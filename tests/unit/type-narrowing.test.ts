import { describe, it, expect } from 'vitest';
import type { ChapterLatexConfig } from '../../src/types/chapter-semantic';
import type { SlimQuestionItem } from '../../src/types/exercises';
import type { Book } from '../../src/types/collections';

describe('Type Narrowing Contracts (E3)', () => {
  it('ChapterLatexConfig.typography 必须限制为已知出版预设', () => {
    const validConfig: Partial<ChapterLatexConfig> = {
      typography: 'scholarly',
    };
    expect(validConfig.typography).toBe('scholarly');

    const validLecture: Partial<ChapterLatexConfig> = {
      typography: 'lecture',
    };
    expect(validLecture.typography).toBe('lecture');

    const invalidConfig: Partial<ChapterLatexConfig> = {
      // @ts-expect-error 非法 typography 预设值必须被静态类型检查拦截
      typography: 'invalid-nonexistent-preset',
    };
    expect(invalidConfig.typography).toBe('invalid-nonexistent-preset');
  });

  it('ChapterLatexConfig.cjkFont 必须限制为已知中文字体档位', () => {
    const validConfig: Partial<ChapterLatexConfig> = {
      cjkFont: 'sourcehan',
    };
    expect(validConfig.cjkFont).toBe('sourcehan');

    const invalidConfig: Partial<ChapterLatexConfig> = {
      // @ts-expect-error 非法中文字体名必须被拦截
      cjkFont: 'invalid-font-family',
    };
    expect(invalidConfig.cjkFont).toBe('invalid-font-family');
  });

  it('SlimQuestionItem.group 契约收窄测试', () => {
    const itemA: Partial<SlimQuestionItem> = {
      group: 'A',
    };
    expect(itemA.group).toBe('A');

    const itemB: Partial<SlimQuestionItem> = {
      group: 'B',
    };
    expect(itemB.group).toBe('B');
  });

  it('Book.tocMapping 契约结构测试', () => {
    const bookWithMapping: Partial<Book> = {
      tocMapping: {
        '00_preface': 'zh/00_preface',
        '01_intro': ['zh/01_intro', 'zh-wp/01_intro'],
      },
    };
    expect(bookWithMapping.tocMapping).toBeDefined();
    expect(bookWithMapping.tocMapping?.['00_preface']).toBe('zh/00_preface');
  });
});
