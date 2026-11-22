/**
 * tests/unit/harness-astro-blocks.test.ts
 * ============================================================================
 * Track A: AstroBlocks (` ```astro-ui ` 协议编译器) 与 Markdown 集成单元测试
 * ============================================================================
 */

import { describe, it, expect } from 'vitest';
import { renderAstroUiBlock } from '../../src/features/harness/astro-blocks.ts';
import { mdToHtml } from '../../src/ai/client/chat-markdown.ts';

describe('Harness Track A: AstroBlocks Declarative UI Engine', () => {
  it('1. 应正确渲染 8 类声明式原语 (card / metrics / steps / checklist / compare / tabs / callout / grid)', () => {
    const payload = {
      type: 'grid',
      columns: 2,
      font: 'serif',
      tone: 'primary',
      density: 'compact',
      blocks: [
        {
          type: 'card',
          badge: '核心定理',
          eyebrow: 'Carlini et al. 2021',
          title: '模型记忆隐私风险',
          subtitle: 'USENIX Security · p.2633',
          body: '证明了大规模语言模型对训练样本的**逐字记忆**效应。',
          bulletsLabel: '关键结论',
          bullets: ['成员推断可恢复隐私文本', '去重可缓解过拟合'],
          actions: [{ label: '查看目录', command: '/toc math_analysis' }],
        },
        {
          type: 'metrics',
          sections: [
            {
              title: '样本统计对比',
              subtitle: 'Survey 2025',
              items: [
                { value: '92%', label: '使用率', tone: 'success', note: '较去年 +26%' },
                { value: '63%', label: '待治理比例', tone: 'warning' },
              ],
              source: 'HEPI 调查报告',
              meaning: '说明生成式工具已成高频学习基础设施。',
              links: [{ label: '原章定位', url: 'astrolib://math/math_analysis/00_intro' }],
            },
          ],
        },
        {
          type: 'steps',
          title: '证明路线图',
          items: [
            { title: '构造辅助函数', caption: 'Step 1', body: '引入 $\\varphi(x) = f(x) - f(a)$。' },
            { title: '应用 Rolle 定理', body: '存在 $\\xi \\in (a, b)$ 使导数为零。' },
          ],
        },
        {
          type: 'checklist',
          title: '考前核对清单',
          groups: [
            {
              label: '必背公式',
              items: [
                { id: 'c1', text: 'Stokes 公式', checked: true },
                { id: 'c2', text: 'Gauss 散度公式', checked: false },
              ],
            },
            {
              label: '易错点',
              items: [{ id: 'c3', text: '曲面的定向方向与法向量符号' }],
            },
          ],
        },
        {
          type: 'compare',
          title: '定义对比',
          columns: [
            { title: 'Cauchy 收敛准则', badge: '充要', items: ['无需预先知道极限值', '完备性等价'] },
            { title: '单调有界原理', items: ['仅适用实数域单调序列', '构造成立捷径'] },
          ],
        },
        {
          type: 'tabs',
          items: [
            { label: '直观解释', body: '局部线性逼近的几何切平面。' },
            { label: '严格证明', blocks: [{ type: 'callout', title: '注记', body: '依赖 Heine-Borel 有限覆盖。' }] },
          ],
        },
        {
          type: 'callout',
          tone: 'warning',
          title: '边界条件提醒',
          body: '奇点处需挖去 $\\varepsilon$-邻域单独估计积分。',
        },
      ],
    };

    const res = renderAstroUiBlock(JSON.stringify(payload));
    expect(res.ok).toBe(true);
    expect(res.html).toContain('astro-ui-grid');
    expect(res.html).toContain('astro-ui-font-serif');
    expect(res.html).toContain('astro-ui-density-compact');
    expect(res.html).toContain('astro-ui-card__title');
    expect(res.html).toContain('astro-ui-metrics-card');
    expect(res.html).toContain('astro-ui-metric-val');
    expect(res.html).toContain('astro-ui-step-list');
    expect(res.html).toContain('astro-ui-checklist');
    expect(res.html).toContain('astro-ui-compare-grid');
    expect(res.html).toContain('astro-ui-tabs');
    expect(res.html).toContain('astro-ui-callout');
    expect(res.html).toContain('data-astrolib-uri="astrolib://math/math_analysis/00_intro"');
  });

  it('2. 流式生成未闭合 ```astro-ui 块时应返回骨架占位符而不崩溃或吐出裸 JSON', () => {
    const res = renderAstroUiBlock('{"type":"card","title":"正在生成', { isClosed: false });
    expect(res.ok).toBe(true);
    expect(res.html).toContain('astro-ui-skeleton');
    expect(res.html).not.toContain('"type":"card"');

    const mdHtml = mdToHtml('下面整理要点：\n\n```astro-ui\n{"type":"metrics","sections":[{"title":"');
    expect(mdHtml).toContain('astro-ui-skeleton');
    expect(mdHtml).not.toContain('{"type":"metrics"');
  });

  it('3. 应容错末尾多余逗号并拦截 XSS 注入脚本', () => {
    const relaxedJson = `{
      "type": "card",
      "title": "<script>alert(1)</script>线性相关性",
      "body": "<img src=x onerror=alert(2)>检查方程组零解",
      "actions": [{ "label": "危险跳转", "url": "javascript:alert(3)" },],
    }`;
    const res = renderAstroUiBlock(relaxedJson);
    expect(res.ok).toBe(true);
    expect(res.html).not.toContain('<script>');
    expect(res.html).not.toContain('<img src=x');
    expect(res.html).not.toContain('javascript:alert');
    expect(res.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('4. mdToHtml 应识别闭合的 ```astro-ui 与 ```ui 围栏并保留数学公式语法', () => {
    const md = [
      '导论如下：',
      '',
      '```astro-ui',
      '{"type":"callout","tone":"primary","title":"Green 公式","body":"设闭合曲线正方向满足 $\\\\oint_{\\\\partial D} P\\\\,dx + Q\\\\,dy$。"}',
      '```',
    ].join('\n');

    const html = mdToHtml(md);
    expect(html).toContain('class="astro-ui-root"');
    expect(html).toContain('astro-ui-callout');
    expect(html).toContain('$\\oint_{\\partial D} P\\,dx + Q\\,dy$');
  });
});
