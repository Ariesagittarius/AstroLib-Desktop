export type ResizerSide = 'left' | 'right';

export interface PaneResizerOptions {

  handle: HTMLElement;

  side: ResizerSide;

  getInitialWidth: () => number;

  getMinWidth: () => number;

  getMaxWidth: () => number;

  onResize: (widthPx: number) => void;

  onCommit?: (widthPx: number) => void;

  onReset?: () => void;

  stepPx?: number;
}

export interface PaneResizerController {
  destroy: () => void;
  syncAria: () => void;
}

function clampWidth(value: number, minWidth: number, maxWidth: number): number {
  const safeMin = Math.max(0, Math.round(minWidth));
  const safeMax = Math.max(safeMin, Math.round(maxWidth));
  return Math.max(safeMin, Math.min(safeMax, Math.round(value)));
}

export function createPaneResizer(options: PaneResizerOptions): PaneResizerController {
  const {
    handle,
    side,
    getInitialWidth,
    getMinWidth,
    getMaxWidth,
    onResize,
    onCommit,
    onReset,
    stepPx = 16,
  } = options;

  let activePointerId: number | null = null;
  let startX = 0;
  let startWidth = 0;
  let lastAppliedWidth = 0;
  let rafId: number | null = null;
  let pendingWidth: number | null = null;

  if (!handle.hasAttribute('role')) {
    handle.setAttribute('role', 'separator');
  }
  handle.setAttribute('aria-orientation', 'vertical');
  if (!handle.hasAttribute('tabindex')) {
    handle.setAttribute('tabindex', '0');
  }

  const syncAria = (currentWidth?: number): void => {
    const minW = Math.max(0, Math.round(getMinWidth()));
    const maxW = Math.max(minW, Math.round(getMaxWidth()));
    const nowW = clampWidth(currentWidth ?? getInitialWidth(), minW, maxW);
    handle.setAttribute('aria-valuemin', String(minW));
    handle.setAttribute('aria-valuemax', String(maxW));
    handle.setAttribute('aria-valuenow', String(nowW));
  };

  syncAria();

  const flushPending = (): void => {
    rafId = null;
    if (pendingWidth === null) return;
    const width = pendingWidth;
    pendingWidth = null;
    if (width !== lastAppliedWidth) {
      lastAppliedWidth = width;
      onResize(width);
      syncAria(width);
    }
  };

  const endDrag = (commit: boolean): void => {
    if (activePointerId === null) return;
    try {
      if (handle.hasPointerCapture?.(activePointerId)) {
        handle.releasePointerCapture(activePointerId);
      }
    } catch {}
    activePointerId = null;

    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (pendingWidth !== null) {
      lastAppliedWidth = pendingWidth;
      onResize(lastAppliedWidth);
      pendingWidth = null;
    }

    document.documentElement.classList.remove('is-pane-resizing');
    handle.classList.remove('is-dragging');
    syncAria(lastAppliedWidth);

    if (commit) {
      onCommit?.(lastAppliedWidth);
    }
  };

  const onPointerDown = (ev: PointerEvent): void => {
    if (ev.button !== 0 && ev.pointerType === 'mouse') return;
    ev.preventDefault();
    ev.stopPropagation();

    activePointerId = ev.pointerId;
    startX = ev.clientX;
    startWidth = getInitialWidth();
    lastAppliedWidth = clampWidth(startWidth, getMinWidth(), getMaxWidth());
    pendingWidth = null;

    document.documentElement.classList.add('is-pane-resizing');
    handle.classList.add('is-dragging');

    try {
      handle.setPointerCapture(ev.pointerId);
    } catch {}
  };

  const onPointerMove = (ev: PointerEvent): void => {
    if (activePointerId === null || ev.pointerId !== activePointerId) return;
    const rawDelta = ev.clientX - startX;
    const signedDelta = side === 'left' ? rawDelta : -rawDelta;
    const clamped = clampWidth(startWidth + signedDelta, getMinWidth(), getMaxWidth());
    pendingWidth = clamped;

    if (rafId === null) {
      rafId = requestAnimationFrame(flushPending);
    }
  };

  const onPointerUp = (ev: PointerEvent): void => {
    if (activePointerId === null || ev.pointerId !== activePointerId) return;
    endDrag(true);
  };

  const onPointerCancel = (ev: PointerEvent): void => {
    if (activePointerId === null || ev.pointerId !== activePointerId) return;
    endDrag(false);
  };

  const onDblClick = (ev: MouseEvent): void => {
    ev.preventDefault();
    ev.stopPropagation();
    onReset?.();
    requestAnimationFrame(() => syncAria());
  };

  const onKeyDown = (ev: KeyboardEvent): void => {
    if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight' && ev.key !== 'Home') return;
    ev.preventDefault();
    if (ev.key === 'Home') {
      onReset?.();
      requestAnimationFrame(() => syncAria());
      return;
    }
    const deltaMagnitude = ev.shiftKey ? stepPx * 3 : stepPx;
    const sign =
      side === 'left'
        ? ev.key === 'ArrowRight'
          ? 1
          : -1
        : ev.key === 'ArrowLeft'
          ? 1
          : -1;
    const nextWidth = clampWidth(
      getInitialWidth() + sign * deltaMagnitude,
      getMinWidth(),
      getMaxWidth()
    );
    lastAppliedWidth = nextWidth;
    onResize(nextWidth);
    syncAria(nextWidth);
    onCommit?.(nextWidth);
  };

  handle.addEventListener('pointerdown', onPointerDown);
  handle.addEventListener('pointermove', onPointerMove);
  handle.addEventListener('pointerup', onPointerUp);
  handle.addEventListener('pointercancel', onPointerCancel);
  handle.addEventListener('dblclick', onDblClick);
  handle.addEventListener('keydown', onKeyDown);

  return {
    syncAria: () => syncAria(),
    destroy: () => {
      endDrag(false);
      handle.removeEventListener('pointerdown', onPointerDown);
      handle.removeEventListener('pointermove', onPointerMove);
      handle.removeEventListener('pointerup', onPointerUp);
      handle.removeEventListener('pointercancel', onPointerCancel);
      handle.removeEventListener('dblclick', onDblClick);
      handle.removeEventListener('keydown', onKeyDown);
    },
  };
}
