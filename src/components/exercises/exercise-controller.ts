import renderMathInElement from 'katex/dist/contrib/auto-render.mjs';
import { exerciseDb } from '../../utils/exercise-db/exercise-db-client';
import type {
  SlimQuestionItem,
  ChapterData,
  PaperSummary,
  SinglePaperData,
  QuestionOption,
  SubQuestion,
  ChapterSectionSummary,
} from '../../types/exercises';

import { ExerciseExportPipeline } from './exercise-export-pipeline';
import { ExerciseSubmodalsManager } from './exercise-submodals';
import { ExerciseAiFlowManager } from './exercise-ai-flow';
import {
  renderSingleCardHtml,
  renderSolutionBoxContent,
  renderHintsBoxContent,
  esc,
} from './exercise-view-renderer';
import { ExerciseStateMachine, type UserPracticeRecord } from './exercise-controller.state';
import { onAiConfigChange, type AiProviderId } from '../../ai/ai-config';
import { createM3LoadingHtml } from '../common/m3-loading-helper';

export function sanitizeLatexString(val: string): string {
  if (typeof val !== 'string') return '';
  let str = val;
  str = str.replace(/\x0c/g, '\\f');
  str = str.replace(/\x08/g, '\\b');
  str = str.replace(/\x0b/g, '\\v');
  str = str.replace(/\r(?!\n)/g, '\\r');
  str = str.replace(/\t([a-zA-Z])/g, '\\t$1');
  str = str.replace(/(\$\$[\s\S]+?\$\$|\$[^\$\n]+?\$)/g, (m) => m.replace(/\t/g, ' '));
  str = str.replace(/(\$\$[\s\S]+?\$\$|\$[^\$\n]+?\$)/g, (m) =>
    m.replace(/\n(u|eq|ne|not|nabla|notin|nrightarrow|natural|nearrow|nwarrow|neg|normalsize)\b/g, '\\n$1')
  );
  str = str.replace(/\\iiiint_{\\Omega}/g, '\\iiint_{\\Omega}');
  str = str.replace(/\\overparen\{([^}]+)\}/g, '\\stackrel{\\frown}{$1}');
  str = str.replace(/\\wideparen\{([^}]+)\}/g, '\\stackrel{\\frown}{$1}');
  return str;
}

export function sanitizeLatexValue(val: any): any {
  if (typeof val === 'string') {
    return sanitizeLatexString(val);
  } else if (Array.isArray(val)) {
    return val.map(sanitizeLatexValue);
  } else if (val && typeof val === 'object') {
    const res: any = {};
    for (const [k, v] of Object.entries(val)) {
      res[k] = sanitizeLatexValue(v);
    }
    return res;
  }
  return val;
}

import { renderAcademicSolutionMarkdown as renderSolutionMarkdown, EXERCISE_KATEX_OPTIONS as KATEX_OPTIONS } from './exercise-markdown';

export type {
  SlimQuestionItem,
  ChapterData,
  PaperSummary,
  SinglePaperData,
  QuestionOption,
  SubQuestion,
  ChapterSectionSummary,
  UserPracticeRecord,
};

const PAGE_SIZE = 15;

class ExerciseCenterController {
  private root: HTMLElement | null = null;
  private dialogEl: HTMLElement | null = null;
  private windowEl: HTMLElement | null = null;
  private chapterSelect: HTMLSelectElement | null = null;
  private paperSelect: HTMLSelectElement | null = null;
  private sourcePillsContainer: HTMLElement | null = null;
  private groupPillsContainer: HTMLElement | null = null;
  private sectionPillsContainer: HTMLElement | null = null;
  private paperOutlineContainer: HTMLElement | null = null;
  private typePillsContainer: HTMLElement | null = null;
  private searchInput: HTMLInputElement | null = null;
  private searchClearBtn: HTMLElement | null = null;
  private bodyContainer: HTMLElement | null = null;
  private fullscreenBtn: HTMLElement | null = null;
  private closeBtn: HTMLElement | null = null;
  private modeTabs: NodeListOf<HTMLButtonElement> | null = null;
  private toastBox: HTMLElement | null = null;

  private stateMachine = new ExerciseStateMachine();
  private aiFlow = new ExerciseAiFlowManager({
    getBodyContainer: () => this.bodyContainer,
    getQuestion: (qid) => this.currentFilteredQuestions.find((item) => item.id === qid),
    showToast: (msg) => this.showToast(msg),
    closeModal: () => this.close(),
    esc: (s) => esc(s),
  });

  private submodalsManager = new ExerciseSubmodalsManager({
    getQuestion: (qid) => this.currentFilteredQuestions.find((item) => item.id === qid),
    showToast: (msg) => this.showToast(msg),
    getAiSolution: (qid) => this.aiFlow.getAiSolution(qid),
    onSourceSaved: (activeEditorQuestion, parsedData) => {
      this.chapterCache.delete(activeEditorQuestion.chapter);
      this.paperCache.delete(activeEditorQuestion.paper_id);
      this.allQuestionsCache = [];
      if (parsedData.content?.stem) activeEditorQuestion.stem_raw = parsedData.content.stem;
      if (parsedData.solution?.answer) activeEditorQuestion.answer = parsedData.solution.answer;
      if (parsedData.meta?.type) activeEditorQuestion.type = parsedData.meta.type;
      if (this.currentMode === 'practice') {
        this.loadChapter(this.currentChapter);
      } else if (this.currentMode === 'paper') {
        this.loadPaper(this.currentPaperId);
      } else {
        this.filterAndRender();
      }
    },
    onAiSolutionUploaded: (qid, data) => {
      this.aiFlow.addCommunitySolution(qid, data);
    },
    sanitizeLatexValue: (val) => sanitizeLatexValue(val),
  });

  private exportPipeline = new ExerciseExportPipeline({
    getCurrentMode: () => this.currentMode,
    getCurrentChapter: () => this.currentChapter,
    getCurrentPaperId: () => this.currentPaperId,
    getChapterData: (ch) => this.chapterCache.get(ch),
    getPaperData: (pId) => this.paperCache.get(pId),
    getSearchQuery: () => this.searchQuery,
    getFilteredQuestions: () =>
      this.currentFilteredQuestions.length > 0
        ? this.currentFilteredQuestions
        : this.chapterCache.get(this.currentChapter)?.questions || [],
    showToast: (msg) => this.showToast(msg),
  });

  private toolbarEl: HTMLElement | null = null;
  private toolbarToggleBtn: HTMLButtonElement | null = null;
  private isFilterCollapsed = false;

