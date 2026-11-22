import { describe, it, expect, beforeEach } from 'vitest';
import { PluginEnvironment } from '../../src/plugins/harness/plugin-environment.ts';
import { HeuristicResolver } from '../../src/plugins/harness/heuristic-resolver.ts';
import type { BookMeta, HarnessPlugin, PluginContext } from '../../src/plugins/harness/types.ts';

const mockBooks: BookMeta[] = [
  {
    colSlug: 'math',
    slug: 'math_senior',
    title: '新高考数学你真的掌握了吗（第二版）',
    subject: 'math',
    tags: ['高考数学', '高中数学', '三角函数', '导数'],
  },
  {
    colSlug: 'math',
    slug: 'math_analysis',
    title: '数学分析',
    subject: 'math',
    tags: ['极限', '微积分', '级数'],
  },
  {
    colSlug: 'math',
    slug: 'linear_algebra',
    title: '线性代数及其应用（原书第5版）',
    subject: 'math',
    tags: ['线性代数', '矩阵代数', '行列式', '特征值'],
  },
  {
    colSlug: 'math',
    slug: 'linear_algebra_geometry',
    title: '线性代数与几何（第2版）',
    subject: 'math',
    tags: ['线性代数', '空间解析几何', '行列式', '矩阵', '二次型'],
  },
  {
    colSlug: 'science',
    slug: 'university_physics',
    title: '大学物理学（第七版）',
    subject: 'science',
    tags: ['力学', '电磁学', '热学', '光学'],
  },
];

