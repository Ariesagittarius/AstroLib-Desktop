/**
 * src/core/content/headings.ts
 * ============================================================================
 * AstroLib 核心标题、锚点与大纲契约模块 (Single Source of Heading & Anchor Truth)
 * ============================================================================
 * 遵循 P1-B1 门禁规格与 ADR-CONTENT-IR-2026-11-13：
 * 1. 标题 slugify 算法保持绝对冻结（逐字符复刻，保障存量深链有效）；
 * 2. 以编译后最终 HTML 为唯一真源，反推结构化大纲（headings）；
 * 3. 同一章内重复 id 追加 -1/-2 碰撞后缀，并提供同步改写 HTML 锚点契约；
 * 4. 严禁 import 任何 UI 组件或浏览器专有依赖。
 * ============================================================================
 */

import type { ChapterHeadingItem } from '../../types/content-package.ts';

export type { ChapterHeadingItem };

/**
 * 规范化标题为锚点 Slug
 * 逐字符复刻现有算法：小写 + 非字母数字汉字连字符转 - + 去除首尾连字符
 */
export function slugifyHeading(plainText: string): string {
  if (!plainText) return '';
  return plainText
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * 从编译后的最终 HTML 中提取全部 H1-H4 标题项
 * 优先取 <span> 内文本；若无 <span> 则剥离 anchor-link 后提取纯文本
 */
export function collectHeadingsFromHtml(html: string): ChapterHeadingItem[] {
  if (!html) return [];
  const headings: ChapterHeadingItem[] = [];
  const headingRegex = /<h([1-4])\b[^>]*\sid="([^"]+)"[^>]*>([\s\S]*?)<\/h\1>/gi;

  let match: RegExpExecArray | null;
  while ((match = headingRegex.exec(html)) !== null) {
    const depth = parseInt(match[1], 10);
    const id = match[2];
    const rawInner = match[3];

    // 优先提取 <span> 内文本；若无 <span> 则剥离可能存在的 anchor-link
    let textContent = rawInner;
    const spanMatch = rawInner.match(/<span\b[^>]*>([\s\S]*?)<\/span>/i);
    if (spanMatch) {
      textContent = spanMatch[1];
    } else {
      textContent = textContent.replace(/<a\b[^>]*class="[^"]*anchor-link[^"]*"[^>]*>[\s\S]*?<\/a>/gi, '');
    }

    // 剥离所有 HTML 标签并清理空白
    const plainText = textContent.replace(/<[^>]+>/g, '').trim();

    headings.push({
      depth,
      text: plainText,
      id,
    });
  }

  return headings;
}

/**
 * 对单章节内的标题列表执行去重，重复 ID 依次追加 -1、-2 后缀
 */
export function dedupeHeadingIds(headings: ChapterHeadingItem[]): ChapterHeadingItem[] {
  const counts = new Map<string, number>();
  return headings.map((h) => {
    const baseId = h.id;
    const count = counts.get(baseId) || 0;
    counts.set(baseId, count + 1);

    if (count === 0) {
      return { ...h };
    }
    return {
      ...h,
      id: `${baseId}-${count}`,
    };
  });
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 同步改写 HTML 中重复标题的 id 以及内部 anchor-link 的 href 锚点
 * 保证 HTML 标签内的 id 与 dedupeHeadingIds 产出的结果严格绝对一致
 */
export function rewriteHeadingIdsInHtml(
  html: string,
  renames?: Array<{ from: string; to: string }> | Map<string, string>
): string {
  if (!html) return '';

  // 若传入显式重命名表（例如指定从原 id 到新 id 的映射）
  if (Array.isArray(renames) && renames.length > 0) {
    let result = html;
    for (const r of renames) {
      if (r.from !== r.to) {
        const idRegex = new RegExp(`(<h[1-4]\\b[^>]*\\sid=")${escapeRegex(r.from)}("[^>]*>)`, 'g');
        const hrefRegex = new RegExp(`(<a\\b[^>]*\\shref="#)${escapeRegex(r.from)}("[^>]*>)`, 'g');
        result = result.replace(idRegex, `$1${r.to}$2`).replace(hrefRegex, `$1${r.to}$2`);
      }
    }
    return result;
  }

  // 默认自包含流式去重重写：维护单篇 HTML 内部的 ID 计数器
  const counts = new Map<string, number>();
  return html.replace(
    /<h([1-4])\b([^>]*\sid="([^"]+)"[^>]*)>([\s\S]*?)<\/h\1>/gi,
    (fullMatch, depth, attrs, oldId, innerContent) => {
      const count = counts.get(oldId) || 0;
      counts.set(oldId, count + 1);

      if (count === 0) {
        return fullMatch;
      }

      const newId = `${oldId}-${count}`;
      // 替换 opening tag 中的 id="..."
      const newAttrs = attrs.replace(
        new RegExp(`(\\bid=")${escapeRegex(oldId)}(")`),
        `$1${newId}$2`
      );
      // 替换内部 anchor-link 的 href="#oldId"
      const newInner = innerContent.replace(
        new RegExp(`(\\bhref="#)${escapeRegex(oldId)}(")`),
        `$1${newId}$2`
      );

      return `<h${depth}${newAttrs}>${newInner}</h${depth}>`;
    }
  );
}
