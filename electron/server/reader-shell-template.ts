/**
 * src/services/content-provider/reader-shell-template.ts
 * ============================================================================
 * Universal Reader Shell 页面合成引擎 (Universal Reader HTML Synthesizer)
 * ============================================================================
 * 职责：
 * 将 ABP 书籍清单 (manifest) 与章节有效负载 (payload) 合成入 AstroLib 预编译
 * 的完整 Starlight Master Shell (dist/reader-shell/index.html)。
 *
 * 核心设计原则（严禁 UI 降级）：
 * 1. 100% 保持 AstroLib 原版设计、全套 Vite 编译 CSS 与 Material You (M3) 主题；
 * 2. 完整保留顶部 HeaderOverride（搜索 Ctrl+K、双语助读 Alt+Y、关注点透镜 Alt+I、工具聚合菜单、
 *    日夜切换、快速设置对话框及其全部字体/排版/色彩/AI 配置）；
 * 3. 完整实现左侧多书目层级树状导航，支持多合集全部书籍检索与无缝切换阅读；
 * 4. 注入 MinerU OCR 警告提示条 NoticeFramework 与教材出版元数据 Chips（作者、出版社、书名、阶段学科、双语入口）；
 * 5. 完整保留右侧 Sideload Dock（本节大纲、课后习题、AI 书内问答、双语助读、关注点透镜）及右下角 AI FAB 浮动动作按钮；
 * 6. 严禁任何形式的 UI 降级或自造非官方简陋 HTML 模拟器。
 * ============================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import type { AstroBookManifest, AstroBookChapterPayload } from '../../src/types/content-package.ts';
import { renderTitleHtml } from '../../src/utils/render-title.ts';
import { getCatalogCollections } from '../../src/config/collections.config.ts';
import { cleanSlug } from '../../src/utils/slug.ts';
import { resolveAbpArtifactsDir } from '../../src/core/catalog/content-paths.ts';

function escapeHtml(str?: string | null): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeHtmlAttr(str?: string | null): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

let cachedTemplate: string | null = null;
let cachedTemplateMtime = 0;
let cachedTemplatePath = '';

/**
 * 检索并读取已编译的 Starlight Master Shell 模板文件
 */
function getMasterTemplate(distDir?: string): string | null {
  const candidates: string[] = [];
  if (distDir) {
    candidates.push(path.join(distDir, 'reader-shell', 'index.html'));
    candidates.push(path.join(distDir, 'guides', 'example', 'index.html'));
    candidates.push(path.join(distDir, 'dev', 'index.html'));
  }
  candidates.push(path.resolve(process.cwd(), 'dist', 'reader-shell', 'index.html'));
  candidates.push(path.resolve(process.cwd(), 'dist', 'guides', 'example', 'index.html'));
  candidates.push(path.resolve(process.cwd(), 'dist', 'dev', 'index.html'));

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        const stat = fs.statSync(candidate);
        if (cachedTemplate && cachedTemplatePath === candidate && cachedTemplateMtime === stat.mtimeMs) {
          return cachedTemplate;
        }
        const content = fs.readFileSync(candidate, 'utf8');
        cachedTemplate = content;
        cachedTemplatePath = candidate;
        cachedTemplateMtime = stat.mtimeMs;
        return content;
      }
    } catch {
      // 继续尝试下一个候选路径
    }
  }

  return null;
}

const abpManifestCache = new Map<string, AstroBookManifest | null>();

/**
 * 缓存读取全站任意图书的 ABP 清单
 */
function getBookManifestCached(colSlug: string, bookSlug: string, distDir?: string): AstroBookManifest | null {
  const key = `${colSlug}-${bookSlug}`;
  if (abpManifestCache.has(key)) return abpManifestCache.get(key) || null;

  const candidates: string[] = [];
  if (distDir) {
    candidates.push(path.join(distDir, 'abp-packs', key, 'manifest.json'));
  }
  candidates.push(path.join(resolveAbpArtifactsDir(), key, 'manifest.json'));

  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) {
        const parsed = JSON.parse(fs.readFileSync(c, 'utf8'));
        abpManifestCache.set(key, parsed);
        return parsed;
      }
    } catch {}
  }
  abpManifestCache.set(key, null);
  return null;
}

/**
 * 递归渲染书籍章节树（支持全学科所有图书展开与跳转）
 */
function renderBookChaptersTree(
  colSlug: string,
  bookSlug: string,
  sections: AstroBookManifest['sections'],
  currentChapterSlug?: string
): string {
  if (!sections || sections.length === 0) return '';
  return sections
    .map((sec) => {
      const isSingleGroup = sections.length === 1 && (sec.title === '全部章节' || sec.title === '默认分组');
      const chaptersList = sec.chapters
        .map((ch) => {
          const isActive = ch.slug === currentChapterSlug;
          const url = `/collections/${colSlug}/${bookSlug}/${ch.slug}/`;
          return `
            <li class="gdocs-outline-li">
              <a href="${url}" data-astro-prefetch="false" ${isActive ? 'aria-current="page"' : ''} class="gdocs-outline-link ${isActive ? 'is-active' : ''}">
                <span class="gdocs-link-text">${renderTitleHtml(ch.title)}</span>
              </a>
            </li>
          `;
        })
        .join('');

      if (isSingleGroup) {
        return chaptersList;
      }

      const hasActive = currentChapterSlug ? sec.chapters.some((ch) => ch.slug === currentChapterSlug) : false;
      return `
        <li class="gdocs-outline-li">
          <details class="gdocs-chapter-group" ${hasActive ? 'open' : ''}>
            <summary class="gdocs-chapter-summary">
              <span class="group-label"><span class="large">${renderTitleHtml(sec.title)}</span></span>
              <svg aria-hidden="true" class="caret" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="m14.83 11.29-4.24-4.24a1 1 0 1 0-1.42 1.41L12.71 12l-3.54 3.54a1 1 0 0 0 0 1.41 1 1 0 0 0 .71.29 1 1 0 0 0 .71-.29l4.24-4.24a1.002 1.002 0 0 0 0-1.42Z"/></svg>
            </summary>
            <ul>
              ${chaptersList}
            </ul>
          </details>
        </li>
      `;
    })
    .join('');
}

/**
 * 提取卡片小标题前缀标签 (Chip) 与编号/主体
 */
function parseCardTitle(rawTitle: string, modules: Record<string, any> = {}): { chip: string; number: string } {
  let clean = rawTitle.trim();
  const emojiRegex = /[\u{1F300}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\uFE0F]/gu;
  clean = clean.replace(emojiRegex, '').trim();

  for (const [modKey, modMeta] of Object.entries(modules)) {
    const aliases = (modMeta as any)?.aliases || [modKey];
    for (const alias of aliases) {
      if (clean === alias) {
        return { chip: (modMeta as any)?.short || modKey, number: '' };
      }
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`^(${escaped})(?:\\s+(.*)|\\s*(\\$?[\\d\\s\\.].*))?$`, 'i');
      const match = clean.match(regex);
      if (match) {
        const chip = (modMeta as any)?.short || modKey;
        const number = (match[2] || match[3] || '').trim();
        return { chip, number: number || clean };
      }
    }
  }

  const defaultMap: Record<string, string> = {
    '习题': '习题', '例题': '例', '例': '例', '定理': '定理', '定义': '定义',
    '引理': '引理', '性质': '性质', '推论': '推论', '命题': '命题', '公理': '公理',
    '算法': '算法', '方法': '方法', '要点': '要点', '知识': '知识点',
  };
  for (const [k, v] of Object.entries(defaultMap)) {
    if (clean.startsWith(k)) {
      const rest = clean.slice(k.length).trim();
      return { chip: v, number: rest || clean };
    }
  }

  return { chip: '', number: clean };
}

/**
 * 构建高保真结构化大纲树 (TOC) HTML，完整包含折叠分组、卡片 Chips 与数学公式
 */
