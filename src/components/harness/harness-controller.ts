import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import { mdToHtml } from '../../ai/client/chat-markdown.ts';
import { initMermaid } from '../sidebar/mermaid-loader.ts';
import { parseAstrolibUri, isAstrolibUri } from '../../utils/astrolib-uri.ts';
import { UniversalLocatorResolver } from '../../core/content-api/content-locator.ts';
import { PluginEnvironment } from '../../plugins/harness/plugin-environment.ts';
import type {
  SuggestionItem,
  ToolArtifactPayload,
  ToolExecutionContext,
  ToolExecutionResult,
} from '../../plugins/harness/types.ts';
import { attachPdf2AbpBridge, type Pdf2AbpBridgeHandle } from './pdf2abp/pdf2abp-bridge.ts';
import {
  mountPdf2AbpInlineCards,
  renderPdf2AbpInlineCardPlaceholder,
} from './pdf2abp/pdf2abp-inline-card.ts';
import { createPaneResizer } from '../../utils/pane-resizer.ts';
import {
  HarnessSettingsStore,
  HARNESS_SETTINGS_CHANGED_EVENT,
} from '../../features/harness/settings-store.ts';
import { ArtifactStore } from '../../features/harness/artifact-store.ts';
import { bindAstroBlockInteractions } from '../../features/harness/astro-blocks.ts';
import {
  bindInlineCanvasCards,
  renderInlineCanvasCardHtml,
  syncAllCanvasIframeThemes,
} from '../../features/harness/canvas-sandbox.ts';
import { bindTimelineInteractions } from '../../features/harness/turn-timeline-renderer.ts';
import { TurnStreamView } from '../../features/harness/turn-block-renderer.ts';
import {
  AgentContextManager,
  resolveProviderCapabilities,
  type ChatMessage as AgentChatMessage,
} from '../../ai/agent/context-manager.ts';
import { isWebSearchConfigured } from '../../services/web-search/web-search-service.ts';
import { BtwSidecarController } from '../../features/harness/btw-sidecar.ts';
import { renderQuestionBlockElement } from '../../features/harness/question-widget-renderer.ts';
import { bindQuoteSelector } from '../../features/harness/quote-selector.ts';
import { ArtifactHubPanel } from './artifact-hub-panel.ts';
import type {
  AgentPermissionMode,
  ApprovalBlock,
  ApprovalStep,
  ImageAttachment,
  ModelOption,
  ProviderConfig,
  QuestionBlock,
  QueuedFollowupMessage,
  QuoteSnippet,
  StatusBlock,
  StructuredTurn,
  TextBlock,
  ThinkingBlock,
  ThinkingStep,
  ToolBlock,
  ToolCallStep,
  TurnBlock,
  WidgetBlock,
} from '../../features/harness/types.ts';

export type { ModelOption, ProviderConfig };

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  html: string;
  content?: string;
  turn?: StructuredTurn;
  widgetsHtml?: string;
  timestamp: number;
}

interface Conversation {
  id: string;
  title: string;
  time: string;
  messages: ChatMessage[];
  submittedQuestions?: Record<string, number>;
  agyConversationId?: string;
}

const PERMISSION_META: Record<AgentPermissionMode, { label: string; icon: string }> = {
  'read-only': { label: '仅查看', icon: 'visibility' },
  workspace: { label: '工作区内修改', icon: 'verified_user' },
  full: { label: '完全权限', icon: 'bolt' },
};

export class HarnessController {
  private static instance: HarnessController | null = null;

  private settingsStore = HarnessSettingsStore.getInstance();
  private artifactStore = ArtifactStore.getInstance();
  private pluginEnv = PluginEnvironment.getInstance();

  private conversations: Conversation[] = [];
  private activeConvId: string = 's-default';
  private currentMode: string = 'Turbo';
  private activeTab: 'catalog' | 'artifacts' | 'terminal' = 'catalog';

  private antigravityCliAvailable: boolean = false;
  private antigravityCliInfo: {
    version?: string;
    executablePath?: string;
    models?: ModelOption[];
  } | null = null;

  private term: Terminal | null = null;
  private fitAddon: FitAddon | null = null;
  private termInitPromise: Promise<void> | null = null;
  private termInputBuffer: string = '';
  private termHistory: string[] = [];

  private pdf2abpBridge: Pdf2AbpBridgeHandle | null = null;
  private artifactHubPanel: ArtifactHubPanel | null = null;
  private btwSidecar: BtwSidecarController | null = null;

  private cachedBooks: any[] = [];
  private cachedPapers: any[] = [];
  private cachedChapters: any[] = [];
  private paperOutlines = new Map<string, any[]>();
  private chaptersPreloadStarted: boolean = false;
  private expandedBookSlugs = new Set<string>(['linear_algebra_geometry']);
  private expandedPaperIds = new Set<string>();

  private isGenerating: boolean = false;
  private isPinnedToBottom: boolean = true;
  private pendingMessageQueue: QueuedFollowupMessage[] = [];
  private pendingImages: ImageAttachment[] = [];
  private pendingQuotes: QuoteSnippet[] = [];
  private cachedPythonEnv: {
    pythonPath: string | null;
    pythonVersion: string;
    isolated: boolean;
    packages: Array<{ name: string; version: string }>;
  } | null = null;
  private pythonEnvFetchPromise: Promise<void> | null = null;
  private turnViews = new Map<string, TurnStreamView>();
  private lastSentPrefixMessages: AgentChatMessage[] = [];
  private activeAbortController: AbortController | null = null;
  private pendingApprovalResolvers = new Map<
    string,
    (choice: 'approved-once' | 'approved-full' | 'denied') => void
  >();
  private pendingQuestionResolvers = new Map<
    string,
    (res: { status: 'submitted' | 'skipped'; answers: Record<string, string | string[]> }) => void
  >();
  private renderMathInElementFn: any = null;

  private slashHighlightIdx: number = 0;
  private slashItems: SuggestionItem[] = [];
  private mentionHighlightIdx: number = 0;

  public static init(): HarnessController {
    if (!HarnessController.instance) {
      HarnessController.instance = new HarnessController();
      HarnessController.instance.setup();
    }
    return HarnessController.instance;
  }

  private constructor() {
    this.initDefaultConversations();
  }

  private createPluginContext(): ToolExecutionContext {
    const settings = this.settingsStore.getState();
    return {
      books: this.cachedBooks,
      chapters: this.cachedChapters,
      fetchFn: fetch.bind(window),
      permissionMode: settings.permissionMode,
      customPythonPath: settings.customAgentPythonPath,
      customData: {
        webSearch: settings.webSearch,
      },
      getArtifact: (id: string) => this.artifactStore.getArtifact(id),
      onPythonPackagesChanged: (packages) => {
        this.cachedPythonEnv = {
          ...(this.cachedPythonEnv || { pythonPath: null, pythonVersion: '', isolated: true }),
          packages,
        };
      },
      updateArtifact: (title: string, badge: string, html: string) => {
        this.artifactStore.upsertArtifact(
          {
            kind: 'markdown',
            title,
            badge,
            html,
          },
          { activate: true }
        );
      },
      recordArtifact: (art, activate = false) => {
        const saved = this.artifactStore.upsertArtifact(
          {
            id: art.id,
            kind: art.kind || 'markdown',
            title: art.title,
            badge: art.badge,
            html: art.html,
            markdown: art.markdown,
            code: art.code,
            patch: art.patch,
            diffStats: art.diffStats,
            pythonResult: art.pythonResult,
            canvasMode: art.canvasMode,
          },
          { activate }
        );
        return saved.id;
      },
      switchTab: (tab) => {
        const mapped = tab === 'diff' ? 'artifacts' : tab;
        this.switchInspectorTab(mapped);
      },
      executeCommand: (cmd: string) => this.executeCommand(cmd),
    };
  }

  private initDefaultConversations(): void {
    try {
      const saved = localStorage.getItem('astrolib_harness_conversations');
      if (saved) {
        this.conversations = JSON.parse(saved);
        if (Array.isArray(this.conversations) && this.conversations.length > 0) {
          this.activeConvId = this.conversations[0].id;
          return;
        }
      }
    } catch {}

    this.conversations = [
      {
        id: 's-default',
        title: 'Harness 工作台',
        time: 'now',
        messages: [],
      },
    ];
  }

  private saveConversations(): void {
    try {
      localStorage.setItem('astrolib_harness_conversations', JSON.stringify(this.conversations));
    } catch {}
  }

  private setup(): void {
    this.bindLayoutControls();
    this.bindSidebarControls();
    this.bindInputControls();
    this.bindInspectorTabs();
    this.bindModelAndPermissionControls();
    this.bindSettingsSync();
    this.preloadBooksCatalog();

    this.pdf2abpBridge = attachPdf2AbpBridge({
      pluginEnv: this.pluginEnv,
      artifactStore: this.artifactStore,
      switchToArtifacts: () => this.switchInspectorTab('artifacts'),
      onCatalogRefresh: () => {
        this.chaptersPreloadStarted = false;
        void fetch('/api/v1/content/knowledge/refresh', { method: 'POST' })
          .catch(() => null)
          .finally(() => this.preloadBooksCatalog());
      },
      onTriggerInlinePdf2Abp: () => {
        void this.executeCommand('/pdf2abp');
      },
    });

    this.artifactHubPanel = new ArtifactHubPanel({
      artifactStore: this.artifactStore,
      pdf2abpStore: this.pdf2abpBridge.getStore(),
      renderMath: (el) => this.renderMathInElement(el),
      onExecuteCommand: (cmd) => this.executeCommand(cmd),
    });

    const btwHost = document.getElementById('harness-btw-sidecar-host');
    if (btwHost) {
      this.btwSidecar = new BtwSidecarController(btwHost, (el) => this.hydrateMessageDom(el));
    }

    const msgContainerEl = document.getElementById('harness-messages-container');
    if (msgContainerEl) {
      bindQuoteSelector({
        messagesContainer: msgContainerEl,
        onQuoteSelected: (snippet) => {
          this.pendingQuotes.push(snippet);
          this.renderAttachmentsShelf();
          (document.getElementById('harness-input-textarea') as HTMLTextAreaElement | null)?.focus();
        },
      });
    }

    this.renderActiveConversation();
    this.bindScrollAndQueueControls();
    this.bindAttachmentControls();
    this.bindMessageLinkInteractions();
    this.syncModelAndPermissionDisplay();
    void this.probeAntigravityCli();
    void this.ensurePythonEnvLoaded();
  }

  private async ensurePythonEnvLoaded(force = false): Promise<void> {
    if (!force && this.cachedPythonEnv) return;
    if (this.pythonEnvFetchPromise && !force) return this.pythonEnvFetchPromise;

    const customPath = this.settingsStore.getState().customAgentPythonPath || '';
    const qs = new URLSearchParams();
    if (force) qs.set('force', '1');
    if (customPath) qs.set('pythonPath', customPath);

    this.pythonEnvFetchPromise = (async () => {
      try {
        const res = await fetch(`/api/v1/content/agent-tools/python/env?${qs.toString()}`);
        const json = await res.json();
        if (json?.success && json.data) {
          this.cachedPythonEnv = {
            pythonPath: json.data.pythonPath || null,
            pythonVersion: json.data.pythonVersion || '',
            isolated: Boolean(json.data.isolated),
            packages: Array.isArray(json.data.packages) ? json.data.packages : [],
          };
        }
      } catch {}
    })();
    return this.pythonEnvFetchPromise;
  }

  private getDynamicToolDescriptions(): Record<string, string> {
    if (!this.cachedPythonEnv) return {};
    const { isolated, pythonVersion, packages } = this.cachedPythonEnv;
    const pkgSummary =
      packages.length > 0
        ? packages
            .slice(0, 28)
            .map((p) => `${p.name}==${p.version}`)
            .join(', ') + (packages.length > 28 ? ` 等共 ${packages.length} 个包` : '')
        : '仅标准库（尚未安装第三方轮子，可调 install_python_package 安装）';
    return {
      run_python: `在${isolated ? '独立隔离的 .venv-agent ' : ''}Python ${pythonVersion || '3'} 沙箱工作区内执行脚本。当前已实装可用发行包清单：[${pkgSummary}]。保存至当前工作目录的 .png/.svg 将自动归档至「成果物」并返回可用 Markdown ![图题](url) 本地路径；若缺少某库请调用 install_python_package（仅预编译 wheel，不污染主工程）。`,
    };
  }

