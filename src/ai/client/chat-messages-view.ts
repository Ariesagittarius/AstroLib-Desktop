/**
 * src/ai/client/chat-messages-view.ts
 * ============================================================================
 * Messages View Event Delegation & Sources Rendering for AI Chat
 * ============================================================================
 */

import { safeLink } from './chat-markdown';
import { renderTitleHtml } from '../../utils/render-title';

export interface MessagesViewHost {
  retryLast(): void;
  sourceOpenNew(): boolean;
}

export function bindMessagesViewEvents(messagesEl: HTMLElement, host: MessagesViewHost): void {
  messagesEl.addEventListener('click', (e: MouseEvent) => {
    const targetEl = e.target as HTMLElement;

    // 工具面板 Tab 切换 (结果 / 参数)
    const tabBtn = targetEl.closest('.ask-tool-tab');
    if (tabBtn) {
      e.preventDefault();
      const panel = tabBtn.closest('.ask-tool-panel');
      if (!panel) return;
      const targetTab = tabBtn.getAttribute('data-tab');
      panel.querySelectorAll('.ask-tool-tab').forEach((b) => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      tabBtn.classList.add('active');
      tabBtn.setAttribute('aria-selected', 'true');
      const paneResult = panel.querySelector('.ask-tool-pane-result') as HTMLElement;
      const paneArgs = panel.querySelector('.ask-tool-pane-args') as HTMLElement;
      if (targetTab === 'result') {
        if (paneResult) paneResult.style.display = '';
        if (paneArgs) paneArgs.style.display = 'none';
      } else {
        if (paneResult) paneResult.style.display = 'none';
        if (paneArgs) paneArgs.style.display = '';
      }
      return;
    }

    // 工具数据复制
    const copyBtn = targetEl.closest('.ask-tool-copy-btn');
    if (copyBtn) {
      e.preventDefault();
      const panel = copyBtn.closest('.ask-tool-panel');
      if (!panel) return;
      const activePane = panel.querySelector<HTMLElement>(
        '.ask-tool-pane:not([style*="display: none"]):not([style*="display:none"]) pre'
      );
      const text = activePane ? activePane.textContent || '' : '';
      if (text) {
        navigator.clipboard.writeText(text).then(() => {
          const label = copyBtn.querySelector('.ask-tool-copy-text');
          if (label) {
            const orig = label.textContent;
            label.textContent = '已复制';
            setTimeout(() => { label.textContent = orig; }, 1500);
          }
        }).catch(() => {});
      }
      return;
    }

    // 错误卡片重试
    const retryBtn = targetEl.closest('.ask-error-retry-btn');
    if (retryBtn) {
      e.preventDefault();
      host.retryLast();
      return;
    }

    // 错误卡片打开快速设置调整模型
    const settingsTrigger = targetEl.closest('.ask-error-settings-btn');
    if (settingsTrigger) {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('astrolib:open-settings', { detail: { section: 'ai' } }));
      return;
    }

    // 错误卡片完整日志复制
    const copyErrBtn = targetEl.closest('.ask-error-copy-btn');
    if (copyErrBtn) {
      e.preventDefault();
      const card = copyErrBtn.closest('.ask-error-card');
      const pre = card?.querySelector('.ask-error-raw-pre code');
      const text = pre ? pre.textContent || '' : '';
      if (text) {
        navigator.clipboard.writeText(text).then(() => {
          const label = copyErrBtn.querySelector('.ask-copy-label');
          if (label) {
            const orig = label.textContent;
            label.textContent = '已复制';
            setTimeout(() => { label.textContent = orig; }, 1500);
          }
        }).catch(() => {});
      }
      return;
    }

    // 链接点击处理与平滑滚动
    const link = targetEl.closest('a');
    if (!link || !link.href) return;
    const rawHref = link.getAttribute('href') || '';
    if (!rawHref || rawHref.startsWith('javascript:')) return;
    if (link.target === '_blank') return;

    try {
      const url = new URL(link.href, location.href);
      if (url.origin === location.origin) {
        const currentPath = location.pathname.replace(/\/$/, '');
        const targetPath = url.pathname.replace(/\/$/, '');
        const hash = url.hash ? decodeURIComponent(url.hash.slice(1)) : '';

        if (currentPath === targetPath && hash) {
          e.preventDefault();
          const elem = document.getElementById(hash) || document.querySelector(`[id="${CSS.escape(hash)}"]`);
          if (elem) {
            elem.scrollIntoView({ behavior: 'smooth', block: 'start' });
          } else {
            location.hash = url.hash;
          }
        }
      }
    } catch {}
  });
}

export function renderSourcesHtml(
  el: HTMLElement,
  hits: any[],
  openNew: boolean
): void {
  el.innerHTML = '';
  if (!hits.length) {
    el.style.display = 'none';
    return;
  }
  el.style.display = '';
  const label = document.createElement('div');
  label.className = 'ask-sources-label';
  label.textContent = '来源（点击可跳转原文）';
  el.appendChild(label);

  hits.forEach((h: any, i: number) => {
    const a = document.createElement('a');
    a.className = 'ask-source';
    a.id = `ai-cite-${i + 1}`;
    const targetUrl = safeLink(h.chunk.url);
    a.href = targetUrl;
    a.target = openNew ? '_blank' : '_self';
    a.rel = openNew ? 'noopener' : '';

    a.addEventListener('click', (e) => {
      if (!targetUrl) return;
      const currentPath = window.location.pathname.replace(/\/$/, '') || '/';
      const urlParts = targetUrl.split('#');
      const targetPath = (urlParts[0] || '').replace(/\/$/, '');
      const targetHash = urlParts[1] ? decodeURIComponent(urlParts[1]) : '';

      if (!targetPath || targetPath === currentPath) {
        e.preventDefault();
        if (targetHash) {
          const targetEl = document.getElementById(targetHash);
          if (targetEl) {
            targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            targetEl.classList.add('card-ref-flash');
            setTimeout(() => targetEl.classList.remove('card-ref-flash'), 700);
            return;
          }
        }
      }

      e.preventDefault();
      if (typeof (window as any).__spaNavigate === 'function') {
        (window as any).__spaNavigate(targetUrl);
      } else {
        window.location.href = targetUrl;
      }
    });

    const head = document.createElement('div');
    head.className = 'ask-source-head';
    const type = document.createElement('span');
    type.className = 'ask-source-type';
    type.textContent = `${i + 1}·${h.chunk.type || '正文'}`;
    const t = document.createElement('span');
    t.className = 'ask-source-title';
    const rawTitle = h.chunk.title || `${h.chunk.type || '正文'}（第 ${i + 1} 条）`;
    t.innerHTML = renderTitleHtml(rawTitle);
    head.appendChild(type);
    head.appendChild(t);
    a.appendChild(head);

    const snip = document.createElement('div');
    snip.className = 'ask-source-snip';
    snip.textContent = (h.chunk.text || '').replace(/\s+/g, ' ').trim().slice(0, 110) + '…';
    a.appendChild(snip);

    el.appendChild(a);
  });
}
