/**
 * src/features/harness/types.ts
 * ============================================================================
 * AstroLib 首屏 Agent Harness 核心领域模型与类型契约
 * ============================================================================
 * 遵循 AGENTS.md Rule 1 / Rule 6：所有共享模型与状态类型集中维护于领域层。
 * ============================================================================
 */

export type AgentPermissionMode = 'read-only' | 'workspace' | 'full';

export type ToolRiskLevel = 'read' | 'workspace' | 'system';

export type ToolPermissionDecision = 'allow' | 'prompt' | 'deny';

export interface ToolIconSpec {
  type: 'mdicon' | 'svg' | 'image';
  value: string;
}

export interface ToolOverrideConfig {
  enabled?: boolean;
  icon?: ToolIconSpec;
  description?: string;
  displayName?: string;
}

export interface ToolMetadata {
  name: string;
  displayName: string;
  description: string;
  defaultDescription: string;
  category: string;
  pluginId: string;
  pluginName: string;
  sourceFile: string;
  riskLevel: ToolRiskLevel;
  icon: ToolIconSpec;
  defaultIcon: ToolIconSpec;
  parameters: Record<string, any>;
  slashCommand?: string;
  enabled: boolean;
  allowedInCurrentMode: ToolPermissionDecision;
}

export type TurnStepStatus =
  | 'running'
  | 'completed'
  | 'error'
  | 'aborted'
  | 'pending-approval'
  | 'denied';

export interface ThinkingStep {
  id: string;
  kind: 'thinking';
  content: string;
  startedAt: number;
  endedAt?: number;
  status: TurnStepStatus;
  expanded?: boolean;
}

export interface ToolCallStep {
  id: string;
  kind: 'tool';
  toolName: string;
  label: string;
  icon: ToolIconSpec;
  args: Record<string, any>;
  resultSummary?: string;
  resultText?: string;
  status: TurnStepStatus;
  startedAt: number;
  endedAt?: number;
  artifactId?: string;
  errorMessage?: string;
  expanded?: boolean;
}

export interface ApprovalStep {
  id: string;
  kind: 'approval';
  toolName: string;
  label: string;
  reason: string;
  targetPath?: string;
  status: 'pending' | 'approved-once' | 'approved-full' | 'denied';
  createdAt: number;
  resolvedAt?: number;
}

export interface CompleteStep {
  id: string;
  kind: 'complete';
  label: string;
  status: 'completed' | 'aborted' | 'error';
  timestamp: number;
}

export type TurnStep = ThinkingStep | ToolCallStep | ApprovalStep | CompleteStep;

export interface ThinkingBlock {
  id: string;
  kind: 'thinking';
  stepId: string;
  content: string;
  startedAt: number;
  endedAt?: number;
  status: TurnStepStatus;
  expanded?: boolean;
}

export interface ToolBlock {
  id: string;
  kind: 'tool';
  stepId: string;
  toolName: string;
  label: string;
  icon: ToolIconSpec;
  args: Record<string, any>;
  resultSummary?: string;
  resultText?: string;
  status: TurnStepStatus;
  startedAt: number;
  endedAt?: number;
  artifactId?: string;
  errorMessage?: string;
  expanded?: boolean;
}

export interface ApprovalBlock {
  id: string;
  kind: 'approval';
  stepId: string;
  toolName: string;
  label: string;
  reason: string;
  targetPath?: string;
  status: 'pending' | 'approved-once' | 'approved-full' | 'denied';
  createdAt: number;
  resolvedAt?: number;
}

export interface TextBlock {
  id: string;
  kind: 'text';
  markdown: string;
  startedAt: number;
  endedAt?: number;
  status: 'streaming' | 'completed' | 'aborted' | 'error';
}

export interface WidgetBlock {
  id: string;
  kind: 'widget';
  widgetType: 'canvas' | 'astro-ui' | 'pdf2abp' | 'python' | 'image';
  artifactId?: string;
  jobId?: string;
  imageUrl?: string;
  alt?: string;
  caption?: string;
  rawJson?: string;
  createdAt: number;
}

export interface QuestionOption {
  label: string;
  description?: string;
  recommended?: boolean;
}

export interface QuestionItem {
  id: string;
  question: string;
  multiSelect?: boolean;
  allowCustom?: boolean;
  options: QuestionOption[];
}

export interface QuestionBlock {
  id: string;
  kind: 'question';
  questionId: string;
  title?: string;
  questions: QuestionItem[];
  status: 'pending' | 'submitted' | 'skipped';
  answers?: Record<string, string | string[]>;
  createdAt: number;
  resolvedAt?: number;
}

