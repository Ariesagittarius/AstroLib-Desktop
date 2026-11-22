import { flattenTree } from '../content-api/ast-extractor.ts';
import type { AstDocumentNode } from '../content-api/types.ts';
import type {
  AnnotationSearchHit,
  AttachedAstNodeSummary,
  BookAnnotationItem,
  BookAnnotationsOverview,
  BookChapterAnnotationStats,
  ChapterAnnotationPayload,
  ChapterAnnotationsWithAstResult,
  EnrichedBookAnnotation,
  EnrichedCanvasBlock,
} from '../../types/annotation-package.ts';
import type { AnnotationStorageService } from './annotation-storage.ts';

function stripHtmlTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildFallbackAstTreeFromHtml(html: string): AstDocumentNode[] {
  const nodes: AstDocumentNode[] = [];
  if (!html) return nodes;

  const blockRegex =
    /<(h[2-4])\s+[^>]*?id="([^"]+)"[^>]*>([\s\S]*?)<\/\1>|<(div|details)\s+[^>]*?class="([^"]*?toc-chunk[^"]*?)"[^>]*?(?:data-title="([^"]*)")?[^>]*?(?:id="([^"]*)")?[^>]*>|<div\s+class="katex-display-container"[^>]*?data-latex="([^"]*)"[^>]*>|<p(?:\s+[^>]*)?>([\s\S]*?)<\/p>/gi;

  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = blockRegex.exec(html)) !== null) {
    idx++;
    if (match[1] && match[2]) {
      const level = parseInt(match[1].slice(1), 10);
      const title = stripHtmlTags(match[3]);
      nodes.push({
        id: match[2],
        type: 'heading',
        level,
        title,
        summary: `【大纲标题 H${level}】${title}`,
        preview: title,
        contentLength: title.length,
        lineStart: idx,
        lineEnd: idx,
      });
    } else if (match[4]) {
      const cls = match[5] || '';
      const rawTitle = match[6] || '学术卡片';
      const cardId = match[7] || `card-abp-${idx}`;
      const tagMatch = cls.match(/academic-([a-z0-9_-]+)-card/i);
      const kind = tagMatch ? tagMatch[1] : 'card';
      nodes.push({
        id: cardId,
        type: 'card',
        tag: kind.charAt(0).toUpperCase() + kind.slice(1),
        kind,
        title: rawTitle,
        summary: `【学术模块 ${kind}】${rawTitle}`,
        preview: rawTitle,
        contentLength: rawTitle.length,
        lineStart: idx,
        lineEnd: idx,
      });
    } else if (match[8] !== undefined) {
      let latex = match[8];
      try {
        latex = decodeURIComponent(latex);
      } catch {}
      nodes.push({
        id: `math-abp-${idx}`,
        type: 'math_block',
        latex,
        summary: `【独立公式】$$${latex.slice(0, 60)}$$`,
        preview: `$$ ${latex.slice(0, 80)} $$`,
        contentLength: latex.length,
        lineStart: idx,
        lineEnd: idx,
      });
    } else if (match[9]) {
      const text = stripHtmlTags(match[9]);
      if (text) {
        nodes.push({
          id: `p-abp-${idx}`,
          type: 'paragraph',
          summary: `【正文段落】${text.slice(0, 60)}`,
          preview: text.slice(0, 140),
          contentLength: text.length,
          lineStart: idx,
          lineEnd: idx,
        });
      }
    }
  }

  return nodes;
}

function toAttachedSummary(
  node: AstDocumentNode,
  colSlug: string,
  bookSlug: string,
  chapterSlug: string
): AttachedAstNodeSummary {
  return {
    nodeId: node.id,
    type: node.type,
    ...(node.title ? { title: node.title } : {}),
    ...(node.tag ? { tag: node.tag } : {}),
    ...(node.kind ? { kind: node.kind } : {}),
    summary: node.summary,
    ...(node.preview ? { preview: node.preview } : {}),
    ...(node.latex ? { latex: node.latex } : {}),
    lineStart: node.lineStart,
    lineEnd: node.lineEnd,
    uri: `astrolib://${colSlug}/${bookSlug}/${chapterSlug}#${node.id}`,
  };
}

function resolveAstNodeForId(
  flatNodes: AstDocumentNode[],
  nodeId: string,
  quoteExact?: string
): AstDocumentNode | null {
  if (!flatNodes.length) return null;
  const direct = flatNodes.find((n) => n.id === nodeId);
  if (direct) return direct;

  const caseInsensitive = flatNodes.find((n) => n.id.toLowerCase() === nodeId.toLowerCase());
  if (caseInsensitive) return caseInsensitive;

  if (quoteExact && quoteExact.trim().length >= 4) {
    const snippet = quoteExact.trim().slice(0, 24);
    const byQuote = flatNodes.find(
      (n) => (n.preview && n.preview.includes(snippet)) || (n.title && n.title.includes(snippet))
    );
    if (byQuote) return byQuote;
  }

  return null;
}

