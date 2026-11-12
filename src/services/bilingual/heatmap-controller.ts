/**
 * src/services/bilingual/heatmap-controller.ts
 * ============================================================================
 * AstroLib 双语关联度高保真学术热力图控制器 (Heatmap Sheet Controller)
 * ============================================================================
 * 遵循 Material Design 3 规范与 Rule 5.3 极简主义呼吸感：
 * 1. 严格参照学术文献矩阵排版规范（顶部/左侧坐标轴标注、刻度线 Ticks、白网格间隙）；
 * 2. 经典 Sequential Blues 蓝阶色彩映射（浅冰蓝 → 媒介蓝 → 深藏青）；
 * 3. 格内高对比度两位小数（1.00, 0.85, 0.54）自适应字号居中渲染；
 * 4. 自适应拉伸缩放，段落较多时自动紧凑化，支持点击联动双栏跳转与微光聚焦。
 * ============================================================================
 */

import type { AlignmentMatrixResult } from './types.ts';

export interface HeatmapCallbacks {
  onCellClick?: (sourceId: string, targetId: string, similarity: number) => void;
  onThresholdChange?: (newThreshold: number) => void;
}

export class HeatmapController {
  private sheetEl: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private tooltipEl: HTMLElement | null = null;
  private sliderEl: HTMLInputElement | null = null;
  private badgeEl: HTMLElement | null = null;
  private thresholdValEl: HTMLElement | null = null;
  private scrollWrapper: HTMLElement | null = null;

  private currentResult: AlignmentMatrixResult | null = null;
  private currentThreshold = 0.6;
  private callbacks: HeatmapCallbacks = {};

  // 坐标布局度量
  private labelLeftWidth = 84;
  private labelTopHeight = 38;
  private cellSize = 42;
  private hoveredCell: { i: number; j: number } | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private isBound = false;

  init(sheetEl: HTMLElement, callbacks: HeatmapCallbacks = {}) {
    this.sheetEl = sheetEl;
    this.callbacks = callbacks;

    this.canvas = sheetEl.querySelector('#heatmap-canvas');
    this.tooltipEl = sheetEl.querySelector('#heatmap-cell-tooltip');
    this.sliderEl = sheetEl.querySelector('#heatmap-threshold-slider');
    this.badgeEl = sheetEl.querySelector('#heatmap-links-badge');
    this.thresholdValEl = sheetEl.querySelector('#heatmap-threshold-val');
    this.scrollWrapper = sheetEl.querySelector('.heatmap-matrix-scroll-wrapper');

    this.bindEvents();

    if (this.scrollWrapper) {
      this.resizeObserver = new ResizeObserver(() => {
        if (this.currentResult && !this.sheetEl?.classList.contains('is-collapsed')) {
          this.render();
        }
      });
      this.resizeObserver.observe(this.scrollWrapper);
    }
  }

  destroy() {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.sheetEl = null;
    this.canvas = null;
    this.isBound = false;
  }

  public toggleCollapse(): void {
    if (!this.sheetEl) return;
    const isCollapsed = this.sheetEl.classList.toggle('is-collapsed');
    if (!isCollapsed) {
      setTimeout(() => this.render(), 60);
    }
  }

  public setCollapsed(collapsed: boolean): void {
    if (!this.sheetEl) return;
    if (collapsed) {
      this.sheetEl.classList.add('is-collapsed');
    } else {
      this.sheetEl.classList.remove('is-collapsed');
      setTimeout(() => this.render(), 60);
    }
  }

  private bindEvents() {
    if (!this.sheetEl || this.isBound) return;
    this.isBound = true;

    // 1. 折叠展开切换
    const toggleBtn = this.sheetEl.querySelector('#heatmap-sheet-toggle');
    toggleBtn?.addEventListener('click', () => {
      this.toggleCollapse();
    });

    const closeBtn = this.sheetEl.querySelector('#heatmap-sheet-close');
    closeBtn?.addEventListener('click', () => {
      this.setCollapsed(true);
    });

    // 2. 阈值滑块事件
    this.sliderEl?.addEventListener('input', (e) => {
      const val = parseFloat((e.target as HTMLInputElement).value);
      this.currentThreshold = val;
      if (this.thresholdValEl) {
        this.thresholdValEl.textContent = val.toFixed(2);
      }
      this.callbacks.onThresholdChange?.(val);
      this.render();
    });

    // 3. Canvas 鼠标交互 (Hover & Click)
    this.canvas?.addEventListener('mousemove', (e) => this.handleCanvasHover(e));
    this.canvas?.addEventListener('mouseleave', () => {
      this.hoveredCell = null;
      this.hideTooltip();
      this.render();
    });
    this.canvas?.addEventListener('click', (e) => this.handleCanvasClick(e));
  }

  setData(result: AlignmentMatrixResult, threshold: number = 0.6) {
    this.currentResult = result;
    this.currentThreshold = threshold;
    if (this.sliderEl) this.sliderEl.value = threshold.toString();
    if (this.thresholdValEl) this.thresholdValEl.textContent = threshold.toFixed(2);
    this.render();
  }

