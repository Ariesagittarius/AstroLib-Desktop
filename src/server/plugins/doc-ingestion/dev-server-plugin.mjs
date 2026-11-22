/**
 * src/server/plugins/doc-ingestion/dev-server-plugin.mjs
 * ============================================================================
 * Vite Dev Server 插件：MinerU 文档摄取与自动解析服务接口 (/api/ingest/*)
 * ============================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import { TaskManager } from './task-manager.ts';

const INGEST_PATH_PREFIX = '/api/ingest';

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
  });
  res.end(JSON.stringify(data));
}

async function readBufferBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

async function readJsonBody(req) {
  const raw = (await readBufferBody(req)).toString('utf-8');
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function ingestDevServerPlugin() {
  const taskManager = TaskManager.getInstance();

  return {
    name: 'astrolib-doc-ingestion-dev-server',
    configureServer(server) {
      // 彻底防止 Vite watcher 监听 task/ 临时摄取目录，避免 Windows 解压文件时的 EBUSY 锁文件崩溃
      if (server.watcher) {
        try {
          server.watcher.unwatch('**/task/**');
          server.watcher.unwatch(path.resolve('task'));
        } catch {
          // ignore
        }
      }

      server.middlewares.use(async (req, res, next) => {
        const rawUrl = req.url || '';
        if (!rawUrl.startsWith(INGEST_PATH_PREFIX)) {
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
        const query = Object.fromEntries(urlObj.searchParams.entries());

        try {
          // 2. 健康探活与环境诊断 /api/ingest/health
          if (req.method === 'GET' && pathname === `${INGEST_PATH_PREFIX}/health`) {
            const apiToken = taskManager.getApiClient().getToken();
            const localStatus = await taskManager.getLocalRunner().checkEnvironment();
            return sendJson(res, 200, {
              status: 'ok',
              maxPagesPerParse: 200,
              api: {
                hasToken: Boolean(apiToken),
                tokenPrefix: apiToken ? apiToken.slice(0, 8) + '...' : null,
              },
              local: localStatus,
              timestamp: Date.now(),
            });
          }

          // 2.1 获取或更新 MinerU API Token /api/ingest/token (单一路由，支持清空)
          if (pathname === `${INGEST_PATH_PREFIX}/token`) {
            if (req.method === 'GET') {
              const currentToken = taskManager.getApiClient().getToken() || '';
              const maskedToken =
                currentToken.length > 8
                  ? `${currentToken.slice(0, 4)}****${currentToken.slice(-4)}`
                  : currentToken
                    ? '****'
                    : '';
              return sendJson(res, 200, { hasToken: Boolean(currentToken), maskedToken });
            }
            if (req.method === 'POST') {
              const body = await readJsonBody(req);
              if (typeof body.token !== 'string') {
                return sendJson(res, 400, { error: '请提供合法的 token 字符串' });
              }
              const cleaned = body.token.trim();
              taskManager.getApiClient().persistToken(cleaned);
              return sendJson(res, 200, {
                success: true,
                hasToken: Boolean(cleaned),
                message: cleaned ? 'MinerU API Token 已更新' : 'MinerU API Token 已清除',
              });
            }
          }

          // 3. 上传 PDF /api/ingest/upload
          if (req.method === 'POST' && pathname === `${INGEST_PATH_PREFIX}/upload`) {
            const fileBuffer = await readBufferBody(req);
            if (!fileBuffer || fileBuffer.length === 0) {
              return sendJson(res, 400, { error: '上传内容为空' });
            }

            // 从请求头获取文件名与参数
            let rawFileName = req.headers['x-file-name'];
            let fileName = 'document.pdf';
            if (rawFileName) {
              try {
                fileName = decodeURIComponent(String(rawFileName));
              } catch {
                fileName = String(rawFileName);
              }
            }

            const rawEngine = req.headers['x-engine'];
            const engine = rawEngine === 'local' ? 'local' : rawEngine === 'agent' ? 'agent' : 'api';
            const pageRanges = req.headers['x-page-ranges'] ? String(req.headers['x-page-ranges']) : undefined;

            const taskMeta = await taskManager.createTask(fileName, fileBuffer, {
              engine,
              pageRanges,
            });

            return sendJson(res, 200, {
              success: true,
              task: taskMeta,
            });
          }

          // 4. 触发解析 /api/ingest/parse
          if (req.method === 'POST' && pathname === `${INGEST_PATH_PREFIX}/parse`) {
            const body = await readJsonBody(req);
            const taskId = body.taskId;
            if (!taskId) {
              return sendJson(res, 400, { error: '缺少 taskId' });
            }

            // 提取客户端传递的 Token (Header 优先，Body 兜底)
            const authHeader = req.headers['authorization'] || '';
            const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
            const passedToken = bearerToken || (typeof body.token === 'string' ? body.token.trim() : '');

            const engine = body.engine === 'local' ? 'local' : body.engine === 'agent' ? 'agent' : 'api';
            const pageRanges = typeof body.pageRanges === 'string' ? body.pageRanges : undefined;
            const updatedTask = taskManager.startParse(taskId, engine, {
              token: passedToken || undefined,
              pageRanges,
            });
            return sendJson(res, 200, { success: true, task: updatedTask });
          }

          // 4.05 删除文献任务 /api/ingest/task?taskId=...
          if (req.method === 'DELETE' && pathname === `${INGEST_PATH_PREFIX}/task`) {
            const taskId = query.taskId;
            if (!taskId) {
              return sendJson(res, 400, { error: '缺少 taskId' });
            }
            const deleted = taskManager.deleteTask(taskId);
            if (!deleted) {
              return sendJson(res, 404, { error: `未找到任务 ${taskId}` });
            }
            return sendJson(res, 200, { success: true });
          }

          // 4.1 AI Agent 专用免密极速轻量解析 /api/ingest/agent-parse
          if (req.method === 'POST' && pathname === `${INGEST_PATH_PREFIX}/agent-parse`) {
            const buffer = await readBufferBody(req);
            if (!buffer || buffer.length === 0) {
              return sendJson(res, 400, { error: '文件内容为空' });
            }
            if (buffer.length > 10 * 1024 * 1024) {
              return sendJson(res, 400, { error: 'Agent 免密解析仅支持 <= 10MB 的文件' });
            }

            const tempId = `agent_tmp_${Date.now()}`;
            const tempDir = path.join(taskManager.getBaseDir(), '.agent_temp', tempId);
            fs.mkdirSync(tempDir, { recursive: true });
            const tempPdf = path.join(tempDir, 'doc.pdf');
            fs.writeFileSync(tempPdf, buffer);

            try {
              const { markdown } = await taskManager.getApiClient().parseWithAgentApi(tempPdf);
              return sendJson(res, 200, { success: true, markdown });
            } finally {
              fs.rmSync(tempDir, { recursive: true, force: true });
            }
          }

          // 4.9 获取所有任务列表 /api/ingest/tasks
          if (req.method === 'GET' && pathname === `${INGEST_PATH_PREFIX}/tasks`) {
            const tasks = taskManager.listTasks();
            return sendJson(res, 200, { success: true, tasks });
          }

          // 5. 查询任务状态 /api/ingest/status
          if (req.method === 'GET' && pathname === `${INGEST_PATH_PREFIX}/status`) {
            const taskId = query.taskId;
            if (!taskId) {
              return sendJson(res, 400, { error: '缺少 taskId' });
            }
            const task = taskManager.reconcileStaleTask(taskId);
            if (!task) {
              return sendJson(res, 404, { error: `未找到任务 ${taskId}` });
            }
            return sendJson(res, 200, {
              task,
              isActive: taskManager.isJobActive(taskId),
            });
          }

          // 6. 获取解析结果 (Markdown + Blocks + Images) /api/ingest/result
          if (req.method === 'GET' && pathname === `${INGEST_PATH_PREFIX}/result`) {
            const taskId = query.taskId;
            if (!taskId) {
              return sendJson(res, 400, { error: '缺少 taskId' });
            }
            const result = taskManager.getResult(taskId);
            if (!result) {
              const task = taskManager.getTask(taskId);
              if (task && task.status !== 'completed') {
                return sendJson(res, 202, { message: '解析尚未完成', status: task.status, progress: task.progress });
              }
              return sendJson(res, 404, { error: `未找到任务 ${taskId} 的成果数据` });
            }
            return sendJson(res, 200, { result });
          }

          // 7.1 获取 PDF 元数据 (页数与每页尺寸，基于本地 mupdf，免外网 CDN) /api/ingest/pdf/meta?taskId=...
          if (req.method === 'GET' && pathname === `${INGEST_PATH_PREFIX}/pdf/meta`) {
            const taskId = query.taskId;
            if (!taskId) return sendJson(res, 400, { error: '缺少 taskId' });

            const pdfPath = taskManager.getOriginPdfPath(taskId);
            if (!pdfPath || !fs.existsSync(pdfPath)) {
              return sendJson(res, 404, { error: '未找到对应 PDF 文件' });
            }

            try {
              const mupdfMod = await import('mupdf');
              const mupdf = mupdfMod.default || mupdfMod;
              const pdfBuf = fs.readFileSync(pdfPath);
              const doc = mupdf.Document.openDocument(pdfBuf, 'application/pdf');
              const pageCount = doc.countPages();
              const pages = [];
              for (let i = 0; i < pageCount; i++) {
                const page = doc.loadPage(i);
                const bounds = page.getBounds();
                pages.push({
                  width: Math.max(1, bounds[2] - bounds[0]),
                  height: Math.max(1, bounds[3] - bounds[1]),
                });
              }
              return sendJson(res, 200, { pageCount, pages });
            } catch (err) {
              return sendJson(res, 500, { error: `PDF 元数据解析失败: ${err?.message || err}` });
            }
          }

          // 7.2 本地 MuPDF 渲染单页 PNG /api/ingest/pdf/page?taskId=...&page=0&scale=1.5
          if (req.method === 'GET' && pathname === `${INGEST_PATH_PREFIX}/pdf/page`) {
            const taskId = query.taskId;
            if (!taskId) return sendJson(res, 400, { error: '缺少 taskId' });

            const pdfPath = taskManager.getOriginPdfPath(taskId);
            if (!pdfPath || !fs.existsSync(pdfPath)) {
              return sendJson(res, 404, { error: '未找到对应 PDF 文件' });
            }

            try {
              const mupdfMod = await import('mupdf');
              const mupdf = mupdfMod.default || mupdfMod;
              const pdfBuf = fs.readFileSync(pdfPath);
              const doc = mupdf.Document.openDocument(pdfBuf, 'application/pdf');
              const pageCount = doc.countPages();
              const rawPage = Number.parseInt(String(query.page ?? '0'), 10);
              const pageIdx = Math.max(0, Math.min(pageCount - 1, Number.isFinite(rawPage) ? rawPage : 0));
              const rawScale = Number.parseFloat(String(query.scale ?? '1.5'));
              const scale = Math.max(0.5, Math.min(3.0, Number.isFinite(rawScale) ? rawScale : 1.5));

              const page = doc.loadPage(pageIdx);
              const pixmap = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true);
              const pngBytes = Buffer.from(pixmap.asPNG());
              res.writeHead(200, {
                'Content-Type': 'image/png',
                'Content-Length': pngBytes.byteLength,
                'Cache-Control': 'private, max-age=300',
              });
              res.end(pngBytes);
              return;
            } catch (err) {
              return sendJson(res, 500, { error: `PDF 页面渲染失败: ${err?.message || err}` });
            }
          }

          // 7. 流式传输原版 PDF /api/ingest/pdf?taskId=...
          if (req.method === 'GET' && pathname === `${INGEST_PATH_PREFIX}/pdf`) {
            const taskId = query.taskId;
            if (!taskId) return sendJson(res, 400, { error: '缺少 taskId' });

            const pdfPath = taskManager.getOriginPdfPath(taskId);
            if (!pdfPath || !fs.existsSync(pdfPath)) {
              return sendJson(res, 404, { error: '未找到对应 PDF 文件' });
            }

            const stat = fs.statSync(pdfPath);
            res.writeHead(200, {
              'Content-Type': 'application/pdf',
              'Content-Length': stat.size,
              'Accept-Ranges': 'bytes',
              'Cache-Control': 'private, max-age=3600',
            });
            fs.createReadStream(pdfPath).pipe(res);
            return;
          }

          // 8. 访问提取出的图片资源 /api/ingest/image?taskId=...&name=...
          if (req.method === 'GET' && pathname === `${INGEST_PATH_PREFIX}/image`) {
            const taskId = query.taskId;
            const imageName = query.name;
            if (!taskId || !imageName) {
              return sendJson(res, 400, { error: '缺少 taskId 或 image name' });
            }

            const taskDir = taskManager.getUnpackedDir(taskId);
            if (!taskDir || !fs.existsSync(taskDir)) {
              return sendJson(res, 404, { error: '未找到任务解包资源' });
            }
            // 递归搜索该图片
            let foundPath = null;
            const findImg = (dir) => {
              if (!fs.existsSync(dir)) return;
              const entries = fs.readdirSync(dir, { withFileTypes: true });
              for (const ent of entries) {
                const full = path.join(dir, ent.name);
                if (ent.isFile() && ent.name === imageName) {
                  foundPath = full;
                  return;
                }
                if (ent.isDirectory()) {
                  findImg(full);
                  if (foundPath) return;
                }
              }
            };

            findImg(taskDir);

            if (!foundPath || !fs.existsSync(foundPath)) {
              return sendJson(res, 404, { error: '图片不存在' });
            }

            const ext = path.extname(imageName).toLowerCase();
            const mimeMap = {
              '.png': 'image/png',
              '.jpg': 'image/jpeg',
              '.jpeg': 'image/jpeg',
              '.webp': 'image/webp',
              '.svg': 'image/svg+xml',
            };
            const contentType = mimeMap[ext] || 'application/octet-stream';

            res.writeHead(200, {
              'Content-Type': contentType,
              'Cache-Control': 'public, max-age=86400',
            });
            fs.createReadStream(foundPath).pipe(res);
            return;
          }

          // 9. 下载清洗数据包 ZIP /api/ingest/download-zip?taskId=...
          if (req.method === 'GET' && pathname === `${INGEST_PATH_PREFIX}/download-zip`) {
            const taskId = query.taskId;
            if (!taskId) return sendJson(res, 400, { error: '缺少 taskId' });

            const resolvedTaskDir = taskManager.findTaskDir(taskId) || path.join(taskManager.getBaseDir(), taskId);
            const zipPath = path.join(resolvedTaskDir, 'unpacked', 'result_archive.zip');
            if (fs.existsSync(zipPath)) {
              const stat = fs.statSync(zipPath);
              res.writeHead(200, {
                'Content-Type': 'application/zip',
                'Content-Length': stat.size,
                'Content-Disposition': `attachment; filename="mineru_clean_${taskId}.zip"`,
              });
              fs.createReadStream(zipPath).pipe(res);
              return;
            }

            return sendJson(res, 404, { error: 'ZIP 归档尚未生成或已过期' });
          }

          // 10. 一键转入 AstroLib 书籍合集 /api/ingest/export-book
          if (req.method === 'POST' && pathname === `${INGEST_PATH_PREFIX}/export-book`) {
            const body = await readJsonBody(req);
            const { taskId, collectionSlug, bookSlug, bookTitle } = body;
            if (!taskId || !collectionSlug || !bookSlug) {
              return sendJson(res, 400, { error: '缺少必要参数 taskId, collectionSlug, bookSlug' });
            }

            const exportResult = await taskManager.exportToCollection(
              taskId,
              collectionSlug,
              bookSlug,
              bookTitle || bookSlug
            );

            return sendJson(res, 200, { success: true, exportResult });
          }

          // 未匹配的子路由
          return sendJson(res, 404, { error: `未知的摄取 API 路径: ${pathname}` });
        } catch (err) {
          return sendJson(res, 500, {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      });
    },
  };
}
