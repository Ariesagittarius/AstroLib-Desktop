/**
 * tests/unit/static-handler.test.ts
 * ============================================================================
 * StaticHandler 静态服务引擎单元测试 (P1-A1 门禁测试)
 * ============================================================================
 * 验证目标：
 * 1. 严格 0 模糊匹配：模糊前缀必须返回 404；
 * 2. Canonical Slug 物理命中：返回 HTTP 200 与 HTML 内容；
 * 3. Legacy Slug 显式单项别名查表：返回 HTTP 301 永久重定向并携带 Location 标头；
 * 4. 章节或书籍不存在：返回 HTTP 404 与符合学术规范的 HTML 错误视窗；
 * 5. 书籍根路径 /collections/:col/:book/：返回 HTTP 302 重定向至 entryPoint；
 * 6. 官方 13 本书 1,251 章全量 Canonical Slug 普查：100% 满足 cleanSlug(slug) === slug。
 * ============================================================================
 */

import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { StaticHandler } from '../../electron/server/static-handler.ts';
import { cleanSlug } from '../../src/utils/slug.ts';
import { resolveAbpArtifactsDir, resolveBookSourceDir } from '../../src/core/catalog/content-paths.ts';
import type { AstroBookManifest } from '../../src/types/content-package.ts';