function buildStructuredTocHtml(
  contentHtml: string,
  headings: Array<{ depth: number; text: string; id: string }>,
  modules: Record<string, any> = {}
): string {
  interface TocItem {
    kind: 'heading' | 'card';
    level?: number;
    id: string;
    text: string;
    rawTitle: string;
    chip?: string;
    number?: string;
    pos: number;
  }

  const items: TocItem[] = [];

  // 1. 匹配正文中的所有 H2, H3, H4 标题
  const headingRe = /<h([2-4])\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/h\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = headingRe.exec(contentHtml)) !== null) {
    const level = parseInt(match[1], 10);
    const id = match[2];
    const fullInner = match[3];
    const cleanInner = fullInner
      .replace(/<a[^>]*class="anchor-link"[\s\S]*?<\/a>/gi, '')
      .replace(/<[^>]+>/g, '')
      .trim();
    const rawTitle = cleanInner;
    items.push({
      kind: 'heading',
      level,
      id,
      text: cleanInner,
      rawTitle,
      pos: match.index,
    });
  }

  // 2. 匹配所有学术卡片 (.toc-chunk)，严格排除题解【解】、证明与解析折叠块
  const cardRe = /<(?:div|details)\s+[^>]*?class="([^"]*?toc-chunk[^"]*?)"[^>]*?data-title="([^"]+)"[^>]*?id="([^"]+)"/gi;
  while ((match = cardRe.exec(contentHtml)) !== null) {
    const cls = match[1];
    if (cls.includes('solution') || cls.includes('exercise-trigger')) {
      continue;
    }
    const rawTitle = match[2].trim();
    if (/^(?:解|证明|查看解析与步骤|查看解析|解析|分析)$/.test(rawTitle)) {
      continue;
    }

    const id = match[3];
    const { chip, number } = parseCardTitle(rawTitle, modules);
    items.push({
      kind: 'card',
      id,
      text: rawTitle,
      rawTitle,
      chip,
      number: number || rawTitle,
      pos: match.index,
    });
  }

  // 兜底：若 DOM 中未提取到任何 heading，使用 payload.headings 补充
  if (items.filter((i) => i.kind === 'heading').length === 0 && headings.length > 0) {
    headings.forEach((h, i) => {
      const cleanHeading = h.text.replace(/<[^>]+>/g, '').trim();
      items.push({
        kind: 'heading',
        level: h.depth,
        id: h.id,
        text: cleanHeading,
        rawTitle: cleanHeading,
        pos: i * 10,
      });
    });
  }

  items.sort((a, b) => a.pos - b.pos);

  // 3. 聚合为标题分组
  interface TocGroup {
    heading: TocItem | null;
    cards: TocItem[];
  }
  const groups: TocGroup[] = [];
  let curGroup: TocGroup = { heading: null, cards: [] };

  items.forEach((item) => {
    if (item.kind === 'heading') {
      if (curGroup.heading !== null || curGroup.cards.length > 0) {
        groups.push(curGroup);
      }
      curGroup = { heading: item, cards: [] };
    } else {
      curGroup.cards.push(item);
    }
  });
  if (curGroup.heading !== null || curGroup.cards.length > 0) {
    groups.push(curGroup);
  }

  if (groups.length === 0) {
    return '<li class="toc-loading">本节暂无大纲</li>';
  }

  // 4. 渲染 M3 规范的折叠面板与条目
  let out = '';
  for (const group of groups) {
    const cardsHtml = group.cards
      .map((c) => {
        const chipHtml = c.chip ? `<span class="toc-chip">${escapeHtml(c.chip)}</span>` : '';
        const titleHtml = renderTitleHtml(c.number || c.rawTitle);
        return `
          <li class="toc-item">
            <a href="#${encodeURIComponent(c.id)}" class="toc-link">
              ${chipHtml}
              <span class="toc-number">${titleHtml}</span>
            </a>
          </li>
        `;
      })
      .join('');

    if (group.heading) {
      const hLevel = group.heading.level || 2;
      const depthClass = hLevel === 2 ? 'depth-2' : hLevel === 3 ? 'depth-3' : 'depth-other';
      const headingTitleHtml = renderTitleHtml(group.heading.text);

      if (group.cards.length > 0) {
        out += `
          <li class="toc-group" data-collapsed="false">
            <div class="toc-heading-row">
              <button type="button" class="toc-collapse-btn" aria-label="折叠/展开「${escapeHtml(group.heading.rawTitle)}」板块" aria-expanded="true">
                <svg class="toc-caret-icon" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
                  <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>
                </svg>
              </button>
              <a href="#${encodeURIComponent(group.heading.id)}" class="toc-link ${depthClass}">
                <span class="toc-link-text">${headingTitleHtml}</span>
              </a>
            </div>
            <ul class="toc-sublist">
              ${cardsHtml}
            </ul>
          </li>
        `;
      } else {
        out += `
          <li class="toc-item ${depthClass}">
            <a href="#${encodeURIComponent(group.heading.id)}" class="toc-link ${depthClass}">
              <span class="toc-link-text">${headingTitleHtml}</span>
            </a>
          </li>
        `;
      }
    } else if (cardsHtml) {
      out += cardsHtml;
    }
  }

  return out;
}

/**
 * 将 ABP 书籍清单与章节内容注入至标准 Starlight 模板中
 */
export function renderReaderPageHtml(
  manifest: AstroBookManifest,
  payload: AstroBookChapterPayload,
  distDir?: string
): string {
  const masterTemplate = getMasterTemplate(distDir);

  // 1. 若无 Master Shell 模板（仅可能出现在未执行构建的单元测试环境中），安全降级
  if (!masterTemplate) {
    return renderFallbackShellHtml(manifest, payload);
  }

  let html = masterTemplate;

  const currentChapterSlug = payload.chapterSlug;
  const colSlug = manifest.colSlug;
  const bookSlug = manifest.slug;
  const pageTitle = `${payload.title} - ${manifest.title} - AstroLib`;

  // 确保 HTML 根节点包含桌面端避让类名、思源黑体默认偏好、两字缩进与 Material You 主题
  html = html.replace(
    /<html([^>]*)>/i,
    (_m, attrs) => {
      let cleanAttrs = attrs;
      if (!cleanAttrs.includes('is-electron')) {
        cleanAttrs = cleanAttrs.replace(/class="([^"]*)"/i, 'class="$1 is-electron is-electron-app"');
        if (!cleanAttrs.includes('is-electron')) {
          cleanAttrs += ' class="is-electron is-electron-app"';
        }
      }
      if (!cleanAttrs.includes('data-site-theme')) {
        cleanAttrs += ' data-site-theme="material-you"';
      }
      if (!cleanAttrs.includes('data-font-cjk')) {
        cleanAttrs += ' data-font-cjk="han-sans" data-font-latin="sans"';
      }
      if (!cleanAttrs.includes('data-paragraph-indent')) {
        cleanAttrs += ' data-paragraph-indent="true"';
      }
      return `<html${cleanAttrs}>`;
    }
  );

  // 2. 注入 Title 与 Meta 元数据
  html = html.replace(/<title>.*?<\/title>/i, () => `<title>${escapeHtml(pageTitle)}</title>`);
  html = html.replace(/<meta\s+name="description"\s+content="[^"]*"/i, () => `<meta name="description" content="${escapeHtml(manifest.description || payload.title)}"`);
  html = html.replace(/<meta\s+property="og:title"\s+content="[^"]*"/i, () => `<meta property="og:title" content="${escapeHtml(pageTitle)}"`);
  html = html.replace(/<meta\s+property="og:description"\s+content="[^"]*"/i, () => `<meta property="og:description" content="${escapeHtml(manifest.description || payload.title)}"`);
  html = html.replace(/<meta\s+name="twitter:title"\s+content="[^"]*"/i, () => `<meta name="twitter:title" content="${escapeHtml(pageTitle)}"`);

  // 3. 提取章节用于全局毫秒级瞬时搜索
  const searchCatalog: Array<{
    col: string;
    book: string;
    bookTitle: string;
    chapterSlug: string;
    chapterTitle: string;
    url: string;
  }> = [];

  for (const col of getCatalogCollections()) {
    for (const b of (col.books || [])) {
      const isCurrent = col.slug === colSlug && b.slug === bookSlug;
      const bManifest = isCurrent ? manifest : getBookManifestCached(col.slug, b.slug, distDir);
      if (bManifest?.sections) {
        for (const sec of bManifest.sections) {
          for (const ch of sec.chapters) {
            searchCatalog.push({
              col: col.slug,
              book: b.slug,
              bookTitle: b.title || bManifest.title,
              chapterSlug: ch.slug,
              chapterTitle: ch.title,
              url: `/collections/${col.slug}/${b.slug}/${ch.slug}/`,
            });
          }
        }
      }
    }
  }

  // 严格践行 AGENTS.md 规范与图3批注：“其他书目可以删去，只保留当前书目的目录”
  const currentBookChaptersTreeHtml = renderBookChaptersTree(
    colSlug,
    bookSlug,
    manifest.sections || [],
    currentChapterSlug
  );

  const sidebarTreeHtml = `
<sl-sidebar-state-persist data-hash="${escapeHtmlAttr(bookSlug)}" class="astro-f5yvicm7">
  <ul class="top-level current-book-sidebar">
    <li class="gdocs-book-li is-current-book">
      <div class="gdocs-current-book-header" style="padding: 0.65rem 0.85rem 0.5rem; font-weight: 600; font-size: 0.88rem; color: var(--sl-color-text-accent, var(--md-sys-color-primary)); display: flex; align-items: center; gap: 0.5rem; border-bottom: 1px solid var(--sl-color-hairline, rgba(0,0,0,0.06)); margin-bottom: 0.5rem;">
        <span class="gdocs-book-icon" aria-hidden="true" style="display: flex; align-items: center; flex-shrink: 0;">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
            <path d="M21 5c-1.11-.35-2.33-.5-3.5-.5-1.95 0-4.05.4-5.5 1.5-1.45-1.1-3.55-1.5-5.5-1.5S2.45 4.9 1 6v14.65c0 .25.25.5.5.5.1 0 .15-.05.25-.05C3.1 20.45 5.05 20 6.5 20c1.95 0 4.05.4 5.5 1.5 1.35-.85 3.8-1.5 5.5-1.5 1.65 0 3.35.3 4.75 1.05.1.05.15.05.25.05.25 0 .5-.25.5-.5V6c-.6-.45-1.25-.75-2-1zm-1 13.5c-1.1-.35-2.3-.5-3.5-.5-1.7 0-4.15.65-5.5 1.5V8c1.35-.85 3.8-1.5 5.5-1.5 1.2 0 2.4.15 3.5.5v11.5z"/>
          </svg>
        </span>
        <span class="gdocs-book-text" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${renderTitleHtml(manifest.title)}</span>
      </div>
      <div class="gdocs-book-outline">
        <ul class="top-level">
          ${currentBookChaptersTreeHtml}
        </ul>
      </div>
    </li>
  </ul>
</sl-sidebar-state-persist>
`;

  // 替换侧栏持久化树容器
  html = html.replace(/<sl-sidebar-state-persist[\s\S]*?<\/sl-sidebar-state-persist>/i, () => sidebarTreeHtml);

  // 4. 注入 MinerU OCR 警告提示条 NoticeFramework
  const noticeBannerHtml = `
<div class="astrolib-notice-framework" data-book-slug="${escapeHtml(bookSlug)}" role="complementary" aria-label="页面提示">
  <div class="astrolib-notice-card astrolib-notice-wiki severity-warning" id="notice-ocr" data-notice-id="ocr">
    <div class="wiki-main-row">
      <div class="wiki-icon-wrap" aria-hidden="true">
        <svg class="notice-svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="11" width="18" height="10" rx="3"></rect>
          <circle cx="12" cy="5" r="2"></circle>
          <path d="M12 7v4"></path>
          <line x1="8" y1="16" x2="8.01" y2="16" stroke-width="2.5"></line>
          <line x1="16" y1="16" x2="16.01" y2="16" stroke-width="2.5"></line>
          <path d="M9 19h6"></path>
        </svg>
      </div>
      <div class="wiki-content-col">
        <div class="wiki-text-line">
          <span class="wiki-msg-text">此文章出自以 MinerU OCR 为视觉模型的管线，存在排版与符号准确性问题，请谨慎鉴别。</span>
          <span class="wiki-tag">自动数字化</span>
        </div>
      </div>
      <div class="wiki-actions-col">
        <button type="button" class="notice-action-btn toggle-expand-btn" id="ocr-toggle-expand-btn" aria-label="折叠或展开详情" aria-expanded="false">
          <svg class="action-icon chevron-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
        </button>
      </div>
    </div>
    <div class="wiki-expand-panel" id="ocr-wiki-expand-panel" style="display: none;">
      <div class="wiki-expand-divider"></div>
      <ul class="wiki-items-list">
        <li class="wiki-list-item"><span class="wiki-item-text">我们在推进以 Gemini 3.5 Flash-Lite 为视觉模型的管线使用，并人工审核这些工作。若您发现排版或公式勘误，可通过项目内通道提交或联系作者。</span></li>
      </ul>
    </div>
  </div>
</div>
`;

  const hasOcrNotice = Array.isArray(manifest.notices) && manifest.notices.some((n: any) => {
    const id = typeof n === 'string' ? n : (n?.id || n?.preset || n?.template || '');
    return id.toLowerCase().includes('ocr') || id.toLowerCase().includes('mineru');
  });

  if (hasOcrNotice && !html.includes('id="notice-ocr"')) {
    html = html.replace(/(<main data-pagefind-body)/i, (_m, p1) => `${noticeBannerHtml}\n${p1}`);
  }

  // 5. 注入章节标题与 Material 3 元数据 Chips（作者、出版社、书名、阶段学科、双语助读）
  const stageSubjectLabel = [
    manifest.stageLabel || manifest.stage,
    manifest.categoryLabel || manifest.subjectLabel || manifest.category,
  ]
    .filter(Boolean)
    .join(' · ');

  const chapterHeaderHtml = `
<header class="chapter-header">
  <h1 id="_top" class="chapter-title astro-ev5clelh">${renderTitleHtml(payload.title)}</h1>
  <div class="chapter-meta-container" role="region" aria-label="教材出版信息">
    <md-chip-set class="chapter-meta-chip-set" role="list" aria-label="教材元数据">
      ${manifest.author ? `
        <md-assist-chip label="${escapeHtml(manifest.author)}" has-icon>
          <svg slot="icon" viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
            <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"></path>
          </svg>
          <span class="m3-chip-text">${escapeHtml(manifest.author)}</span>
        </md-assist-chip>
      ` : ''}
      ${manifest.publisher ? `
        <md-assist-chip label="${escapeHtml(manifest.publisher)}" has-icon>
          <svg slot="icon" viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
            <path d="M12 7V3H2v18h20V7H12zM6 19H4v-2h2v2zm0-4H4v-2h2v2zm0-4H4V9h2v2zm0-4H4V5h2v2zm4 12H8v-2h2v2zm0-4H8v-2h2v2zm0-4H8V9h2v2zm0-4H8V5h2v2zm10 12h-8v-2h2v-2h-2v-2h2v-2h-2V9h8v10zm-2-8h-2v2h2v-2zm0 4h-2v2h2v-2z"></path>
          </svg>
          <span class="m3-chip-text">${escapeHtml(manifest.publisher)}</span>
        </md-assist-chip>
      ` : ''}
      ${manifest.title ? `
        <md-assist-chip label="《${escapeHtml(manifest.title)}》" has-icon>
          <svg slot="icon" viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
            <path d="M21 5c-1.11-.35-2.33-.5-3.5-.5-1.95 0-4.05.4-5.5 1.5-1.45-1.1-3.55-1.5-5.5-1.5S2.45 4.9 1 6v14.65c0 .25.25.5.5.5.1 0 .15-.05.25-.05C3.1 20.45 5.05 20 6.5 20c1.95 0 4.05.4 5.5 1.5 1.35-.85 3.8-1.5 5.5-1.5 1.65 0 3.35.3 4.75 1.05.1.05.15.05.25.05.25 0 .5-.25.5-.5V6c-.6-.45-1.25-.75-2-1zm0 13.5c-1.1-.35-2.3-.5-3.5-.5-1.7 0-4.15.65-5.5 1.5V8c1.35-.85 3.8-1.5 5.5-1.5 1.2 0 2.4.15 3.5.5v11.5z"></path>
          </svg>
          <span class="m3-chip-text">《${escapeHtml(manifest.title)}》</span>
        </md-assist-chip>
      ` : ''}
      ${stageSubjectLabel ? `
        <md-assist-chip label="${escapeHtml(stageSubjectLabel)}" has-icon>
          <svg slot="icon" viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
            <path d="M5 13.18v4L12 21l7-3.82v-4L12 17l-7-3.82zM12 3L1 9l11 6 9-4.91V17h2V9L12 3z"></path>
          </svg>
          <span class="m3-chip-text">${escapeHtml(stageSubjectLabel)}</span>
        </md-assist-chip>
      ` : ''}
      <button type="button" class="bilingual-trigger-btn" data-translation-trigger style="background: none; border: none; padding: 0; cursor: pointer;">
        <md-assist-chip class="chapter-compare-chip" label="双语助读 (Alt+Y)" has-icon title="开启章节双语对照与学术翻译 (Alt+Y)">
          <svg slot="icon" viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
            <path d="M12.87 15.07l-2.54-2.51.03-.08c1.74-1.94 2.98-4.17 3.71-6.49H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"></path>
          </svg>
          <span class="m3-chip-text">双语助读 (Alt+Y)</span>
        </md-assist-chip>
      </button>
    </md-chip-set>
  </div>
</header>
`;

  if (html.includes('id="_top" class="chapter-title astro-ev5clelh"')) {
    html = html.replace(/<h1 id="_top" class="chapter-title astro-ev5clelh">[\s\S]*?<\/h1>/i, () => chapterHeaderHtml);
  } else {
    html = html.replace(/(<article class="sl-markdown-content")/i, (_m, p1) => `${chapterHeaderHtml}\n${p1}`);
  }

  // 6. 计算并构建「上一节」与「下一节」翻页导航
  const flattenedChapters: Array<{ slug: string; title: string }> = [];
  for (const sec of manifest.sections) {
    for (const ch of sec.chapters) {
      flattenedChapters.push(ch);
    }
  }
  const currIdx = flattenedChapters.findIndex((c) => c.slug === currentChapterSlug);
  const prevChapter = currIdx > 0 ? flattenedChapters[currIdx - 1] : null;
  const nextChapter = currIdx >= 0 && currIdx < flattenedChapters.length - 1 ? flattenedChapters[currIdx + 1] : null;

  let paginationHtml = '';
  if (prevChapter || nextChapter) {
    paginationHtml = `
      <nav class="prev-next print:hidden" aria-label="翻页导航">
        ${prevChapter ? `
          <div class="pager">
            <a class="pager-link prev" href="/collections/${colSlug}/${bookSlug}/${prevChapter.slug}/" rel="prev">
              <span class="desc">← 上一节</span>
              <span class="title">${renderTitleHtml(prevChapter.title)}</span>
            </a>
          </div>
        ` : '<div></div>'}
        ${nextChapter ? `
          <div class="pager">
            <a class="pager-link next" href="/collections/${colSlug}/${bookSlug}/${nextChapter.slug}/" rel="next">
              <span class="desc">下一节 →</span>
              <span class="title">${renderTitleHtml(nextChapter.title)}</span>
            </a>
          </div>
        ` : ''}
      </nav>
    `;
  }

  // 7. 注入章节正文与翻页导航
  const contentBodyHtml = `<div class="astrolib-chapter-content">${payload.html}\n${paginationHtml}</div>`;
  if (html.includes('<div id="reader-shell-mount-point"></div>')) {
    html = html.replace('<div id="reader-shell-mount-point"></div>', () => contentBodyHtml);
  } else {
    html = html.replace(/(<article class="sl-markdown-content"[^>]*>)/i, (_m, p1) => `${p1}\n${contentBodyHtml}`);
  }

  // 8. 更新右侧 Sideload Dock 属性与本节大纲 (TOC)
  const clientBookConfig = {
    title: manifest.title,
    slug: manifest.slug,
    colSlug: manifest.colSlug,
    modules: manifest.modules || {},
    trackClasses: manifest.trackClasses || [],
  };
  const manifestScriptHtml = `<script id="__book_manifest__" type="application/json">${JSON.stringify(manifest).replace(/<\/script>/gi, '<\\/script>')}</script>`;

  html = html.replace(
    /<aside class="astrolib-sideload-dock custom-page-sidebar" id="astrolib-sideload-dock"[^>]*>/i,
    () => `<aside class="astrolib-sideload-dock custom-page-sidebar" id="astrolib-sideload-dock" data-book-key="${escapeHtmlAttr(`${colSlug}/${bookSlug}`)}" data-refs-mode="interactive" data-book-config="${escapeHtmlAttr(JSON.stringify(clientBookConfig))}">${manifestScriptHtml}`
  );

  const tocHtml = buildStructuredTocHtml(payload.html, payload.headings || [], manifest.modules || {});
  html = html.replace(/<ul id="custom-toc-list" class="toc-list">[\s\S]*?<\/ul>/i, () => `<ul id="custom-toc-list" class="toc-list">${tocHtml}</ul>`);
  html = html.replace(/<ul id="vp-local-nav-toc-list" class="toc-list">[\s\S]*?<\/ul>/i, () => `<ul id="vp-local-nav-toc-list" class="toc-list">${tocHtml}</ul>`);

  // 9. 确保顶部包含关注点透镜 (Alt+I) 按钮
  if (!html.includes('id="vp-focus-btn"')) {
    const focusBtnHtml = `
      <button
        type="button"
        class="vp-focus-btn"
        id="vp-focus-btn"
        data-focus-trigger
        aria-label="关注点透镜与信息高亮 (Alt+I)"
        title="关注点透镜与信息高亮 (Alt+I)"
        data-tooltip="关注点透镜 (Alt+I)"
      >
        <md-icon class="header-mdicon vp-focus-icon" aria-hidden="true">center_focus_strong</md-icon>
      </button>
    `;
    html = html.replace(/(<button[^>]*id="vp-translate-btn"[^>]*>[\s\S]*?<\/button>)/i, (_m, p1) => `${p1}\n${focusBtnHtml}`);
  }

  // 10. 确保侧载栏包含关注点透镜侧载面板
  if (!html.includes('data-panel-id="focus"')) {
    const focusPanelHtml = `
  <section class="sideload-panel-view" data-panel-id="focus" aria-hidden="true">
    <div class="focus-sidebar-panel" id="focus-sidebar-panel" aria-hidden="true">
      <div class="focus-sidebar-header">
        <div class="focus-sidebar-title-group">
          <button
            type="button"
            class="sideload-back-btn"
            id="focus-back-to-toc"
            title="返回本节大纲 (Esc)"
            aria-label="返回本节大纲"
          >
            <md-icon class="sideload-back-icon" aria-hidden="true">arrow_back</md-icon>
          </button>
          <h3 class="focus-sidebar-title">关注点透镜</h3>
          <span class="focus-hardware-badge" id="focus-hardware-badge">Qwen 0.6B</span>
        </div>
        <div class="focus-sidebar-actions">
          <button
            type="button"
            class="focus-action-btn"
            id="focus-sidebar-close"
            title="关闭透镜并恢复大纲 (Esc)"
            aria-label="关闭透镜"
          >
            <md-icon class="focus-action-icon" aria-hidden="true">close</md-icon>
          </button>
        </div>
      </div>
      <div class="focus-sidebar-content">
        <div class="focus-status-card">
          <span class="focus-status" id="focus-status-text">就绪</span>
        </div>
        <div>
          <div class="focus-section-label">渲染模式</div>
          <div class="focus-mode-chips" role="radiogroup" aria-label="选择透镜高亮模式">
            <button type="button" class="focus-chip is-active" data-focus-mode="fade" title="智能淡化低信息词语，快速跳读学术实体">
              智能淡化 (Fade)
            </button>
            <button type="button" class="focus-chip" data-focus-mode="block" title="按香农惊异度梯度施加色块聚焦">
              柔和色块 (Block)
            </button>
            <button type="button" class="focus-chip" data-focus-mode="underline" title="高惊异度学术关键词下划线">
              重点下划线 (Underline)
            </button>
          </div>
        </div>
        <div class="focus-slider-block">
          <div class="focus-slider-header">
            <span>信息密度过滤阈值 (CI)</span>
            <span class="focus-slider-val" id="focus-threshold-val">35%</span>
          </div>
          <input
            type="range"
            min="10"
            max="80"
            value="35"
            step="5"
            id="focus-threshold-slider"
            class="focus-slider"
            aria-label="信息密度过滤阈值"
          />
        </div>
        <div class="focus-btn-group">
          <button type="button" class="focus-analyze-btn" id="focus-analyze-btn" title="分析当前章节并高亮关注点">
            <md-icon class="focus-btn-icon" aria-hidden="true">auto_awesome</md-icon>
            分析本章关注点
          </button>
          <button type="button" class="focus-clear-btn" id="focus-clear-btn" title="清除正文高亮">
            清除高亮
          </button>
        </div>
        <div class="focus-telemetry-box" id="focus-telemetry-box" style="display: none;">
          <div class="focus-stat-item">
            <span class="focus-stat-label">推理延迟</span>
            <span class="focus-stat-value" id="focus-stat-time">-</span>
          </div>
          <div class="focus-stat-item">
            <span class="focus-stat-label">词元数量</span>
            <span class="focus-stat-value" id="focus-stat-tokens">-</span>
          </div>
          <div class="focus-stat-item">
            <span class="focus-stat-label">计算后端</span>
            <span class="focus-stat-value" id="focus-stat-device">CUDA</span>
          </div>
          <div class="focus-stat-item">
            <span class="focus-stat-label">显存占用</span>
            <span class="focus-stat-value" id="focus-stat-vram">1.14 GB</span>
          </div>
        </div>
        <div>
          <div class="focus-section-label">高惊异度实体提取</div>
          <div class="focus-keywords-container" id="focus-keywords-list">
            <span style="font-size: 0.75rem; color: var(--sl-color-gray-3);">暂无分析结果</span>
          </div>
        </div>
      </div>
    </div>
  </section>
    `;
    html = html.replace(/(<\/aside>)/i, (_m, p1) => `${focusPanelHtml}\n${p1}`);
  }

  // 10.5 净化顶栏：彻底移除单一正文视窗中冗余的全局元素（徽标、主题切换、全站设置、独立工作台、GitHub）
  html = html.replace(/<a\s+href="\/"\s+class="[^"]*brand-link[^"]*"[^>]*>[\s\S]*?<\/a>/gi, '');
  html = html.replace(/<a\s+href="\/"\s+class="[^"]*m3-brand-link[^"]*"[^>]*>[\s\S]*?<\/a>/gi, '');
  html = html.replace(/<a[^>]*id="vp-blank-doc-btn"[^>]*>[\s\S]*?<\/a>/gi, '');

  // 11. 联动 AI 书内智能问答 FAB 标题
  html = html.replace(/(<ai-ask[^>]*data-book-title=)"[^"]*"/i, (_m, p1) => `${p1}"${escapeHtmlAttr(manifest.title)}"`);

  // 12. 彻底剔除所有底部【网站地图】字样及其残留容器
  html = html.replace(/<a[^>]*>[\s\S]*?网站地图[\s\S]*?<\/a>/gi, '');
  html = html.replace(/<[^>]*>网站地图<\/[^>]*>/gi, '');
  html = html.replace(/网站地图/g, '');

  // 13. 注入全局设置持久化、交叉引用链接器、全局瞬时搜索与 WikiNotice 交互客户端脚本
  const headInjection = `
  <style id="astrolib-wiki-notice-styles">
    /* 彻底隐藏单一正文视窗中冗余的全局控制区（徽标、独立工作台、工具与设置、主题开关、GitHub） */
    .m3-brand-link, .vp-brand-link,
    #vp-blank-doc-btn, .vp-blank-doc-btn,
    #vp-tools-wrapper, .vp-tools-wrapper,
    .vp-header-theme-group,
    .vp-social-group { display: none !important; }
    .astrolib-notice-framework { max-width: 62rem; width: 100%; margin: 0 auto 1.15rem auto; box-sizing: border-box; display: flex; flex-direction: column; }
    .astrolib-notice-card.astrolib-notice-wiki { position: relative; display: flex; flex-direction: column; align-items: stretch; background-color: var(--md-sys-color-surface-container-low, #f9f9fb); border: 1px solid var(--md-sys-color-outline-variant, rgba(0, 0, 0, 0.08)); border-left: 4.5px solid #ea580c; border-top-right-radius: 8px; border-bottom-right-radius: 8px; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.02); margin-bottom: 0.65rem; transition: background-color 0.2s ease, border-color 0.2s ease; overflow: hidden; }
    [data-theme='dark'] .astrolib-notice-card.astrolib-notice-wiki { background-color: var(--md-sys-color-surface-container, #1e1f20); border-color: rgba(255, 255, 255, 0.1); box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25); }
    .wiki-main-row { display: flex; align-items: flex-start; gap: 0.75rem; padding: 0.65rem 0.9rem; flex: 1; min-width: 0; }
    .wiki-icon-wrap { display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; flex-shrink: 0; margin-top: 1px; color: #ea580c; }
    .wiki-content-col { flex: 1; min-width: 0; }
    .wiki-text-line { font-size: 0.85rem; line-height: 1.55; color: var(--md-sys-color-on-surface, #1f1f1f); word-break: break-word; display: flex; align-items: center; flex-wrap: wrap; gap: 0.5rem; }
    [data-theme='dark'] .wiki-text-line { color: var(--md-sys-color-on-surface, #e3e3e3); }
    .wiki-tag { display: inline-flex; align-items: center; font-size: 0.72rem; font-weight: 500; padding: 0.1rem 0.45rem; border-radius: 4px; background-color: var(--md-sys-color-surface-container-high, rgba(0, 0, 0, 0.05)); border: 1px solid var(--md-sys-color-outline-variant, rgba(0, 0, 0, 0.12)); color: var(--md-sys-color-on-surface-variant, #444746); }
    [data-theme='dark'] .wiki-tag { background-color: rgba(255, 255, 255, 0.06); border-color: rgba(255, 255, 255, 0.14); color: #c4c7c5; }
    .wiki-actions-col { display: flex; align-items: center; gap: 0.25rem; flex-shrink: 0; margin-top: -2px; }
    .notice-action-btn { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; padding: 0; background: transparent; border: none; border-radius: 50%; color: var(--md-sys-color-outline, #74777f); cursor: pointer; transition: background-color 0.15s ease, color 0.15s ease, transform 0.2s ease; }
    .notice-action-btn:hover { background-color: var(--md-sys-color-surface-container-highest, rgba(0, 0, 0, 0.08)); color: var(--md-sys-color-on-surface, #1f1f1f); }
    [data-theme='dark'] .notice-action-btn:hover { background-color: rgba(255, 255, 255, 0.12); color: #ffffff; }
    .action-icon.chevron-icon { width: 16px; height: 16px; transition: transform 0.2s cubic-bezier(0.2, 0, 0, 1); }
    .toggle-expand-btn[aria-expanded='true'] .chevron-icon { transform: rotate(180deg); }
    .wiki-expand-panel { padding: 0 0.9rem 0.65rem 0.9rem; }
    .wiki-expand-divider { border-top: 1px dashed var(--md-sys-color-outline-variant, rgba(0, 0, 0, 0.08)); margin-bottom: 0.45rem; }
    [data-theme='dark'] .wiki-expand-divider { border-top-color: rgba(255, 255, 255, 0.08); }
    .wiki-items-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.35rem; }
    .wiki-list-item { display: flex; align-items: baseline; gap: 0.45rem; font-size: 0.8rem; line-height: 1.45; color: var(--md-sys-color-on-surface-variant, #444746); }
    [data-theme='dark'] .wiki-list-item { color: #c4c7c5; }
    .fill-in-blank { display: inline-block; min-width: 4em; border-bottom: 1.5px solid currentColor; margin: 0 0.35em; text-align: center; vertical-align: baseline; }
    /* 研读视窗运行于桌面多Fragment框架内，系统三键位于桌面主框架顶栏，正文视窗右侧不预留 140px，避免分屏错位 */
    html.is-electron-app .m3-right-group, html.is-electron .m3-right-group, html.is-electron-app .m3-app-bar__actions, html.is-electron .m3-app-bar__actions, html.is-electron-app .vp-right-group, html.is-electron .vp-right-group, html.is-electron-app .vp-nav-actions, html.is-electron .vp-nav-actions { padding-right: 0.25rem !important; }
    html[data-sideload-active='focus'] .sideload-panel-view[data-panel-id='focus'],
    .custom-page-sidebar.has-focus-active .sideload-panel-view[data-panel-id='focus'] { display: flex !important; }

    /* 左侧书目与大纲完整对齐 Web 端规约并提供舒适物理边距 (Issue 3) */
    html.is-electron, html.is-electron-app {
      --sl-sidebar-width: 19rem !important;
    }
    #starlight__sidebar, .sidebar-pane, .sidebar-content, sl-sidebar-state-persist {
      padding-left: 0.75rem !important;
      padding-right: 0.5rem !important;
      box-sizing: border-box !important;
      margin-left: 0 !important;
      width: var(--sl-sidebar-width, 19rem) !important;
    }
    #starlight__sidebar ul,
    .sidebar-pane ul,
    .sidebar-content ul,
    sl-sidebar-state-persist ul,
    .gdocs-book-outline ul,
    .sidebar-category-group ul {
      list-style: none !important;
      padding: 0 !important;
      margin: 0 !important;
      padding-inline-start: 0 !important;
    }
    .sidebar-category-item { margin-bottom: 0.65rem; list-style: none; }
    .sidebar-category-summary { font-weight: 700; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--sl-color-gray-3, #94a3b8); padding: 0.4rem 0.5rem; display: flex; align-items: center; justify-content: space-between; cursor: pointer; user-select: none; }
    .sidebar-category-summary::marker, .sidebar-category-summary::-webkit-details-marker { display: none; }
    .sidebar-category-title-wrap { display: inline-flex; align-items: center; gap: 0.45rem; }
    .sidebar-category-icon { display: inline-flex; align-items: center; justify-content: center; color: var(--sl-color-gray-3, #94a3b8); flex-shrink: 0; }
    .caret { transition: transform 0.2s ease-in-out; flex-shrink: 0; }
    details[open] > summary .caret { transform: rotateZ(90deg); }
    .gdocs-book-li { list-style: none; margin-block: 2px; }
    .gdocs-tab-pill, .gdocs-tab-item { display: flex; align-items: center; gap: 0.5rem; padding: 0.32rem 0.65rem; border-radius: 9999px; text-decoration: none; color: var(--sl-color-gray-2, #cbd5e1); transition: all 0.15s ease; font-size: 0.875rem; cursor: pointer; }
    .gdocs-tab-item:hover { color: var(--sl-color-white, #fff); background-color: var(--sl-color-gray-6, rgba(125, 125, 125, 0.08)); }
    .gdocs-tab-pill.is-active { color: var(--sl-color-white, #fff); font-weight: 600; }
    .gdocs-book-icon { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; opacity: 0.85; }
    .gdocs-book-label { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.35; }
    .gdocs-book-text { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .gdocs-book-outline { margin-top: 2px; margin-inline-start: 0.5rem; border-inline-start: 1px solid var(--sl-color-hairline-light, rgba(125, 125, 125, 0.15)); padding-inline-start: 0.5rem; }
    .gdocs-outline-li { list-style: none; margin-block: 2px; }
    .gdocs-outline-link { display: block; border-radius: 9999px; text-decoration: none; color: var(--sl-color-gray-2, #cbd5e1); padding: 0.22rem 0.65rem; line-height: 1.35; font-size: 0.85rem; }
    .gdocs-outline-link:hover, .gdocs-outline-link:focus { color: var(--sl-color-white, #fff); background-color: var(--sl-color-gray-6, rgba(125, 125, 125, 0.08)); }
    .gdocs-outline-link[aria-current='page'], .gdocs-outline-link.is-active { font-weight: 600; color: var(--sl-color-text-invert, #131316) !important; background-color: var(--sl-color-text-accent, #6366f1) !important; border-radius: 9999px; }
    .gdocs-link-text { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    /* 顶栏折叠大纲浮层规范化间距与阴影 (Issue 4) */
    .m3-local-nav-items,
    .vp-local-nav-items {
      top: calc(var(--sl-nav-height, 3.5rem) + 0.75rem) !important;
      max-width: 26rem !important;
      width: min(26rem, 90vw) !important;
      border-radius: var(--md-shape-corner-large, 16px) !important;
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.4), 0 0 0 1px var(--sl-color-hairline, rgba(255, 255, 255, 0.12)) !important;
      background-color: var(--sl-color-bg-sidebar, #1e1f20) !important;
      padding: 0 !important;
      overflow: hidden !important;
    }
    .m3-local-nav-header,
    .vp-local-nav-header {
      padding: 0.6rem 0.85rem !important;
      border-bottom: 1px solid var(--sl-color-hairline, rgba(255, 255, 255, 0.08)) !important;
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
    }
    .m3-local-nav-outline,
    .vp-local-nav-outline {
      padding: 0.75rem 0.85rem 1rem 0.85rem !important;
      max-height: calc(80vh - var(--sl-nav-height, 3.5rem)) !important;
      overflow-y: auto !important;
    }
    .m3-local-nav-outline .toc-list,
    .vp-local-nav-outline .toc-list {
      display: flex !important;
      flex-direction: column !important;
      gap: 0.25rem !important;
    }
    .m3-local-nav-outline .toc-link,
    .vp-local-nav-outline .toc-link {
      padding: 0.35rem 0.65rem !important;
      border-radius: 6px !important;
      line-height: 1.45 !important;
      font-size: 0.84rem !important;
      transition: background-color 0.15s ease, color 0.15s ease !important;
    }
    .m3-local-nav-outline .toc-link:hover,
    .vp-local-nav-outline .toc-link:hover {
      background-color: var(--md-sys-color-surface-container-highest, rgba(255, 255, 255, 0.08)) !important;
    }

    /* 彻底去除【解】卡片右侧的多余箭头 (Issue 5) */
    .solution-details > summary::after,
    .solution-details summary::after,
    details.solution-details > summary::after,
    details.solution-details summary::after {
      display: none !important;
      content: none !important;
      visibility: hidden !important;
    }

    /* 右侧大纲 TOC 清除一切圆圈符号并贴边对齐 */
    .toc-list, .toc-sublist, .toc-group, .toc-item {
      list-style: none !important;
      list-style-type: none !important;
      padding: 0 !important;
      margin: 0 !important;
    }
    .toc-item::marker, .toc-group::marker, .toc-list::marker, .toc-sublist::marker {
      display: none !important;
      content: '' !important;
    }
    .toc-chip {
      display: inline-block !important;
      font-size: 0.75rem !important;
      font-weight: 600 !important;
      color: var(--sl-color-gray-1, #e2e8f0) !important;
      background: transparent !important;
      border: none !important;
      border-radius: 0 !important;
      padding: 0 !important;
      margin-right: 0.35rem !important;
      line-height: 1.5 !important;
      flex-shrink: 0;
    }
    .toc-link.active .toc-chip {
      color: var(--sl-color-text-accent, #6366f1) !important;
      font-weight: 700 !important;
    }
    html.is-electron .main-frame,
    html.is-electron-app .main-frame {
      max-width: 100% !important;
      width: auto !important;
      margin-right: 0 !important;
    }
    html.is-electron .lg\\:sl-flex,
    html.is-electron-app .lg\\:sl-flex,
    html.is-electron [class*="lg:sl-flex"],
    html.is-electron-app [class*="lg:sl-flex"] {
      width: 100% !important;
      max-width: 100% !important;
    }
    html.is-electron .right-sidebar-container,
    html.is-electron-app .right-sidebar-container,
    html.is-electron .right-sidebar,
    html.is-electron-app .right-sidebar {
      right: 0 !important;
      margin-right: 0 !important;
      width: var(--sl-sideload-width, 16.5rem) !important;
    }

    /* 底部上一节/下一节分页卡片 */
    .prev-next {
      display: grid !important;
      grid-template-columns: 1fr 1fr;
      gap: 1.25rem;
      margin-top: 3.5rem;
      margin-bottom: 2rem;
      padding-top: 1.5rem;
      border-top: 1px solid var(--sl-color-hairline, rgba(255, 255, 255, 0.1));
    }
    .prev-next .pager-link {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      padding: 1.15rem 1.35rem;
      border-radius: 12px;
      border: 1px solid var(--sl-color-hairline, rgba(255, 255, 255, 0.1));
      background-color: var(--md-sys-color-surface-container-low, rgba(255, 255, 255, 0.02));
      text-decoration: none;
      transition: all 0.2s cubic-bezier(0.2, 0, 0, 1);
    }
    .prev-next .pager-link:hover {
      background-color: var(--md-sys-color-surface-container, rgba(255, 255, 255, 0.06));
      border-color: var(--sl-color-text-accent, #6366f1);
      transform: translateY(-1px);
    }
    .prev-next .pager-link.next {
      text-align: right;
      align-items: flex-end;
    }
    .prev-next .desc {
      font-size: 0.75rem;
      font-weight: 500;
      color: var(--sl-color-gray-3, #94a3b8);
      letter-spacing: 0.02em;
    }
    .prev-next .title {
      font-size: 0.95rem;
      font-weight: 600;
      color: var(--sl-color-white, #f8fafc);
    }
    .prev-next .pager-link:hover .title {
      color: var(--sl-color-text-accent, #6366f1);
    }

    /* 交叉引用互动徽章与聚光灯动画 (Issue 7) */
    .block-ref-badge, .fig-ref-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.2rem;
      padding: 0.05rem 0.4rem;
      margin: 0 0.2rem;
      border-radius: 4px;
      background-color: var(--sl-color-accent-low, rgba(99, 102, 241, 0.14));
      color: var(--sl-color-text-accent, #818cf8);
      font-size: 0.88em;
      font-weight: 500;
      text-decoration: none;
      cursor: pointer;
      vertical-align: baseline;
      transition: all 0.15s ease;
    }
    .block-ref-badge:hover, .fig-ref-badge:hover {
      background-color: var(--sl-color-text-accent, #6366f1);
      color: #ffffff;
    }
    .block-ref-badge .badge-icon {
      font-size: 0.85em;
      opacity: 0.85;
    }
    @keyframes refFlash {
      0% { outline: 3px solid #6366f1; outline-offset: 4px; background-color: rgba(99, 102, 241, 0.22); }
      50% { outline: 3px solid rgba(99, 102, 241, 0.8); outline-offset: 6px; background-color: rgba(99, 102, 241, 0.12); }
      100% { outline: 3px solid transparent; outline-offset: 0; background-color: transparent; }
    }
    .card-ref-flash {
      animation: refFlash 1.6s cubic-bezier(0.2, 0, 0, 1) !important;
    }
  </style>
  <script>
    (function initDesktopSync() {
      if (typeof window === 'undefined') return;

      // 0. 首屏秒级恢复侧载激活面板状态 (消除切章时大纲瞬闪)
      try {
        var savedPanel = localStorage.getItem('astrolib_sideload_active_panel');
        if (savedPanel && savedPanel !== 'none') {
          document.documentElement.dataset.sideloadActive = savedPanel;
          if (savedPanel === 'ai' || savedPanel === 'exercises' || savedPanel === 'translate') {
            document.documentElement.style.setProperty('--sl-sideload-width', 'clamp(20rem, 28vw, 25.5rem)');
          } else if (savedPanel === 'focus') {
            document.documentElement.style.setProperty('--sl-sideload-width', '22rem');
          }
        }
      } catch(e) {}

      // 1. 暴露全局变量
      window.__currentBookSlug = ${JSON.stringify(bookSlug)};
      window.__currentColSlug = ${JSON.stringify(colSlug)};
      window.__currentChapterSlug = ${JSON.stringify(currentChapterSlug)};
      window.__currentBookTitle = ${JSON.stringify(manifest.title)};
      window.__allBooksCatalog = ${JSON.stringify(searchCatalog)};
      window.__bookCrossRefIndex = null;

      // 异步预热当前图书的跨页引用索引库
      fetch('/data/cross-ref/' + encodeURIComponent(${JSON.stringify(colSlug)}) + '-' + encodeURIComponent(${JSON.stringify(bookSlug)}) + '.json')
        .then(function(res) { return res.ok ? res.json() : null; })
        .then(function(data) {
          if (data) window.__bookCrossRefIndex = data;
        })
        .catch(function() {});

      // 2. 桌面端持久化配置代理与双向同步
      var bridge = window.astrolib || window.astrolibDesktop;
      if (bridge && typeof bridge.getSettings === 'function') {
        bridge.getSettings().then(function(settings) {
          if (settings && typeof settings === 'object') {
            for (var k in settings) {
              try {
                if (localStorage.getItem(k) !== settings[k]) {
                  localStorage.setItem(k, settings[k]);
                }
              } catch(e) {}
            }
            window.dispatchEvent(new CustomEvent('astrolib:settings-synced', { detail: settings }));
          }
        }).catch(function() {});

        try {
          var origSet = localStorage.setItem.bind(localStorage);
          localStorage.setItem = function(k, v) {
            origSet(k, v);
            try { bridge.saveSetting(k, String(v)); } catch(e) {}
          };
          var origRem = localStorage.removeItem.bind(localStorage);
          localStorage.removeItem = function(k) {
            origRem(k);
            try { bridge.saveSetting(k, null); } catch(e) {}
          };
        } catch(e) {}
      }

      // 3. 客户端交叉引用扫描与交互绑定 (Issue 7)
      function scanAndLinkRefs() {
        var content = document.querySelector('.astrolib-chapter-content');
        if (!content || content.__refsLinked) return;
        content.__refsLinked = true;

        var refTypesPattern = '例|例题|定理|定义|性质|推论|引理|算法|公理|公式|知识点|考点|结论|经验总结|经验|方法|题';

        function walk(node) {
          if (node.nodeType === 3) {
            var val = node.nodeValue || '';
            var localRegex = new RegExp('(?:∡\\s*)?(' + refTypesPattern + ')\\s*(\\d+(?:\\.\\d+)*)', 'g');
            if (val && localRegex.test(val)) {
              localRegex.lastIndex = 0;
              var span = document.createElement('span');
              span.innerHTML = val.replace(localRegex, function(_m, type, num) {
                var cleanType = type.trim();
                var cleanNum = num.trim();
                return '<span class="block-ref-badge interactive-badge" data-ref-type="' + cleanType + '" data-ref-num="' + cleanNum + '"><span class="badge-icon">∡</span> <span class="badge-type">' + cleanType + '</span> <span class="badge-num">' + cleanNum + '</span></span>';
              });
              if (node.parentNode) {
                node.parentNode.replaceChild(span, node);
              }
            }
            return;
          }
          if (node.nodeType === 1) {
            var el = node;
            var tag = el.tagName ? el.tagName.toLowerCase() : '';
            if (tag === 'script' || tag === 'style' || tag === 'svg' || tag === 'pre' || tag === 'code' || tag === 'a' || el.classList.contains('katex') || el.classList.contains('interactive-badge')) {
              return;
            }
            var kids = Array.from(el.childNodes);
            for (var i = 0; i < kids.length; i++) {
              walk(kids[i]);
            }
          }
        }
        walk(content);
      }

      // 4. 绑定页面锚点聚光灯高亮 (页面加载及 hash 变更时自触发)
      function checkUrlHashLanding() {
        var hash = window.location.hash;
        if (!hash) return;
        var targetId = decodeURIComponent(hash.replace(/^#/, ''));
        if (!targetId) return;
        var targetEl = document.getElementById(targetId) ||
          document.querySelector('[data-title*="' + targetId + '"]') ||
          document.querySelector('[id*="' + targetId + '"]');
        if (targetEl) {
          setTimeout(function() {
            targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            targetEl.classList.add('card-ref-flash');
            setTimeout(function() { targetEl.classList.remove('card-ref-flash'); }, 1800);
          }, 150);
        }
      }

      // 5. 绑定全局点击事件委托 (透镜、助读、习题、复制链接、交叉引用等)
      document.addEventListener('click', function(e) {
        var target = e.target;
        if (!target) return;

        // 交叉引用点击跳转
        var badge = target.closest('.block-ref-badge, .interactive-badge');
        if (badge) {
          e.preventDefault();
          var type = badge.getAttribute('data-ref-type') || '';
          var num = badge.getAttribute('data-ref-num') || '';
          var queryTarget = type + ' ' + num;
          var queryTargetAlt = type + num;

          // 5.1 本页查找对应卡片或锚点
          var match = Array.from(document.querySelectorAll('.toc-chunk, details, h1, h2, h3, h4')).find(function(el) {
            var title = el.getAttribute('data-title') || el.textContent || '';
            return title.includes(queryTarget) || title.includes(queryTargetAlt) || (el.id && el.id.includes(num));
          });

          if (match) {
            match.scrollIntoView({ behavior: 'smooth', block: 'center' });
            match.classList.add('card-ref-flash');
            setTimeout(function() { match.classList.remove('card-ref-flash'); }, 1800);
            return;
          }

          // 5.2 从全局跨页引用索引精准定位跳转
          var idx = window.__bookCrossRefIndex;
          if (idx) {
            var candList = idx[queryTargetAlt] || idx[queryTarget] || idx[num];
            if (candList && candList.length > 0) {
              var targetUrl = candList[0].url;
              if (targetUrl) {
                window.location.href = targetUrl;
                return;
              }
            }
          }

          // 5.3 兜底：从全书目录模糊定位
          if (window.__allBooksCatalog) {
            var foundCh = window.__allBooksCatalog.find(function(item) {
              return item.chapterTitle.includes(num);
            });
            if (foundCh) {
              window.location.href = foundCh.url;
              return;
            }
          }
        }

        // 关注点透镜触发
        var focusBtn = target.closest('[data-focus-trigger]');
        if (focusBtn) {
          e.preventDefault();
          var mgr = window.sideloadManager || window.__sideloadManager;
          if (mgr) {
            mgr.toggle('focus');
          } else {
            var panel = document.querySelector('[data-panel-id="focus"]');
            if (panel) {
              var isHidden = panel.getAttribute('aria-hidden') === 'true';
              panel.setAttribute('aria-hidden', String(!isHidden));
            }
          }
        }

        // 双语助读触发
        var transBtn = target.closest('[data-translation-trigger]');
        if (transBtn) {
          e.preventDefault();
          var mgr = window.sideloadManager || window.__sideloadManager;
          if (mgr) {
            mgr.toggle('translate');
          }
        }

        // 课后习题触发
        var exBtn = target.closest('[data-exercise-trigger]');
        if (exBtn) {
          e.preventDefault();
          var mgr = window.sideloadManager || window.__sideloadManager;
          if (mgr) {
            mgr.toggle('exercises');
          }
        }

        // 数字资源链接一键复制
        var copyBtn = target.closest('.js-copy-resource-url');
        if (copyBtn) {
          e.preventDefault();
          var url = copyBtn.getAttribute('data-url');
          if (url && navigator.clipboard) {
            navigator.clipboard.writeText(url).then(function() {
              copyBtn.title = '已复制！';
              setTimeout(function() { copyBtn.title = '复制链接'; }, 2000);
            });
          }
          return;
        }

        // 大纲折叠/展开按钮触发
        var collapseBtn = target.closest('.toc-collapse-btn');
        if (collapseBtn) {
          e.preventDefault();
          e.stopPropagation();
          var groupLi = collapseBtn.closest('.toc-group');
          if (groupLi) {
            var isCollapsed = groupLi.getAttribute('data-collapsed') === 'true';
            groupLi.setAttribute('data-collapsed', String(!isCollapsed));
            collapseBtn.setAttribute('aria-expanded', String(isCollapsed));
          }
          return;
        }

        // 大纲平滑滚动跳转
        var tocLink = target.closest('.toc-link');
        if (tocLink) {
          var href = tocLink.getAttribute('href');
          if (href && href.startsWith('#')) {
            var targetId = decodeURIComponent(href.slice(1));
            var el = document.getElementById(targetId);
            if (el) {
              e.preventDefault();
              el.scrollIntoView({ behavior: 'smooth', block: 'start' });
              history.replaceState(null, '', href);
            }
          }
        }
      });

      // 6. 绑定 WikiNotice 展开折叠
      function bindNoticeToggles() {
        var btn = document.getElementById('ocr-toggle-expand-btn');
        var panel = document.getElementById('ocr-wiki-expand-panel');
        if (btn && panel && !btn.__bound) {
          btn.__bound = true;
          btn.addEventListener('click', function() {
            var isExpanded = btn.getAttribute('aria-expanded') === 'true';
            btn.setAttribute('aria-expanded', String(!isExpanded));
            panel.style.display = isExpanded ? 'none' : 'block';
          });
        }
      }

      function onReady() {
        bindNoticeToggles();
        scanAndLinkRefs();
        checkUrlHashLanding();
      }

      window.addEventListener('hashchange', checkUrlHashLanding);

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', onReady);
      } else {
        onReady();
      }
    })();
  </script>
  `;

  // 14. 移除失效的禁用属性并注入全局 head 增强脚本
  html = html.replace(/<button([^>]*?)data-open-modal\s+disabled/gi, (_m, p1) => `<button${p1}data-open-modal`);
  html = html.replace(/<button([^>]*?)id="astrolib-search-trigger"([^>]*?)disabled/gi, (_m, p1, p2) => `<button${p1}id="astrolib-search-trigger"${p2}`);
  html = html.replace('</head>', () => `${headInjection}\n</head>`);

  return html;
}

