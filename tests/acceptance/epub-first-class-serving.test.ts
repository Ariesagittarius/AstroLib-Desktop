import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { DesktopBookManager } from '../../electron/services/book-manager.ts';
import { StaticHandler } from '../../electron/server/static-handler.ts';
import { runClientTool } from '../../src/ai/tools-client.mjs';
import { ContentApiService } from '../../src/core/content-api/content-api-service.ts';
import { buildFallbackAstTreeFromHtml } from '../../src/core/annotations/annotation-ast-linker.ts';
import type { AstroBookManifest } from '../../src/types/content-package.ts';

const ROOT = path.resolve(__dirname, '../..');
const SAMPLE_EPUB_PATH = path.join(ROOT, 'task', '某暗部的少女共栖4.epub');
const TEST_EPUB_PACKS_DIR = path.join(ROOT, 'tests', 'fixtures', 'runtime-epub-serving');
const DIST_DIR = path.join(ROOT, 'dist');

async function dispatchStatic(
  handler: StaticHandler,
  url: string
): Promise<{ handled: boolean; statusCode: number; headers: Record<string, any>; body: Buffer }> {
  let statusCode = 0;
  let headers: Record<string, any> = {};
  const chunks: Buffer[] = [];
  const res = new PassThrough() as any;

  res.writeHead = (code: number, h: Record<string, any> = {}) => {
    statusCode = code;
    headers = h;
    return res;
  };
  res.setHeader = (k: string, v: any) => {
    headers[k] = v;
  };

  const endPromise = new Promise<void>((resolve) => {
    res.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    res.on('finish', () => resolve());
    res.on('end', () => resolve());
  });

  const handled = await handler.handle(
    { method: 'GET', url, headers: {} } as any,
    res
  );

  if (handled && !res.writableEnded) {
    res.end();
  }
  await endPromise;
  return { handled, statusCode, headers, body: Buffer.concat(chunks) };
}

