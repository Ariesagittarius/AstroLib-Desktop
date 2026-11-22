import { describe, it, expect } from 'vitest';
import {
  buildSandboxedCanvasHtml,
  CANVAS_THEME_VAR_NAMES,
} from '../../src/features/harness/canvas-sandbox.ts';

describe('Canvas 沙箱闭环安全契约与资产注入测试', () => {
  it('1. 注入严格离线 CSP、Electron 字体体系、本地 KaTeX/mhchem/auto-render 与遥测探针', () => {
    const html = buildSandboxedCanvasHtml(
      '<div>\\ce{H2O} 与 $e^{i\\pi}+1=0$</div>',
      '物理化学公式演示',
      {
        artifactId: 'canvas-test-1',
        baseOrigin: 'http://127.0.0.1:62960',
      }
    );

    expect(html).toContain('http-equiv="Content-Security-Policy"');
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain('http://127.0.0.1:62960');
    expect(html).toContain('--astrolib-canvas-sans');
    expect(html).toContain('--astrolib-canvas-mono');

    const idxCss = html.indexOf('/api/v1/content/annotations/katex.css');
    const idxKatex = html.indexOf('/api/v1/content/annotations/katex.min.js');
    const idxMhchem = html.indexOf('/api/v1/content/annotations/katex-mhchem.min.js');
    const idxAuto = html.indexOf('/api/v1/content/annotations/katex-auto-render.min.js');
    expect(idxCss).toBeGreaterThan(-1);
    expect(idxKatex).toBeGreaterThan(idxCss);
    expect(idxMhchem).toBeGreaterThan(idxKatex);
    expect(idxAuto).toBeGreaterThan(idxMhchem);

    expect(html).toContain('__collectAstrolibCanvasTelemetry');
    expect(html).toContain('ASTROLIB_CANVAS_TELEMETRY');
    expect(html).toContain('canvas-test-1');
    expect(html).toContain('\\ce{H2O}');
  });

  it('2. 兼容完整 <!doctype html> 文档与裸 <svg> 画布封装且不丢失头部注入', () => {
    const fullDoc = '<!doctype html><html><head></head><body><h1>Hello</h1></body></html>';
    const outDoc = buildSandboxedCanvasHtml(fullDoc, 'Full', { artifactId: 'c-full' });
    expect(outDoc).toContain('__ASTROLIB_CANVAS__');
    expect(outDoc).toContain('<h1>Hello</h1>');

    const svgDoc = '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="20"/></svg>';
    const outSvg = buildSandboxedCanvasHtml(svgDoc, 'SVG', { artifactId: 'c-svg' });
    expect(outSvg).toContain('<circle');
    expect(outSvg).toContain("connect-src 'none'");
    expect(CANVAS_THEME_VAR_NAMES).toContain('--md-sys-color-primary');
    expect(CANVAS_THEME_VAR_NAMES).toContain('--harness-font-family');
  });
});
