/**
 * src/services/translation/client/translation-dock-controller.ts
 * ============================================================================
 * AstroLib 双语助读侧载面板前端交互控制器
 * ============================================================================
 * 核心交互：
 * 1. 扫描正文 DOM 提取段落，并在正文段落注入 data-trans-id 标记；
 * 2. 渲染右侧卡片流，实现【段落与段落之间严格 1:1 双向对应】；
 * 3. 支持 Google 翻译 (默认) 与 Google Gemini 学术翻译提供商实时切换；
 * 4. 驱动公式 KaTeX 实时排版，悬浮双向高亮与点击平滑定位滚动；
 * 5. 遵从 SideloadManager 状态机规范，支持 Esc 键与返回大纲闭环。
 * ============================================================================
 */

import { sideloadManagerContract as sideloadManager } from '../../../features/sideload/contract';
import { ParagraphAligner } from '../paragraph-aligner';
import {
  TranslationStorage,
  TRANSLATION_DISPLAY_MODE_CHANGE_EVENT,
  TRANSLATION_PROVIDER_CHANGE_EVENT,
} from '../storage/translation-storage';
import { StructurePreservingMasker } from '../masker';
import type { ParagraphUnit, TranslationProviderId, TranslationExportFormat, TranslationDisplayMode } from '../types';
import { TranslationDrawerView } from './translation-drawer-view';
import { TranslationInlineView, renderMathInElementSafely } from './translation-inline-view';
import { TranslationDockStateMachine } from './translation-dock-controller.state';
import { AI_CONFIG_CHANGE_EVENT } from '../../../ai/ai-config';
import { getTypeLabel, escapeHtml, handleStartInlineEdit } from './translation-card-helpers';

export class TranslationDockController {
  private static instance: TranslationDockController | null = null;
  private isInitialized = false;

  private stateMachine = new TranslationDockStateMachine();

  public get currentProvider(): TranslationProviderId { return this.stateMachine.getProvider(); }
  public set currentProvider(p: TranslationProviderId) { this.stateMachine.setProvider(p); }

  public get displayMode(): TranslationDisplayMode { return this.stateMachine.getDisplayMode(); }
  public set displayMode(m: TranslationDisplayMode) { this.stateMachine.setDisplayMode(m); }

  private currentChapterKey: string = '';
  private paragraphs: ParagraphUnit[] = [];

  private get isTranslating(): boolean { return this.stateMachine.getStatus() === 'translating'; }
  private set isTranslating(val: boolean) {
    if (val) this.stateMachine.startTranslation();
    else this.stateMachine.finishTranslation();
  }

  private get selectedExportFormat(): TranslationExportFormat { return this.stateMachine.getSelectedExportFormat(); }
  private set selectedExportFormat(fmt: TranslationExportFormat) { this.stateMachine.setExportFormat(fmt); }

  private get selectedExportScope(): 'all' | 'satisfied' { return this.stateMachine.getSelectedExportScope(); }
  private set selectedExportScope(scope: 'all' | 'satisfied') { this.stateMachine.setExportScope(scope); }

  public getStateMachine(): TranslationDockStateMachine { return this.stateMachine; }

  private unbindSync: (() => void) | null = null;
  private abortController: AbortController | null = null;

  private drawerView = new TranslationDrawerView({
    getProvider: () => this.currentProvider,
    getDisplayMode: () => this.displayMode,
    getParagraphs: () => this.paragraphs,
    getSelectedExportFormat: () => this.selectedExportFormat,
    getSelectedExportScope: () => this.selectedExportScope,
    setSelectedExportFormat: (fmt) => { this.selectedExportFormat = fmt; },
    setSelectedExportScope: (scope) => { this.selectedExportScope = scope; },
    syncDisplayModeChips: () => this.syncDisplayModeChips(),
    updateCardBadges: (card, unit) => this.updateCardBadges(card, unit),
    handleToggleSatisfied: (unit, card) => this.handleToggleSatisfied(unit, card),
    startTranslation: (forceRefresh) => this.startTranslation(forceRefresh),
  });

  private inlineView = new TranslationInlineView({
    getProvider: () => this.currentProvider,
    setProvider: (p) => this.setProvider(p),
    getDisplayMode: () => this.displayMode,
    getParagraphs: () => this.paragraphs,
    setParagraphs: (p) => { this.paragraphs = p; },
    getCurrentChapterKey: () => this.currentChapterKey,
    setCurrentChapterKey: (key) => { this.currentChapterKey = key; },
    requestTranslation: (text, signal) => this.requestTranslation(text, signal),
    updateSatisfiedCountBadge: () => this.drawerView.updateSatisfiedCountBadge(),
    handleToggleSatisfied: (unit, card) => this.handleToggleSatisfied(unit, card),
    toggleSettingsDrawer: (open) => this.drawerView.toggleSettingsDrawer(open),
  });

  public get isInlineActive(): boolean {
    return this.inlineView.isInlineActive();
  }


  public static getInstance(): TranslationDockController {
    if (!this.instance) {
      this.instance = new TranslationDockController();
    }
    return this.instance;
  }

