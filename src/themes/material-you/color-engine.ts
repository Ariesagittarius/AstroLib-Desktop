/**
 * ============================================================================
 * Material You (Material 3) Dynamic Color Engine for AstroLib
 * ============================================================================
 * 职责：
 * 1. 依托 Google 官方 @material/material-color-utilities 算法，根据种子色
 *    动态计算 Light 与 Dark 双模的完整 M3 Tonal Palette 及系统色彩语义令牌。
 * 2. 提供 Chrome / 系统原生 AccentColor 探针，支持动态跟随 Chrome 强调色。
 * 3. 严格限定生成的 CSS 变量作用域在 html[data-site-theme='material-you']，
 *    绝对不污染 VitePress 或 Starlight 等其它主题。
 * ============================================================================
 */

import { themeFromSourceColor, argbFromHex, hexFromArgb } from '@material/material-color-utilities';

export interface ColorPreset {
  id: string;
  label: string;
  seed: string;
  top: string;
  left: string;
  right: string;
  bg?: string;
  isAuto?: boolean;
}

export const THEME_COLOR_PRESETS: ColorPreset[] = [
  { id: 'chrome-blue', label: '默认蓝', seed: '#0b57d0', top: '#d3e3fd', left: '#0b57d0', right: '#7fcfff' },
  { id: 'cool-gray', label: '冷灰', seed: '#5f6368', top: '#e1e3e5', left: '#5f6368', right: '#8e918f' },
  { id: 'deep-blue', label: '深蓝', seed: '#2c5da7', top: '#d7e2ff', left: '#2c5da7', right: '#adc6ff' },
  { id: 'slate', label: '板岩灰', seed: '#505f79', top: '#dfe1e6', left: '#505f79', right: '#97a0af' },
  { id: 'aquamarine', label: '浅青', seed: '#006782', top: '#c2e8ff', left: '#006782', right: '#4fd8eb' },
  { id: 'teal', label: '深青', seed: '#006a6a', top: '#bcebf0', left: '#006a6a', right: '#4ddad9' },
  { id: 'green', label: '草绿', seed: '#2e6b3c', top: '#c8eed0', left: '#2e6b3c', right: '#6dd58c' },
  { id: 'sage', label: '苔绿', seed: '#52634f', top: '#d5e8d0', left: '#52634f', right: '#a2bba0' },
  { id: 'yellow', label: '金黄', seed: '#795900', top: '#ffdf99', left: '#795900', right: '#fabd00' },
  { id: 'orange', label: '暖橙', seed: '#d95700', top: '#ffdbcb', left: '#d95700', right: '#ffb690' },
  { id: 'terracotta', label: '陶褐', seed: '#8c5000', top: '#ffddb8', left: '#8c5000', right: '#ffb960' },
  { id: 'rose', label: '浆果粉', seed: '#9c4146', top: '#ffdada', left: '#9c4146', right: '#ffb3b5' },
  { id: 'mauve', label: '锦葵紫', seed: '#835467', top: '#ffd8e6', left: '#835467', right: '#f4b7ce' },
  { id: 'magenta', label: '洋红', seed: '#984061', top: '#ffd9e2', left: '#984061', right: '#ffb1c8' },
  { id: 'purple', label: '薰衣草', seed: '#6750a4', top: '#eaddff', left: '#6750a4', right: '#d0bcff' },
];

export const DEFAULT_THEME_COLOR_ID = 'chrome-blue';
export const STORAGE_KEY_M3_COLOR = 'starlight-m3-theme-color';

/**
 * 检测当前是否为 Chrome 浏览器（非 Edge/Opera 等派生内核）
 */
export function isChromeBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /Chrome/.test(ua) && !/Edg|OPR|Brave/.test(ua);
}

/**
 * 探测 Chrome / 系统当前生效的 CSS AccentColor
 */
export function detectChromeAccentColor(): string {
  if (typeof document === 'undefined') return '#0b57d0';
  try {
    const probe = document.createElement('div');
    probe.style.cssText =
      'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;visibility:hidden;color:AccentColor;';
    document.body.appendChild(probe);
    const comp = window.getComputedStyle(probe).color;
    probe.remove();

    const match = comp.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (match) {
      const r = parseInt(match[1], 10);
      const g = parseInt(match[2], 10);
      const b = parseInt(match[3], 10);
      if (r === 0 && g === 0 && b === 0) return '#0b57d0';
      return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
    }
  } catch (e) {}
  return '#0b57d0';
}

/**
 * 获取当前持久化的主题色标识或 Hex
 */
