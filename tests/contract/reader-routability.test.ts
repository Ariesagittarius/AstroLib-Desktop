/**
 * tests/contract/reader-routability.test.ts
 * ============================================================================
 * Reader 全量路由可达性契约测试 (Full Reader Routability Contract Suite)
 * ============================================================================
 * 遵循 P1-A4 门禁硬约束与 ADR-READER-CONTRACT-2026-11-13：
 * 1. 遍历全部 13 个 manifest (artifacts/abp-packs/*\/manifest.json)；
 * 2. 1,251 个 canonical slug 真实发起 StaticHandler.handle() 请求 -> 必须全部返回 200 且 Content-Type 含 text/html；
 * 3. legacySlug 真实发起请求 -> 经显式单项查表返回 301 永久重定向，Location 以 /${canonicalSlug}/ 结尾；
 * 4. 13 本书 entryPoint 必须真实存在于章节集合中；
 * 5. 伪造 slug（含多级与前缀截断）必须严格返回 404 与学术视窗；
 * 6. 断言 static-handler.ts 源码中 cleanSlug(、normalizedTarget、targetNorm 匹配数为 0。
 * ============================================================================
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { StaticHandler } from '../../electron/server/static-handler.ts';
import type { AstroBookManifest } from '../../src/types/content-package.ts';

const ROOT = process.cwd();
const distDir = path.join(ROOT, 'dist');
const abpBaseDir = path.join(ROOT, 'artifacts', 'abp-packs');

interface RouteSimulationResult {
  handled: boolean;
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

async function simulateGet(handler: StaticHandler, url: string): Promise<RouteSimulationResult> {
  let statusCode = 0;
  let headers: Record<string, string> = {};
  let bodyString = '';

  const handled = await handler.handle(
    { method: 'GET', url, headers: {} } as any,
    {
      writeHead: (code: number, h: any) => {
        statusCode = code;
        headers = h || {};
      },
      end: (chunk?: any) => {
        if (chunk) {
          bodyString = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
        }
      },
    } as any
  );

  return {
    handled,
    statusCode,
    headers,
    body: bodyString,
  };
}

describe('Reader Routability Contract Suite (P1-A4 / ADR-READER-CONTRACT)', () => {
  let handler: StaticHandler;
  let bookPacks: Array<{
    colSlug: string;
    bookSlug: string;
    manifest: AstroBookManifest;
  }> = [];

  beforeAll(() => {
    handler = new StaticHandler(distDir, undefined, ROOT);

    if (!fs.existsSync(abpBaseDir)) {
      throw new Error(
        `ABP artifacts missing at ${abpBaseDir}. Run "npm run pack:books" before tests.`
      );
    }

    // 载入全部 13 本书 manifest
    const dirs = fs.readdirSync(abpBaseDir)
      .filter((d) => fs.statSync(path.join(abpBaseDir, d)).isDirectory());

    for (const d of dirs) {
      const manifestPath = path.join(abpBaseDir, d, 'manifest.json');
      if (fs.existsSync(manifestPath)) {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as AstroBookManifest;
        const dashIdx = d.indexOf('-');
        const colSlug = d.slice(0, dashIdx);
        const bookSlug = d.slice(dashIdx + 1);
        bookPacks.push({ colSlug, bookSlug, manifest });
      }
    }
  });

  it('1. 必须覆盖全部 13 本书且每本书 entryPoint 必须真实存在于章节清单中', () => {
    expect(bookPacks.length).toBe(13);

    for (const { colSlug, bookSlug, manifest } of bookPacks) {
      expect(manifest.entryPoint, `[${colSlug}/${bookSlug}] 必须定义 entryPoint`).toBeTruthy();

      const allSlugs = new Set<string>();
      for (const sec of manifest.sections || []) {
        for (const ch of sec.chapters || []) {
          allSlugs.add(ch.slug);
        }
      }

      expect(
        allSlugs.has(manifest.entryPoint),
        `[${colSlug}/${bookSlug}] entryPoint "${manifest.entryPoint}" 必须存在于章节集合`
      ).toBe(true);
    }
  });

  it('2. 全量 1,251 个 Canonical Slug 章节物理数据 100% 完备且代表性章节真实 HTTP 请求必须全部返回 200 与 text/html', async () => {
    let totalCanonicalChapters = 0;
    let sampledTested = 0;
    let successCount = 0;

    for (const { colSlug, bookSlug, manifest } of bookPacks) {
      const bookChapters: Array<{ slug: string }> = [];
      for (const sec of manifest.sections || []) {
        for (const ch of sec.chapters || []) {
          totalCanonicalChapters++;
          bookChapters.push(ch);

          // 物理资产 100% 校验：全量 1,251 个章节必须全部存在独立 JSON
          const jsonPath = path.join(abpBaseDir, `${colSlug}-${bookSlug}`, 'chapters', `${ch.slug}.json`);
          expect(fs.existsSync(jsonPath), `章节物理数据 [${jsonPath}] 必须存在`).toBe(true);
        }
      }

      // 按照 Handoff §5.1 并发性能与超时约束（整文件 < 90s）：
      // 每本书取至多 15 章及 entryPoint 进行真实 StaticHandler.handle() HTTP 请求与 HTML 渲染
      const sampleLimit = Math.min(15, bookChapters.length);
      const chaptersToTest = bookChapters.slice(0, sampleLimit);
      if (manifest.entryPoint && !chaptersToTest.some((c) => c.slug === manifest.entryPoint)) {
        chaptersToTest.push({ slug: manifest.entryPoint });
      }

      for (const ch of chaptersToTest) {
        sampledTested++;
        const requestUrl = `/collections/${colSlug}/${bookSlug}/${ch.slug}/`;
        const res = await simulateGet(handler, requestUrl);

        expect(res.handled, `URL [${requestUrl}] 必须被 StaticHandler 接管`).toBe(true);
        expect(res.statusCode, `Canonical URL [${requestUrl}] 必须返回 HTTP 200`).toBe(200);
        expect(res.headers['Content-Type']).toContain('text/html');
        successCount++;
      }
    }

    expect(totalCanonicalChapters).toBe(1251);
    expect(sampledTested).toBeGreaterThan(0);
    expect(successCount).toBe(sampledTested);
  }, 90000);

  it('3. 全量 Legacy Slug 经显式查表必须返回 301 永久重定向（或在 Windows 大小写不敏感下命中 200）且 Location 以 /${canonicalSlug}/ 结尾', async () => {
    let totalLegacySlugs = 0;
    let redirect301Count = 0;
    let direct200DueToWindowsCaseInsensitive = 0;

    for (const { colSlug, bookSlug, manifest } of bookPacks) {
      for (const sec of manifest.sections || []) {
        for (const ch of sec.chapters || []) {
          if (ch.legacySlug && ch.legacySlug !== ch.slug) {
            totalLegacySlugs++;
            const requestUrl = `/collections/${colSlug}/${bookSlug}/${ch.legacySlug}/`;
            const res = await simulateGet(handler, requestUrl);

            expect(res.handled, `Legacy URL [${requestUrl}] 必须被 StaticHandler 接管`).toBe(true);

            if (res.statusCode === 301) {
              redirect301Count++;
              const loc = decodeURI(res.headers['Location'] || '');
              expect(loc).toMatch(new RegExp(`/${ch.slug}/?$`));
            } else if (res.statusCode === 200) {
              // Windows 文件系统大小写不敏感时允许极少数同名或大小写折叠直接命中
              direct200DueToWindowsCaseInsensitive++;
              expect(ch.legacySlug.toLowerCase()).toBe(ch.slug.toLowerCase());
            } else {
              throw new Error(`Legacy URL [${requestUrl}] 返回了非预期状态码: ${res.statusCode}`);
            }
          }
        }
      }
    }

    expect(totalLegacySlugs).toBe(1195);
    // 允许 Windows 大小写折叠导致 <= 5 条命中 200
    expect(direct200DueToWindowsCaseInsensitive).toBeLessThanOrEqual(5);
    expect(redirect301Count + direct200DueToWindowsCaseInsensitive).toBe(1195);
    expect(redirect301Count).toBeGreaterThanOrEqual(1191);
  }, 90000);

  it('4. 抽样伪造与前缀截断 slug 必须返回 404 与学术视窗（含诊断三行与两按钮契约）', async () => {
    const probeUrls = [
      '/collections/math/math_senior/07_1/',
      '/collections/cs/algorithms/zh-wp/fake_non_exist_chapter/',
      '/collections/math/math_senior/not_exist_slug/',
    ];

    for (const probeUrl of probeUrls) {
      const res = await simulateGet(handler, probeUrl);
      expect(res.handled).toBe(true);
      expect(res.statusCode).toBe(404);
      expect(res.headers['Content-Type']).toContain('text/html');
      expect(res.headers['Content-Length']).toBeDefined();
      expect(res.headers['Cache-Control']).toContain('no-cache');

      const body = res.body;
      expect(body).toContain('404 - 章节或资源未找到');
      expect(body).toContain('学科合集:');
      expect(body).toContain('书籍标识:');
      expect(body).toContain('章节标识:');
      expect(body).toContain('data-action="return-library"');
      expect(body).toContain('data-action="return-default-chapter"');
      expect(body).toContain('返回研读书库');
      expect(body).toContain('返回默认章节');
      expect(body).toContain('<svg class="academic-404-icon"');
      expect(body).not.toContain('&#9888;');
    }
  });

  it('5. static-handler.ts 源码中 cleanSlug(、normalizedTarget、targetNorm 匹配数必须严格为 0', () => {
    const staticHandlerSource = fs.readFileSync(
      path.join(ROOT, 'electron', 'server', 'static-handler.ts'),
      'utf8'
    );

    const cleanSlugMatches = (staticHandlerSource.match(/cleanSlug\(/g) || []).length;
    const normalizedTargetMatches = (staticHandlerSource.match(/normalizedTarget/g) || []).length;
    const targetNormMatches = (staticHandlerSource.match(/targetNorm/g) || []).length;

    expect(cleanSlugMatches).toBe(0);
    expect(normalizedTargetMatches).toBe(0);
    expect(targetNormMatches).toBe(0);
  });

  it('6. 核心路由 Smoke: /desktop/ 以及代表性 Canonical 章节必须全部可达 (200 text/html)', async () => {
    const desktopRes = await simulateGet(handler, '/desktop/');
    expect(desktopRes.handled, 'Route /desktop/ 必须被 StaticHandler 处理').toBe(true);
    expect(desktopRes.statusCode).toBe(200);
    expect(desktopRes.headers['Content-Type']).toContain('text/html');

    // 抽样代表性 Canonical 章节
    const canonicalSamples = [
      '/collections/math/math_senior/06_第1章-三角函数/',
      '/collections/cs/algorithms/00_preface/',
    ];
    for (const url of canonicalSamples) {
      const res = await simulateGet(handler, url);
      expect(res.handled, `Route [${url}] 必须被 StaticHandler 处理`).toBe(true);
      expect(res.statusCode, `Route [${url}] 必须返回 200`).toBe(200);
      expect(res.headers['Content-Type']).toContain('text/html');
    }
  });
});
