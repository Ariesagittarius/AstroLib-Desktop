import { describe, it, expect } from 'vitest';
import { ContentApiService } from '../../src/core/content-api/content-api-service.ts';

describe('Phase 1: ContentApiService Internal Contract Tests', () => {
  const service = ContentApiService.getInstance();

  it('1. listBooks() 应返回全部 13 本教材且字段规范完整', () => {
    const books = service.listBooks();
    expect(Array.isArray(books)).toBe(true);
    expect(books.length).toBeGreaterThanOrEqual(13);

    const lag = books.find((b) => b.slug === 'linear_algebra_geometry');
    expect(lag).toBeDefined();
    expect(lag?.colSlug).toBe('math');
    expect(lag?.title).toContain('线性代数与几何');
    expect(lag?.entryPoint).toBeDefined();
    expect(lag?.sourceDir).toContain('content-sources/collections/math/linear_algebra_geometry');
  });

  it('2. getBookToc() 应正确递归构建树状大纲', () => {
    const toc = service.getBookToc('math', 'linear_algebra_geometry');
    expect(toc).toBeDefined();
    expect(toc.bookSlug).toBe('linear_algebra_geometry');
    expect(Array.isArray(toc.catalog)).toBe(true);
    expect(toc.catalog.length).toBeGreaterThan(0);

    const firstChapter = toc.catalog.find((c) => c.type === 'chapter');
    expect(firstChapter).toBeDefined();
    expect((firstChapter as any).slug).toBeDefined();
    expect((firstChapter as any).filePath).toContain('.mdx');
  });

  it('3. getChapterAst() 应精准提取大纲、学术卡片、数学公式与段落切片', () => {
    const ast = service.getChapterAst('math', 'linear_algebra_geometry', '11_二三阶行列式');
    expect(ast).toBeDefined();
    expect(ast.title).toBe('1.1 二、三阶行列式');
    expect(ast.headings.length).toBeGreaterThan(0);

    expect(ast.cards.length).toBeGreaterThanOrEqual(8);
    const defCard = ast.cards.find((c) => c.title?.includes('定义 1.1'));
    expect(defCard).toBeDefined();
    expect(defCard?.tag).toBe('Knowledge');
    expect(defCard?.content).toContain('二阶行列式');
    expect(defCard?.lineStart).toBeGreaterThan(0);
    expect(defCard?.lineEnd).toBeGreaterThan(defCard?.lineStart || 0);

    const exampleCard = ast.cards.find((c) => c.tag === 'Example');
    expect(exampleCard).toBeDefined();
    expect(exampleCard?.type).toBe('example');

    expect(ast.formulas.length).toBeGreaterThan(20);
    const blockFormula = ast.formulas.find((f) => f.displayMode === 'block');
    expect(blockFormula).toBeDefined();
    expect(blockFormula?.latex).toBeDefined();

    expect(ast.paragraphs.length).toBeGreaterThan(0);
    expect(ast.readingTimeMinutes).toBeGreaterThan(0);
    expect(ast.wordCount).toBeGreaterThan(100);
  });

  it('4. getChapterExercises() 应准确检索章节关联的习题集', () => {
    const exercises = service.getChapterExercises('math', 'linear_algebra_geometry', '1.1_二三阶行列式');
    expect(Array.isArray(exercises)).toBe(true);
    expect(exercises.length).toBeGreaterThanOrEqual(1);

    const q1 = exercises[0];
    expect(q1.id).toBeDefined();
    expect(q1.question).toContain('三阶行列式');
    expect(q1.sourceBook).toBe('linear_algebra_geometry');
  });

  it('5. searchExercises() 全局搜索应支持关键词模糊检索', () => {
    const results = service.searchExercises('行列式', 5);
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(5);
    expect(results[0].question.toLowerCase()).toContain('行列式');
  });

  it('6. listMineruTasks() 应列出 task/ 目录下的 MinerU 结构化产物', () => {
    const tasks = service.listMineruTasks();
    expect(Array.isArray(tasks)).toBe(true);
    expect(tasks.length).toBeGreaterThanOrEqual(1);

    const taskWithLayout = tasks.find((t) => t.hasLayoutJson);
    expect(taskWithLayout).toBeDefined();
    expect(taskWithLayout?.bookHash).toBeDefined();
    expect(taskWithLayout?.imageCount).toBeGreaterThan(0);
  });

  it('7. getMineruLayout() 应正确提取 OCR 布局切片', () => {
    const tasks = service.listMineruTasks();
    const task = tasks.find((t) => t.hasLayoutJson);
    if (task) {
      const layoutRes = service.getMineruLayout(task.bookHash, 10);
      expect(layoutRes.success).toBe(true);
      expect(Array.isArray(layoutRes.blocks)).toBe(true);
      expect(layoutRes.blocks?.length).toBeLessThanOrEqual(10);
    }
  });

  it('8. 异常处理：查询不存在的章节应抛出标准语义异常', () => {
    expect(() => {
      service.getChapterAst('math', 'linear_algebra_geometry', 'non_existing_slug_xyz');
    }).toThrowError(/未找到章节/);
  });

  it('9. getChapterAst({ includeRawMdx: true }) 应返回完整 rawMdx 源码与卡片元数据', () => {
    const ast = service.getChapterAst('math', 'linear_algebra_geometry', '11_二三阶行列式', { includeRawMdx: true });
    expect(ast.rawMdx).toBeDefined();
    expect(ast.rawMdx?.length).toBeGreaterThan(100);
    expect(ast.cards.length).toBeGreaterThan(0);
    expect(ast.formulas.length).toBeGreaterThan(0);
  });
});
