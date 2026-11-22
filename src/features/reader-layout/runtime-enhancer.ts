import { CJK_PRESETS, LATIN_PRESETS, type CjkFont, type LatinFont } from '../../scripts/font-presets.ts';
import {
  formatFontSizePt,
  replaceBodyFullStops,
  type PunctStyle,
} from '../../scripts/settings/typography-prefs.ts';
import type { BookStyleMode, ReadingLayoutMode, ReadingProfile } from '../../types/content-package.ts';
import { createPaneResizer, type PaneResizerController } from '../../utils/pane-resizer.ts';
import { sideloadManager } from '../../components/sideload/sideload-manager.ts';
import {
  getBookReadingPrefsKey,
  loadEffectiveBookPrefs,
  normalizeFormatKey,
  READER_MAX_FONT_SIZE,
  READER_MIN_FONT_SIZE,
  resetBookPrefOverrides,
  saveBookPrefOverride,
  type EffectiveBookPrefs,
  type FormatDefaultKey,
} from './prefs.ts';

const READER_LEFT_WIDTH_KEY = 'astrolib_reader_left_width';
const LEFT_MIN_PX = 180;
const LEFT_MAX_PX = 380;
const RIGHT_TOC_MIN_PX = 180;
const RIGHT_TOC_MAX_PX = 400;
const RIGHT_PANEL_MIN_PX = 280;
const RIGHT_PANEL_MAX_PX = 560;
const CENTER_MIN_PX = 480;

interface ReaderViewportApi {
  getState?: () => {
    layoutMode?: ReadingLayoutMode;
    readingProfile?: ReadingProfile;
    styleMode?: BookStyleMode;
    useBookFonts?: boolean;
    effectiveColumns?: number;
  };
  setLayoutMode?: (mode: ReadingLayoutMode) => void;
  setReadingProfile?: (profile: ReadingProfile) => void;
  setStyleMode?: (mode: BookStyleMode) => void;
  setUseBookFonts?: (val: boolean) => void;
  goToPage?: (pageIdx: number) => void;
  recalculate?: (resetToStart?: boolean) => void;
}

function getBookContext(): { bookKey: string; sourceFormat: FormatDefaultKey } {
  const win = window as any;
  const root = document.documentElement;
  const sourceFormat = normalizeFormatKey(root.dataset.sourceFormat || win.__sourceFormat || 'abp');
  const colSlug = typeof win.__currentColSlug === 'string' ? win.__currentColSlug : '';
  const bookSlug = typeof win.__currentBookSlug === 'string' ? win.__currentBookSlug : '';

  if (colSlug && bookSlug) {
    return { bookKey: `${colSlug}-${bookSlug}`, sourceFormat };
  }

  const m = window.location.pathname.match(/\/collections\/([^/]+)\/([^/]+)/);
  if (m && m[1] && m[2]) {
    return {
      bookKey: `${decodeURIComponent(m[1])}-${decodeURIComponent(m[2])}`,
      sourceFormat,
    };
  }

  return {
    bookKey: typeof win.__bookKey === 'string' && win.__bookKey ? win.__bookKey : 'default-reader',
    sourceFormat,
  };
}

let isInitialized = false;
let isSyncingViewport = false;
let appliedDomPunct: PunctStyle | null = null;
let preservedSnapshotForClick: Partial<EffectiveBookPrefs> | null = null;
let leftResizerCtrl: PaneResizerController | null = null;
let rightResizerCtrl: PaneResizerController | null = null;
let flowTurnObserver: MutationObserver | null = null;
let observedFlowEl: HTMLElement | null = null;
let turnAnimTimer: number | null = null;
let turnSafetyTimer: number | null = null;
let isWrappedTurnInFlight = false;
let popoverObserver: MutationObserver | null = null;

function getViewportApi(): ReaderViewportApi | null {
  if (typeof window === 'undefined') return null;
  return ((window as any).__readerViewport as ReaderViewportApi | undefined) || null;
}

