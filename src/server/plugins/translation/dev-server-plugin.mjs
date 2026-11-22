import { translationService } from '../../../services/translation/service.ts';
import { dictionaryService } from '../../../services/dictionary/dictionary-service.ts';

const PROXY_PATH_PREFIX = '/api/translate';
const DICT_PATH_PREFIX = '/api/dict';

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

        if (req.method === 'OPTIONS') {
          res.writeHead(204, {
            'Cache-Control': 'no-store',
          });
          return res.end();
        }

        const parsedUrl = new URL(rawUrl, 'http://localhost');
        const pathname = parsedUrl.pathname;

        try {

          if (req.method === 'GET' && pathname === `${PROXY_PATH_PREFIX}/health`) {
            return sendJson(res, 200, {
              ok: true,
              status: 'ready',
              defaultProvider: translationService.getDefaultProviderId(),
              timestamp: Date.now(),
            });
          }

          if (req.method === 'GET' && pathname === `${PROXY_PATH_PREFIX}/providers`) {
            return sendJson(res, 200, {
              ok: true,
              defaultProvider: translationService.getDefaultProviderId(),
              providers: translationService.listProviders(),
            });
          }

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

          if (req.method === 'GET' && (pathname === DICT_PATH_PREFIX || pathname === `${PROXY_PATH_PREFIX}/dict`)) {
            const word = parsedUrl.searchParams.get('word') || '';
            if (!word.trim()) {
              return sendJson(res, 400, { ok: false, error: '缺少待查询单词参数 (word)' });
            }
            const dictResult = await dictionaryService.lookup(word);
            return sendJson(res, dictResult.ok ? 200 : 404, dictResult);
          }

          if (req.method === 'POST' && (pathname === `${DICT_PATH_PREFIX}/context` || pathname === `${PROXY_PATH_PREFIX}/dict/context`)) {
            const body = await readJsonBody(req);
            const { word, sentence, provider, apiKey, endpoint, model } = body;
            if (!word) {
              return sendJson(res, 400, { ok: false, error: '缺少目标单词 (word)' });
            }
            const contextResult = await dictionaryService.explainInContext({ word, sentence, provider, apiKey, endpoint, model });
            return sendJson(res, contextResult.ok ? 200 : 500, contextResult);
          }

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