describe('Harness Plugin Environment & Heuristic Tools Test Suite', () => {
  let env: PluginEnvironment;

  beforeEach(() => {
    env = PluginEnvironment.getInstance();
  });

  describe('1. HeuristicResolver (纯算法启发式求解测试)', () => {
    it('1.1 当用户输入非法序号 (如 /toc 123) 时，严禁落回默认书籍，必须返回错误并提供候选列表', () => {
      const result = HeuristicResolver.resolve('123', mockBooks, '/toc');
      expect(result.book).toBeNull();
      expect(result.confidence).toBe('none');
      expect(result.reason).toContain('超出有效范围');
      expect(result.suggestions.length).toBe(mockBooks.length);
      expect(result.suggestions[0].fillCommand).toBe('/toc math_senior');
    });

    it('1.2 当用户输入有效序号 (如 1 或 3) 时，精准按 1-based 序号命中目标图书', () => {
      const res1 = HeuristicResolver.resolve('1', mockBooks, '/toc');
      expect(res1.book?.slug).toBe('math_senior');
      expect(res1.confidence).toBe('exact');

      const res3 = HeuristicResolver.resolve('3', mockBooks, '/toc');
      expect(res3.book?.slug).toBe('linear_algebra');
      expect(res3.confidence).toBe('exact');
    });

    it('1.3 当用户输入精确 slug 时，精准命中', () => {
      const result = HeuristicResolver.resolve('linear_algebra_geometry', mockBooks, '/toc');
      expect(result.book?.slug).toBe('linear_algebra_geometry');
      expect(result.confidence).toBe('exact');
    });

    it('1.4 当用户输入空参数时，优雅返回待选建议列表', () => {
      const result = HeuristicResolver.resolve('', mockBooks, '/toc');
      expect(result.book).toBeNull();
      expect(result.suggestions.length).toBe(mockBooks.length);
    });

    it('1.5 模糊关键词匹配：输入 "物理" 自动命中大学物理学', () => {
      const result = HeuristicResolver.resolve('物理', mockBooks, '/toc');
      expect(result.book?.slug).toBe('university_physics');
    });

    it('1.6 存在多本相似书籍时（如 "线性代数"），返回最高分书籍并附带全部候选消除歧义', () => {
      const result = HeuristicResolver.resolve('线性代数', mockBooks, '/toc');
      expect(result.book).toBeDefined();
      expect(['linear_algebra', 'linear_algebra_geometry']).toContain(result.book?.slug);
      expect(result.candidates.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('2. PluginEnvironment 插件生命周期与可扩展性测试', () => {
    it('2.1 默认内置核心插件应全部正常注册且命令齐备', () => {
      const cmds = env.getAllCommands();
      const cmdNames = cmds.map((c) => c.command);
      expect(cmdNames).toContain('/books');
      expect(cmdNames).toContain('/toc');
      expect(cmdNames).toContain('/ast');
      expect(cmdNames).toContain('/exercises');
      expect(cmdNames).toContain('/diff');
    });

    it('2.2 允许运行时动态热挂载第三方新插件，系统自动无感支持新指令与新工具', async () => {
      const customPlugin: HarnessPlugin = {
        id: 'test.custom.plugin',
        name: '测试自定义导出插件',
        version: '1.0.0',
        description: '将章节导出为 Typst 或 PDF',
        activate: (ctx: PluginContext) => {
          ctx.registerCommand({
            command: '/export',
            displayName: '导出文档',
            description: '导出为 Typst/PDF',
            usage: '<格式>',
            execute: async (args) => ({
              toolName: 'export_document',
              command: `/export ${args}`,
              success: true,
              summary: `已触发导出: ${args}`,
              cardHtml: '<div>导出完成</div>',
              contextText: `导出状态: ${args}`,
            }),
          });

          ctx.registerTool({
            name: 'export_document',
            description: '导出指定格式文档',
            parameters: { type: 'object', properties: { format: { type: 'string' } } },
            execute: async (args) => ({
              toolName: 'export_document',
              command: `/export ${args.format}`,
              success: true,
              summary: '导出成功',
              cardHtml: '<div>OK</div>',
              contextText: '已导出',
            }),
          });
        },
      };

      await env.registerPlugin(customPlugin);

      const cmds = env.getAllCommands().map((c) => c.command);
      expect(cmds).toContain('/export');

      const matches = env.extractInlineCommands('请使用 /export pdf 为我导出本章');
      expect(matches.length).toBe(1);
      expect(matches[0].cmd).toBe('/export');
      expect(matches[0].args).toBe('pdf');

      const openAiTools = env.toOpenAITools();
      const toolNames = openAiTools.map((t) => t.function.name);
      expect(toolNames).toContain('export_document');

      const help = env.generateSystemPromptHelp();
      expect(help).toContain('/export');
      expect(help).toContain('export_document');

      await env.unregisterPlugin('test.custom.plugin');
      const cmdsAfter = env.getAllCommands().map((c) => c.command);
      expect(cmdsAfter).not.toContain('/export');
    });
  });

  describe('3. 内联指令提取与上下文转化测试 (Inline Context Augmentation)', () => {
    it('3.1 准确从复合自然语言问题中提取内联指令与其参数', () => {
      const text = '请结合 /toc linear_algebra_geometry 分析前两章知识结构，并检索 /exercises 行列式 讲解典型习题';
      const matches = env.extractInlineCommands(text);

      expect(matches.length).toBe(2);
      expect(matches[0].cmd).toBe('/toc');
      expect(matches[0].args).toBe('linear_algebra_geometry');
      expect(matches[1].cmd).toBe('/exercises');
      expect(matches[1].args).toBe('行列式');
    });

    it('3.2 buildAugmentedPrompt 应将多个工具返回的真实学术数据组织为清晰上下文注入段', () => {
      const rawQuestion = '请总结该章节的定理';
      const toolResults = [
        {
          toolName: 'get_chapter_ast',
          command: '/ast 11_二三阶行列式',
          success: true,
          summary: '成功提取',
          cardHtml: '<div>card</div>',
          contextText: '【章节1.1 核心卡片】: 定理1.1.1 对角线法则; 定理1.1.2 行列式展开',
        },
      ];

      const augmented = env.buildAugmentedPrompt(rawQuestion, toolResults);
      expect(augmented).toContain('【上下文信息 (由工具指令 /ast 11_二三阶行列式 提取)】');
      expect(augmented).toContain('对角线法则');
      expect(augmented).toContain('【用户问题】:\n请总结该章节的定理');
    });
  });

  describe('4. 启发式下拉提示菜单生成测试 (getSuggestions)', () => {
    it('4.1 当用户键入 "/" 时，动态返回所有已加载指令的总览提示', async () => {
      const suggestions = await env.getSuggestions('/', { books: mockBooks });
      expect(suggestions.length).toBeGreaterThanOrEqual(5);
      const titles = suggestions.map((s) => s.title);
      expect(titles.some((t) => t.startsWith('/books'))).toBe(true);
      expect(titles.some((t) => t.startsWith('/toc'))).toBe(true);
    });

    it('4.2 当用户键入 "/toc " 时，动态返回启发式书籍推荐列表', async () => {
      const suggestions = await env.getSuggestions('/toc ', { books: mockBooks });
      expect(suggestions.length).toBe(mockBooks.length);
      expect(suggestions[0].fillCommand).toContain('/toc ');
    });
  });

  describe('5. Agent 自主工具认知与 Function Calling 契约测试', () => {
    it('5.1 generateSystemPromptHelp 应显式申明已挂载的 5 个学术工具、Function Calling 机制与指令映射', () => {
      const help = env.generateSystemPromptHelp();
      expect(help).toContain('AstroLib 学术知识库与自主工具调用系统');
      expect(help).toContain('get_books_catalog');
      expect(help).toContain('get_book_toc');
      expect(help).toContain('get_chapter_ast');
      expect(help).toContain('search_exercises');
      expect(help).toContain('compare_chapters');
      expect(help).toContain('【工具调用与协同规范 (Tool Use Rules)】');
      expect(help).toContain('优先调用工具获取真实数据');
      expect(help).toContain('正面确认工具能力');
    });

    it('5.2 toOpenAITools 应准确生成符合 OpenAI 契约规范的 Function Calling 参数 Schema', () => {
      const tools = env.toOpenAITools();
      expect(tools.length).toBeGreaterThanOrEqual(5);

      const toolNames = tools.map((t) => t.function.name);
      expect(toolNames).toContain('get_books_catalog');
      expect(toolNames).toContain('get_book_toc');
      expect(toolNames).toContain('get_chapter_ast');
      expect(toolNames).toContain('search_exercises');
      expect(toolNames).toContain('compare_chapters');

      tools.forEach((t) => {
        expect(t.type).toBe('function');
        expect(typeof t.function.name).toBe('string');
        expect(typeof t.function.description).toBe('string');
        expect(t.function.parameters).toBeDefined();
        expect(t.function.parameters.type).toBe('object');
      });
    });

    it('5.3 executeAgentTool 支持自主调用 get_books_catalog 与 get_book_toc 并返回结构化学术上下文', async () => {
      const catRes = await env.executeAgentTool('get_books_catalog', {}, { books: mockBooks });
      expect(catRes.success).toBe(true);
      expect(catRes.contextText).toContain('数学分析');
      expect(catRes.cardHtml).toContain('harness-tool-card');

      const tocRes = await env.executeAgentTool('get_book_toc', { book: 'linear_algebra' }, { books: mockBooks });
      expect(tocRes.success).toBe(true);
      expect(tocRes.contextText).toContain('线性代数及其应用');
    });

    it('5.4 当 Agent 调用未注册的工具时，安全返回失败结果与降级说明，绝不崩溃', async () => {
      const errRes = await env.executeAgentTool('unknown_web_search', { q: 'test' }, { books: mockBooks });
      expect(errRes.success).toBe(false);
      expect(errRes.summary).toContain('未找到工具函数');
      expect(errRes.contextText).toContain('未注册');
    });
  });
});