  /**
   * 经典学术 Blues 蓝阶色彩映射函数
   * 将 [0, 1] 的相似度插值映射为高保真渐变颜色
   */
  private getBluesColor(sim: number): string {
    const s = Math.max(0, Math.min(1, sim));
    // Color stops:
    // 0.0 -> rgb(238, 245, 252) #eef5fc
    // 0.45 -> rgb(189, 215, 238) #bdd7ee
    // 0.70 -> rgb(90, 156, 210)  #5a9cd2
    // 0.85 -> rgb(43, 118, 185)  #2b76b9
    // 1.00 -> rgb(12, 50, 96)    #0c3260
    let r: number, g: number, b: number;
    if (s <= 0.45) {
      const t = s / 0.45;
      r = Math.round(238 + (189 - 238) * t);
      g = Math.round(245 + (215 - 245) * t);
      b = Math.round(252 + (238 - 252) * t);
    } else if (s <= 0.70) {
      const t = (s - 0.45) / 0.25;
      r = Math.round(189 + (90 - 189) * t);
      g = Math.round(215 + (156 - 215) * t);
      b = Math.round(238 + (210 - 238) * t);
    } else if (s <= 0.85) {
      const t = (s - 0.70) / 0.15;
      r = Math.round(90 + (43 - 90) * t);
      g = Math.round(156 + (118 - 156) * t);
      b = Math.round(210 + (185 - 210) * t);
    } else {
      const t = (s - 0.85) / 0.15;
      r = Math.round(43 + (12 - 43) * t);
      g = Math.round(118 + (50 - 118) * t);
      b = Math.round(185 + (96 - 185) * t);
    }
    return `rgb(${r}, ${g}, ${b})`;
  }

  private render() {
    if (!this.canvas || !this.currentResult) return;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;

    const matrix = this.currentResult.matrix;
    const M = matrix.length; // 行数 (Source)
    const N = M > 0 ? matrix[0].length : 0; // 列数 (Target)
    if (M === 0 || N === 0) return;

    // 自适应计算网格与画布尺寸
    const wrapperWidth = this.scrollWrapper?.clientWidth || 800;
    const wrapperHeight = this.scrollWrapper?.clientHeight || 360;

    // 动态确定行标宽度：根据段落数是个位数还是多位数
    const isDense = Math.max(M, N) > 10;
    this.labelLeftWidth = isDense ? 54 : 86;
    this.labelTopHeight = isDense ? 28 : 36;

    const availW = Math.max(200, wrapperWidth - this.labelLeftWidth - 28);
    const availH = Math.max(160, wrapperHeight - this.labelTopHeight - 28);

    // 方案 2：整屏紧凑拉伸缩放，在保证最低易读性（26px）前提下尽量不滚动
    const maxDimension = Math.max(M, N);
    let targetCellSize = Math.floor(Math.min(availW / N, availH / M));
    this.cellSize = Math.max(26, Math.min(68, targetCellSize));

    const totalGridWidth = N * this.cellSize;
    const totalGridHeight = M * this.cellSize;
    const totalWidth = this.labelLeftWidth + totalGridWidth + 16;
    const totalHeight = this.labelTopHeight + totalGridHeight + 16;

    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = totalWidth * dpr;
    this.canvas.height = totalHeight * dpr;
    this.canvas.style.width = `${totalWidth}px`;
    this.canvas.style.height = `${totalHeight}px`;

    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, totalWidth, totalHeight);

    const isDarkTheme = document.documentElement.getAttribute('data-theme') === 'dark' ||
                        document.documentElement.classList.contains('dark');
    const axisTextColor = isDarkTheme ? '#94a3b8' : '#334155';
    const tickColor = isDarkTheme ? '#64748b' : '#94a3b8';
    const cellGapColor = isDarkTheme ? '#0f172a' : '#ffffff';