  private totalStatEl: HTMLElement | null = null;
  private doneStatEl: HTMLElement | null = null;
  private accStatEl: HTMLElement | null = null;

  private boundRoot: HTMLElement | null = null;
  private isOpen = false;
  private isFullscreen = false;
  private isGlobalSearch = false;
  private currentMode: 'practice' | 'paper' = 'practice';
  private currentChapter = 1;
  private currentPaperId = 1;
  private currentSource: 'all' | 'textbook' | 'exam' = 'all';
  private currentGroup: 'all' | 'A' | 'B' = 'all';
  private currentSection = 'all';
  private currentPaperSection = 'all';
  private currentType = 'all';
  private searchQuery = '';
  private displayedLimit = PAGE_SIZE;
  private currentBook = 'engineering_analysis';

  private currentFilteredQuestions: SlimQuestionItem[] = [];
  private chapterCache = new Map<number, ChapterData>();
  private paperListSummary: PaperSummary[] = [];
  private paperCache = new Map<number, SinglePaperData>();
  private allQuestionsCache: SlimQuestionItem[] = [];
  private isLoading = false;

  private practiceRecords = new Map<string, UserPracticeRecord>();

  private scopeToggleBtn: HTMLElement | null = null;

  constructor() {
    this.init();
  }

  private init() {
    if (typeof document === 'undefined') return;

    const setup = () => {
      // 路由换页安全清理：若存在多个 root 节点，移除多余的旧节点
      const allRoots = document.querySelectorAll('#exercise-modal-root');
      if (allRoots.length > 1) {
        allRoots.forEach((node, idx) => {
          if (idx < allRoots.length - 1) node.remove();
        });
      }

      const newRoot = document.getElementById('exercise-modal-root');
      if (!newRoot) return;

      if (this.root && this.root !== newRoot) {
        this.root.remove();
      }
      this.root = newRoot;

      if (this.root.parentElement !== document.body) {
        document.body.appendChild(this.root);
      }

      this.dialogEl = this.root.querySelector('#exercise-modal-dialog');
      this.windowEl = (this.dialogEl || this.root.querySelector('.ex-modal-window')) as HTMLElement;
      this.chapterSelect = this.root.querySelector('.ex-chapter-select');
      this.paperSelect = this.root.querySelector('.ex-paper-select');
      this.sourcePillsContainer = this.root.querySelector('.ex-source-pills');
      this.groupPillsContainer = this.root.querySelector('.ex-group-pills');
      this.sectionPillsContainer = this.root.querySelector('.ex-section-pills');
      this.paperOutlineContainer = this.root.querySelector('.ex-paper-outline-bar');
      this.typePillsContainer = this.root.querySelector('.ex-type-pills');
      this.searchInput = this.root.querySelector('.ex-search-input');
      this.searchClearBtn = this.root.querySelector('.ex-search-clear');
      this.scopeToggleBtn = this.root.querySelector('#ex-scope-toggle-btn');
      this.bodyContainer = this.root.querySelector('.ex-body');
      this.fullscreenBtn = this.root.querySelector('.ex-fullscreen-btn');
      this.closeBtn = this.root.querySelector('.ex-close-btn');
      this.modeTabs = this.root.querySelectorAll('.ex-mode-tab');
      this.toastBox = this.root.querySelector('#ex-toast-box');

      this.submodalsManager.initElements(this.root);
      this.exportPipeline.initElements(this.root);

      this.totalStatEl = this.root.querySelector('.ex-stat-total');
      this.doneStatEl = this.root.querySelector('.ex-stat-done');
      this.accStatEl = this.root.querySelector('.ex-stat-acc');

      this.toolbarEl = this.root.querySelector('.ex-toolbar');
      this.toolbarToggleBtn = this.root.querySelector('#ex-toolbar-toggle-btn');
      try {
        const savedCollapsed = localStorage.getItem('astro_exercise_filter_collapsed');
        const isMobileScreen = typeof window !== 'undefined' && window.innerWidth <= 640;
        // 规范第九条：移动端优先进入「沉浸做题态」，筛选默认收起；桌面端遵从用户记忆
        const shouldCollapse = savedCollapsed !== null ? savedCollapsed === '1' : isMobileScreen;
        if (shouldCollapse) {
          this.setFilterCollapsed(true);
        }
      } catch {}

      this.bindEvents();
    };

    onAiConfigChange((cfg) => {
      if (this.bodyContainer) {
        this.bodyContainer.querySelectorAll<HTMLElement>('.ex-ai-model-badge').forEach((badge) => {
          const card = badge.closest('.ex-q-card');
          const qid = card?.getAttribute('data-qid');
          if (qid) {
            const activeVer = this.aiFlow.getActiveSolutionVersion(qid);
            if (activeVer === 'local') {
              badge.textContent = cfg.label;
            }
          }
        });
      }
    });

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', setup);
    } else {
      setup();
    }

    document.addEventListener('astro:page-load', setup);

    // 监听页面卸载，释放全屏题库、PDF 渲染引擎与长周期缓存
    document.addEventListener('astrolib:page-unload', () => {
      if (this.isOpen) {
        this.close();
      }
      this.exportPipeline.destroy();
      this.chapterCache.clear();
      this.paperCache.clear();
      this.allQuestionsCache = [];
      this.boundRoot = null;
    });