function syncViewportToPrefs(eff: EffectiveBookPrefs, bookKey: string): void {
  const rv = getViewportApi();
  if (!rv || typeof rv.getState !== 'function' || isSyncingViewport) return;
  const st = rv.getState();
  if (!st) return;

  const prefKey = getBookReadingPrefsKey(bookKey);
  let prevRaw: string | null = null;
  try {
    prevRaw = localStorage.getItem(prefKey);
  } catch {}

  let didCall = false;
  isSyncingViewport = true;
  try {
    if (st.readingProfile && st.readingProfile !== eff.readingProfile) {
      rv.setReadingProfile?.(eff.readingProfile);
      didCall = true;
    }
    if (st.styleMode && st.styleMode !== eff.styleMode) {
      rv.setStyleMode?.(eff.styleMode);
      didCall = true;
    }
    if (typeof st.useBookFonts === 'boolean' && st.useBookFonts !== eff.useBookFonts) {
      rv.setUseBookFonts?.(eff.useBookFonts);
      didCall = true;
    }
    if (st.layoutMode && st.layoutMode !== eff.layoutMode) {
      rv.setLayoutMode?.(eff.layoutMode);
      didCall = true;
    }
  } finally {
    if (didCall) {
      try {
        if (prevRaw === null) {
          localStorage.removeItem(prefKey);
        } else {
          localStorage.setItem(prefKey, prevRaw);
        }
      } catch {}
    }
    isSyncingViewport = false;
  }
}

export function applyEffectiveBookTypography(forcePunctReplace = false): EffectiveBookPrefs {
  const { bookKey, sourceFormat } = getBookContext();
  const eff = loadEffectiveBookPrefs(bookKey, { sourceFormat });
  const root = document.documentElement;

  if (!root.dataset.sourceFormat) {
    root.dataset.sourceFormat = eff.sourceFormat;
  }
  root.dataset.fontLatin = eff.latin;
  root.dataset.fontCjk = eff.cjk;
  const pt = eff.fontSize * 0.75;
  root.style.setProperty('--academic-font-size-body', `${parseFloat(pt.toFixed(2))}pt`);
  root.dataset.paragraphIndent = eff.paragraphIndent ? 'true' : 'false';
  root.dataset.readingProfile = eff.readingProfile;
  root.dataset.styleMode = eff.styleMode;
  root.dataset.useBookFonts = eff.useBookFonts ? 'true' : 'false';
  root.dataset.punctStyle = eff.punctStyle;

  if (appliedDomPunct === null) {
    appliedDomPunct = eff.sourceFormat === 'epub' ? 'circle' : 'dot';
  }

  if (forcePunctReplace || eff.punctStyle !== appliedDomPunct) {
    const idle =
      (typeof window !== 'undefined' && (window as any).requestIdleCallback) ||
      ((fn: () => void) => setTimeout(fn, 24));
    const targetPunct = eff.punctStyle;
    idle(() => {
      replaceBodyFullStops(targetPunct);
      appliedDomPunct = targetPunct;
    });
  }

  syncViewportToPrefs(eff, bookKey);
  syncPopoverControls(eff);
  return eff;
}

