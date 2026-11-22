import type { ChapterHeadingItem } from '../../types/content-package.ts';

export type { ChapterHeadingItem };

export function slugifyHeading(plainText: string): string {
  if (!plainText) return '';
  return plainText
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function collectHeadingsFromHtml(html: string): ChapterHeadingItem[] {
  if (!html) return [];
  const headings: ChapterHeadingItem[] = [];
  const headingRegex = /<h([1-4])\b[^>]*\sid="([^"]+)"[^>]*>([\s\S]*?)<\/h\1>/gi;

  let match: RegExpExecArray | null;
  while ((match = headingRegex.exec(html)) !== null) {
    const depth = parseInt(match[1], 10);
    const id = match[2];
    const rawInner = match[3];

    let textContent = rawInner;
    const spanMatch = rawInner.match(/<span\b[^>]*>([\s\S]*?)<\/span>/i);
    if (spanMatch) {
      textContent = spanMatch[1];
    } else {
      textContent = textContent.replace(/<a\b[^>]*class="[^"]*anchor-link[^"]*"[^>]*>[\s\S]*?<\/a>/gi, '');
    }

    const plainText = textContent.replace(/<[^>]+>/g, '').trim();

    headings.push({
      depth,
      text: plainText,
      id,
    });
  }

  return headings;
}

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

export function rewriteHeadingIdsInHtml(
  html: string,
  renames?: Array<{ from: string; to: string }> | Map<string, string>
): string {
  if (!html) return '';

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

      const newAttrs = attrs.replace(
        new RegExp(`(\\bid=")${escapeRegex(oldId)}(")`),
        `$1${newId}$2`
      );

      const newInner = innerContent.replace(
        new RegExp(`(\\bhref="#)${escapeRegex(oldId)}(")`),
        `$1${newId}$2`
      );

      return `<h${depth}${newAttrs}>${newInner}</h${depth}>`;
    }
  );
}
