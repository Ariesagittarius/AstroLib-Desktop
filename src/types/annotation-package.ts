/**
 * src/types/annotation-package.ts
 * ============================================================================
 * AstroLib 书籍批注、数位板手写与自由画布笔记标准化包契约 (AstroNote Package / ANP)
 * ============================================================================
 * 遵循架构规范：
 * - Layer 2 (Domain Model & Package Schema)
 * - 纯 TypeScript 接口与无副作用校验/合并函数，严禁依赖 UI 或服务端运行层
 * - 遵循 Rule 1 (UI is not a domain model) & Rule 3 (Source of Truth)
 * - 遵循 Type-Narrowing 门禁：严禁使用 'literal' | string 或 (string & {}) 宽泛联合
 * ============================================================================
 */

import type { AstNodeType } from '../core/content-api/types.ts';

export const ANP_SCHEMA_VERSION = '1.0.0' as const;

/**
 * 文本引用选择器（用于段落内容变动时的自愈再锚定）
 */
export interface TextQuoteSelector {
  exact: string;
  prefix?: string;
  suffix?: string;
}

/**
 * 文本字符偏移选择器（基于 AST 节点纯文本偏移区间 [start, end)）
 */
export interface TextPositionSelector {
  start: number;
  end: number;
}

/**
 * 批注与教材 AST 语法树外接锚点
 */
export interface AstNodeAnchor {
  colSlug: string;
  bookSlug: string;
  chapterSlug: string;
  nodeId: string;
  uri: string;
  nodeType?: AstNodeType;
  quote?: TextQuoteSelector;
  position?: TextPositionSelector;
}

/**
 * 1. 段落/句子高亮批注
 */