function enhanceLayoutPopover(pop: HTMLElement): void {
  if (!pop || pop.dataset.bookTypoEnhanced === '1') return;
  pop.dataset.bookTypoEnhanced = '1';

  const { bookKey, sourceFormat } = getBookContext();
  const header = pop.querySelector<HTMLElement>('.lp-header');
  if (header) {
    const titleEl = header.querySelector<HTMLElement>('.lp-title');
    const closeBtn = header.querySelector<HTMLElement>('#lp-close-btn');

    const headerLeft = document.createElement('div');
    headerLeft.className = 'lp-header-left';
    if (titleEl) {
      headerLeft.appendChild(titleEl);
    }

    const formatTag = document.createElement('span');
    formatTag.className = 'lp-format-tag';
    formatTag.id = 'lp-book-format-tag';
    formatTag.textContent = sourceFormat === 'epub' ? 'EPUB 电子书' : 'ABP 学术教材';
    headerLeft.appendChild(formatTag);

    const headerActions = document.createElement('div');
    headerActions.className = 'lp-header-actions';

    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'lp-reset-btn';
    resetBtn.id = 'lp-reset-book-defaults';
    resetBtn.textContent = '恢复格式默认';
    resetBtn.title = '清除本书独立配置，恢复为此文件格式的全局默认设置';
    headerActions.appendChild(resetBtn);
    if (closeBtn) {
      headerActions.appendChild(closeBtn);
    }

    header.innerHTML = '';
    header.appendChild(headerLeft);
    header.appendChild(headerActions);
  }

  const typoSection = document.createElement('div');
  typoSection.className = 'lp-book-typo-section';
  typoSection.innerHTML = `
    <div class="lp-group">
      <div class="lp-label-row">
        <span class="lp-label">本书字号</span>
        <span class="lp-range-val" id="lp-font-size-val">11.25 pt</span>
      </div>
      <div class="lp-slider-row">
        <input
          type="range"
          id="lp-font-size-slider"
          class="lp-range-input"
          min="${READER_MIN_FONT_SIZE}"
          max="${READER_MAX_FONT_SIZE}"
          step="1"
          aria-label="本书正文字号大小"
        />
      </div>
    </div>
    <div class="lp-group">
      <div class="lp-label-row"><span class="lp-label">中文字体</span></div>
      <div class="lp-chips is-four">
        ${CJK_PRESETS.map(
          (p) => `<button type="button" class="lp-chip" data-book-cjk="${p.value}">${p.label}</button>`
        ).join('')}
      </div>
    </div>
    <div class="lp-group">
      <div class="lp-label-row"><span class="lp-label">拉丁与数字字体</span></div>
      <div class="lp-chips">
        ${LATIN_PRESETS.map(
          (p) => `<button type="button" class="lp-chip" data-book-latin="${p.value}">${p.label}</button>`
        ).join('')}
      </div>
    </div>
    <div class="lp-switch-row">
      <div class="lp-switch-texts">
        <span class="lp-switch-title">段落首行缩进两字</span>
        <span class="lp-switch-desc">按本书独立记忆首行缩进偏好</span>
      </div>
      <button type="button" role="switch" id="lp-book-indent" class="lp-toggle-pill" aria-checked="true" aria-label="段落首行缩进两字"></button>
    </div>
    <div class="lp-group">
      <div class="lp-label-row"><span class="lp-label">句末标点风格</span></div>
      <div class="lp-chips is-two">
        <button type="button" class="lp-chip" data-book-punct="dot">数理圆点 ．</button>
        <button type="button" class="lp-chip" data-book-punct="circle">标准句号 。</button>
      </div>
    </div>
  `;

  const firstGroup = pop.querySelector('.lp-group');
  if (firstGroup) {
    pop.insertBefore(typoSection, firstGroup);
  } else {
    pop.appendChild(typoSection);
  }

  pop.addEventListener(
    'click',
    (ev) => {
      const t = ev.target as HTMLElement | null;
      if (!t) return;
      if (t.closest('[data-set-layout], [data-set-profile], [data-set-style], #lp-use-book-fonts')) {
        const cur = loadEffectiveBookPrefs(bookKey, { sourceFormat });
        preservedSnapshotForClick = { ...cur.overrides };
      }
    },
    true
  );

  pop.addEventListener('click', (ev) => {
    const t = ev.target as HTMLElement | null;
    if (!t) return;

    if (t.closest('#lp-reset-book-defaults')) {
      ev.preventDefault();
      ev.stopPropagation();
      const eff = resetBookPrefOverrides(bookKey, { sourceFormat });
      applyEffectiveBookTypography(true);
      getViewportApi()?.recalculate?.(false);
      syncPopoverControls(eff);
      return;
    }

    const cjkBtn = t.closest<HTMLElement>('[data-book-cjk]');
    if (cjkBtn) {
      ev.preventDefault();
      const cjk = cjkBtn.getAttribute('data-book-cjk') as CjkFont;
      const eff = saveBookPrefOverride(bookKey, { cjk }, { sourceFormat });
      applyEffectiveBookTypography(false);
      getViewportApi()?.recalculate?.(false);
      syncPopoverControls(eff);
      return;
    }

    const latinBtn = t.closest<HTMLElement>('[data-book-latin]');
    if (latinBtn) {
      ev.preventDefault();
      const latin = latinBtn.getAttribute('data-book-latin') as LatinFont;
      const eff = saveBookPrefOverride(bookKey, { latin }, { sourceFormat });
      applyEffectiveBookTypography(false);
      getViewportApi()?.recalculate?.(false);
      syncPopoverControls(eff);
      return;
    }

    const punctBtn = t.closest<HTMLElement>('[data-book-punct]');
    if (punctBtn) {
      ev.preventDefault();
      const punctStyle = punctBtn.getAttribute('data-book-punct') as PunctStyle;
      const eff = saveBookPrefOverride(bookKey, { punctStyle }, { sourceFormat });
      applyEffectiveBookTypography(true);
      getViewportApi()?.recalculate?.(false);
      syncPopoverControls(eff);
      return;
    }

    if (t.closest('#lp-book-indent')) {
      ev.preventDefault();
      const cur = loadEffectiveBookPrefs(bookKey, { sourceFormat });
      const eff = saveBookPrefOverride(bookKey, { paragraphIndent: !cur.paragraphIndent }, { sourceFormat });
      applyEffectiveBookTypography(false);
      getViewportApi()?.recalculate?.(false);
      syncPopoverControls(eff);
      return;
    }

    if (t.closest('[data-set-layout], [data-set-profile], [data-set-style], #lp-use-book-fonts')) {
      const snap = preservedSnapshotForClick;
      preservedSnapshotForClick = null;
      Promise.resolve().then(() => {
        if (snap) {
          const toRestore: Partial<EffectiveBookPrefs> = {};
          if (snap.latin !== undefined) toRestore.latin = snap.latin;
          if (snap.cjk !== undefined) toRestore.cjk = snap.cjk;
          if (snap.fontSize !== undefined) toRestore.fontSize = snap.fontSize;
          if (snap.paragraphIndent !== undefined) toRestore.paragraphIndent = snap.paragraphIndent;
          if (snap.punctStyle !== undefined) toRestore.punctStyle = snap.punctStyle;
          if (Object.keys(toRestore).length > 0) {
            saveBookPrefOverride(bookKey, toRestore, { sourceFormat });
          }
        }
        const eff = applyEffectiveBookTypography(false);
        syncPopoverControls(eff);
      });
    }
  });

  const slider = pop.querySelector<HTMLInputElement>('#lp-font-size-slider');
  slider?.addEventListener('input', () => {
    const val = parseInt(slider.value, 10);
    if (Number.isNaN(val)) return;
    const eff = saveBookPrefOverride(bookKey, { fontSize: val }, { sourceFormat });
    applyEffectiveBookTypography(false);
    syncPopoverControls(eff);
  });
  slider?.addEventListener('change', () => {
    getViewportApi()?.recalculate?.(false);
  });

  syncPopoverControls(loadEffectiveBookPrefs(bookKey, { sourceFormat }));
}

