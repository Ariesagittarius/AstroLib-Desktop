/**
 * src/components/harness/pdf2abp/pdf2abp-launcher-dialog.ts
 * ============================================================================
 * Material Design 3 Launcher Dialog for PDF -> ABP Conversion Pipeline
 * ============================================================================
 */

import '@material/web/dialog/dialog.js';
import '@material/web/textfield/outlined-text-field.js';
import '@material/web/button/filled-button.js';
import '@material/web/button/outlined-button.js';
import '@material/web/button/text-button.js';
import '@material/web/chips/chip-set.js';
import '@material/web/chips/filter-chip.js';
import '@material/web/divider/divider.js';

import './pdf2abp.css';
import type { Pdf2AbpStore, Pdf2AbpHealthStatus } from './pdf2abp-store.ts';

export interface LauncherDialogOptions {
  prefillPdfPath?: string;
  onStarted?: (jobId: string) => void;
}

type MdDialogEl = HTMLElement & {
  open: boolean;
  show: () => void | Promise<void>;
  close: () => void | Promise<void>;
};

type MdTextFieldEl = HTMLElement & { value: string };
type MdFilterChipEl = HTMLElement & { selected: boolean; dataset: DOMStringMap };
type MdButtonEl = HTMLElement & { disabled: boolean };

const DIALOG_ID = 'pdf2abp-launcher-dialog';

function renderHealthSummary(health: Pdf2AbpHealthStatus | null): string {
  if (!health) {
    return '正在检测 MinerU 与 Python 运行环境…';
  }
  const mineruText = health.mineru.ready
    ? `MinerU (${health.mineru.preferredEngine})`
    : 'MinerU 未就绪';
  const pyText = health.python.available
    ? `Python (${health.python.version || 'ready'})`
    : 'Python 未检测';
  return `${mineruText} · ${pyText} · ${health.defaultGateway.modelId}`;
}

function ensureDialogElement(): MdDialogEl {
  const existing = document.getElementById(DIALOG_ID) as MdDialogEl | null;
  if (existing) return existing;

  const dialog = document.createElement('md-dialog') as MdDialogEl;
  dialog.id = DIALOG_ID;
  dialog.className = 'pdf2abp-m3-dialog';
  dialog.innerHTML = `
    <div slot="headline" class="pdf2abp-dialog-headline">PDF 数字化编译为 ABP</div>
    <div slot="content" class="pdf2abp-dialog-content">
      <div class="pdf2abp-health-line" id="pdf2abp-health-line">正在检测运行环境…</div>

      <div class="pdf2abp-path-row">
        <md-outlined-text-field
          id="pdf2abp-pdf-path"
          label="源 PDF 路径（本地绝对路径）"
          placeholder="D:\\books\\algorithms.pdf"
          class="pdf2abp-path-input"
        ></md-outlined-text-field>
        <md-outlined-button id="pdf2abp-browse-pdf-btn" type="button">选择文件</md-outlined-button>
      </div>

      <div class="pdf2abp-field-group">
        <span class="pdf2abp-field-label">文献结构模式</span>
        <md-chip-set id="pdf2abp-mode-chips" aria-label="文献结构模式">
          <md-filter-chip label="教材 (textbook)" data-mode="textbook" selected></md-filter-chip>
          <md-filter-chip label="论文 (paper)" data-mode="paper"></md-filter-chip>
          <md-filter-chip label="试卷 (exam)" data-mode="exam"></md-filter-chip>
          <md-filter-chip label="专著 (monograph)" data-mode="monograph"></md-filter-chip>
        </md-chip-set>
      </div>

      <div class="pdf2abp-inline-fields">
        <md-outlined-text-field
          id="pdf2abp-concurrency-input"
          type="number"
          min="1"
          max="24"
          value="12"
          label="并发校对子代理 (1–24)"
          class="pdf2abp-concurrency-input"
        ></md-outlined-text-field>
      </div>

      <md-outlined-text-field
        id="pdf2abp-instructions-input"
        type="textarea"
        rows="3"
        label="附加范围或排版指令（可选）"
        placeholder="例如：仅处理 Preface 与 Chapter 0 到 Chapter 4（含章首导语与课后习题，跳过目录）"
        class="pdf2abp-full-width"
      ></md-outlined-text-field>

      <div class="pdf2abp-dialog-error" id="pdf2abp-dialog-error" hidden></div>
    </div>
    <div slot="actions">
      <md-text-button id="pdf2abp-cancel-btn" type="button">取消</md-text-button>
      <md-filled-button id="pdf2abp-start-btn" type="button">开始构建</md-filled-button>
    </div>
  `;

  const host = document.getElementById('astro-overlay-root') || document.body;
  host.appendChild(dialog);
  return dialog;
}

