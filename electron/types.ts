/**
 * electron/types.ts
 * ============================================================================
 * AstroLib 桌面端核心类型定义 (IPC / 环境自省 / 模型生命周期 / 更新机制)
 * ============================================================================
 */

export interface SystemDiagnostics {
  platform: string;
  arch: string;
  osRelease: string;
  cpuModel: string;
  cpuCores: number;
  totalMemMB: number;
  freeMemMB: number;
  diskFreeGB: number;
  gpuRenderer?: string;
  gpuName?: string;
  gpuVramMB?: number;
  gpuDriverVersion?: string;
  hasCuda: boolean;
  hasDirectML: boolean;
  pythonPath: string | null;
  pythonVersion: string | null;
  hasTorch: boolean;
  hasHfTransformers: boolean;
  cudaDeviceName?: string;
  huggingFaceCacheDir: string;
  modelsDir: string;
}

export type ModelInstallStatus = 'ready' | 'missing' | 'downloading' | 'needs_python' | 'error';

export interface ModelInfoPayload {
  id: string;
  name: string;
  category: 'embedding' | 'llm' | 'ocr';
  description: string;
  sizeFormatted: string;
  status: ModelInstallStatus;
  localPath?: string;
  requiresPython: boolean;
  recommendedHardware: string;
  supportedEngines: string[];
  activeEngine?: string;
  error?: string;
}

export interface ModelDownloadProgress {
  modelId: string;
  percentage: number;
  receivedBytes: number;
  totalBytes: number;
  speedBytesPerSec: number;
  etaSeconds: number;
  status: 'downloading' | 'verifying' | 'completed' | 'cancelled' | 'error';
  error?: string;
}

export interface AppUpdateInfo {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion?: string;
  releaseName?: string;
  releaseNotes?: string;
  publishedAt?: string;
  downloadUrl?: string;
  htmlUrl?: string;
}

export interface AstroLibDesktopBridge {
  isElectron: true;
  appVersion: string;
  openHubWindow: () => Promise<void>;
  closeHubWindow: () => Promise<void>;
  onOpenHubOverlay?: (callback: () => void) => () => void;
  getEnvDiagnostics: () => Promise<SystemDiagnostics>;
  getAvailableModels: () => Promise<ModelInfoPayload[]>;
  checkModelStatus: (modelId: string) => Promise<ModelInfoPayload>;
  startModelDownload: (modelId: string, options?: { mirrorUrl?: string }) => Promise<{ ok: boolean; message?: string }>;
  cancelModelDownload: (modelId: string) => Promise<{ ok: boolean }>;
  onModelProgress: (callback: (progress: ModelDownloadProgress) => void) => () => void;
  checkForUpdates: () => Promise<AppUpdateInfo>;
  openExternalUrl: (url: string) => Promise<void>;
  selectPythonPath?: () => Promise<string | null>;
  setCustomPythonPath?: (customPath: string) => Promise<SystemDiagnostics>;
  installBookFromAbp?: (abpData: ArrayBuffer | Uint8Array) => Promise<any>;
  getInstalledBooks?: () => Promise<any[]>;
  getBookManifest?: (colSlug: string, bookSlug: string) => Promise<any | null>;
  getChapterPayload?: (colSlug: string, bookSlug: string, chapterSlug: string) => Promise<any | null>;
  removeBook?: (colSlug: string, bookSlug: string) => Promise<boolean>;
  getStorageStats?: () => Promise<any>;
  setThemeMode?: (theme: 'light' | 'dark' | 'auto') => Promise<{ ok: boolean }>;
  clearAllUserData?: () => Promise<{ ok: boolean; message?: string }>;
  analyzeTextHighlight?: (text: string) => Promise<any>;
  getInfoHighlightStatus?: () => Promise<any>;
  getSettings?: () => Promise<Record<string, string>>;
  saveSetting?: (key: string, value: string | null) => Promise<{ ok: boolean }>;
  saveSettingsBatch?: (batch: Record<string, string | null>) => Promise<{ ok: boolean }>;
  getLibraryEntities?: () => Promise<any[]>;
  getLibraryShelves?: () => Promise<any[]>;
  createLibraryShelf?: (name: string) => Promise<any>;
  removeLibraryShelf?: (shelfId: string) => Promise<boolean>;
  updateEntityMeta?: (entityId: string, updates: any) => Promise<void>;
}

declare global {
  interface Window {
    astrolib?: AstroLibDesktopBridge;
  }
}
