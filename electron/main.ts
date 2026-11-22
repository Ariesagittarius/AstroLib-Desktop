import { app, BrowserWindow, ipcMain, shell, Menu, dialog, nativeTheme, session } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LocalServer } from './server/local-server.ts';
import { EnvDetector } from './services/env-detector.ts';
import { ModelManager } from './services/model-manager.ts';
import { AppUpdater } from './services/updater.ts';
import { DesktopBookManager } from './services/book-manager.ts';
import { DesktopLibraryManager } from './services/library-manager.ts';
import { SettingsManager } from './services/settings-manager.ts';
import { fetchOfficialCatalog, installOfficialBook } from './services/remote-catalog-service.ts';
import { QwenHighlightService } from '../src/services/info-highlight/qwen-highlight-service.ts';
import { QwenEngine } from '../src/server/plugins/bilingual-aligner/qwen-engine.ts';
import { BilingualOnnxEngine } from '../src/server/plugins/bilingual-aligner/onnx-engine.ts';
import { parseModelIdleTtlMs } from '../src/services/local-model-lifecycle.ts';
import { AntigravityCliService } from '../src/services/antigravity-cli/antigravity-cli-service.ts';
import { registerElectronAbpInstaller } from '../src/services/pdf2abp/abp-importer.ts';
import {
  registerElectronCanvasCapturer,
  type CanvasCaptureRequest,
  type CanvasCaptureResult,
} from '../src/server/plugins/content-api/agent-tools-handler.ts';

app.name = 'AstroLib';
Menu.setApplicationMenu(null);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isPackaged = app.isPackaged;
const projectRoot = isPackaged ? app.getAppPath() : process.cwd();
const distDir = path.join(projectRoot, 'dist');
const preloadPath = path.join(__dirname, 'preload.cjs');

function getLogFile(): string {
  try {
    const dir = app.getPath('userData');
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, 'app.log');
  } catch {
    return path.join(process.cwd(), 'app-crash.log');
  }
}

function log(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    fs.appendFileSync(getLogFile(), line, 'utf8');
  } catch {}
  console.log(msg);
}

process.on('uncaughtException', (err) => {
  log(`[UNCAUGHT_EXCEPTION] ${err?.stack || err}`);
});

process.on('unhandledRejection', (reason) => {
  log(`[UNHANDLED_REJECTION] ${reason}`);
});

log(`[STARTUP] AstroLib Desktop 正在启动 | isPackaged=${isPackaged} | projectRoot=${projectRoot} | distDir=${distDir}`);

let mainWindow: BrowserWindow | null = null;
let localServer: LocalServer | null = null;
let serverPort = 0;
let modelManager: ModelManager | null = null;
let bookManager: DesktopBookManager | null = null;
let libraryManager: DesktopLibraryManager | null = null;

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  log('[EXIT] 检测到已有实例正在运行 (SingleInstanceLock failed)，退出当前副本');
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine) => {
    log('[SECOND_INSTANCE] 收到双击多开或协议唤起信号，自动聚焦已有主窗口');
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();

      const uriArg = commandLine.find((arg) => typeof arg === 'string' && (arg.startsWith('astrolib://') || arg.startsWith('astrolib:/')));
      if (uriArg) {
        mainWindow.webContents.send('astrolib:navigate-to-url', uriArg);
      }
    }
  });

  app.on('open-url', (event, url) => {
    event.preventDefault();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('astrolib:navigate-to-url', url);
    }
  });
}

function openExternalSafely(rawUrl: string): void {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return;
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return;
    }
    if (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost') {
      return;
    }
    void shell.openExternal(parsed.toString());
  } catch {

  }
}

