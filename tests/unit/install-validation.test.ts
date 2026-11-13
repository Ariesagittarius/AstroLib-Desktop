/**
 * tests/unit/install-validation.test.ts
 * ============================================================================
 * ABP 安装统一校验引擎单元测试 (P1-C1 / ADR-LIBRARY-CONTRACT)
 * ============================================================================
 */

import { describe, it, expect } from 'vitest';
import {
  validateInstallPayload,
  isSafeRelativePath,
  isSafeSlug,
  isSafeIdentifier,
  AbpInstallError,
  AbpInstallErrorCode,
} from '@/services/content-provider/install-validation.ts';
import { ABP_SCHEMA_VERSION, type AbpBundlePayload } from '@/types/content-package.ts';

function createValidBundle(): AbpBundlePayload {
  return {
    manifest: {
      schemaVersion: ABP_SCHEMA_VERSION,
      id: 'math-linear_algebra',
      colSlug: 'math',
      slug: 'linear_algebra',
      title: '线性代数',
      entryPoint: '01_intro',
      totalChapters: 2,
      updatedAt: '2026-11-13T00:00:00.000Z',
      contentHash: 'mock-hash-1234',
      sections: [
        {
          id: 'sec-1',
          slug: 'sec-1',
          title: '第一章 线性方程组',
          chapters: [
            {
              id: 'ch-01',
              slug: '01_intro',
              title: '1.1 导引',
              path: 'chapters/01_intro.json',
              hash: 'ch1-hash',
              sizeBytes: 1000,
            },
            {
              id: 'ch-02',
              slug: 'zh/02_matrix',
              title: '1.2 矩阵消元',
              path: 'chapters/zh/02_matrix.json',
              hash: 'ch2-hash',
              sizeBytes: 1500,
            },
          ],
        },
      ],
    },
    chapters: {
      '01_intro': {
        schemaVersion: ABP_SCHEMA_VERSION,
        bookId: 'math-linear_algebra',
        bookSlug: 'linear_algebra',
        colSlug: 'math',
        chapterSlug: '01_intro',
        title: '1.1 导引',
        html: '<p>导引内容</p>',
        headings: [{ id: 'intro', text: '导引', depth: 2 }],
        updatedAt: '2026-11-13T00:00:00.000Z',
      },
      'zh/02_matrix': {
        schemaVersion: ABP_SCHEMA_VERSION,
        bookId: 'math-linear_algebra',
        bookSlug: 'linear_algebra',
        colSlug: 'math',
        chapterSlug: 'zh/02_matrix',
        title: '1.2 矩阵消元',
        html: '<p>消元法</p>',
        headings: [{ id: 'matrix', text: '矩阵', depth: 2 }],
        updatedAt: '2026-11-13T00:00:00.000Z',
      },
    },
    assets: {
      'images/fig1.png': 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    },
    exercises: {
      'ex-ch1.json': '{"exercises":[]}',
    },
  };
}

