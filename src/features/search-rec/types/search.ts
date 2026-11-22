import type { CandidateItem } from './candidate.ts';

export type SearchMode = 'neural' | 'exact' | 'fuzzy';

export interface SearchFilter {
  colSlug?: string;
  bookSlug?: string;
  chunkTypes?: string[];
  onlyWithLatex?: boolean;
}

export interface SearchQuery {
  raw: string;
  mode: SearchMode;
  filter?: SearchFilter;
  topK?: number;
  contextChapterSlug?: string;
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
