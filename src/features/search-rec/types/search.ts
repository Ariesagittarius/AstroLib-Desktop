/**
 * src/features/search-rec/types/search.ts
 * 搜索模态与检索结果定义
 */

import type { CandidateItem } from './candidate.ts';

export type SearchMode = 'neural' | 'exact' | 'fuzzy';

export interface SearchFilter {
  colSlug?: string;          // 限制合集，如 'math'
  bookSlug?: string;         // 限制单书
  chunkTypes?: string[];     // 限制卡片类型，如 ['定理', '定义']
  onlyWithLatex?: boolean;   // 仅检索含公式切片
}

export interface SearchQuery {
  raw: string;               // 原始输入
  mode: SearchMode;          // 当前模态
  filter?: SearchFilter;
  topK?: number;             // 返回条数，默认 15
  contextChapterSlug?: string; // 当前正在阅读的章节上下文
  contextBookSlug?: string;
  contextColSlug?: string;
}

export interface SearchResult {
  query: SearchQuery;
  items: CandidateItem[];
  totalMatches: number;
  timeMs: number;
  modeUsed: SearchMode;
  appliedFilters?: SearchFilter;
}
