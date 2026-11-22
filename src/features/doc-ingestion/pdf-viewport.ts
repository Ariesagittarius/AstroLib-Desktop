/**
 * src/features/doc-ingestion/pdf-viewport.ts
 * ============================================================================
 * 学术文献左栏 PDF.js 高保真渲染与 BBox 联动视窗控制器
 * ============================================================================
 */

export interface PdfBlockItem {
  id: string;
  type: string;
  pageIndex: number;
  bbox: [number, number, number, number];
  pageWidth?: number;
  pageHeight?: number;
  text?: string;
  html?: string;
  caption?: string;
  level?: number;
  pageNumber?: string;
  fnIndex?: string;
}

export interface PdfViewportCallbacks {
  onSelectBlock: (blockId: string, pageIndex: number, scrollRight: boolean) => void;
  onTranslateBlock: (block: PdfBlockItem) => void;
  onPageSyncRight: (pageIndex: number) => void;
}

const TYPE_NAME_MAP: Record<string, string> = {
  title: '标题',
  text: '文本',
  equation: '公式',
  table: '表格',
  image: '插图',
  figure: '插图',
  list: '列表',
  header: '页眉',
  footer: '页脚',
  footnote: '脚注',
  page_divider: '分页',
  page_meta: '元注',
};

export class PdfViewportController {
  private currentTaskId: string | null = null;
  private pageSizes: Array<{ width: number; height: number }> = [];
  private currentPageIndex = 0;
  private totalPageCount = 1;
  private currentScale = 1.0;
  private activeBlockId: string | null = null;
  private blocks: PdfBlockItem[] = [];
  private enableTransition = true;
  private renderTaskSeq = 0;

  private pagePrevBtn = document.getElementById('pdf-page-prev') as HTMLButtonElement | null;
  private pageNextBtn = document.getElementById('pdf-page-next') as HTMLButtonElement | null;
  private pageInput = document.getElementById('pdf-page-input') as HTMLInputElement | null;
  private pageTotalEl = document.getElementById('pdf-page-total');
  private zoomOutBtn = document.getElementById('pdf-zoom-out');
  private zoomInBtn = document.getElementById('pdf-zoom-in');
  private zoomFitBtn = document.getElementById('pdf-zoom-fit');
  private zoomValEl = document.getElementById('pdf-zoom-val');
  private scrollArea = document.getElementById('pdf-canvas-scroll-area');

  private callbacks: PdfViewportCallbacks;

  constructor(callbacks: PdfViewportCallbacks, enableTransition = true) {
    this.callbacks = callbacks;
    this.enableTransition = enableTransition;
    this.bindControls();
  }

  public setEnableTransition(enabled: boolean): void {
    this.enableTransition = enabled;
  }

  public getCurrentPageIndex(): number {
    return this.currentPageIndex;
  }

  public getTotalPages(): number {
    return this.totalPageCount;
  }

  public setBlocks(blocks: PdfBlockItem[]): void {
    this.blocks = blocks;
    this.renderBboxesForCurrentPage(this.currentPageIndex);
  }

  public setTotalPagesHint(pages: number): void {
    if (pages > 0) {
      this.totalPageCount = pages;
      if (this.pageTotalEl) this.pageTotalEl.textContent = `/ ${pages}`;
    }
  }

