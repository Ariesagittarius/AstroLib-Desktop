/**
 * src/features/harness/settings-store.ts
 * ============================================================================
 * AstroLib Agent Harness 统一配置持久化仓库 (Single Source of Truth)
 * ============================================================================
 * 职责：
 * 1. 统一管理模型服务商、当前模型、系统预设、三档权限模式、导览折叠策略与工具自定义覆写；
 * 2. 兼容读取既有 astrolib_harness_* 存储键，实现零断档平滑迁移；
 * 3. 在首屏 Harness 工作台与全局设置中心之间提供响应式订阅与 CustomEvent 双向同步。
 * ============================================================================
 */

import type {
  AgentPermissionMode,
  HarnessSettingsState,
  ProviderConfig,
  ToolOverrideConfig,
  WebSearchConfig,
} from './types.ts';

export const DEFAULT_HARNESS_SYSTEM_PROMPT =
  '你是由 Google Antigravity 启发的 AstroLib 理工科教辅学术 Agent。你擅长严密逻辑推导、数学公式推演、结构化卡片检索与习题深度解答。你的回答应当学术克制、精确客观，数学公式严格采用 LaTeX 格式（$...$ 或 $$...$$）呈现。';

export const STORAGE_KEYS = {
  PROVIDERS: 'astrolib_harness_providers_v1',
  ACTIVE_PROVIDER: 'astrolib_harness_active_provider',
  ACTIVE_MODEL: 'astrolib_harness_active_model',
  ACTIVE_LABEL: 'astrolib_harness_active_label',
  ACTIVE_REASONING: 'astrolib_harness_active_reasoning',
  PERMISSION_MODE: 'astrolib_harness_permission_mode',
  AUTO_COLLAPSE_TRACE: 'astrolib_harness_auto_collapse_trace',
  TOOL_OVERRIDES: 'astrolib_harness_tool_overrides_v1',
  SYSTEM_PROMPT: 'astrolib_harness_system_prompt',
  DEFAULT_REASONING: 'astrolib_harness_default_reasoning',
  TOKEN_WINDOW: 'astrolib_harness_token_window',
  MAX_AGENT_ROUNDS: 'astrolib_harness_max_agent_rounds',
  CUSTOM_AGENT_PYTHON: 'astrolib_harness_custom_agent_python',
  WEB_SEARCH: 'astrolib_harness_web_search_v1',
} as const;

export const DEFAULT_WEB_SEARCH_CONFIG: WebSearchConfig = {
  enabled: false,
  provider: 'none',
  apiKey: '',
  baseUrl: '',
  maxResults: 5,
};

export const HARNESS_SETTINGS_CHANGED_EVENT = 'astrolib:harness-settings-changed';

