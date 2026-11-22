/**
 * src/utils/pane-resizer.ts
 * ============================================================================
 * 通用无业务语义分栏拖拽缩放器 (Reusable Split-Pane Drag Resizer)
 * ============================================================================
 * - 基于 Pointer Events Capture 实现丝滑拖拽，不依赖具体业务组件；
 * - 动态约束 min/max 安全区，防止挤压中心阅读区或对话区至不可读宽度；
 * - 支持双击恢复默认宽度，以及键盘 ArrowLeft/ArrowRight 无障碍微调。
 */

export type ResizerSide = 'left' | 'right';

export interface PaneResizerOptions {
  /** 作为拖拽热区的分割线 DOM 元素 */
  handle: HTMLElement;
  /** 面板位于主视口左侧还是右侧 */
  side: ResizerSide;
  /** 读取当前面板像素宽度 */
  getInitialWidth: () => number;
  /** 获取允许的最小像素宽度 */
  getMinWidth: () => number;
  /** 获取允许的最大像素宽度 */
  getMaxWidth: () => number;
  /** 拖拽或键盘调整过程中实时应用的回调 */
  onResize: (widthPx: number) => void;
  /** 拖拽结束或键盘微调完成时的持久化回调 */
  onCommit?: (widthPx: number) => void;
  /** 双击分割线或按下 Home 键时的重置回调 */
  onReset?: () => void;
  /** 键盘方向键单步微调像素（默认 16px） */
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
