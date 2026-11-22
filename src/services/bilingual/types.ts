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

export interface SemanticParagraph {
  id: string;
  index: number;
  text: string;
  rawText?: string;
  type: ParagraphStructuralType;
  sectionContext?: string;
  formulas?: string[];
  lang?: 'en' | 'zh' | 'other' | 'auto';
  parentBlockId?: string;
  isFragment?: boolean;
}

export type ParagraphToken = SemanticParagraph;

export interface ParagraphLink {
  sourceIndex: number;
  sourceId: string;
  targetIndex: number;
  targetId: string;
  similarity: number;
  adjustedScore?: number;
  isPrimary?: boolean;
  matchRelation?: 'one_to_one' | 'one_to_many' | 'many_to_one';
  confidenceLevel?: 'high' | 'medium' | 'weak';
}

export interface AlignmentMatrixResult {
  sourceParagraphs: SemanticParagraph[];
  targetParagraphs: SemanticParagraph[];
  matrix: number[][];
  links: ParagraphLink[];
  unmatchedSourceIds?: string[];
  unmatchedTargetIds?: string[];
  calibratedThreshold?: number;
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
