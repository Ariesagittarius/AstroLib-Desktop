import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { StaticHandler } from '../../electron/server/static-handler.ts';

describe('ABP Dynamic Content Serving Acceptance Test', () => {
  const ROOT = path.resolve(__dirname, '../..');
  const distDir = path.join(ROOT, 'dist');
  const testAbpPacksDir = path.join(ROOT, 'tests', 'fixtures', 'runtime-abp-serving');
  const targetDir = path.join(testAbpPacksDir, 'math-math_senior');

  it('预编译生成的 ABP 散列目录结构必须完备', async () => {
    const abpFile = path.join(ROOT, 'public', 'abp-packs', 'math-math_senior.abp');
    expect(fs.existsSync(abpFile)).toBe(true);

    if (!fs.existsSync(targetDir)) {
      const { DesktopBookManager } = await import('../../electron/services/book-manager.ts');
      const manager = new DesktopBookManager(testAbpPacksDir);
      await manager.installBookFromAbp(fs.readFileSync(abpFile));
    }

    expect(fs.existsSync(targetDir)).toBe(true);
    expect(fs.existsSync(path.join(targetDir, 'manifest.json'))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, 'chapters'))).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(path.join(targetDir, 'manifest.json'), 'utf8'));
    expect(manifest.id).toBe('math-math_senior');
    expect(manifest.totalChapters).toBeGreaterThan(0);
  });

  it('StaticHandler 能在无静态预编译 HTML 的情况下即时合成并分发 ABP 章节', async () => {
    const handler = new StaticHandler(distDir, testAbpPacksDir);

    const req: any = {
      method: 'GET',
      url: '/collections/math/math_senior/07_1.1_%E5%9F%BA%E6%9C%AC%E5%85%AC%E5%BC%8F/',
      headers: {},
    };

    let statusCode = 0;
    let headers: any = {};
    let outputBuffer: Buffer | null = null;

    const res: any = {
      writeHead: (code: number, h: any) => {
        statusCode = code;
        headers = h;
      },
      end: (chunk?: any) => {
        if (chunk) outputBuffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      },
    };

    const handled = await handler.handle(req, res);
    expect(handled).toBe(true);
    expect(statusCode).toBe(200);
    expect(headers['Content-Type']).toContain('text/html');
    expect(outputBuffer).not.toBeNull();
    const htmlText = outputBuffer!.toString('utf8');
    expect(htmlText).toContain('新高考数学你真的掌握了吗');
    expect(htmlText).toContain('三角函数');
  });

  it('LocalServer 真实 HTTP 端口能正确响应 /abp-packs/catalog.json 与 .abp 文件分发', async () => {
    const { LocalServer } = await import('../../electron/server/local-server.ts');
    const localServer = new LocalServer(ROOT, distDir);
    const port = await localServer.start(0);

    try {
      // 1. 请求 catalog.json
      const catalogRes = await fetch(`http://127.0.0.1:${port}/abp-packs/catalog.json`);
      expect(catalogRes.status).toBe(200);
      expect(catalogRes.headers.get('content-type')).toContain('application/json');
      const catalogData: any = await catalogRes.json();
      expect(catalogData.schemaVersion).toBe('1.0.0');
      expect(Array.isArray(catalogData.books)).toBe(true);
      expect(catalogData.books.length).toBeGreaterThan(0);

      // 2. 验证书目包含 math-math_senior 且能通过 HTTP 下载 .abp 包
      const book = catalogData.books.find((b: any) => b.id === 'math-math_senior');
      expect(book).toBeDefined();

      const abpRes = await fetch(`http://127.0.0.1:${port}/abp-packs/${book.packFileName}`);
      expect(abpRes.status).toBe(200);
      const abpBuf = await abpRes.arrayBuffer();
      expect(abpBuf.byteLength).toBeGreaterThan(1000);

      // 3. 验证 DesktopBookManager 原生解包安装从该 HTTP 下载的数据
      const { DesktopBookManager } = await import('../../electron/services/book-manager.ts');
      const testUserAbpDir = path.join(ROOT, 'tests', 'fixtures', 'runtime-user-abp');
      fs.mkdirSync(testUserAbpDir, { recursive: true });

      const desktopBookManager = new DesktopBookManager(testUserAbpDir);
      const meta = await desktopBookManager.installBookFromAbp(abpBuf);
      expect(meta.manifest.id).toBe('math-math_senior');
      expect(meta.manifest.title).toContain('新高考数学');

      // 4. 验证装配了 userAbpDir 的 StaticHandler 能即时合成已安装章节
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

      // 清理测试临时目录
      fs.rmSync(testUserAbpDir, { recursive: true, force: true });
    } finally {
      await localServer.stop();
    }
  });
});
