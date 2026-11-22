import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  parseAstrolibUri,
  isAstrolibUri,
  buildPaperAstrolibUri,
} from '../../src/utils/astrolib-uri.ts';
import { UniversalLocatorResolver } from '../../src/core/content-api/content-locator.ts';
import { AbpEpubAdapter, htmlFragmentToAcademicText } from '../../src/core/knowledge/adapters/abp-epub-adapter.ts';
import { PaperIngestAdapter } from '../../src/core/knowledge/adapters/paper-ingest-adapter.ts';
import { MdxBookAdapter } from '../../src/core/knowledge/adapters/mdx-book-adapter.ts';
import { KnowledgeRegistry } from '../../src/core/knowledge/knowledge-registry.ts';

describe('KnowledgeRegistry 四源统一知识库认知与结构化测试', () => {
  let tmpRoot = '';
  let abpRoot = '';
  let ingestRoot = '';
  let prevAbpEnv: string | undefined;
  let prevIngestEnv: string | undefined;

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'astrolib-knowledge-test-'));
    abpRoot = path.join(tmpRoot, 'abp-packs');
    ingestRoot = path.join(tmpRoot, 'ingest-tasks');
    fs.mkdirSync(abpRoot, { recursive: true });
    fs.mkdirSync(ingestRoot, { recursive: true });

    prevAbpEnv = process.env.ASTROLIB_USER_ABP_DIR;
    prevIngestEnv = process.env.ASTROLIB_INGEST_DIR;
    process.env.ASTROLIB_USER_ABP_DIR = abpRoot;
    process.env.ASTROLIB_INGEST_DIR = ingestRoot;

    // 1. 构造模拟 pdf2abp 书籍（含 chapterIntro + KaTeX annotation + 学术卡片 + 无 ai-index）
    const pdf2abpDir = path.join(abpRoot, 'math-cmc_demo_tutorial');
    fs.mkdirSync(path.join(pdf2abpDir, 'chapters'), { recursive: true });
    fs.writeFileSync(
      path.join(pdf2abpDir, 'manifest.json'),
      JSON.stringify({
        schemaVersion: '1.0.0',
        id: 'math-cmc_demo_tutorial',
        slug: 'cmc_demo_tutorial',
        colSlug: 'math',
        title: '全国大学生数学竞赛解析教程（测试版）',
        author: '竞赛命题组',
        entryPoint: '01_limits',
        totalChapters: 1,
        updatedAt: '2026-11-21T00:00:00.000Z',
        contentHash: 'abc123',
        sections: [
          {
            id: 'sec-1',
            slug: 'sec-1',
            title: '第一章 极限与连续',
            chapters: [
              {
                id: 'ch-1',
                title: '1.1 竞赛要点与Stolz定理',
                slug: '01_limits',
                path: 'chapters/01_limits.json',
                hash: 'h1',
                sizeBytes: 512,
              },
            ],
          },
        ],
      }),
      'utf-8'
    );
    fs.writeFileSync(
      path.join(pdf2abpDir, 'chapters', '01_limits.json'),
      JSON.stringify({
        schemaVersion: '1.0.0',
        bookId: 'math-cmc_demo_tutorial',
        bookSlug: 'cmc_demo_tutorial',
        colSlug: 'math',
        chapterSlug: '01_limits',
        title: '1.1 竞赛要点与Stolz定理',
        chapterIntro: {
          title: '第一章导语',
          html: '<p>极限是竞赛数学的基石，常见求解工具包含 Stolz 公式与单调有界准则。</p>',
          slug: '00_intro',
        },
        html: `<div class="astrolib-chapter-content">
          <div class="academic-theorem-card toc-chunk" id="thm-stolz" data-card-title="Stolz 定理">
            <p>设数列满足严格单调递增且趋于无穷，则 <span class="katex"><span class="katex-mathml"><math><semantics><annotation encoding="application/x-tex">\\lim_{n\\to\\infty} \\frac{x_n}{y_n}</annotation></semantics></math></span><span class="katex-html">x_n/y_n</span></span> 存在。</p>
          </div>
          <p>${'这段正文包含超过三百字的完整推导说明用于验证绝对不发生140字符截断问题，'.repeat(8)}尾段关键字: UNIQUE_ABP_TAIL_TOKEN。</p>
        </div>`,
        headings: [],
      }),
      'utf-8'
    );

    // 2. 构造模拟 EPUB 图书（含 Ruby 注音与长正文）
    const epubDir = path.join(abpRoot, 'acg-demo-light-novel');
    fs.mkdirSync(path.join(epubDir, 'chapters'), { recursive: true });
    fs.writeFileSync(
      path.join(epubDir, 'manifest.json'),
      JSON.stringify({
        schemaVersion: '1.0.0',
        id: 'acg-demo-light-novel',
        slug: 'demo-light-novel',
        colSlug: 'acg',
        title: '某暗部的少女共栖（测试卷）',
        author: '镰池和马',
        sourceFormat: 'epub',
        readingProfile: 'literary',
        entryPoint: '001_prologue',
        totalChapters: 1,
        updatedAt: '2026-11-20T00:00:00.000Z',
        contentHash: 'epub123',
        sections: [
          {
            id: 'main',
            slug: 'main',
            title: '正文',
            chapters: [
              {
                id: 'c1',
                title: '引子',
                slug: '001_prologue',
                path: 'chapters/001_prologue.json',
                hash: 'e1',
                sizeBytes: 300,
              },
            ],
          },
        ],
      }),
      'utf-8'
    );
    fs.writeFileSync(
      path.join(epubDir, 'chapters', '001_prologue.json'),
      JSON.stringify({
        schemaVersion: '1.0.0',
        bookId: 'acg-demo-light-novel',
        bookSlug: 'demo-light-novel',
        colSlug: 'acg',
        chapterSlug: '001_prologue',
        title: '引子',
        html: `<div class="main">
          <p id="ep-1"><ruby>学園都市<rp>(</rp><rt>がくえんとし</rt><rp>)</rp></ruby>的暗部组织「ITEM」正面临新指令。</p>
          <p id="ep-2">${'长句无截断检测'.repeat(30)}EPUB_TAIL_MARKER。</p>
        </div>`,
        headings: [],
      }),
      'utf-8'
    );

    // 3. 构造模拟 MinerU 学术文献任务
    const paperDir = path.join(ingestRoot, 'task_test_paper_001');
    fs.mkdirSync(path.join(paperDir, 'unpacked', 'images'), { recursive: true });
    fs.writeFileSync(
      path.join(paperDir, 'meta.json'),
      JSON.stringify({
        taskId: 'task_test_paper_001',
        fileName: 'Test_Handwriting_Paper.pdf',
        fileSize: 102400,
        pageCount: 12,
        engine: 'api',
        status: 'completed',
        createdAt: 1794800000000,
        completedAt: 1794800050000,
        hasImages: true,
        imageCount: 1,
      }),
      'utf-8'
    );
    fs.writeFileSync(
      path.join(paperDir, 'unpacked', 'images', 'fig_arch.png'),
      Buffer.from('PNG_PLACEHOLDER'),
      'utf-8'
    );
    fs.writeFileSync(
      path.join(paperDir, 'unpacked', 'paper_content_list_v2.json'),
      JSON.stringify([
        { type: 'text', text: 'Content-Independent Handwriting Style Verification', page_idx: 0 },
        { type: 'text', text: 'Style Channel Attention extracts directional strokes', page_idx: 2 },
      ]),
      'utf-8'
    );
    fs.writeFileSync(
      path.join(paperDir, 'unpacked', 'full.md'),
      `# Content-Independent Handwriting Style Verification

## ABSTRACT

This paper proposes Ph-Wri with Style Channel Attention (SCA) for identity authentication.

## I. INTRODUCTION

Handwriting dynamics reveal invariant motor patterns.

![Fig. 1 Architecture](images/fig_arch.png)
Fig. 1. Architecture of the multi-path network.

$$
L_{style} = \\sum_{i=1}^{N} \\| f_i - \\mu_s \\|_2^2
$$
`,
      'utf-8'
    );
  });

  afterAll(() => {
    if (prevAbpEnv === undefined) delete process.env.ASTROLIB_USER_ABP_DIR;
    else process.env.ASTROLIB_USER_ABP_DIR = prevAbpEnv;
    if (prevIngestEnv === undefined) delete process.env.ASTROLIB_INGEST_DIR;
    else process.env.ASTROLIB_INGEST_DIR = prevIngestEnv;
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {}
  });

  it('1. 支持 paper:// 与 astrolib://paper/<taskId> URI 解析与路由映射', () => {
    expect(isAstrolibUri('astrolib://paper/task_test_paper_001/sec-2')).toBe(true);
    expect(isAstrolibUri('paper://task_test_paper_001')).toBe(true);

    const uri = buildPaperAstrolibUri('task_test_paper_001', 'sec-2', 'fig-1');
    expect(uri).toBe('astrolib://paper/task_test_paper_001/sec-2#fig-1');

    const parsed = parseAstrolibUri(uri);
    expect(parsed).not.toBeNull();
    expect(parsed?.entityKind).toBe('paper');
    expect(parsed?.taskId).toBe('task_test_paper_001');
    expect(parsed?.sectionId).toBe('sec-2');
    expect(parsed?.canonicalPath).toBe('/workspace/ingest/?taskId=task_test_paper_001&section=sec-2#fig-1');

    const loc = UniversalLocatorResolver.parseUri('paper://task_test_paper_001/sec-3');
    expect(loc?.entityKind).toBe('paper');
    expect(loc?.bookSlug).toBe('task_test_paper_001');
    expect(loc?.chapterSlug).toBe('sec-3');
  });

  it('2. AbpEpubAdapter 保留 KaTeX LaTeX、剔除 Ruby 注音且消除 140 字截断', () => {
    const cleanText = htmlFragmentToAcademicText(
      '<p><ruby>学園<rp>(</rp><rt>がくえん</rt><rp>)</rp></ruby>测试 <span class="katex"><span class="katex-mathml"><math><semantics><annotation encoding="application/x-tex">a^2+b^2=c^2</annotation></semantics></math></span><span class="katex-html">a2+b2</span></span></p>'
    );
    expect(cleanText).toContain('学園测试');
    expect(cleanText).toContain('$a^2+b^2=c^2$');
    expect(cleanText).not.toContain('がくえん');
    expect(cleanText).not.toContain('a2+b2');

    const adapter = new AbpEpubAdapter();
    const docs = adapter.listDocuments();
    const cmc = docs.find((d) => d.slug === 'cmc_demo_tutorial');
    const epub = docs.find((d) => d.slug === 'demo-light-novel');
    expect(cmc?.sourceFormat).toBe('abp');
    expect(epub?.sourceFormat).toBe('epub');

    const cmcSection = adapter.readSection('astrolib://math/cmc_demo_tutorial', '01_limits');
    expect(cmcSection).not.toBeNull();
    expect(cmcSection?.plainText).toContain('第一章导语');
    expect(cmcSection?.plainText).toContain('UNIQUE_ABP_TAIL_TOKEN');
    expect(cmcSection?.plainText).toContain('\\lim_{n\\to\\infty}');

    const epubSection = adapter.readSection('astrolib://acg/demo-light-novel', '001_prologue');
    expect(epubSection?.plainText).toContain('学園都市的暗部组织');
    expect(epubSection?.plainText).not.toContain('がくえんとし');
    expect(epubSection?.plainText).toContain('EPUB_TAIL_MARKER');

    // 验证检索懒索引落盘于 .cache/ 而不污染源目录
    const abpHits = adapter.search('UNIQUE_ABP_TAIL_TOKEN');
    expect(abpHits.length).toBe(1);
    expect(abpHits[0].docSlug).toBe('cmc_demo_tutorial');
    expect(
      fs.existsSync(path.join(abpRoot, '.cache', 'math-cmc_demo_tutorial', 'knowledge-index.v1.json'))
    ).toBe(true);
  });

  it('3. PaperIngestAdapter 自动结构化文献大纲、分节正文、插图 URL 与缓存索引', () => {
    const adapter = new PaperIngestAdapter();
    const docs = adapter.listDocuments();
    const paper = docs.find((d) => d.slug === 'task_test_paper_001');
    expect(paper).toBeDefined();
    expect(paper?.title).toBe('Content-Independent Handwriting Style Verification');
    expect(paper?.uri).toBe('astrolib://paper/task_test_paper_001');

    const outline = adapter.getOutline('astrolib://paper/task_test_paper_001');
    expect(outline && outline.length).toBeGreaterThan(0);

    const intro = adapter.readSection('astrolib://paper/task_test_paper_001', 'I. INTRODUCTION');
    expect(intro).not.toBeNull();
    expect(intro?.plainText).toContain('Handwriting dynamics');
    expect(intro?.images.length).toBe(1);
    expect(intro?.images[0].url).toBe('/api/ingest/image?taskId=task_test_paper_001&name=fig_arch.png');
    expect(intro?.blocks.some((b) => b.kind === 'math' && b.latex?.includes('L_{style}'))).toBe(true);

    expect(
      fs.existsSync(path.join(ingestRoot, 'task_test_paper_001', '.cache', 'knowledge-index.v1.json'))
    ).toBe(true);
  });

  it('4. KnowledgeRegistry 跨 MDX / pdf2abp / EPUB / 文献四源联合筛选与搜索', () => {
    const registry = KnowledgeRegistry.createIsolated([
      new MdxBookAdapter(),
      new AbpEpubAdapter(),
      new PaperIngestAdapter(),
    ]);

    const all = registry.listAllDocuments();
    expect(all.some((d) => d.sourceFormat === 'mdx')).toBe(true);
    expect(all.some((d) => d.slug === 'cmc_demo_tutorial')).toBe(true);
    expect(all.some((d) => d.sourceFormat === 'epub')).toBe(true);
    expect(all.some((d) => d.sourceFormat === 'paper')).toBe(true);

    const paperHits = registry.searchAll('Style Channel Attention', { limit: 50 });
    expect(paperHits.length).toBeGreaterThan(0);
    expect(paperHits.some((h) => h.kind === 'paper' && h.uri.includes('astrolib://paper/task_test_paper_001'))).toBe(true);

    const epubHits = registry.searchAll('ITEM', { limit: 50 });
    expect(epubHits.some((h) => h.sourceFormat === 'epub')).toBe(true);
  });
});
