/**
 * src/server/plugins/info-highlight/dev-server-plugin.mjs
 * ============================================================================
 * Vite Dev Server / LocalServer 插件：本地 Qwen 信息高亮服务接口 (/__info_highlight__/*)
 * ============================================================================
 */

import { QwenHighlightService } from '../../../services/info-highlight/qwen-highlight-service.ts';

const HIGHLIGHT_PATH_PREFIX = '/__info_highlight__';

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

export function infoHighlightDevServerPlugin() {
  return {
    name: 'astrolib-info-highlight-dev-server',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const rawUrl = req.url || '';
        if (!rawUrl.startsWith(HIGHLIGHT_PATH_PREFIX)) {
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

        const path = rawUrl.split('?')[0];

        try {
          // 2. 健康与模型状态探活 /__info_highlight__/status
          if (req.method === 'GET' && path === `${HIGHLIGHT_PATH_PREFIX}/status`) {
            const service = QwenHighlightService.getInstance();
            const status = await service.getStatus();
            return sendJson(res, 200, status);
          }

          // 3. 文本分析 /__info_highlight__/analyze
          if (req.method === 'POST' && path === `${HIGHLIGHT_PATH_PREFIX}/analyze`) {
            const body = await readJsonBody(req);
            const text = body.text || '';
            if (typeof text !== 'string') {
              return sendJson(res, 400, { error: 'text must be a string' });
            }

            const service = QwenHighlightService.getInstance();
            const result = await service.analyze(text);
            return sendJson(res, 200, result);
          }

          return sendJson(res, 404, { error: 'Not Found' });
        } catch (err) {
          console.error('[info-highlight-server] Handler error:', err);
          return sendJson(res, 500, { error: err.message || 'Internal Server Error' });
        }
      });
    },
  };
}

export default infoHighlightDevServerPlugin;
