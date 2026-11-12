/**
 * api/translate.ts
 * ============================================================================
 * AstroLib 生产环境翻译服务端点 (Vercel Serverless Function - Self-Contained)
 * ============================================================================
 * 职责：
 * 1. 响应 CORS 预检 (OPTIONS)，支持生产域名与本地跨域调用；
 * 2. GET /api/translate -> 健康探活与提供商列表；
 * 3. POST /api/translate -> 服务端翻译兜底支持（独立自包含，零外部相对导入，杜绝 Vercel 打包崩溃）；
 * 4. POST /api/translate/batch -> 批量段落翻译；
 * 5. 全面兼容 Node.js runtime (req, res) 与 Web standard Request / Edge runtime。
 * ============================================================================
 */

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
  'Cache-Control': 'no-cache, no-store, must-revalidate',
};

const DEFAULT_PROVIDERS = [
  { id: 'google', label: 'Google 翻译 (官方/默认)', desc: 'Google 官方成熟机器翻译引擎，响应迅速、翻译稳定' },
  { id: 'zhipu', label: '智谱 GLM-4 (免费)', desc: '智谱开放平台 GLM-4-Flash 官方永久免费模型，国内免翻直连' },
  { id: 'gemini', label: 'Google Gemini (学术推理)', desc: 'Google 官方前沿学术与理科推理模型' },
  { id: 'bupt', label: '北京邮电大学 (校内专属)', desc: '北京邮电大学「人人有算力」校内专属服务，免翻直连' },
];

async function translateWithGoogle(text: string, apiKey?: string): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) return text;

  // 1. Google Cloud Translation API (v2) if API Key provided
  if (apiKey && apiKey.startsWith('AIzaSy')) {
    try {
      const url = `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(apiKey)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ q: trimmed, source: 'en', target: 'zh-CN', format: 'text' }),
      });
      if (res.ok) {
        const data = await res.json();
        const trans = data?.data?.translations?.[0]?.translatedText;
        if (typeof trans === 'string' && trans) return trans;
      }
    } catch {}
  }

  // 2. Chrome Extension Endpoint (clients5)
  try {
    const res = await fetch('https://clients5.google.com/translate_a/t?client=dict-chrome-ex', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      },
      body: new URLSearchParams({ sl: 'en', tl: 'zh-CN', q: trimmed }),
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && typeof data[0] === 'string') {
        return data.join('');
      }
      if (Array.isArray(data) && Array.isArray(data[0])) {
        return data[0].filter((p: any) => typeof p === 'string').join('');
      }
    }
  } catch {}

  // 3. Fallback GTX
  try {
    const gtxUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=${encodeURIComponent(trimmed)}`;
    const gtxRes = await fetch(gtxUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    if (gtxRes.ok) {
      const data = await gtxRes.json();
      if (Array.isArray(data) && Array.isArray(data[0])) {
        const full = data[0]
          .filter((part: any) => Array.isArray(part) && typeof part[0] === 'string')
          .map((part: any) => part[0])
          .join('');
        if (full) return full;
      }
    }
  } catch {}

  return trimmed;
}

async function translateWithZhipu(text: string, apiKey: string): Promise<string> {
  const res = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'glm-4-flash',
      temperature: 0.1,
      messages: [
        {
          role: 'system',
          content: '你是一个无状态的高校教材纯文本翻译引擎。你的唯一任务是将输入的英文直接翻译为规范的简体中文。严禁扩写，仅输出翻译结果。',
        },
        {
          role: 'user',
          content: `请直接翻译以下英文内容为简体中文（仅输出译文）：\n<source_text>\n${text}\n</source_text>`,
        },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`智谱 API 异常: HTTP ${res.status}`);
  }
  const data = await res.json();
  let content = data?.choices?.[0]?.message?.content || '';
  content = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  content = content.replace(/<\/?(?:source_text|translation|translated_text)>/gi, '').trim();
  if (content.startsWith('```') && content.endsWith('```')) {
    content = content.replace(/^```(?:markdown|md|text)?\n([\s\S]*?)\n```$/i, '$1').trim();
  }
  return content.replace(/^(?:好的[，,！!]?|以下是翻译[：:]?|翻译如下[：:]?|译文[：:]?)\s*/i, '').trim();
}