  private bindControls(): void {
    this.pagePrevBtn?.addEventListener('click', () => {
      if (this.currentPageIndex > 0) this.gotoPage(this.currentPageIndex - 1, true);
    });
    this.pageNextBtn?.addEventListener('click', () => {
      if (this.currentPageIndex < this.totalPageCount - 1) this.gotoPage(this.currentPageIndex + 1, true);
    });
    this.pageInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && this.pageInput) {
        const val = parseInt(this.pageInput.value, 10);
        if (!isNaN(val) && val >= 1 && val <= this.totalPageCount) {
          this.gotoPage(val - 1, true);
        } else {
          this.pageInput.value = String(this.currentPageIndex + 1);
        }
      }
    });

    this.zoomInBtn?.addEventListener('click', () => {
      this.currentScale = Math.min(2.5, this.currentScale + 0.15);
      this.updateZoomDisplay();
      void this.renderPdfPage(this.currentPageIndex);
    });
    this.zoomOutBtn?.addEventListener('click', () => {
      this.currentScale = Math.max(0.5, this.currentScale - 0.15);
      this.updateZoomDisplay();
      void this.renderPdfPage(this.currentPageIndex);
    });
    this.zoomFitBtn?.addEventListener('click', () => {
      this.currentScale = 1.0;
      this.updateZoomDisplay();
      void this.renderPdfPage(this.currentPageIndex);
    });
  }

  private updateZoomDisplay(): void {
    if (this.zoomValEl) {
      this.zoomValEl.textContent = `${Math.round(this.currentScale * 100)}%`;
    }
  }

  private syncPageControls(): void {
    if (this.pageInput) this.pageInput.value = String(this.currentPageIndex + 1);
    if (this.pagePrevBtn) this.pagePrevBtn.disabled = this.currentPageIndex === 0;
    if (this.pageNextBtn) this.pageNextBtn.disabled = this.currentPageIndex >= this.totalPageCount - 1;
  }

  public async loadPdf(taskId: string): Promise<void> {
    if (!this.scrollArea) return;
    try {
      this.currentTaskId = taskId;
      const res = await fetch(`/api/ingest/pdf/meta?taskId=${encodeURIComponent(taskId)}`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const meta = await res.json();
      const count = Number(meta?.pageCount || 1);
      this.totalPageCount = Math.max(1, count);
      this.pageSizes = Array.isArray(meta?.pages) ? meta.pages : [];
      if (this.pageTotalEl) this.pageTotalEl.textContent = `/ ${this.totalPageCount}`;
      await this.renderPdfPage(this.currentPageIndex);
    } catch (err) {
      console.error('[PdfViewport] PDF 加载失败:', err);
    }
  }

  public gotoPage(pageIdx: number, syncScrollRight = true): void {
    if (pageIdx < 0 || pageIdx >= this.totalPageCount) return;
    void this.renderPdfPage(pageIdx);
    if (syncScrollRight) {
      this.callbacks.onPageSyncRight(pageIdx);
    }
  }

  public syncPageFromRightScroll(pageIdx: number): void {
    if (pageIdx === this.currentPageIndex || pageIdx < 0 || pageIdx >= this.totalPageCount) return;
    this.currentPageIndex = pageIdx;
    this.syncPageControls();
    void this.renderPdfPage(pageIdx);
  }

  public async renderPdfPage(pageIdx: number): Promise<void> {
    if (!this.currentTaskId || !this.scrollArea) return;
    if (pageIdx < 0 || pageIdx >= this.totalPageCount) return;

    this.currentPageIndex = pageIdx;
    this.syncPageControls();

    const currentSeq = ++this.renderTaskSeq;

    try {
      const dim = this.pageSizes[pageIdx] || { width: 595, height: 842 };
      const containerWidth = Math.max(320, (this.scrollArea.clientWidth || 600) - 48);
      const baseScale = containerWidth / dim.width;
      const displayScale = baseScale * this.currentScale;
      const targetWidth = Math.round(dim.width * displayScale);
      const targetHeight = Math.round(dim.height * displayScale);

      const pageContainer = document.createElement('div');
      pageContainer.className = `pdf-page-container ${this.enableTransition ? 'fade-transition' : ''}`;
      pageContainer.id = `pdf-page-${pageIdx}`;
      pageContainer.style.width = `${targetWidth}px`;
      pageContainer.style.height = `${targetHeight}px`;

      const dpr = Math.min(2.5, window.devicePixelRatio || 1);
      const renderScale = Math.max(0.5, Math.min(3.0, Number((displayScale * dpr).toFixed(2))));

      const img = document.createElement('img');
      img.className = 'pdf-page-canvas';
      img.alt = `PDF Page ${pageIdx + 1}`;
      img.style.width = '100%';
      img.style.height = '100%';
      img.style.display = 'block';
      img.src = `/api/ingest/pdf/page?taskId=${encodeURIComponent(this.currentTaskId)}&page=${pageIdx}&scale=${renderScale}`;

      await new Promise<void>((resolve) => {
        if (img.complete) return resolve();
        img.addEventListener('load', () => resolve(), { once: true });
        img.addEventListener('error', () => resolve(), { once: true });
      });

      if (currentSeq !== this.renderTaskSeq) return;

      const overlayLayer = document.createElement('div');
      overlayLayer.className = 'pdf-overlay-layer';
      overlayLayer.id = `pdf-overlay-${pageIdx}`;

      pageContainer.appendChild(img);
      pageContainer.appendChild(overlayLayer);
      this.scrollArea.replaceChildren(pageContainer);

      if (this.blocks.length > 0) {
        this.renderBboxesForCurrentPage(pageIdx);
      }
    } catch (e: any) {
      console.error(`[PdfViewport] 渲染第 ${pageIdx + 1} 页出错:`, e);
    }
  }

  public highlightBlockBbox(blockId: string, pageIdx: number): void {
    this.activeBlockId = blockId;
    document.querySelectorAll('.bbox-floating-toolbar').forEach((el) => el.remove());
    document.querySelectorAll('.bbox-highlight').forEach((r) => r.classList.remove('active'));

    if (this.currentPageIndex !== pageIdx) {
      this.gotoPage(pageIdx, false);
    }

    const targetRect = document.getElementById(`bbox_${blockId}`);
    if (!targetRect) return;
    targetRect.classList.add('active');

    const block = this.blocks.find((b) => b.id === blockId);
    const floatBar = document.createElement('div');
    floatBar.className = 'bbox-floating-toolbar';
    floatBar.innerHTML = `
      <span class="floating-type-badge">${block?.type === 'title' ? '标题' : block?.type === 'equation' ? '公式' : block?.type === 'footnote' ? '脚注' : '文本'}</span>
      <button type="button" class="floating-tool-btn" id="float-btn-translate" title="双语学术研判" aria-label="双语学术研判">
        <span class="material-symbols-outlined" style="font-size: 14px;">translate</span>
      </button>
      <button type="button" class="floating-tool-btn" id="float-btn-copy" title="复制文本" aria-label="复制文本">
        <span class="material-symbols-outlined" style="font-size: 14px;">content_copy</span>
      </button>
    `;

    floatBar.querySelector('#float-btn-translate')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (block) this.callbacks.onTranslateBlock(block);
    });
    floatBar.querySelector('#float-btn-copy')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (block?.text) void navigator.clipboard.writeText(block.text);
    });

    targetRect.appendChild(floatBar);
  }

  public renderBboxesForCurrentPage(pageIdx: number): void {
    const overlay = document.getElementById(`pdf-overlay-${pageIdx}`);
    if (!overlay) return;
    overlay.innerHTML = '';

    const pageBlocks = this.blocks.filter((b) => b.pageIndex === pageIdx);

    pageBlocks.forEach((block) => {
      if (block.type === 'page_divider' || block.type === 'page_meta') return;
      const bbox = block.bbox;
      if (!bbox || bbox.length !== 4) return;

      const pw = block.pageWidth || 1000;
      const ph = block.pageHeight || 1000;
      const [x0, y0, x1, y1] = bbox;

      const rect = document.createElement('div');
      rect.className = `bbox-highlight type-${block.type || 'text'}`;
      rect.id = `bbox_${block.id}`;
      rect.style.left = `${(x0 / pw) * 100}%`;
      rect.style.top = `${(y0 / ph) * 100}%`;
      rect.style.width = `${((x1 - x0) / pw) * 100}%`;
      rect.style.height = `${((y1 - y0) / ph) * 100}%`;

      const tag = document.createElement('span');
      tag.className = 'bbox-tag';
      tag.textContent = TYPE_NAME_MAP[block.type] || block.type;
      rect.appendChild(tag);

      rect.addEventListener('mouseenter', () => {
        document.getElementById(`card_${block.id}`)?.classList.add('hover-block');
      });
      rect.addEventListener('mouseleave', () => {
        document.getElementById(`card_${block.id}`)?.classList.remove('hover-block');
      });
      rect.addEventListener('click', (e) => {
        e.stopPropagation();
        this.callbacks.onSelectBlock(block.id, block.pageIndex, true);
      });

      overlay.appendChild(rect);
    });

    if (this.activeBlockId) {
      document.getElementById(`bbox_${this.activeBlockId}`)?.classList.add('active');
    }
  }
}
