import { describe, it, expect, vi, beforeEach } from 'vitest';
import zlib from 'node:zlib';
import {
  getContentProvider,
  WebContentProvider,
  ElectronContentProvider,
} from '@/services/content-provider/index.ts';
import { renderReaderPageHtml } from '@/services/content-provider/reader-shell-template.ts';
import { ABP_SCHEMA_VERSION, type AstroBookManifest } from '@/types/content-package.ts';

describe('Content Provider Engine Unit Tests', () => {
  it('getContentProvider() 能够在浏览器和默认环境返回 WebContentProvider 单例', () => {
    const provider = getContentProvider();
    expect(provider).toBeDefined();
    expect(provider instanceof WebContentProvider).toBe(true);
  });

  it('WebContentProvider 能正确解包安装 Gzip 压缩的 .abp 数据', async () => {
    const provider = new WebContentProvider();

    const mockManifest: AstroBookManifest = {
      schemaVersion: ABP_SCHEMA_VERSION,
      id: 'math-test_book',
      slug: 'test_book',
      colSlug: 'math',
      title: '测试数学教材',
      entryPoint: '01_intro',
      totalChapters: 1,
      updatedAt: new Date().toISOString(),
      contentHash: 'hash-test',
      sections: [],
    };

    const mockChapter = {
      schemaVersion: ABP_SCHEMA_VERSION,
      bookId: 'math-test_book',
      bookSlug: 'test_book',
      colSlug: 'math',
      chapterSlug: '01_intro',
      title: '第 1 节 导论',
      html: '<p>测试正文</p>',
      headings: [],
      updatedAt: new Date().toISOString(),
    };

    const bundle = {
      manifest: mockManifest,
      chapters: {
        '01_intro': mockChapter,
      },
    };

    const gzipped = zlib.gzipSync(Buffer.from(JSON.stringify(bundle), 'utf8'));

    // 测试内存与 IndexedDB 回退解压
    const meta = await provider.installBookFromAbp(gzipped);
    expect(meta.manifest.id).toBe('math-test_book');
    expect(meta.manifest.title).toBe('测试数学教材');

    const retrievedManifest = await provider.getBookManifest('math', 'test_book');
    expect(retrievedManifest?.title).toBe('测试数学教材');

    const retrievedChapter = await provider.getChapterPayload('math', 'test_book', '01_intro');
    expect(retrievedChapter?.title).toBe('第 1 节 导论');
    expect(retrievedChapter?.html).toContain('测试正文');
  });

  it('ElectronContentProvider 在缺少 IPC 桥接时能优雅回退至 Web 存储且不抛错', async () => {
    const provider = new ElectronContentProvider();
    const books = await provider.getInstalledBooks();
    expect(Array.isArray(books)).toBe(true);

    const mockManifest: AstroBookManifest = {
      schemaVersion: ABP_SCHEMA_VERSION,
      id: 'cs-demo',
      slug: 'demo',
      colSlug: 'cs',
      title: '降级测试书目',
      entryPoint: '01_main',
      totalChapters: 1,
      updatedAt: new Date().toISOString(),
      contentHash: 'hash-demo',
      sections: [],
    };
    const bundle = {
      manifest: mockManifest,
      chapters: {
        '01_main': {
          schemaVersion: ABP_SCHEMA_VERSION,
          bookId: 'cs-demo',
          bookSlug: 'demo',
          colSlug: 'cs',
          chapterSlug: '01_main',
          title: '第一章',
          html: '<h1>Hello</h1>',
          headings: [],
          updatedAt: new Date().toISOString(),
        },
      },
    };
    const gzipped = zlib.gzipSync(Buffer.from(JSON.stringify(bundle), 'utf8'));

    // 严禁抛出“未检测到 Electron IPC 桥接接口！”
    const meta = await provider.installBookFromAbp(gzipped);
    expect(meta.manifest.id).toBe('cs-demo');

    const manifest = await provider.getBookManifest('cs', 'demo');
    expect(manifest?.title).toBe('降级测试书目');
  });

  it('fetchRemoteCatalog 针对相对路径或本地路径不应错误拼装 GitHub 域名', async () => {
    const provider = new ElectronContentProvider();
    let requestedUrl = '';
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => {
      requestedUrl = url;
      return {
        ok: true,
        json: async () => ({
          schemaVersion: ABP_SCHEMA_VERSION,
          catalogName: 'Mock Catalog',
          generatedAt: new Date().toISOString(),
          books: [],
        }),
      };
    }));

    const catalog = await provider.fetchRemoteCatalog({
      id: 'local-cat',
      name: 'Local Catalog',
      type: 'direct-url' as any,
      urlOrRepo: '/abp-packs/catalog.json',
      enabled: true,
    });

    expect(requestedUrl).toBe('/abp-packs/catalog.json');
    expect(catalog.catalogName).toBe('Mock Catalog');
    vi.unstubAllGlobals();
  });

  it('renderReaderPageHtml 能够合成纯净单窗口阅读页（剔除全局设施，仅保留当前书目目录、公式渲染与 Sideload 侧载栏）', () => {
    const mockManifest: AstroBookManifest = {
      schemaVersion: ABP_SCHEMA_VERSION,
      id: 'math-math_analysis',
      slug: 'math_analysis',
      colSlug: 'math',
      title: '工科数学分析（上册）',
      author: '孙振绮 主编',
      publisher: '机械工业出版社',
      stageLabel: '大学本科',
      categoryLabel: '教材',
      entryPoint: '01_intro',
      totalChapters: 2,
      updatedAt: new Date().toISOString(),
      contentHash: 'hash-test',
      sections: [
        {
          id: 'sec-2',
          slug: 'sec-2',
          title: '第二章 数列极限',
          chapters: [
            { id: 'ch-1', slug: '01_intro', title: '§ 2.1 数列极限的基本概念', path: 'chapters/01_intro.json', hash: 'h1', sizeBytes: 100 },
            { id: 'ch-2', slug: '05_euler', title: '§ 2.5 自然对数的底 $e$ 和 $Euler$ 常数 $\\gamma$', path: 'chapters/05_euler.json', hash: 'h2', sizeBytes: 200 },
          ],
        },
      ],
    };

    const mockPayload = {
      schemaVersion: ABP_SCHEMA_VERSION,
      bookId: 'math-math_analysis',
      bookSlug: 'math_analysis',
      colSlug: 'math',
      chapterSlug: '05_euler',
      title: '§ 2.5 自然对数的底 $e$ 和 $Euler$ 常数 $\\gamma$',
      html: '<p>本节推导自然对数的底 $e$。</p>',
      headings: [
        { id: '1-自然对数的底-e', text: '1. 自然对数的底 $e$', depth: 2 },
      ],
      updatedAt: new Date().toISOString(),
    };

    const renderedHtml = renderReaderPageHtml(mockManifest, mockPayload);

    // 1. 验证顶栏纯净：保留单窗口阅读控制器，剔除全局设置/主题/工作台/GitHub/Brand 设施
    const headerMatch = renderedHtml.match(/<header[\s\S]*?<\/header>/i);
    const headerHtml = headerMatch ? headerMatch[0] : '';
    expect(headerHtml).toContain('vp-sidebar-toggle-btn');
    expect(headerHtml).toContain('astrolib-search-trigger');
    expect(headerHtml).toContain('vp-right-sidebar-toggle-btn');
    expect(headerHtml).toContain('vp-translate-btn');
    expect(headerHtml).toContain('vp-focus-btn');
    expect(headerHtml).not.toContain('vp-brand-link');
    expect(headerHtml).not.toContain('vp-blank-doc-btn');
    expect(headerHtml).not.toContain('starlight-feature-toggles');
    expect(headerHtml).not.toContain('starlight-theme-select');
    expect(headerHtml).not.toContain('vp-tools-wrapper');
    expect(headerHtml).not.toContain('vp-social-group');

    // 2. 验证左侧目录树仅渲染当前书目章节（不含跨学科及其他书目）与 KaTeX 公式渲染
    const sidebarMatch = renderedHtml.match(/<sl-sidebar-state-persist[\s\S]*?<\/sl-sidebar-state-persist>/i);
    const sidebarHtml = sidebarMatch ? sidebarMatch[0] : '';
    expect(sidebarHtml).toContain('current-book-sidebar');
    expect(sidebarHtml).not.toContain('sidebar-category-item');
    expect(sidebarHtml).toContain('gdocs-outline-link');
    expect(sidebarHtml).toContain('aria-current="page"');
    // $e$ 和 $\gamma$ 必须渲染为 KaTeX HTML 而非裸字符
    expect(sidebarHtml).toContain('annotation encoding="application/x-tex">e</annotation>');
    expect(sidebarHtml).toContain('annotation encoding="application/x-tex">\\gamma</annotation>');

    // 3. 验证 MinerU OCR 提示框架与出版信息元数据 Chips
    expect(renderedHtml).toContain('astrolib-notice-framework');
    expect(renderedHtml).toContain('chapter-meta-chip-set');
    expect(renderedHtml).toContain('孙振绮 主编');
    expect(renderedHtml).toContain('机械工业出版社');
    expect(renderedHtml).toContain('《工科数学分析（上册）》');
    expect(renderedHtml).toContain('大学本科 · 教材');
    expect(renderedHtml).toContain('双语助读 (Alt+Y)');

    // 4. 验证右侧 Sideload Dock 与 AI FAB
    expect(renderedHtml).toContain('astrolib-sideload-dock');
    expect(renderedHtml).toContain('custom-toc-list');
    expect(renderedHtml).toContain('ask-fab');
  });
});
