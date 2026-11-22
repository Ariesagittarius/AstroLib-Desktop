/**
 * src/core/knowledge/types.ts
 * ============================================================================
 * AstroLib 统一知识库协议契约 (Unified Knowledge Registry & Document Adapters)
 * ============================================================================
 * 职责：
 * 1. 解耦 MDX 源码教材、pdf2abp 编译包、EPUB 电子书与 MinerU 学术文献四种内容来源；
 * 2. 提供一致的文档元数据、分层目录树 (Outline)、语义块 (Blocks) 与全文检索模型；
 * 3. 保持纯 TypeScript 接口定义，严禁依赖 UI 或前端框架状态。
 * ============================================================================
 */

export type KnowledgeEntityKind = 'book' | 'paper';

export type KnowledgeSourceFormat = 'mdx' | 'abp' | 'epub' | 'paper';

export interface KnowledgeDocumentSummary {
  /** 规范唯一 URI，如 astrolib://math/math_analysis 或 astrolib://paper/task_xxx */
  uri: string;
  /** 内部唯一键，如 book:math-math_analysis 或 paper:task_xxx */
  id: string;
  kind: KnowledgeEntityKind;
  sourceFormat: KnowledgeSourceFormat;
  colSlug: string;
  /** 书籍为 bookSlug，文献为 taskId */
  slug: string;
  title: string;
  author?: string;
  publisher?: string;
  edition?: string;
  category: string;
  subject?: string;
  description?: string;
  tags?: string[];
  sectionCount: number;
  entrySectionId?: string;
  status: 'ready' | 'processing' | 'idle' | 'error';
  updatedAt?: number;
  pageCount?: number;
  imageCount?: number;
  /** 物理根路径（仅后端内部使用，不对外部透出敏感路径） */
  sourceRoot?: string;
}

export interface KnowledgeOutlineNode {
  id: string;
  title: string;
  slug: string;
  depth: number;
  kind: 'section' | 'chapter' | 'heading' | 'page';
  uri: string;
  pageRange?: string;
  wordCount?: number;
  children?: KnowledgeOutlineNode[];
}

export type KnowledgeBlockKind =
  | 'heading'
  | 'paragraph'
  | 'card'
  | 'math'
  | 'figure'
  | 'table'
  | 'footnote'
  | 'list'
  | 'code'
  | 'quote';

export interface KnowledgeBlock {
  id: string;
  kind: KnowledgeBlockKind;
  title?: string;
  tag?: string;
  text: string;
  latex?: string;
  imageUrl?: string;
  localImagePath?: string;
  page?: number;
  lineStart?: number;
  lineEnd?: number;
  uri: string;
}

export interface KnowledgeSectionImage {
  alt: string;
  url: string;
  localPath?: string;
}

export interface KnowledgeSectionContent {
  uri: string;
  docUri: string;
  docTitle: string;
  kind: KnowledgeEntityKind;
  sourceFormat: KnowledgeSourceFormat;
  sectionId: string;
  sectionTitle: string;
  pageRange?: string;
  totalBlocks: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  blocks: KnowledgeBlock[];
  plainText: string;
  markdown?: string;
  images: KnowledgeSectionImage[];
  prevSectionId?: string;
  nextSectionId?: string;
}

export interface KnowledgeSearchHit {
  uri: string;
  docUri: string;
  docTitle: string;
  kind: KnowledgeEntityKind;
  sourceFormat: KnowledgeSourceFormat;
  colSlug: string;
  docSlug: string;
  sectionId: string;
  sectionTitle: string;
  blockId?: string;
  snippet: string;
  lineNumber?: number;
  page?: number;
  score: number;
  matchSource: 'ripgrep' | 'ai-index' | 'knowledge-index' | 'markdown';
}

export interface ReadSectionOptions {
  offset?: number;
  limit?: number;
  includeMarkdown?: boolean;
}

export interface SearchKnowledgeOptions {
  kind?: 'all' | KnowledgeEntityKind;
  format?: 'all' | KnowledgeSourceFormat;
  colSlug?: string;
  docSlug?: string;
  regex?: boolean;
  limit?: number;
}

export interface IKnowledgeAdapter {
  readonly adapterId: string;
  readonly supportedFormats: readonly KnowledgeSourceFormat[];

  listDocuments(): KnowledgeDocumentSummary[];
  supportsDocument(uriOrId: string): boolean;
  getOutline(uriOrId: string): KnowledgeOutlineNode[] | null;
  readSection(
    uriOrId: string,
    sectionId?: string,
    options?: ReadSectionOptions
  ): KnowledgeSectionContent | null;
  search(query: string, options?: SearchKnowledgeOptions): KnowledgeSearchHit[];
  invalidateCache?(): void;
}
