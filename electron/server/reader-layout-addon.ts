import type {
  BookSourceFormat,
  ChapterContentKind,
  ReadingProfile,
} from '../../src/types/content-package.ts';
import {
  BOOK_LAYOUT_PREFS_PREFIX,
  DEFAULT_READING_LAYOUT_KEY,
  DUAL_COLUMN_MIN_WIDTH_PX,
} from '../../src/features/reader-layout/prefs.ts';

export function buildReaderLayoutHeaderButtonHtml(): string {
  return `
      <button
        type="button"
        class="m3-icon-btn m3-layout-btn vp-layout-btn"
        id="vp-reading-layout-btn"
        data-layout-trigger
        aria-label="阅读版式与视图 (Alt+L)"
        title="阅读版式与视图 (Alt+L)"
        data-tooltip="版式视图 (Alt+L)"
        aria-expanded="false"
        aria-controls="astrolib-layout-popover"
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M2 5.5A2.5 2.5 0 0 1 4.5 3H12v18H4.5A2.5 2.5 0 0 1 2 18.5v-13Z"></path>
          <path d="M22 5.5A2.5 2.5 0 0 0 19.5 3H12v18h7.5a2.5 2.5 0 0 0 2.5-2.5v-13Z"></path>
        </svg>
      </button>
  `;
}

