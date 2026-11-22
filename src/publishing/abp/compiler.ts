/**
 * src/publishing/abp/compiler.ts
 * ============================================================================
 * 独立无头 ABP (AstroBook Package 1.0.0) 内容包编译器
 * ============================================================================
 * 规范：
 * 1. 纯无头模块（Rule 2 / Rule 8），可直接在 Electron、Node 服务、Vitest 中运行；
 * 2. 完整支持 AstroLib 全部 13+ 学术组件与嵌套卡片（Knowledge/Example/Exercise/
 *    Solution/Analysis/Variant/Note/Block/Method/Summary/Algorithm/SideNote/
 *    MarginNote/DigitalResource/QRCodeVideo/ExerciseTrigger）及 Mermaid 图表；
 * 3. 支持工作区级 book.json（多级 sections、modules、元数据、内嵌封面）；
 * 4. 工作区直算附属索引（aiIndex、crossRefs、relationGraph、inspectorData），
 *    不硬编码依赖 content-sources/collections/；
 * 5. 编译产物落盘前强制经过 validateInstallPayload() 校验。
 * ============================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import katex from 'katex';
import hljs from 'highlight.js';
import { marked, Marked } from 'marked';
import { renderTitleHtml } from '../../utils/render-title.ts';
import { cleanSlug } from '../../utils/slug.ts';
import { naturalSort } from '../../utils/natural-sort.ts';
import { slugifyHeading, collectHeadingsFromHtml, rewriteHeadingIdsInHtml } from '../../core/content/headings.ts';
import {
  ABP_SCHEMA_VERSION,
  type AbpBundlePayload,
  type AstroBookChapterPayload,
  type AstroBookChapterSummary,
  type AstroBookManifest,
  type AstroBookSection,
  type BookFootnoteEntry,
} from '../../types/content-package.ts';
import type { ModuleItemConfig } from '../../types/collections.ts';
import { validateInstallPayload } from '../../services/content-provider/install-validation.ts';
import { buildBookIndex } from '../../ai/indexer.mjs';
import { chunkMdx } from '../../ai/chunker.mjs';
import { serializeEmbeddingsBinary } from '../../features/search-rec/services/storage.ts';
import type { AbpCompileOptions, AbpCompileResult, BookJsonConfig } from './types.ts';

export const DEFAULT_ACADEMIC_MODULES: Record<string, ModuleItemConfig> = {
  '定理': { short: '理', aliases: ['定理', 'Theorem'], theme: 'chip-conclusion' },
  '定义': { short: '定', aliases: ['定义', 'Definition'], theme: 'chip-knowledge' },
  '性质': { short: '性', aliases: ['性质', 'Property'], theme: 'chip-knowledge' },
  '推论': { short: '推', aliases: ['推论', 'Corollary'], theme: 'chip-conclusion' },
  '引理': { short: '引', aliases: ['引理', 'Lemma'], theme: 'chip-conclusion' },
  '命题': { short: '命', aliases: ['命题', 'Proposition'], theme: 'chip-conclusion' },
  '公理': { short: '公', aliases: ['公理', 'Axiom'], theme: 'chip-conclusion' },
  '准则': { short: '准', aliases: ['准则', 'Criterion'], theme: 'chip-conclusion' },
  '例': { short: '例', aliases: ['例', '例题', 'Example'], theme: 'chip-example' },
  '变式': { short: '变', aliases: ['变式', 'Variant'], theme: 'chip-variant' },
  '习题': { short: '习', aliases: ['习题', '练习', '练习题', 'Exercise'], theme: 'chip-problem' },
  '算法': { short: '算', aliases: ['算法', 'Algorithm'], theme: 'chip-method' },
  '方法': { short: '方', aliases: ['方法', '方法总结', 'Method'], theme: 'chip-method' },
  '总结': { short: '结', aliases: ['总结', '结论总结', '小结', 'Summary'], theme: 'chip-conclusion' },
  '注': { short: '注', aliases: ['注', '注意', '注解', 'Note', 'Remark'], theme: 'chip-default' },
  '图': {
    short: '图',
    aliases: ['图'],
    theme: 'chip-default',
    isImage: true,
    targetQuery: 'p, div, figcaption',
    targetPattern: '^图\\s*(\\d+(?:[\\.\\-－]\\d+)*)$',
  },
};

export const DEFAULT_TRACK_CLASSES = [
  '.example-card',
  '.knowledge-card',
  '.exercise-card',
  '.variant-card',
  '.summary-card',
  '.method-card',
  '.note-card',
  '.note-block',
  '.analysis-card',
  '.analysis-block',
  '.fallback-block',
  '.block-card',
  '.academic-algorithm',
  '.toc-chunk',
];

function computeHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

function escapeHtml(str: string): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(str: string): string {
  return escapeHtml(str);
}

export function parseFrontmatter(rawContent: string): { frontmatter: Record<string, string>; body: string } {
  const cleaned = rawContent.replace(/^\uFEFF/, '');
  const fmMatch = cleaned.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!fmMatch) {
    return { frontmatter: {}, body: cleaned };
  }
  const fmBlock = fmMatch[1];
  const body = cleaned.slice(fmMatch[0].length);
  const frontmatter: Record<string, string> = {};

  for (const line of fmBlock.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx > 0) {
      const key = trimmed.slice(0, colonIdx).trim();
      let val = trimmed.slice(colonIdx + 1).trim();
      if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) {
        val = val.slice(1, -1);
      }
      frontmatter[key] = val;
    }
  }

  return { frontmatter, body };
}

function inferKnowledgeIconKind(title: string): string {
  const t = title || '';
  if (/定理|theorem/i.test(t)) return 'theorem';
  if (/推论|corollary/i.test(t)) return 'corollary';
  if (/引理|lemma/i.test(t)) return 'lemma';
  if (/公理|axiom/i.test(t)) return 'axiom';
  if (/命题|proposition/i.test(t)) return 'proposition';
  if (/定义|概念|definition/i.test(t)) return 'definition';
  if (/性质|property/i.test(t)) return 'property';
  if (/法则|定律|law/i.test(t)) return 'law';
  if (/公式|formula/i.test(t)) return 'formula';
  if (/准则|原理|criterion|principle/i.test(t)) return 'criterion';
  if (/知识点|point|box/i.test(t)) return 'point';
  if (/结论|总结|conclusion/i.test(t)) return 'conclusion';
  return 'knowledge';
}

function inferSideNoteKind(explicitType: string, title: string): string {
  const valid = new Set(['note', 'think', 'caution', 'analysis', 'geom']);
  if (explicitType && valid.has(explicitType.toLowerCase())) {
    return explicitType.toLowerCase();
  }
  const t = (title || '').trim();
  if (/想一想|思考|问一问|探讨|探究/i.test(t)) return 'think';
  if (/注意|警告|防错|小心/i.test(t)) return 'caution';
  if (/分析|思路|关键|证明思路/i.test(t)) return 'analysis';
  if (/几何|几何意义|直观/i.test(t)) return 'geom';
  return 'note';
}

function getTagAttr(attrsStr: string, name: string): string {
  if (!attrsStr) return '';
  const re = new RegExp(
    `\\b${name}\\s*=\\s*(?:\\{"((?:\\\\.|[^"\\\\])*)"\\}|\\{'((?:\\\\.|[^'\\\\])*)'\\}|"((?:\\\\.|[^"\\\\])*)"|'((?:\\\\.|[^'\\\\])*)'|\\{([^}]+)\\})`,
    'i'
  );
  const match = attrsStr.match(re);
  if (!match) return '';
  const raw = match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5] ?? '';
  return raw.replace(/\\(["'])/g, '$1').trim();
}

function compileAlgorithmBody(rawContent: string): string {
  let normalized = rawContent
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\r\n/g, '\n');

  const rawLines = normalized.split('\n');
  while (rawLines.length > 0 && !rawLines[0].trim()) rawLines.shift();
  while (rawLines.length > 0 && !rawLines[rawLines.length - 1].trim()) rawLines.pop();

  if (rawLines.length === 0) return '';

  const expandTabs = (s: string) => s.replace(/^\t+/, (tabs) => '    '.repeat(tabs.length));
  const expandedLines = rawLines.map(expandTabs);

  let minIndent = Infinity;
  for (const ln of expandedLines) {
    if (!ln.trim()) continue;
    const m = ln.match(/^ */);
    const indent = m ? m[0].length : 0;
    if (indent < minIndent) minIndent = indent;
  }
  if (!Number.isFinite(minIndent)) minIndent = 0;

  return expandedLines
    .map((ln) => {
      if (!ln.trim()) {
        return '<div class="algo-line algo-blank" aria-hidden="true"></div>';
      }
      const dedented = ln.slice(minIndent);
      const leadMatch = dedented.match(/^ */);
      const indentSpaces = leadMatch ? leadMatch[0].length : 0;
      const textPart = dedented.slice(indentSpaces);

      const inlineTokens: string[] = [];
      const pushInline = (htmlStr: string) => {
        const idx = inlineTokens.length;
        inlineTokens.push(htmlStr);
        return `%%%ALGO_TOK_${idx}%%%`;
      };

      let line = textPart;
      line = line.replace(/%%%MATH_(?:BLOCK|INLINE)_\d+%%%/g, (m) => pushInline(m));
      line = line.replace(/`([^`]+)`/g, (_m, code) =>
        pushInline(`<span class="algo-inline-code">${escapeHtml(code)}</span>`)
      );
      line = line.replace(/<\/?(?:u|b|i|strong|em|sub|sup)\b[^>]*>/gi, (tag) => {
        const cleanTag = tag.replace(/\s+[^>]+/, '').toLowerCase();
        return pushInline(cleanTag);
      });

      line = escapeHtml(line);
      line = line.replace(/\*\*(?!\s)([^*\n]+?)(?<!\s)\*\*/g, '<strong>$1</strong>');
      line = line.replace(/\*(?!\s)([^*\n]+?)(?<!\s)\*/g, '<em>$1</em>');
      line = line.replace(/%%%ALGO_TOK_(\d+)%%%/g, (_m, idx) => inlineTokens[Number(idx)] ?? '');

      return `<div class="algo-line" style="--algo-indent:${indentSpaces}"><span class="algo-line-text">${line}</span></div>`;
    })
    .join('');
}

export interface CompileMarkdownOptions {
  colSlug?: string;
  bookSlug?: string;
  bookTitle?: string;
  chapterSlug?: string;
  includeBuptExerciseBank?: boolean;
}

export interface CompileMarkdownResult {
  html: string;
  footnotes: Record<string, BookFootnoteEntry>;
}

/**
 * 将 Markdown / MDX 编译为 AstroLib 语义 HTML 与结构化脚注映射
 */
export function compileMarkdownToSemanticResult(
  body: string,
  {
    colSlug = '',
    bookSlug = '',
    bookTitle = '',
    chapterSlug = '',
    includeBuptExerciseBank = false,
  }: CompileMarkdownOptions = {}
): CompileMarkdownResult {
  // 1. 剔除 MDX 顶部或内部 import 语句
  let cleaned = body
    .replace(/^import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '')
    .replace(/import\s+[^;\n]+;\s*/g, '')
    .trim();

  // 1.5 若 <Algorithm> 内部仅包裹单层 fenced code block，则提前解包以便其内数学公式与行级缩进正常编译
  cleaned = cleaned.replace(
    /(<Algorithm(?:\s+[^>]*)?>)([\s\S]*?)(<\/Algorithm>)/gi,
    (_m, openTag, inner, closeTag) => {
      const trimmedInner = inner.trim();
      const singleFence = trimmedInner.match(/^```[a-zA-Z0-9_+#.-]*[ \t]*\r?\n([\s\S]*?)\r?\n```$/);
      if (singleFence && !singleFence[1].includes('```')) {
        return `${openTag}\n${singleFence[1]}\n${closeTag}`;
      }
      return `${openTag}${inner}${closeTag}`;
    }
  );

  // 2. 保护 fenced code blocks (含 mermaid 图表与 highlight.js 编译期语法高亮)
  const codePlaceholders: string[] = [];
  cleaned = cleaned.replace(/```([a-zA-Z0-9_+#.-]*)[ \t]*\r?\n([\s\S]*?)```/g, (_m, lang, code) => {
    const idx = codePlaceholders.length;
    const normLang = (lang || '').trim().toLowerCase();
    const rawCode = code.replace(/\s+$/, '');
    if (normLang === 'mermaid') {
      const encoded = encodeURIComponent(rawCode);
      codePlaceholders.push(
        `<div class="mermaid-container" data-mermaid-code="${encoded}"><pre class="mermaid">${escapeHtml(rawCode)}</pre></div>`
      );
    } else {
      const isPlain = !normLang || normLang === 'txt' || normLang === 'text' || normLang === 'plain';
      let highlighted = '';
      if (!isPlain && hljs.getLanguage(normLang)) {
        try {
          highlighted = hljs.highlight(rawCode, { language: normLang, ignoreIllegals: true }).value;
        } catch {
          highlighted = escapeHtml(rawCode);
        }
      } else {
        highlighted = escapeHtml(rawCode);
      }
      const cls = normLang ? ` class="language-${escapeAttr(normLang)}"` : '';
      const langDisplay = normLang || 'text';
      codePlaceholders.push(
        `<div class="astrolib-code-block not-content" data-lang="${escapeAttr(langDisplay)}"><div class="code-block-header"><span class="code-block-lang">${escapeHtml(langDisplay)}</span><button type="button" class="code-block-copy-btn" aria-label="复制代码" title="复制代码"><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg><span>复制</span></button></div><pre class="hljs"><code${cls}>${highlighted}</code></pre></div>`
      );
    }
    return `\n\n%%%CODE_${idx}%%%\n\n`;
  });

  // 3. 规范化填空题下划线
  cleaned = cleaned.replace(/(?:\\_){2,}|_{3,}/g, '<span class="fill-in-blank">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>');

  // 4. 保护并预渲染 KaTeX 公式（保存 rawTex 与 pre-rendered HTML）
  const mathPlaceholders: Array<{ rawTex: string; html: string }> = [];
  cleaned = cleaned.replace(/\$\$([\s\S]*?)\$\$/g, (match, tex) => {
    const idx = mathPlaceholders.length;
    const cleanTex = tex.trim();
    try {
      const rendered = katex.renderToString(cleanTex, {
        displayMode: true,
        output: 'html',
        strict: false,
        throwOnError: false,
      });
      const encodedTex = encodeURIComponent(cleanTex);
      mathPlaceholders.push({
        rawTex: cleanTex,
        html: `<div class="katex-display-container" data-latex="${encodedTex}">${rendered}</div>`,
      });
    } catch {
      mathPlaceholders.push({ rawTex: cleanTex, html: match });
    }
    return `%%%MATH_BLOCK_${idx}%%%`;
  });

  cleaned = cleaned.replace(/(?<!\\)\$([^\$\n\r]+?)(?<!\\)\$/g, (match, tex) => {
    const idx = mathPlaceholders.length;
    const cleanTex = tex.trim();
    try {
      const rendered = katex.renderToString(cleanTex, {
        displayMode: false,
        output: 'html',
        strict: false,
        throwOnError: false,
      });
      const encodedTex = encodeURIComponent(cleanTex);
      mathPlaceholders.push({
        rawTex: cleanTex,
        html: `<span class="katex-inline-container" data-latex="${encodedTex}">${rendered}</span>`,
      });
    } catch {
      mathPlaceholders.push({ rawTex: cleanTex, html: match });
    }
    return `%%%MATH_INLINE_${idx}%%%`;
  });

  // 4.5 提取并编译 Markdown 学术脚注 ([^id] / [^id]: ...，支持跨行续写与内联 KaTeX)
  const rawFootnoteDefs = new Map<string, string>();
  const linesForFn = cleaned.split(/\r?\n/);
  const filteredFnLines: string[] = [];
  for (let i = 0; i < linesForFn.length; i++) {
    const line = linesForFn[i];
    const defMatch = line.match(/^\[\^([^\]]+)\]:[ \t]*(.*)$/);
    if (defMatch) {
      const fnId = defMatch[1].trim();
      const defBodyParts: string[] = [];
      if (defMatch[2].trim()) defBodyParts.push(defMatch[2].trimEnd());
      while (i + 1 < linesForFn.length) {
        const nextLine = linesForFn[i + 1];
        if (/^(?: {2,}|\t)\S/.test(nextLine)) {
          defBodyParts.push(nextLine.replace(/^(?: {2,4}|\t)/, ''));
          i++;
        } else if (
          nextLine.trim() === '' &&
          i + 2 < linesForFn.length &&
          /^(?: {2,}|\t)\S/.test(linesForFn[i + 2])
        ) {
          defBodyParts.push('');
          i++;
        } else {
          break;
        }
      }
      rawFootnoteDefs.set(fnId, defBodyParts.join('\n').trim());
    } else {
      filteredFnLines.push(line);
    }
  }
  cleaned = filteredFnLines.join('\n');

  const footnotes: Record<string, BookFootnoteEntry> = {};
  const fnRefPlaceholders: string[] = [];
  const fnAssignedOrder = new Map<string, { num: number; fnKey: string }>();
  const orderedFootnoteItems: Array<{ num: number; fnKey: string; html: string }> = [];

  if (rawFootnoteDefs.size > 0) {
    const restoreMathAndCode = (s: string): string => {
      let out = s;
      let prev = '';
      while (out !== prev && (out.includes('%%%CODE_') || out.includes('%%%MATH_'))) {
        prev = out;
        out = out
          .replace(/%%%CODE_(\d+)%%%/g, (_m, idx) => codePlaceholders[Number(idx)] ?? '')
          .replace(/%%%MATH_(?:BLOCK|INLINE)_(\d+)%%%/g, (_m, idx) => mathPlaceholders[Number(idx)]?.html || '');
      }
      return out;
    };

    const safeChapPrefix = (chapterSlug || 'ch').replace(/[^a-zA-Z0-9_-]/g, '_');

    cleaned = cleaned.replace(/\[\^([^\]]+)\]/g, (fullMatch, rawId) => {
      const fnId = String(rawId || '').trim();
      if (!rawFootnoteDefs.has(fnId)) return fullMatch;

      let assigned = fnAssignedOrder.get(fnId);
      if (!assigned) {
        const num = fnAssignedOrder.size + 1;
        const fnKey = `fn-${safeChapPrefix}-${num}`;
        assigned = { num, fnKey };
        fnAssignedOrder.set(fnId, assigned);

        const rawDefMd = rawFootnoteDefs.get(fnId) || '';
        let defHtml = String(marked.parse(rawDefMd, { gfm: true, breaks: false })).trim();
        const singlePMatch = defHtml.match(/^<p>([\s\S]*)<\/p>$/i);
        if (singlePMatch && !singlePMatch[1].includes('</p>')) {
          defHtml = singlePMatch[1];
        }
        defHtml = restoreMathAndCode(defHtml);

        const plainDefText = rawDefMd
          .replace(/%%%MATH_(?:BLOCK|INLINE)_(\d+)%%%/g, (_m, idx) => mathPlaceholders[Number(idx)]?.rawTex || '')
          .replace(/<[^>]+>/g, '')
          .trim();

        footnotes[fnKey] = {
          id: fnKey,
          title: `脚注 ${num}`,
          html: defHtml,
          text: plainDefText,
          ...(chapterSlug ? { chapterSlug } : {}),
        };
        orderedFootnoteItems.push({ num, fnKey, html: defHtml });
      }

      const phIdx = fnRefPlaceholders.length;
      fnRefPlaceholders.push(
        `<sup class="academic-fn-ref" id="fnref-${escapeAttr(assigned.fnKey)}"><a href="#fn-${escapeAttr(assigned.fnKey)}" data-astrolib-footnote="${escapeAttr(assigned.fnKey)}" data-fn-num="${assigned.num}" role="doc-noteref" aria-label="脚注 ${assigned.num}">${assigned.num}</a></sup>`
      );
      return `%%%FNREF_${phIdx}%%%`;
    });
  }

  // 5. 图片路径规范化与图注绑定（避免双重 <figure> 嵌套）
  const rewriteImageSrc = (rawSrc: string): string => {
    const cleanSrc = (rawSrc || '').trim();
    if (!cleanSrc || cleanSrc.startsWith('http://') || cleanSrc.startsWith('https://') || cleanSrc.startsWith('data:')) {
      return cleanSrc;
    }
    if (colSlug && bookSlug && (cleanSrc.startsWith('images/') || cleanSrc.startsWith('./images/') || !cleanSrc.startsWith('/'))) {
      const fileName = path.basename(cleanSrc);
      return `/collections/${colSlug}/${bookSlug}/images/${fileName}`;
    }
    return cleanSrc;
  };

  cleaned = cleaned.replace(
    /(<figure[^>]*>[\s\S]*?)!\[([\s\S]*?)\]\s*\(([\s\S]*?)\)([\s\S]*?<\/figure>)/gi,
    (_m, pre, alt, src, post) => {
      const cleanAlt = (alt || '').trim();
      const finalSrc = rewriteImageSrc(src);
      return `${pre}<img src="${escapeAttr(finalSrc)}" alt="${escapeAttr(cleanAlt)}" loading="lazy" />${post}`;
    }
  );

  cleaned = cleaned.replace(/!\[([\s\S]*?)\]\s*\(([\s\S]*?)\)/g, (_m, alt, src) => {
    const cleanAlt = (alt || '').trim();
    const finalSrc = rewriteImageSrc(src);
    return `<figure class="content-figure"><img src="${escapeAttr(finalSrc)}" alt="${escapeAttr(cleanAlt)}" loading="lazy" />${cleanAlt ? `<figcaption>${cleanAlt}</figcaption>` : ''}</figure>`;
  });

  cleaned = cleaned.replace(/<img\s+([^>]*?)src=["'](\.?\/?images\/[^"']+)["']([^>]*)>/gi, (_m, pre, src, post) => {
    const finalSrc = rewriteImageSrc(src);
    return `<img ${pre}src="${escapeAttr(finalSrc)}"${post}>`;
  });

  // 6. 转换 Astro MDX 学术组件为 Semantic Card DOM
  const cardPlaceholders: string[] = [];

  const renderTitleHelper = (rawTitle: string): { plainTitle: string; titleHtml: string; cleanId: string } => {
    let plainTitle = rawTitle.replace(/%%%MATH_(?:BLOCK|INLINE)_(\d+)%%%/g, (_, idx) => mathPlaceholders[Number(idx)]?.rawTex || '');
    plainTitle = plainTitle.replace(/<[^>]+>/g, '').trim();
    const cleanId = slugifyHeading(plainTitle) || `card-${cardPlaceholders.length}`;
    const titleWithMath = rawTitle.replace(/%%%MATH_(?:BLOCK|INLINE)_(\d+)%%%/g, (_, idx) => mathPlaceholders[Number(idx)]?.html || '');
    const titleHtml = rawTitle.includes('%%%MATH_') ? titleWithMath : renderTitleHtml(titleWithMath);
    return { plainTitle, titleHtml, cleanId };
  };

  const mdParseInlineBody = (innerMd: string): string => {
    return String(marked.parse(innerMd.trim(), { gfm: true, breaks: false }));
  };

  // 6.1 可折叠解答/提示组件 <Solution>
  cleaned = cleaned.replace(
    /<Solution(?:\s+([^>]*?))?>([\s\S]*?)<\/Solution>/gi,
    (_m, attrsStr, content) => {
      const rawTitle = getTagAttr(attrsStr || '', 'title') || '查看解析与步骤';
      const { plainTitle, titleHtml, cleanId } = renderTitleHelper(rawTitle);
      const bodyHtml = mdParseInlineBody(content);
      const html = `<details class="solution-details" data-title="${escapeAttr(plainTitle)}" id="${escapeAttr(cleanId)}"><summary>${titleHtml}</summary><div class="solution-content">${bodyHtml}</div></details>`;
      const idx = cardPlaceholders.length;
      cardPlaceholders.push(html);
      return `\n\n%%%CARD_${idx}%%%\n\n`;
    }
  );

  // 6.2 数字资源组件 <DigitalResource> & <QRCodeVideo>
  cleaned = cleaned.replace(
    /<(?:DigitalResource|QRCodeVideo)\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:DigitalResource|QRCodeVideo)>)/gi,
    (_m, attrsStr) => {
      const id = getTagAttr(attrsStr, 'id');
      const title = getTagAttr(attrsStr, 'title');
      const url = getTagAttr(attrsStr, 'url');
      const type = getTagAttr(attrsStr, 'type') || 'auto';

      const cleanTitle = title.replace(/^二维码\s*\d+(\.\d+)*\s*/, '').replace(/[.\。\s]+$/, '').trim();
      let codeId = id;
      if (!codeId) {
        const match = title.match(/^二维码\s*(\d+(\.\d+)*)/);
        if (match) codeId = match[1];
      }

      let categoryName = '数字资源';
      let iconKind = 'resource';
      if (type === 'courseware' || /课件|讲义|PPT|演示文稿/i.test(cleanTitle)) {
        categoryName = '教学课件';
        iconKind = 'courseware';
      } else if (type === 'video' || /视频|微课|讲解|录像/i.test(cleanTitle)) {
        categoryName = '微课视频';
        iconKind = 'video';
      } else if (type === 'demo' || /动画|演示|仿真|几何画板|GeoGebra/i.test(cleanTitle)) {
        categoryName = '动态演示';
        iconKind = 'demo';
      }

      const displayTag = codeId ? `${categoryName} ${codeId}` : categoryName;
      const displayTitle = cleanTitle || '配套数字化资源';
      const iconSvg =
        iconKind === 'video'
          ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/></svg>'
          : iconKind === 'courseware'
          ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>'
          : '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/></svg>';

      const linkHtml = url
        ? `<a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer" class="academic-resource-title-link" title="打开数字资源: ${escapeAttr(displayTitle)}"><span class="academic-resource-title-text">${escapeHtml(displayTitle)}</span><span class="academic-resource-link-arrow" aria-hidden="true"> ↗</span></a>`
        : `<span class="academic-resource-title-plain">${escapeHtml(displayTitle)}</span>`;

      const copyBtnHtml = url
        ? `<span class="academic-resource-actions academic-resource-trigger-wrapper qr-trigger-wrapper"><button type="button" class="academic-resource-action-btn js-copy-resource-url" data-url="${escapeAttr(url)}" aria-label="复制资源链接" title="复制链接"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" /></svg></button></span>`
        : '';

      const resHtml = `<div class="academic-digital-resource academic-resource-card qr-video-card not-content" data-res-type="${iconKind}"><div class="academic-resource-stream"><div class="academic-resource-lead"><span class="academic-resource-media-icon" aria-hidden="true">${iconSvg}</span><span class="academic-resource-prefix">${escapeHtml(displayTag)}</span>${linkHtml}</div>${copyBtnHtml}</div></div>`;
      const idx = cardPlaceholders.length;
      cardPlaceholders.push(resHtml);
      return `\n\n%%%CARD_${idx}%%%\n\n`;
    }
  );

  // 6.3 课后习题触发卡 <ExerciseTrigger />
  cleaned = cleaned.replace(/<ExerciseTrigger\s*([^>]*?)\/?>/gi, (_m, attrsStr) => {
    const ch = getTagAttr(attrsStr || '', 'chapter') || '1';
    const sec = getTagAttr(attrsStr || '', 'section') || 'all';
    const rawTitle = getTagAttr(attrsStr || '', 'title') || (sec !== 'all' ? `第 ${sec} 节` : `第 ${ch} 章`);
    const cleanTitle = rawTitle
      .replace(/\s*(?:课后真题与自测练习|课后真题与即时自测练习|课后自测与真题练习|课后真题与练习|课后练习|自测练习)/g, '')
      .trim();

    const bookTitleStr = bookTitle || '课本';
    const chipsHtml = includeBuptExerciseBank
      ? `<button type="button" class="ex-bank-chip ft-m3-see-all-btn" data-exercise-trigger data-bank-id="bupt_math" data-chapter="${escapeAttr(ch)}" data-section="${escapeAttr(sec)}"><span>大邮数学集</span></button><button type="button" class="ex-bank-chip ft-m3-see-all-btn" data-exercise-trigger data-bank-id="textbook_exercises" data-chapter="${escapeAttr(ch)}" data-section="${escapeAttr(sec)}"><span>《${escapeHtml(bookTitleStr)}》课后习题</span></button>`
      : `<button type="button" class="ex-bank-chip ft-m3-see-all-btn" data-exercise-trigger data-bank-id="textbook_exercises" data-chapter="${escapeAttr(ch)}" data-section="${escapeAttr(sec)}"><span>《${escapeHtml(bookTitleStr)}》课后习题</span></button>`;

    const triggerHtml = `<div class="exercise-trigger-card not-content" role="complementary" aria-label="相关课后习题" data-exercise-trigger-card data-chapter="${escapeAttr(ch)}" data-section="${escapeAttr(sec)}" data-book="${escapeAttr(bookSlug || '')}"><div class="exercise-trigger-info"><div class="exercise-trigger-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /><polyline points="10 8 13 11 17 6" /></svg></div><div class="exercise-trigger-texts"><div class="exercise-trigger-title-row"><div class="exercise-trigger-title">${escapeHtml(cleanTitle)}</div></div><div class="exercise-chip-group">${chipsHtml}</div></div></div></div>`;
    const idx = cardPlaceholders.length;
    cardPlaceholders.push(triggerHtml);
    return `\n\n%%%CARD_${idx}%%%\n\n`;
  });

  // 6.4 旁注组件 <SideNote> & <MarginNote>
  cleaned = cleaned.replace(/<(?:SideNote|MarginNote)(?:\s+([^>]*?))?>([\s\S]*?)<\/(?:SideNote|MarginNote)>/gi, (_m, attrsStr, content) => {
    const rawTitle = getTagAttr(attrsStr || '', 'title') || '注';
    const explicitType = getTagAttr(attrsStr || '', 'type');
    const side = getTagAttr(attrsStr || '', 'side') === 'left' ? 'left' : 'right';
    const isInline = /\binline(?:\s*=\s*(?:\{true\}|["']true["']))?(?:\s|$)/i.test(attrsStr || '');
    const kind = inferSideNoteKind(explicitType, rawTitle);
    const { plainTitle, titleHtml, cleanId } = renderTitleHelper(rawTitle);
    const bodyHtml = mdParseInlineBody(content);
    const sideNoteHtml = `<div class="astrolib-sidenote sidenote-${kind} sidenote-${side} ${isInline ? 'sidenote-inline' : 'sidenote-float'}" role="note" aria-label="${escapeAttr(plainTitle)}" data-sidenote-kind="${kind}" data-title="${escapeAttr(plainTitle)}" id="${escapeAttr(cleanId)}"><div class="sidenote-header"><div class="sidenote-header-left"><span class="sidenote-title">${titleHtml}</span></div></div><div class="sidenote-content">${bodyHtml}</div></div>`;
    const idx = cardPlaceholders.length;
    cardPlaceholders.push(sideNoteHtml);
    return `\n\n%%%CARD_${idx}%%%\n\n`;
  });

  // 6.5 算法块组件 <Algorithm>（专属行级编译，精确保真缩进与行内 KaTeX）
  cleaned = cleaned.replace(/<Algorithm(?:\s+([^>]*?))?>([\s\S]*?)<\/Algorithm>/gi, (_m, attrsStr, content) => {
    const rawTitle = getTagAttr(attrsStr || '', 'title') || getTagAttr(attrsStr || '', 'caption') || '算法';
    const { plainTitle, cleanId } = renderTitleHelper(rawTitle);
    const bodyHtml = compileAlgorithmBody(content);

    let captionBlock = '';
    if (plainTitle) {
      const capSplit = rawTitle.trim().match(/^((?:Figure|Algorithm|算法|图)\s*[\d.\-]+[:.]?)\s+(.*)$/i);
      if (capSplit) {
        const prefixHtml = escapeHtml(capSplit[1]);
        const restHtml = renderTitleHelper(capSplit[2]).titleHtml;
        captionBlock = `<div class="algorithm-caption" role="heading" aria-level="4"><span class="algorithm-caption-prefix">${prefixHtml}</span><span class="algorithm-caption-text">${restHtml}</span></div>`;
      } else {
        const { titleHtml } = renderTitleHelper(rawTitle);
        captionBlock = `<div class="algorithm-caption" role="heading" aria-level="4"><span class="algorithm-caption-text">${titleHtml}</span></div>`;
      }
    }

    const algoHtml = `<div class="academic-algorithm toc-chunk" data-title="${escapeAttr(plainTitle)}" id="${escapeAttr(cleanId)}">${captionBlock}<div class="algorithm-body">${bodyHtml}</div></div>`;
    const idx = cardPlaceholders.length;
    cardPlaceholders.push(algoHtml);
    return `\n\n%%%CARD_${idx}%%%\n\n`;
  });

  // 6.6 标准学术卡片组件（按“可能在内层 -> 外层”的顺序编译，保障嵌套无损，并兼容主题与旧测试类名）
  const cardConfigs = [
    { tag: 'Analysis', cls: 'analysis-card toc-chunk', headerCls: 'card-header analysis-header', bodyCls: 'card-body analysis-content', defaultTitle: '分析' },
    { tag: 'Method', cls: 'method-card toc-chunk', headerCls: 'card-header', bodyCls: 'card-body', defaultTitle: '方法总结' },
    { tag: 'Note', cls: 'note-card toc-chunk', headerCls: 'card-header note-header', bodyCls: 'card-body note-content', defaultTitle: '注' },
    { tag: 'Variant', cls: 'variant-card toc-chunk', headerCls: 'card-header', bodyCls: 'card-body', defaultTitle: '变式' },
    { tag: 'Example', cls: 'example-card toc-chunk', headerCls: 'card-header', bodyCls: 'card-body', defaultTitle: '例题' },
    { tag: 'Knowledge', cls: 'knowledge-card toc-chunk', headerCls: 'card-header', bodyCls: 'card-body', defaultTitle: '知识要点' },
    { tag: 'Exercise', cls: 'exercise-card toc-chunk', headerCls: 'card-header', bodyCls: 'card-body', defaultTitle: '习题' },
    { tag: 'Block', cls: 'block-card fallback-block toc-chunk', headerCls: 'card-header fallback-header', bodyCls: 'card-body fallback-content', defaultTitle: '知识板块' },
    { tag: 'Summary', cls: 'summary-card toc-chunk', headerCls: 'card-header', bodyCls: 'card-body', defaultTitle: '总结' },
  ];

  for (const { tag, cls, headerCls, bodyCls, defaultTitle } of cardConfigs) {
    const re = new RegExp(`<${tag}(?:\\s+([^>]*?))?>([\\s\\S]*?)<\\/${tag}>`, 'gi');
    cleaned = cleaned.replace(re, (_m, attrsStr, content) => {
      const rawTitle = getTagAttr(attrsStr || '', 'title') || defaultTitle;
      const { plainTitle, titleHtml, cleanId } = renderTitleHelper(rawTitle);
      const bodyHtml = mdParseInlineBody(content);
      const extraAttr = tag === 'Knowledge' ? ` data-icon-kind="${inferKnowledgeIconKind(plainTitle)}"` : '';
      const cardHtml = `<div class="${cls}"${extraAttr} data-title="${escapeAttr(plainTitle)}" id="${escapeAttr(cleanId)}"><div class="${headerCls}" role="heading" aria-level="4"><span class="card-title-text">${titleHtml}</span></div><div class="${bodyCls}">${bodyHtml}</div></div>`;
      const idx = cardPlaceholders.length;
      cardPlaceholders.push(cardHtml);
      return `\n\n%%%CARD_${idx}%%%\n\n`;
    });
  }

  // 剔除空 <Guide /> 占位
  cleaned = cleaned.replace(/<Guide[^>]*\/>/gi, '');

  // 7. 使用独立 Marked 实例编译外层 Markdown（不污染全局 marked 单例）
  const localMarked = new Marked({
    gfm: true,
    breaks: false,
    renderer: {
      heading({ depth, text, tokens }) {
        const innerHtml = this.parser.parseInline(tokens);
        let plainText = text.replace(/%%%MATH_(?:BLOCK|INLINE)_(\d+)%%%/g, (_, idx) => mathPlaceholders[Number(idx)]?.rawTex || '');
        plainText = plainText.replace(/<[^>]+>/g, '').trim();
        const slug = slugifyHeading(plainText) || `heading-${depth}`;
        const anchorSvg = `<a class="anchor-link" href="#${slug}" aria-label="标题直链"><svg class="anchor-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></a>`;
        return `<h${depth} id="${slug}"><span>${innerHtml}</span>${anchorSvg}</h${depth}>\n`;
      },
    },
  });

  let html = String(localMarked.parse(cleaned));

  // 8. 递归还原卡片、代码块、脚注上标与公式占位符
  let prevHtml = '';
  while (html !== prevHtml && html.includes('%%%CARD_')) {
    prevHtml = html;
    html = html
      .replace(/<p>\s*%%%CARD_(\d+)%%%\s*<\/p>/g, (_m, idx) => cardPlaceholders[Number(idx)] ?? '')
      .replace(/%%%CARD_(\d+)%%%/g, (_m, idx) => cardPlaceholders[Number(idx)] ?? '');
  }

  prevHtml = '';
  while (html !== prevHtml && html.includes('%%%CODE_')) {
    prevHtml = html;
    html = html
      .replace(/<p>\s*%%%CODE_(\d+)%%%\s*<\/p>/g, (_m, idx) => codePlaceholders[Number(idx)] ?? '')
      .replace(/%%%CODE_(\d+)%%%/g, (_m, idx) => codePlaceholders[Number(idx)] ?? '');
  }

  prevHtml = '';
  while (html !== prevHtml && html.includes('%%%FNREF_')) {
    prevHtml = html;
    html = html.replace(/%%%FNREF_(\d+)%%%/g, (_m, idx) => fnRefPlaceholders[Number(idx)] ?? '');
  }

  prevHtml = '';
  while (html !== prevHtml && html.includes('%%%MATH_')) {
    prevHtml = html;
    html = html.replace(/%%%MATH_(?:BLOCK|INLINE)_(\d+)%%%/g, (_m, idx) => mathPlaceholders[Number(idx)]?.html || '');
  }

  if (orderedFootnoteItems.length > 0) {
    const itemsHtml = orderedFootnoteItems
      .map(
        (fn) =>
          `<li id="fn-${escapeAttr(fn.fnKey)}" class="academic-footnote-item" data-fn-id="${escapeAttr(fn.fnKey)}" data-fn-num="${fn.num}"><span class="fn-body">${fn.html}</span><a href="#fnref-${escapeAttr(fn.fnKey)}" class="fn-back-link" data-fn-ref="fnref-${escapeAttr(fn.fnKey)}" title="返回正文引用处" aria-label="返回正文引用处">↩</a></li>`
      )
      .join('');
    html += `\n<section class="academic-footnotes" role="doc-endnotes" aria-label="本节脚注"><ol class="academic-footnotes-list">${itemsHtml}</ol></section>`;
  }

  // 9. 重写去重章节内标题 ID
  html = rewriteHeadingIdsInHtml(html);

  return {
    html: `<div class="astrolib-chapter-content">${html}</div>`,
    footnotes,
  };
}

/**
 * 兼容入口：返回语义 HTML 字符串
 */
export function compileMarkdownToSemanticHtml(
  body: string,
  options: CompileMarkdownOptions = {}
): string {
  return compileMarkdownToSemanticResult(body, options).html;
}

function findChapterFiles(dir: string, baseDir: string = dir): string[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let results: string[] = [];
  for (const entry of entries) {
    if (entry.name === 'images' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(findChapterFiles(full, baseDir));
    } else if (entry.isFile() && (entry.name.endsWith('.mdx') || entry.name.endsWith('.md'))) {
      const rel = path.relative(baseDir, full).replace(/\\/g, '/');
      results.push(rel);
    }
  }
  return results.sort(naturalSort);
}

function parseTitleDetailsLocal(rawTitle: string) {
  const emojiRegex = /[\u{1F300}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\uFE0F]/gu;
  const cleanTitle = (rawTitle || '').replace(emojiRegex, '').trim();
  const match = cleanTitle.match(/^([^\d\s]+)\s*(\d+(?:\.\d+)*(?:[-－]\d+)?)(.*)$/);
  if (match) {
    const type = match[1].trim();
    const num = match[2].trim().replace(/－/g, '-');
    return {
      type,
      num,
      coreKey: `${type}${num}`.replace(/\s+/g, ''),
      fullKey: cleanTitle.replace(/\s+/g, ''),
      cleanTitle,
    };
  }
  return {
    type: '',
    num: '',
    coreKey: cleanTitle.replace(/\s+/g, ''),
    fullKey: cleanTitle.replace(/\s+/g, ''),
    cleanTitle,
  };
}

function buildWorkspaceAuxiliaryData(params: {
  bookDir: string;
  colSlug: string;
  bookSlug: string;
  title: string;
  modules: Record<string, ModuleItemConfig>;
  chapterRecords: Array<{
    cFile: string;
    slug: string;
    title: string;
    rawContent: string;
  }>;
}) {
  const { bookDir, colSlug, bookSlug, title, modules, chapterRecords } = params;

  // 1. aiIndex
  const aiIndex = buildBookIndex({
    colSlug,
    bookSlug,
    bookDir,
    modules,
    title,
  });

  // 2. crossRefs
  const crossRefs: Record<string, Array<{ url: string; chapterTitle: string; rawTitle: string; cleanTitle: string }>> = {};
  const tagRegex = /<(Example|Variant|Knowledge|Summary|Method|Conclusion|Block|Exercise|Solution|Algorithm|Note)\s+[^>]*?\btitle\s*=\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)')/g;

  for (const ch of chapterRecords) {
    const urlPath = `/collections/${colSlug}/${bookSlug}/${ch.slug}/`.replace(/\/+/g, '/');
    tagRegex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = tagRegex.exec(ch.rawContent)) !== null) {
      const rawTitle = (m[2] ?? m[3] ?? '').replace(/\\(["'])/g, '$1').trim();
      const details = parseTitleDetailsLocal(rawTitle);
      const cleanId = encodeURIComponent(details.cleanTitle.replace(/\s+/g, '-'));
      const candidate = {
        url: `${urlPath}#${cleanId}`,
        chapterTitle: ch.title,
        rawTitle,
        cleanTitle: details.cleanTitle,
      };
      for (const key of new Set([details.coreKey, details.fullKey])) {
        if (!key) continue;
        if (!crossRefs[key]) crossRefs[key] = [];
        if (!crossRefs[key].some((c) => c.url === candidate.url)) {
          crossRefs[key].push(candidate);
        }
      }
    }
  }

  // 3. inspectorData & relationGraph
  const cardByType: Record<string, number> = {};
  const inspectorCards: Array<{ chapterSlug: string; chapterTitle: string; tag: string; title: string }> = [];
  const graphNodes: Array<{ id: string; name: string; category: number; symbolSize: number; url: string }> = [];
  const graphLinks: Array<{ source: string; target: string; value: number }> = [];
  const categoriesSet: string[] = [];

  const allAliases: string[] = [];
  for (const [k, meta] of Object.entries(modules)) {
    if (k !== '图' && !meta.isImage && Array.isArray(meta.aliases)) {
      allAliases.push(...meta.aliases);
    }
  }
  const escapedAliases = allAliases.map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const refRegex = escapedAliases ? new RegExp(`(${escapedAliases})\\s*(\\d+(?:\\.\\d+)*)`, 'g') : null;

  chapterRecords.forEach((ch, idx) => {
    const groupMatch = ch.title.match(/^(第[0-9一二三四五六七八九十百]+章|[0-9]+|附录[A-Za-z0-9\-_]*)/);
    const groupName = groupMatch ? groupMatch[1] : '正文';
    if (!categoriesSet.includes(groupName)) categoriesSet.push(groupName);
    const catIdx = categoriesSet.indexOf(groupName);

    let localCardCount = 0;
    tagRegex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = tagRegex.exec(ch.rawContent)) !== null) {
      localCardCount++;
      const tag = m[1];
      const cardTitle = m[2].trim();
      cardByType[tag] = (cardByType[tag] || 0) + 1;
      inspectorCards.push({ chapterSlug: ch.slug, chapterTitle: ch.title, tag, title: cardTitle });
    }

    graphNodes.push({
      id: `chap-${idx}`,
      name: ch.title,
      category: catIdx,
      symbolSize: Math.min(48, Math.max(16, 14 + localCardCount * 2)),
      url: `/collections/${colSlug}/${bookSlug}/${ch.slug}/`,
    });
  });

  if (refRegex) {
    const urlToNodeIdx = new Map<string, number>();
    chapterRecords.forEach((ch, i) => {
      urlToNodeIdx.set(`/collections/${colSlug}/${bookSlug}/${ch.slug}/`, i);
    });
    const linkCounts = new Map<string, number>();
    chapterRecords.forEach((ch, srcIdx) => {
      refRegex.lastIndex = 0;
      let rm: RegExpExecArray | null;
      while ((rm = refRegex.exec(ch.rawContent)) !== null) {
        const key = `${rm[1].trim()}${rm[2].trim()}`.replace(/\s+/g, '');
        const hits = crossRefs[key] || [];
        for (const h of hits) {
          const baseUrl = h.url.split('#')[0];
          const tgtIdx = urlToNodeIdx.get(baseUrl);
          if (tgtIdx !== undefined && tgtIdx !== srcIdx) {
            const lk = `${srcIdx}->${tgtIdx}`;
            linkCounts.set(lk, (linkCounts.get(lk) || 0) + 1);
          }
        }
      }
    });
    for (const [lk, val] of linkCounts.entries()) {
      const [s, t] = lk.split('->');
      graphLinks.push({ source: `chap-${s}`, target: `chap-${t}`, value: val });
    }
  }

  const inspectorData = {
    ok: true,
    bookId: `${colSlug}-${bookSlug}`,
    title,
    totalChapters: chapterRecords.length,
    totalCards: inspectorCards.length,
    cardByType,
    cards: inspectorCards,
  };

  const relationGraph = {
    meta: { colSlug, bookSlug, title },
    categories: categoriesSet.map((name) => ({ name })),
    nodes: graphNodes,
    links: graphLinks,
  };

  return { aiIndex, crossRefs, inspectorData, relationGraph };
}

