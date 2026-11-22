/**
 * src/plugins/harness/builtin/books.plugin.ts
 * ============================================================================
 * AstroLib 教材库总览插件 (/books)
 * ============================================================================
 */

import type { HarnessPlugin, PluginContext } from '../types.ts';

function escapeHtml(str: string): string {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const BooksPlugin: HarnessPlugin = {
  id: 'astrolib.builtin.books',
  name: '教材全库清单插件',
  version: '1.2.0',
  description: '提供知识库全量教材目录检索、卡片卡槽呈现与元数据导出能力。',
  sourceFile: 'src/plugins/harness/builtin/books.plugin.ts',
  activate: (context: PluginContext) => {
    context.registerCommand({
      command: '/books',
      aliases: ['/catalog', '/library'],
      displayName: '教材全库清单',
      description: '浏览与检索知识库全部教材的元数据与大纲入口。',
      usage: '',
      icon: { type: 'mdicon', value: 'library_books' },
      suggest: (_query, ctx) => {
        return (ctx.books || []).map((b, i) => ({
          id: b.slug,
          title: `#${i + 1} 《${b.title}》`,
          subtitle: `[${b.colSlug.toUpperCase()}] ${b.subject || ''} · ${b.slug}`,
          badge: b.colSlug.toUpperCase(),
          icon: { type: 'mdicon', value: 'menu_book' },
          fillCommand: `/toc ${b.slug}`,
        }));
      },
      execute: async (_args, ctx) => {
        let list = ctx.books;
        if (!list || list.length === 0) {
          try {
            const fetcher = ctx.fetchFn || fetch;
            const res = await fetcher('/api/v1/content/books');
            const json = await res.json();
            list = json.data || [];
          } catch {}
        }

        let booksHtml = '<div class="harness-book-grid">';
        const contextLines: string[] = ['【AstroLib 本地教材库全景清单】:'];

        list.forEach((b, idx) => {
          contextLines.push(
            `${idx + 1}. 《${b.title}》 (${b.colSlug}/${b.slug}) - 分类: ${b.subject || b.category || '理工教材'}`
          );
          booksHtml += `
            <div class="harness-book-card">
              <div class="harness-book-card__header">
                <div class="harness-book-card__title">#${idx + 1} ${escapeHtml(b.title)}</div>
                <span class="harness-book-card__badge">${escapeHtml(b.colSlug.toUpperCase())}</span>
              </div>
              <div class="harness-book-card__meta">
                <span><strong>分类:</strong> ${escapeHtml(b.subject || b.category || '理工教材')}</span>
                <span><strong>标识:</strong> <code>${escapeHtml(b.slug)}</code></span>
              </div>
              <div class="harness-book-card__actions">
                <button type="button" class="harness-card-btn" data-action="load-toc" data-col="${escapeHtml(b.colSlug)}" data-book="${escapeHtml(b.slug)}">查看目录 (/toc)</button>
                <a href="astrolib://${escapeHtml(b.colSlug)}/${escapeHtml(b.slug)}" class="harness-card-btn harness-card-btn--primary astrolib-node-link" style="text-decoration: none;">直接阅读</a>
              </div>
            </div>
          `;
        });
        booksHtml += '</div>';

        return {
          toolName: 'get_books_catalog',
          command: '/books',
          success: true,
          summary: `已加载全库 ${list.length} 本教材元数据`,
          cardHtml: `
            <div style="font-size: 0.9rem; line-height: 1.6; margin: 4px 0 8px;">
              知识库当前共收录 ${list.length} 本教材。您可以点击 <strong>查看目录</strong> 或键入 <code>/toc &lt;序号/书名&gt;</code> 展开大纲：
            </div>
            ${booksHtml}
          `,
          contextText: contextLines.join('\n'),
          artifact: {
            id: 'books-catalog',
            kind: 'markdown',
            title: 'AstroLib 结构化图书清单',
            badge: `全部 ${list.length} 本教材`,
            html: `<ul style="padding-left: 20px; line-height: 1.8;">${list.map((b, i) => `<li><strong>#${i + 1} ${escapeHtml(b.title)}</strong> (<code>${escapeHtml(b.colSlug)}/${escapeHtml(b.slug)}</code>) - ${escapeHtml(b.subject || '')}</li>`).join('')}</ul>`,
          },
          sideEffectTab: 'artifacts',
        };
      },
    });

    context.registerTool({
      name: 'get_books_catalog',
      displayName: '获取教材目录清单',
      category: '知识库检索',
      icon: { type: 'mdicon', value: 'library_books' },
      sourceFile: 'src/plugins/harness/builtin/books.plugin.ts',
      riskLevel: 'read',
      exposeAsSlashCommand: '/books',
      formatActionLabel: () => '加载全部教材目录清单',
      description: '获取 AstroLib 知识库全部教材与电子书列表（含内置教材、pdf2abp 入库教材、EPUB 电子书的元数据与 slug）。如需同时查看 PDF 学术文献请调用 list_library_items。对应用户指令 /books。',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      execute: async (_args, ctx) => {
        let list = ctx.books;
        const fetcher = ctx.fetchFn || fetch;
        try {
          const res = await fetcher('/api/v1/content/books');
          const json = await res.json();
          if (Array.isArray(json.data) && json.data.length > 0) {
            list = json.data;
          }
        } catch {}
        let paperCount = 0;
        try {
          const pRes = await fetcher('/api/v1/content/knowledge/items?kind=paper');
          const pJson = await pRes.json();
          if (Array.isArray(pJson.data)) paperCount = pJson.data.length;
        } catch {}
        return {
          toolName: 'get_books_catalog',
          command: '/books',
          success: true,
          summary: `已加载全库 ${list.length} 本书籍${paperCount > 0 ? `（另有 ${paperCount} 篇学术文献）` : ''}`,
          cardHtml: `<div class="harness-tool-card"><div class="harness-tool-card__body">已检索全部 ${list.length} 本书籍元数据。</div></div>`,
          contextText:
            list
              .map(
                (b: any, i: number) =>
                  `${i + 1}. 《${b.title}》 (${b.colSlug}/${b.slug}${b.sourceFormat ? `, ${b.sourceFormat}` : ''})`
              )
              .join('\n') +
            (paperCount > 0
              ? `\n\n[提示] 知识库还收录了 ${paperCount} 篇 MinerU 学术文献，可调用 list_library_items(kind="paper") 浏览全部文献。`
              : ''),
        };
      },
    });
  },
};
