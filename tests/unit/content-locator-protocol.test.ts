/**
 * tests/unit/content-locator-protocol.test.ts
 * ============================================================================
 * AstroLib 统一内容定位协议 (AURP) 与跨书全局自愈寻址契约测试套件
 * ============================================================================
 * 覆盖场景：
 * 1. 规范 URI 格式互转 (astrolib://<col>/<book>[/<chapter>][#<card>])；
 * 2. 跨书全局章节反向寻址：验证输入 "06_第1章-三角函数" 绝不落回默认线性代数，而是精准定位新高考数学；
 * 3. 歧义消歧与候选推荐 (confidence: 'ambiguous')；
 * 4. ContentApiService 双模自愈 (源码 MDX + ABP 标准展开包 fallback 保证目录树绝不为空)；
 * 5. 习题多关键词分词智能检索 ("极限, 实数完备性") 与解答提取；
 * 6. Plugin 工具层与指令层规范契约验证 (/ast, /toc, locate_content)。
 * ============================================================================
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { UniversalLocatorResolver } from '../../src/core/content-api/content-locator.ts';
import { ContentApiService } from '../../src/core/content-api/content-api-service.ts';
import { PluginEnvironment } from '../../src/plugins/harness/plugin-environment.ts';
import type { ToolExecutionContext } from '../../src/plugins/harness/types.ts';

describe('AstroLib Universal Content Locator Protocol (AURP) Suite', () => {
  const service = ContentApiService.getInstance();
  const env = PluginEnvironment.getInstance();
  const books = service.listBooks();
  const chapters = service.buildGlobalChapterIndex();

  describe('1. 规范协议 URI 格式生成与解析契约', () => {
    it('1.1 应正确生成标准书籍级与章节级 URI', () => {
      const bookUri = UniversalLocatorResolver.toUri({
        colSlug: 'math',
        bookSlug: 'math_analysis',
      });
      expect(bookUri).toBe('astrolib://math/math_analysis');

      const chapterUri = UniversalLocatorResolver.toUri({
        colSlug: 'math',
        bookSlug: 'math_analysis',
        chapterSlug: '21_数列极限的基本概念',
        cardId: 'thm-1',
      });
      expect(chapterUri).toBe('astrolib://math/math_analysis/21_数列极限的基本概念#thm-1');
    });

    it('1.2 应正确解析标准 astrolib:// 协议与路径格式', () => {
      const parsed1 = UniversalLocatorResolver.parseUri('astrolib://math/math_senior/06_第1章-三角函数');
      expect(parsed1).toBeDefined();
      expect(parsed1?.colSlug).toBe('math');
      expect(parsed1?.bookSlug).toBe('math_senior');
      expect(parsed1?.chapterSlug).toBe('06_第1章-三角函数');
      expect(parsed1?.isBookLevel).toBe(false);

      const parsed2 = UniversalLocatorResolver.parseUri('telecom/digital_circuit/03_逻辑门电路#gate-and');
      expect(parsed2).toBeDefined();
      expect(parsed2?.colSlug).toBe('telecom');
      expect(parsed2?.bookSlug).toBe('digital_circuit');
      expect(parsed2?.chapterSlug).toBe('03_逻辑门电路');
      expect(parsed2?.cardId).toBe('gate-and');
    });
  });

  describe('2. 跨书全局章节反向拓扑寻址 (彻底根除线性代数绑定硬编码)', () => {
    it('2.1 输入 "06_第1章-三角函数" 必须自动精确反向定位到新高考数学，严禁落回线性代数', () => {
      const locator = UniversalLocatorResolver.resolve('06_第1章-三角函数', books, chapters);
      expect(locator.confidence).toBe('exact');
      expect(locator.bookSlug).toBe('math_senior');
      expect(locator.colSlug).toBe('math');
      expect(locator.chapterSlug).toBe('06_第1章-三角函数');
      expect(locator.uri).toBe('astrolib://math/math_senior/06_第1章-三角函数');
      expect(locator.bookTitle).toContain('新高考数学');
    });

    it('2.2 输入 "21_数列极限的基本概念" 必须自动精确反向定位到数学分析', () => {
      const locator = UniversalLocatorResolver.resolve('21_数列极限的基本概念', books, chapters);
      expect(locator.confidence).toBe('exact');
      expect(locator.bookSlug).toBe('math_analysis');
      expect(locator.colSlug).toBe('math');
      expect(locator.uri).toBe('astrolib://math/math_analysis/21_数列极限的基本概念');
      expect(locator.bookTitle).toBe('数学分析');
    });

    it('2.3 复合书名与章节输入 (如 "数学分析 2.1") 应能精准拆解定位', () => {
      const locator = UniversalLocatorResolver.resolve('数学分析 2.1', books, chapters);
      expect(locator.bookSlug).toBe('math_analysis');
      expect(locator.colSlug).toBe('math');
      expect(locator.chapterSlug).toContain('2.1');
      expect(locator.isBookLevel).toBe(false);
    });

    it('2.4 纯书名或序号输入应正确解析为书籍级定位', () => {
      const locByName = UniversalLocatorResolver.resolve('数学分析', books, chapters);
      expect(locByName.bookSlug).toBe('math_analysis');
      expect(locByName.isBookLevel).toBe(true);
      expect(locByName.uri).toBe('astrolib://math/math_analysis');

      const locByIdx = UniversalLocatorResolver.resolve('2', books, chapters);
      expect(locByIdx.bookSlug).toBe('math_analysis');
      expect(locByIdx.isBookLevel).toBe(true);
    });
  });

  describe('3. ContentApiService 双模自愈保证 TOC 与 AST 绝不为空', () => {
    it('3.1 getBookToc("math", "math_analysis") 必须返回完整非空的章节目录', () => {
      const toc = service.getBookToc('math', 'math_analysis');
      expect(toc).toBeDefined();
      expect(toc.bookSlug).toBe('math_analysis');
      expect(toc.title).toBe('数学分析');
      expect(Array.isArray(toc.catalog)).toBe(true);
      expect(toc.catalog.length).toBeGreaterThanOrEqual(100);

      const sample = toc.catalog.find((c: any) => c.title?.includes('数列极限'));
      expect(sample).toBeDefined();
    });

    it('3.2 locateContent 应能通过门面方法直接求解统一内容定位器', () => {
      const loc = service.locateContent('06_第1章-三角函数');
      expect(loc.confidence).toBe('exact');
      expect(loc.bookSlug).toBe('math_senior');
      expect(loc.uri).toContain('astrolib://math/math_senior');
    });

    it('3.3 getChapterAst 应能正常提取卡片与 LaTeX 数学公式', () => {
      // 3.3.1 导读章应能提取 Guide 卡片
      const introAst = service.getChapterAst('math', 'math_senior', '06_第1章-三角函数');
      expect(introAst).toBeDefined();
      expect(introAst.title).toContain('三角函数');
      expect(introAst.cards.length).toBeGreaterThan(0);

      // 3.3.2 具体公式节应能完整提取学术卡片与 LaTeX 公式
      const formulaAst = service.getChapterAst('math', 'math_senior', '08_111_平方关系与商数关系');
      expect(formulaAst).toBeDefined();
      expect(formulaAst.cards.length).toBeGreaterThan(0);
      expect(formulaAst.formulas.length).toBeGreaterThan(0);
    });
  });

  describe('4. 习题多关键词智能模糊检索测试 ("极限, 实数完备性")', () => {
    it('4.1 多关键词分词检索应成功命中题目，不再返回空结果', () => {
      const results = service.searchExercises('极限, 实数完备性', 5);
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);
      expect(results.length).toBeLessThanOrEqual(5);

      const top = results[0];
      expect(top.id).toBeDefined();
      expect(top.question).toBeDefined();
      expect(top.solution).toBeDefined();
      expect(top.solution).toContain('答案:');
    });

    it('4.2 空白或标点分隔查询应具有高容错性', () => {
      const res1 = service.searchExercises('行列式 矩阵', 3);
      expect(res1.length).toBeGreaterThan(0);

      const res2 = service.searchExercises('导数，微分；积分', 3);
      expect(res2.length).toBeGreaterThan(0);
    });
  });

  describe('5. 插件指令与 Agent Tools 统一协议闭环验证', () => {
    let ctx: ToolExecutionContext;

    beforeEach(() => {
      ctx = {
        books,
        chapters: chapters as any,
        fetchFn: async (url) => {
          const urlStr = String(url);
          const matchToc = urlStr.match(/\/books\/([^/]+)\/([^/]+)\/toc$/);
          if (matchToc) {
            return {
              ok: true,
              json: async () => ({ success: true, data: service.getBookToc(matchToc[1], matchToc[2]) }),
            } as any;
          }
          const matchAst = urlStr.match(/\/books\/([^/]+)\/([^/]+)\/chapters\/([^/]+)\/ast/);
          if (matchAst) {
            try {
              const ast = service.getChapterAst(matchAst[1], matchAst[2], decodeURIComponent(matchAst[3]));
              return { ok: true, json: async () => ({ success: true, data: ast }) } as any;
            } catch (e: any) {
              return { ok: false, json: async () => ({ success: false, error: e.message }) } as any;
            }
          }
          const matchEx = urlStr.match(/\/exercises\/search\?q=([^&]+)/);
          if (matchEx) {
            const q = decodeURIComponent(matchEx[1]);
            const list = service.searchExercises(q, 5);
            return { ok: true, json: async () => ({ success: true, data: list }) } as any;
          }
          return { ok: true, json: async () => ({}) } as any;
        },
      };
    });

    it('5.1 /ast 06_第1章-三角函数 必须成功执行并返回规范 URI', async () => {
      const res = await env.executeCommand('/ast 06_第1章-三角函数', ctx);
      expect(res.success).toBe(true);
      expect(res.toolName).toBe('get_chapter_ast');
      expect(res.contextText).toContain('astrolib://math/math_senior/06_第1章-三角函数');
      expect(res.cardHtml).toContain('第1章 三角函数');
      expect(res.artifact?.html).toContain('harness-ast-tree');
    });

    it('5.2 Agent 调用 get_book_toc (math_analysis) 应返回完整非空章节目录与规范 URI', async () => {
      const res = await env.executeAgentTool('get_book_toc', { bookQuery: 'math_analysis' }, ctx);
      expect(res.success).toBe(true);
      expect(res.summary).toContain('已解析《数学分析》目录');
      expect(res.contextText).toContain('astrolib://math/math_analysis');
      expect(res.contextText).toContain('数列极限');
    });

    it('5.3 Agent 调用 search_exercises ("极限, 实数完备性") 应成功返回习题要点与题解', async () => {
      const res = await env.executeAgentTool('search_exercises', { query: '极限, 实数完备性' }, ctx);
      expect(res.success).toBe(true);
      expect(res.summary).toMatch(/命中|已检索到/);
      expect(res.contextText).toContain('答案:');
    });

    it('5.4 locate_content 工具应能供 Agent 自主探测并输出标准协议元数据', async () => {
      const res = await env.executeAgentTool('locate_content', { query: '06_第1章-三角函数' }, ctx);
      expect(res.success).toBe(true);
      expect(res.contextText).toContain('astrolib://math/math_senior/06_第1章-三角函数');
    });
  });
});