function buildHierarchicalSections(
  chapterFiles: string[],
  summaryMap: Map<string, AstroBookChapterSummary>,
  configuredSections?: BookJsonConfig['sections']
): AstroBookSection[] {
  const usedSlugs = new Set<string>();

  if (Array.isArray(configuredSections) && configuredSections.length > 0) {
    const sections: AstroBookSection[] = [];
    const lookup = new Map<string, AstroBookChapterSummary>();

    for (const s of summaryMap.values()) {
      lookup.set(s.slug, s);
      if (s.sourcePath) {
        lookup.set(s.sourcePath, s);
        lookup.set(s.sourcePath.replace(/\.(mdx|md)$/i, ''), s);
        lookup.set(path.basename(s.sourcePath), s);
        lookup.set(path.basename(s.sourcePath, path.extname(s.sourcePath)), s);
      }
      if (s.legacySlug) lookup.set(s.legacySlug, s);
    }

    configuredSections.forEach((secCfg, idx) => {
      let introSlug: string | undefined;
      if (secCfg.intro && typeof secCfg.intro === 'string') {
        const introHit = lookup.get(secCfg.intro) || lookup.get(cleanSlug(secCfg.intro));
        if (introHit && !usedSlugs.has(introHit.slug)) {
          usedSlugs.add(introHit.slug);
          introSlug = introHit.slug;
        }
      }

      const chList: AstroBookChapterSummary[] = [];
      for (const ref of secCfg.chapters || []) {
        const hit = lookup.get(ref) || lookup.get(cleanSlug(ref));
        if (hit && !usedSlugs.has(hit.slug)) {
          usedSlugs.add(hit.slug);
          chList.push(hit);
        }
      }
      if (chList.length > 0 || introSlug) {
        const secSlug = secCfg.slug || slugifyHeading(secCfg.title) || `section-${idx + 1}`;
        sections.push({
          id: secCfg.id || `section-${idx + 1}`,
          title: secCfg.title,
          slug: secSlug,
          ...(introSlug ? { introSlug } : {}),
          collapsed: Boolean(secCfg.collapsed),
          order: idx,
          chapters: chList,
        });
      }
    });

    const unmapped: AstroBookChapterSummary[] = [];
    for (const cFile of chapterFiles) {
      const s = summaryMap.get(cFile);
      if (s && !usedSlugs.has(s.slug)) {
        usedSlugs.add(s.slug);
        unmapped.push(s);
      }
    }
    if (unmapped.length > 0) {
      sections.push({
        id: 'section-other',
        title: sections.length > 0 ? '其他章节' : '全部章节',
        slug: 'other',
        collapsed: false,
        order: sections.length,
        chapters: unmapped,
      });
    }
    if (sections.length > 0) return sections;
  }

  // 自动目录分组：若存在子目录结构，则按顶级目录自动分组
  const hasSubDirs = chapterFiles.some((f) => f.includes('/'));
  if (hasSubDirs) {
    const groups = new Map<string, AstroBookChapterSummary[]>();
    for (const cFile of chapterFiles) {
      const s = summaryMap.get(cFile);
      if (!s) continue;
      const parts = cFile.split('/');
      const groupKey = parts.length > 1 ? parts[0] : '__root__';
      if (!groups.has(groupKey)) groups.set(groupKey, []);
      groups.get(groupKey)!.push(s);
    }

    const sections: AstroBookSection[] = [];
    let order = 0;
    for (const [key, chapters] of groups.entries()) {
      const title =
        key === '__root__'
          ? '导言与附录'
          : key.replace(/^\d+[_-]/, '').replace(/_/g, ' ').trim() || key;
      sections.push({
        id: `section-${order + 1}`,
        title,
        slug: cleanSlug(key === '__root__' ? 'frontmatter' : key) || `sec-${order + 1}`,
        collapsed: false,
        order,
        chapters,
      });
      order++;
    }
    return sections;
  }

  return [
    {
      id: 'section-main',
      title: '全部章节',
      slug: 'main',
      collapsed: false,
      order: 0,
      chapters: chapterFiles.map((f) => summaryMap.get(f)!).filter(Boolean),
    },
  ];
}

