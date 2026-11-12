/**
 * src/pages/workspace/ingest-controller.ts
 * ============================================================================
 * AstroLib 学术文献研读工作台核心控制器 (Material 3 + Chrome 官方交互架构)
 * 严格对齐主页面品牌，统一归档设置，消除 AI SaaS 粗制滥造，支持 LaTeX 字体与行距微调
 * ============================================================================
 */

import { marked } from 'marked';
import katex from 'katex';

interface BlockItem {
  id: string;
  type: string;
  pageIndex: number;
  bbox: [number, number, number, number];
  pageWidth?: number;
  pageHeight?: number;
  text?: string;
  html?: string;
  caption?: string;
  level?: number;
  pageNumber?: string;
  fnIndex?: string;
}

export function initIngestWorkspace() {
  const urlParams = new URLSearchParams(window.location.search);
  let currentTaskId = urlParams.get('taskId') || '';
  let currentEngine: 'api' | 'agent' | 'local' = (localStorage.getItem('astrolib_ingest_engine') as any) || 'api';
  let currentViewMode: 'structured' | 'bilingual' | 'continuous' = 'structured';
  let currentTab: 'markdown' | 'json' = 'markdown';
  let translationProvider = localStorage.getItem('astrolib_trans_provider') || 'google';
  let pageRangesSetting = localStorage.getItem('astrolib_page_ranges') || '';
  const blockTranslationCache = new Map<string, string>();

  // 学术排版与字体偏好
  let currentReadingFont = localStorage.getItem('astrolib_reading_font') || 'latin-modern';
  let currentHeadingFont = localStorage.getItem('astrolib_heading_font') || 'default';
  let currentReadingLh = localStorage.getItem('astrolib_reading_lh') || 'standard';
  let currentReadingSize = localStorage.getItem('astrolib_reading_size') || 'standard';

  let currentBlocks: BlockItem[] = [];
  let currentMarkdown = '';
  let currentRawJson = '';
  let pdfDocInstance: any = null;
  let pollTimer: number | null = null;
  let currentPageIndex = 0; // 0-based
  let totalPageCount = 1;
  let currentScale = 1.0;
  let activeBlockId: string | null = null;

  // DOM 元素引用
  const sidebar = document.getElementById('ingest-sidebar');
  const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
  const btnCloseSidebar = document.getElementById('btn-close-sidebar');
  const taskListEl = document.getElementById('sidebar-task-list');
  const btnNewParse = document.getElementById('btn-new-parse');
  const fileInputHidden = document.getElementById('file-input-hidden') as HTMLInputElement;

  const docNameText = document.getElementById('doc-name-text');
  const docEnginePill = document.getElementById('doc-engine-pill');
  const progressFill = document.getElementById('m3-progress-fill');

  const viewStructured = document.getElementById('view-structured');
  const viewBilingual = document.getElementById('view-bilingual');
  const viewContinuous = document.getElementById('view-continuous');

  const btnParse = document.getElementById('btn-parse') as HTMLButtonElement;
  const btnParseText = document.getElementById('btn-parse-text');
  const btnDownloadZip = document.getElementById('btn-download-zip') as HTMLButtonElement;
  const btnExportBook = document.getElementById('btn-export-book') as HTMLButtonElement;

  // 统一设置模态框 DOM
  const btnOpenSettings = document.getElementById('btn-open-settings');
  const settingsModal = document.getElementById('settings-modal');
  const btnCloseSettings = document.getElementById('btn-close-settings');
  const btnSaveSettings = document.getElementById('btn-save-settings');
  const settingsEngineTiles = document.querySelectorAll('#settings-engine-group .m3-radio-tile');
  const settingsPageRangeInput = document.getElementById('settings-page-range') as HTMLInputElement;
  const settingsTransSelect = document.getElementById('settings-translate-provider') as HTMLSelectElement;
  const settingsTokenInput = document.getElementById('settings-token-input') as HTMLInputElement;
  const toggleClickToDefine = document.getElementById('toggle-click-to-define') as HTMLInputElement | null;
  const settingsDictProvider = document.getElementById('settings-dict-provider') as HTMLSelectElement | null;
  const btnBatchTransCurrent = document.getElementById('btn-batch-translate-current');
  const btnBatchTransAll = document.getElementById('btn-batch-translate-all');
  const fontPreviewSample = document.getElementById('font-preview-sample');
  const headingFontPreviewSample = document.getElementById('heading-font-preview-sample');
  const wordPopover = document.getElementById('m3-word-popover');

  // 错误提示横幅 DOM
  const errorBanner = document.getElementById('ingest-error-banner');
  const errorBannerText = document.getElementById('ingest-error-text');
  const btnCloseErrorBanner = document.getElementById('btn-close-error-banner');

  function showIngestErrorBanner(msg: string) {
    if (errorBannerText) errorBannerText.textContent = msg;
    if (errorBanner) errorBanner.style.display = 'flex';
  }

  function hideIngestErrorBanner() {
    if (errorBanner) errorBanner.style.display = 'none';
  }

  btnCloseErrorBanner?.addEventListener('click', hideIngestErrorBanner);

  // 双语研判即点即译设置
  let clickToDefineEnabled = localStorage.getItem('mineru_click_to_define') !== 'false';
  let dictProviderSetting = localStorage.getItem('astrolib_dict_provider') || 'auto';
  let currentAudio: HTMLAudioElement | null = null;
  let currentLookedUpWord = '';
  let currentSentenceContext = '';

  // 快捷排版选项 DOM
  const quickFontSelect = document.getElementById('quick-font-select') as HTMLSelectElement;
  const quickHeadingFontSelect = document.getElementById('quick-heading-font-select') as HTMLSelectElement;
  const quickLhSelect = document.getElementById('quick-lh-select') as HTMLSelectElement;
  const btnLhCompact = document.getElementById('btn-lh-compact');
  const btnLhStandard = document.getElementById('btn-lh-standard');
  const btnLhSpacious = document.getElementById('btn-lh-spacious');

  // PDF 控件
  const pdfPagePrevBtn = document.getElementById('pdf-page-prev') as HTMLButtonElement;
  const pdfPageNextBtn = document.getElementById('pdf-page-next') as HTMLButtonElement;
  const pdfPageInput = document.getElementById('pdf-page-input') as HTMLInputElement;
  const pdfPageTotal = document.getElementById('pdf-page-total');
  const pdfZoomOutBtn = document.getElementById('pdf-zoom-out');
  const pdfZoomInBtn = document.getElementById('pdf-zoom-in');
  const pdfZoomFitBtn = document.getElementById('pdf-zoom-fit');
  const pdfZoomVal = document.getElementById('pdf-zoom-val');
  const pdfCanvasScrollArea = document.getElementById('pdf-canvas-scroll-area');

  // 内容视窗与 Tab
  const tabMarkdown = document.getElementById('tab-markdown');
  const tabJson = document.getElementById('tab-json');
  const btnCopyContent = document.getElementById('btn-copy-content');
  const contentStatsText = document.getElementById('content-stats-text');
  const contentScrollArea = document.getElementById('content-scroll-area');
  const structuredBlocksContainer = document.getElementById('structured-blocks-container');
  const continuousReadingContainer = document.getElementById('continuous-reading-container');
  const jsonViewContainer = document.getElementById('json-view-container');

  // 物理版面与结构化元素显示偏好 (Local Storage 持久化)
  let showPageDividers = localStorage.getItem('astrolib_show_page_dividers') !== 'false';
  let showPageMeta = localStorage.getItem('astrolib_show_page_meta') !== 'false';
  let enablePdfTransition = localStorage.getItem('astrolib_pdf_page_transition') !== 'false';

  const toggleShowPageDividers = document.getElementById('toggle-show-page-dividers') as HTMLInputElement;
  const toggleShowPageMeta = document.getElementById('toggle-show-page-meta') as HTMLInputElement;
  const togglePdfPageTransition = document.getElementById('toggle-pdf-page-transition') as HTMLInputElement;
  const footnotePopover = document.getElementById('doc-footnote-popover');

  let isScrollingProgrammatically = false;
  let scrollSyncDebounceTimer: any = null;
  let activeRenderTask: any = null;
  let renderTaskSeq = 0;

  function applyLayoutVisibilitySettings() {
    document.body.classList.toggle('hide-page-dividers', !showPageDividers);
    document.body.classList.toggle('hide-page-meta', !showPageMeta);
    if (toggleShowPageDividers) toggleShowPageDividers.checked = showPageDividers;
    if (toggleShowPageMeta) toggleShowPageMeta.checked = showPageMeta;
    if (togglePdfPageTransition) togglePdfPageTransition.checked = enablePdfTransition;
  }
  applyLayoutVisibilitySettings();

  // ==========================================================================
  // 1. 学术排版、字体与行距应用系统
  // ==========================================================================
  function applyTypographySettings() {
    document.body.setAttribute('data-reading-font', currentReadingFont);
    document.body.setAttribute('data-heading-font', currentHeadingFont);
    document.body.setAttribute('data-reading-lh', currentReadingLh);
    document.body.setAttribute('data-reading-size', currentReadingSize);

    if (quickFontSelect) quickFontSelect.value = currentReadingFont;
    if (quickHeadingFontSelect) quickHeadingFontSelect.value = currentHeadingFont;
    if (quickLhSelect) quickLhSelect.value = currentReadingLh;

    // 同步设置面板内的正文字体 Chips 高亮
    document.querySelectorAll('#font-family-chips .m3-chip-item').forEach((el) => {
      const f = el.getAttribute('data-font');
      el.classList.toggle('active', f === currentReadingFont);
    });

    // 同步设置面板内的标题字体 Chips 高亮
    document.querySelectorAll('#heading-font-chips .m3-chip-item').forEach((el) => {
      const f = el.getAttribute('data-font');
      el.classList.toggle('active', f === currentHeadingFont);
    });

    document.querySelectorAll('#dialog-line-height-chips .m3-chip-item').forEach((el) => {
      const lh = el.getAttribute('data-lh');
      el.classList.toggle('active', lh === currentReadingLh);
    });

    document.querySelectorAll('#dialog-font-size-chips .m3-chip-item').forEach((el) => {
      const s = el.getAttribute('data-size');
      el.classList.toggle('active', s === currentReadingSize);
    });

    // 快捷行距切换高亮
    btnLhCompact?.classList.toggle('active', currentReadingLh === 'compact');
    btnLhStandard?.classList.toggle('active', currentReadingLh === 'standard');
    btnLhSpacious?.classList.toggle('active', currentReadingLh === 'spacious');

    // 样例预览字体更新 (正文)
    if (fontPreviewSample) {
      const fontVarMap: Record<string, string> = {
        'latin-modern': 'var(--font-tex-latin-modern)',
        'termes': 'var(--font-tex-termes)',
        'libertine': 'var(--font-tex-libertine)',
        'noto-serif': 'var(--font-tex-noto-serif)',
        'sans': 'var(--font-tex-sans)',
      };
      fontPreviewSample.style.fontFamily = fontVarMap[currentReadingFont] || 'inherit';
    }

    // 样例预览字体更新 (标题可变字重)
    if (headingFontPreviewSample) {
      const headingFontVarMap: Record<string, string> = {
        'default': 'var(--font-heading-default)',
        'inherit': 'inherit',
        'latin-modern': 'var(--font-tex-latin-modern)',
        'termes': 'var(--font-tex-termes)',
        'libertine': 'var(--font-tex-libertine)',
        'noto-serif': 'var(--font-tex-noto-serif)',
      };
      headingFontPreviewSample.style.fontFamily = headingFontVarMap[currentHeadingFont] || 'inherit';
    }
  }

  function setReadingFont(font: string) {
    currentReadingFont = font;
    localStorage.setItem('astrolib_reading_font', font);
    applyTypographySettings();
  }

  function setHeadingFont(font: string) {
    currentHeadingFont = font;
    localStorage.setItem('astrolib_heading_font', font);
    applyTypographySettings();
  }

  function setReadingLineHeight(lh: string) {
    currentReadingLh = lh;
    localStorage.setItem('astrolib_reading_lh', lh);
    applyTypographySettings();
  }

  function setReadingFontSize(size: string) {
    currentReadingSize = size;
    localStorage.setItem('astrolib_reading_size', size);
    applyTypographySettings();
  }

  // 绑定快捷排版控制器事件
  quickFontSelect?.addEventListener('change', (e) => {
    setReadingFont((e.target as HTMLSelectElement).value);
  });
  quickHeadingFontSelect?.addEventListener('change', (e) => {
    setHeadingFont((e.target as HTMLSelectElement).value);
  });
  quickLhSelect?.addEventListener('change', (e) => {
    setReadingLineHeight((e.target as HTMLSelectElement).value);
  });
  btnLhCompact?.addEventListener('click', () => setReadingLineHeight('compact'));
  btnLhStandard?.addEventListener('click', () => setReadingLineHeight('standard'));
  btnLhSpacious?.addEventListener('click', () => setReadingLineHeight('spacious'));

  // 绑定弹窗内 Chips 事件
  document.querySelectorAll('#font-family-chips .m3-chip-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const f = btn.getAttribute('data-font');
      if (f) setReadingFont(f);
    });
  });

  document.querySelectorAll('#heading-font-chips .m3-chip-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const f = btn.getAttribute('data-font');
      if (f) setHeadingFont(f);
    });
  });

  document.querySelectorAll('#dialog-line-height-chips .m3-chip-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const lh = btn.getAttribute('data-lh');
      if (lh) setReadingLineHeight(lh);
    });
  });

  document.querySelectorAll('#dialog-font-size-chips .m3-chip-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const s = btn.getAttribute('data-size');
      if (s) setReadingFontSize(s);
    });
  });

  // 初始化排版
  applyTypographySettings();

  // ==========================================================================
  // 2. 统一设置对话框 (Unified Settings Modal) 交互系统
  // ==========================================================================
  function openSettingsModal() {
    if (!settingsModal) return;
    settingsModal.style.display = 'flex';

    // 回填通道
    settingsEngineTiles.forEach((tile) => {
      const engine = tile.getAttribute('data-engine');
      const isCurrent = engine === currentEngine;
      tile.classList.toggle('selected', isCurrent);
      const radio = tile.querySelector('input[type="radio"]') as HTMLInputElement;
      if (radio) radio.checked = isCurrent;
    });

    // 回填切片
    if (settingsPageRangeInput) {
      settingsPageRangeInput.value = pageRangesSetting;
    }

    // 回填翻译引擎
    if (settingsTransSelect) {
      settingsTransSelect.value = translationProvider;
    }

    // 回填 Token (优先本地缓存，若无则探查后端存储的 token)
    if (settingsTokenInput) {
      const cachedToken = localStorage.getItem('mineru_api_token') || '';
      if (cachedToken) {
        settingsTokenInput.value = cachedToken;
      } else {
        fetch('/api/ingest/token')
          .then((r) => r.json())
          .then((data) => {
            if (data?.token && settingsTokenInput) {
              settingsTokenInput.value = data.token;
              localStorage.setItem('mineru_api_token', data.token);
            }
          })
          .catch(() => {});
      }
    }

    // 回填版面显示开关
    if (toggleShowPageDividers) {
      toggleShowPageDividers.checked = showPageDividers;
    }
    if (toggleShowPageMeta) {
      toggleShowPageMeta.checked = showPageMeta;
    }
    if (togglePdfPageTransition) {
      togglePdfPageTransition.checked = enablePdfTransition;
    }

    // 回填单词即点即译开关
    if (toggleClickToDefine) {
      toggleClickToDefine.checked = clickToDefineEnabled;
    }
    if (settingsDictProvider) {
      settingsDictProvider.value = dictProviderSetting;
    }
  }

  function closeSettingsModal() {
    if (settingsModal) settingsModal.style.display = 'none';
  }

  function saveSettings() {
    // 保存切片范围
    if (settingsPageRangeInput) {
      pageRangesSetting = settingsPageRangeInput.value.trim();
      localStorage.setItem('astrolib_page_ranges', pageRangesSetting);
    }

    // 保存翻译引擎
    if (settingsTransSelect) {
      translationProvider = settingsTransSelect.value;
      localStorage.setItem('astrolib_trans_provider', translationProvider);
    }

    // 保存 Token 并同步至后端服务
    if (settingsTokenInput) {
      const token = settingsTokenInput.value.trim();
      localStorage.setItem('mineru_api_token', token);
      fetch('/api/ingest/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      }).catch(() => {});
    }

    // 保存版面显示偏好
    if (toggleShowPageDividers) {
      showPageDividers = toggleShowPageDividers.checked;
      localStorage.setItem('astrolib_show_page_dividers', String(showPageDividers));
    }
    if (toggleShowPageMeta) {
      showPageMeta = toggleShowPageMeta.checked;
      localStorage.setItem('astrolib_show_page_meta', String(showPageMeta));
    }
    if (togglePdfPageTransition) {
      enablePdfTransition = togglePdfPageTransition.checked;
      localStorage.setItem('astrolib_pdf_page_transition', String(enablePdfTransition));
    }

    // 保存单词即点即译偏好
    if (toggleClickToDefine) {
      clickToDefineEnabled = toggleClickToDefine.checked;
      localStorage.setItem('mineru_click_to_define', String(clickToDefineEnabled));
      updateClickToDefineState();
    }
    if (settingsDictProvider) {
      dictProviderSetting = settingsDictProvider.value;
      localStorage.setItem('astrolib_dict_provider', dictProviderSetting);
    }

    applyLayoutVisibilitySettings();

    // 更新顶栏引擎提示
    updateEngineBadge();
    closeSettingsModal();
  }

  btnOpenSettings?.addEventListener('click', openSettingsModal);
  btnCloseSettings?.addEventListener('click', closeSettingsModal);
  btnSaveSettings?.addEventListener('click', saveSettings);

  // 点击背景遮罩关闭
  settingsModal?.addEventListener('click', (e) => {
    if (e.target === settingsModal) closeSettingsModal();
  });

  // 键盘 Esc 关闭
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && settingsModal?.style.display === 'flex') {
      closeSettingsModal();
    }
  });

  // 通道单选交互
  settingsEngineTiles.forEach((tile) => {
    tile.addEventListener('click', () => {
      const engine = tile.getAttribute('data-engine') as 'api' | 'agent' | 'local';
      if (!engine) return;
      currentEngine = engine;
      localStorage.setItem('astrolib_ingest_engine', engine);

      settingsEngineTiles.forEach((t) => t.classList.remove('selected'));
      tile.classList.add('selected');
      const radio = tile.querySelector('input[type="radio"]') as HTMLInputElement;
      if (radio) radio.checked = true;

      updateEngineBadge();
    });
  });

  function updateEngineBadge() {
    if (!docEnginePill) return;
    const nameMap = {
      api: '官方 VLM 3.4.x',
      agent: '免密 Agent',
      local: '本机硬件加速',
    };
    docEnginePill.textContent = nameMap[currentEngine] || '高精排版引擎';
  }
  updateEngineBadge();

  // 批量研判按钮绑定
  btnBatchTransCurrent?.addEventListener('click', () => {
    closeSettingsModal();
    setViewMode('bilingual');
    translateCurrentPageBlocks(true);
  });

  btnBatchTransAll?.addEventListener('click', () => {
    closeSettingsModal();
    setViewMode('bilingual');
    translateAllBlocks();
  });

  // ==========================================================================
  // 3. 侧边栏折叠/展开与历史任务加载
  // ==========================================================================
  btnToggleSidebar?.addEventListener('click', () => {
    sidebar?.classList.toggle('collapsed');
  });
  btnCloseSidebar?.addEventListener('click', () => {
    sidebar?.classList.add('collapsed');
  });

  async function loadTaskList() {
    if (!taskListEl) return;
    try {
      const res = await fetch('/api/ingest/tasks');
      if (!res.ok) return;
      const data = await res.json();
      const tasks = data.tasks || [];
      taskListEl.innerHTML = '';

      tasks.forEach((t: any) => {
        const item = document.createElement('a');
        item.className = `task-item ${t.taskId === currentTaskId ? 'active' : ''}`;
        item.href = `?taskId=${encodeURIComponent(t.taskId)}`;
        item.onclick = (e) => {
          e.preventDefault();
          switchTask(t.taskId);
        };

        const sizeMb = (t.fileSize / (1024 * 1024)).toFixed(1);
        const statusClass = t.status === 'completed' ? '' : t.status === 'failed' ? 'failed' : 'processing';

        item.innerHTML = `
          <div class="task-item-icon">
            <span class="material-symbols-outlined" style="font-size: 20px;">description</span>
          </div>
          <div class="task-item-content">
            <span class="task-item-name" title="${t.fileName}">${t.fileName}</span>
            <div class="task-item-meta">
              <span class="task-status-indicator ${statusClass}"></span>
              <span>${t.pageCount ? t.pageCount + '页' : '待解析'} · ${sizeMb}M</span>
            </div>
          </div>
        `;
        taskListEl.appendChild(item);
      });
    } catch {
      // ignore
    }
  }

  function switchTask(taskId: string) {
    if (currentTaskId === taskId) return;
    currentTaskId = taskId;
    const newUrl = `${window.location.pathname}?taskId=${encodeURIComponent(taskId)}`;
    window.history.pushState({ taskId }, '', newUrl);

    document.querySelectorAll('.task-item').forEach((el) => {
      const href = el.getAttribute('href') || '';
      el.classList.toggle('active', href.includes(taskId));
    });

    loadTaskInfo(taskId);
  }

  // ==========================================================================
  // 4. 上传新 PDF
  // ==========================================================================
  btnNewParse?.addEventListener('click', () => {
    fileInputHidden?.click();
  });

  fileInputHidden?.addEventListener('change', async () => {
    const file = fileInputHidden.files?.[0];
    if (!file) return;

    try {
      updateProgress(15);
      const res = await fetch('/api/ingest/upload', {
        method: 'POST',
        headers: {
          'x-file-name': encodeURIComponent(file.name),
          'x-engine': currentEngine,
        },
        body: file,
      });

      const data = await res.json();
      if (data.success && data.task) {
        loadTaskList();
        switchTask(data.task.taskId);
        try {
          if (window.parent && window.parent !== window) {
            window.parent.postMessage({ type: 'ASTROLIB_LIBRARY_UPDATED' }, '*');
          }
        } catch {}
      } else {
        alert('上传失败: ' + (data.error || '未知错误'));
      }
    } catch {
      alert('上传异常');
    } finally {
      fileInputHidden.value = '';
    }
  });

  // ==========================================================================
  // 5. 视图模式切换与 Tab 管理
  // ==========================================================================
  function setViewMode(mode: 'structured' | 'bilingual' | 'continuous') {
    currentViewMode = mode;
    viewStructured?.classList.toggle('active', mode === 'structured');
    viewBilingual?.classList.toggle('active', mode === 'bilingual');
    viewContinuous?.classList.toggle('active', mode === 'continuous');

    if (mode === 'structured' || mode === 'bilingual') {
      if (structuredBlocksContainer) structuredBlocksContainer.style.display = 'flex';
      if (continuousReadingContainer) continuousReadingContainer.style.display = 'none';

      // 仅在双语研判模式下展示已有的双语段落
      document.querySelectorAll('.block-item-translation').forEach((el) => {
        const transEl = el as HTMLElement;
        const hasText = transEl.innerText.trim().length > 0;
        transEl.style.display = mode === 'bilingual' && hasText ? 'block' : 'none';
      });

      if (mode === 'bilingual') {
        translateCurrentPageBlocks(false);
      }
    } else {
      if (structuredBlocksContainer) structuredBlocksContainer.style.display = 'none';
      if (continuousReadingContainer) continuousReadingContainer.style.display = 'block';
    }

    updateClickToDefineState();
    if (mode !== 'bilingual') {
      closeWordPopover();
    }
  }

  viewStructured?.addEventListener('click', () => setViewMode('structured'));
  viewBilingual?.addEventListener('click', () => setViewMode('bilingual'));
  viewContinuous?.addEventListener('click', () => setViewMode('continuous'));

  // Tab 切换 (Markdown vs JSON)
  tabMarkdown?.addEventListener('click', () => {
    currentTab = 'markdown';
    tabMarkdown.classList.add('active');
    tabJson?.classList.remove('active');
    if (jsonViewContainer) jsonViewContainer.style.display = 'none';
    if (currentViewMode === 'continuous') {
      if (continuousReadingContainer) continuousReadingContainer.style.display = 'block';
    } else {
      if (structuredBlocksContainer) structuredBlocksContainer.style.display = 'flex';
    }
  });

  tabJson?.addEventListener('click', () => {
    currentTab = 'json';
    tabJson.classList.add('active');
    tabMarkdown?.classList.remove('active');
    if (structuredBlocksContainer) structuredBlocksContainer.style.display = 'none';
    if (continuousReadingContainer) continuousReadingContainer.style.display = 'none';
    if (jsonViewContainer) {
      jsonViewContainer.style.display = 'block';
      if (!jsonViewContainer.textContent) {
        jsonViewContainer.textContent = currentRawJson || JSON.stringify(currentBlocks, null, 2);
      }
    }
  });

  btnCopyContent?.addEventListener('click', () => {
    const textToCopy = currentTab === 'markdown' ? currentMarkdown : currentRawJson || JSON.stringify(currentBlocks, null, 2);
    if (!textToCopy) return;
    navigator.clipboard.writeText(textToCopy).then(() => {
      const orig = btnCopyContent.innerHTML;
      btnCopyContent.textContent = '已复制!';
      setTimeout(() => (btnCopyContent.innerHTML = orig), 1500);
    });
  });

  // ==========================================================================
  // 6. 加载任务元数据与状态
  // ==========================================================================
  async function loadTaskInfo(taskId: string) {
    if (!taskId) return;
    try {
      updateProgress(15);
      const res = await fetch(`/api/ingest/status?taskId=${encodeURIComponent(taskId)}`);
      if (!res.ok) throw new Error('任务加载失败');
      const data = await res.json();
      const task = data.task;

      if (docNameText) docNameText.textContent = task.fileName;
      totalPageCount = task.pageCount || 1;
      if (pdfPageTotal) pdfPageTotal.textContent = `/ ${totalPageCount}`;
      btnParse.disabled = false;

      // 加载 PDF
      loadPdf(taskId);

      if (task.status === 'completed') {
        updateProgress(100);
        fetchAndRenderResult(taskId);
      } else if (['processing', 'uploading', 'waiting-file', 'downloading', 'unpacking'].includes(task.status)) {
        startPolling(taskId);
      }
    } catch (err) {
      console.error(err);
    }
  }

  // ==========================================================================
  // 7. PDF.js 加载与单页矢量高保真渲染
  // ==========================================================================
  async function loadPdf(taskId: string) {
    const pdfjs = (window as any).pdfjsLib;
    if (!pdfjs || !pdfCanvasScrollArea) return;
    try {
      const pdfUrl = `/api/ingest/pdf?taskId=${encodeURIComponent(taskId)}`;
      pdfDocInstance = await pdfjs.getDocument(pdfUrl).promise;
      totalPageCount = pdfDocInstance.numPages;
      if (pdfPageTotal) pdfPageTotal.textContent = `/ ${totalPageCount}`;

      renderPdfPage(currentPageIndex);
    } catch (err) {
      console.error('PDF 加载失败:', err);
    }
  }

  async function renderPdfPage(pageIdx: number) {
    if (!pdfDocInstance || !pdfCanvasScrollArea) return;
    if (pageIdx < 0 || pageIdx >= totalPageCount) return;

    currentPageIndex = pageIdx;
    if (pdfPageInput) pdfPageInput.value = String(pageIdx + 1);
    if (pdfPagePrevBtn) pdfPagePrevBtn.disabled = pageIdx === 0;
    if (pdfPageNextBtn) pdfPageNextBtn.disabled = pageIdx >= totalPageCount - 1;

    // 递增渲染序号并取消前序进行中的异步任务，杜绝快速翻页时的挤压迟滞
    const currentSeq = ++renderTaskSeq;
    if (activeRenderTask) {
      try {
        activeRenderTask.cancel();
      } catch {}
      activeRenderTask = null;
    }

    try {
      const page = await pdfDocInstance.getPage(pageIdx + 1);
      if (currentSeq !== renderTaskSeq) return;

      const unscaledViewport = page.getViewport({ scale: 1.0 });

      const containerWidth = Math.max(320, (pdfCanvasScrollArea.clientWidth || 600) - 48);
      const baseScale = containerWidth / unscaledViewport.width;
      const finalScale = baseScale * currentScale;
      const viewport = page.getViewport({ scale: finalScale });

      // 双缓冲：先在内存中构建新页容器与画布，渲染完成前不清除旧容器，彻底消灭空白白闪！
      const pageContainer = document.createElement('div');
      pageContainer.className = `pdf-page-container ${enablePdfTransition ? 'fade-transition' : ''}`;
      pageContainer.id = `pdf-page-${pageIdx}`;
      pageContainer.style.width = `${viewport.width}px`;
      pageContainer.style.height = `${viewport.height}px`;

      const canvas = document.createElement('canvas');
      canvas.className = 'pdf-page-canvas';
      const pixelRatio = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * pixelRatio);
      canvas.height = Math.floor(viewport.height * pixelRatio);
      canvas.style.width = '100%';
      canvas.style.height = '100%';

      const ctx = canvas.getContext('2d');
      if (pixelRatio !== 1) {
        ctx?.scale(pixelRatio, pixelRatio);
      }

      const renderTask = page.render({ canvasContext: ctx, viewport });
      activeRenderTask = renderTask;
      await renderTask.promise;
      activeRenderTask = null;

      // 如果在当前帧渲染期间触发了更新的翻页请求，丢弃当前陈旧结果
      if (currentSeq !== renderTaskSeq) return;

      // 标注叠加层
      const overlayLayer = document.createElement('div');
      overlayLayer.className = 'pdf-overlay-layer';
      overlayLayer.id = `pdf-overlay-${pageIdx}`;

      pageContainer.appendChild(canvas);
      pageContainer.appendChild(overlayLayer);

      // 渲染完成后瞬间无缝置换，新页柔和淡入（若开启渐变），零白闪！
      pdfCanvasScrollArea.replaceChildren(pageContainer);

      if (currentBlocks.length > 0) {
        renderBboxesForCurrentPage(pageIdx);
      }
    } catch (e: any) {
      if (e?.name !== 'RenderingCancelledException') {
        console.error(`渲染第 ${pageIdx + 1} 页出错:`, e);
      }
    }
  }

  // 翻页事件
  pdfPagePrevBtn?.addEventListener('click', () => {
    if (currentPageIndex > 0) gotoPage(currentPageIndex - 1, true);
  });
  pdfPageNextBtn?.addEventListener('click', () => {
    if (currentPageIndex < totalPageCount - 1) gotoPage(currentPageIndex + 1, true);
  });

  pdfPageInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const val = parseInt(pdfPageInput.value, 10);
      if (!isNaN(val) && val >= 1 && val <= totalPageCount) {
        gotoPage(val - 1, true);
      } else {
        pdfPageInput.value = String(currentPageIndex + 1);
      }
    }
  });

  // 缩放事件
  pdfZoomInBtn?.addEventListener('click', () => {
    currentScale = Math.min(2.5, currentScale + 0.15);
    updateZoomDisplay();
    renderPdfPage(currentPageIndex);
  });
  pdfZoomOutBtn?.addEventListener('click', () => {
    currentScale = Math.max(0.5, currentScale - 0.15);
    updateZoomDisplay();
    renderPdfPage(currentPageIndex);
  });
  pdfZoomFitBtn?.addEventListener('click', () => {
    currentScale = 1.0;
    updateZoomDisplay();
    renderPdfPage(currentPageIndex);
  });

  function updateZoomDisplay() {
    if (pdfZoomVal) pdfZoomVal.textContent = `${Math.round(currentScale * 100)}%`;
  }

  // ==========================================================================
  // 8. 渲染当前页高精度 Bounding Box 标注选框
  // ==========================================================================
  function renderBboxesForCurrentPage(pageIdx: number) {
    const overlay = document.getElementById(`pdf-overlay-${pageIdx}`);
    if (!overlay) return;
    overlay.innerHTML = '';

    const typeNameMap: Record<string, string> = {
      title: '标题',
      text: '文本',
      equation: '公式',
      table: '表格',
      image: '插图',
      figure: '插图',
      list: '列表',
      header: '页眉',
      footer: '页脚',
      footnote: '脚注',
      page_divider: '分页',
      page_meta: '元注',
    };

    const pageBlocks = currentBlocks.filter((b) => b.pageIndex === pageIdx);

    pageBlocks.forEach((block) => {
      // 分页虚线标尺与元注徽标不在 PDF 画面绘制全宽选框
      if (block.type === 'page_divider' || block.type === 'page_meta') return;

      const bbox = block.bbox;
      if (!bbox || bbox.length !== 4) return;

      const pw = block.pageWidth || 1000;
      const ph = block.pageHeight || 1000;
      const [x0, y0, x1, y1] = bbox;
      const leftPct = (x0 / pw) * 100;
      const topPct = (y0 / ph) * 100;
      const widthPct = ((x1 - x0) / pw) * 100;
      const heightPct = ((y1 - y0) / ph) * 100;

      const rect = document.createElement('div');
      rect.className = `bbox-highlight type-${block.type || 'text'}`;
      rect.id = `bbox_${block.id}`;
      rect.style.left = `${leftPct}%`;
      rect.style.top = `${topPct}%`;
      rect.style.width = `${widthPct}%`;
      rect.style.height = `${heightPct}%`;

      const tag = document.createElement('span');
      tag.className = 'bbox-tag';
      tag.textContent = typeNameMap[block.type] || block.type;
      rect.appendChild(tag);

      rect.addEventListener('mouseenter', () => {
        const targetCard = document.getElementById(`card_${block.id}`);
        if (targetCard) targetCard.classList.add('hover-block');
      });
      rect.addEventListener('mouseleave', () => {
        const targetCard = document.getElementById(`card_${block.id}`);
        if (targetCard) targetCard.classList.remove('hover-block');
      });

      rect.addEventListener('click', (e) => {
        e.stopPropagation();
        selectBlock(block.id, block.pageIndex);
      });

      overlay.appendChild(rect);
    });

    if (activeBlockId) {
      const activeRect = document.getElementById(`bbox_${activeBlockId}`);
      if (activeRect) activeRect.classList.add('active');
    }
  }

  // ==========================================================================
  // 9. 选中选框与双向联动
  // ==========================================================================
  function selectBlock(blockId: string, pageIdx: number, scrollRight = true) {
    activeBlockId = blockId;

    document.querySelectorAll('.bbox-floating-toolbar').forEach((el) => el.remove());
    document.querySelectorAll('.bbox-highlight').forEach((r) => r.classList.remove('active'));

    if (currentPageIndex !== pageIdx) {
      gotoPage(pageIdx, false);
    }

    const targetRect = document.getElementById(`bbox_${blockId}`);
    if (targetRect) {
      targetRect.classList.add('active');

      const block = currentBlocks.find((b) => b.id === blockId);
      const floatBar = document.createElement('div');
      floatBar.className = 'bbox-floating-toolbar';
      floatBar.innerHTML = `
        <span class="floating-type-badge">${block?.type === 'title' ? '标题' : block?.type === 'equation' ? '公式' : block?.type === 'footnote' ? '脚注' : '文本'}</span>
        <button type="button" class="floating-tool-btn" id="float-btn-translate" title="双语学术研判" aria-label="双语学术研判">
          <span class="material-symbols-outlined" style="font-size: 14px;">translate</span>
        </button>
        <button type="button" class="floating-tool-btn" id="float-btn-copy" title="复制文本" aria-label="复制文本">
          <span class="material-symbols-outlined" style="font-size: 14px;">content_copy</span>
        </button>
      `;

      floatBar.querySelector('#float-btn-translate')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (block) {
          setViewMode('bilingual');
          translateSingleBlock(block, true);
        }
      });
      floatBar.querySelector('#float-btn-copy')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (block?.text) {
          navigator.clipboard.writeText(block.text);
        }
      });

      targetRect.appendChild(floatBar);
    }

    document.querySelectorAll('.structured-block-item').forEach((c) => c.classList.remove('active-block'));
    const targetCard = document.getElementById(`card_${blockId}`);
    const contentScrollArea = document.getElementById('content-scroll-area');
    if (targetCard && contentScrollArea) {
      targetCard.classList.add('active-block');
      if (scrollRight) {
        isScrollingProgrammatically = true;
        setTimeout(() => { isScrollingProgrammatically = false; }, 600);

        const containerRect = contentScrollArea.getBoundingClientRect();
        const cardRect = targetCard.getBoundingClientRect();
        const targetScrollTop = contentScrollArea.scrollTop + (cardRect.top - containerRect.top) - (containerRect.height / 2) + (cardRect.height / 2);
        contentScrollArea.scrollTo({ top: Math.max(0, targetScrollTop), behavior: 'smooth' });
      }
    }
  }

  function gotoPage(pageIdx: number, syncScrollRight = true) {
    if (pageIdx < 0 || pageIdx >= totalPageCount) return;
    renderPdfPage(pageIdx);

    if (syncScrollRight && structuredBlocksContainer) {
      isScrollingProgrammatically = true;
      setTimeout(() => { isScrollingProgrammatically = false; }, 600);

      const firstPageBlock = currentBlocks.find((b) => b.pageIndex === pageIdx && b.type !== 'page_divider' && b.type !== 'page_meta') || currentBlocks.find((b) => b.pageIndex === pageIdx);
      const contentScrollArea = document.getElementById('content-scroll-area');
      if (firstPageBlock && contentScrollArea) {
        const card = document.getElementById(`card_${firstPageBlock.id}`);
        if (card) {
          const containerRect = contentScrollArea.getBoundingClientRect();
          const cardRect = card.getBoundingClientRect();
          const targetScrollTop = contentScrollArea.scrollTop + (cardRect.top - containerRect.top) - 20;
          contentScrollArea.scrollTo({ top: Math.max(0, targetScrollTop), behavior: 'smooth' });
        }
      }
    }
  }

  // ==========================================================================
  // 10. 获取并渲染解析结果 (Markdown + Blocks + 消除 AI SaaS 粗糙痕迹)
  // ==========================================================================
  async function fetchAndRenderResult(taskId: string) {
    try {
      const res = await fetch(`/api/ingest/result?taskId=${encodeURIComponent(taskId)}`);
      if (!res.ok) return;
      const data = await res.json();
      const result = data.result;

      currentBlocks = result.layoutBlocks || [];
      currentMarkdown = result.markdown || '';
      currentRawJson = result.rawJson || JSON.stringify(currentBlocks, null, 2);

      if (contentStatsText) {
        contentStatsText.textContent = `共 ${currentBlocks.length} 个结构段落 · ${currentMarkdown.length} 字符`;
      }

      renderRightPaneContent(taskId);
      renderBboxesForCurrentPage(currentPageIndex);

      if (btnDownloadZip) btnDownloadZip.style.display = 'inline-flex';
      if (btnExportBook) btnExportBook.style.display = 'inline-flex';
    } catch (e) {
      console.error('获取结果失败:', e);
    }
  }

  function renderRightPaneContent(taskId: string) {
    if (!structuredBlocksContainer) return;
    structuredBlocksContainer.innerHTML = '';

    let lastPageWithFootnote = -1;

    currentBlocks.forEach((block) => {
      if (!block.html && !block.text) return;

      // 1. 物理跨页虚线标尺 (Page Divider)
      if (block.type === 'page_divider') {
        const item = document.createElement('div');
        item.className = 'structured-block-item type-page_divider';
        item.id = `card_${block.id}`;
        item.setAttribute('data-block-id', block.id);
        item.setAttribute('data-page-index', String(block.pageIndex));
        item.innerHTML = block.html || '';

        const pageNumBtn = item.querySelector('.doc-page-number');
        pageNumBtn?.addEventListener('click', (e) => {
          e.stopPropagation();
          gotoPage(block.pageIndex, false);
        });

        structuredBlocksContainer.appendChild(item);
        return;
      }

      // 2. 页外刊物与水印折叠元注 (Page Meta Badge)
      if (block.type === 'page_meta') {
        const item = document.createElement('div');
        item.className = 'structured-block-item type-page_meta';
        item.id = `card_${block.id}`;
        item.setAttribute('data-block-id', block.id);
        item.setAttribute('data-page-index', String(block.pageIndex));
        item.innerHTML = block.html || '';
        structuredBlocksContainer.appendChild(item);
        return;
      }

      // 3. 页底独立学术脚注 (Page Footnotes Zone)
      if (block.type === 'footnote') {
        if (lastPageWithFootnote !== block.pageIndex) {
          lastPageWithFootnote = block.pageIndex;
          const rule = document.createElement('div');
          rule.className = 'doc-footnote-page-rule';
          structuredBlocksContainer.appendChild(rule);
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

        // 仅保留复制动作
        const actions = document.createElement('div');
        actions.className = 'block-hover-actions';
        actions.innerHTML = `
          <button type="button" class="block-hover-btn btn-action-copy" title="复制脚注" aria-label="复制脚注">
            <span class="material-symbols-outlined" style="font-size: 13px;">content_copy</span>
          </button>
        `;
        actions.querySelector('.btn-action-copy')?.addEventListener('click', (e) => {
          e.stopPropagation();
          if (block.text) navigator.clipboard.writeText(block.text);
        });
        item.appendChild(actions);

        // 绑定返回正文引用处箭头链接
        const backLink = item.querySelector('.fn-back-link');
        backLink?.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const refId = `ref_p${block.pageIndex}_${block.fnIndex}`;
          const refEl = document.getElementById(refId);
          if (refEl) {
            refEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            refEl.classList.remove('target-flash');
            void refEl.offsetWidth;
            refEl.classList.add('target-flash');
          }
        });

        item.addEventListener('mouseenter', () => {
          const targetBbox = document.getElementById(`bbox_${block.id}`);
          if (targetBbox) targetBbox.classList.add('hover-bbox');
        });
        item.addEventListener('mouseleave', () => {
          const targetBbox = document.getElementById(`bbox_${block.id}`);
          if (targetBbox) targetBbox.classList.remove('hover-bbox');
        });
        item.addEventListener('click', () => {
          selectBlock(block.id, block.pageIndex, false);
        });

        structuredBlocksContainer.appendChild(item);
        return;
      }

      // 4. 普通正文元素（标题、段落、公式、图表、列表）
      const item = document.createElement('div');
      item.className = `structured-block-item type-${block.type || 'text'}`;
      item.id = `card_${block.id}`;
      item.setAttribute('data-block-id', block.id);
      item.setAttribute('data-page-index', String(block.pageIndex));

      // 正文内容
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
        const alt = match ? match[1] : (block.caption || '插图');
        const src = match ? match[2] : '';
        const imgName = src.split('/').pop() || `img_${block.id}.png`;
        body.innerHTML = `<figure class="doc-figure"><img src="/api/ingest/image?taskId=${encodeURIComponent(taskId)}&name=${encodeURIComponent(imgName)}" alt="${alt}" loading="lazy" />${alt ? `<figcaption class="doc-figcaption">${alt}</figcaption>` : ''}</figure>`;
      } else {
        body.innerHTML = safeParseMarkdown(block.text || '', taskId);
      }

      // 绑定正文内脚注角标交互（悬停浮窗 + 点击平滑滚动至页底附注并高亮）
      body.querySelectorAll('.doc-footnote-ref').forEach((refEl) => {
        const fnSym = refEl.getAttribute('data-fn-symbol');
        const pIdx = refEl.getAttribute('data-page-index');

        refEl.addEventListener('mouseenter', () => {
          if (!footnotePopover) return;
          const targetFn = currentBlocks.find(
            (b) => b.id === `fn_p${pIdx}_${fnSym}` || (b.pageIndex === Number(pIdx) && b.type === 'footnote' && b.fnIndex === fnSym)
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

        refEl.addEventListener('mouseleave', () => {
          footnotePopover?.classList.remove('active');
        });

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

      // 悬停操作组：极简 M3 药丸，彻底取代粗糙的灰白大方框！
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
        translateSingleBlock(block, true);
      });
      actions.querySelector('.btn-action-copy')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (block.text) navigator.clipboard.writeText(block.text);
      });
      item.appendChild(actions);

      // 学术双语研判译文容器：保持负空间，未翻译时绝不插入刺眼的灰色大框！
      const transContainer = document.createElement('div');
      transContainer.className = 'block-item-translation';
      transContainer.id = `trans_${block.id}`;
      const cachedHtml = blockTranslationCache.get(block.id);
      if (cachedHtml && currentViewMode === 'bilingual') {
        transContainer.style.display = 'block';
        transContainer.innerHTML = `<div class="translation-body">${cachedHtml}</div>`;
      } else {
        transContainer.style.display = 'none';
        transContainer.innerHTML = '<div class="translation-body"></div>';
      }
      item.appendChild(transContainer);

      item.addEventListener('mouseenter', () => {
        const targetBbox = document.getElementById(`bbox_${block.id}`);
        if (targetBbox) targetBbox.classList.add('hover-bbox');
      });
      item.addEventListener('mouseleave', () => {
        const targetBbox = document.getElementById(`bbox_${block.id}`);
        if (targetBbox) targetBbox.classList.remove('hover-bbox');
      });

      item.addEventListener('click', () => {
        selectBlock(block.id, block.pageIndex, false);
      });

      structuredBlocksContainer.appendChild(item);
    });

    if (continuousReadingContainer && currentMarkdown) {
      continuousReadingContainer.innerHTML = safeParseMarkdown(currentMarkdown, taskId);
    }
  }

  // 右侧正文滚动时静默防抖同步左侧 PDF 翻页 (双向联动)
  contentScrollArea?.addEventListener('scroll', () => {
    if (isScrollingProgrammatically || currentBlocks.length === 0) return;
    clearTimeout(scrollSyncDebounceTimer);
    scrollSyncDebounceTimer = setTimeout(() => {
      if (!structuredBlocksContainer || !contentScrollArea) return;
      const containerRect = contentScrollArea.getBoundingClientRect();
      const cards = structuredBlocksContainer.querySelectorAll('.structured-block-item[data-page-index]');
      let detectedPageIndex = currentPageIndex;

      for (const card of cards) {
        const r = card.getBoundingClientRect();
        if (r.top >= containerRect.top - 60 && r.top <= containerRect.top + containerRect.height * 0.4) {
          const p = parseInt(card.getAttribute('data-page-index') || '0', 10);
          if (!isNaN(p)) {
            detectedPageIndex = p;
            break;
          }
        }
      }

      if (detectedPageIndex !== currentPageIndex && detectedPageIndex >= 0 && detectedPageIndex < totalPageCount) {
        currentPageIndex = detectedPageIndex;
        if (pdfPageInput) pdfPageInput.value = String(currentPageIndex + 1);
        if (pdfPagePrevBtn) pdfPagePrevBtn.disabled = currentPageIndex === 0;
        if (pdfPageNextBtn) pdfPageNextBtn.disabled = currentPageIndex >= totalPageCount - 1;
        renderPdfPage(currentPageIndex);
      }
    }, 120);
  }, { passive: true });

  // Markdown 与 KaTeX 解析保护
  function safeParseMarkdown(content: string, taskId: string): string {
    if (!content) return '';
    const displayMathMap: string[] = [];
    const inlineMathMap: string[] = [];

    let protectedMd = content.replace(/\$\$([\s\S]*?)\$\$/g, (_, eq) => {
      const idx = displayMathMap.length;
      try {
        const rendered = katex.renderToString(eq.trim(), { displayMode: true, throwOnError: false });
        displayMathMap.push(`<div class="doc-equation-display">${rendered}</div>`);
      } catch {
        displayMathMap.push(`<div class="doc-equation-display">$$\n${eq}\n$$</div>`);
      }
      return `\n\n%%ASTROLIB_DISPLAY_MATH_${idx}%%\n\n`;
    });

    protectedMd = protectedMd.replace(/\$([^\$\n]+?)\$/g, (_, eq) => {
      const idx = inlineMathMap.length;
      try {
        const rendered = katex.renderToString(eq.trim(), { displayMode: false, throwOnError: false });
        inlineMathMap.push(`<span class="katex-inline-wrapper">${rendered}</span>`);
      } catch {
        inlineMathMap.push(`$${eq}$`);
      }
      return `%%ASTROLIB_INLINE_MATH_${idx}%%`;
    });

    let html = '';
    try {
      html = marked.parse(protectedMd) as string;
    } catch {
      html = `<pre>${content}</pre>`;
    }

    html = html.replace(/%%ASTROLIB_DISPLAY_MATH_(\d+)%%/g, (_, idx) => displayMathMap[parseInt(idx, 10)] || '');
    html = html.replace(/%%ASTROLIB_INLINE_MATH_(\d+)%%/g, (_, idx) => inlineMathMap[parseInt(idx, 10)] || '');
    return html;
  }

  // ==========================================================================
  // 11. 双语研判翻译调用
  // ==========================================================================
  async function translateSingleBlock(block: BlockItem, forceRefresh = false) {
    const transEl = document.getElementById(`trans_${block.id}`);
    if (!transEl) return;
    const transBody = transEl.querySelector('.translation-body') as HTMLElement;
    if (!transBody) return;

    if (!forceRefresh && blockTranslationCache.has(block.id)) {
      transEl.style.display = 'block';
      transBody.innerHTML = blockTranslationCache.get(block.id)!;
      return;
    }

    transEl.style.display = 'block';
    transBody.innerHTML = '<span class="translation-loading">正在进行结构保护学术研判...</span>';

    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: block.text,
          provider: translationProvider,
          sourceLang: 'en',
          targetLang: 'zh',
          preserveStructure: true,
        }),
      });
      const data = await res.json();
      if (data.ok && data.translatedText) {
        const rendered = safeParseMarkdown(data.translatedText, currentTaskId);
        blockTranslationCache.set(block.id, rendered);
        transBody.innerHTML = rendered;
      } else {
        transBody.innerHTML = `<span style="color:#ea4335;">研判未命中: ${data.error || '通道繁忙'}</span>`;
      }
    } catch (e: any) {
      transBody.innerHTML = `<span style="color:#ea4335;">研判异常: ${e.message}</span>`;
    }
  }

  async function translateCurrentPageBlocks(force = false) {
    const pageBlocks = currentBlocks.filter((b) => b.pageIndex === currentPageIndex && (b.type === 'text' || b.type === 'title') && b.text);
    for (const b of pageBlocks) {
      if (force || !blockTranslationCache.has(b.id)) {
        await translateSingleBlock(b, force);
      }
    }
  }

  async function translateAllBlocks() {
    const textBlocks = currentBlocks.filter((b) => (b.type === 'text' || b.type === 'title') && b.text);
    for (const b of textBlocks) {
      if (!blockTranslationCache.has(b.id)) {
        await translateSingleBlock(b, false);
      }
    }
  }

  // ==========================================================================
  // 12. 解析与轮询管理
  // ==========================================================================
  btnParse?.addEventListener('click', async () => {
    if (!currentTaskId) return;
    hideIngestErrorBanner();
    btnParse.disabled = true;
    if (btnParseText) btnParseText.textContent = '解析中...';

    const token = (localStorage.getItem('mineru_api_token') || '').trim();

    try {
      const res = await fetch('/api/ingest/parse', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          taskId: currentTaskId,
          engine: currentEngine,
          pageRanges: pageRangesSetting,
          token: token || undefined,
        }),
      });

      if (res.ok) {
        startPolling(currentTaskId);
      } else {
        btnParse.disabled = false;
        if (btnParseText) btnParseText.textContent = '重试解析';
        const errJson = await res.json().catch(() => ({}));
        showIngestErrorBanner(errJson.error || '解析任务启动失败，请检查请求参数或服务状态。');
      }
    } catch (err: any) {
      btnParse.disabled = false;
      if (btnParseText) btnParseText.textContent = '开始解析';
      showIngestErrorBanner('网络连接失败，无法提交解析任务：' + (err?.message || String(err)));
    }
  });

  function startPolling(taskId: string) {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/ingest/status?taskId=${encodeURIComponent(taskId)}`);
        if (!res.ok) return;
        const data = await res.json();
        const task = data.task;
        updateProgress(task.progress || 50);

        if (task.status === 'completed') {
          clearInterval(pollTimer!);
          btnParse.disabled = false;
          if (btnParseText) btnParseText.textContent = '重新解析';
          hideIngestErrorBanner();
          fetchAndRenderResult(taskId);
          loadTaskList();
        } else if (task.status === 'failed') {
          clearInterval(pollTimer!);
          btnParse.disabled = false;
          if (btnParseText) btnParseText.textContent = '重试解析';
          const errMsg = task.error || '解析任务执行失败，请检查 MinerU Token 是否有效、网络连通性或配额。';
          showIngestErrorBanner(errMsg);
        }
      } catch {}
    }, 2000);
  }

  function updateProgress(pct: number) {
    if (progressFill) progressFill.style.width = `${pct}%`;
  }

  // ==========================================================================
  // 13. 下载清洗包与转入书籍库
  // ==========================================================================
  btnDownloadZip?.addEventListener('click', () => {
    if (currentTaskId) {
      window.location.href = `/api/ingest/download-zip?taskId=${encodeURIComponent(currentTaskId)}`;
    }
  });

  const exportModal = document.getElementById('export-modal');
  const btnCloseExport = document.getElementById('btn-close-export');
  const btnConfirmExport = document.getElementById('btn-confirm-export');
  const exportColSelect = document.getElementById('export-collection-select') as HTMLSelectElement;
  const exportSlugInput = document.getElementById('export-slug-input') as HTMLInputElement;
  const exportTitleInput = document.getElementById('export-title-input') as HTMLInputElement;

  btnExportBook?.addEventListener('click', () => {
    if (exportModal) exportModal.style.display = 'flex';
  });
  btnCloseExport?.addEventListener('click', () => {
    if (exportModal) exportModal.style.display = 'none';
  });
  btnConfirmExport?.addEventListener('click', async () => {
    if (!currentTaskId) return;
    const col = exportColSelect?.value;
    const slug = exportSlugInput?.value?.trim();
    const title = exportTitleInput?.value?.trim();
    if (!col || !slug) return;

    try {
      const res = await fetch('/api/ingest/export-book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: currentTaskId, collectionSlug: col, bookSlug: slug, bookTitle: title || slug }),
      });
      const data = await res.json();
      if (data.success) {
        alert('成功转入书籍合集！');
        if (exportModal) exportModal.style.display = 'none';
      }
    } catch {}
  });

  // ==========================================================================
  // 14. 双语研判：单词即点即译与学术语境研读控制器 (M3 Word Popover)
  // ==========================================================================
  function updateClickToDefineState() {
    const isReady = currentViewMode === 'bilingual' && clickToDefineEnabled;
    if (structuredBlocksContainer) {
      structuredBlocksContainer.classList.toggle('click-to-define-ready', isReady);
    }
  }

  function closeWordPopover() {
    if (!wordPopover) return;
    wordPopover.classList.remove('active');
    wordPopover.style.display = 'none';
    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }
  }

  function getWordAtPoint(x: number, y: number): { word: string; sentence: string; rect: DOMRect } | null {
    let textNode: Node | null = null;
    let offset = 0;

    if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(x, y);
      if (pos && pos.offsetNode && pos.offsetNode.nodeType === Node.TEXT_NODE) {
        textNode = pos.offsetNode;
        offset = pos.offset;
      }
    } else if ((document as any).caretRangeFromPoint) {
      const r = (document as any).caretRangeFromPoint(x, y);
      if (r && r.startContainer && r.startContainer.nodeType === Node.TEXT_NODE) {
        textNode = r.startContainer;
        offset = r.startOffset;
      }
    }

    if (!textNode || !textNode.textContent) return null;

    const parentEl = textNode.parentElement;
    if (!parentEl) return null;

    // 严格规避数学公式、代码块、操作按钮、已有译文块与角标
    if (parentEl.closest('.katex, .doc-equation-display, pre, code, .block-hover-actions, .block-item-translation, button, .doc-footnote-ref')) {
      return null;
    }

    const blockCard = parentEl.closest('.structured-block-item.type-text, .structured-block-item.type-title, .structured-block-item.type-paragraph');
    if (!blockCard) return null;

    const text = textNode.textContent;
    let start = offset;
    let end = offset;

    // 点击在词尾空白或标点时探测前一字符
    if (offset > 0 && (offset >= text.length || !/[a-zA-Z]/.test(text[offset])) && /[a-zA-Z]/.test(text[offset - 1])) {
      start = offset - 1;
      end = offset - 1;
    }

    if (start >= text.length || !/[a-zA-Z]/.test(text[start])) {
      return null;
    }

    while (start > 0 && /[a-zA-Z\-'’]/.test(text[start - 1])) {
      start--;
    }
    while (end < text.length && /[a-zA-Z\-'’]/.test(text[end])) {
      end++;
    }

    const rawWord = text.slice(start, end).replace(/^['’\-]+|['’\-]+$/g, '');
    if (!rawWord || rawWord.length < 2) return null;

    const range = document.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, end);
    const rect = range.getBoundingClientRect();

    const fullBlockText = blockCard.querySelector('.block-item-body')?.textContent || text;
    let sentence = text;
    const sentenceMatches = fullBlockText.match(/[^.!?]+[.!?]+/g);
    if (sentenceMatches) {
      for (const s of sentenceMatches) {
        if (s.toLowerCase().includes(rawWord.toLowerCase())) {
          sentence = s.trim();
          break;
        }
      }
    }

    return { word: rawWord, sentence, rect };
  }

  function positionWordPopover(rect: DOMRect) {
    if (!wordPopover) return;
    const isMobile = window.innerWidth <= 800;

    if (isMobile) {
      wordPopover.classList.add('mobile-sheet');
      wordPopover.style.top = '';
      wordPopover.style.left = '';
      wordPopover.style.right = '';
      wordPopover.style.bottom = '';
      wordPopover.style.display = 'block';
      void wordPopover.offsetWidth;
      wordPopover.classList.add('active');
      return;
    }

    wordPopover.classList.remove('mobile-sheet');
    wordPopover.style.display = 'block';

    const popoverWidth = Math.min(320, window.innerWidth - 32);
    const popoverHeight = 220;

    let top = rect.bottom + 8;
    if (top + popoverHeight > window.innerHeight - 16 && rect.top - popoverHeight > 16) {
      top = rect.top - popoverHeight - 8;
    }

    let left = rect.left + rect.width / 2 - popoverWidth / 2;
    left = Math.max(16, Math.min(window.innerWidth - popoverWidth - 16, left));

    wordPopover.style.top = `${top}px`;
    wordPopover.style.left = `${left}px`;
    void wordPopover.offsetWidth;
    wordPopover.classList.add('active');
  }

  async function fetchClientDirectDict(word: string) {
    try {
      const url = `https://dict.youdao.com/jsonapi?q=${encodeURIComponent(word)}`;
      const res = await fetch(url);
      if (res.ok) {
        const d = await res.json();
        const simpleWord = d.simple?.word?.[0];
        const phonetic = simpleWord?.usphone ? `/${simpleWord.usphone}/` : (simpleWord?.ukphone ? `/${simpleWord.ukphone}/` : undefined);
        const audioUrl = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word)}&type=2`;
        const trs = d.ec?.word?.[0]?.trs;
        const meanings: Array<{ partOfSpeech: string; definitions: string[] }> = [];

        if (Array.isArray(trs)) {
          for (const item of trs) {
            const text = item?.tr?.[0]?.l?.i?.[0] || '';
            if (!text) continue;
            const m = text.match(/^([a-z]+\.)\s*(.+)$/i);
            if (m) {
              const pos = m[1].toLowerCase();
              const defs = m[2].split(/[,，、；;]/).map((s: string) => s.trim()).filter(Boolean);
              if (defs.length > 0) {
                meanings.push({ partOfSpeech: pos, definitions: defs.slice(0, 5) });
              }
            } else {
              meanings.push({ partOfSpeech: '', definitions: [text] });
            }
          }
        }

        if (meanings.length > 0) {
          return { ok: true, word, phonetic, audioUrl, meanings, source: 'youdao-jsonapi' };
        }
      }
    } catch {}

    // 备选 2: Youdao Suggest
    try {
      const url = `https://dict.youdao.com/suggest?num=1&doctype=json&q=${encodeURIComponent(word)}`;
      const res = await fetch(url);
      if (res.ok) {
        const json = await res.json();
        const entry = json?.data?.entries?.[0];
        if (entry?.explain) {
          const posMatch = entry.explain.match(/^([a-z]+\.)\s*(.+)$/i);
          const pos = posMatch ? posMatch[1].toLowerCase() : '';
          const raw = posMatch ? posMatch[2] : entry.explain;
          const defs = raw.split(/[,，、；;]/).map((s: string) => s.trim()).filter(Boolean);
          return {
            ok: true,
            word,
            audioUrl: `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word)}&type=2`,
            meanings: [{ partOfSpeech: pos, definitions: defs.slice(0, 5) }],
            source: 'youdao-suggest',
          };
        }
      }
    } catch {}

    return null;
  }

  async function showWordDefinition(word: string, sentence: string, rect: DOMRect) {
    if (!wordPopover) return;
    currentLookedUpWord = word;
    currentSentenceContext = sentence;

    positionWordPopover(rect);
    wordPopover.innerHTML = `
      <div class="m3-word-header">
        <div class="m3-word-header-left">
          <span class="m3-word-title">${word}</span>
          <span class="m3-word-phonetic">查询中...</span>
        </div>
        <div class="m3-word-header-actions">
          <button type="button" class="m3-word-close-btn" id="m3-word-close" title="关闭" aria-label="关闭">
            <span class="material-symbols-outlined" style="font-size: 16px;">close</span>
          </button>
        </div>
      </div>
      <div style="font-size: 0.8rem; color: var(--md3-on-surface-variant); padding: 8px 0;">正在检索多源词典...</div>
    `;
    document.getElementById('m3-word-close')?.addEventListener('click', closeWordPopover);

    let data: any = null;

    // 通道 1：本地/后端服务代理 (/api/dict)
    try {
      const res = await fetch(`/api/dict?word=${encodeURIComponent(word)}&provider=${encodeURIComponent(dictProviderSetting)}`);
      const contentType = res.headers.get('content-type') || '';
      if (res.ok && contentType.includes('application/json')) {
        const json = await res.json();
        if (json && json.ok && Array.isArray(json.meanings) && json.meanings.length > 0) {
          data = json;
        }
      }
    } catch {}

    // 通道 2：前端直连极速词典源双重兜底 (解决离线代理、未重启或代理异常情况)
    if (!data) {
      data = await fetchClientDirectDict(word);
    }

    if (!wordPopover.classList.contains('active') || currentLookedUpWord !== word) return;

    if (!data || !data.ok || !data.meanings || data.meanings.length === 0) {
      wordPopover.innerHTML = `
        <div class="m3-word-header">
          <div class="m3-word-header-left">
            <span class="m3-word-title">${word}</span>
          </div>
          <div class="m3-word-header-actions">
            <button type="button" class="m3-word-close-btn" id="m3-word-close" title="关闭" aria-label="关闭">
              <span class="material-symbols-outlined" style="font-size: 16px;">close</span>
            </button>
          </div>
        </div>
        <div style="font-size: 0.82rem; color: var(--md3-outline); padding: 6px 0;">未在词库中命中释义</div>
        <div class="m3-word-ai-section">
          <button type="button" class="m3-ai-context-btn" id="btn-explain-context">
            <span class="material-symbols-outlined" style="font-size: 14px;">auto_awesome</span>
            <span>AI 学术语境解析</span>
          </button>
          <div id="ai-context-result" style="display: none;"></div>
        </div>
      `;
      setupPopoverInteractions(word, sentence);
      return;
    }

    const meaningsHtml = data.meanings.map((m: any) => `
      <div class="m3-word-meaning-row">
        ${m.partOfSpeech ? `<span class="m3-pos-chip">${m.partOfSpeech}</span>` : ''}
        <div class="m3-word-defs">${m.definitions.join('； ')}</div>
      </div>
    `).join('');

    wordPopover.innerHTML = `
      <div class="m3-word-header">
        <div class="m3-word-header-left">
          <span class="m3-word-title">${data.word || word}</span>
          ${data.phonetic ? `<span class="m3-word-phonetic">${data.phonetic}</span>` : ''}
        </div>
        <div class="m3-word-header-actions">
          <button type="button" class="m3-word-audio-btn" id="m3-word-audio" title="朗读发音" aria-label="朗读发音">
            <span class="material-symbols-outlined" style="font-size: 17px;">volume_up</span>
          </button>
          <button type="button" class="m3-word-close-btn" id="m3-word-close" title="关闭" aria-label="关闭">
            <span class="material-symbols-outlined" style="font-size: 16px;">close</span>
          </button>
        </div>
      </div>
      <div class="m3-word-meanings">
        ${meaningsHtml}
      </div>
      <div class="m3-word-ai-section">
        <button type="button" class="m3-ai-context-btn" id="btn-explain-context" title="结合本文原句解析学术用法">
          <span class="material-symbols-outlined" style="font-size: 14px;">auto_awesome</span>
          <span>学术语境</span>
        </button>
        <div id="ai-context-result" style="display: none;"></div>
      </div>
    `;

    setupPopoverInteractions(word, sentence, data.audioUrl);
  }

  function setupPopoverInteractions(word: string, sentence: string, audioUrl?: string) {
    document.getElementById('m3-word-close')?.addEventListener('click', closeWordPopover);

    const audioBtn = document.getElementById('m3-word-audio');
    audioBtn?.addEventListener('click', () => {
      if (audioUrl) {
        if (currentAudio) currentAudio.pause();
        currentAudio = new Audio(audioUrl);
        currentAudio.play().catch(() => {
          if ('speechSynthesis' in window) {
            const u = new SpeechSynthesisUtterance(word);
            u.lang = 'en-US';
            window.speechSynthesis.speak(u);
          }
        });
      } else if ('speechSynthesis' in window) {
        const u = new SpeechSynthesisUtterance(word);
        u.lang = 'en-US';
        window.speechSynthesis.speak(u);
      }
    });

    const aiBtn = document.getElementById('btn-explain-context') as HTMLButtonElement | null;
    const aiBox = document.getElementById('ai-context-result');
    aiBtn?.addEventListener('click', async () => {
      if (!aiBtn || !aiBox) return;
      aiBtn.disabled = true;
      aiBtn.innerHTML = `
        <span class="material-symbols-outlined" style="font-size: 14px; animation: spin 1s infinite linear;">sync</span>
        <span>研判中...</span>
      `;
      aiBox.style.display = 'block';
      aiBox.innerHTML = '<div class="m3-ai-context-box" style="color: var(--md3-outline);">正在结合学术原句深度研判...</div>';

      try {
        let res = await fetch('/api/dict/context', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ word, sentence, provider: translationProvider }),
        });
        if (!res.ok) {
          res = await fetch('/api/translate/dict/context', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ word, sentence, provider: translationProvider }),
          });
        }
        const data = await res.json();
        if (data.ok && data.explanation) {
          const formatted = safeParseMarkdown(data.explanation, currentTaskId || '');
          aiBox.innerHTML = `<div class="m3-ai-context-box">${formatted}</div>`;
          aiBtn.style.display = 'none';
        } else {
          aiBox.innerHTML = `<div class="m3-ai-context-box" style="color: #ea4335;">语境解析未完成: ${data.error || '通道繁忙'}</div>`;
          aiBtn.disabled = false;
          aiBtn.innerHTML = `<span class="material-symbols-outlined" style="font-size: 14px;">auto_awesome</span><span>重试学术语境</span>`;
        }
      } catch (e: any) {
        aiBox.innerHTML = `<div class="m3-ai-context-box" style="color: #ea4335;">解析异常: ${e.message}</div>`;
        aiBtn.disabled = false;
        aiBtn.innerHTML = `<span class="material-symbols-outlined" style="font-size: 14px;">auto_awesome</span><span>重试学术语境</span>`;
      }
    });
  }

  // 绑定段落词元单击监听器 (划词复制时不干扰)
  structuredBlocksContainer?.addEventListener('click', (e: MouseEvent) => {
    if (currentViewMode !== 'bilingual' || !clickToDefineEnabled) return;

    // 划词选区保护：若用户正在划选拖拽复制文本，不弹出词典
    const selection = window.getSelection();
    if (selection && selection.toString().trim().length > 0) return;

    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (target.closest('.block-hover-actions, .block-item-translation, button, a')) return;

    const hit = getWordAtPoint(e.clientX, e.clientY);
    if (hit) {
      showWordDefinition(hit.word, hit.sentence, hit.rect);
    }
  });

  // 监听点击外部与 Escape 关闭词典浮窗
  document.addEventListener('click', (e: MouseEvent) => {
    if (!wordPopover || !wordPopover.classList.contains('active')) return;
    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (target.closest('#m3-word-popover') || target.closest('.structured-block-item')) return;
    closeWordPopover();
  });

  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape' && wordPopover?.classList.contains('active')) {
      closeWordPopover();
    }
  });

  // 同步外部控制中心变更的助读翻译引擎
  window.addEventListener('storage', (e) => {
    if (e.key === 'astrolib_trans_provider' && e.newValue) {
      translationProvider = e.newValue;
      if (settingsTransSelect) settingsTransSelect.value = translationProvider;
    }
  });

  window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'M3_THEME_COLOR_CHANGED' && e.data.transProvider) {
      translationProvider = e.data.transProvider;
      if (settingsTransSelect) settingsTransSelect.value = translationProvider;
    }
  });

  // 初始化流程
  updateClickToDefineState();
  loadTaskList();
  if (currentTaskId) {
    loadTaskInfo(currentTaskId);
  }
}
