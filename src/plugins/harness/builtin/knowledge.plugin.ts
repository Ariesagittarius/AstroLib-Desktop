import type { HarnessPlugin, PluginContext } from '../types.ts';

const SOURCE_FILE = 'src/plugins/harness/builtin/knowledge.plugin.ts';

function escapeHtml(str: string): string {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatOutlineLines(nodes: any[], indent = ''): string[] {
  const lines: string[] = [];
  for (const n of nodes) {
    const pageTag = n.pageRange ? ` [${n.pageRange}]` : '';
    lines.push(`${indent}- ${n.title}${pageTag} (sectionId: "${n.id}", uri: "${n.uri}")`);
    if (Array.isArray(n.children) && n.children.length > 0) {
      lines.push(...formatOutlineLines(n.children, indent + '  '));
    }
  }
  return lines;
}

function formatOutlineHtml(nodes: any[]): string {
  if (!nodes || nodes.length === 0) return '';
  return `<ul class="harness-ast-tree">${nodes
    .map(
      (n) =>
        `<li style="margin:4px 0;"><a href="${escapeHtml(n.uri)}" class="astrolib-node-link" data-astrolib-uri="${escapeHtml(n.uri)}">${escapeHtml(n.title)}</a> <code style="font-size:0.74rem;opacity:0.7;">${escapeHtml(n.id)}</code>${n.pageRange ? ` <span style="font-size:0.75rem;color:var(--harness-text-tertiary);">${escapeHtml(n.pageRange)}</span>` : ''}${formatOutlineHtml(n.children || [])}</li>`
    )
    .join('')}</ul>`;
}

export const KnowledgePlugin: HarnessPlugin = {
  id: 'astrolib.builtin.knowledge',
  name: '统一知识库与文献阅读插件',
  version: '1.0.0',
  description:
    '打通内置 MDX 教材、pdf2abp 入库书目、EPUB 电子书与 MinerU 学术文献的统一目录、大纲与全文阅读能力。',
  sourceFile: SOURCE_FILE,
  activate: (context: PluginContext) => {

    context.registerCommand({
      command: '/papers',
      aliases: ['/docs'],
      displayName: '学术文献清单',
      description: '列出并浏览所有通过 MinerU 摄取的 PDF 学术文献与报告。',
      usage: '[关键词]',
      icon: { type: 'mdicon', value: 'article' },
      execute: async (args, ctx) => {
        const fetcher = ctx.fetchFn || fetch;
        const q = (args || '').trim();
        const url = `/api/v1/content/knowledge/items?kind=paper${q ? `&q=${encodeURIComponent(q)}` : ''}`;
        const res = await fetcher(url);
        const json = await res.json();
        const items: any[] = json.data || [];

        const htmlList =
          items.length > 0
            ? `<ul class="harness-ast-tree" style="margin-top:8px;">${items
                .map(
                  (it) =>
                    `<li style="margin:6px 0;"><a href="${escapeHtml(it.uri)}" class="astrolib-node-link" data-astrolib-uri="${escapeHtml(it.uri)}">${escapeHtml(it.title)}</a> <span style="font-size:0.76rem;color:var(--harness-text-tertiary);">(${it.sectionCount} 节 · ${it.pageCount || '?'} 页 · ${it.status})</span></li>`
                )
                .join('')}</ul>`
            : `<div style="font-size:0.86rem;color:var(--harness-text-secondary);">暂无已摄取的学术文献。</div>`;

        return {
          toolName: 'list_library_items',
          command: q ? `/papers ${q}` : '/papers',
          success: true,
          summary: `共检索到 ${items.length} 篇学术文献`,
          cardHtml: `<div style="font-size:0.9rem;">本地学术文献库（共 ${items.length} 篇）：</div>${htmlList}`,
          contextText:
            items.length > 0
              ? items
                  .map(
                    (it, i) =>
                      `${i + 1}. 《${it.title}》 (uri: ${it.uri}, status: ${it.status}, sections: ${it.sectionCount}, pages: ${it.pageCount || '?'})`
                  )
                  .join('\n')
              : '暂无学术文献。',
          artifact: {
            id: 'knowledge:papers',
            kind: 'markdown',
            title: 'AstroLib 学术文献库清单',
            badge: `${items.length} 篇文献`,
            html: htmlList,
          },
          sideEffectTab: 'artifacts',
        };
      },
    });

    context.registerTool({
      name: 'list_library_items',
      displayName: '列举全库书籍与文献',
      category: '知识库检索',
      icon: { type: 'mdicon', value: 'collections_bookmark' },
      sourceFile: SOURCE_FILE,
      riskLevel: 'read',
      formatActionLabel: (args) => {
        const kind = args.kind === 'paper' ? '学术文献' : args.kind === 'book' ? '全库书籍' : '全部知识库资源';
        return `列举${kind}${args.query ? ` · "${args.query}"` : ''}`;
      },
      description:
        '【全库感知主入口】列出 AstroLib 中全部可用内容资源，覆盖四类来源：(1) 内置 MDX 教材、(2) 通过 pdf2abp 导入的书籍（如竞赛教程等）、(3) 导入的 EPUB 电子书（如轻小说/文学/专著）、(4) MinerU 解析的 PDF 学术文献/论文。支持按 kind (all/book/paper)、format (all/mdx/abp/epub/paper) 与关键词筛选。',
      parameters: {
        type: 'object',
        properties: {
          kind: {
            type: 'string',
            enum: ['all', 'book', 'paper'],
            description: '筛选实体类型：all (默认)、book (所有教材/ABP/EPUB)、paper (所有学术文献)',
          },
          format: {
            type: 'string',
            enum: ['all', 'mdx', 'abp', 'epub', 'paper'],
            description: '可选：按数据格式过滤',
          },
          query: {
            type: 'string',
            description: '可选：按标题、作者、描述或标签模糊筛选',
          },
          refresh: {
            type: 'boolean',
            description: '是否强制刷新磁盘扫描缓存（新导入书籍或文献后可传 true）',
          },
        },
        required: [],
      },
      execute: async (args, ctx) => {
        const fetcher = ctx.fetchFn || fetch;
        const params = new URLSearchParams();
        if (args.kind) params.set('kind', String(args.kind));
        if (args.format) params.set('format', String(args.format));
        if (args.query) params.set('q', String(args.query));
        if (args.refresh) params.set('refresh', 'true');

        const res = await fetcher(`/api/v1/content/knowledge/items?${params.toString()}`);
        const json = await res.json();
        if (!json.success) {
          return {
            toolName: 'list_library_items',
            command: 'list_library_items',
            success: false,
            summary: json.error || '读取知识库失败',
            cardHtml: '',
            contextText: json.error || '读取知识库失败',
          };
        }

        const items: any[] = json.data || [];
        const lines = items.map(
          (it, idx) =>
            `${idx + 1}. [${it.kind}/${it.sourceFormat}] 《${it.title}》 | uri: ${it.uri} | 章节/小节: ${it.sectionCount}${it.author ? ` | 作者: ${it.author}` : ''}${it.status !== 'ready' ? ` | 状态: ${it.status}` : ''}`
        );

        return {
          toolName: 'list_library_items',
          command: 'list_library_items',
          success: true,
          summary: `共发现 ${items.length} 项知识库资源`,
          cardHtml: '',
          contextText:
            items.length > 0
              ? `【AstroLib 统一知识库全量目录 (${items.length} 项)】:\n${lines.join('\n')}`
              : '未匹配到符合条件的书籍或学术文献。',
        };
      },
    });

    context.registerTool({
      name: 'get_document_outline',
      displayName: '读取文档结构化大纲',
      category: '知识库检索',
      icon: { type: 'mdicon', value: 'account_tree' },
      sourceFile: SOURCE_FILE,
      riskLevel: 'read',
      formatActionLabel: (args) => {
        const target = String(args.uri || args.query || '').trim();
        return target ? `提取大纲 · ${target}` : '读取文档大纲树';
      },
      description:
        '统一读取任意书籍（MDX / pdf2abp / EPUB）或学术文献（astrolib://paper/<taskId>）的完整目录大纲与各章节 sectionId / URI，便于后续调用 read_document_section 精读正文。',
      parameters: {
        type: 'object',
        properties: {
          uri: {
            type: 'string',
            description:
              '目标文档的规范 URI、taskId、slug 或书名/文献标题（如 "astrolib://paper/task_xxx"、"某暗部的少女共栖"、"cmc_tutorial_nonmath_vol1_2nd"）',
          },
        },
        required: ['uri'],
      },
      execute: async (args, ctx) => {
        const uri = String(args.uri || args.query || '').trim();
        if (!uri) {
          return {
            toolName: 'get_document_outline',
            command: 'get_document_outline',
            success: false,
            summary: '缺少 uri 参数',
            cardHtml: '',
            contextText: '请提供目标书籍或文献的 uri / 书名 / taskId。',
          };
        }

        const fetcher = ctx.fetchFn || fetch;
        const res = await fetcher(
          `/api/v1/content/knowledge/outline?uri=${encodeURIComponent(uri)}`
        );
        const json = await res.json();
        if (!json.success || !json.data) {
          return {
            toolName: 'get_document_outline',
            command: 'get_document_outline',
            success: false,
            summary: json.error || `未找到文档 ${uri}`,
            cardHtml: '',
            contextText: json.error || `未找到文档 ${uri}`,
          };
        }

        const doc = json.data.document;
        const outline = json.data.outline || [];
        const lines = formatOutlineLines(outline);

        return {
          toolName: 'get_document_outline',
          command: 'get_document_outline',
          success: true,
          summary: `已提取《${doc.title}》大纲 (${outline.length} 顶层节)`,
          cardHtml: '',
          contextText: `【文档大纲】《${doc.title}》 (${doc.kind}/${doc.sourceFormat}, uri: ${doc.uri}):\n${lines.join('\n') || '(无独立分节，可直接调用 read_document_section 读取正文)'}`,
          artifact: {
            id: `outline:${doc.uri}`,
            kind: 'markdown',
            title: `大纲 · 《${doc.title}》`,
            badge: `${doc.sourceFormat.toUpperCase()} · ${outline.length} 节`,
            html: `<div style="margin-bottom:8px;font-size:0.8rem;color:var(--harness-text-secondary);">URI: <code>${escapeHtml(doc.uri)}</code></div>${formatOutlineHtml(outline)}`,
          },
        };
      },
    });

    context.registerTool({
      name: 'read_document_section',
      displayName: '精读任意书籍或文献分节正文',
      category: '知识库检索',
      icon: { type: 'mdicon', value: 'menu_book' },
      sourceFile: SOURCE_FILE,
      riskLevel: 'read',
      formatActionLabel: (args) => {
        const sec = args.sectionId ? ` · ${args.sectionId}` : '';
        return `读取正文${sec}`;
      },
      description:
        '【全格式无损正文读取器】支持分页读取 MDX 教材、pdf2abp 书籍、EPUB 电子书和 MinerU 学术文献任意章节/小节的完整原文、数学公式及插图路径（无 140 字截断）。若章节较长可用 offset/limit 分块翻页。',
      parameters: {
        type: 'object',
        properties: {
          uri: {
            type: 'string',
            description:
              '文档或章节 URI / taskId / 书名（例如 "astrolib://paper/task_xxx" 或 "astrolib://acg/.../008_p-001"）',
          },
          sectionId: {
            type: 'string',
            description: '可选：具体章节 slug 或文献 sectionId（如 "sec-2"）；留空默认读首页或入口节',
          },
          offset: {
            type: 'number',
            description: '块起始偏移（默认 0）',
          },
          limit: {
            type: 'number',
            description: '单次读取语义块数上限（默认 60，最大 200）',
          },
          includeMarkdown: {
            type: 'boolean',
            description: '若为文献或 MDX，是否额外附带原始 Markdown',
          },
        },
        required: ['uri'],
      },
      execute: async (args, ctx) => {
        const uri = String(args.uri || '').trim();
        if (!uri) {
          return {
            toolName: 'read_document_section',
            command: 'read_document_section',
            success: false,
            summary: '缺少 uri 参数',
            cardHtml: '',
            contextText: '请提供目标文档或章节的 uri。',
          };
        }

        const fetcher = ctx.fetchFn || fetch;
        const qs = new URLSearchParams({ uri });
        if (args.sectionId) qs.set('sectionId', String(args.sectionId));
        if (args.offset !== undefined) qs.set('offset', String(args.offset));
        if (args.limit !== undefined) qs.set('limit', String(args.limit));
        if (args.includeMarkdown) qs.set('markdown', 'true');

        const res = await fetcher(`/api/v1/content/knowledge/section?${qs.toString()}`);
        const json = await res.json();
        if (!json.success || !json.data) {
          return {
            toolName: 'read_document_section',
            command: 'read_document_section',
            success: false,
            summary: json.error || '读取分节失败',
            cardHtml: '',
            contextText: json.error || '读取分节失败',
          };
        }

        const sec = json.data;
        const imgNotes =
          Array.isArray(sec.images) && sec.images.length > 0
            ? `\n\n【本节插图 (${sec.images.length} 张)】:\n` +
              sec.images
                .map(
                  (im: any, i: number) =>
                    `${i + 1}. ${im.alt}: ${im.url}${im.localPath ? ` (localPath: ${im.localPath})` : ''}`
                )
                .join('\n')
            : '';

        const navHint = [
          sec.prevSectionId ? `上一节: ${sec.prevSectionId}` : '',
          sec.nextSectionId ? `下一节: ${sec.nextSectionId}` : '',
          sec.hasMore ? `本节还有更多内容，可传 offset=${sec.offset + sec.blocks.length}` : '',
        ]
          .filter(Boolean)
          .join(' | ');

        const bodyText = sec.markdown || sec.plainText || '(本节无纯文本内容)';

        return {
          toolName: 'read_document_section',
          command: 'read_document_section',
          success: true,
          summary: `已读取《${sec.docTitle}》· ${sec.sectionTitle} (${sec.blocks.length}/${sec.totalBlocks} 块)`,
          cardHtml: '',
          contextText: `【${sec.kind}/${sec.sourceFormat} 正文】《${sec.docTitle}》 - ${sec.sectionTitle} (${sec.uri}${sec.pageRange ? `, ${sec.pageRange}` : ''})\n块范围: ${sec.offset}..${sec.offset + sec.blocks.length} / 共 ${sec.totalBlocks} 块${navHint ? `\n导航: ${navHint}` : ''}\n\n${bodyText}${imgNotes}`,
        };
      },
    });
  },
};
