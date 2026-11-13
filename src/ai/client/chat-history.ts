/**
 * src/ai/client/chat-history.ts
 * ============================================================================
 * Thread History List & Management for AI Chat
 * ============================================================================
 */

import { ThreadStore, MAX_THREADS } from './thread-store';

export interface HistoryHost {
  getThreads(): any[];
  setThreads(threads: any[]): void;
  loadThreads(): any[];
  saveThreads(threads: any[]): void;
  getActiveThread(): any;
  setActiveThread(t: any): void;
  saveActiveThreadId(id: string): void;
  getActiveKey(): string;
  renderThread(t: any): void;
  closeHistory(): void;
  updateSendState(): void;
  newThread(): any;
  getInput(): HTMLTextAreaElement | null;
  growInput(): void;
  abortCurrent(): void;
  setBusy(busy: boolean): void;
  setStreaming(streaming: boolean): void;
}

export class ChatHistoryManager {
  private host: HistoryHost;

  constructor(host: HistoryHost) {
    this.host = host;
  }

  public relTime(ts: number): string {
    return ThreadStore.formatRelativeTime(ts);
  }

  public renderHistoryList(container: HTMLElement, emptyEl: HTMLElement | null): void {
    const threads = (this.host.getThreads() || this.host.loadThreads())
      .slice()
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    container.innerHTML = '';
    if (emptyEl) emptyEl.style.display = threads.length ? 'none' : '';

    const activeThread = this.host.getActiveThread();

    for (const t of threads) {
      const item = document.createElement('md-list-item');
      item.className = 'ask-history-item';
      if (activeThread && activeThread.id === t.id) {
        item.classList.add('ask-history-item-active');
      }
      item.dataset.id = t.id;
      item.type = 'button';

      const icon = document.createElement('svg');
      icon.slot = 'start';
      icon.setAttribute('viewBox', '0 0 24 24');
      icon.setAttribute('width', '20');
      icon.setAttribute('height', '20');
      icon.setAttribute('fill', 'none');
      icon.setAttribute('stroke', 'currentColor');
      icon.setAttribute('stroke-width', '2');
      icon.setAttribute('stroke-linecap', 'round');
      icon.setAttribute('stroke-linejoin', 'round');
      icon.innerHTML = '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>';

      const headline = document.createElement('div');
      headline.slot = 'headline';
      headline.className = 'ask-history-headline';
      headline.textContent = (t.title || '新会话').slice(0, 32);

      const supporting = document.createElement('div');
      supporting.slot = 'supporting-text';
      supporting.className = 'ask-history-meta';
      supporting.textContent = `${this.relTime(t.updatedAt)} · ${(t.messages || []).length} 条对话`;

      const delBtn = document.createElement('button');
      delBtn.slot = 'end';
      delBtn.type = 'button';
      delBtn.className = 'ask-history-del-btn';
      delBtn.title = '删除会话';
      delBtn.setAttribute('aria-label', '删除会话');
      delBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>`;

      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.deleteThread(t.id, container, emptyEl);
      });

      item.appendChild(icon);
      item.appendChild(headline);
      item.appendChild(supporting);
      item.appendChild(delBtn);

      item.addEventListener('click', (e) => {
        if (delBtn.contains(e.target as Node)) return;
        this.loadThreadById(t.id);
      });

      container.appendChild(item);
    }
  }

  public loadThreadById(id: string): void {
    const threads = this.host.getThreads() || this.host.loadThreads();
    const t = threads.find((x) => x.id === id);
    if (!t) return;
    this.host.abortCurrent();
    this.host.setBusy(false);
    this.host.setStreaming(false);
    this.host.setActiveThread(t);
    this.host.saveActiveThreadId(id);
    this.host.renderThread(t);
    this.host.closeHistory();
    this.host.updateSendState();
  }

  public deleteThread(id: string, container: HTMLElement, emptyEl: HTMLElement | null): void {
    this.host.abortCurrent();
    this.host.setBusy(false);
    this.host.setStreaming(false);
    let threads = this.host.getThreads() || this.host.loadThreads();
    threads = threads.filter((x) => x.id !== id);
    this.host.setThreads(threads);
    this.host.saveThreads(threads);

    const active = this.host.getActiveThread();
    if (active && active.id === id) {
      this.host.setActiveThread(null);
      try {
        localStorage.removeItem(this.host.getActiveKey());
      } catch {}
      this.host.renderThread(null);
    }
    this.renderHistoryList(container, emptyEl);
    this.host.updateSendState();
  }

  public startNewThread(): void {
    this.host.abortCurrent();
    this.host.setBusy(false);
    this.host.setStreaming(false);
    const newT = this.host.newThread();
    this.host.setActiveThread(newT);
    let threads = this.host.getThreads() || this.host.loadThreads();
    threads.push(newT);
    threads = threads.slice(-MAX_THREADS);
    this.host.setThreads(threads);
    this.host.saveThreads(threads);
    this.host.saveActiveThreadId(newT.id);
    this.host.renderThread(newT);
    const input = this.host.getInput();
    if (input) {
      input.value = '';
      this.host.growInput();
    }
    this.host.closeHistory();
    this.host.updateSendState();
  }
}