export function linkChapterAnnotationsWithAst(params: {
  colSlug: string;
  bookSlug: string;
  chapterSlug: string;
  chapterTitle: string;
  payload: ChapterAnnotationPayload;
  astTree: AstDocumentNode[];
}): ChapterAnnotationsWithAstResult {
  const { colSlug, bookSlug, chapterSlug, chapterTitle, payload, astTree } = params;
  const flatNodes = flattenTree(astTree);

  const enrichedAnnotations: EnrichedBookAnnotation[] = payload.annotations.map((ann) => {
    const matched = resolveAstNodeForId(flatNodes, ann.anchor.nodeId, ann.anchor.quote?.exact);
    return {
      annotation: ann,
      astNode: matched ? toAttachedSummary(matched, colSlug, bookSlug, chapterSlug) : null,
    };
  });

  const enrichedCanvasBlocks: EnrichedCanvasBlock[] = payload.canvasNote.blocks.map((block) => {
    const refId = block.astRef?.nodeId;
    const matched = refId ? resolveAstNodeForId(flatNodes, refId, block.astRef?.quote?.exact) : null;
    return {
      block,
      astNode: matched ? toAttachedSummary(matched, colSlug, bookSlug, chapterSlug) : null,
    };
  });

  let highlightsCount = 0;
  let sidenotesCount = 0;
  let inkStrokesCount = 0;
  for (const ann of payload.annotations) {
    if (ann.kind === 'highlight') highlightsCount++;
    else if (ann.kind === 'sidenote') sidenotesCount++;
    else if (ann.kind === 'ink') inkStrokesCount++;
  }

  return {
    colSlug,
    bookSlug,
    chapterSlug,
    chapterTitle: chapterTitle || payload.chapterTitle || chapterSlug,
    chapterUri: `astrolib://${colSlug}/${bookSlug}/${chapterSlug}`,
    payload,
    enrichedAnnotations,
    enrichedCanvasBlocks,
    summary: {
      highlightsCount,
      sidenotesCount,
      inkStrokesCount,
      canvasBlocksCount: payload.canvasNote.blocks.length,
      canvasInkStrokesCount: payload.canvasNote.strokes.length,
    },
  };
}

export function aggregateBookAnnotationsOverview(params: {
  storage: AnnotationStorageService;
  colSlug: string;
  bookSlug: string;
  bookTitle: string;
}): BookAnnotationsOverview {
  const { storage, colSlug, bookSlug, bookTitle } = params;
  const chapterSlugs = storage.listAnnotatedChapterSlugs(colSlug, bookSlug);

  let totalAnnotations = 0;
  let highlightsCount = 0;
  let sidenotesCount = 0;
  let inkStrokesCount = 0;
  let canvasBlocksCount = 0;
  let canvasInkStrokesCount = 0;
  const tagCounts = new Map<string, number>();
  const chapters: BookChapterAnnotationStats[] = [];

  const allHighlights: BookAnnotationsOverview['recentHighlights'] = [];
  const allSidenotes: BookAnnotationsOverview['recentSidenotes'] = [];

  for (const slug of chapterSlugs) {
    const p = storage.getChapterAnnotations(colSlug, bookSlug, slug);
    let chHl = 0;
    let chSn = 0;
    let chInk = 0;
    const chTags = new Set<string>();

    for (const ann of p.annotations) {
      if (ann.kind === 'highlight') {
        chHl++;
        allHighlights.push({
          id: ann.id,
          chapterSlug: p.chapterSlug,
          nodeId: ann.anchor.nodeId,
          uri: ann.anchor.uri,
          exactText: ann.anchor.quote?.exact || ann.note || '',
          color: ann.color,
          updatedAt: ann.updatedAt,
        });
      } else if (ann.kind === 'sidenote') {
        chSn++;
        allSidenotes.push({
          id: ann.id,
          chapterSlug: p.chapterSlug,
          nodeId: ann.anchor.nodeId,
          uri: ann.anchor.uri,
          markdown: ann.markdown,
          ...(ann.anchor.quote?.exact ? { quote: ann.anchor.quote.exact } : {}),
          updatedAt: ann.updatedAt,
        });
      } else if (ann.kind === 'ink') {
        chInk++;
      }

      if ('tags' in ann && Array.isArray(ann.tags)) {
        for (const t of ann.tags) {
          if (t) {
            chTags.add(t);
            tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
          }
        }
      }
    }

    const chBlocks = p.canvasNote.blocks.length;
    const chCanvasInk = p.canvasNote.strokes.length;
    const chTotal = p.annotations.length + chBlocks + chCanvasInk;
    if (chTotal === 0) continue;

    highlightsCount += chHl;
    sidenotesCount += chSn;
    inkStrokesCount += chInk;
    canvasBlocksCount += chBlocks;
    canvasInkStrokesCount += chCanvasInk;
    totalAnnotations += p.annotations.length;

    chapters.push({
      chapterSlug: p.chapterSlug,
      ...(p.chapterTitle ? { chapterTitle: p.chapterTitle } : {}),
      uri: `astrolib://${colSlug}/${bookSlug}/${p.chapterSlug}`,
      totalAnnotations: chTotal,
      highlightsCount: chHl,
      sidenotesCount: chSn,
      inkStrokesCount: chInk,
      canvasBlocksCount: chBlocks,
      canvasInkStrokesCount: chCanvasInk,
      tags: Array.from(chTags),
      updatedAt: p.updatedAt,
    });
  }

  const sortDescByTime = <T extends { updatedAt: string }>(arr: T[]) =>
    arr.sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));

  return {
    colSlug,
    bookSlug,
    bookTitle,
    bookUri: `astrolib://${colSlug}/${bookSlug}`,
    totalAnnotatedChapters: chapters.length,
    totalAnnotations,
    highlightsCount,
    sidenotesCount,
    inkStrokesCount,
    canvasBlocksCount,
    canvasInkStrokesCount,
    allTags: Array.from(tagCounts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count),
    chapters,
    recentHighlights: sortDescByTime(allHighlights).slice(0, 12),
    recentSidenotes: sortDescByTime(allSidenotes).slice(0, 12),
    updatedAt: new Date().toISOString(),
  };
}

