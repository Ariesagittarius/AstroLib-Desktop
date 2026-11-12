/**
 * src/server/plugins/doc-ingestion/ast-compiler.ts
 * ============================================================================
 * AstroLib MinerU 结构化 AST 编译器
 * 将 MinerU content_list_v2.json / layout.json / full.md 编译为统一高质量 LayoutBlock
 * 深度解析物理分页标尺、本页学术脚注双向对应、页眉/刊物/水印折叠元注
 * ============================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import katex from 'katex';
import type { LayoutBlock } from './types.ts';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 将 LaTeX 数学公式安全渲染为 KaTeX HTML
 */
function renderMath(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex.trim(), {
      displayMode,
      throwOnError: false,
    });
  } catch {
    return displayMode ? `$$\n${tex}\n$$` : `$${tex}$`;
  }
}

/**
 * 解析脚注符号与正文内容
 */
function extractFootnoteSymbolAndBody(spans: any[]): { symbol: string; bodySpans: any[] } {
  if (!spans || spans.length === 0) return { symbol: '*', bodySpans: [] };
  let symbol = '';
  let bodySpans: any[] = [];

  const firstSpan = spans[0];
  if (firstSpan.type === 'equation_inline') {
    const m = (firstSpan.content || '').match(/\^?\{?([0-9a-zA-Z*†‡]+)\}?/);
    if (m) {
      symbol = m[1];
      bodySpans = spans.slice(1);
    }
  } else if (firstSpan.type === 'text') {
    const text = firstSpan.content || '';
    const m = text.match(/^\s*(\*|\^?\{?([0-9a-zA-Z*†‡]+)\}?|\[([0-9a-zA-Z*†‡]+)\]|(\d+)[\.\、\s])\s*(.*)$/s);
    if (m) {
      symbol = m[2] || m[3] || m[4] || m[1];
      const remainder = m[5] || '';
      bodySpans = [{ type: 'text', content: remainder }, ...spans.slice(1)];
    }
  }

  if (!symbol) {
    symbol = '*';
    bodySpans = spans;
  }
  return { symbol, bodySpans };
}

/**
 * 核心导出函数：将解压目录编译为结构化 LayoutBlock 集合
 */
export function compileIngestAST(targetDir: string, taskId: string): LayoutBlock[] {
  // 1. 优先尝试 MinerU 原生 content_list_v2.json 或 content_list.json
  const listFiles = fs.readdirSync(targetDir).filter((f) => f.includes('content_list') && f.endsWith('.json'));
  if (listFiles.length > 0) {
    // 优先 v2
    const file = listFiles.find((f) => f.includes('v2')) || listFiles[0];
    try {
      const data = JSON.parse(fs.readFileSync(path.join(targetDir, file), 'utf-8'));
      if (Array.isArray(data) && data.length > 0) {
        return compileFromContentList(data, taskId);
      }
    } catch (err) {
      console.error('compileFromContentList failed:', err);
      // fallback
    }
  }

  // 2. 次选 layout.json
  const layoutPath = path.join(targetDir, 'layout.json');
  if (fs.existsSync(layoutPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(layoutPath, 'utf-8'));
      if (raw.pdf_info && Array.isArray(raw.pdf_info)) {
        return compileFromLayoutJson(raw.pdf_info, taskId);
      }
    } catch (err) {
      console.error('compileFromContentList failed:', err);
      // fallback
    }
  }

  // 3. 后备：纯 Markdown (如 Agent 轻量接口)
  const mdFiles = fs.readdirSync(targetDir).filter((f) => f.endsWith('.md'));
  if (mdFiles.length > 0) {
    try {
      const mdContent = fs.readFileSync(path.join(targetDir, mdFiles[0]), 'utf-8');
      return compileFromMarkdown(mdContent, taskId);
    } catch {
      // ignore
    }
  }

  return [];
}

/**
 * 编译器 1：基于 MinerU content_list_v2.json 进行高保真 AST 编译
 * 该文件中的 bbox 坐标均为归一化 1000 分制 [x0, y0, x1, y1] (0 - 1000)
 */
