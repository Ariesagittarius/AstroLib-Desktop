/**
 * src/types/library-entity.ts
 * ============================================================================
 * AstroLib 统一研读实体模型 (Unified Reading Entity & Library Specification)
 * ============================================================================
 * 规范：
 * 1. 严格践行“教材书籍与学术文献同级化”原则，使两者成为书库内的一等公民；
 * 2. 覆盖未来扩展类型（幻灯片 slides、研讨视频 videos）；
 * 3. 规范 Chrome 式标签页模型与 Windows 11 灵活分屏契约。
 * ============================================================================
 */

export type ReadingEntityKind = 'book' | 'paper' | 'slide' | 'video';

export type EntityStatus = 'ready' | 'processing' | 'error';

/**
 * 统一研读实体接口
 */
export interface UnifiedReadingEntity {
  id: string;                      // 唯一识别码，例如 "book:math-advanced-algebra" 或 "paper:task_173130283"
  kind: ReadingEntityKind;         // 实体门类
  title: string;                   // 主标题
  subtitle?: string;               // 副标题 / 原书英文名
  author?: string;                 // 著作者 / 机构
  publisher?: string;              // 出版单位 / 刊物 / 预印源 (arXiv, IEEE 等)
  cover?: string;                  // 封面图路径或自动生成的 SVG 矢量占位图
  category: string;                // 学科或领域分类 (math, physics, cs, telecom, general)
  shelfId?: string;                // 所属自定义书架 ID
  createdAt: number;               // 录入毫秒时间戳
  lastReadAt?: number;             // 最近研读毫秒时间戳
  readProgress?: number;           // 研读进度 (0.0 ~ 1.0)
  status: EntityStatus;            // 研读就绪状态
  statusMessage?: string;          // 进度详情（如 "MinerU 解析中 68%..."）

  // 专属元数据载荷
  metadata: {
    // 书籍专属 (kind: 'book')
    colSlug?: string;
    bookSlug?: string;
    entryPoint?: string;
    abpPackPath?: string;
    edition?: string;
    isbn?: string;

    // 文献专属 (kind: 'paper')
    taskId?: string;
    originPdfUrl?: string;
    markdownUrl?: string;
    hasBookmarks?: boolean;
    hasAnnotations?: boolean;
    fileSizeBytes?: number;
    totalPages?: number;
    doi?: string;
    year?: string;
  };
}

/**
 * 自定义书架模型
 */
export interface LibraryShelf {
  id: string;
  name: string;
  itemCount: number;
  createdAt: number;
}

/**
 * Fragment 3 标签页实例
 */
export interface TabItem {
  id: string;                      // 标签唯一 ID
  entityId: string;                // 关联的统一实体 ID
  kind: ReadingEntityKind;         // 实体门类
  title: string;                   // 标签显示标题
  url: string;                     // 视窗实际加载的完整 URL
  active: boolean;                 // 是否当前激活
  lastVisited?: number;
}

/**
 * 分屏布局模式
 */
export type SplitLayoutMode = 'single' | 'split-vertical' | 'split-horizontal' | 'grid-2x2';

/**
 * 分屏窗格
 */
export interface SplitPane {
  id: string;                      // 窗格 ID
  tabId: string | null;            // 挂载的 Tab ID
  ratio: number;                   // 宽度或高度占比 (默认 0.5)
}