describe('StaticHandler Unit & Invariant Contract Tests (P1-A1)', () => {
  const ROOT = path.resolve(__dirname, '../..');
  const distDir = path.join(ROOT, 'dist');
  const artifactsAbpDir = resolveAbpArtifactsDir(ROOT);

  beforeAll(async () => {
    // 确保开发期测试至少有一本真实解包书籍
    const abpFile = path.join(artifactsAbpDir, 'math-math_senior.abp');
    if (!fs.existsSync(abpFile)) {
      const { packBook } = await import('../../scripts/pack-book-abp.mjs');
      await packBook({
        bookDir: resolveBookSourceDir('math', 'math_senior', ROOT),
        outDir: artifactsAbpDir,
        withVectors: false,
        includeAuxiliary: true,
      });
    }
  }, 120000);

  it('1. Canonical Slug 正确请求必须返回 HTTP 200 与 text/html 内容', async () => {
    const handler = new StaticHandler(distDir, undefined, ROOT);
    const url = '/collections/math/math_senior/07_11_%E5%9F%BA%E6%9C%AC%E5%85%AC%E5%BC%8F/';

    let statusCode = 0;
    let headers: Record<string, string> = {};
    let outputBuffer: Buffer | null = null;

    const handled = await handler.handle(
      { method: 'GET', url, headers: {} } as any,
      {
        writeHead: (code: number, h: any) => {
          statusCode = code;
          headers = h;
        },
        end: (chunk?: any) => {
          if (chunk) outputBuffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        },
      } as any
    );

    expect(handled).toBe(true);
    expect(statusCode).toBe(200);
    expect(headers['Content-Type']).toContain('text/html');
    expect(outputBuffer).not.toBeNull();
    const html = outputBuffer!.toString('utf8');
    expect(html).toContain('新高考数学你真的掌握了吗');
    expect(html).toContain('三角函数');
  });

  it('2. Legacy Slug 别名必须通过显式查表命中，并返回 HTTP 301 永久重定向', async () => {
    const handler = new StaticHandler(distDir, undefined, ROOT);
    const url = '/collections/math/math_senior/07_1.1_%E5%9F%BA%E6%9C%AC%E5%85%AC%E5%BC%8F/';

    let statusCode = 0;
    let headers: Record<string, string> = {};
    let outputBuffer: Buffer | null = null;

    const handled = await handler.handle(
      { method: 'GET', url, headers: {} } as any,
      {
        writeHead: (code: number, h: any) => {
          statusCode = code;
          headers = h;
        },
        end: (chunk?: any) => {
          if (chunk) outputBuffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        },
      } as any
    );

    expect(handled).toBe(true);
    expect(statusCode).toBe(301);
    expect(headers['Location']).toContain('07_11_%E5%9F%BA%E6%9C%AC%E5%85%AC%E5%BC%8F');
    expect(headers['Content-Type']).toContain('text/html');
  });

  it('3. 请求不存在的章节必须返回 HTTP 404 与符合学术规范的 HTML 视窗', async () => {
    const handler = new StaticHandler(distDir, undefined, ROOT);
    const url = '/collections/math/math_senior/invalid_random_slug_xyz/';

    let statusCode = 0;
    let headers: Record<string, string> = {};
    let outputBuffer: Buffer | null = null;

    const handled = await handler.handle(
      { method: 'GET', url, headers: {} } as any,
      {
        writeHead: (code: number, h: any) => {
          statusCode = code;
          headers = h;
        },
        end: (chunk?: any) => {
          if (chunk) outputBuffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        },
      } as any
    );

    expect(handled).toBe(true);
    expect(statusCode).toBe(404);
    expect(headers['Content-Type']).toContain('text/html');
    expect(outputBuffer).not.toBeNull();
    const html = outputBuffer!.toString('utf8');
    expect(html).toContain('404 - 章节或资源未找到');
    expect(html).toContain('invalid_random_slug_xyz');
    expect(html).toContain('返回研读书库');
  });

  it('4. 模糊匹配必须彻底禁止：前缀模糊路径必须返回 HTTP 404', async () => {
    const handler = new StaticHandler(distDir, undefined, ROOT);
    // 故意截断合法 slug，验证绝无任何模糊子串/前缀匹配
    const url = '/collections/math/math_senior/07_1/';

    let statusCode = 0;
    const handled = await handler.handle(
      { method: 'GET', url, headers: {} } as any,
      {
        writeHead: (code: number) => { statusCode = code; },
        end: () => {},
      } as any
    );

    expect(handled).toBe(true);
    expect(statusCode).toBe(404);
  });

  it('5. 请求不存在的书籍必须返回 HTTP 404 学术视窗', async () => {
    const handler = new StaticHandler(distDir, undefined, ROOT);
    const url = '/collections/math/unknown_book_999/chapter_01/';

    let statusCode = 0;
    let headers: Record<string, string> = {};
    let outputBuffer: Buffer | null = null;

    const handled = await handler.handle(
      { method: 'GET', url, headers: {} } as any,
      {
        writeHead: (code: number, h: any) => {
          statusCode = code;
          headers = h;
        },
        end: (chunk?: any) => {
          if (chunk) outputBuffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        },
      } as any
    );

    expect(handled).toBe(true);
    expect(statusCode).toBe(404);
    expect(headers['Content-Type']).toContain('text/html');
    expect(outputBuffer!.toString('utf8')).toContain('书籍未安装或不存在');
  });

  it('6. 请求书籍根路径 /collections/:col/:book/ 必须返回 302 重定向至 entryPoint', async () => {
    const handler = new StaticHandler(distDir, undefined, ROOT);
    const url = '/collections/math/math_senior/';

    let statusCode = 0;
    let headers: Record<string, string> = {};

    const handled = await handler.handle(
      { method: 'GET', url, headers: {} } as any,
      {
        writeHead: (code: number, h: any) => {
          statusCode = code;
          headers = h;
        },
        end: () => {},
      } as any
    );

    expect(handled).toBe(true);
    expect(statusCode).toBe(302);
    expect(decodeURIComponent(headers['Location'])).toContain('06_第1章-三角函数');
  });

  it('7. 官方 13 本书全量 1,251 章 Canonical Slug 绝对契约普查', () => {
    const catalogPath = path.join(artifactsAbpDir, 'catalog.json');
    expect(fs.existsSync(catalogPath)).toBe(true);

    const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    expect(Array.isArray(catalog.books)).toBe(true);
    expect(catalog.books.length).toBe(13);

    let totalChaptersCount = 0;
    let slugMismatchCount = 0;
    let legacySlugCount = 0;
    let missingFilesCount = 0;

    for (const book of catalog.books) {
      const manifestPath = path.join(artifactsAbpDir, book.id, 'manifest.json');
      expect(fs.existsSync(manifestPath)).toBe(true);

      const manifest: AstroBookManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const chaptersDir = path.join(artifactsAbpDir, book.id, 'chapters');
      expect(fs.existsSync(chaptersDir)).toBe(true);

      for (const section of manifest.sections) {
        for (const chapter of section.chapters) {
          totalChaptersCount++;

          // 核心断言 1：每个章节的 slug 必须恒等于 cleanSlug(slug)
          if (cleanSlug(chapter.slug) !== chapter.slug) {
            slugMismatchCount++;
          }

          // 核心断言 2：每个章节在 chapters/ 目录下必须有对应的物理 JSON 文件
          const chapFilePath = path.join(chaptersDir, `${chapter.slug}.json`);
          if (!fs.existsSync(chapFilePath)) {
            missingFilesCount++;
          }

          // 统计显式历史别名
          if (chapter.legacySlug) {
            legacySlugCount++;
            expect(chapter.legacySlug).not.toBe(chapter.slug);
          }
        }
      }
    }

    // 全量统计验证
    expect(totalChaptersCount).toBe(1251);
    expect(slugMismatchCount).toBe(0);
    expect(missingFilesCount).toBe(0);
    expect(legacySlugCount).toBe(1195);
  });
});
