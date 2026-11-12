/**
 * src/services/bilingual/types.ts
 * ============================================================================
 * AstroLib 双语对照与跨书关联领域模型 (Bilingual & Cross-Doc Alignment Types)
 * ============================================================================
 * 遵循 Rule 1 (UI is not a domain model) & Rule 7 (Utils Purity)
 */

export type ParagraphStructuralType =
  | 'heading'
  | 'paragraph'
  | 'math'
  | 'code'
  | 'quote'
  | 'card'
  | 'theorem'
  | 'definition'
  | 'example'
  | 'table-cell'
  | 'list-item';

/**
 * 结构化语义段落单元 (Semantic Paragraph)
 * 保留稳定 ID、章节上下文、段落类型、公式源码、顺序索引与语言信息。
 */
export interface SemanticParagraph {
  id: string; // e.g. 'src-p-0', 'tgt-p-1'
  index: number;
  text: string; // 提取并规范化后的自然语言文本（完整保留 $formula$ 与 $$formula$$）
  rawText?: string; // 原始未清洗文本（含 HTML 标记或原始源码）
  type: ParagraphStructuralType;
  sectionContext?: string; // 所属章节或小节标题上下文（如 "0.3 Big-O notation"）
  formulas?: string[]; // 提取出的纯 LaTeX 公式列表
  lang?: 'en' | 'zh' | 'other' | 'auto';
  parentBlockId?: string; // 父级卡片或定理容器 ID（针对卡片内段落）
  isFragment?: boolean; // 是否属于 OCR/换行断裂产生的微碎片
}

/**
 * 兼容旧版 ParagraphToken 命名（完全向上兼容 SemanticParagraph）
 */
export type ParagraphToken = SemanticParagraph;

export interface ParagraphLink {
  sourceIndex: number;
  sourceId: string;
  targetIndex: number;
  targetId: string;
  similarity: number; // 0.0 - 1.0 原始余弦相似度
  adjustedScore?: number; // 结合上下文、结构类型、单调性偏置后的综合匹配分
  isPrimary?: boolean;
  matchRelation?: 'one_to_one' | 'one_to_many' | 'many_to_one';
  confidenceLevel?: 'high' | 'medium' | 'weak';
}

export interface AlignmentMatrixResult {
  sourceParagraphs: SemanticParagraph[];
  targetParagraphs: SemanticParagraph[];
  matrix: number[][]; // [M][N] 相似度矩阵
  links: ParagraphLink[]; // 过滤并排序后的显式连线
  unmatchedSourceIds?: string[]; // 未能达到阈值匹配的源段落集合
  unmatchedTargetIds?: string[]; // 未能达到阈值匹配的目标段落集合
  calibratedThreshold?: number; // 依据矩阵统计自动建议的校准阈值
  stats?: {
    min: number;
    max: number;
    mean: number;
    stdDev: number;
  };
  inferenceTimeMs: number;
  engine: string;
  modelId?: string;
  modelName?: string;
  dim?: number;
  device?: string;
  isFallback?: boolean;
  fallbackReason?: string;
}

export interface BilingualModelInfo {
  id: string;
  name: string;
  label: string;
  dim: number;
  description: string;
  isAvailable: boolean;
  provider: 'onnx-node' | 'python-qwen';
}

export interface TocMatchItem {
  sourceChapter: string;
  targetChapter: string;
  confidence: number;
  sourceTitle: string;
  targetTitle: string;
}

export interface TocMatchResult {
  matches: TocMatchItem[];
  unmatchedSource: string[];
  unmatchedTarget: string[];
}

export interface BilingualViewerState {
  activeSourceId: string | null;
  activeTargetIds: string[];
  hoveredSourceId: string | null;
  hoveredTargetId: string | null;
  threshold: number;
  isLockedScroll: boolean;
  isHeatmapOpen: boolean;
}
