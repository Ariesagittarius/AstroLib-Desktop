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

async function fetchOrQueryOverview(ctx: any, colSlug: string, bookSlug: string) {
  if (typeof window !== 'undefined') {
    const fetchImpl = ctx.fetchFn || fetch;
    const res = await fetchImpl(
      `/api/v1/content/annotations/books/${encodeURIComponent(colSlug)}/${encodeURIComponent(bookSlug)}`
    );
    const json = await res.json();
    if (json?.data) return json.data;
    throw new Error(json?.error || 'Failed to load annotations overview');
  }
  const service = await loadContentApiService();
  return service.getBookAnnotationsOverview(colSlug, bookSlug);
}

async function fetchOrQueryChapterAnnotations(ctx: any, colSlug: string, bookSlug: string, chapterSlug: string) {
  if (typeof window !== 'undefined') {
    const fetchImpl = ctx.fetchFn || fetch;
    const res = await fetchImpl(
      `/api/v1/content/annotations/books/${encodeURIComponent(colSlug)}/${encodeURIComponent(bookSlug)}/chapters/${encodeURIComponent(chapterSlug)}?withAst=true`
    );
    const json = await res.json();
    if (json?.data) return json.data;
    throw new Error(json?.error || 'Failed to load chapter annotations');
  }
  const service = await loadContentApiService();
  return service.getChapterAnnotationsWithAst(colSlug, bookSlug, chapterSlug);
}

async function fetchOrSearchAnnotations(ctx: any, query: string, colSlug?: string, bookSlug?: string, limit = 20) {
  if (typeof window !== 'undefined') {
    const fetchImpl = ctx.fetchFn || fetch;
    const qs = new URLSearchParams({ q: query, limit: String(limit) });
    if (colSlug) qs.set('col', colSlug);
    if (bookSlug) qs.set('book', bookSlug);
    const res = await fetchImpl(`/api/v1/content/annotations/search?${qs.toString()}`);
    const json = await res.json();
    if (Array.isArray(json?.data)) return json.data;
    return [];
  }
  const service = await loadContentApiService();
  return service.searchAnnotations(query, { colSlug, bookSlug, limit });
}

function formatChapterAnnotationsContext(res: any): string {
  const lines: string[] = [
    `【章节《${res.chapterTitle}》用户批注与 AST 外接报告 (${res.chapterUri})】:`,
    `统计: 高亮 ${res.summary?.highlightsCount || 0} 条 | 学术侧注 ${res.summary?.sidenotesCount || 0} 条 | 数位板笔迹 ${res.summary?.inkStrokesCount || 0} 笔 | 自由画布卡片 ${res.summary?.canvasBlocksCount || 0} 块 | 画布手写 ${res.summary?.canvasInkStrokesCount || 0} 笔`,
  ];

  if (Array.isArray(res.enrichedAnnotations) && res.enrichedAnnotations.length > 0) {
    lines.push('\n一、正文外接批注列表:');
    res.enrichedAnnotations.forEach((entry: any, i: number) => {
      const ann = entry.annotation;
      const ast = entry.astNode;
      const nodeLabel = ast ? `[${ast.type}] ${ast.title || ast.summary}` : ann.anchor?.nodeId;
      if (ann.kind === 'highlight') {
        lines.push(
          `${i + 1}. [高亮 ${ann.color}] 锚点: ${ann.anchor.uri} (${nodeLabel})\n   原文选段: "${ann.anchor.quote?.exact || ''}"${ann.note ? `\n   附注: ${ann.note}` : ''}`
        );
      } else if (ann.kind === 'sidenote') {
        lines.push(
          `${i + 1}. [学术侧注] 锚点: ${ann.anchor.uri} (${nodeLabel})\n   引用原文: "${ann.anchor.quote?.exact || ''}"\n   侧注内容 (Markdown/LaTeX): ${ann.markdown}`
        );
      } else if (ann.kind === 'ink') {
        lines.push(
          `${i + 1}. [数位板手写 ${ann.anchorMode}] 锚点: ${ann.anchor.uri} (${nodeLabel}) · ${ann.tool} (${ann.points?.length || 0} 采样点)`
        );
      }
    });
  } else {
    lines.push('\n当前章节暂无正文高亮、侧注或手写批注。');
  }

  if (Array.isArray(res.enrichedCanvasBlocks) && res.enrichedCanvasBlocks.length > 0) {
    lines.push('\n二、章节自由画布笔记卡片:');
    res.enrichedCanvasBlocks.forEach((entry: any, i: number) => {
      const b = entry.block;
      const astHint = entry.astNode ? ` (关联节点: ${entry.astNode.uri} · ${entry.astNode.summary})` : '';
      lines.push(`${i + 1}. [${b.kind}]${astHint}\n   ${b.markdown}`);
    });
  }

  return lines.join('\n');
}

