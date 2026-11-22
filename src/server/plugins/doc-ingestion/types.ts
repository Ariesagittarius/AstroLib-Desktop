export type IngestEngineType = 'api' | 'agent' | 'local';

export type TaskStatus =
  | 'idle'
  | 'uploading'
  | 'waiting-file'
  | 'pending'
  | 'processing'
  | 'downloading'
  | 'unpacking'
  | 'completed'
  | 'failed';

export interface LayoutBlock {
  id: string;
  type:
    | 'title'
    | 'text'
    | 'equation'
    | 'image'
    | 'table'
    | 'header'
    | 'footer'
    | 'figure'
    | 'list'
    | 'aside'
    | 'page_divider'
    | 'page_meta'
    | 'footnote';
  pageIndex: number;
  bbox: [number, number, number, number];
  pageWidth?: number;
  pageHeight?: number;
  text?: string;
  html?: string;
  htmlContent?: string;
  markdownRefId?: string;
  caption?: string;
  level?: number;

  pageNumber?: string;
  fnIndex?: string;
  refIds?: string[];
  metaInfo?: {
    header?: string;
    footer?: string;
    aside?: string;
  };
}

export interface IngestTaskMeta {
  taskId: string;
  fileName: string;
  fileSize: number;
  pageCount: number;
  pageRanges?: string;
  engine: IngestEngineType;
  status: TaskStatus;
  progress: number;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  error?: string;
  batchId?: string;
  fullZipUrl?: string;
  outputDir: string;
  hasImages: boolean;
  imageCount: number;
}

export interface ParseResultResponse {
  taskId: string;
  fileName: string;
  pageCount: number;
  markdown: string;
  layoutBlocks: LayoutBlock[];
  images: string[];
  status: TaskStatus;
  engine: IngestEngineType;
  durationMs?: number;
  rawJson?: string;
}
