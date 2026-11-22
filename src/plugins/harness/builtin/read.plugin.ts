import type { HarnessPlugin, PluginContext } from '../types.ts';
import { UniversalLocatorResolver } from '../../../core/content-api/content-locator.ts';

function escapeHtml(str: string): string {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function loadContentApiService() {
  if (typeof window !== 'undefined') {
    throw new Error('ContentApiService is only available in Node runtime');
  }
  const modPath = ['..', '..', '..', 'core', 'content-api', 'content-api-service.ts'].join('/');
  const mod = await import(/* @vite-ignore */ modPath);
  return mod.ContentApiService.getInstance();
}

async function fetchOrReadNode(
  ctx: any,
  colSlug: string,
  bookSlug: string,
  chapterSlug: string,
  nodeId: string,
  includeChildren?: boolean
) {
  if (typeof window !== 'undefined') {
    const fetchImpl = ctx.fetchFn || fetch;
    const url = `/api/v1/content/books/${encodeURIComponent(colSlug)}/${encodeURIComponent(bookSlug)}/chapters/${encodeURIComponent(chapterSlug)}/nodes/${encodeURIComponent(nodeId)}${includeChildren ? '?includeChildren=true' : ''}`;
    const res = await fetchImpl(url);
    const json = await res.json();
    if (json?.data) return json.data;
    throw new Error(json?.error || `Failed to load node ${nodeId}`);
  }

  const service = await loadContentApiService();
  return service.readChapterNode(colSlug, bookSlug, chapterSlug, nodeId, {
    includeChildren,
  });
}

export const ReadPlugin: HarnessPlugin = {
  id: 'astrolib.builtin.read',
  name: '精准内容节点读取插件',
  version: '1.1.0',
  description: '根据 AST 树节点唯一 ID 获取任意段落、公式、卡片模块的完整 MDX 原文。',
  sourceFile: 'src/plugins/harness/builtin/read.plugin.ts',
  activate: (context: PluginContext) => {
    context.registerCommand({
      command: '/read',
      aliases: ['/node', '/snippet'],
      displayName: '节点原文精读',
      description: '根据 AST 树中的唯一节点 ID (如 card-28-example, p-18, math-20) 直接读取其全部 MDX 原文与公式。',
      usage: '<[可选章节/URI] 节点ID>',
      icon: { type: 'mdicon', value: 'article' },
      suggest: () => [
        {
          id: 'read-example',
          title: '/read <nodeId>',
          subtitle: '示例: /read card-28-example 或 /read math-20',
          badge: 'READ',
          icon: { type: 'mdicon', value: 'article' },
          fillCommand: '/read ',
        },
      ],
      execute: async (args, ctx) => {
        const rawArgs = (args || '').trim();
        if (!rawArgs) {
          return {
            toolName: 'read_content_node',
            command: '/read',
            success: false,
            summary: '请提供目标节点的唯一 ID',
            cardHtml: `<div class="harness-tool-card"><div class="harness-tool-card__body">请指定要精读的节点 ID，例如 <code>/read card-28-example</code></div></div>`,
            contextText: '未提供目标节点 ID。',
          };
        }

        let locatorQuery = '';
        let nodeId = '';

        if (rawArgs.includes('#')) {
          const parts = rawArgs.split('#');
          locatorQuery = parts[0];
          nodeId = parts[1];
        } else {
          const parts = rawArgs.split(/\s+/);
          if (parts.length >= 2) {
            locatorQuery = parts.slice(0, -1).join(' ');
            nodeId = parts[parts.length - 1];
          } else {
            nodeId = parts[0];
          }
        }

        const locator = UniversalLocatorResolver.resolve(
          locatorQuery || 'math_analysis 6.2',
          ctx.books,
          ctx.chapters as any
        );
        const colSlug = locator.colSlug || 'math';
        const bookSlug = locator.bookSlug || 'math_analysis';
        const chapterSlug = locator.chapterSlug || '62_高阶导数及其他求导法则';

        try {
          const node = await fetchOrReadNode(ctx, colSlug, bookSlug, chapterSlug, nodeId);

          if (!node) {
            const errMsg = `在章节《${chapterSlug}》中未找到节点 "${nodeId}"`;
            return {
              toolName: 'read_content_node',
              command: `/read ${nodeId}`,
              success: false,
              summary: errMsg,
              cardHtml: `<div class="harness-tool-card"><div class="harness-tool-card__body">${escapeHtml(errMsg)}</div></div>`,
              contextText: errMsg,
            };
          }

          const rawMdxEscaped = escapeHtml(node.rawMdx);
          const summaryText = `已读取节点 [${node.type}] "${node.title || ''}" (${node.id}) 原文 (L${node.lineStart}-${node.lineEnd})`;

          const contextLines = [
            `【AST 节点原文精读结果 (节点 ID: "${node.id}")】:`,
            `所属章节: 《${node.chapterTitle}》 (URI: ${node.uri})`,
            `节点类型: ${node.type} | 标签: ${node.tag || node.kind || '无'}`,
            `标题/模块名: ${node.title || '无'}`,
            `行号范围: 第 ${node.lineStart} 行 至 第 ${node.lineEnd} 行`,
            `学术定性描述: ${node.summary}`,
          ];

          if (node.latex) {
            contextLines.push(`完整精确 LaTeX 公式:\n$$${node.latex}$$`);
          }

          contextLines.push('节点完整 MDX 源码:');
          contextLines.push('```mdx');
          contextLines.push(node.rawMdx);
          contextLines.push('```');

          return {
            toolName: 'read_content_node',
            command: `/read ${nodeId}`,
            success: true,
            summary: summaryText,
            cardHtml: `
              <div style="font-size: 0.88rem; line-height: 1.55; margin-bottom: 6px;">
                <strong>${escapeHtml(node.id)}</strong> · 《${escapeHtml(node.chapterTitle)}》（行 ${node.lineStart}-${node.lineEnd}）
              </div>
              <pre style="background: var(--md-sys-color-surface-container-low, var(--harness-bg-surface)); padding: 10px 12px; border-radius: 8px; font-size: 0.82rem; overflow-x: auto; max-height: 280px; border: 1px solid var(--md-sys-color-outline-variant, var(--harness-border-subtle));">${rawMdxEscaped}</pre>
            `,
            contextText: contextLines.join('\n'),
            artifact: {
              id: `node:${colSlug}/${bookSlug}/${chapterSlug}#${node.id}`,
              kind: 'markdown',
              title: `节点精读 · ${node.id}`,
              badge: `行 ${node.lineStart}-${node.lineEnd}`,
              html: `
                <div style="margin-bottom: 12px; font-size: 0.84rem; color: var(--harness-text-secondary);">
                  <div><strong>URI：</strong><code>${escapeHtml(node.uri)}</code></div>
                  <div><strong>章节：</strong>《${escapeHtml(node.chapterTitle)}》</div>
                  <div><strong>摘要：</strong>${escapeHtml(node.summary)}</div>
                </div>
                <h4 class="harness-ast-section-title">完整 MDX 源码</h4>
                <pre style="background: var(--md-sys-color-surface-container-low, var(--harness-bg-surface)); padding: 12px; border-radius: 8px; overflow-x: auto; font-size: 0.83rem; line-height: 1.6; border: 1px solid var(--md-sys-color-outline-variant, var(--harness-border-subtle));">${rawMdxEscaped}</pre>
              `,
            },
            sideEffectTab: 'artifacts',
          };
        } catch (err: any) {
          return {
            toolName: 'read_content_node',
            command: `/read ${nodeId}`,
            success: false,
            summary: `读取节点失败: ${err.message}`,
            cardHtml: `<div class="harness-tool-card"><div class="harness-tool-card__body" style="color: var(--md-sys-color-error, #ef4444);">读取节点失败: ${escapeHtml(err.message)}</div></div>`,
            contextText: `读取节点 ${nodeId} 失败: ${err.message}`,
          };
        }
      },
    });

    context.registerTool({
      name: 'read_content_node',
      displayName: '读取章节节点原文',
      category: '知识库检索',
      icon: { type: 'mdicon', value: 'article' },
      sourceFile: 'src/plugins/harness/builtin/read.plugin.ts',
      riskLevel: 'read',
      exposeAsSlashCommand: '/read',
      formatActionLabel: (args) => {
        const nid = String(args.nodeId || '').trim();
        return nid ? `读取节点原文 · ${nid}` : '读取章节节点原文';
      },
      description: '【精准内容节点读取器】根据 AST 树给出的唯一 ID（如 "card-28-example", "p-18", "math-20", "h2-16"）直接获取该段落/公式/标题/学术模块/习题的完整 MDX 原文、LaTeX 公式与行号范围。支持规范 URI。',
      parameters: {
        type: 'object',
        properties: {
          nodeId: {
            type: 'string',
            description: '目标节点的唯一 ID，例如 "card-28-example", "p-18", "math-20", "h2-16"',
          },
          locator: {
            type: 'string',
            description: '可选的规范内容定位 URI 或章节标识',
          },
          chapterSlug: {
            type: 'string',
            description: '可选的章节 slug 或文件名',
          },
          bookSlug: {
            type: 'string',
            description: '可选的所属图书 slug',
          },
          colSlug: {
            type: 'string',
            description: '可选的合集 slug',
          },
          includeChildren: {
            type: 'boolean',
            description: '若读取标题或容器模块，是否包含所有下级子节点的原文 (默认 false)',
          },
        },
        required: ['nodeId'],
      },
      execute: async (args, ctx) => {
        let nodeId = String(args.nodeId || '');
        let locatorQuery = String(args.locator || args.chapterSlug || '');

        if (args.locator && args.locator.includes('#')) {
          const parts = args.locator.split('#');
          locatorQuery = parts[0];
          if (!nodeId) nodeId = parts[1];
        }

        const locator = UniversalLocatorResolver.resolve(
          locatorQuery || (args.bookSlug && args.chapterSlug ? `${args.bookSlug} ${args.chapterSlug}` : 'math_analysis 6.2'),
          ctx.books,
          ctx.chapters as any
        );

        const colSlug = args.colSlug || locator.colSlug || 'math';
        const bookSlug = args.bookSlug || locator.bookSlug || 'math_analysis';
        const chapterSlug = args.chapterSlug || locator.chapterSlug || '62_高阶导数及其他求导法则';

        try {
          const node = await fetchOrReadNode(ctx, colSlug, bookSlug, chapterSlug, nodeId, args.includeChildren);

          if (!node) {
            const errMsg = `在章节《${chapterSlug}》中未找到节点 "${nodeId}"`;
            return {
              toolName: 'read_content_node',
              command: `/read ${nodeId}`,
              success: false,
              summary: errMsg,
              cardHtml: `<div class="harness-tool-card"><div class="harness-tool-card__body">${escapeHtml(errMsg)}</div></div>`,
              contextText: errMsg,
            };
          }

          const contextLines = [
            `【AST 节点原文精读结果 (节点 ID: "${node.id}")】:`,
            `所属章节: 《${node.chapterTitle}》 (URI: ${node.uri})`,
            `节点类型: ${node.type} | 标签: ${node.tag || node.kind || '无'}`,
            `标题/模块名: ${node.title || '无'}`,
            `行号范围: 第 ${node.lineStart} 行 至 第 ${node.lineEnd} 行`,
            `学术定性描述: ${node.summary}`,
          ];

          if (node.latex) {
            contextLines.push(`完整精确 LaTeX 公式:\n$$${node.latex}$$`);
          }

          contextLines.push('节点完整 MDX 原文源码:');
          contextLines.push('```mdx');
          contextLines.push(node.rawMdx);
          contextLines.push('```');

          return {
            toolName: 'read_content_node',
            command: `/read ${nodeId}`,
            success: true,
            summary: `已读取节点 [${node.type}] "${node.title || ''}" (${node.id}) 原文 (L${node.lineStart}-${node.lineEnd})`,
            cardHtml: `<div class="harness-tool-card"><div class="harness-tool-card__body">已读取节点 <code>${escapeHtml(node.id)}</code> 原文。</div></div>`,
            contextText: contextLines.join('\n'),
          };
        } catch (err: any) {
          return {
            toolName: 'read_content_node',
            command: `/read ${nodeId}`,
            success: false,
            summary: `读取节点失败: ${err.message}`,
            cardHtml: `<div class="harness-tool-card"><div class="harness-tool-card__body" style="color: var(--md-sys-color-error, #ef4444);">读取失败: ${escapeHtml(err.message)}</div></div>`,
            contextText: `读取节点 ${nodeId} 失败: ${err.message}`,
          };
        }
      },
    });
  },
};
