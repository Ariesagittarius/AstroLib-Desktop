/**
 * src/features/library/core/library-dialogs.ts
 * ============================================================================
 * 研读书库 M3 对话框交互控制器 (Token 缺失阻断引导 & 超 200 页页码范围选择)
 * ============================================================================
 */

import { MINERU_MAX_PAGES_PER_PARSE, validatePageRanges } from './entity-status';
import type { OversizedPdfTask } from './ingest-upload-pipeline';

export function showMissingTokenDialog(blockedFileNames: string[]): void {
  const dialog = document.getElementById('dialog-mineru-token-required') as any;
  const listEl = document.getElementById('token-dialog-blocked-files');
  const goBtn = document.getElementById('btn-token-dialog-goto-settings');
  const cancelBtn = document.getElementById('btn-token-dialog-cancel');
  if (!dialog) return;

  if (listEl) {
    listEl.innerHTML = '';
    for (const name of blockedFileNames) {
      const li = document.createElement('li');
      li.textContent = name;
      listEl.appendChild(li);
    }
  }

  const close = () => {
    try {
      dialog.close?.();
    } catch {
      dialog.open = false;
    }
  };

  if (cancelBtn) {
    cancelBtn.onclick = () => close();
  }
  if (goBtn) {
    goBtn.onclick = () => {
      close();
      window.dispatchEvent(
        new CustomEvent('astrolib:open-settings-hub', {
          detail: { panel: 'panel-ingest', section: 'token' },
        })
      );
    };
  }

  if (typeof dialog.show === 'function') {
    dialog.show();
  } else {
    dialog.open = true;
  }
}

export function promptOversizedPdfPageRanges(
  tasks: OversizedPdfTask[]
): Promise<Array<{ taskId: string; pageRanges: string }> | null> {
  return new Promise((resolve) => {
    const dialog = document.getElementById('dialog-pdf-page-range') as any;
    const container = document.getElementById('page-range-tasks-container');
    const confirmBtn = document.getElementById('btn-page-range-confirm') as any;
    const cancelBtn = document.getElementById('btn-page-range-cancel');

    if (!dialog || !container || !confirmBtn || !cancelBtn) {
      resolve(null);
      return;
    }

    container.innerHTML = '';
    const fieldRecords: Array<{
      task: OversizedPdfTask;
      field: any;
      hintEl: HTMLElement;
    }> = [];

    const validateAll = (): Array<{ taskId: string; pageRanges: string }> | null => {
      const results: Array<{ taskId: string; pageRanges: string }> = [];
      let allValid = true;

      for (const rec of fieldRecords) {
        const rawVal = String(rec.field.value || '');
        const check = validatePageRanges(rawVal, rec.task.pageCount, MINERU_MAX_PAGES_PER_PARSE);
        if (check.valid && check.normalized) {
          rec.hintEl.classList.remove('is-error');
          rec.hintEl.textContent = `已选择 ${check.totalSelectedPages} 页（上限 ${MINERU_MAX_PAGES_PER_PARSE} 页），范围合法。`;
          results.push({ taskId: rec.task.taskId, pageRanges: check.normalized });
        } else {
          allValid = false;
          rec.hintEl.classList.add('is-error');
          rec.hintEl.textContent = check.error || '页码格式不合法';
        }
      }

      confirmBtn.disabled = !allValid;
      return allValid ? results : null;
    };

    for (const task of tasks) {
      const item = document.createElement('div');
      item.className = 'page-range-item';

      const head = document.createElement('div');
      head.className = 'page-range-item-head';
      const titleSpan = document.createElement('span');
      titleSpan.textContent = task.fileName;
      const metaSpan = document.createElement('span');
      metaSpan.className = 'page-range-item-meta';
      metaSpan.textContent = `共 ${task.pageCount} 页`;
      head.appendChild(titleSpan);
      head.appendChild(metaSpan);

      const field = document.createElement('md-outlined-text-field') as any;
      field.className = 'page-range-field';
      field.label = `输入要解析的页码范围（单次最多 ${MINERU_MAX_PAGES_PER_PARSE} 页，如 1-200 或 1-80,120-200）`;
      field.value = task.defaultRange || `1-${Math.min(task.pageCount, MINERU_MAX_PAGES_PER_PARSE)}`;

      const hintEl = document.createElement('div');
      hintEl.className = 'page-range-hint';

      field.addEventListener('input', () => {
        validateAll();
      });

      item.appendChild(head);
      item.appendChild(field);
      item.appendChild(hintEl);
      container.appendChild(item);

      fieldRecords.push({ task, field, hintEl });
    }

    validateAll();

    let settled = false;
    const finish = (value: Array<{ taskId: string; pageRanges: string }> | null) => {
      if (settled) return;
      settled = true;
      try {
        dialog.close?.();
      } catch {
        dialog.open = false;
      }
      resolve(value);
    };

    cancelBtn.onclick = () => finish(null);
    confirmBtn.onclick = () => {
      const validated = validateAll();
      if (validated) {
        finish(validated);
      }
    };
    dialog.addEventListener(
      'closed',
      () => {
        if (!settled) {
          settled = true;
          resolve(null);
        }
      },
      { once: true }
    );

    if (typeof dialog.show === 'function') {
      dialog.show();
    } else {
      dialog.open = true;
    }
  });
}
