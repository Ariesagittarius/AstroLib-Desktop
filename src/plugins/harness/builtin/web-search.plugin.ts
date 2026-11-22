import type { HarnessPlugin, PluginContext } from '../types.ts';

const SOURCE_FILE = 'src/plugins/harness/builtin/web-search.plugin.ts';

export const WebSearchPlugin: HarnessPlugin = {
  id: 'astrolib.builtin.web-search',
  name: '联网检索适配器插件 (Tavily / Bocha / SearXNG / Custom)',
  version: '1.0.0',
  description: '允许用户自配检索 API 为 Agent 增加互联网实时资料核查能力（默认关闭）。',
  sourceFile: SOURCE_FILE,
  activate: (context: PluginContext) => {
    context.registerTool({
      name: 'web_search',
      displayName: '联网学术与实时资料检索',
      category: '联网检索',
      icon: { type: 'mdicon', value: 'travel_explore' },
      sourceFile: SOURCE_FILE,
      riskLevel: 'read',
      formatActionLabel: (args) => {
        const q = String(args.query || '').trim();
        return q ? `联网搜索 · ${q}` : '执行联网资料检索';
      },
      description:
        '通过用户自配的外部搜索引擎接口检索最新学术论文、官方文档或现实事实，返回标题、摘要与可核验 URL。本地教材与文献优先使用 search_library_text。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '精确检索词或问题短语' },
          maxResults: { type: 'number', description: '返回结果数量上限（1-10，默认遵循设置）' },
        },
        required: ['query'],
      },
      execute: async (args, ctx) => {
        const query = String(args.query || '').trim();
        const cfg = ctx.customData?.webSearch;
        if (!cfg || !cfg.enabled || !cfg.provider || cfg.provider === 'none') {
          return {
            toolName: 'web_search',
            command: 'web_search',
            success: false,
            summary: '联网搜索未启用',
            cardHtml: '',
            contextText: '用户尚未在「设置 -> Agent 与工具 -> 联网搜索」中开启或配置搜索引擎。',
          };
        }

        const fetcher = ctx.fetchFn || fetch;
        const res = await fetcher('/api/v1/content/agent-tools/web-search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider: cfg.provider,
            apiKey: cfg.apiKey,
            baseUrl: cfg.baseUrl,
            query,
            maxResults: args.maxResults ?? cfg.maxResults ?? 5,
          }),
        });
        const json = await res.json();
        const data = json.data || {};
        if (!json.success && !data.results) {
          return {
            toolName: 'web_search',
            command: 'web_search',
            success: false,
            summary: json.error || '联网搜索失败',
            cardHtml: '',
            contextText: `联网搜索调用失败: ${json.error || '未知错误'}`,
          };
        }

        const hits = Array.isArray(data.results) ? data.results : [];
        return {
          toolName: 'web_search',
          command: 'web_search',
          success: true,
          summary: `检索命中 ${hits.length} 条网页 (${data.latencyMs || 0}ms)`,
          cardHtml: '',
          contextText:
            hits.length > 0
              ? `【联网检索结果 (${hits.length} 条, provider=${data.provider})】:\n` +
                hits
                  .map(
                    (h: any, i: number) =>
                      `${i + 1}. [${h.title}](${h.url})${h.publishedAt ? ` (${h.publishedAt})` : ''}\n   ${h.snippet}`
                  )
                  .join('\n')
              : `未检索到与 "${query}" 相关的网页结果。`,
        };
      },
    });
  },
};
