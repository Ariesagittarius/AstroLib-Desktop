import type { ParagraphUnit, TranslationProviderId, TranslationDisplayMode } from '../types';
import { TranslationStorage } from '../storage/translation-storage';
import { ParagraphAligner } from '../paragraph-aligner';
import { sideloadManagerContract as sideloadManager } from '../../../features/sideload/contract';

let _renderMath: any = null;
export async function renderMathInElementSafely(elem: HTMLElement): Promise<void> {
  try {
    if (!_renderMath) {
      const mod = await import('katex/dist/contrib/auto-render.mjs');
      _renderMath = mod.default || mod;
    }
    _renderMath(elem, {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '$', right: '$', display: false },
        { left: '\\(', right: '\\)', display: false },
        { left: '\\[', right: '\\]', display: true },
      ],
      throwOnError: false,
    });
  } catch (err) {
    console.warn('[TranslationInlineView] KaTeX auto-render 降级:', err);
  }
}

export interface TranslationInlineViewContext {
  getProvider(): TranslationProviderId;
  setProvider(provider: TranslationProviderId): void;
  getDisplayMode(): TranslationDisplayMode;
  getParagraphs(): ParagraphUnit[];
  setParagraphs(paragraphs: ParagraphUnit[]): void;
  getCurrentChapterKey(): string;
  setCurrentChapterKey(key: string): void;
  requestTranslation(text: string, signal?: AbortSignal): Promise<{ ok: boolean; translatedText?: string; error?: string }>;
  updateSatisfiedCountBadge(): void;
  handleToggleSatisfied(unit: ParagraphUnit, card: HTMLElement): void;
  toggleSettingsDrawer(open?: boolean): void;
}

export class TranslationInlineView {
  private isInlineActiveState = false;
  private isTranslating = false;
  private abortController: AbortController | null = null;

  constructor(private ctx: TranslationInlineViewContext) {}

  public isInlineActive(): boolean {
    return this.isInlineActiveState;
  }

  public setInlineActive(active: boolean): void {
    this.isInlineActiveState = active;
  }

  public toggleInlineTranslation(): void {
    if (this.isInlineActiveState) {
      this.hideInlineTranslations();
    } else {
      this.showInlineTranslations();
    }
  }

  public async showInlineTranslations(forceRefresh = false): Promise<void> {
    if (this.isTranslating && !forceRefresh) return;
    if (this.isTranslating && forceRefresh) {
      if (this.abortController) {
        this.abortController.abort();
        this.abortController = null;
      }
      this.isTranslating = false;
    }

    const contentContainer = document.querySelector<HTMLElement>('.sl-markdown-content') || document.querySelector<HTMLElement>('article');
    if (!contentContainer) return;

    this.isInlineActiveState = true;
    this.updateTriggerActiveState(true);

    const chapterKey = TranslationStorage.normalizeKey();
    const hasTransIds = Boolean(contentContainer.querySelector('[data-trans-id]'));
    let paragraphs = this.ctx.getParagraphs();

    if (this.ctx.getCurrentChapterKey() !== chapterKey || !hasTransIds || paragraphs.length === 0 || forceRefresh) {
      this.ctx.setCurrentChapterKey(chapterKey);
      paragraphs = ParagraphAligner.extractFromArticleDom(contentContainer);
      this.ctx.setParagraphs(paragraphs);
    }
    if (paragraphs.length === 0) return;

    const { hydratedCount } = TranslationStorage.hydrateUnits(chapterKey, paragraphs);

    this.renderInlineToolbar(contentContainer);
    this.renderInlineBlocks(contentContainer, paragraphs);

    if (!forceRefresh && hydratedCount === paragraphs.length) {
      return;
    }

    this.isTranslating = true;
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    const total = paragraphs.length;
    const CHUNK_SIZE = 4;

    for (let i = 0; i < total; i += CHUNK_SIZE) {
      if (signal.aborted) break;
      const chunk = paragraphs.slice(i, i + CHUNK_SIZE);
      await Promise.all(
        chunk.map(async (unit) => {
          if (signal.aborted) return;

          if (unit.type === 'math' || unit.type === 'code') {
            unit.status = 'done';
            unit.translatedText = unit.sourceText;
            return;
          }

          if (!forceRefresh && unit.status === 'done' && unit.translatedText) {
            this.updateInlineBlockContent(contentContainer, unit);
            return;
          }

          try {
            const res = await this.ctx.requestTranslation(unit.sourceText, signal);
            if (signal.aborted) return;

            if (res.ok && res.translatedText) {
              unit.translatedText = res.translatedText;
              unit.status = 'done';
              unit.provider = this.ctx.getProvider();
              unit.error = undefined;
              TranslationStorage.saveUnit(chapterKey, unit);
            } else {
              unit.translatedText = unit.sourceText;
              unit.status = 'error';
              unit.error = res.error || '翻译失败';
            }
          } catch (err: any) {
            if (signal.aborted) return;
            unit.translatedText = unit.sourceText;
            unit.status = 'error';
            unit.error = err?.message || '网络连接异常';
          }

          if (signal.aborted) return;
          this.updateInlineBlockContent(contentContainer, unit);
        })
      );
    }

    const chapterTitle = document.querySelector('h1')?.textContent?.trim() || document.title;
    TranslationStorage.saveChapter(chapterKey, paragraphs, chapterTitle);
    this.isTranslating = false;
  }

