/**
 * src/features/reader-layout/viewport-controller.ts
 * ============================================================================
 * 通用阅读视口控制器 (Universal Three-Mode Viewport Controller)
 * ============================================================================
 * 统一抽象连续滚动 / 单页翻阅 / 双栏对页三种布局，面向所有阅读辅助子系统
 * （大纲、批注、双语对照、交叉引用、脚注浮窗、插画灯箱）暴露统一契约。
 * ============================================================================
 */

import type {
  BookFootnoteEntry,
  BookSourceFormat,
  BookStyleMode,
  ReadingLayoutMode,
  ReadingProfile,
} from '../../types/content-package.ts';
import {
  calculatePageIndexForOffset,
  clampPageIndex,
  computeColumnMetrics,
  loadBookReadingPrefs,
  saveBookReadingPrefs,
  type BookReadingPrefs,
  type ColumnLayoutMetrics,
} from './prefs.ts';

export interface ReaderViewportState extends BookReadingPrefs {
  bookKey: string;
  sourceFormat: BookSourceFormat;
  effectiveColumns: 1 | 2;
  degradedFromDual: boolean;
  currentPage: number;
  totalPages: number;
}

export interface ScrollToElementOptions {
  behavior?: 'auto' | 'smooth';
  block?: 'start' | 'center' | 'nearest';
  flash?: boolean;
}

type ViewportListener = (state: ReaderViewportState) => void;

export class ReaderViewportController {
  private static instance: ReaderViewportController | null = null;

  private bookKey = '';
  private sourceFormat: BookSourceFormat = 'abp';
  private prefs: BookReadingPrefs = {
    layoutMode: 'scroll',
    readingProfile: 'academic',
    styleMode: 'harmonized',
    useBookFonts: true,
  };
  private currentPage = 0;
  private totalPages = 1;
  private metrics: ColumnLayoutMetrics = computeColumnMetrics('scroll', 800);
  private listeners = new Set<ViewportListener>();
  private resizeObserver: ResizeObserver | null = null;
  private activeHostEl: HTMLElement | null = null;
  private activeFlowEl: HTMLElement | null = null;
  private wheelCooldown = 0;
  private initialized = false;
  private footnoteMap: Record<string, BookFootnoteEntry> = {};

  public static getInstance(): ReaderViewportController {
    if (!this.instance) {
      this.instance = new ReaderViewportController();
    }
    return this.instance;
  }

  public getState(): ReaderViewportState {
    return {
      ...this.prefs,
      bookKey: this.bookKey,
      sourceFormat: this.sourceFormat,
      effectiveColumns: this.metrics.effectiveColumns,
      degradedFromDual: this.metrics.degradedFromDual,
      currentPage: this.currentPage,
      totalPages: this.totalPages,
    };
  }

