/**
 * src/plugins/harness/heuristic-resolver.ts
 * ============================================================================
 * AstroLib 纯算法启发式求解器 (Heuristic Matching & Suggestion Engine)
 * ============================================================================
 * 核心原则：
 * 1. 零硬编码字典！严禁在代码中写死任何 "线代"、"高代"、"数分" 等静态别名；
 * 2. 纯动态自描述：完全依赖知识库元数据 (title, slug, tags, description) 与纯文本相似度算法；
 * 3. 启发式评分 (Heuristic Scoring)：结合精确命中、子串包含、Token 覆盖率与 Jaccard 相似度；
 * 4. 启发式提示 (Suggestion Generator)：当打出指令或无精准匹配时，输出格式化建议列表供用户一键选择。
 * ============================================================================
 */

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
  /**
   * 计算两个字符串的字符交集覆盖率 (Jaccard-like Character Overlap)
   */
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

  /**
   * 启发式计算 query 与单本图书的匹配得分 (0 ~ 1.0)
   */
  public static scoreBook(query: string, book: BookMeta, index1Based: number): number {
    const q = query.trim().toLowerCase();
    if (!q) return 0;

    // 1. 纯数字序号匹配（最高优先级）
    if (/^\d+$/.test(q)) {
      const targetIdx = parseInt(q, 10);
      return targetIdx === index1Based ? 1.0 : 0;
    }

    const slug = (book.slug || '').toLowerCase();
    const title = (book.title || '').toLowerCase();
    const colSlug = (book.colSlug || '').toLowerCase();
    const tags = (book.tags || []).map((t) => t.toLowerCase());

    // 2. 精确匹配 slug 或 col/slug 或 title (支持 astrolib:// 协议前缀)
    const cleanQ = q.replace(/^astrolib:\/\//, '').split('/')[0] === colSlug && q.includes('/')
      ? q.replace(/^astrolib:\/\//, '')
      : q.replace(/^astrolib:\/\//, '');

    if (slug === cleanQ || `${colSlug}/${slug}` === cleanQ || title === cleanQ || cleanQ.startsWith(`${colSlug}/${slug}/`)) {
      return 0.99;
    }

    // 3. title 包含完整 query
    if (title.includes(q)) {
      // 越贴近完整长度得分越高
      return 0.85 + 0.1 * (q.length / Math.max(title.length, 1));
    }

    // 4. slug 包含 query
    if (slug.includes(q)) {
      return 0.8;
    }

    // 5. tags 中有精确匹配
    if (tags.some((t) => t === q)) {
      return 0.82;
    }

    // 6. tags 中包含 query，或 query 包含某个 tag
    if (tags.some((t) => t.includes(q) || q.includes(t))) {
      return 0.75;
    }

    // 7. query 包含 title 的核心关键词（如用户搜 "线性代数与空间几何第二版"，书名叫 "线性代数与几何（第2版）"）
    const overlapWithTitle = this.calculateCharOverlap(q, title);
    if (overlapWithTitle >= 0.7) {
      return 0.7 + 0.2 * overlapWithTitle;
    }

    // 8. 兜底字符交集
    return overlapWithTitle * 0.5;
  }

  /**
   * 启发式解析目标图书 (支持输入不确定时返回建议列表)
   */
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

    // 生成候选打分列表
    const scoredList = books
      .map((book, idx) => ({
        book,
        score: this.scoreBook(q, book, idx + 1),
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);

    // 将所有图书生成标准 SuggestionItem 列表（供用户选择）
    const makeSuggestions = (list: BookMeta[]): SuggestionItem[] => {
      return list.map((b, i) => ({
        id: b.slug,
        title: `#${i + 1} ${b.title}`,
        subtitle: `[${b.colSlug.toUpperCase()}] ${b.subject || b.category || ''} · slug: ${b.slug}`,
        badge: b.colSlug.toUpperCase(),
        fillCommand: `${commandPrefix} ${b.slug}`,
      }));
    };

    // 场景 A: query 为空 -> 返回所有图书作为建议
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

    // 场景 B: 纯数字序号超出范围
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

    // 场景 C: 无任何匹配项 (score = 0)
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

    // 场景 D: 精确匹配 (exact)
    if (top.score >= 0.95) {
      return {
        book: top.book,
        score: top.score,
        confidence: 'exact',
        candidates: scoredList,
        suggestions: makeSuggestions([top.book]),
      };
    }

    // 场景 E: 高可信度匹配 (高分且显著超过次高分)
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

    // 场景 F: 多本候选歧义 (例如输入 "线性代数" 匹配了《线性代数及其应用》和《线性代数与几何》)
    return {
      book: top.book, // 默认推荐最高分，但标记为 ambiguous 并展示完整候选
      score: top.score,
      confidence: 'ambiguous',
      candidates: scoredList,
      suggestions: makeSuggestions(scoredList.map((s) => s.book)),
      reason: `检索到多本关联教材（最高匹配: 《${top.book.title}》）。您可点击切换具体教材：`,
    };
  }
}