describe('EPUB First-Class Citizen End-to-End Serving Acceptance Test', () => {
  let installedManifest: AstroBookManifest;
  let installedBookDir = '';
  const prevUserAbpEnv = process.env.ASTROLIB_USER_ABP_DIR;

  beforeAll(async () => {
    if (fs.existsSync(TEST_EPUB_PACKS_DIR)) {
      fs.rmSync(TEST_EPUB_PACKS_DIR, { recursive: true, force: true });
    }
    expect(fs.existsSync(SAMPLE_EPUB_PATH)).toBe(true);

    const manager = new DesktopBookManager(TEST_EPUB_PACKS_DIR);
    const bytes = fs.readFileSync(SAMPLE_EPUB_PATH);
    await manager.installBookFromFile('某暗部的少女共栖4.epub', bytes);

    const dirs = fs
      .readdirSync(TEST_EPUB_PACKS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
      .map((d) => d.name);
    expect(dirs.length).toBe(1);
    installedBookDir = path.join(TEST_EPUB_PACKS_DIR, dirs[0]);
    installedManifest = JSON.parse(
      fs.readFileSync(path.join(installedBookDir, 'manifest.json'), 'utf-8')
    );

    process.env.ASTROLIB_USER_ABP_DIR = TEST_EPUB_PACKS_DIR;
  }, 60000);

  afterAll(() => {
    if (prevUserAbpEnv === undefined) {
      delete process.env.ASTROLIB_USER_ABP_DIR;
    } else {
      process.env.ASTROLIB_USER_ABP_DIR = prevUserAbpEnv;
    }
    if (fs.existsSync(TEST_EPUB_PACKS_DIR)) {
      fs.rmSync(TEST_EPUB_PACKS_DIR, { recursive: true, force: true });
    }
  });

  it('磁盘解包产物应与 ABP 一等公民完全一致并无损保留 source/original.epub 与 ai-index.json', () => {
    expect(fs.existsSync(path.join(installedBookDir, 'manifest.json'))).toBe(true);
    expect(fs.existsSync(path.join(installedBookDir, 'chapters'))).toBe(true);
    expect(fs.existsSync(path.join(installedBookDir, 'ai-index.json'))).toBe(true);
    expect(fs.existsSync(path.join(installedBookDir, 'styles', 'epub-book.css'))).toBe(true);
    expect(fs.existsSync(path.join(installedBookDir, 'source', 'original.epub'))).toBe(true);

    expect(installedManifest.sourceFormat).toBe('epub');
    expect(installedManifest.readingProfile).toBe('literary');
  });

  it('StaticHandler 应能伺服 EPUB 章节、版式引擎、作用域样式表、内嵌字体、图片与 AI 索引', async () => {
    const handler = new StaticHandler(DIST_DIR, TEST_EPUB_PACKS_DIR);
    const { colSlug, slug, entryPoint, id } = installedManifest;

    // 1. 请求入口正文页 HTML
    const entryUrl = `/collections/${colSlug}/${slug}/${encodeURIComponent(entryPoint)}/`;
    const htmlRes = await dispatchStatic(handler, entryUrl);
    expect(htmlRes.handled).toBe(true);
    expect(htmlRes.statusCode).toBe(200);
    expect(String(htmlRes.headers['Content-Type'] || '')).toContain('text/html');

    const htmlText = htmlRes.body.toString('utf-8');
    expect(htmlText).toContain('data-reading-profile="literary"');
    expect(htmlText).toContain('vp-reading-layout-btn');
    expect(htmlText).toContain('__book_footnotes__');
    expect(htmlText).toContain('styles/epub-book.css');

    // 1.1 查找包含 NAV 子锚点 #toc-1 与脚注的章节并验证大纲树与脚注载体注入
    const chapterFiles = fs.readdirSync(path.join(installedBookDir, 'chapters')).filter((f) => f.endsWith('.json'));
    const tocSubChap = chapterFiles
      .map((f) => JSON.parse(fs.readFileSync(path.join(installedBookDir, 'chapters', f), 'utf-8')))
      .find((c) => Array.isArray(c.headings) && c.headings.some((h: any) => h.id === 'toc-1'));
    expect(tocSubChap).toBeDefined();
    const tocRes = await dispatchStatic(
      handler,
      `/collections/${colSlug}/${slug}/${encodeURIComponent(tocSubChap.chapterSlug)}/`
    );
    expect(tocRes.handled).toBe(true);
    expect(tocRes.statusCode).toBe(200);
    expect(tocRes.body.toString('utf-8')).toContain('#toc-1');

    // 2. 请求作用域样式表 styles/epub-book.css
    const cssRes = await dispatchStatic(handler, `/collections/${colSlug}/${slug}/styles/epub-book.css`);
    expect(cssRes.handled).toBe(true);
    expect(cssRes.statusCode).toBe(200);
    expect(String(cssRes.headers['Content-Type'] || '')).toContain('text/css');
    expect(cssRes.body.toString('utf-8')).toContain('.astrolib-book-scope');

    // 3. 请求嵌入式图片资产与字体资产
    const imageRel = installedManifest.assets?.find((a) => /\.(?:jpg|jpeg|png|webp)$/i.test(a));
    expect(imageRel).toBeDefined();
    const imgRes = await dispatchStatic(handler, `/collections/${colSlug}/${slug}/${encodeURI(imageRel!)}`);
    expect(imgRes.handled).toBe(true);
    expect(imgRes.statusCode).toBe(200);
    expect(imgRes.body.byteLength).toBeGreaterThan(100);

    const fontRel = installedManifest.assets?.find((a) => /\.(?:woff2?|ttf|otf)$/i.test(a));
    expect(fontRel).toBeDefined();
    const fontRes = await dispatchStatic(handler, `/collections/${colSlug}/${slug}/${encodeURI(fontRel!)}`);
    expect(fontRes.handled).toBe(true);
    expect(fontRes.statusCode).toBe(200);
    expect(fontRes.body.byteLength).toBeGreaterThan(100);

    // 4. 请求 AI 检索索引 /ai-index/<bookId>.json
    const aiRes = await dispatchStatic(handler, `/ai-index/${encodeURIComponent(id)}.json`);
    expect(aiRes.handled).toBe(true);
    expect(aiRes.statusCode).toBe(200);
    const aiIndex = JSON.parse(aiRes.body.toString('utf-8'));
    expect(aiIndex.chunks.length).toBeGreaterThan(20);

    // 5. 客户端 AI 检索工具原生可用（零格式特化）
    const retrieveResult = await runClientTool(
      'book_retrieve',
      { question: '暗部 麦野', topK: 4 },
      { index: aiIndex, bookList: [{ col: colSlug, book: slug, title: installedManifest.title }], col: colSlug, book: slug }
    );
    expect(Array.isArray(retrieveResult.results)).toBe(true);
    expect(retrieveResult.results.length).toBeGreaterThan(0);

    // 6. ContentApiService 发现与 AST 批注回退树均原生工作
    const api = new ContentApiService();
    const listed = api.listBooks();
    expect(listed.some((b) => b.colSlug === colSlug && b.slug === slug)).toBe(true);
    const toc = api.getBookToc(colSlug, slug);
    expect(toc.catalog.length).toBeGreaterThan(0);

    const chapterFile = path.join(installedBookDir, 'chapters', `${entryPoint}.json`);
    const chapJson = JSON.parse(fs.readFileSync(chapterFile, 'utf-8'));
    const astNodes = buildFallbackAstTreeFromHtml(chapJson.html);
    expect(astNodes.length).toBeGreaterThan(0);
  });
});
