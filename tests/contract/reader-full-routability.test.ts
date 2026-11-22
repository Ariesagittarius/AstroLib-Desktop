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

describe('Reader Full 1,251 Canonical Routability Contract Suite', () => {
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

  it('全量 1,251 个 Canonical Slug 真实发起 HTTP 请求必须全部返回 200 与 text/html', async () => {
    const allUrls: string[] = [];

    for (const { colSlug, bookSlug, manifest } of bookPacks) {
      for (const sec of manifest.sections || []) {
        for (const ch of sec.chapters || []) {
          allUrls.push(`/collections/${colSlug}/${bookSlug}/${ch.slug}/`);
        }
      }
    }

    expect(allUrls.length).toBe(1251);

    let successCount = 0;
    const concurrency = 16;
    for (let i = 0; i < allUrls.length; i += concurrency) {
      const batch = allUrls.slice(i, i + concurrency);
      await Promise.all(
        batch.map(async (requestUrl) => {
          const res = await simulateGet(handler, requestUrl);
          expect(res.handled, `URL [${requestUrl}] 必须被 StaticHandler 接管`).toBe(true);
          expect(res.statusCode, `Canonical URL [${requestUrl}] 必须返回 HTTP 200`).toBe(200);
          expect(res.headers['Content-Type']).toContain('text/html');
          successCount++;
        })
      );
    }

    expect(successCount).toBe(1251);
  }, 120000);
});
