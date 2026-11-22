import type { BookMeta, SuggestionItem } from './types.ts';

export interface HeuristicMatchResult {
  book: BookMeta | null;
  score: number;
  confidence: 'exact' | 'high' | 'ambiguous' | 'none';
  candidates: Array<{ book: BookMeta; score: number }>;
  suggestions: SuggestionItem[];
  reason?: string;
}

export class HeuristicResolver {

  private static calculateCharOverlap(query: string, target: string): number {
    if (!query || !target) return 0;
    const qChars = new Set(query.toLowerCase().replace(/\s+/g, '').split(''));
    const tChars = new Set(target.toLowerCase().replace(/\s+/g, '').split(''));
    if (qChars.size === 0) return 0;

    let overlap = 0;
    for (const c of qChars) {
      if (tChars.has(c)) overlap++;
    }
    return overlap / qChars.size;
  }

  public static scoreBook(query: string, book: BookMeta, index1Based: number): number {
    const q = query.trim().toLowerCase();
    if (!q) return 0;

    if (/^\d+$/.test(q)) {
      const targetIdx = parseInt(q, 10);
      return targetIdx === index1Based ? 1.0 : 0;
    }

    const slug = (book.slug || '').toLowerCase();
    const title = (book.title || '').toLowerCase();
    const colSlug = (book.colSlug || '').toLowerCase();
    const tags = (book.tags || []).map((t) => t.toLowerCase());

    const cleanQ = q.replace(/^astrolib:\/\//, '').split('/')[0] === colSlug && q.includes('/')
      ? q.replace(/^astrolib:\/\//, '')
      : q.replace(/^astrolib:\/\//, '');

    if (slug === cleanQ || `${colSlug}/${slug}` === cleanQ || title === cleanQ || cleanQ.startsWith(`${colSlug}/${slug}/`)) {
      return 0.99;
    }

    if (title.includes(q)) {

      return 0.85 + 0.1 * (q.length / Math.max(title.length, 1));
    }

    if (slug.includes(q)) {
      return 0.8;
    }

    if (tags.some((t) => t === q)) {
      return 0.82;
    }

    if (tags.some((t) => t.includes(q) || q.includes(t))) {
      return 0.75;
    }

    const overlapWithTitle = this.calculateCharOverlap(q, title);
    if (overlapWithTitle >= 0.7) {
      return 0.7 + 0.2 * overlapWithTitle;
    }

    return overlapWithTitle * 0.5;
  }

  public static resolve(query: string, books: BookMeta[], commandPrefix: string = '/toc'): HeuristicMatchResult {
    const q = (query || '').trim();
    if (!books || books.length === 0) {
      return {
        book: null,
        score: 0,
        confidence: 'none',
        candidates: [],
        suggestions: [],
        reason: '教材库当前未加载或为空',
      };
    }

    const scoredList = books
      .map((book, idx) => ({
        book,
        score: this.scoreBook(q, book, idx + 1),
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);

    const makeSuggestions = (list: BookMeta[]): SuggestionItem[] => {
      return list.map((b, i) => ({
        id: b.slug,
        title: `#${i + 1} ${b.title}`,
        subtitle: `[${b.colSlug.toUpperCase()}] ${b.subject || b.category || ''} · slug: ${b.slug}`,
        badge: b.colSlug.toUpperCase(),
        fillCommand: `${commandPrefix} ${b.slug}`,
      }));
    };

    if (!q) {
      return {
        book: null,
        score: 0,
        confidence: 'ambiguous',
        candidates: [],
        suggestions: makeSuggestions(books),
        reason: '未输入图书参数，请从知识库教材列表中选择：',
      };
    }

    if (/^\d+$/.test(q)) {
      const num = parseInt(q, 10);
      if (num < 1 || num > books.length) {
        return {
          book: null,
          score: 0,
          confidence: 'none',
          candidates: [],
          suggestions: makeSuggestions(books),
          reason: `教材序号 #${num} 超出有效范围（知识库现有 1~${books.length} 本教材）。`,
        };
      }
    }

    if (scoredList.length === 0) {
      return {
        book: null,
        score: 0,
        confidence: 'none',
        candidates: [],
        suggestions: makeSuggestions(books),
        reason: `未能检索到与 "${q}" 匹配的教材。为您推荐以下教材：`,
      };
    }

    const top = scoredList[0];

    if (top.score >= 0.95) {
      return {
        book: top.book,
        score: top.score,
        confidence: 'exact',
        candidates: scoredList,
        suggestions: makeSuggestions([top.book]),
      };
    }

    const second = scoredList[1];
    if (top.score >= 0.75 && (!second || top.score - second.score >= 0.15)) {
      return {
        book: top.book,
        score: top.score,
        confidence: 'high',
        candidates: scoredList,
        suggestions: makeSuggestions(scoredList.map((s) => s.book)),
      };
    }

    return {
      book: top.book,
      score: top.score,
      confidence: 'ambiguous',
      candidates: scoredList,
      suggestions: makeSuggestions(scoredList.map((s) => s.book)),
      reason: `检索到多本关联教材（最高匹配: 《${top.book.title}》）。您可点击切换具体教材：`,
    };
  }
}
