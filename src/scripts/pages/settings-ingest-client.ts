import {
  INGEST_STORAGE_KEYS,
  readIngestSettings,
  writeIngestSettings,
  type DictProviderType,
  type HeadingFontPreset,
  type IngestEngineType,
  type ReadingFontPreset,
  type ReadingScalePreset,
} from '../../features/doc-ingestion/ingest-settings';

function notifySnackbar(message: string, durationMs = 2800): void {
  window.dispatchEvent(new CustomEvent('astrolib:show-snackbar', { detail: { message, durationMs } }));
}

const ENGINE_DESC_MAP: Record<IngestEngineType, string> = {
  api: '精准识别复杂跨页表格、行间公式与图文混排；上传 200 页以下文献直接静默后台解析，超过 200 页时将询问切片页码范围。',
  agent: '免 Token 轻量解析通道（受官方单次 10MB 体积限制），适合快速抓取短篇纯文本与基础公式。',
  local: '利用本机 GPU/Python 环境离线推理，数据不出本机且无云端页数限制（需在硬件自省确认本地依赖就绪）。',
};

const FONT_PREVIEW_VAR: Record<ReadingFontPreset, string> = {
  'latin-modern': "'Latin Modern Roman', 'KaTeX_Main', Georgia, serif",
  termes: "'TeX Gyre Termes', 'Times New Roman', serif",
  libertine: "'Linux Libertine', Georgia, serif",
  'noto-serif': "'Noto Serif SC Variable', 'Noto Serif SC', serif",
  sans: "'Plus Jakarta Sans Variable', 'Noto Sans SC Variable', system-ui, sans-serif",
};

const HEADING_PREVIEW_VAR: Record<HeadingFontPreset, string> = {
  default: "'Google Sans', 'Plus Jakarta Sans Variable', 'Noto Sans SC Variable', sans-serif",
  inherit: 'inherit',
  'latin-modern': "'Latin Modern Roman', 'KaTeX_Main', Georgia, serif",
  termes: "'TeX Gyre Termes', 'Times New Roman', serif",
  libertine: "'Linux Libertine', Georgia, serif",
  'noto-serif': "'Noto Serif SC Variable', 'Noto Serif SC', serif",
};

function syncSegmented(segEl: any, value: string): void {
  if (!segEl) return;
  segEl.querySelectorAll('m3e-button-segment').forEach((item: any) => {
    item.checked = item.value === value;
  });
}

function syncSingleChipSet(container: Element | null, attr: string, activeVal: string): void {
  if (!container) return;
  container.querySelectorAll<any>('md-filter-chip').forEach((chip) => {
    chip.selected = chip.getAttribute(attr) === activeVal;
  });
}

function bindSingleChipSet(
  container: Element | null,
  attr: string,
  getCurrent: () => string,
  onSelect: (value: string) => void
): void {
  if (!container) return;
  container.querySelectorAll<any>('md-filter-chip').forEach((chip) => {
    chip.addEventListener('click', (e: Event) => {
      const val = chip.getAttribute(attr);
      if (!val) return;
      if (val === getCurrent()) {
        e.preventDefault();
        syncSingleChipSet(container, attr, val);
        return;
      }
      e.stopPropagation();
      onSelect(val);
      syncSingleChipSet(container, attr, val);
    });
  });
}

