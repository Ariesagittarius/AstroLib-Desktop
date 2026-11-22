/**
 * src/features/doc-ingestion/ingest-settings.ts
 * ============================================================================
 * 学术文献解析与双栏阅读设置共享契约 (Single Source of Truth)
 * ============================================================================
 * 统一服务于：
 * - 全局设置中心 (SettingsIngestPanel.astro / settings-ingest-client.ts)
 * - 桌面宿主实时广播 (desktop.astro / reader-host-controller.ts)
 * - 研读书库统一上传流 (ingest-upload-pipeline.ts)
 * - 单文献纯净阅读视窗 (paper-reader-controller.ts / paper-typography.ts)
 * ============================================================================
 */

export type IngestEngineType = 'api' | 'agent' | 'local';
export type ReadingFontPreset = 'latin-modern' | 'termes' | 'libertine' | 'noto-serif' | 'sans';
export type HeadingFontPreset = 'default' | 'inherit' | 'latin-modern' | 'termes' | 'libertine' | 'noto-serif';
export type ReadingScalePreset = 'compact' | 'standard' | 'spacious';
export type DictProviderType = 'auto' | 'youdao' | 'google' | 'free';

export interface IngestSettingsSnapshot {
  engine: IngestEngineType;
  readingFont: ReadingFontPreset;
  headingFont: HeadingFontPreset;
  readingLh: ReadingScalePreset;
  readingSize: ReadingScalePreset;
  showPageDividers: boolean;
  showPageMeta: boolean;
  enablePdfTransition: boolean;
  clickToDefine: boolean;
  dictProvider: DictProviderType;
  transProvider: string;
}

export const INGEST_STORAGE_KEYS = {
  ENGINE: 'astrolib_ingest_engine',
  TOKEN: 'mineru_api_token',
  READING_FONT: 'astrolib_reading_font',
  HEADING_FONT: 'astrolib_heading_font',
  READING_LH: 'astrolib_reading_lh',
  READING_SIZE: 'astrolib_reading_size',
  SHOW_PAGE_DIVIDERS: 'astrolib_show_page_dividers',
  SHOW_PAGE_META: 'astrolib_show_page_meta',
  PDF_PAGE_TRANSITION: 'astrolib_pdf_page_transition',
  CLICK_TO_DEFINE: 'mineru_click_to_define',
  DICT_PROVIDER: 'astrolib_dict_provider',
  TRANS_PROVIDER: 'astrolib_trans_provider',
} as const;

export const DEFAULT_INGEST_SETTINGS: IngestSettingsSnapshot = {
  engine: 'api',
  readingFont: 'latin-modern',
  headingFont: 'default',
  readingLh: 'standard',
  readingSize: 'standard',
  showPageDividers: true,
  showPageMeta: true,
  enablePdfTransition: true,
  clickToDefine: true,
  dictProvider: 'auto',
  transProvider: 'google',
};

function safeGet(key: string): string | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, value);
    }
  } catch {}
}

