/**
 * src/ai/client/chat-dock.ts
 * AI Chat 侧载/浮窗停靠与恢复逻辑封装
 */
import { sideloadManager } from '../../components/sideload/sideload-manager';
import { getAiSideloadRefChapter } from '../ai-config';

export const DOCKED_STORAGE_KEY = 'astrolib_ai_docked';

export interface ChatDockHost {
  element: HTMLElement;
  panel: HTMLElement;
  fab: HTMLElement;
  dockBtn: HTMLElement | null;
  dockIcon: HTMLElement | null;
  undockIcon: HTMLElement | null;
  sideloadBackBtn: HTMLElement | null;
  input: HTMLTextAreaElement | null;
  history: HTMLElement | null;
  historyBtn: HTMLElement | null;
  originalParent: HTMLElement | null;
  originalNextSibling: Node | null;
  isDocked: boolean;
  enableChapterReference: () => void;
  disableChapterReference: () => void;
  scrollThread: () => void;
}

export function performChatDock(host: ChatDockHost, immediate = false): void {
  if (typeof window === 'undefined') return;
  const mountEl = document.getElementById('ai-sidebar-panel');
  if (!mountEl) {
    console.warn('[AIAsk] 未找到右侧栏挂载点 #ai-sidebar-panel');
    return;
  }

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const performDock = () => {
    if (!host.originalParent || host.originalParent === mountEl || host.originalParent.id === 'ai-sidebar-panel') {
      const overlayRoot = document.getElementById('astro-overlay-root') || document.getElementById('astrolib-overlay-root') || document.body;
      host.originalParent = host.element.parentElement && host.element.parentElement !== mountEl ? (host.element.parentElement as HTMLElement) : overlayRoot;
      host.originalNextSibling = host.element.nextSibling;
    }

    host.isDocked = true;
    try { localStorage.setItem(DOCKED_STORAGE_KEY, 'true'); } catch {}

    mountEl.appendChild(host.element);
    mountEl.setAttribute('aria-hidden', 'false');
    host.element.classList.add('is-docked');
    if (!immediate) {
      host.element.classList.add('docking-in');
    } else {
      host.element.classList.remove('docking-in');
    }
    if (host.panel) {
      host.panel.classList.remove('docking-out', 'dock-settled');
      host.panel.classList.add('is-docked', 'ask-open');
    }

    if (host.dockBtn) {
      host.dockBtn.title = '从侧边栏返回浮窗 (Alt+D)';
      host.dockBtn.setAttribute('aria-label', '从侧边栏返回浮窗');
    }
    if (host.dockIcon) host.dockIcon.style.display = 'none';
    if (host.undockIcon) host.undockIcon.style.display = '';
    if (host.sideloadBackBtn) host.sideloadBackBtn.style.display = 'inline-flex';

    if (host.fab) {
      host.fab.style.setProperty('display', 'none', 'important');
      host.fab.setAttribute('hidden', '');
    }

    sideloadManager.open('ai');

    if (getAiSideloadRefChapter()) {
      host.enableChapterReference();
    } else {
      host.disableChapterReference();
    }

    if (!immediate) {
      setTimeout(() => {
        host.element.classList.remove('docking-in');
      }, 280);
    } else {
      host.element.classList.remove('docking-in');
    }

    requestAnimationFrame(() => {
      host.scrollThread();
      host.input && host.input.focus({ preventScroll: true });
    });
  };

  if (!immediate && !prefersReducedMotion && host.panel && host.panel.classList.contains('ask-open')) {
    host.panel.classList.add('docking-out');
    setTimeout(performDock, 130);
  } else {
    performDock();
  }
}

export function performChatUndock(host: ChatDockHost, keepOpen = true): void {
  if (typeof window === 'undefined') return;
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const performUndock = () => {
    sideloadManager.switchToDefault();
    performChatUndockInternal(host, keepOpen);
  };

  if (!prefersReducedMotion && host.panel && host.isDocked) {
    host.element.classList.add('docking-out');
    setTimeout(performUndock, 110);
  } else {
    performUndock();
  }
}

export function performChatUndockInternal(host: ChatDockHost, keepOpen = true): void {
  if (!host.isDocked) return;
  host.isDocked = false;
  host.disableChapterReference();
  try { localStorage.setItem(DOCKED_STORAGE_KEY, 'false'); } catch {}

  host.element.classList.remove('is-docked', 'docking-out');
  if (host.panel) {
    host.panel.classList.remove('is-docked', 'docking-out');
  }

  const mountEl = document.getElementById('ai-sidebar-panel');
  if (mountEl) {
    mountEl.setAttribute('aria-hidden', 'true');
  }

  let targetParent = host.originalParent;
  if (!targetParent || (mountEl && targetParent === mountEl) || targetParent.id === 'ai-sidebar-panel' || !document.body.contains(targetParent)) {
    targetParent = document.getElementById('astro-overlay-root') || document.getElementById('astrolib-overlay-root') || document.body;
  }
  if (host.originalNextSibling && host.originalNextSibling.parentElement === targetParent) {
    targetParent.insertBefore(host.element, host.originalNextSibling);
  } else {
    targetParent.appendChild(host.element);
  }

  if (host.fab) {
    host.fab.style.removeProperty('display');
    host.fab.removeAttribute('hidden');
    host.fab.classList.add('fab-restoring');
    setTimeout(() => {
      host.fab && host.fab.classList.remove('fab-restoring');
    }, 240);
  }

  if (host.dockBtn) {
    host.dockBtn.title = '前往侧边栏 (Alt+D)';
    host.dockBtn.setAttribute('aria-label', '前往侧边栏');
  }
  if (host.dockIcon) host.dockIcon.style.display = '';
  if (host.undockIcon) host.undockIcon.style.display = 'none';
  if (host.sideloadBackBtn) host.sideloadBackBtn.style.display = 'none';

  if (keepOpen) {
    host.panel.classList.remove('dock-settled');
    host.panel.classList.add('ask-open', 'docking-in');

    let settled = false;
    const settleDock = () => {
      if (settled) return;
      settled = true;
      if (host.panel) {
        host.panel.removeEventListener('animationend', settleDock);
        host.panel.classList.remove('docking-in');
        host.panel.classList.add('dock-settled');
      }
    };

    host.panel.addEventListener('animationend', settleDock, { once: true });
    setTimeout(settleDock, 260);

    requestAnimationFrame(() => {
      host.input && host.input.focus({ preventScroll: true });
    });
  } else {
    host.panel.classList.remove('ask-open', 'dock-settled', 'docking-in');
    host.history && host.history.classList.remove('open');
    host.historyBtn && host.historyBtn.classList.remove('ask-settings-open');
  }
  requestAnimationFrame(() => host.scrollThread());
}
