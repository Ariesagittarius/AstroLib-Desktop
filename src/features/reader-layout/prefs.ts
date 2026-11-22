import type {
  BookSourceFormat,
  BookStyleMode,
  ReadingLayoutMode,
  ReadingProfile,
} from '../../types/content-package.ts';
import type { CjkFont, LatinFont } from '../../scripts/font-presets.ts';
import type { PunctStyle } from '../../scripts/settings/typography-prefs.ts';

export interface BookReadingPrefs {
  layoutMode: ReadingLayoutMode;
  readingProfile: ReadingProfile;
  styleMode: BookStyleMode;
  useBookFonts: boolean;
}

export type FormatDefaultKey = 'abp' | 'epub';

export interface FormatTypographyDefaults extends BookReadingPrefs {
  latin: LatinFont;
  cjk: CjkFont;
  fontSize: number;
  paragraphIndent: boolean;
  punctStyle: PunctStyle;
}

export interface EffectiveBookPrefs extends FormatTypographyDefaults {
  sourceFormat: FormatDefaultKey;
  hasOverrides: boolean;
  overrides: Partial<FormatTypographyDefaults>;
}

export interface BookReadingDefaults {
  sourceFormat?: BookSourceFormat;
  readingProfile?: ReadingProfile;
  hasStylesheets?: boolean;
  hasEmbeddedFonts?: boolean;
}

export interface ColumnLayoutMetrics {
  requestedMode: ReadingLayoutMode;
  effectiveColumns: 1 | 2;
  degradedFromDual: boolean;
  viewportWidth: number;
  columnWidth: number;
  columnGap: number;
  pageWidth: number;
  pageStride: number;
}

export const DEFAULT_READING_LAYOUT_KEY = 'astrolib_default_reading_layout';
export const BOOK_LAYOUT_PREFS_PREFIX = 'astrolib_book_layout_prefs:';
export const FORMAT_DEFAULTS_STORAGE_KEY = 'astrolib_format_defaults_v1';
export const DUAL_COLUMN_MIN_WIDTH_PX = 880;
export const READER_MIN_FONT_SIZE = 13;
export const READER_MAX_FONT_SIZE = 20;

const BUILTIN_FORMAT_DEFAULTS: Record<FormatDefaultKey, FormatTypographyDefaults> = {
  abp: {
    latin: 'sans',
    cjk: 'han-sans',
    fontSize: 15,
    paragraphIndent: true,
    punctStyle: 'dot',
    layoutMode: 'scroll',
    readingProfile: 'academic',
    styleMode: 'harmonized',
    useBookFonts: true,
  },
  epub: {
    latin: 'serif',
    cjk: 'han-serif',
    fontSize: 16,
    paragraphIndent: true,
    punctStyle: 'circle',
    layoutMode: 'scroll',
    readingProfile: 'literary',
    styleMode: 'harmonized',
    useBookFonts: true,
  },
};

export function normalizeFormatKey(fmt?: BookSourceFormat | string | null): FormatDefaultKey {
  return fmt === 'epub' ? 'epub' : 'abp';
}

export function normalizeLatinFont(val: unknown, fallback: LatinFont = 'sans'): LatinFont {
  return val === 'sans' || val === 'serif' || val === 'katex' ? val : fallback;
}

export function normalizeCjkFont(val: unknown, fallback: CjkFont = 'han-sans'): CjkFont {
  return val === 'sans' || val === 'serif' || val === 'han-sans' || val === 'han-serif'
    ? val
    : fallback;
}

export function normalizePunctStyle(val: unknown, fallback: PunctStyle = 'dot'): PunctStyle {
  return val === 'dot' || val === 'circle' ? val : fallback;
}

export function clampReaderFontSize(val: unknown, fallback = 15): number {
  const num = typeof val === 'number' ? val : Number(val);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(READER_MIN_FONT_SIZE, Math.min(READER_MAX_FONT_SIZE, Math.round(num)));
}

export function normalizeReadingLayoutMode(val: unknown): ReadingLayoutMode {
  if (val === 'paged-single' || val === 'paged-dual' || val === 'scroll') {
    return val;
  }
  return 'scroll';
}

export function normalizeReadingProfile(val: unknown, fallback: ReadingProfile = 'academic'): ReadingProfile {
  if (val === 'academic' || val === 'literary') {
    return val;
  }
  return fallback;
}

export function normalizeBookStyleMode(val: unknown): BookStyleMode {
  if (val === 'harmonized' || val === 'original' || val === 'reflow') {
    return val;
  }
  return 'harmonized';
}

