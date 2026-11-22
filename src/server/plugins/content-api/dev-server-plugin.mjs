/**
 * src/server/plugins/content-api/dev-server-plugin.mjs
 * ============================================================================
 * AstroLib 统一内部内容数据 REST 服务插件 (/api/v1/content/*)
 * ============================================================================
 * 职责：
 * 1. 拦截并处理 /api/v1/content/* 请求，暴露标准 RESTful JSON 端点；
 * 2. 桥接 ContentApiService，为外部脚本、CLI、MCP 与前端提供低延迟 HTTP 访问；
 * 3. 严格践行统一响应格式 ApiResponse<T> 与跨域保护。
 * ============================================================================
 */

import { ContentApiService } from '../../../core/content-api/content-api-service.ts';
import { AntigravityCliService } from '../../../services/antigravity-cli/antigravity-cli-service.ts';
import { handleAgentToolsRoute } from './agent-tools-handler.ts';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import { URL, fileURLToPath } from 'node:url';
import * as diff from 'diff';
import katex from 'katex';
import { marked } from 'marked';
import { sanitizeAcademicHtml } from '../../../core/security/html-sanitizer.ts';
import { createSanitizedChildEnv } from '../../../core/security/child-env.ts';

const pluginModuleDir = path.dirname(fileURLToPath(import.meta.url));