export function getDefaultProviders(): ProviderConfig[] {
  return [
    {
      id: 'baigong',
      displayName: '邮百工网关',
      isCustom: true,
      status: 'connected',
      api: 'openai-completions',
      baseURL: 'https://gateway.baigongai.cn/v1',
      apiKey: '',
      headers: {
        'X-YBG-Session-ID': 'youlabber-local-pc',
      },
      models: [
        {
          id: 'ybg-youlaber-ds4f',
          name: 'YoulabberLocal Flash',
          reasoningEffort: 'high',
          desc: '新一代理科推理架构',
        },
        {
          id: 'ybg-youlaber-ds4pro',
          name: 'YoulabberLocal Pro',
          reasoningEffort: 'low',
          desc: '高精度专业理科推理',
        },
      ],
      defaultModelId: 'ybg-youlaber-ds4f',
      desc: '北京邮电大学校园 AI 算力平台（免费专用网关，直连无需科学上网）',
    },
    {
      id: 'deepseek-account',
      displayName: 'DeepSeek 账号',
      isAccount: true,
      status: 'connected',
      api: 'openai-completions',
      baseURL: 'https://api.deepseek.com/v1',
      models: [],
      defaultModelId: '',
      desc: '已登录通行证 · 本地会话有效',
    },
    {
      id: 'deepseek',
      displayName: 'DeepSeek',
      status: 'configured',
      api: 'openai-completions',
      baseURL: 'https://api.deepseek.com/v1',
      apiKey: '',
      models: [
        { id: 'deepseek-chat', name: 'DeepSeek V3', reasoningEffort: 'off', desc: '新一代通用对话模型' },
        {
          id: 'deepseek-reasoner',
          name: 'DeepSeek R1',
          reasoningEffort: 'high',
          desc: '开源完整思考链推理',
        },
      ],
      defaultModelId: 'deepseek-chat',
      desc: '深度求索官方开放平台',
    },
    {
      id: 'gemini',
      displayName: 'Google Gemini',
      status: 'configured',
      api: 'openai-completions',
      baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
      apiKey: '',
      models: [
        {
          id: 'gemini-3.8-flash',
          name: 'Gemini 3.8 Flash High',
          reasoningEffort: 'high',
          desc: '前沿混合长文推理',
        },
        {
          id: 'gemini-3.8-pro',
          name: 'Gemini 3.8 Pro',
          reasoningEffort: 'high',
          desc: '复杂数学与学术推演',
        },
      ],
      defaultModelId: 'gemini-3.8-flash',
      desc: 'Google 官方前沿学术模型',
    },
  ];
}

function safeGetStorage(key: string): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetStorage(key: string, value: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, value);
  } catch {}
}

function normalizePermissionMode(raw: string | null): AgentPermissionMode {
  if (raw === 'read-only' || raw === 'workspace' || raw === 'full') {
    return raw;
  }
  return 'workspace';
}

export class HarnessSettingsStore {
  private static instance: HarnessSettingsStore | null = null;
  private state: HarnessSettingsState;
  private listeners = new Set<(state: HarnessSettingsState) => void>();

  public static getInstance(): HarnessSettingsStore {
    if (!HarnessSettingsStore.instance) {
      HarnessSettingsStore.instance = new HarnessSettingsStore();
    }
    return HarnessSettingsStore.instance;
  }

