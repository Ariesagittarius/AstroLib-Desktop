import type { BookJsonConfig, AbpCompileResult, AbpArchiveVerificationReport, MdxValidationReport } from '../../publishing/abp/types.ts';

export interface PdfOutlineItem {
  level: number;
  title: string;

  page: number;
}

export interface PdfInspectResult {
  pdfPath: string;
  fileName: string;
  fileSizeBytes: number;
  pageCount: number;
  pageDimensionsSample: Array<{ page: number; widthPt: number; heightPt: number }>;
  outline: PdfOutlineItem[];
  textLayerSample: Array<{ page: number; charCount: number; preview: string }>;
  likelyScanned: boolean;
}

export interface PdfSplitPart {
  partIndex: number;
  totalParts: number;
  startPage: number;
  endPage: number;
  pageCount: number;
  filePath: string;
  fileSizeBytes: number;
  isOriginalFile: boolean;
}

export interface RenderedPageInfo {
  page: number;
  filePath: string;
  relPath: string;
  width: number;
  height: number;
  dpi: number;
  sizeBytes: number;
}

export interface ContactSheetTile {
  page: number;
  col: number;
  row: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ContactSheetResult {
  filePath: string;
  relPath: string;
  cols: number;
  rows: number;
  dpi: number;
  width: number;
  height: number;
  sizeBytes: number;
  pages: number[];
  tiles: ContactSheetTile[];
}

export interface MineruAvailabilityStatus {
  ready: boolean;
  preferredEngine: 'api' | 'local' | 'none';
  hasApiToken: boolean;
  tokenPrefix: string | null;
  localAvailable: boolean;
  localMessage?: string;
  guidance: string;
}

export interface StitchedPageBlock {
  page: number;
  localPage: number;
  partIndex: number;
  type: string;
  text: string;
  latex?: string;
  imgPath?: string;
  caption?: string;
  level?: number;
  bbox?: [number, number, number, number];
}

export interface StitchedMineruSummary {
  totalPages: number;
  totalParts: number;
  totalImages: number;
  totalBlocks: number;
  fullMdPath: string;
  pagesBlocksPath: string;
  imagesDir: string;
  headings: Array<{ page: number; level: number; text: string }>;
  pageStats: Array<{
    page: number;
    textChars: number;
    equations: number;
    images: number;
    tables: number;
  }>;
}

export interface MineruRunResult {
  engine: 'api' | 'local';
  parts: PdfSplitPart[];
  stitchedDir: string;
  fullMdPath: string;
  pagesBlocksPath: string;
  imagesDir: string;
  summaryPath: string;
  summary: StitchedMineruSummary;
  reusedCache: boolean;
  pageRange?: [number, number];
}

export interface PlannedChapterSpec {
  id: string;
  filename: string;
  title: string;
  sectionTitle?: string;
  startPage: number;
  endPage: number;
  startAnchor?: string;
  endAnchor?: string;
  kind?: 'frontmatter' | 'chapter-intro' | 'body' | 'exercises' | 'notes' | 'appendix';
  rules?: string;
}

export interface BookPlanSpec {
  bookConfig: BookJsonConfig;
  documentMode?: 'textbook' | 'paper' | 'exam' | 'monograph';
  coverPage?: number;
  coverBboxNorm1000?: [number, number, number, number];
  globalProofreadingRules: string[];
  chapters: PlannedChapterSpec[];
}

export interface ChapterChunkWorkOrder {
  chunkId: string;
  chapterId: string;
  chapterTitle: string;
  targetOutputRelPath: string;
  partIndex: number;
  totalParts: number;
  startPage: number;
  endPage: number;
  draftRelPath: string;
  workOrderRelPath: string;
  referencedImages: string[];
  rules: string;
}

export interface SubagentTaskSpec {
  taskId: string;
  title: string;
  targetOutputRelPath: string;
  startPage: number;
  endPage: number;
  draftRelPath?: string;
  referencedImages?: string[];
  instructions: string;
}

export interface SubagentTaskResult {
  taskId: string;
  status: 'completed' | 'failed' | 'skipped_from_checkpoint';
  outputFiles: string[];
  imagesUsed: string[];
  validationPassed: boolean;
  validationErrors: string[];
  anomalies: string[];
  notes: string;
  stepsUsed: number;
  durationMs: number;
  error?: string;
}

export interface WorkspaceFileEntry {
  relPath: string;
  name: string;
  isDirectory: boolean;
  sizeBytes: number;
  mtimeMs: number;
}

export interface AbpImportResult {
  installed: boolean;
  targetMode: 'electron-hook' | 'user-abp-dir' | 'dev-abp-packs';
  bookId: string;
  colSlug: string;
  bookSlug: string;
  title: string;
  entryPoint: string;
  storageDir: string;
  readerUrl: string;
  canonicalUrl: string;
}

export type Pdf2AbpJobStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type Pdf2AbpPhase =
  | 'init'
  | 'skills_and_inspect'
  | 'mineru'
  | 'overview_vision'
  | 'planning_and_slicing'
  | 'subagent_proofreading'
  | 'merge_and_validate'
  | 'pack_and_verify'
  | 'import'
  | 'done';

export interface Pdf2AbpJobState {
  jobId: string;
  sourcePdfPath: string;
  sourceFileName: string;
  workspaceDir: string;
  status: Pdf2AbpJobStatus;
  phase: Pdf2AbpPhase;
  providerId: string;
  modelId: string;
  baseURL: string;
  concurrency: number;
  autoImport: boolean;
  instructions?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  error?: string;
  pdfInfo?: PdfInspectResult;
  mineruResult?: MineruRunResult;
  subagentTasks?: Record<string, SubagentTaskResult>;
  compileResult?: AbpCompileResult;
  verifyResult?: AbpArchiveVerificationReport;
  validationReport?: MdxValidationReport;
  importResult?: AbpImportResult;
  finalSummary?: string;
}

export interface Pdf2AbpEvent {
  seq: number;
  timestamp: number;
  jobId: string;
  agentId: string;
  type:
    | 'job_started'
    | 'phase_changed'
    | 'thinking'
    | 'tool_start'
    | 'tool_result'
    | 'vision_attached'
    | 'subagent_started'
    | 'subagent_finished'
    | 'artifact_written'
    | 'assistant_message'
    | 'warning'
    | 'error'
    | 'job_completed'
    | 'job_cancelled';
  message: string;
  data?: Record<string, unknown>;
}
