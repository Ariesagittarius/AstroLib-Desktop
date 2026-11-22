import { BilingualReaderController } from './bilingual-reader-controller.ts';
import {
  sidebarLayoutContract as sidebarLayoutController,
  sideloadManagerContract as sideloadManager,
} from '../../features/sideload/contract.ts';

export interface TargetVersionOption {
  id: string;
  label: string;
  url: string;
}

export interface InPageCompareOptions {
  bookSlug: string;
  sourceId: string;
  sourceLabel: string;
  target: TargetVersionOption;
  availableTargets: TargetVersionOption[];
}

export class InPageCompareController {
  private static instance: InPageCompareController | null = null;

  private isActive = false;
  private currentOptions: InPageCompareOptions | null = null;
  private splitRoot: HTMLElement | null = null;
  private originalArticle: HTMLElement | null = null;
  private originalPlaceholder: Comment | null = null;
  private savedScrollY: number = 0;
  private savedLeftSidebarCollapsed: boolean = false;
  private savedRightSidebarPanel: string = 'toc';

  private bilingualController: BilingualReaderController | null = null;
  private cachedTargetHtml = new Map<string, string>();

  public static getInstance(): InPageCompareController {
    if (!this.instance) {
      this.instance = new InPageCompareController();
    }
    return this.instance;
  }

  constructor() {
    this.bindGlobalEvents();
  }