    const win = window as any;
    if (!win.__exerciseGlobalBound) {
      win.__exerciseGlobalBound = true;

      window.addEventListener('exercises:open', (e: any) => {
        const detail = e.detail || {};
        if (detail.mode === 'paper') {
          this.openPaper(detail.paperId || 1, detail.targetQid, detail.book);
        } else {
          this.open(detail.chapter || 1, detail.section || 'all', detail.book);
        }
      });

      document.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        const trigger = target?.closest('[data-exercise-trigger]');
        if (trigger) {
          e.preventDefault();
          const ch = parseInt(trigger.getAttribute('data-chapter') || '1', 10);
          const sec = trigger.getAttribute('data-section') || 'all';
          this.open(ch, sec);
        }
      });

      document.addEventListener('keydown', (e) => {
        if (e.altKey && (e.key === 'e' || e.key === 'E')) {
          e.preventDefault();
          if (this.isOpen) {
            this.close();
          } else {
            this.open(this.detectCurrentChapter(), this.detectCurrentSection());
          }
        } else if (e.key === 'Escape' && this.isOpen) {
          if (this.isSubmodalOpen()) {
            this.closeAllSubmodals();
          } else {
            this.close();
          }
        }
      });
    }
  }

  private isSubmodalOpen(): boolean {
    return this.submodalsManager.isSubmodalOpen() || this.exportPipeline.isModalOpen();
  }

  private closeAllSubmodals() {
    this.submodalsManager.closeAllSubmodals();
    this.exportPipeline.closeLatexModal();
  }

  public openLatexModal() {
    this.exportPipeline.openLatexModal();
  }

  public closeLatexModal() {
    this.exportPipeline.closeLatexModal();
  }

  private detectCurrentChapter(): number {
    const path = window.location.pathname;
    const match = path.match(/\/(\d+)\.\d+_/);
    if (match) return parseInt(match[1], 10);
    return this.currentChapter || 1;
  }

  private detectCurrentSection(): string {
    const path = window.location.pathname;
    const match = path.match(/\/(\d+\.\d+)_/);
    if (match) return match[1];
    return 'all';
  }

  private bindEvents() {
    if (!this.root || this.boundRoot === this.root) return;
    this.boundRoot = this.root;

    const backdrop = this.root.querySelector('.ex-modal-backdrop');
    if (backdrop) backdrop.addEventListener('click', () => this.close());

    if (this.dialogEl) {
      this.dialogEl.addEventListener('cancel', (e: Event) => {
        if (this.isSubmodalOpen()) {
          e.preventDefault();
          this.closeAllSubmodals();
          return;
        }
        this.close();
      });
      this.dialogEl.addEventListener('closed', () => {
        this.isOpen = false;
        this.root?.classList.remove('is-open');
        document.body.style.overflow = '';
        this.closeAllSubmodals();
      });
    }

    if (this.closeBtn) this.closeBtn.addEventListener('click', () => this.close());
    if (this.fullscreenBtn) this.fullscreenBtn.addEventListener('click', () => this.toggleFullscreen());
    if (this.toolbarToggleBtn) this.toolbarToggleBtn.addEventListener('click', () => this.toggleFilterCollapse());

    if (this.toolbarEl) {
      this.toolbarEl.addEventListener('click', (e) => {
        if (window.innerWidth <= 640 && !this.isFilterCollapsed) {
          const filterRow = this.toolbarEl?.querySelector('.ex-filter-row');
          if (filterRow && !filterRow.contains(e.target as Node) && !this.toolbarToggleBtn?.contains(e.target as Node)) {
            this.setFilterCollapsed(true);
          }
        }
      });
    }

    if (this.chapterSelect) {
      this.chapterSelect.addEventListener('change', (e) => {
        const val = parseInt((e.target as HTMLSelectElement).value, 10);
        this.currentChapter = val;
        this.currentSection = 'all';
        this.displayedLimit = PAGE_SIZE;
        this.loadChapter(val);
      });
    }

    if (this.paperSelect) {
      this.paperSelect.addEventListener('change', (e) => {
        const val = parseInt((e.target as HTMLSelectElement).value, 10);
        if (!isNaN(val)) {
          this.currentPaperId = val;
          this.currentPaperSection = 'all';
          this.displayedLimit = PAGE_SIZE;
          this.loadPaper(val);
        }
      });
    }

    if (this.modeTabs) {
      this.modeTabs.forEach((tab) => {
        tab.addEventListener('click', () => {
          const mode = (tab.getAttribute('data-mode') || 'practice') as 'practice' | 'paper';
          this.switchMode(mode);
        });
      });
    }

    if (this.scopeToggleBtn) {
      this.scopeToggleBtn.addEventListener('click', async () => {
        this.isGlobalSearch = !this.isGlobalSearch;
        this.scopeToggleBtn?.classList.toggle('active', this.isGlobalSearch);
        if (this.searchInput) {
          this.searchInput.placeholder = this.isGlobalSearch
            ? '全库检索题目、LaTeX 或考点...'
            : '输入题干关键字、LaTeX 或考点...';
        }
        if (this.isGlobalSearch) {
          await this.ensureAllQuestionsLoaded();
        } else {
          this.allQuestionsCache = [];
          this.trimChapterCache(2);
        }
        this.displayedLimit = PAGE_SIZE;
        this.filterAndRender();
      });
    }

    if (this.searchInput) {
      let debounceTimer: any = null;
      this.searchInput.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(async () => {
          this.searchQuery = (e.target as HTMLInputElement).value.trim();
          if (this.isGlobalSearch) {
            await this.ensureAllQuestionsLoaded();
          }
          this.displayedLimit = PAGE_SIZE;
          this.filterAndRender();
        }, 50);
      });
    }

    if (this.searchClearBtn && this.searchInput) {
      this.searchClearBtn.addEventListener('click', () => {
        if (this.searchInput) this.searchInput.value = '';
        this.searchQuery = '';
        this.displayedLimit = PAGE_SIZE;
        this.filterAndRender();
      });
    }

    if (this.typePillsContainer) {
      this.typePillsContainer.addEventListener('click', (e) => {
        const pill = (e.target as HTMLElement).closest('.ex-nav-item, .ex-filter-pill');
        if (!pill) return;
        this.typePillsContainer?.querySelectorAll('.ex-nav-item, .ex-filter-pill').forEach((p) => p.classList.remove('active'));
        pill.classList.add('active');
        this.currentType = pill.getAttribute('data-type') || 'all';
        this.displayedLimit = PAGE_SIZE;
        this.filterAndRender();
      });
    }

    if (this.sourcePillsContainer) {
      this.sourcePillsContainer.addEventListener('click', (e) => {
        const pill = (e.target as HTMLElement).closest('.ex-nav-item');
        if (!pill) return;
        this.sourcePillsContainer?.querySelectorAll('.ex-nav-item').forEach((p) => p.classList.remove('active'));
        pill.classList.add('active');
        const src = (pill.getAttribute('data-source') || 'all') as any;
        this.currentSource = src;
        if (this.currentSource === 'textbook') {
          this.groupPillsContainer?.classList.remove('hidden');
        } else {
          this.groupPillsContainer?.classList.add('hidden');
        }
        this.currentGroup = 'all';
        this.groupPillsContainer?.querySelectorAll('.ex-nav-item').forEach((p) => {
          p.classList.toggle('active', p.getAttribute('data-group') === 'all');
        });
        this.displayedLimit = PAGE_SIZE;
        this.filterAndRender();
      });
    }

    if (this.groupPillsContainer) {
      this.groupPillsContainer.addEventListener('click', (e) => {
        const pill = (e.target as HTMLElement).closest('.ex-nav-item');
        if (!pill) return;
        this.groupPillsContainer?.querySelectorAll('.ex-nav-item').forEach((p) => p.classList.remove('active'));
        pill.classList.add('active');
        this.currentGroup = (pill.getAttribute('data-group') || 'all') as any;
        this.displayedLimit = PAGE_SIZE;
        this.filterAndRender();
      });
    }

    if (this.bodyContainer) {
      this.bindBodyDelegatedInteractions(this.bodyContainer);
    }
  }

  private switchMode(mode: 'practice' | 'paper') {
    this.currentMode = mode;
    this.displayedLimit = PAGE_SIZE;

    this.modeTabs?.forEach((t) => {
      t.classList.toggle('active', t.getAttribute('data-mode') === mode);
    });

    if (mode === 'practice') {
      this.chapterSelect?.classList.remove('hidden');
      this.paperSelect?.classList.add('hidden');
      this.sourcePillsContainer?.classList.remove('hidden');
      if (this.currentSource === 'textbook') {
        this.groupPillsContainer?.classList.remove('hidden');
      } else {
        this.groupPillsContainer?.classList.add('hidden');
      }
      this.sectionPillsContainer?.classList.remove('hidden');
      this.paperOutlineContainer?.classList.add('hidden');
      this.loadChapter(this.currentChapter);
    } else if (mode === 'paper') {
      this.chapterSelect?.classList.add('hidden');
      this.paperSelect?.classList.remove('hidden');
      this.sourcePillsContainer?.classList.add('hidden');
      this.groupPillsContainer?.classList.add('hidden');
      this.sectionPillsContainer?.classList.add('hidden');
      this.paperOutlineContainer?.classList.remove('hidden');
      this.ensurePaperListLoaded().then(() => {
        this.loadPaper(this.currentPaperId);
      });
    }
  }

  private ensureDialogCentered(targetModal: HTMLElement) {
    targetModal.setAttribute('quick', '');
    (targetModal as any).quick = true;
    const shadow = targetModal.shadowRoot;
    if (!shadow) return;
    const nativeDialog = shadow.querySelector('dialog');
    if (nativeDialog) {
      nativeDialog.style.margin = 'auto';
      nativeDialog.style.inset = '0';
    }
    let style = shadow.querySelector('#m3-dialog-centering-style') as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement('style');
      style.id = 'm3-dialog-centering-style';
      shadow.appendChild(style);
    }
    style.textContent = `
      dialog {
        margin: auto !important;
        inset: 0 !important;
        transform-origin: center center;
        width: inherit !important;
        height: inherit !important;
        max-width: inherit !important;
        max-height: inherit !important;
        border-radius: inherit !important;
        overflow: hidden !important;
        display: flex !important;
        flex-direction: column !important;
      }
      .container {
        border-radius: inherit !important;
        display: flex !important;
        flex-direction: column !important;
        flex: 1 !important;
        height: 100% !important;
        min-height: 0 !important;
        overflow: hidden !important;
      }
      .scroller {
        overflow: hidden !important;
        display: flex !important;
        flex: 1 !important;
        flex-direction: column !important;
        min-height: 0 !important;
      }
      .content {
        height: 100% !important;
        display: flex !important;
        flex-direction: column !important;
        min-height: 0 !important;
        padding: 0 !important;
      }
      slot[name=headline]::slotted(*) {
        padding: 0 !important;
        width: 100% !important;
      }
      slot[name=content]::slotted(*) {
        padding: 0 !important;
        height: 100% !important;
        display: flex !important;
        flex-direction: column !important;
        min-height: 0 !important;
      }
      .scrim {
        background-color: rgba(0, 0, 0, 0.38) !important;
        backdrop-filter: blur(4px) !important;
        -webkit-backdrop-filter: blur(4px) !important;
        z-index: var(--layer-dialog, 500) !important;
      }
      ::backdrop {
        background: rgba(0, 0, 0, 0.38) !important;
        backdrop-filter: blur(4px) !important;
        -webkit-backdrop-filter: blur(4px) !important;
      }
    `;
  }

  public open(chapter = 1, section = 'all', book?: string) {
    if (!this.root) this.root = document.getElementById('exercise-modal-root');
    if (!this.root) return;

    if (book && book !== this.currentBook) {
      this.currentBook = book;
      this.chapterCache.clear();
      this.paperCache.clear();
      this.paperListSummary = [];
      this.allQuestionsCache = [];
    }

    if (this.root.parentElement !== document.body) {
      document.body.appendChild(this.root);
    }

    this.isOpen = true;
    this.root.classList.add('is-open');
    document.body.style.overflow = 'hidden';

    if (this.dialogEl) {
      this.ensureDialogCentered(this.dialogEl);
      const dlg = this.dialogEl as any;
      if (typeof dlg.show === 'function') {
        dlg.show();
      } else {
        dlg.open = true;
      }
    }

    this.currentChapter = chapter;
    this.currentSection = section;
    this.displayedLimit = PAGE_SIZE;

    if (this.chapterSelect) {
      this.chapterSelect.value = String(chapter);
    }

    this.switchMode('practice');
  }

  public openPaper(paperId = 1, targetQid?: string, book?: string) {
    if (!this.root) this.root = document.getElementById('exercise-modal-root');
    if (!this.root) return;

    if (book && book !== this.currentBook) {
      this.currentBook = book;
      this.chapterCache.clear();
      this.paperCache.clear();
      this.paperListSummary = [];
      this.allQuestionsCache = [];
    }

    if (this.root.parentElement !== document.body) {
      document.body.appendChild(this.root);
    }

    this.isOpen = true;
    this.root.classList.add('is-open');
    document.body.style.overflow = 'hidden';

    if (this.dialogEl) {
      this.ensureDialogCentered(this.dialogEl);
      const dlg = this.dialogEl as any;
      if (typeof dlg.show === 'function') {
        dlg.show();
      } else {
        dlg.open = true;
      }
    }

    this.currentPaperId = paperId;
    this.currentPaperSection = 'all';
    this.displayedLimit = PAGE_SIZE;

    this.switchMode('paper');

    if (targetQid) {
      setTimeout(() => {
        this.scrollToQuestion(targetQid);
      }, 250);
    }
  }

  public close() {
    if (!this.root) return;
    this.isOpen = false;
    this.root.classList.remove('is-open');
    document.body.style.overflow = '';
    this.closeAllSubmodals();
    this.aiFlow.destroy();
    this.allQuestionsCache = [];
    this.trimChapterCache(2);
    this.trimPaperCache(2);

    if (this.dialogEl) {
      const dlg = this.dialogEl as any;
      if (typeof dlg.close === 'function') {
        dlg.close();
      } else {
        dlg.open = false;
      }
    }
  }

  /**
   * LRU 缓存淘汰策略：保持最多保活 max 个章节 JSON，防止内存无上限膨胀
   */
  private trimChapterCache(max = 2) {
    while (this.chapterCache.size > max) {
      const oldestKey = this.chapterCache.keys().next().value;
      if (oldestKey !== undefined) {
        this.chapterCache.delete(oldestKey);
      } else {
        break;
      }
    }
  }

  /**
   * LRU 缓存淘汰策略：保持最多保活 max 套试卷 JSON
   */
  private trimPaperCache(max = 2) {
    while (this.paperCache.size > max) {
      const oldestKey = this.paperCache.keys().next().value;
      if (oldestKey !== undefined) {
        this.paperCache.delete(oldestKey);
      } else {
        break;
      }
    }
  }

  private toggleFullscreen() {
    this.isFullscreen = !this.isFullscreen;
    if (this.dialogEl) {
      this.dialogEl.classList.toggle('is-fullscreen', this.isFullscreen);
    }
    if (this.windowEl && this.windowEl !== this.dialogEl) {
      this.windowEl.classList.toggle('is-fullscreen', this.isFullscreen);
    }
    const fsIcon = this.root?.querySelector('#ex-fullscreen-icon');
    if (fsIcon) {
      fsIcon.textContent = this.isFullscreen ? 'fullscreen_exit' : 'fullscreen';
    }
    if (this.fullscreenBtn) {
      this.fullscreenBtn.setAttribute('title', this.isFullscreen ? '退出全屏 (F)' : '全屏/窗口切换 (F)');
    }
  }

  private toggleFilterCollapse() {
    this.setFilterCollapsed(!this.isFilterCollapsed);
  }

  private setFilterCollapsed(collapsed: boolean) {
    this.isFilterCollapsed = collapsed;
    if (this.toolbarEl) {
      this.toolbarEl.classList.toggle('is-collapsed', collapsed);
    }
    if (this.toolbarToggleBtn) {
      const label = this.toolbarToggleBtn.querySelector('.ex-toggle-label');
      if (label) label.textContent = collapsed ? '展开筛选' : '收起筛选';
      this.toolbarToggleBtn.setAttribute('title', collapsed ? '展开筛选' : '收起筛选');
      this.toolbarToggleBtn.setAttribute('aria-label', collapsed ? '展开筛选' : '收起筛选');
    }
    try {
      localStorage.setItem('astro_exercise_filter_collapsed', collapsed ? '1' : '0');
    } catch {}
  }

  private scrollToQuestion(qid: string) {
    if (!this.bodyContainer) return;
    const card = this.bodyContainer.querySelector(`#q-card-${qid}`) as HTMLElement;
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.classList.add('ex-q-card-pulse');
      setTimeout(() => {
        card.classList.remove('ex-q-card-pulse');
      }, 1500);
    }
  }

  private async loadChapter(chId: number) {
    if (this.chapterCache.has(chId)) {
      const data = this.chapterCache.get(chId)!;
      this.updateSectionPills(data);
      this.filterAndRender();
      return;
    }

    this.isLoading = true;
    this.renderLoading(`正在加载第 ${chId} 章题库与公式...`);

    try {
      const resp = await fetch(`/data/exercises/${this.currentBook}/ch${chId}.json`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data: ChapterData = await resp.json();
      this.chapterCache.set(chId, data);
      this.trimChapterCache(2);
      this.isLoading = false;
      this.updateSectionPills(data);
      this.filterAndRender();
    } catch (err) {
      this.isLoading = false;
      this.renderError('题库数据加载失败，请检查网络或刷新重试。');
    }
  }

  private async ensurePaperListLoaded() {
    if (this.paperListSummary.length > 0) return;

    try {
      const resp = await fetch(`/data/exercises/${this.currentBook}/papers.json`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      this.paperListSummary = data.papers || [];

      if (this.paperSelect && this.paperListSummary.length > 0) {
        let optionsHtml = '';
        const tbPapers = this.paperListSummary.filter((p) => p.category === '教材课后习题');
        const examPapers = this.paperListSummary.filter((p) => p.category !== '教材课后习题');

        if (tbPapers.length > 0) {
          optionsHtml += `<optgroup label="📚 教材分章课后习题集（${tbPapers.length}套）">`;
          tbPapers.forEach((p) => {
            const isSelected = p.paper_id === this.currentPaperId;
            optionsHtml += `<option value="${p.paper_id}" ${isSelected ? 'selected' : ''}>${p.clean_title} [${p.total_questions}题]</option>`;
          });
          optionsHtml += `</optgroup>`;
        }

        if (examPapers.length > 0) {
          optionsHtml += `<optgroup label="🎓 《大邮数学集》历年真题试卷（CC协议 · ${examPapers.length}套）">`;
          examPapers.forEach((p) => {
            const isSelected = p.paper_id === this.currentPaperId;
            const scoreText = p.total_score ? `[${p.total_score}分 / ${p.total_questions}题]` : `[${p.total_questions}题]`;
            optionsHtml += `<option value="${p.paper_id}" ${isSelected ? 'selected' : ''}>${p.clean_title} ${scoreText}</option>`;
          });
          optionsHtml += `</optgroup>`;
        }
        this.paperSelect.innerHTML = optionsHtml;
      }
    } catch (err) {
      console.warn('[ExerciseController] 加载试卷列表失败:', err);
    }
  }

  private async loadPaper(paperId: number) {
    if (this.paperCache.has(paperId)) {
      const data = this.paperCache.get(paperId)!;
      this.updatePaperOutlineBar(data);
      this.filterAndRender();
      return;
    }

    this.isLoading = true;
    this.renderLoading(`正在加载真题试卷内容与大纲...`);

    try {
      const resp = await fetch(`/data/exercises/${this.currentBook}/papers/p${paperId}.json`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data: SinglePaperData = await resp.json();
      this.paperCache.set(paperId, data);
      this.trimPaperCache(2);
      this.isLoading = false;
      this.updatePaperOutlineBar(data);
      this.filterAndRender();
    } catch (err) {
      this.isLoading = false;
      this.renderError('试卷数据加载失败，请检查网络或刷新重试。');
    }
  }

  private async ensureAllQuestionsLoaded() {
    if (this.allQuestionsCache.length > 0) return;
    this.isLoading = true;
    this.renderLoading('正在构建全书题目全局检索索引...');

    const maxCh = this.currentBook === 'linear_algebra_geometry' ? 9 : 7;
    const chList = Array.from({ length: maxCh }, (_, i) => i + 1);
    const loadPromises = chList.map(async (ch) => {
      if (this.chapterCache.has(ch)) return this.chapterCache.get(ch)!.questions;
      try {
        const resp = await fetch(`/data/exercises/${this.currentBook}/ch${ch}.json`);
        if (resp.ok) {
          const data: ChapterData = await resp.json();
          this.chapterCache.set(ch, data);
          return data.questions;
        }
      } catch {}
      return [];
    });

    const results = await Promise.all(loadPromises);
    this.allQuestionsCache = results.flat();
    this.isLoading = false;
  }

  private updateSectionPills(data: ChapterData) {
    if (!this.sectionPillsContainer) return;

    let html = `<button type="button" class="ex-nav-item ${this.currentSection === 'all' ? 'active' : ''}" data-section="all">
      全部小节 <span class="ex-nav-count">${data.total}</span>
    </button>`;

    (data.sections || []).forEach((sec) => {
      const isActive = this.currentSection === sec.section;
      const titleSnippet = sec.section_title ? ` ${this.esc(sec.section_title)}` : '';
      html += `<button type="button" class="ex-nav-item ${isActive ? 'active' : ''}" data-section="${sec.section}" title="${this.esc(sec.section_title || sec.section)}">
        <span class="ex-nav-label">${sec.section}${titleSnippet}</span><span class="ex-nav-count">${sec.count}</span>
      </button>`;
    });

    this.sectionPillsContainer.innerHTML = html;

    this.sectionPillsContainer.querySelectorAll('.ex-nav-item').forEach((item) => {
      item.addEventListener('click', () => {
        this.sectionPillsContainer?.querySelectorAll('.ex-nav-item').forEach((p) => p.classList.remove('active'));
        item.classList.add('active');
        this.currentSection = item.getAttribute('data-section') || 'all';
        this.displayedLimit = PAGE_SIZE;
        this.filterAndRender();
      });
    });
  }

  private updatePaperOutlineBar(data: SinglePaperData) {
    if (!this.paperOutlineContainer) return;

    let html = `<button type="button" class="ex-nav-item ${this.currentPaperSection === 'all' ? 'active' : ''}" data-paper-sec="all">
      整卷 <span class="ex-nav-count">${data.total_questions}</span>
    </button>`;

    (data.sections_order || []).forEach((secName) => {
      const count = data.questions.filter((q) => q.section_type === secName).length;
      const isActive = this.currentPaperSection === secName;
      const shortTitle = secName.replace(/（.*）/, '').replace(/\(.*\)/, '').trim();
      html += `<button type="button" class="ex-nav-item ${isActive ? 'active' : ''}" data-paper-sec="${this.esc(secName)}">
        <span class="ex-nav-label">${shortTitle}</span><span class="ex-nav-count">${count}</span>
      </button>`;
    });

    this.paperOutlineContainer.innerHTML = html;

    this.paperOutlineContainer.querySelectorAll('.ex-nav-item').forEach((item) => {
      item.addEventListener('click', () => {
        this.paperOutlineContainer?.querySelectorAll('.ex-nav-item').forEach((p) => p.classList.remove('active'));
        item.classList.add('active');
        this.currentPaperSection = item.getAttribute('data-paper-sec') || 'all';
        this.displayedLimit = PAGE_SIZE;
        this.filterAndRender();
      });
    });
  }

  private renderLoading(msg: string) {
    if (!this.bodyContainer) return;
    this.bodyContainer.innerHTML = createM3LoadingHtml({
      variant: 'contained',
      size: 'medium',
      layout: 'block',
      label: msg,
      className: 'ex-loading-state',
    });
  }

  private renderError(msg: string) {
    if (!this.bodyContainer) return;
    this.bodyContainer.innerHTML = `
      <div class="ex-empty-state">
        <svg class="ex-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <span>${msg}</span>
      </div>
    `;
  }

  private renderEmpty(msg: string) {
    if (!this.bodyContainer) return;
    this.bodyContainer.innerHTML = `
      <div class="ex-empty-state">
        <svg class="ex-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <span>${msg}</span>
      </div>
    `;
  }

  private filterAndRender() {
    if (!this.bodyContainer) return;

    let sourceList: SlimQuestionItem[] = [];

    if (this.isGlobalSearch) {
      sourceList = this.allQuestionsCache.length > 0 ? this.allQuestionsCache : (this.chapterCache.get(this.currentChapter)?.questions || []);
    } else if (this.currentMode === 'practice') {
      const data = this.chapterCache.get(this.currentChapter);
      sourceList = data?.questions || [];
    } else if (this.currentMode === 'paper') {
      const data = this.paperCache.get(this.currentPaperId);
      sourceList = data?.questions || [];
    }

    if (sourceList.length === 0 && !this.isLoading) {
      this.renderEmpty('暂无题目数据');
      return;
    }

    let filtered = sourceList;

    if (!this.isGlobalSearch && this.currentMode === 'practice' && this.currentSection !== 'all') {
      filtered = filtered.filter((q) => {
        return q.sec === this.currentSection || q.sec_slug?.startsWith(this.currentSection);
      });
    }

    if (!this.isGlobalSearch && this.currentMode === 'paper' && this.currentPaperSection !== 'all') {
      filtered = filtered.filter((q) => q.section_type === this.currentPaperSection);
    }

    if (this.currentSource !== 'all') {
      filtered = filtered.filter((q) => (q.source_type || 'exam') === this.currentSource);
    }

    if (this.currentSource === 'textbook' && this.currentGroup !== 'all') {
      filtered = filtered.filter((q) => q.group === this.currentGroup);
    }

    if (this.currentType !== 'all') {
      filtered = filtered.filter((q) => q.type === this.currentType);
    }

    if (this.searchQuery) {
      const qLower = this.searchQuery.toLowerCase();
      filtered = filtered.filter((q) => q.search.includes(qLower));
    }

    this.currentFilteredQuestions = filtered;

    if (filtered.length === 0) {
      this.renderEmpty('未找到符合当前筛选条件的题目');
      this.updateStats(0, 0, 0);
      return;
    }

    let doneCount = 0;
    let correctCount = 0;
    filtered.forEach((q) => {
      const rec = this.practiceRecords.get(q.id);
      if (rec && rec.answered) {
        doneCount++;
        if (rec.isCorrect || rec.mastered) correctCount++;
      }
    });
    this.updateStats(filtered.length, doneCount, correctCount);

    this.renderQuestionSlice();
  }

  private updateStats(total: number, done: number, correct: number) {
    if (this.totalStatEl) this.totalStatEl.textContent = String(total);
    if (this.doneStatEl) this.doneStatEl.textContent = String(done);
    if (this.accStatEl) {
      const rate = done > 0 ? Math.round((correct / done) * 100) : 0;
      this.accStatEl.textContent = `${rate}%`;
    }
  }

  private renderQuestionSlice() {
    if (!this.bodyContainer) return;
    const questionsToRender = this.currentFilteredQuestions.slice(0, this.displayedLimit);
    const totalFiltered = this.currentFilteredQuestions.length;

    let cardsHtml = '';
    let lastSectionType = '';

    questionsToRender.forEach((q, idx) => {
      if (this.currentMode === 'paper' && q.section_type && q.section_type !== lastSectionType) {
        lastSectionType = q.section_type;
        cardsHtml += `
          <div class="ex-paper-section-header">
            <h3 class="ex-paper-sec-heading">${this.esc(lastSectionType)}</h3>
          </div>
        `;
      }
      cardsHtml += this.renderSingleCardHtml(q, idx);
    });

    let footerHtml = '';
    if (totalFiltered > this.displayedLimit) {
      const remaining = totalFiltered - this.displayedLimit;
      footerHtml = `
        <div class="ex-load-more-wrap">
          <button type="button" class="ex-load-more-btn" data-action="load-more">
            <span>加载更多（剩余 ${remaining} 题）</span>
          </button>
        </div>
      `;
    } else if (totalFiltered > PAGE_SIZE) {
      footerHtml = `
        <div class="ex-all-loaded">
          <span>— 已加载全部 ${totalFiltered} 道题目 —</span>
        </div>
      `;
    }

    this.bodyContainer.innerHTML = cardsHtml + footerHtml;

    this.renderAllAiKaTeX();

    if (this.displayedLimit === PAGE_SIZE) {
      this.bodyContainer.scrollTop = 0;
    }
  }

  private renderAllAiKaTeX() {
    if (!this.bodyContainer) return;
    const aiContents = this.bodyContainer.querySelectorAll('.ex-ai-content');
    aiContents.forEach((el) => {
      try {
        renderMathInElement(el as HTMLElement, KATEX_OPTIONS);
      } catch (e) {}
    });
  }

  private renderSingleCardHtml(q: SlimQuestionItem, idx: number): string {
    const qid = q.id;
    const record = this.practiceRecords.get(qid) || { answered: false };
    const hasLocalAiSolution = this.aiFlow.hasAiSolution(qid);
    const activeVer = this.aiFlow.getActiveSolutionVersion(qid);
    const communityList = this.aiFlow.getCommunitySolutions(qid);
    let currentSolutionMd = '';

    if (activeVer === 'local') {
      currentSolutionMd = this.aiFlow.getAiSolution(qid);
    } else {
      const match = communityList.find((s) => s.id === activeVer);
      if (match) currentSolutionMd = match.solution_md;
    }

    return renderSingleCardHtml({
      q,
      idx,
      record,
      activeVer,
      communityList,
      currentSolutionMd,
      hasLocalAiSolution,
    });
  }

  private bindBodyDelegatedInteractions(body: HTMLElement) {
    body.addEventListener('click', async (e) => {
      try {
        const target = e.target as HTMLElement;
        const btn = target.closest('[data-action]') as HTMLElement;
        if (!btn) return;

        const action = btn.getAttribute('data-action');
        const qid = btn.getAttribute('data-qid') || '';

        if (action === 'jump-to-paper') {
          const paperId = parseInt(btn.getAttribute('data-paper-id') || '1', 10);
          this.openPaper(paperId, qid);
          return;
        }

        if (action === 'open-feedback') {
          this.submodalsManager.openFeedbackModal(qid);
          return;
        }

        if (action === 'open-source-editor') {
          this.submodalsManager.openSourceEditorModal(qid);
          return;
        }

        if (action === 'open-ai-upload') {
          this.submodalsManager.openAiUploadModal(qid);
          return;
        }

        if (action === 'switch-ai-ver') {
          const ver = btn.getAttribute('data-ver') || 'local';
          this.aiFlow.switchAiVersion(qid, ver);
          return;
        }

        if (action === 'upvote-sol') {
          const solId = btn.getAttribute('data-sol-id') || '';
          this.aiFlow.upvoteSolution(qid, solId);
          return;
        }

        if (action === 'select-option') {
          const optKey = btn.getAttribute('data-key') || '';
          this.handleOptionSelect(qid, optKey);
          return;
        }

        if (action === 'check-blank') {
          this.handleBlankCheck(qid);
          return;
        }

        if (action === 'toggle-steps') {
          this.toggleSteps(qid);
          return;
        }

        if (action === 'toggle-hints') {
          this.toggleHints(qid);
          return;
        }

        if (action === 'master') {
          this.toggleMaster(qid);
          return;
        }

        if (action === 'ask-ai') {
          this.aiFlow.handleAskAi(qid);
          return;
        }

        if (action === 'retry-ai') {
          this.aiFlow.handleAskAi(qid, true);
          return;
        }

        if (action === 'stop-ai') {
          this.aiFlow.stopAiStream(qid);
          return;
        }

        if (action === 'copy-ai') {
          this.aiFlow.copyAiSolution(qid);
          return;
        }

        if (action === 'toggle-ai-box') {
          this.aiFlow.toggleAiBox(qid);
          return;
        }

        if (action === 'open-ai-settings') {
          this.aiFlow.openAiSettings();
          return;
        }

        if (action === 'bridge-ai-chat') {
          this.aiFlow.bridgeToAiChat(qid);
          return;
        }

        if (action === 'switch-provider-quick') {
          const provider = btn.getAttribute('data-provider') as AiProviderId;
          if (provider) {
            this.aiFlow.switchProviderQuick(qid, provider);
          }
          return;
        }

        if (action === 'save-ai-key') {
          this.aiFlow.saveAiKey(qid);
          return;
        }

        if (action === 'load-more') {
          this.displayedLimit += PAGE_SIZE;
          this.renderQuestionSlice();
          return;
        }
      } catch (err) {
        console.error('[ExerciseController] Click action error:', err);
      }
    });

    body.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const target = e.target as HTMLElement;
        if (target.classList.contains('ex-blank-input')) {
          const wrap = target.closest('.ex-blank-wrap');
          const qid = wrap?.getAttribute('data-qid');
          if (qid) this.handleBlankCheck(qid);
        }
      }
    });
  }

  /**
   * 构造参考答案、推导步骤与考点提示 HTML (按需执行，避免全量 KaTeX DOM 挂载)
   */
  private renderSolutionBoxContent(q: SlimQuestionItem): string {
    const record = this.practiceRecords.get(q.id) || { answered: false };
    return renderSolutionBoxContent(q, record);
  }

  private ensureSolutionBoxRendered(qid: string, solBox: Element) {
    if (!solBox.hasChildNodes()) {
      const q = this.currentFilteredQuestions.find((item) => item.id === qid);
      if (q) {
        solBox.innerHTML = this.renderSolutionBoxContent(q);
        try {
          renderMathInElement(solBox as HTMLElement, KATEX_OPTIONS);
        } catch (e) {}
      }
    }
  }

  private renderHintsBoxContent(q: SlimQuestionItem): string {
    return renderHintsBoxContent(q);
  }

  private handleOptionSelect(qid: string, userKey: string) {
    const card = this.bodyContainer?.querySelector(`#q-card-${qid}`);
    if (!card) return;
    const answer = card.getAttribute('data-answer') || '';
    const isCorrect = userKey.trim().toUpperCase() === answer.trim().toUpperCase();

    const record: UserPracticeRecord = { answered: true, userChoice: userKey, isCorrect };
    this.practiceRecords.set(qid, record);

    card.querySelectorAll('.ex-option-btn').forEach((btn) => {
      const k = btn.getAttribute('data-key');
      btn.classList.remove('is-selected', 'is-correct', 'is-wrong');
      if (k === userKey) btn.classList.add('is-selected');
      if (k === answer) btn.classList.add('is-correct');
      else if (k === userKey && !isCorrect) btn.classList.add('is-wrong');
    });

    const solBox = card.querySelector(`#sol-${qid}`);
    if (solBox) {
      this.ensureSolutionBoxRendered(qid, solBox);
      solBox.classList.remove('hidden');
    }

    this.filterAndRenderStatsOnly();
  }

  private handleBlankCheck(qid: string) {
    const card = this.bodyContainer?.querySelector(`#q-card-${qid}`);
    const input = card?.querySelector('.ex-blank-input') as HTMLInputElement;
    if (!card || !input) return;

    const record = this.practiceRecords.get(qid);
    if (record && record.answered) {
      this.practiceRecords.delete(qid);
      input.removeAttribute('readonly');
      input.value = '';
      card.querySelector('.ex-blank-wrap')?.classList.remove('is-correct', 'is-wrong');
      const btn = card.querySelector('.ex-blank-check-btn');
      if (btn) btn.textContent = '核对答案';
      card.querySelector(`#sol-${qid}`)?.classList.add('hidden');
      this.filterAndRenderStatsOnly();
      return;
    }

    const userVal = input.value.trim();
    if (!userVal) { this.showToast('请输入计算答案后再核对'); return; }

    const answer = card.getAttribute('data-answer') || '';
    const cleanUser = userVal.replace(/\$/g, '').replace(/\s+/g, '');
    const cleanAns = answer.replace(/\$/g, '').replace(/\s+/g, '');
    const isCorrect = cleanUser === cleanAns || cleanAns.includes(cleanUser);

    this.practiceRecords.set(qid, { answered: true, userBlank: userVal, isCorrect });
    input.setAttribute('readonly', 'true');
    const wrap = card.querySelector('.ex-blank-wrap');
    wrap?.classList.remove('is-correct', 'is-wrong');
    wrap?.classList.add(isCorrect ? 'is-correct' : 'is-wrong');

    const btn = card.querySelector('.ex-blank-check-btn');
    if (btn) btn.textContent = isCorrect ? '正确' : '重做';

    const solBox = card.querySelector(`#sol-${qid}`);
    if (solBox) {
      this.ensureSolutionBoxRendered(qid, solBox);
      solBox.classList.remove('hidden');
    }

    this.filterAndRenderStatsOnly();
  }

  private toggleSteps(qid: string) {
    const card = this.bodyContainer?.querySelector(`#q-card-${qid}`);
    if (!card) return;
    const solBox = card.querySelector(`#sol-${qid}`);
    if (!solBox) return;

    const record = this.practiceRecords.get(qid) || { answered: false };
    record.revealedSolution = !record.revealedSolution;
    this.practiceRecords.set(qid, record);

    if (record.revealedSolution) {
      this.ensureSolutionBoxRendered(qid, solBox);
    }
    solBox.classList.toggle('hidden', !record.revealedSolution);
    const btn = card.querySelector('.ex-toggle-steps-btn span');
    if (btn) btn.textContent = record.revealedSolution ? '收起解析' : '查看解析';
    const icon = card.querySelector('.ex-toggle-steps-btn md-icon');
    if (icon) icon.textContent = record.revealedSolution ? 'visibility_off' : 'visibility';
    const btnEl = card.querySelector('.ex-toggle-steps-btn');
    if (btnEl) btnEl.classList.toggle('active', record.revealedSolution);
  }

  private toggleHints(qid: string) {
    const card = this.bodyContainer?.querySelector(`#q-card-${qid}`);
    const hintsBox = card?.querySelector(`#hints-${qid}`);
    if (!card || !hintsBox) return;

    if (!hintsBox.hasChildNodes()) {
      const q = this.currentFilteredQuestions.find((item) => item.id === qid);
      if (q) {
        hintsBox.innerHTML = this.renderHintsBoxContent(q);
        try { renderMathInElement(hintsBox as HTMLElement, KATEX_OPTIONS); } catch (e) {}
      }
    }
    const isHidden = hintsBox.classList.contains('hidden');
    hintsBox.classList.toggle('hidden', !isHidden);
    card.querySelector('.ex-toggle-hints-btn')?.classList.toggle('active', isHidden);
  }

  private toggleMaster(qid: string) {
    const record = this.practiceRecords.get(qid) || { answered: false };
    record.mastered = !record.mastered;
    record.answered = true;
    this.practiceRecords.set(qid, record);

    const card = this.bodyContainer?.querySelector(`#q-card-${qid}`);
    card?.querySelector('[data-action="master"]')?.classList.toggle('active', record.mastered);
    const btn = card?.querySelector('[data-action="master"] span');
    if (btn) btn.textContent = record.mastered ? '已掌握' : '标为已掌握';
    this.filterAndRenderStatsOnly();
  }

  private filterAndRenderStatsOnly() {
    let doneCount = 0, correctCount = 0;
    this.currentFilteredQuestions.forEach((q) => {
      const rec = this.practiceRecords.get(q.id);
      if (rec && rec.answered) {
        doneCount++;
        if (rec.isCorrect || rec.mastered) correctCount++;
      }
    });
    this.updateStats(this.currentFilteredQuestions.length, doneCount, correctCount);
  }

  private showToast(msg: string) {
    if (!this.toastBox) return;
    const toast = document.createElement('div');
    toast.className = 'ex-toast';
    toast.textContent = msg;
    this.toastBox.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('ex-toast-fade');
      setTimeout(() => toast.remove(), 300);
    }, 2800);
  }

  private esc(s: string): string { return esc(s); }
}

export const exerciseController = new ExerciseCenterController();
