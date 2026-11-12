/**
 * electron/main.ts
 * ============================================================================
 * AstroLib 桌面端主进程入口 (Electron Main Process Entry)
 * ============================================================================
 */

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
import { QwenHighlightService } from '../src/services/info-highlight/qwen-highlight-service.ts';

// 规范应用名称并彻底移除默认菜单栏
app.name = 'AstroLib';
Menu.setApplicationMenu(null);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 确定项目运行路径与静态资产目录
const isPackaged = app.isPackaged;
const projectRoot = isPackaged ? app.getAppPath() : process.cwd();
const distDir = path.join(projectRoot, 'dist');
const preloadPath = path.join(__dirname, 'preload.cjs');

// 全局异常与启动日志记录（输出至 AppData 目录，用于排查任何静默退出问题）
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

// 1. 单实例应用锁
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  log('[EXIT] 检测到已有实例正在运行 (SingleInstanceLock failed)，退出当前副本');
  app.quit();
} else {
  app.on('second-instance', () => {
    log('[SECOND_INSTANCE] 收到双击多开信号，自动聚焦已有主窗口');
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

/**
 * 创建主阅读窗口
 */
function createMainWindow(port: number): BrowserWindow {
  const iconPath = path.join(projectRoot, 'public', 'favicon.png');
  const savedTheme = SettingsManager.getInstance().get('starlight-theme');
  const isDark =
    savedTheme === 'dark' ||
    ((!savedTheme || savedTheme === 'auto') && nativeTheme.shouldUseDarkColors);
  const overlayColor = isDark ? '#131316' : '#ffffff';
  const symbolColor = isDark ? '#c3c6cf' : '#1f1f1f';

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
    titleBarOverlay: {
      color: overlayColor,
      symbolColor: symbolColor,
      height: 38,
    },
    show: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow.setMenu(null);

  const targetUrl = `http://127.0.0.1:${port}/desktop/`;
  log(`[WINDOW] 正在加载主页面: ${targetUrl}`);
  mainWindow.loadURL(targetUrl);

  mainWindow.webContents.on('did-finish-load', () => {
    log(`[WINDOW] 主页面加载完毕: ${mainWindow?.webContents.getURL()}`);
  });

  mainWindow.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL) => {
    log(`[WINDOW_FAIL_LOAD] 错误码=${errorCode} | 描述=${errorDescription} | URL=${validatedURL}`);
  });

  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    log(`[RENDER_PROCESS_GONE] 渲染进程异常退出: ${JSON.stringify(details)}`);
  });

  // 外部链接一律调用系统默认浏览器打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      if (!url.includes(`127.0.0.1:${port}`)) {
        shell.openExternal(url);
        return { action: 'deny' };
      }
    }
    return { action: 'allow' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

/**
 * 唤起主窗体内的设置覆盖层（不再打开独立二级窗口）
 */
function openHubOverlayInMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    mainWindow.webContents.send('astrolib:open-hub-overlay');
  }
}

/**
 * 注册 IPC 调度总线
 */
