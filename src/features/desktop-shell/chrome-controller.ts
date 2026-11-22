import type { AstroLibDesktopBridge } from '../../../electron/types';

const NAV_RAIL_STORAGE_KEY = 'astrolib_nav_rail_collapsed';

let initialized = false;

function getDesktopBridge(): AstroLibDesktopBridge | undefined {
  return (window as { astrolib?: AstroLibDesktopBridge }).astrolib;
}

function readStoredNavRailCollapsed(): boolean {
  try {
    return localStorage.getItem(NAV_RAIL_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function initDesktopChromeController(): void {
  if (initialized) return;
  initialized = true;

  const root = document.documentElement;
  const bridge = getDesktopBridge();
  const isElectron = Boolean(bridge?.isElectron);

  const toggleRailBtn = document.getElementById('titlebar-btn-toggle-rail') as HTMLButtonElement | null;
  const winControlsEl = document.getElementById('titlebar-win-controls') as HTMLElement | null;
  const minBtn = document.getElementById('win-btn-min') as HTMLButtonElement | null;
  const maxBtn = document.getElementById('win-btn-max') as HTMLButtonElement | null;
  const closeBtn = document.getElementById('win-btn-close') as HTMLButtonElement | null;
  const exitFullscreenBtn = document.getElementById('btn-exit-fullscreen') as HTMLButtonElement | null;

  const isNavRailCollapsed = () => root.dataset.navRailCollapsed === 'true';

  const applyNavRailCollapsed = (collapsed: boolean, persist = true) => {
    root.dataset.navRailCollapsed = collapsed ? 'true' : 'false';
    if (persist) {
      try {
        localStorage.setItem(NAV_RAIL_STORAGE_KEY, collapsed ? 'true' : 'false');
      } catch {}
    }
    if (toggleRailBtn) {
      toggleRailBtn.setAttribute('aria-expanded', String(!collapsed));
      toggleRailBtn.setAttribute(
        'title',
        collapsed ? '展开左侧导航栏 (Ctrl+\\)' : '收起左侧导航栏 (Ctrl+\\)'
      );
    }
  };

  const applyWindowState = (state: { isMaximized?: boolean; isFullScreen?: boolean }) => {
    const isMaximized = Boolean(state?.isMaximized);
    const isFullScreen = Boolean(state?.isFullScreen);
    root.dataset.windowMaximized = isMaximized ? 'true' : 'false';
    root.dataset.desktopFullscreen = isFullScreen ? 'true' : 'false';

    if (maxBtn) {
      const label = isMaximized ? '向下还原' : '最大化';
      maxBtn.setAttribute('title', label);
      maxBtn.setAttribute('aria-label', label);
    }
  };

  applyNavRailCollapsed(readStoredNavRailCollapsed(), false);

  toggleRailBtn?.addEventListener('click', () => {
    applyNavRailCollapsed(!isNavRailCollapsed(), true);
  });

  if (isElectron && bridge) {
    bridge.onToggleNavRail?.(() => {
      applyNavRailCollapsed(!isNavRailCollapsed(), true);
    });

    minBtn?.addEventListener('click', () => {
      void bridge.windowMinimize?.();
    });

    maxBtn?.addEventListener('click', () => {
      void bridge.windowToggleMaximize?.().then((res) => {
        if (res) {
          applyWindowState({
            isMaximized: res.isMaximized,
            isFullScreen: root.dataset.desktopFullscreen === 'true',
          });
        }
      });
    });

    closeBtn?.addEventListener('click', () => {
      void bridge.windowClose?.();
    });

    bridge.onWindowStateChange?.((state) => {
      applyWindowState(state);
    });

    void bridge.getWindowState?.().then((state) => {
      if (state) applyWindowState(state);
    });
  } else if (winControlsEl) {
    winControlsEl.hidden = true;
  }

  exitFullscreenBtn?.addEventListener('click', () => {
    if (isElectron && bridge) {
      if (root.dataset.desktopFullscreen === 'true') {
        void bridge.windowToggleFullscreen?.();
      }
      return;
    }

    if (document.fullscreenElement) {
      void document.exitFullscreen?.();
    }
    applyWindowState({
      isMaximized: root.dataset.windowMaximized === 'true',
      isFullScreen: false,
    });
  });

  if (!isElectron) {
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === '\\' || e.code === 'Backslash')) {
        e.preventDefault();
        applyNavRailCollapsed(!isNavRailCollapsed(), true);
        return;
      }

      if (e.key === 'F11' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        const currentlyFullscreen = Boolean(document.fullscreenElement) || root.dataset.desktopFullscreen === 'true';
        if (currentlyFullscreen) {
          if (document.fullscreenElement) {
            void document.exitFullscreen?.();
          } else {
            applyWindowState({ isMaximized: false, isFullScreen: false });
          }
        } else if (typeof root.requestFullscreen === 'function') {
          void root.requestFullscreen().catch(() => {
            applyWindowState({ isMaximized: false, isFullScreen: true });
          });
        } else {
          applyWindowState({ isMaximized: false, isFullScreen: true });
        }
      }
    });

    document.addEventListener('fullscreenchange', () => {
      applyWindowState({
        isMaximized: root.dataset.windowMaximized === 'true',
        isFullScreen: Boolean(document.fullscreenElement),
      });
    });
  }
}
