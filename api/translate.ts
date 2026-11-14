/**
 * api/translate.ts
 * ============================================================================
 * AstroLib 统一翻译服务端点 (Vercel Serverless Function & Web Standard Route)
 * ============================================================================
 * 抽离翻译与词典核心逻辑至 src/services/translation/translation-core.ts，
 * 保持端点为纯协议适配层（Node.js req/res 与 Web Request/Response 双协议支持）。
 * ============================================================================
 */
import {
  CORS_HEADERS,
  DEFAULT_PROVIDERS,
  dispatchTranslate,
  dispatchBatchTranslate,
  dispatchDictLookup,
  dispatchDictContext,
} from '../src/services/translation/translation-core.ts';

function sendNodeJson(res: any, statusCode: number, data: any) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    ...CORS_HEADERS,
  });
  res.end(JSON.stringify(data));
}

async function readNodeBody(req: any): Promise<any> {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body.trim()) {
    try {
      return JSON.parse(req.body);
    } catch {}
  }
  const chunks: any[] = [];
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

export default async function handler(req: any, res: any) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    return res.end();
  }

  const url = new URL(req.url || '/', 'http://localhost');
  const pathname = url.pathname;

  if (req.method === 'GET') {
    if (pathname.includes('/dict')) {
      const word = url.searchParams.get('word') || '';
      const result = await dispatchDictLookup(word);
      return sendNodeJson(res, result.status, result.data);
    }
    return sendNodeJson(res, 200, {
      ok: true,
      status: 'ready',
      version: '1.0.0',
      defaultProvider: 'google',
      providers: DEFAULT_PROVIDERS,
    });
  }

  if (req.method === 'POST') {
    const body = await readNodeBody(req);
    if (pathname.includes('/dict/context')) {
      const result = await dispatchDictContext(body);
      return sendNodeJson(res, result.status, result.data);
    }
    if (pathname.includes('/dict')) {
      const result = await dispatchDictLookup(body.word || '');
      return sendNodeJson(res, result.status, result.data);
    }
    if (pathname.includes('/batch')) {
      const result = await dispatchBatchTranslate(body);
      return sendNodeJson(res, result.status, result.data);
    }
    const result = await dispatchTranslate(body);
    return sendNodeJson(res, result.status, result.data);
  }

  sendNodeJson(res, 405, { ok: false, error: 'Method Not Allowed' });
}

export async function OPTIONS(_req?: Request): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname.includes('/dict')) {
    const word = url.searchParams.get('word') || '';
    const result = await dispatchDictLookup(word);
    return new Response(JSON.stringify(result.data), {
      status: result.status,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  }

  return new Response(
    JSON.stringify({
      ok: true,
      status: 'ready',
      version: '1.0.0',
      defaultProvider: 'google',
      providers: DEFAULT_PROVIDERS,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    }
  );
}

export async function POST(req: Request): Promise<Response> {
  const url = new URL(req.url);
  let body: any = {};
  try {
    body = await req.json();
  } catch {}

  let result: { status: number; data: any };
  if (url.pathname.includes('/dict/context')) {
    result = await dispatchDictContext(body);
  } else if (url.pathname.includes('/dict')) {
    result = await dispatchDictLookup(body.word || '');
  } else if (url.pathname.includes('/batch')) {
    result = await dispatchBatchTranslate(body);
  } else {
    result = await dispatchTranslate(body);
  }

  return new Response(JSON.stringify(result.data), {
    status: result.status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}
