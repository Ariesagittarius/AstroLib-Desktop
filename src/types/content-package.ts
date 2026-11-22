import type { ModuleItemConfig, BookLanguageConfig } from './collections.ts';
import type { NoticeConfig } from './notices.ts';

export const ABP_SCHEMA_VERSION = '1.0.0' as const;

export type BookSourceFormat = 'abp' | 'epub' | 'markdown' | 'custom';

export type ReadingProfile = 'academic' | 'literary';

export type BookStyleMode = 'harmonized' | 'original' | 'reflow';

export type ReadingLayoutMode = 'scroll' | 'paged-single' | 'paged-dual';

export type ChapterContentKind =
  | 'body'
  | 'chapter-intro'
  | 'cover'
  | 'illustration'
  | 'frontmatter'
  | 'notes'
  | 'colophon';

export interface BookFootnoteEntry {
  id: string;
  title?: string;
  html: string;
  text: string;
  chapterSlug?: string;
}

export interface AstroBookChapterSummary {
  id: string;
  title: string;
  slug: string;
  sourcePath?: string;
  legacySlug?: string;
  path: string;
  hash: string;
  sizeBytes: number;
  order?: number;
}

export interface AstroBookSection {
  id: string;
  title: string;
  slug: string;
  introSlug?: string;
  collapsed?: boolean;
  order?: number;
  chapters: AstroBookChapterSummary[];
}

export interface ChapterHeadingItem {
  depth: number;
  text: string;
  id: string;
}

export interface AstroBookChapterPayload {
  schemaVersion: typeof ABP_SCHEMA_VERSION;
  bookId: string;
  bookSlug: string;
  colSlug: string;
  chapterSlug: string;
  title: string;
  html: string;
  headings: ChapterHeadingItem[];
  crossRefs?: Record<string, unknown>;
  notices?: NoticeConfig[];
  readingTimeMinutes?: number;
  exercises?: unknown[];
  aiChunks?: unknown[];
  chapterKind?: ChapterContentKind;
  chapterIntro?: {
    title: string;
    html: string;
    slug: string;
  };
  bodyClasses?: string[];
  htmlClasses?: string[];
  stylesheets?: string[];
  footnotes?: Record<string, BookFootnoteEntry>;
  updatedAt: string;
}

export interface AstroBookManifest {
  schemaVersion: typeof ABP_SCHEMA_VERSION;
  id: string;
  slug: string;
  colSlug: string;
  title: string;
  author?: string;
  publisher?: string;
  isbn?: string;
  edition?: string;
  stage?: string;
  stageLabel?: string;
  category?: string;
  categoryLabel?: string;
  subject?: string;
  subjectLabel?: string;
  description?: string;
  tags?: string[];
  cover?: string;
  entryPoint: string;
  trackClasses?: string[];
  notices?: NoticeConfig[];
  modules?: Record<string, ModuleItemConfig>;
  languages?: BookLanguageConfig[];
  sections: AstroBookSection[];
  totalChapters: number;
  updatedAt: string;
  contentHash: string;
  assets?: string[];
  hasEmbeddings?: boolean;
  embeddingMeta?: AstroBookEmbeddingMeta;
  sourceFormat?: BookSourceFormat;
  readingProfile?: ReadingProfile;
  writingMode?: 'horizontal-tb' | 'vertical-rl';
  language?: string;
  stylesheets?: string[];
  hasEmbeddedFonts?: boolean;
  originalArchive?: string;
  footnotes?: Record<string, BookFootnoteEntry>;
}

export interface AstroBookEmbeddingMeta {
  model: string;
  dim: number;
  format: 'int8' | 'float32';
  vectorCount: number;
  generatedAt: string;
}

export interface VectorChunkReference {
  id: string;
  chapterSlug: string;
  title: string;
  type: string;
  anchor?: string;
  textLength: number;
  scale?: number;
}

export interface CatalogBookEntry {
  id: string;
  slug: string;
  colSlug: string;
  title: string;
  author?: string;
  edition?: string;
  category?: string;
  subject?: string;
  description?: string;
  cover?: string;
  entryPoint: string;
  totalChapters: number;
  sizeBytes?: number;
  packFileName: string;
  remotePackUrl?: string;
  contentHash: string;
  updatedAt: string;
}

