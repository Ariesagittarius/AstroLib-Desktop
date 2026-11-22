/**
 * src/plugins/harness/builtin/toc.plugin.ts
 * ============================================================================
 * AstroLib 章节大纲目录插件 (/toc) - 统一协议驱动
 * ============================================================================
 */

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

function extractAllChapters(nodes: any[]): Array<{ title: string; slug: string; filePath?: string }> {
  const list: Array<{ title: string; slug: string; filePath?: string }> = [];
  for (const node of nodes) {
    if (node.type === 'chapter') {
      list.push({ title: node.title, slug: node.slug, filePath: node.filePath });
    } else if (node.type === 'group' && Array.isArray(node.children)) {
      list.push(...extractAllChapters(node.children));
    }
  }
  return list;
}

export const TocPlugin: HarnessPlugin = {
  id: 'astrolib.builtin.toc',
  name: '章节大纲目录插件',
  version: '1.2.0',
  description: '提供任意教材的结构化目录大纲提取、统一定位协议支持与候选指引。',
  sourceFile: 'src/plugins/harness/builtin/toc.plugin.ts',
  activate: (context: PluginContext) => {
    context.registerCommand({
      command: '/toc',
      aliases: ['/outline', '/contents'],
      displayName: '章节大纲目录',
      description: '获取指定教材的大纲目录树 (TOC)。支持书名、slug、序号或 astrolib:// 协议定位。',
      usage: '<教材名称/slug/序号/URI>',
      icon: { type: 'mdicon', value: 'toc' },
      suggest: (query, ctx) => {
        const books = ctx.books || [];
        const q = (query || '').trim().toLowerCase();
        const filtered = q
          ? books.filter((b) => b.title.toLowerCase().includes(q) || b.slug.toLowerCase().includes(q))
          : books;

        return filtered.slice(0, 8).map((b, i) => ({
          id: b.slug,
          title: `#${i + 1} 《${b.title}》`,
          subtitle: `[${b.colSlug.toUpperCase()}] ${b.subject || ''} · uri: astrolib://${b.colSlug}/${b.slug}`,
          badge: b.colSlug.toUpperCase(),
          icon: { type: 'mdicon', value: 'toc' },
          fillCommand: `/toc ${b.slug}`,
        }));
      },
      execute: async (args, ctx) => {
        const locator = UniversalLocatorResolver.resolve(args, ctx.books, ctx.chapters as any);

        if (locator.confidence === 'none' || (!locator.bookSlug && (!ctx.books || ctx.books.length === 0))) {
          let candidateChips = '<div class="harness-action-chips" style="margin-top: 8px;">';
          (ctx.books || []).slice(0, 10).forEach((b) => {
            candidateChips += `<div class="harness-action-chip" data-cmd="/toc ${escapeHtml(b.slug)}">《${escapeHtml(b.title)}》</div>`;
          });
          candidateChips += '</div>';

          const reasonText = locator.reason || `未检索到与 "${args}" 匹配的教材。`;

          return {
            toolName: 'get_book_toc',
            command: `/toc ${args}`.trim(),
            success: false,
            summary: reasonText,
            cardHtml: `
              <div style="font-size: 0.9rem; line-height: 1.6; color: var(--harness-text-primary);">
                <strong>${escapeHtml(reasonText)}</strong><br>
                <span style="color: var(--harness-text-secondary); font-size: 0.84rem;">您可以直接点选下方候选教材，或输入 <code>/toc &lt;书名/slug&gt;</code>：</span>
              </div>
              ${candidateChips}
            `,
            contextText: `【目录检索提示】: ${reasonText}`,
          };
        }

        const colSlug = locator.colSlug;
        const bookSlug = locator.bookSlug;
        const bookTitle = locator.bookTitle || bookSlug;

        try {
          const fetcher = ctx.fetchFn || fetch;
          const res = await fetcher(
            `/api/v1/content/books/${encodeURIComponent(colSlug)}/${encodeURIComponent(bookSlug)}/toc`
          );
          const json = await res.json();
          const rawCatalog = json.data?.catalog || [];
          const allChapters = extractAllChapters(rawCatalog);

          let tocListHtml = '<ul class="harness-ast-tree" style="max-height: 460px; overflow-y: auto; padding: 8px 14px; border: 1px solid var(--md-sys-color-outline-variant, var(--harness-border-subtle)); border-radius: 10px; margin-top: 8px;">';
          const contextLines: string[] = [
            `【教材《${bookTitle}》完整大纲目录】(唯一指向源: astrolib://${colSlug}/${bookSlug}):`,
            `包含全书全部章节（共 ${allChapters.length} 节，无截断）：`,
          ];

          for (const item of allChapters) {
            const cleanChapterSlug = (item.slug || '')
              .replace(/^collections\/[^/]+\/[^/]+\//, '')
              .replace(/\.(mdx|md)$/i, '');
            const itemUri = `astrolib://${colSlug}/${bookSlug}/${cleanChapterSlug}`;

            tocListHtml += `<li style="margin: 4px 0;"><a href="javascript:void(0)" class="harness-toc-link" data-uri="${escapeHtml(itemUri)}" data-book="${escapeHtml(bookSlug)}" data-col="${escapeHtml(colSlug)}" data-slug="${escapeHtml(cleanChapterSlug)}">${escapeHtml(item.title || cleanChapterSlug)}</a></li>`;
            contextLines.push(`- ${item.title || cleanChapterSlug} (slug: "${cleanChapterSlug}", uri: "${itemUri}")`);
          }
          tocListHtml += '</ul>';

          return {
            toolName: 'get_book_toc',
            command: `/toc ${bookSlug}`,
            success: true,
            summary: `已解析《${bookTitle}》目录 (${allChapters.length} 章节)`,
            cardHtml: `
              <div style="font-size: 0.9rem; line-height: 1.6; margin: 4px 0;">
                《${escapeHtml(bookTitle)}》目录大纲（共 ${allChapters.length} 节，点击任意章节提取 AST 结构）：
              </div>
              ${tocListHtml}
            `,
            contextText: contextLines.join('\n'),
            artifact: {
              id: `toc:${colSlug}/${bookSlug}`,
              kind: 'markdown',
              title: `《${bookTitle}》· 目录大纲`,
              badge: `${allChapters.length} 章节`,
              html: `<div style="margin-bottom:8px;font-size:0.8rem;color:var(--harness-text-secondary);">URI: <code>astrolib://${escapeHtml(colSlug)}/${escapeHtml(bookSlug)}</code></div>${tocListHtml}`,
            },
            sideEffectTab: 'artifacts',
          };
        } catch (err: any) {
          return {
            toolName: 'get_book_toc',
            command: `/toc ${bookSlug}`,
            success: false,
            summary: `加载目录失败: ${err.message}`,
            cardHtml: `<div class="harness-tool-card"><div class="harness-tool-card__body" style="color: var(--md-sys-color-error, #ef4444);">加载目录失败: ${escapeHtml(err.message)}</div></div>`,
            contextText: `加载《${bookTitle}》目录失败: ${err.message}`,
          };
        }
      },
    });

    context.registerTool({
      name: 'get_book_toc',
      displayName: '提取教材大纲目录',
      category: '知识库检索',
      icon: { type: 'mdicon', value: 'toc' },
      sourceFile: 'src/plugins/harness/builtin/toc.plugin.ts',
      riskLevel: 'read',
      exposeAsSlashCommand: '/toc',
      formatActionLabel: (args) => {
        const target = args.locator || args.bookQuery || args.bookSlug || args.book || '';
        return target ? `读取《${target}》章节目录` : '读取教材章节目录';
      },
      description: '获取指定教材的完整结构化大纲目录树 (TOC) 与规范 URI。对应快捷指令 /toc <book>。',
      parameters: {
        type: 'object',
        properties: {
          locator: {
            type: 'string',
            description: '规范内容定位 URI（例如 "astrolib://math/math_analysis"）或教材 slug/书名',
          },
          bookQuery: {
            type: 'string',
            description: '教材标识、slug（如 "math_analysis", "linear_algebra_geometry"）或书名中文关键词',
          },
        },
        required: [],
      },
      execute: async (args, ctx) => {
        const query = String(args.locator || args.bookQuery || args.bookSlug || args.book || '');
        const locator = UniversalLocatorResolver.resolve(query, ctx.books, ctx.chapters as any);

        if (locator.confidence === 'none' || !locator.bookSlug) {
          return {
            toolName: 'get_book_toc',
            command: `/toc ${query}`,
            success: false,
            summary: locator.reason || '未找到目标教材',
            cardHtml: `<div class="harness-tool-card"><div class="harness-tool-card__body">未找到教材: ${escapeHtml(query)}</div></div>`,
            contextText: `未找到与 "${query}" 匹配的教材。知识库可选教材包括: ${(ctx.books || []).map((b) => b.slug).join(', ')}`,
          };
        }

        const colSlug = locator.colSlug;
        const bookSlug = locator.bookSlug;
        const bookTitle = locator.bookTitle || bookSlug;

        let allChapters: any[] = [];
        try {
          const fetcher = ctx.fetchFn || fetch;
          const res = await fetcher(
            `/api/v1/content/books/${encodeURIComponent(colSlug)}/${encodeURIComponent(bookSlug)}/toc`
          );
          const json = await res.json();
          const rawCatalog = json.data?.catalog || [];
          allChapters = extractAllChapters(rawCatalog);
        } catch {
          allChapters = [];
        }

        const contextLines = [
          `【教材《${bookTitle}》完整目录大纲树】:`,
          `唯一指向源 (Canonical URI): astrolib://${colSlug}/${bookSlug}`,
          `章节总数: ${allChapters.length} 节（全部提供，无截断）`,
          '全书章节清单 (含精准 URI 定位符，可直接传给 get_chapter_ast):',
        ];

        for (const ch of allChapters) {
          const cleanSlug = (ch.slug || '')
            .replace(/^collections\/[^/]+\/[^/]+\//, '')
            .replace(/\.(mdx|md)$/i, '');
          const uri = `astrolib://${colSlug}/${bookSlug}/${cleanSlug}`;
          contextLines.push(`- ${ch.title || cleanSlug} | slug: "${cleanSlug}" | uri: "${uri}"`);
        }

        return {
          toolName: 'get_book_toc',
          command: `/toc ${bookSlug}`,
          success: true,
          summary: `已解析《${bookTitle}》目录 (${allChapters.length} 章节)`,
          cardHtml: `<div class="harness-tool-card"><div class="harness-tool-card__body">已检索《${escapeHtml(bookTitle)}》目录大纲 (${allChapters.length} 章节)。</div></div>`,
          contextText: contextLines.join('\n'),
        };
      },
    });
  },
};