export function loadDefaultReadingLayout(): ReadingLayoutMode {
  try {
    if (typeof localStorage !== 'undefined') {
      return normalizeReadingLayoutMode(localStorage.getItem(DEFAULT_READING_LAYOUT_KEY));
    }
  } catch {}
  return 'scroll';
}

export function saveDefaultReadingLayout(mode: ReadingLayoutMode): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(DEFAULT_READING_LAYOUT_KEY, normalizeReadingLayoutMode(mode));
    }
  } catch {}
}

export function getBookReadingPrefsKey(bookKey: string): string {
  return `${BOOK_LAYOUT_PREFS_PREFIX}${bookKey}`;
}

function readFormatDefaultsStore(): Partial<Record<FormatDefaultKey, Partial<FormatTypographyDefaults>>> {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(FORMAT_DEFAULTS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          return parsed as Partial<Record<FormatDefaultKey, Partial<FormatTypographyDefaults>>>;
        }
      }
    }
  } catch {}
  return {};
}

export function loadFormatDefaults(fmt: BookSourceFormat | string = 'abp'): FormatTypographyDefaults {
  const key = normalizeFormatKey(fmt);
  const builtin = BUILTIN_FORMAT_DEFAULTS[key];
  const store = readFormatDefaultsStore();
  const saved = store[key] && typeof store[key] === 'object' ? store[key]! : {};
  const legacyLayout = loadDefaultReadingLayout();

  return {
    latin: normalizeLatinFont(saved.latin, builtin.latin),
    cjk: normalizeCjkFont(saved.cjk, builtin.cjk),
    fontSize: clampReaderFontSize(saved.fontSize, builtin.fontSize),
    paragraphIndent:
      typeof saved.paragraphIndent === 'boolean' ? saved.paragraphIndent : builtin.paragraphIndent,
    punctStyle: normalizePunctStyle(saved.punctStyle, builtin.punctStyle),
    layoutMode: normalizeReadingLayoutMode(saved.layoutMode ?? legacyLayout ?? builtin.layoutMode),
    readingProfile: normalizeReadingProfile(saved.readingProfile, builtin.readingProfile),
    styleMode: normalizeBookStyleMode(saved.styleMode ?? builtin.styleMode),
    useBookFonts: typeof saved.useBookFonts === 'boolean' ? saved.useBookFonts : builtin.useBookFonts,
  };
}

export function saveFormatDefaults(
  fmt: BookSourceFormat | string,
  partial: Partial<FormatTypographyDefaults>
): FormatTypographyDefaults {
  const key = normalizeFormatKey(fmt);
  const builtin = BUILTIN_FORMAT_DEFAULTS[key];
  const current = loadFormatDefaults(key);
  const next: Partial<FormatTypographyDefaults> = {
    ...readFormatDefaultsStore()[key],
  };

  if (partial.latin !== undefined) next.latin = normalizeLatinFont(partial.latin, current.latin);
  if (partial.cjk !== undefined) next.cjk = normalizeCjkFont(partial.cjk, current.cjk);
  if (partial.fontSize !== undefined) next.fontSize = clampReaderFontSize(partial.fontSize, current.fontSize);
  if (typeof partial.paragraphIndent === 'boolean') next.paragraphIndent = partial.paragraphIndent;
  if (partial.punctStyle !== undefined) next.punctStyle = normalizePunctStyle(partial.punctStyle, current.punctStyle);
  if (partial.layoutMode !== undefined) next.layoutMode = normalizeReadingLayoutMode(partial.layoutMode);
  if (partial.readingProfile !== undefined) next.readingProfile = normalizeReadingProfile(partial.readingProfile, builtin.readingProfile);
  if (partial.styleMode !== undefined) next.styleMode = normalizeBookStyleMode(partial.styleMode);
  if (typeof partial.useBookFonts === 'boolean') next.useBookFonts = partial.useBookFonts;

  try {
    if (typeof localStorage !== 'undefined') {
      const store = readFormatDefaultsStore();
      store[key] = next;
      localStorage.setItem(FORMAT_DEFAULTS_STORAGE_KEY, JSON.stringify(store));
    }
  } catch {}

  return loadFormatDefaults(key);
}

export function resetFormatDefaults(fmt: BookSourceFormat | string): FormatTypographyDefaults {
  const key = normalizeFormatKey(fmt);
  try {
    if (typeof localStorage !== 'undefined') {
      const store = readFormatDefaultsStore();
      delete store[key];
      if (Object.keys(store).length === 0) {
        localStorage.removeItem(FORMAT_DEFAULTS_STORAGE_KEY);
      } else {
        localStorage.setItem(FORMAT_DEFAULTS_STORAGE_KEY, JSON.stringify(store));
      }
    }
  } catch {}
  return loadFormatDefaults(key);
}

