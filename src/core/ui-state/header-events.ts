export const HEADER_EVENTS = {
  THEME_TOGGLE: 'astrolib:theme-toggle',
  SEARCH_OPEN: 'astrolib:open-search',
  SETTINGS_OPEN: 'astrolib:open-settings-hub',
  SIDEBAR_TOGGLE: 'astrolib:sidebar-toggle',
  FOCUS_LENS_TOGGLE: 'astrolib:focus-lens-toggle',
  TRANSLATION_TOGGLE: 'astrolib:translation-toggle',
} as const;

export type HeaderEventType = (typeof HEADER_EVENTS)[keyof typeof HEADER_EVENTS];

export interface HeaderThemeToggleDetail {
  mode?: 'light' | 'dark' | 'auto';
}

export interface HeaderSettingsOpenDetail {
  panel?: string;
  section?: string;
}

export interface HeaderSidebarToggleDetail {
  side: 'left' | 'right';
  expanded?: boolean;
}

export function dispatchHeaderEvent<T = any>(eventName: HeaderEventType, detail?: T): boolean {
  if (typeof window === 'undefined') return false;
  return window.dispatchEvent(new CustomEvent(eventName, { detail, bubbles: true }));
}