/**
 * 极简保底模板（仅在极端缺失构建产物时的测试保底，正常运行不走此处）
 */
function renderFallbackShellHtml(
  manifest: AstroBookManifest,
  payload: AstroBookChapterPayload
): string {
  const currentChapterSlug = payload.chapterSlug;
  const sidebarSectionsHtml = manifest.sections
    .map((sec) => {
      const chaptersList = sec.chapters
        .map((ch) => {
          const isActive = ch.slug === currentChapterSlug;
          const url = `/collections/${manifest.colSlug}/${manifest.slug}/${ch.slug}/`;
          return `
            <li class="abp-sidebar-item ${isActive ? 'is-active' : ''}">
              <a href="${url}" class="abp-sidebar-link ${isActive ? 'is-active' : ''}">
                <span class="abp-sidebar-link-text">${renderTitleHtml(ch.title)}</span>
              </a>
            </li>
          `;
        })
        .join('');

      return `
        <div class="abp-sidebar-group">
          <div class="abp-sidebar-group-title">${sec.title}</div>
          <ul class="abp-sidebar-list">${chaptersList}</ul>
        </div>
      `;
    })
    .join('');

  const tocHtml = (payload.headings || [])
    .map((h) => `
      <li class="abp-toc-item depth-${h.depth}">
        <a href="#${encodeURIComponent(h.id)}" class="abp-toc-link">${renderTitleHtml(h.text)}</a>
      </li>
    `)
    .join('');

  return `<!DOCTYPE html>
<html lang="zh-CN" data-site-theme="material-you">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(payload.title)} · ${escapeHtml(manifest.title)} · AstroLib</title>
  <link rel="icon" type="image/png" href="/favicon.png" />
  <link rel="stylesheet" href="/_astro/theme.css" />
</head>
<body>
  <div class="abp-layout">
    <aside class="abp-sidebar">${sidebarSectionsHtml}</aside>
    <main class="abp-main-content">
      <h1 class="abp-chapter-title">${renderTitleHtml(payload.title)}</h1>
      <article class="astrolib-chapter-content">${payload.html}</article>
    </main>
    <aside class="abp-toc"><ul>${tocHtml}</ul></aside>
  </div>
</body>
</html>`;
}