export interface LibraryCatalog {
  schemaVersion: typeof ABP_SCHEMA_VERSION;
  catalogName: string;
  releaseRepo?: string;
  releaseTag?: string;
  sourceUrl?: string;
  generatedAt: string;
  books: CatalogBookEntry[];
}

export interface InstalledBookMeta {
  manifest: AstroBookManifest;
  installedAt: string;
  sourceType: 'local-file' | 'remote-repo' | 'pre-bundled';
  sourceUrl?: string;
  localPath?: string;
}

export interface AbpEmbeddingBundle {
  binaryBase64?: string;
  meta?: Record<string, unknown>;
}

export interface AbpBundlePayload {
  manifest: AstroBookManifest;
  chapters: Record<string, AstroBookChapterPayload>;
  assets?: Record<string, string>;
  embeddings?: AbpEmbeddingBundle | null;
  aiIndex?: Record<string, unknown> | null;
  relationGraph?: Record<string, unknown> | null;
  crossRefs?: Record<string, unknown> | null;
  inspectorData?: Record<string, unknown> | null;
  exercises?: Record<string, string> | null;
  sourceArchiveBase64?: string;
  sourceArchiveFileName?: string;
}

export function validateAbpBundle(raw: unknown): AbpBundlePayload {
  if (!raw || typeof raw !== 'object') {
    throw new Error('无效的 ABP 数据包：根节点必须为 JSON 对象');
  }
  const obj = raw as Record<string, unknown>;
  const manifest = obj.manifest as Record<string, unknown> | undefined;
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('无效的 ABP 数据包：缺少 manifest 清单');
  }
  if (manifest.schemaVersion !== ABP_SCHEMA_VERSION) {
    throw new Error(
      `无效的 ABP manifest：不支持的 schemaVersion (${String(manifest.schemaVersion)}，期望 ${ABP_SCHEMA_VERSION})`
    );
  }
  for (const field of ['id', 'slug', 'colSlug', 'title', 'entryPoint'] as const) {
    if (typeof manifest[field] !== 'string' || !manifest[field]) {
      throw new Error(`无效的 ABP manifest：缺少合法 ${field} 字段`);
    }
  }
  if (!Array.isArray(manifest.sections)) {
    throw new Error('无效的 ABP manifest：sections 必须为数组');
  }
  if (!obj.chapters || typeof obj.chapters !== 'object' || Array.isArray(obj.chapters)) {
    throw new Error('无效的 ABP 数据包：chapters 必须为章节映射对象');
  }
  const chapters = obj.chapters as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(chapters, manifest.entryPoint as string)) {
    throw new Error(`无效的 ABP 数据包：chapters 中缺少入口章节 ${String(manifest.entryPoint)}`);
  }
  for (const [slugKey, payload] of Object.entries(chapters)) {
    if (!payload || typeof payload !== 'object') {
      throw new Error(`无效的 ABP 章节载荷：${slugKey}`);
    }
    const p = payload as Record<string, unknown>;
    if (typeof p.html !== 'string' || typeof p.title !== 'string') {
      throw new Error(`无效的 ABP 章节载荷（缺少 title 或 html）：${slugKey}`);
    }
  }
  for (const sec of manifest.sections) {
    if (!sec || typeof sec !== 'object' || !Array.isArray((sec as any).chapters)) {
      throw new Error('无效的 ABP manifest：section 条目缺少 chapters 数组');
    }
    const secAny = sec as any;
    if (typeof secAny.introSlug === 'string' && secAny.introSlug.trim()) {
      if (!Object.prototype.hasOwnProperty.call(chapters, secAny.introSlug)) {
        throw new Error(`无效的 ABP manifest：section 引用了不存在的导语章节 ${String(secAny.introSlug)}`);
      }
    }
    for (const ch of secAny.chapters) {
      if (!ch || typeof ch.slug !== 'string' || !Object.prototype.hasOwnProperty.call(chapters, ch.slug)) {
        throw new Error(`无效的 ABP manifest：section 引用了不存在的章节 ${String(ch?.slug)}`);
      }
    }
  }
  return raw as AbpBundlePayload;
}
