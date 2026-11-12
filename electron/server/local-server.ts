/**
 * electron/server/local-server.ts
 * ============================================================================
 * AstroLib 本地嵌入式服务引擎 (Embedded Localhost Server & Plugin Bridge)
 * ============================================================================
 * 职责：
 * 1. 启动轻量 Node 原生 HTTP 服务 (127.0.0.1:port)；
 * 2. 桥接挂载既有 10+ 个 Vite Connect 中间件插件 (Typst 编译、ONNX 向量、AI 代理等)；
 * 3. 挂载 StaticHandler 极速分发 pre-built dist/ 静态页面；
 * 4. 零延迟即开即用 (<500ms)，前端所有相对 API 路径 100% 无缝复用。
 * ============================================================================
 */

import http from 'node:http';
import path from 'node:path';
import { StaticHandler } from './static-handler.ts';

type ConnectMiddleware = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  next: (err?: any) => void
) => void | Promise<void>;

export class LocalServer {
  private server: http.Server | null = null;
  private port = 0;
  private projectRoot: string;
  private distDir: string;
  private userAbpDir?: string;
  private middlewares: ConnectMiddleware[] = [];
  private staticHandler: StaticHandler;

  constructor(projectRoot: string, distDir?: string, userAbpDir?: string) {
    this.projectRoot = projectRoot;
    this.distDir = distDir || path.join(projectRoot, 'dist');
    this.userAbpDir = userAbpDir;
    this.staticHandler = new StaticHandler(this.distDir, this.userAbpDir, this.projectRoot);
  }

  /**
   * 加载并装配既有业务服务端插件
   */
  private async loadPlugins(): Promise<void> {
    const mockServer = {
      middlewares: {
        use: (fn: ConnectMiddleware) => {
          this.middlewares.push(fn);
        },
      },
    };

    const pluginLoaders = [
      // 1. 章节导出 (Typst / LaTeX / PDF)
      async () => {
        const mod: any = await import('../../src/server/plugins/chapter-export/dev-server-plugin.mjs');
        const fn = mod.default || mod.devChapterExportServerPlugin;
        return typeof fn === 'function' ? fn() : null;
      },
      // 2. 双语向量对齐 (ONNX Runtime / Transformers.js / Qwen3)
      async () => {
        const mod: any = await import('../../src/server/plugins/bilingual-aligner/dev-server-plugin.mjs');
        const fn = mod.bilingualDevServerPlugin || mod.default;
        return typeof fn === 'function' ? fn() : null;
      },
      // 3. Gemini AI 全双工反代
      async () => {
        const mod: any = await import('../../src/server/plugins/gemini-proxy/dev-server-plugin.mjs');
        const fn = mod.geminiProxyDevServerPlugin || mod.default;
        return typeof fn === 'function' ? fn() : null;
      },
      // 4. BUPT AI 全双工反代
      async () => {
        const mod: any = await import('../../src/server/plugins/bupt-proxy/dev-server-plugin.mjs');
        const fn = mod.buptProxyDevServerPlugin || mod.default;
        return typeof fn === 'function' ? fn() : null;
      },
      // 5. 学术翻译中继
      async () => {
        const mod: any = await import('../../src/server/plugins/translation/dev-server-plugin.mjs');
        const fn = mod.translationDevServerPlugin || mod.default;
        return typeof fn === 'function' ? fn() : null;
      },
      // 6. 习题库持久化与热写回
      async () => {
        const mod: any = await import('../../src/server/plugins/exercise-editor/dev-server-plugin.mjs');
        const fn = mod.exerciseDevServerPlugin || mod.default;
        return typeof fn === 'function' ? fn() : null;
      },
      // 7. MinerU 文档摄取与自动解析
      async () => {
        const mod: any = await import('../../src/server/plugins/doc-ingestion/dev-server-plugin.mjs');
        const fn = mod.ingestDevServerPlugin || mod.default;
        return typeof fn === 'function' ? fn() : null;
      },
      // 8. 离线数据包分发
      async () => {
        const mod: any = await import('../../src/server/plugins/offline-pack/dev-server-plugin.mjs');
        const fn = mod.offlinePackDevServerPlugin || mod.default;
        return typeof fn === 'function' ? fn() : null;
      },
      // 9. 章节关系图谱
      async () => {
        const mod: any = await import('../../src/server/plugins/relation-graph/dev-server-plugin.mjs');
        const fn = mod.default || mod.devRelationGraphServerPlugin;
        return typeof fn === 'function' ? fn() : null;
      },
      // 10. 模块巡检
      async () => {
        const mod: any = await import('../../src/server/plugins/module-inspector/dev-server-plugin.mjs');
        const fn = mod.default || mod.devInspectorServerPlugin;
        return typeof fn === 'function' ? fn() : null;
      },
      // 11. 在线可视化精修写回
      async () => {
        const mod: any = await import('../../src/features/mdx-editor/server/dev-server-plugin.mjs');
        const fn = mod.default || mod.devEditServerPlugin;
        return typeof fn === 'function' ? fn() : null;
      },
      // 12. 本地 Qwen 关注点透镜与信息高亮
      async () => {
        const mod: any = await import('../../src/server/plugins/info-highlight/dev-server-plugin.mjs');
        const fn = mod.default || mod.infoHighlightDevServerPlugin;
        return typeof fn === 'function' ? fn() : null;
      },
      // 13. 统一研读实体与书库聚合服务 (书籍 + 文献)
      async () => {
        const mod: any = await import('../../src/server/plugins/library/dev-server-plugin.mjs');
        const fn = mod.default || mod.devLibraryServerPlugin;
        return typeof fn === 'function' ? fn() : null;
      },
    ];

    for (const loader of pluginLoaders) {
      try {
        const plugin = await loader();
        if (plugin && typeof plugin.configureServer === 'function') {
          plugin.configureServer(mockServer);
        }
      } catch (err) {
        console.warn('[local-server] 挂载插件跳过或警告:', err);
      }
    }
  }

  /**
   * 启动本地 HTTP 监听服务
   */
  async start(preferredPort = 0): Promise<number> {
    await this.loadPlugins();

    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        // 允许 Electron 与本地跨域访问
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
        res.setHeader('Access-Control-Allow-Headers', '*');

        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }

        // 桌面端健康探活接口
        if (req.url === '/api/desktop/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', port: this.port, timestamp: Date.now() }));
          return;
        }

        // 顺序流转 Connect 中间件
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

          if (idx < this.middlewares.length) {
            const current = this.middlewares[idx++];
            try {
              await current(req, res, next);
            } catch (e) {
              next(e);
            }
          } else {
            // 所有中间件均未消费此请求：进入静态资源分发
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

      // 绑定 127.0.0.1 限制仅本地访问，杜绝外部网络探测
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

  /**
   * 关闭本地服务
   */
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
