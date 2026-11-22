import type { BookSourceFormat, ReadingProfile } from './content-package.ts';

export type ReadingEntityKind = 'book' | 'paper' | 'slide' | 'video' | 'canvas';

export type EntityStatus = 'ready' | 'idle' | 'processing' | 'error';

export interface UnifiedReadingEntity {
  id: string;
  kind: ReadingEntityKind;
  title: string;
  subtitle?: string;
  author?: string;
  publisher?: string;
  cover?: string;
  category: string;
  shelfId?: string;
  createdAt: number;
  lastReadAt?: number;
  readProgress?: number;
  status: EntityStatus;
  statusMessage?: string;

  metadata: {

    colSlug?: string;
    bookSlug?: string;
    entryPoint?: string;
    abpPackPath?: string;
    edition?: string;
    isbn?: string;
    sourceFormat?: BookSourceFormat;
    readingProfile?: ReadingProfile;

    taskId?: string;
    originPdfUrl?: string;
    markdownUrl?: string;
    hasBookmarks?: boolean;
    hasAnnotations?: boolean;
    fileSizeBytes?: number;
    totalPages?: number;
    pageRanges?: string;
    doi?: string;
    year?: string;
  };
}

export interface LibraryShelf {
  id: string;
  name: string;
  itemCount: number;
  createdAt: number;
}

export interface TabItem {
  id: string;
  entityId: string;
  kind: ReadingEntityKind;
  title: string;
  url: string;
  active: boolean;
  lastVisited?: number;
}

export type SplitLayoutMode = 'single' | 'split-vertical' | 'split-horizontal' | 'grid-2x2';

export interface SplitPane {
  id: string;
  tabId: string | null;
  ratio: number;
}
