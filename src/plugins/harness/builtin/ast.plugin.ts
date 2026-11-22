/**
 * src/plugins/harness/builtin/ast.plugin.ts
 * ============================================================================
 * AstroLib 章节 AST 与学术卡片插件 (/ast & /cards) - 统一协议与 M3 极简学术规范
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

function renderAstTreeToContextText(nodes: any[], indent = '', maxDepth = 4): string[] {
  const lines: string[] = [];
  for (const node of nodes) {
    let lineStr = '';
    const idStr = `(id: "${node.id}", 行 ${node.lineStart}-${node.lineEnd})`;
    switch (node.type) {
      case 'heading':
        lineStr = `${indent}- [H${node.level} 标题] ${node.title} ${idStr}`;
        break;
      case 'card':
        lineStr = `${indent}- [${node.tag || 'Card'} 模块] ${node.title || ''} ${idStr} - ${node.summary || ''}`;
        break;
      case 'math_block':
        lineStr = `${indent}- [独立公式] ${idStr}: $$ ${node.latex ? node.latex.slice(0, 90).replace(/\s+/g, ' ') : ''} $$`;
        break;
      case 'paragraph':
        lineStr = `${indent}- [正文段落] ${idStr}: ${node.preview?.slice(0, 80).replace(/\s+/g, ' ')}...`;
        break;
      case 'exercise':
        lineStr = `${indent}- [习题模块] ${node.title || '练习题'} ${idStr}`;
        break;
      case 'code_block':
        lineStr = `${indent}- [代码块] ${idStr}: ${node.summary || ''}`;
        break;
      case 'list':
        lineStr = `${indent}- [列表清单] ${idStr}: ${node.summary || ''}`;
        break;
      case 'table':
        lineStr = `${indent}- [数据表格] ${idStr}: ${node.summary || ''}`;
        break;
      default:
        lineStr = `${indent}- [${node.type}] ${idStr}: ${node.summary || ''}`;
        break;
    }
    lines.push(lineStr);

    if (node.children && node.children.length > 0 && indent.length / 2 < maxDepth) {
      lines.push(...renderAstTreeToContextText(node.children, indent + '  ', maxDepth));
    }
  }
  return lines;
}

/**
 * 清理行内截断可能导致的未闭合 TeX 定界符，确保 KaTeX 渲染不出错
 */
function sanitizePreviewText(raw: string, maxLen = 100): string {
  const s = (raw || '').replace(/\s+/g, ' ').trim();
  if (s.length <= maxLen) return s;
  const sliced = s.slice(0, maxLen);
  const dollarCount = (sliced.match(/(?<!\\)\$/g) || []).length;
  if (dollarCount % 2 === 1) {
    const lastDollar = sliced.lastIndexOf('$');
    if (lastDollar > 8) {
      return sliced.slice(0, lastDollar).trim() + ' …';
    }
    return sliced + '$ …';
  }
  return sliced + '…';
}

/**
 * 极简学术风格的层次化 AST 树视图 (无彩虹标签，遵守 Material You 单色层次与语义留白)
 */
