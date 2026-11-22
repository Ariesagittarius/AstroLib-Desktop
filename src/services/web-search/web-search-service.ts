import type { WebSearchConfig, WebSearchProviderKind } from '../../features/harness/types.ts';
export type { WebSearchConfig, WebSearchProviderKind };

export interface WebSearchHit {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
  source?: string;
}

export interface WebSearchRequest {
  provider: WebSearchProviderKind;
  apiKey?: string;
  baseUrl?: string;
  query: string;
  maxResults?: number;
}

export interface WebSearchResponse {
  success: boolean;
  provider: WebSearchProviderKind;
  query: string;
  results: WebSearchHit[];
  error?: string;
  latencyMs: number;
}

export function isWebSearchConfigured(cfg?: Partial<WebSearchConfig>): boolean {
  if (!cfg || !cfg.enabled || !cfg.provider || cfg.provider === 'none') {
    return false;
  }
  const key = (cfg.apiKey || '').trim();
  const base = (cfg.baseUrl || '').trim();
  if (cfg.provider === 'tavily' || cfg.provider === 'bocha') {
    return key.length > 0;
  }
  if (cfg.provider === 'searxng' || cfg.provider === 'custom') {
    return /^https?:\/\//i.test(base);
  }
  return false;
}

function normalizeHits(rawItems: any[], maxResults: number): WebSearchHit[] {
  const hits: WebSearchHit[] = [];
  for (const item of rawItems || []) {
    if (!item || typeof item !== 'object') continue;
    const title = String(item.title || item.name || item.url || 'Untitled').trim();
    const url = String(item.url || item.link || '').trim();
    const snippet = String(
      item.snippet || item.content || item.summary || item.description || ''
    )
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 500);
    if (!url || !/^https?:\/\//i.test(url)) continue;
    hits.push({
      title: title.slice(0, 180),
      url,
      snippet,
      ...(item.publishedDate || item.published_date || item.dateLastCrawled
        ? { publishedAt: String(item.publishedDate || item.published_date || item.dateLastCrawled) }
        : {}),
      ...(item.source || item.siteName ? { source: String(item.source || item.siteName) } : {}),
    });
    if (hits.length >= maxResults) break;
  }
  return hits;
}

export async function executeWebSearch(
  req: WebSearchRequest,
  fetchImpl: typeof fetch = fetch
): Promise<WebSearchResponse> {
  const t0 = Date.now();
  const query = (req.query || '').trim();
  const provider = req.provider || 'none';
  const maxResults = Math.max(1, Math.min(12, Number(req.maxResults) || 5));
  const apiKey = (req.apiKey || '').trim();
  const baseUrl = (req.baseUrl || '').trim().replace(/\/+$/, '');

  if (!query) {
    return {
      success: false,
      provider,
      query,
      results: [],
      error: '检索词 query 不能为空。',
      latencyMs: Date.now() - t0,
    };
  }

  if (provider === 'none') {
    return {
      success: false,
      provider,
      query,
      results: [],
      error: '当前未选择联网搜索服务商。',
      latencyMs: Date.now() - t0,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);

  try {
    if (provider === 'tavily') {
      if (!apiKey) {
        throw new Error('Tavily 搜索缺少 API Key。');
      }
      const endpoint = baseUrl ? `${baseUrl}/search` : 'https://api.tavily.com/search';
      const res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: apiKey,
          query,
          search_depth: 'basic',
          max_results: maxResults,
          include_answer: false,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`Tavily HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }
      const json: any = await res.json();
      return {
        success: true,
        provider,
        query,
        results: normalizeHits(json?.results || [], maxResults),
        latencyMs: Date.now() - t0,
      };
    }

    if (provider === 'bocha') {
      if (!apiKey) {
        throw new Error('博查 Bocha 搜索缺少 API Key。');
      }
      const endpoint = baseUrl || 'https://api.bochaai.com/v1/web-search';
      const res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          query,
          count: maxResults,
          summary: true,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`Bocha HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }
      const json: any = await res.json();
      const rawArr =
        json?.data?.webPages?.value ||
        json?.webPages?.value ||
        json?.results ||
        json?.data ||
        [];
      return {
        success: true,
        provider,
        query,
        results: normalizeHits(rawArr, maxResults),
        latencyMs: Date.now() - t0,
      };
    }

    if (provider === 'searxng') {
      if (!/^https?:\/\//i.test(baseUrl)) {
        throw new Error('SearXNG 需要配置合法的 http(s):// 服务地址。');
      }
      const endpoint = `${baseUrl}/search?q=${encodeURIComponent(query)}&format=json`;
      const headers: Record<string, string> = {};
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
      const res = await fetchImpl(endpoint, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`SearXNG HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }
      const json: any = await res.json();
      return {
        success: true,
        provider,
        query,
        results: normalizeHits(json?.results || [], maxResults),
        latencyMs: Date.now() - t0,
      };
    }

    if (!/^https?:\/\//i.test(baseUrl)) {
      throw new Error('Custom 搜索接口需要配置完整的 http(s):// URL。');
    }
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const res = await fetchImpl(baseUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query, maxResults, limit: maxResults }),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Custom Search HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const json: any = await res.json();
    const rawArr = Array.isArray(json)
      ? json
      : json?.results || json?.items || json?.data?.results || json?.data || [];
    return {
      success: true,
      provider,
      query,
      results: normalizeHits(rawArr, maxResults),
      latencyMs: Date.now() - t0,
    };
  } catch (err: any) {
    return {
      success: false,
      provider,
      query,
      results: [],
      error:
        err?.name === 'AbortError'
          ? '联网搜索请求超时（12s）'
          : err?.message || String(err),
      latencyMs: Date.now() - t0,
    };
  } finally {
    clearTimeout(timer);
  }
}
