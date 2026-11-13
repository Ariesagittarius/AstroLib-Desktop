let _renderMath: any = null;
async function getMathRenderer() {
  if (!_renderMath) {
    const mod = await import('katex/dist/contrib/auto-render.mjs');
    _renderMath = mod.default || mod;
  }
  return _renderMath;
}

let _aiCoreModules: any = null;
async function getAiCoreModules() {
  if (!_aiCoreModules) {
    const [retrieverMod, llmMod, toolsMod] = await Promise.all([
      import('../retriever.mjs'),
      import('../llm.mjs'),
      import('../tools-client.mjs'),
    ]);
    _aiCoreModules = {
      createRetriever: retrieverMod.createRetriever,
      buildMessages: llmMod.buildMessages,
      buildContext: llmMod.buildContext,
      streamChat: llmMod.streamChat,
      buildToolDefs: toolsMod.buildToolDefs,
      runClientTool: toolsMod.runClientTool,
      toolsDesc: toolsMod.toolsDesc,
    };
  }
  return _aiCoreModules;
}

import {
  getAllAiModels,
  getActiveAiModelId,
  getAiProvider,
  getAiApiKey,
  getAiEndpoint,
  getAiParams,
  getAiAnswerMode,
  getAiSourceOpen,
  getAiPanelDimensions,
  getAiAutoCollapsePreceding,
  getAiCollapseToolsSummary,
  saveAiCollapseToolsSummary,
  formatExplorationSummary,
  getAiSideloadRefChapter,
  saveAiActiveModel,
  getAiExtendedThinking,
  saveAiExtendedThinking,
  getShortModelLabel,
  onAiConfigChange,
} from '../ai-config';

import {
  ChatControllerStateMachine,
  type ReferencedChapter,
  type ChatExecutionStatus,
} from './chat-controller.state';
import {
  esc,
  cleanSingleLine,
  capSnippet,
  jsonHighlight,
  capJsonText,
  decorateFootnotes,
  toolSummary,
} from './chat-formatter';
import { ChatChapterPicker } from './chat-chapter-picker';
import { ChatModelMenu } from './chat-model-menu';
import { ChatHistoryManager } from './chat-history';
import { generateChatAnswer } from './chat-generation';
import { bindMessagesViewEvents, renderSourcesHtml } from './chat-messages-view';
import {
  jsonHtml,
  renderToolBlocksHtml,
  renderToolsGroupHtml,
  collapseTools,
  collapsePreceding,
  updateCollapseBtnState,
} from './chat-tools-view';
import { parseAiError, renderErrorCardHtml } from '../error-handler';
import { createM3LoadingHtml } from '../../components/common/m3-loading-helper';
import { renderTitleHtml } from '../../utils/render-title.ts';
import { initChatResizer } from './chat-resizer';
import { ThreadStore, MAX_THREADS, MAX_MSGS } from './thread-store';
import { mdToHtml, safeLink } from './chat-markdown';
import { sideloadManager } from '../../components/sideload/sideload-manager';
import {
  DOCKED_STORAGE_KEY,
  type ChatDockHost,
  performChatDock,
  performChatUndock,
  performChatUndockInternal,
} from './chat-dock';

export type { ReferencedChapter };
export { formatExplorationSummary };

const SUGGESTIONS = [
  '夹逼定理是什么意思？',
  '什么情况下用麦克劳林展开？',
  '这道例题的解题步骤是什么？',
];

function getConfig(el: Element): any {
  try { return JSON.parse(el.getAttribute('data-config') || '{}'); } catch { return {}; }
}

export class AIAskElement extends HTMLElement {
  _stateMachine = new ChatControllerStateMachine();
  _chapterPicker!: ChatChapterPicker;
  _modelMenuCtrl!: ChatModelMenu;
  _historyMgr!: ChatHistoryManager;
  _indexCache = new Map<string, any>();
  _inited = false;
  _abort: AbortController | null = null;
  _busy = false;
  _streaming = false;
  _threadStore: ThreadStore = new ThreadStore('');
  _threads: any[] | null = null;
  _activeThread: any = null;
  _config: any = {};
  _bookTitle = '本书';
  _col = '';
  _book = '';
  _panel!: HTMLElement;
  _fab!: HTMLElement;
  _close!: HTMLElement;
  _settingsBtn!: HTMLElement;
  _collapseBtn!: HTMLElement;
  _isPrecedingCollapsed = true;
  _newBtn!: HTMLElement;
  _submit!: HTMLButtonElement;
  _sendIcon!: HTMLElement;
  _stopIcon!: HTMLElement;
  _input!: HTMLTextAreaElement;
  _status!: HTMLElement;
  _thread!: HTMLElement;
  _empty!: HTMLElement;
  _messages!: HTMLElement;
  _bookEl!: HTMLElement;
  _historyBtn!: HTMLElement;
  _history!: HTMLElement;
  _historyList!: HTMLElement;
  _historyEmpty!: HTMLElement;
  _historyNew!: HTMLElement;
  _historyClose!: HTMLElement;
  _isDocked = false;
  _dockBtn!: HTMLElement;
  _dockIcon!: HTMLElement;
  _undockIcon!: HTMLElement;
  _sideloadBackBtn!: HTMLElement;
  _contextContainer!: HTMLElement;
  _contextRow!: HTMLElement;
  _contextText!: HTMLElement;
  _contextExpandBtn!: HTMLButtonElement;
  _contextRemoveBtn!: HTMLButtonElement;
  _contextDropdown!: HTMLElement;
  _contextItemsList!: HTMLElement;
  _addChapterBtn!: HTMLButtonElement;
  _chapterPickerPopover!: HTMLElement;
  _chapterSearchInput!: HTMLInputElement;
  _chapterPickerClose!: HTMLButtonElement;
  _chapterPickerList!: HTMLElement;
  _chapterPickerCount!: HTMLElement;
  _chapterPickerDone!: HTMLButtonElement;
  _modelPillBtn!: HTMLButtonElement;
  _modelPillName!: HTMLElement;
  _modelMenu!: HTMLElement;
  _thinkingSwitch!: HTMLInputElement;
  _collapseToolsSwitch!: HTMLInputElement;
  _modelExtraItem!: HTMLElement;
  _modelExtraHeadline!: HTMLElement;
  _modelExtraSupport!: HTMLElement;
  _referencedChapters: ReferencedChapter[] = [];
  _bookChaptersCache: Array<{ title: string; url: string }> | null = null;
  _chapterTextCache: Map<string, Promise<string>> = new Map();
  _chapterChip!: HTMLElement;
  _chapterChipText!: HTMLElement;
  _chapterChipClose!: HTMLElement;
  _refCurrentChapter = false;
  _unsubSideload: (() => void) | null = null;
  _originalParent: HTMLElement | null = null;
  _originalNextSibling: Node | null = null;
  _onKeyDownAltD!: (e: KeyboardEvent) => void;
  _onRoute!: () => void;
  _onDocClick!: (e: MouseEvent) => void;
  _onKeyDownEsc!: (e: KeyboardEvent) => void;
  _onExternalQuery!: (e: CustomEvent) => void;
  _unsubAi: (() => void) | null = null;
  _katexConfig = {
    delimiters: [
      { left: '$$', right: '$$', display: true },
      { left: '$', right: '$', display: false },
    ],
    throwOnError: false,
  };

