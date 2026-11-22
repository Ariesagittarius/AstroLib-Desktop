/**
 * src/features/doc-ingestion/paper-reader-controller.ts
 * ============================================================================
 * 单文献纯净双栏阅读器主控制器 (Material Design 3 + MD3E)
 * ============================================================================
 * 设计铁律：
 * 1. 严格单文献绑定：仅依据 URL ?taskId= 载入唯一指定文献，绝不切换任务或篡改标题；
 * 2. 彻底去冗余：无侧栏、无独立 Logo、无独立设置、无常驻「开始解析」按钮；
 * 3. 状态自洽：正在解析显示 MD3 进度条并自动渲染；失败/中断/待解析右栏给出清晰提示与轻量重试。
 * ============================================================================
 */

import katex from 'katex';
import { getSavedMineruToken, readIngestSettings } from './ingest-settings';
import { PaperTypographyManager } from './paper-typography';
import { PdfViewportController, type PdfBlockItem } from './pdf-viewport';
import { BilingualTranslator, safeParsePaperMarkdown } from './bilingual-translator';
import { WordPopoverController } from './word-popover';
import {
  isIngestRunningState,
  MINERU_MAX_PAGES_PER_PARSE,
  validatePageRanges,
} from '../library/core/entity-status';

type ViewMode = 'structured' | 'bilingual' | 'continuous';
type ContentTab = 'markdown' | 'json';