  private bindGlobalEvents() {
    if (typeof window === 'undefined') return;

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isActive) {

        const heatmapSheet = document.getElementById('bilingual-heatmap-sheet');
        if (heatmapSheet && !heatmapSheet.classList.contains('is-collapsed')) {
          heatmapSheet.classList.add('is-collapsed');
          return;
        }
        e.preventDefault();
        this.close();
      }
    });
  }

  public getIsActive(): boolean {
    return this.isActive;
  }

  public getCurrentTarget(): TargetVersionOption | null {
    return this.currentOptions?.target || null;
  }

  public async open(options: InPageCompareOptions): Promise<void> {
    if (this.isActive && this.currentOptions?.target.id === options.target.id) {
      return;
    }

    if (this.isActive) {

      await this.switchTarget(options.target);
      this.currentOptions = options;
      return;
    }

    this.currentOptions = options;
    this.savedScrollY = window.scrollY;

    const mainEl = document.querySelector('main');
    const article = mainEl?.querySelector('article.sl-markdown-content') || document.querySelector('article.sl-markdown-content');
    if (!article || !article.parentElement) {
      console.warn('[InPageCompare] 未能定位到当前正文 article.sl-markdown-content 容器');
      return;
    }

    this.originalArticle = article as HTMLElement;

    this.originalPlaceholder = document.createComment('astrolib-in-page-bilingual-marker');
    article.parentElement.insertBefore(this.originalPlaceholder, article);

    try {
      this.savedLeftSidebarCollapsed = sidebarLayoutController.isCollapsed();
      this.savedRightSidebarPanel = sideloadManager.getActivePanelId();
      sidebarLayoutController.setCollapsed(true);
      sideloadManager.open('none');
    } catch {}

    document.documentElement.classList.add('bilingual-in-page-active');
    document.body.classList.add('bilingual-in-page-active');

    this.splitRoot = document.createElement('div');
    this.splitRoot.id = 'in-page-bilingual-root';
    this.splitRoot.className = 'in-page-bilingual-root';

    const toolbar = document.createElement('header');
    toolbar.className = 'in-page-bilingual-toolbar';
    toolbar.innerHTML = `
      <div class="toolbar-left-group">
        <div class="toolbar-lang-chip is-source" title="当前主读版本">
          <span class="toolbar-chip-dot"></span>
          <span>${options.sourceLabel}</span>
        </div>

        <span class="toolbar-divider-arrow">↔</span>

        <div class="toolbar-target-dropdown-wrap">
          <button type="button" class="toolbar-target-chip" id="in-page-target-switcher" title="点击切换对比版本">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path fill="currentColor" d="M12.87 15.07l-2.54-2.51.03-.08c1.74-1.94 2.98-4.17 3.71-6.49H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/>
            </svg>
            <span id="in-page-target-label">${options.target.label}</span>
            <svg class="chevron-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path fill="currentColor" d="M7 10l5 5 5-5z"/>
            </svg>
          </button>

          <!-- 仅在点击 target-switcher 时呼出的浮动气泡菜单 (默认彻底隐藏) -->
          <div id="in-page-switch-popover" class="m3e-version-popover is-hidden" style="display: none;" role="menu">
            <div class="popover-header">
              <span class="popover-title">切换对比语言版本</span>
            </div>
            <div class="popover-list">
              ${options.availableTargets
                .map(
                  (t) => `
                <button type="button" class="m3e-popover-item ${t.id === options.target.id ? 'is-selected' : ''}" data-switch-id="${t.id}" data-switch-label="${t.label}" data-switch-url="${t.url}">
                  <span class="item-label">${t.label}</span>
                  ${t.id === options.target.id ? '<span class="item-check">✓</span>' : ''}
                </button>
              `
                )
                .join('')}
            </div>
          </div>
        </div>
      </div>

      <div class="toolbar-right-group">
        <span class="toolbar-stat-pill" id="in-page-align-stat">计算对齐中...</span>
        <button type="button" class="m3-action-btn m3-tonal-btn" id="in-page-toggle-heatmap" title="展开/收起全局学术相关矩阵">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
            <path d="M3 3v18h18V3H3zm16 16H5V5h14v14zM11 7h2v2h-2V7zm0 4h2v2h-2v-2zm0 4h2v2h-2v-2zm-4-8h2v2H7V7zm0 4h2v2H7v-2zm0 4h2v2H7v-2zm8-8h2v2h-2V7zm0 4h2v2h-2v-2zm0 4h2v2h-2v-2z"/>
          </svg>
          <span>热力图</span>
        </button>
        <button type="button" class="m3-action-btn m3-outlined-btn" id="in-page-realign-btn" title="重新计算双语对齐">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
            <path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6c0 1.01-.25 1.97-.7 2.8l1.46 1.46A7.93 7.93 0 0 0 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6c0-1.01.25-1.97.7-2.8L5.24 7.74A7.93 7.93 0 0 0 4 12c0 4.42 3.58 8 8 8v3l4-4l-4-4v3z"/>
          </svg>
          <span>刷新</span>
        </button>
        <button type="button" class="m3-action-btn m3-filled-btn" id="in-page-exit-btn" title="退出对比并恢复大纲 (Esc)">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
          </svg>
          <span>退出对比</span>
          <kbd class="m3-kbd-badge">Esc</kbd>
        </button>
      </div>
    `;

    const grid = document.createElement('div');
    grid.className = 'in-page-bilingual-grid';

    const leftPane = document.createElement('div');
    leftPane.className = 'bilingual-col-source bilingual-column-pane';
    leftPane.setAttribute('data-col', 'source');

    const gutter = document.createElement('div');
    gutter.className = 'bilingual-gutter';

    const rightPane = document.createElement('div');
    rightPane.className = 'bilingual-col-target bilingual-column-pane';
    rightPane.setAttribute('data-col', 'target');
    rightPane.innerHTML = `
      <div class="in-page-bilingual-loading">
        <div class="bilingual-shimmer-spinner"></div>
        <span>正在载入《${options.target.label}》对应学术排版章节...</span>
      </div>
    `;

    const svgCanvas = document.createElementNS ? document.createElementNS('http://www.w3.org/2000/svg', 'svg') : document.createElement('svg');
    svgCanvas.setAttribute('class', 'bilingual-svg-canvas');

    grid.appendChild(leftPane);
    grid.appendChild(gutter);
    grid.appendChild(rightPane);
    grid.appendChild(svgCanvas as any);

    this.splitRoot.appendChild(toolbar);
    this.splitRoot.appendChild(grid);

    leftPane.appendChild(this.originalArticle);

    this.originalPlaceholder.parentElement?.insertBefore(this.splitRoot, this.originalPlaceholder);

    this.isActive = true;

    this.bindToolbarEvents(toolbar, grid);

    await this.loadTargetContent(options.target, grid);
  }

  private async loadTargetContent(target: TargetVersionOption, grid: HTMLElement): Promise<void> {
    const rightPane = grid.querySelector('.bilingual-col-target') as HTMLElement;
    if (!rightPane) return;

    try {
      let html = this.cachedTargetHtml.get(target.url);
      if (!html) {
        const resp = await fetch(target.url);
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status} - 章节未找到`);
        }
        html = await resp.text();
        this.cachedTargetHtml.set(target.url, html);
      }

      const doc = new DOMParser().parseFromString(html, 'text/html');
      const targetArticle = doc.querySelector('article.sl-markdown-content') || doc.querySelector('.sl-markdown-content');

      if (!targetArticle) {
        throw new Error('未能在目标页面解析到学术正文');
      }

      rightPane.innerHTML = '';
      rightPane.appendChild(targetArticle);

      this.bilingualController?.destroy();
      this.bilingualController = new BilingualReaderController();
      this.bilingualController.init(grid);

      setTimeout(() => {
        const statBadge = document.getElementById('in-page-align-stat');
        if (statBadge) {
          const linksBadge = document.getElementById('heatmap-links-badge');
          if (linksBadge && linksBadge.textContent) {
            statBadge.textContent = linksBadge.textContent;
          } else {
            statBadge.textContent = '语义对齐已就绪';
          }
        }
      }, 350);
    } catch (err: any) {
      console.error('[InPageCompare] 加载目标版本失败:', err);
      rightPane.innerHTML = `
        <div class="in-page-bilingual-loading" style="color: var(--sl-color-accent-high);">
          <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
          </svg>
          <span>未能载入《${target.label}》排版内容（${err?.message || '网络异常'}）</span>
        </div>
      `;
    }
  }

  private bindToolbarEvents(toolbar: HTMLElement, grid: HTMLElement) {

    const exitBtn = toolbar.querySelector('#in-page-exit-btn');
    exitBtn?.addEventListener('click', () => {
      this.close();
    });

    const realignBtn = toolbar.querySelector('#in-page-realign-btn');
    realignBtn?.addEventListener('click', () => {
      this.bilingualController?.runAlignment();
    });

    const heatmapBtn = toolbar.querySelector('#in-page-toggle-heatmap');
    heatmapBtn?.addEventListener('click', () => {
      this.bilingualController?.getHeatmapController()?.toggleCollapse();
    });

    const switcherBtn = toolbar.querySelector('#in-page-target-switcher') as HTMLElement | null;
    const popover = toolbar.querySelector('#in-page-switch-popover') as HTMLElement | null;

    switcherBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!popover) return;
      const isHidden = popover.style.display === 'none' || popover.classList.contains('is-hidden');
      if (isHidden) {
        popover.style.display = 'flex';
        popover.classList.remove('is-hidden');
      } else {
        popover.style.display = 'none';
        popover.classList.add('is-hidden');
      }
    });

    popover?.addEventListener('click', (e) => {
      const item = (e.target as HTMLElement).closest('.m3e-popover-item') as HTMLElement | null;
      if (!item) return;

      const newId = item.getAttribute('data-switch-id');
      const newLabel = item.getAttribute('data-switch-label');
      const newUrl = item.getAttribute('data-switch-url');

      if (newId && newLabel && newUrl) {
        popover.style.display = 'none';
        popover.classList.add('is-hidden');
        this.switchTarget({ id: newId, label: newLabel, url: newUrl });
      }
    });

    document.addEventListener('click', (e) => {
      if (popover && popover.style.display !== 'none' && !popover.contains(e.target as Node) && e.target !== switcherBtn) {
        popover.style.display = 'none';
        popover.classList.add('is-hidden');
      }
    });
  }

  public async switchTarget(newTarget: TargetVersionOption): Promise<void> {
    if (!this.splitRoot || !this.currentOptions) return;

    this.currentOptions.target = newTarget;

    if (this.currentOptions.bookSlug) {
      try {
        localStorage.setItem(`astrolib_bilingual_target_${this.currentOptions.bookSlug}`, newTarget.id);
      } catch {}
    }

    const targetLabelEl = this.splitRoot.querySelector('#in-page-target-label');
    if (targetLabelEl) {
      targetLabelEl.textContent = newTarget.label;
    }

    const grid = this.splitRoot.querySelector('.in-page-bilingual-grid') as HTMLElement;
    if (grid) {
      const rightPane = grid.querySelector('.bilingual-col-target') as HTMLElement;
      if (rightPane) {
        rightPane.innerHTML = `
          <div class="in-page-bilingual-loading">
            <div class="bilingual-shimmer-spinner"></div>
            <span>正在载入《${newTarget.label}》对应学术排版章节...</span>
          </div>
        `;
      }
      await this.loadTargetContent(newTarget, grid);
    }
  }

  public close(): void {
    if (!this.isActive) return;

    this.bilingualController?.destroy();
    this.bilingualController = null;

    if (this.originalArticle && this.originalPlaceholder && this.originalPlaceholder.parentElement) {
      this.originalPlaceholder.parentElement.insertBefore(this.originalArticle, this.originalPlaceholder);
      this.originalPlaceholder.remove();
    }

    if (this.splitRoot) {
      this.splitRoot.remove();
      this.splitRoot = null;
    }

    document.documentElement.classList.remove('bilingual-in-page-active');
    document.body.classList.remove('bilingual-in-page-active');

    try {
      sidebarLayoutController.setCollapsed(this.savedLeftSidebarCollapsed);
      if (this.savedRightSidebarPanel === 'none') {
        sideloadManager.open('none');
      } else if (this.savedRightSidebarPanel) {
        sideloadManager.open(this.savedRightSidebarPanel);
      } else {
        sideloadManager.switchToDefault();
      }
    } catch {}

    const heatmapSheet = document.getElementById('bilingual-heatmap-sheet');
    if (heatmapSheet) {
      heatmapSheet.classList.add('is-collapsed');
    }

    this.isActive = false;

    window.scrollTo({ top: this.savedScrollY, behavior: 'instant' });

    const chip = document.getElementById('bilingual-in-page-trigger');
    chip?.classList.remove('is-active');
  }
}

export const inPageCompareController = InPageCompareController.getInstance();
