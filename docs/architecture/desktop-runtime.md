# Desktop Runtime & IPC Architecture

## 1. Electron Main Process (`electron/main.ts`)

`electron/main.ts` initializes single-instance locking, custom protocol registration (`astrolib://`), user data paths (`abp-packs`, `models`, `annotations`, `ingest-tasks`, `pdf2abp-jobs`), IPC handlers, `LocalServer`, `session.defaultSession` request/permission hooks, and `BrowserWindow` lifecycle:

- **`mainWindow`**: Uses `titleBarStyle: 'hidden'` (custom 28px drag chrome inside `FragmentReaderHost.astro`), `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`. Top-level `will-navigate` stays locked to the local loopback server origin; `astrolib:` and `/collections/` links route back to the in-app SPA via `astrolib:navigate-to-url`, and external `https:` links open safely via `openExternalSafely`.
- **Offscreen & Export Windows**: Both `exportWin` instances (PDF and PNG canvas export) and `captureWin` run with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, and explicit `destroy()` in `finally`.
- **Session Hooks**:
  - `session.defaultSession.setPermissionRequestHandler` and `setPermissionCheckHandler` default-deny all permissions.
  - `session.defaultSession.webRequest.onBeforeSendHeaders` restricts header injection exclusively to exact `127.0.0.1:${serverPort}` and `localhost:${serverPort}` URLs, attaching the launch-random `X-AstroLib-Token`.

## 2. Preload Context Bridge (`electron/preload.ts`)

`electron/preload.ts` runs inside Chromium's renderer sandbox (no Node globals). It synchronously reads initial settings (`astrolib:get-settings-sync`) and app version (`astrolib:get-app-version-sync`), synchronizes `localStorage` caches seamlessly across startups without theme flicker, and exposes `window.astrolib` (`AstroLibDesktopBridge` defined in `electron/types.ts`).

## 3. Embedded HTTP Server & StaticHandler

- **`electron/server/local-server.ts` (`LocalServer`)**: Listens on `127.0.0.1:62960` (falling back to port `0` if busy). Lazily loads Connect middleware plugins only when their URL prefix matches:
  - `/__chapter_export__` -> `chapter-export`
  - `/__bilingual__` -> `bilingual-aligner`
  - `/api/proxy/gemini` -> `gemini-proxy`
  - `/api/proxy/bupt` -> `bupt-proxy`
  - `/api/translate`, `/api/dict` -> `translation`
  - `/api/ingest` -> `doc-ingestion`
  - `/__info_highlight__` -> `info-highlight`
  - `/api/v1/content` -> `content-api`
  - `/api/v1/pdf2abp` -> `pdf2abp`
- **`electron/server/static-handler.ts` (`StaticHandler`)**: Serves pre-built `dist/` assets with a 32 MB LRU memory cache + ETag 304 negotiation, synthesizes live `/abp-packs/catalog.json` from installed books + dev artifacts, handles safe `/astrolib:*` redirects, and renders `/collections/<col>/<book>/<slug>/` chapters via `reader-shell-template.ts`.

## 4. Core Desktop Services (`electron/services/`)

| Service | Responsibility |
| :--- | :--- |
| `book-manager.ts` (`DesktopBookManager`) | Atomic install/uninstall/lookup for `.abp` and `.epub` packages inside `userData/abp-packs/`, guarded by `resolveSafeSubpath`. |
| `library-manager.ts` (`DesktopLibraryManager`) | Unified book + document workspace catalog index. |
| `settings-manager.ts` (`SettingsManager`) | Atomic JSON preferences (`user_preferences.json`) with transparent `safeStorage` encryption (`enc:v1:`) for sensitive keys. |
| `model-manager.ts` (`ModelManager`) | On-demand model downloads (MiniLM via `@huggingface/transformers`, Qwen models via Python `huggingface_hub` over HTTPS allowlist & sanitized env). |
| `env-detector.ts` (`EnvDetector`) | Hardware, VRAM/CUDA/DirectML, Python interpreter, and TeX/MuPDF diagnostics. |
| `remote-catalog-service.ts` | Fetches release catalog and installs verified remote `.abp` packs (20 MB cap + SHA/contentHash verification). |
| `updater.ts` (`AppUpdater`) | GitHub release semver comparison and installer metadata lookup. |