export interface HighlightAnnotation {
  id: string;
  kind: 'highlight';
  anchor: AstNodeAnchor;
  color: string;
  note?: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

/**
 * 2. 学术侧注（支持 Markdown + LaTeX 公式，可折叠展开）
 */
export interface SidenoteAnnotation {
  id: string;
  kind: 'sidenote';
  anchor: AstNodeAnchor;
  markdown: string;
  color: string;
  collapsed?: boolean;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

/**
 * 数位板/手写轨迹采样点
 * - 当 anchorMode === 'node-relative' 时，u, v 为所属 AST 节点矩形内归一化比例 [0, 1]
 * - 当 anchorMode === 'margin-offset' 时，u, v 为相对于最近邻 AST 节点左上角的未缩放逻辑偏移 (dx, dy)
 */
export interface InkPoint {
  u: number;
  v: number;
  pressure: number;
  tiltX?: number;
  tiltY?: number;
  t?: number;
}

export type InkAnchorMode = 'node-relative' | 'margin-offset';
export type InkToolType = 'pen' | 'highlighter';

/**
 * 3. 数位板手写批注（混合双层锚定）
 */
export interface InkStrokeAnnotation {
  id: string;
  kind: 'ink';
  anchorMode: InkAnchorMode;
  anchor: AstNodeAnchor;
  tool: InkToolType;
  color: string;
  strokeWidth: number;
  opacity: number;
  baseWidth: number;
  baseHeight: number;
  zoomScaleAtCreation: number;
  points: InkPoint[];
  createdAt: string;
  updatedAt: string;
}

/**
 * 单条附着于正文 AST 树的批注联合类型
 */
export type BookAnnotationItem =
  | HighlightAnnotation
  | SidenoteAnnotation
  | InkStrokeAnnotation;

export type CanvasBlockKind = 'markdown' | 'ast-quote';

export type CanvasBrushStyle = 'fountain' | 'monoline' | 'pencil';

/**
 * 章节自由画布中的内容卡片（支持自由 Markdown/LaTeX 笔记块与 AST 原文引用块）
 */
export interface CanvasNoteBlock {
  id: string;
  kind: CanvasBlockKind;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  markdown: string;
  astRef?: AstNodeAnchor & {
    rawMdx?: string;
    renderedHtml?: string;
    summary?: string;
    title?: string;
  };
  createdAt: string;
  updatedAt: string;
}

/**
 * 章节自由画布中的手写矢量图层笔画（画布逻辑坐标系）
 */
export interface CanvasInkStroke {
  id: string;
  tool: InkToolType;
  brushStyle?: CanvasBrushStyle;
  color: string;
  strokeWidth: number;
  opacity: number;
  points: InkPoint[];
  createdAt: string;
}

/**
 * 画布视口状态
 */
export interface CanvasViewportState {
  panX: number;
  panY: number;
  zoom: number;
}

/**
 * 4. 章节自由画布笔记容器
 */
export interface ChapterCanvasNote {
  chapterSlug: string;
  title: string;
  blocks: CanvasNoteBlock[];
  strokes: CanvasInkStroke[];
  viewport?: CanvasViewportState;
  updatedAt: string;
}

/**
 * 单章节批注与自由画布持久化完整载荷
 */
export interface ChapterAnnotationPayload {
  schemaVersion: typeof ANP_SCHEMA_VERSION;
  colSlug: string;
  bookSlug: string;
  chapterSlug: string;
  chapterTitle?: string;
  annotations: BookAnnotationItem[];
  canvasNote: ChapterCanvasNote;
  updatedAt: string;
}

/**
 * AstroNote Package (.anp / .anp.json) 整书或单章无损导入导出包
 */
export interface AstroNotePackagePayload {
  schemaVersion: typeof ANP_SCHEMA_VERSION;
  exportedAt: string;
  colSlug: string;
  bookSlug: string;
  bookTitle: string;
  chapters: Record<string, ChapterAnnotationPayload>;
}

/**
 * 供 Agent 只读感知的图书章节批注分布条目
 */
export interface BookChapterAnnotationStats {
  chapterSlug: string;
  chapterTitle?: string;
  uri: string;
  totalAnnotations: number;
  highlightsCount: number;
  sidenotesCount: number;
  inkStrokesCount: number;
  canvasBlocksCount: number;
  canvasInkStrokesCount: number;
  tags: string[];
  updatedAt: string;
}

/**
 * 供 Agent 全局感知的整书批注概览
 */
export interface BookAnnotationsOverview {
  colSlug: string;
  bookSlug: string;
  bookTitle: string;
  bookUri: string;
  totalAnnotatedChapters: number;
  totalAnnotations: number;
  highlightsCount: number;
  sidenotesCount: number;
  inkStrokesCount: number;
  canvasBlocksCount: number;
  canvasInkStrokesCount: number;
  allTags: Array<{ tag: string; count: number }>;
  chapters: BookChapterAnnotationStats[];
  recentHighlights: Array<{
    id: string;
    chapterSlug: string;
    nodeId: string;
    uri: string;
    exactText: string;
    color: string;
    updatedAt: string;
  }>;
  recentSidenotes: Array<{
    id: string;
    chapterSlug: string;
    nodeId: string;
    uri: string;
    markdown: string;
    quote?: string;
    updatedAt: string;
  }>;
  updatedAt: string;
}

/**
 * 批注条目外接的 AST 节点上下文摘要
 */
export interface AttachedAstNodeSummary {
  nodeId: string;
  type: AstNodeType;
  title?: string;
  tag?: string;
  kind?: string;
  summary: string;
  preview?: string;
  latex?: string;
  lineStart: number;
  lineEnd: number;
  uri: string;
}

/**
 * 带 AST 节点原文外接关联的单条批注（供 Agent 深度对照阅读）
 */
export interface EnrichedBookAnnotation {
  annotation: BookAnnotationItem;
  astNode: AttachedAstNodeSummary | null;
}

/**
 * 带 AST 节点外接关联的画布引用块
 */
export interface EnrichedCanvasBlock {
  block: CanvasNoteBlock;
  astNode: AttachedAstNodeSummary | null;
}

/**
 * 章节批注与 AST 节点外接组装结果（供 REST API 与 Agent 工具使用）
 */
export interface ChapterAnnotationsWithAstResult {
  colSlug: string;
  bookSlug: string;
  chapterSlug: string;
  chapterTitle: string;
  chapterUri: string;
  payload: ChapterAnnotationPayload;
  enrichedAnnotations: EnrichedBookAnnotation[];
  enrichedCanvasBlocks: EnrichedCanvasBlock[];
  summary: {
    highlightsCount: number;
    sidenotesCount: number;
    inkStrokesCount: number;
    canvasBlocksCount: number;
    canvasInkStrokesCount: number;
  };
}

/**
 * 跨书/单书批注检索命中条目
 */
export interface AnnotationSearchHit {
  hitType: 'highlight' | 'sidenote' | 'canvas-block';
  id: string;
  colSlug: string;
  bookSlug: string;
  chapterSlug: string;
  chapterTitle?: string;
  nodeId?: string;
  uri: string;
  matchedText: string;
  noteText?: string;
  tags: string[];
  updatedAt: string;
}

/**
 * 创建空的单章节批注载荷
 */
export function createEmptyChapterAnnotationPayload(
  colSlug: string,
  bookSlug: string,
  chapterSlug: string,
  chapterTitle?: string
): ChapterAnnotationPayload {
  const now = new Date().toISOString();
  return {
    schemaVersion: ANP_SCHEMA_VERSION,
    colSlug,
    bookSlug,
    chapterSlug,
    ...(chapterTitle ? { chapterTitle } : {}),
    annotations: [],
    canvasNote: {
      chapterSlug,
      title: chapterTitle ? `${chapterTitle} · 自由画布笔记` : `${chapterSlug} · 自由画布笔记`,
      blocks: [],
      strokes: [],
      viewport: { panX: 0, panY: 0, zoom: 1 },
      updatedAt: now,
    },
    updatedAt: now,
  };
}

function isRecord(val: unknown): val is Record<string, unknown> {
  return Boolean(val) && typeof val === 'object' && !Array.isArray(val);
}

function isValidAnchor(raw: unknown): raw is AstNodeAnchor {
  if (!isRecord(raw)) return false;
  return (
    typeof raw.colSlug === 'string' &&
    raw.colSlug.length > 0 &&
    typeof raw.bookSlug === 'string' &&
    raw.bookSlug.length > 0 &&
    typeof raw.chapterSlug === 'string' &&
    raw.chapterSlug.length > 0 &&
    typeof raw.nodeId === 'string' &&
    raw.nodeId.length > 0 &&
    typeof raw.uri === 'string'
  );
}

function isValidInkPoints(raw: unknown): raw is InkPoint[] {
  if (!Array.isArray(raw)) return false;
  return raw.every(
    (pt) =>
      isRecord(pt) &&
      typeof pt.u === 'number' &&
      Number.isFinite(pt.u) &&
      typeof pt.v === 'number' &&
      Number.isFinite(pt.v) &&
      typeof pt.pressure === 'number' &&
      Number.isFinite(pt.pressure)
  );
}

function isValidAnnotationItem(raw: unknown): raw is BookAnnotationItem {
  if (!isRecord(raw)) return false;
  if (typeof raw.id !== 'string' || !raw.id) return false;
  if (!isValidAnchor(raw.anchor)) return false;

  if (raw.kind === 'highlight') {
    return typeof raw.color === 'string' && raw.color.length > 0;
  }
  if (raw.kind === 'sidenote') {
    return typeof raw.markdown === 'string' && typeof raw.color === 'string';
  }
  if (raw.kind === 'ink') {
    return (
      (raw.anchorMode === 'node-relative' || raw.anchorMode === 'margin-offset') &&
      (raw.tool === 'pen' || raw.tool === 'highlighter') &&
      typeof raw.color === 'string' &&
      typeof raw.strokeWidth === 'number' &&
      typeof raw.opacity === 'number' &&
      typeof raw.baseWidth === 'number' &&
      typeof raw.baseHeight === 'number' &&
      typeof raw.zoomScaleAtCreation === 'number' &&
      isValidInkPoints(raw.points)
    );
  }
  return false;
}

function isValidCanvasNote(raw: unknown): raw is ChapterCanvasNote {
  if (!isRecord(raw)) return false;
  if (typeof raw.chapterSlug !== 'string' || typeof raw.title !== 'string') return false;
  if (!Array.isArray(raw.blocks) || !Array.isArray(raw.strokes)) return false;

  const blocksOk = raw.blocks.every(
    (b) =>
      isRecord(b) &&
      typeof b.id === 'string' &&
      b.id.length > 0 &&
      (b.kind === 'markdown' || b.kind === 'ast-quote') &&
      typeof b.x === 'number' &&
      typeof b.y === 'number' &&
      typeof b.width === 'number' &&
      typeof b.height === 'number' &&
      typeof b.markdown === 'string'
  );

  const strokesOk = raw.strokes.every(
    (s) =>
      isRecord(s) &&
      typeof s.id === 'string' &&
      s.id.length > 0 &&
      (s.tool === 'pen' || s.tool === 'highlighter') &&
      typeof s.color === 'string' &&
      typeof s.strokeWidth === 'number' &&
      typeof s.opacity === 'number' &&
      isValidInkPoints(s.points)
  );

  return blocksOk && strokesOk;
}

/**
 * 校验反序列化后的 .anp 数据包格式合法性
 */
export function validateAnpPackage(raw: unknown): AstroNotePackagePayload {
  if (!isRecord(raw)) {
    throw new Error('无效的 ANP 批注包：根节点必须为 JSON 对象');
  }
  if (raw.schemaVersion !== ANP_SCHEMA_VERSION) {
    throw new Error(
      `无效的 ANP 批注包：不支持的 schemaVersion (${String(raw.schemaVersion)}，期望 ${ANP_SCHEMA_VERSION})`
    );
  }
  for (const field of ['exportedAt', 'colSlug', 'bookSlug', 'bookTitle'] as const) {
    if (typeof raw[field] !== 'string' || !raw[field]) {
      throw new Error(`无效的 ANP 批注包：缺少合法 ${field} 字段`);
    }
  }
  if (!isRecord(raw.chapters)) {
    throw new Error('无效的 ANP 批注包：chapters 必须为章节映射对象');
  }

  for (const [slugKey, chapRaw] of Object.entries(raw.chapters)) {
    if (!isRecord(chapRaw)) {
      throw new Error(`无效的 ANP 章节批注载荷：${slugKey}`);
    }
    if (chapRaw.schemaVersion !== ANP_SCHEMA_VERSION) {
      throw new Error(`无效的 ANP 章节版本 (${slugKey})：${String(chapRaw.schemaVersion)}`);
    }
    if (
      typeof chapRaw.colSlug !== 'string' ||
      typeof chapRaw.bookSlug !== 'string' ||
      typeof chapRaw.chapterSlug !== 'string'
    ) {
      throw new Error(`无效的 ANP 章节标识 (${slugKey})：缺少 colSlug / bookSlug / chapterSlug`);
    }
    if (!Array.isArray(chapRaw.annotations) || !chapRaw.annotations.every(isValidAnnotationItem)) {
      throw new Error(`无效的 ANP 章节批注列表 (${slugKey})：存在字段格式不合法的批注项`);
    }
    if (!isValidCanvasNote(chapRaw.canvasNote)) {
      throw new Error(`无效的 ANP 章节自由画布结构 (${slugKey})`);
    }
  }

  return raw as unknown as AstroNotePackagePayload;
}

function pickNewerTimestamp(a: string, b: string): number {
  const ta = Date.parse(a || '') || 0;
  const tb = Date.parse(b || '') || 0;
  return tb >= ta ? 1 : -1;
}

/**
 * 基于 UUID 无损幂等合并同一章节的两份批注载荷
 */
export function mergeChapterAnnotationPayloads(
  existing: ChapterAnnotationPayload,
  incoming: ChapterAnnotationPayload
): ChapterAnnotationPayload {
  const annMap = new Map<string, BookAnnotationItem>();
  for (const item of existing.annotations) {
    annMap.set(item.id, item);
  }
  for (const item of incoming.annotations) {
    const prev = annMap.get(item.id);
    if (!prev || pickNewerTimestamp(prev.updatedAt, item.updatedAt) >= 0) {
      annMap.set(item.id, item);
    }
  }

  const blockMap = new Map<string, CanvasNoteBlock>();
  for (const b of existing.canvasNote.blocks) {
    blockMap.set(b.id, b);
  }
  for (const b of incoming.canvasNote.blocks) {
    const prev = blockMap.get(b.id);
    if (!prev || pickNewerTimestamp(prev.updatedAt, b.updatedAt) >= 0) {
      blockMap.set(b.id, b);
    }
  }

  const strokeMap = new Map<string, CanvasInkStroke>();
  for (const s of existing.canvasNote.strokes) {
    strokeMap.set(s.id, s);
  }
  for (const s of incoming.canvasNote.strokes) {
    if (!strokeMap.has(s.id)) {
      strokeMap.set(s.id, s);
    }
  }

  const now = new Date().toISOString();
  return {
    schemaVersion: ANP_SCHEMA_VERSION,
    colSlug: existing.colSlug || incoming.colSlug,
    bookSlug: existing.bookSlug || incoming.bookSlug,
    chapterSlug: existing.chapterSlug || incoming.chapterSlug,
    chapterTitle: incoming.chapterTitle || existing.chapterTitle,
    annotations: Array.from(annMap.values()),
    canvasNote: {
      chapterSlug: existing.chapterSlug || incoming.chapterSlug,
      title: incoming.canvasNote.title || existing.canvasNote.title,
      blocks: Array.from(blockMap.values()),
      strokes: Array.from(strokeMap.values()),
      viewport: incoming.canvasNote.viewport || existing.canvasNote.viewport,
      updatedAt: now,
    },
    updatedAt: now,
  };
}