  public hideInlineTranslations(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.isTranslating = false;
    this.isInlineActiveState = false;

    const contentContainer = document.querySelector<HTMLElement>('.sl-markdown-content') || document.querySelector<HTMLElement>('article');
    if (contentContainer) {
      contentContainer.querySelectorAll<HTMLElement>('.trans-inline-block').forEach((el) => el.remove());
      contentContainer.querySelectorAll<HTMLElement>('.has-trans-inline').forEach((el) => el.classList?.remove('has-trans-inline'));
      const toolbar = contentContainer.querySelector<HTMLElement>('#trans-inline-toolbar');
      if (toolbar) toolbar.remove();
    }

    this.updateTriggerActiveState(false);
  }

  public renderInlineBlocks(container: HTMLElement, paragraphs: ParagraphUnit[]): void {
    for (const unit of paragraphs) {

      if (unit.type === 'math' || unit.type === 'code') continue;

      const srcEl = container.querySelector<HTMLElement>(`[data-trans-id="${unit.id}"]`);
      if (!srcEl) continue;

      let inlineBlock = container.querySelector<HTMLElement>(`[data-trans-inline-id="${unit.id}"]`);
      if (!inlineBlock) {
        inlineBlock = document.createElement('div');
        const isCardTitle =
          unit.type === 'card-title' ||
          srcEl.getAttribute?.('data-trans-card-title') === 'true' ||
          srcEl.classList?.contains('card-header');

        const isTableCell =
          unit.type === 'table-cell' ||
          srcEl.tagName === 'TH' ||
          srcEl.tagName === 'TD' ||
          srcEl.getAttribute?.('data-trans-kind') === 'table-cell';

        const isInsideAlgorithm = Boolean(srcEl.closest?.('.academic-algorithm, .mineru-algorithm, .algorithm-body'));
        const isNoIndent = srcEl.classList?.contains('noindent') || isInsideAlgorithm || isTableCell;

        inlineBlock.className = `trans-inline-block ${unit.type === 'heading' ? 'is-heading' : ''} ${isCardTitle ? 'is-card-title' : ''} ${isTableCell ? 'is-table-cell' : ''} ${isNoIndent ? 'is-noindent' : ''} ${isInsideAlgorithm ? 'is-algorithm-item' : ''}`.trim();
        inlineBlock.setAttribute('data-trans-inline-id', unit.id);
        inlineBlock.setAttribute('role', 'region');
        inlineBlock.setAttribute(
          'aria-label',
          isCardTitle ? '卡片标题中文译文' : isTableCell ? '表格单元格中文译文' : '段落中文译文'
        );

        if (isCardTitle || isTableCell) {
          srcEl.classList?.add('has-trans-inline');
          srcEl.appendChild(inlineBlock);
        } else {
          srcEl.after(inlineBlock);
          if (isInsideAlgorithm) {
            const nextNode = inlineBlock.nextSibling;
            if (nextNode && nextNode.nodeType === 3 && /^\s+$/.test(nextNode.nodeValue || '')) {
              nextNode.nodeValue = '';
            }
          }
        }
      }

      this.updateInlineBlockContent(container, unit, inlineBlock);
    }
  }