function renderAstTreeToHtml(nodes: any[], depth = 0): string {
  const listClass = depth === 0 ? 'harness-ast-tree harness-ast-tree--root' : 'harness-ast-tree';
  let html = `<ul class="${listClass}">`;

  for (const node of nodes) {
    let typeLabel = node.type;
    let roleTone = 'neutral';
    if (node.type === 'heading') {
      typeLabel = `H${node.level}`;
      roleTone = 'heading';
    } else if (node.type === 'card') {
      typeLabel = node.tag || '模块';
      roleTone = 'card';
    } else if (node.type === 'math_block') {
      typeLabel = '公式';
      roleTone = 'math';
    } else if (node.type === 'paragraph') {
      typeLabel = '段落';
      roleTone = 'neutral';
    } else if (node.type === 'exercise') {
      typeLabel = '习题';
      roleTone = 'card';
    } else if (node.type === 'code_block') {
      typeLabel = '代码';
    } else if (node.type === 'table') {
      typeLabel = '表格';
    }

    const titleText = node.title
      ? node.title
      : node.latex
        ? `$$${node.latex}$$`
        : sanitizePreviewText(node.preview || node.summary || '', 110);

    const hasChildren = Array.isArray(node.children) && node.children.length > 0;
    const nodeRow = `
      <div class="harness-ast-row">
        <span class="harness-ast-tag is-${roleTone}">${escapeHtml(typeLabel)}</span>
        <span class="harness-ast-label">${escapeHtml(titleText)}</span>
        <span class="harness-ast-meta">L${node.lineStart}-${node.lineEnd}</span>
        <button type="button" class="harness-ast-read-btn harness-action-chip" data-cmd="/read ${escapeHtml(node.id)}" title="读取节点 ${escapeHtml(node.id)} 原文">精读</button>
      </div>
    `;

    if (hasChildren && depth < 2) {
      html += `
        <li class="harness-ast-node">
          <details open class="harness-ast-details">
            <summary class="harness-ast-summary">${nodeRow}</summary>
            ${renderAstTreeToHtml(node.children, depth + 1)}
          </details>
        </li>
      `;
    } else {
      html += `<li class="harness-ast-node">${nodeRow}${hasChildren ? renderAstTreeToHtml(node.children, depth + 1) : ''}</li>`;
    }
  }
  html += '</ul>';
  return html;
}

