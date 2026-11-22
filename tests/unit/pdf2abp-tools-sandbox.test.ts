import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  JobWorkspace,
  runWorkspacePython,
  findBestPythonExecutable,
  stitchMineruParts,
  prepareChapterChunks,
  mergeChapterParts,
  validateBookPlan,
  analyzeBookStructure,
  auditBookCoverage,
  importAbpToAppLibrary,
} from '../../src/services/pdf2abp/index.ts';
import { compileBookToAbp } from '../../src/publishing/abp/index.ts';

describe('PDF2ABP Workspace Sandbox, Python Runner, Stitcher, Slicer & Importer', () => {
  let tmpDir = '';
  let dummyPdfPath = '';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'astrolib-sandbox-'));
    dummyPdfPath = path.join(tmpDir, 'source.pdf');
    fs.writeFileSync(dummyPdfPath, '%PDF-1.4\n%%EOF\n', 'utf-8');
  });

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('JobWorkspace 严格拦截路径越狱与外部未授权 PDF 访问', () => {
    const ws = new JobWorkspace('job_test_jail', dummyPdfPath, path.join(tmpDir, 'jobs'));

    ws.writeFile('book/01_intro.mdx', '---\ntitle: "引言"\n---\n\n测试正文\n');
    const readRes = ws.readFile('book/01_intro.mdx');
    expect(readRes.content).toContain('测试正文');

    expect(() => ws.resolveWorkspacePath('../outside.txt')).toThrow();
    expect(() => ws.resolveWorkspacePath('book/../../escape.txt')).toThrow();
    expect(() => ws.resolveWorkspacePath('C:\\Windows\\System32\\drivers\\etc\\hosts')).toThrow();
    expect(() => ws.assertAllowedSourcePdf(path.join(tmpDir, 'other.pdf'))).toThrow();
    expect(ws.assertAllowedSourcePdf(dummyPdfPath)).toBe(path.resolve(dummyPdfPath));
  });

  it('runWorkspacePython 在沙箱工作区执行 Python 脚本并注入环境变量', async () => {
    const pyExe = await findBestPythonExecutable();
    if (!pyExe) {
      return;
    }
    const ws = new JobWorkspace('job_test_py', dummyPdfPath, path.join(tmpDir, 'jobs'));
    const res = await runWorkspacePython({
      workspace: ws,
      code: `
import os, json
out_path = os.path.join(os.environ['ASTROLIB_BOOK_DIR'], 'py_generated.txt')
with open(out_path, 'w', encoding='utf-8') as f:
    f.write('hello_from_python')
print(json.dumps({"ok": True, "ws": os.environ['ASTROLIB_WORKSPACE_DIR']}))
`,
    });

    expect(res.success).toBe(true);
    expect(res.exitCode).toBe(0);
    expect(JSON.parse(res.stdout.trim()).ok).toBe(true);
    expect(ws.readFile('book/py_generated.txt').content).toBe('hello_from_python');
  });

  it('stitchMineruParts 能防冲突重命名图片、全局重映射物理页码并切分合并章节', () => {
    const ws = new JobWorkspace('job_test_stitch', dummyPdfPath, path.join(tmpDir, 'jobs'));

    const part1Dir = path.join(ws.mineruPartsDir, 'part_001_unpacked', 'uuid-1');
    const part2Dir = path.join(ws.mineruPartsDir, 'part_002_unpacked', 'uuid-2');
    fs.mkdirSync(path.join(part1Dir, 'images'), { recursive: true });
    fs.mkdirSync(path.join(part2Dir, 'images'), { recursive: true });

    fs.writeFileSync(path.join(part1Dir, 'images', 'img1.jpg'), 'PART1_IMG');
    fs.writeFileSync(path.join(part2Dir, 'images', 'img1.jpg'), 'PART2_IMG');

    fs.writeFileSync(path.join(part1Dir, 'full.md'), '# 第一章\n\n![](images/img1.jpg)\n\n$$a=1$$', 'utf-8');
    fs.writeFileSync(path.join(part2Dir, 'full.md'), '$$\nb=2\n$$\n\n# 第二章\n\n![](images/img1.jpg)', 'utf-8');

    fs.writeFileSync(
      path.join(part1Dir, 'doc_content_list_v2.json'),
      JSON.stringify([
        [
          { type: 'title', content: { title_content: [{ type: 'text', content: '第1章 矩阵' }], level: 1 } },
          { type: 'paragraph', content: { paragraph_content: [{ type: 'text', content: '第1页正文' }] } },
        ],
        [
          {
            type: 'image',
            content: {
              image_source: { path: 'images/img1.jpg' },
              image_caption: [{ type: 'text', content: '图 1.1' }],
            },
          },
        ],
      ]),
      'utf-8'
    );

    const p2Blocks: any[] = [];
    for (let i = 0; i < 10; i++) {
      p2Blocks.push({ type: 'text', text: `第 ${3 + i} 页练习内容`, page_idx: i });
    }
    p2Blocks.push({
      type: 'image',
      img_path: 'images/img1.jpg',
      image_caption: ['图 2.1'],
      page_idx: 0,
    });
    fs.writeFileSync(path.join(part2Dir, 'doc_content_list.json'), JSON.stringify(p2Blocks), 'utf-8');

    const summary = stitchMineruParts(
      [
        { partIndex: 1, startPage: 1, endPage: 2, unpackedDir: path.join(ws.mineruPartsDir, 'part_001_unpacked') },
        { partIndex: 2, startPage: 3, endPage: 12, unpackedDir: path.join(ws.mineruPartsDir, 'part_002_unpacked') },
      ],
      ws.mineruStitchedDir,
      path.join(ws.mineruDir, 'mineru-summary.json')
    );

    expect(summary.totalPages).toBe(12);
    expect(summary.totalImages).toBe(2);
    expect(fs.readFileSync(path.join(ws.mineruStitchedDir, 'images', 'p1_img1.jpg'), 'utf-8')).toBe('PART1_IMG');
    expect(fs.readFileSync(path.join(ws.mineruStitchedDir, 'images', 'p2_img1.jpg'), 'utf-8')).toBe('PART2_IMG');

    const stitchedMd = fs.readFileSync(summary.fullMdPath, 'utf-8');
    expect(stitchedMd).toContain('images/p1_img1.jpg');
    expect(stitchedMd).toContain('images/p2_img1.jpg');
    expect(stitchedMd).not.toContain('$$$$');

    const sliced = prepareChapterChunks({
      workspace: ws,
      maxPagesPerChunk: 6,
      plan: {
        bookConfig: { colSlug: 'math', slug: 'stitch_test', title: '缝合测试' },
        globalProofreadingRules: ['保持公式完整'],
        chapters: [
          { id: 'ch1', filename: '01_ch1.mdx', title: '第1章 矩阵', startPage: 1, endPage: 2 },
          { id: 'ch2', filename: '02_ch2.mdx', title: '第2章 习题', startPage: 3, endPage: 12 },
        ],
      },
    });

    expect(sliced.workOrders).toHaveLength(3);
    expect(sliced.copiedImagesCount).toBe(2);
    expect(fs.existsSync(path.join(ws.bookImagesDir, 'p1_img1.jpg'))).toBe(true);
    expect(fs.existsSync(path.join(ws.bookImagesDir, 'p2_img1.jpg'))).toBe(true);

    ws.writeFile('chunks/ch2__part1of2/proofread_part.mdx', '---\ntitle: "第2章"\n---\n\n第一段习题');
    ws.writeFile('chunks/ch2__part2of2/proofread_part.mdx', '---\ntitle: "第2章"\n---\n\n第二段习题');
    const merged = mergeChapterParts({
      workspace: ws,
      targetOutputRelPath: 'book/02_ch2.mdx',
      partRelPaths: ['chunks/ch2__part1of2/proofread_part.mdx', 'chunks/ch2__part2of2/proofread_part.mdx'],
      chapterTitle: '第2章 习题',
    });
    const mergedContent = ws.readFile(merged.targetOutputRelPath).content;
    expect(mergedContent).toContain('第一段习题');
    expect(mergedContent).toContain('第二段习题');
    expect(mergedContent.match(/^---$/gm)?.length).toBe(2);
  });

  it('importAbpToAppLibrary 能原子安装 .abp 包至目标书库目录', async () => {
    const srcBook = path.join(tmpDir, 'src-book');
    const distOut = path.join(tmpDir, 'dist-out');
    const libTarget = path.join(tmpDir, 'app-lib');
    fs.mkdirSync(srcBook, { recursive: true });
    fs.writeFileSync(
      path.join(srcBook, 'book.json'),
      JSON.stringify({ colSlug: 'math', slug: 'import_demo', title: '导入测试书' }),
      'utf-8'
    );
    fs.writeFileSync(
      path.join(srcBook, '01_intro.mdx'),
      '---\ntitle: "引言"\n---\n\n欢迎阅读 $e^{i\\pi}+1=0$。\n',
      'utf-8'
    );

    const compiled = await compileBookToAbp({ bookDir: srcBook, outDir: distOut });
    const imported = await importAbpToAppLibrary(compiled.abpPath, { targetDir: libTarget });

    expect(imported.installed).toBe(true);
    expect(imported.bookId).toBe('math-import_demo');
    expect(fs.existsSync(path.join(libTarget, 'math-import_demo', 'manifest.json'))).toBe(true);
    expect(fs.existsSync(path.join(libTarget, 'math-import_demo', 'chapters', '01_intro.json'))).toBe(true);
  });

  it('validateBookPlan 严格拦截纯目录/索引、合并小节、拆散三级子节及重复 intro，并支持 startAnchor/endAnchor 与整节切片', () => {
    const invalidPlan = validateBookPlan({
      documentMode: 'textbook',
      bookConfig: {
        colSlug: 'cs',
        slug: 'algo',
        title: 'Algorithms',
        sections: [
          { title: 'Ch0', intro: 'ch0_intro.mdx', chapters: ['ch0_intro.mdx', '01_0.1.mdx'] },
        ],
      },
      globalProofreadingRules: [],
      chapters: [
        { id: 'toc', filename: '00_toc.mdx', title: 'Contents and List of Boxes', startPage: 5, endPage: 8, kind: 'frontmatter' },
        { id: 'ch0_intro', filename: 'ch0_intro.mdx', title: 'Prologue', startPage: 11, endPage: 11, kind: 'chapter-intro' },
        { id: 'merged', filename: '01_0.1.mdx', title: '0.1 Books and algorithms · 0.2 Enter Fibonacci', startPage: 11, endPage: 14, kind: 'body' },
        { id: 'sec12', filename: '02_1.2.mdx', title: '1.2 Modular arithmetic', startPage: 20, endPage: 25, kind: 'body' },
        { id: 'sec123', filename: '03_1.2.3.mdx', title: '1.2.3 Euclid algorithm', startPage: 22, endPage: 23, kind: 'body' },
      ],
    });

    expect(invalidPlan.ok).toBe(false);
    const errText = invalidPlan.errors.join('\n');
    expect(errText).toContain('目录');
    expect(errText).toContain('合并');
    expect(errText).toContain('1.2.3');
    expect(errText).toContain('chapters[]');

    const ws = new JobWorkspace('anchor_slice_test', dummyPdfPath, path.join(tmpDir, 'jobs'));
    const fakeBlocks = [
      { page: 11, localPage: 11, partIndex: 1, type: 'title', level: 1, text: 'Chapter 0' },
      { page: 11, localPage: 11, partIndex: 1, type: 'title', level: 2, text: 'Prologue' },
      { page: 11, localPage: 11, partIndex: 1, type: 'paragraph', text: 'Computers and networks are everywhere in daily life and engineering.' },
      { page: 11, localPage: 11, partIndex: 1, type: 'title', level: 2, text: '0.1 Books and algorithms' },
      { page: 11, localPage: 11, partIndex: 1, type: 'paragraph', text: 'Two ideas changed the world.' },
      { page: 11, localPage: 11, partIndex: 1, type: 'footnote', text: '1 Sissa and Moore story in Chapter 8.' },
      ...Array.from({ length: 14 }, (_, idx) => ({
        page: 12 + idx,
        localPage: 12 + idx,
        partIndex: 1,
        type: 'paragraph',
        text: `Page ${12 + idx} body content of section 0.1.`,
      })),
    ];
    fs.writeFileSync(path.join(ws.mineruStitchedDir, 'pages_blocks.json'), JSON.stringify(fakeBlocks), 'utf-8');

    const sliced = prepareChapterChunks({
      workspace: ws,
      plan: {
        documentMode: 'textbook',
        bookConfig: {
          colSlug: 'cs',
          slug: 'algo_ok',
          title: 'Algorithms',
          sections: [{ title: 'Chapter 0 · Prologue', intro: '01_ch0_intro.mdx', chapters: ['02_0.1_books.mdx'] }],
        },
        globalProofreadingRules: [],
        chapters: [
          {
            id: 'ch0_intro',
            filename: '01_ch0_intro.mdx',
            title: 'Prologue',
            startPage: 11,
            endPage: 11,
            startAnchor: 'Prologue',
            endAnchor: '0.1 Books and algorithms',
            kind: 'chapter-intro',
          },
          {
            id: 'sec01',
            filename: '02_0.1_books.mdx',
            title: '0.1 Books and algorithms',
            startPage: 11,
            endPage: 25,
            startAnchor: '0.1 Books and algorithms',
            kind: 'body',
          },
        ],
      },
    });

    expect(sliced.workOrders).toHaveLength(2);
    const introDraft = ws.readFile('chunks/ch0_intro/draft.md').content;
    expect(introDraft).toContain('Computers and networks are everywhere');
    expect(introDraft).not.toContain('Two ideas changed the world');

    const sec01Draft = ws.readFile('chunks/sec01/draft.md').content;
    expect(sec01Draft).not.toContain('Computers and networks are everywhere');
    expect(sec01Draft).toContain('Two ideas changed the world');
    expect(sec01Draft).toContain('<!-- MINERU_FOOTNOTE p11: 1 Sissa and Moore story in Chapter 8. -->');

    const analysis = analyzeBookStructure(path.join(ws.mineruStitchedDir, 'pages_blocks.json'));
    expect(analysis.sections.some((s) => s.kind === 'chapter-intro')).toBe(true);
    expect(analysis.density.pagesWithFootnotes).toEqual([{ page: 11, count: 1 }]);

    ws.writeFile('book/01_ch0_intro.mdx', '---\ntitle: "Prologue"\n---\n\nComputers and networks are everywhere.\n');
    ws.writeFile('book/02_0.1_books.mdx', '---\ntitle: "0.1 Books and algorithms"\n---\n\nTwo ideas changed the world.[^p11-1]\n\n[^p11-1]: Sissa and Moore.\n');
    const audit = auditBookCoverage(ws.bookDir, path.join(ws.mineruStitchedDir, 'pages_blocks.json'));
    expect(audit.ok).toBe(true);
    expect(audit.outputStats.totalFootnoteDefs).toBe(1);
    expect(audit.outputStats.totalUnconvertedHints).toBe(0);
  });
});
