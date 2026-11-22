/**
 * src/plugins/harness/builtin/exercises.plugin.ts
 * ============================================================================
 * AstroLib 习题与题解检索插件 (/exercises)
 * ============================================================================
 */

import type { HarnessPlugin, PluginContext } from '../types.ts';

function escapeHtml(str: string): string {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const ExercisesPlugin: HarnessPlugin = {
  id: 'astrolib.builtin.exercises',
  name: '习题与题解检索插件',
  version: '1.1.0',
  description: '提供全库课后习题、题干、选项与官方题解检索。',
  sourceFile: 'src/plugins/harness/builtin/exercises.plugin.ts',
  activate: (context: PluginContext) => {
    context.registerCommand({
      command: '/exercises',
      aliases: ['/problems', '/quiz'],
      displayName: '习题与题解检索',
      description: '在知识库习题中心检索与指定知识点、关键词或题型关联的课后习题与官方解答。',
      usage: '<检索关键词>',
      icon: { type: 'mdicon', value: 'quiz' },
      suggest: (query) => {
        const defaultQueries = ['行列式', '特征值', '向量空间', '导数与微分', '定积分', '二重积分', '傅里叶变换', '极限'];
        const q = (query || '').trim().toLowerCase();
        const filtered = q ? defaultQueries.filter((k) => k.includes(q)) : defaultQueries;
        return filtered.map((k) => ({
          id: k,
          title: `习题检索: "${k}"`,
          subtitle: `检索与 "${k}" 相关的精选题与官方解答`,
          badge: '习题',
          icon: { type: 'mdicon', value: 'quiz' },
          fillCommand: `/exercises ${k}`,
        }));
      },
      execute: async (args, ctx) => {
        const q = (args || '行列式').trim();
        try {
          const fetcher = ctx.fetchFn || fetch;
          const res = await fetcher(`/api/v1/content/exercises/search?q=${encodeURIComponent(q)}&limit=5`);
          const json = await res.json();
          const list = json.data || [];

          let exercisesHtml = '';
          const contextLines: string[] = [`【关联习题检索结果 (关键词: "${q}")】:`];

          for (const ex of list) {
            const qContent = ex.question || ex.stem || '暂无题干内容';
            contextLines.push(
              `- 习题 #${ex.id} (${ex.type || '题目'} · ${ex.difficulty || '难度适中'}): ${qContent.slice(0, 100)}...`
            );
            if (ex.answer) {
              contextLines.push(`  答案: ${ex.answer}`);
            }
            if (ex.solution) {
              contextLines.push(`  官方解答要点: ${ex.solution.slice(0, 120)}... ∎`);
            }
            exercisesHtml += `
              <div class="harness-exercise-card">
                <div class="harness-exercise-card__header">
                  <span class="harness-exercise-card__id">#${escapeHtml(String(ex.id))}</span>
                  <span style="font-size: 0.72rem; padding: 2px 8px; border-radius: 999px; background: var(--md-sys-color-surface-container, var(--harness-bg-surface-hover)); color: var(--harness-text-secondary);">${escapeHtml(ex.type || '题目')} · ${escapeHtml(ex.difficulty || '标准')}</span>
                </div>
                <div class="harness-exercise-card__stem">${escapeHtml(qContent)}</div>
                ${
                  ex.solution || ex.answer
                    ? `
                  <details class="harness-solution-details">
                    <summary>查看参考解答</summary>
                    <div class="harness-solution-body">
                      ${ex.answer ? `<div><strong>答案：</strong>${escapeHtml(ex.answer)}</div>` : ''}
                      ${ex.solution ? `<div style="margin-top:4px;">${escapeHtml(ex.solution)}</div>` : ''}
                      <span style="float: right;">∎</span>
                    </div>
                  </details>
                `
                    : ''
                }
              </div>
            `;
          }

          return {
            toolName: 'search_exercises',
            command: `/exercises ${q}`,
            success: true,
            summary: `已检索到 ${list.length} 道关联习题`,
            cardHtml: `
              <div style="font-size: 0.9rem; line-height: 1.6; margin: 4px 0 8px;">
                关于 <strong>"${escapeHtml(q)}"</strong> 的检索结果（共 ${list.length} 题）：
              </div>
              ${exercisesHtml || '<div style="color:var(--harness-text-secondary);font-size:0.86rem;">未检索到匹配习题，请尝试更换关键词。</div>'}
            `,
            contextText: contextLines.join('\n'),
            artifact: {
              id: `exercises:${q}`,
              kind: 'markdown',
              title: `习题检索 · "${q}"`,
              badge: `命中 ${list.length} 题`,
              html: exercisesHtml || '<p>未检索到匹配习题。</p>',
            },
            sideEffectTab: 'artifacts',
          };
        } catch (err: any) {
          return {
            toolName: 'search_exercises',
            command: `/exercises ${q}`,
            success: false,
            summary: `检索习题失败: ${err.message}`,
            cardHtml: `<div class="harness-tool-card"><div class="harness-tool-card__body" style="color: var(--md-sys-color-error, #ef4444);">检索习题失败: ${escapeHtml(err.message)}</div></div>`,
            contextText: `检索习题失败: ${err.message}`,
          };
        }
      },
    });

    context.registerTool({
      name: 'search_exercises',
      displayName: '检索习题与题解',
      category: '知识库检索',
      icon: { type: 'mdicon', value: 'quiz' },
      sourceFile: 'src/plugins/harness/builtin/exercises.plugin.ts',
      riskLevel: 'read',
      exposeAsSlashCommand: '/exercises',
      formatActionLabel: (args) => {
        const q = String(args.query || '').trim();
        return q ? `检索习题 · "${q}"` : '检索教材习题';
      },
      description: '在知识库习题中心检索与指定知识点、关键词或题型关联的课后习题与官方题解。对应用户指令 /exercises <query>。',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '检索关键词，例如 "行列式", "特征值", "极限", "傅里叶变换"',
          },
          limit: {
            type: 'number',
            description: '最大返回数量，默认 5 条',
          },
        },
        required: ['query'],
      },
      execute: async (args, ctx) => {
        const query = args.query || '行列式';
        const limit = args.limit || 5;
        const fetcher = ctx.fetchFn || fetch;
        const res = await fetcher(`/api/v1/content/exercises/search?q=${encodeURIComponent(query)}&limit=${limit}`);
        const json = await res.json();
        const list = json.data || [];

        return {
          toolName: 'search_exercises',
          command: `/exercises ${query}`,
          success: true,
          summary: `命中 ${list.length} 道习题`,
          cardHtml: `<div class="harness-tool-card"><div class="harness-tool-card__body">已检索 "${escapeHtml(query)}"，命中 ${list.length} 道习题。</div></div>`,
          contextText:
            `【习题检索结果】:\n` +
            list
              .map((e: any) => {
                const qText = (e.question || e.stem || '').slice(0, 120);
                const ans = e.answer || e.solution || '详见解析';
                return `#${e.id}: ${qText}... 答案: ${ans}`;
              })
              .join('\n'),
        };
      },
    });
  },
};
