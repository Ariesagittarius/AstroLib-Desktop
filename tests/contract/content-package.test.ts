import { describe, it, expect } from 'vitest';
import {
  ABP_SCHEMA_VERSION,
  type AstroBookManifest,
  type AstroBookChapterPayload,
  type LibraryCatalog,
} from '@/types/content-package.ts';

describe('ABP (AstroBook Package) Schema Contract', () => {
  it('ABP_SCHEMA_VERSION 必须为 1.0.0 语义版本', () => {
    expect(ABP_SCHEMA_VERSION).toBe('1.0.0');
  });

  it('AstroBookManifest 必须满足结构化与必要字段约束', () => {
    const mockManifest: AstroBookManifest = {
      schemaVersion: ABP_SCHEMA_VERSION,
      id: 'math-linear-algebra',
      slug: 'linear_algebra',
      colSlug: 'math',
      title: '线性代数及其应用',
      author: 'David C. Lay',
      category: 'textbook',
      subject: 'math',
      description: '经典大学线性代数教材',
      entryPoint: '01_linear_equations',
      totalChapters: 1,
      updatedAt: new Date().toISOString(),
      contentHash: 'hash-abc-123',
      sections: [
        {
          id: 'sec-1',
          title: '第 1 章 线性方程组',
          slug: 'ch01',
          chapters: [
            {
              id: 'ch-01-1',
              title: '1.1 线性方程组组与高斯消元',
              slug: '01_linear_equations',
              path: 'chapters/01_linear_equations.json',
              hash: 'hash-chap-1',
              sizeBytes: 12000,
            },
          ],
        },
      ],
    };

    expect(mockManifest.schemaVersion).toBe('1.0.0');
    expect(mockManifest.colSlug).toBe('math');
    expect(mockManifest.sections.length).toBe(1);
    expect(mockManifest.sections[0].chapters[0].slug).toBe(mockManifest.entryPoint);
  });

  it('AstroBookChapterPayload 必须包含预渲染 HTML 与大纲条目', () => {
    const mockPayload: AstroBookChapterPayload = {
      schemaVersion: ABP_SCHEMA_VERSION,
      bookId: 'math-linear-algebra',
      bookSlug: 'linear_algebra',
      colSlug: 'math',
      chapterSlug: '01_linear_equations',
      title: '1.1 线性方程组',
      html: '<div class="example-card"><span class="katex">x+y=1</span></div>',
      headings: [
        { depth: 2, text: '高斯消元法', id: 'gaussian-elimination' },
      ],
      updatedAt: new Date().toISOString(),
    };

    expect(mockPayload.html).toContain('class="example-card"');
    expect(mockPayload.headings.length).toBe(1);
  });

  it('LibraryCatalog 必须包含书籍清单列表', () => {
    const mockCatalog: LibraryCatalog = {
      schemaVersion: ABP_SCHEMA_VERSION,
      catalogName: 'AstroLib Official Library',
      sourceUrl: 'https://github.com/Ariesagittarius/AstroLib-Books',
      generatedAt: new Date().toISOString(),
      books: [
        {
          id: 'math-linear-algebra',
          slug: 'linear_algebra',
          colSlug: 'math',
          title: '线性代数及其应用',
          entryPoint: '01_linear_equations',
          totalChapters: 25,
          packFileName: 'math-linear_algebra.abp',
          contentHash: 'hash-999',
          updatedAt: new Date().toISOString(),
        },
      ],
    };

    expect(mockCatalog.books.length).toBe(1);
    expect(mockCatalog.books[0].packFileName.endsWith('.abp')).toBe(true);
  });
});