async function translateText(text: string, options: any = {}): Promise<{ success: boolean; translatedText: string; provider: string; error?: string }> {
  const provider = options.provider || 'google';
  const apiKey = options.apiKey || (typeof process !== 'undefined' ? process.env?.ZHIPU_API_KEY || process.env?.GOOGLE_TRANSLATE_API_KEY : '');

  try {
    let translated = '';
    if (provider === 'zhipu' && apiKey) {
      translated = await translateWithZhipu(text, apiKey);
    } else {
      translated = await translateWithGoogle(text, apiKey);
    }
    return {
      success: true,
      translatedText: translated || text,
      provider,
    };
  } catch (err: any) {
    return {
      success: false,
      translatedText: text,
      provider,
      error: err?.message || '翻译失败',
    };
  }
}

function sendNodeJson(res: any, statusCode: number, data: any) {
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    for (const [k, v] of Object.entries(CORS_HEADERS)) {
      res.setHeader(k, v);
    }
    return res.status(statusCode).json(data);
  }

  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    ...CORS_HEADERS,
  });
  res.end(JSON.stringify(data));
}

async function readNodeBody(req: any): Promise<any> {
  if (req.body) {
    if (typeof req.body === 'string') {
      try {
        return JSON.parse(req.body);
      } catch {
        return {};
      }
    }
    return req.body;
  }

  const chunks: Buffer[] = [];
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

/**
 * Node.js Runtime Handler (Vercel Standard Node.js Function)
 */
async function handleNode(req: any, res: any) {
  if (req.method === 'OPTIONS') {
    if (typeof res.status === 'function') {
      for (const [k, v] of Object.entries(CORS_HEADERS)) {
        res.setHeader(k, v);
      }
      return res.status(204).end();
    }
    res.writeHead(204, CORS_HEADERS);
    return res.end();
  }

  if (req.method === 'GET') {
    return sendNodeJson(res, 200, {
      ok: true,
      status: 'ready',
      defaultProvider: 'google',
      providers: DEFAULT_PROVIDERS,
      timestamp: Date.now(),
    });
  }

  if (req.method === 'POST') {
    try {
      const body = await readNodeBody(req);
      const { text, paragraphs, provider, sourceLang, targetLang, apiKey, endpoint, model } = body;

      if (Array.isArray(paragraphs)) {
        const results = await Promise.all(
          paragraphs.map(async (p: any) => {
            const src = typeof p === 'string' ? p : p?.sourceText || '';
            const resSingle = await translateText(src, { provider, apiKey, endpoint, model, sourceLang, targetLang });
            return typeof p === 'string'
              ? resSingle.translatedText
              : { ...p, translatedText: resSingle.translatedText, status: resSingle.success ? 'done' : 'error', error: resSingle.error };
          })
        );
        return sendNodeJson(res, 200, {
          ok: true,
          paragraphs: results,
        });
      }

      if (!text || typeof text !== 'string') {
        return sendNodeJson(res, 400, {
          ok: false,
          error: '缺少有效的待翻译文本 (text)',
        });
      }

      const result = await translateText(text, {
        provider,
        sourceLang,
        targetLang,
        apiKey,
        endpoint,
        model,
      });

      return sendNodeJson(res, result.success ? 200 : 500, {
        ok: result.success,
        ...result,
      });
    } catch (err: any) {
      return sendNodeJson(res, 500, {
        ok: false,
        error: err?.message || '翻译服务器内部异常',
      });
    }
  }

  return sendNodeJson(res, 405, { ok: false, error: 'Method Not Allowed' });
}

function normalizePos(raw: string): string {
  const lower = raw.trim().toLowerCase();
  if (lower.startsWith('noun') || lower === 'n') return 'n.';
  if (lower.startsWith('verb') || lower === 'v') return 'v.';
  if (lower.startsWith('adj') || lower === 'adjective') return 'adj.';
  if (lower.startsWith('adv') || lower === 'adverb') return 'adv.';
  if (lower.startsWith('prep') || lower === 'preposition') return 'prep.';
  if (lower.startsWith('conj') || lower === 'conjunction') return 'conj.';
  if (lower.startsWith('pron') || lower === 'pronoun') return 'pron.';
  if (lower.startsWith('interj') || lower === 'interjection') return 'int.';
  return lower.endsWith('.') ? lower : `${lower}.`;
}

async function fetchYoudaoJsonApi(word: string) {
  const url = `https://dict.youdao.com/jsonapi?q=${encodeURIComponent(word)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  });
  if (!res.ok) return null;

  const d = await res.json();
  const simpleWord = d.simple?.word?.[0];
  const phonetic = simpleWord?.usphone ? `/${simpleWord.usphone}/` : (simpleWord?.ukphone ? `/${simpleWord.ukphone}/` : undefined);
  const audioUrl = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word)}&type=2`;
  const trs = d.ec?.word?.[0]?.trs;
  const meanings: Array<{ partOfSpeech: string; definitions: string[] }> = [];

  if (Array.isArray(trs)) {
    for (const item of trs) {
      const text = item?.tr?.[0]?.l?.i?.[0] || '';
      if (!text) continue;
      const m = text.match(/^([a-z]+\.)\s*(.+)$/i);
      if (m) {
        const pos = normalizePos(m[1]);
        const defs = m[2].split(/[,，、；;]/).map((s: string) => s.trim()).filter(Boolean);
        if (defs.length > 0) {
          meanings.push({ partOfSpeech: pos, definitions: defs.slice(0, 5) });
        }
      } else {
        meanings.push({ partOfSpeech: '', definitions: [text] });
      }
    }
  }

  if (meanings.length === 0) return null;

  return {
    ok: true,
    word,
    phonetic,
    audioUrl,
    meanings,
    source: 'youdao-jsonapi',
  };
}

async function fetchGoogleDictForWord(word: string) {
  const gtxUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&dt=bd&dt=rm&q=${encodeURIComponent(word)}`;
  const res = await fetch(gtxUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    },
  });
  if (!res.ok) return null;

  const data = await res.json();
  if (!Array.isArray(data)) return null;

  const meanings: Array<{ partOfSpeech: string; definitions: string[] }> = [];
  let phonetic: string | undefined;

  if (Array.isArray(data[1])) {
    for (const group of data[1]) {
      if (!Array.isArray(group)) continue;
      const pos = normalizePos(group[0] || '');
      const defs = [];
      if (Array.isArray(group[1])) {
        defs.push(...group[1].filter((d: any) => typeof d === 'string' && d.trim()));
      }
      if (defs.length > 0) {
        meanings.push({ partOfSpeech: pos, definitions: defs.slice(0, 5) });
      }
    }
  }

  if (Array.isArray(data[0])) {
    for (const item of data[0]) {
      if (Array.isArray(item) && typeof item[3] === 'string' && item[3].trim()) {
        phonetic = item[3].trim();
        break;
      }
    }
  }

  if (meanings.length === 0 && Array.isArray(data[0]) && data[0][0] && typeof data[0][0][0] === 'string') {
    const basic = data[0][0][0].trim();
    if (basic && basic.toLowerCase() !== word) {
      meanings.push({ partOfSpeech: '', definitions: [basic] });
    }
  }

  if (meanings.length === 0) return null;

  return {
    ok: true,
    word,
    phonetic: phonetic ? `/${phonetic.replace(/^\/|\/$/g, '')}/` : undefined,
    audioUrl: `https://translate.google.com/translate_tts?ie=UTF-8&tl=en&client=tw-ob&q=${encodeURIComponent(word)}`,
    meanings,
    source: 'google-dict',
  };
}

