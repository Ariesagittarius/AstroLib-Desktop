/**
 * src/features/settings/settings-registry.ts
 * ============================================================================
 * AstroLib Unified Settings Registry (Single Source of Truth)
 * ============================================================================
 * Declarative specification of all setting panels, switches, default values,
 * localStorage keys, and DOM attribute bindings.
 */

export type SettingCategory =
  | 'appearance'
  | 'typography'
  | 'reading'
  | 'performance'
  | 'ai'
  | 'translation';

export interface SettingDefinition<T = any> {
  id: string;
  category: SettingCategory;
  label: string;
  description: string;
  storageKey: string;
  defaultValue: T;
  dataAttribute: string;
  runtimeSwitchable: boolean;
  featureFlagId?: string;
}

export const SETTINGS_STORAGE_KEYS = {
  FEATURES: 'starlight-features',
  SITE_THEME: 'starlight-site-theme',
  THEME_MODE: 'starlight-theme-mode',
  THEME_COLOR: 'starlight-m3-theme-color',
  THEME_TRANSITION: 'starlight-theme-transition',
  FONT_PREF: 'starlight-font',
  FONT_SIZE: 'starlight-font-size',
  TYPOGRAPHY_INDENT: 'starlight-typography-indent',
  PUNCT_STYLE: 'starlight-punct-style',
  LITE_MODE: 'astrolib-lite-mode',
  LITE_BACKUP: 'astrolib-lite-backup',
  PREWARM_PAGES: 'astrolib-prewarm-pages',
  MAX_PAGE_CACHE: 'astrolib-max-page-cache',
  SIDEBAR_HOVER_PREFETCH: 'astrolib-sidebar-hover-prefetch',
  TRANSLATION_DISPLAY_MODE: 'starlight-translation-display-mode',
  TRANSLATION_PROVIDER: 'starlight-translation-provider',
  LOADING_STYLE: 'starlight-loading-indicator-style',
} as const;

