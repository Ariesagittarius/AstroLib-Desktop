import { describe, it, expect } from 'vitest';
import {
  collections,
  sourceCollections,
  getAllBooks,
  getBuiltinStaticBooks,
  getCatalogBooks,
  getCatalogCollections,
} from '@/config/collections.config.ts';

describe('Collections Source of Truth Schema Contract', () => {
  it('collections 必须为合集数组，并支持零预编译书籍 (Zero-Built-in Books) 架构', () => {
    expect(Array.isArray(collections)).toBe(true);
    expect(collections.length).toBe(0);
  });

  it('sourceCollections 源书库必须包含合集，slug 全局唯一且图书具备必填元数据', () => {
    expect(Array.isArray(sourceCollections)).toBe(true);
    expect(sourceCollections.length).toBeGreaterThan(0);

    const colSlugs = new Set<string>();
    for (const col of sourceCollections) {
      expect(col.id).toBeDefined();
      expect(col.slug).toBeDefined();
      expect(col.title).toBeDefined();
      expect(colSlugs.has(col.slug)).toBe(false);
      colSlugs.add(col.slug);
      expect(col.books?.length).toBeGreaterThan(0);
    }

    const allSourceBooks = getAllBooks(true);
    expect(allSourceBooks.length).toBe(13);

    const bookSlugs = new Set<string>();
    for (const book of allSourceBooks) {
      expect(book.id).toBeDefined();
      expect(book.slug).toBeDefined();
      expect(book.title).toBeDefined();
      expect(book.entryPoint).toBeDefined();
      expect(bookSlugs.has(book.slug)).toBe(false);
      bookSlugs.add(book.slug);
    }
  });

  it('图书若声明 modules，必须包含有效的 chip 映射', () => {
    for (const col of sourceCollections) {
      for (const book of col.books) {
        if (book.modules) {
          for (const [modKey, modConfig] of Object.entries(book.modules)) {
            expect(modKey).toBeDefined();
            expect(modConfig.short).toBeDefined();
            expect(modConfig.theme).toBeDefined();
          }
        }
      }
    }
  });

  it('单目录 SSOT 不受 collections 空/非空状态影响，始终精确返回 13 本既定书目', () => {
    const expectedSlugs = [
      'math_senior',
      'math_analysis',
      'engineering_analysis',
      'linear_algebra',
      'probability_statistics',
      'linear_algebra_geometry',
      'graph_theory',
      'university_physics',
      'vectors_and_tensors',
      'communication_principles',
      'digital_circuit',
      'electronic_circuits',
      'algorithms',
    ];

    expect(getBuiltinStaticBooks()).toHaveLength(0);
    expect(getAllBooks()).toHaveLength(13);
    expect(getAllBooks('builtin-static')).toHaveLength(0);

    const emptyStateBooks = getCatalogBooks();
    expect(emptyStateBooks).toHaveLength(13);
    expect(emptyStateBooks.map((b) => b.slug)).toEqual(expectedSlugs);
    expect(getCatalogCollections()).toBe(sourceCollections);

    // 模拟静态构建开关 collections 非空时，catalog 仍严格单源返回 exact 13 本
    collections.push({
      id: 'mock',
      slug: 'mock',
      title: 'Mock Collection',
      books: [{ id: 'mock-book', slug: 'mock_book', title: 'Mock Book', entryPoint: '00' }],
    });
    try {
      const nonEmptyStateBooks = getCatalogBooks();
      expect(nonEmptyStateBooks).toHaveLength(13);
      expect(nonEmptyStateBooks.map((b) => b.slug)).toEqual(expectedSlugs);
      expect(getCatalogCollections()).toBe(sourceCollections);
      expect(getBuiltinStaticBooks()).toHaveLength(1);
    } finally {
      collections.length = 0;
    }
  });
});
