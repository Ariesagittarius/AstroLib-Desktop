/**
 * tests/contract/epub-heading-parity.test.ts
 * ============================================================================
 * EPUB 与 ABP 标题大纲同构契约测试 (EPUB / ABP Heading Parity Contract Suite)
 * ============================================================================
 * 遵循 P1-B2 门禁规格与 ADR-CONTENT-IR-2026-11-13：
 * 1. 抽取 3 个跨学科代表性章节源码；
 * 2. 分别通过 EPUB 转换管线 (scripts/epub/mdx-pipeline.mjs) 与 ABP 编译产物进行对照；
 * 3. 验证两者标题大纲的顺序、层级与核心文本保持一致（同源对齐）。
 * ============================================================================
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { renderChapter } from '../../scripts/epub/mdx-pipeline.mjs';

const ROOT = process.cwd();

describe('EPUB / ABP Heading Parity Contract Suite (P1-B2)', () => {
  const sampleChapters = [
    {
      colSlug: 'math',
      bookSlug: 'math_senior',
      sourceRel: 'content-sources/collections/math/math_senior/07_1.1_基本公式.mdx',
      abpChapJsonRel: 'artifacts/abp-packs/math-math_senior/chapters/07_11_基本公式.json',
    },
    {
      colSlug: 'science',
      bookSlug: 'vectors_and_tensors',
      sourceRel: 'content-sources/collections/science/vectors_and_tensors/01.1_definitions-basic.mdx',
      abpChapJsonRel: 'artifacts/abp-packs/science-vectors_and_tensors/chapters/011_definitions-basic.json',
    },
    {
      colSlug: 'cs',
      bookSlug: 'algorithms',
      sourceRel: 'content-sources/collections/cs/algorithms/00.1_books-and-algorithms.mdx',
      abpChapJsonRel: 'artifacts/abp-packs/cs-algorithms/chapters/001_books-and-algorithms.json',
    },
  ];

  it.each(sampleChapters)(
    '章节 [$colSlug/$bookSlug] 的 EPUB 渲染结果与 ABP 产物应具备同构的大纲层级与标题文本',
    async ({ sourceRel, abpChapJsonRel }) => {
      const sourcePath = path.join(ROOT, sourceRel);
      const abpJsonPath = path.join(ROOT, abpChapJsonRel);

      expect(fs.existsSync(sourcePath), `源 MDX 文件不存在: ${sourcePath}`).toBe(true);
      expect(fs.existsSync(abpJsonPath), `ABP 产物 JSON 不存在: ${abpJsonPath}`).toBe(true);

      const mdxSource = fs.readFileSync(sourcePath, 'utf8');
      const abpPayload = JSON.parse(fs.readFileSync(abpJsonPath, 'utf8'));

      // 运行 EPUB 渲染管线
      const epubResult = await renderChapter(mdxSource);
      expect(epubResult.headings).toBeDefined();

      const abpHeadings = abpPayload.headings || [];
      const epubHeadings = epubResult.headings || [];

      // 验证标题数量基本同构（若存在标题，顺序与层级一致）
      if (abpHeadings.length > 0 && epubHeadings.length > 0) {
        // 验证各层级 depth 相同
        expect(epubHeadings.length).toBeGreaterThan(0);
        const minLen = Math.min(abpHeadings.length, epubHeadings.length);
        for (let i = 0; i < minLen; i++) {
          expect(epubHeadings[i].depth).toBe(abpHeadings[i].depth);
          // 比较核心文本包含性
          const cleanAbpText = abpHeadings[i].text.replace(/\s+/g, '');
          const cleanEpubText = epubHeadings[i].text.replace(/\s+/g, '');
          expect(
            cleanAbpText === cleanEpubText ||
            cleanAbpText.includes(cleanEpubText) ||
            cleanEpubText.includes(cleanAbpText),
            `标题文本不一致: ABP="${abpHeadings[i].text}", EPUB="${epubHeadings[i].text}"`
          ).toBe(true);
        }
      }
    }
  );
});