export function buildReaderLayoutAddonHtml(params: {
  colSlug: string;
  bookSlug: string;
  chapterSlug: string;
  sourceFormat: BookSourceFormat;
  defaultProfile: ReadingProfile;
  chapterKind: ChapterContentKind;
  hasStylesheets: boolean;
  hasEmbeddedFonts: boolean;
}): string {
  const safeCfg = JSON.stringify({
    colSlug: params.colSlug,
    bookSlug: params.bookSlug,
    bookKey: `${params.colSlug}-${params.bookSlug}`,
    chapterSlug: params.chapterSlug,
    sourceFormat: params.sourceFormat,
    defaultProfile: params.defaultProfile,
    chapterKind: params.chapterKind,
    hasStylesheets: params.hasStylesheets,
    hasEmbeddedFonts: params.hasEmbeddedFonts,
    prefsKeyPrefix: BOOK_LAYOUT_PREFS_PREFIX,
    defaultLayoutKey: DEFAULT_READING_LAYOUT_KEY,
    dualMinWidth: DUAL_COLUMN_MIN_WIDTH_PX,
  }).replace(/<\//g, '<\\/');

  return `
  <style id="astrolib-reader-layout-styles">
    /* 1. 顶栏版式图标统一对齐 20px 光学规范 */
    .vp-layout-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 2rem;
      height: 2rem;
      padding: 0;
      border-radius: 50%;
      border: none;
      background: transparent;
      color: var(--sl-color-gray-2, var(--md-sys-color-on-surface-variant, #444746));
      cursor: pointer;
      flex-shrink: 0;
      position: relative;
      transition: background-color 0.15s ease, color 0.15s ease;
    }
    [data-theme='dark'] .vp-layout-btn {
      color: var(--sl-color-gray-2, #e2e8f0);
    }
    .vp-layout-btn:hover,
    .vp-layout-btn[aria-expanded='true'] {
      background-color: var(--sl-color-gray-6, rgba(125, 125, 125, 0.12));
      color: var(--sl-color-text-accent, var(--md-sys-color-primary, #0b57d0));
    }

    /* 2. M3 Expressive 版式快捷调节浮层 */
    .astrolib-layout-popover {
      position: fixed;
      top: calc(var(--sl-nav-height, 2.5rem) + 8px);
      right: 16px;
      width: min(332px, calc(100vw - 24px));
      background: var(--md-sys-color-surface-container, #f3f5f8);
      color: var(--md-sys-color-on-surface, #1b1b1f);
      border: 1px solid var(--md-sys-color-outline-variant, #c4c6d0);
      border-radius: 16px;
      padding: 14px 16px;
      box-shadow: 0 8px 28px rgba(0, 0, 0, 0.12);
      z-index: 650;
      display: none;
      flex-direction: column;
      gap: 14px;
      font-family: var(--font-ui, 'Google Sans Text', 'Noto Sans SC', sans-serif);
      box-sizing: border-box;
    }
    [data-theme='dark'] .astrolib-layout-popover {
      background: var(--md-sys-color-surface-container, #1e1f23);
      color: var(--md-sys-color-on-surface, #e3e3e6);
      border-color: var(--md-sys-color-outline-variant, #44474f);
      box-shadow: 0 10px 32px rgba(0, 0, 0, 0.42);
    }
    .astrolib-layout-popover.is-open {
      display: flex;
    }
    .lp-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-bottom: 6px;
      border-bottom: 1px solid var(--md-sys-color-outline-variant, rgba(125,125,125,0.2));
    }
    .lp-title {
      font-size: 0.86rem;
      font-weight: 600;
      letter-spacing: 0.01em;
    }
    .lp-close-btn {
      width: 26px;
      height: 26px;
      border-radius: 50%;
      border: none;
      background: transparent;
      color: var(--md-sys-color-on-surface-variant, #5f6368);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }
    .lp-close-btn:hover {
      background: rgba(125, 125, 125, 0.14);
    }
    .lp-group {
      display: flex;
      flex-direction: column;
      gap: 7px;
    }
    .lp-label-row {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 8px;
    }
    .lp-label {
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--md-sys-color-on-surface-variant, #5f6368);
    }
    .lp-hint {
      font-size: 0.68rem;
      color: var(--md-sys-color-outline, #74777f);
    }
    .lp-chips {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 6px;
    }
    .lp-chips.is-two {
      grid-template-columns: repeat(2, 1fr);
    }
    .lp-chip {
      height: 32px;
      padding: 0 8px;
      border-radius: 8px;
      border: 1px solid var(--md-sys-color-outline-variant, #c4c6d0);
      background: transparent;
      color: var(--md-sys-color-on-surface-variant, #444746);
      font-size: 0.76rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s cubic-bezier(0.2, 0, 0, 1);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    [data-theme='dark'] .lp-chip {
      color: #c4c7c5;
      border-color: #44474f;
    }
    .lp-chip:hover {
      background: var(--md-sys-color-surface-container-highest, rgba(125,125,125,0.1));
    }
    .lp-chip.is-active {
      background: var(--md-sys-color-secondary-container, #d3e3fd);
      color: var(--md-sys-color-on-secondary-container, #041e49);
      border-color: transparent;
      font-weight: 600;
    }
    [data-theme='dark'] .lp-chip.is-active {
      background: var(--md-sys-color-secondary-container, #004a77);
      color: var(--md-sys-color-on-secondary-container, #c2e7ff);
    }
    .lp-switch-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding-top: 2px;
    }
    .lp-switch-texts {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .lp-switch-title {
      font-size: 0.78rem;
      font-weight: 500;
    }
    .lp-switch-desc {
      font-size: 0.68rem;
      color: var(--md-sys-color-outline, #74777f);
    }
    .lp-toggle-pill {
      position: relative;
      width: 40px;
      height: 22px;
      border-radius: 999px;
      border: 1.5px solid var(--md-sys-color-outline, #74777f);
      background: var(--md-sys-color-surface-container-highest, #e1e2e8);
      cursor: pointer;
      transition: all 0.18s ease;
      flex-shrink: 0;
      padding: 0;
    }
    .lp-toggle-pill::after {
      content: '';
      position: absolute;
      top: 2px;
      left: 2px;
      width: 15px;
      height: 15px;
      border-radius: 50%;
      background: var(--md-sys-color-outline, #74777f);
      transition: transform 0.18s cubic-bezier(0.2, 0, 0, 1), background-color 0.18s ease;
    }
    .lp-toggle-pill[aria-checked='true'] {
      background: var(--md-sys-color-primary, #0b57d0);
      border-color: var(--md-sys-color-primary, #0b57d0);
    }
    .lp-toggle-pill[aria-checked='true']::after {
      transform: translateX(18px);
      background: var(--md-sys-color-on-primary, #ffffff);
    }

    /* 3. 文学排版与纯插画页净界面优化 */
    html[data-reading-profile='literary'] .chapter-header.has-inline-h1 h1.chapter-title {
      display: none;
    }
    html[data-reading-profile='literary'] .chapter-header.is-illustration-header {
      display: none;
    }
    html[data-reading-profile='literary'] .astrolib-book-scope {
      font-size: var(--academic-font-size-body, 11.5pt);
      line-height: 1.82;
    }
    html[data-reading-profile='literary'] .astrolib-book-scope ruby rt {
      font-size: 0.56em;
      letter-spacing: 0.02em;
      opacity: 0.86;
    }
    .astrolib-book-scope img {
      max-width: 100%;
      height: auto;
      border-radius: 4px;
      cursor: zoom-in;
    }
    html[data-reading-profile='literary'] .astrolib-chapter-content.is-illustration-chapter {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: calc(100vh - 9.5rem);
      text-align: center;
    }
    html[data-reading-profile='literary'] .astrolib-chapter-content.is-illustration-chapter img {
      max-height: calc(100vh - 10.5rem);
      width: auto;
      max-width: 100%;
      object-fit: contain;
      margin-inline: auto;
    }

    /* 4. 三模分页视口容器样式（ABP 与 EPUB 通用） */
    html[data-reading-layout='paged-single'],
    html[data-reading-layout='paged-dual'] {
      overflow: hidden !important;
    }
    html[data-reading-layout='paged-single'] body,
    html[data-reading-layout='paged-dual'] body {
      overflow: hidden !important;
    }
    /* 分页模式强制禁用 content-visibility，确保多栏总宽度与总页数精确计算 */
    html[data-reading-layout='paged-single'] .astrolib-chapter-content *,
    html[data-reading-layout='paged-dual'] .astrolib-chapter-content *,
    html[data-reading-layout='paged-single'] .sl-markdown-content *,
    html[data-reading-layout='paged-dual'] .sl-markdown-content * {
      content-visibility: visible !important;
      contain-intrinsic-size: none !important;
    }
    .sl-markdown-content.astrolib-paged-host {
      overflow: hidden !important;
      position: relative !important;
      padding-top: 0 !important;
      padding-bottom: 0 !important;
      margin-top: 0.5rem !important;
      box-sizing: border-box !important;
    }
    html[data-reading-layout='paged-single'] .main-pane,
    html[data-reading-layout='paged-dual'] .main-pane {
      padding-top: 0.5rem !important;
      padding-bottom: 0.5rem !important;
    }
    html[data-reading-layout='paged-single'] .main-pane > main,
    html[data-reading-layout='paged-dual'] .main-pane > main {
      padding-top: 1.15rem !important;
      padding-bottom: 1rem !important;
      min-height: auto !important;
    }
    html[data-reading-layout='paged-dual'] .main-pane > main {
      max-width: min(78rem, 100%) !important;
    }
    html[data-reading-layout='paged-single'] .content-panel,
    html[data-reading-layout='paged-dual'] .content-panel {
      padding-bottom: 0 !important;
    }
    html[data-reading-layout='paged-single'] footer,
    html[data-reading-layout='paged-dual'] footer,
    html[data-reading-layout='paged-single'] .chapter-meta-container,
    html[data-reading-layout='paged-dual'] .chapter-meta-container,
    html[data-reading-layout='paged-single'][data-reading-profile='literary'] .chapter-header.has-inline-h1,
    html[data-reading-layout='paged-dual'][data-reading-profile='literary'] .chapter-header.has-inline-h1 {
      display: none !important;
    }
    .astrolib-chapter-content.astrolib-paged-flow {
      column-fill: auto;
      box-sizing: border-box;
      transition: transform 0.26s cubic-bezier(0.2, 0, 0, 1);
      will-change: transform, opacity;
    }
    html[data-reading-layout='paged-dual'][data-effective-columns='2'] .astrolib-chapter-content.astrolib-paged-flow {
      transition: none !important;
    }
    @media (prefers-reduced-motion: no-preference) {
      html[data-reading-layout='paged-dual'][data-effective-columns='2'] .astrolib-chapter-content.astrolib-paged-flow {
        transition: opacity 0.11s cubic-bezier(0.2, 0, 0, 1) !important;
      }
      html[data-reading-layout='paged-dual'][data-effective-columns='2'] .astrolib-chapter-content.astrolib-paged-flow.is-dual-turning {
        opacity: 0;
        transition: opacity 0.065s ease-out !important;
      }
    }
    .astrolib-chapter-content.astrolib-paged-flow h1,
    .astrolib-chapter-content.astrolib-paged-flow h2,
    .astrolib-chapter-content.astrolib-paged-flow h3 {
      break-after: avoid;
      page-break-after: avoid;
    }
    .astrolib-chapter-content.astrolib-paged-flow img,
    .astrolib-chapter-content.astrolib-paged-flow figure,
    .astrolib-chapter-content.astrolib-paged-flow .katex-display,
    .astrolib-chapter-content.astrolib-paged-flow .academic-card,
    .astrolib-chapter-content.astrolib-paged-flow pre,
    .astrolib-chapter-content.astrolib-paged-flow blockquote {
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .astrolib-chapter-content.astrolib-paged-flow img {
      max-height: calc(var(--astrolib-page-height, 600px) - 28px) !important;
      width: auto !important;
      max-width: 100% !important;
      object-fit: contain;
    }
    .astrolib-chapter-content.astrolib-paged-flow .prev-next {
      break-inside: avoid;
      margin-top: 1.5rem !important;
    }
    /* 双栏书脊柔和参考发丝线（极克制） */
    html[data-reading-layout='paged-dual'][data-effective-columns='2'] .sl-markdown-content.astrolib-paged-host::after {
      content: '';
      position: absolute;
      top: 12px;
      bottom: 12px;
      left: 50%;
      width: 1px;
      background: var(--md-sys-color-outline-variant, rgba(125, 125, 125, 0.16));
      opacity: 0.45;
      pointer-events: none;
    }

    /* 5. 底部极简悬浮翻页控制胶囊 */
    .astrolib-paged-bar {
      position: fixed;
      bottom: 14px;
      left: 50%;
      transform: translateX(-50%);
      display: none;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--md-sys-color-surface-container, #f3f5f8) 92%, transparent);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      border: 1px solid var(--md-sys-color-outline-variant, rgba(125, 125, 125, 0.24));
      color: var(--md-sys-color-on-surface, #1b1b1f);
      z-index: 420;
      font-family: var(--font-ui, 'Google Sans Text', sans-serif);
      font-size: 0.78rem;
      user-select: none;
    }
    [data-theme='dark'] .astrolib-paged-bar {
      background: color-mix(in srgb, var(--md-sys-color-surface-container, #1e1f23) 92%, transparent);
      color: #e3e3e6;
    }
    html[data-reading-layout='paged-single'] .astrolib-paged-bar,
    html[data-reading-layout='paged-dual'] .astrolib-paged-bar {
      display: inline-flex;
    }
    .pb-nav-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 3px;
      height: 28px;
      padding: 0 10px;
      border-radius: 999px;
      border: none;
      background: transparent;
      color: inherit;
      cursor: pointer;
      font-size: 0.76rem;
      font-weight: 500;
      transition: background-color 0.15s ease;
    }
    .pb-nav-btn:hover:not(:disabled) {
      background: var(--md-sys-color-surface-container-highest, rgba(125, 125, 125, 0.14));
    }
    .pb-nav-btn:disabled {
      opacity: 0.36;
      cursor: default;
    }
    .pb-indicator {
      min-width: 68px;
      text-align: center;
      font-variant-numeric: tabular-nums;
      font-weight: 500;
      color: var(--md-sys-color-on-surface-variant, #5f6368);
      padding: 0 4px;
    }
    .pb-progress-track {
      width: 64px;
      height: 3px;
      border-radius: 999px;
      background: var(--md-sys-color-outline-variant, rgba(125, 125, 125, 0.28));
      overflow: hidden;
    }
    .pb-progress-fill {
      height: 100%;
      width: 0%;
      background: var(--md-sys-color-primary, #0b57d0);
      transition: width 0.2s ease;
    }

    /* 6. EPUB 译注 / 脚注就地浮窗 (M3 Expressive Popover) */
    a[data-astrolib-footnote] {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      text-indent: 0 !important;
      padding: 0.05em 0.3em;
      margin: 0 0.12em;
      border-radius: 4px;
      color: var(--md-sys-color-primary, #0b57d0) !important;
      text-decoration: none !important;
      font-size: 0.8em;
      vertical-align: super;
      line-height: 1;
      cursor: pointer;
      background: color-mix(in srgb, var(--md-sys-color-primary, #0b57d0) 10%, transparent);
      transition: background-color 0.15s ease;
    }
    a[data-astrolib-footnote]:hover {
      background: color-mix(in srgb, var(--md-sys-color-primary, #0b57d0) 20%, transparent);
    }
    .astrolib-footnote-popover {
      position: fixed;
      max-width: min(380px, calc(100vw - 24px));
      background: var(--md-sys-color-surface-container-high, #eceef3);
      color: var(--md-sys-color-on-surface, #1b1b1f);
      border: 1px solid var(--md-sys-color-outline-variant, #c4c6d0);
      border-radius: 14px;
      padding: 12px 14px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.14);
      z-index: 660;
      display: none;
      flex-direction: column;
      gap: 8px;
      font-size: 0.85rem;
      line-height: 1.6;
    }
    [data-theme='dark'] .astrolib-footnote-popover {
      background: var(--md-sys-color-surface-container-high, #28292e);
      color: #e3e3e6;
      border-color: #44474f;
      box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45);
    }
    .astrolib-footnote-popover.is-open {
      display: flex;
    }
    .fn-pop-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 0.74rem;
      font-weight: 600;
      color: var(--md-sys-color-primary, #0b57d0);
    }
    .fn-pop-footer {
      display: flex;
      justify-content: flex-end;
      font-size: 0.74rem;
    }
    .fn-pop-link {
      color: var(--md-sys-color-primary, #0b57d0);
      text-decoration: none;
    }
    .fn-pop-link:hover {
      text-decoration: underline;
    }
    @keyframes astrolibTargetFlash {
      0% { background-color: color-mix(in srgb, var(--md-sys-color-primary, #0b57d0) 22%, transparent); }
      100% { background-color: transparent; }
    }
    .target-flash {
      animation: astrolibTargetFlash 1.5s cubic-bezier(0.2, 0, 0, 1);
      border-radius: 6px;
    }

    /* 7. 全屏插画灯箱赏析 */
    .astrolib-lightbox {
      position: fixed;
      inset: 0;
      background: rgba(12, 13, 16, 0.88);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 900;
      padding: 24px;
      cursor: zoom-out;
    }
    .astrolib-lightbox.is-open {
      display: flex;
    }
    .astrolib-lightbox img {
      max-width: 94vw;
      max-height: 92vh;
      object-fit: contain;
      border-radius: 6px;
      transition: transform 0.16s ease;
      cursor: default;
    }
    .astrolib-lightbox-close {
      position: fixed;
      top: 18px;
      right: 20px;
      width: 36px;
      height: 36px;
      border-radius: 50%;
      border: 1px solid rgba(255, 255, 255, 0.24);
      background: rgba(255, 255, 255, 0.12);
      color: #ffffff;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }
    .astrolib-lightbox-close:hover {
      background: rgba(255, 255, 255, 0.24);
    }
  </style>

  <script>
    (function initReaderLayoutAddon() {
      if (typeof window === 'undefined') return;
      var CFG = ${safeCfg};

      function getStorageKey() {
        return CFG.prefsKeyPrefix + CFG.bookKey;
      }

      function normalizeLayout(v) {
        return (v === 'paged-single' || v === 'paged-dual' || v === 'scroll') ? v : 'scroll';
      }

      function loadPrefs() {
        var defLayout = 'scroll';
        try {
          defLayout = normalizeLayout(localStorage.getItem(CFG.defaultLayoutKey));
        } catch(e) {}

        var base = {
          layoutMode: defLayout,
          readingProfile: CFG.defaultProfile || 'academic',
          styleMode: 'harmonized',
          useBookFonts: true
        };
        try {
          var fmtKey = CFG.sourceFormat === 'epub' ? 'epub' : 'abp';
          var rawFmt = localStorage.getItem('astrolib_format_defaults_v1');
          if (rawFmt) {
            var fmtStore = JSON.parse(rawFmt);
            var fmtDef = fmtStore && typeof fmtStore === 'object' ? fmtStore[fmtKey] : null;
            if (fmtDef && typeof fmtDef === 'object') {
              base.layoutMode = normalizeLayout(fmtDef.layoutMode || base.layoutMode);
              if (fmtDef.readingProfile === 'academic' || fmtDef.readingProfile === 'literary') {
                base.readingProfile = fmtDef.readingProfile;
              }
              if (fmtDef.styleMode === 'harmonized' || fmtDef.styleMode === 'original' || fmtDef.styleMode === 'reflow') {
                base.styleMode = fmtDef.styleMode;
              }
              if (typeof fmtDef.useBookFonts === 'boolean') {
                base.useBookFonts = fmtDef.useBookFonts;
              }
            }
          }
        } catch(e) {}
        try {
          var raw = localStorage.getItem(getStorageKey());
          if (raw) {
            var parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
              base.layoutMode = normalizeLayout(parsed.layoutMode || base.layoutMode);
              if (parsed.readingProfile === 'academic' || parsed.readingProfile === 'literary') {
                base.readingProfile = parsed.readingProfile;
              }
              if (parsed.styleMode === 'harmonized' || parsed.styleMode === 'original' || parsed.styleMode === 'reflow') {
                base.styleMode = parsed.styleMode;
              }
              if (typeof parsed.useBookFonts === 'boolean') {
                base.useBookFonts = parsed.useBookFonts;
              }
            }
          }
        } catch(e) {}
        return base;
      }

      function savePrefs(prefs) {
        try {
          var key = getStorageKey();
          var merged = {};
          var existingRaw = localStorage.getItem(key);
          if (existingRaw) {
            var existingParsed = JSON.parse(existingRaw);
            if (existingParsed && typeof existingParsed === 'object' && !Array.isArray(existingParsed)) {
              merged = existingParsed;
            }
          }
          merged.layoutMode = prefs.layoutMode;
          merged.readingProfile = prefs.readingProfile;
          merged.styleMode = prefs.styleMode;
          merged.useBookFonts = prefs.useBookFonts;
          localStorage.setItem(key, JSON.stringify(merged));
        } catch(e) {}
      }

      function computeMetrics(requestedMode, availWidth) {
        var safeW = Math.max(280, Math.floor(availWidth));
        var isDual = requestedMode === 'paged-dual';
        var effectiveColumns = (isDual && safeW >= CFG.dualMinWidth) ? 2 : 1;
        var degradedFromDual = isDual && effectiveColumns === 1;

        if (effectiveColumns === 2) {
          var gap2 = 48;
          var colW2 = Math.max(260, Math.floor((safeW - gap2) / 2));
          return {
            requestedMode: requestedMode,
            effectiveColumns: 2,
            degradedFromDual: false,
            columnWidth: colW2,
            columnGap: gap2,
            pageWidth: colW2 * 2 + gap2,
            pageStride: 2 * (colW2 + gap2)
          };
        }

        var gap1 = 40;
        return {
          requestedMode: requestedMode,
          effectiveColumns: 1,
          degradedFromDual: degradedFromDual,
          columnWidth: safeW,
          columnGap: gap1,
          pageWidth: safeW,
          pageStride: safeW + gap1
        };
      }

      var state = {
        prefs: loadPrefs(),
        currentPage: 0,
        totalPages: 1,
        metrics: computeMetrics('scroll', 800),
        footnotes: {}
      };

      try {
        var fnEl = document.getElementById('__book_footnotes__');
        if (fnEl && fnEl.textContent) {
          state.footnotes = JSON.parse(fnEl.textContent) || {};
        }
      } catch(e) {}

      function applyRootAttributes() {
        var root = document.documentElement;
        root.dataset.sourceFormat = CFG.sourceFormat;
        root.dataset.readingLayout = state.prefs.layoutMode;
        root.dataset.readingProfile = state.prefs.readingProfile;
        root.dataset.styleMode = state.prefs.styleMode;
        root.dataset.useBookFonts = state.prefs.useBookFonts ? 'true' : 'false';
        root.dataset.chapterKind = CFG.chapterKind || 'body';
      }

      // 立即在解析阶段同步首屏根节点属性，消除闪跳
      applyRootAttributes();

      var resizeObs = null;
      var wheelCooldown = 0;

      function getContainers() {
        var host = document.querySelector('.sl-markdown-content') || document.querySelector('main article');
        var flow = document.querySelector('.astrolib-chapter-content');
        return { host: host, flow: flow };
      }

      function setupContainers() {
        var c = getContainers();
        if (resizeObs) { resizeObs.disconnect(); resizeObs = null; }
        if (!c.host || !c.flow) return;

        var isPaged = state.prefs.layoutMode !== 'scroll';
        c.host.classList.toggle('astrolib-paged-host', isPaged);
        c.flow.classList.toggle('astrolib-paged-flow', isPaged);

        if (!isPaged) {
          c.host.style.removeProperty('width');
          c.host.style.removeProperty('margin-inline');
          c.flow.style.removeProperty('width');
          c.flow.style.removeProperty('height');
          c.flow.style.removeProperty('column-width');
          c.flow.style.removeProperty('column-gap');
          c.flow.style.removeProperty('transform');
          return;
        }

        if (typeof ResizeObserver !== 'undefined') {
          resizeObs = new ResizeObserver(function() {
            recalculate(false);
          });
          resizeObs.observe(c.host.parentElement || c.host);
        }
      }

      function updatePagedBarUi() {
        var bar = document.getElementById('astrolib-paged-bar');
        if (!bar) return;
        var ind = bar.querySelector('.pb-indicator');
        var fill = bar.querySelector('.pb-progress-fill');
        var prevBtn = bar.querySelector('[data-pb-prev]');
        var nextBtn = bar.querySelector('[data-pb-next]');

        if (ind) ind.textContent = (state.currentPage + 1) + ' / ' + state.totalPages;
        if (fill) {
          var pct = state.totalPages <= 1 ? 100 : Math.round(((state.currentPage + 1) / state.totalPages) * 100);
          fill.style.width = pct + '%';
        }
        var hasPrevChapter = Boolean(document.querySelector('.prev-next .pager-link.prev'));
        var hasNextChapter = Boolean(document.querySelector('.prev-next .pager-link.next'));
        if (prevBtn) {
          prevBtn.disabled = state.currentPage <= 0 && !hasPrevChapter;
          prevBtn.textContent = state.currentPage <= 0 && hasPrevChapter ? '上一节' : '上一页';
        }
        if (nextBtn) {
          nextBtn.disabled = state.currentPage >= state.totalPages - 1 && !hasNextChapter;
          nextBtn.textContent = state.currentPage >= state.totalPages - 1 && hasNextChapter ? '下一节' : '下一页';
        }
      }

      function updateLayoutPopoverUi() {
        var pop = document.getElementById('astrolib-layout-popover');
        if (!pop) return;
        pop.querySelectorAll('[data-set-layout]').forEach(function(btn) {
          btn.classList.toggle('is-active', btn.getAttribute('data-set-layout') === state.prefs.layoutMode);
        });
        pop.querySelectorAll('[data-set-profile]').forEach(function(btn) {
          btn.classList.toggle('is-active', btn.getAttribute('data-set-profile') === state.prefs.readingProfile);
        });
        pop.querySelectorAll('[data-set-style]').forEach(function(btn) {
          btn.classList.toggle('is-active', btn.getAttribute('data-set-style') === state.prefs.styleMode);
        });
        var fontSwitch = pop.querySelector('#lp-use-book-fonts');
        if (fontSwitch) {
          fontSwitch.setAttribute('aria-checked', String(state.prefs.useBookFonts));
        }
        var dualHint = pop.querySelector('#lp-dual-degrade-hint');
        if (dualHint) {
          dualHint.style.display = state.metrics.degradedFromDual ? 'inline' : 'none';
        }
      }

      function recalculate(resetToStart) {
        var c = getContainers();
        if (state.prefs.layoutMode === 'scroll' || !c.host || !c.flow) {
          state.metrics = computeMetrics('scroll', (c.host && c.host.clientWidth) || 800);
          state.currentPage = 0;
          state.totalPages = 1;
          document.documentElement.dataset.effectiveColumns = '1';
          updatePagedBarUi();
          updateLayoutPopoverUi();
          return;
        }

        var parent = c.host.parentElement || c.host;
        var pStyle = getComputedStyle(parent);
        var padX = (parseFloat(pStyle.paddingLeft) || 0) + (parseFloat(pStyle.paddingRight) || 0);
        var availW = Math.max(280, parent.clientWidth - padX);
        state.metrics = computeMetrics(state.prefs.layoutMode, availW);
        document.documentElement.dataset.effectiveColumns = String(state.metrics.effectiveColumns);

        var navH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sl-nav-height')) || 40;
        var hostRect = c.host.getBoundingClientRect();
        var hostTop = Math.max(navH + 8, Math.round(hostRect.top));
        var pageH = Math.max(280, Math.floor(window.innerHeight - hostTop - 56));

        c.host.style.width = state.metrics.pageWidth + 'px';
        c.host.style.marginInline = 'auto';
        c.flow.style.setProperty('--astrolib-page-height', pageH + 'px');
        c.flow.style.width = state.metrics.pageWidth + 'px';
        c.flow.style.height = pageH + 'px';
        c.flow.style.columnWidth = state.metrics.columnWidth + 'px';
        c.flow.style.columnGap = state.metrics.columnGap + 'px';

        c.flow.style.transform = 'translateX(0px)';
        var totalW = c.flow.scrollWidth;
        var stride = state.metrics.columnWidth + state.metrics.columnGap;
        var totalCols = Math.max(1, Math.round((totalW + state.metrics.columnGap) / stride));
        state.totalPages = Math.max(1, Math.ceil(totalCols / state.metrics.effectiveColumns));

        if (resetToStart) {
          state.currentPage = 0;
        } else {
          state.currentPage = Math.max(0, Math.min(state.totalPages - 1, state.currentPage));
        }

        var offsetX = state.currentPage * state.metrics.pageStride;
        c.flow.style.transform = 'translateX(-' + offsetX + 'px)';
        updatePagedBarUi();
        updateLayoutPopoverUi();
      }

      var dualFadeTimer = null;
      var dualSafetyTimer = null;

      function goToPage(pageIdx) {
        var c = getContainers();
        if (state.prefs.layoutMode === 'scroll' || !c.flow) return;
        state.currentPage = Math.max(0, Math.min(state.totalPages - 1, Math.floor(pageIdx)));
        var offsetX = state.currentPage * state.metrics.pageStride;

        if (dualFadeTimer) { clearTimeout(dualFadeTimer); dualFadeTimer = null; }
        if (dualSafetyTimer) { clearTimeout(dualSafetyTimer); dualSafetyTimer = null; }

        var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        var isDualFade = state.prefs.layoutMode === 'paged-dual' && state.metrics.effectiveColumns === 2 && !reduceMotion;

        if (isDualFade) {
          c.flow.classList.add('is-dual-turning');
          updatePagedBarUi();
          dualFadeTimer = setTimeout(function() {
            c.flow.style.transform = 'translateX(-' + offsetX + 'px)';
            void c.flow.offsetWidth;
            c.flow.classList.remove('is-dual-turning');
            dualFadeTimer = null;
          }, 65);
          dualSafetyTimer = setTimeout(function() {
            c.flow.classList.remove('is-dual-turning');
            dualSafetyTimer = null;
          }, 220);
        } else {
          c.flow.classList.remove('is-dual-turning');
          c.flow.style.transform = 'translateX(-' + offsetX + 'px)';
          updatePagedBarUi();
        }
      }

      function nextPage() {
        if (state.prefs.layoutMode === 'scroll') return false;
        if (state.currentPage < state.totalPages - 1) {
          goToPage(state.currentPage + 1);
          return true;
        }
        return false;
      }

      function prevPage() {
        if (state.prefs.layoutMode === 'scroll') return false;
        if (state.currentPage > 0) {
          goToPage(state.currentPage - 1);
          return true;
        }
        return false;
      }

      function scrollToElement(el, opts) {
        if (!el) return;
        var options = opts || {};
        var c = getContainers();
        if (state.prefs.layoutMode === 'scroll' || !c.flow) {
          el.scrollIntoView({ behavior: options.behavior || 'smooth', block: options.block || 'center' });
        } else {
          var flowRect = c.flow.getBoundingClientRect();
          var targetRect = el.getBoundingClientRect();
          var absLeft = Math.max(0, targetRect.left - flowRect.left);
          var colStride = Math.max(1, state.metrics.columnWidth + state.metrics.columnGap);
          var colIdx = Math.max(0, Math.floor((absLeft + 4) / colStride));
          var pageIdx = Math.floor(colIdx / state.metrics.effectiveColumns);
          goToPage(pageIdx);
        }
        if (options.flash) {
          el.classList.add('card-ref-flash');
          setTimeout(function() { el.classList.remove('card-ref-flash'); }, 1600);
        }
      }

      function findAnchorEl() {
        var c = getContainers();
        if (!c.flow) return null;
        var nodes = c.flow.querySelectorAll('h1, h2, h3, h4, p, .academic-card');
        if (state.prefs.layoutMode === 'scroll') {
          for (var i = 0; i < nodes.length; i++) {
            var r = nodes[i].getBoundingClientRect();
            if (r.bottom >= 72 && r.height > 0) return nodes[i];
          }
        } else if (c.host) {
          var hRect = c.host.getBoundingClientRect();
          for (var j = 0; j < nodes.length; j++) {
            var r2 = nodes[j].getBoundingClientRect();
            if (r2.right > hRect.left && r2.left < hRect.right) return nodes[j];
          }
        }
        return nodes[0] || null;
      }

      function setLayoutMode(mode) {
        var next = normalizeLayout(mode);
        if (state.prefs.layoutMode === next) return;
        var anchor = findAnchorEl();
        state.prefs.layoutMode = next;
        savePrefs(state.prefs);
        applyRootAttributes();
        if (next !== 'scroll') {
          window.scrollTo(0, 0);
        }
        setupContainers();
        recalculate(false);
        if (anchor) {
          requestAnimationFrame(function() { scrollToElement(anchor, { behavior: 'auto', block: 'start' }); });
        }
      }

      function setReadingProfile(profile) {
        if (profile !== 'academic' && profile !== 'literary') return;
        if (state.prefs.readingProfile === profile) return;
        state.prefs.readingProfile = profile;
        savePrefs(state.prefs);
        applyRootAttributes();
        window.dispatchEvent(new CustomEvent('astrolib:reading-profile-change', {
          detail: { readingProfile: profile, sourceFormat: CFG.sourceFormat }
        }));
        recalculate(false);
      }

      function setStyleMode(styleMode) {
        if (styleMode !== 'harmonized' && styleMode !== 'original' && styleMode !== 'reflow') return;
        if (state.prefs.styleMode === styleMode) return;
        state.prefs.styleMode = styleMode;
        savePrefs(state.prefs);
        applyRootAttributes();
        recalculate(false);
      }

      function setUseBookFonts(enabled) {
        state.prefs.useBookFonts = Boolean(enabled);
        savePrefs(state.prefs);
        applyRootAttributes();
        if (document.fonts && document.fonts.ready) {
          document.fonts.ready.then(function() { recalculate(false); });
        } else {
          recalculate(false);
        }
      }

      window.__readerViewport = {
        getState: function() {
          return Object.assign({}, state.prefs, {
            currentPage: state.currentPage,
            totalPages: state.totalPages,
            effectiveColumns: state.metrics.effectiveColumns,
            degradedFromDual: state.metrics.degradedFromDual
          });
        },
        setLayoutMode: setLayoutMode,
        setReadingProfile: setReadingProfile,
        setStyleMode: setStyleMode,
        setUseBookFonts: setUseBookFonts,
        nextPage: nextPage,
        prevPage: prevPage,
        goToPage: goToPage,
        recalculate: function() { recalculate(false); },
        scrollToElement: scrollToElement,
        getFootnote: function(id) { return state.footnotes[id] || null; }
      };

      function ensureOverlayWidgets() {
        // 1. 版式快捷调节浮层
        if (!document.getElementById('astrolib-layout-popover')) {
          var pop = document.createElement('div');
          pop.id = 'astrolib-layout-popover';
          pop.className = 'astrolib-layout-popover';
          pop.setAttribute('role', 'dialog');
          pop.setAttribute('aria-label', '阅读版式与视图设置');

          var styleSectionHtml = CFG.hasStylesheets
            ? '<div class="lp-group">' +
                '<div class="lp-label-row"><span class="lp-label">原书版式</span></div>' +
                '<div class="lp-chips">' +
                  '<button type="button" class="lp-chip" data-set-style="harmonized">主题融合</button>' +
                  '<button type="button" class="lp-chip" data-set-style="original">出版原貌</button>' +
                  '<button type="button" class="lp-chip" data-set-style="reflow">统一重排</button>' +
                '</div>' +
              '</div>'
            : '';

          var fontToggleHtml = CFG.hasEmbeddedFonts
            ? '<div class="lp-switch-row">' +
                '<div class="lp-switch-texts">' +
                  '<span class="lp-switch-title">优先原书内嵌字体</span>' +
                  '<span class="lp-switch-desc">缺失字符自动回退至系统字库</span>' +
                '</div>' +
                '<button type="button" role="switch" id="lp-use-book-fonts" class="lp-toggle-pill" aria-checked="true" aria-label="优先原书内嵌字体"></button>' +
              '</div>'
            : '';

          pop.innerHTML =
            '<div class="lp-header">' +
              '<span class="lp-title">版式与视图</span>' +
              '<button type="button" class="lp-close-btn" id="lp-close-btn" aria-label="关闭版式浮层">' +
                '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
              '</button>' +
            '</div>' +
            '<div class="lp-group">' +
              '<div class="lp-label-row">' +
                '<span class="lp-label">阅读布局</span>' +
                '<span class="lp-hint" id="lp-dual-degrade-hint" style="display:none;">视窗较窄，已自动单栏呈现</span>' +
              '</div>' +
              '<div class="lp-chips">' +
                '<button type="button" class="lp-chip" data-set-layout="scroll">连续滚动</button>' +
                '<button type="button" class="lp-chip" data-set-layout="paged-single">单页翻阅</button>' +
                '<button type="button" class="lp-chip" data-set-layout="paged-dual">双栏对页</button>' +
              '</div>' +
            '</div>' +
            '<div class="lp-group">' +
              '<div class="lp-label-row"><span class="lp-label">排版体裁</span></div>' +
              '<div class="lp-chips is-two">' +
                '<button type="button" class="lp-chip" data-set-profile="academic">学术排版</button>' +
                '<button type="button" class="lp-chip" data-set-profile="literary">文学排版</button>' +
              '</div>' +
            '</div>' +
            styleSectionHtml +
            fontToggleHtml;

          document.body.appendChild(pop);
        }

        // 2. 底部悬浮分页胶囊
        if (!document.getElementById('astrolib-paged-bar')) {
          var bar = document.createElement('div');
          bar.id = 'astrolib-paged-bar';
          bar.className = 'astrolib-paged-bar';
          bar.innerHTML =
            '<button type="button" class="pb-nav-btn" data-pb-prev>上一页</button>' +
            '<div class="pb-progress-track"><div class="pb-progress-fill"></div></div>' +
            '<span class="pb-indicator">1 / 1</span>' +
            '<button type="button" class="pb-nav-btn" data-pb-next>下一页</button>';
          document.body.appendChild(bar);
        }

        // 3. 译注浮窗
        if (!document.getElementById('astrolib-footnote-popover')) {
          var fnPop = document.createElement('div');
          fnPop.id = 'astrolib-footnote-popover';
          fnPop.className = 'astrolib-footnote-popover';
          fnPop.innerHTML =
            '<div class="fn-pop-header">' +
              '<span>译注 / 注释</span>' +
              '<button type="button" class="lp-close-btn" id="fn-pop-close" aria-label="关闭注释">' +
                '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
              '</button>' +
            '</div>' +
            '<div class="fn-pop-body" id="fn-pop-body"></div>' +
            '<div class="fn-pop-footer"><a class="fn-pop-link" id="fn-pop-link" href="#">定位至原注页</a></div>';
          document.body.appendChild(fnPop);
        }

        // 4. 全屏插画灯箱
        if (!document.getElementById('astrolib-illustration-lightbox')) {
          var lb = document.createElement('div');
          lb.id = 'astrolib-illustration-lightbox';
          lb.className = 'astrolib-lightbox';
          lb.innerHTML =
            '<button type="button" class="astrolib-lightbox-close" id="lb-close-btn" aria-label="关闭大图赏析">' +
              '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
            '</button>' +
            '<img id="astrolib-lightbox-img" alt="插画大图" />';
          document.body.appendChild(lb);
        }
      }

      function toggleLayoutPopover(forceOpen) {
        var pop = document.getElementById('astrolib-layout-popover');
        var btn = document.getElementById('vp-reading-layout-btn');
        if (!pop) return;
        var next = typeof forceOpen === 'boolean' ? forceOpen : !pop.classList.contains('is-open');
        pop.classList.toggle('is-open', next);
        if (btn) btn.setAttribute('aria-expanded', String(next));
        if (next) updateLayoutPopoverUi();
      }

      function openFootnotePopover(anchorEl, noteId, fallbackHref) {
        var entry = state.footnotes[noteId];
        if (!entry) return false;
        var pop = document.getElementById('astrolib-footnote-popover');
        var body = document.getElementById('fn-pop-body');
        var link = document.getElementById('fn-pop-link');
        var titleSpan = pop ? pop.querySelector('.fn-pop-header span') : null;
        if (!pop || !body || !link) return false;

        if (titleSpan) titleSpan.textContent = entry.title || '脚注';
        body.innerHTML = entry.html || entry.text || '';
        var hasTargetOnPage = fallbackHref && fallbackHref.startsWith('#') && document.getElementById(fallbackHref.slice(1));
        if (fallbackHref && (hasTargetOnPage || !fallbackHref.startsWith('#'))) {
          link.href = fallbackHref;
          link.textContent = hasTargetOnPage ? '跳转至文末脚注 ↓' : '定位至原注页';
          link.style.display = '';
        } else {
          link.style.display = 'none';
        }
        pop.classList.add('is-open');

        var rect = anchorEl.getBoundingClientRect();
        var popW = Math.min(380, window.innerWidth - 24);
        var left = Math.max(12, Math.min(window.innerWidth - popW - 12, rect.left));
        var top = rect.bottom + 8;
        if (top + 180 > window.innerHeight && rect.top > 190) {
          top = Math.max(52, rect.top - 160);
        }
        pop.style.left = left + 'px';
        pop.style.top = top + 'px';
        return true;
      }

      var fnHoverTimer = null;
      function scheduleCloseFootnotePopover() {
        if (fnHoverTimer) clearTimeout(fnHoverTimer);
        fnHoverTimer = setTimeout(function() {
          closeFootnotePopover();
        }, 180);
      }
      function cancelCloseFootnotePopover() {
        if (fnHoverTimer) {
          clearTimeout(fnHoverTimer);
          fnHoverTimer = null;
        }
      }

      function jumpAndFlashElement(targetEl) {
        if (!targetEl) return;
        if (typeof scrollToElement === 'function') {
          scrollToElement(targetEl, { behavior: 'smooth', block: 'center' });
        } else {
          targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        targetEl.classList.remove('target-flash');
        void targetEl.offsetWidth;
        targetEl.classList.add('target-flash');
      }

      function closeFootnotePopover() {
        var pop = document.getElementById('astrolib-footnote-popover');
        if (pop) pop.classList.remove('is-open');
      }

      var lbScale = 1;
      function openLightbox(src, alt) {
        var lb = document.getElementById('astrolib-illustration-lightbox');
        var img = document.getElementById('astrolib-lightbox-img');
        if (!lb || !img) return;
        lbScale = 1;
        img.style.transform = 'scale(1)';
        img.src = src;
        img.alt = alt || '';
        lb.classList.add('is-open');
      }
      function closeLightbox() {
        var lb = document.getElementById('astrolib-illustration-lightbox');
        if (lb) lb.classList.remove('is-open');
      }

      function bindEventsOnce() {
        if (window.__astrolibViewportBound) return;
        window.__astrolibViewportBound = true;

        document.addEventListener('click', function(e) {
          var t = e.target;
          if (!t || !t.closest) return;

          if (t.closest('[data-layout-trigger]')) {
            e.preventDefault();
            e.stopPropagation();
            toggleLayoutPopover();
            return;
          }
          if (t.closest('#lp-close-btn')) {
            toggleLayoutPopover(false);
            return;
          }

          var layoutBtn = t.closest('[data-set-layout]');
          if (layoutBtn) {
            setLayoutMode(layoutBtn.getAttribute('data-set-layout'));
            return;
          }
          var profBtn = t.closest('[data-set-profile]');
          if (profBtn) {
            setReadingProfile(profBtn.getAttribute('data-set-profile'));
            return;
          }
          var styleBtn = t.closest('[data-set-style]');
          if (styleBtn) {
            setStyleMode(styleBtn.getAttribute('data-set-style'));
            return;
          }
          if (t.closest('#lp-use-book-fonts')) {
            setUseBookFonts(!state.prefs.useBookFonts);
            return;
          }

          if (t.closest('[data-pb-prev]')) {
            if (!prevPage()) {
              var prevChap = document.querySelector('.prev-next .pager-link.prev');
              if (prevChap) prevChap.click();
            }
            return;
          }
          if (t.closest('[data-pb-next]')) {
            if (!nextPage()) {
              var nextChap = document.querySelector('.prev-next .pager-link.next');
              if (nextChap) nextChap.click();
            }
            return;
          }

          // 脚注跳转逻辑：同页文末脚注直接平滑滚动并闪烁高亮；跨页 EPUB 注脚则弹出浮窗
          var fnRef = t.closest('a[data-astrolib-footnote]');
          if (fnRef) {
            var fnHref = fnRef.getAttribute('href') || '';
            var targetId = fnHref.startsWith('#') ? fnHref.slice(1) : '';
            var samePageTarget = targetId ? document.getElementById(targetId) : null;
            if (samePageTarget) {
              e.preventDefault();
              closeFootnotePopover();
              jumpAndFlashElement(samePageTarget);
              return;
            }
            var noteId = fnRef.getAttribute('data-astrolib-footnote');
            if (noteId && openFootnotePopover(fnRef, noteId, fnHref)) {
              e.preventDefault();
              return;
            }
          }
          var fnPopLink = t.closest('#fn-pop-link');
          if (fnPopLink) {
            var popHref = fnPopLink.getAttribute('href') || '';
            if (popHref.startsWith('#')) {
              var popTarget = document.getElementById(popHref.slice(1));
              if (popTarget) {
                e.preventDefault();
                closeFootnotePopover();
                jumpAndFlashElement(popTarget);
                return;
              }
            }
          }
          var fnBack = t.closest('.fn-back-link');
          if (fnBack) {
            var refId = fnBack.getAttribute('data-fn-ref') || (fnBack.getAttribute('href') || '').replace(/^#/, '');
            var refTarget = refId ? document.getElementById(refId) : null;
            if (refTarget) {
              e.preventDefault();
              jumpAndFlashElement(refTarget);
              return;
            }
          }
          if (t.closest('#fn-pop-close')) {
            closeFootnotePopover();
            return;
          }

          // 插画大图灯箱触发与关闭
          if (t.closest('#lb-close-btn') || (t.id === 'astrolib-illustration-lightbox')) {
            closeLightbox();
            return;
          }
          var bookImg = t.closest('.astrolib-book-scope img');
          if (bookImg && bookImg.src) {
            e.preventDefault();
            openLightbox(bookImg.src, bookImg.alt);
            return;
          }

          // 点击浮层外部关闭
          if (!t.closest('#astrolib-layout-popover')) {
            toggleLayoutPopover(false);
          }
          if (!t.closest('#astrolib-footnote-popover') && !t.closest('a[data-astrolib-footnote]')) {
            closeFootnotePopover();
          }
        });

        window.addEventListener('keydown', function(e) {
          var target = e.target;
          if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
            return;
          }
          if (e.key === 'Escape') {
            closeLightbox();
            closeFootnotePopover();
            toggleLayoutPopover(false);
            return;
          }
          if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'l') {
            e.preventDefault();
            toggleLayoutPopover();
            return;
          }
          if (state.prefs.layoutMode !== 'scroll') {
            if (document.querySelector('.astrolib-lightbox.is-open, #astrolib-layout-popover.is-open')) return;
            if (e.key === 'ArrowRight' || e.key === 'PageDown') {
              e.preventDefault();
              if (!nextPage()) {
                var nextChap = document.querySelector('.prev-next .pager-link.next');
                if (nextChap) nextChap.click();
              }
            } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
              e.preventDefault();
              if (!prevPage()) {
                var prevChap = document.querySelector('.prev-next .pager-link.prev');
                if (prevChap) prevChap.click();
              }
            } else if (e.key === ' ') {
              e.preventDefault();
              if (e.shiftKey) prevPage(); else nextPage();
            }
          }
        });

        window.addEventListener('wheel', function(e) {
          var lb = document.getElementById('astrolib-illustration-lightbox');
          if (lb && lb.classList.contains('is-open')) {
            e.preventDefault();
            lbScale = Math.max(0.5, Math.min(3.0, lbScale + (e.deltaY < 0 ? 0.15 : -0.15)));
            var img = document.getElementById('astrolib-lightbox-img');
            if (img) img.style.transform = 'scale(' + lbScale.toFixed(2) + ')';
            return;
          }
          if (state.prefs.layoutMode === 'scroll') return;
          if (e.target && e.target.closest && e.target.closest('.katex-display, pre, .astrolib-sideload-dock, #starlight__sidebar, .astrolib-footnote-popover, #astrolib-layout-popover')) {
            return;
          }
          var now = Date.now();
          if (now - wheelCooldown < 240) return;
          var delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
          if (Math.abs(delta) < 18) return;
          e.preventDefault();
          wheelCooldown = now;
          if (delta > 0) nextPage();
          else prevPage();
        }, { passive: false });

        window.addEventListener('astrolib:sideload-change', function() {
          setTimeout(function() { recalculate(false); }, 260);
        });

        // 脚注悬停临时预览（支持鼠标平滑移入浮窗，离开延迟关闭）
        document.addEventListener('mouseover', function(e) {
          var t = e.target;
          if (!t || !t.closest) return;
          var fnRef = t.closest('a[data-astrolib-footnote]');
          if (fnRef) {
            cancelCloseFootnotePopover();
            var noteId = fnRef.getAttribute('data-astrolib-footnote');
            if (noteId) openFootnotePopover(fnRef, noteId, fnRef.getAttribute('href'));
            return;
          }
          if (t.closest('#astrolib-footnote-popover')) {
            cancelCloseFootnotePopover();
          }
        });

        document.addEventListener('mouseout', function(e) {
          var t = e.target;
          if (!t || !t.closest) return;
          var fromRef = t.closest('a[data-astrolib-footnote]');
          var fromPop = t.closest('#astrolib-footnote-popover');
          if (!fromRef && !fromPop) return;
          var rel = e.relatedTarget;
          if (rel && rel.closest && (rel.closest('a[data-astrolib-footnote]') || rel.closest('#astrolib-footnote-popover'))) {
            return;
          }
          scheduleCloseFootnotePopover();
        });
      }

      function onReady() {
        if (!state.footnotes || Object.keys(state.footnotes).length === 0) {
          try {
            var fnEl = document.getElementById('__book_footnotes__');
            if (fnEl && fnEl.textContent) {
              state.footnotes = JSON.parse(fnEl.textContent) || {};
            }
          } catch(e) {}
        }
        if (state.prefs.layoutMode !== 'scroll') {
          window.scrollTo(0, 0);
        }
        ensureOverlayWidgets();
        bindEventsOnce();
        setupContainers();
        recalculate(true);
        if (document.fonts && document.fonts.ready) {
          document.fonts.ready.then(function() { recalculate(false); }).catch(function() {});
        }
        document.querySelectorAll('.astrolib-book-scope img').forEach(function(img) {
          if (!img.complete) {
            img.addEventListener('load', function() { recalculate(false); }, { once: true });
          }
        });
      }

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', onReady);
      } else {
        onReady();
      }
      document.addEventListener('astro:page-load', onReady);
    })();
  <\/script>
  `;
}