export async function openPdf2AbpLauncherDialog(
  store: Pdf2AbpStore,
  options: LauncherDialogOptions = {}
): Promise<void> {
  const dialog = ensureDialogElement();
  const pathInput = dialog.querySelector('#pdf2abp-pdf-path') as MdTextFieldEl;
  const browseBtn = dialog.querySelector('#pdf2abp-browse-pdf-btn') as MdButtonEl;
  const modeChips = Array.from(dialog.querySelectorAll('#pdf2abp-mode-chips md-filter-chip')) as MdFilterChipEl[];
  const concurrencyInput = dialog.querySelector('#pdf2abp-concurrency-input') as MdTextFieldEl;
  const instructionsInput = dialog.querySelector('#pdf2abp-instructions-input') as MdTextFieldEl;
  const healthLine = dialog.querySelector('#pdf2abp-health-line') as HTMLElement;
  const errorBox = dialog.querySelector('#pdf2abp-dialog-error') as HTMLElement;
  const cancelBtn = dialog.querySelector('#pdf2abp-cancel-btn') as MdButtonEl;
  const startBtn = dialog.querySelector('#pdf2abp-start-btn') as MdButtonEl;

  errorBox.hidden = true;
  errorBox.textContent = '';

  if (options.prefillPdfPath) {
    pathInput.value = options.prefillPdfPath;
  }

  const bridge = window.astrolibDesktop || window.astrolib;
  if (!bridge?.selectPdfFile) {
    browseBtn.style.display = 'none';
  } else {
    browseBtn.style.display = '';
    browseBtn.onclick = async () => {
      const picked = await bridge.selectPdfFile?.();
      if (picked) {
        pathInput.value = picked;
      }
    };
  }

  // Enforce single-select filter chip group for document mode
  modeChips.forEach((chip) => {
    chip.onclick = () => {
      const selectedMode = chip.dataset.mode || 'textbook';
      modeChips.forEach((c) => {
        c.selected = (c.dataset.mode || '') === selectedMode;
      });
    };
  });

  cancelBtn.onclick = () => {
    void dialog.close();
  };

  startBtn.onclick = async () => {
    const pdfPath = (pathInput.value || '').trim();
    if (!pdfPath) {
      errorBox.textContent = '请填写或选择本地 PDF 文件路径。';
      errorBox.hidden = false;
      return;
    }

    const activeChip = modeChips.find((c) => c.selected);
    const documentMode = (activeChip?.dataset.mode || 'textbook') as
      | 'textbook'
      | 'paper'
      | 'exam'
      | 'monograph';
    const rawConc = Number(concurrencyInput.value || 12);
    const concurrency = Number.isFinite(rawConc)
      ? Math.max(1, Math.min(24, Math.floor(rawConc)))
      : 12;

    startBtn.disabled = true;
    errorBox.hidden = true;
    try {
      const job = await store.startJob({
        pdfPath,
        documentMode,
        concurrency,
        autoImport: true,
        instructions: (instructionsInput.value || '').trim(),
      });
      await dialog.close();
      options.onStarted?.(job.jobId);
    } catch (err) {
      errorBox.textContent = err instanceof Error ? err.message : String(err);
      errorBox.hidden = false;
    } finally {
      startBtn.disabled = false;
    }
  };

  await dialog.show();
  const health = await store.fetchHealth();
  healthLine.textContent = renderHealthSummary(health);
}
