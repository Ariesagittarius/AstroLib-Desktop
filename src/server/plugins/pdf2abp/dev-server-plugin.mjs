/**
 * src/server/plugins/pdf2abp/dev-server-plugin.mjs
 * ============================================================================
 * Vite / Electron LocalServer 插件：自动化 PDF2ABP 多智能体管线服务
 * (/api/v1/pdf2abp/*)
 * ============================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_YOULABBER_CONFIG,
  Pdf2AbpJobManager,
} from '../../../ai/agent/pdf2abp-agent.ts';
import { resolveProviderCapabilities } from '../../../ai/agent/context-manager.ts';
import { listPdf2AbpSkills, readPdf2AbpSkill } from '../../../ai/skills/pdf2abp/index.ts';
import {
  checkMineruAvailability,
  getPythonAvailability,
} from '../../../services/pdf2abp/index.ts';

const PDF2ABP_PREFIX = '/api/v1/pdf2abp';

const MIME_TYPES = {
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.mdx': 'text/mdx; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.log': 'text/plain; charset=utf-8',
  '.py': 'text/x-python; charset=utf-8',
  '.jsonl': 'application/x-ndjson; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.abp': 'application/octet-stream',
};

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
  });
  res.end(JSON.stringify(data));
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf-8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('Invalid JSON request body');
  }
}

export function pdf2abpDevServerPlugin() {
  const manager = Pdf2AbpJobManager.getInstance();

  return {
    name: 'astrolib-pdf2abp-dev-server',
    configureServer(server) {
      if (server.watcher) {
        try {
          server.watcher.unwatch('**/.tmp/**');
          server.watcher.unwatch(path.resolve('.tmp'));
        } catch {
          // ignore
        }
      }

      server.middlewares.use(async (req, res, next) => {
        const rawUrl = req.url || '';
        if (!rawUrl.startsWith(PDF2ABP_PREFIX)) {
          return next();
        }

        if (req.method === 'OPTIONS') {
          res.writeHead(204, {
            'Cache-Control': 'no-store',
          });
          return res.end();
        }

        const urlObj = new URL(rawUrl, 'http://localhost');
        const pathname = urlObj.pathname;
        const relRoute = pathname.slice(PDF2ABP_PREFIX.length) || '/';

        try {
          // 1. GET /api/v1/pdf2abp/health
          if (req.method === 'GET' && relRoute === '/health') {
            const [mineru, python] = await Promise.all([
              checkMineruAvailability(),
              getPythonAvailability(),
            ]);
            const capabilities = resolveProviderCapabilities(
              DEFAULT_YOULABBER_CONFIG.providerId,
              DEFAULT_YOULABBER_CONFIG.modelId
            );
            return sendJson(res, 200, {
              ok: true,
              mineru,
              python,
              defaultGateway: {
                providerId: DEFAULT_YOULABBER_CONFIG.providerId,
                modelId: DEFAULT_YOULABBER_CONFIG.modelId,
                baseURL: DEFAULT_YOULABBER_CONFIG.baseURL,
                capabilities,
              },
            });
          }

          // 2. GET /api/v1/pdf2abp/skills
          if (req.method === 'GET' && relRoute === '/skills') {
            return sendJson(res, 200, { skills: listPdf2AbpSkills() });
          }

          // 3. GET /api/v1/pdf2abp/skills/:id
          const skillMatch = relRoute.match(/^\/skills\/([^/]+)$/);
          if (req.method === 'GET' && skillMatch) {
            const skillId = decodeURIComponent(skillMatch[1]);
            const sectionId = urlObj.searchParams.get('section') || undefined;
            try {
              const skill = readPdf2AbpSkill(skillId, sectionId);
              return sendJson(res, 200, { skill });
            } catch (err) {
              return sendJson(res, 404, {
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }

          // 4. POST /api/v1/pdf2abp/jobs
          if (req.method === 'POST' && relRoute === '/jobs') {
            let body;
            try {
              body = await readJsonBody(req);
            } catch (err) {
              return sendJson(res, 400, {
                errorCode: 'INVALID_JSON',
                error: err instanceof Error ? err.message : 'Invalid JSON',
              });
            }

            if (!body.pdfPath || typeof body.pdfPath !== 'string' || !body.pdfPath.trim()) {
              return sendJson(res, 400, {
                errorCode: 'INVALID_PDF_PATH',
                error: 'Missing required field: pdfPath',
              });
            }

            const resolvedPdf = path.resolve(body.pdfPath);
            if (!fs.existsSync(resolvedPdf) || fs.statSync(resolvedPdf).isDirectory()) {
              return sendJson(res, 400, {
                errorCode: 'PDF_NOT_FOUND',
                error: `PDF file does not exist: ${resolvedPdf}`,
              });
            }
            if (path.extname(resolvedPdf).toLowerCase() !== '.pdf') {
              return sendJson(res, 400, {
                errorCode: 'INVALID_PDF_PATH',
                error: `Only .pdf files are supported: ${resolvedPdf}`,
              });
            }

            const job = manager.startJob({
              pdfPath: resolvedPdf,
              jobId: typeof body.jobId === 'string' ? body.jobId : undefined,
              providerId: typeof body.providerId === 'string' ? body.providerId : undefined,
              modelId: typeof body.modelId === 'string' ? body.modelId : undefined,
              baseURL: typeof body.baseURL === 'string' ? body.baseURL : undefined,
              apiKey: typeof body.apiKey === 'string' ? body.apiKey : undefined,
              extraHeaders:
                body.extraHeaders && typeof body.extraHeaders === 'object'
                  ? body.extraHeaders
                  : undefined,
              concurrency: typeof body.concurrency === 'number' ? body.concurrency : undefined,
              autoImport: typeof body.autoImport === 'boolean' ? body.autoImport : undefined,
              instructions: typeof body.instructions === 'string' ? body.instructions : undefined,
              maxSteps: typeof body.maxSteps === 'number' ? body.maxSteps : undefined,
            });
            return sendJson(res, 202, { job });
          }

          // 5. GET /api/v1/pdf2abp/jobs
          if (req.method === 'GET' && relRoute === '/jobs') {
            return sendJson(res, 200, { jobs: manager.listJobs() });
          }

          // 6. GET /api/v1/pdf2abp/jobs/:id
          const jobMatch = relRoute.match(/^\/jobs\/([^/]+)$/);
          if (req.method === 'GET' && jobMatch) {
            const jobId = decodeURIComponent(jobMatch[1]);
            const job = manager.getJob(jobId);
            if (!job) {
              return sendJson(res, 404, { error: `Job not found: ${jobId}` });
            }
            return sendJson(res, 200, { job });
          }

          // 7. GET /api/v1/pdf2abp/jobs/:id/stream (SSE)
          const streamMatch = relRoute.match(/^\/jobs\/([^/]+)\/stream$/);
          if (req.method === 'GET' && streamMatch) {
            const jobId = decodeURIComponent(streamMatch[1]);
            const job = manager.getJob(jobId);
            if (!job) {
              return sendJson(res, 404, { error: `Job not found: ${jobId}` });
            }

            res.writeHead(200, {
              'Content-Type': 'text/event-stream; charset=utf-8',
              'Cache-Control': 'no-cache, no-transform',
              Connection: 'keep-alive',
            });

            let lastSeq = 0;
            const writeSse = (eventName, payload, id) => {
              if (res.writableEnded) return;
              if (id !== undefined) res.write(`id: ${id}\n`);
              res.write(`event: ${eventName}\n`);
              res.write(`data: ${JSON.stringify(payload)}\n\n`);
            };

            const existingEvents = manager.getJobEvents(jobId);
            for (const evt of existingEvents) {
              writeSse(evt.type, evt, evt.seq);
              if (evt.seq > lastSeq) lastSeq = evt.seq;
            }

            const current = manager.getJob(jobId);
            if (current && current.status !== 'running' && current.status !== 'pending') {
              writeSse('done', { job: current });
              return res.end();
            }

            const keepAlive = setInterval(() => {
              if (!res.writableEnded) {
                res.write(': keepalive\n\n');
              }
            }, 15000);

            let unsubscribe = () => {};
            const cleanup = () => {
              clearInterval(keepAlive);
              unsubscribe();
            };

            unsubscribe = manager.subscribe(jobId, (evt) => {
              if (evt.seq <= lastSeq) return;
              lastSeq = evt.seq;
              writeSse(evt.type, evt, evt.seq);

              const latest = manager.getJob(jobId);
              if (
                evt.type === 'job_completed' ||
                evt.type === 'job_cancelled' ||
                (latest && latest.status !== 'running' && latest.status !== 'pending')
              ) {
                writeSse('done', { job: latest });
                cleanup();
                if (!res.writableEnded) res.end();
              }
            });

            req.on('close', cleanup);
            return;
          }

          // 8. POST /api/v1/pdf2abp/jobs/:id/cancel
          const cancelMatch = relRoute.match(/^\/jobs\/([^/]+)\/cancel$/);
          if (req.method === 'POST' && cancelMatch) {
            const jobId = decodeURIComponent(cancelMatch[1]);
            try {
              const job = manager.cancelJob(jobId);
              return sendJson(res, 200, { job });
            } catch (err) {
              return sendJson(res, 404, {
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }

          // 9. POST /api/v1/pdf2abp/jobs/:id/resume
          const resumeMatch = relRoute.match(/^\/jobs\/([^/]+)\/resume$/);
          if (req.method === 'POST' && resumeMatch) {
            const jobId = decodeURIComponent(resumeMatch[1]);
            const body = await readJsonBody(req).catch(() => ({}));
            try {
              const job = manager.resumeJob(jobId, body);
              return sendJson(res, 202, { job });
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              const status = /正在运行/.test(msg) ? 409 : 404;
              return sendJson(res, status, { error: msg });
            }
          }

          // 10. GET /api/v1/pdf2abp/jobs/:id/files
          const filesMatch = relRoute.match(/^\/jobs\/([^/]+)\/files$/);
          if (req.method === 'GET' && filesMatch) {
            const jobId = decodeURIComponent(filesMatch[1]);
            const ws = manager.getWorkspace(jobId);
            if (!ws) {
              return sendJson(res, 404, { error: `Job not found: ${jobId}` });
            }
            const dir = urlObj.searchParams.get('dir') || '';
            const maxDepthRaw = Number(urlObj.searchParams.get('maxDepth') || 3);
            const maxDepth = Number.isFinite(maxDepthRaw) ? Math.max(1, Math.min(6, maxDepthRaw)) : 3;
            try {
              const entries = ws.listFiles(dir, maxDepth);
              return sendJson(res, 200, { jobId, dir, entries });
            } catch (err) {
              return sendJson(res, 400, {
                errorCode: 'INVALID_WORKSPACE_PATH',
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }

          // 11. GET /api/v1/pdf2abp/jobs/:id/file?path=...
          const fileMatch = relRoute.match(/^\/jobs\/([^/]+)\/file$/);
          if (req.method === 'GET' && fileMatch) {
            const jobId = decodeURIComponent(fileMatch[1]);
            const ws = manager.getWorkspace(jobId);
            if (!ws) {
              return sendJson(res, 404, { error: `Job not found: ${jobId}` });
            }
            const relFilePath = urlObj.searchParams.get('path') || '';
            if (!relFilePath) {
              return sendJson(res, 400, {
                errorCode: 'MISSING_PATH_PARAM',
                error: 'Query parameter "path" is required',
              });
            }

            let absPath;
            try {
              absPath = ws.resolveWorkspacePath(relFilePath);
            } catch (err) {
              return sendJson(res, 403, {
                errorCode: 'PATH_TRAVERSAL_BLOCKED',
                error: err instanceof Error ? err.message : 'Forbidden path',
              });
            }

            if (!fs.existsSync(absPath) || fs.statSync(absPath).isDirectory()) {
              return sendJson(res, 404, { error: `Workspace file not found: ${relFilePath}` });
            }

            const ext = path.extname(absPath).toLowerCase();
            const contentType = MIME_TYPES[ext] || 'application/octet-stream';
            const data = fs.readFileSync(absPath);
            res.writeHead(200, {
              'Content-Type': contentType,
              'Content-Length': data.byteLength,
              'Cache-Control': 'no-cache',
            });
            return res.end(data);
          }

          return sendJson(res, 404, { error: `Unknown endpoint: ${pathname}` });
        } catch (err) {
          return sendJson(res, 500, {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      });
    },
  };
}

export default pdf2abpDevServerPlugin;