function syncPopoverControls(eff: EffectiveBookPrefs): void {
  const pop = document.getElementById('astrolib-layout-popover');
  if (!pop) return;

  const formatTag = pop.querySelector<HTMLElement>('#lp-book-format-tag');
  if (formatTag) {
    formatTag.textContent = eff.sourceFormat === 'epub' ? 'EPUB 电子书' : 'ABP 学术教材';
  }

  const resetBtn = pop.querySelector<HTMLButtonElement>('#lp-reset-book-defaults');
  if (resetBtn) {
    resetBtn.hidden = !eff.hasOverrides;
  }

  const slider = pop.querySelector<HTMLInputElement>('#lp-font-size-slider');
  if (slider && Number(slider.value) !== eff.fontSize) {
    slider.value = String(eff.fontSize);
  }
  const sizeVal = pop.querySelector<HTMLElement>('#lp-font-size-val');
  if (sizeVal) {
    sizeVal.textContent = formatFontSizePt(eff.fontSize);
  }

  pop.querySelectorAll<HTMLElement>('[data-book-cjk]').forEach((btn) => {
    btn.classList.toggle('is-active', btn.getAttribute('data-book-cjk') === eff.cjk);
  });
  pop.querySelectorAll<HTMLElement>('[data-book-latin]').forEach((btn) => {
    btn.classList.toggle('is-active', btn.getAttribute('data-book-latin') === eff.latin);
  });
  pop.querySelectorAll<HTMLElement>('[data-book-punct]').forEach((btn) => {
    btn.classList.toggle('is-active', btn.getAttribute('data-book-punct') === eff.punctStyle);
  });

  const indentSwitch = pop.querySelector<HTMLElement>('#lp-book-indent');
  if (indentSwitch) {
    indentSwitch.classList.toggle('is-on', eff.paragraphIndent);
    indentSwitch.setAttribute('aria-checked', eff.paragraphIndent ? 'true' : 'false');
  }

  const bookFontSwitch = pop.querySelector<HTMLElement>('#lp-use-book-fonts');
  if (bookFontSwitch) {
    bookFontSwitch.classList.toggle('is-on', eff.useBookFonts);
    bookFontSwitch.setAttribute('aria-checked', eff.useBookFonts ? 'true' : 'false');
  }

  pop.querySelectorAll<HTMLElement>('[data-set-layout]').forEach((btn) => {
    btn.classList.toggle('is-active', btn.getAttribute('data-set-layout') === eff.layoutMode);
  });
  pop.querySelectorAll<HTMLElement>('[data-set-profile]').forEach((btn) => {
    btn.classList.toggle('is-active', btn.getAttribute('data-set-profile') === eff.readingProfile);
  });
  pop.querySelectorAll<HTMLElement>('[data-set-style]').forEach((btn) => {
    btn.classList.toggle('is-active', btn.getAttribute('data-set-style') === eff.styleMode);
  });
}