const execFileAsync = promisify(execFile);
const CONTENT_API_PREFIX = '/api/v1/content';

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
  const raw = Buffer.concat(chunks).toString('utf-8');
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function streamAntigravityCli(req, res, body) {
  const cliService = AntigravityCliService.getInstance();
  const prompt =
    body.prompt ||
    (body.messages && body.messages.length > 0
      ? body.messages[body.messages.length - 1].content
      : '');
  const model = body.model || 'gemini-3.8-flash-high';
  const reasoningEffort = body.reasoningEffort || 'high';
  const agyConversationId = body.agyConversationId || body.conversationId;
  const systemPrompt = body.systemPrompt;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
  });

  const abortController = new AbortController();
  req.on('close', () => abortController.abort());

  try {
    const stream = cliService.streamTask({
      prompt: typeof prompt === 'string' ? prompt : JSON.stringify(prompt),
      model,
      reasoningEffort,
      agyConversationId,
      signal: abortController.signal,
      systemPrompt,
    });

    for await (const evt of stream) {
      if (res.writableEnded) break;

      if (evt.type === 'init') {
        res.write(`data: ${JSON.stringify({ type: 'init', conversationId: evt.conversationId, model: evt.model })}\n\n`);
      } else if (evt.type === 'text_delta') {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: evt.delta } }] })}\n\n`);
      } else if (evt.type === 'reasoning_delta') {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { reasoning: evt.delta } }] })}\n\n`);
      } else if (evt.type === 'tool_start') {
        res.write(
          `data: ${JSON.stringify({
            type: 'tool_start',
            tool_name: evt.toolName,
            tool_call_id: evt.toolCallId,
            parameters: evt.parameters,
          })}\n\n`
        );
      } else if (evt.type === 'tool_done') {
        res.write(
          `data: ${JSON.stringify({
            type: 'tool_done',
            tool_name: evt.toolName,
            tool_call_id: evt.toolCallId,
            output: evt.output,
            duration: evt.durationSeconds,
          })}\n\n`
        );
      } else if (evt.type === 'finish') {
        res.write(
          `data: ${JSON.stringify({
            type: 'finish',
            conversationId: evt.conversationId,
            usage: evt.usage,
          })}\n\n`
        );
        res.write('data: [DONE]\n\n');
      } else if (evt.type === 'error') {
        res.write(`data: ${JSON.stringify({ error: evt.error })}\n\n`);
        res.write('data: [DONE]\n\n');
      }
    }
  } catch (streamErr) {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ error: streamErr.message })}\n\n`);
      res.write('data: [DONE]\n\n');
    }
  } finally {
    if (!res.writableEnded) {
      res.end();
    }
  }
}

export function contentApiDevServerPlugin() {
  const service = ContentApiService.getInstance();

  return {
    name: 'astrolib-content-api-server',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const rawUrl = req.url || '';
        if (!rawUrl.startsWith(CONTENT_API_PREFIX)) {
          return next();
        }

        if (req.method === 'OPTIONS') {
          res.writeHead(204, {
            'Cache-Control': 'no-store',
          });
          return res.end();
        }

        const parsedUrl = new URL(rawUrl, 'http://127.0.0.1');
        const pathname = parsedUrl.pathname;
        const subPath = pathname.slice(CONTENT_API_PREFIX.length);

        try {
          // 0. Agent 扩展工具后端端点 (/agent-tools/*)
          if (subPath.startsWith('/agent-tools/')) {
            const handled = await handleAgentToolsRoute(req, res, subPath, parsedUrl);
            if (handled) return;
          }

          // 1. GET /books - 列出所有图书
          if (req.method === 'GET' && (subPath === '/books' || subPath === '/books/')) {
            const books = service.listBooks();
            return sendJson(res, 200, {
              success: true,
              data: books,
              timestamp: Date.now(),
            });
          }

          // 1.1 GET /knowledge/items - 统一知识库文档列表 (MDX + pdf2abp + EPUB + 学术文献)
          if (req.method === 'GET' && subPath === '/knowledge/items') {
            const kind = parsedUrl.searchParams.get('kind') || 'all';
            const format = parsedUrl.searchParams.get('format') || 'all';
            const colSlug = parsedUrl.searchParams.get('col') || undefined;
            const query = parsedUrl.searchParams.get('q') || undefined;
            if (parsedUrl.searchParams.get('refresh') === 'true') {
              service.invalidateKnowledgeCache();
            }
            const items = service.listKnowledgeItems({
              kind: kind === 'book' || kind === 'paper' ? kind : 'all',
              format:
                format === 'mdx' || format === 'abp' || format === 'epub' || format === 'paper'
                  ? format
                  : 'all',
              colSlug,
              query,
            });
            return sendJson(res, 200, {
              success: true,
              count: items.length,
              data: items,
              timestamp: Date.now(),
            });
          }

          // 1.2 GET /knowledge/outline?uri=... - 统一知识库结构化大纲树
          if (req.method === 'GET' && subPath === '/knowledge/outline') {
            const uri = parsedUrl.searchParams.get('uri') || parsedUrl.searchParams.get('id') || '';
            if (!uri.trim()) {
              return sendJson(res, 400, { success: false, error: '缺少 uri 或 id 参数' });
            }
            const outlineRes = service.getKnowledgeOutline(uri);
            if (!outlineRes) {
              return sendJson(res, 404, { success: false, error: `未找到知识库文档: ${uri}` });
            }
            return sendJson(res, 200, {
              success: true,
              data: outlineRes,
              timestamp: Date.now(),
            });
          }

          // 1.3 GET /knowledge/section?uri=...&sectionId=...&offset=0&limit=80 - 统一知识库分节读取
          if (req.method === 'GET' && subPath === '/knowledge/section') {
            const uri = parsedUrl.searchParams.get('uri') || parsedUrl.searchParams.get('id') || '';
            const sectionId = parsedUrl.searchParams.get('sectionId') || undefined;
            const offset = parseInt(parsedUrl.searchParams.get('offset') || '0', 10) || 0;
            const limit = parseInt(parsedUrl.searchParams.get('limit') || '80', 10) || 80;
            const includeMarkdown = parsedUrl.searchParams.get('markdown') === 'true';
            if (!uri.trim()) {
              return sendJson(res, 400, { success: false, error: '缺少 uri 或 id 参数' });
            }
            const secRes = service.readKnowledgeSection(uri, sectionId, {
              offset,
              limit,
              includeMarkdown,
            });
            if (!secRes) {
              return sendJson(res, 404, {
                success: false,
                error: `未找到文档或章节: ${uri}${sectionId ? ` / ${sectionId}` : ''}`,
              });
            }
            return sendJson(res, 200, {
              success: true,
              data: secRes,
              timestamp: Date.now(),
            });
          }

          // 1.4 POST /knowledge/search - 统一知识库四源联合检索
          if (req.method === 'POST' && subPath === '/knowledge/search') {
            const body = await readJsonBody(req);
            const query = String(body.query || '').trim();
            if (!query) {
              return sendJson(res, 400, { success: false, error: '检索词 query 不能为空' });
            }
            const hits = service.searchKnowledge(query, {
              kind: body.kind || 'all',
              format: body.format || 'all',
              colSlug: body.colSlug || undefined,
              docSlug: body.docSlug || undefined,
              regex: Boolean(body.regex),
              limit: Number(body.limit) || 20,
            });
            return sendJson(res, 200, {
              success: true,
              count: hits.length,
              data: { query, count: hits.length, hits },
              timestamp: Date.now(),
            });
          }

          // 1.45 POST /knowledge/refresh - 刷新知识库索引缓存
          if (req.method === 'POST' && subPath === '/knowledge/refresh') {
            service.invalidateKnowledgeCache();
            return sendJson(res, 200, { success: true, timestamp: Date.now() });
          }

          // 1.5 GET /locate?q=... - 统一内容定位协议求解 (Content Locator Protocol)
          if (req.method === 'GET' && subPath === '/locate') {
            const q = parsedUrl.searchParams.get('q') || '';
            const locator = service.locateContent(q);
            return sendJson(res, 200, {
              success: true,
              data: locator,
              timestamp: Date.now(),
            });
          }

          // ====================================================================
          // 1.8 批注元数据、数位板笔迹与自由画布 (/api/v1/content/annotations/*)
          // ====================================================================

          // 1.8a GET /annotations/search?q=...&col=...&book=...&limit=...
          if (req.method === 'GET' && subPath === '/annotations/search') {
            const q = parsedUrl.searchParams.get('q') || '';
            const colSlug = parsedUrl.searchParams.get('col') || undefined;
            const bookSlug = parsedUrl.searchParams.get('book') || undefined;
            const limit = parseInt(parsedUrl.searchParams.get('limit') || '30', 10);
            const hits = service.searchAnnotations(q, { colSlug, bookSlug, limit });
            return sendJson(res, 200, {
              success: true,
              count: hits.length,
              data: hits,
              timestamp: Date.now(),
            });
          }

          // 1.8a-2 POST /annotations/render-markdown - 离线本地 Markdown + KaTeX 渲染接口 (供侧注与自由画布使用)
          if (req.method === 'POST' && subPath === '/annotations/render-markdown') {
            const body = await readJsonBody(req);
            const rawMd = typeof body.markdown === 'string' ? body.markdown : '';
            const mathTokens = [];
            let safe = rawMd
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;');
            safe = safe.replace(/\$\$([\s\S]*?)\$\$/g, (_m, tex) => {
              const id = mathTokens.length;
              try {
                mathTokens.push(
                  `<div class="katex-display-container">${katex.renderToString(tex.trim(), { displayMode: true, output: 'html', strict: false, throwOnError: false })}</div>`
                );
              } catch {
                mathTokens.push(`<pre>${tex}</pre>`);
              }
              return `%%%ANP_MATH_${id}%%%`;
            });
            safe = safe.replace(/(?<!\\)\$([^\$\n\r]+?)\$/g, (_m, tex) => {
              const id = mathTokens.length;
              try {
                mathTokens.push(
                  `<span class="katex-inline-container">${katex.renderToString(tex.trim(), { displayMode: false, output: 'html', strict: false, throwOnError: false })}</span>`
                );
              } catch {
                mathTokens.push(`<code>${tex}</code>`);
              }
              return `%%%ANP_MATH_${id}%%%`;
            });
            let html = String(marked.parse(safe, { breaks: true, gfm: true }));
            html = html.replace(/%%%ANP_MATH_(\d+)%%%/g, (_m, idxStr) => mathTokens[Number(idxStr)] || '');
            html = sanitizeAcademicHtml(html);
            return sendJson(res, 200, {
              success: true,
              html,
              timestamp: Date.now(),
            });
          }

          // 1.8a-3 GET /annotations/katex.css & fonts - 分发本地 KaTeX CSS 与字体 (供独立画布工作台离线渲染)
          if (req.method === 'GET' && subPath === '/annotations/katex.css') {
            const katexCssCandidates = [
              path.resolve(pluginModuleDir, 'katex/katex.min.css'),
              path.resolve(process.cwd(), 'dist-electron/katex/katex.min.css'),
              path.resolve(process.cwd(), 'node_modules/katex/dist/katex.min.css'),
            ];
            for (const cand of katexCssCandidates) {
              if (fs.existsSync(cand)) {
                const rawCss = fs.readFileSync(cand, 'utf-8');
                const rewrittenCss = rawCss.replace(/url\(fonts\//g, 'url(/api/v1/content/annotations/katex-fonts/');
                res.writeHead(200, {
                  'Content-Type': 'text/css; charset=utf-8',
                  'Cache-Control': 'public, max-age=86400',
                });
                return res.end(rewrittenCss);
              }
            }
            res.writeHead(404);
            return res.end('');
          }

          const katexFontMatch = subPath.match(/^\/annotations\/katex-fonts\/([a-zA-Z0-9_.-]+\.(?:woff2?|ttf))$/);
          if (req.method === 'GET' && katexFontMatch) {
            const fontCandidates = [
              path.resolve(pluginModuleDir, 'katex/fonts', katexFontMatch[1]),
              path.resolve(process.cwd(), 'dist-electron/katex/fonts', katexFontMatch[1]),
              path.resolve(process.cwd(), 'node_modules/katex/dist/fonts', katexFontMatch[1]),
            ];
            for (const fontFile of fontCandidates) {
              if (fs.existsSync(fontFile)) {
                const ext = path.extname(fontFile).toLowerCase();
                const mime = ext === '.woff2' ? 'font/woff2' : ext === '.woff' ? 'font/woff' : 'font/ttf';
                res.writeHead(200, {
                  'Content-Type': mime,
                  'Cache-Control': 'public, max-age=31536000, immutable',
                });
                return res.end(fs.readFileSync(fontFile));
              }
            }
            res.writeHead(404);
            return res.end('');
          }

          // 1.8a-4 GET KaTeX 运行时 JS 与扩展 (katex.min.js / auto-render / mhchem)
          const katexJsMap = {
            '/annotations/katex.min.js': [
              path.resolve(pluginModuleDir, 'katex/katex.min.js'),
              path.resolve(process.cwd(), 'dist-electron/katex/katex.min.js'),
              path.resolve(process.cwd(), 'node_modules/katex/dist/katex.min.js'),
            ],
            '/annotations/katex-auto-render.min.js': [
              path.resolve(pluginModuleDir, 'katex/katex-auto-render.min.js'),
              path.resolve(process.cwd(), 'dist-electron/katex/katex-auto-render.min.js'),
              path.resolve(process.cwd(), 'node_modules/katex/dist/contrib/auto-render.min.js'),
            ],
            '/annotations/katex-mhchem.min.js': [
              path.resolve(pluginModuleDir, 'katex/katex-mhchem.min.js'),
              path.resolve(process.cwd(), 'dist-electron/katex/katex-mhchem.min.js'),
              path.resolve(process.cwd(), 'node_modules/katex/dist/contrib/mhchem.min.js'),
            ],
          };
          if (req.method === 'GET' && katexJsMap[subPath]) {
            for (const cand of katexJsMap[subPath]) {
              if (fs.existsSync(cand)) {
                res.writeHead(200, {
                  'Content-Type': 'application/javascript; charset=utf-8',
                  'Cache-Control': 'public, max-age=86400',
                });
                return res.end(fs.readFileSync(cand));
              }
            }
            res.writeHead(404);
            return res.end('');
          }

          // 1.8b GET /annotations/books/:col/:book/export?chapter=...
          const annExportMatch = subPath.match(/^\/annotations\/books\/([^/]+)\/([^/]+)\/export$/);
          if (req.method === 'GET' && annExportMatch) {
            const col = decodeURIComponent(annExportMatch[1]);
            const book = decodeURIComponent(annExportMatch[2]);
            const chapter = parsedUrl.searchParams.get('chapter') || undefined;
            const anp = service.exportBookAnp(col, book, chapter);
            return sendJson(res, 200, {
              success: true,
              data: anp,
              timestamp: Date.now(),
            });
          }

          // 1.8c POST /annotations/books/:col/:book/import
          const annImportMatch = subPath.match(/^\/annotations\/books\/([^/]+)\/([^/]+)\/import$/);
          if (req.method === 'POST' && annImportMatch) {
            const body = await readJsonBody(req);
            const rawPkg = body.package || body.anp || body;
            const mode = body.mode === 'overwrite' ? 'overwrite' : 'merge';
            try {
              const result = service.importBookAnp(rawPkg, mode);
              return sendJson(res, 200, {
                success: true,
                data: result,
                timestamp: Date.now(),
              });
            } catch (importErr) {
              return sendJson(res, 400, {
                success: false,
                error: importErr?.message || String(importErr),
                timestamp: Date.now(),
              });
            }
          }

          // 1.8d GET/POST /annotations/books/:col/:book/chapters/:slug (支持多级章节 slug)
          const annChapterMatch = subPath.match(/^\/annotations\/books\/([^/]+)\/([^/]+)\/chapters\/(.+)$/);
          if (annChapterMatch) {
            const col = decodeURIComponent(annChapterMatch[1]);
            const book = decodeURIComponent(annChapterMatch[2]);
            const slug = decodeURIComponent(annChapterMatch[3]);

            if (req.method === 'GET') {
              const withAst = parsedUrl.searchParams.get('withAst') !== 'false';
              const data = withAst
                ? service.getChapterAnnotationsWithAst(col, book, slug)
                : service.getChapterAnnotationsRaw(col, book, slug);
              return sendJson(res, 200, {
                success: true,
                data,
                timestamp: Date.now(),
              });
            }

            if (req.method === 'POST') {
              const body = await readJsonBody(req);
              const action = body.action || 'save-all';
              let saved;
              if (action === 'upsert-item' && body.item) {
                saved = service.upsertChapterAnnotation(col, book, slug, body.item, body.chapterTitle);
              } else if (action === 'delete-item' && body.annotationId) {
                saved = service.deleteChapterAnnotation(col, book, slug, body.annotationId);
              } else if (action === 'save-canvas' && body.canvasNote) {
                saved = await service.saveChapterCanvasNoteAsync(col, book, slug, body.canvasNote, body.chapterTitle);
              } else {
                saved = service.saveChapterAnnotationsPayload(col, book, slug, body);
              }
              return sendJson(res, 200, {
                success: true,
                data: saved,
                timestamp: Date.now(),
              });
            }
          }

          // 1.8e GET /annotations/books/:col/:book - 获取整书批注全景概览
          const annBookMatch = subPath.match(/^\/annotations\/books\/([^/]+)\/([^/]+)$/);
          if (req.method === 'GET' && annBookMatch) {
            const col = decodeURIComponent(annBookMatch[1]);
            const book = decodeURIComponent(annBookMatch[2]);
            const overview = service.getBookAnnotationsOverview(col, book);
            return sendJson(res, 200, {
              success: true,
              data: overview,
              timestamp: Date.now(),
            });
          }

          // 2. GET /exercises/search?q=... - 全局检索习题
          if (req.method === 'GET' && subPath === '/exercises/search') {
            const q = parsedUrl.searchParams.get('q') || '';
            const limit = parseInt(parsedUrl.searchParams.get('limit') || '20', 10);
            const exercises = service.searchExercises(q, limit);
            return sendJson(res, 200, {
              success: true,
              data: exercises,
              timestamp: Date.now(),
            });
          }

          // 3. GET /mineru - 列出所有 MinerU 任务
          if (req.method === 'GET' && (subPath === '/mineru' || subPath === '/mineru/')) {
            const tasks = service.listMineruTasks();
            return sendJson(res, 200, {
              success: true,
              data: tasks,
              timestamp: Date.now(),
            });
          }

          // 4. GET /mineru/:hash/layout - 获取 MinerU 布局切片
          const mineruLayoutMatch = subPath.match(/^\/mineru\/([^/]+)\/layout$/);
          if (req.method === 'GET' && mineruLayoutMatch) {
            const hash = decodeURIComponent(mineruLayoutMatch[1]);
            const limit = parseInt(parsedUrl.searchParams.get('limit') || '50', 10);
            const result = service.getMineruLayout(hash, limit);
            return sendJson(res, result.success ? 200 : 404, {
              ...result,
              timestamp: Date.now(),
            });
          }

          // 5. GET /mineru/:hash - 获取单个 MinerU 详情
          const mineruSingleMatch = subPath.match(/^\/mineru\/([^/]+)$/);
          if (req.method === 'GET' && mineruSingleMatch) {
            const hash = decodeURIComponent(mineruSingleMatch[1]);
            const task = service.getMineruTask(hash);
            if (!task) {
              return sendJson(res, 404, {
                success: false,
                error: `未找到 MinerU 任务: ${hash}`,
                timestamp: Date.now(),
              });
            }
            return sendJson(res, 200, {
              success: true,
              data: task,
              timestamp: Date.now(),
            });
          }

          // 6. GET /books/:col/:book/toc - 获取图书目录
          const tocMatch = subPath.match(/^\/books\/([^/]+)\/([^/]+)\/toc$/);
          if (req.method === 'GET' && tocMatch) {
            const col = decodeURIComponent(tocMatch[1]);
            const book = decodeURIComponent(tocMatch[2]);
            const toc = service.getBookToc(col, book);
            return sendJson(res, 200, {
              success: true,
              data: toc,
              timestamp: Date.now(),
            });
          }

          // 7. GET /books/:col/:book/chapters/:slug/ast - 获取章节 AST (支持多级章节 slug)
          const astMatch = subPath.match(/^\/books\/([^/]+)\/([^/]+)\/chapters\/(.+)\/ast$/);
          if (req.method === 'GET' && astMatch) {
            const col = decodeURIComponent(astMatch[1]);
            const book = decodeURIComponent(astMatch[2]);
            const slug = decodeURIComponent(astMatch[3]);
            const includeRaw = parsedUrl.searchParams.get('raw') === 'true';
            const ast = service.getChapterAst(col, book, slug, { includeRawMdx: includeRaw });
            return sendJson(res, 200, {
              success: true,
              data: ast,
              timestamp: Date.now(),
            });
          }

          // 7.0a GET /books/:col/:book/chapters/:slug/nodes/:nodeId/html - 获取节点原版预编译 HTML
          const nodeHtmlMatch = subPath.match(/^\/books\/([^/]+)\/([^/]+)\/chapters\/(.+)\/nodes\/([^/]+)\/html$/);
          if (req.method === 'GET' && nodeHtmlMatch) {
            const col = decodeURIComponent(nodeHtmlMatch[1]);
            const book = decodeURIComponent(nodeHtmlMatch[2]);
            const slug = decodeURIComponent(nodeHtmlMatch[3]);
            const nodeId = decodeURIComponent(nodeHtmlMatch[4]);
            const htmlRes = service.getChapterNodeHtml(col, book, slug, nodeId);
            return sendJson(res, 200, {
              success: true,
              data: htmlRes,
              timestamp: Date.now(),
            });
          }

          // 7.0 GET /books/:col/:book/chapters/:slug/nodes/:nodeId - 读取指定 AST 节点原文
          const nodeMatch = subPath.match(/^\/books\/([^/]+)\/([^/]+)\/chapters\/(.+)\/nodes\/([^/]+)$/);
          if (req.method === 'GET' && nodeMatch) {
            const col = decodeURIComponent(nodeMatch[1]);
            const book = decodeURIComponent(nodeMatch[2]);
            const slug = decodeURIComponent(nodeMatch[3]);
            const nodeId = decodeURIComponent(nodeMatch[4]);
            const includeChildren = parsedUrl.searchParams.get('includeChildren') === 'true';
            try {
              const nodeData = service.readChapterNode(col, book, slug, nodeId, { includeChildren });
              return sendJson(res, 200, {
                success: true,
                data: nodeData,
                timestamp: Date.now(),
              });
            } catch (err) {
              return sendJson(res, 404, {
                success: false,
                error: err.message,
                timestamp: Date.now(),
              });
            }
          }

          // 7.1 GET /books/:col/:book/chapters/:slug/cards - 获取章节学术卡片列表
          const cardsMatch = subPath.match(/^\/books\/([^/]+)\/([^/]+)\/chapters\/([^/]+)\/cards$/);
          if (req.method === 'GET' && cardsMatch) {
            const col = decodeURIComponent(cardsMatch[1]);
            const book = decodeURIComponent(cardsMatch[2]);
            const slug = decodeURIComponent(cardsMatch[3]);
            const ast = service.getChapterAst(col, book, slug);
            return sendJson(res, 200, {
              success: true,
              count: ast.cards.length,
              data: ast.cards,
              timestamp: Date.now(),
            });
          }

          // 7.2 GET /books/:col/:book/chapters/:slug/formulas - 获取章节公式列表
          const formulasMatch = subPath.match(/^\/books\/([^/]+)\/([^/]+)\/chapters\/([^/]+)\/formulas$/);
          if (req.method === 'GET' && formulasMatch) {
            const col = decodeURIComponent(formulasMatch[1]);
            const book = decodeURIComponent(formulasMatch[2]);
            const slug = decodeURIComponent(formulasMatch[3]);
            const ast = service.getChapterAst(col, book, slug);
            return sendJson(res, 200, {
              success: true,
              count: ast.formulas.length,
              data: ast.formulas,
              timestamp: Date.now(),
            });
          }

          // 8. GET /books/:col/:book/chapters/:slug/exercises - 获取章节习题
          const chExercisesMatch = subPath.match(/^\/books\/([^/]+)\/([^/]+)\/chapters\/([^/]+)\/exercises$/);
          if (req.method === 'GET' && chExercisesMatch) {
            const col = decodeURIComponent(chExercisesMatch[1]);
            const book = decodeURIComponent(chExercisesMatch[2]);
            const slug = decodeURIComponent(chExercisesMatch[3]);
            const exercises = service.getChapterExercises(col, book, slug);
            return sendJson(res, 200, {
              success: true,
              data: exercises,
              timestamp: Date.now(),
            });
          }

          // 9. POST /books/:col/:book/pack-abp - 触发打包 ABP
          const packMatch = subPath.match(/^\/books\/([^/]+)\/([^/]+)\/pack-abp$/);
          if (req.method === 'POST' && packMatch) {
            const col = decodeURIComponent(packMatch[1]);
            const book = decodeURIComponent(packMatch[2]);
            const packResult = await service.packBookAbp(col, book);
            return sendJson(res, 200, {
              ...packResult,
              timestamp: Date.now(),
            });
          }

          // 10. POST /books/import - 导入书籍
          if (req.method === 'POST' && (subPath === '/books/import' || subPath === '/books/import/')) {
            const body = await readJsonBody(req);
            const { colSlug, bookSlug, title, mineruDir } = body;
            if (!colSlug || !bookSlug || !title || !mineruDir) {
              return sendJson(res, 400, {
                success: false,
                error: '缺少必要参数: colSlug, bookSlug, title, mineruDir',
                timestamp: Date.now(),
              });
            }
            const importRes = await service.importBookFromMineru({ colSlug, bookSlug, title, mineruDir });
            return sendJson(res, 200, {
              ...importRes,
              timestamp: Date.now(),
            });
          }

          // 11. POST /books/:col/:book/chapters/:slug/save - 保存章节 MDX
          const saveMatch = subPath.match(/^\/books\/([^/]+)\/([^/]+)\/chapters\/([^/]+)\/save$/);
          if (req.method === 'POST' && saveMatch) {
            const col = decodeURIComponent(saveMatch[1]);
            const book = decodeURIComponent(saveMatch[2]);
            const slug = decodeURIComponent(saveMatch[3]);
            const body = await readJsonBody(req);
            if (typeof body.content !== 'string') {
              return sendJson(res, 400, {
                success: false,
                error: '缺少 content 字符串',
                timestamp: Date.now(),
              });
            }
            const saveRes = await service.saveChapterMdx(col, book, slug, body.content);
            return sendJson(res, 200, {
              ...saveRes,
              timestamp: Date.now(),
            });
          }

          // 12. POST /diff - 计算章节或文本 Unified Diff
          if (req.method === 'POST' && (subPath === '/diff' || subPath === '/diff/')) {
            const body = await readJsonBody(req);
            let text1 = body.text1 || '';
            let text2 = body.text2 || '';
            let label1 = body.label1 || 'Original';
            let label2 = body.label2 || 'Modified';

            if (body.colSlug1 && body.bookSlug1 && body.slug1) {
              const ast1 = service.getChapterAst(body.colSlug1, body.bookSlug1, body.slug1, { includeRawMdx: true });
              text1 = ast1.rawMdx || '';
              label1 = `${body.bookSlug1}/${body.slug1}.mdx`;
            }
            if (body.colSlug2 && body.bookSlug2 && body.slug2) {
              const ast2 = service.getChapterAst(body.colSlug2, body.bookSlug2, body.slug2, { includeRawMdx: true });
              text2 = ast2.rawMdx || '';
              label2 = `${body.bookSlug2}/${body.slug2}.mdx`;
            }

            const patch = diff.createTwoFilesPatch(label1, label2, text1, text2);
            const additions = (patch.match(/^\+[^+]/gm) || []).length;
            const deletions = (patch.match(/^-[^-]/gm) || []).length;

            return sendJson(res, 200, {
              success: true,
              patch,
              stats: { additions, deletions },
              timestamp: Date.now(),
            });
          }

          // 13. POST /cli - 交互终端直接调度运行 CLI
          if (req.method === 'POST' && (subPath === '/cli' || subPath === '/cli/')) {
            const body = await readJsonBody(req);
            const commandStr = (body.command || '').trim();
            if (!commandStr) {
              return sendJson(res, 400, { success: false, error: 'Command string cannot be empty' });
            }

            const cliScript = path.resolve(process.cwd(), 'bin/astrolib-cli.mjs');
            const args = commandStr.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
            const sanitizedArgs = args.map(a => a.replace(/^["']|["']$/g, ''));

            try {
              const { stdout, stderr } = await execFileAsync(process.execPath, [cliScript, ...sanitizedArgs], {
                timeout: 15000,
                maxBuffer: 10 * 1024 * 1024,
                env: createSanitizedChildEnv({ ELECTRON_RUN_AS_NODE: '1' }),
              });
              return sendJson(res, 200, {
                success: true,
                stdout: stdout || '',
                stderr: stderr || '',
                exitCode: 0,
                timestamp: Date.now(),
              });
            } catch (execErr) {
              return sendJson(res, 200, {
                success: false,
                stdout: execErr.stdout || '',
                stderr: execErr.stderr || execErr.message || '',
                exitCode: execErr.code || 1,
                timestamp: Date.now(),
              });
            }
          }

          // 13.5 GET /antigravity-cli/status - 静默探测本地 Antigravity CLI 状态
          if (req.method === 'GET' && (subPath === '/antigravity-cli/status' || subPath === '/antigravity-cli/status/')) {
            const cliService = AntigravityCliService.getInstance();
            const status = await cliService.detectCli();
            return sendJson(res, 200, {
              success: true,
              data: status,
              timestamp: Date.now(),
            });
          }

          // 13.6 POST /antigravity-cli/chat - 本地 Antigravity CLI 流式调度
          if (req.method === 'POST' && (subPath === '/antigravity-cli/chat' || subPath === '/antigravity-cli/chat/')) {
            const body = await readJsonBody(req);
            await streamAntigravityCli(req, res, body);
            return;
          }

          // 14. POST /chat - 本地与远程 AI 模型全双工流式对话代理 (/api/v1/content/chat)
          if (req.method === 'POST' && (subPath === '/chat' || subPath === '/chat/')) {
            const body = await readJsonBody(req);

            if (body.provider === 'antigravity-cli') {
              await streamAntigravityCli(req, res, body);
              return;
            }

            const {
              messages = [],
              provider = 'baigong',
              model = 'ybg-youlaber-ds4f',
              stream = true,
              temperature,
              max_tokens,
            } = body;

            // 提取端点与密钥配置 (优先使用请求体传参，未传时兜底学校免费网关 baigong)
            let baseURL = body.baseURL;
            let apiKey = body.apiKey;
            let customHeaders = body.headers || {};

            if (!baseURL || provider === 'baigong') {
              baseURL = baseURL || 'https://gateway.baigongai.cn/v1';
              apiKey = apiKey || process.env.BAIGONG_API_KEY || process.env.ASTROLIB_YOULABBER_API_KEY || '';
              customHeaders = {
                'X-YBG-Session-ID': 'youlabber-local-pc',
                ...customHeaders,
              };
            }
            if (!apiKey) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              res.end(JSON.stringify({ ok: false, error: 'Missing API key for LLM provider' }));
              return;
            }

            const targetUrl = new URL(baseURL.replace(/\/+$/, '') + '/chat/completions');
            const modelLower = String(model || '').toLowerCase();
            const isReasoningModel =
              provider === 'baigong' ||
              modelLower.includes('youlaber') ||
              modelLower.includes('reasoner') ||
              modelLower.includes('r1') ||
              modelLower.includes('thinking') ||
              modelLower.includes('qvq');
            const effectiveMaxTokens =
              typeof max_tokens === 'number' && Number.isFinite(max_tokens)
                ? isReasoningModel
                  ? Math.max(16384, max_tokens)
                  : max_tokens
                : isReasoningModel
                  ? 16384
                  : undefined;

            const payload = JSON.stringify({
              model: model || 'ybg-youlaber-ds4f',
              messages: messages.length > 0 ? messages : [{ role: 'user', content: 'Hello' }],
              stream: Boolean(stream),
              ...(temperature !== undefined ? { temperature } : {}),
              ...(effectiveMaxTokens !== undefined ? { max_tokens: effectiveMaxTokens } : {}),
              ...(body.tools && Array.isArray(body.tools) && body.tools.length > 0 ? { tools: body.tools } : {}),
              ...(body.tool_choice !== undefined ? { tool_choice: body.tool_choice } : {}),
            });

            const headers = {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payload),
              ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
              ...customHeaders,
            };

            const client = targetUrl.protocol === 'https:' ? https : http;
            const UPSTREAM_TIMEOUT_MS = 240_000;

            if (stream) {
              res.writeHead(200, {
                'Content-Type': 'text/event-stream; charset=utf-8',
                'Cache-Control': 'no-cache, no-transform',
                'Connection': 'keep-alive',
              });

              let closed = false;
              const keepaliveTimer = setInterval(() => {
                if (!closed && !res.writableEnded) {
                  try {
                    res.write(': keepalive\n\n');
                  } catch {
                    clearInterval(keepaliveTimer);
                  }
                }
              }, 20_000);

              const cleanupKeepalive = () => {
                closed = true;
                clearInterval(keepaliveTimer);
              };

              const upstreamReq = client.request(
                targetUrl,
                {
                  method: 'POST',
                  headers,
                  timeout: UPSTREAM_TIMEOUT_MS,
                },
                (upstreamRes) => {
                  if (upstreamRes.statusCode && upstreamRes.statusCode >= 400) {
                    let errData = '';
                    upstreamRes.on('data', (c) => (errData += c));
                    upstreamRes.on('end', () => {
                      cleanupKeepalive();
                      if (!res.writableEnded) {
                        res.write(`data: ${JSON.stringify({ error: errData || `Upstream returned ${upstreamRes.statusCode}` })}\n\n`);
                        res.write('data: [DONE]\n\n');
                        res.end();
                      }
                    });
                    upstreamRes.on('error', (err) => {
                      cleanupKeepalive();
                      if (!res.writableEnded) {
                        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
                        res.write('data: [DONE]\n\n');
                        res.end();
                      }
                    });
                    return;
                  }

                  upstreamRes.on('data', (chunk) => {
                    if (!res.writableEnded) {
                      res.write(chunk);
                    }
                  });

                  upstreamRes.on('end', () => {
                    cleanupKeepalive();
                    if (!res.writableEnded) {
                      res.end();
                    }
                  });

                  upstreamRes.on('error', (err) => {
                    cleanupKeepalive();
                    if (!res.writableEnded) {
                      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
                      res.write('data: [DONE]\n\n');
                      res.end();
                    }
                  });
                }
              );

              upstreamReq.on('timeout', () => {
                cleanupKeepalive();
                if (!upstreamReq.destroyed) {
                  upstreamReq.destroy(new Error(`Upstream SSE timeout after ${UPSTREAM_TIMEOUT_MS / 1000}s`));
                }
              });

              upstreamReq.on('error', (err) => {
                cleanupKeepalive();
                if (!res.writableEnded) {
                  res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
                  res.write('data: [DONE]\n\n');
                  res.end();
                }
              });

              req.on('close', () => {
                cleanupKeepalive();
                if (!upstreamReq.destroyed) {
                  upstreamReq.destroy();
                }
              });

              upstreamReq.write(payload);
              upstreamReq.end();
              return;
            } else {
              return new Promise((resolve) => {
                const upstreamReq = client.request(
                  targetUrl,
                  {
                    method: 'POST',
                    headers,
                    timeout: UPSTREAM_TIMEOUT_MS,
                  },
                  (upstreamRes) => {
                    let buf = '';
                    upstreamRes.on('data', (c) => (buf += c));
                    upstreamRes.on('end', () => {
                      try {
                        const json = JSON.parse(buf);
                        sendJson(res, upstreamRes.statusCode || 200, json);
                      } catch {
                        sendJson(res, upstreamRes.statusCode || 200, { raw: buf });
                      }
                      resolve();
                    });
                  }
                );

                upstreamReq.on('timeout', () => {
                  if (!upstreamReq.destroyed) {
                    upstreamReq.destroy(new Error(`Upstream timeout after ${UPSTREAM_TIMEOUT_MS / 1000}s`));
                  }
                });

                upstreamReq.on('error', (err) => {
                  sendJson(res, 502, { success: false, error: err.message });
                  resolve();
                });

                upstreamReq.write(payload);
                upstreamReq.end();
              });
            }
          }

          return sendJson(res, 404, {
            success: false,
            error: `未知的内容 API 路由: ${pathname}`,
            timestamp: Date.now(),
          });
        } catch (err) {
          return sendJson(res, 500, {
            success: false,
            error: err?.message || String(err),
            timestamp: Date.now(),
          });
        }
      });
    },
  };
}

export default contentApiDevServerPlugin;
