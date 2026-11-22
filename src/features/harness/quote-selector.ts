import type { QuoteSnippet } from './types.ts';

export function bindQuoteSelector(options: {
  messagesContainer: HTMLElement;
  onQuoteSelected: (snippet: QuoteSnippet) => void;
}): () => void {
  const { messagesContainer, onQuoteSelected } = options;

  let pillEl = document.getElementById('harness-quote-pill') as HTMLButtonElement | null;
  if (!pillEl) {
    pillEl = document.createElement('button');
    pillEl.id = 'harness-quote-pill';
    pillEl.type = 'button';
    pillEl.className = 'harness-quote-float-pill';
    pillEl.hidden = true;
    pillEl.innerHTML = `
      <span class="material-symbols-outlined" style="font-size:15px;" aria-hidden="true">format_quote</span>
      <span>引用提问</span>
    `;
    document.body.appendChild(pillEl);
  }

  let pendingSnippet: QuoteSnippet | null = null;

  const hidePill = () => {
    if (pillEl) pillEl.hidden = true;
    pendingSnippet = null;
  };

  const evaluateSelection = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      hidePill();
      return;
    }

    const text = sel.toString().replace(/\s+/g, ' ').trim();
    if (text.length < 4) {
      hidePill();
      return;
    }

    const range = sel.getRangeAt(0);
    const commonEl =
      range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
        ? (range.commonAncestorContainer as HTMLElement)
        : range.commonAncestorContainer.parentElement;

    if (!commonEl || !messagesContainer.contains(commonEl)) {
      hidePill();
      return;
    }

    const assistantMsg = commonEl.closest<HTMLElement>('.harness-message--assistant');
    if (!assistantMsg || commonEl.closest('button, input, textarea')) {
      hidePill();
      return;
    }

    const rect = range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      hidePill();
      return;
    }

    pendingSnippet = {
      id: `qt-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      messageId: assistantMsg.dataset.msgId || '',
      authorLabel: '助手回复',
      text: text.length > 260 ? text.slice(0, 260) + '…' : text,
      createdAt: Date.now(),
    };

    const top = Math.max(12, rect.top - 38);
    const left = Math.min(window.innerWidth - 130, Math.max(12, rect.left + rect.width / 2 - 48));
    if (pillEl) {
      pillEl.style.top = `${top}px`;
      pillEl.style.left = `${left}px`;
      pillEl.hidden = false;
    }
  };

  const onMouseUp = () => window.setTimeout(evaluateSelection, 20);
  const onPointerDown = (ev: PointerEvent) => {
    const t = ev.target as Node | null;
    if (pillEl && t && pillEl.contains(t)) return;
    hidePill();
  };
  const onPillClick = (ev: MouseEvent) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (!pendingSnippet) return;
    const snap = pendingSnippet;
    window.getSelection()?.removeAllRanges();
    hidePill();
    onQuoteSelected(snap);
  };

  messagesContainer.addEventListener('mouseup', onMouseUp);
  messagesContainer.addEventListener('scroll', hidePill, { passive: true });
  document.addEventListener('pointerdown', onPointerDown);
  pillEl.addEventListener('mousedown', (e) => e.preventDefault());
  pillEl.addEventListener('click', onPillClick);

  return () => {
    messagesContainer.removeEventListener('mouseup', onMouseUp);
    messagesContainer.removeEventListener('scroll', hidePill);
    document.removeEventListener('pointerdown', onPointerDown);
    pillEl?.removeEventListener('click', onPillClick);
  };
}