/**
 * 独立无头打包单本图书工作区为标准 .abp 内容包
 */
export async function compileBookToAbp(options: AbpCompileOptions): Promise<AbpCompileResult> {
  const {
    bookDir,
    outDir,
    customManifest = null,
    withVectors = false,
    vectorFormat = 'int8',
    includeAuxiliary = true,
    writeExpanded = true,
  } = options;

  const resolvedDir = path.resolve(bookDir);
  if (!fs.existsSync(resolvedDir)) {
    throw new Error(`目标书籍目录不存在: ${bookDir}`);
  }

  const warnings: string[] = [];

  // 1. 读取 book.json（工作区元数据 SSOT）
  let bookJson: BookJsonConfig = {};
  const bookJsonPath = path.join(resolvedDir, 'book.json');
  if (fs.existsSync(bookJsonPath)) {
    try {
      bookJson = JSON.parse(fs.readFileSync(bookJsonPath, 'utf-8')) as BookJsonConfig;
    } catch (err: any) {
      throw new Error(`解析 book.json 失败 (${bookJsonPath}): ${err?.message || String(err)}`);
    }
  }

  const mergedMeta: BookJsonConfig = { ...bookJson, ...(customManifest || {}) };
  const dirParts = resolvedDir.replace(/\\/g, '/').split('/');
  const colSlug = (options.colSlug || mergedMeta.colSlug || dirParts[dirParts.length - 2] || 'general')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_');
  const bookSlug = (options.bookSlug || mergedMeta.slug || dirParts[dirParts.length - 1] || 'book')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_');

  const modules: Record<string, ModuleItemConfig> =
    mergedMeta.modules && Object.keys(mergedMeta.modules).length > 0
      ? mergedMeta.modules
      : DEFAULT_ACADEMIC_MODULES;

  const trackClasses =
    Array.isArray(mergedMeta.trackClasses) && mergedMeta.trackClasses.length > 0
      ? mergedMeta.trackClasses
      : DEFAULT_TRACK_CLASSES;

  const manifest: AstroBookManifest = {
    schemaVersion: ABP_SCHEMA_VERSION,
    id: `${colSlug}-${bookSlug}`,
    slug: bookSlug,
    colSlug,
    title: mergedMeta.title || bookSlug,
    author: mergedMeta.author || 'AstroLib',
    publisher: mergedMeta.publisher,
    isbn: mergedMeta.isbn,
    edition: mergedMeta.edition,
    stage: mergedMeta.stage,
    stageLabel: mergedMeta.stageLabel,
    category: mergedMeta.category || 'textbook',
    categoryLabel: mergedMeta.categoryLabel || '教材',
    subject: mergedMeta.subject || colSlug,
    subjectLabel: mergedMeta.subjectLabel || '理学',
    description: mergedMeta.description || '',
    tags: mergedMeta.tags || [],
    cover: mergedMeta.cover,
    entryPoint: mergedMeta.entryPoint || '',
    trackClasses,
    notices: mergedMeta.notices,
    languages: mergedMeta.languages,
    modules,
    sections: [],
    totalChapters: 0,
    updatedAt: new Date().toISOString(),
    contentHash: '',
    assets: [],
    sourceFormat: mergedMeta.sourceFormat || 'abp',
    readingProfile: mergedMeta.readingProfile || 'academic',
    language: mergedMeta.language || 'zh-CN',
  };

  // 2. 扫描并编译全部章节
  const chapterFiles = findChapterFiles(resolvedDir);
  if (chapterFiles.length === 0) {
    throw new Error(`未在目录 ${bookDir} 中找到任何 .mdx 或 .md 章节文件`);
  }

  const chapterPayloads: Record<string, AstroBookChapterPayload> = {};
  const summaryMap = new Map<string, AstroBookChapterSummary>();
  const chapterRecords: Array<{ cFile: string; slug: string; title: string; rawContent: string }> = [];
  const allBookChunks: Array<any> = [];
  let combinedHashData = '';
  const seenChapterSlugs = new Set<string>();

  for (let orderIdx = 0; orderIdx < chapterFiles.length; orderIdx++) {
    const cFile = chapterFiles[orderIdx];
    const fullPath = path.join(resolvedDir, cFile);
    const rawContent = fs.readFileSync(fullPath, 'utf8');
    const { frontmatter, body } = parseFrontmatter(rawContent);
    const rawChapterSlug = cFile.replace(/\.(mdx|md)$/i, '');
    let chapterSlug = cleanSlug(rawChapterSlug);
    if (!chapterSlug) {
      chapterSlug = `chapter-${orderIdx + 1}`;
    }
    if (seenChapterSlugs.has(chapterSlug)) {
      chapterSlug = `${chapterSlug}-${orderIdx + 1}`;
    }
    seenChapterSlugs.add(chapterSlug);

    const legacySlug = rawChapterSlug !== chapterSlug ? rawChapterSlug : undefined;
    const chapterTitle = frontmatter.title || path.basename(rawChapterSlug);
    const chapterHash = computeHash(rawContent);
    combinedHashData += chapterHash;

    try {
      const fileChunks = chunkMdx({ source: rawContent, modules });
      for (const fc of fileChunks) {
        if (fc.text && fc.text.length > 5) {
          allBookChunks.push({
            id: `${chapterSlug}-${fc.anchor || allBookChunks.length}`,
            chapterSlug,
            title: fc.title,
            type: fc.type || '正文',
            number: fc.number || '',
            text: fc.text,
            anchor: fc.anchor,
          });
        }
      }
    } catch {}

    const compiled = compileMarkdownToSemanticResult(body, {
      colSlug: manifest.colSlug,
      bookSlug: manifest.slug,
      bookTitle: manifest.title,
      chapterSlug,
    });
    const html = compiled.html;
    const headings = collectHeadingsFromHtml(html);

    const payload: AstroBookChapterPayload = {
      schemaVersion: ABP_SCHEMA_VERSION,
      bookId: manifest.id,
      bookSlug: manifest.slug,
      colSlug: manifest.colSlug,
      chapterSlug,
      title: chapterTitle,
      html,
      headings,
      ...(Object.keys(compiled.footnotes).length > 0 ? { footnotes: compiled.footnotes } : {}),
      readingTimeMinutes: Math.max(1, Math.round(body.length / 450)),
      updatedAt: manifest.updatedAt,
    };

    chapterPayloads[chapterSlug] = payload;
    chapterRecords.push({ cFile, slug: chapterSlug, title: chapterTitle, rawContent });

    const summary: AstroBookChapterSummary = {
      id: `ch-${chapterSlug}`,
      title: chapterTitle,
      slug: chapterSlug,
      sourcePath: cFile,
      path: `chapters/${chapterSlug}.json`,
      hash: chapterHash,
      sizeBytes: Buffer.byteLength(JSON.stringify(payload), 'utf8'),
      order: orderIdx,
    };
    if (legacySlug) summary.legacySlug = legacySlug;
    summaryMap.set(cFile, summary);
  }

  manifest.sections = buildHierarchicalSections(chapterFiles, summaryMap, mergedMeta.sections);

  // 处理独立章首导语文件 (chapter-intro)：标记 chapterKind 并挂载到该章第一节的 chapterIntro
  for (const sec of manifest.sections) {
    if (sec.introSlug && chapterPayloads[sec.introSlug]) {
      const introPayload = chapterPayloads[sec.introSlug];
      introPayload.chapterKind = 'chapter-intro';
      if (sec.chapters.length > 0) {
        const firstSlug = sec.chapters[0].slug;
        const targetPayload = chapterPayloads[firstSlug];
        if (targetPayload) {
          targetPayload.chapterIntro = {
            title: introPayload.title,
            html: introPayload.html,
            slug: introPayload.chapterSlug,
          };
          if (introPayload.footnotes && Object.keys(introPayload.footnotes).length > 0) {
            targetPayload.footnotes = {
              ...introPayload.footnotes,
              ...(targetPayload.footnotes || {}),
            };
          }
          // 同步更新 summary sizeBytes
          const firstSummary = sec.chapters[0];
          firstSummary.sizeBytes = Buffer.byteLength(JSON.stringify(targetPayload), 'utf8');
        }
      }
    }
  }

  // 解析 entryPoint（确保精确命中 chapters 映射，默认优先落在可导航章节而非孤立导语）
  const firstNavigableSlug =
    manifest.sections.flatMap((s) => s.chapters)[0]?.slug || chapterRecords[0].slug;
  if (manifest.entryPoint) {
    const requested = manifest.entryPoint.replace(/\.(mdx|md)$/i, '');
    if (chapterPayloads[requested]) {
      manifest.entryPoint = requested;
    } else if (chapterPayloads[cleanSlug(requested)]) {
      manifest.entryPoint = cleanSlug(requested);
    } else {
      const byBasename = chapterRecords.find((r) => path.basename(r.cFile, path.extname(r.cFile)) === requested);
      if (byBasename) {
        manifest.entryPoint = byBasename.slug;
      } else {
        warnings.push(`指定的 entryPoint "${manifest.entryPoint}" 未匹配任何章节，已自动回退为 "${firstNavigableSlug}"`);
        manifest.entryPoint = firstNavigableSlug;
      }
    }
  } else {
    manifest.entryPoint = firstNavigableSlug;
  }

  manifest.totalChapters = chapterRecords.length;
  manifest.contentHash = computeHash(combinedHashData);

  // 3. 收集 images/ 资产并内嵌封面
  const imagesDir = path.join(resolvedDir, 'images');
  const assetBuffers: Record<string, string> = {};
  let detectedCoverRel: string | null = null;
  if (fs.existsSync(imagesDir)) {
    for (const imgName of fs.readdirSync(imagesDir)) {
      const imgPath = path.join(imagesDir, imgName);
      if (fs.statSync(imgPath).isFile()) {
        const relAssetPath = `images/${imgName}`;
        manifest.assets!.push(relAssetPath);
        assetBuffers[relAssetPath] = fs.readFileSync(imgPath).toString('base64');
        if (/^cover\.(jpg|jpeg|png|webp)$/i.test(imgName)) {
          detectedCoverRel = relAssetPath;
        }
      }
    }
  }

  if (detectedCoverRel && (!manifest.cover || manifest.cover.startsWith('images/') || manifest.cover.startsWith('/covers/'))) {
    manifest.cover = `/abp-packs/${manifest.id}/${detectedCoverRel}`;
  }

  // 4. 可选向量化与附属索引
  let embeddingAsset: AbpBundlePayload['embeddings'] = null;
  if (withVectors && allBookChunks.length > 0) {
    try {
      const transformersMod: any = await import('@huggingface/transformers');
      const pipe = await transformersMod.pipeline('feature-extraction', 'Xenova/bge-small-zh-v1.5', {
        dtype: 'q8',
        device: 'cpu',
      });
      const vectors: Float32Array[] = [];
      for (const c of allBookChunks) {
        const textToEncode = `${c.title}。${String(c.text || '').slice(0, 300)}`;
        const out = await pipe(textToEncode, { pooling: 'cls', normalize: true });
        vectors.push(new Float32Array(out.data));
      }
      const { buffer: vecBuf, dim, count } = serializeEmbeddingsBinary(vectors, vectorFormat);
      const binBuffer = Buffer.isBuffer(vecBuf) ? vecBuf : Buffer.from(new Uint8Array(vecBuf));
      const generatedAt = new Date().toISOString();
      manifest.hasEmbeddings = true;
      manifest.embeddingMeta = {
        model: 'Xenova/bge-small-zh-v1.5',
        dim,
        format: vectorFormat,
        vectorCount: count,
        generatedAt,
      };
      embeddingAsset = {
        binaryBase64: binBuffer.toString('base64'),
        meta: {
          model: 'Xenova/bge-small-zh-v1.5',
          dim,
          format: vectorFormat,
          count,
          chunks: allBookChunks,
          generatedAt,
        },
      };
    } catch (err: any) {
      warnings.push(`离线向量化已跳过: ${err?.message || String(err)}`);
    }
  }

  let aiIndex: Record<string, unknown> | null = null;
  let crossRefs: Record<string, unknown> | null = null;
  let relationGraph: Record<string, unknown> | null = null;
  let inspectorData: Record<string, unknown> | null = null;

  if (includeAuxiliary) {
    try {
      const aux = buildWorkspaceAuxiliaryData({
        bookDir: resolvedDir,
        colSlug: manifest.colSlug,
        bookSlug: manifest.slug,
        title: manifest.title,
        modules,
        chapterRecords,
      });
      aiIndex = aux.aiIndex as unknown as Record<string, unknown>;
      crossRefs = aux.crossRefs as unknown as Record<string, unknown>;
      relationGraph = aux.relationGraph as unknown as Record<string, unknown>;
      inspectorData = aux.inspectorData as unknown as Record<string, unknown>;
    } catch (err: any) {
      warnings.push(`附属索引构建异常: ${err?.message || String(err)}`);
    }
  }

  // 5. 组装并落盘前强制契约校验
  const fullBundle: AbpBundlePayload = {
    manifest,
    chapters: chapterPayloads,
    assets: assetBuffers,
    embeddings: embeddingAsset,
    aiIndex,
    relationGraph,
    crossRefs,
    inspectorData,
    exercises: null,
  };

  validateInstallPayload(fullBundle);

  // 6. 原子写入 .abp 单文件包与可选展开目录
  const resolvedOutDir = path.resolve(outDir);
  fs.mkdirSync(resolvedOutDir, { recursive: true });

  let expandedDir: string | null = null;
  if (writeExpanded) {
    const bookOutDir = path.join(resolvedOutDir, manifest.id);
    const chaptersOutDir = path.join(bookOutDir, 'chapters');
    if (fs.existsSync(chaptersOutDir)) {
      fs.rmSync(chaptersOutDir, { recursive: true, force: true });
    }
    fs.mkdirSync(chaptersOutDir, { recursive: true });
    fs.writeFileSync(path.join(bookOutDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

    for (const [slug, payload] of Object.entries(chapterPayloads)) {
      const chapJsonFile = path.join(chaptersOutDir, `${slug}.json`);
      fs.mkdirSync(path.dirname(chapJsonFile), { recursive: true });
      fs.writeFileSync(chapJsonFile, JSON.stringify(payload, null, 2), 'utf8');
    }

    if (Object.keys(assetBuffers).length > 0) {
      const assetsOutDir = path.join(bookOutDir, 'images');
      fs.mkdirSync(assetsOutDir, { recursive: true });
      for (const [relPath, b64] of Object.entries(assetBuffers)) {
        fs.writeFileSync(path.join(assetsOutDir, path.basename(relPath)), Buffer.from(b64, 'base64'));
      }
    }

    if (aiIndex) fs.writeFileSync(path.join(bookOutDir, 'ai-index.json'), JSON.stringify(aiIndex), 'utf8');
    if (crossRefs) fs.writeFileSync(path.join(bookOutDir, 'cross-refs.json'), JSON.stringify(crossRefs), 'utf8');
    if (relationGraph) fs.writeFileSync(path.join(bookOutDir, 'relation-graph.json'), JSON.stringify(relationGraph), 'utf8');
    if (inspectorData) fs.writeFileSync(path.join(bookOutDir, 'inspector-data.json'), JSON.stringify(inspectorData), 'utf8');
    if (embeddingAsset?.binaryBase64) {
      fs.writeFileSync(path.join(bookOutDir, 'embeddings.bin'), Buffer.from(embeddingAsset.binaryBase64, 'base64'));
    }
    if (embeddingAsset?.meta) {
      fs.writeFileSync(path.join(bookOutDir, 'embeddings.meta.json'), JSON.stringify(embeddingAsset.meta, null, 2), 'utf8');
    }

    expandedDir = bookOutDir;
  }

  const bundleJson = JSON.stringify(fullBundle);
  const abpBuffer = zlib.gzipSync(Buffer.from(bundleJson, 'utf8'), { level: 9 });
  const abpPath = path.join(resolvedOutDir, `${manifest.id}.abp`);
  const tmpAbpPath = `${abpPath}.tmp.${process.pid}`;
  fs.writeFileSync(tmpAbpPath, abpBuffer);
  fs.renameSync(tmpAbpPath, abpPath);

  return {
    manifest,
    abpPath,
    expandedDir,
    sizeBytes: abpBuffer.length,
    totalChapters: manifest.totalChapters,
    totalAssets: manifest.assets?.length || 0,
    warnings,
  };
}