describe('ABP Install Validation Engine Unit Tests (P1-C1)', () => {
  describe('Path & Slug Safety Helpers', () => {
    it('isSafeRelativePath 能够正确拦截路径逃逸并允许合法相对路径', () => {
      // 合法相对路径
      expect(isSafeRelativePath('chapters/01_intro.json')).toBe(true);
      expect(isSafeRelativePath('images/sub/fig.png')).toBe(true);
      expect(isSafeRelativePath('01_intro.json')).toBe(true);

      // 非法与逃逸路径
      expect(isSafeRelativePath('../secrets.json')).toBe(false);
      expect(isSafeRelativePath('chapters/../../secrets.json')).toBe(false);
      expect(isSafeRelativePath('/etc/passwd')).toBe(false);
      expect(isSafeRelativePath('C:\\Windows\\System32')).toBe(false);
      expect(isSafeRelativePath('chapters\\01.json')).toBe(false);
      expect(isSafeRelativePath('chapters//01.json')).toBe(false);
      expect(isSafeRelativePath('chapters/01:foo.json')).toBe(false);
      expect(isSafeRelativePath('foo\0bar')).toBe(false);
    });

    it('isSafeSlug 能够正确判定普通 slug 与多级路径 slug', () => {
      expect(isSafeSlug('01_intro')).toBe(true);
      expect(isSafeSlug('zh/02_matrix')).toBe(true);
      expect(isSafeSlug('zh-wp/001_books-and-algorithms')).toBe(true);

      expect(isSafeSlug('01_intro/')).toBe(false);
      expect(isSafeSlug('../01_intro')).toBe(false);
      expect(isSafeSlug('/01_intro')).toBe(false);
      expect(isSafeSlug('01\\intro')).toBe(false);
    });

    it('isSafeIdentifier 严禁包含斜杠与多级层级', () => {
      expect(isSafeIdentifier('math')).toBe(true);
      expect(isSafeIdentifier('linear_algebra')).toBe(true);
      expect(isSafeIdentifier('math-linear_algebra')).toBe(true);

      expect(isSafeIdentifier('math/algebra')).toBe(false);
      expect(isSafeIdentifier('../math')).toBe(false);
    });
  });

  describe('validateInstallPayload Contract Enforcement', () => {
    it('1. 规范合法 ABP 包能够顺利通过校验', () => {
      const bundle = createValidBundle();
      const validated = validateInstallPayload(bundle);
      expect(validated).toBeDefined();
      expect(validated.manifest.id).toBe('math-linear_algebra');
      expect(Object.keys(validated.chapters)).toHaveLength(2);
    });

    it('2. 损坏包（根节点非法抛出 INVALID_PAYLOAD，schemaVersion 不匹配抛出 SCHEMA_MISMATCH）', () => {
      expect(() => validateInstallPayload(null)).toThrow(AbpInstallError);
      try {
        validateInstallPayload(null);
      } catch (e: any) {
        expect(e.code).toBe(AbpInstallErrorCode.INVALID_PAYLOAD);
      }

      const invalidVersion = createValidBundle();
      (invalidVersion.manifest as any).schemaVersion = '2.0.0';
      expect(() => validateInstallPayload(invalidVersion)).toThrow(AbpInstallError);
      try {
        validateInstallPayload(invalidVersion);
      } catch (e: any) {
        expect(e.code).toBe(AbpInstallErrorCode.SCHEMA_MISMATCH);
      }
    });

    it('3. 清单声明章节但在 chapters 数据字典中缺失时抛出 CHAPTER_MISSING', () => {
      const bundle = createValidBundle();
      delete bundle.chapters['zh/02_matrix'];

      expect(() => validateInstallPayload(bundle)).toThrow(AbpInstallError);
      try {
        validateInstallPayload(bundle);
      } catch (e: any) {
        expect(e.code).toBe(AbpInstallErrorCode.CHAPTER_MISSING);
        expect(e.message).toContain('zh/02_matrix');
      }
    });

    it('4. entryPoint 不在 chapters 字典中时抛出 CHAPTER_MISSING', () => {
      const bundle = createValidBundle();
      bundle.manifest.entryPoint = 'non_existent_chapter';

      expect(() => validateInstallPayload(bundle)).toThrow(AbpInstallError);
      try {
        validateInstallPayload(bundle);
      } catch (e: any) {
        expect(e.code).toBe(AbpInstallErrorCode.CHAPTER_MISSING);
      }
    });

    it('5. chapters 字典 key 与内部 chapterSlug 不一致时抛出 CHAPTER_SLUG_MISMATCH', () => {
      const bundle = createValidBundle();
      bundle.chapters['01_intro'].chapterSlug = 'mismatched_slug';

      expect(() => validateInstallPayload(bundle)).toThrow(AbpInstallError);
      try {
        validateInstallPayload(bundle);
      } catch (e: any) {
        expect(e.code).toBe(AbpInstallErrorCode.CHAPTER_SLUG_MISMATCH);
      }
    });

    it('6. 章节 path 属性不符合规范时抛出 CHAPTER_PATH_INVALID', () => {
      const bundle = createValidBundle();
      bundle.manifest.sections[0].chapters[0].path = 'invalid_dir/01_intro.json';

      expect(() => validateInstallPayload(bundle)).toThrow(AbpInstallError);
      try {
        validateInstallPayload(bundle);
      } catch (e: any) {
        expect(e.code).toBe(AbpInstallErrorCode.CHAPTER_PATH_INVALID);
      }
    });

    it('7. 章节 slug 或清单 colSlug/slug 包含路径逃逸字符时抛出 PATH_TRAVERSAL_DETECTED', () => {
      // A. colSlug 逃逸
      const bundle1 = createValidBundle();
      bundle1.manifest.colSlug = '../etc';
      expect(() => validateInstallPayload(bundle1)).toThrow(/PATH_TRAVERSAL_DETECTED/);

      // B. chapter key 逃逸
      const bundle2 = createValidBundle();
      bundle2.chapters['../evil_chap'] = {
        ...bundle2.chapters['01_intro'],
        chapterSlug: '../evil_chap',
      };
      expect(() => validateInstallPayload(bundle2)).toThrow(/PATH_TRAVERSAL_DETECTED/);

      // C. Windows 盘符与反斜杠逃逸
      const bundle3 = createValidBundle();
      bundle3.chapters['C:\\escape'] = {
        ...bundle3.chapters['01_intro'],
        chapterSlug: 'C:\\escape',
      };
      expect(() => validateInstallPayload(bundle3)).toThrow(/PATH_TRAVERSAL_DETECTED/);
    });

    it('8. 静态资源路径逃逸时抛出 PATH_TRAVERSAL_DETECTED', () => {
      const bundle = createValidBundle();
      bundle.assets = {
        '../outside.png': 'base64data',
      };

      expect(() => validateInstallPayload(bundle)).toThrow(/PATH_TRAVERSAL_DETECTED/);
    });

    it('9. 习题数据路径逃逸时抛出 PATH_TRAVERSAL_DETECTED', () => {
      const bundle = createValidBundle();
      bundle.exercises = {
        '/root/ex.json': '{"exercises":[]}',
      };

      expect(() => validateInstallPayload(bundle)).toThrow(/PATH_TRAVERSAL_DETECTED/);
    });
  });
});
