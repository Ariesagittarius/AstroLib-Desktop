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
  fillCommand: string;
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

  inlineWidget?:
    | { type: 'canvas_card'; artifactId: string; title: string; mode?: string }
    | { type: 'pdf2abp_launcher'; prefillPdfPath?: string };

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

export type SuggestionProvider = (
  query: string,
  ctx: ToolExecutionContext
) => Promise<SuggestionItem[]> | SuggestionItem[];

export interface CommandDefinition {

  command: string;

  aliases?: string[];

  displayName: string;

  description: string;

  usage?: string;

  icon?: ToolIconSpec;

  suggest?: SuggestionProvider;

  execute: (args: string, ctx: ToolExecutionContext) => Promise<ToolExecutionResult>;
}

export interface AgentToolDefinition {
  name: string;
  displayName?: string;
  description: string;
  category?: string;
  icon?: ToolIconSpec;
  sourceFile?: string;
  riskLevel?: ToolRiskLevel;

  formatActionLabel?: (args: Record<string, any>) => string;
  exposeAsSlashCommand?: string;
  parameters: Record<string, any>;
  execute: (args: Record<string, any>, ctx: ToolExecutionContext) => Promise<ToolExecutionResult>;
}

export interface PluginContext {

  registerCommand: (cmd: CommandDefinition) => void;

  registerTool: (tool: AgentToolDefinition) => void;

  getBooks: () => BookMeta[];

  subscriptions: { push: (disposable: { dispose: () => void }) => void };
}

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
