export type KnowledgeEntityKind = 'book' | 'paper';

export type KnowledgeSourceFormat = 'mdx' | 'abp' | 'epub' | 'paper';

export interface KnowledgeDocumentSummary {

  uri: string;

  id: string;
  kind: KnowledgeEntityKind;
  sourceFormat: KnowledgeSourceFormat;
  colSlug: string;

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