export interface StatusBlock {
  id: string;
  kind: 'status';
  tone: 'info' | 'warning' | 'error' | 'completed';
  label: string;
  detail?: string;
  action?: 'continue-exploring' | 'retry';
  timestamp: number;
}

export type TurnBlock =
  | ThinkingBlock
  | ToolBlock
  | ApprovalBlock
  | TextBlock
  | WidgetBlock
  | QuestionBlock
  | StatusBlock;

export interface StructuredTurn {
  id: string;
  startedAt: number;
  endedAt?: number;
  status: 'streaming' | 'completed' | 'aborted' | 'error';
  providerDisplayName?: string;
  steps: TurnStep[];
  /** 自然时间序渲染块（思考 / 工具 / 正文 / 组件交错） */
  blocks?: TurnBlock[];
  contentMarkdown: string;
  errorMessage?: string;
  /** undefined: follow settingsStore.autoCollapseTrace; boolean: user manual override */
  collapseSummaryOverride?: boolean;
}

export interface CanvasTelemetrySnapshot {
  updatedAt: number;
  consoleErrors: string[];
  runtimeExceptions: string[];
  overflowX: boolean;
  overflowY: boolean;
  katexLoaded: boolean;
  katexNodeCount: number;
  katexErrorCount: number;
  bodyTextLength: number;
  cssVarCount: number;
  cspActive: boolean;
  viewportWidth: number;
  viewportHeight: number;
}

export interface ImageAttachment {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  source?: 'upload' | 'paste' | 'drop' | 'workspace';
  workspacePath?: string;
}

export interface QuoteSnippet {
  id: string;
  messageId: string;
  authorLabel: string;
  text: string;
  createdAt: number;
}

export interface QueuedFollowupMessage {
  id: string;
  rawText: string;
  quotes?: QuoteSnippet[];
  images?: ImageAttachment[];
  createdAt: number;
}

export type WebSearchProviderKind = 'none' | 'tavily' | 'bocha' | 'searxng' | 'custom';

export interface WebSearchConfig {
  enabled: boolean;
  provider: WebSearchProviderKind;
  apiKey?: string;
  baseUrl?: string;
  maxResults?: number;
}

export type ArtifactKind = 'pdf2abp' | 'canvas' | 'ast' | 'python' | 'diff' | 'markdown';

export interface ArtifactVersion {
  version: number;
  timestamp: number;
  code?: string;
  html?: string;
  summary?: string;
}

export interface ArtifactPythonResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  scriptPath?: string;
  images: Array<{ name: string; url: string }>;
}

export interface ArtifactItem {
  id: string;
  kind: ArtifactKind;
  title: string;
  badge: string;
  createdAt: number;
  updatedAt: number;
  sourceCommand?: string;
  html?: string;
  markdown?: string;
  code?: string;
  patch?: string;
  diffStats?: { additions: number; deletions: number };
  pythonResult?: ArtifactPythonResult;
  pdf2abpJobId?: string;
  canvasMode?: 'html' | 'svg' | 'interactive';
  canvasTelemetry?: CanvasTelemetrySnapshot;
  screenshotDataUrl?: string;
  versions?: ArtifactVersion[];
  activeVersionIndex?: number;
}

export interface ModelOption {
  id: string;
  name: string;
  reasoningEffort?: 'off' | 'low' | 'medium' | 'high' | 'max';
  desc?: string;
  badge?: string;
  supportsVision?: boolean;
  maxImagesPerRequest?: number;
  maxContextTokens?: number;
  defaultMaxOutputTokens?: number;
}

export interface ProviderConfig {
  id: string;
  displayName: string;
  isCustom?: boolean;
  isAccount?: boolean;
  status: 'connected' | 'configured' | 'unconfigured';
  api: 'openai-completions' | 'gemini' | 'antigravity-cli';
  baseURL: string;
  apiKey?: string;
  headers?: Record<string, string>;
  models: ModelOption[];
  defaultModelId: string;
  desc?: string;
}

export interface HarnessSettingsState {
  providers: ProviderConfig[];
  currentProviderId: string;
  currentModelId: string;
  currentModelLabel: string;
  currentReasoningEffort: string;
  defaultReasoningEffort: 'high' | 'low' | 'off';
  tokenWindowLimit: number;
  maxAgentRounds?: number;
  customAgentPythonPath?: string;
  webSearch?: WebSearchConfig;
  systemPrompt: string;
  permissionMode: AgentPermissionMode;
  autoCollapseTrace: boolean;
  toolOverrides: Record<string, ToolOverrideConfig>;
}
