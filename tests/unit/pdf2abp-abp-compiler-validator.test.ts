import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  compileBookToAbp,
  compileMarkdownToSemanticHtml,
  compileMarkdownToSemanticResult,
  validateBookDirectory,
  verifyAbpArchive,
} from '../../src/publishing/abp/index.ts';

describe('Headless ABP Compiler & Quality Gate (src/publishing/abp)', () => {
  let tmpRoot = '';

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'astrolib-abp-test-'));
  });

  afterEach(() => {
    if (tmpRoot && fs.existsSync(tmpRoot)) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('compileMarkdownToSemanticHtml 支持全部 13+ 学术组件、嵌套题解、Mermaid 与图注不重复嵌套', () => {
    const mdx = `
## 1.1 矩阵与线性变换

<Knowledge title="定理 1.1 矩阵秩不等式">
设 $A, B$ 为 $n$ 阶方阵，则 $\\operatorname{rank}(AB) \\le \\min(\\\\operatorname{rank}(A), \\operatorname{rank}(B))$。
</Knowledge>

<Example title="例 1.1 求二阶矩阵逆">
求矩阵 $A = \\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}$ 的逆。

<Analysis>
先计算行列式 $|A| = -2 \\ne 0$。
</Analysis>

<Solution title="解答">
$$A^{-1} = -\\frac{1}{2}\\begin{pmatrix} 4 & -2 \\\\ -3 & 1 \\end{pmatrix}$$
</Solution>
</Example>

<Exercise title="练习 1⁺">
证明：若 $A^2 = I$，则特征值只能为 $\\pm 1$。
<Solution title="提示">
考虑 $Ax = \\lambda x$。
</Solution>
</Exercise>

<Algorithm title="Algorithm 1 Gaussian Elimination">
1. Pivot selection
2. Row elimination
</Algorithm>

<SideNote title="想一想" type="think">
可逆矩阵的乘积是否仍可逆？
</SideNote>

<MarginNote title="注记" side="left">
此处采用列主元策略。
</MarginNote>

<Variant title="变式 1">变式训练文本</Variant>
<Note title="注 1">注释文本</Note>
<Method title="方法总结">先化简再求值</Method>
<Summary title="本节小结">核心要点汇总</Summary>
<Block title="知识板块">前置定义</Block>
<DigitalResource id="1.1" title="视频讲解" url="https://example.com/v1" type="video" />
<ExerciseTrigger chapter="1" section="1.1" title="第 1.1 节" />

<figure class="vp-figure">![图 1.1 变换示意图](images/fig1.png)<figcaption>图 1.1 变换示意图</figcaption></figure>

\`\`\`mermaid
flowchart TD
  A[输入矩阵] --> B[初等行变换]
\`\`\`
`;

    const html = compileMarkdownToSemanticHtml(mdx, {
      colSlug: 'math',
      bookSlug: 'test_linear',
      bookTitle: '测试线性代数',
    });

    expect(html).toContain('class="knowledge-card toc-chunk"');
    expect(html).toContain('data-icon-kind="theorem"');
    expect(html).toContain('class="example-card toc-chunk"');
    expect(html).toContain('class="analysis-card toc-chunk"');
    expect(html).toContain('class="solution-details"');
    expect(html).toContain('class="exercise-card toc-chunk"');
    expect(html).toContain('class="academic-algorithm toc-chunk"');
    expect(html).toContain('class="astrolib-sidenote sidenote-think');
    expect(html).toContain('class="astrolib-sidenote sidenote-note sidenote-left');
    expect(html).toContain('class="variant-card toc-chunk"');
    expect(html).toContain('class="note-card toc-chunk"');
    expect(html).toContain('class="method-card toc-chunk"');
    expect(html).toContain('class="summary-card toc-chunk"');
    expect(html).toContain('class="academic-digital-resource');
    expect(html).toContain('class="exercise-trigger-card');
    expect(html).toContain('class="mermaid-container"');
    expect(html).toContain('src="/collections/math/test_linear/images/fig1.png"');

    expect(html).not.toMatch(/<figure[^>]*>[\s\S]*?<figure/i);
  });

  it('compileBookToAbp 与 verifyAbpArchive 支持 book.json 多级目录、内嵌封面与资产闭环校验', async () => {
    const bookDir = path.join(tmpRoot, 'src-book');
    const outDir = path.join(tmpRoot, 'out');
    fs.mkdirSync(path.join(bookDir, 'images'), { recursive: true });

    const png1x1 = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
      'base64'
    );
    fs.writeFileSync(path.join(bookDir, 'images', 'cover.png'), png1x1);
    fs.writeFileSync(path.join(bookDir, 'images', 'fig_1_1.png'), png1x1);

    fs.writeFileSync(
      path.join(bookDir, 'book.json'),
      JSON.stringify(
        {
          colSlug: 'math',
          slug: 'sample_algebra',
          title: '高等代数测试讲义',
          author: '测试作者',
          entryPoint: '00_前言',
          sections: [
            { title: '卷首', chapters: ['00_前言.mdx'] },
            { title: '第1章 多项式', chapters: ['1.1_数域.mdx', '1.2_习题.mdx'] },
          ],
        },
        null,
        2
      ),
      'utf-8'
    );

    fs.writeFileSync(
      path.join(bookDir, '00_前言.mdx'),
      `---\ntitle: "前言"\n---\n\n这是面向理工科本科生的测试讲义。\n`,
      'utf-8'
    );
    fs.writeFileSync(
      path.join(bookDir, '1.1_数域.mdx'),
      `---\ntitle: "1.1 数域"\n---\n\n## 1.1 数域定义\n\n<Knowledge title="定义 1.1 数域">\n包含 $0$ 和 $1$ 且对四则运算封闭的数集称为数域。\n</Knowledge>\n\n<figure class="vp-figure">![图 1.1 数域层级](images/fig_1_1.png)<figcaption>图 1.1 数域层级</figcaption></figure>\n`,
      'utf-8'
    );
    fs.writeFileSync(
      path.join(bookDir, '1.2_习题.mdx'),
      `---\ntitle: "第1章习题"\n---\n\n<Exercise title="练习 1">\n证明 $\\mathbb{Q}(\\sqrt{2})$ 是数域。\n<Solution title="提示">\n检验分母有理化。\n</Solution>\n</Exercise>\n`,
      'utf-8'
    );

    const valReport = await validateBookDirectory(bookDir);
    expect(valReport.passed).toBe(true);
    expect(valReport.errorCount).toBe(0);

    const compiled = await compileBookToAbp({
      bookDir,
      outDir,
      withVectors: false,
      includeAuxiliary: true,
    });

    expect(fs.existsSync(compiled.abpPath)).toBe(true);
    expect(compiled.manifest.sections.length).toBe(2);
    expect(compiled.manifest.sections[0].title).toBe('卷首');
    expect(compiled.manifest.sections[1].chapters).toHaveLength(2);
    expect(compiled.manifest.cover).toBe('/abp-packs/math-sample_algebra/images/cover.png');

    const verifyReport = await verifyAbpArchive(compiled.abpPath);
    expect(verifyReport.passed).toBe(true);
    expect(verifyReport.katexErrorChapters).toEqual([]);
    expect(verifyReport.missingAssets).toEqual([]);
    expect(verifyReport.bundleSummary?.hasAiIndex).toBe(true);
    expect(verifyReport.bundleSummary?.hasCrossRefs).toBe(true);
    expect(verifyReport.bundleSummary?.hasRelationGraph).toBe(true);
    expect(verifyReport.bundleSummary?.hasInspectorData).toBe(true);
  });

  it('validateBookDirectory 精准拦截破损 KaTeX、缺失图片、原生 img、嵌套 figure、尾部标题泄漏及注解卡', async () => {
    const badDir = path.join(tmpRoot, 'bad-book');
    fs.mkdirSync(badDir, { recursive: true });

    fs.writeFileSync(
      path.join(badDir, '1.1_坏章节.mdx'),
      `---\ntitle: "坏章节"\n---\n\n行内错误公式 $\\frac{1$。\n\n![缺失图](images/not_exist.png)\n\n<img src="images/raw.png" />\n\n<figure><figure><figcaption>嵌套</figcaption></figure></figure>\n\n| 区间 | 值 |\n| --- | --- |\n| 10~20 | 5 |\n\n## 1.2 泄漏的下一节标题\n`,
      'utf-8'
    );

    fs.writeFileSync(
      path.join(badDir, '1.3_第1章注解.mdx'),
      `---\ntitle: "第1章注解"\n---\n\n<Knowledge title="定理 1.1">\n注解章不允许写 Knowledge。\n</Knowledge>\n`,
      'utf-8'
    );

    const report = await validateBookDirectory(badDir);
    expect(report.passed).toBe(false);

    const categories = new Set(report.errors.map((e) => e.category));
    expect(categories.has('katex')).toBe(true);
    expect(categories.has('image-asset')).toBe(true);
    expect(categories.has('figure-nesting')).toBe(true);
    expect(categories.has('trailing-heading')).toBe(true);
    expect(categories.has('annotation-card')).toBe(true);
    expect(report.warnings.some((w) => w.category === 'table-tilde')).toBe(true);
  });

  it('允许同一章节中存在多个并列 <figure class="vp-figure"> 块而不会误报嵌套错误', async () => {
    const multiFigDir = path.join(tmpRoot, 'multi-fig-book');
    fs.mkdirSync(path.join(multiFigDir, 'images'), { recursive: true });
    const png1x1 = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
      'base64'
    );
    fs.writeFileSync(path.join(multiFigDir, 'images', 'f1.png'), png1x1);
    fs.writeFileSync(path.join(multiFigDir, 'images', 'f2.png'), png1x1);

    fs.writeFileSync(
      path.join(multiFigDir, '01_multi.mdx'),
      [
        '---',
        'title: "Multi Figures"',
        '---',
        '',
        '<figure class="vp-figure">![图 1](images/f1.png)<figcaption>图 1</figcaption></figure>',
        '',
        '中间正文段落。',
        '',
        '<figure class="vp-figure">![图 2](images/f2.png)<figcaption>图 2</figcaption></figure>',
        '',
      ].join('\n'),
      'utf-8'
    );

    const report = await validateBookDirectory(multiFigDir);
    expect(report.passed).toBe(true);
    expect(report.errorCount).toBe(0);
  });

  it('Phase 2: 支持含撇号 Block 标题、双轨代码高亮、行级 Algorithm 伪代码与页码作用域脚注', () => {
    const mdx = `---
title: "1.2 Modular arithmetic"
---

Modular arithmetic meets shaded excursion[^p14-1] and code[^p15-1].

<Block title="Two's complement">
Stores negative numbers as $2^n - x$.
</Block>

\`\`\`python
def mod_add(a: int, b: int, m: int) -> int:
    return (a + b) % m
\`\`\`

<Algorithm title="Figure 1.1 Multiplication à la Française">
function multiply($x$, $y$)
Input: Two $n$-bit integers $x, y \\ge 0$
Output: Their product
  if $y = 0$: return $0$
  $z = \\text{multiply}(x, \\lfloor y/2 \\rfloor)$
</Algorithm>

[^p14-1]: First note with $x^2$ math.
[^p15-1]: Second academic note.
`;

    const res = compileMarkdownToSemanticResult(mdx, {
      colSlug: 'cs',
      bookSlug: 'algorithms_test',
      bookTitle: 'Algorithms',
      chapterSlug: 'ch1_sec2',
    });

    expect(res.html).toContain('Two&#39;s complement');
    expect(res.html).toContain('block-card fallback-block toc-chunk');
    expect(res.html).toContain('class="astrolib-code-block not-content"');
    expect(res.html).toContain('class="hljs-keyword"');
    expect(res.html).toContain('class="code-block-copy-btn"');
    expect(res.html).toContain('class="algo-line" style="--algo-indent:2"');
    expect(res.html).toContain('class="katex"');
    const fnList = Object.values(res.footnotes);
    expect(fnList).toHaveLength(2);
    expect(fnList[0].title).toBe('脚注 1');
    expect(fnList[1].title).toBe('脚注 2');
    expect(fnList[0].html).toContain('First note with');
    expect(res.html).toContain('data-astrolib-footnote="');
    expect(res.html).toContain('class="academic-footnotes"');
  });

  it('Phase 2: 编译 chapter-intro 并挂载至该章首节 chapterIntro 而不污染 chapters[]', async () => {
    const bookDir = path.join(tmpRoot, 'intro-book');
    const outDir = path.join(tmpRoot, 'intro-out');
    fs.mkdirSync(bookDir, { recursive: true });

    fs.writeFileSync(
      path.join(bookDir, 'book.json'),
      JSON.stringify({
        colSlug: 'cs',
        slug: 'algo_intro_test',
        title: 'Algorithms',
        sections: [
          {
            title: 'Chapter 0 · Prologue',
            intro: '01_ch0_intro.mdx',
            chapters: ['02_0.1_books.mdx'],
          },
        ],
      }),
      'utf-8'
    );
    fs.writeFileSync(
      path.join(bookDir, '01_ch0_intro.mdx'),
      '---\ntitle: "Prologue"\n---\n\nComputers and networks are everywhere.\n',
      'utf-8'
    );
    fs.writeFileSync(
      path.join(bookDir, '02_0.1_books.mdx'),
      '---\ntitle: "0.1 Books and algorithms"\n---\n\nTwo ideas changed the world.\n',
      'utf-8'
    );

    const compiled = await compileBookToAbp({
      bookDir,
      outDir,
      withVectors: false,
      writeExpanded: true,
    });

    expect(compiled.manifest.sections[0].introSlug).toBe('01_ch0_intro');
    expect(compiled.manifest.sections[0].chapters.map((c) => c.slug)).toEqual(['02_01_books']);
    const introPayload = JSON.parse(
      fs.readFileSync(path.join(compiled.expandedDir!, 'chapters', '01_ch0_intro.json'), 'utf-8')
    );
    const secPayload = JSON.parse(
      fs.readFileSync(path.join(compiled.expandedDir!, 'chapters', '02_01_books.json'), 'utf-8')
    );
    expect(introPayload.chapterKind).toBe('chapter-intro');
    expect(secPayload.chapterIntro?.slug).toBe('01_ch0_intro');
    expect(secPayload.chapterIntro?.html).toContain('Computers and networks are everywhere');

    const verify = await verifyAbpArchive(compiled.abpPath);
    expect(verify.passed).toBe(true);
  });

  it('Phase 2: validateBookDirectory 捕获正文重复标题、Algorithm 非法 <br/> 与破损脚注', async () => {
    const bad2 = path.join(tmpRoot, 'bad-phase2');
    fs.mkdirSync(bad2, { recursive: true });

    fs.writeFileSync(
      path.join(bad2, '01_dup_h1.mdx'),
      `---
title: "0.1 Books and algorithms"
---

## 0.1 Books and algorithms

# Forbidden H1

<Algorithm title="Figure 1.1">
if y == 0:<br/>&nbsp;&nbsp;return 0
</Algorithm>

Text with orphan[^p5-1] and duplicate[^p5-2].

<!-- MINERU_FOOTNOTE p5: unconverted note -->

[^p5-2]: First def
[^p5-2]: Duplicate def
`,
      'utf-8'
    );

    const rep = await validateBookDirectory(bad2);
    expect(rep.passed).toBe(false);
    const cats = new Set(rep.errors.map((e) => e.category));
    expect(cats.has('duplicate-heading')).toBe(true);
    expect(cats.has('algorithm-syntax')).toBe(true);
    expect(cats.has('footnote')).toBe(true);
  });
});