  public init(): void {
    if (this.isInitialized || typeof window === 'undefined') return;
    this.isInitialized = true;

    // 恢复用户上次选择的翻译提供商与呈现模式
    this.currentProvider = TranslationStorage.getProvider();
    this.displayMode = TranslationStorage.getDisplayMode();

    // 全局事件委托：绑定所有侧载操作、服务商切换、一键触发器
    document.addEventListener('click', (e) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      // 1. 返回大纲或关闭侧载栏
      if (target.closest('#trans-back-to-toc') || target.closest('#trans-sidebar-close')) {
        e.preventDefault();
        sideloadManager.switchToDefault();
        return;
      }

      // 2. 重新翻译本节 (侧边栏刷新按钮)
      if (target.closest('#trans-sidebar-refresh')) {
        e.preventDefault();
        if (this.displayMode === 'sidebar') {
          this.startTranslation(true);
        } else {
          this.showInlineTranslations(true);
        }
        return;
      }

      // 2.1 行内控制条：重新翻译全文
      if (target.closest('#trans-inline-refresh-btn')) {
        e.preventDefault();
        this.showInlineTranslations(true);
        return;
      }

      // 2.2 行内控制条：退出助读
      if (target.closest('#trans-inline-exit-btn')) {
        e.preventDefault();
        this.hideInlineTranslations();
        return;
      }

      // 2.3 行内控制条：就地切换翻译服务商
      const inlinePill = target.closest<HTMLButtonElement>('[data-inline-provider]');
      if (inlinePill) {
        e.preventDefault();
        const p = inlinePill.getAttribute('data-inline-provider') as TranslationProviderId | null;
        if (p && p !== this.currentProvider) {
          this.setProvider(p);
        }
        return;
      }

      // 3. 展开/折叠翻译设置抽屉
      if (target.closest('#trans-sidebar-settings')) {
        e.preventDefault();
        this.toggleSettingsDrawer();
        return;
      }

      // 4. 收起设置抽屉
      if (target.closest('#trans-settings-close')) {
        e.preventDefault();
        this.toggleSettingsDrawer(false);
        return;
      }

      // 5. 展开/折叠导出抽屉
      if (target.closest('#trans-sidebar-export')) {
        e.preventDefault();
        this.toggleExportDrawer();
        return;
      }

      // 6. 收起导出抽屉
      if (target.closest('#trans-export-close')) {
        e.preventDefault();
        this.toggleExportDrawer(false);
        return;
      }

      // 7. 执行下载导出
      if (target.closest('#trans-export-download')) {
        e.preventDefault();
        this.handleExportDownload();
        return;
      }

      // 8. 全部标为采纳
      if (target.closest('#trans-export-approve-all')) {
        e.preventDefault();
        this.handleMarkAllSatisfied();
        return;
      }

      // 9. 切换导出格式
      const fmtChip = target.closest<HTMLButtonElement>('[data-export-fmt]');
      if (fmtChip) {
        e.preventDefault();
        const fmt = fmtChip.getAttribute('data-export-fmt') as TranslationExportFormat;
        if (fmt) {
          this.selectedExportFormat = fmt;
          this.syncExportDrawerUI();
        }
        return;
      }

      // 10. 切换导出范围
      const scopeChip = target.closest<HTMLButtonElement>('[data-export-scope]');
      if (scopeChip) {
        e.preventDefault();
        const scope = scopeChip.getAttribute('data-export-scope') as 'all' | 'satisfied';
        if (scope) {
          this.selectedExportScope = scope;
          this.syncExportDrawerUI();
        }
        return;
      }

      // 11. 切换密码明文/掩码
      if (target.closest('#trans-key-toggle-eye')) {
        e.preventDefault();
        this.toggleKeyVisibility();
        return;
      }

      // 12. 保存密钥
      if (target.closest('#trans-settings-save')) {
        e.preventDefault();
        this.handleSaveKey();
        return;
      }

      // 13. 清空密钥
      if (target.closest('#trans-settings-clear')) {
        e.preventDefault();
        this.handleClearKey();
        return;
      }

      // 14. 打开系统全站 AI 偏好设置
      if (target.closest('#trans-settings-more')) {
        e.preventDefault();
        this.openFullAiSettings();
        return;
      }

      // 15. 切换翻译服务商 (Google / Gemini / BUPT DeepSeek)
      const chip = target.closest<HTMLButtonElement>('.trans-provider-chips [data-provider]');
      if (chip) {
        e.preventDefault();
        const targetProvider = chip.getAttribute('data-provider') as TranslationProviderId;
        if (targetProvider && targetProvider !== this.currentProvider) {
          this.setProvider(targetProvider);
        }
        return;
      }

      // 15.1 切换译文呈现方式 (侧边栏对照 vs 段落下方显示)
      const modeChip = target.closest<HTMLButtonElement>('[data-trans-mode]');
      if (modeChip) {
        e.preventDefault();
        const targetMode = modeChip.getAttribute('data-trans-mode') as TranslationDisplayMode | null;
        if (targetMode) {
          this.setDisplayMode(targetMode, true, true);
        }
        return;
      }

      // 16. 触发双语助读面板开关 (来自顶栏、正文芯片、本地导航等所有位置)
      const trigger = target.closest('[data-translation-trigger]');
      if (trigger) {
        e.preventDefault();
        this.handleTriggerClick();
        return;
      }
    });

    // 监听输入框实时校验
    document.addEventListener('input', (e) => {
      const target = e.target as HTMLElement | null;
      if (target && target.id === 'trans-api-key-input') {
        this.handleKeyInput((target as HTMLInputElement).value);
      }
    });

    // 回车保存
    document.addEventListener('keydown', (e) => {
      const target = e.target as HTMLElement | null;
      if (target && target.id === 'trans-api-key-input' && e.key === 'Enter') {
        e.preventDefault();
        this.handleSaveKey();
      }
    });

    // 监听全站 AI 设置变更事件联动
    window.addEventListener(AI_CONFIG_CHANGE_EVENT, () => {
      this.syncSettingsDrawerUI();
    });

    // 监听全局译文呈现方式变更事件
    window.addEventListener(TRANSLATION_DISPLAY_MODE_CHANGE_EVENT, (e: any) => {
      const mode = e?.detail?.mode;
      const forceTrigger = Boolean(e?.detail?.forceTrigger);
      if (mode && (mode === 'sidebar' || mode === 'inline')) {
        this.setDisplayMode(mode, false, forceTrigger);
      }
    });

    // 监听全局翻译服务商变更事件
    window.addEventListener(TRANSLATION_PROVIDER_CHANGE_EVENT, (e: any) => {
      const p = e?.detail?.provider as TranslationProviderId | undefined;
      if (p && p !== this.currentProvider) {
        this.setProvider(p);
      }
    });

    // 监听 SideloadManager 侧载状态事件
    window.addEventListener('astrolib:sideload-change', (e: any) => {
      const activeId = e?.detail?.activePanelId;
      if (activeId === 'translate') {
        if (this.displayMode === 'inline') {
          // 行内模式下严禁占用或影响右侧边栏，安全恢复默认大纲
          sideloadManager.switchToDefault();
          return;
        }
        this.onPanelActivated();
      }
    });

