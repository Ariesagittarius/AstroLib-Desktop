/**
 * src/features/reader-host/reader-host-controller.ts
 * ============================================================================
 * 研读视窗宿主控制器 (Iframe Pool + Bottom Chrome Tabs + Multi-Pane Focus)
 * ============================================================================
 * 架构保证：
 * 1. 所有 .tab-pane-slot 与 #pane-0..3 空槽均直接作为 #reader-split-grid 直接子元素，
 *    通过 CSS 几何定位切换窗格位置，绝不 reparenting 导致 iframe 重载；
 * 2. 统一委托 ReaderWorkspaceStateMachine 处理多屏落位、焦点与关闭策略；
 * 3. 委托 SplitResizer 处理 1x2 / 2x1 / 2x2 上下独立列宽的界线拖拽。
 * ============================================================================
 */

import type { UnifiedReadingEntity } from '../../types/library-entity';
import { getBookTitle, type AstrolibNodeTarget } from '../../utils/astrolib-uri';
import {
  normalizeClosePolicy,
  ReaderWorkspaceStateMachine,
  SPLIT_CLOSE_POLICY_STORAGE_KEY,
  splitLayoutToUiMode,
  uiModeToSplitLayout,
} from './workspace-state';
import { SplitResizer } from './split-resizer';
import { readIngestSettings } from '../doc-ingestion/ingest-settings';

interface LiveTabSlot {
  slotEl: HTMLElement;
  iframe: HTMLIFrameElement;
  url: string;
  lastUsed: number;
  loaded: boolean;
}

export class ReaderChromeHostController {
  private static readonly MAX_LIVE_IFRAMES = 4;

  private machine: ReaderWorkspaceStateMachine;
  private resizer: SplitResizer | null = null;
  private liveSlots = new Map<string, LiveTabSlot>();
  private pendingLoadTimers = new Map<string, number>();
  private slotAccessClock = 0;

  private trackEl: HTMLElement | null;
  private emptyEl: HTMLElement | null;
  private splitGridEl: HTMLElement | null;
  private firstDividerEl: HTMLElement | null;
  private bottomDockEl: HTMLElement | null;
  private tabCountBadge: HTMLElement | null;

  constructor() {
    (window as any).__readerChromeHost = this;

    let initialPolicy = normalizeClosePolicy(null);
    try {
      initialPolicy = normalizeClosePolicy(localStorage.getItem(SPLIT_CLOSE_POLICY_STORAGE_KEY));
    } catch {}
    this.machine = new ReaderWorkspaceStateMachine(initialPolicy);

    this.trackEl = document.getElementById('chrome-tabs-track');
    this.emptyEl = document.getElementById('reader-empty-stage');
    this.splitGridEl = document.getElementById('reader-split-grid');
    this.firstDividerEl = document.getElementById('split-divider-v');
    this.bottomDockEl = document.getElementById('reader-bottom-dock');
    this.tabCountBadge = document.getElementById('rail-reader-tab-count');

    if (this.splitGridEl) {
      this.resizer = new SplitResizer(this.splitGridEl);
    }

    this.initEvents();
    this.initDragAndDrop();
    this.initPaneFocusTracking();
    this.syncSplitButtons();
  }

  private getAllLiveIframes(): HTMLIFrameElement[] {
    return Array.from(this.liveSlots.values()).map((s) => s.iframe);
  }

  private disposeSlot(tabId: string): void {
    const pendingTimer = this.pendingLoadTimers.get(tabId);
    if (pendingTimer !== undefined) {
      clearTimeout(pendingTimer);
      this.pendingLoadTimers.delete(tabId);
    }
    const slot = this.liveSlots.get(tabId);
    if (!slot) return;
    try {
      slot.iframe.src = 'about:blank';
    } catch {}
    slot.slotEl.remove();
    this.liveSlots.delete(tabId);
  }

  private refreshClosePolicyFromStorage(): void {
    try {
      const next = normalizeClosePolicy(localStorage.getItem(SPLIT_CLOSE_POLICY_STORAGE_KEY));
      this.machine.setClosePolicy(next);
    } catch {}
  }