/**
 * Web Standard Request / Edge Runtime Handler
 */
async function handleWeb(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const url = new URL(req.url);

  if (req.method === 'GET') {
    const wordParam = (url.searchParams.get('word') || '').trim();
    if (url.pathname.endsWith('/dict') || wordParam) {
      if (!wordParam || !/^[a-zA-Z\-'’]+$/.test(wordParam)) {
        return Response.json({ ok: false, error: '缺少有效的英文单词参数 (word)' }, { status: 400, headers: CORS_HEADERS });
      }
      const word = wordParam.toLowerCase();
      let result = await fetchYoudaoJsonApi(word).catch(() => null);
      if (!result || result.meanings.length === 0) {
        result = await fetchGoogleDictForWord(word).catch(() => null);
      }
      if (!result || result.meanings.length === 0) {
        return Response.json({ ok: false, word, meanings: [], error: '未能检索到释义' }, { status: 404, headers: CORS_HEADERS });
      }
      return Response.json(result, { status: 200, headers: CORS_HEADERS });
    }

    return Response.json(
      {
        ok: true,
        status: 'ready',
        defaultProvider: 'google',
        providers: DEFAULT_PROVIDERS,
        timestamp: Date.now(),
      },
      { headers: CORS_HEADERS }
    );
  }

  if (req.method === 'POST') {
    try {
      const body = await req.json().catch(() => ({}));
      const { text, paragraphs, provider, sourceLang, targetLang, apiKey, endpoint, model, word, sentence } = body;

      // 词典学术语境解析支持: POST /api/translate/dict/context 或 POST /api/translate 带 word
      if (word && sentence) {
        let explanation = '';
        const rawSentence = (sentence || word).trim();
        try {
          const transSingle = await translateText(rawSentence, { provider, apiKey, endpoint, model, sourceLang: 'en', targetLang: 'zh-CN' });
          const translatedSentence = (transSingle?.translatedText || '').trim();
          let dict: any = await fetchYoudaoJsonApi(word);
          if (!dict) dict = await fetchGoogleDictForWord(word);

          let matched: { keyword: string; fullDef: string; pos?: string } | null = null;
          if (translatedSentence && dict && dict.meanings?.length > 0) {
            for (const m of dict.meanings) {
              for (const def of m.definitions) {
                const candidates = def.split(/[/；，、\s]+/);
                for (const cand of candidates) {
                  const cleanKeyword = cand.trim().replace(/[的地理于着]+$/, '');
                  if (cleanKeyword.length >= 1 && translatedSentence.includes(cleanKeyword)) {
                    if (!matched || cleanKeyword.length > matched.keyword.length) {
                      matched = { keyword: cleanKeyword, fullDef: def, pos: m.partOfSpeech };
                    }
                  }
                }
              }
            }
          }

          if (matched && translatedSentence) {
            const highlighted = translatedSentence.replace(matched.keyword, `【${matched.keyword}】`);
            const posText = matched.pos ? `（${matched.pos}）` : '';
            explanation = `在当前学术语境中，**${word}** 意为“**${matched.fullDef}**”${posText}。\n\n**原句译文**：${highlighted}`;
          } else if (translatedSentence) {
            const primaryDef = dict?.meanings?.[0]?.definitions?.slice(0, 3).join(' / ') || '学术专业术语';
            explanation = `**原句译文**：${translatedSentence}\n\n**学术取义**：在当前语境中通常取“**${primaryDef}**”之义，用于学术论证与修辞。`;
          } else {
            explanation = `在当前学术语境中，**${word}** 充当关键学术术语。`;
          }
        } catch {
          explanation = `在当前学术原句中，**${word}** 具有特定专业论述作用。`;
        }

        return Response.json({
          ok: true,
          word,
          explanation,
        }, { headers: CORS_HEADERS });
      }

      if (Array.isArray(paragraphs)) {
        const results = await Promise.all(
          paragraphs.map(async (p: any) => {
            const src = typeof p === 'string' ? p : p?.sourceText || '';
            const resSingle = await translateText(src, { provider, apiKey, endpoint, model, sourceLang, targetLang });
            return typeof p === 'string'
              ? resSingle.translatedText
              : { ...p, translatedText: resSingle.translatedText, status: resSingle.success ? 'done' : 'error', error: resSingle.error };
          })
        );
        return Response.json({ ok: true, paragraphs: results }, { headers: CORS_HEADERS });
      }

      if (!text || typeof text !== 'string') {
        return Response.json(
          { ok: false, error: '缺少有效的待翻译文本 (text)' },
          { status: 400, headers: CORS_HEADERS }
        );
      }

      const result = await translateText(text, {
        provider,
        sourceLang,
        targetLang,
        apiKey,
        endpoint,
        model,
      });

      return Response.json(
        { ok: result.success, ...result },
        { status: result.success ? 200 : 500, headers: CORS_HEADERS }
      );
    } catch (err: any) {
      return Response.json(
        { ok: false, error: err?.message || '翻译服务器内部异常' },
        { status: 500, headers: CORS_HEADERS }
      );
    }
  }

  return Response.json({ ok: false, error: 'Method Not Allowed' }, { status: 405, headers: CORS_HEADERS });
}

/**
 * Universal Handler Entrypoint
 */
export default async function handler(req: any, res?: any) {
  if (!res && typeof req?.headers?.get === 'function') {
    return handleWeb(req);
  }
  return handleNode(req, res);
}

export async function GET(req: Request) {
  return handleWeb(req);
}

export async function POST(req: Request) {
  return handleWeb(req);
}

export async function OPTIONS(req: Request) {
  return handleWeb(req);
}