    // 1. 绘制顶部 X 轴标签与刻度线 (Columns: Target)
    ctx.font = `${isDense ? 10 : 12}px "Plus Jakarta Sans", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = axisTextColor;

    for (let j = 0; j < N; j++) {
      const colCenterX = this.labelLeftWidth + j * this.cellSize + this.cellSize / 2;
      const labelText = isDense ? `S${j + 1}` : `Sentence ${j + 1}`;

      // 文本标签
      ctx.fillText(labelText, colCenterX, this.labelTopHeight - 6);

      // 刻度线 (Tick mark)
      ctx.beginPath();
      ctx.strokeStyle = tickColor;
      ctx.lineWidth = 1;
      ctx.moveTo(colCenterX, this.labelTopHeight - 5);
      ctx.lineTo(colCenterX, this.labelTopHeight);
      ctx.stroke();
    }

    // 2. 绘制左侧 Y 轴标签与刻度线 (Rows: Source)
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    for (let i = 0; i < M; i++) {
      const rowCenterY = this.labelTopHeight + i * this.cellSize + this.cellSize / 2;
      const labelText = isDense ? `S${i + 1}` : `Sentence ${i + 1}`;

      // 文本标签
      ctx.fillText(labelText, this.labelLeftWidth - 8, rowCenterY);

      // 刻度线 (Tick mark)
      ctx.beginPath();
      ctx.strokeStyle = tickColor;
      ctx.lineWidth = 1;
      ctx.moveTo(this.labelLeftWidth - 5, rowCenterY);
      ctx.lineTo(this.labelLeftWidth, rowCenterY);
      ctx.stroke();
    }

    // 3. 绘制热力图矩阵单元格
    let activePairs = 0;
    const gap = this.cellSize >= 36 ? 2.5 : 1.5;
    const numFontSize = Math.max(8.5, Math.min(13, Math.floor(this.cellSize * 0.28)));

    for (let i = 0; i < M; i++) {
      for (let j = 0; j < N; j++) {
        const sim = matrix[i][j];
        const cellX = this.labelLeftWidth + j * this.cellSize;
        const cellY = this.labelTopHeight + i * this.cellSize;

        if (sim >= this.currentThreshold) {
          activePairs++;
        }

        // 绘制单元格背景
        ctx.fillStyle = this.getBluesColor(sim);
        ctx.fillRect(
          cellX + gap / 2,
          cellY + gap / 2,
          this.cellSize - gap,
          this.cellSize - gap
        );

        // 单元格数值直显（符合附图规范）
        ctx.font = `600 ${numFontSize}px "Plus Jakarta Sans", system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        // 深色背景使用纯白文字，浅色背景使用深蓝文字
        ctx.fillStyle = sim >= 0.70 ? '#ffffff' : '#0f2847';
        ctx.fillText(
          sim.toFixed(2),
          cellX + this.cellSize / 2,
          cellY + this.cellSize / 2
        );

        // 若当前处于 Hover 状态，绘制聚焦金光/紫光高亮外边框
        if (this.hoveredCell && this.hoveredCell.i === i && this.hoveredCell.j === j) {
          ctx.strokeStyle = '#6366f1';
          ctx.lineWidth = 2.5;
          ctx.strokeRect(
            cellX + gap / 2,
            cellY + gap / 2,
            this.cellSize - gap,
            this.cellSize - gap
          );
        }
      }
    }

    if (this.badgeEl) {
      this.badgeEl.textContent = `${activePairs} 对有效关联`;
    }
  }

  private getCellFromEvent(e: MouseEvent): { i: number; j: number } | null {
    if (!this.canvas || !this.currentResult) return null;
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left - this.labelLeftWidth;
    const y = e.clientY - rect.top - this.labelTopHeight;

    if (x < 0 || y < 0) return null;

    const j = Math.floor(x / this.cellSize);
    const i = Math.floor(y / this.cellSize);

    const M = this.currentResult.matrix.length;
    const N = M > 0 ? this.currentResult.matrix[0].length : 0;

    if (i >= 0 && i < M && j >= 0 && j < N) {
      return { i, j };
    }
    return null;
  }

  private handleCanvasHover(e: MouseEvent) {
    const cell = this.getCellFromEvent(e);
    if (!cell || !this.currentResult || !this.tooltipEl) {
      if (this.hoveredCell !== null) {
        this.hoveredCell = null;
        this.render();
      }
      this.hideTooltip();
      return;
    }

    if (!this.hoveredCell || this.hoveredCell.i !== cell.i || this.hoveredCell.j !== cell.j) {
      this.hoveredCell = cell;
      this.render();
    }

    const { i, j } = cell;
    const sim = this.currentResult.matrix[i][j];
    const src = this.currentResult.sourceParagraphs[i];
    const tgt = this.currentResult.targetParagraphs[j];

    const srcTitle = src?.text.slice(0, 24).replace(/\n/g, ' ') || `Sentence ${i + 1}`;
    const tgtTitle = tgt?.text.slice(0, 24).replace(/\n/g, ' ') || `Sentence ${j + 1}`;

    this.tooltipEl.innerHTML = `
      <div style="font-weight: 600; margin-bottom: 2px;">
        Sentence ${i + 1} ↔ Sentence ${j + 1}
        <span style="color: #818cf8; margin-left: 6px;">${(sim * 100).toFixed(1)}%</span>
      </div>
      <div style="font-size: 0.72rem; color: #cbd5e1; max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
        源: ${srcTitle}
      </div>
      <div style="font-size: 0.72rem; color: #cbd5e1; max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
        译: ${tgtTitle}
      </div>
    `;
    this.tooltipEl.style.opacity = '1';
    this.tooltipEl.style.left = `${e.clientX + 14}px`;
    this.tooltipEl.style.top = `${e.clientY - 38}px`;
  }

  private hideTooltip() {
    if (this.tooltipEl) {
      this.tooltipEl.style.opacity = '0';
    }
  }

  private handleCanvasClick(e: MouseEvent) {
    const cell = this.getCellFromEvent(e);
    if (!cell || !this.currentResult) return;

    const { i, j } = cell;
    const sim = this.currentResult.matrix[i][j];
    const srcId = this.currentResult.sourceParagraphs[i]?.id ?? `src-p-${i}`;
    const tgtId = this.currentResult.targetParagraphs[j]?.id ?? `tgt-p-${j}`;

    this.callbacks.onCellClick?.(srcId, tgtId, sim);
  }
}
