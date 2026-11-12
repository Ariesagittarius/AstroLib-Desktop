#!/usr/bin/env node
/**
 * scripts/pack-book-abp.mjs
 * ============================================================================
 * AstroLib 官方标准 ABP 内容包编译器 (AstroBook Package Compiler)
 * ============================================================================
 * 职责：
 * 1. 扫描目标书籍 MDX/Markdown 章节与图片资产目录；
 * 2. 运行 AstroLib 同款编译管线：
 *    - KaTeX 纯 HTML 预渲染 (output: html, 源码回填 data-latex)；
 *    - 提取标题大纲 (TOC Headings)；
 *    - 卡片类名与结构化元数据提取；
 * 3. 产出：
 *    - 散列流式分发目录：dist/abp-packs/{colSlug}-{bookSlug}/
 *    - 单文件离线归档包：dist/abp-packs/{colSlug}-{bookSlug}.abp (Gzip 压缩)
 * ============================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import katex from 'katex';
import { marked } from 'marked';
import { renderTitleHtml } from '../src/utils/render-title.ts';
import { cleanSlug } from '../src/utils/slug.ts';
import { ABP_SCHEMA_VERSION } from '../src/types/content-package.ts';
import { getCatalogCollections } from '../src/config/collections.config.ts';
import { resolveAbpArtifactsDir, resolveBookSourceDir, CONTENT_CATALOG_REL } from '../src/core/catalog/content-paths.ts';
import { buildBookIndex } from '../src/ai/indexer.mjs';
import { generateBookRelationGraph } from '../src/features/relation-graph/core/generator.mjs';
import { buildGlobalBlockIndex } from '../src/core/indexing/cross-ref-indexer.mjs';
import { scanBookModules } from '../src/features/module-inspector/core/scanner.mjs';
import { chunkMdx } from '../src/ai/chunker.mjs';
import { serializeEmbeddingsBinary } from '../src/features/search-rec/services/storage.ts';
import { SUPPORTED_EXERCISE_BOOKS } from './build-exercise-data.mjs';
import {
  DEFAULT_DESKTOP_RELEASE_REPO,
  buildReleaseCatalogUrl,
  buildReleasePackUrl,
  normalizeReleaseRepo,
} from '../src/config/release.config.ts';

const SUPPORTED_EXERCISE_SLUGS = new Set(SUPPORTED_EXERCISE_BOOKS.map((b) => b.slug));

// 嵌入模型 Pipeline 单例缓存 (避免重复加载)
let embeddingPipelineInstance = null;
async function getEmbeddingPipeline() {
  if (!embeddingPipelineInstance) {
    let transformersMod;
    try {
      transformersMod = await import('@huggingface/transformers');
    } catch {
      const nodeImport = new Function('m', 'return import(m)');
      transformersMod = await nodeImport('@huggingface/transformers');
    }
    const { pipeline } = transformersMod;
    embeddingPipelineInstance = await pipeline('feature-extraction', 'Xenova/bge-small-zh-v1.5', {
      dtype: 'q8',
      device: 'cpu',
    });
  }
  return embeddingPipelineInstance;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

function computeHash(content) {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

function parseFrontmatter(rawContent) {
  const fmMatch = rawContent.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!fmMatch) {
    return { frontmatter: {}, body: rawContent };
  }
  const fmBlock = fmMatch[1];
  const body = rawContent.slice(fmMatch[0].length);
  const frontmatter = {};

  for (const line of fmBlock.split('\n')) {
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

/**
 * 极简且稳健的 KaTeX 行内与块级公式预渲染器 (保留 data-latex 源码回填)
 */
function renderKatexMathInMarkdown(content) {
  // 1. 处理块级公式 $$ ... $$
  let processed = content.replace(/\$\$([\s\S]*?)\$\$/g, (match, tex) => {
    try {
      const cleanTex = tex.trim();
      const rendered = katex.renderToString(cleanTex, {
        displayMode: true,
        output: 'html',
        strict: false,
        throwOnError: false,
      });
      const encodedTex = encodeURIComponent(cleanTex);
      return `<div class="katex-display-container" data-latex="${encodedTex}">${rendered}</div>`;
    } catch {
      return match;
    }
  });

  // 2. 处理行内公式 $ ... $ (跳过代码块和已处理的 html)
  processed = processed.replace(/(?<!\\)\$([^\$\n\r]+?)\$/g, (match, tex) => {
    try {
      const cleanTex = tex.trim();
      const rendered = katex.renderToString(cleanTex, {
        displayMode: false,
        output: 'html',
        strict: false,
        throwOnError: false,
      });
      const encodedTex = encodeURIComponent(cleanTex);
      return `<span class="katex-inline-container" data-latex="${encodedTex}">${rendered}</span>`;
    } catch {
      return match;
    }
  });

  return processed;
}

/**
 * 提取 Markdown 中的 H1-H4 标题作为大纲树
 */
function extractHeadings(content) {
  const headings = [];
  const lines = content.split('\n');
  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      const depth = headingMatch[1].length;
      const rawText = headingMatch[2].trim();
      // 生成干净的纯文本 ID，去除 HTML 标签，保留数学变量字母
      const plainText = rawText.replace(/\$([^$]+)\$/g, '$1').replace(/<[^>]+>/g, '').trim();
      const id = plainText.toLowerCase().replace(/[^\w\u4e00-\u9fa5-]+/g, '-').replace(/^-+|-+$/g, '') || `heading-${headings.length + 1}`;
      headings.push({ depth, text: rawText, id });
    }
  }
  return headings;
}