  private initEvents(): void {
    window.addEventListener('astrolib:navigate-node', ((e: CustomEvent<AstrolibNodeTarget>) => {
      if (e.detail) this.openNodeInTab(e.detail);
    }) as EventListener);

    window.addEventListener('astrolib:open-reading-entity', ((e: CustomEvent<UnifiedReadingEntity>) => {
      if (e.detail) this.openEntityInTab(e.detail);
    }) as EventListener);

    window.addEventListener('astrolib:entity-removed', ((e: CustomEvent<{ entityId?: string }>) => {
      const entityId = e.detail?.entityId;
      if (!entityId) return;
      const deadTab = this.machine.getTabs().find((t) => t.entityId === entityId);
      if (deadTab) {
        this.closeTab(deadTab.id);
      }
    }) as EventListener);

    window.addEventListener('astrolib:settings-changed', () => {
      this.refreshClosePolicyFromStorage();
    });
    window.addEventListener('storage', (e) => {
      if (e.key === SPLIT_CLOSE_POLICY_STORAGE_KEY) {
        this.refreshClosePolicyFromStorage();
      }
    });

    document.getElementById('btn-reader-new-tab')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('astrolib:switch-fragment', { detail: 'library' }));
    });
    document.getElementById('btn-jump-to-library')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('astrolib:switch-fragment', { detail: 'library' }));
    });

    const splitBtns = document.querySelectorAll('.split-btn[data-split]');
    splitBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = btn.getAttribute('data-split') || '1x1';
        this.setSplitMode(mode);
      });
    });

    document.getElementById('btn-dock-collapse')?.addEventListener('click', () => {
      this.bottomDockEl?.classList.add('is-collapsed');
    });
    document.getElementById('dock-expand-handle')?.addEventListener('click', () => {
      this.bottomDockEl?.classList.remove('is-collapsed');
    });

    window.addEventListener('message', (e: MessageEvent) => {
      const data = e.data as any;
      if (!data || typeof data.type !== 'string') return;

      const frames = this.getAllLiveIframes();
      if (frames.length === 0) return;
      const fromOwnPane = frames.some((frame) => frame.contentWindow === e.source);
      if (!fromOwnPane) return;

      if (data.type === 'astrolib:switch-fragment') {
        if (data.fragment === 'library' || data.fragment === 'reader') {
          window.dispatchEvent(new CustomEvent('astrolib:switch-fragment', { detail: data.fragment }));
        }
        return;
      }

      if (data.type === 'astrolib:open-canvas-split' && data.url) {
        this.openCanvasInSplit(data);
        return;
      }

      if (data.type === 'astrolib:chapter-changed' && data.colSlug && data.bookSlug && data.chapterSlug) {
        frames.forEach((frame) => {
          if (frame.contentWindow === e.source) return;
          const src = frame.getAttribute('src') || '';
          if (src.indexOf('/workspace/canvas') !== -1) {
            try {
              frame.contentWindow?.postMessage(
                {
                  type: 'astrolib:switch-canvas-chapter',
                  colSlug: data.colSlug,
                  bookSlug: data.bookSlug,
                  chapterSlug: data.chapterSlug,
                  chapterTitle: data.chapterTitle || data.chapterSlug,
                },
                '*'
              );
            } catch {}
          }
        });
        // 同步内部画布 Tab 记录
        const stateTabs = this.machine.getTabs();
        stateTabs.forEach((tab) => {
          if (tab.kind === 'canvas' && tab.entityId.startsWith(`canvas:${data.colSlug}-${data.bookSlug}-`)) {
            tab.entityId = `canvas:${data.colSlug}-${data.bookSlug}-${data.chapterSlug}`;
            tab.title = `${data.chapterTitle || data.chapterSlug} · 画布`;
            tab.url = `/workspace/canvas/?col=${encodeURIComponent(data.colSlug)}&book=${encodeURIComponent(data.bookSlug)}&chapter=${encodeURIComponent(data.chapterSlug)}&chapterTitle=${encodeURIComponent(data.chapterTitle || data.chapterSlug)}`;
            const slot = this.liveSlots.get(tab.id);
            if (slot) slot.url = tab.url;
          }
        });
        this.renderTabs();
        return;
      }

      if (data.type === 'astrolib:export-canvas') {
        const bridge = (window as any).astrolib;
        if (bridge) {
          if (data.format === 'pdf' && typeof bridge.exportCanvasPdf === 'function') {
            bridge.exportCanvasPdf(data);
          } else if (data.format === 'png' && typeof bridge.exportCanvasPng === 'function') {
            bridge.exportCanvasPng(data);
          }
        }
        return;
      }

      if (data.type === 'astrolib:focus-ast-node' && data.nodeId) {
        frames.forEach((frame) => {
          if (frame.contentWindow !== e.source) {
            try {
              frame.contentWindow?.postMessage(
                {
                  type: 'astrolib:focus-ast-node',
                  colSlug: data.colSlug,
                  bookSlug: data.bookSlug,
                  chapterSlug: data.chapterSlug,
                  nodeId: data.nodeId,
                },
                '*'
              );
            } catch {}
          }
        });
      }
    });
  }

  /**
   * 追踪当前聚焦窗格：支持点击空槽以及焦点进入子 iframe
   */
  private initPaneFocusTracking(): void {
    const grid = this.splitGridEl;
    if (!grid) return;

    grid.addEventListener('pointerdown', (e) => {
      const target = (e.target as HTMLElement | null)?.closest('.split-pane-box, .tab-pane-slot') as HTMLElement | null;
      if (!target) return;
      const idxStr = target.dataset.paneIndex ?? target.dataset.assignedPane;
      if (idxStr === undefined) return;
      const paneIdx = Number(idxStr);
      if (Number.isInteger(paneIdx) && paneIdx >= 0 && paneIdx < this.machine.getMaxPanes()) {
        this.machine.focusPane(paneIdx);
        this.syncFocusDecorations();
        this.renderTabs();
      }
    });

    // 当点击进入 iframe 内部时，主窗失焦且 document.activeElement 指向该 iframe
    window.addEventListener('blur', () => {
      setTimeout(() => {
        const active = document.activeElement;
        if (active && active instanceof HTMLIFrameElement && active.classList.contains('pane-reader-iframe')) {
          const slotEl = active.closest('.tab-pane-slot') as HTMLElement | null;
          const idxStr = slotEl?.dataset.assignedPane;
          if (idxStr !== undefined) {
            const paneIdx = Number(idxStr);
            if (Number.isInteger(paneIdx) && paneIdx >= 0 && paneIdx < this.machine.getMaxPanes()) {
              this.machine.focusPane(paneIdx);
              this.syncFocusDecorations();
              this.renderTabs();
            }
          }
        }
      }, 0);
    });
  }

  private initDragAndDrop(): void {
    const grid = this.splitGridEl;
    if (!grid) return;

    this.trackEl?.addEventListener('dragstart', () => {
      grid.classList.add('is-resizing');
    });
    this.trackEl?.addEventListener('dragend', () => {
      grid.classList.remove('is-resizing');
      grid.querySelectorAll('.pane-drag-over').forEach((el) => el.classList.remove('pane-drag-over'));
    });

    const resolveDropTarget = (target: EventTarget | null) => {
      const el = (target as HTMLElement | null)?.closest('.split-pane-box, .tab-pane-slot') as HTMLElement | null;
      if (!el) return null;
      const idxStr = el.dataset.paneIndex ?? el.dataset.assignedPane;
      if (idxStr === undefined) return null;
      const paneIdx = Number(idxStr);
      return Number.isInteger(paneIdx) && paneIdx >= 0 && paneIdx < this.machine.getMaxPanes()
        ? { el, paneIdx }
        : null;
    };

    grid.addEventListener('dragover', (e) => {
      const hit = resolveDropTarget(e.target);
      if (!hit) return;
      e.preventDefault();
      hit.el.classList.add('pane-drag-over');
    });

    grid.addEventListener('dragleave', (e) => {
      const hit = resolveDropTarget(e.target);
      hit?.el.classList.remove('pane-drag-over');
    });

    grid.addEventListener('drop', (e) => {
      grid.classList.remove('is-resizing');
      const hit = resolveDropTarget(e.target);
      if (!hit) return;
      e.preventDefault();
      hit.el.classList.remove('pane-drag-over');
      const tabId = e.dataTransfer?.getData('text/plain');
      if (tabId && this.machine.assignTabToPane(tabId, hit.paneIdx)) {
        this.render();
      }
    });
  }

  public openCanvasInSplit(data: {
    colSlug: string;
    bookSlug: string;
    chapterSlug: string;
    title?: string;
    url: string;
  }): void {
    this.machine.openCanvasSplit(data);
    this.syncSplitButtons();
    this.render();
    window.dispatchEvent(new CustomEvent('astrolib:switch-fragment', { detail: 'reader' }));
  }

  public openNodeInTab(target: AstrolibNodeTarget): void {
    const isPaper = target.entityKind === 'paper' || target.colSlug === 'paper';
    const entityId = isPaper
      ? `paper:${target.taskId || target.bookSlug}`
      : `book:${target.colSlug}-${target.bookSlug}`;
    const targetUrl = target.canonicalPath;
    const existing = this.machine.getTabs().find((t) => t.entityId === entityId);

    if (existing) {
      const existingSlot = this.liveSlots.get(existing.id);
      if (existingSlot) {
        const ifr = existingSlot.iframe;
        try {
          const currentPath = ifr.contentWindow?.location.pathname || '';
          const targetPath = targetUrl.split('#')[0];
          if (currentPath && decodeURI(currentPath) === decodeURI(targetPath) && target.anchor) {
            ifr.contentWindow!.location.hash = `#${target.anchor}`;
            existingSlot.url = targetUrl;
          } else if (existingSlot.url !== targetUrl) {
            existingSlot.url = targetUrl;
            existingSlot.loaded = false;
            existingSlot.slotEl.classList.remove('is-loaded');
            ifr.src = targetUrl;
          }
        } catch {
          existingSlot.url = targetUrl;
          existingSlot.loaded = false;
          existingSlot.slotEl.classList.remove('is-loaded');
          ifr.src = targetUrl;
        }
      }
    }

    this.machine.openEntity({
      entityId,
      kind: isPaper ? 'paper' : 'book',
      title: target.title || getBookTitle(target.colSlug, target.bookSlug),
      url: targetUrl,
    });

    this.render();
    window.dispatchEvent(new CustomEvent('astrolib:switch-fragment', { detail: 'reader' }));
  }

  public openEntityInTab(entity: UnifiedReadingEntity): void {
    let targetUrl = '';
    if (entity.kind === 'book') {
      const meta = entity.metadata;
      targetUrl = `/collections/${meta.colSlug || 'math'}/${meta.bookSlug || 'book'}/${meta.entryPoint || 'chapter-01'}/`;
    } else if (entity.kind === 'paper') {
      const taskId = entity.metadata?.taskId;
      targetUrl = taskId ? `/workspace/ingest/?taskId=${encodeURIComponent(taskId)}` : '/workspace/ingest/';
    }

    this.machine.openEntity({
      entityId: entity.id,
      kind: entity.kind,
      title: entity.title,
      url: targetUrl,
    });

    this.render();
    window.dispatchEvent(new CustomEvent('astrolib:switch-fragment', { detail: 'reader' }));
  }

  private activateTab(tabId: string): void {
    this.machine.activateTab(tabId);
    this.render();
  }

  private closeTab(tabId: string): void {
    const existed = this.machine.closeTab(tabId);
    if (!existed) return;
    this.disposeSlot(tabId);
    this.syncSplitButtons();
    this.render();
  }

  private setSplitMode(mode: string): void {
    this.machine.setSplitMode(uiModeToSplitLayout(mode));
    this.syncSplitButtons();
    this.render();
  }

  private syncSplitButtons(): void {
    const activeUiMode = splitLayoutToUiMode(this.machine.getSplitMode());
    document.querySelectorAll('.split-btn[data-split]').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-split') === activeUiMode);
    });
  }

  private updateBadge(): void {
    if (!this.tabCountBadge) return;
    const count = this.machine.getTabs().length;
    if (count > 0) {
      this.tabCountBadge.textContent = String(count);
      this.tabCountBadge.style.display = 'flex';
    } else {
      this.tabCountBadge.style.display = 'none';
    }
  }

  private render(): void {
    this.updateBadge();
    this.renderTabs();
    this.renderPanes();
  }

  private renderTabs(): void {
    if (!this.trackEl) return;
    this.trackEl.innerHTML = '';

    const tabs = this.machine.getTabs();
    const visibleIds = this.machine.getVisibleTabIds();
    const focusedTabId = this.machine.getFocusedTabId();
    const isMultiPane = this.machine.getMaxPanes() > 1;

    tabs.forEach((tab) => {
      const isVisible = visibleIds.has(tab.id);
      const isFocused = tab.id === focusedTabId;

      const tabEl = document.createElement('div');
      const classes = ['chrome-tab'];
      if (isVisible) classes.push('is-visible');
      if (isFocused) classes.push('is-focused');
      if (isVisible || isFocused) classes.push('active');
      tabEl.className = classes.join(' ');
      tabEl.setAttribute('data-tab-id', tab.id);
      tabEl.setAttribute('draggable', 'true');

      const iconName = tab.kind === 'canvas' ? 'draw' : tab.kind === 'paper' ? 'description' : 'menu_book';

      const focusDotHtml = isMultiPane && isFocused ? '<span class="tab-focus-dot" aria-hidden="true"></span>' : '';

      tabEl.innerHTML = `
        ${focusDotHtml}
        <span class="material-symbols-outlined tab-icon">${iconName}</span>
        <span class="tab-title"></span>
        <button type="button" class="tab-close-btn" title="关闭标签页" aria-label="关闭标签页">
          <span class="material-symbols-outlined">close</span>
        </button>
      `;
      const titleEl = tabEl.querySelector('.tab-title') as HTMLElement;
      titleEl.textContent = tab.title;
      titleEl.title = tab.title;

      tabEl.addEventListener('dragstart', (e) => {
        e.dataTransfer?.setData('text/plain', tab.id);
      });

      tabEl.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.tab-close-btn')) return;
        this.activateTab(tab.id);
      });

      tabEl.querySelector('.tab-close-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeTab(tab.id);
      });

      this.trackEl!.appendChild(tabEl);
    });
  }

  private syncFocusDecorations(): void {
    const maxPanes = this.machine.getMaxPanes();
    const focusedPane = this.machine.getFocusedPaneIndex();
    const showFocusHint = maxPanes > 1;

    for (let i = 0; i < 4; i++) {
      const box = document.getElementById(`pane-${i}`);
      box?.classList.toggle('is-pane-focused', showFocusHint && i === focusedPane);
    }

    for (const slot of this.liveSlots.values()) {
      const assigned = Number(slot.slotEl.getAttribute('data-assigned-pane'));
      const isFocused = showFocusHint && Number.isInteger(assigned) && assigned === focusedPane;
      slot.slotEl.classList.toggle('is-pane-focused', isFocused);
    }
  }

  private syncThemeToIframe(ifr: HTMLIFrameElement): void {
    try {
      const m3Color = localStorage.getItem('starlight-m3-theme-color');
      const cachedCss = localStorage.getItem('astrolib_m3_cached_css');
      const theme = localStorage.getItem('starlight-theme') || 'auto';
      const resolvedTheme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
      const font = localStorage.getItem('starlight-font');
      const fontSize = localStorage.getItem('astrolib_font_size');
      const punctStyle = localStorage.getItem('astrolib_punct_style');
      const indent =
        localStorage.getItem('astrolib_typography_indent') ?? localStorage.getItem('starlight-paragraph-indent');
      const liteMode = localStorage.getItem('astrolib_lite_mode');
      const features = localStorage.getItem('starlight-features');
      const transProvider = localStorage.getItem('astrolib_trans_provider');
      const ingestSettings = readIngestSettings();

      ifr.contentWindow?.postMessage(
        {
          type: 'M3_THEME_COLOR_CHANGED',
          color: m3Color,
          schemeCss: cachedCss,
          css: cachedCss,
          theme,
          resolvedTheme,
          font,
          fontSize,
          punctStyle,
          indent,
          liteMode,
          features,
          transProvider,
          ingestSettings,
        },
        '*'
      );
    } catch {}
  }

  private showSlotErrorOverlay(slot: LiveTabSlot, statusLabel: string): void {
    slot.loaded = true;
    slot.slotEl.classList.add('is-loaded');
    slot.slotEl.querySelector('.pane-slot-error')?.remove();

    const overlay = document.createElement('div');
    overlay.className = 'pane-slot-error';
    overlay.innerHTML = `
      <span class="material-symbols-outlined" style="font-size: 28px; opacity: 0.7;">menu_book</span>
      <div style="font-size: 14px; font-weight: 500; color: var(--md-sys-color-on-surface);">章节暂不可用（${statusLabel}）</div>
      <div style="font-size: 12.5px; color: var(--md-sys-color-on-surface-variant); max-width: 340px;">
        该教材包尚未导入或对应章节地址已失效，请前往书库导入对应的 .abp 书籍包。
      </div>
      <button type="button" class="empty-slot-btn">
        <span class="material-symbols-outlined" style="font-size: 18px;">library_books</span>
        <span>前往书库导入书籍</span>
      </button>
    `;
    overlay.querySelector('.empty-slot-btn')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('astrolib:switch-fragment', { detail: 'library' }));
    });
    slot.slotEl.appendChild(overlay);
  }

  private renderPanes(): void {
    const tabs = this.machine.getTabs();
    if (tabs.length === 0) {
      for (const tabId of Array.from(this.liveSlots.keys())) {
        this.disposeSlot(tabId);
      }
      if (this.emptyEl) this.emptyEl.style.display = 'flex';
      if (this.splitGridEl) this.splitGridEl.style.display = 'none';
      return;
    }

    if (this.emptyEl) this.emptyEl.style.display = 'none';
    if (this.splitGridEl) this.splitGridEl.style.display = 'block';

    const grid = this.splitGridEl!;
    const splitMode = this.machine.getSplitMode();
    grid.className = `reader-split-grid mode-${splitLayoutToUiMode(splitMode)}`;
    this.resizer?.applyRatios(splitMode);

    const activeIds = new Set(tabs.map((t) => t.id));
    for (const existingTabId of Array.from(this.liveSlots.keys())) {
      if (!activeIds.has(existingTabId)) {
        this.disposeSlot(existingTabId);
      }
    }

    const maxPanes = this.machine.getMaxPanes();
    const bindings = this.machine.getPaneBindings();
    const visibleTabIds = new Set<string>();
    let newMountIdx = 0;

    for (let i = 0; i < 4; i++) {
      const paneBox = document.getElementById(`pane-${i}`);
      const paneWrap = document.getElementById(`pane-wrap-${i}`);
      if (!paneBox || !paneWrap) continue;

      if (i < maxPanes) {
        const boundTabId = bindings[i];
        const targetTab = tabs.find((t) => t.id === boundTabId);

        if (targetTab) {
          visibleTabIds.add(targetTab.id);
          paneBox.style.display = 'none';

          let slot = this.liveSlots.get(targetTab.id);
          if (!slot) {
            const slotEl = document.createElement('div');
            slotEl.className = 'tab-pane-slot';
            slotEl.setAttribute('data-tab-id', targetTab.id);
            slotEl.setAttribute('data-assigned-pane', String(i));
            slotEl.innerHTML = `
              <div class="pane-loading-skeleton">
                <div class="pane-loading-bar"></div>
                <span>正在载入研读视窗...</span>
              </div>
              <iframe
                class="pane-reader-iframe"
                data-tab-id="${targetTab.id}"
                allow="fullscreen"
                title="${targetTab.title.replace(/"/g, '&quot;')}"
              ></iframe>
            `;
            const iframe = slotEl.querySelector('iframe') as HTMLIFrameElement;
            const newSlot: LiveTabSlot = {
              slotEl,
              iframe,
              url: targetTab.url,
              lastUsed: ++this.slotAccessClock,
              loaded: false,
            };

            iframe.addEventListener('load', () => {
              const currentSrc = iframe.getAttribute('src') || '';
              if (!currentSrc || currentSrc === 'about:blank') return;

              newSlot.loaded = true;
              newSlot.slotEl.classList.add('is-loaded');

              try {
                const doc = iframe.contentDocument;
                const bodyText = doc?.body?.textContent?.trim() || '';
                if (bodyText.startsWith('404 Not Found')) {
                  window.dispatchEvent(
                    new CustomEvent('astrolib:show-snackbar', {
                      detail: { message: '未找到章节：HTTP 404 资源不存在或链接失效', durationMs: 4500 },
                    })
                  );
                  this.showSlotErrorOverlay(newSlot, 'HTTP 404');
                  return;
                }
              } catch {}

              this.syncThemeToIframe(iframe);
            });

            grid.insertBefore(slotEl, this.firstDividerEl || null);
            this.liveSlots.set(targetTab.id, newSlot);
            slot = newSlot;

            const delayMs = newMountIdx * 45;
            newMountIdx++;
            const targetUrl = targetTab.url;
            if (delayMs === 0) {
              iframe.src = targetUrl;
            } else {
              const timerId = window.setTimeout(() => {
                this.pendingLoadTimers.delete(targetTab.id);
                if (this.liveSlots.get(targetTab.id) === newSlot) {
                  iframe.src = newSlot.url;
                }
              }, delayMs);
              this.pendingLoadTimers.set(targetTab.id, timerId);
            }
          } else {
            slot.lastUsed = ++this.slotAccessClock;
            slot.slotEl.setAttribute('data-assigned-pane', String(i));
            slot.slotEl.classList.remove('is-parked');

            if (slot.url !== targetTab.url) {
              slot.url = targetTab.url;
              slot.loaded = false;
              slot.slotEl.classList.remove('is-loaded');
              slot.slotEl.querySelector('.pane-slot-error')?.remove();
              const pending = this.pendingLoadTimers.get(targetTab.id);
              if (pending !== undefined) {
                clearTimeout(pending);
                this.pendingLoadTimers.delete(targetTab.id);
              }
              slot.iframe.src = targetTab.url;
            }
          }
        } else {
          paneBox.style.display = 'flex';
          if (!paneWrap.querySelector('.empty-slot-btn')) {
            paneWrap.innerHTML = `
              <div class="pane-empty-slot">
                <button type="button" class="empty-slot-btn" data-slot-index="${i}">
                  <span class="material-symbols-outlined" style="font-size: 18px;">add</span>
                  <span>选择对照研读内容 (文献/教材)</span>
                </button>
              </div>
            `;
            paneWrap.querySelector('.empty-slot-btn')?.addEventListener('click', (ev) => {
              ev.stopPropagation();
              this.machine.focusPane(i);
              this.machine.setPendingSlotTarget(i);
              this.syncFocusDecorations();
              window.dispatchEvent(new CustomEvent('astrolib:switch-fragment', { detail: 'library' }));
            });
          }
        }
      } else {
        paneBox.style.display = 'none';
      }
    }

    for (const [tabId, slot] of this.liveSlots.entries()) {
      if (!visibleTabIds.has(tabId)) {
        slot.slotEl.classList.add('is-parked');
        slot.slotEl.removeAttribute('data-assigned-pane');
      }
    }

    if (this.liveSlots.size > ReaderChromeHostController.MAX_LIVE_IFRAMES) {
      const parkedCandidates = Array.from(this.liveSlots.entries())
        .filter(([tabId]) => !visibleTabIds.has(tabId))
        .sort((a, b) => a[1].lastUsed - b[1].lastUsed);

      for (const [tabId] of parkedCandidates) {
        if (this.liveSlots.size <= ReaderChromeHostController.MAX_LIVE_IFRAMES) break;
        this.disposeSlot(tabId);
      }
    }

    this.syncFocusDecorations();
  }
}

export function initReaderChromeHost(): ReaderChromeHostController {
  return new ReaderChromeHostController();
}