function triggerDualColumnCrossFade(flow: HTMLElement): void {
  const root = document.documentElement;
  if (
    root.dataset.readingLayout !== 'paged-dual' ||
    root.dataset.effectiveColumns !== '2' ||
    root.classList.contains('is-pane-resizing')
  ) {
    return;
  }
  const reduceMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion) {
    flow.classList.remove('is-dual-turning');
    return;
  }

  if (turnAnimTimer !== null) {
    clearTimeout(turnAnimTimer);
    turnAnimTimer = null;
  }
  if (turnSafetyTimer !== null) {
    clearTimeout(turnSafetyTimer);
    turnSafetyTimer = null;
  }

  flow.classList.add('is-dual-turning');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      flow.classList.remove('is-dual-turning');
    });
  });
  turnSafetyTimer = window.setTimeout(() => {
    flow.classList.remove('is-dual-turning');
    turnSafetyTimer = null;
  }, 150);
}

function installDualColumnTurnAnimator(): void {
  const rv = getViewportApi() as any;
  if (rv && typeof rv.goToPage === 'function' && !rv.__dualCrossFadeWrapped) {
    const origGoToPage = rv.goToPage.bind(rv);
    rv.__dualCrossFadeWrapped = true;
    rv.goToPage = function wrappedGoToPage(pageIdx: number) {
      const flow = document.querySelector<HTMLElement>('.astrolib-chapter-content.astrolib-paged-flow');
      const root = document.documentElement;
      const reduceMotion =
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const shouldFade =
        Boolean(flow) &&
        root.dataset.readingLayout === 'paged-dual' &&
        root.dataset.effectiveColumns === '2' &&
        !reduceMotion &&
        !root.classList.contains('is-pane-resizing');

      if (!shouldFade || !flow) {
        return origGoToPage(pageIdx);
      }

      if (turnAnimTimer !== null) {
        clearTimeout(turnAnimTimer);
        turnAnimTimer = null;
      }
      if (turnSafetyTimer !== null) {
        clearTimeout(turnSafetyTimer);
        turnSafetyTimer = null;
      }

      isWrappedTurnInFlight = true;
      flow.classList.add('is-dual-turning');
      turnAnimTimer = window.setTimeout(() => {
        try {
          origGoToPage(pageIdx);
        } finally {
          void flow.offsetWidth;
          flow.classList.remove('is-dual-turning');
          isWrappedTurnInFlight = false;
          turnAnimTimer = null;
        }
      }, 65);
      turnSafetyTimer = window.setTimeout(() => {
        flow.classList.remove('is-dual-turning');
        isWrappedTurnInFlight = false;
        turnSafetyTimer = null;
      }, 240);
    };
  }

  const flow = document.querySelector<HTMLElement>('.astrolib-chapter-content');
  if (!flow || flow === observedFlowEl) return;

  if (flowTurnObserver) {
    flowTurnObserver.disconnect();
  }
  observedFlowEl = flow;
  let lastTransform = flow.style.transform || '';

  flowTurnObserver = new MutationObserver(() => {
    const nextTransform = flow.style.transform || '';
    if (nextTransform === lastTransform) return;
    const prevWasPaged = lastTransform.includes('translateX');
    lastTransform = nextTransform;

    if (
      !isWrappedTurnInFlight &&
      prevWasPaged &&
      nextTransform.includes('translateX') &&
      flow.classList.contains('astrolib-paged-flow')
    ) {
      triggerDualColumnCrossFade(flow);
    }
  });
  flowTurnObserver.observe(flow, { attributes: true, attributeFilter: ['style'] });
}

