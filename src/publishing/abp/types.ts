/**
 * src/publishing/abp/types.ts
 * ============================================================================
 * 独立无头 ABP (AstroBook Package) 编译器与质检门禁类型契约
 * ============================================================================
 * 遵循 Rule 2 (Publishing is independent) & Rule 8 (No runtime dependency on scripts/)
 */

import type {
  AbpBundlePayload,
  AstroBookManifest,
  BookSourceFormat,
  ReadingProfile,
} from '../../types/content-package.ts';
import type { BookLanguageConfig, ModuleItemConfig } from '../../types/collections.ts';
import type { NoticeConfig } from '../../types/notices.ts';

export interface BookJsonSectionConfig {
  id?: string;
  title: string;
  slug?: string;
  intro?: string;
  collapsed?: boolean;
  /** 支持填入相对文件名（如 "01_引言.mdx"）、rawSlug 或 cleanSlug */
  chapters: string[];
}

export interface BookJsonConfig {
  id?: string;
  colSlug?: string;
  slug?: string;
  title?: string;
  author?: string;
  publisher?: string;
  isbn?: string;
  edition?: string;
  stage?: 'high-school' | 'university' | 'graduate' | 'research' | string;
  stageLabel?: string;
  category?: 'textbook' | 'supplement' | 'notes' | 'monograph' | 'exercise' | string;
  categoryLabel?: string;
  subject?: string;
  subjectLabel?: string;
  description?: string;
  tags?: string[];
  cover?: string;
  entryPoint?: string;
  sourceFormat?: BookSourceFormat;
  readingProfile?: ReadingProfile;
  language?: string;
  trackClasses?: string[];
  notices?: NoticeConfig[];
  languages?: BookLanguageConfig[];
  modules?: Record<string, ModuleItemConfig>;
  sections?: BookJsonSectionConfig[];
}

export interface AbpCompileOptions {
  bookDir: string;
  outDir: string;
  colSlug?: string;
  bookSlug?: string;
  customManifest?: Partial<BookJsonConfig> | null;
  withVectors?: boolean;
  vectorFormat?: 'int8' | 'float32';
  includeAuxiliary?: boolean;
  writeExpanded?: boolean;
}

export interface AbpCompileResult {
  manifest: AstroBookManifest;
  abpPath: string;
  expandedDir: string | null;
  sizeBytes: number;
  totalChapters: number;
  totalAssets: number;
  warnings: string[];
}

export type MdxValidationCategory =
  | 'frontmatter'
  | 'mdx-syntax'
  | 'katex'
  | 'image-asset'
  | 'figure-nesting'
  | 'trailing-heading'
  | 'duplicate-heading'
  | 'annotation-card'
  | 'algorithm-syntax'
  | 'footnote'
  | 'table-tilde'
  | 'mermaid'
  | 'empty-content';

export interface MdxValidationIssue {
  file: string;
  severity: 'error' | 'warning';
  category: MdxValidationCategory;
  line?: number;
  column?: number;
  message: string;
  snippet?: string;
}

export interface MdxValidationReport {
  passed: boolean;
  targetPath: string;
  totalFiles: number;
  passedFiles: number;
  errorCount: number;
  warningCount: number;
  errors: MdxValidationIssue[];
  warnings: MdxValidationIssue[];
}

export interface AbpArchiveVerificationReport {
  passed: boolean;
  abpPath: string;
  bookId: string;
  title: string;
  totalChapters: number;
  totalAssets: number;
  katexErrorChapters: string[];
  missingAssets: string[];
  errors: string[];
  warnings: string[];
  manifest?: AstroBookManifest;
  bundleSummary?: {
    hasAiIndex: boolean;
    hasCrossRefs: boolean;
    hasRelationGraph: boolean;
    hasInspectorData: boolean;
    hasEmbeddings: boolean;
  };
}

export type { AbpBundlePayload, AstroBookManifest };
