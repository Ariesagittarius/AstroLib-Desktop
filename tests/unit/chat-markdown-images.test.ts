import { describe, it, expect } from 'vitest';
import { mdToHtml, safeImageUrl } from '../../src/ai/client/chat-markdown.ts';
import { renderAstroUiBlock } from '../../src/features/harness/astro-blocks.ts';

describe('Markdown 图像安全渲染与 Astro-UI 容错解析测试', () => {
  it('1. 独占一行 ![alt](relPath) 自动路由至沙箱 workspace-file 端点并升格为 figure', () => {
    const html = mdToHtml('![正弦波仿真](sin_v2_820x500.png)');
    expect(html).toContain('<figure class="harness-md-figure">');
    expect(html).toContain('<img class="harness-md-img"');
    expect(html).toContain('src="/api/v1/content/agent-tools/workspace-file?path=sin_v2_820x500.png"');
    expect(html).toContain('<figcaption>正弦波仿真</figcaption>');
  });

  it('2. 支持文献插图 URL 与行内图像且不退化为 <a> 链接', () => {
    const md = '实验结构见 ![架构图](/api/ingest/image?taskId=t123&name=fig1.png) 所示。';
    const html = mdToHtml(md);
    expect(html).not.toContain('<a ');
    expect(html).toContain('src="/api/ingest/image?taskId=t123&amp;name=fig1.png"');
  });

  it('3. SVG Base64 严格以 <img> 标签沙箱承载，危险 javascript: 协议严格拦截', () => {
    const svgB64 = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=';
    const html = mdToHtml(`![矢量](${svgB64})`);
    expect(html).toContain('<img ');
    expect(html).not.toContain('<svg>');

    expect(safeImageUrl('javascript:alert(1)')).toBe('');
    expect(safeImageUrl('data:text/html;base64,PHNjcmlwdD4=')).toBe('');
    const xss = mdToHtml('![evil](javascript:alert(1))');
    expect(xss).not.toContain('<img');
  });

  it('4. Astro-UI 块容错恢复字符串内未转义换行与尾逗号', () => {
    const malformedJson = `{
      "type": "callout",
      "title": "校验说明",
      "tone": "primary",
      "body": "第一行说明
第二行说明",
    }`;
    const rendered = renderAstroUiBlock(malformedJson, { isClosed: true });
    expect(rendered.ok).toBe(true);
    expect(rendered.html).toContain('astro-ui-callout');
    expect(rendered.html).toContain('第一行说明');
  });
});
