/**
 * src/features/harness/question-widget-renderer.ts
 * ============================================================================
 * M3 交互式用户追问卡片渲染器 (ask_user_questions / /grill-me)
 * ============================================================================
 */

import type { QuestionBlock, QuestionItem } from './types.ts';

function esc(str: unknown): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderQuestionBlockElement(
  block: QuestionBlock,
  existingEl: HTMLElement | null,
  onSubmit: (
    questionId: string,
    result: { status: 'submitted' | 'skipped'; answers: Record<string, string | string[]> }
  ) => void
): HTMLElement {
  const host = existingEl || document.createElement('div');
  host.className = 'harness-question-block';
  host.dataset.blockId = block.id;
  host.dataset.questionId = block.questionId;

  const isPending = block.status === 'pending';
  const prevStateKey = host.dataset.renderedStatus || '';
  // 若已渲染为 pending 且仍处于 pending 状态，严禁重置用户正在勾选/输入的表单控件！
  if (existingEl && prevStateKey === 'pending' && isPending) {
    return existingEl;
  }
  host.dataset.renderedStatus = block.status;

  if (!isPending) {
    const summaryRows = block.questions
      .map((q) => {
        const rawAns = block.answers?.[q.id];
        const ansStr = Array.isArray(rawAns) ? rawAns.join('、') : rawAns || '（未选）';
        return `<div class="harness-q-resolved-row"><span class="harness-q-resolved-q">${esc(q.question)}</span><span class="harness-q-resolved-a">${esc(block.status === 'skipped' ? '已跳过' : ansStr)}</span></div>`;
      })
      .join('');

    host.innerHTML = `
      <div class="harness-q-card is-resolved">
        <div class="harness-q-card__head">
          <span class="material-symbols-outlined" style="font-size:18px;color:var(--md-sys-color-primary);" aria-hidden="true">${block.status === 'skipped' ? 'skip_next' : 'check_circle'}</span>
          <span class="harness-q-card__title">${esc(block.title || '需求澄清已确认')}</span>
          <span class="harness-q-card__badge">${block.status === 'skipped' ? '已跳过' : '已提交'}</span>
        </div>
        <div class="harness-q-resolved-list">${summaryRows}</div>
      </div>
    `;
    return host;
  }

  const questionsHtml = block.questions
    .map((q: QuestionItem, qIdx: number) => {
      const inputType = q.multiSelect ? 'checkbox' : 'radio';
      const groupName = `q_${esc(block.questionId)}_${esc(q.id)}`;
      const optsHtml = (q.options || [])
        .map(
          (opt, oIdx) => `
          <label class="harness-q-option">
            <input type="${inputType}" name="${groupName}" value="${esc(opt.label)}" ${!q.multiSelect && oIdx === 0 && opt.recommended ? 'checked' : ''} />
            <div class="harness-q-option__body">
              <div class="harness-q-option__title">
                <span>${esc(opt.label)}</span>
                ${opt.recommended ? '<span class="harness-q-rec-badge">推荐</span>' : ''}
              </div>
              ${opt.description ? `<div class="harness-q-option__desc">${esc(opt.description)}</div>` : ''}
            </div>
          </label>
        `
        )
        .join('');

      const customHtml =
        q.allowCustom !== false
          ? `<input type="text" class="harness-q-custom-input" data-q-custom="${esc(q.id)}" placeholder="其他补充说明（可选）..." />`
          : '';

      return `
        <div class="harness-q-item" data-q-id="${esc(q.id)}">
          <div class="harness-q-item__label">${qIdx + 1}. ${esc(q.question)}${q.multiSelect ? ' <span class="harness-q-multi-tag">(可多选)</span>' : ''}</div>
          <div class="harness-q-options">${optsHtml}</div>
          ${customHtml}
        </div>
      `;
    })
    .join('');

  host.innerHTML = `
    <div class="harness-q-card is-pending">
      <div class="harness-q-card__head">
        <span class="material-symbols-outlined" style="font-size:18px;color:var(--md-sys-color-primary);" aria-hidden="true">help_outline</span>
        <span class="harness-q-card__title">${esc(block.title || '请确认设计决策与需求边界')}</span>
      </div>
      <div class="harness-q-items">${questionsHtml}</div>
      <div class="harness-q-actions">
        <button type="button" class="harness-followup-btn" data-q-skip>跳过</button>
        <button type="button" class="harness-q-submit-btn" data-q-submit>提交回答</button>
      </div>
    </div>
  `;

  host.querySelector('[data-q-skip]')?.addEventListener('click', () => {
    onSubmit(block.questionId, { status: 'skipped', answers: {} });
  });

  host.querySelector('[data-q-submit]')?.addEventListener('click', () => {
    const answers: Record<string, string | string[]> = {};
    for (const q of block.questions) {
      const qEl = host.querySelector<HTMLElement>(`.harness-q-item[data-q-id="${CSS.escape(q.id)}"]`);
      const checked = Array.from(
        qEl?.querySelectorAll<HTMLInputElement>('input[type="radio"]:checked, input[type="checkbox"]:checked') || []
      ).map((inp) => inp.value);
      const customVal = (
        qEl?.querySelector<HTMLInputElement>('[data-q-custom]')?.value || ''
      ).trim();

      if (q.multiSelect) {
        const list = [...checked];
        if (customVal) list.push(customVal);
        answers[q.id] = list;
      } else {
        answers[q.id] = customVal || checked[0] || '';
      }
    }
    onSubmit(block.questionId, { status: 'submitted', answers });
  });

  return host;
}
