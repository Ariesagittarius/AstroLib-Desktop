/**
 * electron/preload.ts
 * ============================================================================
 * AstroLib 安全上下文预加载脚本 (Secure IPC Context Bridge)
 * ============================================================================
 */

import { contextBridge, ipcRenderer } from 'electron';
import type {
  AstroLibDesktopBridge,
  SystemDiagnostics,
  ModelInfoPayload,
  ModelDownloadProgress,
  AppUpdateInfo,
} from './types.ts';

function readAppVersionSync(): string {
  try {
    const ver = ipcRenderer.sendSync('astrolib:get-app-version-sync');
    if (typeof ver === 'string' && ver.trim()) {
      return ver.trim();
    }
  } catch {
    // 沙箱降级兜底版本号
  }
  return '0.0.4';
}

const bridge: AstroLibDesktopBridge = {
  isElectron: true,
  appVersion: readAppVersionSync(),

  async openHubWindow(): Promise<void> {
    return ipcRenderer.invoke('astrolib:open-hub-window');
  },

  async closeHubWindow(): Promise<void> {
    return ipcRenderer.invoke('astrolib:close-hub-window');
  },

  onOpenHubOverlay(callback: () => void): () => void {
    const handler = () => {
      callback();
    };
    ipcRenderer.on('astrolib:open-hub-overlay', handler);
    return () => {
      ipcRenderer.removeListener('astrolib:open-hub-overlay', handler);
    };
  },

  async getEnvDiagnostics(): Promise<SystemDiagnostics> {
    return ipcRenderer.invoke('astrolib:get-env-diagnostics');
  },

  async getAvailableModels(): Promise<ModelInfoPayload[]> {
    return ipcRenderer.invoke('astrolib:get-available-models');
  },

  async checkModelStatus(modelId: string): Promise<ModelInfoPayload> {
    return ipcRenderer.invoke('astrolib:check-model-status', modelId);
  },

  async startModelDownload(
    modelId: string,
    options?: { mirrorUrl?: string }
  ): Promise<{ ok: boolean; message?: string }> {
    return ipcRenderer.invoke('astrolib:start-model-download', modelId, options);
  },

  async cancelModelDownload(modelId: string): Promise<{ ok: boolean }> {
    return ipcRenderer.invoke('astrolib:cancel-model-download', modelId);
  },

  onModelProgress(callback: (progress: ModelDownloadProgress) => void): () => void {
    const handler = (_event: any, data: ModelDownloadProgress) => {
      callback(data);
    };
    ipcRenderer.on('astrolib:model-progress', handler);
    return () => {
      ipcRenderer.removeListener('astrolib:model-progress', handler);
    };
  },

  async checkForUpdates(): Promise<AppUpdateInfo> {
    return ipcRenderer.invoke('astrolib:check-for-updates');
  },

  async openExternalUrl(url: string): Promise<void> {
    return ipcRenderer.invoke('astrolib:open-external-url', url);
  },

  onNavigateToUrl(callback: (url: string) => void): () => void {
    const handler = (_event: any, url: string) => {
      callback(url);
    };
    ipcRenderer.on('astrolib:navigate-to-url', handler);
    return () => {
      ipcRenderer.removeListener('astrolib:navigate-to-url', handler);
    };
  },

  async selectPythonPath(): Promise<string | null> {
    return ipcRenderer.invoke('astrolib:select-python');
  },

  async setCustomPythonPath(customPath: string): Promise<SystemDiagnostics> {
    return ipcRenderer.invoke('astrolib:set-python-path', customPath);
  },

  async installBookFromAbp(abpData: ArrayBuffer | Uint8Array): Promise<any> {
    const uint8 = abpData instanceof Uint8Array ? abpData : new Uint8Array(abpData);
    return ipcRenderer.invoke('astrolib:install-book-from-abp', uint8);
  },

  async installBookFromFile(fileName: string, fileData: ArrayBuffer | Uint8Array, options?: any): Promise<any> {
    const uint8 = fileData instanceof Uint8Array ? fileData : new Uint8Array(fileData);
    return ipcRenderer.invoke('astrolib:install-book-from-file', fileName, uint8, options);
  },

  async fetchOfficialCatalog(customUrl?: string): Promise<any> {
    return ipcRenderer.invoke('astrolib:fetch-official-catalog', customUrl);
  },

  async installOfficialBook(entry: any): Promise<any> {
    return ipcRenderer.invoke('astrolib:install-official-book', entry);
  },

  async getInstalledBooks(): Promise<any[]> {
    return ipcRenderer.invoke('astrolib:get-installed-books');
  },

  async getBookManifest(colSlug: string, bookSlug: string): Promise<any | null> {
    return ipcRenderer.invoke('astrolib:get-book-manifest', colSlug, bookSlug);
  },

  async getChapterPayload(colSlug: string, bookSlug: string, chapterSlug: string): Promise<any | null> {
    return ipcRenderer.invoke('astrolib:get-chapter-payload', colSlug, bookSlug, chapterSlug);
  },

  async removeBook(colSlug: string, bookSlug: string): Promise<boolean> {
    return ipcRenderer.invoke('astrolib:remove-book', colSlug, bookSlug);
  },

  async getStorageStats(): Promise<any> {
    return ipcRenderer.invoke('astrolib:get-storage-stats');
  },

  async setThemeMode(theme: 'light' | 'dark' | 'auto'): Promise<{ ok: boolean }> {
    return ipcRenderer.invoke('astrolib:set-theme-mode', theme);
  },

  async clearAllUserData(): Promise<{ ok: boolean; message?: string }> {
    return ipcRenderer.invoke('astrolib:clear-all-userdata');
  },

  async analyzeTextHighlight(text: string): Promise<any> {
    return ipcRenderer.invoke('astrolib:analyze-text-highlight', text);
  },

  async getInfoHighlightStatus(): Promise<any> {
    return ipcRenderer.invoke('astrolib:get-info-highlight-status');
  },

  async getRuntimeModelStatus(): Promise<any> {
    return ipcRenderer.invoke('astrolib:get-runtime-model-status');
  },

  async setModelIdleTimeout(idleTimeoutMs: number): Promise<{ ok: boolean; idleTimeoutMs: number }> {
    return ipcRenderer.invoke('astrolib:set-model-idle-timeout', idleTimeoutMs);
  },

  async unloadLocalModels(modelId: 'qwen-highlight' | 'qwen-align' | 'minilm-align' | 'all' = 'all'): Promise<{ ok: boolean; unloaded: string[] }> {
    return ipcRenderer.invoke('astrolib:unload-local-models', modelId);
  },

  async getSettings(): Promise<Record<string, string>> {
    return ipcRenderer.invoke('astrolib:get-settings');
  },

  async saveSetting(key: string, value: string | null): Promise<{ ok: boolean }> {
    return ipcRenderer.invoke('astrolib:save-setting', key, value);
  },

  async saveSettingsBatch(batch: Record<string, string | null>): Promise<{ ok: boolean }> {
    return ipcRenderer.invoke('astrolib:save-settings-batch', batch);
  },

  async getLibraryEntities(forceRefresh?: boolean): Promise<any[]> {
    return ipcRenderer.invoke('astrolib:get-library-entities', Boolean(forceRefresh));
  },

  async getLibraryShelves(): Promise<any[]> {
    return ipcRenderer.invoke('astrolib:get-library-shelves');
  },

  async createLibraryShelf(name: string): Promise<any> {
    return ipcRenderer.invoke('astrolib:create-library-shelf', name);
  },

  async removeLibraryShelf(shelfId: string): Promise<boolean> {
    return ipcRenderer.invoke('astrolib:remove-library-shelf', shelfId);
  },

  async updateEntityMeta(entityId: string, updates: any): Promise<void> {
    return ipcRenderer.invoke('astrolib:update-entity-meta', entityId, updates);
  },

  async getAntigravityCliStatus(): Promise<any> {
    return ipcRenderer.invoke('astrolib:get-antigravity-cli-status');
  },

  async exportCanvasPdf(options: {
    colSlug: string;
    bookSlug: string;
    chapterSlug: string;
    title?: string;
    width?: number;
    height?: number;
  }): Promise<{ ok: boolean; filePath?: string; canceled?: boolean; error?: string }> {
    return ipcRenderer.invoke('astrolib:export-canvas-pdf', options);
  },

  async exportCanvasPng(options: {
    colSlug: string;
    bookSlug: string;
    chapterSlug: string;
    title?: string;
    dpi?: number;
    width?: number;
    height?: number;
  }): Promise<{ ok: boolean; filePath?: string; canceled?: boolean; error?: string }> {
    return ipcRenderer.invoke('astrolib:export-canvas-png', options);
  },

  async windowMinimize(): Promise<void> {
    return ipcRenderer.invoke('astrolib:window-minimize');
  },

  async windowToggleMaximize(): Promise<{ isMaximized: boolean }> {
    return ipcRenderer.invoke('astrolib:window-toggle-maximize');
  },

  async windowClose(): Promise<void> {
    return ipcRenderer.invoke('astrolib:window-close');
  },

  async windowToggleFullscreen(): Promise<{ isFullScreen: boolean }> {
    return ipcRenderer.invoke('astrolib:window-toggle-fullscreen');
  },

  async getWindowState(): Promise<{ isMaximized: boolean; isFullScreen: boolean }> {
    return ipcRenderer.invoke('astrolib:window-get-state');
  },

  onWindowStateChange(callback: (state: { isMaximized: boolean; isFullScreen: boolean }) => void): () => void {
    const handler = (_event: any, state: { isMaximized: boolean; isFullScreen: boolean }) => {
      callback(state);
    };
    ipcRenderer.on('astrolib:window-state-change', handler);
    return () => {
      ipcRenderer.removeListener('astrolib:window-state-change', handler);
    };
  },

  onToggleNavRail(callback: () => void): () => void {
    const handler = () => {
      callback();
    };
    ipcRenderer.on('astrolib:toggle-nav-rail', handler);
    return () => {
      ipcRenderer.removeListener('astrolib:toggle-nav-rail', handler);
    };
  },

  async selectPdfFile(): Promise<string | null> {
    return ipcRenderer.invoke('astrolib:select-pdf-file');
  },

  async revealFileInFolder(
    relOrAbsPath: string
  ): Promise<{ ok: boolean; absPath?: string; error?: string }> {
    return ipcRenderer.invoke('astrolib:reveal-file-in-folder', relOrAbsPath);
  },

  onLibraryUpdated(callback: (info: { id: string; title?: string }) => void): () => void {
    const handler = (_event: any, info: { id: string; title?: string }) => {
      callback(info);
    };
    ipcRenderer.on('astrolib:library-updated', handler);
    return () => {
      ipcRenderer.removeListener('astrolib:library-updated', handler);
    };
  },
};

