import { describe, it, expect, vi, beforeEach } from 'vitest';
import zlib from 'node:zlib';
import path from 'node:path';
import fs from 'node:fs';
import {
  getContentProvider,
  WebContentProvider,
  ElectronContentProvider,
} from '@/services/content-provider/index.ts';
import {
  AbpInstallError,
  AbpInstallErrorCode,
} from '@/services/content-provider/install-validation.ts';
import devLibraryServerPlugin from '../../src/server/plugins/library/dev-server-plugin.mjs';
import { renderReaderPageHtml } from '../../electron/server/reader-shell-template.ts';
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

    const meta = await provider.installBookFromAbp(gzipped);
    expect(meta.manifest.id).toBe('math-test_book');
    expect(meta.manifest.title).toBe('测试数学教材');

    const retrievedManifest = await provider.getBookManifest('math', 'test_book');
    expect(retrievedManifest?.title).toBe('测试数学教材');

    const retrievedChapter = await provider.getChapterPayload('math', 'test_book', '01_intro');
    expect(retrievedChapter?.title).toBe('第 1 节 导论');
    expect(retrievedChapter?.html).toContain('测试正文');
  });

  it('ElectronContentProvider 在缺少 IPC 桥接时必须显式报错且严禁静默降级至 Web 存储', async () => {
    const provider = new ElectronContentProvider();
    await expect(provider.getInstalledBooks()).rejects.toThrow('未检测到 Electron 桌面端 IPC 桥接接口');

    const mockManifest: AstroBookManifest = {
      schemaVersion: ABP_SCHEMA_VERSION,
      id: 'cs-demo',
      slug: 'demo',
      colSlug: 'cs',
      title: '原生 IPC 书目',
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
    await expect(provider.installBookFromAbp(gzipped)).rejects.toThrow('未检测到 Electron 桌面端 IPC 桥接接口');

    const installed: any[] = [{ manifest: mockManifest, installedAt: new Date().toISOString(), sourceType: 'local-file' }];
    vi.stubGlobal('window', {
      astrolib: {
        getInstalledBooks: vi.fn().mockResolvedValue(installed),
        getBookManifest: vi.fn().mockResolvedValue(mockManifest),
        installBookFromAbp: vi.fn().mockResolvedValue(installed[0]),
      },
    });
    try {
      const books = await provider.getInstalledBooks();
      expect(books).toHaveLength(1);
      const manifest = await provider.getBookManifest('cs', 'demo');
      expect(manifest?.title).toBe('原生 IPC 书目');
    } finally {
      vi.unstubAllGlobals();
    }
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

    const sidebarMatch = renderedHtml.match(/<sl-sidebar-state-persist[\s\S]*?<\/sl-sidebar-state-persist>/i);
    const sidebarHtml = sidebarMatch ? sidebarMatch[0] : '';
    expect(sidebarHtml).toContain('current-book-sidebar');
    expect(sidebarHtml).not.toContain('sidebar-category-item');
    expect(sidebarHtml).toContain('gdocs-outline-link');
    expect(sidebarHtml).toContain('aria-current="page"');

    expect(sidebarHtml).toContain('annotation encoding="application/x-tex">e</annotation>');
    expect(sidebarHtml).toContain('annotation encoding="application/x-tex">\\gamma</annotation>');

    expect(renderedHtml).toContain('astrolib-notice-framework');
    expect(renderedHtml).toContain('chapter-meta-chip-set');
    expect(renderedHtml).toContain('孙振绮 主编');
    expect(renderedHtml).toContain('机械工业出版社');
    expect(renderedHtml).toContain('《工科数学分析（上册）》');
    expect(renderedHtml).toContain('大学本科 · 教材');
    expect(renderedHtml).toContain('双语助读 (Alt+Y)');

    expect(renderedHtml).toContain('astrolib-sideload-dock');
    expect(renderedHtml).toContain('custom-toc-list');
    expect(renderedHtml).toContain('ask-fab');
  });

  describe('WebContentProvider Atomic Install & Idempotency (P1-C2 / P1-C3)', () => {
    it('1. WebContentProvider 拒绝损坏 ABP 数据包且保证零残留', async () => {
      const provider = new WebContentProvider();
      const badBundle = {
        manifest: {
          schemaVersion: '9.9.9',
          id: 'math-corrupt',
          slug: 'corrupt',
          colSlug: 'math',
          title: '损坏包',
          entryPoint: '01_intro',
          totalChapters: 1,
          updatedAt: new Date().toISOString(),
          contentHash: 'bad',
          sections: [],
        },
        chapters: {},
      };
      const badGzip = zlib.gzipSync(Buffer.from(JSON.stringify(badBundle), 'utf8'));

      await expect(provider.installBookFromAbp(badGzip)).rejects.toThrow(AbpInstallError);
      const books = await provider.getInstalledBooks();
      expect(books.some((b) => b.manifest.id === 'math-corrupt')).toBe(false);
    });

    it('2. WebContentProvider 重复安装保证幂等，降级安装彻底清除旧章节', async () => {
      const provider = new WebContentProvider();

      const makeBundle = (chaptersList: string[]) => {
        const manifest: AstroBookManifest = {
          schemaVersion: ABP_SCHEMA_VERSION,
          id: 'math-idempotent',
          slug: 'idempotent',
          colSlug: 'math',
          title: '幂等与降级测试',
          entryPoint: chaptersList[0],
          totalChapters: chaptersList.length,
          updatedAt: new Date().toISOString(),
          contentHash: 'hash-' + chaptersList.join(','),
          sections: [
            {
              id: 's1',
              title: 'S1',
              slug: 's1',
              chapters: chaptersList.map((ch) => ({
                id: 'ch-' + ch,
                slug: ch,
                title: 'Chapter ' + ch,
                path: `chapters/${ch}.json`,
                hash: 'h',
                sizeBytes: 100,
              })),
            },
          ],
        };
        const chapters: Record<string, any> = {};
        for (const ch of chaptersList) {
          chapters[ch] = {
            schemaVersion: ABP_SCHEMA_VERSION,
            bookId: 'math-idempotent',
            bookSlug: 'idempotent',
            colSlug: 'math',
            chapterSlug: ch,
            title: 'Chapter ' + ch,
            html: `<p>Content of ${ch}</p>`,
            headings: [],
            updatedAt: new Date().toISOString(),
          };
        }
        return zlib.gzipSync(Buffer.from(JSON.stringify({ manifest, chapters }), 'utf8'));
      };

      await provider.installBookFromAbp(makeBundle(['01_intro', '02_next']));
      let books = await provider.getInstalledBooks();
      expect(books.filter((b) => b.manifest.id === 'math-idempotent')).toHaveLength(1);
      expect(await provider.getChapterPayload('math', 'idempotent', '01_intro')).not.toBeNull();
      expect(await provider.getChapterPayload('math', 'idempotent', '02_next')).not.toBeNull();

      await provider.installBookFromAbp(makeBundle(['01_intro', '02_next']));
      books = await provider.getInstalledBooks();
      expect(books.filter((b) => b.manifest.id === 'math-idempotent')).toHaveLength(1);

      await provider.installBookFromAbp(makeBundle(['01_intro']));
      books = await provider.getInstalledBooks();
      expect(books.filter((b) => b.manifest.id === 'math-idempotent')).toHaveLength(1);
      expect(await provider.getChapterPayload('math', 'idempotent', '01_intro')).not.toBeNull();
      expect(await provider.getChapterPayload('math', 'idempotent', '02_next')).toBeNull();

      await provider.removeBook('math', 'idempotent');
      books = await provider.getInstalledBooks();
      expect(books.filter((b) => b.manifest.id === 'math-idempotent')).toHaveLength(0);
      expect(await provider.getChapterPayload('math', 'idempotent', '01_intro')).toBeNull();
    });

    it('3. WebContentProvider 在写入元数据失败时执行逆序回滚，保证书库零半残条目', async () => {
      const provider = new WebContentProvider();

      const bundle = {
        manifest: {
          schemaVersion: ABP_SCHEMA_VERSION,
          id: 'math-rollback_demo',
          slug: 'rollback_demo',
          colSlug: 'math',
          title: '回滚测试',
          entryPoint: '01_intro',
          totalChapters: 1,
          updatedAt: new Date().toISOString(),
          contentHash: 'h-rb',
          sections: [
            {
              id: 's1',
              title: 'S1',
              slug: 's1',
              chapters: [
                {
                  id: 'ch-01',
                  slug: '01_intro',
                  title: '01',
                  path: 'chapters/01_intro.json',
                  hash: 'h',
                  sizeBytes: 100,
                },
              ],
            },
          ],
        },
        chapters: {
          '01_intro': {
            schemaVersion: ABP_SCHEMA_VERSION,
            bookId: 'math-rollback_demo',
            bookSlug: 'rollback_demo',
            colSlug: 'math',
            chapterSlug: '01_intro',
            title: '01',
            html: '<p>01</p>',
            headings: [],
            updatedAt: new Date().toISOString(),
          },
        },
      };
      const gzipped = zlib.gzipSync(Buffer.from(JSON.stringify(bundle), 'utf8'));

      const originalPutManifest = (provider as any).db.putManifest;
      (provider as any).db.putManifest = vi.fn().mockRejectedValue(new Error('IndexedDB QuotaExceededError'));

      const onProgressCalls: number[] = [];
      await expect(
        provider.installBookFromAbp(gzipped, (pct) => {
          onProgressCalls.push(pct);
        })
      ).rejects.toThrow('IndexedDB QuotaExceededError');

      expect(onProgressCalls).not.toContain(100);

      const books = await provider.getInstalledBooks();
      expect(books.some((b) => b.manifest.id === 'math-rollback_demo')).toBe(false);

      (provider as any).db.putManifest = originalPutManifest;
    });

    it('4. WebContentProvider 拒绝路径逃逸包且不写入任何记录', async () => {
      const provider = new WebContentProvider();
      const evilBundle = {
        manifest: {
          schemaVersion: ABP_SCHEMA_VERSION,
          id: 'math-evil',
          slug: 'evil',
          colSlug: 'math',
          title: '路径逃逸测试',
          entryPoint: '../escape',
          totalChapters: 1,
          updatedAt: new Date().toISOString(),
          contentHash: 'evil',
          sections: [],
        },
        chapters: {
          '../escape': {
            schemaVersion: ABP_SCHEMA_VERSION,
            bookId: 'math-evil',
            bookSlug: 'evil',
            colSlug: 'math',
            chapterSlug: '../escape',
            title: 'Escape',
            html: '<p>evil</p>',
            headings: [],
            updatedAt: new Date().toISOString(),
          },
        },
      };
      const gzipped = zlib.gzipSync(Buffer.from(JSON.stringify(evilBundle), 'utf8'));

      await expect(provider.installBookFromAbp(gzipped)).rejects.toThrow(/PATH_TRAVERSAL_DETECTED/);
      const books = await provider.getInstalledBooks();
      expect(books.some((b) => b.manifest.id === 'math-evil')).toBe(false);
    });

    it('5. WebContentProvider.installToDisk() 必须显式抛出 OPERATION_NOT_SUPPORTED 异常', async () => {
      const provider = new WebContentProvider();
      await expect((provider as any).installToDisk()).rejects.toThrow(AbpInstallError);
      try {
        await (provider as any).installToDisk();
      } catch (e: any) {
        expect(e.code).toBe(AbpInstallErrorCode.OPERATION_NOT_SUPPORTED);
        expect(e.message).toContain('不支持写入本地文件系统磁盘');
      }
    });
  });

  describe('Dev Server Plugin HTTP Upload & Atomic Staging (P1-C2 / P1-C3)', () => {
    const plugin = devLibraryServerPlugin();
    let middleware: any;

    const fakeServer = {
      middlewares: {
        use: (fn: any) => {
          middleware = fn;
        },
      },
    };
    plugin.configureServer(fakeServer);

    function simulateDevRequest(options: {
      method: string;
      url: string;
      body?: Buffer | string;
    }): Promise<{ statusCode: number; data: any; headers: Record<string, string> }> {
      return new Promise((resolve) => {
        let bodyBuffer = Buffer.isBuffer(options.body)
          ? options.body
          : typeof options.body === 'string'
            ? Buffer.from(options.body, 'utf8')
            : Buffer.alloc(0);

        const req: any = {
          method: options.method,
          url: options.url,
          async *[Symbol.asyncIterator]() {
            if (bodyBuffer.length > 0) {
              yield bodyBuffer;
            }
          },
        };

        const headers: Record<string, string> = {};
        let statusCode = 200;
        let responseText = '';

        const res: any = {
          writeHead: (code: number, hdrs: Record<string, string>) => {
            statusCode = code;
            Object.assign(headers, hdrs);
          },
          end: (content?: string) => {
            if (content) responseText += content;
            let data: any = null;
            try {
              data = JSON.parse(responseText);
            } catch {
              data = responseText;
            }
            resolve({ statusCode, data, headers });
          },
        };

        middleware(req, res, () => {
          resolve({ statusCode: 404, data: null, headers: {} });
        });
      });
    }

    it('1. Dev 上传损坏或非法 Schema 的包应返回 400 且零残留', async () => {
      const corruptJson = {
        manifest: { schemaVersion: '2.0.0', colSlug: 'cs', slug: 'corrupt' },
        chapters: {},
      };
      const gzipped = zlib.gzipSync(Buffer.from(JSON.stringify(corruptJson), 'utf8'));

      const res = await simulateDevRequest({
        method: 'POST',
        url: '/api/library/upload-abp',
        body: gzipped,
      });

      expect(res.statusCode).toBe(400);
      expect(res.data.code).toBe(AbpInstallErrorCode.SCHEMA_MISMATCH);

      const targetDir = path.resolve(process.cwd(), '.tmp/dev-abp-packs/cs-corrupt');
      expect(fs.existsSync(targetDir)).toBe(false);
    });

    it('2. Dev 上传路径逃逸包应返回 400 与 PATH_TRAVERSAL_DETECTED 且零写入', async () => {
      const evilJson = {
        manifest: {
          schemaVersion: ABP_SCHEMA_VERSION,
          colSlug: '../escape',
          slug: 'demo',
          id: 'bad',
          title: 'Evil',
          entryPoint: '01',
          sections: [],
        },
        chapters: {
          '01': {
            schemaVersion: ABP_SCHEMA_VERSION,
            bookId: 'bad',
            bookSlug: 'demo',
            colSlug: '../escape',
            chapterSlug: '01',
            title: '01',
            html: 'ok',
            headings: [],
            updatedAt: new Date().toISOString(),
          },
        },
      };
      const gzipped = zlib.gzipSync(Buffer.from(JSON.stringify(evilJson), 'utf8'));

      const res = await simulateDevRequest({
        method: 'POST',
        url: '/api/library/upload-abp',
        body: gzipped,
      });

      expect(res.statusCode).toBe(400);
      expect(res.data.code).toBe(AbpInstallErrorCode.PATH_TRAVERSAL_DETECTED);
    });

    it('3. Dev 上传合法包成功落盘，降级安装彻底清除旧章节，DELETE 端点彻底清理', async () => {
      const makeDevBundle = (chaptersList: string[]) => {
        const bundle = {
          manifest: {
            schemaVersion: ABP_SCHEMA_VERSION,
            colSlug: 'cs',
            slug: 'dev_test',
            id: 'cs-dev_test',
            title: 'Dev Test Book',
            entryPoint: chaptersList[0],
            sections: [
              {
                id: 's1',
                title: 'S1',
                slug: 's1',
                chapters: chaptersList.map((c) => ({
                  id: 'ch-' + c,
                  slug: c,
                  title: 'Ch ' + c,
                  path: `chapters/${c}.json`,
                  hash: 'h',
                  sizeBytes: 50,
                })),
              },
            ],
          },
          chapters: Object.fromEntries(
            chaptersList.map((c) => [
              c,
              {
                schemaVersion: ABP_SCHEMA_VERSION,
                bookId: 'cs-dev_test',
                bookSlug: 'dev_test',
                colSlug: 'cs',
                chapterSlug: c,
                title: 'Ch ' + c,
                html: `<p>${c}</p>`,
                headings: [],
                updatedAt: new Date().toISOString(),
              },
            ])
          ),
        };
        return zlib.gzipSync(Buffer.from(JSON.stringify(bundle), 'utf8'));
      };

      const targetDir = path.resolve(process.cwd(), '.tmp/dev-abp-packs/cs-dev_test');

      try {

        const res1 = await simulateDevRequest({
          method: 'POST',
          url: '/api/library/upload-abp',
          body: makeDevBundle(['c1', 'c2']),
        });
        expect(res1.statusCode).toBe(200);
        expect(res1.data.success).toBe(true);
        expect(fs.existsSync(path.join(targetDir, 'chapters/c1.json'))).toBe(true);
        expect(fs.existsSync(path.join(targetDir, 'chapters/c2.json'))).toBe(true);

        const res2 = await simulateDevRequest({
          method: 'POST',
          url: '/api/library/upload-abp',
          body: makeDevBundle(['c1']),
        });
        expect(res2.statusCode).toBe(200);
        expect(fs.existsSync(path.join(targetDir, 'chapters/c1.json'))).toBe(true);
        expect(fs.existsSync(path.join(targetDir, 'chapters/c2.json'))).toBe(false);

        const res3 = await simulateDevRequest({
          method: 'DELETE',
          url: '/api/library/books/cs-dev_test',
        });
        expect(res3.statusCode).toBe(200);
        expect(res3.data.success).toBe(true);
        expect(fs.existsSync(targetDir)).toBe(false);
      } finally {
        if (fs.existsSync(targetDir)) {
          fs.rmSync(targetDir, { recursive: true, force: true });
        }
      }
    });
  });
});
