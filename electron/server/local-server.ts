import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { StaticHandler } from './static-handler.ts';

type ConnectMiddleware = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  next: (err?: any) => void
) => void | Promise<void>;

interface LazyPluginEntry {
  id: string;
  prefixes: string[];
  loader: () => Promise<any>;
  middlewares: ConnectMiddleware[] | null;
  loadingPromise: Promise<ConnectMiddleware[]> | null;
}

function extractRequestPathname(rawUrl: string | undefined): string {
  if (!rawUrl) return '/';
  const qIdx = rawUrl.indexOf('?');
  return qIdx === -1 ? rawUrl : rawUrl.slice(0, qIdx);
}

const LOCAL_CSP_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "connect-src 'self' https: http://127.0.0.1:* http://localhost:*",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'self'",
  "form-action 'self'",
].join('; ');

function isAllowedLoopbackOrigin(originHeader: string | undefined, expectedPort: number): boolean {
  if (!originHeader) return true;
  if (originHeader === 'null') return false;
  try {
    const parsed = new URL(originHeader);
    const isHttp = parsed.protocol === 'http:' || parsed.protocol === 'https:';
    const isLoopbackHost = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
    if (!isHttp || !isLoopbackHost) {
      return false;
    }
    if (expectedPort > 0) {
      return parsed.port === String(expectedPort);
    }
    return true;
  } catch {
    return false;
  }
}

function isAllowedLoopbackHost(hostHeader: string | undefined): boolean {
  if (!hostHeader) return true;
  return /^(?:127\.0\.0\.1|localhost)(?::\d+)?$/i.test(hostHeader.trim());
}