  public subscribe(listener: ViewportListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    const snap = this.getState();
    this.listeners.forEach((fn) => {
      try {
        fn(snap);
      } catch {}
    });
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('astrolib:viewport-change', { detail: snap }));
    }
  }

  public mount(params?: {
    bookKey?: string;
    sourceFormat?: BookSourceFormat;
    defaultProfile?: ReadingProfile;
    footnotes?: Record<string, BookFootnoteEntry>;
  }): void {
    if (typeof document === 'undefined') return;

    const contentEl = document.querySelector<HTMLElement>('.astrolib-chapter-content');
    const colSlug = contentEl?.dataset.colSlug || (window as any).__currentColSlug || '';
    const bookSlug = contentEl?.dataset.bookSlug || (window as any).__currentBookSlug || '';
    this.bookKey = params?.bookKey || (colSlug && bookSlug ? `${colSlug}-${bookSlug}` : '');
    this.sourceFormat =
      params?.sourceFormat ||
      ((document.documentElement.dataset.sourceFormat as BookSourceFormat) || 'abp');
    const defaultProfile =
      params?.defaultProfile ||
      ((document.documentElement.dataset.readingProfile as ReadingProfile) ||
        (this.sourceFormat === 'epub' ? 'literary' : 'academic'));

    this.prefs = loadBookReadingPrefs(this.bookKey, {
      sourceFormat: this.sourceFormat,
      readingProfile: defaultProfile,
    });

    if (params?.footnotes) {
      this.footnoteMap = params.footnotes;
    } else {
      this.loadFootnotesFromDom();
    }

    this.bindGlobalListenersOnce();
    this.applyAttributesToDom();
    if (this.prefs.layoutMode !== 'scroll') {
      window.scrollTo(0, 0);
    }
    this.setupViewportContainers();
    this.recalculate(true);
  }

  private loadFootnotesFromDom(): void {
    const scriptEl = document.getElementById('__book_footnotes__');
    if (scriptEl?.textContent) {
      try {
        this.footnoteMap = JSON.parse(scriptEl.textContent) || {};
        return;
      } catch {}
    }
    this.footnoteMap = {};
  }

  public setLayoutMode(mode: ReadingLayoutMode): void {
    if (this.prefs.layoutMode === mode) return;
    const anchorEl = this.findTopVisibleAnchorElement();
    this.prefs = saveBookReadingPrefs(
      this.bookKey,
      { layoutMode: mode },
      { sourceFormat: this.sourceFormat, readingProfile: this.prefs.readingProfile }
    );
    this.applyAttributesToDom();
    if (mode !== 'scroll') {
      window.scrollTo(0, 0);
    }
    this.setupViewportContainers();
    this.recalculate(false);
    if (anchorEl) {
      requestAnimationFrame(() => this.scrollToElement(anchorEl, { behavior: 'auto', block: 'start' }));
    } else {
      this.goToPage(0);
    }
    this.emit();
  }

  public setReadingProfile(profile: ReadingProfile): void {
    if (this.prefs.readingProfile === profile) return;
    this.prefs = saveBookReadingPrefs(
      this.bookKey,
      { readingProfile: profile },
      { sourceFormat: this.sourceFormat, readingProfile: profile }
    );
    this.applyAttributesToDom();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('astrolib:reading-profile-change', {
          detail: { readingProfile: profile, sourceFormat: this.sourceFormat },
        })
      );
    }
    this.recalculate(false);
    this.emit();
  }

  public setStyleMode(styleMode: BookStyleMode): void {
    if (this.prefs.styleMode === styleMode) return;
    this.prefs = saveBookReadingPrefs(
      this.bookKey,
      { styleMode },
      { sourceFormat: this.sourceFormat, readingProfile: this.prefs.readingProfile }
    );
    this.applyAttributesToDom();
    this.recalculate(false);
    this.emit();
  }

  public setUseBookFonts(enabled: boolean): void {
    if (this.prefs.useBookFonts === enabled) return;
    this.prefs = saveBookReadingPrefs(
      this.bookKey,
      { useBookFonts: enabled },
      { sourceFormat: this.sourceFormat, readingProfile: this.prefs.readingProfile }
    );
    this.applyAttributesToDom();
    if (typeof document !== 'undefined' && (document as any).fonts?.ready) {
      (document as any).fonts.ready.then(() => this.recalculate(false)).catch(() => {});
    }
    this.emit();
  }

  private applyAttributesToDom(): void {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.dataset.readingLayout = this.prefs.layoutMode;
    root.dataset.readingProfile = this.prefs.readingProfile;
    root.dataset.styleMode = this.prefs.styleMode;
    root.dataset.useBookFonts = this.prefs.useBookFonts ? 'true' : 'false';
  }

  private setupViewportContainers(): void {
    const hostEl =
      document.querySelector<HTMLElement>('.sl-markdown-content') ||
      document.querySelector<HTMLElement>('main article');
    const flowEl = document.querySelector<HTMLElement>('.astrolib-chapter-content');

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }

    this.activeHostEl = hostEl;
    this.activeFlowEl = flowEl;

    if (!hostEl || !flowEl) return;

    const isPaged = this.prefs.layoutMode !== 'scroll';
    hostEl.classList.toggle('astrolib-paged-host', isPaged);
    flowEl.classList.toggle('astrolib-paged-flow', isPaged);

    if (!isPaged) {
      hostEl.style.removeProperty('width');
      hostEl.style.removeProperty('margin-inline');
      flowEl.style.removeProperty('width');
      flowEl.style.removeProperty('height');
      flowEl.style.removeProperty('column-width');
      flowEl.style.removeProperty('column-gap');
      flowEl.style.removeProperty('transform');
      return;
    }

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        this.recalculate(false);
      });
      const containerTarget = hostEl.parentElement || hostEl;
      this.resizeObserver.observe(containerTarget);
    }
  }

  public recalculate(resetToStart = false): void {
    if (typeof document === 'undefined') return;
    const hostEl = this.activeHostEl;
    const flowEl = this.activeFlowEl;

    if (this.prefs.layoutMode === 'scroll' || !hostEl || !flowEl) {
      this.metrics = computeColumnMetrics('scroll', hostEl?.clientWidth || 800);
      this.currentPage = 0;
      this.totalPages = 1;
      document.documentElement.dataset.effectiveColumns = '1';
      this.emit();
      return;
    }

    const parentContainer = hostEl.parentElement || hostEl;
    const containerStyle = getComputedStyle(parentContainer);
    const padX =
      (parseFloat(containerStyle.paddingLeft) || 0) +
      (parseFloat(containerStyle.paddingRight) || 0);
    const rawAvailWidth = Math.max(280, parentContainer.clientWidth - padX);

    this.metrics = computeColumnMetrics(this.prefs.layoutMode, rawAvailWidth);
    document.documentElement.dataset.effectiveColumns = String(this.metrics.effectiveColumns);

    const navH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sl-nav-height')) || 40;
    const hostRect = hostEl.getBoundingClientRect();
    const hostTop = Math.max(navH + 8, Math.round(hostRect.top));
    const pageHeight = Math.max(280, Math.floor(window.innerHeight - hostTop - 56));

    hostEl.style.width = `${this.metrics.pageWidth}px`;
    hostEl.style.marginInline = 'auto';
    flowEl.style.setProperty('--astrolib-col-width', `${this.metrics.columnWidth}px`);
    flowEl.style.setProperty('--astrolib-col-gap', `${this.metrics.columnGap}px`);
    flowEl.style.setProperty('--astrolib-page-height', `${pageHeight}px`);
    flowEl.style.width = `${this.metrics.pageWidth}px`;
    flowEl.style.height = `${pageHeight}px`;
    flowEl.style.columnWidth = `${this.metrics.columnWidth}px`;
    flowEl.style.columnGap = `${this.metrics.columnGap}px`;

    // 临时归零 transform 计算精确总栏数，避免局部视觉滞后
    const prevTransform = flowEl.style.transform;
    flowEl.style.transform = 'translateX(0px)';
    const totalScrollWidth = flowEl.scrollWidth;
    const colStride = this.metrics.columnWidth + this.metrics.columnGap;
    const totalColumns = Math.max(1, Math.round((totalScrollWidth + this.metrics.columnGap) / colStride));
    this.totalPages = Math.max(1, Math.ceil(totalColumns / this.metrics.effectiveColumns));

    if (resetToStart) {
      this.currentPage = 0;
    } else {
      this.currentPage = clampPageIndex(this.currentPage, this.totalPages);
    }

    const offsetX = this.currentPage * this.metrics.pageStride;
    flowEl.style.transform = `translateX(-${offsetX}px)`;
    if (!flowEl.style.transform && prevTransform) {
      flowEl.style.transform = prevTransform;
    }
    this.emit();
  }

  public goToPage(pageIndex: number): void {
    if (this.prefs.layoutMode === 'scroll' || !this.activeFlowEl) return;
    const next = clampPageIndex(pageIndex, this.totalPages);
    this.currentPage = next;
    const offsetX = next * this.metrics.pageStride;
    this.activeFlowEl.style.transform = `translateX(-${offsetX}px)`;
    this.emit();
  }

  public nextPage(): boolean {
    if (this.prefs.layoutMode === 'scroll') return false;
    if (this.currentPage < this.totalPages - 1) {
      this.goToPage(this.currentPage + 1);
      return true;
    }
    return false;
  }

  public prevPage(): boolean {
    if (this.prefs.layoutMode === 'scroll') return false;
    if (this.currentPage > 0) {
      this.goToPage(this.currentPage - 1);
      return true;
    }
    return false;
  }

  public scrollToElement(el: HTMLElement | null, options: ScrollToElementOptions = {}): void {
    if (!el) return;
    const { behavior = 'smooth', block = 'center', flash = false } = options;

    if (this.prefs.layoutMode === 'scroll' || !this.activeFlowEl) {
      el.scrollIntoView({ behavior, block });
    } else {
      const flowRect = this.activeFlowEl.getBoundingClientRect();
      const targetRect = el.getBoundingClientRect();
      const absoluteLeft = Math.max(0, targetRect.left - flowRect.left);
      const pageIdx = calculatePageIndexForOffset(
        absoluteLeft,
        this.metrics,
        this.totalPages
      );
      this.goToPage(pageIdx);
    }

    if (flash) {
      el.classList.add('card-ref-flash');
      setTimeout(() => el.classList.remove('card-ref-flash'), 1600);
    }
  }

  private findTopVisibleAnchorElement(): HTMLElement | null {
    const flowEl = this.activeFlowEl;
    if (!flowEl) return null;
    const candidates = Array.from(flowEl.querySelectorAll<HTMLElement>('h1, h2, h3, h4, p, .academic-card'));
    if (this.prefs.layoutMode === 'scroll') {
      const topLimit = 72;
      for (const el of candidates) {
        const rect = el.getBoundingClientRect();
        if (rect.bottom >= topLimit && rect.height > 0) return el;
      }
      return candidates[0] || null;
    }

    const hostRect = (this.activeHostEl || flowEl).getBoundingClientRect();
    for (const el of candidates) {
      const rect = el.getBoundingClientRect();
      if (rect.right > hostRect.left && rect.left < hostRect.right) {
        return el;
      }
    }
    return candidates[0] || null;
  }

  private bindGlobalListenersOnce(): void {
    if (this.initialized || typeof window === 'undefined') return;
    this.initialized = true;

    window.addEventListener('keydown', (e: KeyboardEvent) => {
      if (this.prefs.layoutMode === 'scroll') return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'MD-OUTLINED-TEXT-FIELD' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (document.querySelector('.astrolib-lightbox.is-open, #astrolib-layout-popover.is-open')) {
        return;
      }

      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        this.nextPage();
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        this.prevPage();
      } else if (e.key === ' ') {
        e.preventDefault();
        if (e.shiftKey) this.prevPage();
        else this.nextPage();
      }
    });

    window.addEventListener(
      'wheel',
      (e: WheelEvent) => {
        if (this.prefs.layoutMode === 'scroll') return;
        const t = e.target as HTMLElement | null;
        if (
          t?.closest(
            '.katex-display, pre, .astrolib-sideload-dock, #starlight__sidebar, .astrolib-footnote-popover, #astrolib-layout-popover'
          )
        ) {
          return;
        }
        const now = Date.now();
        if (now - this.wheelCooldown < 240) return;
        const delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
        if (Math.abs(delta) < 18) return;
        e.preventDefault();
        this.wheelCooldown = now;
        if (delta > 0) this.nextPage();
        else this.prevPage();
      },
      { passive: false }
    );

    window.addEventListener('astrolib:sideload-change', () => {
      setTimeout(() => this.recalculate(false), 260);
    });
  }

  public getFootnote(noteId: string): BookFootnoteEntry | null {
    return this.footnoteMap[noteId] || null;
  }
}

export const readerViewportController = ReaderViewportController.getInstance();