function createMainWindow(port: number): BrowserWindow {
  const iconPath = path.join(projectRoot, 'public', 'favicon.png');
  const savedTheme = SettingsManager.getInstance().get('starlight-theme');
  const isDark =
    savedTheme === 'dark' ||
    ((!savedTheme || savedTheme === 'auto') && nativeTheme.shouldUseDarkColors);
  const overlayColor = isDark ? '#131316' : '#ffffff';

  mainWindow = new BrowserWindow({
    width: 1380,
    height: 880,
    minWidth: 1024,
    minHeight: 680,
    title: 'AstroLib - 理工科学术教辅系统',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    backgroundColor: overlayColor,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    show: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.setMenu(null);

  const emitWindowState = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('astrolib:window-state-change', {
      isMaximized: mainWindow.isMaximized(),
      isFullScreen: mainWindow.isFullScreen(),
    });
  };

  mainWindow.on('maximize', emitWindowState);
  mainWindow.on('unmaximize', emitWindowState);
  mainWindow.on('enter-full-screen', emitWindowState);
  mainWindow.on('leave-full-screen', emitWindowState);

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.isAutoRepeat) return;
    if (input.key === 'F11' && !input.control && !input.alt && !input.meta) {
      event.preventDefault();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setFullScreen(!mainWindow.isFullScreen());
      }
      return;
    }
    if ((input.control || input.meta) && !input.alt && !input.shift && (input.key === '\\' || input.code === 'Backslash')) {
      event.preventDefault();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('astrolib:toggle-nav-rail');
      }
    }
  });

  const targetUrl = `http://127.0.0.1:${port}/desktop/`;
  log(`[WINDOW] 正在加载主页面: ${targetUrl}`);
  mainWindow.loadURL(targetUrl);

  mainWindow.webContents.on('did-finish-load', () => {
    log(`[WINDOW] 主页面加载完毕: ${mainWindow?.webContents.getURL()}`);
    emitWindowState();
  });

  mainWindow.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL) => {
    log(`[WINDOW_FAIL_LOAD] 错误码=${errorCode} | 描述=${errorDescription} | URL=${validatedURL}`);
  });

  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    log(`[RENDER_PROCESS_GONE] 渲染进程异常退出: ${JSON.stringify(details)}`);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    log(`[WINDOW_OPEN] 捕获窗口打开请求: ${url}`);
    if (url.startsWith('astrolib:') || url.includes('/astrolib:') || url.includes('/collections/')) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('astrolib:navigate-to-url', url);
      }
      return { action: 'deny' };
    }

    openExternalSafely(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    log(`[WILL_NAVIGATE] 主窗口导航拦截: ${navigationUrl}`);
    if (navigationUrl.includes('/collections/') || navigationUrl.startsWith('astrolib:') || navigationUrl.includes('/astrolib:')) {
      event.preventDefault();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('astrolib:navigate-to-url', navigationUrl);
      }
      return;
    }

    try {
      const targetUrl = new URL(navigationUrl);
      const isLocalLoopback =
        targetUrl.protocol === 'http:' &&
        (targetUrl.hostname === '127.0.0.1' || targetUrl.hostname === 'localhost') &&
        Number(targetUrl.port) === port;
      if (isLocalLoopback) {
        return;
      }
      event.preventDefault();
      openExternalSafely(navigationUrl);
    } catch {
      event.preventDefault();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

function openHubOverlayInMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    mainWindow.webContents.send('astrolib:open-hub-overlay');
  }
}