function timingSafeTokenMatch(expected: string, candidate: string | undefined): boolean {
  if (!candidate) return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(candidate, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export class LocalServer {
  private server: http.Server | null = null;
  private port = 0;
  private readonly authToken: string;
  private projectRoot: string;
  private distDir: string;
  private userAbpDir?: string;
  private pluginRegistry: LazyPluginEntry[];
  private staticHandler: StaticHandler;

  constructor(projectRoot: string, distDir?: string, userAbpDir?: string) {
    this.authToken = crypto.randomBytes(32).toString('hex');
    this.projectRoot = projectRoot;
    this.distDir = distDir || path.join(projectRoot, 'dist');
    this.userAbpDir = userAbpDir;
    this.staticHandler = new StaticHandler(this.distDir, this.userAbpDir, this.projectRoot);
    this.pluginRegistry = this.createLazyPluginRegistry();
  }

  getAuthToken(): string {
    return this.authToken;
  }

  private createLazyPluginRegistry(): LazyPluginEntry[] {
    const entries: Array<Pick<LazyPluginEntry, 'id' | 'prefixes' | 'loader'>> = [
      {
        id: 'chapter-export',
        prefixes: ['/__chapter_export__'],
        loader: async () => {
          const mod: any = await import('../../src/server/plugins/chapter-export/dev-server-plugin.mjs');
          const fn = mod.default || mod.devChapterExportServerPlugin;
          return typeof fn === 'function' ? fn() : null;
        },
      },
      {
        id: 'bilingual-aligner',
        prefixes: ['/__bilingual__'],
        loader: async () => {
          const mod: any = await import('../../src/server/plugins/bilingual-aligner/dev-server-plugin.mjs');
          const fn = mod.bilingualDevServerPlugin || mod.default;
          return typeof fn === 'function' ? fn() : null;
        },
      },
      {
        id: 'gemini-proxy',
        prefixes: ['/api/proxy/gemini'],
        loader: async () => {
          const mod: any = await import('../../src/server/plugins/gemini-proxy/dev-server-plugin.mjs');
          const fn = mod.geminiProxyDevServerPlugin || mod.default;
          return typeof fn === 'function' ? fn() : null;
        },
      },
      {
        id: 'bupt-proxy',
        prefixes: ['/api/proxy/bupt'],
        loader: async () => {
          const mod: any = await import('../../src/server/plugins/bupt-proxy/dev-server-plugin.mjs');
          const fn = mod.buptProxyDevServerPlugin || mod.default;
          return typeof fn === 'function' ? fn() : null;
        },
      },
      {
        id: 'translation',
        prefixes: ['/api/translate', '/api/dict'],
        loader: async () => {
          const mod: any = await import('../../src/server/plugins/translation/dev-server-plugin.mjs');
          const fn = mod.translationDevServerPlugin || mod.default;
          return typeof fn === 'function' ? fn() : null;
        },
      },
      {
        id: 'doc-ingestion',
        prefixes: ['/api/ingest'],
        loader: async () => {
          const mod: any = await import('../../src/server/plugins/doc-ingestion/dev-server-plugin.mjs');
          const fn = mod.ingestDevServerPlugin || mod.default;
          return typeof fn === 'function' ? fn() : null;
        },
      },
      {
        id: 'info-highlight',
        prefixes: ['/__info_highlight__'],
        loader: async () => {
          const mod: any = await import('../../src/server/plugins/info-highlight/dev-server-plugin.mjs');
          const fn = mod.default || mod.infoHighlightDevServerPlugin;
          return typeof fn === 'function' ? fn() : null;
        },
      },
      {
        id: 'content-api',
        prefixes: ['/api/v1/content'],
        loader: async () => {
          const mod: any = await import('../../src/server/plugins/content-api/dev-server-plugin.mjs');
          const fn = mod.default || mod.contentApiDevServerPlugin;
          return typeof fn === 'function' ? fn() : null;
        },
      },
      {
        id: 'pdf2abp',
        prefixes: ['/api/v1/pdf2abp'],
        loader: async () => {
          const mod: any = await import('../../src/server/plugins/pdf2abp/dev-server-plugin.mjs');
          const fn = mod.pdf2abpDevServerPlugin || mod.default;
          return typeof fn === 'function' ? fn() : null;
        },
      },
    ];

    return entries.map((e) => ({
      ...e,
      middlewares: null,
      loadingPromise: null,
    }));
  }

  private async ensurePluginLoaded(entry: LazyPluginEntry): Promise<ConnectMiddleware[]> {
    if (entry.middlewares !== null) {
      return entry.middlewares;
    }
    if (entry.loadingPromise) {
      return entry.loadingPromise;
    }

    entry.loadingPromise = (async () => {
      const collected: ConnectMiddleware[] = [];
      const mockServer = {
        middlewares: {
          use: (fn: ConnectMiddleware) => {
            collected.push(fn);
          },
        },
      };
      try {
        const plugin = await entry.loader();
        if (plugin && typeof plugin.configureServer === 'function') {
          plugin.configureServer(mockServer);
        }
      } catch (err) {
        console.warn(`[local-server] 按需加载插件 ${entry.id} 失败或跳过:`, err);
      }
      entry.middlewares = collected;
      return collected;
    })();

    try {
      return await entry.loadingPromise;
    } finally {
      entry.loadingPromise = null;
    }
  }

  async start(preferredPort = 0): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'SAMEORIGIN');
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
        res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
        res.setHeader('Content-Security-Policy', LOCAL_CSP_POLICY);

        const rawOrigin = Array.isArray(req.headers.origin) ? req.headers.origin[0] : req.headers.origin;
        const secFetchSite = Array.isArray(req.headers['sec-fetch-site'])
          ? req.headers['sec-fetch-site'][0]
          : req.headers['sec-fetch-site'];
        const hostHeader = Array.isArray(req.headers.host) ? req.headers.host[0] : req.headers.host;

        if (!isAllowedLoopbackHost(hostHeader) || !isAllowedLoopbackOrigin(rawOrigin, this.port) || secFetchSite === 'cross-site') {
          res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: 'Forbidden cross-origin or untrusted host request' }));
          return;
        }

        if (rawOrigin) {
          res.setHeader('Access-Control-Allow-Origin', rawOrigin);
          res.setHeader('Vary', 'Origin');
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-AstroLib-Token, Authorization, X-File-Name, X-Page-Ranges, X-Mineru-Token');
        }

        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }

        const pathname = extractRequestPathname(req.url);

        if (pathname === '/api/desktop/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', port: this.port, timestamp: Date.now() }));
          return;
        }

        const matchedPlugin = this.pluginRegistry.find((entry) =>
          entry.prefixes.some((prefix) => pathname.startsWith(prefix))
        );

        const isProtectedApiRoute =
          Boolean(matchedPlugin) || pathname.startsWith('/api/') || pathname.startsWith('/__');
        if (isProtectedApiRoute) {
          const rawToken = req.headers['x-astrolib-token'];
          const token = Array.isArray(rawToken) ? rawToken[0] : rawToken;
          if (!timingSafeTokenMatch(this.authToken, token)) {
            res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'Unauthorized: missing or invalid X-AstroLib-Token' }));
            return;
          }
        }

        let middlewares: ConnectMiddleware[] = [];
        if (matchedPlugin) {
          try {
            middlewares = await this.ensurePluginLoaded(matchedPlugin);
          } catch (err: any) {
            console.error('[local-server] 插件加载错误:', err);
            if (!res.headersSent) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: err?.message || String(err) }));
            }
            return;
          }
        }

        let idx = 0;
        const next = async (err?: any) => {
          if (err) {
            console.error('[local-server] 中间件执行错误:', err);
            if (!res.headersSent) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: err?.message || String(err) }));
            }
            return;
          }

          if (res.writableEnded) {
            return;
          }

          if (idx < middlewares.length) {
            const current = middlewares[idx++];
            try {
              await current(req, res, next);
            } catch (e) {
              next(e);
            }
          } else {

            const handled = await this.staticHandler.handle(req, res);
            if (!handled && !res.writableEnded) {
              res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
              res.end('404 Not Found - AstroLib Desktop Server');
            }
          }
        };

        await next();
      });

      const listenPort = preferredPort || 62960;
      this.server.on('error', (err: any) => {
        if (err.code === 'EADDRINUSE' && listenPort !== 0) {
          console.warn(`[local-server] 端口 ${listenPort} 已被占用，自动尝试随机可用端口...`);
          try {
            this.server?.listen(0, '127.0.0.1', () => {
              const addr = this.server?.address();
              if (addr && typeof addr === 'object') {
                this.port = addr.port;
                resolve(this.port);
              } else {
                resolve(0);
              }
            });
          } catch (listenErr) {
            reject(listenErr);
          }
        } else {
          reject(err);
        }
      });

      this.server.listen(listenPort, '127.0.0.1', () => {
        const addr = this.server?.address();
        if (addr && typeof addr === 'object') {
          this.port = addr.port;
          resolve(this.port);
        } else {
          resolve(listenPort);
        }
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    return new Promise((resolve) => {
      this.server?.close(() => {
        this.server = null;
        resolve();
      });
    });
  }

  getPort(): number {
    return this.port;
  }
}
