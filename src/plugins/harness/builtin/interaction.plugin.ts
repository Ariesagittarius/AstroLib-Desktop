import type { HarnessPlugin, PluginContext } from '../types.ts';

const SOURCE_FILE = 'src/plugins/harness/builtin/interaction.plugin.ts';

export const InteractionPlugin: HarnessPlugin = {
  id: 'astrolib.builtin.interaction',
  name: '结构化需求访谈与决策追问插件 (/grill-me)',
  version: '1.0.0',
  description: '提供 ask_user_questions 交互卡片与 /grill-me 深度需求审视指令。',
  sourceFile: SOURCE_FILE,
  activate: (context: PluginContext) => {
    context.registerCommand({
      command: '/grill-me',
      aliases: ['/clarify'],
      displayName: '深度审视设计决策',
      description: '启动一轮面向方案边界与关键决策分支的结构化访谈（调用 ask_user_questions 逐分支对齐）。',
      usage: '[主题或需求描述]',
      icon: { type: 'mdicon', value: 'quiz' },
      execute: async (args) => {
        const topic = (args || '').trim();
        return {
          toolName: 'ask_user_questions',
          command: topic ? `/grill-me ${topic}` : '/grill-me',
          success: true,
          summary: topic ? `启动深度设计访谈: ${topic}` : '启动深度设计决策访谈',
          cardHtml: '',
          contextText: `用户明确请求通过 \`/grill-me\` 进行深度设计审视与需求边界对齐${
            topic ? `（主题：${topic}）` : ''
          }。请立即调用 \`ask_user_questions\` 工具（每次 1~3 个精准选择题，提供明确推荐项并保留开放补充），逐分支收拢目标、边界约束、交互方式与验收标准；全部明确后再着手设计或执行。`,
        };
      },
    });

    context.registerTool({
      name: 'ask_user_questions',
      displayName: '向用户发起结构化选择追问',
      category: '人机协同',
      icon: { type: 'mdicon', value: 'fact_check' },
      sourceFile: SOURCE_FILE,
      riskLevel: 'read',
      formatActionLabel: (args) => {
        const title = String(args.title || '').trim();
        return title ? `等待确认 · ${title}` : '向用户发起结构化确认';
      },
      description:
        '在对话流内原位挂起并渲染 Material You 交互选择题卡片（支持单选/多选、推荐标识与自定义补充），等待用户点击提交后返回精确选项，避免长段文字猜测需求。仅在需求存在关键歧义或执行 /grill-me 时使用。',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '卡片顶部简要标题，例如 "确认交互与数据范围"' },
          questions: {
            type: 'array',
            description: '1~4 个高信噪比决策问题',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: '问题唯一标识符，如 "scope"' },
                question: { type: 'string', description: '清晰的提问正文' },
                multiSelect: { type: 'boolean', description: '是否允许勾选多项，默认 false' },
                allowCustom: { type: 'boolean', description: '是否附带自定义文本补充框，默认 true' },
                options: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      label: { type: 'string', description: '选项文案' },
                      description: { type: 'string', description: '可选：简短权衡说明' },
                      recommended: { type: 'boolean', description: '是否为推荐默认项' },
                    },
                    required: ['label'],
                  },
                },
              },
              required: ['id', 'question', 'options'],
            },
          },
        },
        required: ['questions'],
      },
      execute: async (args, ctx) => {
        const title = String(args.title || '请确认方案偏好').trim();
        const questions = Array.isArray(args.questions) ? args.questions : [];
        if (questions.length === 0) {
          return {
            toolName: 'ask_user_questions',
            command: 'ask_user_questions',
            success: false,
            summary: '未提供有效问题列表',
            cardHtml: '',
            contextText: 'ask_user_questions 参数错误：questions 数组不能为空。',
          };
        }

        if (!ctx.requestUserQuestions) {
          return {
            toolName: 'ask_user_questions',
            command: 'ask_user_questions',
            success: false,
            summary: '当前界面不支持阻塞式追问卡片',
            cardHtml: '',
            contextText: '当前前端未挂载 ask_user_questions 交互宿主，请改为在正文中简要询问用户。',
          };
        }

        const resp = await ctx.requestUserQuestions({ title, questions });
        if (resp.status === 'skipped') {
          return {
            toolName: 'ask_user_questions',
            command: 'ask_user_questions',
            success: true,
            summary: '用户已跳过追问，采用合理默认推进',
            cardHtml: '',
            contextText: '用户选择跳过本次提问，请直接采用各题的推荐默认选项继续推进。',
          };
        }

        return {
          toolName: 'ask_user_questions',
          command: 'ask_user_questions',
          success: true,
          summary: `用户已确认 ${questions.length} 项决策`,
          cardHtml: '',
          contextText: `【用户明确回复的选择结果】:\n${JSON.stringify(resp.answers, null, 2)}`,
        };
      },
    });
  },
};
