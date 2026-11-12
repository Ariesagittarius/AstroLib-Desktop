/**
 * src/types/content-package.ts
 * ============================================================================
 * AstroLib 标准化预编译语义包 (AstroBook Package / ABP) 核心契约定义
 * ============================================================================
 * 遵循架构规范：
 * - Layer 2 (Domain Model & Package Schema)
 * - 纯 TypeScript 接口声明，严禁依赖 UI 组件或运行层
 * - 遵循 Rule 1 (UI is not a domain model) & Rule 3 (Source of Truth)
 * ============================================================================
 */

import type { ModuleItemConfig, BookLanguageConfig } from './collections.ts';
import type { NoticeConfig } from './notices.ts';

export const ABP_SCHEMA_VERSION = '1.0.0' as const;

/**
 * 章节目录节点摘要 (TOC Node)
 */
export interface AstroBookChapterSummary {
  id: string;
  title: string;
  slug: string;
  path: string; // 相对包根目录的路径，例如 'chapters/01_intro.json'
  hash: string; // 内容 MD5 / SHA256 哈希，供增量同步使用
  sizeBytes: number;
  order?: number;
}

/**
 * 书籍大章节/分卷分区 (Section / Part / Chapter Level)
 */
export interface AstroBookSection {
  id: string;
  title: string;
  slug: string;
  collapsed?: boolean;
  order?: number;
  chapters: AstroBookChapterSummary[];
}

/**
 * 章节大纲标题项 (TOC Headings)
 */
export interface ChapterHeadingItem {
  depth: number;
  text: string;
  id: string;
}

/**
 * 章节详细有效负载 (Chapter Payload JSON)
 * 存放于 chapters/{slug}.json
 */
export interface AstroBookChapterPayload {
  schemaVersion: typeof ABP_SCHEMA_VERSION;
  bookId: string;
  bookSlug: string;
  colSlug: string;
  chapterSlug: string;
  title: string;
  html: string; // 经打包管线预渲染的语义 HTML（内嵌 KaTeX 纯 HTML 与卡片结构）
  headings: ChapterHeadingItem[];
  crossRefs?: Record<string, any>;
  notices?: NoticeConfig[];
  readingTimeMinutes?: number;
  exercises?: any[];
  aiChunks?: any[];
  updatedAt: string;
}

/**
 * 书籍主清单 (Book Manifest)
 * 存放于 manifest.json
 */
export interface AstroBookManifest {
  schemaVersion: typeof ABP_SCHEMA_VERSION;
  id: string;
  slug: string;
  colSlug: string; // 所属学科合集 slug，如 'math', 'physics', 'cs'
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
  entryPoint: string; // 默认入口章节 slug
  trackClasses?: string[];
  notices?: NoticeConfig[];
  modules?: Record<string, ModuleItemConfig>;
  languages?: BookLanguageConfig[];
  sections: AstroBookSection[];
  totalChapters: number;
  updatedAt: string;
  contentHash: string;
  assets?: string[]; // 包含的相对资产路径列表，如 ['images/fig_1_1.webp']
  hasEmbeddings?: boolean; // 是否内置语义向量
  embeddingMeta?: AstroBookEmbeddingMeta; // 向量元数据配置
}

/**
 * 向量嵌入元数据 (Embedding Metadata)
 */
export interface AstroBookEmbeddingMeta {
  model: string;              // 例如 'Xenova/bge-small-zh-v1.5'
  dim: number;                // 例如 512 或 384
  format: 'int8' | 'float32'; // 量化格式
  vectorCount: number;        // 向量总条数
  generatedAt: string;        // 生成时间戳
}

/**
 * 语义向量切片索引条目 (Vector Chunk Reference)
 */
export interface VectorChunkReference {
  id: string;                 // 切片唯一标识，例如 '01_intro-0'
  chapterSlug: string;        // 所在章节 slug
  title: string;              // 切片标题 / 概念名
  type: string;               // 卡片类型（'定理', '定义', '例题', etc.）
  anchor?: string;            // 跳转锚点
  textLength: number;         // 纯文本长度
  scale?: number;             // Int8 专属标量量化因子 (float32 时无此字段)
}

/**
 * 书库远程/本地条目信息 (Catalog Entry)
 */
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
  packFileName: string; // e.g. 'math-linear_algebra.abp'
  remotePackUrl?: string; // 完整下载链接
  contentHash: string;
  updatedAt: string;
}

/**
 * 书库总目录清单 (Library Catalog)
 * 托管在远程源 (如 GitHub Releases) 或本地维护的 catalog.json
 */
export interface LibraryCatalog {
  schemaVersion: typeof ABP_SCHEMA_VERSION;
  catalogName: string;
  sourceUrl?: string;
  generatedAt: string;
  books: CatalogBookEntry[];
}

/**
 * 本地已安装书籍元数据 (Installed Book Meta)
 */
export interface InstalledBookMeta {
  manifest: AstroBookManifest;
  installedAt: string;
  sourceType: 'local-file' | 'remote-repo' | 'pre-bundled';
  sourceUrl?: string;
  localPath?: string; // Electron 下有效
}