function getLeftSidebarWidthPx(): number {
  const sidebar = document.querySelector<HTMLElement>('#starlight__sidebar, .sidebar-pane');
  if (sidebar) {
    const rect = sidebar.getBoundingClientRect();
    if (rect.width > 40) return Math.round(rect.width);
  }
  const stored = Number(localStorage.getItem(READER_LEFT_WIDTH_KEY));
  return Number.isFinite(stored) && stored >= LEFT_MIN_PX ? Math.round(stored) : 304;
}

function getRightSidebarWidthPx(): number {
  if (sideloadManager.getActivePanelId() === 'none') return 0;
  const rightContainer = document.querySelector<HTMLElement>('.right-sidebar-container');
  if (rightContainer) {
    const rect = rightContainer.getBoundingClientRect();
    if (rect.width > 40) return Math.round(rect.width);
  }
  return sideloadManager.getCustomWidthPx() ?? 264;
}

function applyLeftSidebarWidth(widthPx: number | null, persist: boolean): void {
  const root = document.documentElement;
  if (widthPx === null) {
    root.style.removeProperty('--sl-sidebar-width');
    if (persist) {
      try {
        localStorage.removeItem(READER_LEFT_WIDTH_KEY);
      } catch {}
    }
  } else {
    const clamped = Math.max(LEFT_MIN_PX, Math.min(LEFT_MAX_PX, Math.round(widthPx)));
    root.style.setProperty('--sl-sidebar-width', `${clamped}px`, 'important');
    if (persist) {
      try {
        localStorage.setItem(READER_LEFT_WIDTH_KEY, String(clamped));
      } catch {}
    }
  }
}

