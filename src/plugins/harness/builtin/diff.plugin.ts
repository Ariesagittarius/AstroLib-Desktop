/**
 * src/plugins/harness/builtin/diff.plugin.ts
 * ============================================================================
 * AstroLib 章节与文本 Unified Diff 比对插件 (/diff & compare_chapters)
 * ============================================================================
 */

import type { HarnessPlugin, PluginContext } from '../types.ts';
import { UniversalLocatorResolver } from '../../../core/content-api/content-locator.ts';

function escapeHtml(str: string): string {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const DiffPlugin: HarnessPlugin = {
  id: 'astrolib.builtin.diff',
  name: '章节与源码比对插件',
  version: '1.2.0',
  description: '比对两章节或两段源码的 Unified Diff 差异，并在右侧成果物中以 Diff2Html 渲染。',
  sourceFile: 'src/plugins/harness/builtin/diff.plugin.ts',
  activate: (context: PluginContext) => {
    context.registerCommand({
      command: '/diff',
      aliases: ['/compare'],
      displayName: '章节源码差异比对',
      description: '比对两个章节的内容、公式与学术卡片差异，生成 Unified Diff 补丁并在右侧成果物呈现。',
      usage: '<章节1> <章节2>',
      icon: { type: 'mdicon', value: 'difference' },
      suggest: () => {
        return [
          {
            id: 'diff-11-12',
            title: '比对 1.1 与 1.2 节差异',
            subtitle: '11_二三阶行列式 vs 12_n阶行列式',
            badge: 'Diff',
            icon: { type: 'mdicon', value: 'difference' },
            fillCommand: '/diff 11_二三阶行列式 12_n阶行列式',
          },
          {
            id: 'diff-21-22',
            title: '比对数分 2.1 与 2.2 节差异',
            subtitle: '21_数列极限的基本概念 vs 22_收敛数列的基本性质',
            badge: 'Diff',
            icon: { type: 'mdicon', value: 'difference' },
            fillCommand: '/diff 21_数列极限的基本概念 22_收敛数列的基本性质',
          },
        ];
      },
      execute: async (args, ctx) => {
        const parts = (args || '').trim().split(/\s+/).filter(Boolean);
        const q1 = parts[0] || '11_二三阶行列式';
        const q2 = parts[1] || '12_n阶行列式';

        const loc1 = UniversalLocatorResolver.resolve(q1, ctx.books, ctx.chapters as any);
        const loc2 = UniversalLocatorResolver.resolve(q2, ctx.books, ctx.chapters as any);

        const colSlug1 = loc1.colSlug;
        const bookSlug1 = loc1.bookSlug;
        const slug1 = loc1.chapterSlug || q1;

        const colSlug2 = loc2.colSlug;
        const bookSlug2 = loc2.bookSlug;
        const slug2 = loc2.chapterSlug || q2;

        try {
          const fetcher = ctx.fetchFn || fetch;
          const res = await fetcher('/api/v1/content/diff', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              colSlug1,
              bookSlug1,
              slug1,
              colSlug2,
              bookSlug2,
              slug2,
            }),
          });
          const json = await res.json();
          if (!res.ok || json.success === false) {
            throw new Error(json.error || `HTTP ${res.status}`);
          }
          const patch = json.patch || '';
          const stats = json.stats || { additions: 0, deletions: 0 };

          return {
            toolName: 'compare_chapters',
            command: `/diff ${slug1} ${slug2}`,
            success: true,
            summary: `已比对 ${slug1} 与 ${slug2} (+${stats.additions} / -${stats.deletions})`,
            cardHtml: `
              <div style="font-size: 0.9rem; line-height: 1.6;">
                已生成 <code>${escapeHtml(slug1)}</code> 与 <code>${escapeHtml(slug2)}</code> 的 Unified Diff（新增 +${stats.additions} / 删除 -${stats.deletions} 行），并在右侧「成果物」中展开逐行对比视图。
              </div>
            `,
            contextText: `【章节对比 Unified Diff (${slug1} vs ${slug2})】:\n新增行: +${stats.additions}, 删除行: -${stats.deletions}\n补丁摘要:\n${patch.slice(0, 1200)}`,
            artifact: {
              id: `diff:${slug1}:${slug2}`,
              kind: 'diff',
              title: `差异比对 · ${slug1} vs ${slug2}`,
              badge: `+${stats.additions} / -${stats.deletions}`,
              patch,
              diffStats: stats,
            },
            sideEffectTab: 'artifacts',
          };
        } catch (err: any) {
          return {
            toolName: 'compare_chapters',
            command: `/diff ${slug1} ${slug2}`,
            success: false,
            summary: `比对失败: ${err.message}`,
            cardHtml: `<div class="harness-tool-card"><div class="harness-tool-card__body" style="color: var(--md-sys-color-error, #ef4444);">比对失败: ${escapeHtml(err.message)}</div></div>`,
            contextText: `比对失败: ${err.message}`,
          };
        }
      },
    });

    context.registerTool({
      name: 'compare_chapters',
      displayName: '比对章节或文本差异',
      category: '开发与校验',
      icon: { type: 'mdicon', value: 'difference' },
      sourceFile: 'src/plugins/harness/builtin/diff.plugin.ts',
      riskLevel: 'read',
      exposeAsSlashCommand: '/diff',
      formatActionLabel: (args) => {
        if (args.text1 !== undefined && args.text2 !== undefined) {
          return '比对两段文本源码差异';
        }
        const a = args.slug1 || '章节 1';
        const b = args.slug2 || '章节 2';
        return `比对章节差异 · ${a} 与 ${b}`;
      },
      description: '比对两个章节（或两段文本）的源码与公式差异，生成 Unified Diff 并写入右侧成果物供可视化审查。',
      parameters: {
        type: 'object',
        properties: {
          slug1: {
            type: 'string',
            description: '第 1 个章节的 slug 或 URI',
          },
          slug2: {
            type: 'string',
            description: '第 2 个章节的 slug 或 URI',
          },
          text1: {
            type: 'string',
            description: '可选：直接比对的第一段文本（提供 text1/text2 时不再查章节）',
          },
          text2: {
            type: 'string',
            description: '可选：直接比对的第二段文本',
          },
          label1: { type: 'string', description: '可选：文本 1 标签' },
          label2: { type: 'string', description: '可选：文本 2 标签' },
        },
        required: [],
      },
      execute: async (args, ctx) => {
        const fetcher = ctx.fetchFn || fetch;
        const isRawText = typeof args.text1 === 'string' && typeof args.text2 === 'string';

        if (isRawText) {
          const res = await fetcher('/api/v1/content/diff', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text1: args.text1,
              text2: args.text2,
              label1: args.label1 || 'Before',
              label2: args.label2 || 'After',
            }),
          });
          const json = await res.json();
          const patch = json.patch || '';
          const stats = json.stats || { additions: 0, deletions: 0 };
          return {
            toolName: 'compare_chapters',
            command: '/diff text',
            success: Boolean(json.success),
            summary: `已完成文本差异比对 (+${stats.additions} / -${stats.deletions})`,
            cardHtml: `<div class="harness-tool-card"><div class="harness-tool-card__body">已生成文本 Diff (+${stats.additions} / -${stats.deletions})。</div></div>`,
            contextText: `【Diff 比对结果】(+${stats.additions} / -${stats.deletions}):\n${patch.slice(0, 1500)}`,
            artifact: {
              kind: 'diff',
              title: `文本比对 · ${args.label1 || 'Before'} vs ${args.label2 || 'After'}`,
              badge: `+${stats.additions} / -${stats.deletions}`,
              patch,
              diffStats: stats,
            },
          };
        }

        const q1 = args.slug1 || '11_二三阶行列式';
        const q2 = args.slug2 || '12_n阶行列式';

        const loc1 = UniversalLocatorResolver.resolve(q1, ctx.books, ctx.chapters as any);
        const loc2 = UniversalLocatorResolver.resolve(q2, ctx.books, ctx.chapters as any);

        const slug1 = loc1.chapterSlug || q1;
        const slug2 = loc2.chapterSlug || q2;

        const res = await fetcher('/api/v1/content/diff', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            colSlug1: loc1.colSlug,
            bookSlug1: loc1.bookSlug,
            slug1,
            colSlug2: loc2.colSlug,
            bookSlug2: loc2.bookSlug,
            slug2,
          }),
        });
        const json = await res.json();
        const patch = json.patch || '';
        const stats = json.stats || { additions: 0, deletions: 0 };

        return {
          toolName: 'compare_chapters',
          command: `/diff ${slug1} ${slug2}`,
          success: true,
          summary: `已比对 ${slug1} 与 ${slug2} (+${stats.additions} / -${stats.deletions})`,
          cardHtml: `<div class="harness-tool-card"><div class="harness-tool-card__body">已完成差异比对 (+${stats.additions} / -${stats.deletions})。</div></div>`,
          contextText: `【Diff 比对完成】(+${stats.additions} / -${stats.deletions}):\n${patch.slice(0, 1500)}`,
          artifact: {
            id: `diff:${slug1}:${slug2}`,
            kind: 'diff',
            title: `差异比对 · ${slug1} vs ${slug2}`,
            badge: `+${stats.additions} / -${stats.deletions}`,
            patch,
            diffStats: stats,
          },
        };
      },
    });
  },
};
