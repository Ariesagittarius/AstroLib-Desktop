import type { ChapterHeadingItem } from '../../types/content-package.ts';
import type { BookCatalog } from '../catalog/book-catalog.mjs';

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: number;
}

export interface BookSummary {
  id: string;
  slug: string;
  colSlug: string;
  title: string;
  author?: string;
  publisher?: string;
  edition?: string;
  subject?: string;
  stage?: string;
  category?: string;
  cover?: string;
  entryPoint?: string;
  tags?: string[];
  trackClasses?: string[];
  sourceDir: string;
  hasAbpPack?: boolean;
  sourceFormat?: 'mdx' | 'abp' | 'epub' | 'markdown' | 'custom';
}

export type AstNodeType =
  | 'heading'
  | 'paragraph'
  | 'math_block'
  | 'card'
  | 'exercise'
  | 'list'
  | 'code_block'
  | 'table'
  | 'quote';

export interface AstDocumentNode {
  id: string;
  type: AstNodeType;
  level?: number;
  tag?: string;
  kind?: string;
  title?: string;
  summary: string;
  preview?: string;
  rawMdx?: string;
  latex?: string;
  contentLength: number;
  lineStart: number;
  lineEnd: number;
  parentRefId?: string;
  children?: AstDocumentNode[];
}

export interface ChapterNodeReadResult {
  success: boolean;
  id: string;
  type: AstNodeType;
  title?: string;
  tag?: string;
  kind?: string;
  lineStart: number;
  lineEnd: number;
  chapterTitle: string;
  chapterSlug: string;
  bookSlug: string;
  colSlug: string;
  uri: string;
  rawMdx: string;
  latex?: string;
  summary: string;
  parentRefId?: string;
  childrenCount: number;
  error?: string;
}

export interface AcademicCardNode {
  id: string;
  tag: string;
  type: 'theorem' | 'definition' | 'example' | 'solution' | 'proof' | 'remark' | 'card';
  title?: string;
  content: string;
  rawMdx: string;
  order: number;
  lineStart: number;
  lineEnd: number;
}

export interface MathFormulaNode {
  id: string;
  latex: string;
  displayMode: 'inline' | 'block';
  line: number;
}

export interface ParagraphNode {
  index: number;
  text: string;
  lineStart: number;
  lineEnd: number;
  cardRefId?: string;
}

export interface ChapterAstData {
  colSlug: string;
  bookSlug: string;
  chapterSlug: string;
  title: string;
  rawSlug: string;
  filePath: string;
  uri?: string;

  tree: AstDocumentNode[];

  headings: ChapterHeadingItem[];
  cards: AcademicCardNode[];
  formulas: MathFormulaNode[];
  paragraphs: ParagraphNode[];
  readingTimeMinutes: number;
  wordCount: number;
  rawMdx?: string;
}

export interface ExerciseItem {
  id: string;
  number?: string;
  title?: string;
  section?: string;
  chapterSlug?: string;
  question: string;
  options?: string[];
  answer?: string;
  solution?: string;
  communityAiSolutions?: Array<{
    provider: string;
    model: string;
    content: string;
    rating?: number;
  }>;
  sourceBook?: string;
  sourceFile?: string;
}

export interface MineruTaskData {
  bookHash: string;
  dirPath: string;
  pdfPath?: string;
  fullMarkdownPath?: string;
  layoutJsonPath?: string;
  tocSamplePath?: string;
  imagesDir?: string;
  imageCount: number;
  hasFullMarkdown: boolean;
  hasLayoutJson: boolean;
  sampleToc?: string;
}

export interface IContentMutationService {

  saveChapterMdx(
    colSlug: string,
    bookSlug: string,
    chapterSlug: string,
    content: string
  ): Promise<{ success: boolean; bytesWritten: number }>;

  packBookAbp(
    colSlug: string,
    bookSlug: string
  ): Promise<{ success: boolean; outputPath: string; manifestPath: string }>;

  importBookFromMineru(params: {
    colSlug: string;
    bookSlug: string;
    title: string;
    mineruDir: string;
  }): Promise<{ success: boolean; bookPath: string }>;

  addAnnotation?(params: {
    colSlug: string;
    bookSlug: string;
    chapterSlug: string;
    cardId?: string;
    paragraphIndex?: number;
    text: string;
    annotation: string;
  }): Promise<{ annotationId: string }>;
}
