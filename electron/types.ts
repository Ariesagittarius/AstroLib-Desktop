import type { RuntimeModelStatus } from '../src/services/local-model-lifecycle.ts';

export type { RuntimeModelStatus };

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
  installerUrl?: string;
  portableUrl?: string;
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
  onNavigateToUrl?: (callback: (url: string) => void) => () => void;
  selectPythonPath?: () => Promise<string | null>;
  setCustomPythonPath?: (customPath: string) => Promise<SystemDiagnostics>;
  installBookFromAbp?: (abpData: ArrayBuffer | Uint8Array) => Promise<any>;
  installBookFromFile?: (fileName: string, fileData: ArrayBuffer | Uint8Array, options?: any) => Promise<any>;
  fetchOfficialCatalog?: (customUrl?: string) => Promise<any>;
  installOfficialBook?: (entry: any) => Promise<any>;
  getInstalledBooks?: () => Promise<any[]>;
  getBookManifest?: (colSlug: string, bookSlug: string) => Promise<any | null>;
  getChapterPayload?: (colSlug: string, bookSlug: string, chapterSlug: string) => Promise<any | null>;
  removeBook?: (colSlug: string, bookSlug: string) => Promise<boolean>;
  getStorageStats?: () => Promise<any>;
  setThemeMode?: (theme: 'light' | 'dark' | 'auto') => Promise<{ ok: boolean }>;
  clearAllUserData?: () => Promise<{ ok: boolean; message?: string }>;
  analyzeTextHighlight?: (text: string) => Promise<any>;
  getInfoHighlightStatus?: () => Promise<any>;
  getRuntimeModelStatus?: () => Promise<{ idleTimeoutMs: number; models: RuntimeModelStatus[] }>;
  setModelIdleTimeout?: (idleTimeoutMs: number) => Promise<{ ok: boolean; idleTimeoutMs: number }>;
  unloadLocalModels?: (
    modelId?: 'qwen-highlight' | 'qwen-align' | 'minilm-align' | 'all'
  ) => Promise<{ ok: boolean; unloaded: string[] }>;
  getSettings?: () => Promise<Record<string, string>>;
  saveSetting?: (key: string, value: string | null) => Promise<{ ok: boolean }>;
  saveSettingsBatch?: (batch: Record<string, string | null>) => Promise<{ ok: boolean }>;
  getLibraryEntities?: (forceRefresh?: boolean) => Promise<any[]>;
  getLibraryShelves?: () => Promise<any[]>;
  createLibraryShelf?: (name: string) => Promise<any>;
  removeLibraryShelf?: (shelfId: string) => Promise<boolean>;
  updateEntityMeta?: (entityId: string, updates: any) => Promise<void>;
  getAntigravityCliStatus?: () => Promise<{ available: boolean; version?: string; executablePath?: string; models?: any[] }>;
  exportCanvasPdf?: (options: {
    colSlug: string;
    bookSlug: string;
    chapterSlug: string;
    title?: string;
    width?: number;
    height?: number;
  }) => Promise<{ ok: boolean; filePath?: string; canceled?: boolean; error?: string }>;
  exportCanvasPng?: (options: {
    colSlug: string;
    bookSlug: string;
    chapterSlug: string;
    title?: string;
    dpi?: number;
    width?: number;
    height?: number;
  }) => Promise<{ ok: boolean; filePath?: string; canceled?: boolean; error?: string }>;
  windowMinimize?: () => Promise<void>;
  windowToggleMaximize?: () => Promise<{ isMaximized: boolean }>;
  windowClose?: () => Promise<void>;
  windowToggleFullscreen?: () => Promise<{ isFullScreen: boolean }>;
  getWindowState?: () => Promise<{ isMaximized: boolean; isFullScreen: boolean }>;
  onWindowStateChange?: (callback: (state: { isMaximized: boolean; isFullScreen: boolean }) => void) => () => void;
  onToggleNavRail?: (callback: () => void) => () => void;
  selectPdfFile?: () => Promise<string | null>;
  revealFileInFolder?: (relOrAbsPath: string) => Promise<{ ok: boolean; absPath?: string; error?: string }>;
  onLibraryUpdated?: (callback: (info: { id: string; title?: string }) => void) => () => void;
}

declare global {
  interface Window {
    astrolib?: AstroLibDesktopBridge;
    astrolibDesktop?: AstroLibDesktopBridge;
  }
}
