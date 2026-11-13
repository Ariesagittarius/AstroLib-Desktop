/**
 * src/ai/client/chat-tools-view.ts
 * ============================================================================
 * Tools Calling Log & Inspection View Renderer for AI Chat
 * ============================================================================
 */

import { esc, jsonHighlight, capJsonText } from './chat-formatter';
import { formatExplorationSummary } from '../ai-config';

export function jsonHtml(v: any, cap = 1400): string {
  if (v === undefined || v === null) return '<span class="tok-null">null</span>';
  if (typeof v === 'string') {
    const raw = esc(v.length > cap ? v.slice(0, cap) + `\n… (其余 ${v.length - cap} 字符已折叠)` : v);
    return `<span class="tok-str">"${raw}"</span>`;
  }
  const pretty = capJsonText(v, cap);
  return jsonHighlight(esc(pretty));
}

export function renderToolBlocksHtml(toolLog: any[], isOpen = false): string {
  if (!toolLog || !toolLog.length) return '';
  const items = toolLog.map((t: any) => {
    const raw = t.resultRaw !== undefined ? t.resultRaw : t.resultText;
    const cleanSummary = (t.summary || '').replace(/\s+/g, ' ').trim();
    let countBadge = '';
    if (raw && Array.isArray(raw.results)) countBadge = ` (${raw.results.length})`;
    else if (raw && Array.isArray(raw.hits)) countBadge = ` (${raw.hits.length})`;
    else if (Array.isArray(raw)) countBadge = ` (${raw.length})`;

    return `
      <details class="ask-tool" ${isOpen ? 'open' : ''}>
        <summary class="ask-tool-summary" title="${esc(cleanSummary)}">
          <svg class="ask-tool-chevron" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
          <span class="ask-tool-badge">Tool</span>
          <span class="ask-tool-name">${esc(t.name)}</span>
          <span class="ask-tool-sum">${esc(cleanSummary)}</span>
        </summary>
        <div class="ask-tool-panel">
          <div class="ask-tool-panel-header">
            <div class="ask-tool-tabs" role="tablist" aria-label="工具数据切换">
              <button type="button" class="ask-tool-tab active" data-tab="result" role="tab" aria-selected="true">
                <span class="ask-tool-tab-label">返回结果</span><span class="ask-tool-tab-count">${countBadge}</span>
              </button>
              <button type="button" class="ask-tool-tab" data-tab="args" role="tab" aria-selected="false">
                <span class="ask-tool-tab-label">调用参数</span>
              </button>
            </div>
            <button type="button" class="ask-tool-copy-btn" title="复制当前数据" aria-label="复制当前数据">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
              <span class="ask-tool-copy-text">复制</span>
            </button>
          </div>
          <div class="ask-tool-pane ask-tool-pane-result" role="tabpanel">
            <pre>${jsonHtml(raw)}</pre>
          </div>
          <div class="ask-tool-pane ask-tool-pane-args" role="tabpanel" style="display:none;">
            <pre>${jsonHtml(t.args)}</pre>
          </div>
        </div>
      </details>`;
  }).join('');
  return `<div class="ask-tool-block">${items}</div>`;
}

export function renderToolsGroupHtml(tools: any[], isOpen = false): string {
  if (!tools || !tools.length) return '';
  const summaryText = formatExplorationSummary(tools);
  const toolItemsHtml = renderToolBlocksHtml(tools, false);
  return `
    <details class="ask-tools-group" ${isOpen ? 'open' : ''}>
      <summary class="ask-tools-group-summary" title="点击展开/收起工具调用详情">
        <span class="ask-tools-group-title">${esc(summaryText)}</span>
        <svg class="ask-tools-group-chevron" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="9 18 15 12 9 6"></polyline>
        </svg>
      </summary>
      <div class="ask-tools-group-items">
        ${toolItemsHtml}
      </div>
    </details>
  `;
}

export function collapseTools(container: HTMLElement): void {
  if (!container) return;
  const tools = container.querySelectorAll<HTMLDetailsElement>('details.ask-tool[open]');
  for (const t of Array.from(tools)) {
    t.removeAttribute('open');
  }
}

export function collapsePreceding(
  messagesEl: HTMLElement | null,
  isPrecedingCollapsed: boolean,
  collapseBtn: HTMLElement | null,
  forceCollapse?: boolean
): boolean {
  if (!messagesEl) return isPrecedingCollapsed;
  const aiMsgs = Array.from(messagesEl.querySelectorAll<HTMLElement>('.ask-msg-ai'));
  if (aiMsgs.length === 0) return isPrecedingCollapsed;

  const shouldCollapse = forceCollapse !== undefined ? forceCollapse : !isPrecedingCollapsed;

  if (aiMsgs.length === 1) {
    if (forceCollapse === undefined) {
      const tools = aiMsgs[0].querySelectorAll<HTMLDetailsElement>('details.ask-tool, details.ask-think, details.ask-tools-group');
      for (const t of Array.from(tools)) {
        if (shouldCollapse) t.removeAttribute('open');
        else t.setAttribute('open', '');
      }
    }
  } else {
    const preceding = aiMsgs.slice(0, -1);
    for (const msg of preceding) {
      const tools = msg.querySelectorAll<HTMLDetailsElement>('details.ask-tool, details.ask-think, details.ask-tools-group');
      for (const t of Array.from(tools)) {
        if (shouldCollapse) {
          t.removeAttribute('open');
        } else {
          t.setAttribute('open', '');
        }
      }
    }
    if (!shouldCollapse && forceCollapse === undefined) {
      const lastTools = aiMsgs[aiMsgs.length - 1].querySelectorAll<HTMLDetailsElement>('details.ask-tool, details.ask-think, details.ask-tools-group');
      for (const t of Array.from(lastTools)) {
        t.setAttribute('open', '');
      }
    }
  }

  updateCollapseBtnState(collapseBtn, shouldCollapse);
  return shouldCollapse;
}

export function updateCollapseBtnState(collapseBtn: HTMLElement | null, isPrecedingCollapsed: boolean): void {
  if (!collapseBtn) return;
  const iconLess = collapseBtn.querySelector<HTMLElement>('.icon-unfold-less');
  const iconMore = collapseBtn.querySelector<HTMLElement>('.icon-unfold-more');
  if (isPrecedingCollapsed) {
    if (iconLess) iconLess.style.display = 'none';
    if (iconMore) iconMore.style.display = '';
    collapseBtn.title = '展开所有过程';
    collapseBtn.setAttribute('aria-label', '展开所有过程');
  } else {
    if (iconLess) iconLess.style.display = '';
    if (iconMore) iconMore.style.display = 'none';
    collapseBtn.title = '折叠前序过程';
    collapseBtn.setAttribute('aria-label', '折叠前序过程');
  }
}