/**
 * 将 Markdown 转换为具备学术卡片、KaTeX 预渲染与标准语义的 HTML
 */
function compileMarkdownToSemanticHtml(body, { colSlug = '', bookSlug = '', bookTitle = '' } = {}) {
  // 1. 彻底剔除 MDX 开头及内部任何 import 语句 (无论多行、单行或分号拼接)
  let cleaned = body
    .replace(/import\s+[^;]+;\s*/g, '')
    .replace(/^import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '')
    .trim();

  // 2. 规范化填空题下划线（单趟正则转换，彻底杜绝嵌套二次替换）
  cleaned = cleaned.replace(/(?:\\_){2,}|_{3,}/g, '<span class="fill-in-blank">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>');

  // 3. 保护数学公式 (KaTeX)
  const mathPlaceholders = [];
  cleaned = cleaned.replace(/\$\$([\s\S]*?)\$\$/g, (_match, tex) => {
    const idx = mathPlaceholders.length;
    try {
      const cleanTex = tex.trim();
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
      mathPlaceholders.push({ rawTex: tex, html: _match });
    }
    return `%%%MATH_BLOCK_${idx}%%%`;
  });

  cleaned = cleaned.replace(/(?<!\\)\$([^\$\n\r]+?)\$/g, (_match, tex) => {
    const idx = mathPlaceholders.length;
    try {
      const cleanTex = tex.trim();
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
      mathPlaceholders.push({ rawTex: tex, html: _match });
    }
    return `%%%MATH_INLINE_${idx}%%%`;
  });

  // 4. 图片 Markdown 语法转换 ![]() 与 <img> 标签规范化为绝对路由
  // 4.1 先处理已经在 <figure ...> 内部的 ![]() 语法，避免外层已有 figure 时产生嵌套破坏语义
  cleaned = cleaned.replace(/(<figure[^>]*>[\s\S]*?)!\[([\s\S]*?)\]\s*\(([\s\S]*?)\)([\s\S]*?<\/figure>)/gi, (_m, pre, alt, src, post) => {
    const cleanAlt = (alt || '').trim();
    const cleanSrc = (src || '').trim();
    let finalSrc = cleanSrc;
    if (colSlug && bookSlug && (cleanSrc.startsWith('images/') || cleanSrc.startsWith('./images/') || !cleanSrc.startsWith('/'))) {
      const fileName = path.basename(cleanSrc);
      finalSrc = `/collections/${colSlug}/${bookSlug}/images/${fileName}`;
    }
    return `${pre}<img src="${finalSrc}" alt="${cleanAlt}" loading="lazy" />${post}`;
  });

  // 4.2 处理独立的 ![]() Markdown 语法
  cleaned = cleaned.replace(/!\[([\s\S]*?)\]\s*\(([\s\S]*?)\)/g, (_m, alt, src) => {
    const cleanAlt = (alt || '').trim();
    const cleanSrc = (src || '').trim();
    let finalSrc = cleanSrc;
    if (colSlug && bookSlug && (cleanSrc.startsWith('images/') || cleanSrc.startsWith('./images/') || !cleanSrc.startsWith('/'))) {
      const fileName = path.basename(cleanSrc);
      finalSrc = `/collections/${colSlug}/${bookSlug}/images/${fileName}`;
    }
    return `<figure class="content-figure"><img src="${finalSrc}" alt="${cleanAlt}" loading="lazy" />${cleanAlt ? `<figcaption>${cleanAlt}</figcaption>` : ''}</figure>`;
  });

  // 4.3 处理 <img> 标签的本地路径规范化
  cleaned = cleaned.replace(/<img\s+([^>]*?)src=["'](\.?\/?images\/[^"']+)["']([^>]*)>/gi, (_m, pre, src, post) => {
    const fileName = path.basename(src);
    const finalSrc = colSlug && bookSlug ? `/collections/${colSlug}/${bookSlug}/images/${fileName}` : `/images/${fileName}`;
    return `<img ${pre}src="${finalSrc}"${post}>`;
  });

  // 5. 转换 Astro MDX 自定义卡片组件为标准 Semantic Card DOM (携带 toc-chunk 与 data-title)
  const cardPlaceholders = [];

  // 5.1 优先处理可折叠【解】组件 (<Solution>)
  const solutionRe = /<Solution(?:\s+title=(?:\{["']([^"']+)["']\}|["']([^"']+)["']))?[^>]*>([\s\S]*?)<\/Solution>/gi;
  cleaned = cleaned.replace(solutionRe, (_m, t1, t2, content) => {
    const rawTitle = t1 || t2 || '查看解析与步骤';
    let plainTitle = rawTitle.replace(/%%%MATH_(?:BLOCK|INLINE)_(\d+)%%%/g, (_, idx) => mathPlaceholders[Number(idx)]?.rawTex || '');
    plainTitle = plainTitle.replace(/<[^>]+>/g, '').trim();
    const cleanId = plainTitle.toLowerCase().replace(/[^\w\u4e00-\u9fa5-]+/g, '-').replace(/^-+|-+$/g, '') || `solution-${cardPlaceholders.length}`;

    let titleWithMath = rawTitle.replace(/%%%MATH_(?:BLOCK|INLINE)_(\d+)%%%/g, (_, idx) => mathPlaceholders[Number(idx)]?.html || '');
    const titleHtml = rawTitle.includes('%%%MATH_') ? titleWithMath : renderTitleHtml(titleWithMath);

    const bodyHtml = marked.parse(content.trim(), { gfm: true, breaks: true });
    const solutionHtml = `<details class="solution-details" data-title="${plainTitle}" id="${cleanId}"><summary>${titleHtml}</summary><div class="solution-content">${bodyHtml}</div></details>`;
    const idx = cardPlaceholders.length;
    cardPlaceholders.push(solutionHtml);
    return `\n\n%%%CARD_${idx}%%%\n\n`;
  });

  // 5.2 处理数字资源组件 (<DigitalResource> 与 <QRCodeVideo>)
  const digitalResourceRe = /<(?:DigitalResource|QRCodeVideo)\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:DigitalResource|QRCodeVideo)>)/gi;
  cleaned = cleaned.replace(digitalResourceRe, (_m, attrsStr) => {
    const getAttr = (name) => {
      const match = attrsStr.match(new RegExp(`${name}=(?:["']([^"']*)["']|\\{["']([^"']*)["']\\})`, 'i'));
      return match ? (match[1] || match[2] || '').trim() : '';
    };
    const id = getAttr('id');
    const title = getAttr('title');
    const url = getAttr('url');
    const type = getAttr('type') || 'auto';

    let cleanTitle = title.replace(/^二维码\s*\d+(\.\d+)*\s*/, '').replace(/[\.\。\s]+$/, '').trim();
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

    const iconSvg = iconKind === 'video'
      ? `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/></svg>`
      : iconKind === 'courseware'
      ? `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>`
      : `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/></svg>`;

    const escapedUrl = url.replace(/"/g, '&quot;');
    const escapedTitle = displayTitle.replace(/"/g, '&quot;');
    const linkHtml = url
      ? `<a href="${escapedUrl}" target="_blank" rel="noopener noreferrer" class="academic-resource-title-link" title="打开数字资源: ${escapedTitle}"><span class="academic-resource-title-text">${displayTitle}</span><span class="academic-resource-link-arrow" aria-hidden="true"> ↗</span></a>`
      : `<span class="academic-resource-title-plain">${displayTitle}</span>`;

    const copyBtnHtml = url
      ? `<span class="academic-resource-actions academic-resource-trigger-wrapper qr-trigger-wrapper"><button type="button" class="academic-resource-action-btn js-copy-resource-url" data-url="${escapedUrl}" aria-label="复制资源链接" title="复制链接"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" /></svg></button></span>`
      : '';

    const resHtml = `<div class="academic-digital-resource academic-resource-card qr-video-card not-content" data-res-type="${iconKind}"><div class="academic-resource-stream"><div class="academic-resource-lead"><span class="academic-resource-media-icon" aria-hidden="true">${iconSvg}</span><span class="academic-resource-prefix">${displayTag}</span>${linkHtml}</div>${copyBtnHtml}</div></div>`;
    const idx = cardPlaceholders.length;
    cardPlaceholders.push(resHtml);
    return `\n\n%%%CARD_${idx}%%%\n\n`;
  });

  // 5.3 处理课后习题入口卡片 (<ExerciseTrigger>)
  cleaned = cleaned.replace(/<ExerciseTrigger\s*([^>]*?)\/?>/gi, (_m, attrsStr) => {
    const getAttr = (name) => {
      const match = (attrsStr || '').match(new RegExp(`${name}=(?:["']([^"']*)["']|\\{["']?([^"']*)["']?\\})`, 'i'));
      return match ? (match[1] || match[2] || '').trim() : '';
    };
    const ch = getAttr('chapter') || '1';
    const sec = getAttr('section') || 'all';
    const rawTitle = getAttr('title') || (sec !== 'all' ? `第 ${sec} 节` : `第 ${ch} 章`);
    const cleanTitle = rawTitle.replace(/\s*(?:课后真题与自测练习|课后真题与即时自测练习|课后自测与真题练习|课后真题与练习|课后练习|自测练习)/g, '').trim();

    const bookTitleStr = bookTitle || '课本';
    const chipsHtml = `
      <button type="button" class="ex-bank-chip ft-m3-see-all-btn" data-exercise-trigger data-bank-id="bupt_math" data-chapter="${ch}" data-section="${sec}">
        <span>大邮数学集</span>
      </button>
      <button type="button" class="ex-bank-chip ft-m3-see-all-btn" data-exercise-trigger data-bank-id="textbook_exercises" data-chapter="${ch}" data-section="${sec}">
        <span>《${bookTitleStr}》课后习题</span>
      </button>
    `;

    const triggerHtml = `
      <div class="exercise-trigger-card not-content" role="complementary" aria-label="相关课后习题" data-exercise-trigger-card data-chapter="${ch}" data-section="${sec}" data-book="${bookSlug || ''}">
        <div class="exercise-trigger-info">
          <div class="exercise-trigger-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
              <polyline points="10 8 13 11 17 6" />
            </svg>
          </div>
          <div class="exercise-trigger-texts">
            <div class="exercise-trigger-title-row">
              <div class="exercise-trigger-title">${cleanTitle}</div>
            </div>
            <div class="exercise-chip-group">
              ${chipsHtml}
            </div>
          </div>
        </div>
      </div>
    `;
    const idx = cardPlaceholders.length;
    cardPlaceholders.push(triggerHtml);
    return `\n\n%%%CARD_${idx}%%%\n\n`;
  });

  // 5.4 处理 SideNote 旁注组件 (<SideNote>)
  cleaned = cleaned.replace(/<SideNote(?:[^>]*?)>([\s\S]*?)<\/SideNote>/gi, (_m, content) => {
    const bodyHtml = marked.parse(content.trim(), { gfm: true, breaks: true });
    const sideNoteHtml = `<aside class="academic-sidenote not-content"><div class="sidenote-content">${bodyHtml}</div></aside>`;
    const idx = cardPlaceholders.length;
    cardPlaceholders.push(sideNoteHtml);
    return `\n\n%%%CARD_${idx}%%%\n\n`;
  });

  // 5.5 处理标准学术卡片组件
  const cardConfigs = [
    { tag: 'Knowledge', cls: 'knowledge-card', defaultTitle: '知识要点' },
    { tag: 'Example', cls: 'example-card', defaultTitle: '例题' },
    { tag: 'Analysis', cls: 'analysis-card', defaultTitle: '分析' },
    { tag: 'Variant', cls: 'variant-card', defaultTitle: '变式' },
    { tag: 'Note', cls: 'note-card', defaultTitle: '注' },
    { tag: 'Block', cls: 'summary-card', defaultTitle: '知识板块' },
    { tag: 'Method', cls: 'method-card', defaultTitle: '方法总结' },
    { tag: 'Summary', cls: 'summary-card', defaultTitle: '总结' },
    { tag: 'Algorithm', cls: 'academic-algorithm', defaultTitle: '算法' },
    { tag: 'Exercise', cls: 'exercise-card', defaultTitle: '习题' },
  ];

  for (const { tag, cls, defaultTitle } of cardConfigs) {
    const re = new RegExp(`<${tag}(?:\\s+title=(?:\\{["']([^"']+)["']\\}|["']([^"']+)["']))?[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
    cleaned = cleaned.replace(re, (_m, t1, t2, content) => {
      const rawTitle = t1 || t2 || defaultTitle;
      let plainTitle = rawTitle.replace(/%%%MATH_(?:BLOCK|INLINE)_(\d+)%%%/g, (_, idx) => mathPlaceholders[Number(idx)]?.rawTex || '');
      plainTitle = plainTitle.replace(/<[^>]+>/g, '').trim();
      const cleanId = plainTitle.toLowerCase().replace(/[^\w\u4e00-\u9fa5-]+/g, '-').replace(/^-+|-+$/g, '') || `card-${cardPlaceholders.length}`;
      
      let titleWithMath = rawTitle.replace(/%%%MATH_(?:BLOCK|INLINE)_(\d+)%%%/g, (_, idx) => mathPlaceholders[Number(idx)]?.html || '');
      const titleHtml = rawTitle.includes('%%%MATH_') ? titleWithMath : renderTitleHtml(titleWithMath);

      const bodyHtml = marked.parse(content.trim(), { gfm: true, breaks: true });
      const cardHtml = `<div class="${cls} toc-chunk" data-title="${plainTitle}" id="${cleanId}"><div class="card-header" role="heading" aria-level="4"><span class="card-title-text">${titleHtml}</span></div><div class="card-body">${bodyHtml}</div></div>`;
      const idx = cardPlaceholders.length;
      cardPlaceholders.push(cardHtml);
      return `\n\n%%%CARD_${idx}%%%\n\n`;
    });
  }

  // 剔除空占位
  cleaned = cleaned.replace(/<Guide[^>]*\/>/gi, '');

  // 6. 使用 marked 完整编译外部 Markdown
  const renderer = {
    heading({ depth, text, tokens }) {
      const innerHtml = this.parser.parseInline(tokens);
      let plainText = text.replace(/%%%MATH_(?:BLOCK|INLINE)_(\d+)%%%/g, (_, idx) => mathPlaceholders[Number(idx)]?.rawTex || '');
      plainText = plainText.replace(/<[^>]+>/g, '').trim();
      const slug = plainText.toLowerCase().replace(/[^\w\u4e00-\u9fa5-]+/g, '-').replace(/^-+|-+$/g, '') || `heading-${depth}`;
      const anchorSvg = `<a class="anchor-link" href="#${slug}" aria-label="标题直链"><svg class="anchor-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></a>`;
      return `<h${depth} id="${slug}"><span>${innerHtml}</span>${anchorSvg}</h${depth}>\n`;
    }
  };

  marked.use({ renderer });
  let html = marked.parse(cleaned, { gfm: true, breaks: true });

  // 7. 递归还原卡片 HTML (彻底支持嵌套卡片，如 Exercise 内嵌 Solution)
  let prevHtml = '';
  while (html !== prevHtml && html.includes('%%%CARD_')) {
    prevHtml = html;
    html = html.replace(/<p>\s*%%%CARD_(\d+)%%%\s*<\/p>/g, (_m, idx) => cardPlaceholders[Number(idx)])
               .replace(/%%%CARD_(\d+)%%%/g, (_m, idx) => cardPlaceholders[Number(idx)]);
  }

  // 8. 递归还原 KaTeX 公式 (彻底支持卡片标题与卡片正文中的公式)
  prevHtml = '';
  while (html !== prevHtml && html.includes('%%%MATH_')) {
    prevHtml = html;
    html = html.replace(/%%%MATH_(BLOCK|INLINE)_(\d+)%%%/g, (_m, type, idx) => mathPlaceholders[Number(idx)]?.html || '');
  }

  return `<div class="astrolib-chapter-content">${html}</div>`;
}

/**
 * 编译单本图书为 ABP
 */
export async function packBook({
  bookDir,
  outDir,
  customManifest = null,
  withVectors = true,
  vectorFormat = 'int8',
  includeAuxiliary = true,
  releaseRepo = DEFAULT_DESKTOP_RELEASE_REPO,
  releaseTag = process.env.ASTROLIB_RELEASE_TAG || '',
}) {
  if (!fs.existsSync(bookDir)) {
    throw new Error(`目标书籍目录不存在: ${bookDir}`);
  }

  // 1. 推断合集与图书标识
  const resolvedDir = path.resolve(bookDir);
  const dirParts = resolvedDir.replace(/\\/g, '/').split('/');
  const bookSlug = dirParts[dirParts.length - 1];
  const colSlug = dirParts[dirParts.length - 2] || 'general';

  // 从唯一 SSOT 目录配置检索权威书籍元数据
  let existingBook = null;
  for (const col of getCatalogCollections()) {
    const found = (col.books || []).find((b) => b.slug === bookSlug && col.slug === colSlug)
      || (col.books || []).find((b) => b.slug === bookSlug);
    if (found) {
      existingBook = found;
      break;
    }
  }

  const manifest = {
    schemaVersion: ABP_SCHEMA_VERSION,
    id: `${colSlug}-${bookSlug}`,
    slug: bookSlug,
    colSlug: colSlug,
    title: existingBook?.title || customManifest?.title || bookSlug,
    author: existingBook?.author || customManifest?.author || 'AstroLib',
    publisher: existingBook?.publisher || customManifest?.publisher,
    isbn: existingBook?.isbn || customManifest?.isbn,
    edition: existingBook?.edition || customManifest?.edition,
    stage: existingBook?.stage || customManifest?.stage,
    stageLabel: existingBook?.stageLabel || customManifest?.stageLabel,
    category: existingBook?.category || customManifest?.category || 'textbook',
    categoryLabel: existingBook?.categoryLabel || customManifest?.categoryLabel || '教材',
    subject: existingBook?.subject || customManifest?.subject || colSlug,
    subjectLabel: existingBook?.subjectLabel || customManifest?.subjectLabel || '理学',
    description: existingBook?.description || customManifest?.description || '',
    tags: existingBook?.tags || customManifest?.tags || [],
    cover: existingBook?.cover || customManifest?.cover,
    entryPoint: existingBook?.entryPoint || customManifest?.entryPoint || '',
    trackClasses: (existingBook?.trackClasses && existingBook.trackClasses.length > 0) ? existingBook.trackClasses : ['.toc-chunk'],
    notices: existingBook?.notices || customManifest?.notices,
    languages: existingBook?.languages || customManifest?.languages,
    modules: (existingBook?.modules && Object.keys(existingBook.modules).length > 0)
      ? existingBook.modules
      : {
          '定理': { short: '理' },
          '定义': { short: '定' },
          '例题': { short: '例' },
          '习题': { short: '习' },
          '性质': { short: '性' },
          '推论': { short: '推' },
          '引理': { short: '引' },
          '命题': { short: '命' },
          '公理': { short: '公' },
          '方法': { short: '法' },
          '注': { short: '注' },
          '知识要点': { short: '知' },
          '知识板块': { short: '块' },
        },
    sections: [],
    totalChapters: 0,
    updatedAt: new Date().toISOString(),
    contentHash: '',
    assets: [],
  };

  // 2. 扫描所有 .md 与 .mdx 章节 (支持递归子目录，跳过 images)
  function findChapterFiles(dir, baseDir = dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    let results = [];
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
    return results.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  }

  const chapterFiles = findChapterFiles(resolvedDir);

  if (chapterFiles.length === 0) {
    throw new Error(`未在目录 ${bookDir} 中找到任何 .mdx 或 .md 章节文件！`);
  }

  const rawEntry = manifest.entryPoint || chapterFiles[0].replace(/\.(mdx|md)$/, '');
  manifest.entryPoint = cleanSlug(rawEntry);

  const chapterPayloads = {};
  const sectionChapters = [];
  const allBookChunks = [];
  let combinedHashData = '';

  for (const cFile of chapterFiles) {
    const fullPath = path.join(resolvedDir, cFile);
    const rawContent = fs.readFileSync(fullPath, 'utf8');
    const { frontmatter, body } = parseFrontmatter(rawContent);
    const rawChapterSlug = cFile.replace(/\.(mdx|md)$/, '');
    const chapterSlug = cleanSlug(rawChapterSlug);
    const legacySlug = rawChapterSlug !== chapterSlug ? rawChapterSlug : undefined;
    const chapterTitle = frontmatter.title || rawChapterSlug;
    const chapterHash = computeHash(rawContent);
    combinedHashData += chapterHash;

    // 提取学术卡片语义切片
    try {
      const fileChunks = chunkMdx({ source: rawContent, modules: manifest.modules || {} });
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

    const headings = extractHeadings(body);
    const html = compileMarkdownToSemanticHtml(body, {
      colSlug: manifest.colSlug,
      bookSlug: manifest.slug,
      bookTitle: manifest.title,
    });

    const payload = {
      schemaVersion: ABP_SCHEMA_VERSION,
      bookId: manifest.id,
      bookSlug: manifest.slug,
      colSlug: manifest.colSlug,
      chapterSlug: chapterSlug,
      title: chapterTitle,
      html: html,
      headings: headings,
      updatedAt: manifest.updatedAt,
    };

    chapterPayloads[chapterSlug] = payload;

    const summary = {
      id: `ch-${chapterSlug}`,
      title: chapterTitle,
      slug: chapterSlug,
      sourcePath: cFile,
      path: `chapters/${chapterSlug}.json`,
      hash: chapterHash,
      sizeBytes: Buffer.byteLength(JSON.stringify(payload), 'utf8'),
    };
    if (legacySlug) {
      summary.legacySlug = legacySlug;
    }
    sectionChapters.push(summary);
  }

  manifest.sections = [
    {
      id: 'section-main',
      title: '全部章节',
      slug: 'main',
      collapsed: false,
      chapters: sectionChapters,
    },
  ];
  manifest.totalChapters = sectionChapters.length;
  manifest.contentHash = computeHash(combinedHashData);

  // 3. 收集图片资产 (assets/)
  const imagesDir = path.join(resolvedDir, 'images');
  const assetBuffers = {};
  if (fs.existsSync(imagesDir)) {
    const imgFiles = fs.readdirSync(imagesDir);
    for (const imgName of imgFiles) {
      const imgPath = path.join(imagesDir, imgName);
      if (fs.statSync(imgPath).isFile()) {
        const relAssetPath = `images/${imgName}`;
        manifest.assets.push(relAssetPath);
        assetBuffers[relAssetPath] = fs.readFileSync(imgPath).toString('base64');
      }
    }
  }

  // 4. 输出散列流式分发目录（先清理旧章节防止历史未净化 slug 残留）
  const bookOutDir = path.join(outDir, `${manifest.colSlug}-${manifest.slug}`);
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
    for (const [relPath, base64Data] of Object.entries(assetBuffers)) {
      const fileName = path.basename(relPath);
      fs.writeFileSync(path.join(assetsOutDir, fileName), Buffer.from(base64Data, 'base64'));
    }
  }

  // 4.5 离线内置向量化与词法倒排表生成
  let embeddingAsset = null;
  if (withVectors && allBookChunks.length > 0) {
    try {
      process.stdout.write(`   - 正在向量化 ${allBookChunks.length} 个知识切片 (BGE-small-zh-v1.5 / ${vectorFormat})... `);
      const pipe = await getEmbeddingPipeline();
      const vectors = [];
      for (const c of allBookChunks) {
        const textToEncode = `${c.title}。${c.text.slice(0, 300)}`;
        const out = await pipe(textToEncode, { pooling: 'cls', normalize: true });
        vectors.push(new Float32Array(out.data));
      }

      const { buffer: vecBuf, dim, count } = serializeEmbeddingsBinary(vectors, vectorFormat);
      const binBuffer = Buffer.from(vecBuf);
      fs.writeFileSync(path.join(bookOutDir, 'embeddings.bin'), binBuffer);

      const metaJson = {
        model: 'Xenova/bge-small-zh-v1.5',
        dim,
        format: vectorFormat,
        count,
        chunks: allBookChunks,
        generatedAt: new Date().toISOString(),
      };
      fs.writeFileSync(path.join(bookOutDir, 'embeddings.meta.json'), JSON.stringify(metaJson, null, 2), 'utf8');

      manifest.hasEmbeddings = true;
      manifest.embeddingMeta = {
        model: 'Xenova/bge-small-zh-v1.5',
        dim,
        format: vectorFormat,
        vectorCount: count,
        generatedAt: metaJson.generatedAt,
      };
      fs.writeFileSync(path.join(bookOutDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

      embeddingAsset = {
        binaryBase64: binBuffer.toString('base64'),
        meta: metaJson,
      };
      console.log(`✔ 完成 (${(binBuffer.length / 1024).toFixed(1)} KB)`);
    } catch (e) {
      console.log(`⚠️ 向量化跳过: ${e.message}`);
    }
  }

  // 4.6 自包含书籍附属索引打包 (AI 索引 / 关系图谱 / 跨页引用 / 卡片巡检 / 可选题库切片)
  let aiIndex = null;
  let relationGraph = null;
  let crossRefs = null;
  let inspectorData = null;
  let exercisesBundle = null;

  if (includeAuxiliary) {
    try {
      aiIndex = buildBookIndex({
        colSlug: manifest.colSlug,
        bookSlug: manifest.slug,
        bookDir: resolvedDir,
        modules: manifest.modules || {},
        title: manifest.title,
      });
      fs.writeFileSync(path.join(bookOutDir, 'ai-index.json'), JSON.stringify(aiIndex), 'utf8');
    } catch (e) {
      console.warn(`   ⚠️ AI 索引生成跳过: ${e.message}`);
    }

    try {
      relationGraph = generateBookRelationGraph(manifest.colSlug, manifest.slug);
      if (relationGraph) {
        fs.writeFileSync(path.join(bookOutDir, 'relation-graph.json'), JSON.stringify(relationGraph), 'utf8');
      }
    } catch (e) {
      console.warn(`   ⚠️ 关系图谱生成跳过: ${e.message}`);
    }

    try {
      crossRefs = buildGlobalBlockIndex(manifest.colSlug, manifest.slug);
      if (crossRefs && Object.keys(crossRefs).length > 0) {
        fs.writeFileSync(path.join(bookOutDir, 'cross-refs.json'), JSON.stringify(crossRefs), 'utf8');
      }
    } catch (e) {
      console.warn(`   ⚠️ 跨页引用生成跳过: ${e.message}`);
    }

    try {
      inspectorData = scanBookModules(manifest.colSlug, manifest.slug);
      if (inspectorData?.ok) {
        fs.writeFileSync(path.join(bookOutDir, 'inspector-data.json'), JSON.stringify(inspectorData), 'utf8');
      }
    } catch (e) {
      console.warn(`   ⚠️ 模块巡检生成跳过: ${e.message}`);
    }

    // 若存在对应书目的编译题库切片，一并编入 .abp（唯一权威来源：artifacts/exercises/<slug>）
    const primaryExDir = path.join(ROOT, 'artifacts', 'exercises', manifest.slug);
    const legacyExDir = path.join(ROOT, 'public', 'data', 'exercises', manifest.slug);
    let exSrcDir = fs.existsSync(primaryExDir) ? primaryExDir : null;
    if (!exSrcDir && fs.existsSync(legacyExDir)) {
      console.warn(`   ⚠️ [DEPRECATED] 正在回退读取旧路径 ${path.relative(ROOT, legacyExDir)}，请改用 npm run build:exercises 生成 artifacts/exercises/`);
      exSrcDir = legacyExDir;
    }

    if (exSrcDir) {
      const exMap = {};
      const collectEx = (dir) => {
        for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, ent.name);
          if (ent.isDirectory()) collectEx(full);
          else if (ent.isFile() && ent.name.endsWith('.json')) {
            const rel = path.relative(exSrcDir, full).replace(/\\/g, '/');
            const content = fs.readFileSync(full, 'utf8');
            exMap[rel] = content;
            const dest = path.join(bookOutDir, 'exercises', rel);
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.writeFileSync(dest, content, 'utf8');
          }
        }
      };
      collectEx(exSrcDir);
      if (Object.keys(exMap).length > 0) {
        exercisesBundle = exMap;
      } else if (SUPPORTED_EXERCISE_SLUGS.has(manifest.slug)) {
        throw new Error(`支持题库的书籍 ${manifest.id} 在 ${exSrcDir} 下未找到任何 .json 题库切片`);
      }
    } else if (SUPPORTED_EXERCISE_SLUGS.has(manifest.slug)) {
      throw new Error(`支持题库的书籍 ${manifest.id} 缺少已编译题库目录: ${primaryExDir}，请先执行 npm run build:exercises`);
    } else {
      console.log(`   ℹ️ 题库状态 [unsupported]: ${manifest.id} 在 src/data/exercises/ 中无结构化题库，保持 exercises=null`);
    }
  }

  // 5. 原子输出单文件 .abp 离线归档包 (Gzip 压缩)
  const fullBundle = {
    manifest,
    chapters: chapterPayloads,
    assets: assetBuffers,
    embeddings: embeddingAsset,
    aiIndex,
    relationGraph,
    crossRefs,
    inspectorData,
    exercises: exercisesBundle,
  };
  const bundleJson = JSON.stringify(fullBundle);
  const abpBuffer = zlib.gzipSync(Buffer.from(bundleJson, 'utf8'), { level: 9 });
  const abpPath = path.join(outDir, `${manifest.colSlug}-${manifest.slug}.abp`);
  const abpTmpPath = `${abpPath}.tmp.${process.pid}`;
  fs.writeFileSync(abpTmpPath, abpBuffer);
  fs.renameSync(abpTmpPath, abpPath);

  const abpSizeMb = (abpBuffer.length / (1024 * 1024)).toFixed(2);
  console.log(`\n✅ 成功编译图书包: [${manifest.title}] (${manifest.id})`);
  console.log(`   - 章节总数: ${manifest.totalChapters} 篇`);
  console.log(`   - 散列目录: ${bookOutDir}`);
  console.log(`   - 单文件包: ${abpPath} (${abpSizeMb} MB)`);

  // 6. 增量更新/重新生成 outDir/catalog.json 与权威投影 content-sources/catalog.json
  updateCatalogJson(outDir, manifest, `${manifest.colSlug}-${manifest.slug}.abp`, abpBuffer.length, {
    releaseRepo,
    releaseTag,
  });

  return {
    manifest,
    abpPath,
    bookOutDir,
    sizeBytes: abpBuffer.length,
  };
}

/**
 * 原子更新或创建书库总清单 catalog.json
 */
export function updateCatalogJson(outDir, manifest, packFileName, sizeBytes, releaseOpts = {}) {
  const catalogPath = path.join(outDir, 'catalog.json');
  const releaseRepo = normalizeReleaseRepo(releaseOpts.releaseRepo || DEFAULT_DESKTOP_RELEASE_REPO);
  const releaseTag = String(releaseOpts.releaseTag || '').trim() || undefined;
  let catalog = {
    schemaVersion: ABP_SCHEMA_VERSION,
    catalogName: 'AstroLib Book Catalog',
    releaseRepo,
    ...(releaseTag ? { releaseTag } : {}),
    sourceUrl: buildReleaseCatalogUrl(releaseRepo, releaseTag),
    generatedBy: 'scripts/pack-book-abp.mjs',
    sourceInput: 'src/config/collections.config.ts#sourceCollections',
    generatedAt: new Date().toISOString(),
    books: [],
  };

  if (fs.existsSync(catalogPath)) {
    try {
      catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
      if (!Array.isArray(catalog.books)) catalog.books = [];
    } catch {}
  }

  const existingIdx = catalog.books.findIndex((b) => b.id === manifest.id);
  const entry = {
    id: manifest.id,
    slug: manifest.slug,
    colSlug: manifest.colSlug,
    title: manifest.title,
    author: manifest.author,
    edition: manifest.edition,
    category: manifest.category,
    subject: manifest.subject,
    description: manifest.description,
    cover: manifest.cover,
    entryPoint: manifest.entryPoint,
    totalChapters: manifest.totalChapters,
    sizeBytes: sizeBytes,
    packFileName: packFileName,
    remotePackUrl: buildReleasePackUrl(packFileName, releaseRepo, releaseTag),
    contentHash: manifest.contentHash,
    updatedAt: manifest.updatedAt,
  };

  if (existingIdx >= 0) {
    catalog.books[existingIdx] = entry;
  } else {
    catalog.books.push(entry);
  }

  catalog.schemaVersion = ABP_SCHEMA_VERSION;
  catalog.releaseRepo = releaseRepo;
  if (releaseTag) {
    catalog.releaseTag = releaseTag;
  } else {
    delete catalog.releaseTag;
  }
  catalog.sourceUrl = buildReleaseCatalogUrl(releaseRepo, releaseTag);
  catalog.generatedBy = 'scripts/pack-book-abp.mjs';
  catalog.sourceInput = 'src/config/collections.config.ts#sourceCollections';
  catalog.generatedAt = new Date().toISOString();
  const payload = JSON.stringify(catalog, null, 2);
  const tmpPath = `${catalogPath}.tmp.${process.pid}`;
  fs.writeFileSync(tmpPath, payload, 'utf8');
  fs.renameSync(tmpPath, catalogPath);
}

// CLI 执行入口
if (process.argv[1] && process.argv[1].endsWith('pack-book-abp.mjs')) {
  const args = process.argv.slice(2);
  const outArg = args.find((a) => a.startsWith('--out='))?.slice('--out='.length);
  const releaseRepoArg = args.find((a) => a.startsWith('--release-repo='))?.slice('--release-repo='.length);
  const releaseTagArg = args.find((a) => a.startsWith('--release-tag='))?.slice('--release-tag='.length);
  const releaseRepo = normalizeReleaseRepo(releaseRepoArg || DEFAULT_DESKTOP_RELEASE_REPO);
  const releaseTag = (releaseTagArg || process.env.ASTROLIB_RELEASE_TAG || '').trim();
  const outDir = outArg ? path.resolve(ROOT, outArg) : resolveAbpArtifactsDir(ROOT);
  fs.mkdirSync(outDir, { recursive: true });

  async function run() {
    const withVectors = !args.includes('--no-vectors');
    const includeAuxiliary = !args.includes('--no-auxiliary');
    const vectorFormat = args.includes('--format=float32') ? 'float32' : 'int8';

    if (args.includes('--all')) {
      console.log('📦 正在依据 SSOT 目录批量编译全站书籍为自包含 ABP 内容包...\n');
      const allBooks = [];
      for (const col of getCatalogCollections()) {
        for (const book of col.books || []) {
          const bookDir = resolveBookSourceDir(col.slug, book.slug, ROOT);
          if (!fs.existsSync(bookDir)) {
            throw new Error(`SSOT 目录书目源码缺失: ${bookDir}`);
          }
          allBooks.push({
            bookDir,
            title: `${col.slug}/${book.slug}`,
            id: `${col.slug}-${book.slug}`,
          });
        }
      }

      if (allBooks.length === 0) {
        throw new Error('SSOT 目录中没有任何可打包的书目！');
      }

      for (const b of allBooks) {
        console.log(`⏳ 正在打包: ${b.title}...`);
        await packBook({
          bookDir: b.bookDir,
          outDir,
          withVectors,
          vectorFormat,
          includeAuxiliary,
          releaseRepo,
          releaseTag,
        });
      }

      // 同步权威投影 content-sources/catalog.json
      const generatedCatalog = path.join(outDir, 'catalog.json');
      if (fs.existsSync(generatedCatalog)) {
        fs.copyFileSync(generatedCatalog, path.join(ROOT, CONTENT_CATALOG_REL));
      }

      console.log(`\n🎉 全站 ${allBooks.length} 本书籍已全部打包完成！`);
      console.log(`   - 产物目录: ${outDir}`);
      console.log(`   - 目录投影: ${path.join(ROOT, CONTENT_CATALOG_REL)}`);
    } else {
      const defaultDir = path.join('content-sources', 'collections', 'math', 'math_senior');
      const targetDir = args.find((a) => !a.startsWith('--')) || defaultDir;
      await packBook({
        bookDir: path.resolve(ROOT, targetDir),
        outDir,
        withVectors,
        vectorFormat,
        includeAuxiliary,
        releaseRepo,
        releaseTag,
      });
    }
  }

  run().catch((err) => {
    console.error('❌ 打包失败:', err);
    process.exit(1);
  });
}
