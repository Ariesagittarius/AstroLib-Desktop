/**
 * src/plugins/harness/types.ts
 * ============================================================================
 * AstroLib Harness 独立动态插件环境规范契约 (Plugin Specification Types)
 * ============================================================================
 * 规范：
 * 1. 严格解耦：严禁在编译期写死任何指令、别名与硬编码字典；
 * 2. 插件生命周期：提供标准的 activate / deactivate 钩子；
 * 3. 启发式能力：插件可自主提供 suggest 提示生成器（用于弹出候选建议列表）；
 * 4. 多重形态打通：单套插件同时提供用户斜杠指令、内联上下文转换器与 Agent Tools；
 * 5. 工具元信息契约：声明图标 (mdicon/svg/image)、源文件定位、风险等级与动作描述生成。
 * ============================================================================
 */

import type {
  AgentPermissionMode,
  ArtifactKind,
  ArtifactPythonResult,
  ToolIconSpec,
  ToolMetadata,
  ToolOverrideConfig,
  ToolPermissionDecision,
  ToolRiskLevel,
} from '../../features/harness/types.ts';

export type {
  AgentPermissionMode,
  ArtifactKind,
  ArtifactPythonResult,
  ToolIconSpec,
  ToolMetadata,
  ToolOverrideConfig,
  ToolPermissionDecision,
  ToolRiskLevel,
};

export interface BookMeta {
  colSlug: string;
  slug: string;
  title: string;
  subject?: string;
  category?: string;
  tags?: string[];
  description?: string;
  chaptersCount?: number;
}

export interface SuggestionItem {
  id: string;
  title: string;
  subtitle?: string;
  badge?: string;
  icon?: ToolIconSpec;
  fillCommand: string; // 用户点击该建议时填充并执行的指令
}

export interface ToolArtifactPayload {
  id?: string;
  kind?: ArtifactKind;
  title: string;
  badge: string;
  html?: string;
  markdown?: string;
  code?: string;
  patch?: string;
  diffStats?: { additions: number; deletions: number };
  pythonResult?: ArtifactPythonResult;
  canvasMode?: 'html' | 'svg' | 'interactive';
}

export interface ToolExecutionResult {
  toolName: string;
  command: string;
  success: boolean;
  summary: string;
  cardHtml: string;
  contextText: string;
  artifact?: ToolArtifactPayload;
  sideEffectTab?: 'artifacts' | 'diff' | 'terminal' | 'catalog';
  /** 可选：通知前端是否应在对话正文内渲染特定内联卡片（如 canvas_card / pdf2abp_launcher） */
  inlineWidget?:
    | { type: 'canvas_card'; artifactId: string; title: string; mode?: string }
    | { type: 'pdf2abp_launcher'; prefillPdfPath?: string };
  /** 可选：工具读取/截取的图像（经 AgentContextManager 按模型视觉上限路由注入） */
  visionImage?: {
    dataUrl: string;
    label: string;
    relPath?: string;
  };
}

export interface ChapterMetaItem {
  colSlug: string;
  bookSlug: string;
  bookTitle: string;
  chapterSlug: string;
  chapterTitle: string;
  filePath?: string;
}

export interface ApprovalRequestPayload {
  toolName: string;
  label: string;
  reason: string;
  targetPath?: string;
}

export interface ToolExecutionContext {
  books: BookMeta[];
  chapters?: ChapterMetaItem[];
  fetchFn?: typeof fetch;
  permissionMode?: AgentPermissionMode;
  customPythonPath?: string;
  requestApproval?: (
    req: ApprovalRequestPayload
  ) => Promise<'approved-once' | 'approved-full' | 'denied'>;
  updateArtifact?: (title: string, badge: string, html: string) => void;
  recordArtifact?: (artifact: ToolArtifactPayload, activate?: boolean) => string | undefined;
  switchTab?: (tab: 'artifacts' | 'diff' | 'terminal' | 'catalog') => void;
  executeCommand?: (cmd: string) => Promise<void>;
  getArtifact?: (id: string) => any;
  requestUserQuestions?: (payload: {
    title?: string;
    questions: Array<{
      id: string;
      question: string;
      multiSelect?: boolean;
      allowCustom?: boolean;
      options: Array<{ label: string; description?: string; recommended?: boolean }>;
    }>;
  }) => Promise<{ status: 'submitted' | 'skipped'; answers: Record<string, string | string[]> }>;
  onPythonPackagesChanged?: (packages: Array<{ name: string; version: string }>) => void;
  customData?: Record<string, any>;
}

export interface InlineCommandMatch {
  raw: string;
  cmd: string;
  args: string;
  startIndex: number;
  endIndex: number;
  pluginId: string;
}

/**
 * 启发式候选建议生成器接口
 */
export type SuggestionProvider = (
  query: string,
  ctx: ToolExecutionContext
) => Promise<SuggestionItem[]> | SuggestionItem[];

/**
 * 指令定义契约 (CommandDefinition)
 */
export interface CommandDefinition {
  /** 触发指令，以 / 开头，例如 '/toc' */
  command: string;
  /** 可选别名，例如 ['/outline', '/contents'] */
  aliases?: string[];
  /** 人类可读名称 */
  displayName: string;
  /** 功能描述 */
  description: string;
  /** 参数提示，例如 '<教材名称/序号>' */
  usage?: string;
  /** 图标定义 */
  icon?: ToolIconSpec;
  /** 启发式下拉提示提供者（打出指令后弹出建议列表让用户选择） */
  suggest?: SuggestionProvider;
  /** 指令执行函数 */
  execute: (args: string, ctx: ToolExecutionContext) => Promise<ToolExecutionResult>;
}

/**
 * Agent 层面工具调用契约 (AgentToolDefinition - 对齐 OpenAI Function Calling)
 */
export interface AgentToolDefinition {
  name: string;
  displayName?: string;
  description: string;
  category?: string;
  icon?: ToolIconSpec;
  sourceFile?: string;
  riskLevel?: ToolRiskLevel;
  /** 将结构化入参映射为平实中文动作描述（用于地铁式线性导览图展示） */
  formatActionLabel?: (args: Record<string, any>) => string;
  exposeAsSlashCommand?: string;
  parameters: Record<string, any>;
  execute: (args: Record<string, any>, ctx: ToolExecutionContext) => Promise<ToolExecutionResult>;
}

/**
 * 宿主环境向插件注入的上下文能力 (PluginContext)
 */
export interface PluginContext {
  /** 注册一条用户指令 */
  registerCommand: (cmd: CommandDefinition) => void;
  /** 注册一个大模型工具函数 */
  registerTool: (tool: AgentToolDefinition) => void;
  /** 获取当前图书列表缓存 */
  getBooks: () => BookMeta[];
  /** 注册全局销毁资源释放逻辑 */
  subscriptions: { push: (disposable: { dispose: () => void }) => void };
}

/**
 * 独立插件契约 (HarnessPlugin)
 */
export interface HarnessPlugin {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  sourceFile?: string;
  activate: (context: PluginContext) => Promise<void> | void;
  deactivate?: () => Promise<void> | void;
}
