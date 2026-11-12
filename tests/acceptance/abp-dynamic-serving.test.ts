import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { StaticHandler } from '../../electron/server/static-handler.ts';
import { resolveAbpArtifactsDir, resolveBookSourceDir } from '../../src/core/catalog/content-paths.ts';

describe('ABP Dynamic Content Serving Acceptance Test', () => {
  const ROOT = path.resolve(__dirname, '../..');
  const distDir = path.join(ROOT, 'dist');
  const artifactsAbpDir = resolveAbpArtifactsDir(ROOT);
  const testAbpPacksDir = path.join(ROOT, 'tests', 'fixtures', 'runtime-abp-serving');
  const targetDir = path.join(testAbpPacksDir, 'math-math_senior');
  const abpFile = path.join(artifactsAbpDir, 'math-math_senior.abp');

  beforeAll(async () => {
    if (!fs.existsSync(abpFile) || !fs.existsSync(path.join(artifactsAbpDir, 'catalog.json'))) {
      const { packBook } = await import('../../scripts/pack-book-abp.mjs');
      await packBook({
        bookDir: resolveBookSourceDir('math', 'math_senior', ROOT),
        outDir: artifactsAbpDir,
        withVectors: false,
        includeAuxiliary: true,
      });
    }
  });

  afterAll(() => {
    if (fs.existsSync(testAbpPacksDir)) {
      fs.rmSync(testAbpPacksDir, { recursive: true, force: true });
    }
  });

  it('自包含 ABP 安装解包目录结构必须完备（含辅助索引与规范化 Slug）', async () => {
    expect(fs.existsSync(abpFile)).toBe(true);

    if (fs.existsSync(testAbpPacksDir)) {
      fs.rmSync(testAbpPacksDir, { recursive: true, force: true });
    }
    const { DesktopBookManager } = await import('../../electron/services/book-manager.ts');
    const manager = new DesktopBookManager(testAbpPacksDir);
    await manager.installBookFromAbp(fs.readFileSync(abpFile));

    expect(fs.existsSync(targetDir)).toBe(true);
    expect(fs.existsSync(path.join(targetDir, 'manifest.json'))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, 'chapters'))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, 'ai-index.json'))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, 'relation-graph.json'))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, 'cross-refs.json'))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, 'inspector-data.json'))).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(path.join(targetDir, 'manifest.json'), 'utf8'));
    expect(manifest.id).toBe('math-math_senior');
    expect(manifest.totalChapters).toBeGreaterThan(0);
    expect(manifest.entryPoint).not.toContain('.');
  });

  it('StaticHandler 能即时合成 canonical slug 与 legacySlug 别名章节及自包含辅助数据', async () => {
    const handler = new StaticHandler(distDir, testAbpPacksDir);

    // 1. Canonical slug 与 Legacy 别名双重命中
    for (const url of [
      '/collections/math/math_senior/07_11_%E5%9F%BA%E6%9C%AC%E5%85%AC%E5%BC%8F/',
      '/collections/math/math_senior/07_1.1_%E5%9F%BA%E6%9C%AC%E5%85%AC%E5%BC%8F/',
    ]) {
      let statusCode = 0;
      let headers: any = {};
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
      const htmlText = outputBuffer!.toString('utf8');
      expect(htmlText).toContain('新高考数学你真的掌握了吗');
      expect(htmlText).toContain('三角函数');
    }

    // 2. 自包含辅助数据端点从已安装目录直出（无需 public/ 或 projectRoot）
    for (const auxUrl of [
      '/ai-index/math-math_senior.json',
      '/relation-graphs/math-math_senior.json',
      '/data/cross-ref/math-math_senior.json',
      '/inspector-data/math-math_senior.json',
    ]) {
      let statusCode = 0;
      const handled = await handler.handle(
        { method: 'GET', url: auxUrl, headers: {} } as any,
        {
          writeHead: (code: number) => { statusCode = code; },
          end: () => {},
        } as any
      );
      expect(handled).toBe(true);
      expect(statusCode).toBe(200);
    }
  });

  it('LocalServer 真实 HTTP 端口能正确响应开发态 artifacts /abp-packs/catalog.json 与 .abp 分发', async () => {
    const { LocalServer } = await import('../../electron/server/local-server.ts');
    const localServer = new LocalServer(ROOT, distDir);
    const port = await localServer.start(0);

    try {
      const catalogRes = await fetch(`http://127.0.0.1:${port}/abp-packs/catalog.json`);
      expect(catalogRes.status).toBe(200);
      expect(catalogRes.headers.get('content-type')).toContain('application/json');
      const catalogData: any = await catalogRes.json();
      expect(catalogData.schemaVersion).toBe('1.0.0');
      expect(Array.isArray(catalogData.books)).toBe(true);

      const book = catalogData.books.find((b: any) => b.id === 'math-math_senior');
      expect(book).toBeDefined();

      const abpRes = await fetch(`http://127.0.0.1:${port}/abp-packs/${book.packFileName}`);
      expect(abpRes.status).toBe(200);
      const abpBuf = await abpRes.arrayBuffer();
      expect(abpBuf.byteLength).toBeGreaterThan(1000);

      const { DesktopBookManager } = await import('../../electron/services/book-manager.ts');
      const testUserAbpDir = path.join(ROOT, 'tests', 'fixtures', 'runtime-user-abp');
      fs.mkdirSync(testUserAbpDir, { recursive: true });

      const desktopBookManager = new DesktopBookManager(testUserAbpDir);
      const meta = await desktopBookManager.installBookFromAbp(abpBuf);
      expect(meta.manifest.id).toBe('math-math_senior');
      expect(meta.manifest.title).toContain('新高考数学');

      const userStaticHandler = new StaticHandler(distDir, testUserAbpDir);
      const req: any = {
        method: 'GET',
        url: `/collections/${meta.manifest.colSlug}/${meta.manifest.slug}/${meta.manifest.entryPoint}/`,
        headers: {},
      };
      let outBuf: Buffer | null = null;
      let statusCode = 0;
      const res: any = {
        writeHead: (code: number) => { statusCode = code; },
        end: (chunk?: any) => { if (chunk) outBuf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); },
      };
      const handled = await userStaticHandler.handle(req, res);
      expect(handled).toBe(true);
      expect(statusCode).toBe(200);
      expect(outBuf).not.toBeNull();
      expect(outBuf!.toString('utf8')).toContain(meta.manifest.title);

      fs.rmSync(testUserAbpDir, { recursive: true, force: true });
    } finally {
      await localServer.stop();
    }
  });
});