export const AnnotationsPlugin: HarnessPlugin = {
  id: 'astrolib.builtin.annotations',
  name: '批注与自由画布只读感知插件',
  version: '1.1.0',
  description: '只读访问整书及章节维度的段落高亮、Markdown/LaTeX 侧注、手写锚点与章节自由画布笔记。',
  sourceFile: 'src/plugins/harness/builtin/annotations.plugin.ts',
  activate: (context: PluginContext) => {
    context.registerCommand({
      command: '/notes',
      aliases: ['/annotations', '/book-notes'],
      displayName: '批注与笔记感知',
      description: '查看指定教材或章节的批注概览、高亮/侧注、数位板手写分布及自由画布笔记。',
      usage: '<图书/章节/URI>',
      icon: { type: 'mdicon', value: 'sticky_note_2' },
      suggest: (_query, ctx) => {
        return (ctx.books || []).slice(0, 6).map((b) => ({
          id: `notes-${b.slug}`,
          title: `/notes ${b.slug}`,
          subtitle: `查看《${b.title}》整书批注态势`,
          badge: 'NOTES',
          icon: { type: 'mdicon', value: 'sticky_note_2' },
          fillCommand: `/notes ${b.slug}`,
        }));
      },
      execute: async (args, ctx) => {
        const raw = (args || '').trim();
        const locator = UniversalLocatorResolver.resolve(raw || 'math_analysis', ctx.books, ctx.chapters as any);
        if (locator.confidence === 'none' || !locator.bookSlug) {
          return {
            toolName: 'get_book_annotations_overview',
            command: `/notes ${raw}`.trim(),
            success: false,
            summary: `未能定位目标教材或章节: ${raw}`,
            cardHtml: `<div class="harness-tool-card"><div class="harness-tool-card__body">请指定有效的教材或章节标识，例如 <code>/notes math_analysis</code></div></div>`,
            contextText: `未定位到教材或章节: ${raw}`,
          };
        }

        if (!locator.isBookLevel && locator.chapterSlug) {
          const data = await fetchOrQueryChapterAnnotations(ctx, locator.colSlug, locator.bookSlug, locator.chapterSlug);
          const ctxText = formatChapterAnnotationsContext(data);
          return {
            toolName: 'get_chapter_annotations',
            command: `/notes ${locator.chapterSlug}`,
            success: true,
            summary: `已加载《${data.chapterTitle}》批注 (${data.enrichedAnnotations.length} 条批注 / ${data.enrichedCanvasBlocks.length} 块画布)`,
            cardHtml: `<div style="font-size:0.9rem;line-height:1.6;">章节 <strong>《${escapeHtml(data.chapterTitle)}》</strong>：高亮 ${data.summary.highlightsCount} · 侧注 ${data.summary.sidenotesCount} · 手写 ${data.summary.inkStrokesCount} · 画布卡片 ${data.summary.canvasBlocksCount}</div>`,
            contextText: ctxText,
            artifact: {
              id: `notes:${locator.colSlug}/${locator.bookSlug}/${locator.chapterSlug}`,
              kind: 'markdown',
              title: `${data.chapterTitle} · 批注视图`,
              badge: `${data.enrichedAnnotations.length} 批注`,
              html: `<pre style="white-space: pre-wrap; font-size: 0.84rem; line-height: 1.6;">${escapeHtml(ctxText)}</pre>`,
            },
            sideEffectTab: 'artifacts',
          };
        }

        const overview = await fetchOrQueryOverview(ctx, locator.colSlug, locator.bookSlug);
        const lines = [
          `【整书批注全景《${overview.bookTitle}》 (${overview.bookUri})】:`,
          `已批注章节: ${overview.totalAnnotatedChapters} | 高亮: ${overview.highlightsCount} | 侧注: ${overview.sidenotesCount} | 手写: ${overview.inkStrokesCount} | 画布卡片: ${overview.canvasBlocksCount}`,
          ...overview.chapters.map(
            (c: any) =>
              `- [${c.chapterTitle || c.chapterSlug}](${c.uri}): 高亮 ${c.highlightsCount} / 侧注 ${c.sidenotesCount} / 手写 ${c.inkStrokesCount} / 画布 ${c.canvasBlocksCount}`
          ),
        ];

        return {
          toolName: 'get_book_annotations_overview',
          command: `/notes ${locator.bookSlug}`,
          success: true,
          summary: `已汇总《${overview.bookTitle}》批注分布 (${overview.totalAnnotatedChapters} 章含批注)`,
          cardHtml: `<div style="font-size:0.9rem;line-height:1.6;">教材 <strong>《${escapeHtml(overview.bookTitle)}》</strong>：活跃章节 ${overview.totalAnnotatedChapters} · 高亮 ${overview.highlightsCount} · 侧注 ${overview.sidenotesCount} · 手写 ${overview.inkStrokesCount} · 画布 ${overview.canvasBlocksCount}</div>`,
          contextText: lines.join('\n'),
          artifact: {
            id: `notes:${locator.colSlug}/${locator.bookSlug}`,
            kind: 'markdown',
            title: `${overview.bookTitle} · 批注概览`,
            badge: `${overview.totalAnnotatedChapters} 章节`,
            html: `<pre style="white-space: pre-wrap; font-size: 0.84rem; line-height: 1.6;">${escapeHtml(lines.join('\n'))}</pre>`,
          },
          sideEffectTab: 'artifacts',
        };
      },
    });

    context.registerTool({
      name: 'get_book_annotations_overview',
      displayName: '查看整书批注概览',
      category: '批注与笔记',
      icon: { type: 'mdicon', value: 'sticky_note_2' },
      sourceFile: 'src/plugins/harness/builtin/annotations.plugin.ts',
      riskLevel: 'read',
      exposeAsSlashCommand: '/notes',
      formatActionLabel: (args) => {
        const target = args.locator || args.bookSlug || '';
        return target ? `读取批注概览 · ${target}` : '读取整书批注概览';
      },
      description: '【只读】获取指定教材的整体用户批注情况，包括各章节的高亮、侧注、手写笔迹、自由画布卡片统计。',
      parameters: {
        type: 'object',
        properties: {
          locator: { type: 'string', description: '规范 URI 或教材名称，如 "astrolib://math/math_analysis" 或 "数学分析"' },
          colSlug: { type: 'string', description: '学科合集 slug' },
          bookSlug: { type: 'string', description: '图书 slug' },
        },
        required: [],
      },
      execute: async (args, ctx) => {
        const q = String(args.locator || args.bookSlug || '');
        const loc = UniversalLocatorResolver.resolve(q, ctx.books, ctx.chapters as any);
        const col = String(args.colSlug || loc.colSlug || 'math');
        const book = String(args.bookSlug || loc.bookSlug || 'math_analysis');
        const overview = await fetchOrQueryOverview(ctx, col, book);
        const text = [
          `【《${overview.bookTitle}》整书批注概览 (${overview.bookUri})】`,
          `已批注章节数: ${overview.totalAnnotatedChapters} | 总正文批注: ${overview.totalAnnotations} (高亮 ${overview.highlightsCount}, 侧注 ${overview.sidenotesCount}, 手写 ${overview.inkStrokesCount}) | 画布卡片: ${overview.canvasBlocksCount}`,
          overview.chapters.length > 0
            ? '章节分布:\n' +
              overview.chapters
                .map(
                  (c: any) =>
                    `  - ${c.chapterSlug} (${c.uri}): 高亮 ${c.highlightsCount}, 侧注 ${c.sidenotesCount}, 手写 ${c.inkStrokesCount}, 画布卡片 ${c.canvasBlocksCount}`
                )
                .join('\n')
            : '当前该书尚无用户批注。',
        ].join('\n');

        return {
          toolName: 'get_book_annotations_overview',
          command: `/notes ${book}`,
          success: true,
          summary: `已读取《${overview.bookTitle}》批注概览 (${overview.totalAnnotatedChapters} 章有批注)`,
          cardHtml: `<div class="harness-tool-card"><div class="harness-tool-card__body">已读取《${escapeHtml(overview.bookTitle)}》批注概览。</div></div>`,
          contextText: text,
        };
      },
    });

    context.registerTool({
      name: 'get_chapter_annotations',
      displayName: '读取章节批注与画布',
      category: '批注与笔记',
      icon: { type: 'mdicon', value: 'edit_note' },
      sourceFile: 'src/plugins/harness/builtin/annotations.plugin.ts',
      riskLevel: 'read',
      formatActionLabel: (args) => {
        const target = args.locator || args.chapterSlug || '';
        return target ? `读取章节批注 · ${target}` : '读取章节批注与画布';
      },
      description: '【只读】读取指定章节的用户全部批注（段落高亮、Markdown/LaTeX 侧注、手写批注、章节自由画布笔记）以及外接 AST 节点摘要。',
      parameters: {
        type: 'object',
        properties: {
          locator: { type: 'string', description: '规范章节 URI，如 "astrolib://math/math_analysis/62_高阶导数及其他求导法则"' },
          colSlug: { type: 'string', description: '学科合集 slug' },
          bookSlug: { type: 'string', description: '图书 slug' },
          chapterSlug: { type: 'string', description: '章节 slug' },
        },
        required: [],
      },
      execute: async (args, ctx) => {
        const q = String(
          args.locator || (args.bookSlug && args.chapterSlug ? `${args.bookSlug} ${args.chapterSlug}` : args.chapterSlug || '')
        );
        const loc = UniversalLocatorResolver.resolve(q, ctx.books, ctx.chapters as any);
        const col = String(args.colSlug || loc.colSlug || 'math');
        const book = String(args.bookSlug || loc.bookSlug || 'math_analysis');
        const chapter = String(args.chapterSlug || loc.chapterSlug || '01_内容简介');

        const data = await fetchOrQueryChapterAnnotations(ctx, col, book, chapter);
        const contextText = formatChapterAnnotationsContext(data);

        return {
          toolName: 'get_chapter_annotations',
          command: `/notes ${chapter}`,
          success: true,
          summary: `已读取《${data.chapterTitle}》批注 (${data.enrichedAnnotations.length} 条)`,
          cardHtml: `<div class="harness-tool-card"><div class="harness-tool-card__body">已读取章节《${escapeHtml(data.chapterTitle)}》的批注与自由画布。</div></div>`,
          contextText,
        };
      },
    });

    context.registerTool({
      name: 'search_user_annotations',
      displayName: '搜索用户批注',
      category: '批注与笔记',
      icon: { type: 'mdicon', value: 'search' },
      sourceFile: 'src/plugins/harness/builtin/annotations.plugin.ts',
      riskLevel: 'read',
      formatActionLabel: (args) => {
        const q = String(args.query || '').trim();
        return q ? `搜索批注 · "${q}"` : '搜索用户批注';
      },
      description: '【只读】根据关键词或标签在整库或指定教材中检索用户的高亮句段、侧注笔记与章节画布卡片。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '检索关键词或标签' },
          colSlug: { type: 'string', description: '可选合集 slug' },
          bookSlug: { type: 'string', description: '可选图书 slug' },
          limit: { type: 'number', description: '最多返回条数 (默认 20)' },
        },
        required: ['query'],
      },
      execute: async (args, ctx) => {
        const query = String(args.query || '');
        const hits = await fetchOrSearchAnnotations(
          ctx,
          query,
          args.colSlug ? String(args.colSlug) : undefined,
          args.bookSlug ? String(args.bookSlug) : undefined,
          typeof args.limit === 'number' ? args.limit : 20
        );
        const lines = hits.length
          ? hits.map(
              (h: any, idx: number) =>
                `${idx + 1}. [${h.hitType}] ${h.uri}\n   匹配片段: ${h.matchedText}${h.noteText ? `\n   笔记: ${h.noteText}` : ''}`
            )
          : [`未检索到包含 "${query}" 的用户批注或画布笔记。`];

        return {
          toolName: 'search_user_annotations',
          command: `/notes ${query}`,
          success: true,
          summary: `命中 ${hits.length} 条批注`,
          cardHtml: `<div class="harness-tool-card"><div class="harness-tool-card__body">检索 "${escapeHtml(query)}" 命中 ${hits.length} 条批注。</div></div>`,
          contextText: lines.join('\n'),
        };
      },
    });
  },
};