export function loadThemeColor(): string {
  try {
    if (typeof localStorage !== 'undefined') {
      const val = localStorage.getItem(STORAGE_KEY_M3_COLOR);
      if (val === 'google-blue') return 'chrome-blue';
      return val || DEFAULT_THEME_COLOR_ID;
    }
  } catch (e) {}
  return DEFAULT_THEME_COLOR_ID;
}

/**
 * 保存主题色偏好
 */
export function saveThemeColor(colorIdOrHex: string): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY_M3_COLOR, colorIdOrHex);
    }
  } catch (e) {}
}

/**
 * 根据种子颜色生成 M3 CSS 样式表内容（严格限定在 html[data-site-theme='material-you']）
 */
function generateSchemeCss(seedHex: string): string {
  let theme;
  try {
    theme = themeFromSourceColor(argbFromHex(seedHex));
  } catch (e) {
    theme = themeFromSourceColor(argbFromHex('#0b57d0'));
  }

  const { light, dark } = theme.schemes;

  // Light 模式 Tonal 变量
  const lightPrimary = hexFromArgb(light.primary);
  const lightOnPrimary = hexFromArgb(light.onPrimary);
  const lightPrimaryContainer = hexFromArgb(light.primaryContainer);
  const lightOnPrimaryContainer = hexFromArgb(light.onPrimaryContainer);

  const lightSecondary = hexFromArgb(light.secondary);
  const lightOnSecondary = hexFromArgb(light.onSecondary);
  const lightSecondaryContainer = hexFromArgb(light.secondaryContainer);
  const lightOnSecondaryContainer = hexFromArgb(light.onSecondaryContainer);

  const lightTertiary = hexFromArgb(light.tertiary);
  const lightOnTertiary = hexFromArgb(light.onTertiary);
  const lightTertiaryContainer = hexFromArgb(light.tertiaryContainer);
  const lightOnTertiaryContainer = hexFromArgb(light.onTertiaryContainer);

  const lightSurfaceVariant = hexFromArgb(light.surfaceVariant);
  const lightOnSurfaceVariant = hexFromArgb(light.onSurfaceVariant);

  const lightOutline = hexFromArgb(light.outline);
  const lightOutlineVariant = hexFromArgb(light.outlineVariant);

  // Dark 模式 Tonal 变量
  const darkPrimary = hexFromArgb(dark.primary);
  const darkOnPrimary = hexFromArgb(dark.onPrimary);
  const darkPrimaryContainer = hexFromArgb(dark.primaryContainer);
  const darkOnPrimaryContainer = hexFromArgb(dark.onPrimaryContainer);

  const darkSecondary = hexFromArgb(dark.secondary);
  const darkOnSecondary = hexFromArgb(dark.onSecondary);
  const darkSecondaryContainer = hexFromArgb(dark.secondaryContainer);
  const darkOnSecondaryContainer = hexFromArgb(dark.onSecondaryContainer);

  const darkTertiary = hexFromArgb(dark.tertiary);
  const darkOnTertiary = hexFromArgb(dark.onTertiary);
  const darkTertiaryContainer = hexFromArgb(dark.tertiaryContainer);
  const darkOnTertiaryContainer = hexFromArgb(dark.onTertiaryContainer);

  const darkSurface = hexFromArgb(dark.surface);
  const darkOnSurface = hexFromArgb(dark.onSurface);
  const darkSurfaceVariant = hexFromArgb(dark.surfaceVariant);
  const darkOnSurfaceVariant = hexFromArgb(dark.onSurfaceVariant);

  const darkOutline = hexFromArgb(dark.outline);
  const darkOutlineVariant = hexFromArgb(dark.outlineVariant);

  return `
/* --- Material You Dynamic Color Scheme (Seed: ${seedHex}) --- */
:root,
html[data-site-theme='material-you'],
html[data-site-theme='material-you'][data-theme='light'],
html.desktop-app-html,
html.desktop-app-html[data-theme='light'] {
  color-scheme: light;
  --md-sys-color-primary: ${lightPrimary} !important;
  --md-sys-color-on-primary: ${lightOnPrimary} !important;
  --md-sys-color-primary-container: ${lightPrimaryContainer} !important;
  --md-sys-color-on-primary-container: ${lightOnPrimaryContainer} !important;

  --md-sys-color-secondary: ${lightSecondary} !important;
  --md-sys-color-on-secondary: ${lightOnSecondary} !important;
  --md-sys-color-secondary-container: ${lightSecondaryContainer} !important;
  --md-sys-color-on-secondary-container: ${lightOnSecondaryContainer} !important;

  --md-sys-color-tertiary: ${lightTertiary} !important;
  --md-sys-color-on-tertiary: ${lightOnTertiary} !important;
  --md-sys-color-tertiary-container: ${lightTertiaryContainer} !important;
  --md-sys-color-on-tertiary-container: ${lightOnTertiaryContainer} !important;

  /* 严格保持顶栏、正文与背景为纯净白底，杜绝色调污染 */
  --md-sys-color-background: #ffffff;
  --md-sys-color-on-background: #1f1f1f;
  --md-sys-color-surface: #ffffff;
  --md-sys-color-on-surface: #1f1f1f;
  --md-sys-color-surface-dim: #f8f9fa;
  --md-sys-color-surface-bright: #ffffff;
  --md-sys-color-surface-container-lowest: #ffffff;
  --md-sys-color-surface-container-low: #f8f9fa;
  --md-sys-color-surface-container: #f0f2f5;
  --md-sys-color-surface-container-high: #e8eaed;
  --md-sys-color-surface-container-highest: #dadce0;

  --md-sys-color-surface-variant: ${lightSurfaceVariant} !important;
  --md-sys-color-on-surface-variant: ${lightOnSurfaceVariant} !important;
  --md-sys-color-outline: ${lightOutline} !important;
  --md-sys-color-outline-variant: ${lightOutlineVariant} !important;

  /* AstroLib / Starlight Semantic Bridge (Pure White Light Background) */
  --sl-color-bg: #ffffff;
  --sl-color-bg-nav: #ffffff;
  --sl-color-bg-sidebar: #ffffff;
  --sl-color-white: #1f1f1f;
  --sl-color-gray-1: #1f1f1f;
  --sl-color-gray-2: ${lightOnSurfaceVariant};
  --sl-color-gray-3: ${lightOutline};
  --sl-color-gray-4: ${lightOutlineVariant};
  --sl-color-gray-5: #e8eaed;
  --sl-color-gray-6: #f8f9fa;
  --sl-color-accent: ${lightPrimary} !important;
  --sl-color-accent-low: ${lightPrimaryContainer} !important;
  --sl-color-text-accent: ${lightPrimary} !important;
  --sl-color-text-invert: ${lightOnPrimary} !important;
}

:root[data-theme='dark'],
html[data-site-theme='material-you'][data-theme='dark'],
html.desktop-app-html[data-theme='dark'] {
  color-scheme: dark;
  --md-sys-color-primary: ${darkPrimary} !important;
  --md-sys-color-on-primary: ${darkOnPrimary} !important;
  --md-sys-color-primary-container: ${darkPrimaryContainer} !important;
  --md-sys-color-on-primary-container: ${darkOnPrimaryContainer} !important;

  --md-sys-color-secondary: ${darkSecondary} !important;
  --md-sys-color-on-secondary: ${darkOnSecondary} !important;
  --md-sys-color-secondary-container: ${darkSecondaryContainer} !important;
  --md-sys-color-on-secondary-container: ${darkOnSecondaryContainer} !important;

  --md-sys-color-tertiary: ${darkTertiary} !important;
  --md-sys-color-on-tertiary: ${darkOnTertiary} !important;
  --md-sys-color-tertiary-container: ${darkTertiaryContainer} !important;
  --md-sys-color-on-tertiary-container: ${darkOnTertiaryContainer} !important;

  /* 黑色系沉浸暗夜表面阶梯（与桌面原生 titleBarOverlay #131316 保持像素级一致） */
  --md-sys-color-background: #111213;
  --md-sys-color-on-background: #e3e3e3;
  --md-sys-color-surface: #131316;
  --md-sys-color-on-surface: ${darkOnSurface};
  --md-sys-color-surface-dim: #0f1011;
  --md-sys-color-surface-bright: #373739;
  --md-sys-color-surface-container-lowest: #0b0c0d;
  --md-sys-color-surface-container-low: #18191a;
  --md-sys-color-surface-container: #1e1f20;
  --md-sys-color-surface-container-high: #28292a;
  --md-sys-color-surface-container-highest: #333537;

  --md-sys-color-surface-variant: ${darkSurfaceVariant} !important;
  --md-sys-color-on-surface-variant: ${darkOnSurfaceVariant} !important;
  --md-sys-color-outline: ${darkOutline} !important;
  --md-sys-color-outline-variant: ${darkOutlineVariant} !important;

  /* AstroLib / Starlight Semantic Bridge (Dark Mode) */
  --sl-color-bg: #111213;
  --sl-color-bg-sidebar: #1e1f20;
  --sl-color-bg-nav: #18191a;
  --sl-color-white: ${darkOnSurface};
  --sl-color-gray-1: ${darkOnSurface};
  --sl-color-gray-2: ${darkOnSurfaceVariant};
  --sl-color-gray-3: ${darkOutline};
  --sl-color-gray-4: ${darkOutlineVariant};
  --sl-color-gray-5: #28292a;
  --sl-color-gray-6: #18191a;
  --sl-color-accent: ${darkPrimary} !important;
  --sl-color-accent-low: ${darkPrimaryContainer} !important;
  --sl-color-text-accent: ${darkPrimary} !important;
  --sl-color-text-invert: ${darkOnPrimary} !important;
}
  `.trim();
}

