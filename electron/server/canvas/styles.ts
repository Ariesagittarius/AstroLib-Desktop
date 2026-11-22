export function buildCanvasStyles(): string {
  const drawCursorLight =
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Ccircle cx='6' cy='6' r='2.1' fill='%231f1f1f' stroke='%23ffffff' stroke-width='1'/%3E%3C/svg%3E\") 6 6, default";
  const drawCursorDark =
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Ccircle cx='6' cy='6' r='2.1' fill='%23f2f2f2' stroke='%23131316' stroke-width='1'/%3E%3C/svg%3E\") 6 6, default";
  const eraserCursorLight =
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 14 14'%3E%3Ccircle cx='7' cy='7' r='3.5' fill='none' stroke='%231f1f1f' stroke-width='1.1'/%3E%3Ccircle cx='7' cy='7' r='4.6' fill='none' stroke='%23ffffff' stroke-width='0.8' stroke-opacity='0.85'/%3E%3C/svg%3E\") 7 7, default";
  const eraserCursorDark =
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 14 14'%3E%3Ccircle cx='7' cy='7' r='3.5' fill='none' stroke='%23f2f2f2' stroke-width='1.1'/%3E%3Ccircle cx='7' cy='7' r='4.6' fill='none' stroke='%23131316' stroke-width='0.8' stroke-opacity='0.85'/%3E%3C/svg%3E\") 7 7, default";

  return `
    :root {
      --font-latin-sans: 'Google Sans', 'Google Sans Text';
      --font-latin-serif: 'Times New Roman', Georgia;
      --font-latin-katex: 'KaTeX_Main', 'Times New Roman', Georgia;

      --font-cjk-sans: 'Noto Sans SC Variable', 'Source Han Sans SC', 'Source Han Sans CN', 'Noto Sans SC', 'Noto Sans CJK SC', '思源黑体', 'PingFang SC', sans-serif;
      --font-cjk-serif: 'Songti SC', 'STSong', 'SimSun', serif;
      --font-cjk-han-sans: 'Noto Sans SC Variable', 'Source Han Sans SC', 'Source Han Sans CN', 'Noto Sans SC', 'Noto Sans CJK SC', '思源黑体', 'PingFang SC', sans-serif;
      --font-cjk-han-serif: 'Noto Serif SC Variable', 'Source Han Serif SC', 'Source Han Serif CN', 'Noto Serif SC', 'Noto Serif CJK SC', '思源宋体', 'Songti SC', 'STSong', 'SimSun', serif;

      --font-latin: var(--font-latin-sans);
      --font-cjk: var(--font-cjk-han-sans);
      --cv-font-ui: var(--font-latin-sans), var(--font-cjk-han-sans);
      --cv-font-reading: var(--font-latin), var(--font-cjk);
      --academic-font-size-body: 0.9375rem;

      /* Material You 动态颜色令牌回退 */
      --md-sys-color-primary: #0b57d0;
      --md-sys-color-on-primary: #ffffff;
      --md-sys-color-primary-container: #d3e3fd;
      --md-sys-color-on-primary-container: #041e49;
      --md-sys-color-secondary-container: #c2e7ff;
      --md-sys-color-on-secondary-container: #001d35;
      --md-sys-color-surface: #ffffff;
      --md-sys-color-on-surface: #1f1f1f;
      --md-sys-color-surface-container-low: #f8f9fa;
      --md-sys-color-surface-container: #f0f2f5;
      --md-sys-color-surface-container-high: #e8eaed;
      --md-sys-color-on-surface-variant: #444746;
      --md-sys-color-outline: #72777d;
      --md-sys-color-outline-variant: #e8eaed;
      --md-sys-color-error: #b3261e;
      --md-sys-color-inverse-surface: #303030;
      --md-sys-color-inverse-on-surface: #f2f2f2;

      --cv-bg: var(--md-sys-color-surface, #ffffff);
      --cv-grid-dot: rgba(31, 31, 31, 0.13);
      --cv-surface: var(--md-sys-color-surface, #ffffff);
      --cv-surface-subtle: var(--md-sys-color-surface-container-low, #f8f9fa);
      --cv-surface-hover: var(--md-sys-color-surface-container-high, #e8eaed);
      --cv-ink: var(--md-sys-color-on-surface, #1f1f1f);
      --cv-ink-muted: var(--md-sys-color-on-surface-variant, #444746);
      --cv-outline: var(--md-sys-color-outline-variant, #e8eaed);
      --cv-outline-strong: color-mix(in srgb, var(--md-sys-color-outline, #72777d) 36%, var(--md-sys-color-surface, #ffffff));
      --cv-accent: var(--md-sys-color-primary, #0b57d0);
      --cv-accent-container: var(--md-sys-color-secondary-container, #d3e3fd);
      --cv-accent-ink: var(--md-sys-color-on-secondary-container, #041e49);
      --cv-danger: var(--md-sys-color-error, #b3261e);
      --cv-tooltip-bg: var(--md-sys-color-inverse-surface, #303030);
      --cv-tooltip-fg: var(--md-sys-color-inverse-on-surface, #f2f2f2);
    }

    :root[data-font-latin='sans'] { --font-latin: var(--font-latin-sans); }
    :root[data-font-latin='serif'] { --font-latin: var(--font-latin-serif); }
    :root[data-font-latin='katex'] { --font-latin: var(--font-latin-katex); }
    :root[data-font-cjk='sans'] { --font-cjk: var(--font-cjk-sans); }
    :root[data-font-cjk='serif'] { --font-cjk: var(--font-cjk-serif); }
    :root[data-font-cjk='han-sans'] { --font-cjk: var(--font-cjk-han-sans); }
    :root[data-font-cjk='han-serif'] { --font-cjk: var(--font-cjk-han-serif); }

    html[data-theme="dark"] {
      --md-sys-color-primary: #a8c7fa;
      --md-sys-color-on-primary: #062e6f;
      --md-sys-color-primary-container: #0842a0;
      --md-sys-color-on-primary-container: #d3e3fd;
      --md-sys-color-secondary-container: #004a77;
      --md-sys-color-on-secondary-container: #c2e7ff;
      --md-sys-color-surface: #131316;
      --md-sys-color-on-surface: #e3e3e3;
      --md-sys-color-surface-container-low: #18191a;
      --md-sys-color-surface-container: #1e1f20;
      --md-sys-color-surface-container-high: #28292a;
      --md-sys-color-on-surface-variant: #c4c7c5;
      --md-sys-color-outline: #8e918f;
      --md-sys-color-outline-variant: #3c4043;
      --md-sys-color-error: #ffb4ab;
      --md-sys-color-inverse-surface: #e3e3e3;
      --md-sys-color-inverse-on-surface: #1f1f1f;

      --cv-grid-dot: rgba(227, 227, 227, 0.14);
      --cv-outline-strong: var(--md-sys-color-outline, #5f6368);
    }

    * { box-sizing: border-box; }

    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: var(--cv-bg);
      color: var(--cv-ink);
      font-family: var(--cv-font-ui);
      -webkit-font-smoothing: antialiased;
    }

    button, input, select, textarea {
      font-family: inherit;
    }

    .cv-app {
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
    }

    /* 紧凑纯图标顶栏 */
    .cv-topbar {
      height: 38px;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      padding: 0 8px;
      background: var(--cv-surface);
      border-bottom: 1px solid var(--cv-outline);
      z-index: 40;
      user-select: none;
    }

    .cv-toolbar-group {
      display: flex;
      align-items: center;
      gap: 2px;
      position: relative;
    }

    .cv-sep {
      width: 1px;
      height: 16px;
      background: var(--cv-outline);
      margin: 0 4px;
      flex-shrink: 0;
    }

    .cv-icon-btn {
      position: relative;
      width: 28px;
      height: 28px;
      border: 1px solid transparent;
      border-radius: 9999px;
      background: transparent;
      color: var(--cv-ink-muted);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      padding: 0;
      transition: background-color 0.14s ease, color 0.14s ease, border-color 0.14s ease;
    }

    .cv-icon-btn svg {
      width: 18px;
      height: 18px;
      display: block;
      pointer-events: none;
    }

    .cv-icon-btn:hover:not(:disabled) {
      background: var(--cv-surface-hover);
      color: var(--cv-ink);
    }

    .cv-icon-btn.active {
      background: var(--cv-accent-container);
      color: var(--cv-accent-ink);
      border-color: transparent;
    }

    .cv-icon-btn:disabled {
      opacity: 0.36;
      cursor: not-allowed;
    }

    /* M3 暗底白字 Tooltip（带快捷键提示） */
    .cv-icon-btn[data-tip]:hover::after {
      content: attr(data-tip);
      position: absolute;
      top: calc(100% + 6px);
      left: 50%;
      transform: translateX(-50%);
      padding: 4px 8px;
      border-radius: 6px;
      background: var(--cv-tooltip-bg);
      color: var(--cv-tooltip-fg);
      font-size: 11px;
      font-weight: 500;
      line-height: 1.3;
      white-space: nowrap;
      pointer-events: none;
      z-index: 120;
    }

    .cv-icon-btn.tip-left[data-tip]:hover::after {
      left: 0;
      transform: none;
    }

    .cv-icon-btn.tip-right[data-tip]:hover::after {
      left: auto;
      right: 0;
      transform: none;
    }

    .cv-brush-indicator {
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      height: 26px;
      padding: 0 8px;
      border-radius: 9999px;
      border: 1px solid var(--cv-outline);
      background: var(--cv-surface);
      color: var(--cv-ink);
      cursor: pointer;
      font-size: 11px;
    }

    .cv-brush-indicator:hover {
      background: var(--cv-surface-hover);
    }

    .cv-brush-dot {
      width: 10px;
      height: 10px;
      border-radius: 9999px;
      border: 1px solid rgba(0, 0, 0, 0.16);
      flex-shrink: 0;
    }

    .cv-zoom-readout {
      height: 26px;
      min-width: 42px;
      padding: 0 6px;
      border: 1px solid transparent;
      border-radius: 9999px;
      background: transparent;
      color: var(--cv-ink-muted);
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      font-variant-numeric: tabular-nums;
    }

    .cv-zoom-readout:hover {
      background: var(--cv-surface-hover);
      color: var(--cv-ink);
    }

    .cv-save-dot {
      width: 6px;
      height: 6px;
      border-radius: 9999px;
      background: #188038;
      margin-left: 2px;
      flex-shrink: 0;
    }
    .cv-save-dot.dirty { background: #d97706; }
    .cv-save-dot.error { background: var(--cv-danger); }

    /* 弹出面板（笔触设置 / 导出菜单）：纯白 M3 + 1px 细边框，无重阴影 */
    .cv-popover {
      position: fixed;
      top: 42px;
      background: var(--cv-surface);
      border: 1px solid var(--cv-outline-strong);
      border-radius: 14px;
      padding: 12px 14px;
      z-index: 100;
      display: none;
      flex-direction: column;
      gap: 10px;
      min-width: 248px;
      box-shadow: 0 2px 10px rgba(15, 23, 42, 0.06);
    }

    .cv-popover.open { display: flex; }

    .cv-popover-section-title {
      font-size: 11px;
      font-weight: 600;
      color: var(--cv-ink-muted);
      letter-spacing: 0.02em;
      margin-bottom: 4px;
    }

    .cv-seg-row {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 4px;
    }

    .cv-seg-btn {
      height: 28px;
      border-radius: 8px;
      border: 1px solid var(--cv-outline);
      background: var(--cv-surface);
      color: var(--cv-ink);
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
    }

    .cv-seg-btn:hover { background: var(--cv-surface-hover); }
    .cv-seg-btn.active {
      background: var(--cv-accent-container);
      color: var(--cv-accent-ink);
      border-color: var(--cv-accent);
      font-weight: 600;
    }

    .cv-width-row {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .cv-width-chip {
      width: 28px;
      height: 28px;
      border-radius: 8px;
      border: 1px solid var(--cv-outline);
      background: var(--cv-surface);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }
    .cv-width-chip.active {
      border-color: var(--cv-accent);
      background: var(--cv-accent-container);
    }
    .cv-width-chip span {
      display: block;
      border-radius: 9999px;
      background: var(--cv-ink);
    }

    .cv-swatch-row {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }

    .cv-swatch {
      width: 22px;
      height: 22px;
      border-radius: 9999px;
      border: 2px solid transparent;
      cursor: pointer;
      padding: 0;
    }
    .cv-swatch.active {
      outline: 2px solid var(--cv-accent);
      outline-offset: 2px;
    }

    .cv-menu-action {
      width: 100%;
      height: 34px;
      border-radius: 10px;
      border: 1px solid var(--cv-outline);
      background: var(--cv-surface);
      color: var(--cv-ink);
      font-size: 12px;
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 10px;
      cursor: pointer;
      text-align: left;
    }
    .cv-menu-action:hover {
      background: var(--cv-surface-hover);
      border-color: var(--cv-outline-strong);
    }
    .cv-menu-action svg { width: 16px; height: 16px; color: var(--cv-ink-muted); flex-shrink: 0; }

    .cv-dpi-row {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .cv-dpi-select, .cv-dpi-input {
      height: 30px;
      border-radius: 8px;
      border: 1px solid var(--cv-outline);
      background: var(--cv-surface);
      color: var(--cv-ink);
      font-size: 12px;
      padding: 0 8px;
    }
    .cv-dpi-input { width: 64px; text-align: center; }

    /* 无限画布视口（绘图态改用极简非 XOR 微圆点光标，彻底避免十字遮挡与闪烁） */
    .cv-viewport {
      position: relative;
      flex: 1 1 auto;
      overflow: hidden;
      background-color: var(--cv-bg);
      background-image: radial-gradient(var(--cv-grid-dot) 1.15px, transparent 1.15px);
      background-size: 24px 24px;
      background-position: 0px 0px;
      touch-action: none;
      cursor: default;
    }

    .cv-viewport.tool-pan { cursor: grab; }
    .cv-viewport.tool-pan.panning { cursor: grabbing; }
    .cv-viewport.tool-draw { cursor: ${drawCursorLight}; }
    html[data-theme="dark"] .cv-viewport.tool-draw { cursor: ${drawCursorDark}; }
    .cv-viewport.tool-eraser { cursor: ${eraserCursorLight}; }
    html[data-theme="dark"] .cv-viewport.tool-eraser { cursor: ${eraserCursorDark}; }

    /* 世界坐标变换层（仅承载卡片 DOM） */
    .cv-cards-layer {
      position: absolute;
      left: 0;
      top: 0;
      width: 0;
      height: 0;
      transform-origin: 0 0;
      overflow: visible;
      z-index: 10;
    }

    /* 双层屏幕空间笔迹画布（视锥裁剪 + 零延迟实时增量笔迹） */
    .cv-ink-canvas {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
    }
    #cv-ink-static { z-index: 15; }
    #cv-ink-live { z-index: 16; }

    /* Material 3 纯白无阴影学术笔记卡片 */
    .cv-card {
      position: absolute;
      display: flex;
      flex-direction: column;
      background: var(--cv-surface);
      border: 1px solid var(--cv-outline);
      border-radius: 14px;
      box-shadow: none;
      overflow: hidden;
      user-select: text;
      transition: border-color 0.14s ease;
    }

    .cv-card:hover {
      border-color: var(--cv-outline-strong);
    }

    .cv-card.selected {
      border-color: var(--cv-accent);
      outline: 1px solid var(--cv-accent);
    }

    .cv-card[data-accent]::before {
      content: '';
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 3px;
      background: var(--card-accent, var(--cv-accent));
    }

    .cv-card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 7px 10px 6px 12px;
      border-bottom: 1px solid var(--cv-outline);
      background: var(--cv-surface);
      cursor: grab;
      user-select: none;
    }

    .cv-card-header:active { cursor: grabbing; }

    .cv-card-badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 11px;
      font-weight: 600;
      color: var(--cv-ink-muted);
      letter-spacing: 0.01em;
    }

    .cv-card-badge svg {
      width: 14px;
      height: 14px;
      flex-shrink: 0;
    }

    .cv-card-actions {
      display: flex;
      align-items: center;
      gap: 2px;
    }

    .cv-card-mini-btn {
      width: 24px;
      height: 24px;
      border: none;
      border-radius: 9999px;
      background: transparent;
      color: var(--cv-ink-muted);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      padding: 0;
    }

    .cv-card-mini-btn svg { width: 14px; height: 14px; }
    .cv-card-mini-btn:hover { background: var(--cv-surface-hover); color: var(--cv-ink); }
    .cv-card-mini-btn.danger:hover { color: var(--cv-danger); }

    .cv-card-body {
      padding: 12px 14px;
      font-family: var(--cv-font-reading);
      font-size: var(--academic-font-size-body, 0.9375rem);
      line-height: 1.7;
      color: var(--cv-ink);
      overflow-y: auto;
      flex: 1 1 auto;
    }

    .cv-card-body p:first-child { margin-top: 0; }
    .cv-card-body p:last-child { margin-bottom: 0; }

    .cv-card-editor {
      width: 100%;
      min-height: 112px;
      border: 1px solid var(--cv-outline);
      border-radius: 10px;
      background: var(--cv-bg);
      color: var(--cv-ink);
      padding: 9px 10px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12.5px;
      line-height: 1.55;
      resize: vertical;
      outline: none;
    }

    .cv-card-editor:focus {
      border-color: var(--cv-accent);
    }

    .cv-card-resize {
      position: absolute;
      right: 2px;
      bottom: 2px;
      width: 16px;
      height: 16px;
      cursor: nwse-resize;
      opacity: 0.45;
    }
    .cv-card:hover .cv-card-resize { opacity: 0.85; }

    /* 1:1 复刻正文原书排版与学术卡片样式 */
    .cv-ast-quote-original {
      font-family: var(--cv-font-reading);
      font-size: var(--academic-font-size-body, 0.9375rem);
      line-height: 1.72;
      color: var(--cv-ink);
    }
    .cv-ast-quote-original h1,
    .cv-ast-quote-original h2,
    .cv-ast-quote-original h3,
    .cv-ast-quote-original h4 {
      font-family: var(--cv-font-ui);
      margin: 0 0 8px 0;
      font-weight: 600;
      line-height: 1.35;
    }
    .cv-ast-quote-original p { margin: 0 0 8px 0; }
    .cv-ast-quote-original p:last-child { margin-bottom: 0; }
    .cv-ast-quote-original img { max-width: 100%; height: auto; border-radius: 8px; }
    .cv-ast-quote-original .katex-display {
      overflow-x: auto;
      overflow-y: hidden;
      margin: 8px 0;
      padding: 2px 0;
    }
    .cv-ast-quote-original pre {
      margin: 8px 0;
      padding: 10px 12px;
      border-radius: 8px;
      background: var(--cv-surface-subtle);
      border: 1px solid var(--cv-outline);
      overflow-x: auto;
      font-size: 12.5px;
    }
    .cv-ast-quote-original code,
    .cv-ast-quote-original kbd {
      background: var(--cv-surface-subtle);
      color: var(--cv-ink);
      border: 1px solid var(--cv-outline);
      border-radius: 4px;
      padding: 1px 5px;
      font-size: 0.88em;
    }
    .cv-ast-quote-original pre code {
      background: transparent;
      border: none;
      padding: 0;
    }
    .cv-ast-quote-original .academic-card,
    .cv-ast-quote-original .theorem-card,
    .cv-ast-quote-original .definition-card,
    .cv-ast-quote-original .example-card,
    .cv-ast-quote-original .exercise-card,
    .cv-ast-quote-original .proof-card,
    .cv-ast-quote-original .academic-theorem-card {
      margin: 0;
      padding: 10px 12px;
      border-radius: 10px;
      border: 1px solid var(--cv-outline);
      border-left: 3px solid var(--cv-accent);
      background: var(--cv-surface);
    }
    .cv-ast-quote-original .definition-card { border-left-color: var(--cv-accent); }
    .cv-ast-quote-original .theorem-card { border-left-color: #6750a4; }
    .cv-ast-quote-original .example-card { border-left-color: #146c2e; }
    .cv-ast-quote-original .exercise-card { border-left-color: #b06000; }
    .cv-ast-quote-original .card-header,
    .cv-ast-quote-original .academic-card-header {
      font-family: var(--cv-font-ui);
      font-weight: 600;
      font-size: 13px;
      margin-bottom: 6px;
      color: var(--cv-ink);
    }
    .cv-ast-quote-original details.solution-details {
      margin-top: 8px;
      border-top: 1px dashed var(--cv-outline);
      padding-top: 6px;
    }
    .cv-ast-quote-original details.solution-details > summary {
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      color: var(--cv-accent);
    }
    .cv-ast-quote-original blockquote {
      margin: 0;
      padding-left: 10px;
      border-left: 3px solid var(--cv-outline-strong);
      color: var(--cv-ink-muted);
    }

    /* AST 节点引用选择器模态框 */
    .cv-modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.36);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 140;
    }
    .cv-modal-backdrop.open { display: flex; }

    .cv-modal {
      width: min(560px, 92vw);
      max-height: 76vh;
      background: var(--cv-surface);
      border: 1px solid var(--cv-outline-strong);
      border-radius: 16px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .cv-modal-head {
      padding: 12px 16px;
      border-bottom: 1px solid var(--cv-outline);
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 14px;
      font-weight: 600;
    }

    .cv-modal-search {
      width: calc(100% - 24px);
      margin: 10px 12px 4px;
      height: 34px;
      padding: 0 12px;
      border-radius: 10px;
      border: 1px solid var(--cv-outline);
      background: var(--cv-bg);
      color: var(--cv-ink);
      font-size: 13px;
      outline: none;
    }
    .cv-modal-search:focus { border-color: var(--cv-accent); }

    .cv-modal-body {
      padding: 8px 12px 12px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .cv-ast-row {
      padding: 9px 12px;
      border-radius: 10px;
      border: 1px solid var(--cv-outline);
      background: var(--cv-surface);
      cursor: pointer;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .cv-ast-row:hover {
      border-color: var(--cv-accent);
      background: var(--cv-surface-subtle);
    }
    .cv-ast-meta {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 11px;
      color: var(--cv-accent);
      font-family: ui-monospace, monospace;
      font-weight: 600;
    }
    .cv-ast-preview {
      font-size: 12.5px;
      color: var(--cv-ink-muted);
      line-height: 1.45;
    }

    .cv-toast {
      position: fixed;
      bottom: 16px;
      left: 50%;
      transform: translateX(-50%);
      padding: 7px 14px;
      border-radius: 9999px;
      background: var(--cv-tooltip-bg);
      color: var(--cv-tooltip-fg);
      font-size: 12px;
      font-weight: 500;
      z-index: 200;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.16s ease;
    }
    .cv-toast.show { opacity: 1; }

    /* 导出模式 (?exportMode=pdf|png)：隐藏所有控件与点阵网格，输出纯净无边框纸面 */
    body.cv-export-mode .cv-topbar,
    body.cv-export-mode .cv-card-actions,
    body.cv-export-mode .cv-card-resize,
    body.cv-export-mode .cv-popover,
    body.cv-export-mode .cv-modal-backdrop,
    body.cv-export-mode .cv-toast {
      display: none !important;
    }
    body.cv-export-mode .cv-viewport {
      background-image: none !important;
      background: #ffffff !important;
      overflow: visible !important;
    }
  `;
}
