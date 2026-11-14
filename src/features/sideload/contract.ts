/**
 * src/features/sideload/contract.ts
 * ============================================================================
 * Shared contract & accessor for global Sideload & Sidebar Layout state
 * ============================================================================
 * Decouples services/business logic from concrete UI component implementations.
 */

export type SideloadWidthTier = 'compact' | 'medium' | 'wide' | 'full' | 'none';

export interface SideloadPanelConfig {
  id: string;
  title: string;
  widthTier: SideloadWidthTier;
  allowDrawer?: boolean;
}

export interface SideloadState {
  activePanelId: string;
  previousPanelId: string | null;
  widthTier: SideloadWidthTier;
  widthValue: string;
  isDrawerOpen: boolean;
}

export interface ISideloadManager {
  init(): void;
  register(config: SideloadPanelConfig): void;
  open(panelId: string, payload?: any): void;
  close?(panelId?: string): void;
  toggle(panelId: string, payload?: any): void;
  toggleRightSidebar(): void;
  switchToDefault(): void;
  getActivePanelId(): string;
  getState(): SideloadState;
  subscribe(listener: (state: SideloadState) => void): () => void;
}

export interface ISidebarLayoutController {
  init(): void;
  toggleLeftSidebar(): void;
  setCollapsed(collapsed: boolean): void;
  isCollapsed(): boolean;
  subscribe(listener: (state: any) => void): () => void;
}

let _sideloadManager: ISideloadManager | null = null;
let _sidebarLayoutController: ISidebarLayoutController | null = null;

export function registerSideloadManager(manager: ISideloadManager): void {
  _sideloadManager = manager;
  if (typeof window !== 'undefined') {
    (window as any).__sideloadManager = manager;
    (window as any).sideloadManager = manager;
  }
}

export function getSideloadManager(): ISideloadManager {
  if (_sideloadManager) return _sideloadManager;
  if (typeof window !== 'undefined' && (window as any).sideloadManager) {
    return (window as any).sideloadManager;
  }
  return {
    init: () => {},
    register: () => {},
    open: () => {},
    close: () => {},
    toggle: () => {},
    toggleRightSidebar: () => {},
    switchToDefault: () => {},
    getActivePanelId: () => 'toc',
    getState: () => ({
      activePanelId: 'toc',
      previousPanelId: null,
      widthTier: 'compact',
      widthValue: '16.5rem',
      isDrawerOpen: false,
    }),
    subscribe: () => () => {},
  };
}

export const sideloadManagerContract: ISideloadManager = {
  init: () => getSideloadManager().init(),
  register: (c) => getSideloadManager().register(c),
  open: (p, pay) => getSideloadManager().open(p, pay),
  close: (p) => getSideloadManager().close?.(p),
  toggle: (p, pay) => getSideloadManager().toggle(p, pay),
  toggleRightSidebar: () => getSideloadManager().toggleRightSidebar(),
  switchToDefault: () => getSideloadManager().switchToDefault(),
  getActivePanelId: () => getSideloadManager().getActivePanelId(),
  getState: () => getSideloadManager().getState(),
  subscribe: (l) => getSideloadManager().subscribe(l),
};

export function registerSidebarLayoutController(ctrl: ISidebarLayoutController): void {
  _sidebarLayoutController = ctrl;
  if (typeof window !== 'undefined') {
    (window as any).__sidebarLayoutController = ctrl;
  }
}

export function getSidebarLayoutController(): ISidebarLayoutController {
  if (_sidebarLayoutController) return _sidebarLayoutController;
  if (typeof window !== 'undefined' && (window as any).__sidebarLayoutController) {
    return (window as any).__sidebarLayoutController;
  }
  return {
    init: () => {},
    toggleLeftSidebar: () => {},
    setCollapsed: () => {},
    isCollapsed: () => false,
    subscribe: () => () => {},
  };
}

export const sidebarLayoutContract: ISidebarLayoutController = {
  init: () => getSidebarLayoutController().init(),
  toggleLeftSidebar: () => getSidebarLayoutController().toggleLeftSidebar(),
  setCollapsed: (c) => getSidebarLayoutController().setCollapsed(c),
  isCollapsed: () => getSidebarLayoutController().isCollapsed(),
  subscribe: (l) => getSidebarLayoutController().subscribe(l),
};