export function focusMineruTokenSection(): void {
  const sec = document.getElementById('hub-ingest-token-section');
  const input = document.getElementById('hub-mineru-token-input') as any;
  if (sec) {
    sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  setTimeout(() => {
    input?.focus?.();
  }, 160);
}

export function initIngestSettingsPanel(onJumpToPanel?: (panelId: string, scrollSelector?: string) => void): void {
  const engineSeg = document.getElementById('hub-ingest-engine-seg') as any;
  const engineDescEl = document.getElementById('hub-ingest-engine-desc');

  const tokenInput = document.getElementById('hub-mineru-token-input') as any;
  const tokenToggleBtn = document.getElementById('hub-mineru-token-toggle');
  const tokenSaveBtn = document.getElementById('hub-mineru-token-save');
  const tokenClearBtn = document.getElementById('hub-mineru-token-clear');
  const tokenStatusEl = document.getElementById('hub-mineru-token-status');
  const tokenStatusText = tokenStatusEl?.querySelector<HTMLElement>('.status-text');

  const fontChipsEl = document.getElementById('hub-paper-font-chips');
  const fontPreviewEl = document.getElementById('hub-paper-font-preview');
  const headingChipsEl = document.getElementById('hub-paper-heading-font-chips');
  const headingPreviewEl = document.getElementById('hub-paper-heading-preview');
  const lhSeg = document.getElementById('hub-paper-lh-seg') as any;
  const sizeSeg = document.getElementById('hub-paper-size-seg') as any;

  const toggleDividers = document.getElementById('hub-toggle-page-dividers') as any;
  const toggleMeta = document.getElementById('hub-toggle-page-meta') as any;
  const toggleTransition = document.getElementById('hub-toggle-pdf-transition') as any;
  const toggleClickToDefine = document.getElementById('hub-toggle-click-to-define') as any;
  const dictChipsEl = document.getElementById('hub-dict-provider-chips');

  const updateTokenStatusBadge = (hasToken: boolean) => {
    if (!tokenStatusEl || !tokenStatusText) return;
    tokenStatusEl.className = hasToken ? 'status-indicator ready' : 'status-indicator warning';
    tokenStatusText.textContent = hasToken ? '已配置 Token' : '未配置 Token';
  };

  const syncUiFromSettings = () => {
    const s = readIngestSettings();
    syncSegmented(engineSeg, s.engine);
    if (engineDescEl) engineDescEl.textContent = ENGINE_DESC_MAP[s.engine];

    syncSingleChipSet(fontChipsEl, 'data-paper-font', s.readingFont);
    if (fontPreviewEl) fontPreviewEl.style.fontFamily = FONT_PREVIEW_VAR[s.readingFont];

    syncSingleChipSet(headingChipsEl, 'data-paper-heading', s.headingFont);
    if (headingPreviewEl) {
      headingPreviewEl.style.fontFamily =
        s.headingFont === 'inherit' ? FONT_PREVIEW_VAR[s.readingFont] : HEADING_PREVIEW_VAR[s.headingFont];
    }

    syncSegmented(lhSeg, s.readingLh);
    syncSegmented(sizeSeg, s.readingSize);

    if (toggleDividers) toggleDividers.selected = s.showPageDividers;
    if (toggleMeta) toggleMeta.selected = s.showPageMeta;
    if (toggleTransition) toggleTransition.selected = s.enablePdfTransition;
    if (toggleClickToDefine) toggleClickToDefine.selected = s.clickToDefine;

    syncSingleChipSet(dictChipsEl, 'data-dict-val', s.dictProvider);
  };

  const hydrateToken = async () => {
    let localToken = '';
    try {
      localToken = (localStorage.getItem(INGEST_STORAGE_KEYS.TOKEN) || '').trim();
    } catch {}
    if (localToken && tokenInput) {
      tokenInput.value = localToken;
      updateTokenStatusBadge(true);
      return;
    }

    try {
      const res = await fetch('/api/ingest/token');
      if (res.ok) {
        const data = await res.json();
        const hasToken = Boolean(data?.hasToken);
        if (hasToken) {
          if (tokenInput) {
            tokenInput.value = '';
            const masked = typeof data?.maskedToken === 'string' && data.maskedToken ? data.maskedToken : '****';
            tokenInput.placeholder = `服务端已保存凭证 (${masked})，留空则保持不变`;
          }
          updateTokenStatusBadge(true);
          return;
        }
      }
    } catch {}
    updateTokenStatusBadge(false);
  };

  syncUiFromSettings();
  void hydrateToken();

  engineSeg?.addEventListener('change', () => {
    const val = engineSeg.value as IngestEngineType;
    if (val === 'api' || val === 'agent' || val === 'local') {
      writeIngestSettings({ engine: val });
      if (engineDescEl) engineDescEl.textContent = ENGINE_DESC_MAP[val];
    }
  });

  tokenToggleBtn?.addEventListener('click', () => {
    if (!tokenInput) return;
    const isPassword = tokenInput.type === 'password';
    tokenInput.type = isPassword ? 'text' : 'password';
    const icon = tokenToggleBtn.querySelector('.material-symbols-outlined');
    if (icon) icon.textContent = isPassword ? 'visibility_off' : 'visibility';
  });

  const persistToken = async (nextToken: string) => {
    const trimmed = nextToken.trim();
    try {
      if (trimmed) {
        localStorage.setItem(INGEST_STORAGE_KEYS.TOKEN, trimmed);
      } else {
        localStorage.removeItem(INGEST_STORAGE_KEYS.TOKEN);
      }
    } catch {}
    try {
      await fetch('/api/ingest/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: trimmed }),
      });
    } catch {}
    updateTokenStatusBadge(Boolean(trimmed));
    window.dispatchEvent(new CustomEvent('astrolib:settings-changed'));
    notifySnackbar(trimmed ? 'MinerU API Token 已保存并同步' : '已清除 MinerU API Token');
  };

  tokenSaveBtn?.addEventListener('click', () => {
    void persistToken(String(tokenInput?.value || ''));
  });

  tokenClearBtn?.addEventListener('click', () => {
    if (tokenInput) tokenInput.value = '';
    void persistToken('');
  });

  bindSingleChipSet(
    fontChipsEl,
    'data-paper-font',
    () => readIngestSettings().readingFont,
    (val) => {
      writeIngestSettings({ readingFont: val as ReadingFontPreset });
      syncUiFromSettings();
    }
  );

  bindSingleChipSet(
    headingChipsEl,
    'data-paper-heading',
    () => readIngestSettings().headingFont,
    (val) => {
      writeIngestSettings({ headingFont: val as HeadingFontPreset });
      syncUiFromSettings();
    }
  );

  lhSeg?.addEventListener('change', () => {
    const val = lhSeg.value as ReadingScalePreset;
    if (val === 'compact' || val === 'standard' || val === 'spacious') {
      writeIngestSettings({ readingLh: val });
    }
  });

  sizeSeg?.addEventListener('change', () => {
    const val = sizeSeg.value as ReadingScalePreset;
    if (val === 'compact' || val === 'standard' || val === 'spacious') {
      writeIngestSettings({ readingSize: val });
    }
  });

  toggleDividers?.addEventListener('change', () => {
    writeIngestSettings({ showPageDividers: Boolean(toggleDividers.selected) });
  });
  toggleMeta?.addEventListener('change', () => {
    writeIngestSettings({ showPageMeta: Boolean(toggleMeta.selected) });
  });
  toggleTransition?.addEventListener('change', () => {
    writeIngestSettings({ enablePdfTransition: Boolean(toggleTransition.selected) });
  });
  toggleClickToDefine?.addEventListener('change', () => {
    writeIngestSettings({ clickToDefine: Boolean(toggleClickToDefine.selected) });
  });

  bindSingleChipSet(
    dictChipsEl,
    'data-dict-val',
    () => readIngestSettings().dictProvider,
    (val) => {
      writeIngestSettings({ dictProvider: val as DictProviderType });
    }
  );

  document.getElementById('hub-btn-goto-trans-provider')?.addEventListener('click', () => {
    onJumpToPanel?.('panel-reading', '.ft-trans-provider-wrapper');
  });

  if (typeof customElements !== 'undefined' && customElements.whenDefined) {
    Promise.all([
      customElements.whenDefined('md-filter-chip'),
      customElements.whenDefined('m3e-segmented-button'),
    ])
      .then(() => syncUiFromSettings())
      .catch(() => {});
  }
}