    // 页面切页路由跳转时重置段落状态与联动
    document.addEventListener('astro:page-load', () => {
      const newKey = TranslationStorage.normalizeKey();
      if (this.currentChapterKey !== newKey) {
        this.currentChapterKey = newKey;
        this.paragraphs = [];
        if (this.unbindSync) {
          this.unbindSync();
          this.unbindSync = null;
        }
      }
      this.syncDisplayModeChips();
      if (this.displayMode === 'sidebar') {
        if (sideloadManager.getActivePanelId() === 'translate') {
          this.onPanelActivated();
        }
      } else if (this.displayMode === 'inline') {
        if (this.isInlineActive) {
          this.showInlineTranslations();
        }
      }
    });

    // 快捷键: Alt+Y (译) 与 Alt+Shift+T 开启双语助读
    window.addEventListener('keydown', (e) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'MD-OUTLINED-TEXT-FIELD' || target.isContentEditable)) {
        return;
      }
      if (e.altKey && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 't'))) {
        e.preventDefault();
        this.handleTriggerClick();
      }
    });
  }

  public handleTriggerClick(): void {
    if (this.displayMode === 'sidebar') {
      this.openTranslationPanel();
    } else {
      this.toggleInlineTranslation();
    }
  }

  public openTranslationPanel(): void {
    if (this.displayMode === 'inline') {
      this.toggleInlineTranslation();
      return;
    }
    if (sideloadManager.getActivePanelId() === 'translate') {
      sideloadManager.switchToDefault();
    } else {
      sideloadManager.open('translate');
    }
  }

  public getDisplayMode(): TranslationDisplayMode {
    return this.displayMode;
  }

  public setDisplayMode(mode: TranslationDisplayMode, persist = true, forceTrigger = false): void {
    const isModeChanged = this.displayMode !== mode;
    this.displayMode = mode;
    if (persist) {
      TranslationStorage.setDisplayMode(mode);
    }
    this.syncDisplayModeChips();

    if (mode === 'inline') {
      // 切换至行内段落下显示：
      // 1. 若右侧边栏当前正处于 translate 面板，立即安全关闭并无条件退回大纲，保持右侧栏不受影响
      if (sideloadManager.getActivePanelId() === 'translate') {
        sideloadManager.switchToDefault();
      }
      // 2. 无论右侧栏当前为何种面板，只要进入 inline 模式且尚未呈现行内翻译，或者显式触发/模式变更，立即在正文呈现段落下对照翻译
      if (!this.isInlineActive || isModeChanged || forceTrigger) {
        this.showInlineTranslations();
      }
    } else if (mode === 'sidebar') {
      // 切换回侧边栏对照：
      // 1. 若正文中已有行内译文，清理行内译文并呼出右侧侧载栏
      if (this.isInlineActive) {
        this.hideInlineTranslations();
        sideloadManager.open('translate');
      } else if (forceTrigger) {
        sideloadManager.open('translate');
      }
    }
  }

  private syncDisplayModeChips(): void {
    document.querySelectorAll<HTMLButtonElement>('[data-trans-mode]').forEach((btn) => {
      const mode = btn.getAttribute('data-trans-mode');
      if (mode === this.displayMode) {
        btn.classList.add('is-active');
      } else {
        btn.classList.remove('is-active');
      }
    });
  }


  public toggleSettingsDrawer(open?: boolean): void {
    this.drawerView.toggleSettingsDrawer(open);
  }

  public toggleExportDrawer(open?: boolean): void {
    this.drawerView.toggleExportDrawer(open);
  }

  private syncExportDrawerUI(): void {
    this.drawerView.syncExportDrawerUI();
  }

  private updateSatisfiedCountBadge(): void {
    this.drawerView.updateSatisfiedCountBadge();
  }

  private handleExportDownload(): void {
    this.drawerView.handleExportDownload();
  }

  private handleMarkAllSatisfied(): void {
    this.drawerView.handleMarkAllSatisfied();
  }

  private toggleKeyVisibility(): void {
    this.drawerView.toggleKeyVisibility();
  }

  private syncSettingsDrawerUI(): void {
    this.drawerView.syncSettingsDrawerUI();
  }

  private handleKeyInput(val: string): void {
    this.drawerView.handleKeyInput(val);
  }

  private handleSaveKey(): void {
    this.drawerView.handleSaveKey();
  }

  private handleClearKey(): void {
    this.drawerView.handleClearKey();
  }

  private openFullAiSettings(): void {
    this.drawerView.openFullAiSettings();
  }

  private getEffectiveApiKey(): string | undefined {
    return this.drawerView.getEffectiveApiKey();
  }

  private onPanelActivated(): void {
    if (this.displayMode === 'inline') {
      sideloadManager.switchToDefault();
      return;
    }

    const panel = document.getElementById('trans-sidebar-panel');
    if (panel) {
      panel.setAttribute('aria-hidden', 'false');
    }

    this.syncProviderChips();
    this.syncDisplayModeChips();
    this.syncSettingsDrawerUI();
    this.updateSatisfiedCountBadge();

    // 若尚未加载段落或章节已更换，执行解析与翻译
    this.startTranslation(false);
  }


  private syncProviderChips(): void {
    document.querySelectorAll('.trans-provider-chips [data-provider]').forEach((el) => {
      const p = el.getAttribute('data-provider');
      if (p === this.currentProvider) {
        el.classList.add('is-active');
      } else {
        el.classList.remove('is-active');
      }
    });
    this.syncInlineToolbarUI();
  }

  public getProvider(): TranslationProviderId {
    return this.currentProvider;
  }

  public setProvider(provider: TranslationProviderId): void {
    if (this.currentProvider === provider && !this.isTranslating) return;
    this.currentProvider = provider;
    TranslationStorage.setProvider(provider);
    this.syncProviderChips();
    this.syncSettingsDrawerUI();
    this.syncInlineToolbarUI();

    // 根据当前呈现方式，重新发起翻译以新服务商刷新内容
    if (this.displayMode === 'sidebar') {
      if (sideloadManager.getActivePanelId() === 'translate') {
        this.startTranslation(true);
      }
    } else {
      if (this.isInlineActive) {
        this.showInlineTranslations(true);
      }
    }
  }

  public async startTranslation(forceRefresh = false): Promise<void> {
    if (this.isTranslating) {
      if (!forceRefresh) return;
      // 切换服务商或强制刷新时，立即终止进行中的上一次翻译
      if (this.abortController) {
        this.abortController.abort();
        this.abortController = null;
        this.stateMachine.abortTranslation();
      }
      this.isTranslating = false;
    }

    const contentContainer = document.querySelector<HTMLElement>('.sl-markdown-content') || document.querySelector<HTMLElement>('article');
    const dockContent = document.getElementById('trans-sidebar-content');
    const countBadge = document.getElementById('trans-para-count');
    const progressBar = document.getElementById('trans-progress-bar');
    const progressFill = document.getElementById('trans-progress-fill');

    if (!contentContainer || !dockContent) return;

    const chapterKey = TranslationStorage.normalizeKey();
    const hasTransIds = Boolean(contentContainer.querySelector('[data-trans-id]'));

    // 1. 扫描正文 DOM 提取段落
    if (this.currentChapterKey !== chapterKey || !hasTransIds || this.paragraphs.length === 0 || forceRefresh) {
      this.currentChapterKey = chapterKey;
      this.paragraphs = ParagraphAligner.extractFromArticleDom(contentContainer);
    }

    if (countBadge) {
      countBadge.textContent = `${this.paragraphs.length} 段`;
    }

    // 2. 本地持久化缓存回填 (Hydration)
    const { hydratedCount } = TranslationStorage.hydrateUnits(chapterKey, this.paragraphs);
    this.updateSatisfiedCountBadge();

    // 3. 渲染卡片骨架或已回填卡片
    this.renderSkeletonCards(dockContent, this.paragraphs);

    // 4. 绑定双向悬浮与定位联动
    if (this.unbindSync) this.unbindSync();
    this.unbindSync = ParagraphAligner.bindBidirectionalSync(contentContainer, dockContent);

    // 若非强制刷新，且所有段落均已从本地缓存瞬间回填完成，则实现 0 网络请求即时呈现
    if (!forceRefresh && hydratedCount === this.paragraphs.length && this.paragraphs.length > 0) {
      if (progressBar) progressBar.style.display = 'none';
      return;
    }

    this.isTranslating = true;
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    if (progressBar) progressBar.style.display = 'block';
    if (progressFill) {
      const initialPct = this.paragraphs.length > 0 ? Math.round((hydratedCount / this.paragraphs.length) * 100) : 10;
      progressFill.style.width = `${Math.max(10, initialPct)}%`;
    }

    // 5. 分块请求翻译端点 (/api/translate)
    let completedCount = hydratedCount;
    const total = this.paragraphs.length;
    const CHUNK_SIZE = 4;

    for (let i = 0; i < total; i += CHUNK_SIZE) {
      if (signal.aborted) break;
      const chunk = this.paragraphs.slice(i, i + CHUNK_SIZE);
      await Promise.all(
        chunk.map(async (unit) => {
          if (signal.aborted) return;

          // 严格跳过公式块与代码块的翻译
          if (unit.type === 'math' || unit.type === 'code') {
            unit.status = 'done';
            unit.translatedText = unit.sourceText;
            this.updateCardContent(dockContent, unit);
            return;
          }

          // 若非强制刷新且该段已回填完成，直接跳过请求
          if (!forceRefresh && unit.status === 'done' && unit.translatedText) {
            this.updateCardContent(dockContent, unit);
            return;
          }

          try {
            const res = await this.requestTranslation(unit.sourceText, signal);
            if (signal.aborted) return;

            if (res.ok && res.translatedText) {
              unit.translatedText = res.translatedText;
              unit.status = 'done';
              unit.provider = this.currentProvider;
              unit.error = undefined;
              TranslationStorage.saveUnit(chapterKey, unit);
            } else {
              unit.translatedText = unit.sourceText;
              unit.status = 'error';
              unit.error = res.error || '翻译失败';
              this.stateMachine.setError(unit.error);
            }
          } catch (err: any) {
            if (signal.aborted) {
              this.stateMachine.abortTranslation();
              return;
            }
            unit.translatedText = unit.sourceText;
            unit.status = 'error';
            unit.error = err?.message || '网络连接异常';
            this.stateMachine.setError(unit.error);
          }

          if (signal.aborted) return;
          completedCount++;
          // 局部更新卡片内容
          this.updateCardContent(dockContent, unit);

          if (progressFill) {
            const pct = Math.min(100, Math.round((completedCount / total) * 100));
            progressFill.style.width = `${pct}%`;
          }
        })
      );
    }

    // 整章完成批量持久化更新
    const chapterTitle = document.querySelector('h1')?.textContent?.trim() || document.title;
    TranslationStorage.saveChapter(chapterKey, this.paragraphs, chapterTitle);
    this.updateSatisfiedCountBadge();

    this.isTranslating = false;
    setTimeout(() => {
      if (progressBar) progressBar.style.display = 'none';
    }, 600);
  }

  private async retrySingleUnit(card: HTMLElement, unit: ParagraphUnit): Promise<void> {
    const targetElem = card.querySelector<HTMLElement>('.trans-target-text');
    if (targetElem) {
      targetElem.classList.add('trans-pulse-text');
      targetElem.innerHTML = `
        <div class="trans-skeleton-line"></div>
        <div class="trans-skeleton-line short"></div>
      `;
    }
    card.classList.remove('trans-card-error');

    try {
      const res = await this.requestTranslation(unit.sourceText);
      if (res.ok && res.translatedText) {
        unit.translatedText = res.translatedText;
        unit.status = 'done';
        unit.provider = this.currentProvider;
        unit.error = undefined;
        this.stateMachine.resetError();
        TranslationStorage.saveUnit(TranslationStorage.normalizeKey(), unit);
        this.updateSatisfiedCountBadge();
      } else {
        unit.status = 'error';
        unit.error = res.error || '翻译失败';
        this.stateMachine.setError(unit.error);
      }
    } catch (err: any) {
      unit.status = 'error';
      unit.error = err?.message || '网络连接异常';
      this.stateMachine.setError(unit.error);
    }

    const dockContent = document.getElementById('trans-sidebar-content');
    if (dockContent) {
      this.updateCardContent(dockContent, unit);
    }
  }

  /**
   * 统一翻译请求调度：采用纯客户端本地直连范式（对标 AI 解题与智能问答），
   * 由读者浏览器直接与大模型及翻译服务通信，零依赖易崩服务端，完全无状态本地执行。
   */
  private async requestTranslation(
    text: string,
    signal?: AbortSignal
  ): Promise<{ ok: boolean; translatedText?: string; error?: string }> {
    const apiKey = this.getEffectiveApiKey();

    // 1. 若为 Google 翻译（无需密钥即可直连）或用户已在本地配置了 API Key：
    // 优先采用纯客户端本地直连范式（对标 AI 解题与智能问答），
    // 由读者浏览器直接与服务商通信，零依赖服务端，彻底消除 Vercel Serverless Function 500 故障
    if (this.currentProvider === 'google' || apiKey) {
      const clientRes = await this.requestClientDirectTranslation(text, apiKey, signal);
      if (clientRes.ok) {
        return clientRes;
      }
      // 若客户端直连明确指出了鉴权或频控错误（如 Key 错误），直接呈现给用户
      if (clientRes.error && (clientRes.error.includes('鉴权失败') || clientRes.error.includes('频次受限'))) {
        return clientRes;
      }
    }

    // 2. 若本地未配置 API Key，或客户端直连因浏览器特殊网络受阻：
    // 尝试向全站统一服务端点发起请求（使用服务端环境变量 .env 兜底配置）
    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({
          text,
          provider: this.currentProvider,
          preserveStructure: true,
          ...(apiKey ? { apiKey } : {}),
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.ok && data.translatedText) {
          return { ok: true, translatedText: data.translatedText };
        }
      }
    } catch {
      // 服务端兜底不可达
    }

    // 3. 服务端若未配置或调用失败，向用户明确提示配置本地 API Key
    if (!apiKey && this.currentProvider !== 'google') {
      const providerNames: Record<string, string> = {
        zhipu: '智谱 GLM-4 (open.bigmodel.cn 免费获取)',
        gemini: 'Google Gemini (aistudio.google.com)',
        deepseek: 'DeepSeek (api.deepseek.com)',
        bupt: 'DeepSeek (北京邮电大学)',
      };
      const name = providerNames[this.currentProvider] || this.currentProvider;
      return {
        ok: false,
        error: `未配置 API Key，请在侧栏右上角设置中填写 ${name}`,
      };
    }

    return { ok: false, error: '翻译请求未成功，请检查网络或更换服务商' };
  }

  /**
   * 客户端本地直连翻译引擎（支持智谱 GLM-4、Google 翻译、Google Gemini、北邮 DeepSeek 等）
   * 100% 运行在读者本地浏览器，无状态、低延迟、零服务端瓶颈。
   */
  private async requestClientDirectTranslation(
    text: string,
    apiKey?: string,
    signal?: AbortSignal
  ): Promise<{ ok: boolean; translatedText?: string; error?: string }> {
    const provider = this.currentProvider;

    // 1. 智谱开放平台 GLM-4 (免费、国内免翻直连)
    if (provider === 'zhipu') {
      if (!apiKey) {
        return {
          ok: false,
          error: '未配置智谱 API Key，请在侧栏右上角设置中填写 (open.bigmodel.cn 免费获取)',
        };
      }

      try {
        const maskResult = StructurePreservingMasker.mask(text, false);
        const res = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            Authorization: `Bearer ${apiKey}`,
          },
          signal,
          body: JSON.stringify({
            model: 'glm-4-flash',
            temperature: 0.1,
            messages: [
              {
                role: 'system',
                content:
                  '你是一个无状态的高校教材纯文本翻译引擎。你的唯一任务是将输入的英文直接翻译为规范的简体中文。\n【核心铁律】：1. 严禁扩写，严禁添加任何解释；2. 严格 1:1 对等；3. 形如 ⟦ASTRO_TOK_N⟧ 的占位符必须原封不动保留；4. 仅输出翻译结果本身。',
              },
              {
                role: 'user',
                content: `请直接翻译以下英文内容为简体中文（严禁扩写、仅输出译文）：\n<source_text>\n${maskResult.maskedText}\n</source_text>`,
              },
            ],
          }),
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          let msg = `HTTP ${res.status}`;
          try {
            const j = JSON.parse(errText);
            if (j?.error?.message) msg = j.error.message;
          } catch {}
          if (res.status === 401) {
            return { ok: false, error: '智谱 API Key 鉴权失败，请检查密钥是否正确' };
          }
          if (res.status === 429) {
            return { ok: false, error: '智谱 API 请求频次受限 (429)，请稍后重试' };
          }
          return { ok: false, error: `智谱 API 异常 (${msg})` };
        }

        const data = await res.json();
        let content = data?.choices?.[0]?.message?.content;
        if (typeof content !== 'string') {
          return { ok: false, error: '智谱 API 未返回有效内容' };
        }

        content = this.cleanClientLlmOutput(content, text);

        if (maskResult.tokens.size > 0) {
          const unmasked = StructurePreservingMasker.unmask(content, maskResult.tokens);
          content = unmasked.restoredText;
        }

        return { ok: true, translatedText: content };
      } catch (err: any) {
        if (signal?.aborted) throw err;
        return { ok: false, error: err?.message || '智谱直连翻译失败' };
      }
    }

    // 2. Google Gemini (学术推理)
    if (provider === 'gemini') {
      if (!apiKey) {
        return {
          ok: false,
          error: '未配置 Gemini API Key，请在侧栏右上角设置中填写 (aistudio.google.com)',
        };
      }

      try {
        const maskResult = StructurePreservingMasker.mask(text, false);
        const endpoint =
          typeof import.meta !== 'undefined' && import.meta.env?.DEV
            ? '/api/proxy/gemini/v1beta/openai/chat/completions'
            : 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';

        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            Authorization: `Bearer ${apiKey}`,
          },
          signal,
          body: JSON.stringify({
            model: 'gemini-3.8-flash',
            temperature: 0.1,
            messages: [
              {
                role: 'system',
                content:
                  '你是一个无状态的高校教材纯文本翻译引擎。你的唯一任务是将输入的英文直接翻译为规范的简体中文。\n【核心铁律】：1. 严禁扩写，严禁添加任何解释；2. 严格 1:1 对等；3. 形如 ⟦ASTRO_TOK_N⟧ 的占位符必须原封不动保留；4. 仅输出翻译结果本身。',
              },
              {
                role: 'user',
                content: `请直接翻译以下英文内容为简体中文（严禁扩写、仅输出译文）：\n<source_text>\n${maskResult.maskedText}\n</source_text>`,
              },
            ],
          }),
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          let msg = `HTTP ${res.status}`;
          try {
            const j = JSON.parse(errText);
            if (j?.error?.message) msg = j.error.message;
          } catch {}
          return { ok: false, error: `Gemini API 异常 (${msg})` };
        }

        const data = await res.json();
        let content = data?.choices?.[0]?.message?.content;
        if (typeof content !== 'string') {
          return { ok: false, error: 'Gemini API 未返回有效内容' };
        }

        content = this.cleanClientLlmOutput(content, text);

        if (maskResult.tokens.size > 0) {
          const unmasked = StructurePreservingMasker.unmask(content, maskResult.tokens);
          content = unmasked.restoredText;
        }

        return { ok: true, translatedText: content };
      } catch (err: any) {
        if (signal?.aborted) throw err;
        return { ok: false, error: err?.message || 'Gemini 直连翻译失败' };
      }
    }

    // 3. 北京邮电大学「人人有算力」校内模型服务网关
    if (provider === 'bupt') {
      const endpoint =
        typeof import.meta !== 'undefined' && import.meta.env?.DEV
          ? '/api/proxy/bupt/chat/completions'
          : 'https://myai.bupt.edu.cn/llm-gw/v1/chat/completions';

      try {
        const maskResult = StructurePreservingMasker.mask(text, false);
        const headers: Record<string, string> = {
          'Content-Type': 'application/json; charset=utf-8',
        };
        if (apiKey) {
          headers['Authorization'] = `Bearer ${apiKey}`;
        }

        const res = await fetch(endpoint, {
          method: 'POST',
          headers,
          signal,
          body: JSON.stringify({
            model: 'deepseek-v4-flash',
            temperature: 0.1,
            messages: [
              {
                role: 'system',
                content:
                  '你是一个无状态的高校教材纯文本翻译引擎。你的唯一任务是将输入的英文直接翻译为规范的简体中文。\n【核心铁律】：1. 严禁扩写，严禁添加任何解释；2. 严格 1:1 对等；3. 形如 ⟦ASTRO_TOK_N⟧ 的占位符必须原封不动保留；4. 仅输出翻译结果本身。',
              },
              {
                role: 'user',
                content: `请直接翻译以下英文内容为简体中文（严禁扩写、仅输出译文）：\n<source_text>\n${maskResult.maskedText}\n</source_text>`,
              },
            ],
          }),
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          let msg = `HTTP ${res.status}`;
          try {
            const j = JSON.parse(errText);
            if (j?.error?.message) msg = j.error.message;
          } catch {}
          return { ok: false, error: `北邮校内网关异常 (${msg})` };
        }

        const data = await res.json();
        let content = data?.choices?.[0]?.message?.content;
        if (typeof content !== 'string') {
          return { ok: false, error: '北邮网关未返回有效内容' };
        }

        content = this.cleanClientLlmOutput(content, text);

        if (maskResult.tokens.size > 0) {
          const unmasked = StructurePreservingMasker.unmask(content, maskResult.tokens);
          content = unmasked.restoredText;
        }

        return { ok: true, translatedText: content };
      } catch (err: any) {
        if (signal?.aborted) throw err;
        return { ok: false, error: err?.message || '北邮校内网关直连失败' };
      }
    }

    // 4. DeepSeek 官方
    if (provider === 'deepseek') {
      if (!apiKey) {
        return {
          ok: false,
          error: '未配置 DeepSeek API Key，请在侧栏右上角设置中填写 (api.deepseek.com)',
        };
      }

      try {
        const maskResult = StructurePreservingMasker.mask(text, false);
        const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            Authorization: `Bearer ${apiKey}`,
          },
          signal,
          body: JSON.stringify({
            model: 'deepseek-chat',
            temperature: 0.1,
            messages: [
              {
                role: 'system',
                content:
                  '你是一个无状态的高校教材纯文本翻译引擎。你的唯一任务是将输入的英文直接翻译为规范的简体中文。\n【核心铁律】：1. 严禁扩写，严禁添加任何解释；2. 严格 1:1 对等；3. 形如 ⟦ASTRO_TOK_N⟧ 的占位符必须原封不动保留；4. 仅输出翻译结果本身。',
              },
              {
                role: 'user',
                content: `请直接翻译以下英文内容为简体中文（严禁扩写、仅输出译文）：\n<source_text>\n${maskResult.maskedText}\n</source_text>`,
              },
            ],
          }),
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          return { ok: false, error: `DeepSeek API 异常 (HTTP ${res.status}): ${errText.slice(0, 100)}` };
        }

        const data = await res.json();
        let content = data?.choices?.[0]?.message?.content;
        if (typeof content !== 'string') {
          return { ok: false, error: 'DeepSeek API 未返回有效内容' };
        }

        content = this.cleanClientLlmOutput(content, text);

        if (maskResult.tokens.size > 0) {
          const unmasked = StructurePreservingMasker.unmask(content, maskResult.tokens);
          content = unmasked.restoredText;
        }

        return { ok: true, translatedText: content };
      } catch (err: any) {
        if (signal?.aborted) throw err;
        return { ok: false, error: err?.message || 'DeepSeek 直连翻译失败' };
      }
    }

    // 5. Google 翻译 (客户端直连)
    if (provider === 'google') {
      // 模式 A: 官方 Google Cloud Translation API（若用户配置了 AIzaSy 密钥）
      if (apiKey && apiKey.startsWith('AIzaSy')) {
        try {
          const maskResult = StructurePreservingMasker.mask(text, false);
          const url = `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(apiKey)}`;
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            signal,
            body: JSON.stringify({ q: maskResult.maskedText, source: 'en', target: 'zh-CN', format: 'text' }),
          });
          if (res.ok) {
            const data = await res.json();
            let trans = data?.data?.translations?.[0]?.translatedText || '';
            if (trans) {
              if (maskResult.tokens.size > 0) {
                trans = StructurePreservingMasker.unmask(trans, maskResult.tokens).restoredText;
              }
              return { ok: true, translatedText: trans };
            }
          }
        } catch {}
      }

      // 模式 B: 客户端直连 Google Chrome 高速官方协议 (Access-Control-Allow-Origin: *，零配额无配置)
      try {
        const maskResult = StructurePreservingMasker.mask(text, false);
        const res = await fetch('https://clients5.google.com/translate_a/t?client=dict-chrome-ex', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
          },
          signal,
          body: new URLSearchParams({
            sl: 'en',
            tl: 'zh-CN',
            q: maskResult.maskedText,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          let trans = '';
          if (Array.isArray(data) && typeof data[0] === 'string') {
            trans = data.join('');
          } else if (Array.isArray(data) && Array.isArray(data[0])) {
            trans = data[0].filter((p: any) => typeof p === 'string').join('');
          }
          if (trans) {
            if (maskResult.tokens.size > 0) {
              trans = StructurePreservingMasker.unmask(trans, maskResult.tokens).restoredText;
            }
            return { ok: true, translatedText: trans };
          }
        }
      } catch (clientErr: any) {
        if (signal?.aborted) throw clientErr;
      }

      // 模式 C: 降级 GTX 协议
      try {
        const maskResult = StructurePreservingMasker.mask(text, false);
        const gtxUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=${encodeURIComponent(maskResult.maskedText)}`;
        const gtxRes = await fetch(gtxUrl, { signal });
        if (gtxRes.ok) {
          const gtxData = await gtxRes.json();
          let trans = (gtxData?.[0] || []).map((p: any) => p?.[0] || '').join('');
          if (trans) {
            if (maskResult.tokens.size > 0) {
              trans = StructurePreservingMasker.unmask(trans, maskResult.tokens).restoredText;
            }
            return { ok: true, translatedText: trans };
          }
        }
      } catch (gtxErr: any) {
        if (signal?.aborted) throw gtxErr;
      }

      return { ok: false, error: 'Google 翻译直连受阻，建议在顶栏切换为智谱 GLM-4 免费模型' };
    }

    return { ok: false, error: '未识别的翻译服务商' };
  }

  /**
   * 清洗模型输出，移除思考链、XML 边界与多余的 markdown 代码块包裹，防短标题扩写
   */
  private cleanClientLlmOutput(raw: string, sourceText = ''): string {
    let text = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    text = text.replace(/<\/?(?:source_text|text_to_translate|translation|translated_text)>/gi, '').trim();
    if (text.startsWith('```') && text.endsWith('```')) {
      text = text.replace(/^```(?:markdown|md|text)?\n([\s\S]*?)\n```$/i, '$1').trim();
    }
    text = text.replace(/^(?:好的[，,！!]?|以下是翻译[：:]?|翻译如下[：:]?|译文[：:]?)\s*/i, '').trim();

    const trimmedSource = sourceText.trim();
    const isSingleLine = !trimmedSource.includes('\n');
    const wordCount = trimmedSource.split(/\s+/).length;
    const isShortHeading = isSingleLine && (trimmedSource.startsWith('#') || wordCount <= 8);

    if (isShortHeading && text) {
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      let firstLine = lines[0] || text;
      if (wordCount <= 5 && firstLine.length > 30) {
        const sentenceMatch = firstLine.match(/^([^。！？\n]+[。！？]?)/);
        if (sentenceMatch && sentenceMatch[1].length < firstLine.length) {
          firstLine = sentenceMatch[1].trim();
        }
      }
      text = firstLine;
    }

    return text.trim();
  }

  private renderSkeletonCards(container: HTMLElement, paragraphs: ParagraphUnit[]): void {
    if (paragraphs.length === 0) {
      container.innerHTML = `
        <div class="trans-empty-tip">
          <md-icon class="trans-empty-icon">menu_book</md-icon>
          <p>当前页面暂无匹配的英文段落</p>
        </div>
      `;
      return;
    }

    container.innerHTML = paragraphs
      .map((unit) => {
        const typeLabel = getTypeLabel(unit.type);
        const isDone = unit.status === 'done';
        const isSatisfied = Boolean(unit.isSatisfied);
        const isCustom = Boolean(unit.isCustomEdited);
        const cardClass = `trans-card ${isDone ? '' : 'trans-card-loading'} ${isSatisfied ? 'is-satisfied' : ''}`;
        const statusPill = isCustom
          ? '<span class="trans-card-status-pill is-custom">★ 已精修</span>'
          : isSatisfied
          ? '<span class="trans-card-status-pill is-satisfied">★ 已采纳</span>'
          : '';

        return `
          <div class="${cardClass}" data-trans-card-id="${unit.id}">
            <div class="trans-card-header">
              <div class="trans-card-badges">
                <span class="trans-card-badge">${typeLabel} ${unit.index + 1}</span>
                ${statusPill}
              </div>
              <div class="trans-card-actions">
                <button
                  type="button"
                  class="trans-card-action-icon-btn trans-card-satisfy-btn ${isSatisfied ? 'is-satisfied' : ''}"
                  title="${isSatisfied ? '取消采纳' : '采纳满意译文'}"
                  aria-label="采纳满意译文"
                >
                  <md-icon class="trans-card-icon">${isSatisfied ? 'star' : 'star_border'}</md-icon>
                </button>
                <button
                  type="button"
                  class="trans-card-action-icon-btn trans-card-edit-btn"
                  title="微调/精修译文"
                  aria-label="微调译文"
                >
                  <md-icon class="trans-card-icon">edit</md-icon>
                </button>
                <button
                  type="button"
                  class="trans-card-action-icon-btn trans-card-copy-btn"
                  title="复制中文译文"
                  aria-label="复制译文"
                >
                  <md-icon class="trans-card-icon">content_copy</md-icon>
                </button>
              </div>
            </div>
            <div class="trans-card-body">
              <div class="trans-source-snippet">${escapeHtml(unit.sourceText.slice(0, 140))}${unit.sourceText.length > 140 ? '...' : ''}</div>
              <div class="trans-target-text ${isDone ? '' : 'trans-pulse-text'}">
                ${isDone
                  ? escapeHtml(unit.translatedText || unit.sourceText)
                  : '<div class="trans-skeleton-line"></div><div class="trans-skeleton-line short"></div>'}
              </div>
            </div>
          </div>
        `;
      })
      .join('');

    // 绑定卡片交互与公式渲染
    paragraphs.forEach((unit) => {
      const card = container.querySelector<HTMLElement>(`[data-trans-card-id="${unit.id}"]`);
      if (card) {
        this.bindCardActions(card, unit);
        if (unit.status === 'done') {
          const targetElem = card.querySelector<HTMLElement>('.trans-target-text');
          if (targetElem) {
            renderMathInElementSafely(targetElem);
          }
        }
      }
    });
  }

  private updateCardContent(container: HTMLElement, unit: ParagraphUnit): void {
    const card = container.querySelector<HTMLElement>(`[data-trans-card-id="${unit.id}"]`);
    if (!card) return;

    card.classList.remove('trans-card-loading');
    const targetElem = card.querySelector<HTMLElement>('.trans-target-text');
    if (!targetElem) return;

    targetElem.classList.remove('trans-pulse-text');

    if (unit.status === 'error') {
      card.classList.add('trans-card-error');
      targetElem.innerHTML = `
        <span class="trans-error-msg" title="${escapeHtml(unit.error || '')}">
          ⚠️ 翻译未成功 (${escapeHtml(unit.error || '请求异常')}) · <button type="button" class="trans-retry-btn">重试</button><button type="button" class="trans-fix-key-btn">配置密钥</button>
        </span>
      `;
      const retryBtn = card.querySelector('.trans-retry-btn');
      retryBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.retrySingleUnit(card, unit);
      });
      const fixKeyBtn = card.querySelector('.trans-fix-key-btn');
      fixKeyBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleSettingsDrawer(true);
        const input = document.getElementById('trans-api-key-input') as HTMLInputElement | null;
        if (input && !input.disabled) {
          input.focus();
          input.select();
        }
      });
      return;
    }

    card.classList.remove('trans-card-error');
    if (unit.isSatisfied) {
      card.classList.add('is-satisfied');
    } else {
      card.classList.remove('is-satisfied');
    }

    const satisfyBtn = card.querySelector<HTMLButtonElement>('.trans-card-satisfy-btn');
    if (satisfyBtn) {
      if (unit.isSatisfied) {
        satisfyBtn.classList.add('is-satisfied');
        satisfyBtn.title = '取消采纳';
        const icon = satisfyBtn.querySelector('md-icon');
        if (icon) icon.textContent = 'star';
      } else {
        satisfyBtn.classList.remove('is-satisfied');
        satisfyBtn.title = '采纳满意译文';
        const icon = satisfyBtn.querySelector('md-icon');
        if (icon) icon.textContent = 'star_border';
      }
    }

    this.updateCardBadges(card, unit);

    targetElem.textContent = unit.translatedText || unit.sourceText;
    renderMathInElementSafely(targetElem);
  }

  private bindCardActions(card: HTMLElement, unit: ParagraphUnit): void {
    const satisfyBtn = card.querySelector<HTMLButtonElement>('.trans-card-satisfy-btn');
    satisfyBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.handleToggleSatisfied(unit, card);
    });

    const editBtn = card.querySelector<HTMLButtonElement>('.trans-card-edit-btn');
    editBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.handleStartEdit(unit, card);
    });

    const copyBtn = card.querySelector<HTMLButtonElement>('.trans-card-copy-btn');
    copyBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(unit.translatedText || unit.sourceText).then(() => {
        const icon = copyBtn.querySelector('md-icon');
        if (icon) {
          icon.textContent = 'check';
          setTimeout(() => {
            icon.textContent = 'content_copy';
          }, 1500);
        }
      });
    });
  }

  private handleToggleSatisfied(unit: ParagraphUnit, card: HTMLElement): void {
    const nextVal = !unit.isSatisfied;
    unit.isSatisfied = nextVal;
    TranslationStorage.toggleSatisfied(TranslationStorage.normalizeKey(), unit.id, nextVal);

    if (nextVal) {
      card.classList.add('is-satisfied');
    } else {
      card.classList.remove('is-satisfied');
    }

    const satisfyBtn = card.querySelector<HTMLButtonElement>('.trans-card-satisfy-btn');
    if (satisfyBtn) {
      if (nextVal) {
        satisfyBtn.classList.add('is-satisfied');
        satisfyBtn.title = '取消采纳';
        const icon = satisfyBtn.querySelector('md-icon');
        if (icon) icon.textContent = 'star';
      } else {
        satisfyBtn.classList.remove('is-satisfied');
        satisfyBtn.title = '采纳满意译文';
        const icon = satisfyBtn.querySelector('md-icon');
        if (icon) icon.textContent = 'star_border';
      }
    }

    this.updateCardBadges(card, unit);
    this.updateSatisfiedCountBadge();
  }

  private updateCardBadges(card: HTMLElement, unit: ParagraphUnit): void {
    const badgesBox = card.querySelector('.trans-card-badges');
    if (!badgesBox) return;

    const existingPill = badgesBox.querySelector('.trans-card-status-pill');
    if (existingPill) existingPill.remove();

    if (unit.isCustomEdited) {
      const pill = document.createElement('span');
      pill.className = 'trans-card-status-pill is-custom';
      pill.textContent = '★ 已精修';
      badgesBox.appendChild(pill);
    } else if (unit.isSatisfied) {
      const pill = document.createElement('span');
      pill.className = 'trans-card-status-pill is-satisfied';
      pill.textContent = '★ 已采纳';
      badgesBox.appendChild(pill);
    }
  }

  private handleStartEdit(unit: ParagraphUnit, card: HTMLElement): void {
    handleStartInlineEdit({
      card,
      unit,
      updateCardBadges: (c, u) => this.updateCardBadges(c, u),
      updateSatisfiedCountBadge: () => this.updateSatisfiedCountBadge(),
    });
  }

  public toggleInlineTranslation(): void {
    this.inlineView.toggleInlineTranslation();
  }

  public async showInlineTranslations(forceRefresh = false): Promise<void> {
    return this.inlineView.showInlineTranslations(forceRefresh);
  }

  public hideInlineTranslations(): void {
    this.inlineView.hideInlineTranslations();
  }

  public syncInlineToolbarUI(): void {
    this.inlineView.syncInlineToolbarUI();
  }
}

// 自动初始化挂载
if (typeof window !== 'undefined') {
  const initController = () => {
    TranslationDockController.getInstance().init();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initController);
  } else {
    initController();
  }
}
