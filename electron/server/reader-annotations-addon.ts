/**
 * electron/server/reader-annotations-addon.ts
 * ============================================================================
 * AstroLib 桌面阅读器文本批注、侧注与章节自由画布联动注入模块
 * ============================================================================
 * 核心能力：
 * 1. 兼容 Astro ViewTransitions (astro:page-load) 软切章无感重挂载，切章后划选批注
 *    与右侧分屏画布同步自动切换；
 * 2. DOM ↔ AST 节点确定性绑定 ([data-ast-node-id], [data-ast-uri]);
 * 3. 任意颜色段落/句子高亮 + Ctrl+Z / Ctrl+Y 撤销恢复批注；
 * 4. 可展开 Markdown + KaTeX 学术侧注卡片（Material 3 纯白无阴影浅边框规范，零 Emoji）；
 * 5. 右侧 Sideload Dock「批注与笔记」面板 + 一键呼出 Win11 分屏自由画布 + .anp 无损导入导出。
 * ============================================================================
 */

export function buildAnnotationsHeaderButtonsHtml(): string {
  return `
      <button
        type="button"
        class="m3-icon-btn m3-annotations-btn vp-annotations-btn"
        id="vp-annotations-btn"
        data-annotations-trigger
        aria-label="批注与章节笔记 (Alt+N)"
        data-tooltip="批注与笔记 (Alt+N)"
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 20h9"></path>
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
        </svg>
      </button>
  `;
}

export function buildAnnotationsSideloadPanelHtml(): string {
  return `
  <section class="sideload-panel-view" data-panel-id="annotations" aria-hidden="true">
    <div class="ann-sidebar-panel" id="ann-sidebar-panel">
      <div class="ann-sidebar-header">
        <div class="ann-sidebar-title-group">
          <button
            type="button"
            class="sideload-back-btn"
            id="annotations-back-to-toc"
            title="返回本节大纲 (Esc)"
            aria-label="返回本节大纲"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <line x1="19" y1="12" x2="5" y2="12"></line>
              <polyline points="12 19 5 12 12 5"></polyline>
            </svg>
          </button>
          <h3 class="ann-sidebar-title">批注与笔记</h3>
          <span class="ann-count-badge" id="ann-count-badge">0</span>
        </div>
        <div class="ann-sidebar-actions">
          <button type="button" class="ann-icon-btn" id="ann-open-split-canvas" title="在分屏右侧展开自由画布" aria-label="分屏自由画布">
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8">
              <rect x="3" y="3" width="18" height="18" rx="2"></rect>
              <line x1="12" y1="3" x2="12" y2="21"></line>
            </svg>
          </button>
          <button type="button" class="ann-icon-btn" id="ann-export-anp" title="导出整书/本章无损笔记包 (.anp.json)" aria-label="导出 ANP">
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
          </button>
          <button type="button" class="ann-icon-btn" id="ann-import-anp" title="导入并合并 .anp 笔记包" aria-label="导入 ANP">
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="17 8 12 3 7 8"></polyline>
              <line x1="12" y1="3" x2="12" y2="15"></line>
            </svg>
          </button>
          <input type="file" id="ann-import-file-input" accept=".anp,.json,.anp.json" style="display: none;" />
          <button type="button" class="ann-icon-btn" id="annotations-sidebar-close" title="关闭批注栏并恢复大纲 (Esc)" aria-label="关闭批注栏">
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      </div>

      <div class="ann-mode-bar" role="tablist" aria-label="批注视图切换">
        <button type="button" class="ann-chip is-active" data-ann-tab="stream">批注流</button>
        <button type="button" class="ann-chip" data-ann-tab="canvas">章节画布</button>
      </div>

      <div class="ann-panel-body" id="ann-stream-view">
        <div class="ann-filter-row" id="ann-filter-row">
          <button type="button" class="ann-filter-chip is-active" data-ann-filter="all">全部</button>
          <button type="button" class="ann-filter-chip" data-ann-filter="highlight">高亮</button>
          <button type="button" class="ann-filter-chip" data-ann-filter="sidenote">侧注</button>
        </div>
        <div class="ann-list" id="ann-list">
          <div class="ann-empty-hint">划选正文可赋予任意颜色高亮或撰写学术侧注；支持 Ctrl+Z / Ctrl+Y 撤销恢复批注。</div>
        </div>
      </div>

      <div class="ann-panel-body" id="ann-canvas-view" style="display: none;">
        <div class="ann-canvas-quick-actions">
          <button type="button" class="ann-primary-btn" id="ann-canvas-launch-split">在分屏打开自由画布</button>
          <button type="button" class="ann-tonal-btn" id="ann-canvas-add-quick">+ 速记卡片</button>
        </div>
        <div class="ann-quick-composer" id="ann-quick-composer" style="display: none;">
          <textarea id="ann-quick-markdown" rows="4" placeholder="输入章节笔记（支持 Markdown 与 $LaTeX$ 公式）..."></textarea>
          <div class="ann-quick-composer-actions">
            <button type="button" class="ann-tonal-btn" id="ann-quick-cancel">取消</button>
            <button type="button" class="ann-primary-btn" id="ann-quick-save">保存至章节画布</button>
          </div>
        </div>
        <div class="ann-list" id="ann-canvas-blocks-list">
          <div class="ann-empty-hint">本章自由画布暂无笔记卡片。点击「在分屏打开自由画布」使用无限画布与数位板手写。</div>
        </div>
      </div>
    </div>
  </section>
  `;
}