  private async compressImageFileToAttachment(
    file: File,
    source: ImageAttachment['source']
  ): Promise<ImageAttachment | null> {
    if (!file.type.startsWith('image/')) return null;
    if (file.size > 10 * 1024 * 1024) {
      window.dispatchEvent(
        new CustomEvent('astrolib:show-snackbar', {
          detail: { message: `图像 "${file.name}" 超过 10MB 上限，请压缩后再试。` },
        })
      );
      return null;
    }

    const rawDataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });

    if (file.type === 'image/svg+xml' || rawDataUrl.length <= 1_200_000) {
      return {
        id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: file.name || 'pasted-image.png',
        mimeType: file.type,
        dataUrl: rawDataUrl,
        sizeBytes: file.size,
        source,
      };
    }

    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('load error'));
        el.src = rawDataUrl;
      });
      const maxDim = 1600;
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(img, 0, 0, w, h);
      const outUrl = canvas.toDataURL('image/jpeg', 0.86);
      return {
        id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: file.name || 'image.jpg',
        mimeType: 'image/jpeg',
        dataUrl: outUrl,
        sizeBytes: outUrl.length,
        width: w,
        height: h,
        source,
      };
    } catch {
      return {
        id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: file.name || 'image.png',
        mimeType: file.type,
        dataUrl: rawDataUrl,
        sizeBytes: file.size,
        source,
      };
    }
  }

  private async enqueueFiles(
    files: FileList | File[],
    source: ImageAttachment['source']
  ): Promise<void> {
    const arr = Array.from(files);
    for (const file of arr) {
      if (this.pendingImages.length >= 4) break;
      const att = await this.compressImageFileToAttachment(file, source);
      if (att) this.pendingImages.push(att);
    }
    this.renderAttachmentsShelf();
  }

  private renderAttachmentsShelf(): void {
    const shelf = document.getElementById('harness-attachments-shelf');
    if (!shelf) return;
    if (this.pendingQuotes.length === 0 && this.pendingImages.length === 0) {
      shelf.setAttribute('hidden', '');
      shelf.innerHTML = '';
      return;
    }

    shelf.removeAttribute('hidden');
    const quoteChips = this.pendingQuotes
      .map(
        (q) => `
      <span class="harness-attach-chip is-quote" data-quote-id="${this.escapeHtml(q.id)}" title="${this.escapeHtml(q.text)}">
        <span class="material-symbols-outlined" style="font-size:14px;" aria-hidden="true">format_quote</span>
        <span class="harness-attach-chip__text">${this.escapeHtml(q.text)}</span>
        <button type="button" class="harness-attach-chip__remove" data-remove-quote="${this.escapeHtml(q.id)}" aria-label="移除引用">×</button>
      </span>
    `
      )
      .join('');

    const imgChips = this.pendingImages
      .map(
        (im) => `
      <span class="harness-attach-chip is-image" data-img-id="${this.escapeHtml(im.id)}" title="${this.escapeHtml(im.name)}">
        <img src="${this.escapeHtml(im.dataUrl)}" alt="${this.escapeHtml(im.name)}" />
        <span class="harness-attach-chip__text">${this.escapeHtml(im.name)}</span>
        <button type="button" class="harness-attach-chip__remove" data-remove-img="${this.escapeHtml(im.id)}" aria-label="移除图片">×</button>
      </span>
    `
      )
      .join('');

    shelf.innerHTML = quoteChips + imgChips;

    shelf.querySelectorAll<HTMLElement>('[data-remove-quote]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const qid = btn.dataset.removeQuote;
        this.pendingQuotes = this.pendingQuotes.filter((q) => q.id !== qid);
        this.renderAttachmentsShelf();
      });
    });

    shelf.querySelectorAll<HTMLElement>('[data-remove-img]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const iid = btn.dataset.removeImg;
        this.pendingImages = this.pendingImages.filter((im) => im.id !== iid);
        this.renderAttachmentsShelf();
      });
    });
  }

  private bindAttachmentControls(): void {
    const attachBtn = document.getElementById('harness-btn-attach-image');
    const fileInput = document.getElementById('harness-image-file-input') as HTMLInputElement | null;
    const textarea = document.getElementById('harness-input-textarea') as HTMLTextAreaElement | null;
    const inputDock = document.getElementById('harness-input-dock');

    if (attachBtn && fileInput) {
      attachBtn.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', () => {
        if (fileInput.files && fileInput.files.length > 0) {
          void this.enqueueFiles(fileInput.files, 'upload');
          fileInput.value = '';
        }
      });
    }

    if (textarea) {
      textarea.addEventListener('paste', (e) => {
        const items = e.clipboardData?.items;
        if (!items) return;
        const imgFiles: File[] = [];
        for (const item of Array.from(items)) {
          if (item.kind === 'file' && item.type.startsWith('image/')) {
            const f = item.getAsFile();
            if (f) imgFiles.push(f);
          }
        }
        if (imgFiles.length > 0) {
          e.preventDefault();
          void this.enqueueFiles(imgFiles, 'paste');
        }
      });
    }

    if (inputDock) {
      inputDock.addEventListener('dragover', (e) => {
        if (e.dataTransfer?.types.includes('Files')) {
          e.preventDefault();
          inputDock.classList.add('is-dragover');
        }
      });
      inputDock.addEventListener('dragleave', () => {
        inputDock.classList.remove('is-dragover');
      });
      inputDock.addEventListener('drop', (e) => {
        inputDock.classList.remove('is-dragover');
        if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
          const imgs = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'));
          if (imgs.length > 0) {
            e.preventDefault();
            void this.enqueueFiles(imgs, 'drop');
          }
        }
      });
    }
  }

  private openImageLightbox(src: string, alt: string): void {
    const existing = document.getElementById('harness-image-lightbox');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'harness-image-lightbox';
    overlay.className = 'harness-lightbox-overlay';
    overlay.innerHTML = `
      <div class="harness-lightbox-card">
        <button type="button" class="harness-lightbox-close" aria-label="关闭大图预览">
          <span class="material-symbols-outlined" aria-hidden="true">close</span>
        </button>
        <img src="${this.escapeHtml(src)}" alt="${this.escapeHtml(alt)}" />
        ${alt ? `<div class="harness-lightbox-caption">${this.escapeHtml(alt)}</div>` : ''}
      </div>
    `;
    const close = () => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') close();
    };
    overlay.addEventListener('click', (ev) => {
      if (ev.target === overlay || (ev.target as HTMLElement).closest('.harness-lightbox-close')) {
        close();
      }
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
  }

  private maybeScrollToBottom(force = false): void {
    const container = document.getElementById('harness-messages-container');
    if (!container) return;
    if (force) {
      this.isPinnedToBottom = true;
    }
    if (this.isPinnedToBottom) {
      container.scrollTop = container.scrollHeight;
    }
    this.updateScrollLatestPill();
  }

  private updateScrollLatestPill(): void {
    const container = document.getElementById('harness-messages-container');
    const pill = document.getElementById('harness-scroll-latest-pill');
    if (!container || !pill) return;

    const hasOverflow = container.scrollHeight > container.clientHeight + 80;
    const dist = container.scrollHeight - container.scrollTop - container.clientHeight;
    this.isPinnedToBottom = dist <= 48;
    if (!this.isPinnedToBottom && hasOverflow) {
      pill.removeAttribute('hidden');
    } else {
      pill.setAttribute('hidden', '');
    }
  }

  private bindScrollAndQueueControls(): void {
    const container = document.getElementById('harness-messages-container');
    const pill = document.getElementById('harness-scroll-latest-pill');
    if (container && container.dataset.boundStickyScroll !== 'true') {
      container.dataset.boundStickyScroll = 'true';
      container.addEventListener(
        'scroll',
        () => {
          this.updateScrollLatestPill();
        },
        { passive: true }
      );
    }
    if (pill && pill.dataset.boundLatestPill !== 'true') {
      pill.dataset.boundLatestPill = 'true';
      pill.addEventListener('click', () => {
        const msgBox = document.getElementById('harness-messages-container');
        if (!msgBox) return;
        this.isPinnedToBottom = true;
        msgBox.scrollTo({ top: msgBox.scrollHeight, behavior: 'smooth' });
        window.setTimeout(() => this.updateScrollLatestPill(), 220);
      });
    }
  }

  private enqueueFollowupMessage(
    rawText: string,
    quotes: QuoteSnippet[] = [],
    images: ImageAttachment[] = []
  ): void {
    const clean = rawText.trim();
    if (!clean) return;
    this.pendingMessageQueue.push({
      id: `fq-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      rawText: clean,
      quotes: quotes.length > 0 ? quotes : undefined,
      images: images.length > 0 ? images : undefined,
      createdAt: Date.now(),
    });
    this.renderFollowupQueue();
  }

  private renderFollowupQueue(): void {
    const host = document.getElementById('harness-followup-queue');
    if (!host) return;
    if (this.pendingMessageQueue.length === 0) {
      host.setAttribute('hidden', '');
      host.innerHTML = '';
      return;
    }

    host.removeAttribute('hidden');
    host.innerHTML = this.pendingMessageQueue
      .map(
        (item, idx) => `
      <div class="harness-followup-item" data-fq-id="${this.escapeHtml(item.id)}">
        <span class="harness-followup-item__badge">排队 #${idx + 1}</span>
        <span class="harness-followup-item__text" title="${this.escapeHtml(item.rawText)}">${this.escapeHtml(item.rawText)}</span>
        <div class="harness-followup-item__actions">
          <button type="button" class="harness-followup-btn is-primary" data-fq-btw="${this.escapeHtml(item.id)}" title="不打断主对话，直接开启侧载快问">侧载立即问</button>
          <button type="button" class="harness-followup-btn" data-fq-edit="${this.escapeHtml(item.id)}">编辑</button>
          <button type="button" class="harness-followup-btn" data-fq-delete="${this.escapeHtml(item.id)}">删除</button>
        </div>
      </div>
    `
      )
      .join('');

    host.querySelectorAll<HTMLElement>('[data-fq-btw]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.fqBtw || '';
        const idx = this.pendingMessageQueue.findIndex((q) => q.id === id);
        if (idx >= 0) {
          const [removed] = this.pendingMessageQueue.splice(idx, 1);
          this.renderFollowupQueue();
          void this.askSidecarQuestion(removed.rawText);
        }
      });
    });

    host.querySelectorAll<HTMLElement>('[data-fq-edit]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.fqEdit || '';
        const idx = this.pendingMessageQueue.findIndex((q) => q.id === id);
        if (idx >= 0) {
          const [removed] = this.pendingMessageQueue.splice(idx, 1);
          this.renderFollowupQueue();
          const textarea = document.getElementById('harness-input-textarea') as HTMLTextAreaElement | null;
          if (textarea) {
            textarea.value = removed.rawText;
            textarea.style.height = 'auto';
            textarea.style.height = Math.min(textarea.scrollHeight, 160) + 'px';
            textarea.focus();
          }
        }
      });
    });

    host.querySelectorAll<HTMLElement>('[data-fq-delete]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.fqDelete || '';
        this.pendingMessageQueue = this.pendingMessageQueue.filter((q) => q.id !== id);
        this.renderFollowupQueue();
      });
    });
  }

  private async askSidecarQuestion(question: string): Promise<void> {
    const cleanQ = question.replace(/^\/btw\s+/i, '').trim();
    if (!cleanQ) return;
    if (!this.btwSidecar) return;

    await this.ensurePythonEnvLoaded();
    const settings = this.settingsStore.getState();
    const activeProvider =
      settings.providers.find((p) => p.id === settings.currentProviderId) || settings.providers[0];
    const webSearchActive = isWebSearchConfigured(settings.webSearch);
    const dynamicDescs = this.getDynamicToolDescriptions();
    const toolsPayload = this.pluginEnv.toOpenAITools({
      permissionMode: settings.permissionMode,
      overrides: settings.toolOverrides,
      webSearchEnabled: webSearchActive,
      dynamicToolDescriptions: dynamicDescs,
    });
    const fullSystemPrompt = `${settings.systemPrompt}\n\n${this.pluginEnv.generateSystemPromptHelp({
      permissionMode: settings.permissionMode,
      overrides: settings.toolOverrides,
      webSearchEnabled: webSearchActive,
      dynamicToolDescriptions: dynamicDescs,
    })}`;

    let prefixMessages = [...this.lastSentPrefixMessages];
    if (prefixMessages.length === 0) {
      prefixMessages = [{ role: 'system', content: fullSystemPrompt }];
      const activeConv = this.conversations.find((c) => c.id === this.activeConvId);
      if (activeConv) {
        for (const m of activeConv.messages.slice(-8)) {
          if (m.content) prefixMessages.push({ role: m.role, content: m.content });
        }
      }
    }

    await this.btwSidecar.openAndAsk({
      question: cleanQ,
      prefixMessages,
      provider: activeProvider,
      modelId: settings.currentModelId,
      toolsPayload,
      systemPrompt: fullSystemPrompt,
    });
  }

  private bindSettingsSync(): void {
    window.addEventListener(HARNESS_SETTINGS_CHANGED_EVENT, () => {
      this.syncModelAndPermissionDisplay();
      this.renderModelDropdown();
    });
    window.addEventListener('starlight-theme-change', () => {
      syncAllCanvasIframeThemes(document);
    });
    window.addEventListener('m3-theme-color-change', () => {
      syncAllCanvasIframeThemes(document);
    });
  }

  private syncModelAndPermissionDisplay(): void {
    const st = this.settingsStore.getState();
    const modelLabel = document.getElementById('harness-current-model-label');
    if (modelLabel) modelLabel.textContent = st.currentModelLabel;

    const meta = PERMISSION_META[st.permissionMode] || PERMISSION_META.workspace;
    const permIcon = document.getElementById('harness-perm-pill-icon');
    const permLabel = document.getElementById('harness-perm-pill-label');
    if (permIcon) permIcon.textContent = meta.icon;
    if (permLabel) permLabel.textContent = meta.label;

    document.querySelectorAll<HTMLElement>('.harness-perm-option').forEach((btn) => {
      const mode = btn.dataset.permMode;
      const active = mode === st.permissionMode;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-checked', String(active));
    });
  }

  private openGlobalSettings(subtab: 'tools' | 'models' | 'presets' = 'models'): void {
    window.dispatchEvent(
      new CustomEvent('astrolib:open-settings-hub', {
        detail: { panel: 'panel-agent', subtab },
      })
    );
  }

  private bindLayoutControls(): void {
    const btnToggleSidebar = document.getElementById('harness-btn-toggle-sidebar');
    const sidebar = document.getElementById('harness-sidebar');
    if (btnToggleSidebar && sidebar) {
      btnToggleSidebar.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
      });
    }

    const btnToggleSplit = document.getElementById('harness-btn-toggle-split');
    const btnCloseInspector = document.getElementById('harness-btn-close-inspector');
    const inspector = document.getElementById('harness-inspector-stage');

    const toggleInspector = () => {
      if (inspector) {
        inspector.classList.toggle('collapsed');
        if (!inspector.classList.contains('collapsed') && this.activeTab === 'terminal') {
          setTimeout(() => this.fitAddon?.fit(), 150);
        }
      }
    };

    btnToggleSplit?.addEventListener('click', toggleInspector);
    btnCloseInspector?.addEventListener('click', toggleInspector);

    const btnQuickSearch = document.getElementById('harness-btn-quick-search');
    const textarea = document.getElementById('harness-input-textarea') as HTMLTextAreaElement | null;
    if (btnQuickSearch && textarea) {
      btnQuickSearch.addEventListener('click', () => {
        textarea.focus();
        textarea.value = '/';
        textarea.dispatchEvent(new Event('input'));
      });
    }

    document.getElementById('harness-nav-customizations')?.addEventListener('click', () => {
      this.openGlobalSettings('tools');
    });

    document.getElementById('harness-nav-automations')?.addEventListener('click', () => {
      void this.executeCommand('/pdf2abp');
    });

    this.initPaneResizers();
  }

  private initPaneResizers(): void {
    const rootEl = document.getElementById('harness-root') || document.documentElement;
    const workspace = document.querySelector<HTMLElement>('.harness-workspace-body');
    const sidebar = document.getElementById('harness-sidebar');
    const inspector = document.getElementById('harness-inspector-stage');
    const leftHandle = document.getElementById('harness-resizer-left');
    const rightHandle = document.getElementById('harness-resizer-right');

    const LEFT_KEY = 'astrolib_harness_left_width';
    const RIGHT_KEY = 'astrolib_harness_right_width';
    const LEFT_MIN = 190;
    const LEFT_MAX = 360;
    const RIGHT_MIN = 320;
    const CENTER_MIN = 420;

    try {
      const savedLeft = Number(localStorage.getItem(LEFT_KEY));
      if (Number.isFinite(savedLeft) && savedLeft >= LEFT_MIN && savedLeft <= LEFT_MAX) {
        rootEl.style.setProperty('--harness-sidebar-width', `${Math.round(savedLeft)}px`);
      }
      const savedRight = Number(localStorage.getItem(RIGHT_KEY));
      if (Number.isFinite(savedRight) && savedRight >= RIGHT_MIN && savedRight <= 760) {
        rootEl.style.setProperty('--harness-inspector-width', `${Math.round(savedRight)}px`);
      }
    } catch {}

    const getWorkspaceWidth = () => workspace?.getBoundingClientRect().width || window.innerWidth;
    const getRightWidth = () =>
      !inspector || inspector.classList.contains('collapsed')
        ? 0
        : Math.round(inspector.getBoundingClientRect().width || 450);
    const getLeftWidth = () =>
      !sidebar || sidebar.classList.contains('collapsed')
        ? 0
        : Math.round(sidebar.getBoundingClientRect().width || 250);

    if (leftHandle && sidebar) {
      createPaneResizer({
        handle: leftHandle,
        side: 'left',
        getInitialWidth: () => Math.round(sidebar.getBoundingClientRect().width || 250),
        getMinWidth: () => LEFT_MIN,
        getMaxWidth: () =>
          Math.max(LEFT_MIN, Math.min(LEFT_MAX, getWorkspaceWidth() - getRightWidth() - CENTER_MIN)),
        onResize: (w) => rootEl.style.setProperty('--harness-sidebar-width', `${w}px`),
        onCommit: (w) => {
          rootEl.style.setProperty('--harness-sidebar-width', `${w}px`);
          try {
            localStorage.setItem(LEFT_KEY, String(w));
          } catch {}
          if (this.activeTab === 'terminal') this.fitAddon?.fit();
        },
        onReset: () => {
          rootEl.style.removeProperty('--harness-sidebar-width');
          try {
            localStorage.removeItem(LEFT_KEY);
          } catch {}
          if (this.activeTab === 'terminal') this.fitAddon?.fit();
        },
      });
    }

    if (rightHandle && inspector) {
      createPaneResizer({
        handle: rightHandle,
        side: 'right',
        getInitialWidth: () => Math.round(inspector.getBoundingClientRect().width || 450),
        getMinWidth: () => RIGHT_MIN,
        getMaxWidth: () => {
          const wsW = getWorkspaceWidth();
          const cap = Math.min(760, Math.round(wsW * 0.56), wsW - getLeftWidth() - CENTER_MIN);
          return Math.max(RIGHT_MIN, cap);
        },
        onResize: (w) => rootEl.style.setProperty('--harness-inspector-width', `${w}px`),
        onCommit: (w) => {
          rootEl.style.setProperty('--harness-inspector-width', `${w}px`);
          try {
            localStorage.setItem(RIGHT_KEY, String(w));
          } catch {}
          if (this.activeTab === 'terminal') setTimeout(() => this.fitAddon?.fit(), 40);
        },
        onReset: () => {
          rootEl.style.removeProperty('--harness-inspector-width');
          try {
            localStorage.removeItem(RIGHT_KEY);
          } catch {}
          if (this.activeTab === 'terminal') setTimeout(() => this.fitAddon?.fit(), 40);
        },
      });
    }
  }

  private bindSidebarControls(): void {
    document.getElementById('harness-btn-new-conv')?.addEventListener('click', () => {
      this.createNewConversation();
    });
    this.renderSidebarSessions();
  }

  private createNewConversation(): void {
    if (this.isGenerating) {
      this.abortActiveTurn();
    }
    const newId = 's-' + Date.now();
    const newTitle = `新会话 (${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })})`;
    this.conversations.unshift({
      id: newId,
      title: newTitle,
      time: 'now',
      messages: [],
    });
    this.activeConvId = newId;
    this.saveConversations();
    this.renderSidebarSessions();
    this.renderActiveConversation();
    (document.getElementById('harness-input-textarea') as HTMLTextAreaElement | null)?.focus();
  }

  private switchConversation(id: string): void {
    if (this.isGenerating) {
      this.abortActiveTurn();
    }
    this.activeConvId = id;
    this.renderSidebarSessions();
    this.renderActiveConversation();
  }

  private renderSidebarSessions(): void {
    const sessionListEl = document.getElementById('harness-session-list');
    if (!sessionListEl) return;

    sessionListEl.innerHTML = '';
    for (const conv of this.conversations) {
      const itemEl = document.createElement('div');
      itemEl.className = `harness-session-item ${conv.id === this.activeConvId ? 'active' : ''}`;
      itemEl.dataset.sessionId = conv.id;
      itemEl.innerHTML = `
        <span class="harness-session-item__title" title="${this.escapeHtml(conv.title)}">${this.escapeHtml(conv.title)}</span>
        <div class="harness-session-item__actions">
          <button type="button" class="harness-session-action-btn btn-rename" title="重命名对话">
            <span class="material-symbols-outlined" style="font-size:14px;">edit</span>
          </button>
          <button type="button" class="harness-session-action-btn btn-delete" title="删除对话">
            <span class="material-symbols-outlined" style="font-size:14px;">delete</span>
          </button>
        </div>
        <span class="harness-session-item__time">${this.escapeHtml(conv.time)}</span>
      `;

      itemEl.querySelector('.btn-rename')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.renameConversation(conv.id);
      });

      itemEl.querySelector('.btn-delete')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm(`确定要删除对话 "${conv.title}" 吗？`)) {
          this.deleteConversation(conv.id);
        }
      });

      itemEl.addEventListener('click', () => this.switchConversation(conv.id));
      sessionListEl.appendChild(itemEl);
    }

    const currentTitleEl = document.getElementById('harness-current-session-title');
    const active = this.conversations.find((c) => c.id === this.activeConvId);
    if (currentTitleEl && active) {
      currentTitleEl.textContent = active.title;
    }
  }

  public renameConversation(id: string): void {
    const conv = this.conversations.find((c) => c.id === id);
    if (!conv) return;
    const newTitle = prompt('重命名对话：', conv.title);
    if (newTitle && newTitle.trim()) {
      conv.title = newTitle.trim();
      this.saveConversations();
      this.renderSidebarSessions();
    }
  }

  public deleteConversation(id: string): void {
    this.conversations = this.conversations.filter((c) => c.id !== id);
    if (this.conversations.length === 0) {
      this.createNewConversation();
      return;
    }
    if (this.activeConvId === id) {
      this.activeConvId = this.conversations[0].id;
    }
    this.saveConversations();
    this.renderSidebarSessions();
    this.renderActiveConversation();
  }

  private createTurnStreamView(streamHost: HTMLElement): TurnStreamView {
    return new TurnStreamView(streamHost, {
      autoCollapseTrace: () => this.settingsStore.getState().autoCollapseTrace,
      onToggleStateChanged: () => this.saveConversations(),
      onJumpArtifact: (artId) => {
        this.artifactStore.selectArtifact(artId, true);
        this.switchInspectorTab('artifacts');
      },
      onApprovalDecision: (stepId, choice) => {
        const resolver = this.pendingApprovalResolvers.get(stepId);
        if (resolver) {
          this.pendingApprovalResolvers.delete(stepId);
          resolver(choice);
        }
      },
      onStatusAction: (action) => {
        if (action === 'continue-exploring') {
          void this.executeCommand('请基于上一轮已掌握的结论继续深入探索并完成剩余任务。');
        }
      },
      hydrateProseElement: (el) => {
        this.hydrateMessageDom(el);
      },
      renderWidgetElement: (block, existingEl) => {
        return this.renderWidgetBlockElement(block, existingEl);
      },
      renderQuestionElement: (block, existingEl) => {
        return renderQuestionBlockElement(block, existingEl, (questionId, res) => {
          const resolver = this.pendingQuestionResolvers.get(questionId);
          if (resolver) {
            this.pendingQuestionResolvers.delete(questionId);
            resolver(res);
          }
        });
      },
    });
  }

  private renderWidgetBlockElement(
    block: WidgetBlock,
    existingEl: HTMLElement | null
  ): HTMLElement {
    const el = existingEl || document.createElement('div');
    el.className = 'harness-widget-block';
    el.dataset.widgetType = block.widgetType;

    if (block.widgetType === 'canvas' && block.artifactId) {
      el.innerHTML = renderInlineCanvasCardHtml({
        artifactId: block.artifactId,
        title: block.caption || '交互演示画布',
        mode: 'interactive',
        timestamp: block.createdAt,
      });
      bindInlineCanvasCards(el, {
        getArtifact: (id) => this.artifactStore.getArtifact(id),
        onOpenInArtifacts: (id) => {
          this.artifactStore.selectArtifact(id, true);
          this.switchInspectorTab('artifacts');
        },
      });
      return el;
    }

    if (block.widgetType === 'image' && block.imageUrl) {
      el.innerHTML = `
        <figure class="harness-inline-figure">
          <img class="harness-md-img" src="${this.escapeHtml(block.imageUrl)}" alt="${this.escapeHtml(block.alt || '')}" loading="lazy" />
          ${block.caption ? `<figcaption>${this.escapeHtml(block.caption)}</figcaption>` : ''}
        </figure>
      `;
      return el;
    }

    return el;
  }

  private renderAssistantMessageBody(msgEl: HTMLElement, msg: ChatMessage): void {
    if (msg.turn) {
      msgEl.innerHTML = '';
      const streamHost = document.createElement('div');
      streamHost.className = 'harness-turn-stream-host';
      msgEl.appendChild(streamHost);

      const view = this.createTurnStreamView(streamHost);
      this.turnViews.set(msg.id, view);
      view.sync(msg.turn);

      const hasInlineWidgetsInBlocks = (msg.turn.blocks || []).some((b) => b.kind === 'widget');
      if (msg.widgetsHtml && !hasInlineWidgetsInBlocks) {
        const wSlot = document.createElement('div');
        wSlot.className = 'harness-widgets-slot';
        wSlot.innerHTML = msg.widgetsHtml;
        msgEl.appendChild(wSlot);
        this.hydrateMessageDom(wSlot);
      }
      if (msg.turn.errorMessage && !(msg.turn.blocks || []).some((b) => b.kind === 'status')) {
        const errDiv = document.createElement('div');
        errDiv.className = 'harness-error-banner';
        errDiv.textContent = msg.turn.errorMessage;
        msgEl.appendChild(errDiv);
      }
    } else {
      msgEl.innerHTML = msg.html;
      this.hydrateMessageDom(msgEl);
    }
  }

  private hydrateMessageDom(rootEl: HTMLElement): void {
    const activeConv = this.conversations.find((c) => c.id === this.activeConvId);

    this.decorateInlineSlashCommands(rootEl);
    void this.renderMathInElement(rootEl);
    if (rootEl.querySelector('.mermaid, pre code.language-mermaid')) {
      initMermaid({ immediate: true });
    }
    bindAstroBlockInteractions(rootEl);

    bindInlineCanvasCards(rootEl, {
      getArtifact: (id) => this.artifactStore.getArtifact(id),
      onOpenInArtifacts: (id) => {
        this.artifactStore.selectArtifact(id, true);
        this.switchInspectorTab('artifacts');
      },
    });

    if (this.pdf2abpBridge) {
      mountPdf2AbpInlineCards(rootEl, {
        store: this.pdf2abpBridge.getStore(),
        onInspectJob: (jobId) => this.pdf2abpBridge?.openJobInArtifacts(jobId),
        onJobStarted: (jobId) => {
          const msgHost = rootEl.closest('.harness-message') as HTMLElement | null;
          if (activeConv && msgHost) {
            const msgObj = activeConv.messages.find((m) => m.id === msgHost.dataset.msgId);
            if (msgObj) {
              msgObj.widgetsHtml = renderPdf2AbpInlineCardPlaceholderWithJob(jobId);
              msgObj.html = msgObj.widgetsHtml;
              this.saveConversations();
            }
          }
        },
      });
    }

    bindTimelineInteractions(rootEl, {
      getTurn: (turnId) =>
        activeConv?.messages.find((m) => m.turn?.id === turnId)?.turn,
      onJumpArtifact: (artId) => {
        this.artifactStore.selectArtifact(artId, true);
        this.switchInspectorTab('artifacts');
      },
      onApprovalDecision: (stepId, choice) => {
        const resolver = this.pendingApprovalResolvers.get(stepId);
        if (resolver) {
          this.pendingApprovalResolvers.delete(stepId);
          resolver(choice);
        }
      },
      onToggleStateChanged: () => this.saveConversations(),
    });

    this.bindCardInteractionsIn(rootEl);

    rootEl.querySelectorAll('a').forEach((a) => {
      const href = a.dataset.astrolibUri || a.getAttribute('href');
      if (href && isAstrolibUri(href)) {
        a.setAttribute('target', '_self');
        a.classList.add('astrolib-node-link');
      }
    });
  }

  private decorateInlineSlashCommands(rootEl: HTMLElement): void {
    const body = rootEl.querySelector('.harness-content-body') || rootEl;
    if (!body) return;

    const cmds = this.pluginEnv
      .getAllCommands()
      .map((c) => c.command.replace(/^\//, ''))
      .sort((a, b) => b.length - a.length);
    if (cmds.length === 0) return;

    const cmdPattern = new RegExp(
      `(^|[\\s(（])(\\/(?:${cmds.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?:\\s+[a-zA-Z0-9_\\u4e00-\\u9fa5-]+)?)`,
      'g'
    );

    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    const nodesToProcess: Text[] = [];
    let current: Node | null;
    while ((current = walker.nextNode())) {
      const parent = current.parentElement;
      if (!parent) continue;
      if (
        parent.closest(
          'code, pre, a, button, script, style, .astro-ui-root, .astro-canvas-card, .metro-timeline-wrap, .katex, .mermaid-container, .harness-action-chip'
        )
      ) {
        continue;
      }
      if (current.nodeValue && current.nodeValue.includes('/')) {
        nodesToProcess.push(current as Text);
      }
    }

    for (const textNode of nodesToProcess) {
      const text = textNode.nodeValue || '';
      cmdPattern.lastIndex = 0;
      if (!cmdPattern.test(text)) continue;

      cmdPattern.lastIndex = 0;
      const frag = document.createDocumentFragment();
      let lastIdx = 0;
      let match: RegExpExecArray | null;

      while ((match = cmdPattern.exec(text)) !== null) {
        const leading = match[1];
        const cmdText = match[2].trim();
        const matchStart = match.index + leading.length;
        if (matchStart > lastIdx) {
          frag.appendChild(document.createTextNode(text.slice(lastIdx, matchStart)));
        }
        const chip = document.createElement('span');
        chip.className = 'harness-action-chip harness-action-chip--inline';
        chip.dataset.cmd = cmdText;
        chip.textContent = cmdText;
        frag.appendChild(chip);
        lastIdx = matchStart + match[2].length;
      }

      if (lastIdx < text.length) {
        frag.appendChild(document.createTextNode(text.slice(lastIdx)));
      }
      textNode.parentNode?.replaceChild(frag, textNode);
    }
  }

  private renderActiveConversation(): void {
    const container = document.getElementById('harness-messages-container');
    if (!container) return;

    const active = this.conversations.find((c) => c.id === this.activeConvId);
    if (!active) return;

    this.turnViews.clear();
    container.innerHTML = '';

    for (const msg of active.messages) {
      const msgEl = document.createElement('div');
      msgEl.className = `harness-message harness-message--${msg.role}`;
      msgEl.dataset.msgId = msg.id;
      if (msg.role === 'assistant') {
        this.renderAssistantMessageBody(msgEl, msg);
      } else {
        msgEl.innerHTML = msg.html;
      }
      container.appendChild(msgEl);
    }

    this.maybeScrollToBottom(true);
  }

  private bindMessageLinkInteractions(): void {
    const container = document.getElementById('harness-messages-container');
    if (!container) return;

    container.addEventListener(
      'click',
      (e) => {
        const targetEl = e.target as HTMLElement | null;
        const img = targetEl?.closest<HTMLImageElement>('.harness-md-img, .harness-user-thumb');
        if (img && img.src) {
          e.preventDefault();
          e.stopPropagation();
          this.openImageLightbox(img.src, img.alt || img.title || '');
          return;
        }

        const link = targetEl?.closest('a');
        if (!link) return;
        const href =
          link.dataset.astrolibUri ||
          link.getAttribute('href') ||
          (link as HTMLAnchorElement).href;
        if (!href) return;

        if (isAstrolibUri(href)) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          const target = parseAstrolibUri(href);
          if (target) {
            window.dispatchEvent(new CustomEvent('astrolib:navigate-node', { detail: target }));
          } else {
            window.dispatchEvent(
              new CustomEvent('astrolib:show-snackbar', {
                detail: { message: `未找到书籍节点：${href}` },
              })
            );
          }
        }
      },
      true
    );
  }

  private closeAllPopovers(): void {
    document.getElementById('harness-mention-dropdown')?.classList.remove('show');
    document.getElementById('harness-slash-dropdown')?.classList.remove('show');
    document.getElementById('harness-model-dropdown')?.classList.remove('show');
    document.getElementById('harness-permission-dropdown')?.classList.remove('show');
  }

  private bindInputControls(): void {
    const textarea = document.getElementById('harness-input-textarea') as HTMLTextAreaElement | null;
    const btnSend = document.getElementById('harness-btn-send');
    const mentionDropdown = document.getElementById('harness-mention-dropdown');
    const slashDropdown = document.getElementById('harness-slash-dropdown');
    const inputDock = document.getElementById('harness-input-dock');

    if (!textarea) return;

    const isSlashOpen = () => slashDropdown?.classList.contains('show') ?? false;
    const isMentionOpen = () => mentionDropdown?.classList.contains('show') ?? false;

    const updateHighlight = (listEl: Element | null, selector: string, idx: number) => {
      if (!listEl) return;
      const items = Array.from(listEl.querySelectorAll<HTMLElement>(selector));
      items.forEach((el, i) => {
        el.classList.toggle('is-highlighted', i === idx);
        if (i === idx) el.scrollIntoView({ block: 'nearest' });
      });
    };

    textarea.addEventListener('input', async () => {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 160) + 'px';

      const val = textarea.value;
      if (val.endsWith('@')) {
        this.closeAllPopovers();
        mentionDropdown?.classList.add('show');
        this.mentionHighlightIdx = 0;
        updateHighlight(mentionDropdown, '.harness-mention-item', 0);
      } else if (val.startsWith('/') && !val.includes('\n')) {
        const suggestions = await this.pluginEnv.getSuggestions(val, this.createPluginContext());
        this.renderSlashDropdown(suggestions);
        mentionDropdown?.classList.remove('show');
      } else {
        mentionDropdown?.classList.remove('show');
        slashDropdown?.classList.remove('show');
      }
    });

    textarea.addEventListener('keydown', (e) => {
      if (isSlashOpen() && this.slashItems.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          this.slashHighlightIdx = (this.slashHighlightIdx + 1) % this.slashItems.length;
          updateHighlight(document.getElementById('harness-slash-list'), '.harness-slash-item', this.slashHighlightIdx);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          this.slashHighlightIdx =
            (this.slashHighlightIdx - 1 + this.slashItems.length) % this.slashItems.length;
          updateHighlight(document.getElementById('harness-slash-list'), '.harness-slash-item', this.slashHighlightIdx);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          slashDropdown?.classList.remove('show');
          return;
        }
        if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
          const item = this.slashItems[this.slashHighlightIdx];
          if (item) {
            e.preventDefault();
            this.applySlashSuggestion(item, e.key === 'Tab');
            return;
          }
        }
      }

      if (isMentionOpen()) {
        const items = Array.from(
          mentionDropdown?.querySelectorAll<HTMLElement>('.harness-mention-item') || []
        );
        if (items.length > 0) {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            this.mentionHighlightIdx = (this.mentionHighlightIdx + 1) % items.length;
            updateHighlight(mentionDropdown, '.harness-mention-item', this.mentionHighlightIdx);
            return;
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            this.mentionHighlightIdx =
              (this.mentionHighlightIdx - 1 + items.length) % items.length;
            updateHighlight(mentionDropdown, '.harness-mention-item', this.mentionHighlightIdx);
            return;
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            mentionDropdown?.classList.remove('show');
            return;
          }
          if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault();
            items[this.mentionHighlightIdx]?.click();
            return;
          }
        }
      }

      if (e.key === 'Escape') {
        this.closeAllPopovers();
        if (this.isGenerating) {
          e.preventDefault();
          this.abortActiveTurn();
        }
        return;
      }

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.submitUserInput();
      }
    });

    textarea.addEventListener('blur', () => {
      setTimeout(() => {
        const activeEl = document.activeElement;
        if (!activeEl || !inputDock?.contains(activeEl)) {
          mentionDropdown?.classList.remove('show');
          slashDropdown?.classList.remove('show');
        }
      }, 160);
    });

    document.addEventListener('pointerdown', (e) => {
      const target = e.target as Node | null;
      if (target && inputDock && !inputDock.contains(target)) {
        this.closeAllPopovers();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const anyOpen = Boolean(document.querySelector('.harness-popover.show'));
        if (anyOpen) {
          this.closeAllPopovers();
        } else if (document.querySelector('.harness-btw-card')) {
          this.btwSidecar?.close();
        } else if (this.isGenerating) {
          this.abortActiveTurn();
        }
      }
    });

    btnSend?.addEventListener('click', () => {
      if (this.isGenerating) {
        this.abortActiveTurn();
      } else {
        this.submitUserInput();
      }
    });

    if (mentionDropdown) {
      mentionDropdown.querySelectorAll('.harness-mention-item').forEach((item) => {
        item.addEventListener('click', () => {
          const entity = (item as HTMLElement).dataset.entity;
          if (entity) {
            textarea.value = textarea.value.replace(/@$/, '') + entity + ' ';
            mentionDropdown.classList.remove('show');
            textarea.focus();
          }
        });
      });
    }
  }

  private applySlashSuggestion(item: SuggestionItem, fillOnly = false): void {
    const slashDropdown = document.getElementById('harness-slash-dropdown');
    const textarea = document.getElementById('harness-input-textarea') as HTMLTextAreaElement | null;
    slashDropdown?.classList.remove('show');

    const cmdTrimmed = item.fillCommand.trim();
    const shouldExecuteImmediately =
      !fillOnly && (!item.fillCommand.endsWith(' ') || cmdTrimmed === '/pdf2abp' || cmdTrimmed === '/books' || cmdTrimmed === '/clear');

    if (shouldExecuteImmediately) {
      if (textarea) {
        textarea.value = '';
        textarea.style.height = '44px';
      }
      void this.executeCommand(cmdTrimmed);
    } else if (textarea) {
      textarea.value = item.fillCommand;
      textarea.focus();
      textarea.dispatchEvent(new Event('input'));
    }
  }

  private renderSlashDropdown(suggestions: SuggestionItem[]): void {
    const slashDropdown = document.getElementById('harness-slash-dropdown');
    const listEl = document.getElementById('harness-slash-list');
    if (!slashDropdown || !listEl) return;

    this.slashItems = suggestions || [];
    this.slashHighlightIdx = 0;

    if (!suggestions || suggestions.length === 0) {
      slashDropdown.classList.remove('show');
      return;
    }

    listEl.innerHTML = '';
    suggestions.forEach((item, idx) => {
      const itemEl = document.createElement('div');
      itemEl.className = `harness-slash-item ${idx === 0 ? 'is-highlighted' : ''}`;
      itemEl.dataset.cmd = item.fillCommand;
      const iconName = item.icon?.type === 'mdicon' ? item.icon.value : 'terminal';
      itemEl.innerHTML = `
        <div class="harness-slash-item__left">
          <span class="material-symbols-outlined harness-slash-item__icon" aria-hidden="true">${this.escapeHtml(iconName)}</span>
          <div class="harness-slash-item__texts">
            <span class="harness-slash-cmd">${this.escapeHtml(item.title)}</span>
            ${
              item.subtitle
                ? `<span class="harness-slash-desc">${this.escapeHtml(item.subtitle)}</span>`
                : ''
            }
          </div>
        </div>
        ${
          item.badge
            ? `<span class="harness-slash-badge">${this.escapeHtml(item.badge)}</span>`
            : ''
        }
      `;
      itemEl.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this.applySlashSuggestion(item, false);
      });
      listEl.appendChild(itemEl);
    });
    slashDropdown.classList.add('show');
  }

  private setGeneratingUi(generating: boolean): void {
    this.isGenerating = generating;
    const btn = document.getElementById('harness-btn-send');
    const icon = document.getElementById('harness-send-btn-icon');
    if (btn && icon) {
      btn.classList.toggle('is-aborting', generating);
      btn.setAttribute('title', generating ? '中断当前回复 (Esc)' : '发送指令 (Enter)');
      btn.setAttribute('aria-label', generating ? '中断当前回复' : '发送指令');
      icon.textContent = generating ? 'stop' : 'arrow_upward';
    }
  }

  public abortActiveTurn(): void {
    if (this.activeAbortController) {
      this.activeAbortController.abort();
    }
    for (const [stepId, resolve] of this.pendingApprovalResolvers.entries()) {
      resolve('denied');
      this.pendingApprovalResolvers.delete(stepId);
    }
    for (const [qId, resolve] of this.pendingQuestionResolvers.entries()) {
      resolve({ status: 'skipped', answers: {} });
      this.pendingQuestionResolvers.delete(qId);
    }
  }

  private submitUserInput(): void {
    const textarea = document.getElementById('harness-input-textarea') as HTMLTextAreaElement | null;
    if (!textarea) return;
    let text = textarea.value.trim();
    const quotes = [...this.pendingQuotes];
    const images = [...this.pendingImages];

    if (!text && images.length === 0) return;
    if (!text && images.length > 0) {
      text = '请结合随附图片进行详细解读与分析。';
    }

    if (quotes.length > 0) {
      const quoteBlock = quotes
        .map((q) => `> **引用 (${q.authorLabel})**：${q.text.replace(/\n+/g, ' ')}`)
        .join('\n');
      text = `${quoteBlock}\n\n${text}`;
    }

    textarea.value = '';
    textarea.style.height = '44px';
    this.pendingQuotes = [];
    this.pendingImages = [];
    this.renderAttachmentsShelf();
    this.closeAllPopovers();

    if (text.toLowerCase().startsWith('/btw ')) {
      void this.askSidecarQuestion(text);
      return;
    }

    if (this.isGenerating) {
      this.enqueueFollowupMessage(text, quotes, images);
      return;
    }

    void this.executeCommand(text, images);
  }

  public async executeCommand(input: string, attachedImages: ImageAttachment[] = []): Promise<void> {
    const trimmed = input.trim();
    if (!trimmed && attachedImages.length === 0) return;

    if (trimmed.toLowerCase().startsWith('/btw ')) {
      void this.askSidecarQuestion(trimmed);
      return;
    }

    if (this.isGenerating) {
      this.abortActiveTurn();
    }

    if (this.cachedBooks.length === 0) {
      await this.preloadBooksCatalog();
    }

    const active = this.conversations.find((c) => c.id === this.activeConvId);

    if (trimmed === '/clear') {
      this.pendingMessageQueue = [];
      this.pendingQuotes = [];
      this.pendingImages = [];
      this.renderFollowupQueue();
      this.renderAttachmentsShelf();
      if (active) active.messages = [];
      this.saveConversations();
      this.renderActiveConversation();
      return;
    }

    this.appendUserMessage(trimmed, attachedImages);

    if (active && active.title.startsWith('新会话')) {
      active.title = trimmed.slice(0, 18);
      this.renderSidebarSessions();
    }

    const inlineCmds = this.pluginEnv.extractInlineCommands(trimmed);
    const isPureCommand =
      attachedImages.length === 0 &&
      ((inlineCmds.length === 1 && inlineCmds[0].raw.length === trimmed.length) ||
        (trimmed.startsWith('/') && !trimmed.includes('\n') && trimmed.split(/\s+/).length <= 4));

    if (isPureCommand) {
      const cmdHead = trimmed.split(/\s+/)[0].toLowerCase();
      if (cmdHead === '/terminal') {
        this.switchInspectorTab('terminal');
        this.appendSimpleAssistantHtml(
          '<div style="font-size:0.9rem;">已切换至右侧 <strong>Terminal</strong> 交互控制台。</div>',
          '[已打开 Terminal 控制台]'
        );
        return;
      }

      const res = await this.pluginEnv.executeCommand(trimmed, this.createPluginContext());
      this.handlePureCommandResult(res);
      return;
    }

    if (inlineCmds.length > 0) {
      const toolResults: ToolExecutionResult[] = [];
      const preSteps: ToolCallStep[] = [];
      for (const match of inlineCmds) {
        const t0 = Date.now();
        const res = await this.pluginEnv.executeCommand(match.raw, this.createPluginContext());
        toolResults.push(res);

        let artId: string | undefined;
        if (res.artifact) {
          const saved = this.artifactStore.upsertArtifact(
            {
              id: res.artifact.id,
              kind: res.artifact.kind || 'markdown',
              title: res.artifact.title,
              badge: res.artifact.badge,
              html: res.artifact.html,
              code: res.artifact.code,
              patch: res.artifact.patch,
              diffStats: res.artifact.diffStats,
              pythonResult: res.artifact.pythonResult,
            },
            { activate: false }
          );
          artId = saved.id;
        }

        preSteps.push({
          id: `pre-${t0}-${Math.random().toString(36).slice(2, 6)}`,
          kind: 'tool',
          toolName: res.toolName,
          label: `执行 ${match.raw}`,
          icon: this.pluginEnv.getToolIcon(
            res.toolName,
            this.settingsStore.getState().toolOverrides
          ),
          args: { command: match.raw },
          resultSummary: res.summary,
          resultText: res.contextText,
          status: res.success ? 'completed' : 'error',
          startedAt: t0,
          endedAt: Date.now(),
          artifactId: artId,
        });
      }

      const augmentedPrompt = this.pluginEnv.buildAugmentedPrompt(trimmed, toolResults);
      await this.streamChatConversation(augmentedPrompt, preSteps, attachedImages);
      return;
    }

    await this.streamChatConversation(trimmed, [], attachedImages);
  }

  private handlePureCommandResult(res: ToolExecutionResult): void {
    let artId: string | undefined;
    if (res.artifact) {
      const saved = this.artifactStore.upsertArtifact(
        {
          id: res.artifact.id,
          kind: res.artifact.kind || 'markdown',
          title: res.artifact.title,
          badge: res.artifact.badge,
          html: res.artifact.html,
          markdown: res.artifact.markdown,
          code: res.artifact.code,
          patch: res.artifact.patch,
          diffStats: res.artifact.diffStats,
          pythonResult: res.artifact.pythonResult,
          canvasMode: res.artifact.canvasMode,
        },
        { activate: true }
      );
      artId = saved.id;
    }

    if (res.sideEffectTab) {
      const targetTab = res.sideEffectTab === 'diff' ? 'artifacts' : res.sideEffectTab;
      this.switchInspectorTab(targetTab);
    }

    if (res.inlineWidget?.type === 'pdf2abp_launcher') {
      const placeholder = renderPdf2AbpInlineCardPlaceholder(res.inlineWidget.prefillPdfPath || '');
      this.appendSimpleAssistantHtml(placeholder, '');
      return;
    }

    const now = Date.now();
    const turn: StructuredTurn = {
      id: `turn-${now}`,
      startedAt: now,
      endedAt: now,
      status: res.success ? 'completed' : 'error',
      steps: [
        {
          id: `step-${now}`,
          kind: 'tool',
          toolName: res.toolName,
          label: res.summary || `执行 ${res.command}`,
          icon: this.pluginEnv.getToolIcon(
            res.toolName,
            this.settingsStore.getState().toolOverrides
          ),
          args: { command: res.command },
          resultSummary: res.summary,
          resultText: res.contextText,
          status: res.success ? 'completed' : 'error',
          startedAt: now,
          endedAt: now,
          artifactId: artId,
        },
        {
          id: `done-${now}`,
          kind: 'complete',
          label: res.success ? '已完成' : '执行未成功',
          status: res.success ? 'completed' : 'error',
          timestamp: now,
        },
      ],
      contentMarkdown: '',
      collapseSummaryOverride: true,
    };

    const container = document.getElementById('harness-messages-container');
    if (!container) return;

    const msgId = 'm-' + now;
    const msg: ChatMessage = {
      id: msgId,
      role: 'assistant',
      html: res.cardHtml,
      content: `[${res.command}: ${res.summary}]`,
      turn,
      widgetsHtml: res.cardHtml,
      timestamp: now,
    };

    const msgEl = document.createElement('div');
    msgEl.className = 'harness-message harness-message--assistant';
    msgEl.dataset.msgId = msgId;
    this.renderAssistantMessageBody(msgEl, msg);
    container.appendChild(msgEl);
    this.maybeScrollToBottom(true);

    const active = this.conversations.find((c) => c.id === this.activeConvId);
    if (active) {
      active.messages.push(msg);
      this.saveConversations();
    }
  }

  private appendUserMessage(text: string, attachedImages: ImageAttachment[] = []): void {
    const container = document.getElementById('harness-messages-container');
    if (!container) return;

    const imgsHtml =
      attachedImages.length > 0
        ? `<div class="harness-user-images">${attachedImages
            .map(
              (im) =>
                `<img class="harness-user-thumb" src="${this.escapeHtml(im.dataUrl)}" alt="${this.escapeHtml(im.name)}" />`
            )
            .join('')}</div>`
        : '';
    const html = `<div class="harness-user-bubble">${this.escapeHtml(text)}${imgsHtml}</div>`;
    const msgId = 'm-' + Date.now();
    const msgEl = document.createElement('div');
    msgEl.className = 'harness-message harness-message--user';
    msgEl.dataset.msgId = msgId;
    msgEl.innerHTML = html;
    container.appendChild(msgEl);
    this.maybeScrollToBottom(true);

    const active = this.conversations.find((c) => c.id === this.activeConvId);
    if (active) {
      active.messages.push({
        id: msgId,
        role: 'user',
        html,
        content:
          attachedImages.length > 0
            ? `${text}\n[已随附 ${attachedImages.length} 张图片: ${attachedImages.map((im) => im.name).join(', ')}]`
            : text,
        timestamp: Date.now(),
      });
      this.saveConversations();
    }
  }

  private appendSimpleAssistantHtml(html: string, contentForContext = ''): void {
    const container = document.getElementById('harness-messages-container');
    if (!container) return;

    const msgId = 'm-' + Date.now();
    const msg: ChatMessage = {
      id: msgId,
      role: 'assistant',
      html,
      content: contentForContext,
      widgetsHtml: html,
      timestamp: Date.now(),
    };
    const msgEl = document.createElement('div');
    msgEl.className = 'harness-message harness-message--assistant';
    msgEl.dataset.msgId = msgId;
    msgEl.innerHTML = `<div class="harness-content-body">${html}</div>`;
    container.appendChild(msgEl);
    this.hydrateMessageDom(msgEl);
    container.scrollTop = container.scrollHeight;

    const active = this.conversations.find((c) => c.id === this.activeConvId);
    if (active) {
      active.messages.push(msg);
      this.saveConversations();
    }
  }

  private waitForApproval(
    step: ApprovalStep,
    signal: AbortSignal
  ): Promise<'approved-once' | 'approved-full' | 'denied'> {
    return new Promise((resolve) => {
      const onAbort = () => {
        this.pendingApprovalResolvers.delete(step.id);
        resolve('denied');
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
      this.pendingApprovalResolvers.set(step.id, (choice) => {
        signal.removeEventListener('abort', onAbort);
        resolve(choice);
      });
    });
  }

  private async runStreamingCompletionPass(params: {
    activeProvider: ProviderConfig;
    modelId: string;
    reasoningEffort: string;
    wireMessages: AgentChatMessage[];
    toolsPayload: any[];
    toolChoice: 'auto' | 'none';
    maxTokens: number;
    promptForCli: string;
    systemPrompt: string;
    activeConv?: Conversation;
    signal: AbortSignal;
    onReasoningDelta: (text: string) => void;
    onContentDelta: (text: string) => void;
    onAgyToolStart: (data: any) => void;
    onAgyToolDone: (data: any) => void;
  }): Promise<{
    roundContentBuffer: string;
    collectedToolCalls: Array<{ id: string; name: string; arguments: string }>;
    finishReason: string | null;
  }> {
    const {
      activeProvider,
      modelId,
      reasoningEffort,
      wireMessages,
      toolsPayload,
      toolChoice,
      maxTokens,
      promptForCli,
      systemPrompt,
      activeConv,
      signal,
    } = params;

    let res: Response;
    if (activeProvider.id === 'antigravity-cli') {
      res = await fetch('/api/v1/content/antigravity-cli/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: promptForCli,
          model: modelId,
          reasoningEffort,
          agyConversationId: activeConv?.agyConversationId,
          systemPrompt,
        }),
        signal,
      });
    } else {
      const requestBody = {
        provider: activeProvider.id,
        baseURL: activeProvider.baseURL,
        apiKey: activeProvider.apiKey,
        headers: activeProvider.headers,
        model: modelId,
        reasoningEffort,
        messages: wireMessages,
        stream: true,
        max_tokens: maxTokens,
        tools: toolsPayload,
        ...(toolsPayload.length > 0 ? { tool_choice: toolChoice } : {}),
      };
      try {
        res = await fetch('/api/v1/content/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
          signal,
        });
      } catch (fetchErr: any) {
        if (fetchErr?.name === 'AbortError') throw fetchErr;
        const targetUrl = activeProvider.baseURL.replace(/\/+$/, '') + '/chat/completions';
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          ...(activeProvider.apiKey ? { Authorization: `Bearer ${activeProvider.apiKey}` } : {}),
          ...(activeProvider.headers || {}),
        };
        res = await fetch(targetUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: modelId,
            messages: wireMessages,
            stream: true,
            max_tokens: maxTokens,
            ...(toolsPayload.length > 0 ? { tools: toolsPayload, tool_choice: toolChoice } : {}),
          }),
          signal,
        });
      }
    }

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`API 响应错误 (${res.status}): ${errText.slice(0, 200)}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error('未能获取响应可读流');

    const decoder = new TextDecoder('utf-8');
    let partialLine = '';
    let roundContentBuffer = '';
    let finishReason: string | null = null;
    const collectedByIndex: Record<number, { id: string; name: string; arguments: string }> = {};

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const textChunk = decoder.decode(value, { stream: true });
      const lines = (partialLine + textChunk).split('\n');
      partialLine = lines.pop() || '';

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine || !trimmedLine.startsWith('data:')) continue;
        if (trimmedLine === 'data: [DONE]') break;

        const jsonStr = trimmedLine.replace(/^data:\s*/, '');
        let data: any;
        try {
          data = JSON.parse(jsonStr);
        } catch {
          continue;
        }

        if (data.error) {
          throw new Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error));
        }

        if (data.type === 'init' && data.conversationId && activeConv) {
          activeConv.agyConversationId = data.conversationId;
        }
        if (data.type === 'finish' && data.conversationId && activeConv) {
          activeConv.agyConversationId = data.conversationId;
        }
        if (data.type === 'tool_start') {
          params.onAgyToolStart(data);
        }
        if (data.type === 'tool_done') {
          params.onAgyToolDone(data);
        }

        const choice0 = data.choices?.[0];
        if (choice0?.finish_reason) {
          finishReason = String(choice0.finish_reason);
        }

        const delta = choice0?.delta;
        if (!delta) continue;

        const reasoningDelta = delta.reasoning || delta.reasoning_content;
        if (reasoningDelta) {
          params.onReasoningDelta(reasoningDelta);
        }

        if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            if (!collectedByIndex[idx]) {
              collectedByIndex[idx] = {
                id: tc.id || `tc-${Date.now()}-${idx}`,
                name: tc.function?.name || '',
                arguments: '',
              };
            }
            if (tc.id) collectedByIndex[idx].id = tc.id;
            if (tc.function?.name) collectedByIndex[idx].name = tc.function.name;
            if (tc.function?.arguments) collectedByIndex[idx].arguments += tc.function.arguments;
          }
        }

        if (delta.content) {
          roundContentBuffer += delta.content;
          params.onContentDelta(delta.content);
        }
      }
    }

    return {
      roundContentBuffer,
      collectedToolCalls: Object.values(collectedByIndex),
      finishReason,
    };
  }

  private async streamChatConversation(
    prompt: string,
    preSteps: ToolCallStep[] = [],
    attachedImages: ImageAttachment[] = []
  ): Promise<void> {
    const container = document.getElementById('harness-messages-container');
    if (!container) return;

    await this.ensurePythonEnvLoaded();

    const settings = this.settingsStore.getState();
    const activeProvider =
      settings.providers.find((p) => p.id === settings.currentProviderId) || settings.providers[0];
    const activeConv = this.conversations.find((c) => c.id === this.activeConvId);

    const turnId = 'turn-' + Date.now();
    const msgId = 'm-' + Date.now();
    const initialBlocks: TurnBlock[] = preSteps.map((s) => ({
      id: `blk_${s.id}`,
      kind: 'tool',
      stepId: s.id,
      toolName: s.toolName,
      label: s.label,
      icon: s.icon,
      args: s.args,
      resultSummary: s.resultSummary,
      resultText: s.resultText,
      status: s.status,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      artifactId: s.artifactId,
      errorMessage: s.errorMessage,
      expanded: s.expanded,
    }));

    const turn: StructuredTurn = {
      id: turnId,
      startedAt: Date.now(),
      status: 'streaming',
      providerDisplayName: activeProvider.displayName,
      steps: [...preSteps],
      blocks: initialBlocks,
      contentMarkdown: '',
    };

    const msgObj: ChatMessage = {
      id: msgId,
      role: 'assistant',
      html: '',
      content: '',
      turn,
      widgetsHtml: '',
      timestamp: Date.now(),
    };

    const msgEl = document.createElement('div');
    msgEl.className = 'harness-message harness-message--assistant';
    msgEl.dataset.msgId = msgId;
    const streamHost = document.createElement('div');
    streamHost.className = 'harness-turn-stream-host';
    msgEl.appendChild(streamHost);
    container.appendChild(msgEl);

    const turnView = this.createTurnStreamView(streamHost);
    this.turnViews.set(msgId, turnView);
    turnView.sync(turn);
    this.maybeScrollToBottom(false);

    let lastSyncTs = 0;
    let syncScheduled = false;
    const syncTurnNow = (force = false) => {
      const now = Date.now();
      if (force || now - lastSyncTs >= 75) {
        lastSyncTs = now;
        syncScheduled = false;
        turnView.sync(turn);
        this.maybeScrollToBottom(false);
        return;
      }
      if (!syncScheduled) {
        syncScheduled = true;
        window.setTimeout(() => {
          syncScheduled = false;
          if (turn.status === 'streaming') {
            lastSyncTs = Date.now();
            turnView.sync(turn);
            this.maybeScrollToBottom(false);
          }
        }, 75);
      }
    };

    const dynamicDescs = this.getDynamicToolDescriptions();
    const webSearchActive = isWebSearchConfigured(settings.webSearch);
    const fullSystemPrompt = `${settings.systemPrompt}\n\n${this.pluginEnv.generateSystemPromptHelp({
      permissionMode: settings.permissionMode,
      overrides: settings.toolOverrides,
      webSearchEnabled: webSearchActive,
      dynamicToolDescriptions: dynamicDescs,
    })}`;
    const historyMessages: AgentChatMessage[] = [{ role: 'system', content: fullSystemPrompt }];

    if (activeConv) {
      const past = activeConv.messages.slice(0, -1).slice(-12);
      for (const m of past) {
        if (m.content) {
          historyMessages.push({ role: m.role, content: m.content });
        }
      }
    }

    if (attachedImages.length > 0) {
      historyMessages.push({
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          ...attachedImages.map((im) => ({
            type: 'image_url' as const,
            image_url: { url: im.dataUrl },
          })),
        ],
        meta: {
          visionLabel: attachedImages.map((im) => im.name).join(', '),
        },
      });
    } else {
      historyMessages.push({ role: 'user', content: prompt });
    }

    const cliPrompt =
      attachedImages.length > 0
        ? `${prompt}\n\n[用户随附了 ${attachedImages.length} 张图像: ${attachedImages
            .map((im) => im.workspacePath || im.name)
            .join(', ')}]`
        : prompt;

    const abortController = new AbortController();
    this.activeAbortController = abortController;
    this.setGeneratingUi(true);

    const timerInterval = window.setInterval(() => {
      if (turn.status === 'streaming' && (turn.blocks?.length || 0) > 0) {
        turnView.sync(turn);
      }
    }, 800);

    const maxRounds = Math.min(60, Math.max(5, Number(settings.maxAgentRounds) || 30));

    let activeThinkingStep: ThinkingStep | null = null;
    let activeThinkingBlock: ThinkingBlock | null = null;
    let activeTextBlock: TextBlock | null = null;

    const closeActiveThinking = () => {
      if (activeThinkingStep && activeThinkingStep.status === 'running') {
        activeThinkingStep.status = 'completed';
        activeThinkingStep.endedAt = Date.now();
        activeThinkingStep.expanded = false;
      }
      if (activeThinkingBlock && activeThinkingBlock.status === 'running') {
        activeThinkingBlock.status = 'completed';
        activeThinkingBlock.endedAt = Date.now();
        activeThinkingBlock.expanded = false;
      }
      activeThinkingStep = null;
      activeThinkingBlock = null;
    };

    const closeActiveText = () => {
      if (activeTextBlock && activeTextBlock.status === 'streaming') {
        activeTextBlock.status = 'completed';
        activeTextBlock.endedAt = Date.now();
      }
      activeTextBlock = null;
    };

    const handleReasoningDelta = (deltaText: string) => {
      closeActiveText();
      if (!activeThinkingStep || !activeThinkingBlock) {
        const sid = `think-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
        const now = Date.now();
        activeThinkingStep = {
          id: sid,
          kind: 'thinking',
          content: '',
          startedAt: now,
          status: 'running',
          expanded: true,
        };
        activeThinkingBlock = {
          id: `blk_${sid}`,
          kind: 'thinking',
          stepId: sid,
          content: '',
          startedAt: now,
          status: 'running',
          expanded: true,
        };
        turn.steps.push(activeThinkingStep);
        turn.blocks!.push(activeThinkingBlock);
      }
      activeThinkingStep.content += deltaText;
      activeThinkingBlock.content += deltaText;
      syncTurnNow(false);
    };

    const handleContentDelta = (deltaText: string) => {
      closeActiveThinking();
      if (!activeTextBlock) {
        activeTextBlock = {
          id: `txt-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          kind: 'text',
          markdown: '',
          startedAt: Date.now(),
          status: 'streaming',
        };
        turn.blocks!.push(activeTextBlock);
      }
      activeTextBlock.markdown += deltaText;
      turn.contentMarkdown += deltaText;
      syncTurnNow(false);
    };

    try {
      let round = 0;
      let lengthContinuations = 0;
      let lastRoundHadTools = false;

      while (round < maxRounds) {
        round++;
        if (abortController.signal.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }

        const currentSettings = this.settingsStore.getState();
        const modelOpt = activeProvider.models.find((m) => m.id === currentSettings.currentModelId);
        const capabilities = resolveProviderCapabilities(
          activeProvider.id,
          currentSettings.currentModelId,
          {
            supportsVision: modelOpt?.supportsVision,
            maxImagesPerRequest: modelOpt?.maxImagesPerRequest,
            maxContextTokens: modelOpt?.maxContextTokens,
            defaultMaxOutputTokens: modelOpt?.defaultMaxOutputTokens,
          }
        );
        const contextManager = new AgentContextManager({ capabilities });
        const prepared = contextManager.prepareContext(historyMessages);
        this.lastSentPrefixMessages = prepared.wireMessages;

        const toolsPayload = this.pluginEnv.toOpenAITools({
          permissionMode: currentSettings.permissionMode,
          overrides: currentSettings.toolOverrides,
          webSearchEnabled: isWebSearchConfigured(currentSettings.webSearch),
          dynamicToolDescriptions: this.getDynamicToolDescriptions(),
        });

        const agyRunningTools = new Map<string, { step: ToolCallStep; block: ToolBlock }>();

        const passResult = await this.runStreamingCompletionPass({
          activeProvider,
          modelId: currentSettings.currentModelId,
          reasoningEffort: currentSettings.currentReasoningEffort,
          wireMessages: prepared.wireMessages,
          toolsPayload,
          toolChoice: 'auto',
          maxTokens: capabilities.defaultMaxOutputTokens,
          promptForCli: cliPrompt,
          systemPrompt: fullSystemPrompt,
          activeConv,
          signal: abortController.signal,
          onReasoningDelta: handleReasoningDelta,
          onContentDelta: handleContentDelta,
          onAgyToolStart: (data) => {
            closeActiveThinking();
            closeActiveText();
            const toolName = String(data.tool_name || 'tool');
            const callId = String(data.tool_call_id || `agy-${Date.now()}`);
            const now = Date.now();
            const icon = this.pluginEnv.getToolIcon(toolName, this.settingsStore.getState().toolOverrides);
            const label = this.pluginEnv.getToolActionLabel(toolName, data.parameters || {});
            const step: ToolCallStep = {
              id: callId,
              kind: 'tool',
              toolName,
              label,
              icon,
              args: data.parameters || {},
              status: 'running',
              startedAt: now,
            };
            const block: ToolBlock = {
              id: `blk_${callId}`,
              kind: 'tool',
              stepId: callId,
              toolName,
              label,
              icon,
              args: data.parameters || {},
              status: 'running',
              startedAt: now,
            };
            agyRunningTools.set(callId, { step, block });
            turn.steps.push(step);
            turn.blocks!.push(block);
            syncTurnNow(true);
          },
          onAgyToolDone: (data) => {
            const callId = String(data.tool_call_id || '');
            const pair = agyRunningTools.get(callId);
            if (pair) {
              const outStr =
                typeof data.output === 'string'
                  ? data.output.slice(0, 4000)
                  : JSON.stringify(data.output || '');
              pair.step.status = 'completed';
              pair.step.endedAt = Date.now();
              pair.step.resultText = outStr;
              pair.block.status = 'completed';
              pair.block.endedAt = pair.step.endedAt;
              pair.block.resultText = outStr;
              agyRunningTools.delete(callId);
              syncTurnNow(true);
            }
          },
        });

        closeActiveThinking();
        syncTurnNow(true);

        const toolCallEntries = passResult.collectedToolCalls;
        if (activeProvider.id === 'antigravity-cli') {
          closeActiveText();
          lastRoundHadTools = false;
          break;
        }

        if (toolCallEntries.length === 0) {
          closeActiveText();
          lastRoundHadTools = false;

          if (passResult.finishReason === 'length' && lengthContinuations < 2) {
            lengthContinuations++;
            historyMessages.push({
              role: 'assistant',
              content: passResult.roundContentBuffer || '',
            });
            historyMessages.push({
              role: 'user',
              content:
                '上一条回复因单次输出长度达到上限被截断，请紧接上文未完成处继续输出完整推导与结论（勿重复前文内容）。',
            });
            turn.blocks!.push({
              id: `st-cont-${Date.now()}-${lengthContinuations}`,
              kind: 'status',
              tone: 'info',
              label: `输出触及单次长度上限，正在自动续写 (${lengthContinuations}/2)…`,
              timestamp: Date.now(),
            } satisfies StatusBlock);
            syncTurnNow(true);
            continue;
          }
          break;
        }

        closeActiveText();
        lastRoundHadTools = true;

        historyMessages.push({
          role: 'assistant',
          content: passResult.roundContentBuffer || null,
          tool_calls: toolCallEntries.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: tc.arguments },
          })),
        });

        for (const tc of toolCallEntries) {
          if (abortController.signal.aborted) {
            throw new DOMException('Aborted', 'AbortError');
          }
          let parsedArgs: Record<string, any> = {};
          try {
            parsedArgs = JSON.parse(tc.arguments || '{}');
          } catch {}

          const curSettings = this.settingsStore.getState();
          const perm = this.pluginEnv.evaluateToolPermission(
            tc.name,
            curSettings.permissionMode,
            parsedArgs
          );

          const stepId = `tool-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
          const label = this.pluginEnv.getToolActionLabel(tc.name, parsedArgs);
          const icon = this.pluginEnv.getToolIcon(tc.name, curSettings.toolOverrides);
          const toolStep: ToolCallStep = {
            id: stepId,
            kind: 'tool',
            toolName: tc.name,
            label,
            icon,
            args: parsedArgs,
            status: 'running',
            startedAt: Date.now(),
          };
          const toolBlock: ToolBlock = {
            id: `blk_${stepId}`,
            kind: 'tool',
            stepId,
            toolName: tc.name,
            label,
            icon,
            args: parsedArgs,
            status: 'running',
            startedAt: toolStep.startedAt,
          };
          turn.steps.push(toolStep);
          turn.blocks!.push(toolBlock);
          syncTurnNow(true);

          if (perm.decision === 'deny') {
            toolStep.status = 'denied';
            toolStep.endedAt = Date.now();
            toolStep.errorMessage = perm.reason || '权限策略拒绝执行';
            toolBlock.status = 'denied';
            toolBlock.endedAt = toolStep.endedAt;
            toolBlock.errorMessage = toolStep.errorMessage;
            syncTurnNow(true);
            historyMessages.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: toolStep.errorMessage,
            });
            continue;
          }

          if (perm.decision === 'prompt') {
            const apprId = `appr-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
            const appStep: ApprovalStep = {
              id: apprId,
              kind: 'approval',
              toolName: tc.name,
              label: toolStep.label,
              reason: perm.reason || `请求授权执行 ${tc.name}`,
              targetPath: perm.targetPath,
              status: 'pending',
              createdAt: Date.now(),
            };
            const appBlock: ApprovalBlock = {
              id: `blk_${apprId}`,
              kind: 'approval',
              stepId: apprId,
              toolName: tc.name,
              label: toolStep.label,
              reason: appStep.reason,
              targetPath: perm.targetPath,
              status: 'pending',
              createdAt: appStep.createdAt,
            };
            turn.steps.push(appStep);
            turn.blocks!.push(appBlock);
            syncTurnNow(true);

            const decision = await this.waitForApproval(appStep, abortController.signal);
            appStep.status = decision;
            appStep.resolvedAt = Date.now();
            appBlock.status = decision;
            appBlock.resolvedAt = appStep.resolvedAt;

            if (decision === 'approved-full') {
              this.settingsStore.setPermissionMode('full');
            }
            if (decision === 'denied') {
              toolStep.status = 'denied';
              toolStep.endedAt = Date.now();
              toolStep.errorMessage = '用户已拒绝本次操作';
              toolBlock.status = 'denied';
              toolBlock.endedAt = toolStep.endedAt;
              toolBlock.errorMessage = toolStep.errorMessage;
              syncTurnNow(true);
              historyMessages.push({
                role: 'tool',
                tool_call_id: tc.id,
                content: '用户拒绝授权此操作，请改用其他安全方式或说明情况。',
              });
              continue;
            }
          }

          const execCtx: ToolExecutionContext = {
            ...this.createPluginContext(),
            requestUserQuestions: (payload) => {
              return new Promise((resolve) => {
                const questionId = `askq-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
                const qBlock: QuestionBlock = {
                  id: `blk_${questionId}`,
                  kind: 'question',
                  questionId,
                  title: payload.title,
                  questions: payload.questions,
                  status: 'pending',
                  createdAt: Date.now(),
                };
                turn.blocks!.push(qBlock);
                syncTurnNow(true);
                this.maybeScrollToBottom(false);

                const onAbort = () => {
                  this.pendingQuestionResolvers.delete(questionId);
                  qBlock.status = 'skipped';
                  qBlock.resolvedAt = Date.now();
                  syncTurnNow(true);
                  resolve({ status: 'skipped', answers: {} });
                };
                if (abortController.signal.aborted) {
                  onAbort();
                  return;
                }
                abortController.signal.addEventListener('abort', onAbort, { once: true });
                this.pendingQuestionResolvers.set(questionId, (res) => {
                  abortController.signal.removeEventListener('abort', onAbort);
                  qBlock.status = res.status;
                  qBlock.answers = res.answers;
                  qBlock.resolvedAt = Date.now();
                  syncTurnNow(true);
                  resolve(res);
                });
              });
            },
          };

          const toolRes = await this.pluginEnv.executeAgentTool(
            tc.name,
            parsedArgs,
            execCtx
          );

          toolStep.status = toolRes.success ? 'completed' : 'error';
          toolStep.endedAt = Date.now();
          toolStep.resultSummary = toolRes.summary;
          toolStep.resultText = toolRes.contextText;
          if (!toolRes.success) {
            toolStep.errorMessage = toolRes.summary;
          }

          toolBlock.status = toolStep.status;
          toolBlock.endedAt = toolStep.endedAt;
          toolBlock.resultSummary = toolStep.resultSummary;
          toolBlock.resultText = toolStep.resultText;
          toolBlock.errorMessage = toolStep.errorMessage;

          if (toolRes.artifact) {
            if (
              toolRes.artifact.kind === 'canvas' &&
              toolRes.artifact.id &&
              this.artifactStore.getArtifact(toolRes.artifact.id) &&
              tc.name === 'update_canvas_artifact'
            ) {
              const updated = this.artifactStore.pushCanvasVersion(
                toolRes.artifact.id,
                toolRes.artifact.code || '',
                parsedArgs.summary || 'Agent 更新',
                toolRes.artifact.title
              );
              toolStep.artifactId = updated?.id || toolRes.artifact.id;
            } else {
              const saved = this.artifactStore.upsertArtifact(
                {
                  id: toolRes.artifact.id,
                  kind: toolRes.artifact.kind || 'markdown',
                  title: toolRes.artifact.title,
                  badge: toolRes.artifact.badge,
                  html: toolRes.artifact.html,
                  markdown: toolRes.artifact.markdown,
                  code: toolRes.artifact.code,
                  patch: toolRes.artifact.patch,
                  diffStats: toolRes.artifact.diffStats,
                  pythonResult: toolRes.artifact.pythonResult,
                  canvasMode: toolRes.artifact.canvasMode,
                },
                { activate: false }
              );
              toolStep.artifactId = saved.id;
            }
            toolBlock.artifactId = toolStep.artifactId;
          }

          if (toolRes.inlineWidget?.type === 'canvas_card') {
            const widgetBlock: WidgetBlock = {
              id: `wgt-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
              kind: 'widget',
              widgetType: 'canvas',
              artifactId: toolRes.inlineWidget.artifactId,
              caption: toolRes.inlineWidget.title,
              createdAt: Date.now(),
            };
            turn.blocks!.push(widgetBlock);
          }

          syncTurnNow(true);
          historyMessages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: toolRes.contextText || toolRes.summary,
          });
          if (toolRes.visionImage?.dataUrl) {
            historyMessages.push({
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: `[Visual input attached: ${toolRes.visionImage.label}] Inspect this image carefully.`,
                },
                {
                  type: 'image_url',
                  image_url: { url: toolRes.visionImage.dataUrl },
                },
              ],
              meta: {
                syntheticVision: true,
                visionLabel: toolRes.visionImage.label,
                visionRelPath: toolRes.visionImage.relPath,
              },
            });
          }
        }

        if (round === maxRounds - 1) {
          historyMessages.push({
            role: 'user',
            content:
              '[系统提示] 工具调用预算仅余最后 1 轮。请在下一轮基于目前已经掌握的所有文本、数值与视觉信息直接给出完整的最终学术答复与结论，勿再发起新的冗余检索。',
          });
        }
      }

      if (lastRoundHadTools && !abortController.signal.aborted && activeProvider.id !== 'antigravity-cli') {
        const currentSettings = this.settingsStore.getState();
        const modelOpt = activeProvider.models.find((m) => m.id === currentSettings.currentModelId);
        const capabilities = resolveProviderCapabilities(
          activeProvider.id,
          currentSettings.currentModelId,
          {
            supportsVision: modelOpt?.supportsVision,
            maxImagesPerRequest: modelOpt?.maxImagesPerRequest,
            maxContextTokens: modelOpt?.maxContextTokens,
            defaultMaxOutputTokens: modelOpt?.defaultMaxOutputTokens,
          }
        );
        const contextManager = new AgentContextManager({ capabilities });

        historyMessages.push({
          role: 'user',
          content:
            '[系统提示] 已达到单轮最大工具调用次数限制。请停止调用任何工具，严格依据上述已经读取到的上下文与工具返回值，向用户总结当前发现、已完成的工作以及尚未完成的线索。',
        });

        const finalPrepared = contextManager.prepareContext(historyMessages);
        this.lastSentPrefixMessages = finalPrepared.wireMessages;
        const summaryTools = this.pluginEnv.toOpenAITools({
          permissionMode: currentSettings.permissionMode,
          overrides: currentSettings.toolOverrides,
          webSearchEnabled: isWebSearchConfigured(currentSettings.webSearch),
          dynamicToolDescriptions: this.getDynamicToolDescriptions(),
        });

        await this.runStreamingCompletionPass({
          activeProvider,
          modelId: currentSettings.currentModelId,
          reasoningEffort: currentSettings.currentReasoningEffort,
          wireMessages: finalPrepared.wireMessages,
          toolsPayload: summaryTools,
          toolChoice: 'none',
          maxTokens: capabilities.defaultMaxOutputTokens,
          promptForCli: cliPrompt,
          systemPrompt: fullSystemPrompt,
          activeConv,
          signal: abortController.signal,
          onReasoningDelta: handleReasoningDelta,
          onContentDelta: handleContentDelta,
          onAgyToolStart: () => {},
          onAgyToolDone: () => {},
        });

        closeActiveThinking();
        closeActiveText();

        turn.blocks!.push({
          id: `st-limit-${Date.now()}`,
          kind: 'status',
          tone: 'warning',
          label: `已达到单次连续探索上限（${maxRounds} 轮），已总结当前阶段性发现`,
          action: 'continue-exploring',
          timestamp: Date.now(),
        } satisfies StatusBlock);
      }

      turn.status = 'completed';
      turn.endedAt = Date.now();
      turn.steps.push({
        id: `done-${Date.now()}`,
        kind: 'complete',
        label: '已完成',
        status: 'completed',
        timestamp: Date.now(),
      });
    } catch (err: any) {
      closeActiveThinking();
      closeActiveText();
      const termStatus = err?.name === 'AbortError' ? 'aborted' : 'error';
      for (const s of turn.steps) {
        if ((s.kind === 'thinking' || s.kind === 'tool') && s.status === 'running') {
          s.status = termStatus;
          s.endedAt = Date.now();
          s.expanded = false;
        }
      }
      for (const b of turn.blocks || []) {
        if ((b.kind === 'thinking' || b.kind === 'tool') && b.status === 'running') {
          b.status = termStatus;
          b.endedAt = Date.now();
          b.expanded = false;
        }
      }

      if (err?.name === 'AbortError') {
        turn.status = 'aborted';
        turn.endedAt = Date.now();
        turn.steps.push({
          id: `abort-${Date.now()}`,
          kind: 'complete',
          label: '已手动中止',
          status: 'aborted',
          timestamp: Date.now(),
        });
        turn.blocks!.push({
          id: `st-abort-${Date.now()}`,
          kind: 'status',
          tone: 'warning',
          label: '已手动中止本轮生成',
          action: 'continue-exploring',
          timestamp: Date.now(),
        } satisfies StatusBlock);
      } else {
        turn.status = 'error';
        turn.endedAt = Date.now();
        turn.errorMessage = err?.message || '通信异常，请检查模型配置';
        turn.steps.push({
          id: `err-${Date.now()}`,
          kind: 'complete',
          label: '执行异常',
          status: 'error',
          timestamp: Date.now(),
        });
        turn.blocks!.push({
          id: `st-err-${Date.now()}`,
          kind: 'status',
          tone: 'error',
          label: '通信或执行中断',
          detail: turn.errorMessage,
          action: 'continue-exploring',
          timestamp: Date.now(),
        } satisfies StatusBlock);
      }
    } finally {
      window.clearInterval(timerInterval);
      if (this.activeAbortController === abortController) {
        this.activeAbortController = null;
      }
      this.setGeneratingUi(false);

      if (!turn.contentMarkdown.trim() && turn.status === 'completed') {
        turn.blocks!.push({
          id: `st-empty-${Date.now()}`,
          kind: 'status',
          tone: 'completed',
          label: '已完成操作',
          timestamp: Date.now(),
        } satisfies StatusBlock);
      }

      syncTurnNow(true);
      this.maybeScrollToBottom(false);

      msgObj.content = turn.contentMarkdown;
      if (activeConv) {
        activeConv.messages.push(msgObj);
        this.saveConversations();
      }

      if (turn.status === 'completed' && this.pendingMessageQueue.length > 0) {
        const nextQueued = this.pendingMessageQueue.shift();
        this.renderFollowupQueue();
        if (nextQueued) {
          window.setTimeout(() => {
            void this.executeCommand(nextQueued.rawText, nextQueued.images || []);
          }, 80);
        }
      }
    }
  }

  private bindCardInteractionsIn(root: HTMLElement): void {
    root.querySelectorAll('[data-action="load-toc"]').forEach((btn) => {
      if ((btn as HTMLElement).dataset.boundToc === 'true') return;
      (btn as HTMLElement).dataset.boundToc = 'true';
      btn.addEventListener('click', () => {
        const book = (btn as HTMLElement).dataset.book;
        if (book) void this.executeCommand(`/toc ${book}`);
      });
    });

    root.querySelectorAll('.harness-toc-link').forEach((link) => {
      if ((link as HTMLElement).dataset.boundLink === 'true') return;
      (link as HTMLElement).dataset.boundLink = 'true';
      link.addEventListener('click', () => {
        const uri = (link as HTMLElement).dataset.uri;
        const slug = (link as HTMLElement).dataset.slug;
        const book = (link as HTMLElement).dataset.book;
        if (uri) void this.executeCommand(`/ast ${uri}`);
        else if (slug) void this.executeCommand(book ? `/ast ${book} ${slug}` : `/ast ${slug}`);
      });
    });

    root.querySelectorAll('[data-cmd]').forEach((chip) => {
      if ((chip as HTMLElement).dataset.boundCmd === 'true') return;
      (chip as HTMLElement).dataset.boundCmd = 'true';
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        const cmd = chip.getAttribute('data-cmd') || chip.textContent?.trim() || '';
        if (!cmd) return;
        if (chip.tagName === 'CODE') {
          this.insertSchemeToInput(cmd);
        } else {
          void this.executeCommand(cmd);
        }
      });
    });

    root.querySelectorAll('.m3-code-copy-btn').forEach((btn) => {
      if ((btn as HTMLElement).dataset.boundCopy === 'true') return;
      (btn as HTMLElement).dataset.boundCopy = 'true';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const block = (btn as HTMLElement).closest('.m3-code-block');
        const code = block?.querySelector('code')?.textContent || '';
        if (code) {
          navigator.clipboard?.writeText(code);
          const span = btn.querySelector('span');
          if (span) {
            const orig = span.textContent;
            span.textContent = '已复制';
            setTimeout(() => {
              span.textContent = orig;
            }, 1500);
          }
        }
      });
    });

    root.querySelectorAll('.mermaid-copy-btn').forEach((btn) => {
      if ((btn as HTMLElement).dataset.boundMcopy === 'true') return;
      (btn as HTMLElement).dataset.boundMcopy = 'true';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const mContainer = (btn as HTMLElement).closest('.mermaid-container');
        const encoded = mContainer?.getAttribute('data-mermaid-code') || '';
        let code = '';
        try {
          code = decodeURIComponent(encoded);
        } catch {
          code = encoded;
        }
        if (!code) code = mContainer?.querySelector('pre.mermaid')?.textContent || '';
        if (code) {
          navigator.clipboard?.writeText(code);
          const span = btn.querySelector('span');
          if (span) {
            const orig = span.textContent;
            span.textContent = '已复制';
            setTimeout(() => {
              span.textContent = orig;
            }, 1500);
          }
        }
      });
    });

    root.querySelectorAll('.mermaid-zoom-btn').forEach((btn) => {
      if ((btn as HTMLElement).dataset.boundMzoom === 'true') return;
      (btn as HTMLElement).dataset.boundMzoom = 'true';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const mContainer = (btn as HTMLElement).closest('.mermaid-container');
        const svgEl = mContainer?.querySelector('.mermaid-render svg') as SVGElement | null;
        if (svgEl) this.openMermaidLightbox(svgEl.outerHTML);
      });
    });
  }

  private openMermaidLightbox(svgHtml: string): void {
    let modal = document.getElementById('harness-mermaid-lightbox');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'harness-mermaid-lightbox';
      modal.className = 'harness-mermaid-lightbox';
      document.body.appendChild(modal);
    }

    modal.innerHTML = `
      <div class="harness-mermaid-lightbox__card">
        <div class="harness-mermaid-lightbox__header">
          <div class="harness-mermaid-lightbox__title">
            <span class="material-symbols-outlined" style="font-size:18px;">account_tree</span>
            <span>Mermaid 流程图 · 缩放预览</span>
          </div>
          <div class="harness-mermaid-lightbox__toolbar">
            <button type="button" class="harness-mermaid-lightbox__btn" id="mermaid-lightbox-zoom-in">放大</button>
            <button type="button" class="harness-mermaid-lightbox__btn" id="mermaid-lightbox-zoom-out">缩小</button>
            <button type="button" class="harness-mermaid-lightbox__btn" id="mermaid-lightbox-zoom-reset">1:1 复位</button>
            <button type="button" class="harness-mermaid-lightbox__btn" id="mermaid-lightbox-close">关闭</button>
          </div>
        </div>
        <div class="harness-mermaid-lightbox__content" id="mermaid-lightbox-viewport">
          <div id="mermaid-lightbox-svg-wrapper" style="transform: scale(1); transform-origin: center center; transition: transform 0.15s ease;">
            ${svgHtml}
          </div>
        </div>
      </div>
    `;

    modal.style.display = 'flex';
    let currentScale = 1.0;
    const wrapper = modal.querySelector('#mermaid-lightbox-svg-wrapper') as HTMLElement | null;

    modal.querySelector('#mermaid-lightbox-zoom-in')?.addEventListener('click', () => {
      currentScale = Math.min(3.5, currentScale + 0.25);
      if (wrapper) wrapper.style.transform = `scale(${currentScale})`;
    });
    modal.querySelector('#mermaid-lightbox-zoom-out')?.addEventListener('click', () => {
      currentScale = Math.max(0.4, currentScale - 0.25);
      if (wrapper) wrapper.style.transform = `scale(${currentScale})`;
    });
    modal.querySelector('#mermaid-lightbox-zoom-reset')?.addEventListener('click', () => {
      currentScale = 1.0;
      if (wrapper) wrapper.style.transform = 'scale(1)';
    });

    const closeModal = () => {
      if (modal) modal.style.display = 'none';
      window.removeEventListener('keydown', onKey);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeModal();
    };
    window.addEventListener('keydown', onKey);
    modal.querySelector('#mermaid-lightbox-close')?.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });
  }

  private async renderMathInElement(el: HTMLElement): Promise<void> {
    try {
      if (!this.renderMathInElementFn) {
        const mod = await import('katex/dist/contrib/auto-render.mjs');
        this.renderMathInElementFn = mod.default || mod;
      }
      if (this.renderMathInElementFn) {
        this.renderMathInElementFn(el, {
          delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '$', right: '$', display: false },
            { left: '\\(', right: '\\)', display: false },
            { left: '\\[', right: '\\]', display: true },
          ],
          ignoredClasses: ['astro-canvas-iframe', 'mermaid'],
          throwOnError: false,
        });
      }
    } catch {}
  }

  public async probeAntigravityCli(): Promise<void> {
    try {
      let status: any = null;
      const bridge = (window as any).astrolib || (window as any).astrolibDesktop;

      if (bridge && typeof bridge.getAntigravityCliStatus === 'function') {
        status = await bridge.getAntigravityCliStatus();
      }

      if (!status || status.available === undefined) {
        const res = await fetch('/api/v1/content/antigravity-cli/status').catch(() => null);
        if (res && res.ok) {
          const json = await res.json().catch(() => null);
          status = json?.data;
        }
      }

      const st = this.settingsStore.getState();
      if (status && status.available) {
        this.antigravityCliAvailable = true;
        this.antigravityCliInfo = status;

        const agyModels: ModelOption[] =
          status.models && status.models.length > 0
            ? status.models.map((m: any) => ({
                id: m.id,
                name: m.name,
                reasoningEffort: m.reasoningEffort || 'high',
                desc: m.desc,
                badge: m.badge,
              }))
            : [
                {
                  id: 'gemini-3.8-flash-high',
                  name: 'Gemini 3.8 Flash (High)',
                  reasoningEffort: 'high',
                  desc: '前沿混合长文推理',
                  badge: '推荐',
                },
                {
                  id: 'claude-sonnet-4-6',
                  name: 'Claude Sonnet 4.6',
                  reasoningEffort: 'high',
                  desc: '深度思考与严密逻辑推导',
                  badge: '深度思考',
                },
              ];

        const agyProvider: ProviderConfig = {
          id: 'antigravity-cli',
          displayName: 'Antigravity CLI (本地)',
          isCustom: false,
          status: 'connected',
          api: 'antigravity-cli',
          baseURL: 'local://antigravity-cli',
          models: agyModels,
          defaultModelId: 'gemini-3.8-flash-high',
          desc: `本地 Antigravity CLI (${status.version || 'v1.5.3'})`,
        };

        const nextProviders = [...st.providers];
        const existingIdx = nextProviders.findIndex((p) => p.id === 'antigravity-cli');
        if (existingIdx >= 0) nextProviders[existingIdx] = agyProvider;
        else nextProviders.unshift(agyProvider);

        this.settingsStore.setProviders(nextProviders);

        if (
          st.currentProviderId === 'gemini' ||
          (st.currentProviderId === 'deepseek' && !nextProviders.find((p) => p.id === 'deepseek')?.apiKey)
        ) {
          this.settingsStore.setActiveModel({
            providerId: 'antigravity-cli',
            modelId: 'gemini-3.8-flash-high',
            label: 'Gemini 3.8 Flash (High)',
            reasoningEffort: 'high',
          });
        }
      } else {
        this.antigravityCliAvailable = false;
        this.antigravityCliInfo = null;
        const filtered = st.providers.filter((p) => p.id !== 'antigravity-cli');
        if (filtered.length !== st.providers.length) {
          this.settingsStore.setProviders(filtered);
        }
        if (st.currentProviderId === 'antigravity-cli') {
          this.settingsStore.setActiveModel({
            providerId: 'baigong',
            modelId: 'ybg-youlaber-ds4f',
            label: 'YoulabberLocal Flash High',
            reasoningEffort: 'high',
          });
        }
      }
    } catch {
      this.antigravityCliAvailable = false;
      this.antigravityCliInfo = null;
    }

    this.renderModelDropdown();
  }

  private bindModelAndPermissionControls(): void {
    const modelPill = document.getElementById('harness-model-selector');
    const modelDropdown = document.getElementById('harness-model-dropdown');
    const permPill = document.getElementById('harness-permission-selector');
    const permDropdown = document.getElementById('harness-permission-dropdown');

    if (modelPill && modelDropdown) {
      modelPill.addEventListener('click', (e) => {
        e.stopPropagation();
        const willShow = !modelDropdown.classList.contains('show');
        this.closeAllPopovers();
        if (willShow) modelDropdown.classList.add('show');
      });
      this.renderModelDropdown();
    }

    if (permPill && permDropdown) {
      permPill.addEventListener('click', (e) => {
        e.stopPropagation();
        const willShow = !permDropdown.classList.contains('show');
        this.closeAllPopovers();
        if (willShow) permDropdown.classList.add('show');
      });

      permDropdown.querySelectorAll<HTMLElement>('.harness-perm-option').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const mode = btn.dataset.permMode as AgentPermissionMode | undefined;
          if (mode) {
            this.settingsStore.setPermissionMode(mode);
            permDropdown.classList.remove('show');
          }
        });
      });
    }

    const modePill = document.querySelector('.harness-mode-pill');
    modePill?.addEventListener('click', () => {
      if (this.currentMode === 'Turbo') this.currentMode = 'Balanced';
      else if (this.currentMode === 'Balanced') this.currentMode = 'Deep Thinking';
      else this.currentMode = 'Turbo';
      const span = modePill.querySelector('span:nth-child(2)');
      if (span) span.textContent = this.currentMode;
    });
  }

  private renderModelDropdown(): void {
    const dropdown = document.getElementById('harness-model-dropdown');
    if (!dropdown) return;

    const st = this.settingsStore.getState();
    let html = `<div class="harness-popover__head"><span>选择推理模型</span><span class="harness-popover__hint">Esc 关闭</span></div><div class="harness-popover__list">`;

    if (this.antigravityCliAvailable) {
      const agyProv = st.providers.find((p) => p.id === 'antigravity-cli');
      if (agyProv && agyProv.models.length > 0) {
        html += `<div class="harness-model-group-title">Antigravity CLI (本地智能体)</div>`;
        for (const m of agyProv.models) {
          const isActive = st.currentProviderId === 'antigravity-cli' && st.currentModelId === m.id;
          const badgeClass =
            m.id === 'gemini-3.8-flash-high'
              ? 'harness-model-item-badge harness-badge-accent'
              : 'harness-model-item-badge';
          const badgeText =
            m.badge ||
            (m.reasoningEffort === 'max'
              ? '极限推导'
              : m.reasoningEffort === 'high'
                ? '深度推导'
                : '快速响应');
          html += `
            <div class="harness-model-item ${isActive ? 'active' : ''}" data-provider="antigravity-cli" data-model="${this.escapeHtml(m.id)}" data-label="${this.escapeHtml(m.name)}" data-reasoning="${this.escapeHtml(m.reasoningEffort || 'high')}">
              <span class="harness-model-item-name">${this.escapeHtml(m.name)}</span>
              <span class="${badgeClass}">${this.escapeHtml(badgeText)}</span>
            </div>
          `;
        }
      }
    }

    for (const prov of st.providers) {
      if (prov.id === 'antigravity-cli' || prov.isAccount || prov.models.length === 0) continue;
      if (prov.id !== 'baigong' && !prov.apiKey) continue;
      html += `<div class="harness-model-group-title">${this.escapeHtml(prov.displayName)}${prov.id === 'baigong' ? ' (校园免费)' : ''}</div>`;
      for (const m of prov.models) {
        const isActive = st.currentProviderId === prov.id && st.currentModelId === m.id;
        const badgeClass =
          prov.id === 'baigong' && m.id === 'ybg-youlaber-ds4f'
            ? 'harness-model-item-badge harness-badge-accent'
            : 'harness-model-item-badge';
        const badgeText =
          prov.id === 'baigong' && m.id === 'ybg-youlaber-ds4f'
            ? '校内免费'
            : m.desc
              ? m.desc.slice(0, 6)
              : m.reasoningEffort || '标准';
        html += `
          <div class="harness-model-item ${isActive ? 'active' : ''}" data-provider="${this.escapeHtml(prov.id)}" data-model="${this.escapeHtml(m.id)}" data-label="${this.escapeHtml(m.name)}" data-reasoning="${this.escapeHtml(m.reasoningEffort || 'off')}">
            <span class="harness-model-item-name">${this.escapeHtml(m.name)}</span>
            <span class="${badgeClass}">${this.escapeHtml(badgeText)}</span>
          </div>
        `;
      }
    }

    html += `
      <div class="harness-model-dropdown-divider"></div>
      <div class="harness-model-item harness-model-item--manage" id="harness-menu-manage-providers">
        <span class="material-symbols-outlined" style="font-size:16px;">tune</span>
        <span>在设置中心管理模型与工具...</span>
      </div>
    </div>`;

    dropdown.innerHTML = html;

    dropdown
      .querySelectorAll('.harness-model-item:not(.harness-model-item--manage)')
      .forEach((item) => {
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          const dataset = (item as HTMLElement).dataset;
          this.settingsStore.setActiveModel({
            providerId: dataset.provider || 'baigong',
            modelId: dataset.model || 'ybg-youlaber-ds4f',
            label: dataset.label || 'YoulabberLocal Flash High',
            reasoningEffort: dataset.reasoning || 'high',
          });
          dropdown.classList.remove('show');
        });
      });

    document.getElementById('harness-menu-manage-providers')?.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.classList.remove('show');
      this.openGlobalSettings('models');
    });
  }

  private bindInspectorTabs(): void {
    document.querySelectorAll('.harness-tab-item').forEach((tab) => {
      tab.addEventListener('click', () => {
        const target = (tab as HTMLElement).dataset.tab as 'catalog' | 'artifacts' | 'terminal';
        if (target) this.switchInspectorTab(target);
      });
    });

    const searchInput = document.getElementById('harness-catalog-search') as HTMLInputElement | null;
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        this.renderCatalogNavigator(searchInput.value);
      });
    }
  }

  public switchInspectorTab(target: 'catalog' | 'artifacts' | 'terminal'): void {
    this.activeTab = target;
    const inspector = document.getElementById('harness-inspector-stage');
    if (inspector && inspector.classList.contains('collapsed')) {
      inspector.classList.remove('collapsed');
    }

    document.querySelectorAll('.harness-tab-item').forEach((t) => {
      t.classList.toggle('active', (t as HTMLElement).dataset.tab === target);
    });

    const paneCatalog = document.getElementById('harness-pane-catalog');
    const paneArtifacts = document.getElementById('harness-pane-artifacts');
    const paneTerminal = document.getElementById('harness-pane-terminal');

    if (paneCatalog) paneCatalog.style.display = target === 'catalog' ? 'flex' : 'none';
    if (paneArtifacts) paneArtifacts.style.display = target === 'artifacts' ? 'flex' : 'none';
    if (paneTerminal) paneTerminal.style.display = target === 'terminal' ? 'block' : 'none';

    if (target === 'artifacts' && paneArtifacts) {
      this.artifactHubPanel?.mount(paneArtifacts);
    }

    if (target === 'terminal') {
      void this.ensureTerminalInitialized().then(() => {
        setTimeout(() => {
          this.fitAddon?.fit();
          this.term?.focus();
        }, 50);
      });
    }
  }

  private async ensureTerminalInitialized(): Promise<void> {
    if (this.term) return;
    if (this.termInitPromise) return this.termInitPromise;
    this.termInitPromise = this.initTerminal();
    try {
      await this.termInitPromise;
    } finally {
      if (!this.term) this.termInitPromise = null;
    }
  }

  private async initTerminal(): Promise<void> {
    const termRoot = document.getElementById('harness-xterm-root');
    if (!termRoot || this.term) return;

    const [{ Terminal: XtermTerminal }, { FitAddon: XtermFitAddon }] = await Promise.all([
      import('@xterm/xterm'),
      import('@xterm/addon-fit'),
    ]);

    this.term = new XtermTerminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: 13,
      fontFamily: 'Consolas, "Fira Code", monospace',
      theme: {
        background: '#121214',
        foreground: '#e4e4e7',
        cursor: '#3b82f6',
        selectionBackground: 'rgba(59, 130, 246, 0.3)',
      },
    });

    this.fitAddon = new XtermFitAddon();
    this.term.loadAddon(this.fitAddon);
    this.term.open(termRoot);
    this.fitAddon.fit();

    this.term.writeln('\x1b[36m┌────────────────────────────────────────────────────────┐\x1b[0m');
    this.term.writeln('\x1b[36m│\x1b[0m  \x1b[1;32mAstroLib Agent Interactive Terminal\x1b[0m                  \x1b[36m│\x1b[0m');
    this.term.writeln('\x1b[36m│\x1b[0m  Type \x1b[33mhelp\x1b[0m for commands or run \x1b[33mbooks\x1b[0m, \x1b[33mexercises <q>\x1b[0m   \x1b[36m│\x1b[0m');
    this.term.writeln('\x1b[36m└────────────────────────────────────────────────────────┘\x1b[0m');
    this.promptTerminal();

    this.term.onData((data) => {
      const code = data.charCodeAt(0);
      if (code === 13) {
        this.term?.writeln('');
        const cmd = this.termInputBuffer.trim();
        if (cmd) {
          this.termHistory.push(cmd);
          void this.handleTerminalCommandInput(cmd);
        } else {
          this.promptTerminal();
        }
        this.termInputBuffer = '';
      } else if (code === 127 || code === 8) {
        if (this.termInputBuffer.length > 0) {
          this.termInputBuffer = this.termInputBuffer.slice(0, -1);
          this.term?.write('\b \b');
        }
      } else if (code === 3) {
        this.term?.writeln('^C');
        this.termInputBuffer = '';
        this.promptTerminal();
      } else if (code >= 32 && code <= 126) {
        this.termInputBuffer += data;
        this.term?.write(data);
      }
    });
  }

  private promptTerminal(): void {
    this.term?.write('\r\n\x1b[1;34mastrolib>\x1b[0m ');
  }

  private async handleTerminalCommandInput(cmd: string): Promise<void> {
    const parts = cmd.split(/\s+/);
    const action = parts[0].toLowerCase();
    const args = parts.slice(1);

    if (action === 'help' || action === '?') {
      this.term?.writeln('\x1b[1mAvailable Commands:\x1b[0m');
      this.term?.writeln('  \x1b[33mbooks\x1b[0m                       列出本地所有源教材');
      this.term?.writeln('  \x1b[33mtoc <col> <book>\x1b[0m            查看指定图书的大纲树');
      this.term?.writeln('  \x1b[33mchapter <col> <book> <slug>\x1b[0m 提取指定章节 AST 结构');
      this.term?.writeln('  \x1b[33mexercises <keyword>\x1b[0m         检索习题与官方题解');
      this.term?.writeln('  \x1b[33mclear\x1b[0m                       清空控制台');
      this.promptTerminal();
      return;
    }

    if (action === 'clear') {
      this.term?.clear();
      this.promptTerminal();
      return;
    }

    if (action === 'books') {
      try {
        const res = await fetch('/api/v1/content/books');
        const json = await res.json();
        const list = json.data || [];
        this.term?.writeln(`\x1b[32mFound ${list.length} textbooks in library:\x1b[0m`);
        for (const b of list) {
          this.term?.writeln(`  - [${b.colSlug}] \x1b[1m${b.title}\x1b[0m (${b.slug})`);
        }
      } catch (err: any) {
        this.term?.writeln(`\x1b[31mError: ${err.message}\x1b[0m`);
      }
      this.promptTerminal();
      return;
    }

    if (action === 'exercises') {
      const q = args.join(' ') || '行列式';
      try {
        const res = await fetch(`/api/v1/content/exercises/search?q=${encodeURIComponent(q)}&limit=3`);
        const json = await res.json();
        const list = json.data || [];
        this.term?.writeln(`\x1b[32mMatched ${list.length} exercises for "${q}":\x1b[0m`);
        for (const ex of list) {
          this.term?.writeln(`  \x1b[33m[${ex.id}]\x1b[0m ${ex.stem?.slice(0, 60)}...`);
        }
      } catch (err: any) {
        this.term?.writeln(`\x1b[31mError: ${err.message}\x1b[0m`);
      }
      this.promptTerminal();
      return;
    }

    try {
      this.term?.writeln('\x1b[90mExecuting via astrolib-cli backend...\x1b[0m');
      const res = await fetch('/api/v1/content/cli', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd }),
      });
      const result = await res.json();
      if (result.stdout) this.term?.write(result.stdout.replace(/\n/g, '\r\n'));
      if (result.stderr) this.term?.write('\x1b[31m' + result.stderr.replace(/\n/g, '\r\n') + '\x1b[0m');
    } catch (err: any) {
      this.term?.writeln(`\x1b[31mExecution failed: ${err.message}\x1b[0m`);
    }

    this.promptTerminal();
  }

  private async preloadBooksCatalog(): Promise<void> {
    try {
      const [booksRes, papersRes] = await Promise.all([
        fetch('/api/v1/content/books'),
        fetch('/api/v1/content/knowledge/items?kind=paper').catch(() => null),
      ]);
      const json = await booksRes.json();
      this.cachedBooks = json.data || [];
      if (papersRes && papersRes.ok) {
        const pJson = await papersRes.json().catch(() => null);
        if (pJson && Array.isArray(pJson.data)) {
          this.cachedPapers = pJson.data;
        }
      }
      UniversalLocatorResolver.updateIndex(this.cachedBooks);
      this.renderCatalogNavigator();
      this.scheduleChaptersPreload();
    } catch {}
  }

  private scheduleChaptersPreload(): void {
    if (this.chaptersPreloadStarted) return;
    const run = () => {
      void this.preloadChaptersIndex();
    };
    const w = window as any;
    if (typeof w.requestIdleCallback === 'function') {
      w.requestIdleCallback(run, { timeout: 600 });
    } else {
      setTimeout(run, 180);
    }
  }

  private async preloadChaptersIndex(): Promise<void> {
    if (this.chaptersPreloadStarted || this.cachedBooks.length === 0) return;
    this.chaptersPreloadStarted = true;

    const chapters: any[] = [];
    const BATCH_SIZE = 4;

    const extractBookChapters = async (b: any) => {
      try {
        const res = await fetch(
          `/api/v1/content/books/${encodeURIComponent(b.colSlug)}/${encodeURIComponent(b.slug)}/toc`
        );
        const json = await res.json();
        const catalog = json.data?.catalog || [];
        const walkNodes = (nodes: any[]) => {
          for (const node of nodes) {
            if (node.type === 'chapter') {
              const chSlug = (node.slug || '')
                .replace(/^collections\/[^/]+\/[^/]+\//, '')
                .replace(/\.(mdx|md)$/i, '');
              chapters.push({
                colSlug: b.colSlug,
                bookSlug: b.slug,
                bookTitle: b.title,
                chapterSlug: chSlug,
                chapterTitle: node.title || chSlug,
                filePath: node.filePath,
              });
            } else if (node.type === 'group' && Array.isArray(node.children)) {
              walkNodes(node.children);
            }
          }
        };
        walkNodes(catalog);
      } catch {}
    };

    for (let i = 0; i < this.cachedBooks.length; i += BATCH_SIZE) {
      await Promise.all(this.cachedBooks.slice(i, i + BATCH_SIZE).map(extractBookChapters));
    }

    if (chapters.length > 0) {
      this.cachedChapters = chapters;
      UniversalLocatorResolver.updateIndex(this.cachedBooks, chapters);
      const searchEl = document.getElementById('harness-catalog-search') as HTMLInputElement | null;
      this.renderCatalogNavigator(searchEl?.value || '');
    }
  }

  private buildBookChaptersHtml(colSlug: string, bookSlug: string, chapters: any[]): string {
    if (chapters.length === 0) {
      return '<div style="padding: 6px 10px; font-size: 0.75rem; color: var(--harness-text-tertiary);">暂无章节或正在读取...</div>';
    }
    let html = '';
    for (const ch of chapters) {
      const uri = `astrolib://${colSlug}/${bookSlug}/${ch.chapterSlug}`;
      html += `
        <div class="harness-catalog-chapter" data-uri="${this.escapeHtml(uri)}" title="${this.escapeHtml(uri)}">
          <span class="harness-catalog-chapter__name">${this.escapeHtml(ch.chapterTitle)}</span>
          <div class="harness-catalog-chapter__actions">
            <button type="button" class="harness-catalog-insert-btn" data-action="insert-scheme" data-uri="${this.escapeHtml(uri)}" title="将 astrolib:// 定位写入输入框">
              <span>写入</span>
            </button>
            <button type="button" class="harness-catalog-insert-btn" data-action="read-node" data-uri="${this.escapeHtml(uri)}" title="在研读视窗打开该章节">
              <span>阅读</span>
            </button>
          </div>
        </div>
      `;
    }
    return html;
  }

  private buildPaperSectionsHtml(paperUri: string, sections: any[]): string {
    if (!sections || sections.length === 0) {
      return `<div class="harness-catalog-chapter" data-uri="${this.escapeHtml(paperUri)}">
        <span class="harness-catalog-chapter__name">全文首页</span>
        <div class="harness-catalog-chapter__actions">
          <button type="button" class="harness-catalog-insert-btn" data-action="insert-scheme" data-uri="${this.escapeHtml(paperUri)}"><span>写入</span></button>
          <button type="button" class="harness-catalog-insert-btn" data-action="read-node" data-uri="${this.escapeHtml(paperUri)}"><span>阅读</span></button>
        </div>
      </div>`;
    }
    const flat: any[] = [];
    const walk = (nodes: any[], prefix = '') => {
      for (const n of nodes) {
        flat.push({ ...n, displayTitle: prefix ? `${prefix}${n.title}` : n.title });
        if (Array.isArray(n.children) && n.children.length > 0) {
          walk(n.children, `${prefix}  `);
        }
      }
    };
    walk(sections);

    return flat
      .map((sec) => {
        const uri = sec.uri || `${paperUri}/${sec.id}`;
        const pageStr = sec.pageRange ? ` (${sec.pageRange})` : '';
        return `
          <div class="harness-catalog-chapter" data-uri="${this.escapeHtml(uri)}" title="${this.escapeHtml(uri)}">
            <span class="harness-catalog-chapter__name">${this.escapeHtml(sec.displayTitle)}${this.escapeHtml(pageStr)}</span>
            <div class="harness-catalog-chapter__actions">
              <button type="button" class="harness-catalog-insert-btn" data-action="insert-scheme" data-uri="${this.escapeHtml(uri)}" title="将 astrolib:// 定位写入输入框">
                <span>写入</span>
              </button>
              <button type="button" class="harness-catalog-insert-btn" data-action="read-node" data-uri="${this.escapeHtml(uri)}" title="在研读视窗打开该文献">
                <span>阅读</span>
              </button>
            </div>
          </div>
        `;
      })
      .join('');
  }

  private async loadPaperOutlineInto(paperUri: string, chaptersEl: HTMLElement): Promise<void> {
    if (!this.paperOutlines.has(paperUri)) {
      chaptersEl.innerHTML =
        '<div style="padding: 6px 10px; font-size: 0.75rem; color: var(--harness-text-tertiary);">正在解析文献结构大纲...</div>';
      try {
        const res = await fetch(`/api/v1/content/knowledge/outline?uri=${encodeURIComponent(paperUri)}`);
        const json = await res.json();
        this.paperOutlines.set(paperUri, json.data?.outline || []);
      } catch {
        this.paperOutlines.set(paperUri, []);
      }
    }
    const outline = this.paperOutlines.get(paperUri) || [];
    chaptersEl.innerHTML = this.buildPaperSectionsHtml(paperUri, outline);
    chaptersEl.dataset.chaptersRendered = 'true';
  }

  private bindCatalogDelegation(treeEl: HTMLElement): void {
    if (treeEl.dataset.catalogDelegated === 'true') return;
    treeEl.dataset.catalogDelegated = 'true';

    treeEl.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;

      const paperHeader = target.closest('[data-action="toggle-paper"]') as HTMLElement | null;
      if (paperHeader) {
        const bookEl = paperHeader.closest('.harness-catalog-book') as HTMLElement | null;
        const chaptersEl = bookEl?.querySelector('.harness-catalog-chapters') as HTMLElement | null;
        if (!bookEl || !chaptersEl) return;

        const paperUri = bookEl.dataset.paperUri || '';
        const isCurrentlyExpanded = bookEl.classList.contains('expanded');
        if (isCurrentlyExpanded) {
          bookEl.classList.remove('expanded');
          this.expandedPaperIds.delete(paperUri);
          chaptersEl.style.display = 'none';
        } else {
          bookEl.classList.add('expanded');
          this.expandedPaperIds.add(paperUri);
          chaptersEl.style.display = 'flex';
          if (chaptersEl.dataset.chaptersRendered !== 'true' && paperUri) {
            void this.loadPaperOutlineInto(paperUri, chaptersEl);
          }
        }
        return;
      }

      const quickUriBtn = target.closest('[data-action="insert-paper-uri"]') as HTMLElement | null;
      if (quickUriBtn) {
        e.stopPropagation();
        const uri = quickUriBtn.dataset.uri;
        if (uri) this.insertSchemeToInput(uri);
        return;
      }

      const header = target.closest('[data-action="toggle-book"]') as HTMLElement | null;
      if (header) {
        const bookEl = header.closest('.harness-catalog-book') as HTMLElement | null;
        const chaptersEl = bookEl?.querySelector('.harness-catalog-chapters') as HTMLElement | null;
        if (!bookEl || !chaptersEl) return;

        const bookSlug = bookEl.dataset.bookSlug || '';
        const colSlug = bookEl.dataset.colSlug || '';
        const isCurrentlyExpanded = bookEl.classList.contains('expanded');
        if (isCurrentlyExpanded) {
          bookEl.classList.remove('expanded');
          this.expandedBookSlugs.delete(bookSlug);
          chaptersEl.style.display = 'none';
        } else {
          bookEl.classList.add('expanded');
          this.expandedBookSlugs.add(bookSlug);
          if (chaptersEl.dataset.chaptersRendered !== 'true') {
            if (!this.chaptersPreloadStarted) void this.preloadChaptersIndex();
            const bookChapters = this.cachedChapters.filter(
              (c) => c.bookSlug === bookSlug && c.colSlug === colSlug
            );
            chaptersEl.innerHTML = this.buildBookChaptersHtml(colSlug, bookSlug, bookChapters);
            chaptersEl.dataset.chaptersRendered = 'true';
          }
          chaptersEl.style.display = 'flex';
        }
        return;
      }

      const row = target.closest('.harness-catalog-chapter') as HTMLElement | null;
      if (!row) return;
      const uri = row.dataset.uri;
      if (!uri) return;

      if (target.closest('[data-action="read-node"]')) {
        e.stopPropagation();
        const parsed = parseAstrolibUri(uri);
        if (parsed) {
          window.dispatchEvent(new CustomEvent('astrolib:navigate-node', { detail: parsed }));
        }
        return;
      }

      e.stopPropagation();
      this.insertSchemeToInput(uri);
    });
  }

  public renderCatalogNavigator(filterQuery = ''): void {
    const treeEl = document.getElementById('harness-catalog-tree');
    if (!treeEl) return;

    this.bindCatalogDelegation(treeEl);

    if (filterQuery.trim() && !this.chaptersPreloadStarted) {
      void this.preloadChaptersIndex();
    }

    if (this.cachedBooks.length === 0 && this.cachedPapers.length === 0) {
      treeEl.innerHTML = '<div class="harness-catalog-loading">正在载入教材与文献库全量目录...</div>';
      return;
    }

    const q = filterQuery.trim().toLowerCase();
    let booksHtml = '';

    for (const b of this.cachedBooks) {
      const bookChapters = this.cachedChapters.filter(
        (c) => c.bookSlug === b.slug && c.colSlug === b.colSlug
      );
      const matchedChapters = q
        ? bookChapters.filter(
            (c) =>
              c.chapterTitle.toLowerCase().includes(q) || c.chapterSlug.toLowerCase().includes(q)
          )
        : bookChapters;
      const bookMatches =
        !q ||
        b.title.toLowerCase().includes(q) ||
        b.slug.toLowerCase().includes(q) ||
        matchedChapters.length > 0;
      if (!bookMatches) continue;

      const isExpanded = q.length > 0 || this.expandedBookSlugs.has(b.slug);
      const displayedChapters = q ? matchedChapters : bookChapters;
      const fmtTag = b.sourceFormat === 'epub' ? 'EPUB' : b.sourceFormat === 'abp' ? 'ABP' : '';

      booksHtml += `
        <div class="harness-catalog-book ${isExpanded ? 'expanded' : ''}" data-book-slug="${this.escapeHtml(b.slug)}" data-col-slug="${this.escapeHtml(b.colSlug)}">
          <div class="harness-catalog-book__header" data-action="toggle-book">
            <div class="harness-catalog-book__title">
              <span class="material-symbols-outlined" style="font-size:16px;flex-shrink:0;" aria-hidden="true">${b.sourceFormat === 'epub' ? 'auto_stories' : 'menu_book'}</span>
              <span>《${this.escapeHtml(b.title)}》</span>
            </div>
            <div style="display:flex;align-items:center;gap:4px;flex-shrink:0;">
              ${fmtTag ? `<span class="harness-catalog-format-tag">${fmtTag}</span>` : ''}
              <span class="harness-catalog-book__badge">${displayedChapters.length || bookChapters.length} 节</span>
            </div>
          </div>
          <div class="harness-catalog-chapters" style="${isExpanded ? 'display: flex;' : 'display: none;'}" data-chapters-rendered="${isExpanded ? 'true' : 'false'}">
            ${isExpanded ? this.buildBookChaptersHtml(b.colSlug, b.slug, displayedChapters) : ''}
          </div>
        </div>
      `;
    }

    let papersHtml = '';
    const matchedPapers = this.cachedPapers.filter((p) => {
      if (!q) return true;
      return (
        (p.title || '').toLowerCase().includes(q) ||
        (p.slug || '').toLowerCase().includes(q) ||
        (p.publisher || '').toLowerCase().includes(q)
      );
    });

    for (const p of matchedPapers) {
      const isExpanded = this.expandedPaperIds.has(p.uri);
      const cachedOutline = this.paperOutlines.get(p.uri);
      papersHtml += `
        <div class="harness-catalog-book ${isExpanded ? 'expanded' : ''}" data-paper-uri="${this.escapeHtml(p.uri)}">
          <div class="harness-catalog-book__header" data-action="toggle-paper">
            <div class="harness-catalog-book__title">
              <span class="material-symbols-outlined" style="font-size:16px;flex-shrink:0;" aria-hidden="true">article</span>
              <span title="${this.escapeHtml(p.title)}">${this.escapeHtml(p.title)}</span>
            </div>
            <div style="display:flex;align-items:center;gap:4px;flex-shrink:0;">
              <button type="button" class="harness-catalog-insert-btn" data-action="insert-paper-uri" data-uri="${this.escapeHtml(p.uri)}" title="将文献 URI 写入对话框">写入</button>
              <span class="harness-catalog-book__badge">${p.sectionCount ? `${p.sectionCount} 节` : `${p.pageCount || '?'} 页`}</span>
            </div>
          </div>
          <div class="harness-catalog-chapters" style="${isExpanded ? 'display: flex;' : 'display: none;'}" data-chapters-rendered="${cachedOutline ? 'true' : 'false'}">
            ${isExpanded && cachedOutline ? this.buildPaperSectionsHtml(p.uri, cachedOutline) : ''}
          </div>
        </div>
      `;
    }

    let finalHtml = '';
    if (booksHtml) {
      finalHtml += `<div class="harness-catalog-group-label">教材与电子书 (${this.cachedBooks.length})</div>${booksHtml}`;
    }
    if (papersHtml) {
      finalHtml += `<div class="harness-catalog-group-label">学术文献 (${matchedPapers.length})</div>${papersHtml}`;
    }

    treeEl.innerHTML =
      finalHtml ||
      `<div class="harness-catalog-loading">未检索到与 "${this.escapeHtml(q)}" 匹配的书籍或文献</div>`;
  }

  public insertSchemeToInput(uri: string): void {
    const textarea = document.getElementById('harness-input-textarea') as HTMLTextAreaElement | null;
    if (!textarea) return;
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? textarea.value.length;
    const val = textarea.value;
    const needsSpaceBefore = start > 0 && !/\s$/.test(val.slice(0, start));
    const insertText = `${needsSpaceBefore ? ' ' : ''}${uri} `;
    textarea.value = val.slice(0, start) + insertText + val.slice(end);
    textarea.focus();
    const newPos = start + insertText.length;
    textarea.setSelectionRange(newPos, newPos);

    window.dispatchEvent(
      new CustomEvent('astrolib:show-snackbar', {
        detail: { message: `已将规范定位 ${uri} 写入对话框` },
      })
    );
  }

  private escapeHtml(str: string): string {
    return (str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

function renderPdf2AbpInlineCardPlaceholderWithJob(jobId: string): string {
  return `<div class="pdf2abp-inline-host" data-pdf2abp-inline="1" data-job-id="${jobId.replace(/"/g, '&quot;')}"></div>`;
}

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => HarnessController.init());
  } else {
    HarnessController.init();
  }
}