  private constructor() {
    this.state = this.loadFromStorage();
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', (e) => {
        if (e.key && Object.values(STORAGE_KEYS).includes(e.key as any)) {
          this.state = this.loadFromStorage();
          this.notifyLocalListeners();
        }
      });
    }
  }

  private loadFromStorage(): HarnessSettingsState {
    const defaultProviders = getDefaultProviders();
    let providers = defaultProviders;

    const savedProviders = safeGetStorage(STORAGE_KEYS.PROVIDERS);
    if (savedProviders) {
      try {
        const parsed = JSON.parse(savedProviders);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const hasBaigong = parsed.find((p: ProviderConfig) => p.id === 'baigong');
          if (!hasBaigong) {
            parsed.unshift(defaultProviders[0]);
          } else if (!hasBaigong.apiKey) {
            hasBaigong.apiKey = defaultProviders[0].apiKey;
          }
          providers = parsed;
        }
      } catch {}
    }

    let toolOverrides: Record<string, ToolOverrideConfig> = {};
    const savedOverrides = safeGetStorage(STORAGE_KEYS.TOOL_OVERRIDES);
    if (savedOverrides) {
      try {
        const parsed = JSON.parse(savedOverrides);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          toolOverrides = parsed;
        }
      } catch {}
    }

    const rawAutoCollapse = safeGetStorage(STORAGE_KEYS.AUTO_COLLAPSE_TRACE);
    const autoCollapseTrace = rawAutoCollapse === null ? true : rawAutoCollapse !== 'false';

    const rawReasoning = safeGetStorage(STORAGE_KEYS.DEFAULT_REASONING);
    const defaultReasoningEffort: 'high' | 'low' | 'off' =
      rawReasoning === 'low' || rawReasoning === 'off' ? rawReasoning : 'high';

    const rawTokenWindow = Number(safeGetStorage(STORAGE_KEYS.TOKEN_WINDOW));
    const tokenWindowLimit =
      Number.isFinite(rawTokenWindow) && rawTokenWindow >= 2048 ? rawTokenWindow : 16384;

    const rawMaxRounds = Number(safeGetStorage(STORAGE_KEYS.MAX_AGENT_ROUNDS));
    const maxAgentRounds =
      Number.isFinite(rawMaxRounds) && rawMaxRounds >= 5 && rawMaxRounds <= 60
        ? Math.round(rawMaxRounds)
        : 30;

    const customAgentPythonPath = safeGetStorage(STORAGE_KEYS.CUSTOM_AGENT_PYTHON) || undefined;

    let webSearch: WebSearchConfig = { ...DEFAULT_WEB_SEARCH_CONFIG };
    const savedWebSearch = safeGetStorage(STORAGE_KEYS.WEB_SEARCH);
    if (savedWebSearch) {
      try {
        const parsed = JSON.parse(savedWebSearch);
        if (parsed && typeof parsed === 'object') {
          webSearch = {
            ...DEFAULT_WEB_SEARCH_CONFIG,
            ...parsed,
          };
        }
      } catch {}
    }

    return {
      providers,
      currentProviderId: safeGetStorage(STORAGE_KEYS.ACTIVE_PROVIDER) || 'baigong',
      currentModelId: safeGetStorage(STORAGE_KEYS.ACTIVE_MODEL) || 'ybg-youlaber-ds4f',
      currentModelLabel: safeGetStorage(STORAGE_KEYS.ACTIVE_LABEL) || 'YoulabberLocal Flash High',
      currentReasoningEffort: safeGetStorage(STORAGE_KEYS.ACTIVE_REASONING) || 'high',
      defaultReasoningEffort,
      tokenWindowLimit,
      maxAgentRounds,
      customAgentPythonPath,
      webSearch,
      systemPrompt: safeGetStorage(STORAGE_KEYS.SYSTEM_PROMPT) || DEFAULT_HARNESS_SYSTEM_PROMPT,
      permissionMode: normalizePermissionMode(safeGetStorage(STORAGE_KEYS.PERMISSION_MODE)),
      autoCollapseTrace,
      toolOverrides,
    };
  }

  public getState(): HarnessSettingsState {
    return this.state;
  }

  public reload(): HarnessSettingsState {
    this.state = this.loadFromStorage();
    return this.state;
  }

  private persistAndNotify(): void {
    safeSetStorage(STORAGE_KEYS.PROVIDERS, JSON.stringify(this.state.providers));
    safeSetStorage(STORAGE_KEYS.ACTIVE_PROVIDER, this.state.currentProviderId);
    safeSetStorage(STORAGE_KEYS.ACTIVE_MODEL, this.state.currentModelId);
    safeSetStorage(STORAGE_KEYS.ACTIVE_LABEL, this.state.currentModelLabel);
    safeSetStorage(STORAGE_KEYS.ACTIVE_REASONING, this.state.currentReasoningEffort);
    safeSetStorage(STORAGE_KEYS.DEFAULT_REASONING, this.state.defaultReasoningEffort);
    safeSetStorage(STORAGE_KEYS.TOKEN_WINDOW, String(this.state.tokenWindowLimit));
    safeSetStorage(STORAGE_KEYS.MAX_AGENT_ROUNDS, String(this.state.maxAgentRounds ?? 30));
    safeSetStorage(STORAGE_KEYS.CUSTOM_AGENT_PYTHON, this.state.customAgentPythonPath || '');
    safeSetStorage(
      STORAGE_KEYS.WEB_SEARCH,
      JSON.stringify(this.state.webSearch || DEFAULT_WEB_SEARCH_CONFIG)
    );
    safeSetStorage(STORAGE_KEYS.SYSTEM_PROMPT, this.state.systemPrompt);
    safeSetStorage(STORAGE_KEYS.PERMISSION_MODE, this.state.permissionMode);
    safeSetStorage(STORAGE_KEYS.AUTO_COLLAPSE_TRACE, String(this.state.autoCollapseTrace));
    safeSetStorage(STORAGE_KEYS.TOOL_OVERRIDES, JSON.stringify(this.state.toolOverrides));

    this.notifyLocalListeners();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(HARNESS_SETTINGS_CHANGED_EVENT, { detail: this.state }));
    }
  }

  private notifyLocalListeners(): void {
    for (const fn of this.listeners) {
      try {
        fn(this.state);
      } catch {}
    }
  }

  public subscribe(listener: (state: HarnessSettingsState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public setProviders(providers: ProviderConfig[]): void {
    this.state = { ...this.state, providers: [...providers] };
    this.persistAndNotify();
  }

  public setActiveModel(selection: {
    providerId: string;
    modelId: string;
    label: string;
    reasoningEffort: string;
  }): void {
    this.state = {
      ...this.state,
      currentProviderId: selection.providerId,
      currentModelId: selection.modelId,
      currentModelLabel: selection.label,
      currentReasoningEffort: selection.reasoningEffort,
    };
    this.persistAndNotify();
  }

  public setPermissionMode(mode: AgentPermissionMode): void {
    if (this.state.permissionMode === mode) return;
    this.state = { ...this.state, permissionMode: mode };
    this.persistAndNotify();
  }

  public setAutoCollapseTrace(autoCollapse: boolean): void {
    this.state = { ...this.state, autoCollapseTrace: Boolean(autoCollapse) };
    this.persistAndNotify();
  }

  public setSystemPrompt(prompt: string): void {
    const clean = prompt.trim() || DEFAULT_HARNESS_SYSTEM_PROMPT;
    this.state = { ...this.state, systemPrompt: clean };
    this.persistAndNotify();
  }

  public resetSystemPrompt(): void {
    this.state = { ...this.state, systemPrompt: DEFAULT_HARNESS_SYSTEM_PROMPT };
    this.persistAndNotify();
  }

  public setPresetOptions(opts: {
    defaultReasoningEffort?: 'high' | 'low' | 'off';
    tokenWindowLimit?: number;
    maxAgentRounds?: number;
    customAgentPythonPath?: string;
  }): void {
    this.state = {
      ...this.state,
      ...(opts.defaultReasoningEffort ? { defaultReasoningEffort: opts.defaultReasoningEffort } : {}),
      ...(typeof opts.tokenWindowLimit === 'number' && opts.tokenWindowLimit >= 2048
        ? { tokenWindowLimit: Math.round(opts.tokenWindowLimit) }
        : {}),
      ...(typeof opts.maxAgentRounds === 'number' && opts.maxAgentRounds >= 5 && opts.maxAgentRounds <= 60
        ? { maxAgentRounds: Math.round(opts.maxAgentRounds) }
        : {}),
      ...(opts.customAgentPythonPath !== undefined
        ? { customAgentPythonPath: opts.customAgentPythonPath.trim() || undefined }
        : {}),
    };
    this.persistAndNotify();
  }

  public setWebSearchConfig(config: Partial<WebSearchConfig>): void {
    const merged: WebSearchConfig = {
      ...DEFAULT_WEB_SEARCH_CONFIG,
      ...(this.state.webSearch || {}),
      ...config,
    };
    this.state = { ...this.state, webSearch: merged };
    this.persistAndNotify();
  }

  public setToolOverride(toolName: string, override: ToolOverrideConfig): void {
    const prev = this.state.toolOverrides[toolName] || {};
    const merged: ToolOverrideConfig = {
      ...prev,
      ...override,
    };
    this.state = {
      ...this.state,
      toolOverrides: {
        ...this.state.toolOverrides,
        [toolName]: merged,
      },
    };
    this.persistAndNotify();
  }

  public resetToolOverride(toolName: string): void {
    const next = { ...this.state.toolOverrides };
    delete next[toolName];
    this.state = {
      ...this.state,
      toolOverrides: next,
    };
    this.persistAndNotify();
  }
}
