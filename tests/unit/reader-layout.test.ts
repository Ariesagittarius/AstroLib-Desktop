import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resolveEffectiveColumns,
  computeColumnMetrics,
  calculatePageIndexForOffset,
  loadDefaultReadingLayout,
  saveDefaultReadingLayout,
  loadBookReadingPrefs,
  saveBookReadingPrefs,
  loadFormatDefaults,
  saveFormatDefaults,
  resetFormatDefaults,
  loadEffectiveBookPrefs,
  saveBookPrefOverride,
  resetBookPrefOverrides,
  DUAL_COLUMN_MIN_WIDTH_PX,
} from '../../src/features/reader-layout/prefs.ts';

function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
  };
}

describe('Universal Reader Layout Geometry & Preferences Tests', () => {
  const origLocalStorage = (globalThis as any).localStorage;

  beforeEach(() => {
    (globalThis as any).localStorage = createMemoryStorage();
  });

  afterEach(() => {
    (globalThis as any).localStorage = origLocalStorage;
  });

  it('resolveEffectiveColumns 应在宽屏下允许双栏，在窄屏下优雅退让为单栏', () => {
    expect(resolveEffectiveColumns('scroll', 1280)).toEqual({
      columns: 1,
      degradedFromDual: false,
    });
    expect(resolveEffectiveColumns('paged-single', 1280)).toEqual({
      columns: 1,
      degradedFromDual: false,
    });
    expect(resolveEffectiveColumns('paged-dual', DUAL_COLUMN_MIN_WIDTH_PX)).toEqual({
      columns: 2,
      degradedFromDual: false,
    });
    expect(resolveEffectiveColumns('paged-dual', DUAL_COLUMN_MIN_WIDTH_PX - 80)).toEqual({
      columns: 1,
      degradedFromDual: true,
    });
  });

  it('computeColumnMetrics 与 calculatePageIndexForOffset 应无累计像素误差地映射页码', () => {
    const dual = computeColumnMetrics('paged-dual', 1048);
    expect(dual.effectiveColumns).toBe(2);
    expect(dual.columnGap).toBe(48);
    expect(dual.columnWidth).toBe(500);
    expect(dual.pageWidth).toBe(1048);
    expect(dual.pageStride).toBe(2 * (500 + 48));

    const colStride = dual.columnWidth + dual.columnGap; // 548
    // 第0/1栏均属第0页
    expect(calculatePageIndexForOffset(10, dual, 5)).toBe(0);
    expect(calculatePageIndexForOffset(colStride + 10, dual, 5)).toBe(0);
    // 第2/3栏属第1页
    expect(calculatePageIndexForOffset(colStride * 2 + 10, dual, 5)).toBe(1);
    expect(calculatePageIndexForOffset(colStride * 3 + 10, dual, 5)).toBe(1);
    // 第4栏属第2页
    expect(calculatePageIndexForOffset(colStride * 4 + 10, dual, 5)).toBe(2);
    // 超出总页数时应正确 clamp
    expect(calculatePageIndexForOffset(colStride * 20, dual, 5)).toBe(4);
  });

  it('按本书隔离持久化阅读偏好，且默认阅读体裁与全局布局互相独立', () => {
    saveDefaultReadingLayout('paged-dual');
    expect(loadDefaultReadingLayout()).toBe('paged-dual');

    const epubDefaults = loadBookReadingPrefs('acg-light-novel-1', { sourceFormat: 'epub' });
    expect(epubDefaults.layoutMode).toBe('paged-dual');
    expect(epubDefaults.readingProfile).toBe('literary');
    expect(epubDefaults.styleMode).toBe('harmonized');
    expect(epubDefaults.useBookFonts).toBe(true);

    const abpDefaults = loadBookReadingPrefs('math-calc-1', { sourceFormat: 'abp' });
    expect(abpDefaults.layoutMode).toBe('paged-dual');
    expect(abpDefaults.readingProfile).toBe('academic');

    saveBookReadingPrefs('acg-light-novel-1', {
      layoutMode: 'paged-single',
      styleMode: 'original',
      useBookFonts: false,
    });

    const reloadedEpub = loadBookReadingPrefs('acg-light-novel-1', { sourceFormat: 'epub' });
    expect(reloadedEpub).toEqual({
      layoutMode: 'paged-single',
      readingProfile: 'literary',
      styleMode: 'original',
      useBookFonts: false,
    });

    // 其他书籍偏好不受影响
    expect(loadBookReadingPrefs('math-calc-1', { sourceFormat: 'abp' }).styleMode).toBe('harmonized');
  });

  it('支持按格式默认排版配置与按本书稀疏覆写继承，并在手选 CJK 字体时自动解绑原书字体锁', () => {
    const abpDefault = loadFormatDefaults('abp');
    const epubDefault = loadFormatDefaults('epub');
    expect(abpDefault.cjk).toBe('han-sans');
    expect(abpDefault.latin).toBe('sans');
    expect(abpDefault.punctStyle).toBe('dot');
    expect(epubDefault.cjk).toBe('han-serif');
    expect(epubDefault.latin).toBe('serif');
    expect(epubDefault.punctStyle).toBe('circle');
    expect(epubDefault.readingProfile).toBe('literary');

    // 修改 EPUB 格式默认字号不应影响 ABP 格式
    saveFormatDefaults('epub', { fontSize: 18, cjk: 'serif' });
    expect(loadFormatDefaults('epub').fontSize).toBe(18);
    expect(loadFormatDefaults('epub').cjk).toBe('serif');
    expect(loadFormatDefaults('abp').fontSize).toBe(15);

    // 继承 EPUB 格式默认配置
    const novel = loadEffectiveBookPrefs('acg-railgun', { sourceFormat: 'epub' });
    expect(novel.fontSize).toBe(18);
    expect(novel.cjk).toBe('serif');
    expect(novel.hasOverrides).toBe(false);
    expect(novel.useBookFonts).toBe(true);

    // 在本书内手动选择 CJK 字体时自动将 useBookFonts 置为 false
    const updatedNovel = saveBookPrefOverride('acg-railgun', { cjk: 'han-sans' }, { sourceFormat: 'epub' });
    expect(updatedNovel.cjk).toBe('han-sans');
    expect(updatedNovel.useBookFonts).toBe(false);
    expect(updatedNovel.hasOverrides).toBe(true);

    // 另一本 EPUB 不受本书覆写影响
    const otherNovel = loadEffectiveBookPrefs('acg-index', { sourceFormat: 'epub' });
    expect(otherNovel.cjk).toBe('serif');
    expect(otherNovel.useBookFonts).toBe(true);

    // 恢复本书为格式默认
    const resetBook = resetBookPrefOverrides('acg-railgun', { sourceFormat: 'epub' });
    expect(resetBook.cjk).toBe('serif');
    expect(resetBook.fontSize).toBe(18);
    expect(resetBook.hasOverrides).toBe(false);

    // 重置 EPUB 格式默认回内置 思源宋体 + 16px
    const resetFmt = resetFormatDefaults('epub');
    expect(resetFmt.cjk).toBe('han-serif');
    expect(resetFmt.fontSize).toBe(16);
  });
});