  constructor() {
    super();
  }

  connectedCallback() {
    // 单例守卫：确保全站仅存在一个活跃的 ai-ask 根实例（防止 SPA 切页在 main-pane 产生重复实例）
    const allInstances = document.querySelectorAll('ai-ask');
    if (allInstances.length > 1) {
      for (const inst of allInstances) {
        if (inst !== this && (inst as any)._inited) {
          this.remove();
          return;
        }
      }
    }
    if (this._inited) return;
    this._inited = true;
    this._initDom();
    this._onRoute = () => this._route();
    this._onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (this._historyBtn && this._historyBtn.contains(target)) return;
      if (this._history && this._history.classList.contains('open') && !this._history.contains(target)) {
        this._history.classList.remove('open');
        this._historyBtn && this._historyBtn.classList.remove('ask-settings-open');
      }
      // 点击外部关闭模型菜单
      if (this._modelMenu && this._modelMenu.style.display !== 'none') {
        if (!this._modelMenu.contains(target) && (!this._modelPillBtn || !this._modelPillBtn.contains(target))) {
          this._closeModelMenu();
        }
      }
      // 点击外部关闭章节选择器
      if (this._chapterPickerPopover && this._chapterPickerPopover.style.display !== 'none') {
        if (!this._chapterPickerPopover.contains(target) && (!this._addChapterBtn || !this._addChapterBtn.contains(target))) {
          this._closeChapterPicker();
        }
      }
    };
    this._onKeyDownEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (this._chapterPickerPopover && this._chapterPickerPopover.style.display !== 'none') {
          e.stopPropagation();
          this._closeChapterPicker();
          return;
        }
        if (this._modelMenu && this._modelMenu.style.display !== 'none') {
          e.stopPropagation();
          this._closeModelMenu();
          return;
        }
      }
    };
    this._onExternalQuery = (e: CustomEvent) => {
      (e as any).__handled = true;
      const { prompt, autoSubmit = true } = (e && e.detail) || {};
      if (!prompt) return;
      this._openWithQuestion(prompt, autoSubmit);
    };

    this._onKeyDownAltD = (e: KeyboardEvent) => {
      if (e.altKey && (e.key === 'd' || e.key === 'D')) {
        if (this._isDocked || (this._panel && this._panel.classList.contains('ask-open'))) {
          e.preventDefault();
          this.toggleDock();
        }
      }
    };
    window.addEventListener('keydown', this._onKeyDownAltD);
    window.addEventListener('keydown', this._onKeyDownEsc);

    // 订阅侧载管理器状态变更：若非 AI 面板激活（如 Esc 或切回大纲），自动将 DOM 归位并关闭浮窗；若为 AI 面板则停靠
    this._unsubSideload = sideloadManager.subscribe((state: any) => {
      if (state.activePanelId !== 'ai' && this._isDocked) {
        this._undockInternal(false);
      } else if (state.activePanelId === 'ai' && !this._isDocked) {
        this.dockToSidebar(true);
      }
    });

    this._unsubAi = onAiConfigChange(() => {
      const dims = getAiPanelDimensions();
      if (this._panel && dims.width && dims.height) {
        this._panel.style.setProperty('--ask-panel-width', `${dims.width}px`);
        this._panel.style.setProperty('--ask-panel-height', `${dims.height}px`);
      }
      this._applySrcOpenToExisting();
      this._updateModelPill();
      if (this._collapseToolsSwitch) {
        this._collapseToolsSwitch.checked = getAiCollapseToolsSummary();
      }
      if (getAiAutoCollapsePreceding()) {
        this._collapsePreceding(true);
      }
      if (this._isDocked) {
        if (getAiSideloadRefChapter() && !this._refCurrentChapter) {
          this._enableChapterReference();
        } else if (!getAiSideloadRefChapter() && this._refCurrentChapter) {
          this._disableChapterReference();
        }
      }
    });

    window.addEventListener('astro:page-load', this._onRoute);
    window.addEventListener('astrolib:spa-navigated', this._onRoute);
    window.addEventListener('aiask:query', this._onExternalQuery as EventListener);
    document.addEventListener('click', this._onDocClick);
    this._route();
  }

  disconnectedCallback() {
    window.removeEventListener('astro:page-load', this._onRoute);
    window.removeEventListener('astrolib:spa-navigated', this._onRoute);
    window.removeEventListener('aiask:query', this._onExternalQuery as EventListener);
    document.removeEventListener('click', this._onDocClick);
    if (this._onKeyDownAltD) window.removeEventListener('keydown', this._onKeyDownAltD);
    if (this._onKeyDownEsc) window.removeEventListener('keydown', this._onKeyDownEsc);
    if (this._unsubSideload) {
      this._unsubSideload();
      this._unsubSideload = null;
    }
    if (this._unsubAi) this._unsubAi();
    if (this._abort) this._abort.abort();
  }

  _openWithQuestion(prompt: string, autoSubmit = true) {
    if (this._isDocked) {
      const mountEl = document.getElementById('ai-sidebar-panel');
      if (mountEl && this.parentElement !== mountEl) {
        mountEl.appendChild(this);
      }
      if (this._panel) {
        this._panel.classList.add('ask-open');
      }
      sideloadManager.open('ai');
    } else {
      this._openPanel();
    }
    this._startNewThread();
    if (this._input) {
      this._input.value = prompt;
      this._grow();
      if (autoSubmit) {
        setTimeout(() => this._ask(), 80);
      }
    }
    requestAnimationFrame(() => {
      this._scrollThread();
      this._input && this._input.focus({ preventScroll: true });
    });
  }

  _initDom() {
    const cfg = getConfig(this);
    this._config = cfg;
    this._bookTitle = this.getAttribute('data-book-title') || this.getAttribute('data-book') || '本书';

    this._panel = this.querySelector('.ask-panel') as HTMLElement;
    this._fab = this.querySelector('.ask-fab') as HTMLElement;
    this._close = this.querySelector('.ask-close') as HTMLElement;
    this._settingsBtn = this.querySelector('.ask-settings-btn') as HTMLElement;
    this._collapseBtn = this.querySelector('.ask-collapse-tools-btn') as HTMLElement;
    this._dockBtn = this.querySelector('.ask-dock-btn') as HTMLElement;
    this._dockIcon = this.querySelector('.icon-dock-to-sidebar') as HTMLElement;
    this._undockIcon = this.querySelector('.icon-undock-from-sidebar') as HTMLElement;
    this._sideloadBackBtn = this.querySelector('.ai-sideload-back-btn') as HTMLElement;
    this._contextRow = (this.querySelector('#ask-context-row') || this.querySelector('#ask-context-container')) as HTMLElement;
    this._contextContainer = this._contextRow;
    this._contextText = (this.querySelector('#ask-context-text') || this.querySelector('#ask-chapter-chip-text')) as HTMLElement;
    this._chapterChipText = this._contextText;
    this._contextExpandBtn = this.querySelector('#ask-context-expand-btn') as HTMLButtonElement;
    this._contextRemoveBtn = (this.querySelector('#ask-context-remove-btn') || this.querySelector('#ask-chapter-chip-close')) as HTMLButtonElement;
    this._chapterChipClose = this._contextRemoveBtn;
    this._contextDropdown = this.querySelector('#ask-context-dropdown') as HTMLElement;
    this._contextItemsList = this.querySelector('#ask-context-items-list') as HTMLElement;

    this._chapterPicker = new ChatChapterPicker({
      getReferencedChapters: () => this._referencedChapters,
      addReferencedChapter: (c) => {
        if (this._referencedChapters.some((x) => x.url === c.url)) return false;
        this._referencedChapters.push(c);
        this._stateMachine.addReferencedChapter(c);
        return true;
      },
      removeReferencedChapter: (url) => {
        const len = this._referencedChapters.length;
        this._referencedChapters = this._referencedChapters.filter((x) => x.url !== url);
        this._stateMachine.removeReferencedChapter(url);
        return this._referencedChapters.length !== len;
      },
      clearReferencedChapters: () => {
        this._referencedChapters = [];
        this._stateMachine.clearReferencedChapters();
      },
      updateContextRow: () => this._updateContextRow(),
      closeModelMenu: () => this._closeModelMenu(),
      getInput: () => this._input,
      growInput: () => this._grow(),
    });

    if (this._contextRemoveBtn) {
      this._contextRemoveBtn.addEventListener('click', (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        this._disableChapterReference();
      });
    }

    if (this._contextExpandBtn) {
      this._contextExpandBtn.addEventListener('click', (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        this._toggleContextDropdown();
      });
    }

    // 章节多选选择器 Popover 元素与交互
    this._addChapterBtn = this.querySelector('#ask-add-chapter-btn') as HTMLButtonElement;
    this._chapterPickerPopover = this.querySelector('#ask-chapter-picker-popover') as HTMLElement;
    this._chapterSearchInput = this.querySelector('#ask-chapter-search-input') as HTMLInputElement;
    this._chapterPickerClose = this.querySelector('#ask-chapter-picker-close') as HTMLButtonElement;
    this._chapterPickerList = this.querySelector('#ask-chapter-picker-list') as HTMLElement;
    this._chapterPickerCount = this.querySelector('#ask-chapter-picker-count') as HTMLElement;
    this._chapterPickerDone = this.querySelector('#ask-chapter-picker-done') as HTMLButtonElement;

    if (this._addChapterBtn) {
      this._addChapterBtn.addEventListener('click', (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (this._chapterPickerPopover && this._chapterPickerPopover.style.display !== 'none') {
          this._closeChapterPicker();
        } else {
          this._openChapterPicker();
        }
      });
    }

    if (this._chapterPickerClose) {
      this._chapterPickerClose.addEventListener('click', (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        this._closeChapterPicker();
      });
    }

    if (this._chapterPickerDone) {
      this._chapterPickerDone.addEventListener('click', (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        this._closeChapterPicker();
      });
    }

    if (this._chapterSearchInput) {
      this._chapterSearchInput.addEventListener('input', () => {
        this._filterChapterPicker(this._chapterSearchInput.value.trim());
      });
    }

    // 模型快捷切换 Popover 菜单与药丸按钮
    this._modelPillBtn = this.querySelector('#ask-model-pill-btn') as HTMLButtonElement;
    this._modelPillName = this.querySelector('#ask-model-pill-name') as HTMLElement;
    this._modelMenu = this.querySelector('#ask-model-menu') as HTMLElement;
    this._thinkingSwitch = this.querySelector('#ask-thinking-switch') as HTMLInputElement;
    this._collapseToolsSwitch = this.querySelector('#ask-collapse-tools-switch') as HTMLInputElement;
    this._modelExtraItem = this.querySelector('#ask-model-extra-item') as HTMLElement;
    this._modelExtraHeadline = this.querySelector('#ask-model-extra-headline') as HTMLElement;
    this._modelExtraSupport = this.querySelector('#ask-model-extra-support') as HTMLElement;

    if (this._modelPillBtn) {
      this._modelPillBtn.addEventListener('click', (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (this._modelMenu && this._modelMenu.style.display !== 'none') {
          this._closeModelMenu();
        } else {
          this._openModelMenu();
        }
      });
    }

    this._initModelMenu();
    this._updateModelPill();

    this._newBtn = this.querySelector('.ask-new-btn') as HTMLElement;
    this._submit = (this.querySelector('.ask-send-btn') || this.querySelector('.ask-send')) as HTMLButtonElement;
    this._sendIcon = this.querySelector('.ask-send-icon') as HTMLElement;
    this._stopIcon = this.querySelector('.ask-stop-icon') as HTMLElement;
    this._input = this.querySelector('.ask-input') as HTMLTextAreaElement;
    this._status = this.querySelector('.ask-status') as HTMLElement;
    this._thread = this.querySelector('.ask-thread') as HTMLElement;
    this._empty = this.querySelector('.ask-empty') as HTMLElement;
    this._messages = this.querySelector('.ask-messages') as HTMLElement;
    this._bookEl = this.querySelector('.ask-book') as HTMLElement;

    // Apply saved panel dimensions if present
    const dims = getAiPanelDimensions();
    if (this._panel) {
      if (dims.width) this._panel.style.setProperty('--ask-panel-width', `${dims.width}px`);
      if (dims.height) this._panel.style.setProperty('--ask-panel-height', `${dims.height}px`);
    }

    this._initResizeHandles();

    if (this._messages) {
      bindMessagesViewEvents(this._messages, {
        retryLast: () => this._retryLast(),
        sourceOpenNew: () => this._sourceOpenNew(),
      });
    }

    this._historyBtn = this.querySelector('.ask-history-btn') as HTMLElement;
    this._history = this.querySelector('.ask-history') as HTMLElement;
    this._historyList = this.querySelector('.ask-history-list') as HTMLElement;
    this._historyEmpty = this.querySelector('.ask-history-empty') as HTMLElement;
    this._historyNew = this.querySelector('.ask-history-new') as HTMLElement;
    this._historyClose = this.querySelector('.ask-history-close') as HTMLElement;

    this._historyMgr = new ChatHistoryManager({
      getThreads: () => this._threads || [],
      setThreads: (ts) => { this._threads = ts; },
      loadThreads: () => this._loadThreads(),
      saveThreads: (ts) => this._saveThreads(ts),
      getActiveThread: () => this._activeThread,
      setActiveThread: (t) => {
        this._activeThread = t;
        this._stateMachine.setActiveThreadId(t ? t.id : null);
      },
      saveActiveThreadId: (id) => this._saveActiveThreadId(id),
      getActiveKey: () => this._activeKey(),
      renderThread: (t) => this._renderThread(t),
      closeHistory: () => this._closeHistory(),
      updateSendState: () => this._updateSendState(),
      newThread: () => this._newThread(),
      getInput: () => this._input,
      growInput: () => this._grow(),
      abortCurrent: () => { if (this._abort) this._abort.abort(); },
      setBusy: (b) => { this._busy = b; },
      setStreaming: (s) => { this._streaming = s; },
    });

    if (this._historyBtn) {
      this._historyBtn.addEventListener('click', (e) => { e.stopPropagation(); this._toggleHistory(); });
    }
    if (this._historyNew) {
      this._historyNew.addEventListener('click', () => this._startNewThread());
    }
    if (this._historyClose) {
      this._historyClose.addEventListener('click', () => this._closeHistory());
    }
    if (this._collapseBtn) {
      this._collapseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._togglePrecedingCollapse();
      });
    }
    if (this._newBtn) {
      this._newBtn.addEventListener('click', () => this._startNewThread());
    }
    if (this._dockBtn) {
      this._dockBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleDock();
      });
    }
    if (this._sideloadBackBtn) {
      this._sideloadBackBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.undockFromSidebar(true);
      });
    }

    this._setBookTitle(this._bookTitle);

    if (this._fab) {
      this._fab.addEventListener('click', () => {
        if (this._panel && this._panel.classList.contains('ask-open')) this._closePanel();
        else this._openPanel();
      });
    }
    if (this._close) this._close.addEventListener('click', () => this._closePanel());

    // Settings trigger dispatches global event to open quick settings AI panel
    if (this._settingsBtn) {
      this._settingsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        window.dispatchEvent(new CustomEvent('astrolib:open-settings', { detail: { section: 'ai' } }));
      });
    }

    if (this._input) {
      this._input.addEventListener('input', () => {
        this._grow();
        const val = this._input.value;
        if (val.endsWith('@') || /(?:^|\s)@$/.test(val)) {
          this._openChapterPicker();
        }
      });
      this._input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          if (this._streaming) {
            if (this._abort) this._abort.abort();
          } else {
            this._ask();
          }
        }
      });
    }
    if (this._submit) {
      this._submit.addEventListener('click', () => {
        if (this._streaming) {
          if (this._abort) this._abort.abort();
        } else {
          this._ask();
        }
      });
    }

    const sugg = this.querySelector('.ask-suggest');
    if (sugg) {
      sugg.innerHTML = '';
      for (const s of SUGGESTIONS) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'ask-suggest-chip';
        b.textContent = s;
        b.addEventListener('click', () => {
          if (this._input) {
            this._input.value = s;
            this._grow();
            this._ask();
          }
        });
        sugg.appendChild(b);
      }
    }
    this._grow();
  }

  _initResizeHandles() {
    if (!this._panel) return;
    initChatResizer(this._panel);
  }

  _setBookTitle(t: string) {
    this._bookTitle = t || '本书';
    if (this._bookEl) this._bookEl.textContent = this._bookTitle;
  }

  _getCurrentChapterInfo(): { title: string; url: string; text: string } {
    const h1 = document.querySelector('.main-pane h1, main h1, #starlight-content-title');
    let title = h1?.textContent?.trim() || '';
    if (!title) {
      title = document.title.split(' - ')[0]?.trim() || '本章节';
    }
    const url = typeof window !== 'undefined' ? window.location.pathname : '';

    let text = '';
    const article = document.querySelector('.main-pane article, .main-pane main, main');
    if (article) {
      const clone = article.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('script, style, .print\\:hidden, button, .ex-card-actions, md-icon').forEach((el) => el.remove());
      text = (clone.innerText || clone.textContent || '').replace(/\s+/g, ' ').trim();
    }
    return { title, url, text };
  }

  _enableChapterReference() {
    this._refCurrentChapter = true;
    const cur = this._getCurrentChapterInfo();
    if (cur.title && !this._referencedChapters.some((c) => c.url === cur.url)) {
      this._referencedChapters.push({ ...cur, isCurrent: true });
    }
    this._updateContextRow();
  }

  _disableChapterReference() {
    this._refCurrentChapter = false;
    this._referencedChapters = [];
    this._updateContextRow();
  }

  _removeReferencedChapter(url: string) {
    this._referencedChapters = this._referencedChapters.filter((c) => c.url !== url);
    const curUrl = typeof window !== 'undefined' ? window.location.pathname : '';
    if (url === curUrl) {
      this._refCurrentChapter = false;
    }
    this._updateContextRow();
    this._updateChapterPickerCount();
    if (this._chapterPickerList) {
      const items = this._chapterPickerList.querySelectorAll<HTMLElement>('.ask-chapter-picker-item');
      items.forEach((item) => {
        if (item.getAttribute('data-url') === url) {
          const cb = item.querySelector<HTMLInputElement>('.ask-chapter-picker-checkbox');
          if (cb) cb.checked = false;
        }
      });
    }
  }

  _toggleContextDropdown() {
    if (!this._contextDropdown) return;
    const isOpen = this._contextDropdown.style.display !== 'none';
    this._contextDropdown.style.display = isOpen ? 'none' : 'block';
    if (this._contextExpandBtn) {
      this._contextExpandBtn.classList.toggle('is-expanded', !isOpen);
      this._contextExpandBtn.setAttribute('aria-expanded', String(!isOpen));
    }
  }

  _updateContextRow() {
    if (!this._contextRow) return;

    if (this._referencedChapters.length === 0) {
      this._contextRow.style.display = 'none';
      if (this._contextDropdown) this._contextDropdown.style.display = 'none';
      if (this._contextExpandBtn) {
        this._contextExpandBtn.classList.remove('is-expanded');
        this._contextExpandBtn.setAttribute('aria-expanded', 'false');
      }
      return;
    }

    this._contextRow.style.display = 'flex';

    if (this._referencedChapters.length === 1) {
      const ch = this._referencedChapters[0];
      if (this._contextText) {
        this._contextText.textContent = `正在引用“${ch.title}”`;
        this._contextText.title = `正在引用章节：${ch.title}`;
      }
      if (this._contextExpandBtn) this._contextExpandBtn.style.display = 'none';
      if (this._contextDropdown) this._contextDropdown.style.display = 'none';
    } else {
      if (this._contextText) {
        this._contextText.textContent = `正在引用 ${this._referencedChapters.length} 个章节`;
        this._contextText.title = `正在引用：${this._referencedChapters.map((c) => c.title).join('、')}`;
      }
      if (this._contextExpandBtn) this._contextExpandBtn.style.display = 'inline-flex';
      this._renderContextDropdownList();
    }
  }

  _renderContextDropdownList() {
    if (!this._contextItemsList) return;
    this._contextItemsList.innerHTML = '';
    this._referencedChapters.forEach((ch) => {
      const li = document.createElement('li');
      li.className = 'ask-context-item';

      const titleSpan = document.createElement('span');
      titleSpan.className = 'ask-context-item-title';
      titleSpan.textContent = ch.title;
      titleSpan.title = ch.title;

      const rmBtn = document.createElement('button');
      rmBtn.type = 'button';
      rmBtn.className = 'ask-context-item-remove';
      rmBtn.title = `取消引用《${ch.title}》`;
      rmBtn.setAttribute('aria-label', `取消引用《${ch.title}》`);
      rmBtn.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';
      rmBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._removeReferencedChapter(ch.url);
      });

      li.appendChild(titleSpan);
      li.appendChild(rmBtn);
      this._contextItemsList.appendChild(li);
    });
  }

  _updateChapterContextChip() {
    this._updateContextRow();
  }

  _extractBookChapters() { return this._chapterPicker.extractBookChapters(); }
  _openChapterPicker() {
    this._closeModelMenu();
    if (!this._chapterPickerPopover) return;
    this._chapterPickerPopover.style.display = 'flex';
    this._renderChapterPickerList();
    if (this._chapterSearchInput) { this._chapterSearchInput.value = ''; this._chapterSearchInput.focus(); }
  }
  _closeChapterPicker() {
    if (!this._chapterPickerPopover) return;
    this._chapterPickerPopover.style.display = 'none';
    if (this._input) { this._input.value = this._input.value.replace(/@\s*$/, ''); this._grow(); this._input.focus(); }
  }
  _renderChapterPickerList() {
    if (!this._chapterPickerList) return;
    this._chapterPicker.renderPickerList(this._chapterPickerList, this._chapterPickerCount, () => this._updateContextRow());
  }
  _filterChapterPicker(kw: string) { this._chapterPicker.filterPicker(this._chapterPickerList, kw); }
  _updateChapterPickerCount() { this._chapterPicker.updatePickerCount(this._chapterPickerCount); }
  async _prefetchChapterText(url: string): Promise<string> { return this._chapterPicker.prefetchChapterText(url); }

  _initModelMenu() {
    this._modelMenuCtrl = new ChatModelMenu({
      modelMenu: this._modelMenu,
      modelPillBtn: this._modelPillBtn,
      modelPillName: this._modelPillName,
      thinkingSwitch: this._thinkingSwitch,
      collapseToolsSwitch: this._collapseToolsSwitch,
      modelExtraItem: this._modelExtraItem,
      modelExtraHeadline: this._modelExtraHeadline,
      modelExtraSupport: this._modelExtraSupport,
    }, (mid) => {
      this._stateMachine.setActiveModelId(mid);
    });
  }

  _openModelMenu() { this._closeChapterPicker(); this._modelMenuCtrl?.open(); }
  _closeModelMenu() { this._modelMenuCtrl?.close(); }
  _updateModelPill() { this._modelMenuCtrl?.updateModelPill(); }

  private _getDockHost(): ChatDockHost {
    return {
      element: this,
      panel: this._panel,
      fab: this._fab,
      dockBtn: this._dockBtn,
      dockIcon: this._dockIcon,
      undockIcon: this._undockIcon,
      sideloadBackBtn: this._sideloadBackBtn,
      input: this._input,
      history: this._history,
      historyBtn: this._historyBtn,
      originalParent: this._originalParent,
      originalNextSibling: this._originalNextSibling,
      isDocked: this._isDocked,
      enableChapterReference: () => this._enableChapterReference(),
      disableChapterReference: () => this._disableChapterReference(),
      scrollThread: () => this._scrollThread(),
    };
  }

  toggleDock() {
    if (this._isDocked) {
      this.undockFromSidebar(true);
    } else {
      this.dockToSidebar();
    }
  }

  dockToSidebar(immediate = false) {
    const host = this._getDockHost();
    performChatDock(host, immediate);
    this._originalParent = host.originalParent;
    this._originalNextSibling = host.originalNextSibling;
    this._isDocked = host.isDocked;
  }

  undockFromSidebar(keepOpen = true) {
    const host = this._getDockHost();
    performChatUndock(host, keepOpen);
    this._originalParent = host.originalParent;
    this._originalNextSibling = host.originalNextSibling;
    this._isDocked = host.isDocked;
  }

  _undockInternal(keepOpen = true) {
    const host = this._getDockHost();
    performChatUndockInternal(host, keepOpen);
    this._originalParent = host.originalParent;
    this._originalNextSibling = host.originalNextSibling;
    this._isDocked = host.isDocked;
  }

  _openPanel() {
    if (this._isDocked) {
      sideloadManager.open('ai');
      requestAnimationFrame(() => {
        this._input && this._input.focus({ preventScroll: true });
      });
      return;
    }
    this._panel.classList.remove('dock-settled', 'docking-in');
    this._panel.classList.add('ask-open');
    requestAnimationFrame(() => {
      this._input && this._input.focus({ preventScroll: true });
    });
    requestAnimationFrame(() => this._scrollThread());
  }
  _closePanel() {
    if (this._isDocked) {
      sideloadManager.switchToDefault();
      this._undockInternal(false);
      return;
    }
    this._panel.classList.remove('ask-open', 'dock-settled', 'docking-in');
    this._history && this._history.classList.remove('open');
    this._historyBtn && this._historyBtn.classList.remove('ask-settings-open');
  }
  _toggleHistory() {
    const open = this._history.classList.toggle('open');
    this._historyBtn && this._historyBtn.classList.toggle('ask-settings-open', open);
    if (open) {
      this._renderHistoryList();
    }
  }
  _closeHistory() {
    this._history && this._history.classList.remove('open');
    this._historyBtn && this._historyBtn.classList.remove('ask-settings-open');
  }

  _route() {
    const m = location.pathname.match(/^\/collections\/([^/]+)\/([^/]+)\//);
    if (!m) {
      this.hidden = true;
      this._closePanel();
      return;
    }
    this.hidden = false;
    const changed = this._col !== m[1] || this._book !== m[2];
    this._col = m[1];
    this._book = m[2];
    if (changed) this._resetThread();
    const cached = this._indexCache.get(this._bookKey());
    if (cached && cached.meta && cached.meta.title) this._setBookTitle(cached.meta.title);
    else this._setBookTitle(this.getAttribute('data-book-title') || m[2]);

    // 路由切换时，重置章节缓存；若处于侧载且引用激活，更新当前章节引用
    this._bookChaptersCache = null;
    if (this._isDocked && this._refCurrentChapter) {
      const cur = this._getCurrentChapterInfo();
      const idx = this._referencedChapters.findIndex((c) => c.isCurrent);
      if (idx !== -1) {
        this._referencedChapters[idx] = { ...cur, isCurrent: true };
      } else {
        this._referencedChapters.unshift({ ...cur, isCurrent: true });
      }
      this._updateContextRow();
    }

    // 探测并平滑恢复侧载停靠态
    const isAiDocked = sideloadManager.getActivePanelId() === 'ai' ||
      (typeof localStorage !== 'undefined' && (
        localStorage.getItem('astrolib_sideload_active_panel') === 'ai' ||
        localStorage.getItem(DOCKED_STORAGE_KEY) === 'true'
      ));

    if (isAiDocked) {
      const mountEl = document.getElementById('ai-sidebar-panel');
      if (mountEl) {
        requestAnimationFrame(() => {
          this.dockToSidebar(true);
        });
      }
    }
  }

  _resetThread() {
    if (this._abort) this._abort.abort();
    this._abort = null;
    this._busy = false;
    this._streaming = false;
    this._activeThread = null;
    this._threads = null;
    if (this._messages) this._messages.innerHTML = '';
    if (this._empty) this._empty.style.display = '';
    if (this._messages) this._messages.style.display = 'none';
    if (this._input) this._input.value = '';
    if (this._status) this._status.textContent = '';
    this._grow();
    this._updateSendState();
    this._restoreBookThread();
  }

  _bookKey() { return `${this._col}-${this._book}`; }

  _threadsKey() { return this._threadStore.getThreadsKey(); }
  _activeKey() { return this._threadStore.getActiveKey(); }

  _loadThreads(): any[] {
    return this._threadStore.loadThreads();
  }
  _saveThreads(threads: any[]) {
    this._threadStore.saveThreads(threads);
  }
  _saveActiveThreadId(id: string) {
    this._threadStore.saveActiveThreadId(id);
  }
  _newThread() {
    return this._threadStore.newThread();
  }

  _restoreBookThread() {
    this._threadStore.setBookKey(this._bookKey());
    const { threads, activeThread } = this._threadStore.restoreBookThread();
    this._threads = threads;
    this._activeThread = activeThread;
    this._renderThread(activeThread);
  }

  _ensureActiveThread() {
    if (this._activeThread) return this._activeThread;
    const t = this._newThread();
    if (!this._threads) this._threads = this._loadThreads();
    this._threads.push(t);
    this._activeThread = t;
    this._saveActiveThread();
    return t;
  }

  _renderThread(t: any) {
    const msgs = (t && t.messages) || [];
    if (this._messages) this._messages.innerHTML = '';
    if (!msgs.length) {
      if (this._messages) this._messages.style.display = 'none';
      if (this._empty) this._empty.style.display = '';
      return;
    }
    this._hideEmpty();
    for (const m of msgs) {
      const body: any = { text: m.text, chapterTitle: m.chapterTitle };
      this._addMessage(m.role, body);
      if (m.role === 'assistant') {
        const segs = (m.segments && m.segments.length)
          ? m.segments
          : [
              ...(m.text ? [{ kind: 'reply', text: m.text }] : []),
              ...(m.tools || []).map((t: any) => ({ kind: 'tool', name: t.name, args: t.args, summary: t.summary, resultText: t.resultText })),
            ];
        const decorate = !!(m.sources && m.sources.length);
        let currentToolGroup: any[] = [];
        const flushToolGroup = () => {
          if (!currentToolGroup.length) return;
          const shouldOpen = !getAiCollapseToolsSummary();
          body.blocksEl.insertAdjacentHTML('beforeend', this._toolsGroupHtml(currentToolGroup, shouldOpen));
          currentToolGroup = [];
        };

        for (const seg of segs) {
          if (seg.kind === 'tool') {
            currentToolGroup.push(seg);
          } else {
            flushToolGroup();
            if (seg.kind === 'reply') {
              if (!seg.text || !seg.text.trim()) continue;
              this._appendMdBlock(body.blocksEl, seg.text, decorate);
            } else if (seg.kind === 'error') {
              body.blocksEl.insertAdjacentHTML('beforeend', seg.html || (seg.errorInfo ? renderErrorCardHtml(seg.errorInfo) : ''));
            }
          }
        }
        flushToolGroup();
        if (m.sources && m.sources.length) this._renderSources(body.sourcesEl, m.sources.map((s: any) => ({ chunk: s })));
      }
    }
    if (getAiAutoCollapsePreceding()) {
      this._collapsePreceding(true);
    } else {
      this._isPrecedingCollapsed = false;
      this._updateCollapseBtnState();
    }
    this._scrollThread();
  }

  _retryLast() {
    if (this._streaming || this._busy) return;
    const t = this._activeThread;
    if (!t || !Array.isArray(t.messages) || !t.messages.length) return;

    let userIndex = -1;
    for (let i = t.messages.length - 1; i >= 0; i--) {
      if (t.messages[i].role === 'user') {
        userIndex = i;
        break;
      }
    }
    if (userIndex < 0) return;

    const lastUserMsg = t.messages[userIndex].text;
    if (!lastUserMsg) return;

    // 回滚该提问及后续可能失败的消息
    t.messages = t.messages.slice(0, userIndex);
    this._saveActiveThread();
    this._renderThread(t);

    if (this._input) {
      this._input.value = lastUserMsg;
      this._grow();
    }
    this._ask();
  }

  _appendToThread(q: string, text: string, sources: any[], tools: any[], segments: any[], chapterTitle?: string) {
    const t = this._ensureActiveThread();
    t.messages.push({ role: 'user', text: q, chapterTitle });
    if (text) t.messages.push({ role: 'assistant', text, sources, tools, segments: segments || undefined });
    if (!t.title || t.title === '新会话') t.title = (q || '').slice(0, 20) || '新会话';
    t.updatedAt = Date.now();
    this._saveActiveThread();
  }

  _saveActiveThread() {
    const t = this._activeThread;
    if (!t) return;
    if (t.messages.length > MAX_MSGS) t.messages = t.messages.slice(-MAX_MSGS);
    if (!this._threads) this._threads = this._loadThreads();
    const i = this._threads.findIndex((x) => x.id === t.id);
    if (i >= 0) this._threads[i] = t; else this._threads.push(t);
    this._threads = this._threads.slice(-MAX_THREADS);
    this._saveThreads(this._threads);
    this._saveActiveThreadId(t.id);
  }

  _historyFromThread(t: any): any[] {
    return this._threadStore.historyFromThread(t);
  }

  _fallbackSummary(toolLog: any[]): string {
    return [
      '**【AI 本轮未能输出最终回答】**',
      '',
      'AI 已检索了本书相关的背景资料（可参考下方检索到的来源卡片），但未能生成完整的最终总结回答。',
      '',
      '您可以直接点击下方来源卡片查阅教材原文，或稍后换一种问法重新提问。',
    ].join('\n');
  }

  _relTime(ts: number): string {
    return this._historyMgr.relTime(ts);
  }

  _renderHistoryList() {
    if (!this._historyList) return;
    this._historyMgr.renderHistoryList(this._historyList, this._historyEmpty);
  }

  _loadThreadById(id: string) {
    this._historyMgr.loadThreadById(id);
  }

  _deleteThread(id: string) {
    if (!this._historyList) return;
    this._historyMgr.deleteThread(id, this._historyList, this._historyEmpty);
  }

  _startNewThread() {
    this._historyMgr.startNewThread();
  }

  async _getIndex() {
    const key = this._bookKey();
    if (this._indexCache.has(key)) return this._indexCache.get(key);
    const url = `/ai-index/${key}.json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`索引加载失败（${res.status}）—— 请先构建 ${url}`);
    const idx = await res.json();
    this._indexCache.set(key, idx);
    if (idx.meta && idx.meta.title) this._setBookTitle(idx.meta.title);
    return idx;
  }

  _selectedModel(): any {
    const id = getActiveAiModelId();
    const found = getAllAiModels().find((m) => m.id === id);
    const provider = getAiProvider();
    return { id, model: id, label: found ? found.label : id, endpoint: getAiEndpoint(id), provider: found ? found.provider : provider.id, providerLabel: provider.label };
  }

  _currentKey(): string {
    return getAiApiKey(getActiveAiModelId());
  }

  _params(): any {
    return getAiParams();
  }

  _answerMode(): string {
    return getAiAnswerMode();
  }

  _hideEmpty() {
    if (this._empty) this._empty.style.display = 'none';
    if (this._messages) this._messages.style.display = '';
  }

  _addMessage(role: string, body: any): HTMLElement {
    const msg = document.createElement('div');
    msg.className = 'ask-msg ' + (role === 'user' ? 'ask-msg-user' : 'ask-msg-ai');
    if (role === 'user') {
      if (body.chapterTitle) {
        const badge = document.createElement('div');
        badge.className = 'ask-user-ref-badge';
        const label = body.chapterTitle.includes('章节:')
          ? `引用 ${body.chapterTitle}`
          : `引用: 《${body.chapterTitle}》`;
        badge.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg> ${label}`;
        msg.appendChild(badge);
      }
      const t = document.createElement('div');
      t.className = 'ask-msg-text ai-md';
      t.innerHTML = mdToHtml(body.text, this._sourceOpenNew());
      msg.appendChild(t);
      this._typeMath(t);
    } else {
      const blocks = document.createElement('div');
      blocks.className = 'ask-blocks';
      const sources = document.createElement('div');
      sources.className = 'ask-sources';
      sources.style.display = 'none';
      msg.appendChild(blocks);
      msg.appendChild(sources);
      body.blocksEl = blocks;
      body.sourcesEl = sources;
    }
    if (this._messages) this._messages.appendChild(msg);
    this._scrollThread();
    return msg;
  }

  _appendMdBlock(blocksEl: HTMLElement, text: string, decorate = true): HTMLElement | null {
    if (!blocksEl) return null;
    const d = document.createElement('div');
    d.className = 'ai-md ask-ai-reply';
    d.innerHTML = decorateFootnotes(mdToHtml(text, this._sourceOpenNew()), decorate);
    blocksEl.appendChild(d);
    this._typeMath(d);
    return d;
  }

  _scrollThread() {
    if (this._thread) this._thread.scrollTop = this._thread.scrollHeight;
  }

  _grow() {
    const t = this._input;
    if (!t) return;
    t.style.height = 'auto';
    const h = Math.min(t.scrollHeight, 128);
    t.style.height = `${h}px`;
    t.style.overflowY = t.scrollHeight > 128 ? 'auto' : 'hidden';
    this._updateSendState();
  }

  _updateSendState() {
    if (!this._submit) return;
    if (this._streaming) {
      this._submit.disabled = false;
      if (this._sendIcon) this._sendIcon.hidden = true;
      if (this._stopIcon) this._stopIcon.hidden = false;
      this._submit.title = '停止生成';
      this._submit.setAttribute('aria-label', '停止生成');
      return;
    }

    if (this._sendIcon) this._sendIcon.hidden = false;
    if (this._stopIcon) this._stopIcon.hidden = true;
    this._submit.title = '发送 (Enter)';
    this._submit.setAttribute('aria-label', '发送');

    const val = this._input ? this._input.value.trim() : '';
    this._submit.disabled = this._busy || !val;
  }

  _renderSources(el: HTMLElement, hits: any[]) {
    renderSourcesHtml(el, hits, this._sourceOpenNew());
    this._typeMath(el);
  }

  _sourceOpenNew(): boolean {
    return getAiSourceOpen() !== 'same';
  }

  _applySrcOpenToExisting() {
    const openNew = this._sourceOpenNew();
    const links = this.querySelectorAll('.ask-messages a');
    for (const a of Array.from(links)) {
      (a as HTMLAnchorElement).target = openNew ? '_blank' : '_self';
      if (openNew) {
        (a as HTMLAnchorElement).setAttribute('rel', 'noopener');
      } else {
        (a as HTMLAnchorElement).removeAttribute('rel');
      }
    }
  }

  _typeMath(el: HTMLElement) {
    if (!el) return;
    getMathRenderer().then((renderer) => {
      try { renderer(el, this._katexConfig); }
      catch (e) {}
    }).catch(() => {});
  }

  _jsonHtml(v: any, cap = 1400): string {
    return jsonHtml(v, cap);
  }

  _collapseTools(container: HTMLElement) {
    collapseTools(container);
  }

  _collapsePreceding(forceCollapse?: boolean) {
    this._isPrecedingCollapsed = collapsePreceding(
      this._messages,
      this._isPrecedingCollapsed,
      this._collapseBtn,
      forceCollapse
    );
  }

  _togglePrecedingCollapse() {
    this._collapsePreceding(!this._isPrecedingCollapsed);
  }

  _updateCollapseBtnState() {
    updateCollapseBtnState(this._collapseBtn, this._isPrecedingCollapsed);
  }

  _toolBlocksHtml(toolLog: any[], isOpen = false): string {
    return renderToolBlocksHtml(toolLog, isOpen);
  }

  _toolsGroupHtml(tools: any[], isOpen = false): string {
    return renderToolsGroupHtml(tools, isOpen);
  }

  async _ask() {
    if (!this._input) return;
    const q = this._input.value.trim();
    if (!q || this._busy) return;

    // 收集引用的章节列表
    const chapterRefs: ReferencedChapter[] = this._referencedChapters.slice();
    if (this._isDocked && this._refCurrentChapter) {
      const cur = this._getCurrentChapterInfo();
      if (!chapterRefs.some((c) => c.url === cur.url)) {
        chapterRefs.unshift({ ...cur, isCurrent: true });
      }
    }

    // 确保引用的所有章节文本在发送前已完成拉取 (最多等待 1.2s)
    await Promise.all(
      chapterRefs.map(async (c) => {
        if (!c.text) {
          c.text = await Promise.race([
            this._prefetchChapterText(c.url),
            new Promise<string>((resolve) => setTimeout(() => resolve(''), 1200)),
          ]);
        }
      })
    );

    const chapterRefTitles = chapterRefs.map((c) => c.title).filter(Boolean);
    const chapterRefDisplay =
      chapterRefTitles.length === 1
        ? chapterRefTitles[0]
        : chapterRefTitles.length > 1
        ? `${chapterRefTitles.length} 个章节: ${chapterRefTitles.join('、')}`
        : undefined;

    this._hideEmpty();
    this._addMessage('user', { text: q, chapterTitle: chapterRefDisplay });
    this._input.value = '';
    this._grow();
    this._busy = true;
    this._updateSendState();
    try { (window as any).__astrolibTrack?.('ai_ask', { book: this._bookKey() }); } catch {}

    const status = this._status;
    const mode = this._answerMode();
    const discussion = mode === 'discussion';

    const aiMsg = this._addMessage('ai', {});
    const blocksEl = aiMsg.querySelector('.ask-blocks') as HTMLElement;
    const sourcesEl = aiMsg.querySelector('.ask-sources') as HTMLElement;
    if (discussion) sourcesEl.style.display = 'none';

    // 立即插入 Material 3 官方微光思考占位
    blocksEl.innerHTML = createM3LoadingHtml({
      variant: 'default',
      size: 'compact',
      layout: 'inline',
      label: discussion ? 'AI 正在深入思考与推导...' : '正在检索本书知识库...',
      className: 'ask-msg-thinking-placeholder',
    });
    this._scrollThread();

    status.textContent = discussion ? '深度讨论中：AI 正在基于理解作答，需要时按需检索本书…' : '正在检索本书知识库…';

    const params = this._params();
    try {
      let idx = null;
      let hits: any[] = [];
      const ai = await getAiCoreModules();
      if (!discussion) {
        idx = await this._getIndex();
        const retriever = ai.createRetriever(idx.chunks);
        hits = retriever.search(q, { topK: params.topK });
        if (!hits.length) {
          blocksEl.innerHTML = '';
          this._appendMdBlock(blocksEl, '没有在本书中找到相关内容。');
          status.textContent = '没有在本书中找到相关内容。';
          this._busy = false;
          this._updateSendState();
          this._scrollThread();
          return;
        }
        status.textContent = `命中 ${hits.length} 个片段，正在生成回答…`;
      } else {
        status.textContent = '深度讨论中：AI 正在基于理解作答，需要时按需检索本书…';
      }

      const apiKey = this._currentKey();
      const modelDef = this._selectedModel();
      if (apiKey && modelDef && modelDef.endpoint) {
        const res = await this._generateAnswer(blocksEl, {
          mode,
          idx,
          hits,
          question: q,
          chapterRef: chapterRefs[0] || null,
          chapterRefs,
        });
        const text = res.text || '';
        const sources = discussion ? [] : hits.map((h: any) => ({
          type: h.chunk.type, title: h.chunk.title, url: h.chunk.url, text: h.chunk.text,
        }));
        const tools = (res.tools || []).map((t: any) => ({
          name: t.name, args: t.args, summary: t.summary, resultText: t.resultText,
        }));
        if (!discussion && hits.length) this._renderSources(sourcesEl, hits);
        this._appendToThread(q, text, sources, tools, res.segments, chapterRefDisplay);
        status.textContent = '完成。';
      } else {
        const placeholder = blocksEl.querySelector('.ask-msg-thinking-placeholder');
        if (placeholder) placeholder.remove();
        this._appendMdBlock(blocksEl, discussion
          ? '未配置 API Key（或模型/端点缺失），无法生成深度讨论回答。可在设置中配置 Key、选择模型后继续。'
          : '未配置 API Key（或模型/端点缺失），已仅展示检索来源（点击可跳转原文）。可在设置中配置 Key、选择模型后生成答案。', false);
        if (!discussion && hits.length) this._renderSources(sourcesEl, hits);
        status.textContent = '';
      }
    } catch (e: any) {
      const placeholder = blocksEl.querySelector('.ask-msg-thinking-placeholder');
      if (placeholder) placeholder.remove();
      const provider = getAiProvider();
      const modelDef = this._selectedModel();
      const errInfo = parseAiError(e, {
        providerId: provider.id,
        providerLabel: provider.label,
        modelId: modelDef.model || modelDef.id,
        modelLabel: modelDef.label || modelDef.id,
        endpoint: modelDef.endpoint,
      });
      status.textContent = `出错了：${errInfo.title}`;
      const d = document.createElement('div');
      d.className = 'ask-error-container';
      d.innerHTML = renderErrorCardHtml(errInfo);
      blocksEl.appendChild(d);
      console.error('[ai-ask]', e);
    } finally {
      this._busy = false;
      this._updateSendState();
      this._scrollThread();
    }
  }

  async _generateAnswer(blocksEl: HTMLElement, opts: any): Promise<any> {
    if (this._abort) this._abort.abort();
    this._abort = new AbortController();
    const cfg = getConfig(this);
    const ai = await getAiCoreModules();

    return generateChatAnswer({
      blocksEl,
      opts,
      params: this._params(),
      apiKey: this._currentKey(),
      modelDef: this._selectedModel(),
      bookTitle: this._bookTitle,
      bookKey: this._bookKey(),
      col: this._col,
      book: this._book,
      bookList: cfg.bookList || [],
      activeThread: this._activeThread,
      abortSignal: this._abort.signal,
      aiModules: ai,
      sourceOpenNew: this._sourceOpenNew(),
      historyFromThread: (t) => this._historyFromThread(t),
      getIndex: () => this._getIndex(),
      fallbackSummary: (log) => this._fallbackSummary(log),
      typeMath: (el) => this._typeMath(el),
      scrollThread: () => this._scrollThread(),
      collapseTools: (el) => this._collapseTools(el),
      collapsePreceding: (force) => this._collapsePreceding(force),
      setStreaming: (s) => {
        this._streaming = s;
        if (s) this._stateMachine.enterStreaming();
        else this._stateMachine.finishGenerating();
      },
      updateSendState: () => this._updateSendState(),
    });
  }
}

if (!customElements.get('ai-ask')) {
  customElements.define('ai-ask', AIAskElement);
}