function installReaderResizers(): void {
  try {
    const savedLeft = Number(localStorage.getItem(READER_LEFT_WIDTH_KEY));
    if (Number.isFinite(savedLeft) && savedLeft >= LEFT_MIN_PX && savedLeft <= LEFT_MAX_PX) {
      applyLeftSidebarWidth(savedLeft, false);
    }
  } catch {}

  const sidebar = document.querySelector<HTMLElement>('#starlight__sidebar, .sidebar-pane');
  const rightContainer = document.querySelector<HTMLElement>('.right-sidebar-container');
  if (!sidebar && !rightContainer) return;

  if (sidebar) {
    let leftHandle = document.getElementById('astrolib-reader-resizer-left');
    if (!leftHandle) {
      leftHandle = document.createElement('div');
      leftHandle.id = 'astrolib-reader-resizer-left';
      leftHandle.className = 'astrolib-pane-resizer astrolib-pane-resizer--left';
      leftHandle.title = '拖拽调整左侧目录宽度（双击恢复默认）';
      leftHandle.setAttribute('aria-label', '调整左侧目录宽度');
      document.body.appendChild(leftHandle);
    }
    leftResizerCtrl?.destroy();
    leftResizerCtrl = createPaneResizer({
      handle: leftHandle,
      side: 'left',
      getInitialWidth: getLeftSidebarWidthPx,
      getMinWidth: () => LEFT_MIN_PX,
      getMaxWidth: () => Math.max(LEFT_MIN_PX, Math.min(LEFT_MAX_PX, window.innerWidth - getRightSidebarWidthPx() - CENTER_MIN_PX)),
      onResize: (w) => {
        applyLeftSidebarWidth(w, false);
      },
      onCommit: (w) => {
        applyLeftSidebarWidth(w, true);
        getViewportApi()?.recalculate?.(false);
        rightResizerCtrl?.syncAria();
      },
      onReset: () => {
        applyLeftSidebarWidth(null, true);
        getViewportApi()?.recalculate?.(false);
        rightResizerCtrl?.syncAria();
      },
    });
  }

  if (rightContainer) {
    let rightHandle = document.getElementById('astrolib-reader-resizer-right');
    if (!rightHandle) {
      rightHandle = document.createElement('div');
      rightHandle.id = 'astrolib-reader-resizer-right';
      rightHandle.className = 'astrolib-pane-resizer astrolib-pane-resizer--right';
      rightHandle.title = '拖拽调整右侧面板宽度（双击恢复默认）';
      rightHandle.setAttribute('aria-label', '调整右侧面板宽度');
      document.body.appendChild(rightHandle);
    }
    rightResizerCtrl?.destroy();
    rightResizerCtrl = createPaneResizer({
      handle: rightHandle,
      side: 'right',
      getInitialWidth: getRightSidebarWidthPx,
      getMinWidth: () => (sideloadManager.getActivePanelId() === 'toc' ? RIGHT_TOC_MIN_PX : RIGHT_PANEL_MIN_PX),
      getMaxWidth: () => {
        const tierCap = sideloadManager.getActivePanelId() === 'toc' ? RIGHT_TOC_MAX_PX : RIGHT_PANEL_MAX_PX;
        return Math.max(180, Math.min(tierCap, window.innerWidth - getLeftSidebarWidthPx() - CENTER_MIN_PX));
      },
      onResize: (w) => {
        sideloadManager.setCustomWidth(w, false);
      },
      onCommit: (w) => {
        sideloadManager.setCustomWidth(w, true);
        getViewportApi()?.recalculate?.(false);
        leftResizerCtrl?.syncAria();
      },
      onReset: () => {
        sideloadManager.setCustomWidth(null, true);
        getViewportApi()?.recalculate?.(false);
        leftResizerCtrl?.syncAria();
      },
    });
  }
}

export function initReaderRuntimeEnhancer(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  (window as any).__applyEffectiveBookTypography = applyEffectiveBookTypography;
  applyEffectiveBookTypography(false);

  const pop = document.getElementById('astrolib-layout-popover');
  if (pop) {
    enhanceLayoutPopover(pop);
  }

  installDualColumnTurnAnimator();
  installReaderResizers();

  if (isInitialized) return;
  isInitialized = true;

  setTimeout(() => {
    const delayedPop = document.getElementById('astrolib-layout-popover');
    if (delayedPop) enhanceLayoutPopover(delayedPop);
    installDualColumnTurnAnimator();
  }, 180);

  if (typeof MutationObserver !== 'undefined' && document.body) {
    popoverObserver = new MutationObserver(() => {
      const delayedPop = document.getElementById('astrolib-layout-popover');
      if (delayedPop && delayedPop.dataset.bookTypoEnhanced !== '1') {
        enhanceLayoutPopover(delayedPop);
      }
      installDualColumnTurnAnimator();
    });
    popoverObserver.observe(document.body, { childList: true });
  }

  window.addEventListener('astrolib:format-defaults-changed', () => {
    applyEffectiveBookTypography(true);
    getViewportApi()?.recalculate?.(false);
  });

  window.addEventListener('storage', (e) => {
    if (
      e.key === 'astrolib_format_defaults_v1' ||
      (e.key && e.key.startsWith('astrolib_book_layout_prefs:'))
    ) {
      applyEffectiveBookTypography(true);
      getViewportApi()?.recalculate?.(false);
    }
  });

  window.addEventListener('astrolib:sideload-change', () => {
    rightResizerCtrl?.syncAria();
    leftResizerCtrl?.syncAria();
  });

  window.addEventListener('message', (ev) => {
    if (ev.data && ev.data.type === 'M3_THEME_COLOR_CHANGED') {
      if (typeof ev.data.formatDefaults === 'string') {
        try {
          localStorage.setItem('astrolib_format_defaults_v1', ev.data.formatDefaults);
        } catch {}
      }
      applyEffectiveBookTypography(true);
      getViewportApi()?.recalculate?.(false);
    }
  });
}