export function resolveDefaultReadingPrefs(defaults: BookReadingDefaults = {}): BookReadingPrefs {
  const key = normalizeFormatKey(defaults.sourceFormat || 'abp');
  const formatDefaults = loadFormatDefaults(key);
  const store = readFormatDefaultsStore();
  const hasSavedFormatProfile = Boolean(store[key]?.readingProfile);
  const defaultProfile: ReadingProfile = hasSavedFormatProfile
    ? formatDefaults.readingProfile
    : defaults.readingProfile || formatDefaults.readingProfile;

  return {
    layoutMode: formatDefaults.layoutMode,
    readingProfile: defaultProfile,
    styleMode: formatDefaults.styleMode,
    useBookFonts: formatDefaults.useBookFonts,
  };
}

function sanitizeBookOverrideRecord(
  rawObj: Record<string, unknown>,
  base: FormatTypographyDefaults
): Partial<FormatTypographyDefaults> {
  const overrides: Partial<FormatTypographyDefaults> = {};
  if (rawObj.latin !== undefined) overrides.latin = normalizeLatinFont(rawObj.latin, base.latin);
  if (rawObj.cjk !== undefined) overrides.cjk = normalizeCjkFont(rawObj.cjk, base.cjk);
  if (rawObj.fontSize !== undefined) overrides.fontSize = clampReaderFontSize(rawObj.fontSize, base.fontSize);
  if (typeof rawObj.paragraphIndent === 'boolean') overrides.paragraphIndent = rawObj.paragraphIndent;
  if (rawObj.punctStyle !== undefined) overrides.punctStyle = normalizePunctStyle(rawObj.punctStyle, base.punctStyle);
  if (rawObj.layoutMode !== undefined) overrides.layoutMode = normalizeReadingLayoutMode(rawObj.layoutMode);
  if (rawObj.readingProfile !== undefined) {
    overrides.readingProfile = normalizeReadingProfile(rawObj.readingProfile, base.readingProfile);
  }
  if (rawObj.styleMode !== undefined) overrides.styleMode = normalizeBookStyleMode(rawObj.styleMode);
  if (typeof rawObj.useBookFonts === 'boolean') overrides.useBookFonts = rawObj.useBookFonts;
  return overrides;
}

export function loadEffectiveBookPrefs(
  bookKey: string,
  defaults: BookReadingDefaults = {}
): EffectiveBookPrefs {
  const sourceFormat = normalizeFormatKey(defaults.sourceFormat || 'abp');
  const base = loadFormatDefaults(sourceFormat);
  const resolvedProfile = resolveDefaultReadingPrefs(defaults).readingProfile;
  const effectiveBase: FormatTypographyDefaults = {
    ...base,
    readingProfile: resolvedProfile,
  };

  if (!bookKey) {
    return {
      ...effectiveBase,
      sourceFormat,
      hasOverrides: false,
      overrides: {},
    };
  }

  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(getBookReadingPrefsKey(bookKey));
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const overrides = sanitizeBookOverrideRecord(parsed as Record<string, unknown>, effectiveBase);
          return {
            ...effectiveBase,
            ...overrides,
            sourceFormat,
            hasOverrides: Object.keys(overrides).length > 0,
            overrides,
          };
        }
      }
    }
  } catch {}

  return {
    ...effectiveBase,
    sourceFormat,
    hasOverrides: false,
    overrides: {},
  };
}

export function saveBookPrefOverride(
  bookKey: string,
  partial: Partial<FormatTypographyDefaults>,
  defaults: BookReadingDefaults = {}
): EffectiveBookPrefs {
  const current = loadEffectiveBookPrefs(bookKey, defaults);
  if (bookKey) {
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(getBookReadingPrefsKey(bookKey));
        let parsed: Record<string, unknown> = {};
        if (raw) {
          const maybe = JSON.parse(raw);
          if (maybe && typeof maybe === 'object' && !Array.isArray(maybe)) {
            parsed = maybe as Record<string, unknown>;
          }
        }
        const stored = sanitizeBookOverrideRecord(parsed, current);

        if (partial.latin !== undefined) stored.latin = normalizeLatinFont(partial.latin, current.latin);
        if (partial.cjk !== undefined) {
          stored.cjk = normalizeCjkFont(partial.cjk, current.cjk);

          if (current.useBookFonts && partial.useBookFonts === undefined) {
            stored.useBookFonts = false;
          }
        }
        if (partial.fontSize !== undefined) stored.fontSize = clampReaderFontSize(partial.fontSize, current.fontSize);
        if (typeof partial.paragraphIndent === 'boolean') stored.paragraphIndent = partial.paragraphIndent;
        if (partial.punctStyle !== undefined) stored.punctStyle = normalizePunctStyle(partial.punctStyle, current.punctStyle);
        if (partial.layoutMode !== undefined) stored.layoutMode = normalizeReadingLayoutMode(partial.layoutMode);
        if (partial.readingProfile !== undefined) {
          stored.readingProfile = normalizeReadingProfile(partial.readingProfile, current.readingProfile);
        }
        if (partial.styleMode !== undefined) stored.styleMode = normalizeBookStyleMode(partial.styleMode);
        if (typeof partial.useBookFonts === 'boolean') stored.useBookFonts = partial.useBookFonts;

        localStorage.setItem(getBookReadingPrefsKey(bookKey), JSON.stringify(stored));
      }
    } catch {}
  }
  return loadEffectiveBookPrefs(bookKey, defaults);
}

