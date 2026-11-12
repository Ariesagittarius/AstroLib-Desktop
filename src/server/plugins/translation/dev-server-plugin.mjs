/**
 * src/server/plugins/translation/dev-server-plugin.mjs
 * ============================================================================
 * Vite Dev Server 插件：学术教材结构无损翻译服务接口 (/api/translate/*)
 * ============================================================================
 * 端点职责：
 * 1. OPTIONS /api/translate/* -> 响应 CORS 预检
 * 2. GET /api/translate/health -> 健康探活
 * 3. GET /api/translate/providers -> 获取支持的翻译提供商列表
 * 4. POST /api/translate -> 翻译单段文本或整篇 Markdown（带结构遮蔽与还原）
 * 5. POST /api/translate/batch -> 批量翻译段落
 * ============================================================================
 */

import { translationService } from '../../../services/translation/service.ts';
import { dictionaryService } from '../../../services/dictionary/dictionary-service.ts';

const PROXY_PATH_PREFIX = '/api/translate';
const DICT_PATH_PREFIX = '/api/dict';

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': '*',
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
  return JSON.parse(raw);
}

export function translationDevServerPlugin() {
  return {
    name: 'astrolib-translation-dev-server',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const rawUrl = req.url || '';
        if (!rawUrl.startsWith(PROXY_PATH_PREFIX) && !rawUrl.startsWith(DICT_PATH_PREFIX)) {
          return next();
        }

        // 1. CORS 预检
        if (req.method === 'OPTIONS') {
          res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': '*',
            'Access-Control-Max-Age': '86400',
          });
          return res.end();
        }

        const parsedUrl = new URL(rawUrl, 'http://localhost');
        const pathname = parsedUrl.pathname;

        try {
          // 2. 健康探测: GET /api/translate/health
          if (req.method === 'GET' && pathname === `${PROXY_PATH_PREFIX}/health`) {
            return sendJson(res, 200, {
              ok: true,
              status: 'ready',
              defaultProvider: translationService.getDefaultProviderId(),
              timestamp: Date.now(),
            });
          }

          // 3. 提供商列表: GET /api/translate/providers
          if (req.method === 'GET' && pathname === `${PROXY_PATH_PREFIX}/providers`) {
            return sendJson(res, 200, {
              ok: true,
              defaultProvider: translationService.getDefaultProviderId(),
              providers: translationService.listProviders(),
            });
          }

          // 4. 单段/全篇翻译: POST /api/translate
          if (req.method === 'POST' && (pathname === PROXY_PATH_PREFIX || pathname === `${PROXY_PATH_PREFIX}/`)) {
            const body = await readJsonBody(req);
            const { text, provider, sourceLang, targetLang, preserveStructure, apiKey, endpoint, model } = body;

            if (!text || typeof text !== 'string') {
              return sendJson(res, 400, {
                ok: false,
                error: '缺少有效的待翻译文本 (text)',
              });
            }

            const result = await translationService.translate(text, {
              provider,
              sourceLang,
              targetLang,
              preserveStructure: preserveStructure !== false,
              apiKey,
              endpoint,
              model,
            });

            return sendJson(res, result.success ? 200 : 500, {
              ok: result.success,
              ...result,
            });
          }

          // 5. 批量段落翻译: POST /api/translate/batch
          if (req.method === 'POST' && pathname === `${PROXY_PATH_PREFIX}/batch`) {
            const body = await readJsonBody(req);
            const { paragraphs, provider, sourceLang, targetLang, preserveStructure } = body;

            if (!Array.isArray(paragraphs)) {
              return sendJson(res, 400, {
                ok: false,
                error: '缺少段落数组 (paragraphs)',
              });
            }

            const results = await translationService.translateParagraphs(paragraphs, {
              provider,
              sourceLang,
              targetLang,
              preserveStructure: preserveStructure !== false,
            });

            return sendJson(res, 200, {
              ok: true,
              paragraphs: results,
            });
          }

          // 6. 单词释义查询: GET /api/dict?word=... 或 GET /api/translate/dict?word=...
          if (req.method === 'GET' && (pathname === DICT_PATH_PREFIX || pathname === `${PROXY_PATH_PREFIX}/dict`)) {
            const word = parsedUrl.searchParams.get('word') || '';
            if (!word.trim()) {
              return sendJson(res, 400, { ok: false, error: '缺少待查询单词参数 (word)' });
            }
            const dictResult = await dictionaryService.lookup(word);
            return sendJson(res, dictResult.ok ? 200 : 404, dictResult);
          }

          // 7. 学术语境解析: POST /api/dict/context 或 POST /api/translate/dict/context
          if (req.method === 'POST' && (pathname === `${DICT_PATH_PREFIX}/context` || pathname === `${PROXY_PATH_PREFIX}/dict/context`)) {
            const body = await readJsonBody(req);
            const { word, sentence, provider, apiKey, endpoint, model } = body;
            if (!word) {
              return sendJson(res, 400, { ok: false, error: '缺少目标单词 (word)' });
            }
            const contextResult = await dictionaryService.explainInContext({ word, sentence, provider, apiKey, endpoint, model });
            return sendJson(res, contextResult.ok ? 200 : 500, contextResult);
          }

          // 其他路径 404
          return sendJson(res, 404, {
            ok: false,
            error: `未知翻译端点: ${pathname}`,
          });
        } catch (err) {
          return sendJson(res, 500, {
            ok: false,
            error: err?.message || '翻译服务器内部错误',
          });
        }
      });
    },
  };
}