function setupIpcHandlers() {
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

  ipcMain.handle('astrolib:set-python-path', async (_event, customPath: string) => {
    EnvDetector.setCustomPythonPath(customPath);
    const customModelsDir = path.join(app.getPath('userData'), 'models');
    return EnvDetector.getDiagnostics(projectRoot, customModelsDir, true);
  });

  ipcMain.handle('astrolib:open-external-url', async (_event, url: string) => {
    if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
      await shell.openExternal(url);
    }
  });

  // ABP 预编译图书包与书架原生 IPC 路由
  ipcMain.handle('astrolib:install-book-from-abp', async (_event, abpData: Uint8Array | Buffer | ArrayBuffer) => {
    if (!bookManager) throw new Error('桌面图书服务未初始化');
    return bookManager.installBookFromAbp(abpData);
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
    return bookManager ? bookManager.removeBook(colSlug, bookSlug) : false;
  });

  ipcMain.handle('astrolib:get-storage-stats', async () => {
    return bookManager ? bookManager.getStorageStats() : { usedBytes: 0, bookCount: 0 };
  });

  ipcMain.handle('astrolib:set-theme-mode', (_event, theme: 'light' | 'dark' | 'auto') => {
    if (!mainWindow || mainWindow.isDestroyed()) return { ok: false };
    const isDark = theme === 'dark' || (theme === 'auto' && nativeTheme.shouldUseDarkColors);
    const bgColor = isDark ? '#131316' : '#ffffff';
    try {
      mainWindow.setBackgroundColor(bgColor);
      mainWindow.setTitleBarOverlay({
        color: bgColor,
        symbolColor: isDark ? '#c3c6cf' : '#1f1f1f',
        height: 38,
      });
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

  ipcMain.handle('astrolib:get-settings', async () => {
    return SettingsManager.getInstance().getAll();
  });

  ipcMain.on('astrolib:get-settings-sync', (event) => {
    event.returnValue = SettingsManager.getInstance().getAll();
  });

  ipcMain.handle('astrolib:save-setting', async (_event, key: string, value: string | null) => {
    SettingsManager.getInstance().set(key, value);
    return { ok: true };
  });

  ipcMain.handle('astrolib:save-settings-batch', async (_event, batch: Record<string, string | null>) => {
    SettingsManager.getInstance().setBatch(batch);
    return { ok: true };
  });

  // 统一书库与研读实体 (书籍 + 文献)
  ipcMain.handle('astrolib:get-library-entities', async () => {
    return libraryManager ? libraryManager.getAllEntities() : [];
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
}

// 2. 应用程序准备就绪
app.whenReady().then(async () => {
  const userAbpDir = path.join(app.getPath('userData'), 'abp-packs');
  if (app.isPackaged && !process.env.ASTROLIB_INGEST_DIR) {
    process.env.ASTROLIB_INGEST_DIR = path.join(app.getPath('userData'), 'ingest-tasks');
  }
  bookManager = new DesktopBookManager(userAbpDir);
  libraryManager = new DesktopLibraryManager(bookManager, projectRoot);

  setupIpcHandlers();

  const customModelsDir = path.join(app.getPath('userData'), 'models');
  modelManager = new ModelManager(projectRoot, customModelsDir);

  // 监听并广播模型下载进度给主窗口（设置覆盖层宿于主窗口内）
  modelManager.onProgress((progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('astrolib:model-progress', progress);
    }
  });

  try {
    localServer = new LocalServer(projectRoot, distDir, userAbpDir);
    serverPort = await localServer.start(62960); // 优先使用固定端口 62960 保证 Web Origin 与持久化存储绝对一致
    log(`[astrolib-desktop] 本地服务已启动于 http://127.0.0.1:${serverPort}`);

    createMainWindow(serverPort);

    // 后台静默预热 Qwen 信息高亮常驻模型（显存占用 ~1.14 GB，实现透镜秒级响应）
    setTimeout(() => {
      QwenHighlightService.getInstance().prewarm().then((ok) => {
        if (ok) log('[INFO_HIGHLIGHT] Qwen3-0.6B 模型常驻后台已预热完成');
      }).catch(() => {});
    }, 2000);
  } catch (err: any) {
    log(`[CRITICAL] 本地服务启动失败: ${err?.stack || err}`);
  }

  // 监听操作系统级日夜模式变化，无缝同步 Windows 标题栏三键颜色
  nativeTheme.on('updated', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const isDark = nativeTheme.shouldUseDarkColors;
      try {
        mainWindow.setTitleBarOverlay({
          color: isDark ? '#131316' : '#ffffff',
          symbolColor: isDark ? '#c3c6cf' : '#1f1f1f',
          height: 38,
        });
      } catch {}
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && serverPort > 0) {
      createMainWindow(serverPort);
    }
  });
});

// 3. 所有窗口关闭时退出
app.on('window-all-closed', () => {
  log('[LIFECYCLE] 所有窗口已关闭，准备退出应用');
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// 4. 应用退出前清理
app.on('before-quit', async () => {
  try {
    QwenHighlightService.getInstance().destroy();
  } catch {}
  if (localServer) {
    await localServer.stop();
  }
});