export function searchAnnotationsAcrossBooks(params: {
  storage: AnnotationStorageService;
  books: Array<{ colSlug: string; slug: string }>;
  query: string;
  limit?: number;
}): AnnotationSearchHit[] {
  const { storage, books, query, limit = 30 } = params;
  const terms = query
    .toLowerCase()
    .split(/[\s,，]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (terms.length === 0) return [];

  const hits: AnnotationSearchHit[] = [];

  for (const book of books) {
    const slugs = storage.listAnnotatedChapterSlugs(book.colSlug, book.slug);
    for (const chSlug of slugs) {
      const p = storage.getChapterAnnotations(book.colSlug, book.slug, chSlug);

      for (const ann of p.annotations) {
        if (ann.kind === 'ink') continue;
        const quoteText = ann.anchor.quote?.exact || '';
        const noteText = ann.kind === 'sidenote' ? ann.markdown : ann.note || '';
        const tags = ann.tags || [];
        const haystack = `${quoteText} ${noteText} ${ann.anchor.nodeId} ${tags.join(' ')}`.toLowerCase();
        if (terms.every((t) => haystack.includes(t))) {
          hits.push({
            hitType: ann.kind,
            id: ann.id,
            colSlug: book.colSlug,
            bookSlug: book.slug,
            chapterSlug: p.chapterSlug,
            ...(p.chapterTitle ? { chapterTitle: p.chapterTitle } : {}),
            nodeId: ann.anchor.nodeId,
            uri: ann.anchor.uri,
            matchedText: quoteText || noteText.slice(0, 100),
            ...(noteText ? { noteText } : {}),
            tags,
            updatedAt: ann.updatedAt,
          });
        }
      }

      for (const block of p.canvasNote.blocks) {
        const refText = `${block.astRef?.summary || ''} ${block.astRef?.title || ''} ${block.astRef?.nodeId || ''}`;
        const haystack = `${block.markdown} ${refText}`.toLowerCase();
        if (terms.every((t) => haystack.includes(t))) {
          hits.push({
            hitType: 'canvas-block',
            id: block.id,
            colSlug: book.colSlug,
            bookSlug: book.slug,
            chapterSlug: p.chapterSlug,
            ...(p.chapterTitle ? { chapterTitle: p.chapterTitle } : {}),
            ...(block.astRef?.nodeId ? { nodeId: block.astRef.nodeId } : {}),
            uri: block.astRef?.uri || `astrolib://${book.colSlug}/${book.slug}/${p.chapterSlug}`,
            matchedText: block.markdown.slice(0, 140),
            tags: [],
            updatedAt: block.updatedAt,
          });
        }
      }
    }
  }

  return hits
    .sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0))
    .slice(0, limit);
}

export function matchAnnotationRecord(item: BookAnnotationItem, query: string): boolean {
  const q = query.toLowerCase();
  if (item.kind === 'ink') return item.anchor.nodeId.toLowerCase().includes(q);
  return (
    (item.anchor.quote?.exact || '').toLowerCase().includes(q) ||
    (item.kind === 'sidenote' ? item.markdown : item.note || '').toLowerCase().includes(q)
  );
}