  public updateInlineBlockContent(container: HTMLElement, unit: ParagraphUnit, targetBlock?: HTMLElement): void {
    const block = targetBlock || container.querySelector<HTMLElement>(`[data-trans-inline-id="${unit.id}"]`);
    if (!block) return;

    const isDone = unit.status === 'done';
    const isError = unit.status === 'error';
    const isSatisfied = Boolean(unit.isSatisfied);

    if (isError) {
      const isKeyError = (unit.error || '').includes('Key') || (unit.error || '').includes('密钥') || (unit.error || '').includes('401');
      const fixKeyBtn = isKeyError ? '<button type="button" class="trans-inline-fix-key-btn">配置密钥</button>' : '';
      block.innerHTML = `<div class="trans-inline-error"><span class="trans-inline-error-text">⚠️ 翻译未成功 (${this.escapeHtml(unit.error || '请求异常')})</span><button type="button" class="trans-inline-retry-btn">重试</button>${fixKeyBtn}</div>`;
      block.querySelector('.trans-inline-retry-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.retrySingleUnitInline(block, unit);
      });
      block.querySelector('.trans-inline-fix-key-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.ctx.getDisplayMode() === 'sidebar') {
          this.ctx.toggleSettingsDrawer(true);
        } else {
          sideloadManager.open('translate');
          this.ctx.toggleSettingsDrawer(true);
        }
      });
      return;
    }

    const textContent = isDone
      ? this.escapeHtml((unit.translatedText || unit.sourceText).trim())
      : '<div class="trans-skeleton-line"></div>';

    const actionsContent = isDone
      ? `<div class="trans-inline-actions">
          <button
            type="button"
            class="trans-inline-action-btn trans-inline-satisfy-btn ${isSatisfied ? 'is-satisfied' : ''}"
            title="${isSatisfied ? '取消采纳' : '采纳满意译文'}"
            aria-label="采纳满意译文"
          >
            <md-icon class="trans-inline-icon">${isSatisfied ? 'star' : 'star_border'}</md-icon>
          </button>
          <button
            type="button"
            class="trans-inline-action-btn trans-inline-copy-btn"
            title="复制译文"
            aria-label="复制译文"
          >
            <md-icon class="trans-inline-icon">content_copy</md-icon>
          </button>
        </div>`
      : '';

    block.innerHTML = `<div class="trans-inline-inner"><div class="trans-inline-text ${isDone ? '' : 'trans-pulse-text'}">${textContent}</div>${actionsContent}</div>`;

    if (isDone) {
      const textEl = block.querySelector<HTMLElement>('.trans-inline-text');
      if (textEl) {
        renderMathInElementSafely(textEl);
      }

      const satisfyBtn = block.querySelector<HTMLButtonElement>('.trans-inline-satisfy-btn');
      satisfyBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        const nextVal = !unit.isSatisfied;
        unit.isSatisfied = nextVal;
        TranslationStorage.toggleSatisfied(TranslationStorage.normalizeKey(), unit.id, nextVal);
        satisfyBtn.classList.toggle('is-satisfied', nextVal);
        const icon = satisfyBtn.querySelector('md-icon');
        if (icon) icon.textContent = nextVal ? 'star' : 'star_border';
        satisfyBtn.title = nextVal ? '取消采纳' : '采纳满意译文';
        this.ctx.updateSatisfiedCountBadge();

        const dockContent = document.getElementById('trans-sidebar-content');
        if (dockContent) {
          const card = dockContent.querySelector<HTMLElement>(`[data-trans-card-id="${unit.id}"]`);
          if (card) {
            this.ctx.handleToggleSatisfied(unit, card);
          }
        }
      });

      const copyBtn = block.querySelector<HTMLButtonElement>('.trans-inline-copy-btn');
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
  }

  public async retrySingleUnitInline(block: HTMLElement, unit: ParagraphUnit): Promise<void> {
    const textEl = block.querySelector<HTMLElement>('.trans-inline-error');
    if (textEl) {
      textEl.innerHTML = '<div class="trans-skeleton-line"></div>';
    }
    try {
      const res = await this.ctx.requestTranslation(unit.sourceText);
      if (res.ok && res.translatedText) {
        unit.translatedText = res.translatedText;
        unit.status = 'done';
        unit.provider = this.ctx.getProvider();
        unit.error = undefined;
        TranslationStorage.saveUnit(TranslationStorage.normalizeKey(), unit);
      } else {
        unit.status = 'error';
        unit.error = res.error || '翻译失败';
      }
    } catch (err: any) {
      unit.status = 'error';
      unit.error = err?.message || '网络连接异常';
    }

    const container = document.querySelector<HTMLElement>('.sl-markdown-content') || document.querySelector<HTMLElement>('article');
    if (container) {
      this.updateInlineBlockContent(container, unit, block);
    }
  }

  public updateTriggerActiveState(active: boolean): void {
    document.querySelectorAll<HTMLElement>('[data-translation-trigger]').forEach((el) => {
      el.classList.toggle('is-active', active);
      if (el.tagName.toLowerCase() === 'md-assist-chip') {
        if (active) {
          el.setAttribute('selected', '');
        } else {
          el.removeAttribute('selected');
        }
      }
    });
  }

  public renderInlineToolbar(container: HTMLElement): void {
    let toolbar = container.querySelector<HTMLElement>('#trans-inline-toolbar');
    if (!toolbar) {
      toolbar = document.createElement('div');
      toolbar.id = 'trans-inline-toolbar';
      toolbar.className = 'trans-inline-toolbar';
      toolbar.setAttribute('role', 'toolbar');
      toolbar.setAttribute('aria-label', '双语助读控制条');
      container.prepend(toolbar);
    }

    const currentP = this.ctx.getProvider();
    toolbar.innerHTML = `
      <div class="trans-inline-toolbar-left">
        <span class="trans-inline-toolbar-title">
          <svg class="trans-inline-toolbar-icon" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/>
          </svg>
          <span>双语助读</span>
        </span>
        <span class="trans-inline-toolbar-sep">/</span>
        <div class="trans-inline-provider-pills" role="radiogroup" aria-label="选择翻译服务商">
          <button type="button" class="trans-inline-pill ${currentP === 'google' ? 'is-active' : ''}" data-inline-provider="google" title="Google 翻译 (免密默认)">Google 翻译</button>
          <button type="button" class="trans-inline-pill ${currentP === 'bupt' ? 'is-active' : ''}" data-inline-provider="bupt" title="北京邮电大学「人人有算力」校内专属服务">北邮校内</button>
          <button type="button" class="trans-inline-pill ${currentP === 'zhipu' ? 'is-active' : ''}" data-inline-provider="zhipu" title="智谱开放平台 GLM-4-Flash (免费模型)">智谱 GLM-4</button>
          <button type="button" class="trans-inline-pill ${currentP === 'gemini' ? 'is-active' : ''}" data-inline-provider="gemini" title="Google Gemini 学术翻译">Gemini</button>
        </div>
      </div>
      <div class="trans-inline-toolbar-right">
        <button type="button" class="trans-inline-toolbar-btn" id="trans-inline-refresh-btn" title="重新翻译全文">
          <md-icon class="trans-inline-btn-icon">refresh</md-icon>
          <span>重新翻译</span>
        </button>
        <button type="button" class="trans-inline-toolbar-btn trans-inline-close-btn" id="trans-inline-exit-btn" title="退出双语助读模式">
          <md-icon class="trans-inline-btn-icon">close</md-icon>
          <span>退出助读</span>
        </button>
      </div>
    `;

    toolbar.querySelectorAll<HTMLButtonElement>('[data-inline-provider]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = btn.getAttribute('data-inline-provider') as TranslationProviderId;
        if (p) {
          this.ctx.setProvider(p);
          this.syncInlineToolbarUI();
          this.showInlineTranslations(true);
        }
      });
    });

    toolbar.querySelector('#trans-inline-refresh-btn')?.addEventListener('click', () => {
      this.showInlineTranslations(true);
    });

    toolbar.querySelector('#trans-inline-exit-btn')?.addEventListener('click', () => {
      this.hideInlineTranslations();
    });
  }

  public syncInlineToolbarUI(): void {
    const toolbar = document.getElementById('trans-inline-toolbar');
    if (!toolbar) return;
    const currentP = this.ctx.getProvider();
    toolbar.querySelectorAll<HTMLButtonElement>('[data-inline-provider]').forEach((btn) => {
      const p = btn.getAttribute('data-inline-provider');
      btn.classList.toggle('is-active', p === currentP);
    });
  }

  public escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  public destroy(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.isTranslating = false;
  }
}
