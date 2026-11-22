export function buildCanvasBodyMarkup(): string {
  return `
  <div class="cv-app">
    <header class="cv-topbar" id="cv-topbar">
      <!-- 左侧工具与卡片操作 -->
      <div class="cv-toolbar-group">
        <button type="button" class="cv-icon-btn tip-left" id="tool-select" data-tool="select" data-tip="选择与编辑 (V)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3l14 9-6.5 1.5L9.5 20z"/></svg>
        </button>
        <button type="button" class="cv-icon-btn" id="tool-pan" data-tool="pan" data-tip="抓手平移画布 (H / 空格)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11V6a2 2 0 0 0-4 0v4M14 10V4a2 2 0 0 0-4 0v6M10 10V6a2 2 0 0 0-4 0v7"/><path d="M6 13v-2a2 2 0 0 0-4 0v3.5a6.5 6.5 0 0 0 6.5 6.5H13a5 5 0 0 0 5-5v-3"/></svg>
        </button>
        <button type="button" class="cv-icon-btn" id="tool-pen" data-tool="pen" data-tip="钢笔/数位板书写 (P)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/></svg>
        </button>
        <button type="button" class="cv-icon-btn" id="tool-highlighter" data-tool="highlighter" data-tip="荧光标注笔 (M)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l-6 6v3h9l3-3"/><path d="M22 12l-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/></svg>
        </button>
        <button type="button" class="cv-icon-btn" id="tool-eraser" data-tool="eraser" data-tip="笔画橡皮擦 (E)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20H7L3 16c-.8-.8-.8-2 0-2.8L13.4 2.8c.8-.8 2-.8 2.8 0L21 7.6c.8.8.8 2 0 2.8L11.5 20"/></svg>
        </button>

        <div class="cv-sep"></div>

        <button type="button" class="cv-brush-indicator" id="btn-brush-popover" title="笔触质感、粗细与颜色 (B)">
          <span class="cv-brush-dot" id="cv-brush-dot" style="background:var(--cv-accent)"></span>
          <span id="cv-brush-label">钢笔 · 2.5</span>
        </button>

        <div class="cv-sep"></div>

        <button type="button" class="cv-icon-btn" id="btn-add-card" data-tip="新建笔记卡片 (N)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M12 8v8M8 12h8"/></svg>
        </button>
        <button type="button" class="cv-icon-btn" id="btn-quote-ast" data-tip="引用原文 AST 节点 (Q)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 11h-4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v6c0 2.667-1.333 4.333-4 5"/><path d="M19 11h-4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v6c0 2.667-1.333 4.333-4 5"/></svg>
        </button>
      </div>

      <!-- 右侧历史、缩放与导入导出 -->
      <div class="cv-toolbar-group">
        <button type="button" class="cv-icon-btn" id="btn-undo" data-tip="撤销 (Ctrl+Z)" disabled>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>
        </button>
        <button type="button" class="cv-icon-btn" id="btn-redo" data-tip="重做 (Ctrl+Y)" disabled>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/></svg>
        </button>

        <div class="cv-sep"></div>

        <button type="button" class="cv-icon-btn" id="btn-zoom-out" data-tip="缩小画布 (Ctrl+-)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35M8 11h6"/></svg>
        </button>
        <button type="button" class="cv-zoom-readout" id="btn-zoom-reset" title="点击重置缩放 100% (Ctrl+0)">100%</button>
        <button type="button" class="cv-icon-btn" id="btn-zoom-in" data-tip="放大画布 (Ctrl+=)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35M11 8v6M8 11h6"/></svg>
        </button>
        <button type="button" class="cv-icon-btn" id="btn-fit-view" data-tip="适应全部内容 (F)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4"/></svg>
        </button>

        <div class="cv-sep"></div>

        <button type="button" class="cv-icon-btn" id="btn-import-anp" data-tip="导入 ANP 笔记包">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        </button>
        <button type="button" class="cv-icon-btn tip-right" id="btn-export-popover" data-tip="导出 PDF / PNG / ANP (Ctrl+E)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </button>
        <span class="cv-save-dot" id="cv-save-dot" title="笔记自动持久化状态"></span>
        <input type="file" id="cv-import-file" accept=".json,.anp,.anp.json" style="display:none" />
      </div>
    </header>

    <!-- 笔触质感与粗细弹出面板 -->
    <div class="cv-popover" id="cv-brush-popover" style="left: 140px;">
      <div>
        <div class="cv-popover-section-title">笔触质感</div>
        <div class="cv-seg-row" id="cv-brush-style-row">
          <button type="button" class="cv-seg-btn active" data-style="fountain">钢笔</button>
          <button type="button" class="cv-seg-btn" data-style="monoline">匀速</button>
          <button type="button" class="cv-seg-btn" data-style="pencil">铅笔</button>
          <button type="button" class="cv-seg-btn" data-style="highlighter">荧光</button>
        </div>
      </div>
      <div>
        <div class="cv-popover-section-title">笔触粗细 (<span id="cv-width-val">2.5</span> px)</div>
        <div class="cv-width-row" style="margin-bottom:6px">
          <button type="button" class="cv-width-chip" data-w="1.5" title="极细 1.5px"><span style="width:4px;height:4px"></span></button>
          <button type="button" class="cv-width-chip active" data-w="2.5" title="适中 2.5px"><span style="width:6px;height:6px"></span></button>
          <button type="button" class="cv-width-chip" data-w="4" title="加粗 4px"><span style="width:9px;height:9px"></span></button>
          <button type="button" class="cv-width-chip" data-w="7" title="粗笔 7px"><span style="width:12px;height:12px"></span></button>
          <button type="button" class="cv-width-chip" data-w="12" title="特粗 12px"><span style="width:16px;height:16px"></span></button>
        </div>
        <input type="range" id="cv-width-slider" min="1" max="24" step="0.5" value="2.5" style="width:100%" />
      </div>
      <div>
        <div class="cv-popover-section-title">墨水颜色</div>
        <div class="cv-swatch-row" id="cv-swatch-row">
          <button type="button" class="cv-swatch" data-color="#1a1c1e" style="background:#1a1c1e" title="碳黑"></button>
          <button type="button" class="cv-swatch active" data-color="#0b57d0" data-theme-swatch="1" style="background:var(--cv-accent,#0b57d0)" title="主题强调色"></button>
          <button type="button" class="cv-swatch" data-color="#b3261e" style="background:#b3261e" title="朱红"></button>
          <button type="button" class="cv-swatch" data-color="#188038" style="background:#188038" title="松绿"></button>
          <button type="button" class="cv-swatch" data-color="#b06000" style="background:#b06000" title="琥珀"></button>
          <button type="button" class="cv-swatch" data-color="#7b1fa2" style="background:#7b1fa2" title="紫罗兰"></button>
          <input type="color" id="cv-color-picker" value="#0b57d0" title="自定义任意颜色" style="width:24px;height:24px;border:none;padding:0;background:transparent;cursor:pointer;" />
        </div>
      </div>
    </div>

    <!-- 导出菜单弹出面板 -->
    <div class="cv-popover" id="cv-export-popover" style="right: 12px;">
      <div class="cv-popover-section-title">导出当前画布与笔记</div>
      <button type="button" class="cv-menu-action" id="btn-export-pdf">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
        <span>导出为 PDF 文档</span>
      </button>
      <div style="display:flex;flex-direction:column;gap:6px;padding:8px;border:1px solid var(--cv-outline);border-radius:10px;">
        <div class="cv-popover-section-title" style="margin:0">导出为高分辨率 PNG 图片</div>
        <div class="cv-dpi-row">
          <select class="cv-dpi-select" id="cv-png-dpi-preset" style="flex:1">
            <option value="96">96 DPI (屏幕)</option>
            <option value="150">150 DPI (高清)</option>
            <option value="300" selected>300 DPI (印刷)</option>
            <option value="600">600 DPI (超清)</option>
          </select>
          <input type="number" class="cv-dpi-input" id="cv-png-dpi-custom" min="72" max="600" value="300" title="自定义 DPI (72-600)" />
        </div>
        <button type="button" class="cv-menu-action" id="btn-export-png" style="justify-content:center;background:var(--cv-accent-container);color:var(--cv-accent-ink);border-color:transparent;font-weight:600">
          <span>导出 PNG</span>
        </button>
      </div>
      <button type="button" class="cv-menu-action" id="btn-export-anp">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
        <span>导出整书无损数据包 (.anp.json)</span>
      </button>
    </div>

    <!-- 无限画布视口 -->
    <main class="cv-viewport" id="cv-viewport">
      <div class="cv-cards-layer" id="cv-cards-layer"></div>
      <canvas class="cv-ink-canvas" id="cv-ink-static"></canvas>
      <canvas class="cv-ink-canvas" id="cv-ink-live"></canvas>
    </main>
  </div>

  <!-- 原书 AST 节点引用弹窗 -->
  <div class="cv-modal-backdrop" id="cv-ast-modal">
    <div class="cv-modal">
      <div class="cv-modal-head">
        <span>引用本章原文段落 / 公式 / 学术卡片</span>
        <button type="button" class="cv-card-mini-btn" id="cv-ast-close" title="关闭 (Esc)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <input type="text" class="cv-modal-search" id="cv-ast-search" placeholder="筛选节点 ID (如 p-12) 或关键词..." />
      <div class="cv-modal-body" id="cv-ast-list"></div>
    </div>
  </div>

  <div class="cv-toast" id="cv-toast"></div>
  `;
}