// 预先向 DOM 注入桌面宿主标记与全量设置同步脚本
if (typeof document !== 'undefined') {
  const markAsElectron = () => {
    if (document.documentElement) {
      document.documentElement.classList.add('is-electron-app');
      document.documentElement.classList.add('is-electron');
    }
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', markAsElectron);
  } else {
    markAsElectron();
  }

  // 同步初始化注入用户持久化偏好至 Main World 的 localStorage
  try {
    const initialSettings = ipcRenderer.sendSync('astrolib:get-settings-sync');
    if (initialSettings && typeof initialSettings === 'object') {
      const injectSettings = () => {
        const sTag = document.createElement('script');
        sTag.textContent = `
          try {
            var s = ${JSON.stringify(initialSettings)};
            for (var k in s) {
              if (s[k] !== null && s[k] !== undefined) {
                localStorage.setItem(k, s[k]);
              }
            }
            var origSet = localStorage.setItem.bind(localStorage);
            localStorage.setItem = function(k, v) {
              origSet(k, v);
              try {
                var bridge = window.astrolib || window.astrolibDesktop;
                if (bridge && typeof bridge.saveSetting === 'function') {
                  bridge.saveSetting(k, String(v));
                }
              } catch(e) {}
            };
            var origRem = localStorage.removeItem.bind(localStorage);
            localStorage.removeItem = function(k) {
              origRem(k);
              try {
                var bridge = window.astrolib || window.astrolibDesktop;
                if (bridge && typeof bridge.saveSetting === 'function') {
                  bridge.saveSetting(k, null);
                }
              } catch(e) {}
            };
          } catch(e) {}
        `;
        (document.head || document.documentElement).appendChild(sTag);
        sTag.remove();
      };
      if (document.documentElement) {
        injectSettings();
      } else {
        document.addEventListener('DOMContentLoaded', injectSettings);
      }
    }
  } catch (e) {}
}

contextBridge.exposeInMainWorld('astrolib', bridge);
contextBridge.exposeInMainWorld('astrolibDesktop', bridge);