export function initPaperReader(): void {
  const urlParams = new URLSearchParams(window.location.search);
  const taskId = (urlParams.get('taskId') || '').trim();

  let currentViewMode: ViewMode = 'structured';
  let currentTab: ContentTab = 'markdown';
  let currentBlocks: PdfBlockItem[] = [];
  let currentMarkdown = '';
  let currentRawJson = '';
  let currentTaskMeta: any = null;
  let pollTimer: number | null = null;
  let isScrollingProgrammatically = false;
  let scrollSyncTimer: number | null = null;

  const docNameText = document.getElementById('doc-name-text');
  const progressBar = document.getElementById('paper-linear-progress') as any;
  const viewModeSegmented = document.getElementById('view-mode-segmented') as any;
  const contentTabSegmented = document.getElementById('content-tab-segmented') as any;

  const btnDownloadZip = document.getElementById('btn-download-zip') as HTMLElement | null;
  const btnExportBook = document.getElementById('btn-export-book') as HTMLElement | null;
  const bilingualBatchControls = document.getElementById('bilingual-batch-controls');
  const btnBatchTransCurrent = document.getElementById('btn-batch-translate-current');
  const btnBatchTransAll = document.getElementById('btn-batch-translate-all');
  const btnCopyContent = document.getElementById('btn-copy-content');

  const errorBanner = document.getElementById('ingest-error-banner');
  const errorBannerText = document.getElementById('ingest-error-text');
  document.getElementById('btn-close-error-banner')?.addEventListener('click', () => {
    if (errorBanner) errorBanner.style.display = 'none';
  });

  const emptyStage = document.getElementById('paper-empty-stage');
  const workspaceGrid = document.getElementById('paper-workspace-grid');
  const contentScrollArea = document.getElementById('content-scroll-area');
  const structuredContainer = document.getElementById('structured-blocks-container');
  const continuousContainer = document.getElementById('continuous-reading-container');
  const jsonContainer = document.getElementById('json-view-container');
  const footnotePopover = document.getElementById('doc-footnote-popover');

  const initialSettings = readIngestSettings();
  const translator = new BilingualTranslator(initialSettings.transProvider);
  const wordPopover = new WordPopoverController({
    enabled: initialSettings.clickToDefine,
    dictProvider: initialSettings.dictProvider,
    transProvider: initialSettings.transProvider,
  });

  let pdfViewport: PdfViewportController;

  const typography = new PaperTypographyManager((next) => {
    translator.setProvider(next.transProvider);
    wordPopover.updateConfig({
      enabled: next.clickToDefine,
      dictProvider: next.dictProvider,
      transProvider: next.transProvider,
    });
    pdfViewport?.setEnableTransition(next.enablePdfTransition);
    syncClickToDefineClass();
  });

  const showErrorBanner = (msg: string) => {
    if (errorBannerText) errorBannerText.textContent = msg;
    if (errorBanner) errorBanner.style.display = 'flex';
  };

  const hideErrorBanner = () => {
    if (errorBanner) errorBanner.style.display = 'none';
  };

  const setProgress = (value: number | null) => {
    if (!progressBar) return;
    if (value === null || value >= 100 || value <= 0) {
      progressBar.style.display = 'none';
      progressBar.value = 0;
    } else {
      progressBar.style.display = 'block';
      progressBar.value = Math.max(0.05, Math.min(1, value / 100));
    }
  };

  const syncClickToDefineClass = () => {
    if (!structuredContainer) return;
    const ready = currentViewMode === 'bilingual' && wordPopover.isEnabled();
    structuredContainer.classList.toggle('click-to-define-ready', ready);
  };

  const selectBlock = (blockId: string, pageIdx: number, scrollRight = true) => {
    pdfViewport.highlightBlockBbox(blockId, pageIdx);

    document.querySelectorAll('.structured-block-item').forEach((c) => c.classList.remove('active-block'));
    const targetCard = document.getElementById(`card_${blockId}`);
    if (targetCard && contentScrollArea) {
      targetCard.classList.add('active-block');
      if (scrollRight) {
        isScrollingProgrammatically = true;
        setTimeout(() => {
          isScrollingProgrammatically = false;
        }, 600);
        const containerRect = contentScrollArea.getBoundingClientRect();
        const cardRect = targetCard.getBoundingClientRect();
        const targetTop =
          contentScrollArea.scrollTop + (cardRect.top - containerRect.top) - containerRect.height / 2 + cardRect.height / 2;
        contentScrollArea.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
      }
    }
  };

  pdfViewport = new PdfViewportController(
    {
      onSelectBlock: selectBlock,
      onTranslateBlock: (block) => {
        setViewMode('bilingual');
        void translator.translateSingleBlock(block, true);
      },
      onPageSyncRight: (pageIdx) => {
        if (!structuredContainer || !contentScrollArea) return;
        isScrollingProgrammatically = true;
        setTimeout(() => {
          isScrollingProgrammatically = false;
        }, 600);
        const firstBlock =
          currentBlocks.find(
            (b) => b.pageIndex === pageIdx && b.type !== 'page_divider' && b.type !== 'page_meta'
          ) || currentBlocks.find((b) => b.pageIndex === pageIdx);
        if (firstBlock) {
          const card = document.getElementById(`card_${firstBlock.id}`);
          if (card) {
            const containerRect = contentScrollArea.getBoundingClientRect();
            const cardRect = card.getBoundingClientRect();
            const targetTop = contentScrollArea.scrollTop + (cardRect.top - containerRect.top) - 20;
            contentScrollArea.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
          }
        }
      },
    },
    typography.getSnapshot().enablePdfTransition
  );

  const setViewMode = (mode: ViewMode) => {
    currentViewMode = mode;
    if (viewModeSegmented) {
      viewModeSegmented.querySelectorAll('m3e-button-segment').forEach((seg: any) => {
        seg.checked = seg.value === mode;
      });
    }

    if (bilingualBatchControls) {
      bilingualBatchControls.style.display =
        mode === 'bilingual' && currentTab === 'markdown' && currentBlocks.length > 0 ? 'flex' : 'none';
    }

    if (currentTab === 'markdown') {
      if (mode === 'structured' || mode === 'bilingual') {
        if (structuredContainer) structuredContainer.style.display = 'flex';
        if (continuousContainer) continuousContainer.style.display = 'none';

        document.querySelectorAll('.block-item-translation').forEach((el) => {
          const transEl = el as HTMLElement;
          const hasText = transEl.innerText.trim().length > 0;
          transEl.style.display = mode === 'bilingual' && hasText ? 'block' : 'none';
        });

        if (mode === 'bilingual' && currentBlocks.length > 0) {
          void translator.translatePageBlocks(currentBlocks, pdfViewport.getCurrentPageIndex(), false);
        }
      } else {
        if (structuredContainer) structuredContainer.style.display = 'none';
        if (continuousContainer) continuousContainer.style.display = 'block';
      }
    }

    syncClickToDefineClass();
    if (mode !== 'bilingual') wordPopover.close();
  };

  viewModeSegmented?.addEventListener('change', () => {
    const val = viewModeSegmented.value;
    if (val === 'structured' || val === 'bilingual' || val === 'continuous') {
      setViewMode(val);
    }
  });

  contentTabSegmented?.addEventListener('change', () => {
    const val = contentTabSegmented.value;
    if (val === 'json') {
      currentTab = 'json';
      if (structuredContainer) structuredContainer.style.display = 'none';
      if (continuousContainer) continuousContainer.style.display = 'none';
      if (bilingualBatchControls) bilingualBatchControls.style.display = 'none';
      if (jsonContainer) {
        jsonContainer.style.display = 'block';
        if (!jsonContainer.textContent) {
          jsonContainer.textContent = currentRawJson || JSON.stringify(currentBlocks, null, 2);
        }
      }
    } else if (val === 'markdown') {
      currentTab = 'markdown';
      if (jsonContainer) jsonContainer.style.display = 'none';
      setViewMode(currentViewMode);
    }
  });

  btnBatchTransCurrent?.addEventListener('click', () => {
    setViewMode('bilingual');
    void translator.translatePageBlocks(currentBlocks, pdfViewport.getCurrentPageIndex(), true);
  });

  btnBatchTransAll?.addEventListener('click', () => {
    setViewMode('bilingual');
    void translator.translateAllBlocks(currentBlocks);
  });

  btnCopyContent?.addEventListener('click', () => {
    const textToCopy =
      currentTab === 'markdown' ? currentMarkdown : currentRawJson || JSON.stringify(currentBlocks, null, 2);
    if (!textToCopy) return;
    void navigator.clipboard.writeText(textToCopy);
  });

  wordPopover.attachToContainer(structuredContainer, () => currentViewMode === 'bilingual');

  contentScrollArea?.addEventListener(
    'scroll',
    () => {
      if (isScrollingProgrammatically || currentBlocks.length === 0 || !structuredContainer || !contentScrollArea) return;
      if (scrollSyncTimer) clearTimeout(scrollSyncTimer);
      scrollSyncTimer = window.setTimeout(() => {
        const containerRect = contentScrollArea.getBoundingClientRect();
        const cards = structuredContainer.querySelectorAll('.structured-block-item[data-page-index]');
        let detected = pdfViewport.getCurrentPageIndex();
        for (const card of cards) {
          const r = card.getBoundingClientRect();
          if (r.top >= containerRect.top - 60 && r.top <= containerRect.top + containerRect.height * 0.4) {
            const p = parseInt(card.getAttribute('data-page-index') || '0', 10);
            if (!isNaN(p)) {
              detected = p;
              break;
            }
          }
        }
        pdfViewport.syncPageFromRightScroll(detected);
      }, 120);
    },
    { passive: true }
  );

  // 空状态返回书库
  document.getElementById('btn-empty-goto-library')?.addEventListener('click', () => {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'astrolib:switch-fragment', fragment: 'library' }, '*');
    } else {
      window.location.href = '/desktop/';
    }
  });

  const renderStatePlaceholder = (opts: {
    icon: string;
    title: string;
    description: string;
    showRetry?: boolean;
    taskMeta?: any;
  }) => {
    if (!structuredContainer) return;
    const totalPages = Number(opts.taskMeta?.pageCount || 0);
    const needsRange = totalPages > MINERU_MAX_PAGES_PER_PARSE;
    const defaultRange = opts.taskMeta?.pageRanges || `1-${Math.min(totalPages || 200, MINERU_MAX_PAGES_PER_PARSE)}`;

    structuredContainer.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'paper-state-card';
    box.innerHTML = `
      <span class="material-symbols-outlined paper-state-icon">${opts.icon}</span>
      <h3 class="paper-state-title"></h3>
      <p class="paper-state-desc"></p>
      ${
        opts.showRetry && needsRange
          ? `<md-outlined-text-field id="inline-reparse-range" class="paper-state-range-field" label="解析页码范围（总 ${totalPages} 页，单次最多 ${MINERU_MAX_PAGES_PER_PARSE} 页）" value="${defaultRange}"></md-outlined-text-field>
             <div id="inline-reparse-hint" class="paper-state-hint"></div>`
          : ''
      }
      ${
        opts.showRetry
          ? `<div class="paper-state-actions">
               <md-filled-tonal-button id="btn-inline-reparse">${opts.taskMeta?.status === 'idle' ? '开始解析此文献' : '重新解析此文献'}</md-filled-tonal-button>
             </div>`
          : ''
      }
    `;
    (box.querySelector('.paper-state-title') as HTMLElement).textContent = opts.title;
    (box.querySelector('.paper-state-desc') as HTMLElement).textContent = opts.description;

    const retryBtn = box.querySelector('#btn-inline-reparse') as any;
    const rangeField = box.querySelector('#inline-reparse-range') as any;
    const hintEl = box.querySelector('#inline-reparse-hint') as HTMLElement | null;

    retryBtn?.addEventListener('click', async () => {
      const { engine } = readIngestSettings();
      const token = getSavedMineruToken();
      if (engine === 'api' && !token) {
        try {
          const hRes = await fetch('/api/ingest/health');
          const hJson = await hRes.json().catch(() => ({}));
          if (!hJson?.api?.hasToken) {
            showErrorBanner('当前缺少 MinerU API Token，请前往全局设置「文献解析与研读」填写。');
            if (window.parent && window.parent !== window) {
              window.parent.postMessage(
                { type: 'ASTROLIB_OPEN_SETTINGS_HUB', panel: 'panel-ingest', section: 'token' },
                '*'
              );
            }
            return;
          }
        } catch {}
      }

      let chosenRange: string | undefined = opts.taskMeta?.pageRanges;
      if (needsRange && rangeField) {
        const check = validatePageRanges(String(rangeField.value || ''), totalPages, MINERU_MAX_PAGES_PER_PARSE);
        if (!check.valid) {
          if (hintEl) hintEl.textContent = check.error || '页码范围不合法';
          return;
        }
        chosenRange = check.normalized;
      }

      retryBtn.disabled = true;
      hideErrorBanner();
      setProgress(10);

      try {
        const res = await fetch('/api/ingest/parse', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            taskId,
            engine,
            pageRanges: chosenRange,
            token: token || undefined,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || '启动解析失败');
        }
        notifyParentLibraryUpdated();
        startPolling();
      } catch (err: any) {
        retryBtn.disabled = false;
        setProgress(null);
        showErrorBanner(err?.message || String(err));
      }
    });

    structuredContainer.appendChild(box);
  };

  const renderStructuredBlocks = () => {
    if (!structuredContainer) return;
    structuredContainer.innerHTML = '';

    let lastPageWithFootnote = -1;

    currentBlocks.forEach((block) => {
      if (!block.html && !block.text) return;

      if (block.type === 'page_divider') {
        const item = document.createElement('div');
        item.className = 'structured-block-item type-page_divider';
        item.id = `card_${block.id}`;
        item.setAttribute('data-block-id', block.id);
        item.setAttribute('data-page-index', String(block.pageIndex));
        item.innerHTML = block.html || '';
        item.querySelector('.doc-page-number')?.addEventListener('click', (e) => {
          e.stopPropagation();
          pdfViewport.gotoPage(block.pageIndex, false);
        });
        structuredContainer.appendChild(item);
        return;
      }

      if (block.type === 'page_meta') {
        const item = document.createElement('div');
        item.className = 'structured-block-item type-page_meta';
        item.id = `card_${block.id}`;
        item.setAttribute('data-block-id', block.id);
        item.setAttribute('data-page-index', String(block.pageIndex));
        item.innerHTML = block.html || '';
        structuredContainer.appendChild(item);
        return;
      }

      if (block.type === 'footnote') {
        if (lastPageWithFootnote !== block.pageIndex) {
          lastPageWithFootnote = block.pageIndex;
          const rule = document.createElement('div');
          rule.className = 'doc-footnote-page-rule';
          structuredContainer.appendChild(rule);
        }

        const item = document.createElement('div');
        item.className = 'structured-block-item type-footnote';
        item.id = `card_${block.id}`;
        item.setAttribute('data-block-id', block.id);
        item.setAttribute('data-page-index', String(block.pageIndex));

        const body = document.createElement('div');
        body.className = 'block-item-body';
        body.innerHTML = block.html || block.text || '';
        item.appendChild(body);

        const actions = document.createElement('div');
        actions.className = 'block-hover-actions';
        actions.innerHTML = `
          <button type="button" class="block-hover-btn btn-action-copy" title="复制脚注" aria-label="复制脚注">
            <span class="material-symbols-outlined" style="font-size: 13px;">content_copy</span>
          </button>
        `;
        actions.querySelector('.btn-action-copy')?.addEventListener('click', (e) => {
          e.stopPropagation();
          if (block.text) void navigator.clipboard.writeText(block.text);
        });
        item.appendChild(actions);

        item.querySelector('.fn-back-link')?.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const refEl = document.getElementById(`ref_p${block.pageIndex}_${block.fnIndex}`);
          if (refEl) {
            refEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            refEl.classList.remove('target-flash');
            void refEl.offsetWidth;
            refEl.classList.add('target-flash');
          }
        });

        item.addEventListener('mouseenter', () => {
          document.getElementById(`bbox_${block.id}`)?.classList.add('hover-bbox');
        });
        item.addEventListener('mouseleave', () => {
          document.getElementById(`bbox_${block.id}`)?.classList.remove('hover-bbox');
        });
        item.addEventListener('click', () => selectBlock(block.id, block.pageIndex, false));

        structuredContainer.appendChild(item);
        return;
      }

      const item = document.createElement('div');
      item.className = `structured-block-item type-${block.type || 'text'}`;
      item.id = `card_${block.id}`;
      item.setAttribute('data-block-id', block.id);
      item.setAttribute('data-page-index', String(block.pageIndex));

      const body = document.createElement('div');
      body.className = 'block-item-body';
      if (block.html) {
        body.innerHTML = block.html;
      } else if (block.type === 'equation') {
        try {
          const cleanEq = (block.text || '').replace(/^\$\$|\$\$$/g, '').trim();
          body.innerHTML = `<div class="doc-equation-display">${katex.renderToString(cleanEq, { displayMode: true, throwOnError: false })}</div>`;
        } catch {
          body.textContent = block.text || '';
        }
      } else if (block.type === 'image' || block.type === 'figure') {
        const match = (block.text || '').match(/!\[(.*?)\]\((.*?)\)/);
        const alt = match ? match[1] : block.caption || '插图';
        const src = match ? match[2] : '';
        const imgName = src.split('/').pop() || `img_${block.id}.png`;
        body.innerHTML = `<figure class="doc-figure"><img src="/api/ingest/image?taskId=${encodeURIComponent(taskId)}&name=${encodeURIComponent(imgName)}" alt="${alt}" loading="lazy" />${alt ? `<figcaption class="doc-figcaption">${alt}</figcaption>` : ''}</figure>`;
      } else {
        body.innerHTML = safeParsePaperMarkdown(block.text || '');
      }

      body.querySelectorAll('.doc-footnote-ref').forEach((refEl) => {
        const fnSym = refEl.getAttribute('data-fn-symbol');
        const pIdx = refEl.getAttribute('data-page-index');
        refEl.addEventListener('mouseenter', () => {
          if (!footnotePopover) return;
          const targetFn = currentBlocks.find(
            (b) =>
              b.id === `fn_p${pIdx}_${fnSym}` ||
              (b.pageIndex === Number(pIdx) && b.type === 'footnote' && b.fnIndex === fnSym)
          );
          if (targetFn) {
            footnotePopover.innerHTML = `
              <div style="font-weight: 700; color: var(--md3-primary); margin-bottom: 2px;">[${fnSym}] 脚注说明</div>
              <div>${targetFn.html || targetFn.text || ''}</div>
            `;
            const rect = refEl.getBoundingClientRect();
            footnotePopover.style.left = `${Math.min(window.innerWidth - 360, Math.max(16, rect.left - 20))}px`;
            footnotePopover.style.top = `${rect.bottom + 8}px`;
            footnotePopover.classList.add('active');
          }
        });
        refEl.addEventListener('mouseleave', () => footnotePopover?.classList.remove('active'));
        refEl.addEventListener('click', (e) => {
          e.stopPropagation();
          footnotePopover?.classList.remove('active');
          const targetCard = document.getElementById(`card_fn_p${pIdx}_${fnSym}`);
          if (targetCard) {
            targetCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
            targetCard.classList.remove('target-flash');
            void targetCard.offsetWidth;
            targetCard.classList.add('target-flash');
          }
        });
      });
      item.appendChild(body);

      const actions = document.createElement('div');
      actions.className = 'block-hover-actions';
      actions.innerHTML = `
        <button type="button" class="block-hover-btn btn-action-translate" title="双语学术研判" aria-label="双语学术研判">
          <span class="material-symbols-outlined" style="font-size: 13px;">translate</span>
          <span>研判</span>
        </button>
        <button type="button" class="block-hover-btn btn-action-copy" title="复制内容" aria-label="复制内容">
          <span class="material-symbols-outlined" style="font-size: 13px;">content_copy</span>
        </button>
      `;
      actions.querySelector('.btn-action-translate')?.addEventListener('click', (e) => {
        e.stopPropagation();
        void translator.translateSingleBlock(block, true);
      });
      actions.querySelector('.btn-action-copy')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (block.text) void navigator.clipboard.writeText(block.text);
      });
      item.appendChild(actions);

      const transContainer = document.createElement('div');
      transContainer.className = 'block-item-translation';
      transContainer.id = `trans_${block.id}`;
      const cachedHtml = translator.getCachedHtml(block.id);
      if (cachedHtml && currentViewMode === 'bilingual') {
        transContainer.style.display = 'block';
        transContainer.innerHTML = `<div class="translation-body">${cachedHtml}</div>`;
      } else {
        transContainer.style.display = 'none';
        transContainer.innerHTML = '<div class="translation-body"></div>';
      }
      item.appendChild(transContainer);

      item.addEventListener('mouseenter', () => {
        document.getElementById(`bbox_${block.id}`)?.classList.add('hover-bbox');
      });
      item.addEventListener('mouseleave', () => {
        document.getElementById(`bbox_${block.id}`)?.classList.remove('hover-bbox');
      });
      item.addEventListener('click', () => selectBlock(block.id, block.pageIndex, false));

      structuredContainer.appendChild(item);
    });

    if (continuousContainer && currentMarkdown) {
      continuousContainer.innerHTML = safeParsePaperMarkdown(currentMarkdown);
    }

    if (bilingualBatchControls) {
      bilingualBatchControls.style.display =
        currentViewMode === 'bilingual' && currentTab === 'markdown' ? 'flex' : 'none';
    }
  };

  const fetchAndRenderResult = async () => {
    try {
      const res = await fetch(`/api/ingest/result?taskId=${encodeURIComponent(taskId)}`);
      if (!res.ok) return;
      const data = await res.json();
      const result = data.result;
      if (!result) return;

      currentBlocks = result.layoutBlocks || [];
      currentMarkdown = result.markdown || '';
      currentRawJson = result.rawJson || JSON.stringify(currentBlocks, null, 2);

      pdfViewport.setBlocks(currentBlocks);
      renderStructuredBlocks();
      setProgress(null);

      if (btnDownloadZip) btnDownloadZip.style.display = 'inline-flex';
      if (btnExportBook) btnExportBook.style.display = 'inline-flex';
    } catch (err) {
      console.error('[PaperReader] 读取解析成果失败:', err);
    }
  };

  const notifyParentLibraryUpdated = () => {
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'ASTROLIB_LIBRARY_UPDATED' }, '*');
      }
    } catch {}
  };

  const startPolling = () => {
    if (pollTimer) clearInterval(pollTimer);
    renderStatePlaceholder({
      icon: 'hourglass_top',
      title: '正在后台解析文献',
      description: '左侧可先行翻阅原 PDF，结构化内容与公式提取完成后将自动呈现。',
    });

    pollTimer = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/ingest/status?taskId=${encodeURIComponent(taskId)}`);
        if (!res.ok) return;
        const data = await res.json();
        const task = data.task;
        currentTaskMeta = task;

        if (task.status === 'completed') {
          clearInterval(pollTimer!);
          pollTimer = null;
          setProgress(null);
          hideErrorBanner();
          notifyParentLibraryUpdated();
          void fetchAndRenderResult();
        } else if (task.status === 'failed' || (isIngestRunningState(task.status) && data.isActive === false)) {
          clearInterval(pollTimer!);
          pollTimer = null;
          setProgress(null);
          const msg = task.error || '解析任务失败或已中断，可点击下方按钮重试。';
          showErrorBanner(msg);
          notifyParentLibraryUpdated();
          renderStatePlaceholder({
            icon: 'error_outline',
            title: '文献解析未完成',
            description: msg,
            showRetry: true,
            taskMeta: task,
          });
        } else {
          setProgress(task.progress || 30);
        }
      } catch {}
    }, 2200);
  };

  // 转入书籍合集 M3 Dialog
  const exportModal = document.getElementById('export-modal') as any;
  const exportColChips = document.getElementById('export-collection-chips');
  const exportSlugInput = document.getElementById('export-slug-input') as any;
  const exportTitleInput = document.getElementById('export-title-input') as any;
  let selectedExportCol = '';

  const initExportChips = () => {
    if (!exportColChips) return;
    const chips = Array.from(exportColChips.querySelectorAll<any>('md-filter-chip'));
    if (chips.length > 0 && !selectedExportCol) {
      chips[0].selected = true;
      selectedExportCol = chips[0].getAttribute('data-col-slug') || '';
    }
    chips.forEach((chip) => {
      chip.addEventListener('click', (e: Event) => {
        const slug = chip.getAttribute('data-col-slug') || '';
        if (slug === selectedExportCol) {
          e.preventDefault();
          chip.selected = true;
          return;
        }
        selectedExportCol = slug;
        chips.forEach((c) => {
          c.selected = c === chip;
        });
      });
    });
  };
  initExportChips();

  btnDownloadZip?.addEventListener('click', () => {
    if (taskId) {
      window.location.href = `/api/ingest/download-zip?taskId=${encodeURIComponent(taskId)}`;
    }
  });

  btnExportBook?.addEventListener('click', () => {
    if (!exportModal) return;
    if (exportTitleInput && !exportTitleInput.value && currentTaskMeta?.fileName) {
      exportTitleInput.value = String(currentTaskMeta.fileName).replace(/\.pdf$/i, '');
    }
    if (typeof exportModal.show === 'function') exportModal.show();
    else exportModal.open = true;
  });

  document.getElementById('btn-close-export')?.addEventListener('click', () => {
    try {
      exportModal?.close?.();
    } catch {
      if (exportModal) exportModal.open = false;
    }
  });

  document.getElementById('btn-confirm-export')?.addEventListener('click', async () => {
    if (!taskId) return;
    const col = selectedExportCol;
    const slug = String(exportSlugInput?.value || '').trim();
    const title = String(exportTitleInput?.value || '').trim();
    if (!col || !slug) {
      showErrorBanner('请选择学科合集并填写书籍/论文 Slug 后再确认入库');
      return;
    }

    try {
      const res = await fetch('/api/ingest/export-book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, collectionSlug: col, bookSlug: slug, bookTitle: title || slug }),
      });
      const data = await res.json();
      if (data.success) {
        try {
          exportModal?.close?.();
        } catch {
          if (exportModal) exportModal.open = false;
        }
        notifyParentLibraryUpdated();
      } else {
        showErrorBanner(data.error || '转入书籍合集失败');
      }
    } catch (err: any) {
      showErrorBanner(`转入失败: ${err?.message || err}`);
    }
  });

  // 初始化入口：严格绑定单一文献
  if (!taskId) {
    if (emptyStage) emptyStage.style.display = 'flex';
    if (workspaceGrid) workspaceGrid.style.display = 'none';
    if (docNameText) docNameText.textContent = '未指定文献';
    return;
  }

  if (emptyStage) emptyStage.style.display = 'none';
  if (workspaceGrid) workspaceGrid.style.display = 'grid';

  void (async () => {
    try {
      setProgress(15);
      const res = await fetch(`/api/ingest/status?taskId=${encodeURIComponent(taskId)}`);
      if (!res.ok) throw new Error('未找到对应的文献记录');
      const data = await res.json();
      const task = data.task;
      currentTaskMeta = task;

      const cleanTitle = String(task.fileName || taskId).replace(/\.pdf$/i, '');
      if (docNameText) {
        docNameText.textContent = cleanTitle;
        docNameText.title = cleanTitle;
      }
      pdfViewport.setTotalPagesHint(task.pageCount || 1);
      void pdfViewport.loadPdf(taskId);

      if (task.status === 'completed') {
        await fetchAndRenderResult();
      } else if (isIngestRunningState(task.status) && data.isActive !== false) {
        setProgress(task.progress || 25);
        startPolling();
      } else if (task.status === 'idle') {
        setProgress(null);
        renderStatePlaceholder({
          icon: 'pending',
          title: '文献尚未解析',
          description: '该文献已上传原 PDF，可点击下方按钮立即开始提取结构化排版与公式。',
          showRetry: true,
          taskMeta: task,
        });
      } else {
        setProgress(null);
        const msg = task.error || '上次解析未完成或发生异常，请重试。';
        showErrorBanner(msg);
        renderStatePlaceholder({
          icon: 'error_outline',
          title: '解析失败或已中断',
          description: msg,
          showRetry: true,
          taskMeta: task,
        });
      }
    } catch (err: any) {
      setProgress(null);
      if (emptyStage) emptyStage.style.display = 'flex';
      if (workspaceGrid) workspaceGrid.style.display = 'none';
      showErrorBanner(err?.message || '无法加载指定文献');
    }
  })();
}