export function readIngestSettings(): IngestSettingsSnapshot {
  const engineRaw = safeGet(INGEST_STORAGE_KEYS.ENGINE);
  const engine: IngestEngineType =
    engineRaw === 'agent' || engineRaw === 'local' || engineRaw === 'api' ? engineRaw : 'api';

  const rfRaw = safeGet(INGEST_STORAGE_KEYS.READING_FONT);
  const readingFont: ReadingFontPreset =
    rfRaw === 'termes' || rfRaw === 'libertine' || rfRaw === 'noto-serif' || rfRaw === 'sans' || rfRaw === 'latin-modern'
      ? rfRaw
      : 'latin-modern';

  const hfRaw = safeGet(INGEST_STORAGE_KEYS.HEADING_FONT);
  const headingFont: HeadingFontPreset =
    hfRaw === 'inherit' ||
    hfRaw === 'latin-modern' ||
    hfRaw === 'termes' ||
    hfRaw === 'libertine' ||
    hfRaw === 'noto-serif' ||
    hfRaw === 'default'
      ? hfRaw
      : 'default';

  const lhRaw = safeGet(INGEST_STORAGE_KEYS.READING_LH);
  const readingLh: ReadingScalePreset =
    lhRaw === 'compact' || lhRaw === 'spacious' || lhRaw === 'standard' ? lhRaw : 'standard';

  const sizeRaw = safeGet(INGEST_STORAGE_KEYS.READING_SIZE);
  const readingSize: ReadingScalePreset =
    sizeRaw === 'compact' || sizeRaw === 'spacious' || sizeRaw === 'standard' ? sizeRaw : 'standard';

  const dictRaw = safeGet(INGEST_STORAGE_KEYS.DICT_PROVIDER);
  const dictProvider: DictProviderType =
    dictRaw === 'youdao' || dictRaw === 'google' || dictRaw === 'free' || dictRaw === 'auto' ? dictRaw : 'auto';

  return {
    engine,
    readingFont,
    headingFont,
    readingLh,
    readingSize,
    showPageDividers: safeGet(INGEST_STORAGE_KEYS.SHOW_PAGE_DIVIDERS) !== 'false',
    showPageMeta: safeGet(INGEST_STORAGE_KEYS.SHOW_PAGE_META) !== 'false',
    enablePdfTransition: safeGet(INGEST_STORAGE_KEYS.PDF_PAGE_TRANSITION) !== 'false',
    clickToDefine: safeGet(INGEST_STORAGE_KEYS.CLICK_TO_DEFINE) !== 'false',
    dictProvider,
    transProvider: safeGet(INGEST_STORAGE_KEYS.TRANS_PROVIDER) || 'google',
  };
}

export function writeIngestSettings(partial: Partial<IngestSettingsSnapshot>): IngestSettingsSnapshot {
  if (partial.engine !== undefined) safeSet(INGEST_STORAGE_KEYS.ENGINE, partial.engine);
  if (partial.readingFont !== undefined) safeSet(INGEST_STORAGE_KEYS.READING_FONT, partial.readingFont);
  if (partial.headingFont !== undefined) safeSet(INGEST_STORAGE_KEYS.HEADING_FONT, partial.headingFont);
  if (partial.readingLh !== undefined) safeSet(INGEST_STORAGE_KEYS.READING_LH, partial.readingLh);
  if (partial.readingSize !== undefined) safeSet(INGEST_STORAGE_KEYS.READING_SIZE, partial.readingSize);
  if (partial.showPageDividers !== undefined) safeSet(INGEST_STORAGE_KEYS.SHOW_PAGE_DIVIDERS, String(partial.showPageDividers));
  if (partial.showPageMeta !== undefined) safeSet(INGEST_STORAGE_KEYS.SHOW_PAGE_META, String(partial.showPageMeta));
  if (partial.enablePdfTransition !== undefined) safeSet(INGEST_STORAGE_KEYS.PDF_PAGE_TRANSITION, String(partial.enablePdfTransition));
  if (partial.clickToDefine !== undefined) safeSet(INGEST_STORAGE_KEYS.CLICK_TO_DEFINE, String(partial.clickToDefine));
  if (partial.dictProvider !== undefined) safeSet(INGEST_STORAGE_KEYS.DICT_PROVIDER, partial.dictProvider);
  if (partial.transProvider !== undefined) safeSet(INGEST_STORAGE_KEYS.TRANS_PROVIDER, partial.transProvider);

  const next = readIngestSettings();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('astrolib:ingest-settings-changed', { detail: next }));
    window.dispatchEvent(new CustomEvent('astrolib:settings-changed'));
  }
  return next;
}

export function getSavedMineruToken(): string {
  return (safeGet(INGEST_STORAGE_KEYS.TOKEN) || '').trim();
}

export function isIngestSettingStorageKey(key: string | null): boolean {
  if (!key) return false;
  return (Object.values(INGEST_STORAGE_KEYS) as string[]).includes(key);
}
