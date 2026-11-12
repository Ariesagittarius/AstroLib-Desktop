/**
 * src/server/plugins/library/dev-server-plugin.mjs
 * ============================================================================
 * AstroLib 统一研读实体与书库服务插件 (/api/library/*)
 * ============================================================================
 * 职责：
 * 1. 响应前端统一书库实体查询 (/api/library/entities)；
 * 2. 响应书架查询与创建 (/api/library/shelves)；
 * 3. 接收并解压安装 .abp 书籍包 (/api/library/upload-abp)；
 * 4. 彻底解耦，同端服务于 Web 与 Electron 嵌入式服务。
 * ============================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { TaskManager } from '../doc-ingestion/task-manager.ts';

const LIBRARY_PATH_PREFIX = '/api/library';

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, PUT, DELETE',
    'Access-Control-Allow-Headers': '*',
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

export function devLibraryServerPlugin() {
  const projectRoot = process.cwd();
  const registryFile = path.resolve(projectRoot, '.tmp/library-registry.json');

  const getStore = () => {
    try {
      if (fs.existsSync(registryFile)) {
        return JSON.parse(fs.readFileSync(registryFile, 'utf8'));
      }
    } catch {}
    return {
      shelves: [
        { id: 'shelf-math-core', name: '数学基础核心', itemCount: 0, createdAt: Date.now() },
        { id: 'shelf-papers-unread', name: '待研读文献', itemCount: 0, createdAt: Date.now() },
      ],
      customMeta: {},
    };
  };

  const saveStore = (store) => {
    try {
      const dir = path.dirname(registryFile);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(registryFile, JSON.stringify(store, null, 2), 'utf8');
    } catch {}
  };

  return {
    name: 'astrolib-library-dev-server',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const rawUrl = req.url || '';
        if (!rawUrl.startsWith(LIBRARY_PATH_PREFIX)) {
          return next();
        }

        if (req.method === 'OPTIONS') {
          res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, PUT, DELETE',
            'Access-Control-Allow-Headers': '*',
            'Access-Control-Max-Age': '86400',
          });
          return res.end();
        }

        const urlObj = new URL(rawUrl, 'http://localhost');
        const pathname = urlObj.pathname;

        try {
          const store = getStore();

          // 1. 获取全库统一实体 (书籍 + 文献)
          if (req.method === 'GET' && pathname === `${LIBRARY_PATH_PREFIX}/entities`) {
            const entities = [];

            // A. 读取内置 catalog.json 书籍
            const catalogPath = path.resolve(projectRoot, 'public/abp-packs/catalog.json');
            if (fs.existsSync(catalogPath)) {
              try {
                const cat = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
                for (const b of cat.books || []) {
                  const entityId = `book:${b.colSlug}-${b.slug}`;
                  const userMeta = store.customMeta[entityId] || {};
                  entities.push({
                    id: entityId,
                    kind: 'book',
                    title: b.title,
                    subtitle: b.subtitle || '',
                    author: b.author || 'AstroLib',
                    publisher: b.publisher || '高等教育出版社',
                    cover: b.cover || '/favicon.png',
                    category: b.colSlug || 'math',
                    shelfId: userMeta.shelfId,
                    createdAt: Date.now() - 86400000 * 15,
                    lastReadAt: userMeta.lastReadAt,
                    readProgress: userMeta.readProgress || 0,
                    status: 'ready',
                    metadata: {
                      colSlug: b.colSlug,
                      bookSlug: b.slug,
                      entryPoint: b.entryPoint || 'chapter-01',
                      abpPackPath: `/abp-packs/${b.colSlug}-${b.slug}`,
                      edition: b.edition,
                      isbn: b.isbn,
                    },
                  });
                }
              } catch {}
            }

            // B. 读取 MinerU 文献任务
            try {
              const taskMgr = TaskManager.getInstance();
              const tasks = taskMgr.listTasks();
              for (const t of tasks) {
                const taskId = t.taskId || t.id;
                const entityId = `paper:${taskId}`;
                const userMeta = store.customMeta[entityId] || {};

                let entityStatus = 'ready';
                let statusMsg = '';
                if (t.status === 'completed') {
                  entityStatus = 'ready';
                } else if (t.status === 'failed') {
                  entityStatus = 'error';
                  statusMsg = t.error || '解析失败';
                } else {
                  entityStatus = 'processing';
                  statusMsg = `MinerU 解析中 ${t.progress || 0}%`;
                }

                entities.push({
                  id: entityId,
                  kind: 'paper',
                  title: t.fileName.replace(/\.pdf$/i, ''),
                  subtitle: `PDF 学术文献 · ${t.engine === 'api' ? '云端 MinerU' : '本地引擎'}`,
                  author: 'MinerU 学术解析',
                  publisher: '学术文献库',
                  cover: '/astrolib-logo.webp',
                  category: 'paper',
                  shelfId: userMeta.shelfId,
                  createdAt: t.createdAt || Date.now(),
                  lastReadAt: userMeta.lastReadAt,
                  readProgress: userMeta.readProgress || 0,
                  status: entityStatus,
                  statusMessage: statusMsg,
                  metadata: {
                    taskId: taskId,
                    originPdfUrl: `/api/ingest/pdf?taskId=${taskId}`,
                    markdownUrl: `/api/ingest/result?taskId=${taskId}`,
                    hasBookmarks: true,
                    hasAnnotations: true,
                    fileSizeBytes: t.fileSize,
                    totalPages: t.pageCount,
                  },
                });
              }
            } catch {}

            // 排序
            entities.sort((a, b) => {
              const aT = a.lastReadAt || a.createdAt;
              const bT = b.lastReadAt || b.createdAt;
              return bT - aT;
            });

            return sendJson(res, 200, { success: true, entities });
          }

          // 2. 获取书架列表
          if (req.method === 'GET' && pathname === `${LIBRARY_PATH_PREFIX}/shelves`) {
            return sendJson(res, 200, { success: true, shelves: store.shelves });
          }

          // 3. 创建书架
          if (req.method === 'POST' && pathname === `${LIBRARY_PATH_PREFIX}/shelves`) {
            const body = await readJsonBody(req);
            const name = (body.name || '').trim();
            if (!name) return sendJson(res, 400, { error: '书架名称不能为空' });
            const newShelf = {
              id: `shelf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              name,
              itemCount: 0,
              createdAt: Date.now(),
            };
            store.shelves.push(newShelf);
            saveStore(store);
            return sendJson(res, 200, { success: true, shelf: newShelf });
          }

          // 4. 更新实体元数据 (书架归属、阅读进度)
          if (req.method === 'POST' && pathname === `${LIBRARY_PATH_PREFIX}/entity-meta`) {
            const body = await readJsonBody(req);
            const { entityId, updates } = body;
            if (!entityId) return sendJson(res, 400, { error: '缺少 entityId' });
            if (!store.customMeta[entityId]) store.customMeta[entityId] = {};
            Object.assign(store.customMeta[entityId], updates || {});
            saveStore(store);
            return sendJson(res, 200, { success: true });
          }

          // 5. 上传并安装 .abp 书籍包
          if (req.method === 'POST' && pathname === `${LIBRARY_PATH_PREFIX}/upload-abp`) {
            const fileBuf = await readBufferBody(req);
            if (!fileBuf || fileBuf.length === 0) {
              return sendJson(res, 400, { error: '上传内容为空' });
            }
            try {
              const decompressed = zlib.gunzipSync(fileBuf);
              const bundle = JSON.parse(decompressed.toString('utf8'));
              const manifest = bundle.manifest;
              if (!manifest || !manifest.colSlug || !manifest.slug) {
                return sendJson(res, 400, { error: '无效的 ABP 数据包：缺少合法清单' });
              }
              const bookKey = `${manifest.colSlug}-${manifest.slug}`;
              const targetDir = path.resolve(projectRoot, 'public/abp-packs', bookKey);
              fs.mkdirSync(targetDir, { recursive: true });
              fs.writeFileSync(path.join(targetDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
              if (bundle.chapters) {
                for (const [cSlug, cData] of Object.entries(bundle.chapters)) {
                  fs.writeFileSync(path.join(targetDir, `${cSlug}.json`), JSON.stringify(cData, null, 2), 'utf8');
                }
              }
              return sendJson(res, 200, { success: true, manifest });
            } catch (err) {
              return sendJson(res, 500, { error: `安装 ABP 失败: ${err.message}` });
            }
          }

          return sendJson(res, 404, { error: '未找到对应 API 接口' });
        } catch (err) {
          return sendJson(res, 500, { error: err?.message || String(err) });
        }
      });
    },
  };
}

export default devLibraryServerPlugin;