function compileFromContentList(pages: any[], taskId: string): LayoutBlock[] {
  const blocks: LayoutBlock[] = [];

  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const pageItems = pages[pageIdx];
    if (!Array.isArray(pageItems)) continue;

    // 1. 预提取本页物理页码
    const pageNumItem = pageItems.find((it) => it.type === 'page_number');
    const pageNumStr = (pageNumItem?.content?.page_number_content || [])
      .map((c: any) => c.content || '')
      .join('')
      .trim() || String(pageIdx + 1);

    // 2. 预提取本页所有脚注并建立本页符号表
    const rawFootnoteItems = pageItems.filter((it) => it.type === 'page_footnote');
    const pageFootnotes: Array<{
      itemIdx: number;
      symbol: string;
      rawText: string;
      htmlContent: string;
      bbox: [number, number, number, number];
    }> = [];

    rawFootnoteItems.forEach((it, idx) => {
      const itIdx = pageItems.indexOf(it);
      const spans = it.content?.page_footnote_content || [];
      const { symbol, bodySpans } = extractFootnoteSymbolAndBody(spans);

      let fnHtml = '';
      let fnRaw = '';
      for (const s of bodySpans) {
        if (s.type === 'equation_inline') {
          fnHtml += renderMath(s.content, false);
          fnRaw += `$${s.content}$`;
        } else if (s.type === 'equation_interline') {
          fnHtml += `<div class="doc-equation-display">${renderMath(s.content, true)}</div>`;
          fnRaw += `\n$$\n${s.content}\n$$\n`;
        } else {
          fnHtml += escapeHtml(s.content || '');
          fnRaw += s.content || '';
        }
      }

      const bbox: [number, number, number, number] = Array.isArray(it.bbox) && it.bbox.length === 4
        ? [it.bbox[0], it.bbox[1], it.bbox[2], it.bbox[3]]
        : [0, 900, 1000, 1000];

      pageFootnotes.push({
        itemIdx: itIdx,
        symbol,
        rawText: fnRaw.trim(),
        htmlContent: fnHtml.trim(),
        bbox,
      });
    });

    const knownSymbols = new Set(pageFootnotes.map((f) => f.symbol));

    // 3. 预提取本页页眉与期刊/水印元信息
    let headerText = '';
    let footerText = '';
    let asideText = '';

    pageItems.forEach((it) => {
      if (it.type === 'page_header') {
        const txt = (it.content?.page_header_content || []).map((c: any) => c.content || '').join('').trim();
        if (txt) headerText = txt;
      } else if (it.type === 'page_footer') {
        const txt = (it.content?.page_footer_content || []).map((c: any) => c.content || '').join('').trim();
        if (txt) footerText = txt;
      } else if (it.type === 'page_aside_text') {
        const txt = (it.content?.page_aside_text_content || []).map((c: any) => c.content || '').join('').trim();
        if (txt) asideText = txt;
      }
    });

    // 4. 发射跨页虚线标尺 (Page Divider, 仅在第 2 页及之后生成)
    if (pageIdx > 0) {
      blocks.push({
        id: `divider_p${pageIdx}`,
        type: 'page_divider',
        pageIndex: pageIdx,
        pageNumber: pageNumStr,
        bbox: [0, 0, 1000, 20],
        pageWidth: 1000,
        pageHeight: 1000,
        html: `<div class="doc-page-divider" id="divider_p${pageIdx}" data-page-index="${pageIdx}" data-page-number="${pageNumStr}"><span class="doc-page-divider-line"></span><span class="doc-page-number" title="点击跳转至第 ${pageNumStr} 页">${pageNumStr}</span><span class="doc-page-divider-line"></span></div>`,
        text: `\n\n<!-- page: ${pageNumStr} -->\n\n`,
      });
    }

    // 5. 若本页存在刊物、会议或水印信息，发射页外折叠元注徽标 (Page Meta Badge)
    if (headerText || footerText || asideText) {
      const metaRows: string[] = [];
      if (headerText) {
        metaRows.push(`<div class="doc-meta-row"><span class="meta-k">页眉</span><span class="meta-v">${escapeHtml(headerText)}</span></div>`);
      }
      if (footerText) {
        metaRows.push(`<div class="doc-meta-row"><span class="meta-k">刊号</span><span class="meta-v">${escapeHtml(footerText)}</span></div>`);
      }
      if (asideText) {
        metaRows.push(`<div class="doc-meta-row"><span class="meta-k">水印</span><span class="meta-v">${escapeHtml(asideText)}</span></div>`);
      }

      const metaSummary = footerText || asideText || headerText;
      blocks.push({
        id: `meta_p${pageIdx}`,
        type: 'page_meta',
        pageIndex: pageIdx,
        bbox: [0, 0, 1000, 25],
        pageWidth: 1000,
        pageHeight: 1000,
        html: `<div class="doc-page-meta-badge" data-page-index="${pageIdx}"><details class="doc-page-meta-details"><summary class="doc-page-meta-summary" title="查看本页刊物与水印元信息"><span class="material-symbols-outlined doc-meta-icon" style="font-size: 14px;">info</span><span class="doc-meta-label">${escapeHtml(metaSummary)}</span></summary><div class="doc-page-meta-popover">${metaRows.join('')}</div></details></div>`,
        text: `<!-- meta: ${metaSummary} -->`,
        metaInfo: { header: headerText, footer: footerText, aside: asideText },
      });
    }

    // 6. 遍历本页普通正文元素
    for (let itemIdx = 0; itemIdx < pageItems.length; itemIdx++) {
      const item = pageItems[itemIdx];
      const rawType = item.type || 'paragraph';

      // 彻底跳过元信息与裸页码、脚注，避免在正文流中打断阅读！
      if (
        rawType === 'page_number' ||
        rawType === 'page_header' ||
        rawType === 'page_footer' ||
        rawType === 'page_aside_text' ||
        rawType === 'page_footnote'
      ) {
        continue;
      }

      const bbox: [number, number, number, number] = Array.isArray(item.bbox) && item.bbox.length === 4
        ? [item.bbox[0], item.bbox[1], item.bbox[2], item.bbox[3]]
        : [0, 0, 1000, 1000];

      const blockId = `blk_p${pageIdx}_${itemIdx}`;
      let blockType: LayoutBlock['type'] = 'text';
      let html = '';
      let text = '';
      let caption: string | undefined = undefined;
      let level: number | undefined = undefined;

      if (rawType === 'title') {
        blockType = 'title';
        level = Math.min(6, Math.max(1, item.content?.level || 1));
        const spans = item.content?.title_content || [];
        let innerHtml = '';
        for (const s of spans) {
          if (s.type === 'equation_inline') {
            const symMatch = (s.content || '').match(/^\^?\{?([0-9a-zA-Z*†‡]+)\}?$/);
            if (symMatch && knownSymbols.has(symMatch[1])) {
              const sym = symMatch[1];
              innerHtml += `<sup class="doc-footnote-ref" id="ref_p${pageIdx}_${sym}" data-fn-id="fn_p${pageIdx}_${sym}" data-page-index="${pageIdx}" data-fn-symbol="${sym}">[${sym}]</sup>`;
              text += `[^${sym}]`;
            } else {
              innerHtml += renderMath(s.content, false);
              text += `$${s.content}$`;
            }
          } else {
            innerHtml += escapeHtml(s.content || '');
            text += s.content || '';
          }
        }
        html = `<h${level} class="doc-heading doc-heading-${level}">${innerHtml}</h${level}>`;
      } else if (rawType === 'paragraph') {
        blockType = 'text';
        const spans = item.content?.paragraph_content || [];
        let innerHtml = '';
        for (const s of spans) {
          if (s.type === 'equation_inline') {
            const symMatch = (s.content || '').match(/^\^?\{?([0-9a-zA-Z*†‡]+)\}?$/);
            if (symMatch && knownSymbols.has(symMatch[1])) {
              const sym = symMatch[1];
              innerHtml += `<sup class="doc-footnote-ref" id="ref_p${pageIdx}_${sym}" data-fn-id="fn_p${pageIdx}_${sym}" data-page-index="${pageIdx}" data-fn-symbol="${sym}">[${sym}]</sup>`;
              text += `[^${sym}]`;
            } else {
              innerHtml += renderMath(s.content, false);
              text += `$${s.content}$`;
            }
          } else if (s.type === 'equation_interline') {
            innerHtml += `<div class="doc-equation-display">${renderMath(s.content, true)}</div>`;
            text += `\n$$\n${s.content}\n$$\n`;
          } else {
            let chunkText = s.content || '';
            let chunkHtml = escapeHtml(chunkText);
            // 兼容性扫描文本内的 ^1 或 ^{2}
            for (const sym of knownSymbols) {
              const esc = escapeRegex(sym);
              const reg = new RegExp(`\\^\\{?${esc}\\}?`, 'g');
              if (reg.test(chunkText)) {
                chunkHtml = chunkHtml.replace(reg, `<sup class="doc-footnote-ref" id="ref_p${pageIdx}_${sym}" data-fn-id="fn_p${pageIdx}_${sym}" data-page-index="${pageIdx}" data-fn-symbol="${sym}">[${sym}]</sup>`);
                chunkText = chunkText.replace(reg, `[^${sym}]`);
              }
            }
            innerHtml += chunkHtml;
            text += chunkText;
          }
        }
        html = `<p class="doc-paragraph">${innerHtml}</p>`;
      } else if (rawType === 'equation_interline' || rawType === 'equation') {
        blockType = 'equation';
        const math = item.content?.math_content || item.content || '';
        text = `$$\n${math}\n$$`;
        html = `<div class="doc-equation-display">${renderMath(math, true)}</div>`;
      } else if (rawType === 'image' || rawType === 'chart') {
        blockType = 'image';
        const imgPath = item.content?.image_source?.path || '';
        const imgName = path.basename(imgPath);
        caption = (item.content?.image_caption || []).map((c: any) => c.content || '').join('');
        text = `![${caption || '插图'}](/api/ingest/image?taskId=${encodeURIComponent(taskId)}&name=${encodeURIComponent(imgName)})`;
        const imgSrc = `/api/ingest/image?taskId=${encodeURIComponent(taskId)}&name=${encodeURIComponent(imgName)}`;
        html = `<figure class="doc-figure"><img src="${imgSrc}" alt="${escapeHtml(caption || '插图')}" loading="lazy" />${caption ? `<figcaption class="doc-figcaption">${escapeHtml(caption)}</figcaption>` : ''}</figure>`;
      } else if (rawType === 'table') {
        blockType = 'table';
        const tableHtml = item.content?.html || '';
        caption = (item.content?.table_caption || []).map((c: any) => c.content || '').join('');
        text = caption ? `${caption}\n${tableHtml}` : tableHtml;
        html = `<div class="doc-table-wrapper">${tableHtml}${caption ? `<div class="doc-table-caption">${escapeHtml(caption)}</div>` : ''}</div>`;
      } else if (rawType === 'list') {
        blockType = 'list';
        const listItems = item.content?.list_items || [];
        const itemsHtml = listItems.map((li: any) => {
          const txt = (li.item_content || []).map((c: any) => c.content || '').join('');
          text += `* ${txt}\n`;
          return `<li>${escapeHtml(txt)}</li>`;
        }).join('');
        html = `<ul class="doc-list">${itemsHtml}</ul>`;
      }

      blocks.push({
        id: blockId,
        type: blockType,
        pageIndex: pageIdx,
        bbox,
        pageWidth: 1000,
        pageHeight: 1000,
        html,
        text: text.trim(),
        caption,
        level,
      });
    }

    // 7. 本页所有正文完毕后，在页底集中发射学术级脚注区 (Page Footnotes Zone)
    if (pageFootnotes.length > 0) {
      for (const fn of pageFootnotes) {
        blocks.push({
          id: `fn_p${pageIdx}_${fn.symbol}`,
          type: 'footnote',
          pageIndex: pageIdx,
          fnIndex: fn.symbol,
          bbox: fn.bbox,
          pageWidth: 1000,
          pageHeight: 1000,
          html: `<div class="doc-page-footnote" id="fn_p${pageIdx}_${fn.symbol}" data-page-index="${pageIdx}" data-fn-symbol="${fn.symbol}"><span class="fn-marker">${fn.symbol}.</span><span class="fn-body">${fn.htmlContent}</span><a href="#ref_p${pageIdx}_${fn.symbol}" class="fn-back-link" title="返回正文引用处" data-ref-id="ref_p${pageIdx}_${fn.symbol}">↩</a></div>`,
          text: `[^${fn.symbol}]: ${fn.rawText}`,
        });
      }
    }
  }

  return blocks;
}

