import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ZipArchive } from '../../src/core/book-formats/zip-reader.ts';
import { harmonizeEpubCss } from '../../src/core/book-formats/css-harmonizer.ts';
import { EpubFormatAdapter } from '../../src/core/book-formats/epub-adapter.ts';
import { bookFormatRegistry } from '../../src/core/book-formats/registry.ts';
import { validateInstallPayload } from '../../src/services/content-provider/install-validation.ts';

const SAMPLE_EPUB_PATH = path.resolve(
  __dirname,
  '../../task/某暗部的少女共栖4.epub'
);

describe('EPUB Adapter & CSS Harmonizer Unit Tests', () => {
  it('harmonizeEpubCss 应隔离选择器作用域、命名空间字体且不泄漏到壳层或误染黑白中性纸色', () => {
    const css = `
      @font-face {
        font-family: "CustomKai";
        src: url("../fonts/kai.woff2") format("woff2");
      }
      html, body {
        color: #111111;
        background-color: #ffffff;
        line-height: 1.75;
      }
      .chapter-accent {
        color: #c83232;
        font-family: "CustomKai", serif;
        text-indent: 2em;
      }
    `;

    const res = harmonizeEpubCss({
      cssText: css,
      cssRelPath: 'styles/book.css',
      assetUrlPrefix: '/collections/acg/sample-book/assets/',
      fontNamespace: 'ep_test1234',
    });

    expect(res.hasEmbeddedFonts).toBe(true);
    expect(res.fontFamilies).toContain('CustomKai');
    expect(res.scopedCss).toContain('font-family: "ep_test1234__CustomKai"');
    expect(res.scopedCss).toContain('url("/collections/acg/sample-book/assets/fonts/kai.woff2")');

    // 验证多前缀笛卡尔积：不会生成不带 html[data-style-mode="..."] .astrolib-book-scope 前缀的裸选择器
    expect(res.scopedCss).toContain(
      'html[data-style-mode="original"] .astrolib-book-scope .chapter-accent'
    );
    expect(res.scopedCss).toContain(
      'html[data-style-mode="harmonized"][data-use-book-fonts="true"] .astrolib-book-scope .chapter-accent'
    );

    // 结构排版保留
    expect(res.scopedCss).toContain('text-indent: 2em');
    expect(res.scopedCss).toContain('line-height: 1.75');

    // harmonized 亮色模式映射主题色而不输出纯黑白中性底色/文字硬编码
    expect(res.scopedCss).toContain('var(--md-sys-color-primary');
    const harmonizedLightBlockMatch = res.scopedCss.match(
      /html\[data-style-mode="harmonized"\]:not\(\[data-theme="dark"\]\) \.astrolib-book-scope \.astrolib-epub-body\s*\{[\s\S]*?\}/
    );
    expect(harmonizedLightBlockMatch).toBeNull();
  });

  it('bookFormatRegistry 能通过文件名或魔数识别 EPUB 与 ABP', async () => {
    const adapter = bookFormatRegistry.resolveAdapter('book.epub');
    expect(adapter?.format).toBe('epub');

    if (fs.existsSync(SAMPLE_EPUB_PATH)) {
      const bytes = new Uint8Array(fs.readFileSync(SAMPLE_EPUB_PATH));
      const zip = ZipArchive.fromBytes(bytes);
      expect(zip.hasEntry('META-INF/container.xml')).toBe(true);

      const byMagic = bookFormatRegistry.resolveAdapter('unknown.bin', bytes);
      expect(byMagic?.format).toBe('epub');
    }
  });

  it('能完整归一化真实 EPUB《某暗部的少女共栖4.epub》并通过官方 ABP 安全与架构门禁', async () => {
    expect(fs.existsSync(SAMPLE_EPUB_PATH)).toBe(true);

    const bytes = new Uint8Array(fs.readFileSync(SAMPLE_EPUB_PATH));
    const adapter = new EpubFormatAdapter();
    const result = await adapter.normalize(bytes, {
      fileName: '某暗部的少女共栖4.epub',
    });

    const { bundle, sourceFormat, sourceArchive } = result;
    expect(sourceFormat).toBe('epub');
    expect(sourceArchive?.fileName).toBe('original.epub');
    expect(sourceArchive?.bytes.byteLength).toBe(bytes.byteLength);

    // 核心架构门禁校验
    expect(() => validateInstallPayload(bundle)).not.toThrow();

    const { manifest, chapters, assets, aiIndex } = bundle;
    expect(manifest.sourceFormat).toBe('epub');
    expect(manifest.readingProfile).toBe('literary');
    expect(manifest.totalChapters).toBe(21);
    expect(manifest.hasEmbeddedFonts).toBe(true);
    expect(manifest.stylesheets).toContain('styles/epub-book.css');
    expect(Object.keys(chapters).length).toBe(21);
    expect(assets?.['styles/epub-book.css']).toBeDefined();

    // 验证自包含 AI 索引切片非空
    expect(aiIndex).toBeDefined();
    const aiChunks = (aiIndex as { chunks?: unknown[] } | undefined)?.chunks;
    expect(Array.isArray(aiChunks)).toBe(true);
    expect((aiChunks || []).length).toBeGreaterThan(20);

    // 验证跨文件 EPUB 3 脚注提取与正文标记注入
    expect(manifest.footnotes).toBeDefined();
    expect(manifest.footnotes?.note0301).toBeDefined();
    expect(manifest.footnotes?.note0301?.text.length).toBeGreaterThan(2);

    const chaptersWithFootnotes = Object.values(chapters).filter(
      (c) => c.footnotes && Object.keys(c.footnotes).length > 0
    );
    expect(chaptersWithFootnotes.length).toBeGreaterThan(0);
    expect(chaptersWithFootnotes[0].html).toContain('data-astrolib-footnote=');

    // 验证 NAV 子锚点（如 #toc-1）完整提取进章节 headings，供右侧大纲展示
    const tocSubChapter = Object.values(chapters).find((c) =>
      c.headings.some((h) => h.id === 'toc-1')
    );
    expect(tocSubChapter).toBeDefined();
  });
});
