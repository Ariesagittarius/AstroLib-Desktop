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

const bridge: AstroLibDesktopBridge = {
  isElectron: true,
  appVersion: process.env.npm_package_version || '0.0.1',

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

  async getSettings(): Promise<Record<string, string>> {
    return ipcRenderer.invoke('astrolib:get-settings');
  },

  async saveSetting(key: string, value: string | null): Promise<{ ok: boolean }> {
    return ipcRenderer.invoke('astrolib:save-setting', key, value);
  },

  async saveSettingsBatch(batch: Record<string, string | null>): Promise<{ ok: boolean }> {
    return ipcRenderer.invoke('astrolib:save-settings-batch', batch);
  },

  async getLibraryEntities(): Promise<any[]> {
    return ipcRenderer.invoke('astrolib:get-library-entities');
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
