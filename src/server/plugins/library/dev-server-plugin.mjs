import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { TaskManager } from '../doc-ingestion/task-manager.ts';
import { mapIngestTaskToEntityStatus } from '../../../features/library/core/entity-status.ts';
import { validateInstallPayload, AbpInstallError } from '../../../services/content-provider/install-validation.ts';
import { bookFormatRegistry } from '../../../core/book-formats/registry.ts';

const LIBRARY_PATH_PREFIX = '/api/library';

const DEV_MIME_TYPES = {
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

function sendStaticAssetFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = DEV_MIME_TYPES[ext] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': mime,
    'Cache-Control': 'no-cache',
  });
  fs.createReadStream(filePath).pipe(res);
}

function isSafeSubPath(baseDir, resolvedPath) {
  const rel = path.relative(baseDir, resolvedPath);
  return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
}

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
        const urlObj = new URL(rawUrl, 'http://localhost');
        const pathname = urlObj.pathname;

        if (req.method === 'GET' && pathname.startsWith('/abp-packs/')) {
          const decodedRel = decodeURIComponent(pathname.slice('/abp-packs/'.length));
          if (!decodedRel.includes('..') && !decodedRel.includes('\\')) {
            const devBase = path.resolve(projectRoot, '.tmp/dev-abp-packs');
            const artBase = path.resolve(projectRoot, 'artifacts/abp-packs');
            for (const base of [devBase, artBase]) {
              const candidate = path.resolve(base, decodedRel);
              if (isSafeSubPath(base, candidate) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
                return sendStaticAssetFile(res, candidate);
              }
            }
          }
        }

        if (req.method === 'GET' && pathname.startsWith('/ai-index/') && pathname.endsWith('.json')) {
          const fileName = decodeURIComponent(pathname.slice('/ai-index/'.length));
          const bookKey = fileName.replace(/\.json$/i, '');
          if (bookKey && !bookKey.includes('..') && !bookKey.includes('/') && !bookKey.includes('\\')) {
            const devAiPath = path.resolve(projectRoot, '.tmp/dev-abp-packs', bookKey, 'ai-index.json');
            const artAiPath = path.resolve(projectRoot, 'artifacts/ai-index', `${bookKey}.json`);
            for (const candidate of [devAiPath, artAiPath]) {
              if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
                return sendStaticAssetFile(res, candidate);
              }
            }
          }
        }

        const assetMatch =
          req.method === 'GET'
            ? pathname.match(/^\/collections\/([^/]+)\/([^/]+)\/((?:assets|styles|fonts|images)\/.+)$/)
            : null;
        if (assetMatch) {
          const colSlug = decodeURIComponent(assetMatch[1]);
          const bookSlug = decodeURIComponent(assetMatch[2]);
          const relAsset = decodeURIComponent(assetMatch[3]);
          if (
            !colSlug.includes('..') &&
            !bookSlug.includes('..') &&
            !relAsset.includes('..') &&
            !relAsset.includes('\\')
          ) {
            const devBookDir = path.resolve(projectRoot, '.tmp/dev-abp-packs', `${colSlug}-${bookSlug}`);
            const artBookDir = path.resolve(projectRoot, 'artifacts/abp-packs', `${colSlug}-${bookSlug}`);
            for (const baseDir of [devBookDir, artBookDir]) {
              const candidate = path.resolve(baseDir, relAsset);
              if (isSafeSubPath(baseDir, candidate) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
                return sendStaticAssetFile(res, candidate);
              }
            }
          }
        }

        if (!rawUrl.startsWith(LIBRARY_PATH_PREFIX)) {
          return next();
        }

        if (req.method === 'OPTIONS') {
          res.writeHead(204, {
            'Cache-Control': 'no-store',
          });
          return res.end();
        }

        try {
          const store = getStore();

          if (req.method === 'GET' && pathname === `${LIBRARY_PATH_PREFIX}/entities`) {
            const entities = [];
            const seenBookIds = new Set();

            const pushBookManifest = (b, fallbackTs) => {
              const colSlug = b.colSlug || 'general';
              const bookSlug = b.slug;
              if (!bookSlug) return;
              const entityId = `book:${colSlug}-${bookSlug}`;
              if (seenBookIds.has(entityId)) return;
              seenBookIds.add(entityId);
              const userMeta = store.customMeta[entityId] || {};
              const sourceFormat = b.sourceFormat || 'abp';
              entities.push({
                id: entityId,
                kind: 'book',
                title: b.title,
                subtitle: b.subtitle || b.description || '',
                author: b.author || '',
                publisher: b.publisher || '',
                cover: b.cover || '/favicon.png',
                category: colSlug,
                shelfId: userMeta.shelfId,
                createdAt: (b.updatedAt ? Date.parse(b.updatedAt) : 0) || fallbackTs,
                lastReadAt: userMeta.lastReadAt,
                readProgress: userMeta.readProgress || 0,
                status: 'ready',
                metadata: {
                  colSlug,
                  bookSlug,
                  entryPoint: b.entryPoint || 'chapter-01',
                  abpPackPath: `/abp-packs/${colSlug}-${bookSlug}`,
                  edition: b.edition,
                  isbn: b.isbn,
                  sourceFormat,
                  readingProfile: b.readingProfile || (sourceFormat === 'epub' ? 'literary' : 'academic'),
                },
              });
            };

            const devPacksDir = path.resolve(projectRoot, '.tmp/dev-abp-packs');
            if (fs.existsSync(devPacksDir)) {
              try {
                for (const entry of fs.readdirSync(devPacksDir, { withFileTypes: true })) {
                  if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
                  const mf = path.join(devPacksDir, entry.name, 'manifest.json');
                  if (fs.existsSync(mf)) {
                    try {
                      const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
                      pushBookManifest(m, Date.now());
                    } catch {}
                  }
                }
              } catch {}
            }

            const candidateCatalogs = [
              path.resolve(projectRoot, 'artifacts/abp-packs/catalog.json'),
              path.resolve(projectRoot, '.tmp/dev-abp-packs/catalog.json'),
            ];
            const catalogPath = candidateCatalogs.find((p) => fs.existsSync(p));
            if (catalogPath) {
              try {
                const cat = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
                for (const b of cat.books || []) {
                  pushBookManifest(b, Date.now() - 86400000 * 15);
                }
              } catch {}
            }

            try {
              const taskMgr = TaskManager.getInstance();
              const tasks = taskMgr.listTasks();
              for (const t of tasks) {
                const taskId = t.taskId || t.id;
                const entityId = `paper:${taskId}`;
                const userMeta = store.customMeta[entityId] || {};

                const mappedStatus = mapIngestTaskToEntityStatus(t, taskMgr.isJobActive(taskId));

                entities.push({
                  id: entityId,
                  kind: 'paper',
                  title: t.fileName.replace(/\.pdf$/i, ''),
                  subtitle: `PDF 学术文献 · ${t.engine === 'api' ? '云端 MinerU' : t.engine === 'agent' ? 'Agent 通道' : '本地引擎'}`,
                  author: 'MinerU 学术解析',
                  publisher: '学术文献库',
                  cover: '/astrolib-logo.webp',
                  category: 'paper',
                  shelfId: userMeta.shelfId,
                  createdAt: t.createdAt || Date.now(),
                  lastReadAt: userMeta.lastReadAt,
                  readProgress: userMeta.readProgress || 0,
                  status: mappedStatus.status,
                  statusMessage: mappedStatus.statusMessage,
                  metadata: {
                    taskId: taskId,
                    originPdfUrl: `/api/ingest/pdf?taskId=${taskId}`,
                    markdownUrl: `/api/ingest/result?taskId=${taskId}`,
                    hasBookmarks: true,
                    hasAnnotations: true,
                    fileSizeBytes: t.fileSize,
                    totalPages: t.pageCount,
                    pageRanges: t.pageRanges,
                  },
                });
              }
            } catch {}

            entities.sort((a, b) => {
              const aT = a.lastReadAt || a.createdAt;
              const bT = b.lastReadAt || b.createdAt;
              return bT - aT;
            });

            return sendJson(res, 200, { success: true, entities });
          }

          if (req.method === 'GET' && pathname === `${LIBRARY_PATH_PREFIX}/shelves`) {
            return sendJson(res, 200, { success: true, shelves: store.shelves });
          }

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

          if (req.method === 'POST' && pathname === `${LIBRARY_PATH_PREFIX}/entity-meta`) {
            const body = await readJsonBody(req);
            const { entityId, updates } = body;
            if (!entityId) return sendJson(res, 400, { error: '缺少 entityId' });
            if (!store.customMeta[entityId]) store.customMeta[entityId] = {};
            Object.assign(store.customMeta[entityId], updates || {});
            saveStore(store);
            return sendJson(res, 200, { success: true });
          }

          if (
            req.method === 'POST' &&
            (pathname === `${LIBRARY_PATH_PREFIX}/upload-abp` || pathname === `${LIBRARY_PATH_PREFIX}/upload-book`)
          ) {
            const fileBuf = await readBufferBody(req);
            if (!fileBuf || fileBuf.length === 0) {
              return sendJson(res, 400, { error: '上传内容为空', code: 'INVALID_PAYLOAD' });
            }
            const rawHeaderName = req.headers?.['x-file-name'];
            let fileName = pathname.endsWith('/upload-abp') ? 'book.abp' : 'book.epub';
            if (typeof rawHeaderName === 'string' && rawHeaderName.trim()) {
              try {
                fileName = decodeURIComponent(rawHeaderName.trim());
              } catch {
                fileName = rawHeaderName.trim();
              }
            }
            try {
              let normalized;
              try {
                normalized = await bookFormatRegistry.normalizeFile(
                  fileName,
                  new Uint8Array(fileBuf.buffer, fileBuf.byteOffset, fileBuf.byteLength)
                );
              } catch (err) {
                const code = err instanceof AbpInstallError ? err.code : 'NORMALIZE_FAILED';
                return sendJson(res, 400, { error: err.message, code });
              }

              let bundle;
              try {
                bundle = validateInstallPayload(normalized.bundle);
              } catch (err) {
                const code = err instanceof AbpInstallError ? err.code : 'VALIDATION_FAILED';
                return sendJson(res, 400, { error: err.message, code });
              }

              const manifest = bundle.manifest;
              const bookKey = `${manifest.colSlug}-${manifest.slug}`;
              const baseDir = path.resolve(projectRoot, '.tmp/dev-abp-packs');
              const targetDir = path.join(baseDir, bookKey);
              const ts = Date.now();
              const stagingDir = path.join(baseDir, `${bookKey}.__staging_${ts}_${process.pid}`);
              const backupDir = path.join(baseDir, `${bookKey}.__backup_${ts}_${process.pid}`);

              fs.mkdirSync(baseDir, { recursive: true });
              const stagingChaptersDir = path.join(stagingDir, 'chapters');
              fs.mkdirSync(stagingChaptersDir, { recursive: true });

              let backedUp = false;
              let swapped = false;

              try {

                fs.writeFileSync(path.join(stagingDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

                if (bundle.chapters && typeof bundle.chapters === 'object') {
                  for (const [cSlug, cData] of Object.entries(bundle.chapters)) {
                    const destChap = path.join(stagingChaptersDir, `${cSlug}.json`);
                    fs.mkdirSync(path.dirname(destChap), { recursive: true });
                    fs.writeFileSync(destChap, JSON.stringify(cData, null, 2), 'utf8');
                  }
                }

                if (bundle.assets && typeof bundle.assets === 'object') {
                  for (const [relPath, b64] of Object.entries(bundle.assets)) {
                    const destAsset = path.join(stagingDir, relPath);
                    fs.mkdirSync(path.dirname(destAsset), { recursive: true });
                    fs.writeFileSync(destAsset, Buffer.from(b64, 'base64'));
                  }
                }

                if (bundle.aiIndex) {
                  fs.writeFileSync(path.join(stagingDir, 'ai-index.json'), JSON.stringify(bundle.aiIndex, null, 2), 'utf8');
                }
                if (normalized.sourceArchive && normalized.sourceArchive.bytes?.byteLength > 0) {
                  const archiveDir = path.join(stagingDir, 'source');
                  fs.mkdirSync(archiveDir, { recursive: true });
                  fs.writeFileSync(
                    path.join(archiveDir, path.basename(normalized.sourceArchive.fileName || 'original.epub')),
                    Buffer.from(
                      normalized.sourceArchive.bytes.buffer,
                      normalized.sourceArchive.bytes.byteOffset,
                      normalized.sourceArchive.bytes.byteLength
                    )
                  );
                }

                if (bundle.exercises && typeof bundle.exercises === 'object') {
                  const stagingExercisesDir = path.join(stagingDir, 'exercises');
                  fs.mkdirSync(stagingExercisesDir, { recursive: true });
                  for (const [relPath, rawJson] of Object.entries(bundle.exercises)) {
                    if (typeof rawJson !== 'string') continue;
                    const destPath = path.join(stagingExercisesDir, relPath);
                    fs.mkdirSync(path.dirname(destPath), { recursive: true });
                    fs.writeFileSync(destPath, rawJson, 'utf8');
                  }
                }

                if (fs.existsSync(targetDir)) {
                  fs.renameSync(targetDir, backupDir);
                  backedUp = true;
                }
                fs.renameSync(stagingDir, targetDir);
                swapped = true;

                if (backedUp && fs.existsSync(backupDir)) {
                  fs.rmSync(backupDir, { recursive: true, force: true });
                }

                return sendJson(res, 200, { success: true, manifest });
              } catch (writeErr) {

                if (swapped) {
                  try {
                    if (fs.existsSync(targetDir)) {
                      fs.rmSync(targetDir, { recursive: true, force: true });
                    }
                    if (backedUp && fs.existsSync(backupDir)) {
                      fs.renameSync(backupDir, targetDir);
                    }
                  } catch {}
                } else if (backedUp && fs.existsSync(backupDir) && !fs.existsSync(targetDir)) {
                  try {
                    fs.renameSync(backupDir, targetDir);
                  } catch {}
                }
                if (fs.existsSync(stagingDir)) {
                  try {
                    fs.rmSync(stagingDir, { recursive: true, force: true });
                  } catch {}
                }
                throw writeErr;
              }
            } catch (err) {
              return sendJson(res, 500, { error: `安装书籍失败: ${err.message}`, code: 'INSTALL_FAILED' });
            }
          }

          if (req.method === 'DELETE' && pathname.startsWith(`${LIBRARY_PATH_PREFIX}/books/`)) {
            const bookKey = pathname.slice(`${LIBRARY_PATH_PREFIX}/books/`.length);
            if (!bookKey || bookKey.includes('..') || bookKey.includes('/') || bookKey.includes('\\')) {
              return sendJson(res, 400, { error: '非法的书籍标识', code: 'INVALID_BOOK_KEY' });
            }
            const targetDir = path.resolve(projectRoot, '.tmp/dev-abp-packs', bookKey);
            if (fs.existsSync(targetDir)) {
              fs.rmSync(targetDir, { recursive: true, force: true });
            }
            const entityId = `book:${bookKey}`;
            if (store.customMeta[entityId]) {
              delete store.customMeta[entityId];
              saveStore(store);
            }
            return sendJson(res, 200, { success: true });
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