export const AstPlugin: HarnessPlugin = {
  id: 'astrolib.builtin.ast',
  name: '章节卡片与AST语义插件',
  version: '1.2.0',
  description: '提取指定章节的语义大纲、学术卡片（定理/定义/例题/题解）与 KaTeX 数学公式树。',
  sourceFile: 'src/plugins/harness/builtin/ast.plugin.ts',
  activate: (context: PluginContext) => {
    context.registerCommand({
      command: '/ast',
      aliases: ['/cards', '/chapter'],
      displayName: '章节卡片与AST',
      description: '提取指定章节的语义 AST、大纲、学术卡片与公式树。支持全局跨书定位与 astrolib:// 协议。',
      usage: '<[可选图书] 章节slug/名称/URI>',
      icon: { type: 'mdicon', value: 'account_tree' },
      suggest: (query, ctx) => {
        const chapters = (ctx.chapters as any[]) || [];
        const q = (query || '').trim().toLowerCase();

        let list: any[] = [];
        if (chapters.length > 0) {
          list = q
            ? chapters.filter((c) => c.chapterSlug.toLowerCase().includes(q) || c.chapterTitle.toLowerCase().includes(q))
            : chapters;
        } else {
          const defaultChapters = [
            { chapterSlug: '06_第1章-三角函数', chapterTitle: '第1章 三角函数', bookTitle: '新高考数学你真的掌握了吗' },
            { chapterSlug: '21_数列极限的基本概念', chapterTitle: '§2.1 数列极限的基本概念', bookTitle: '数学分析' },
            { chapterSlug: '11_二三阶行列式', chapterTitle: '1.1 二、三阶行列式', bookTitle: '线性代数与几何' },
            { chapterSlug: '12_n阶行列式', chapterTitle: '1.2 n阶行列式', bookTitle: '线性代数与几何' },
          ];
          list = q
            ? defaultChapters.filter((c) => c.chapterSlug.toLowerCase().includes(q) || c.chapterTitle.toLowerCase().includes(q))
            : defaultChapters;
        }

        return list.slice(0, 8).map((c) => ({
          id: c.chapterSlug,
          title: c.chapterTitle || c.chapterSlug,
          subtitle: `《${c.bookTitle || ''}》 · ${c.chapterSlug}`,
          badge: 'AST',
          icon: { type: 'mdicon', value: 'account_tree' },
          fillCommand: `/ast ${c.chapterSlug}`,
        }));
      },
      execute: async (args, ctx) => {
        const locator = UniversalLocatorResolver.resolve(args, ctx.books, ctx.chapters as any);

        if (locator.isBookLevel && locator.bookSlug) {
          return {
            toolName: 'get_chapter_ast',
            command: `/ast ${args}`.trim(),
            success: false,
            summary: `已定位到《${locator.bookTitle}》，需要指定具体章节`,
            cardHtml: `
              <div style="font-size: 0.9rem; line-height: 1.6;">
                您输入的是教材 <strong>《${escapeHtml(locator.bookTitle || locator.bookSlug)}》</strong>。<br>
                请先输入 <code>/toc ${escapeHtml(locator.bookSlug)}</code> 查看目录大纲并选取具体章节。
              </div>
            `,
            contextText: `请先查看《${locator.bookTitle}》目录并指定章节 slug。`,
          };
        }

        if (locator.confidence === 'none' || !locator.chapterSlug) {
          let candidateChips = '';
          if (locator.candidates && locator.candidates.length > 0) {
            candidateChips = '<div class="harness-action-chips" style="margin-top: 8px;">';
            locator.candidates.slice(0, 6).forEach((c) => {
              candidateChips += `<div class="harness-action-chip" data-cmd="/ast ${escapeHtml(c.uri)}">《${escapeHtml(c.bookTitle || '')}》${escapeHtml(c.chapterTitle || c.chapterSlug || '')}</div>`;
            });
            candidateChips += '</div>';
          }

          const reasonText = locator.reason || `未能定位章节 "${args}"，请检查名称或使用 /toc 查看目录。`;

          return {
            toolName: 'get_chapter_ast',
            command: `/ast ${args}`.trim(),
            success: false,
            summary: reasonText,
            cardHtml: `
              <div style="font-size: 0.9rem; line-height: 1.6;">
                ${escapeHtml(reasonText)}
              </div>
              ${candidateChips}
            `,
            contextText: reasonText,
          };
        }

        const colSlug = locator.colSlug;
        const bookSlug = locator.bookSlug;
        const chapterSlug = locator.chapterSlug;
        const bookTitle = locator.bookTitle || bookSlug;

        try {
          const fetcher = ctx.fetchFn || fetch;
          const res = await fetcher(
            `/api/v1/content/books/${encodeURIComponent(colSlug)}/${encodeURIComponent(bookSlug)}/chapters/${encodeURIComponent(chapterSlug)}/ast`
          );
          const json = await res.json();
          const ast = json.data;

          if (!ast) {
            return {
              toolName: 'get_chapter_ast',
              command: `/ast ${chapterSlug}`,
              success: false,
              summary: `未能获取章节 ${chapterSlug} 的 AST 数据`,
              cardHtml: `<div class="harness-tool-card"><div class="harness-tool-card__body">在《${escapeHtml(bookTitle)}》中未能获取章节 <strong>${escapeHtml(chapterSlug)}</strong> 的 AST 数据。</div></div>`,
              contextText: `章节 ${chapterSlug} AST 数据不存在。`,
            };
          }

          const canonicalUri = locator.uri || `astrolib://${colSlug}/${bookSlug}/${chapterSlug}`;
          const contextLines: string[] = [
            `【章节《${ast.title}》全文语义 AST 结构树】:`,
            `唯一指向源 (Canonical URI): ${canonicalUri}`,
            `所属教材: 《${bookTitle}》 (${colSlug}/${bookSlug})`,
            `文件路径: ${ast.filePath || chapterSlug}`,
            `大纲标题数: ${ast.headings?.length || 0} | 学术卡片数: ${ast.cards?.length || 0} | 独立公式数: ${ast.formulas?.length || 0}`,
            '篇章层次语法树 (含唯一可寻址 ID):',
          ];

          if (ast.tree && ast.tree.length > 0) {
            contextLines.push(...renderAstTreeToContextText(ast.tree));
          } else {
            for (const c of (ast.cards || [])) {
              contextLines.push(`- [${c.tag}] ${c.title || ''}: 行号 ${c.lineStart}-${c.lineEnd}`);
            }
          }

          contextLines.push('');
          contextLines.push('若需获取某一定理、例题、证明步骤或正文段落的完整 MDX 源码，请调用 read_content_node(nodeId="<节点ID>") 或 /read <节点ID>。');

          const formulasSampleHtml = (ast.formulas || []).length > 0
            ? `
              <h4 class="harness-ast-section-title">核心数学公式 (${ast.formulas.length})</h4>
              <div class="harness-ast-formulas">
                ${(ast.formulas || [])
                  .slice(0, 6)
                  .map((f: any) => `<div class="harness-ast-formula-item">$$${escapeHtml(f.rawTex || f.latex || '')}$$</div>`)
                  .join('')}
              </div>
            `
            : '';

          const artifactHtml = `
            <div class="harness-ast-artifact-header">
              <div><strong>教材：</strong>《${escapeHtml(bookTitle)}》</div>
              <div><strong>定位：</strong><code>${escapeHtml(canonicalUri)}</code></div>
              <div class="harness-ast-artifact-hint">点击节点右侧「精读」可在对话流中提取对应 MDX 源码片段</div>
            </div>
            <h4 class="harness-ast-section-title">篇章层次结构 (${ast.headings?.length || 0} 标题 · ${ast.cards?.length || 0} 卡片)</h4>
            ${ast.tree && ast.tree.length > 0 ? renderAstTreeToHtml(ast.tree) : '<div class="harness-ast-empty">暂无层次树数据</div>'}
            ${formulasSampleHtml}
          `;

          return {
            toolName: 'get_chapter_ast',
            command: `/ast ${chapterSlug}`,
            success: true,
            summary: `已提取《${ast.title}》AST 结构 (${ast.cards?.length || 0} 张卡片 / ${ast.formulas?.length || 0} 个公式)`,
            cardHtml: `
              <div style="font-size: 0.9rem; line-height: 1.6;">
                已提取章节 <strong>《${escapeHtml(ast.title)}》</strong>（${escapeHtml(bookTitle)}）的层次语法树，包含 ${ast.headings?.length || 0} 个标题节点、${ast.cards?.length || 0} 个学术模块与 ${ast.formulas?.length || 0} 个独立公式。<br>
                <span style="font-size: 0.84rem; color: var(--harness-text-secondary);">完整结构树与公式预览已归档至右侧「成果物」历史仓（可随时返回其他任务）。</span>
              </div>
            `,
            contextText: contextLines.join('\n'),
            artifact: {
              id: `ast:${colSlug}/${bookSlug}/${chapterSlug}`,
              kind: 'ast',
              title: `${ast.title} · 结构语法树`,
              badge: `${ast.cards?.length || 0} Cards · ${ast.formulas?.length || 0} Formulas`,
              html: artifactHtml,
            },
            sideEffectTab: 'artifacts',
          };
        } catch (err: any) {
          return {
            toolName: 'get_chapter_ast',
            command: `/ast ${chapterSlug}`,
            success: false,
            summary: `提取章节 AST 失败: ${err.message}`,
            cardHtml: `<div class="harness-tool-card"><div class="harness-tool-card__body" style="color: var(--md-sys-color-error, #ef4444);">提取章节 AST 失败: ${escapeHtml(err.message)}</div></div>`,
            contextText: `提取章节 ${chapterSlug} 失败: ${err.message}`,
          };
        }
      },
    });

    context.registerTool({
      name: 'get_chapter_ast',
      displayName: '提取章节 AST 语法树',
      category: '知识库检索',
      icon: { type: 'mdicon', value: 'account_tree' },
      sourceFile: 'src/plugins/harness/builtin/ast.plugin.ts',
      riskLevel: 'read',
      exposeAsSlashCommand: '/ast',
      formatActionLabel: (args) => {
        const target = args.locator || args.chapterSlug || args.bookSlug || '';
        return target ? `提取章节结构 · ${target}` : '提取章节 AST 结构';
      },
      description: '提取指定章节的精细结构化 AST 树、大纲标题、学术卡片（定理/定义/例题/题解）与 KaTeX 公式树。支持规范 URI（astrolib://<col>/<book>/<chapter>）或章节 slug 跨书自动寻址。',
      parameters: {
        type: 'object',
        properties: {
          locator: {
            type: 'string',
            description: '规范内容定位 URI（例如 "astrolib://math/math_senior/06_第1章-三角函数"）或全路径',
          },
          chapterSlug: {
            type: 'string',
            description: '章节 slug 或文件名（如 "06_第1章-三角函数", "21_数列极限的基本概念"）',
          },
          bookSlug: {
            type: 'string',
            description: '可选的所属图书 slug（如 "math_senior", "math_analysis"）',
          },
        },
        required: [],
      },
      execute: async (args, ctx) => {
        const query = args.locator || (args.bookSlug && args.chapterSlug ? `${args.bookSlug} ${args.chapterSlug}` : args.chapterSlug || '');
        const locator = UniversalLocatorResolver.resolve(query, ctx.books, ctx.chapters as any);

        if (locator.confidence === 'none' || !locator.chapterSlug) {
          return {
            toolName: 'get_chapter_ast',
            command: `/ast ${query}`,
            success: false,
            summary: locator.reason || `未找到章节: ${query}`,
            cardHtml: `<div class="harness-tool-card"><div class="harness-tool-card__body">未找到章节: ${escapeHtml(query)}</div></div>`,
            contextText: `未找到章节 "${query}"。请先调用 get_book_toc 获取准确章节 slug 或 URI。`,
          };
        }

        const colSlug = locator.colSlug;
        const bookSlug = locator.bookSlug;
        const chapterSlug = locator.chapterSlug;
        const canonicalUri = locator.uri || `astrolib://${colSlug}/${bookSlug}/${chapterSlug}`;

        try {
          const fetcher = ctx.fetchFn || fetch;
          const res = await fetcher(
            `/api/v1/content/books/${encodeURIComponent(colSlug)}/${encodeURIComponent(bookSlug)}/chapters/${encodeURIComponent(chapterSlug)}/ast`
          );
          const json = await res.json();
          const ast = json.data;

          if (!ast) {
            return {
              toolName: 'get_chapter_ast',
              command: `/ast ${chapterSlug}`,
              success: false,
              summary: `章节 ${chapterSlug} 数据不存在`,
              cardHtml: `<div class="harness-tool-card"><div class="harness-tool-card__body">章节 ${escapeHtml(chapterSlug)} 未找到。</div></div>`,
              contextText: `在《${locator.bookTitle}》中未找到章节 ${chapterSlug}`,
            };
          }

          const contextLines: string[] = [
            `【章节《${ast.title}》全文语义 AST 结构树 (唯一指向源: ${canonicalUri})】:`,
            `所属教材: 《${locator.bookTitle}》`,
            `大纲标题数: ${ast.headings?.length || 0} | 学术卡片数: ${ast.cards?.length || 0} | 独立公式数: ${ast.formulas?.length || 0}`,
            '层次化语法树 (每个节点均包含其性质、描述与全局唯一可寻址 ID):',
          ];

          if (ast.tree && ast.tree.length > 0) {
            contextLines.push(...renderAstTreeToContextText(ast.tree));
          } else {
            (ast.cards || []).forEach((c: any) =>
              contextLines.push(`- [${c.tag}] ${c.title || ''} (id: "${c.id}", 行 ${c.lineStart}-${c.lineEnd})`)
            );
          }

          contextLines.push('');
          contextLines.push('【内容精读工具调用指引 (read_content_node)】: 若需获取某个具体段落、例题、证明或公式的全部 MDX 原文，请调用 read_content_node(nodeId="<目标节点id>", locator="' + canonicalUri + '")。');

          return {
            toolName: 'get_chapter_ast',
            command: `/ast ${chapterSlug}`,
            success: true,
            summary: `已提取《${ast.title}》AST 树 (${ast.cards?.length || 0} 卡片 / ${ast.formulas?.length || 0} 公式)`,
            cardHtml: `<div class="harness-tool-card"><div class="harness-tool-card__body">已提取《${escapeHtml(ast.title)}》AST (${ast.cards?.length || 0} Cards)。</div></div>`,
            contextText: contextLines.join('\n'),
          };
        } catch (err: any) {
          return {
            toolName: 'get_chapter_ast',
            command: `/ast ${chapterSlug}`,
            success: false,
            summary: `提取章节 AST 失败: ${err.message}`,
            cardHtml: `<div class="harness-tool-card"><div class="harness-tool-card__body" style="color: var(--md-sys-color-error, #ef4444);">提取失败: ${escapeHtml(err.message)}</div></div>`,
            contextText: `提取章节 ${chapterSlug} 失败: ${err.message}`,
          };
        }
      },
    });
  },
};
