export type AcademicChunkKind = 'card' | 'heading' | 'exercise' | 'digital-resource';

export interface AcademicChunk {
  id: string;
  bookId: string;
  colSlug: string;
  bookSlug: string;
  bookTitle: string;
  chapterSlug: string;
  chapterTitle: string;
  kind: AcademicChunkKind;
  type: string;
  title: string;
  number?: string;
  text: string;
  anchor?: string;
  url: string;
  hasLatex?: boolean;
  latexFormulas?: string[];
  line?: number;
}

export interface CandidateItem {
  chunk: AcademicChunk;
  channel: 'lexical' | 'dense' | 'graph' | 'scaffold';
  channelScore: number;
  channelRank: number;
  matchedTokens?: string[];
  rrfScore?: number;
  rankScore?: number;
  recommendReason?: string;
}
