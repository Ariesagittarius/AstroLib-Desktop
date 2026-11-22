import { BilingualOnnxEngine } from './onnx-engine.ts';
import { QwenEngine } from './qwen-engine.ts';

const BILINGUAL_PATH_PREFIX = '/__bilingual__';

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

export function bilingualDevServerPlugin() {
  return {
    name: 'astrolib-bilingual-aligner-dev-server',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const rawUrl = req.url || '';
        if (!rawUrl.startsWith(BILINGUAL_PATH_PREFIX)) {
          return next();
        }

        if (req.method === 'OPTIONS') {
          res.writeHead(204, {
            'Cache-Control': 'no-store',
          });
          return res.end();
        }

        const path = rawUrl.split('?')[0];

        try {

          if (req.method === 'GET' && path === `${BILINGUAL_PATH_PREFIX}/health`) {
            const engine = BilingualOnnxEngine.getInstance();
            const qwenEngine = QwenEngine.getInstance();
            const models = await engine.getAvailableModels();
            return sendJson(res, 200, {
              status: 'ok',
              engine: 'onnxruntime-node',
              models,
              runtime: [engine.getRuntimeInfo(), qwenEngine.getRuntimeInfo()],
              timestamp: Date.now(),
            });
          }

          if (req.method === 'POST' && path === `${BILINGUAL_PATH_PREFIX}/unload`) {
            QwenEngine.getInstance().destroy();
            await BilingualOnnxEngine.getInstance().dispose();
            return sendJson(res, 200, {
              ok: true,
              runtime: [
                BilingualOnnxEngine.getInstance().getRuntimeInfo(),
                QwenEngine.getInstance().getRuntimeInfo(),
              ],
            });
          }

          if (req.method === 'GET' && path === `${BILINGUAL_PATH_PREFIX}/models`) {
            const engine = BilingualOnnxEngine.getInstance();
            const models = await engine.getAvailableModels();
            return sendJson(res, 200, { models });
          }

          if (req.method === 'POST' && path === `${BILINGUAL_PATH_PREFIX}/align`) {
            const body = await readJsonBody(req);
            const sourceTexts = body.sourceTexts || (Array.isArray(body.sourceParagraphs) ? body.sourceParagraphs.map(p => typeof p === 'string' ? p : p.text) : []);
            const targetTexts = body.targetTexts || (Array.isArray(body.targetParagraphs) ? body.targetParagraphs.map(p => typeof p === 'string' ? p : p.text) : []);
            const model = body.model || 'minilm-l12';

            if (!Array.isArray(sourceTexts) || !Array.isArray(targetTexts)) {
              return sendJson(res, 400, { error: 'sourceTexts and targetTexts must be arrays of strings' });
            }

            const engine = BilingualOnnxEngine.getInstance();
            const result = await engine.alignParagraphs(sourceTexts, targetTexts, { model });
            return sendJson(res, 200, result);
          }

          if (req.method === 'POST' && path === `${BILINGUAL_PATH_PREFIX}/toc-match`) {
            const body = await readJsonBody(req);
            const sourceChapters = body.sourceChapters || [];
            const targetChapters = body.targetChapters || [];
            const model = body.model || 'minilm-l12';

            const engine = BilingualOnnxEngine.getInstance();
            const matches = await engine.matchToc(sourceChapters, targetChapters, { model });
            return sendJson(res, 200, { matches });
          }

          return sendJson(res, 404, { error: 'Not Found' });
        } catch (err) {
          console.error('[bilingual-server] Request handler error:', err);
          return sendJson(res, 500, { error: err.message || 'Internal Server Error' });
        }
      });
    },
  };
}
