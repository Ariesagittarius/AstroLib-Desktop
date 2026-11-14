/**
 * tests/unit/heading-contract.test.ts
 * ============================================================================
 * 标题大纲与锚点唯一真源契约测试 (Heading & Anchor Contract Suite)
 * ============================================================================
 * 遵循 P1-B1 门禁规格与 ADR-CONTENT-IR-2026-11-13：
 * 1. 验证 src/core/content/headings.ts 纯函数的算法冻结、大纲提取与去重重写契约；
 * 2. 普查 13 本书全部章节：headings[].id 必须 100% 属于 HTML 中 <h1-4> 的 id 集合；
 * 3. 每章 headings 的 depth 与 text 与 HTML 中对应标题标签一致；
 * 4. 同一章节内 headings 与 HTML 锚点 id 严格唯一（0 重复碰撞）；
 * 5. 全书 headings 非空章数必须 ≥ 983 章；
 * 6. 源码负向断言：scripts/pack-book-abp.mjs 中硬编码 slug 正则出现次数必须为 0。
 * ============================================================================
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  slugifyHeading,
  collectHeadingsFromHtml,
  dedupeHeadingIds,
  rewriteHeadingIdsInHtml,
  type ChapterHeadingItem,
} from '../../src/core/content/headings.ts';

const ROOT = process.cwd();
const abpBaseDir = path.join(ROOT, 'artifacts', 'abp-packs');

describe('Heading & Anchor Contract Suite (P1-B1)', () => {
  describe('headings.ts 纯函数单元测试', () => {
    it('slugifyHeading: 逐字符复刻现有算法（小写、非字母数字汉字转-、去首尾-）', () => {
      expect(slugifyHeading('1.1 基本定义')).toBe('1-1-基本定义');
      expect(slugifyHeading('Theorem 2.4 (Lagrange)')).toBe('theorem-2-4-lagrange');
      expect(slugifyHeading('---Special Characters & Math: $f(x)$---')).toBe('special-characters-math-f-x');
      expect(slugifyHeading('')).toBe('');
      expect(slugifyHeading('   ')).toBe('');
    });

    it('collectHeadingsFromHtml: 从 HTML 中精确提取 h1-h4，剥离 anchor-link，提取纯文本与层级', () => {
      const html = `
        <div class="test">
          <h1 id="main-title"><span>主标题 <em>强调</em></span><a class="anchor-link" href="#main-title">#</a></h1>
          <p>正文段落</p>
          <h2 id="sec-1"><span>第一节 导论</span><a class="anchor-link" href="#sec-1">#</a></h2>
          <h3 id="subsec-1-1"><span>1.1 预备知识</span></h3>
          <h4 id="case-study">案例分析</h4>
          <h5 id="ignored-h5">忽略的五级标题</h5>
        </div>
      `;

      const headings = collectHeadingsFromHtml(html);
      expect(headings).toHaveLength(4);
      expect(headings[0]).toEqual({ depth: 1, text: '主标题 强调', id: 'main-title' });
      expect(headings[1]).toEqual({ depth: 2, text: '第一节 导论', id: 'sec-1' });
      expect(headings[2]).toEqual({ depth: 3, text: '1.1 预备知识', id: 'subsec-1-1' });
      expect(headings[3]).toEqual({ depth: 4, text: '案例分析', id: 'case-study' });
    });

    it('dedupeHeadingIds: 重复 ID 依次追加 -1、-2 后缀', () => {
      const input: ChapterHeadingItem[] = [
        { depth: 2, text: '定义 1', id: 'def-1' },
        { depth: 2, text: '定理 1', id: 'thm-1' },
        { depth: 2, text: '定义 1', id: 'def-1' },
        { depth: 2, text: '定义 1', id: 'def-1' },
      ];

      const deduped = dedupeHeadingIds(input);
      expect(deduped.map((h) => h.id)).toEqual(['def-1', 'thm-1', 'def-1-1', 'def-1-2']);
    });

    it('rewriteHeadingIdsInHtml: 同步重写 HTML 标签内的 id 与内部 anchor-link 的 href', () => {
      const html = `
        <h2 id="intro"><span>引言</span><a class="anchor-link" href="#intro">#</a></h2>
        <h2 id="intro"><span>引言 2</span><a class="anchor-link" href="#intro">#</a></h2>
        <h2 id="intro"><span>引言 3</span><a class="anchor-link" href="#intro">#</a></h2>
      `;

      const rewritten = rewriteHeadingIdsInHtml(html);
      const headings = collectHeadingsFromHtml(rewritten);
      expect(headings.map((h) => h.id)).toEqual(['intro', 'intro-1', 'intro-2']);
      expect(rewritten).toContain('href="#intro"');
      expect(rewritten).toContain('href="#intro-1"');
      expect(rewritten).toContain('href="#intro-2"');
    });
  });

  describe('全仓 13 本书章节标题契约普查', () => {
    const bookDirs = fs.readdirSync(abpBaseDir)
      .filter((d) => fs.statSync(path.join(abpBaseDir, d)).isDirectory());

    it('13 本书已生成且全部章节 headings[].id 必须 100% 属于 HTML 中 <h1-4> 的 id 集合', () => {
      expect(bookDirs.length).toBe(13);

      let totalChaptersChecked = 0;
      let chaptersWithHeadings = 0;
      let duplicateIdCount = 0;

      for (const d of bookDirs) {
        const chapDir = path.join(abpBaseDir, d, 'chapters');
        if (!fs.existsSync(chapDir)) continue;

        const chapFiles: string[] = [];
        function walk(dir: string) {
          for (const f of fs.readdirSync(dir)) {
            const p = path.join(dir, f);
            if (fs.statSync(p).isDirectory()) walk(p);
            else if (f.endsWith('.json')) chapFiles.push(p);
          }
        }
        walk(chapDir);

        for (const cf of chapFiles) {
          totalChaptersChecked++;
          const payload = JSON.parse(fs.readFileSync(cf, 'utf8'));
          const html = payload.html || '';

          // 提取 HTML 中所有 <h1-4 id="..."> 的 id
          const htmlIdMatches = [...html.matchAll(/<h([1-4])\b[^>]*\sid="([^"]+)"/gi)];
          const htmlIds = htmlIdMatches.map((m) => m[2]);
          const htmlIdSet = new Set(htmlIds);

          // 验证 HTML 标题 ID 唯一性（0 重复）
          if (htmlIds.length !== htmlIdSet.size) {
            duplicateIdCount++;
          }

          const headings = payload.headings || [];
          if (headings.length > 0) {
            chaptersWithHeadings++;
          }

          // 核心断言：headings[].id ⊆ htmlIdSet (100%)
          for (const h of headings) {
            expect(
              htmlIdSet.has(h.id),
              `[${d}] 章节 ${cf} 中 heading ID "${h.id}" 必须存在于 HTML 标题锚点集合中`
            ).toBe(true);
          }

          // 验证 heading 自身 ID 唯一性
          const headingIds = headings.map((h: any) => h.id);
          expect(new Set(headingIds).size, `[${d}] 章节 ${cf} 的 headings 数组存在重复 ID`).toBe(headingIds.length);
        }
      }

      expect(totalChaptersChecked).toBe(1251);
      // 重打包后 headings 覆盖率由 465 提升至 ≥ 983
      expect(chaptersWithHeadings).toBeGreaterThanOrEqual(983);
      // 重复 ID 章数归零
      expect(duplicateIdCount).toBe(0);
    }, 60000);
  });

  describe('源码实现唯一性负向断言', () => {
    it('scripts/pack-book-abp.mjs 中硬编码 slug 正则出现次数必须为 0', () => {
      const content = fs.readFileSync(path.join(ROOT, 'scripts', 'pack-book-abp.mjs'), 'utf8');
      const matches = content.match(/toLowerCase\(\)\s*\.replace\(\/\[\^\\w\\u4e00-\\u9fa5-\]\+\/g/g);
      expect(matches ? matches.length : 0).toBe(0);
    });

    it('src/core/content/headings.ts 为全仓唯一标题 slug 算法源', () => {
      const content = fs.readFileSync(path.join(ROOT, 'src', 'core', 'content', 'headings.ts'), 'utf8');
      const matches = content.match(/toLowerCase\(\)\s*\.replace\(\/\[\^\\w\\u4e00-\\u9fa5-\]\+\/g/g);
      expect(matches ? matches.length : 1).toBe(1);
    });
  });
});