export function resetBookPrefOverrides(
  bookKey: string,
  defaults: BookReadingDefaults = {}
): EffectiveBookPrefs {
  if (bookKey) {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(getBookReadingPrefsKey(bookKey));
      }
    } catch {}
  }
  return loadEffectiveBookPrefs(bookKey, defaults);
}

export function loadBookReadingPrefs(
  bookKey: string,
  defaults: BookReadingDefaults = {}
): BookReadingPrefs {
  const effective = loadEffectiveBookPrefs(bookKey, defaults);
  return {
    layoutMode: effective.layoutMode,
    readingProfile: effective.readingProfile,
    styleMode: effective.styleMode,
    useBookFonts: effective.useBookFonts,
  };
}

export function saveBookReadingPrefs(
  bookKey: string,
  partial: Partial<BookReadingPrefs>,
  defaults: BookReadingDefaults = {}
): BookReadingPrefs {
  const effective = saveBookPrefOverride(bookKey, partial, defaults);
  return {
    layoutMode: effective.layoutMode,
    readingProfile: effective.readingProfile,
    styleMode: effective.styleMode,
    useBookFonts: effective.useBookFonts,
  };
}

export function resolveEffectiveColumns(
  requestedMode: ReadingLayoutMode,
  availableWidthPx: number
): { columns: 1 | 2; degradedFromDual: boolean } {
  if (requestedMode !== 'paged-dual') {
    return { columns: 1, degradedFromDual: false };
  }
  if (availableWidthPx >= DUAL_COLUMN_MIN_WIDTH_PX) {
    return { columns: 2, degradedFromDual: false };
  }
  return { columns: 1, degradedFromDual: true };
}

export function computeColumnMetrics(
  requestedMode: ReadingLayoutMode,
  availableWidthPx: number
): ColumnLayoutMetrics {
  const safeWidth = Math.max(280, Math.floor(availableWidthPx));
  const { columns, degradedFromDual } = resolveEffectiveColumns(requestedMode, safeWidth);

  if (columns === 2) {
    const columnGap = 48;
    const columnWidth = Math.max(260, Math.floor((safeWidth - columnGap) / 2));
    const pageWidth = columnWidth * 2 + columnGap;
    const pageStride = 2 * (columnWidth + columnGap);
    return {
      requestedMode,
      effectiveColumns: 2,
      degradedFromDual,
      viewportWidth: safeWidth,
      columnWidth,
      columnGap,
      pageWidth,
      pageStride,
    };
  }

  const columnGap = 40;
  const columnWidth = safeWidth;
  const pageWidth = columnWidth;
  const pageStride = columnWidth + columnGap;

  return {
    requestedMode,
    effectiveColumns: 1,
    degradedFromDual,
    viewportWidth: safeWidth,
    columnWidth,
    columnGap,
    pageWidth,
    pageStride,
  };
}

export function clampPageIndex(pageIndex: number, totalPages: number): number {
  const maxIdx = Math.max(0, totalPages - 1);
  if (!Number.isFinite(pageIndex)) return 0;
  return Math.max(0, Math.min(maxIdx, Math.floor(pageIndex)));
}

export function calculatePageIndexForOffset(
  elementOffsetLeft: number,
  metrics: Pick<ColumnLayoutMetrics, 'columnWidth' | 'columnGap' | 'effectiveColumns'>,
  totalPages: number
): number {
  if (totalPages <= 1) return 0;
  const colStride = Math.max(1, metrics.columnWidth + metrics.columnGap);
  const colIndex = Math.max(0, Math.floor((elementOffsetLeft + 4) / colStride));
  const rawPage = Math.floor(colIndex / metrics.effectiveColumns);
  return clampPageIndex(rawPage, totalPages);
}