export const SETTINGS_DEFINITIONS: Record<string, SettingDefinition> = {
  // Appearance
  themeMode: {
    id: 'themeMode',
    category: 'appearance',
    label: '外观模式',
    description: '浅色、深色或跟随系统设备',
    storageKey: SETTINGS_STORAGE_KEYS.THEME_MODE,
    defaultValue: 'auto',
    dataAttribute: 'data-theme-mode',
    runtimeSwitchable: true,
  },
  themeColor: {
    id: 'themeColor',
    category: 'appearance',
    label: '主题色彩',
    description: 'Material You 动态种子色盘',
    storageKey: SETTINGS_STORAGE_KEYS.THEME_COLOR,
    defaultValue: 'blue',
    dataAttribute: 'data-theme-color',
    runtimeSwitchable: true,
  },
  themeTransition: {
    id: 'themeTransition',
    category: 'appearance',
    label: '主题过渡动画',
    description: '平滑色彩渐变过渡',
    storageKey: SETTINGS_STORAGE_KEYS.THEME_TRANSITION,
    defaultValue: 'instant',
    dataAttribute: 'data-theme-transition',
    runtimeSwitchable: true,
  },

  // Typography
  typographyIndent: {
    id: 'typographyIndent',
    category: 'typography',
    label: '段落首行缩进',
    description: '中文段落首行缩进两字（2em）',
    storageKey: SETTINGS_STORAGE_KEYS.TYPOGRAPHY_INDENT,
    defaultValue: true,
    dataAttribute: 'data-typography-indent',
    runtimeSwitchable: true,
  },
  punctStyle: {
    id: 'punctStyle',
    category: 'typography',
    label: '句末标点形式',
    description: '中文全角句号（。）或数理西文圆点（．）',
    storageKey: SETTINGS_STORAGE_KEYS.PUNCT_STYLE,
    defaultValue: 'dot',
    dataAttribute: 'data-punct-style',
    runtimeSwitchable: true,
  },
  fontSize: {
    id: 'fontSize',
    category: 'typography',
    label: '基准字号',
    description: '正文字号大小 (14px - 22px)',
    storageKey: SETTINGS_STORAGE_KEYS.FONT_SIZE,
    defaultValue: 16,
    dataAttribute: 'data-font-size',
    runtimeSwitchable: true,
  },

  // Performance
  liteMode: {
    id: 'liteMode',
    category: 'performance',
    label: '低性能模式',
    description: '关闭动效与预载，释放受限设备计算与内存',
    storageKey: SETTINGS_STORAGE_KEYS.LITE_MODE,
    defaultValue: false,
    dataAttribute: 'data-lite-mode',
    runtimeSwitchable: true,
  },
  prewarmPages: {
    id: 'prewarmPages',
    category: 'performance',
    label: '章节预热跨度',
    description: '前后预加载章节数',
    storageKey: SETTINGS_STORAGE_KEYS.PREWARM_PAGES,
    defaultValue: 1,
    dataAttribute: 'data-prewarm-pages',
    runtimeSwitchable: true,
    featureFlagId: 'prewarm',
  },
  maxPageCache: {
    id: 'maxPageCache',
    category: 'performance',
    label: '内存页面缓存',
    description: '页面内存缓存上限',
    storageKey: SETTINGS_STORAGE_KEYS.MAX_PAGE_CACHE,
    defaultValue: 5,
    dataAttribute: 'data-max-page-cache',
    runtimeSwitchable: true,
  },
  sidebarHoverPrefetch: {
    id: 'sidebarHoverPrefetch',
    category: 'performance',
    label: '目录悬停预取',
    description: '鼠标悬停在左侧栏目录链接时提前预取页面',
    storageKey: SETTINGS_STORAGE_KEYS.SIDEBAR_HOVER_PREFETCH,
    defaultValue: true,
    dataAttribute: 'data-sidebar-hover-prefetch',
    runtimeSwitchable: true,
  },

  // Reading features
  crossRef: {
    id: 'crossRef',
    category: 'reading',
    label: '知识引用联动',
    description: '公式、定理与参考文献高亮跳转',
    storageKey: SETTINGS_STORAGE_KEYS.FEATURES,
    defaultValue: true,
    dataAttribute: 'data-feature-id="crossRef"',
    runtimeSwitchable: true,
    featureFlagId: 'crossRef',
  },
  formulaActions: {
    id: 'formulaActions',
    category: 'reading',
    label: '公式交互操作',
    description: '公式复制、放大与 LaTeX 提取',
    storageKey: SETTINGS_STORAGE_KEYS.FEATURES,
    defaultValue: true,
    dataAttribute: 'data-feature-id="formulaActions"',
    runtimeSwitchable: true,
    featureFlagId: 'formulaActions',
  },
  inspector: {
    id: 'inspector',
    category: 'reading',
    label: '模块查看与速查',
    description: '卡片与结构化章节探针',
    storageKey: SETTINGS_STORAGE_KEYS.FEATURES,
    defaultValue: false,
    dataAttribute: 'data-feature-id="inspector"',
    runtimeSwitchable: true,
    featureFlagId: 'inspector',
  },
  epub: {
    id: 'epub',
    category: 'reading',
    label: 'EPUB 离线导出',
    description: '整书一键打包导出 EPUB 电子书',
    storageKey: SETTINGS_STORAGE_KEYS.FEATURES,
    defaultValue: true,
    dataAttribute: 'data-feature-id="epub"',
    runtimeSwitchable: true,
    featureFlagId: 'epub',
  },
  relationGraph: {
    id: 'relationGraph',
    category: 'reading',
    label: '章节关系图谱',
    description: '交互式全书知识拓扑拓扑网络',
    storageKey: SETTINGS_STORAGE_KEYS.FEATURES,
    defaultValue: false,
    dataAttribute: 'data-feature-id="relationGraph"',
    runtimeSwitchable: true,
    featureFlagId: 'relationGraph',
  },
  mermaid: {
    id: 'mermaid',
    category: 'reading',
    label: 'Mermaid 动态图表',
    description: '正文中流程图与序列图渲染',
    storageKey: SETTINGS_STORAGE_KEYS.FEATURES,
    defaultValue: true,
    dataAttribute: 'data-feature-id="mermaid"',
    runtimeSwitchable: true,
    featureFlagId: 'mermaid',
  },
  editor: {
    id: 'editor',
    category: 'reading',
    label: '在线精修编辑器',
    description: '正文双向实时排版与语法修正',
    storageKey: SETTINGS_STORAGE_KEYS.FEATURES,
    defaultValue: false,
    dataAttribute: 'data-feature-id="editor"',
    runtimeSwitchable: true,
    featureFlagId: 'editor',
  },

  // AI & Translation
  aiAsk: {
    id: 'aiAsk',
    category: 'ai',
    label: 'AI 助读与侧载问答',
    description: '侧栏大模型学术对话与答疑解惑',
    storageKey: SETTINGS_STORAGE_KEYS.FEATURES,
    defaultValue: true,
    dataAttribute: 'data-feature-id="aiAsk"',
    runtimeSwitchable: true,
    featureFlagId: 'aiAsk',
  },
  translationMode: {
    id: 'translationMode',
    category: 'translation',
    label: '翻译呈现模式',
    description: '侧边栏分栏对照或段落下嵌',
    storageKey: SETTINGS_STORAGE_KEYS.TRANSLATION_DISPLAY_MODE,
    defaultValue: 'sidebar',
    dataAttribute: 'data-trans-mode',
    runtimeSwitchable: true,
  },
  translationProvider: {
    id: 'translationProvider',
    category: 'translation',
    label: '翻译提供商',
    description: 'Google, DeepL, 智谱或离线模型',
    storageKey: SETTINGS_STORAGE_KEYS.TRANSLATION_PROVIDER,
    defaultValue: 'google',
    dataAttribute: 'data-trans-provider',
    runtimeSwitchable: true,
  },
};

/**
 * Retrieve all registered setting definitions.
 */
export function getAllSettings(): SettingDefinition[] {
  return Object.values(SETTINGS_DEFINITIONS);
}

/**
 * Retrieve setting definitions by category.
 */
export function getSettingsByCategory(category: SettingCategory): SettingDefinition[] {
  return Object.values(SETTINGS_DEFINITIONS).filter((s) => s.category === category);
}

/**
 * Retrieve a specific setting definition by ID.
 */
export function getSettingDefinition(id: string): SettingDefinition | undefined {
  return SETTINGS_DEFINITIONS[id];
}