/**
 * 解析有效种子色
 */
export function resolveSeedColor(colorIdOrHex: string): { seedHex: string; isAuto: boolean } {
  if (colorIdOrHex === 'chrome-auto' || colorIdOrHex === 'auto') {
    return { seedHex: detectChromeAccentColor(), isAuto: true };
  }

  const preset = THEME_COLOR_PRESETS.find((p) => p.id === colorIdOrHex);
  if (preset) {
    if (preset.isAuto) {
      return { seedHex: detectChromeAccentColor(), isAuto: true };
    }
    return { seedHex: preset.seed, isAuto: false };
  }

  // 检查是否为 Hex 字符串
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(colorIdOrHex)) {
    return { seedHex: colorIdOrHex, isAuto: false };
  }

  return { seedHex: '#0b57d0', isAuto: false };
}

export const STORAGE_KEY_M3_CACHED_CSS = 'astrolib_m3_cached_css';

/**
 * 将生成的 M3 动态色彩注入 DOM
 */
export function applyThemeColor(colorIdOrHex?: string): void {
  if (typeof document === 'undefined') return;

  const currentPref = colorIdOrHex || loadThemeColor();
  const { seedHex } = resolveSeedColor(currentPref);
  const schemeCss = generateSchemeCss(seedHex);

  // 持久化缓存动态 CSS 供首屏内联脚本在首次绘制前秒级注入，杜绝 FOUC 与二次样式重算
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY_M3_CACHED_CSS, schemeCss);
    }
  } catch {}

  const styleId = 'm3-dynamic-color-theme';
  let styleEl = document.getElementById(styleId) as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = styleId;
    styleEl.textContent = schemeCss;
    document.head.appendChild(styleEl);
  } else {
    if (styleEl.textContent !== schemeCss) {
      styleEl.textContent = schemeCss;
    }
    // 关键机制：确保 styleEl 始终位于 head 最后一个子节点，防止被其它静态 link CSS 覆盖
    if (document.head.lastElementChild !== styleEl) {
      document.head.appendChild(styleEl);
    }
  }

  if (document.documentElement.dataset.m3ThemeColor !== currentPref) {
    document.documentElement.dataset.m3ThemeColor = currentPref;
  }

  window.dispatchEvent(
    new CustomEvent('m3-theme-color-change', {
      detail: { color: currentPref, seedHex },
    })
  );

  // 跨窗口与多 iframe 双向实时同步 (保证外层 Shell 与内部 Reader 保持 100% 相同主题色)
  try {
    if (typeof window !== 'undefined') {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'M3_THEME_COLOR_CHANGED', color: currentPref, schemeCss }, '*');
      }
      const iframes = document.querySelectorAll('iframe');
      iframes.forEach((ifr) => {
        try {
          ifr.contentWindow?.postMessage({ type: 'M3_THEME_COLOR_CHANGED', color: currentPref, schemeCss }, '*');
        } catch (e) {}
      });
    }
  } catch (e) {}
}

/**
 * 初始化色彩引擎运行时与 Chrome 消息监听
 */
export function initColorEngine(): void {
  if (typeof window === 'undefined') return;
  if ((window as any).__m3ColorEngineInitialized) return;
  (window as any).__m3ColorEngineInitialized = true;

  // 初始应用
  if (document.documentElement.dataset.siteTheme === 'material-you') {
    applyThemeColor();
  }

  // 监听跨 iframe / 主窗口主题色同步消息
  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'M3_THEME_COLOR_CHANGED' && event.data.color) {
      if (document.documentElement.dataset.m3ThemeColor !== event.data.color) {
        applyThemeColor(event.data.color);
      }
    }
  });

  // 监听站点主题切换
  window.addEventListener('site-theme-change', (e: Event) => {
    const detail = (e as CustomEvent).detail;
    if (detail?.theme === 'material-you') {
      applyThemeColor();
    }
  });

  // 监听 Chrome 扩展广播或跨域消息
  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'CHROME_THEME_COLOR' && event.data.color) {
      if (loadThemeColor() === 'chrome-auto') {
        applyThemeColor('chrome-auto');
      }
    }
  });
}