export function buildReaderAnnotationsAddonHtml(params: {
  colSlug: string;
  bookSlug: string;
  chapterSlug: string;
  chapterTitle: string;
}): string {
  const safeMeta = JSON.stringify({
    colSlug: params.colSlug,
    bookSlug: params.bookSlug,
    chapterSlug: params.chapterSlug,
    chapterTitle: params.chapterTitle,
  }).replace(/<\//g, '<\\/');

  return `
  <style id="astrolib-annotations-styles">
    /* 0. 顶栏新增图标统一样式与 Google M3 Plain Tooltip */
    .vp-annotations-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 2.125rem;
      height: 2.125rem;
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
    [data-theme='dark'] .vp-annotations-btn {
      color: var(--sl-color-gray-2, #e2e8f0);
    }
    .vp-annotations-btn:hover {
      background-color: var(--sl-color-gray-6, rgba(125, 125, 125, 0.1));
      color: var(--sl-color-text-accent, var(--md-sys-color-primary, #4f46e5));
    }
    .vp-annotations-btn[data-tooltip]::before {
      content: attr(data-tooltip);
      position: absolute;
      top: calc(100% + 8px);
      right: 0;
      transform: translateY(-3px);
      padding: 0.28rem 0.52rem;
      font-size: 0.6875rem;
      font-weight: 500;
      line-height: 1;
      white-space: nowrap;
      border-radius: var(--md-shape-corner-extra-small, 4px);
      background-color: var(--md-sys-color-inverse-surface, #313033);
      color: var(--md-sys-color-inverse-on-surface, #f4eff4);
      box-shadow: var(--md-elevation-level-2, 0 2px 6px rgba(0, 0, 0, 0.25));
      pointer-events: none;
      opacity: 0;
      visibility: hidden;
      transition: opacity 0.15s cubic-bezier(0.2, 0, 0, 1), transform 0.15s cubic-bezier(0.2, 0, 0, 1), visibility 0.15s;
      z-index: var(--layer-popover, 300);
    }
    .vp-annotations-btn[data-tooltip]::after {
      content: '';
      position: absolute;
      top: calc(100% + 3px);
      right: 0.85rem;
      transform: translateX(50%) translateY(-3px);
      border-width: 0 4px 5px 4px;
      border-style: solid;
      border-color: transparent transparent var(--md-sys-color-inverse-surface, #313033) transparent;
      pointer-events: none;
      opacity: 0;
      visibility: hidden;
      transition: opacity 0.15s cubic-bezier(0.2, 0, 0, 1), transform 0.15s cubic-bezier(0.2, 0, 0, 1), visibility 0.15s;
      z-index: var(--layer-popover, 300);
    }
    .vp-annotations-btn[data-tooltip]:hover::before,
    .vp-annotations-btn[data-tooltip]:focus-visible::before {
      opacity: 1;
      visibility: visible;
      transform: translateY(0);
    }
    .vp-annotations-btn[data-tooltip]:hover::after,
    .vp-annotations-btn[data-tooltip]:focus-visible::after {
      opacity: 1;
      visibility: visible;
      transform: translateX(50%) translateY(0);
    }

    /* 1. 侧载面板可见性与右栏铺满 */
    html[data-sideload-active='annotations'] .right-sidebar,
    html[data-sideload-active='annotations'] .right-sidebar-panel,
    html[data-sideload-active='annotations'] .astrolib-sideload-dock,
    body.annotations-sidebar-active .right-sidebar,
    body.annotations-sidebar-active .right-sidebar-panel,
    body.annotations-sidebar-active .astrolib-sideload-dock {
      width: 100% !important;
      max-width: 100% !important;
      padding: 0 !important;
      margin: 0 !important;
    }
    html[data-sideload-active='annotations'] .sideload-panel-view[data-panel-id='annotations'],
    .custom-page-sidebar.has-annotations-active .sideload-panel-view[data-panel-id='annotations'] {
      display: flex;
      flex-direction: column;
      height: 100%;
      width: 100%;
    }
    .ann-sidebar-panel {
      display: flex;
      flex-direction: column;
      height: 100%;
      width: 100%;
      overflow: hidden;
    }
    .ann-sidebar-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.7rem 0.85rem;
      border-bottom: 1px solid var(--md-sys-color-outline-variant, #e0e3e7);
      gap: 0.5rem;
    }
    .ann-sidebar-title-group {
      display: flex;
      align-items: center;
      gap: 0.45rem;
      min-width: 0;
    }
    .ann-sidebar-title {
      margin: 0;
      font-size: 0.94rem;
      font-weight: 600;
      color: var(--md-sys-color-on-surface, inherit);
    }
    .ann-count-badge {
      font-size: 0.72rem;
      font-weight: 600;
      padding: 0.08rem 0.42rem;
      border-radius: 999px;
      background: var(--md-sys-color-secondary-container, rgba(99, 102, 241, 0.14));
      color: var(--md-sys-color-on-secondary-container, inherit);
    }
    .ann-sidebar-actions {
      display: flex;
      align-items: center;
      gap: 0.2rem;
    }
    .ann-icon-btn {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      border: none;
      background: transparent;
      color: var(--md-sys-color-on-surface-variant, #64748b);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: background-color 0.15s ease, color 0.15s ease;
    }
    .ann-icon-btn:hover {
      background: var(--md-sys-color-surface-container-highest, rgba(128, 128, 128, 0.14));
      color: var(--md-sys-color-on-surface, inherit);
    }
    .ann-mode-bar {
      display: flex;
      gap: 0.4rem;
      padding: 0.55rem 0.85rem;
      border-bottom: 1px solid var(--md-sys-color-outline-variant, #e0e3e7);
    }
    .ann-chip, .ann-filter-chip {
      border: 1px solid var(--md-sys-color-outline-variant, #d8dce3);
      background: transparent;
      color: var(--md-sys-color-on-surface-variant, #64748b);
      border-radius: 8px;
      padding: 0.25rem 0.65rem;
      font-size: 0.78rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .ann-chip.is-active, .ann-filter-chip.is-active {
      background: var(--md-sys-color-secondary-container, rgba(99, 102, 241, 0.14));
      border-color: transparent;
      color: var(--md-sys-color-on-secondary-container, var(--md-sys-color-primary, #4f46e5));
      font-weight: 600;
    }
    .ann-panel-body {
      flex: 1;
      overflow-y: auto;
      padding: 0.7rem 0.85rem 1.25rem;
      display: flex;
      flex-direction: column;
      gap: 0.65rem;
    }
    .ann-filter-row {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
    }
    .ann-list {
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
    }
    .ann-empty-hint {
      font-size: 0.8rem;
      line-height: 1.55;
      color: var(--md-sys-color-on-surface-variant, #64748b);
      padding: 0.75rem;
      border-radius: 12px;
      background: var(--md-sys-color-surface, #ffffff);
      border: 1px solid var(--md-sys-color-outline-variant, #e0e3e7);
    }
    [data-theme='dark'] .ann-empty-hint {
      background: var(--md-sys-color-surface, #1b1c20);
      border-color: var(--md-sys-color-outline-variant, #343740);
    }

    /* M3 极简纯白无阴影卡片 (仅留浅色边框) */
    .ann-item-card {
      border-radius: 12px;
      padding: 0.7rem 0.8rem;
      background: #ffffff;
      border: 1px solid var(--md-sys-color-outline-variant, #e0e3e7);
      box-shadow: none;
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      cursor: pointer;
      transition: border-color 0.15s ease;
    }
    [data-theme='dark'] .ann-item-card {
      background: var(--md-sys-color-surface, #1b1c20);
      border-color: var(--md-sys-color-outline-variant, #343740);
    }
    .ann-item-card:hover {
      border-color: var(--md-sys-color-primary, #6366f1);
    }
    .ann-item-meta {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 0.72rem;
      color: var(--md-sys-color-on-surface-variant, #64748b);
      gap: 0.4rem;
    }
    .ann-item-kind {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      font-weight: 600;
    }
    .ann-color-dot {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      display: inline-block;
      flex-shrink: 0;
    }
    .ann-item-quote {
      font-size: 0.8rem;
      line-height: 1.45;
      color: var(--md-sys-color-on-surface, inherit);
      border-left: 2px solid var(--md-sys-color-outline-variant, #cbd5e1);
      padding-left: 0.5rem;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .ann-item-note {
      font-size: 0.82rem;
      line-height: 1.5;
      color: var(--md-sys-color-on-surface, inherit);
    }
    .ann-item-actions {
      display: flex;
      justify-content: flex-end;
      gap: 0.4rem;
      margin-top: 0.15rem;
    }
    .ann-mini-btn {
      font-size: 0.72rem;
      padding: 0.15rem 0.45rem;
      border-radius: 6px;
      border: 1px solid var(--md-sys-color-outline-variant, #d8dce3);
      background: transparent;
      color: var(--md-sys-color-on-surface-variant, #64748b);
      cursor: pointer;
    }
    .ann-mini-btn:hover {
      color: var(--md-sys-color-primary, #6366f1);
      border-color: var(--md-sys-color-primary, #6366f1);
    }
    .ann-canvas-quick-actions {
      display: flex;
      gap: 0.45rem;
      flex-wrap: wrap;
    }
    .ann-primary-btn, .ann-tonal-btn {
      border-radius: 999px;
      padding: 0.42rem 0.85rem;
      font-size: 0.78rem;
      font-weight: 500;
      border: none;
      cursor: pointer;
    }
    .ann-primary-btn {
      background: var(--md-sys-color-primary, #4f46e5);
      color: var(--md-sys-color-on-primary, #ffffff);
    }
    .ann-tonal-btn {
      background: var(--md-sys-color-secondary-container, rgba(99, 102, 241, 0.14));
      color: var(--md-sys-color-on-secondary-container, inherit);
    }
    .ann-quick-composer {
      display: flex;
      flex-direction: column;
      gap: 0.45rem;
      padding: 0.65rem;
      border-radius: 12px;
      background: #ffffff;
      border: 1px solid var(--md-sys-color-outline-variant, #e0e3e7);
    }
    [data-theme='dark'] .ann-quick-composer {
      background: var(--md-sys-color-surface, #1b1c20);
      border-color: var(--md-sys-color-outline-variant, #343740);
    }
    .ann-quick-composer textarea {
      width: 100%;
      box-sizing: border-box;
      border-radius: 8px;
      border: 1px solid var(--md-sys-color-outline-variant, #d8dce3);
      background: transparent;
      color: var(--md-sys-color-on-surface, inherit);
      padding: 0.5rem;
      font-family: inherit;
      font-size: 0.82rem;
      resize: vertical;
    }
    .ann-quick-composer-actions {
      display: flex;
      justify-content: flex-end;
      gap: 0.4rem;
    }

    /* 2. 划选文字浮动批注胶囊与侧注编辑器 */
    .astrolib-selection-popover {
      position: fixed;
      z-index: var(--layer-popover, 300);
      display: none;
      flex-direction: column;
      gap: 0.45rem;
      padding: 0.42rem 0.62rem;
      border-radius: 14px;
      background: #ffffff;
      color: var(--md-sys-color-on-surface, #1f2937);
      border: 1px solid var(--md-sys-color-outline-variant, #dce0e6);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.12);
      max-width: min(380px, 92vw);
    }
    [data-theme='dark'] .astrolib-selection-popover {
      background: #23252b;
      color: #f1f5f9;
      border-color: rgba(255, 255, 255, 0.16);
    }
    .astrolib-selection-popover.is-open {
      display: flex;
    }
    .sel-pop-row {
      display: flex;
      align-items: center;
      gap: 0.38rem;
      flex-wrap: wrap;
    }
    .sel-color-swatch {
      width: 18px;
      height: 18px;
      border-radius: 50%;
      border: 2px solid transparent;
      cursor: pointer;
      padding: 0;
    }
    .sel-custom-color-input {
      width: 22px;
      height: 22px;
      padding: 0;
      border: 1px solid var(--md-sys-color-outline-variant, #cbd5e1);
      border-radius: 50%;
      background: transparent;
      cursor: pointer;
    }
    .sel-pop-btn {
      border: 1px solid var(--md-sys-color-outline-variant, #dce0e6);
      background: transparent;
      color: inherit;
      border-radius: 8px;
      padding: 0.22rem 0.52rem;
      font-size: 0.76rem;
      font-weight: 500;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 0.28rem;
    }
    .sel-pop-btn:hover {
      border-color: var(--md-sys-color-primary, #4f46e5);
      color: var(--md-sys-color-primary, #4f46e5);
    }
    .sel-sidenote-editor {
      display: none;
      flex-direction: column;
      gap: 0.4rem;
      border-top: 1px solid var(--md-sys-color-outline-variant, #e0e3e7);
      padding-top: 0.45rem;
    }
    .sel-sidenote-editor.is-open {
      display: flex;
    }
    .sel-sidenote-editor textarea {
      width: 100%;
      box-sizing: border-box;
      border-radius: 8px;
      border: 1px solid var(--md-sys-color-outline-variant, #d8dce3);
      background: #ffffff;
      color: var(--md-sys-color-on-surface, inherit);
      padding: 0.45rem;
      font-size: 0.8rem;
      font-family: inherit;
      resize: vertical;
    }
    [data-theme='dark'] .sel-sidenote-editor textarea {
      background: #18191d;
    }
    .sel-sidenote-preview {
      max-height: 120px;
      overflow-y: auto;
      padding: 0.4rem 0.5rem;
      border-radius: 8px;
      font-size: 0.8rem;
      background: var(--md-sys-color-surface-container-low, rgba(128, 128, 128, 0.06));
    }

    /* 3. 正文内高亮与 M3 纯白无阴影可展开学术侧注 */
    .astrolib-hl-mark {
      background-color: color-mix(in srgb, var(--hl-color, #fde047) 36%, transparent);
      color: inherit;
      border-bottom: 2px solid var(--hl-color, #eab308);
      border-radius: 2px;
      padding: 0.04em 0;
      cursor: pointer;
    }
    .astrolib-hl-mark.is-sidenote-ref {
      background-color: color-mix(in srgb, var(--hl-color, #93c5fd) 20%, transparent);
      border-bottom: 1.5px dashed var(--hl-color, #3b82f6);
    }
    .astrolib-sidenote-card {
      margin: 0.5rem 0 0.8rem;
      border: 1px solid var(--md-sys-color-outline-variant, #e0e3e7);
      border-left: 3px solid var(--sn-color, #6366f1);
      border-radius: 12px;
      background: #ffffff;
      box-shadow: none;
      padding: 0.45rem 0.85rem;
      font-size: 0.86rem;
    }
    [data-theme='dark'] .astrolib-sidenote-card {
      background: var(--md-sys-color-surface, #1b1c20);
      border-color: var(--md-sys-color-outline-variant, #343740);
      border-left-color: var(--sn-color, #818cf8);
    }
    .astrolib-sidenote-card > summary {
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      font-size: 0.78rem;
      font-weight: 600;
      color: var(--md-sys-color-on-surface-variant, #5b5e6b);
      list-style: none;
    }
    .astrolib-sidenote-card > summary::-webkit-details-marker {
      display: none;
    }
    .astrolib-sidenote-title {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      min-width: 0;
    }
    .astrolib-sidenote-body {
      margin-top: 0.45rem;
      padding-top: 0.45rem;
      border-top: 1px solid var(--md-sys-color-outline-variant, #eceef2);
      line-height: 1.6;
    }
    .astrolib-sidenote-body p {
      margin: 0.25rem 0;
      text-indent: 0;
    }
    .astrolib-sidenote-footer {
      display: flex;
      justify-content: flex-end;
      gap: 0.4rem;
      margin-top: 0.35rem;
    }
  </style>

  <script>
    (function initAstrolibAnnotationsRuntime() {
      if (typeof window === 'undefined') return;

      var FALLBACK_META = ${safeMeta};
      var PRESET_COLORS = ['#fde047', '#86efac', '#93c5fd', '#f9a8d4', '#c4b5fd'];
      var SVG_NOTE_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>';
      var SVG_QUOTE_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"></rect><line x1="12" y1="3" x2="12" y2="21"></line></svg>';

      var rt = window.__astrolibAnnRuntime;
      if (!rt) {
        rt = {
          meta: FALLBACK_META,
          payload: null,
          streamFilter: 'all',
          currentSelection: null,
          undoStack: [],
          redoStack: [],
          syncChannel: typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('astrolib_annotations_sync') : null,
          globalBound: false,
          hasFocus: true,
        };
        window.__astrolibAnnRuntime = rt;
      }

      function resolveCurrentMetaFromDom() {
        var el = document.querySelector('.astrolib-chapter-content');
        var colSlug = el && el.getAttribute('data-col-slug');
        var bookSlug = el && el.getAttribute('data-book-slug');
        var chapterSlug = el && el.getAttribute('data-chapter-slug');
        var chapterTitle = el && el.getAttribute('data-chapter-title');

        if (!colSlug || !bookSlug || !chapterSlug) {
          var m = decodeURIComponent(window.location.pathname || '').match(/^\\/collections\\/([^/]+)\\/([^/]+)\\/(.+?)\\/?$/);
          if (m) {
            colSlug = colSlug || m[1];
            bookSlug = bookSlug || m[2];
            chapterSlug = chapterSlug || m[3];
          }
        }
        var h1 = document.getElementById('_top') || document.querySelector('h1');
        return {
          colSlug: colSlug || window.__currentColSlug || FALLBACK_META.colSlug,
          bookSlug: bookSlug || window.__currentBookSlug || FALLBACK_META.bookSlug,
          chapterSlug: chapterSlug || window.__currentChapterSlug || FALLBACK_META.chapterSlug,
          chapterTitle: chapterTitle || (h1 ? h1.textContent.trim() : '') || FALLBACK_META.chapterTitle,
        };
      }

      function getApiBase() {
        return '/api/v1/content/annotations/books/' + encodeURIComponent(rt.meta.colSlug) + '/' + encodeURIComponent(rt.meta.bookSlug);
      }

      function getChapterApi() {
        return getApiBase() + '/chapters/' + encodeURIComponent(rt.meta.chapterSlug);
      }

      function genId(prefix) {
        return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
      }

      function escapeHtml(str) {
        return String(str || '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }

      function sanitizeCssColor(rawColor) {
        var val = String(rawColor || '').trim();
        if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(val)) return val;
        if (/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i.test(val)) return val;
        return '#fde047';
      }

      function sanitizeClientHtml(rawHtml) {
        if (!rawHtml) return '';
        var tpl = document.createElement('template');
        tpl.innerHTML = String(rawHtml);
        var blocked = tpl.content.querySelectorAll('script, style, iframe, frame, object, embed, applet, base, meta, link, form, input, textarea, select, noscript');
        for (var i = 0; i < blocked.length; i++) {
          blocked[i].remove();
        }
        var allEls = tpl.content.querySelectorAll('*');
        for (var j = 0; j < allEls.length; j++) {
          var node = allEls[j];
          var attrs = Array.prototype.slice.call(node.attributes);
          for (var k = 0; k < attrs.length; k++) {
            var attrName = attrs[k].name.toLowerCase();
            var attrVal = (attrs[k].value || '').replace(/[\\u0000-\\u0020\\u007f]+/g, '');
            if (attrName.indexOf('on') === 0 || attrName === 'srcdoc' || attrName === 'formaction') {
              node.removeAttribute(attrs[k].name);
            } else if (attrName === 'href' || attrName === 'xlink:href' || attrName === 'src') {
              if (/^(?:javascript:|vbscript:|data:text\\/html|data:image\\/svg\\+xml)/i.test(attrVal)) {
                node.removeAttribute(attrs[k].name);
              }
            }
          }
        }
        return tpl.innerHTML;
      }

      function ensureSideloadRegistered() {
        var mgr = window.sideloadManager || window.__sideloadManager;
        if (mgr && typeof mgr.register === 'function') {
          mgr.register({
            id: 'annotations',
            title: '批注与笔记',
            widthTier: 'wide',
            allowDrawer: true,
          });
        }
        return mgr;
      }

      function flattenAstTree(tree) {
        var list = [];
        for (var i = 0; i < (tree || []).length; i++) {
          list.push(tree[i]);
          if (tree[i].children && tree[i].children.length) {
            list = list.concat(flattenAstTree(tree[i].children));
          }
        }
        return list;
      }

      function assignFallbackDomIds(root) {
        var selector = 'h1, h2, h3, h4, .toc-chunk, .academic-card, details.solution-details, .katex-display-container, p, ul, ol, table, blockquote, pre';
        var els = root.querySelectorAll(selector);
        var idx = 0;
        els.forEach(function(el) {
          if (el.closest('.astrolib-sidenote-card') || el.closest('.prev-next')) return;
          idx++;
          if (!el.getAttribute('data-ast-node-id')) {
            var baseId = el.id || ('dom-' + el.tagName.toLowerCase() + '-' + idx);
            el.setAttribute('data-ast-node-id', baseId);
            el.setAttribute('data-ast-uri', 'astrolib://' + rt.meta.colSlug + '/' + rt.meta.bookSlug + '/' + rt.meta.chapterSlug + '#' + baseId);
          }
        });
      }

      function normCompact(s) {
        return String(s || '').replace(/\s+/g, '').slice(0, 28).toLowerCase();
      }

      function bindRealAstNodes(tree) {
        var root = document.querySelector('.astrolib-chapter-content');
        if (!root) return;
        assignFallbackDomIds(root);

        var flat = flattenAstTree(tree);
        if (!flat.length) return;

        var usedEls = new Set();
        var headingEls = Array.from(root.querySelectorAll('h1, h2, h3, h4'));
        var cardEls = Array.from(root.querySelectorAll('.toc-chunk, .academic-card, details.solution-details'));
        var mathEls = Array.from(root.querySelectorAll('.katex-display-container'));
        var pEls = Array.from(root.querySelectorAll('p')).filter(function(p) {
          return !p.closest('.astrolib-sidenote-card') && !p.closest('.prev-next');
        });
        var listEls = Array.from(root.querySelectorAll('ul, ol')).filter(function(l) { return !l.closest('.prev-next'); });
        var tableEls = Array.from(root.querySelectorAll('table'));
        var codeEls = Array.from(root.querySelectorAll('pre'));
        var quoteEls = Array.from(root.querySelectorAll('blockquote'));

        function bindNodeToEl(node, el) {
          if (!el) return;
          usedEls.add(el);
          el.setAttribute('data-ast-node-id', node.id);
          el.setAttribute('data-ast-node-type', node.type);
          el.setAttribute('data-ast-uri', 'astrolib://' + rt.meta.colSlug + '/' + rt.meta.bookSlug + '/' + rt.meta.chapterSlug + '#' + node.id);
          if (!el.id) el.id = node.id;
        }

        flat.forEach(function(node) {
          var target = null;
          if (node.type === 'heading') {
            var hNeedle = normCompact(node.title);
            target = headingEls.find(function(el) {
              return !usedEls.has(el) && normCompact(el.textContent).indexOf(hNeedle.slice(0, 12)) !== -1;
            }) || headingEls.find(function(el) { return !usedEls.has(el); });
          } else if (node.type === 'card') {
            var cNeedle = normCompact(node.title);
            target = cardEls.find(function(el) {
              var dt = normCompact(el.getAttribute('data-title') || el.textContent);
              return !usedEls.has(el) && cNeedle && dt.indexOf(cNeedle.slice(0, 12)) !== -1;
            }) || cardEls.find(function(el) { return !usedEls.has(el); });
          } else if (node.type === 'math_block') {
            var mNeedle = normCompact(node.latex);
            target = mathEls.find(function(el) {
              var raw = '';
              try { raw = decodeURIComponent(el.getAttribute('data-latex') || ''); } catch(e) {}
              return !usedEls.has(el) && mNeedle && normCompact(raw).indexOf(mNeedle.slice(0, 14)) !== -1;
            }) || mathEls.find(function(el) { return !usedEls.has(el); });
          } else if (node.type === 'paragraph') {
            var pNeedle = normCompact(node.preview);
            target = pEls.find(function(el) {
              return !usedEls.has(el) && pNeedle && normCompact(el.textContent).indexOf(pNeedle.slice(0, 14)) !== -1;
            }) || pEls.find(function(el) { return !usedEls.has(el); });
          } else if (node.type === 'list') {
            target = listEls.find(function(el) { return !usedEls.has(el); });
          } else if (node.type === 'table') {
            target = tableEls.find(function(el) { return !usedEls.has(el); });
          } else if (node.type === 'code_block') {
            target = codeEls.find(function(el) { return !usedEls.has(el); });
          } else if (node.type === 'quote') {
            target = quoteEls.find(function(el) { return !usedEls.has(el); });
          }
          if (target) bindNodeToEl(node, target);
        });
      }

      function renderMarkdownWithKatex(mdText) {
        return fetch('/api/v1/content/annotations/render-markdown', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ markdown: mdText || '' }),
        })
          .then(function(r) { return r.json(); })
          .then(function(j) { return j && j.html ? j.html : escapeHtml(mdText); })
          .catch(function() { return '<p>' + escapeHtml(mdText).replace(/\\n/g, '<br>') + '</p>'; });
      }

      function getTextNodesInElement(rootEl) {
        var nodes = [];
        var walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, {
          acceptNode: function(node) {
            if (!node.nodeValue || !node.nodeValue.length) return NodeFilter.FILTER_REJECT;
            var parent = node.parentElement;
            if (!parent) return NodeFilter.FILTER_REJECT;
            if (parent.closest('.astrolib-sidenote-card') || parent.closest('.katex-mathml') || parent.closest('script') || parent.closest('style')) {
              return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_ACCEPT;
          }
        });
        var cur;
        while ((cur = walker.nextNode())) {
          nodes.push(cur);
        }
        return nodes;
      }

      function computeSelectionOffsets(nodeEl, range) {
        var textNodes = getTextNodesInElement(nodeEl);
        var fullText = '';
        var startOffset = -1;
        var endOffset = -1;

        for (var i = 0; i < textNodes.length; i++) {
          var tn = textNodes[i];
          if (tn === range.startContainer) {
            startOffset = fullText.length + range.startOffset;
          }
          if (tn === range.endContainer) {
            endOffset = fullText.length + range.endOffset;
          }
          fullText += tn.nodeValue;
        }

        if (startOffset < 0 || endOffset <= startOffset) {
          var exactFallback = range.toString().trim();
          var foundIdx = exactFallback ? fullText.indexOf(exactFallback) : -1;
          if (foundIdx >= 0) {
            startOffset = foundIdx;
            endOffset = foundIdx + exactFallback.length;
          } else {
            return null;
          }
        }

        var exact = fullText.slice(startOffset, endOffset);
        var prefix = fullText.slice(Math.max(0, startOffset - 24), startOffset);
        var suffix = fullText.slice(endOffset, Math.min(fullText.length, endOffset + 24));
        return {
          position: { start: startOffset, end: endOffset },
          quote: { exact: exact, prefix: prefix, suffix: suffix },
        };
      }

      function extractCleanHtmlFromElement(el) {
        var clone = el.cloneNode(true);
        clone.querySelectorAll('.astrolib-sidenote-card, script, style').forEach(function(n) { n.remove(); });
        clone.querySelectorAll('.astrolib-hl-mark').forEach(function(mark) {
          var parent = mark.parentNode;
          if (!parent) return;
          while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
          parent.removeChild(mark);
        });
        return clone.outerHTML;
      }

      function extractCleanHtmlFromRange(range, fallbackNodeEl) {
        try {
          if (fallbackNodeEl && (fallbackNodeEl.classList.contains('toc-chunk') || fallbackNodeEl.classList.contains('academic-card') || fallbackNodeEl.classList.contains('katex-display-container'))) {
            return extractCleanHtmlFromElement(fallbackNodeEl);
          }
          var frag = range.cloneContents();
          var wrap = document.createElement('div');
          wrap.appendChild(frag);
          wrap.querySelectorAll('.astrolib-hl-mark').forEach(function(mark) {
            var parent = mark.parentNode;
            if (!parent) return;
            while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
            parent.removeChild(mark);
          });
          var inner = wrap.innerHTML.trim();
          return inner ? ('<div class="astrolib-excerpt-fragment">' + inner + '</div>') : (fallbackNodeEl ? extractCleanHtmlFromElement(fallbackNodeEl) : '');
        } catch (err) {
          return fallbackNodeEl ? extractCleanHtmlFromElement(fallbackNodeEl) : '';
        }
      }

      function clearRenderedHighlightsAndSidenotes() {
        document.querySelectorAll('.astrolib-hl-mark').forEach(function(mark) {
          var parent = mark.parentNode;
          if (!parent) return;
          while (mark.firstChild) {
            parent.insertBefore(mark.firstChild, mark);
          }
          parent.removeChild(mark);
          parent.normalize();
        });
        document.querySelectorAll('.astrolib-sidenote-card').forEach(function(el) {
          el.remove();
        });
      }

      function applyMarkOnNode(nodeEl, ann) {
        var anchor = ann.anchor;
        if (!anchor) return;
        var textNodes = getTextNodesInElement(nodeEl);
        var fullText = textNodes.map(function(n) { return n.nodeValue; }).join('');
        if (!fullText) return;

        var start = anchor.position ? anchor.position.start : -1;
        var end = anchor.position ? anchor.position.end : -1;
        var exact = anchor.quote ? anchor.quote.exact : '';

        if (exact && (start < 0 || fullText.slice(start, end) !== exact)) {
          var idx = fullText.indexOf(exact);
          if (idx >= 0) {
            start = idx;
            end = idx + exact.length;
          }
        }
        if (start < 0 || end <= start) return;

        var cursor = 0;
        for (var i = 0; i < textNodes.length; i++) {
          var tn = textNodes[i];
          var len = tn.nodeValue.length;
          var segStart = Math.max(start, cursor);
          var segEnd = Math.min(end, cursor + len);
          cursor += len;
          if (segEnd <= segStart) continue;

          var localStart = segStart - (cursor - len);
          var localEnd = segEnd - (cursor - len);
          var targetTn = tn;
          if (localStart > 0) {
            targetTn = targetTn.splitText(localStart);
          }
          if (localEnd - localStart < targetTn.nodeValue.length) {
            targetTn.splitText(localEnd - localStart);
          }
          var mark = document.createElement('mark');
          mark.className = 'astrolib-hl-mark' + (ann.kind === 'sidenote' ? ' is-sidenote-ref' : '');
          mark.setAttribute('data-ann-id', ann.id);
          mark.style.setProperty('--hl-color', ann.color || '#fde047');
          if (ann.kind === 'sidenote') {
            mark.title = '点击查看学术侧注';
          }
          targetTn.parentNode.replaceChild(mark, targetTn);
          mark.appendChild(targetTn);
        }
      }

      function findDomByAstNodeId(nodeId) {
        if (!nodeId) return null;
        return document.querySelector('.astrolib-chapter-content [data-ast-node-id="' + CSS.escape(nodeId) + '"]') || document.getElementById(nodeId);
      }

      function renderHighlightsAndSidenotes() {
        clearRenderedHighlightsAndSidenotes();
        if (!rt.payload || !Array.isArray(rt.payload.annotations)) return;

        rt.payload.annotations.forEach(function(ann) {
          if (ann.kind !== 'highlight' && ann.kind !== 'sidenote') return;
          var nodeEl = findDomByAstNodeId(ann.anchor.nodeId);
          if (!nodeEl) return;

          applyMarkOnNode(nodeEl, ann);

          if (ann.kind === 'sidenote') {
            var card = document.createElement('details');
            card.className = 'astrolib-sidenote-card';
            card.setAttribute('data-ann-id', ann.id);
            card.style.setProperty('--sn-color', ann.color || '#6366f1');
            if (!ann.collapsed) card.setAttribute('open', '');

            var quotePreview = ann.anchor.quote && ann.anchor.quote.exact ? ann.anchor.quote.exact.slice(0, 36) : ann.anchor.nodeId;
            card.innerHTML =
              '<summary>' +
                '<span class="astrolib-sidenote-title">' + SVG_NOTE_ICON + '<span>侧注 · ' + escapeHtml(quotePreview) + '</span></span>' +
                '<span style="font-weight:400;opacity:0.75;">展开/折叠</span>' +
              '</summary>' +
              '<div class="astrolib-sidenote-body" id="sn-body-' + escapeHtml(ann.id) + '">正在渲染公式...</div>' +
              '<div class="astrolib-sidenote-footer">' +
                '<button type="button" class="ann-mini-btn" data-sn-canvas="' + escapeHtml(ann.id) + '">转存至画布</button>' +
                '<button type="button" class="ann-mini-btn" data-sn-delete="' + escapeHtml(ann.id) + '">删除</button>' +
              '</div>';

            nodeEl.insertAdjacentElement('afterend', card);
            renderMarkdownWithKatex(ann.markdown).then(function(renderedHtml) {
              var bodyEl = document.getElementById('sn-body-' + ann.id);
              if (bodyEl) bodyEl.innerHTML = sanitizeClientHtml(renderedHtml);
            });
          }
        });
      }

      function ensureFloatingPopover() {
        var pop = document.getElementById('astrolib-selection-popover');
        if (pop) return pop;
        pop = document.createElement('div');
        pop.id = 'astrolib-selection-popover';
        pop.className = 'astrolib-selection-popover';
        pop.innerHTML =
          '<div class="sel-pop-row">' +
            PRESET_COLORS.map(function(c) {
              return '<button type="button" class="sel-color-swatch" data-sel-hl="' + c + '" style="background:' + c + ';" title="用此颜色高亮"></button>';
            }).join('') +
            '<input type="color" id="sel-custom-hl-color" class="sel-custom-color-input" value="#fde047" title="任意颜色高亮" />' +
            '<button type="button" class="sel-pop-btn" id="sel-btn-sidenote">' + SVG_NOTE_ICON + '<span>侧注</span></button>' +
            '<button type="button" class="sel-pop-btn" id="sel-btn-canvas">' + SVG_QUOTE_ICON + '<span>摘录至画布</span></button>' +
          '</div>' +
          '<div class="sel-sidenote-editor" id="sel-sidenote-editor">' +
            '<textarea id="sel-sidenote-input" rows="3" placeholder="撰写学术侧注（支持 Markdown 与 $LaTeX$ 公式）..."></textarea>' +
            '<div class="sel-sidenote-preview" id="sel-sidenote-preview">实时公式与 Markdown 预览区</div>' +
            '<div class="sel-pop-row" style="justify-content: flex-end;">' +
              '<button type="button" class="ann-mini-btn" id="sel-sidenote-cancel">取消</button>' +
              '<button type="button" class="ann-primary-btn" style="padding:0.25rem 0.7rem;font-size:0.75rem;" id="sel-sidenote-save">保存侧注</button>' +
            '</div>' +
          '</div>';
        document.body.appendChild(pop);

        function resolveSelectionWithAst(selectionSnap, buildItemFn) {
          if (!selectionSnap) return;
          ensureAstBound().then(function() {
            var anchor = Object.assign({}, selectionSnap.anchor);
            if (selectionSnap.astNodeEl && selectionSnap.astNodeEl.isConnected) {
              var upgradedId = selectionSnap.astNodeEl.getAttribute('data-ast-node-id');
              if (upgradedId) {
                anchor.nodeId = upgradedId;
                anchor.uri = 'astrolib://' + rt.meta.colSlug + '/' + rt.meta.bookSlug + '/' + rt.meta.chapterSlug + '#' + upgradedId;
                anchor.nodeType = selectionSnap.astNodeEl.getAttribute('data-ast-node-type') || anchor.nodeType;
              }
            }
            buildItemFn(anchor);
          });
        }

        pop.querySelectorAll('[data-sel-hl]').forEach(function(btn) {
          btn.addEventListener('click', function() {
            if (!rt.currentSelection) return;
            var selSnap = rt.currentSelection;
            var color = btn.getAttribute('data-sel-hl') || '#fde047';
            resolveSelectionWithAst(selSnap, function(anchor) {
              var now = new Date().toISOString();
              upsertAnnotationItem({
                id: genId('hl'),
                kind: 'highlight',
                anchor: anchor,
                color: color,
                createdAt: now,
                updatedAt: now,
              }, true);
            });
            window.getSelection()?.removeAllRanges();
            hideSelectionPopover();
          });
        });

        pop.querySelector('#sel-custom-hl-color')?.addEventListener('change', function(e) {
          if (!rt.currentSelection) return;
          var selSnap = rt.currentSelection;
          var color = e.target.value || '#fde047';
          resolveSelectionWithAst(selSnap, function(anchor) {
            var now = new Date().toISOString();
            upsertAnnotationItem({
              id: genId('hl'),
              kind: 'highlight',
              anchor: anchor,
              color: color,
              createdAt: now,
              updatedAt: now,
            }, true);
          });
          window.getSelection()?.removeAllRanges();
          hideSelectionPopover();
        });

        var snTimer = 0;
        pop.querySelector('#sel-btn-sidenote')?.addEventListener('click', function() {
          pop.querySelector('#sel-sidenote-editor')?.classList.add('is-open');
          pop.querySelector('#sel-sidenote-input')?.focus();
        });
        pop.querySelector('#sel-sidenote-input')?.addEventListener('input', function(e) {
          clearTimeout(snTimer);
          var val = e.target.value;
          snTimer = setTimeout(function() {
            renderMarkdownWithKatex(val).then(function(html) {
              var prev = pop.querySelector('#sel-sidenote-preview');
              if (prev) prev.innerHTML = sanitizeClientHtml(html) || '实时公式与 Markdown 预览区';
            });
          }, 160);
        });
        pop.querySelector('#sel-sidenote-cancel')?.addEventListener('click', hideSelectionPopover);
        pop.querySelector('#sel-sidenote-save')?.addEventListener('click', function() {
          if (!rt.currentSelection) return;
          var selSnap = rt.currentSelection;
          var input = pop.querySelector('#sel-sidenote-input');
          var md = (input?.value || '').trim();
          if (!md) return;
          var color = pop.querySelector('#sel-custom-hl-color')?.value || '#6366f1';
          resolveSelectionWithAst(selSnap, function(anchor) {
            var now = new Date().toISOString();
            upsertAnnotationItem({
              id: genId('sn'),
              kind: 'sidenote',
              anchor: anchor,
              markdown: md,
              color: color,
              collapsed: false,
              createdAt: now,
              updatedAt: now,
            }, true);
          });
          if (input) input.value = '';
          window.getSelection()?.removeAllRanges();
          hideSelectionPopover();
        });

        pop.querySelector('#sel-btn-canvas')?.addEventListener('click', function() {
          if (!rt.currentSelection) return;
          var selSnap = rt.currentSelection;
          var exact = selSnap.anchor.quote?.exact || '';
          resolveSelectionWithAst(selSnap, function(anchor) {
            addExcerptToCanvas(anchor, exact, '> ' + exact, selSnap.renderedHtml);
            openCanvasInSplitPane();
          });
          window.getSelection()?.removeAllRanges();
          hideSelectionPopover();
        });

        return pop;
      }

      function ensureAstBound() {
        var chapterKey = rt.meta.colSlug + '/' + rt.meta.bookSlug + '/' + rt.meta.chapterSlug;
        if (rt.astLoadedKey === chapterKey) {
          return Promise.resolve();
        }
        if (rt.astLoadPromise && rt.astLoadingKey === chapterKey) {
          return rt.astLoadPromise;
        }
        rt.astLoadingKey = chapterKey;
        rt.astLoadPromise = fetch(
          '/api/v1/content/books/' +
            encodeURIComponent(rt.meta.colSlug) + '/' +
            encodeURIComponent(rt.meta.bookSlug) + '/chapters/' +
            encodeURIComponent(rt.meta.chapterSlug) + '/ast'
        )
          .then(function(r) { return r.ok ? r.json() : null; })
          .then(function(j) {
            if (j && j.data && Array.isArray(j.data.tree)) {
              bindRealAstNodes(j.data.tree);
              rt.astLoadedKey = chapterKey;
            }
          })
          .catch(function() {})
          .finally(function() {
            if (rt.astLoadingKey === chapterKey) {
              rt.astLoadPromise = null;
            }
          });
        return rt.astLoadPromise;
      }

      function loadChapterData() {
        var targetApi = getChapterApi();
        return fetch(targetApi + '?withAst=false')
          .then(function(r) { return r.json(); })
          .then(function(j) {
            if (j && j.data) {
              rt.payload = j.data;
              var hasExisting =
                (Array.isArray(j.data.annotations) && j.data.annotations.length > 0) ||
                (j.data.canvasNote && Array.isArray(j.data.canvasNote.blocks) && j.data.canvasNote.blocks.length > 0);
              if (hasExisting) {
                ensureAstBound().then(function() {
                  renderHighlightsAndSidenotes();
                  renderSidebarLists();
                });
              } else {
                renderHighlightsAndSidenotes();
                renderSidebarLists();
              }
            }
          })
          .catch(function() {});
      }

      function broadcastUpdate() {
        if (rt.syncChannel) {
          rt.syncChannel.postMessage({
            type: 'annotations-updated',
            colSlug: rt.meta.colSlug,
            bookSlug: rt.meta.bookSlug,
            chapterSlug: rt.meta.chapterSlug,
          });
        }
      }

      function upsertAnnotationItem(item, recordUndo) {
        if (!rt.payload) return;
        var prev = rt.payload.annotations.find(function(a) { return a.id === item.id; }) || null;
        if (recordUndo) {
          rt.undoStack.push({ action: prev ? 'update' : 'add', item: item, prevItem: prev });
          if (rt.undoStack.length > 50) rt.undoStack.shift();
          rt.redoStack = [];
        }

        var idx = rt.payload.annotations.findIndex(function(a) { return a.id === item.id; });
        if (idx >= 0) rt.payload.annotations[idx] = item;
        else rt.payload.annotations.push(item);

        renderHighlightsAndSidenotes();
        renderSidebarLists();

        fetch(getChapterApi(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'upsert-item', item: item, chapterTitle: rt.meta.chapterTitle }),
        })
          .then(function() { broadcastUpdate(); })
          .catch(function() {});
      }

      function deleteAnnotationById(id, recordUndo) {
        if (!rt.payload) return;
        var existing = rt.payload.annotations.find(function(a) { return a.id === id; });
        if (!existing) return;
        if (recordUndo) {
          rt.undoStack.push({ action: 'delete', item: existing, prevItem: existing });
          if (rt.undoStack.length > 50) rt.undoStack.shift();
          rt.redoStack = [];
        }

        rt.payload.annotations = rt.payload.annotations.filter(function(a) { return a.id !== id; });
        renderHighlightsAndSidenotes();
        renderSidebarLists();

        fetch(getChapterApi(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'delete-item', annotationId: id }),
        })
          .then(function() { broadcastUpdate(); })
          .catch(function() {});
      }

      function performUndo() {
        if (!rt.undoStack.length) return;
        var op = rt.undoStack.pop();
        rt.redoStack.push(op);
        if (op.action === 'add') {
          deleteAnnotationById(op.item.id, false);
        } else if (op.action === 'delete') {
          upsertAnnotationItem(op.item, false);
        } else if (op.action === 'update' && op.prevItem) {
          upsertAnnotationItem(op.prevItem, false);
        }
      }

      function performRedo() {
        if (!rt.redoStack.length) return;
        var op = rt.redoStack.pop();
        rt.undoStack.push(op);
        if (op.action === 'add' || op.action === 'update') {
          upsertAnnotationItem(op.item, false);
        } else if (op.action === 'delete') {
          deleteAnnotationById(op.item.id, false);
        }
      }

      function saveCanvasNoteState() {
        if (!rt.payload) return;
        renderSidebarLists();
        fetch(getChapterApi(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'save-canvas',
            canvasNote: rt.payload.canvasNote,
            chapterTitle: rt.meta.chapterTitle,
          }),
        })
          .then(function() { broadcastUpdate(); })
          .catch(function() {});
      }

      function addExcerptToCanvas(anchor, quoteText, markdownBody, renderedHtml) {
        if (!rt.payload) return;
        var blocks = rt.payload.canvasNote.blocks;
        var colIdx = blocks.length % 2;
        var rowIdx = Math.floor(blocks.length / 2);
        var now = new Date().toISOString();
        var block = {
          id: genId('blk'),
          kind: anchor ? 'ast-quote' : 'markdown',
          x: 40 + colIdx * 360,
          y: 40 + rowIdx * 240,
          width: 340,
          height: 210,
          markdown: markdownBody || ('> ' + (quoteText || '')),
          ...(anchor ? {
            astRef: Object.assign({}, anchor, {
              summary: quoteText ? quoteText.slice(0, 80) : anchor.nodeId,
              ...(renderedHtml ? { renderedHtml: renderedHtml } : {}),
            })
          } : {}),
          createdAt: now,
          updatedAt: now,
        };
        blocks.push(block);
        saveCanvasNoteState();
      }

      function buildCanvasUrl() {
        return '/workspace/canvas/?col=' + encodeURIComponent(rt.meta.colSlug) +
          '&book=' + encodeURIComponent(rt.meta.bookSlug) +
          '&chapter=' + encodeURIComponent(rt.meta.chapterSlug) +
          '&chapterTitle=' + encodeURIComponent(rt.meta.chapterTitle || rt.meta.chapterSlug);
      }

      function openCanvasInSplitPane() {
        var canvasUrl = buildCanvasUrl();
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({
            type: 'astrolib:open-canvas-split',
            colSlug: rt.meta.colSlug,
            bookSlug: rt.meta.bookSlug,
            chapterSlug: rt.meta.chapterSlug,
            title: (rt.meta.chapterTitle || rt.meta.chapterSlug) + ' · 画布',
            url: canvasUrl,
          }, '*');
        } else {
          window.open(canvasUrl, '_blank');
        }
      }

      function notifyParentChapterChanged() {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({
            type: 'astrolib:chapter-changed',
            colSlug: rt.meta.colSlug,
            bookSlug: rt.meta.bookSlug,
            chapterSlug: rt.meta.chapterSlug,
            chapterTitle: rt.meta.chapterTitle,
            canvasUrl: buildCanvasUrl(),
          }, '*');
        }
      }

      function scrollToAstNode(nodeId) {
        var el = findDomByAstNodeId(nodeId);
        if (!el) return;
        if (window.__readerViewport && typeof window.__readerViewport.scrollToElement === 'function') {
          window.__readerViewport.scrollToElement(el, { behavior: 'smooth', block: 'center', flash: true });
        } else {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.classList.add('card-ref-flash');
          setTimeout(function() { el.classList.remove('card-ref-flash'); }, 1800);
        }
      }

      function renderSidebarLists() {
        if (!rt.payload) return;
        var textAnns = (rt.payload.annotations || []).filter(function(a) {
          return a.kind === 'highlight' || a.kind === 'sidenote';
        });
        var blocks = (rt.payload.canvasNote && rt.payload.canvasNote.blocks) || [];

        var badge = document.getElementById('ann-count-badge');
        if (badge) badge.textContent = String(textAnns.length + blocks.length);

        var listEl = document.getElementById('ann-list');
        if (listEl) {
          var filtered = rt.streamFilter === 'all'
            ? textAnns
            : textAnns.filter(function(a) { return a.kind === rt.streamFilter; });

          if (!filtered.length) {
            listEl.innerHTML = '<div class="ann-empty-hint">当前筛选下暂无文本批注。划选正文可赋予任意颜色高亮或撰写学术侧注；支持 Ctrl+Z / Ctrl+Y 撤销恢复。</div>';
          } else {
            listEl.innerHTML = filtered.map(function(a) {
              var label = a.kind === 'highlight' ? '高亮' : '学术侧注';
              var quote = a.anchor && a.anchor.quote ? a.anchor.quote.exact : '';
              return '<div class="ann-item-card" data-jump-node="' + escapeHtml(a.anchor.nodeId) + '">' +
                '<div class="ann-item-meta">' +
                  '<span class="ann-item-kind"><span class="ann-color-dot" style="background:' + sanitizeCssColor(a.color) + ';"></span>' + escapeHtml(label) + '</span>' +
                  '<code>' + escapeHtml(a.anchor.nodeId) + '</code>' +
                '</div>' +
                (quote ? '<div class="ann-item-quote">' + escapeHtml(quote) + '</div>' : '') +
                (a.kind === 'sidenote' ? '<div class="ann-item-note">' + escapeHtml(a.markdown) + '</div>' : '') +
                '<div class="ann-item-actions">' +
                  '<button type="button" class="ann-mini-btn" data-ann-del="' + escapeHtml(a.id) + '">删除</button>' +
                '</div>' +
              '</div>';
            }).join('');
          }
        }

        var canvasListEl = document.getElementById('ann-canvas-blocks-list');
        if (canvasListEl) {
          if (!blocks.length) {
            canvasListEl.innerHTML = '<div class="ann-empty-hint">本章自由画布暂无卡片。点击「在分屏打开自由画布」使用无限画布与数位板手写。</div>';
          } else {
            canvasListEl.innerHTML = blocks.map(function(b) {
              var refUri = b.astRef ? b.astRef.nodeId : '';
              return '<div class="ann-item-card"' + (refUri ? ' data-jump-node="' + escapeHtml(refUri) + '"' : '') + '>' +
                '<div class="ann-item-meta">' +
                  '<span class="ann-item-kind">' + (b.kind === 'ast-quote' ? SVG_QUOTE_ICON + '<span>原文引用</span>' : SVG_NOTE_ICON + '<span>笔记卡片</span>') + '</span>' +
                  (refUri ? '<code>' + escapeHtml(refUri) + '</code>' : '') +
                '</div>' +
                '<div class="ann-item-note">' + escapeHtml(b.markdown.slice(0, 220)) + '</div>' +
              '</div>';
            }).join('');
          }
        }
      }

      function hideSelectionPopover() {
        var pop = document.getElementById('astrolib-selection-popover');
        var ed = document.getElementById('sel-sidenote-editor');
        if (pop) pop.classList.remove('is-open');
        if (ed) ed.classList.remove('is-open');
      }

      function handleSelectionMouseUp() {
        var sel = window.getSelection();
        if (!sel || sel.isCollapsed || !sel.rangeCount) {
          return;
        }
        var range = sel.getRangeAt(0);
        var exact = sel.toString().trim();
        if (!exact) return;

        var startEl = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
        if (!startEl || !startEl.closest('.astrolib-chapter-content') || startEl.closest('.astrolib-sidenote-card')) {
          return;
        }
        var astNodeEl = startEl.closest('[data-ast-node-id]');
        if (!astNodeEl) return;

        var offsets = computeSelectionOffsets(astNodeEl, range);
        if (!offsets) return;

        var nodeId = astNodeEl.getAttribute('data-ast-node-id');
        rt.currentSelection = {
          astNodeEl: astNodeEl,
          anchor: {
            colSlug: rt.meta.colSlug,
            bookSlug: rt.meta.bookSlug,
            chapterSlug: rt.meta.chapterSlug,
            nodeId: nodeId,
            uri: 'astrolib://' + rt.meta.colSlug + '/' + rt.meta.bookSlug + '/' + rt.meta.chapterSlug + '#' + nodeId,
            nodeType: astNodeEl.getAttribute('data-ast-node-type') || undefined,
            quote: offsets.quote,
            position: offsets.position,
          },
          renderedHtml: extractCleanHtmlFromRange(range, astNodeEl),
          rect: range.getBoundingClientRect(),
        };
        ensureAstBound();

        var pop = ensureFloatingPopover();
        pop.style.left = Math.max(12, Math.min(window.innerWidth - 360, rt.currentSelection.rect.left)) + 'px';
        pop.style.top = Math.max(56, rt.currentSelection.rect.top - 52) + 'px';
        pop.classList.add('is-open');
      }

      function bindGlobalListenersOnce() {
        if (rt.globalBound) return;
        rt.globalBound = true;

        window.addEventListener('focus', function() { rt.hasFocus = true; });
        window.addEventListener('blur', function() { rt.hasFocus = false; });

        window.addEventListener('keydown', function(e) {
          if (!rt.hasFocus) return;
          var t = e.target;
          if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;

          if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'n') {
            e.preventDefault();
            ensureAstBound();
            var mgr = ensureSideloadRegistered();
            if (mgr) mgr.toggle('annotations');
            return;
          }

          if ((e.ctrlKey || e.metaKey) && !e.altKey) {
            var key = e.key.toLowerCase();
            if (key === 'z' && !e.shiftKey) {
              e.preventDefault();
              performUndo();
            } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
              e.preventDefault();
              performRedo();
            }
          }
        });

        document.addEventListener('mouseup', function(e) {
          if (e.target && e.target.closest && e.target.closest('.astrolib-selection-popover')) return;
          setTimeout(handleSelectionMouseUp, 15);
        });
        document.addEventListener('mousedown', function(e) {
          if (e.target && e.target.closest && e.target.closest('.astrolib-selection-popover')) return;
          hideSelectionPopover();
        });

        document.addEventListener('click', function(e) {
          var t = e.target;
          if (!t || !t.closest) return;

          var trigger = t.closest('[data-annotations-trigger]');
          if (trigger) {
            e.preventDefault();
            ensureAstBound();
            var mgr = ensureSideloadRegistered();
            if (mgr) mgr.toggle('annotations');
            return;
          }

          if (t.closest('#annotations-back-to-toc') || t.closest('#annotations-sidebar-close')) {
            var mgr2 = ensureSideloadRegistered();
            if (mgr2) mgr2.switchToDefault();
            return;
          }

          if (t.closest('#ann-open-split-canvas') || t.closest('#ann-canvas-launch-split')) {
            openCanvasInSplitPane();
            return;
          }

          var delBtn = t.closest('[data-ann-del], [data-sn-delete]');
          if (delBtn) {
            e.stopPropagation();
            var id = delBtn.getAttribute('data-ann-del') || delBtn.getAttribute('data-sn-delete');
            if (id) deleteAnnotationById(id, true);
            return;
          }

          var toCanvasBtn = t.closest('[data-sn-canvas]');
          if (toCanvasBtn) {
            e.stopPropagation();
            var snId = toCanvasBtn.getAttribute('data-sn-canvas');
            var sn = rt.payload && rt.payload.annotations.find(function(a) { return a.id === snId; });
            if (sn) {
              var quote = sn.anchor.quote?.exact || '';
              var domEl = findDomByAstNodeId(sn.anchor.nodeId);
              var rawHtml = domEl ? extractCleanHtmlFromElement(domEl) : '';
              addExcerptToCanvas(sn.anchor, quote, (quote ? '> ' + quote + '\\n\\n' : '') + sn.markdown, rawHtml);
              openCanvasInSplitPane();
            }
            return;
          }

          var jumpCard = t.closest('[data-jump-node]');
          if (jumpCard) {
            var nid = jumpCard.getAttribute('data-jump-node');
            if (nid) scrollToAstNode(nid);
          }
        });

        if (rt.syncChannel) {
          rt.syncChannel.addEventListener('message', function(ev) {
            var d = ev.data;
            if (!d) return;
            if (d.type === 'annotations-updated' && d.bookSlug === rt.meta.bookSlug && d.chapterSlug === rt.meta.chapterSlug) {
              loadChapterData();
            } else if (d.type === 'focus-ast-node' && d.bookSlug === rt.meta.bookSlug && d.chapterSlug === rt.meta.chapterSlug && d.nodeId) {
              ensureAstBound().then(function() { scrollToAstNode(d.nodeId); });
            }
          });
        }
        window.addEventListener('astrolib:sideload-change', function(ev) {
          if (ev && ev.detail && ev.detail.activePanelId === 'annotations') {
            ensureAstBound();
          }
        });
        window.addEventListener('message', function(ev) {
          if (ev.data && ev.data.type === 'astrolib:focus-ast-node' && ev.data.nodeId) {
            ensureAstBound().then(function() { scrollToAstNode(ev.data.nodeId); });
          }
        });
      }

      function bindPageSidebarControls() {
        document.querySelectorAll('[data-ann-tab]').forEach(function(tab) {
          if (tab.__annBound) return;
          tab.__annBound = true;
          tab.addEventListener('click', function() {
            var target = tab.getAttribute('data-ann-tab');
            document.querySelectorAll('[data-ann-tab]').forEach(function(t) { t.classList.remove('is-active'); });
            tab.classList.add('is-active');
            var sv = document.getElementById('ann-stream-view');
            var cv = document.getElementById('ann-canvas-view');
            if (sv) sv.style.display = target === 'stream' ? 'flex' : 'none';
            if (cv) cv.style.display = target === 'canvas' ? 'flex' : 'none';
          });
        });

        document.querySelectorAll('[data-ann-filter]').forEach(function(chip) {
          if (chip.__annBound) return;
          chip.__annBound = true;
          chip.addEventListener('click', function() {
            rt.streamFilter = chip.getAttribute('data-ann-filter') || 'all';
            document.querySelectorAll('[data-ann-filter]').forEach(function(c) { c.classList.remove('is-active'); });
            chip.classList.add('is-active');
            renderSidebarLists();
          });
        });

        var addQuickBtn = document.getElementById('ann-canvas-add-quick');
        if (addQuickBtn && !addQuickBtn.__annBound) {
          addQuickBtn.__annBound = true;
          addQuickBtn.addEventListener('click', function() {
            var box = document.getElementById('ann-quick-composer');
            if (box) box.style.display = box.style.display === 'none' ? 'flex' : 'none';
          });
        }
        var cancelQuickBtn = document.getElementById('ann-quick-cancel');
        if (cancelQuickBtn && !cancelQuickBtn.__annBound) {
          cancelQuickBtn.__annBound = true;
          cancelQuickBtn.addEventListener('click', function() {
            var box = document.getElementById('ann-quick-composer');
            if (box) box.style.display = 'none';
          });
        }
        var saveQuickBtn = document.getElementById('ann-quick-save');
        if (saveQuickBtn && !saveQuickBtn.__annBound) {
          saveQuickBtn.__annBound = true;
          saveQuickBtn.addEventListener('click', function() {
            var input = document.getElementById('ann-quick-markdown');
            var md = (input?.value || '').trim();
            if (!md) return;
            addExcerptToCanvas(null, '', md);
            input.value = '';
            var box = document.getElementById('ann-quick-composer');
            if (box) box.style.display = 'none';
          });
        }

        var exportBtn = document.getElementById('ann-export-anp');
        if (exportBtn && !exportBtn.__annBound) {
          exportBtn.__annBound = true;
          exportBtn.addEventListener('click', function() {
            fetch(getApiBase() + '/export')
              .then(function(r) { return r.json(); })
              .then(function(j) {
                if (!j || !j.data) return;
                var blob = new Blob([JSON.stringify(j.data, null, 2)], { type: 'application/json' });
                var url = URL.createObjectURL(blob);
                var a = document.createElement('a');
                a.href = url;
                a.download = rt.meta.colSlug + '-' + rt.meta.bookSlug + '.anp.json';
                a.click();
                URL.revokeObjectURL(url);
              });
          });
        }

        var importBtn = document.getElementById('ann-import-anp');
        var importInput = document.getElementById('ann-import-file-input');
        if (importBtn && !importBtn.__annBound) {
          importBtn.__annBound = true;
          importBtn.addEventListener('click', function() { importInput?.click(); });
        }
        if (importInput && !importInput.__annBound) {
          importInput.__annBound = true;
          importInput.addEventListener('change', function(e) {
            var file = e.target.files && e.target.files[0];
            if (!file) return;
            file.text().then(function(txt) {
              var parsed = JSON.parse(txt);
              return fetch(getApiBase() + '/import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ package: parsed, mode: 'merge' }),
              });
            }).then(function() {
              loadChapterData();
              broadcastUpdate();
            }).catch(function(err) {
              alert('导入 ANP 失败: ' + (err && err.message ? err.message : String(err)));
            });
            e.target.value = '';
          });
        }
      }

      function mountChapter() {
        rt.meta = resolveCurrentMetaFromDom();
        rt.undoStack = [];
        rt.redoStack = [];
        rt.currentSelection = null;
        rt.astLoadedKey = null;
        rt.astLoadingKey = null;
        rt.astLoadPromise = null;
        ensureSideloadRegistered();
        bindGlobalListenersOnce();
        ensureFloatingPopover();
        bindPageSidebarControls();

        var rootEl = document.querySelector('.astrolib-chapter-content');
        if (rootEl) {
          assignFallbackDomIds(rootEl);
        }

        // 切章后自动通知外层同步右侧分屏画布
        notifyParentChapterChanged();

        // 按需加载本章批注：仅当存在批注或画布节点时再拉取真实 AST 映射，避免无批注章节打开时的冗余请求
        loadChapterData();
      }

      if (!window.__astrolibAnnPageLoadBound) {
        window.__astrolibAnnPageLoadBound = true;
        document.addEventListener('astro:page-load', mountChapter);
      }

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mountChapter);
      } else {
        mountChapter();
      }
    })();
  <\/script>
  `;
}
