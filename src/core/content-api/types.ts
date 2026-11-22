/**
 * src/core/content-api/types.ts
 * ============================================================================
 * AstroLib 统一内部内容数据 API (Content-as-an-API) 类型契约定义
 * ============================================================================
 * 遵循架构规范：
 * - 纯 TypeScript 接口声明，严禁依赖 UI 组件或运行层
 * - 支持外部脚本、CLI、MCP 工具与 Agent 闭环消费
 * - 保留写层面的抽象契约 (IContentMutationService) 供后续扩展圈画与批注
 * ============================================================================
 */

import type { ChapterHeadingItem } from '../../types/content-package.ts';
import type { BookCatalog } from '../catalog/book-catalog.mjs';

/**
 * 统一 API 响应格式
 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: number;
}

/**
 * 图书元数据摘要
 */
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

/**
 * AST 真实语法节点类型定义
 */
export type AstNodeType =
  | 'heading'      // 标题 (H1..H6)
  | 'paragraph'    // 正文段落
  | 'math_block'   // 独立行间公式块 ($$ ... $$)
  | 'card'         // 学术卡片模块 (<Example>, <Theorem>, <Knowledge>, <Solution>, <Note>, etc.)
  | 'exercise'     // 课后习题/练习块
  | 'list'         // 列表块 (ul / ol)
  | 'code_block'   // 代码块 (``` ... ```)
  | 'table'        // 表格
  | 'quote';       // 引用块 (> ...)

/**
 * 篇章统一抽象语法树节点 (真正的层次化 AST Document Node)
 */
export interface AstDocumentNode {
  id: string;              // 唯一稳定 ID，如 "h2-16", "p-18", "math-20", "card-28-example", "card-31-solution"
  type: AstNodeType;       // 节点语法性质
  level?: number;          // 针对 heading: 1..6
  tag?: string;            // 针对 card: 'Example', 'Knowledge', 'Theorem', 'Solution', 'Note', etc.
  kind?: string;           // 语义归类: 'example', 'theorem', 'definition', 'solution', 'remark', 'axiom', etc.
  title?: string;          // 标题或模块名: 如 "6.2.1 高阶导数计算", "例 6.2.1", "解"
  summary: string;         // 抽象层智能定性描述 (50-100字，定性概括该段落/公式/模块的学术属性与核心内容)
  preview?: string;        // 节点原文节选 (前 150 字符，用于概览)
  rawMdx?: string;         // 完整原文 (若节点较小或显式要求提供)
  latex?: string;          // 针对公式节点或公式卡片: 完整精确的 LaTeX 表达
  contentLength: number;   // 原文字符总长度
  lineStart: number;       // MDX 起始行号 (1-based)
  lineEnd: number;         // MDX 结束行号 (1-based)
  parentRefId?: string;    // 父节点 ID
  children?: AstDocumentNode[]; // 子节点列表，严格体现正文层级树 (Section -> Paragraphs / Formulas / Cards -> Solution / Sub-formulas)
}

/**
 * 节点精准读取响应模型 (Content Node Read Result)
 */
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

/**
 * 学术卡片 AST 节点 (向后兼容)
 */
export interface AcademicCardNode {
  id: string;
  tag: string; // 例如: 'Theorem', 'Definition', 'Example', 'Solution', 'Proof', 'Remark'
  type: 'theorem' | 'definition' | 'example' | 'solution' | 'proof' | 'remark' | 'card';
  title?: string;
  content: string; // 卡片内部正文内容
  rawMdx: string; // 完整标签包裹块
  order: number;
  lineStart: number;
  lineEnd: number;
}

/**
 * 数学公式 AST 节点 (向后兼容)
 */
export interface MathFormulaNode {
  id: string;
  latex: string;
  displayMode: 'inline' | 'block';
  line: number;
}

/**
 * 正文段落 AST 节点 (向后兼容)
 */
export interface ParagraphNode {
  index: number;
  text: string;
  lineStart: number;
  lineEnd: number;
  cardRefId?: string; // 若段落位于某个卡片内部，指向该卡片 ID
}

/**
 * 章节 AST 结构化响应数据
 */
export interface ChapterAstData {
  colSlug: string;
  bookSlug: string;
  chapterSlug: string;
  title: string;
  rawSlug: string;
  filePath: string;
  uri?: string;
  // 核心：层次化正文真实语法树 (真正体现正文标题、段落、公式、模块层级)
  tree: AstDocumentNode[];
  // 保持向后兼容现有消费者
  headings: ChapterHeadingItem[];
  cards: AcademicCardNode[];
  formulas: MathFormulaNode[];
  paragraphs: ParagraphNode[];
  readingTimeMinutes: number;
  wordCount: number;
  rawMdx?: string;
}

/**
 * 习题实体模型
 */
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

/**
 * MinerU 文档解析元数据
 */
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

/**
 * 写操作与编译流水线抽象接口 (IContentMutationService)
 * 供后续批注、高亮圈画、动态习题绑定与一键入库扩展
 */
export interface IContentMutationService {
  /** 保存/替换章节 MDX 源码 */
  saveChapterMdx(
    colSlug: string,
    bookSlug: string,
    chapterSlug: string,
    content: string
  ): Promise<{ success: boolean; bytesWritten: number }>;

  /** 触发编译指定图书的 ABP 包 */
  packBookAbp(
    colSlug: string,
    bookSlug: string
  ): Promise<{ success: boolean; outputPath: string; manifestPath: string }>;

  /** 导入新的书籍（从 MinerU 产物目录） */
  importBookFromMineru(params: {
    colSlug: string;
    bookSlug: string;
    title: string;
    mineruDir: string;
  }): Promise<{ success: boolean; bookPath: string }>;

  /** 预留：为章节添加批注/高亮 */
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