/**
 * 编译器 2：从 layout.json 的 pdf_info 编译回退
 */
function compileFromLayoutJson(pdfInfo: any[], taskId: string): LayoutBlock[] {
  const blocks: LayoutBlock[] = [];

  for (let pageIdx = 0; pageIdx < pdfInfo.length; pageIdx++) {
    const page = pdfInfo[pageIdx];
    const [pageWidth, pageHeight] = Array.isArray(page.page_size) && page.page_size.length === 2
      ? page.page_size
      : [612, 792];

    const paraBlocks = page.para_blocks || [];

    // 发射分页标尺
    if (pageIdx > 0) {
      blocks.push({
        id: `divider_p${pageIdx}`,
        type: 'page_divider',
        pageIndex: pageIdx,
        pageNumber: String(pageIdx + 1),
        bbox: [0, 0, 1000, 20],
        pageWidth: 1000,
        pageHeight: 1000,
        html: `<div class="doc-page-divider" id="divider_p${pageIdx}" data-page-index="${pageIdx}" data-page-number="${pageIdx + 1}"><span class="doc-page-divider-line"></span><span class="doc-page-number" title="点击跳转至第 ${pageIdx + 1} 页">${pageIdx + 1}</span><span class="doc-page-divider-line"></span></div>`,
        text: `\n\n<!-- page: ${pageIdx + 1} -->\n\n`,
      });
    }

    for (let i = 0; i < paraBlocks.length; i++) {
      const pb = paraBlocks[i];
      if (!pb.bbox || !Array.isArray(pb.bbox) || pb.bbox.length !== 4) continue;

      const rawType = (pb.type || 'text') as string;
      if (rawType === 'page_number' || rawType === 'header' || rawType === 'footer') {
        continue;
      }

      const lines = pb.lines || pb.blocks?.flatMap((b: any) => b.lines || []) || [];
      let innerHtml = '';
      let text = '';
      let blockType: LayoutBlock['type'] = 'text';

      for (const line of lines) {
        for (const span of (line.spans || [])) {
          if (span.type === 'image') {
            blockType = 'image';
            const imgName = span.image_path || `img_${pageIdx}_${i}.png`;
            const imgSrc = `/api/ingest/image?taskId=${encodeURIComponent(taskId)}&name=${encodeURIComponent(imgName)}`;
            innerHtml += `<figure class="doc-figure"><img src="${imgSrc}" alt="切片插图" loading="lazy" /></figure>`;
            text += `![插图](${imgSrc})\n`;
          } else if (span.type === 'table') {
            blockType = 'table';
            innerHtml += `<div class="doc-table-wrapper">${span.html || ''}</div>`;
            text += span.html || '';
          } else if (span.type === 'inline_equation') {
            innerHtml += renderMath(span.content || '', false);
            text += `$${span.content}$`;
          } else if (span.type === 'interline_equation') {
            blockType = 'equation';
            innerHtml += `<div class="doc-equation-display">${renderMath(span.content || '', true)}</div>`;
            text += `\n$$\n${span.content}\n$$\n`;
          } else {
            innerHtml += escapeHtml(span.content || '');
            text += span.content || '';
          }
        }
      }

      let html = innerHtml;
      if (rawType === 'title') {
        blockType = 'title';
        const lvl = Math.min(6, Math.max(1, pb.level || 1));
        html = `<h${lvl} class="doc-heading doc-heading-${lvl}">${innerHtml}</h${lvl}>`;
      } else if (rawType === 'footnote') {
        blockType = 'footnote';
        html = `<div class="doc-page-footnote" id="fn_p${pageIdx}_${i}"><span class="fn-body">${innerHtml}</span></div>`;
      } else if (blockType === 'text') {
        html = `<p class="doc-paragraph">${innerHtml}</p>`;
      }

      // 将 layout.json 的 pt 坐标归一化为 1000 分制
      const normBbox: [number, number, number, number] = [
        Math.round((pb.bbox[0] / pageWidth) * 1000),
        Math.round((pb.bbox[1] / pageHeight) * 1000),
        Math.round((pb.bbox[2] / pageWidth) * 1000),
        Math.round((pb.bbox[3] / pageHeight) * 1000),
      ];

      blocks.push({
        id: `blk_p${pageIdx}_${i}`,
        type: blockType,
        pageIndex: pageIdx,
        bbox: normBbox,
        pageWidth: 1000,
        pageHeight: 1000,
        html,
        text: text.trim(),
      });
    }
  }

  return blocks;
}

