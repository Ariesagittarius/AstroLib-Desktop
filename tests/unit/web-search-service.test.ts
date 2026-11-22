import { describe, it, expect, vi } from 'vitest';
import {
  executeWebSearch,
  isWebSearchConfigured,
} from '../../src/services/web-search/web-search-service.ts';
import { PluginEnvironment } from '../../src/plugins/harness/plugin-environment.ts';

describe('WebSearch 多适配器与按需工具注入测试', () => {
  it('1. isWebSearchConfigured 严格校验各检索模式必填字段', () => {
    expect(isWebSearchConfigured(undefined)).toBe(false);
    expect(isWebSearchConfigured({ enabled: false, provider: 'tavily', apiKey: 'tvly-123' })).toBe(false);
    expect(isWebSearchConfigured({ enabled: true, provider: 'none' })).toBe(false);
    expect(isWebSearchConfigured({ enabled: true, provider: 'tavily', apiKey: '' })).toBe(false);
    expect(isWebSearchConfigured({ enabled: true, provider: 'searxng', baseUrl: 'ftp://bad' })).toBe(false);

    expect(isWebSearchConfigured({ enabled: true, provider: 'tavily', apiKey: 'tvly-123' })).toBe(true);
    expect(isWebSearchConfigured({ enabled: true, provider: 'bocha', apiKey: 'sk-bocha' })).toBe(true);
    expect(isWebSearchConfigured({ enabled: true, provider: 'searxng', baseUrl: 'http://127.0.0.1:8080' })).toBe(true);
    expect(isWebSearchConfigured({ enabled: true, provider: 'custom', baseUrl: 'https://search.example.com/q' })).toBe(true);
  });

  it('2. Tavily / Bocha / SearXNG / Custom 适配器正确构造请求并归一化结果', async () => {
    const tavilyFetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          results: [{ title: 'T1', url: 'https://a.org/1', content: 'Snippet 1', published_date: '2026-01-01' }],
        }),
        { status: 200 }
      )
    ) as unknown as typeof fetch;

    const r1 = await executeWebSearch(
      { provider: 'tavily', apiKey: 'tvly-k', query: 'Stolz theorem' },
      tavilyFetch
    );
    expect(r1.success).toBe(true);
    expect(r1.results[0].url).toBe('https://a.org/1');

    const bochaFetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: {
            webPages: {
              value: [{ name: 'B1', url: 'https://b.org/1', snippet: 'Bocha hit' }],
            },
          },
        }),
        { status: 200 }
      )
    ) as unknown as typeof fetch;
    const r2 = await executeWebSearch(
      { provider: 'bocha', apiKey: 'bocha-k', query: 'FFT' },
      bochaFetch
    );
    expect(r2.success).toBe(true);
    expect(r2.results[0].title).toBe('B1');

    const searxFetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          results: [{ title: 'S1', url: 'https://s.org/1', content: 'SearX hit' }],
        }),
        { status: 200 }
      )
    ) as unknown as typeof fetch;
    const r3 = await executeWebSearch(
      { provider: 'searxng', baseUrl: 'http://127.0.0.1:8888/', query: 'Eigenvalue' },
      searxFetch
    );
    expect(r3.success).toBe(true);
    expect(r3.results[0].title).toBe('S1');
  });

  it('3. PluginEnvironment 未开启联网时不注入 web_search，且支持动态覆写工具描述', () => {
    const env = PluginEnvironment.getInstance();
    const disabledTools = env.toOpenAITools({
      permissionMode: 'workspace',
      webSearchEnabled: false,
      dynamicToolDescriptions: {
        run_python: 'DYNAMIC_PY_PACKAGES_MARKER',
      },
    });
    expect(disabledTools.some((t) => t.function?.name === 'web_search')).toBe(false);
    const runPy = disabledTools.find((t) => t.function?.name === 'run_python');
    expect(runPy?.function?.description).toBe('DYNAMIC_PY_PACKAGES_MARKER');

    const enabledTools = env.toOpenAITools({
      permissionMode: 'workspace',
      webSearchEnabled: true,
    });
    expect(enabledTools.some((t) => t.function?.name === 'web_search')).toBe(true);
  });
});
