/**
 * src/services/translation/client/translation-card-helpers.ts
 * ============================================================================
 * AstroLib 双语助读卡片辅助渲染与内联微调纯函数
 * ============================================================================
 */

import type { ParagraphUnit } from '../types';
import { TranslationStorage } from '../storage/translation-storage';
import { renderMathInElementSafely } from './translation-inline-view';

export function getTypeLabel(type: ParagraphUnit['type']): string {
  switch (type) {
    case 'heading':
      return '标题';
    case 'card-title':
      return '卡片标题';
    case 'table-cell':
      return '表格';
    case 'math':
      return '公式';
    case 'code':
      return '算法';
    case 'quote':
      return '引言';
    case 'card':
      return '专栏';
    default:
      return '段落';
  }
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface CardEditorOptions {
  card: HTMLElement;
  unit: ParagraphUnit;
  updateCardBadges: (card: HTMLElement, unit: ParagraphUnit) => void;
  updateSatisfiedCountBadge: () => void;
}

export function handleStartInlineEdit(options: CardEditorOptions): void {
  const { card, unit, updateCardBadges, updateSatisfiedCountBadge } = options;
  const body = card.querySelector<HTMLElement>('.trans-card-body');
  const targetElem = card.querySelector<HTMLElement>('.trans-target-text');
  if (!body || !targetElem) return;

  if (card.querySelector('.trans-card-editor-box')) return;

  targetElem.style.display = 'none';

  const editorBox = document.createElement('div');
  editorBox.className = 'trans-card-editor-box';
  editorBox.innerHTML = `
    <textarea class="trans-card-textarea" rows="3" placeholder="在此编辑或精修译文...">${escapeHtml(unit.translatedText || unit.sourceText)}</textarea>
    <div class="trans-card-editor-actions">
      <button type="button" class="trans-editor-save-btn">保存微调</button>
      <button type="button" class="trans-editor-cancel-btn">取消</button>
    </div>
  `;

  body.appendChild(editorBox);

  const textarea = editorBox.querySelector<HTMLTextAreaElement>('.trans-card-textarea');
  const saveBtn = editorBox.querySelector<HTMLButtonElement>('.trans-editor-save-btn');
  const cancelBtn = editorBox.querySelector<HTMLButtonElement>('.trans-editor-cancel-btn');

  const closeEditor = () => {
    editorBox.remove();
    targetElem.style.display = '';
  };

  const saveAction = () => {
    const val = textarea?.value.trim() ?? '';
    if (val) {
      unit.translatedText = val;
      unit.isCustomEdited = true;
      unit.isSatisfied = true;
      unit.status = 'done';
      TranslationStorage.updateCustomTranslation(TranslationStorage.normalizeKey(), unit.id, val);

      card.classList.add('is-satisfied');
      const satisfyBtn = card.querySelector<HTMLButtonElement>('.trans-card-satisfy-btn');
      if (satisfyBtn) {
        satisfyBtn.classList.add('is-satisfied');
        satisfyBtn.title = '取消采纳';
        const icon = satisfyBtn.querySelector('md-icon');
        if (icon) icon.textContent = 'star';
      }

      updateCardBadges(card, unit);
      updateSatisfiedCountBadge();

      targetElem.textContent = val;
      renderMathInElementSafely(targetElem);
    }
    closeEditor();
  };

  if (textarea) {
    textarea.focus();
    textarea.addEventListener('click', (e) => e.stopPropagation());
    textarea.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        saveAction();
      }
    });
  }

  saveBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    saveAction();
  });

  cancelBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    closeEditor();
  });
}