function setupIpcHandlers() {
  ipcMain.on('astrolib:get-app-version-sync', (event) => {
    event.returnValue = app.getVersion();
  });

  ipcMain.handle('astrolib:open-hub-window', async () => {
    openHubOverlayInMainWindow();
  });

  ipcMain.handle('astrolib:close-hub-window', async () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('astrolib:close-hub-overlay');
    }
  });

  ipcMain.handle('astrolib:get-env-diagnostics', async () => {
    const customModelsDir = path.join(app.getPath('userData'), 'models');
    return EnvDetector.getDiagnostics(projectRoot, customModelsDir);
  });

  ipcMain.handle('astrolib:get-available-models', async () => {
    if (!modelManager) return [];
    return modelManager.getAvailableModels();
  });

  ipcMain.handle('astrolib:check-model-status', async (_event, modelId: string) => {
    if (!modelManager) throw new Error('Model manager not initialized');
    return modelManager.checkModelStatus(modelId);
  });

  ipcMain.handle(
    'astrolib:start-model-download',
    async (_event, modelId: string, options?: { mirrorUrl?: string }) => {
      if (!modelManager) throw new Error('Model manager not initialized');
      return modelManager.startDownload(modelId, options);
    }
  );

  ipcMain.handle('astrolib:cancel-model-download', async (_event, modelId: string) => {
    if (!modelManager) return { ok: false };
    return modelManager.cancelDownload(modelId);
  });

  ipcMain.handle('astrolib:check-for-updates', async () => {
    return AppUpdater.checkForUpdates(app.getVersion());
  });

  ipcMain.handle('astrolib:select-python', async () => {
    const res = await dialog.showOpenDialog({
      title: '选择 Python 解释器 (python.exe)',
      filters: [{ name: 'Python Executable', extensions: ['exe'] }],
      properties: ['openFile'],
    });
    if (!res.canceled && res.filePaths.length > 0) {
      return res.filePaths[0];
    }
    return null;
  });

  ipcMain.handle('astrolib:select-pdf-file', async () => {
    const res = await dialog.showOpenDialog({
      title: '选择待转换的 PDF 教材或讲义',
      filters: [{ name: 'PDF Document', extensions: ['pdf'] }],
      properties: ['openFile'],
    });
    if (!res.canceled && res.filePaths.length > 0) {
      return res.filePaths[0];
    }
    return null;
  });

  ipcMain.handle('astrolib:set-python-path', async (_event, customPath: string) => {
    EnvDetector.setCustomPythonPath(customPath);
    const customModelsDir = path.join(app.getPath('userData'), 'models');
    return EnvDetector.getDiagnostics(projectRoot, customModelsDir, true);
  });

  ipcMain.handle('astrolib:open-external-url', async (_event, url: string) => {
    openExternalSafely(url);
  });

  ipcMain.handle('astrolib:install-book-from-abp', async (_event, abpData: Uint8Array | Buffer | ArrayBuffer) => {
    if (!bookManager) throw new Error('桌面图书服务未初始化');
    const res = await bookManager.installBookFromAbp(abpData);
    libraryManager?.invalidateCache();
    return res;
  });

  ipcMain.handle(
    'astrolib:install-book-from-file',
    async (_event, fileName: string, fileData: Uint8Array | Buffer | ArrayBuffer, options?: any) => {
      if (!bookManager) throw new Error('桌面图书服务未初始化');
      const res = await bookManager.installBookFromFile(fileName, fileData, options || {});
      libraryManager?.invalidateCache();
      return res;
    }
  );

  ipcMain.handle('astrolib:fetch-official-catalog', async (_event, customUrl?: string) => {
    return fetchOfficialCatalog(customUrl);
  });

  ipcMain.handle('astrolib:install-official-book', async (_event, entry: any) => {
    if (!bookManager) throw new Error('桌面图书服务未初始化');
    const res = await installOfficialBook(entry, bookManager);
    libraryManager?.invalidateCache();
    return res;
  });

  ipcMain.handle('astrolib:get-installed-books', async () => {
    return bookManager ? bookManager.getInstalledBooks() : [];
  });

  ipcMain.handle('astrolib:get-book-manifest', async (_event, colSlug: string, bookSlug: string) => {
    return bookManager ? bookManager.getBookManifest(colSlug, bookSlug) : null;
  });

  ipcMain.handle('astrolib:get-chapter-payload', async (_event, colSlug: string, bookSlug: string, chapterSlug: string) => {
    return bookManager ? bookManager.getChapterPayload(colSlug, bookSlug, chapterSlug) : null;
  });

  ipcMain.handle('astrolib:remove-book', async (_event, colSlug: string, bookSlug: string) => {
    const ok = bookManager ? await bookManager.removeBook(colSlug, bookSlug) : false;
    if (ok) libraryManager?.invalidateCache();
    return ok;
  });

  ipcMain.handle('astrolib:get-storage-stats', async () => {
    return bookManager ? bookManager.getStorageStats() : { usedBytes: 0, bookCount: 0 };
  });

  ipcMain.handle('astrolib:window-minimize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.minimize();
    }
  });

  ipcMain.handle('astrolib:window-toggle-maximize', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return { isMaximized: false };
    if (mainWindow.isFullScreen()) {
      mainWindow.setFullScreen(false);
      return { isMaximized: mainWindow.isMaximized() };
    }
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
    return { isMaximized: mainWindow.isMaximized() };
  });

  ipcMain.handle('astrolib:window-close', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.close();
    }
  });

  ipcMain.handle('astrolib:window-toggle-fullscreen', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return { isFullScreen: false };
    const next = !mainWindow.isFullScreen();
    mainWindow.setFullScreen(next);
    return { isFullScreen: next };
  });

  ipcMain.handle('astrolib:window-get-state', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return { isMaximized: false, isFullScreen: false };
    return {
      isMaximized: mainWindow.isMaximized(),
      isFullScreen: mainWindow.isFullScreen(),
    };
  });

  ipcMain.handle('astrolib:set-theme-mode', (_event, theme: 'light' | 'dark' | 'auto') => {
    if (!mainWindow || mainWindow.isDestroyed()) return { ok: false };
    const isDark = theme === 'dark' || (theme === 'auto' && nativeTheme.shouldUseDarkColors);
    const bgColor = isDark ? '#131316' : '#ffffff';
    try {
      mainWindow.setBackgroundColor(bgColor);
      return { ok: true };
    } catch (err: any) {
      log(`[TITLEBAR_UPDATE_ERROR] ${err?.message || err}`);
      return { ok: false };
    }
  });

  ipcMain.handle('astrolib:clear-all-userdata', async () => {
    try {
      if (bookManager) {
        await bookManager.clearAllBooks();
      }
      const ses = session.defaultSession;
      await ses.clearCache();
      await ses.clearStorageData();
      log('[CACHE_CLEARED] 已成功清空所有已安装图书与 Chromium 运行时缓存');
      return { ok: true, message: '已彻底清空用户数据与离线缓存' };
    } catch (err: any) {
      log(`[CACHE_CLEAR_ERROR] ${err?.message || err}`);
      return { ok: false, message: String(err?.message || err) };
    }
  });

  ipcMain.handle('astrolib:analyze-text-highlight', async (_event, text: string) => {
    try {
      return await QwenHighlightService.getInstance().analyze(text);
    } catch (err: any) {
      log(`[INFO_HIGHLIGHT_ERROR] ${err?.message || err}`);
      throw err;
    }
  });

  ipcMain.handle('astrolib:get-info-highlight-status', async () => {
    try {
      return await QwenHighlightService.getInstance().getStatus();
    } catch (err: any) {
      log(`[INFO_HIGHLIGHT_STATUS_ERROR] ${err?.message || err}`);
      return { available: false, ready: false, device: 'error', error: String(err?.message || err) };
    }
  });

  ipcMain.handle('astrolib:get-runtime-model-status', async () => {
    return {
      idleTimeoutMs: parseModelIdleTtlMs(),
      models: [
        QwenHighlightService.getInstance().getRuntimeInfo(),
        QwenEngine.getInstance().getRuntimeInfo(),
        BilingualOnnxEngine.getInstance().getRuntimeInfo(),
      ],
    };
  });

  ipcMain.handle('astrolib:set-model-idle-timeout', async (_event, rawMs: number) => {
    const ms = Number.isFinite(Number(rawMs)) && Number(rawMs) >= 0 ? Math.floor(Number(rawMs)) : parseModelIdleTtlMs();
    process.env.ASTROLIB_MODEL_IDLE_TTL_MS = String(ms);
    SettingsManager.getInstance().set('astrolib_local_model_idle_ttl_ms', String(ms));
    QwenHighlightService.getInstance().setIdleTimeoutMs(ms);
    QwenEngine.getInstance().setIdleTimeoutMs(ms);
    BilingualOnnxEngine.getInstance().setIdleTimeoutMs(ms);
    log(`[LOCAL_MODEL] 空闲回收策略已更新为 ${ms === 0 ? '常驻至退出' : `${Math.round(ms / 60000)} 分钟`}`);
    return { ok: true, idleTimeoutMs: ms };
  });

  ipcMain.handle(
    'astrolib:unload-local-models',
    async (_event, modelId: 'qwen-highlight' | 'qwen-align' | 'minilm-align' | 'all' = 'all') => {
      const target = modelId || 'all';
      const unloaded: string[] = [];
      if (target === 'all' || target === 'qwen-highlight') {
        QwenHighlightService.getInstance().destroy();
        unloaded.push('qwen-highlight');
      }
      if (target === 'all' || target === 'qwen-align') {
        QwenEngine.getInstance().destroy();
        unloaded.push('qwen-align');
      }
      if (target === 'all' || target === 'minilm-align') {
        await BilingualOnnxEngine.getInstance().dispose();
        unloaded.push('minilm-align');
      }
      log(`[LOCAL_MODEL] 已手动释放端侧模型显存/内存: ${unloaded.join(', ')}`);
      return { ok: true, unloaded };
    }
  );

  ipcMain.handle('astrolib:get-settings', async () => {
    return SettingsManager.getInstance().getAll();
  });

  ipcMain.on('astrolib:get-settings-sync', (event) => {
    event.returnValue = SettingsManager.getInstance().getAll();
  });

  ipcMain.handle('astrolib:save-setting', async (_event, key: string, value: string | null) => {
    SettingsManager.getInstance().set(key, value);
    if (key === 'mineru_api_token') {
      try {
        const { TaskManager } = await import('../src/server/plugins/doc-ingestion/task-manager.ts');
        TaskManager.getInstance().getApiClient().persistToken(value || '');
      } catch {}
    }
    return { ok: true };
  });

  ipcMain.handle('astrolib:save-settings-batch', async (_event, batch: Record<string, string | null>) => {
    SettingsManager.getInstance().setBatch(batch);
    if (batch && 'mineru_api_token' in batch) {
      try {
        const { TaskManager } = await import('../src/server/plugins/doc-ingestion/task-manager.ts');
        TaskManager.getInstance().getApiClient().persistToken(batch.mineru_api_token || '');
      } catch {}
    }
    return { ok: true };
  });

  ipcMain.handle('astrolib:get-library-entities', async (_event, forceRefresh?: boolean) => {
    return libraryManager ? libraryManager.getAllEntities(Boolean(forceRefresh)) : [];
  });

  ipcMain.handle('astrolib:get-library-shelves', async () => {
    return libraryManager ? libraryManager.getShelves() : [];
  });

  ipcMain.handle('astrolib:create-library-shelf', async (_event, name: string) => {
    if (!libraryManager) throw new Error('书库服务未就绪');
    return libraryManager.createShelf(name);
  });

  ipcMain.handle('astrolib:remove-library-shelf', async (_event, shelfId: string) => {
    if (!libraryManager) throw new Error('书库服务未就绪');
    return libraryManager.removeShelf(shelfId);
  });

  ipcMain.handle('astrolib:update-entity-meta', async (_event, entityId: string, updates: any) => {
    if (libraryManager) {
      libraryManager.updateEntityMeta(entityId, updates);
    }
    return { ok: true };
  });

  ipcMain.handle('astrolib:get-antigravity-cli-status', async () => {
    try {
      const realRoot = app.isPackaged ? path.dirname(app.getPath('exe')) : process.cwd();
      return await AntigravityCliService.getInstance(realRoot).detectCli();
    } catch {
      return { available: false };
    }
  });

  ipcMain.handle('astrolib:reveal-file-in-folder', async (_event, rawPath: string) => {
    try {
      const clean = String(rawPath || '').trim();
      if (!clean) return { ok: false, error: '路径为空' };
      const absTarget = path.isAbsolute(clean) ? path.resolve(clean) : path.resolve(projectRoot, clean);
      const rel = path.relative(projectRoot, absTarget);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        return { ok: false, error: '路径超出项目根目录安全范围' };
      }
      if (!fs.existsSync(absTarget)) {
        return { ok: false, error: '目标文件不存在' };
      }
      shell.showItemInFolder(absTarget);
      return { ok: true, absPath: absTarget };
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle(
    'astrolib:export-canvas-pdf',
    async (
      _event,
      opts: { colSlug: string; bookSlug: string; chapterSlug: string; title?: string; width?: number; height?: number }
    ) => {
      if (!serverPort) return { ok: false, error: '本地服务尚未就绪' };
      const safeName = `${opts.bookSlug}-${opts.chapterSlug}`.replace(/[\\/:*?"<>|]/g, '_');
      const saveRes = await dialog.showSaveDialog(mainWindow!, {
        title: '导出自由画布笔记为矢量 PDF',
        defaultPath: `${safeName}-notes.pdf`,
        filters: [{ name: 'PDF 文档', extensions: ['pdf'] }],
      });
      if (saveRes.canceled || !saveRes.filePath) {
        return { ok: false, canceled: true };
      }

      const w = Math.max(760, Math.min(2400, Math.ceil(opts.width || 1120)));
      const h = Math.max(540, Math.min(3200, Math.ceil(opts.height || 800)));
      const exportWin = new BrowserWindow({
        show: false,
        width: w,
        height: h,
        useContentSize: true,
        backgroundColor: '#ffffff',
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      try {
        const url = `http://127.0.0.1:${serverPort}/workspace/canvas/?col=${encodeURIComponent(opts.colSlug)}&book=${encodeURIComponent(opts.bookSlug)}&chapter=${encodeURIComponent(opts.chapterSlug)}&exportMode=pdf`;
        await exportWin.loadURL(url);
        const measured: { width: number; height: number } = await exportWin.webContents.executeJavaScript(`
          new Promise((resolve) => {
            const start = Date.now();
            const check = () => {
              if (window.__astrolibExportReady || Date.now() - start > 5000) {
                (document.fonts ? document.fonts.ready : Promise.resolve()).finally(() => setTimeout(() => {
                  resolve(window.__astrolibExportSize || { width: 1120, height: 800 });
                }, 180));
              } else {
                setTimeout(check, 60);
              }
            };
            check();
          })
        `);
        const finalW = Math.max(480, Math.min(3600, Math.ceil(measured?.width || w)));
        const finalH = Math.max(360, Math.min(4800, Math.ceil(measured?.height || h)));
        const pdfBuf = await exportWin.webContents.printToPDF({
          printBackground: true,
          pageSize: {
            width: Number((finalW / 96).toFixed(2)),
            height: Number((finalH / 96).toFixed(2)),
          },
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
        });
        fs.writeFileSync(saveRes.filePath, pdfBuf);
        return { ok: true, filePath: saveRes.filePath };
      } catch (err: any) {
        return { ok: false, error: err?.message || String(err) };
      } finally {
        if (!exportWin.isDestroyed()) exportWin.destroy();
      }
    }
  );

  ipcMain.handle(
    'astrolib:export-canvas-png',
    async (
      _event,
      opts: { colSlug: string; bookSlug: string; chapterSlug: string; title?: string; dpi?: number; width?: number; height?: number }
    ) => {
      if (!serverPort) return { ok: false, error: '本地服务尚未就绪' };
      const dpi = Math.max(72, Math.min(600, Number(opts.dpi) || 192));
      const scaleFactor = dpi / 96;
      const safeName = `${opts.bookSlug}-${opts.chapterSlug}`.replace(/[\\/:*?"<>|]/g, '_');
      const saveRes = await dialog.showSaveDialog(mainWindow!, {
        title: `导出自由画布笔记为高清 PNG (${dpi} DPI)`,
        defaultPath: `${safeName}-notes-${dpi}dpi.png`,
        filters: [{ name: 'PNG 图片', extensions: ['png'] }],
      });
      if (saveRes.canceled || !saveRes.filePath) {
        return { ok: false, canceled: true };
      }

      const baseW = Math.max(760, Math.min(2600, Math.ceil(opts.width || 1120)));
      const baseH = Math.max(540, Math.min(3600, Math.ceil(opts.height || 800)));
      const pixelW = Math.min(6400, Math.round(baseW * scaleFactor));
      const pixelH = Math.min(6400, Math.round(baseH * scaleFactor));
      const exportWin = new BrowserWindow({
        show: false,
        width: pixelW,
        height: pixelH,
        useContentSize: true,
        enableLargerThanScreen: true,
        backgroundColor: '#ffffff',
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      try {
        const url = `http://127.0.0.1:${serverPort}/workspace/canvas/?col=${encodeURIComponent(opts.colSlug)}&book=${encodeURIComponent(opts.bookSlug)}&chapter=${encodeURIComponent(opts.chapterSlug)}&exportMode=png`;
        await exportWin.loadURL(url);
        exportWin.webContents.setZoomFactor(scaleFactor);
        const measured: { width: number; height: number } = await exportWin.webContents.executeJavaScript(`
          new Promise((resolve) => {
            const start = Date.now();
            const check = () => {
              if (window.__astrolibExportReady || Date.now() - start > 5000) {
                (document.fonts ? document.fonts.ready : Promise.resolve()).finally(() => setTimeout(() => {
                  resolve(window.__astrolibExportSize || { width: 1120, height: 800 });
                }, 260));
              } else {
                setTimeout(check, 60);
              }
            };
            check();
          })
        `);
        const capW = Math.min(8000, Math.max(480, Math.round((measured?.width || baseW) * scaleFactor)));
        const capH = Math.min(8000, Math.max(360, Math.round((measured?.height || baseH) * scaleFactor)));
        exportWin.setContentSize(capW, capH);
        await new Promise((r) => setTimeout(r, 80));
        const image = await exportWin.webContents.capturePage({ x: 0, y: 0, width: capW, height: capH });
        fs.writeFileSync(saveRes.filePath, image.toPNG());
        return { ok: true, filePath: saveRes.filePath };
      } catch (err: any) {
        return { ok: false, error: err?.message || String(err) };
      } finally {
        if (!exportWin.isDestroyed()) exportWin.destroy();
      }
    }
  );
}

app.whenReady().then(async () => {

  try {
    if (!app.isDefaultProtocolClient('astrolib')) {
      app.setAsDefaultProtocolClient('astrolib');
    }
  } catch {}
  const userAbpDir = path.join(app.getPath('userData'), 'abp-packs');
  const customModelsDir = path.join(app.getPath('userData'), 'models');
  process.env.ASTROLIB_USER_DATA_DIR = app.getPath('userData');
  if (app.isPackaged) {
    process.env.ASTROLIB_MODELS_DIR = customModelsDir;
    process.env.ASTROLIB_USER_ABP_DIR = userAbpDir;
    process.env.ASTROLIB_ANNOTATIONS_DIR = path.join(app.getPath('userData'), 'annotations');
    if (!process.env.HF_HOME) {
      process.env.HF_HOME = customModelsDir;
    }
    if (!process.env.ASTROLIB_INGEST_DIR) {
      process.env.ASTROLIB_INGEST_DIR = path.join(app.getPath('userData'), 'ingest-tasks');
    }
    if (!process.env.ASTROLIB_PDF2ABP_DIR) {
      process.env.ASTROLIB_PDF2ABP_DIR = path.join(app.getPath('userData'), 'pdf2abp-jobs');
    }
  }
  bookManager = new DesktopBookManager(userAbpDir);
  libraryManager = new DesktopLibraryManager(bookManager, projectRoot);
  const activeBookManager = bookManager;
  const activeLibraryManager = libraryManager;

  registerElectronAbpInstaller(async (abpBuffer) => {
    const installedMeta = await activeBookManager.installBookFromAbp(abpBuffer);
    activeLibraryManager.invalidateCache();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('astrolib:library-updated', {
        id: installedMeta.manifest.id,
        title: installedMeta.manifest.title,
      });
    }
    return installedMeta;
  });

  const savedIdleTtl = SettingsManager.getInstance().get('astrolib_local_model_idle_ttl_ms');
  const initialIdleTtlMs = parseModelIdleTtlMs(savedIdleTtl ?? undefined);
  process.env.ASTROLIB_MODEL_IDLE_TTL_MS = String(initialIdleTtlMs);
  QwenHighlightService.getInstance().setIdleTimeoutMs(initialIdleTtlMs);
  QwenEngine.getInstance().setIdleTimeoutMs(initialIdleTtlMs);
  BilingualOnnxEngine.getInstance().setIdleTimeoutMs(initialIdleTtlMs);

  setupIpcHandlers();

  modelManager = new ModelManager(projectRoot, customModelsDir);

  modelManager.onProgress((progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('astrolib:model-progress', progress);
    }
  });

  try {
    localServer = new LocalServer(projectRoot, distDir, userAbpDir);
    serverPort = await localServer.start(62960);
    log(`[astrolib-desktop] 本地服务已启动于 http://127.0.0.1:${serverPort}`);

    const defaultSess = session.defaultSession;
    defaultSess.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false);
    });
    defaultSess.setPermissionCheckHandler(() => false);

    const serverAuthToken = localServer.getAuthToken();
    const localPortStr = String(serverPort);
    defaultSess.webRequest.onBeforeSendHeaders(
      {
        urls: [
          `http://127.0.0.1:${localPortStr}/*`,
          `http://localhost:${localPortStr}/*`,
        ],
      },
      (details, callback) => {
        try {
          const reqUrl = new URL(details.url);
          if (
            (reqUrl.hostname === '127.0.0.1' || reqUrl.hostname === 'localhost') &&
            reqUrl.port === localPortStr
          ) {
            const requestHeaders = {
              ...details.requestHeaders,
              'X-AstroLib-Token': serverAuthToken,
            };
            callback({ requestHeaders });
            return;
          }
        } catch {

        }
        callback({ requestHeaders: details.requestHeaders });
      }
    );

    let captureMutex: Promise<unknown> = Promise.resolve();
    registerElectronCanvasCapturer((captureReq: CanvasCaptureRequest) => {
      const task = captureMutex.then(async (): Promise<CanvasCaptureResult> => {
        const w = Math.max(320, Math.min(1440, captureReq.width || 900));
        const h = Math.max(240, Math.min(1200, captureReq.height || 620));
        const consoleErrors: string[] = [];

        const win = new BrowserWindow({
          width: w,
          height: h,
          show: false,
          backgroundColor: captureReq.darkTheme ? '#131316' : '#ffffff',
          webPreferences: {
            offscreen: true,
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
          },
        });

        try {
          win.webContents.on('console-message', (_ev, level, message) => {
            if (level >= 2 && consoleErrors.length < 20) {
              consoleErrors.push(String(message || '').slice(0, 300));
            }
          });

          const localOrigin = `http://127.0.0.1:${serverPort}`;
          const localPrefix = `${localOrigin}/api/v1/content/annotations`;
          const htmlRebased = captureReq.html
            .replace(/(["'])\/api\/v1\/content\/annotations\//g, `$1${localPrefix}/`)
            .replace(/'self'/g, `'self' ${localOrigin}`);

          await Promise.race([
            new Promise<void>((resolve, reject) => {
              win.webContents.once('did-finish-load', () => resolve());
              win.webContents.once('did-fail-load', (_e, code, desc) => {
                reject(new Error(`Canvas load failed (${code}): ${desc}`));
              });
              void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlRebased)}`);
            }),
            new Promise<void>((_, reject) =>
              setTimeout(() => reject(new Error('Offscreen canvas capture timed out (6s)')), 6000)
            ),
          ]);

          await new Promise((r) => setTimeout(r, 380));

          const telemetry = await Promise.race([
            win.webContents.executeJavaScript(
              'window.__collectAstrolibCanvasTelemetry ? window.__collectAstrolibCanvasTelemetry() : null'
            ),
            new Promise<null>((r) => setTimeout(() => r(null), 1500)),
          ]).catch(() => null);

          const nativeImg = await Promise.race([
            win.webContents.capturePage(),
            new Promise<null>((_, reject) =>
              setTimeout(() => reject(new Error('capturePage timed out')), 2500)
            ),
          ]);
          const screenshotDataUrl = nativeImg ? nativeImg.toDataURL() : undefined;

          const mergedConsoleErrors = Array.from(
            new Set([
              ...consoleErrors,
              ...(Array.isArray(telemetry?.consoleErrors) ? telemetry.consoleErrors : []),
            ])
          ).slice(0, 20);

          return {
            available: true,
            screenshotDataUrl,
            width: w,
            height: h,
            consoleErrors: mergedConsoleErrors,
            overflowX: Boolean(telemetry?.overflowX),
            overflowY: Boolean(telemetry?.overflowY),
            katexNodeCount: Number(telemetry?.katexNodeCount) || 0,
            katexErrorCount: Number(telemetry?.katexErrorCount) || 0,
          };
        } catch (err: any) {
          return {
            available: false,
            width: w,
            height: h,
            consoleErrors: [...consoleErrors, err?.message || String(err)],
            overflowX: false,
            overflowY: false,
            katexNodeCount: 0,
            katexErrorCount: 0,
            note: err?.message || String(err),
          };
        } finally {
          try {
            if (!win.isDestroyed()) win.destroy();
          } catch {}
        }
      });
      captureMutex = task.catch(() => {});
      return task;
    });

    createMainWindow(serverPort);

    app.on('web-contents-created', (_event, contents) => {
      contents.setWindowOpenHandler(({ url }) => {
        log(`[GLOBAL_WINDOW_OPEN] 拦截 WebContents 窗口请求: ${url}`);
        if (url.startsWith('astrolib:') || url.includes('/astrolib:') || url.includes('/collections/')) {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('astrolib:navigate-to-url', url);
          }
          return { action: 'deny' };
        }
        openExternalSafely(url);
        return { action: 'deny' };
      });
    });

  } catch (err: any) {
    log(`[CRITICAL] 本地服务启动失败: ${err?.stack || err}`);
  }

  nativeTheme.on('updated', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const savedTheme = SettingsManager.getInstance().get('starlight-theme');
      if (!savedTheme || savedTheme === 'auto') {
        const isDark = nativeTheme.shouldUseDarkColors;
        try {
          mainWindow.setBackgroundColor(isDark ? '#131316' : '#ffffff');
        } catch {}
      }
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && serverPort > 0) {
      createMainWindow(serverPort);
    }
  });
});

app.on('window-all-closed', () => {
  log('[LIFECYCLE] 所有窗口已关闭，准备退出应用');
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  try {
    QwenHighlightService.getInstance().destroy();
  } catch {}
  try {
    QwenEngine.getInstance().destroy();
  } catch {}
  try {
    await BilingualOnnxEngine.getInstance().dispose();
  } catch {}
  if (localServer) {
    await localServer.stop();
  }
});