/**
 * 编译器 3：从纯 Markdown 编译回退 (Agent 免密接口)
 */
function compileFromMarkdown(mdContent: string, taskId: string): LayoutBlock[] {
  const blocks: LayoutBlock[] = [];
  const sections = mdContent.split(/\n\n+/);

  sections.forEach((sec, idx) => {
    const trimmed = sec.trim();
    if (!trimmed) return;

    let blockType: LayoutBlock['type'] = 'text';
    let html = '';

    if (/^#{1,6}\s/.test(trimmed)) {
      blockType = 'title';
      const m = trimmed.match(/^(#{1,6})\s+(.*)$/);
      const lvl = m ? m[1].length : 2;
      const titleText = m ? m[2] : trimmed;
      html = `<h${lvl} class="doc-heading doc-heading-${lvl}">${escapeHtml(titleText)}</h${lvl}>`;
    } else if (/^\$\$[\s\S]+\$\$$/.test(trimmed)) {
      blockType = 'equation';
      const math = trimmed.replace(/^\$\$|\$\$$/g, '');
      html = `<div class="doc-equation-display">${renderMath(math, true)}</div>`;
    } else if (/^!\[.*?\]\(.*?\)$/.test(trimmed)) {
      blockType = 'image';
      const m = trimmed.match(/^!\[(.*?)\]\((.*?)\)$/);
      const alt = m ? m[1] : '';
      const src = m ? m[2] : '';
      const imgName = path.basename(src);
      const imgSrc = `/api/ingest/image?taskId=${encodeURIComponent(taskId)}&name=${encodeURIComponent(imgName)}`;
      html = `<figure class="doc-figure"><img src="${imgSrc}" alt="${escapeHtml(alt)}" loading="lazy" />${alt ? `<figcaption class="doc-figcaption">${escapeHtml(alt)}</figcaption>` : ''}</figure>`;
    } else if (/^\|.*\|\n\|.*\|/.test(trimmed)) {
      blockType = 'table';
      html = `<div class="doc-table-wrapper"><pre>${escapeHtml(trimmed)}</pre></div>`;
    } else {
      let pText = trimmed.replace(/\$([^\$\n]+?)\$/g, (_, eq) => renderMath(eq, false));
      html = `<p class="doc-paragraph">${pText}</p>`;
    }

    blocks.push({
      id: `blk_syn_${idx}`,
      type: blockType,
      pageIndex: 0,
      bbox: [0, 0, 1000, 1000],
      pageWidth: 1000,
      pageHeight: 1000,
      html,
      text: trimmed,
    });
  });

  return blocks;
}

/**
 * 合成高纯度结构化 Markdown：
 * 1. 彻底清除突兀孤立的页码段落（如 \n\n2\n\n）；
 * 2. 插入标准 <!-- page: N --> 分页锚点；
 * 3. 收集并格式化学术脚注 [^N] 与文末 [^N]: 定义；
 * 4. 剔除重复无意义的 running header。
 */
export function synthesizeStructuredMarkdown(blocks: LayoutBlock[], originalRawMd?: string): string {
  const parts: string[] = [];
  const footnotes: string[] = [];

  for (const b of blocks) {
    if (b.type === 'page_divider') {
      parts.push(`\n\n<!-- page: ${b.pageNumber || (b.pageIndex + 1)} -->\n\n`);
    } else if (b.type === 'page_meta') {
      // 避免正文夹杂元注噪音，保持正文洁净
      continue;
    } else if (b.type === 'title') {
      const lvl = Math.min(6, Math.max(1, b.level || 2));
      parts.push(`\n\n${'#'.repeat(lvl)} ${b.text}\n\n`);
    } else if (b.type === 'text') {
      parts.push(`\n\n${b.text}\n\n`);
    } else if (b.type === 'equation') {
      parts.push(`\n\n$$\n${(b.text || '').replace(/^\$\$|\$\$$/g, '').trim()}\n$$\n\n`);
    } else if (b.type === 'image' || b.type === 'figure') {
      parts.push(`\n\n${b.text}\n\n`);
    } else if (b.type === 'table') {
      parts.push(`\n\n${b.text}\n\n`);
    } else if (b.type === 'list') {
      parts.push(`\n\n${b.text}\n\n`);
    } else if (b.type === 'footnote') {
      const sym = b.fnIndex || '1';
      const cleanContent = (b.text || '').replace(/^\[\^.*?\]:\s*/, '').trim();
      footnotes.push(`[^${sym}]: ${cleanContent}`);
    }
  }

  let md = parts.join('').replace(/\n{3,}/g, '\n\n').trim();

  // 清洗残留的孤立数字段落
  md = md.replace(/\n\n\d{1,3}\n\n/g, '\n\n');

  // 追加标准脚注区
  if (footnotes.length > 0) {
    md += `\n\n---\n\n### 附注与文献说明\n\n` + footnotes.join('\n\n');
  }

  return md;
}
