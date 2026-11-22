import type { SplitLayoutMode } from '../../types/library-entity';

export interface SplitRatios {
  col: number;
  row: number;
  topCol: number;
  bottomCol: number;
}

const STORAGE_KEY_V2 = 'astrolib_split_ratios_v2';
const LEGACY_STORAGE_KEY = 'astrolib_split_ratio';
const MIN_RATIO = 0.18;
const MAX_RATIO = 0.82;
const SNAP_THRESHOLD = 0.012;

function clampRatio(val: number): number {
  if (!Number.isFinite(val)) return 0.5;
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, val));
}

export class SplitResizer {
  private ratios: SplitRatios = {
    col: 0.5,
    row: 0.5,
    topCol: 0.5,
    bottomCol: 0.5,
  };

  private gridEl: HTMLElement;
  private dividerV: HTMLElement | null;
  private dividerH: HTMLElement | null;
  private dividerVTop: HTMLElement | null;
  private dividerVBottom: HTMLElement | null;

  constructor(gridEl: HTMLElement) {
    this.gridEl = gridEl;
    this.dividerV = document.getElementById('split-divider-v');
    this.dividerH = document.getElementById('split-divider-h');
    this.dividerVTop = document.getElementById('split-divider-v-top');
    this.dividerVBottom = document.getElementById('split-divider-v-bottom');

    this.loadRatios();
    this.applyRatios();
    this.bindHandle(this.dividerV, 'col', 'x');
    this.bindHandle(this.dividerH, 'row', 'y');
    this.bindHandle(this.dividerVTop, 'topCol', 'x', 'bottomCol');
    this.bindHandle(this.dividerVBottom, 'bottomCol', 'x', 'topCol');
  }

  private loadRatios(): void {
    try {
      const rawV2 = localStorage.getItem(STORAGE_KEY_V2);
      if (rawV2) {
        const parsed = JSON.parse(rawV2) as Partial<SplitRatios>;
        this.ratios = {
          col: clampRatio(Number(parsed.col ?? 0.5)),
          row: clampRatio(Number(parsed.row ?? 0.5)),
          topCol: clampRatio(Number(parsed.topCol ?? 0.5)),
          bottomCol: clampRatio(Number(parsed.bottomCol ?? 0.5)),
        };
        return;
      }
      const legacy = Number(localStorage.getItem(LEGACY_STORAGE_KEY) || '0.5');
      if (Number.isFinite(legacy)) {
        this.ratios.col = clampRatio(legacy);
      }
    } catch {}
  }

  private saveRatios(): void {
    try {
      localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(this.ratios));
      localStorage.setItem(LEGACY_STORAGE_KEY, String(this.ratios.col));
    } catch {}
  }

  public applyRatios(_mode?: SplitLayoutMode): void {
    this.gridEl.style.setProperty('--split-col', `${(this.ratios.col * 100).toFixed(3)}%`);
    this.gridEl.style.setProperty('--split-row', `${(this.ratios.row * 100).toFixed(3)}%`);
    this.gridEl.style.setProperty('--split-top-col', `${(this.ratios.topCol * 100).toFixed(3)}%`);
    this.gridEl.style.setProperty('--split-bottom-col', `${(this.ratios.bottomCol * 100).toFixed(3)}%`);
  }

  private bindHandle(
    handle: HTMLElement | null,
    key: keyof SplitRatios,
    axis: 'x' | 'y',
    snapPartnerKey?: keyof SplitRatios
  ): void {
    if (!handle) return;

    handle.addEventListener('dblclick', (e) => {
      e.preventDefault();
      this.ratios[key] = 0.5;
      this.applyRatios();
      this.saveRatios();
    });

    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.gridEl.classList.add('is-resizing');
      handle.classList.add('dragging');
      try {
        handle.setPointerCapture(e.pointerId);
      } catch {}

      const onMove = (me: PointerEvent) => {
        const rect = this.gridEl.getBoundingClientRect();
        if (axis === 'x' && rect.width <= 0) return;
        if (axis === 'y' && rect.height <= 0) return;

        const raw =
          axis === 'x' ? (me.clientX - rect.left) / rect.width : (me.clientY - rect.top) / rect.height;
        let clamped = clampRatio(raw);

        if (snapPartnerKey && Math.abs(clamped - this.ratios[snapPartnerKey]) < SNAP_THRESHOLD) {
          clamped = this.ratios[snapPartnerKey];
        }

        this.ratios[key] = clamped;
        this.applyRatios();
      };

      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        this.gridEl.classList.remove('is-resizing');
        handle.classList.remove('dragging');
        this.saveRatios();
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    });
  }
}
