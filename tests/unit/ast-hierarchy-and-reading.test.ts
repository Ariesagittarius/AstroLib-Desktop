import { describe, it, expect } from 'vitest';
import { ContentApiService } from '../../src/core/content-api/content-api-service.ts';
import { extractChapterAst, findNodeById, flattenTree, formatAstTreeOutline } from '../../src/core/content-api/ast-extractor.ts';
import { PluginEnvironment } from '../../src/plugins/harness/plugin-environment.ts';

describe('AstroLib AST Hierarchy & Content Reader Suite', () => {
  const service = ContentApiService.getInstance();
  const env = PluginEnvironment.getInstance();

  describe('1. 目录工具完整性与标题自愈测试 (彻底杜绝目录残缺与错位)', () => {
    it('1.1 《数学分析》大纲应包含全书全部章节 (>= 130 节)，不截断于 40 条', () => {
      const toc = service.getBookToc('math', 'math_analysis');
      expect(toc).toBeDefined();
      expect(toc.catalog.length).toBeGreaterThanOrEqual(130);

      const hasIntegral = toc.catalog.some(
        (c: any) => c.slug.includes('定积分') || c.title?.includes('定积分') || c.slug.includes('10.')
      );
      expect(hasIntegral).toBe(true);

      const hasSeries = toc.catalog.some(
        (c: any) => c.slug.includes('级数') || c.title?.includes('级数') || c.slug.includes('13.')
      );
      expect(hasSeries).toBe(true);
    });

    it('1.2 历史错位标题自愈：00_intro, 3.4 Cauchy, 5.1 连续性 不应显示为次级练习题', () => {
      const toc = service.getBookToc('math', 'math_analysis');
      const intro = toc.catalog.find((c: any) => c.slug.includes('00_intro') || c.filePath?.includes('00_intro'));
      expect(intro?.title).not.toContain('新高考数学');

      const cauchy = toc.catalog.find((c: any) => c.slug.includes('34_cauchy') || c.filePath?.includes('3.4'));
      expect(cauchy?.title).not.toBe('$3.4.5$ 练习题');
      expect(cauchy?.title).toContain('Cauchy');

      const continuity = toc.catalog.find((c: any) => c.slug.includes('51_连续性') || c.filePath?.includes('5.1'));
      expect(continuity?.title).not.toBe('$5.1.4$ 练习题');
      expect(continuity?.title).toContain('连续性');
    });
  });

  describe('2. 真实 AST 语法结构树深度提取测试 (包含标题、段落、公式、模块与嵌套层级)', () => {
    it('2.1 数学分析 6.2 章节应提取出完整的层次化 AST 树 (tree)', () => {
      const ast = service.getChapterAst('math', 'math_analysis', '6.2_高阶导数及其他求导法则');
      expect(ast).toBeDefined();
      expect(ast.title).toContain('6.2');
      expect(Array.isArray(ast.tree)).toBe(true);
      expect(ast.tree.length).toBeGreaterThanOrEqual(4);

      const introP = ast.tree.find((n) => n.type === 'paragraph' && n.lineStart === 14);
      expect(introP).toBeDefined();
      expect(introP?.summary).toContain('正文段落');
      expect(introP?.preview).toContain('高阶导数的计算方法');

      const sec621 = ast.tree.find((n) => n.type === 'heading' && n.title?.includes('6.2.1'));
      expect(sec621).toBeDefined();
      expect(sec621?.level).toBe(2);
      expect(sec621?.children).toBeDefined();
      expect(sec621?.children?.length).toBeGreaterThanOrEqual(6);

      const secChildren = sec621!.children!;
      const formulaNode = secChildren.find((c) => c.type === 'math_block');
      expect(formulaNode).toBeDefined();
      expect(formulaNode?.latex).toContain('binom');
      expect(formulaNode?.latex).toContain('(u v) ^ {(n)}');
      expect(formulaNode?.summary).toContain('公式');

      const ex1 = secChildren.find((c) => c.type === 'card' && c.title?.includes('6.2.1'));
      expect(ex1).toBeDefined();
      expect(ex1?.tag).toBe('Example');
      expect(ex1?.lineStart).toBe(28);
      expect(ex1?.children).toBeDefined();

      const sol = ex1!.children!.find((c) => c.type === 'card' && (c.tag === 'Solution' || c.title?.includes('解')));
      expect(sol).toBeDefined();
      expect(sol?.lineStart).toBe(31);
      expect(sol?.children).toBeDefined();

      const solMath = sol!.children!.find((c) => c.type === 'math_block');
      expect(solMath).toBeDefined();
      expect(solMath?.latex).toContain('(x ^ {2} \\sin x) ^ {(80)}');
    });

    it('2.2 formatAstTreeOutline() 应生成层次清晰、含 ID 与公式的树状大纲', () => {
      const ast = service.getChapterAst('math', 'math_analysis', '6.2_高阶导数及其他求导法则');
      const outline = formatAstTreeOutline(ast.tree);
      expect(outline).toContain('[H2] 6.2.1 高阶导数计算');
      expect(outline).toContain('id: "card-28-example"');
      expect(outline).toContain('id: "math-20"');
      expect(outline).toContain('id: "p-18"');
    });
  });

  describe('3. 精准内容读取工具测试 (read_content_node)', () => {
    it('3.1 readChapterNode 应通过 nodeId="card-28-example" 完整读取例题 6.2.1 的全量 MDX 源码', () => {
      const result = service.readChapterNode('math', 'math_analysis', '6.2_高阶导数及其他求导法则', 'card-28-example');
      expect(result.success).toBe(true);
      expect(result.id).toBe('card-28-example');
      expect(result.lineStart).toBe(28);
      expect(result.lineEnd).toBe(38);
      expect(result.rawMdx).toContain('<Example title="例 6.2.1">');
      expect(result.rawMdx).toContain('<Solution title="解">');
      expect(result.rawMdx).toContain('(x ^ {2} \\sin x) ^ {(80)}');
      expect(result.rawMdx).toContain('</Example>');
    });

    it('3.2 readChapterNode 应通过 nodeId="math-20" 精准读取 Leibniz 独立公式块', () => {
      const result = service.readChapterNode('math', 'math_analysis', '6.2_高阶导数及其他求导法则', 'math-20');
      expect(result.success).toBe(true);
      expect(result.type).toBe('math_block');
      expect(result.latex).toContain('(u v) ^ {(n)}');
      expect(result.rawMdx).toContain('$$');
    });

    it('3.3 readChapterNode 应通过 nodeId="p-18" 精准读取正文段落', () => {
      const result = service.readChapterNode('math', 'math_analysis', '6.2_高阶导数及其他求导法则', 'p-18');
      expect(result.success).toBe(true);
      expect(result.type).toBe('paragraph');
      expect(result.rawMdx).toContain('这里 $Leibniz$ (莱布尼茨) 公式是主要工具');
    });

    it('3.4 PluginEnvironment 工具 read_content_node 应支持完整协议与参数闭环调用', async () => {
      const res: any = await env.executeAgentTool(
        'read_content_node',
        {
          colSlug: 'math',
          bookSlug: 'math_analysis',
          chapterSlug: '62_高阶导数及其他求导法则',
          nodeId: 'card-28-example',
        },
        {
          books: service.listBooks() as any,
          chapters: service.buildGlobalChapterIndex() as any,
        }
      );

      expect(res.success).toBe(true);
      expect(res.contextText).toContain('<Example title="例 6.2.1">');
      expect(res.summary).toBeDefined();
    });

    it('3.5 Harness 动态指令 /read 应成功提取指定节点', async () => {
      const result = await env.executeCommand('/read math_analysis 62_高阶导数及其他求导法则 card-28-example', {
        books: service.listBooks() as any,
        chapters: service.buildGlobalChapterIndex() as any,
      });

      expect(result.success).toBe(true);
      expect(result.summary).toContain('card-28-example');
      expect(result.contextText).toContain('【AST 节点原文精读结果');
      expect(result.contextText).toContain('<Example title="例 6.2.1">');
    });
  });
});
