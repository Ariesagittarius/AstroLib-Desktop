# Security Model & Hardening Controls

AstroLib enforces a **dual-zone trust boundary**: strict zero-trust defense on external inputs, HTTP boundaries, child processes, archives, and DOM rendering, paired with intentional single-user agency inside trusted local tooling.

## 1. Network & Loopback Boundary (`LocalServer` & `Electron`)

- **Loopback-Only Binding**: `LocalServer` (`electron/server/local-server.ts`) binds strictly to `127.0.0.1`.
- **No Wildcard CORS**: All `Access-Control-Allow-Origin: *` and `Access-Control-Allow-Headers: *` headers are eliminated across `electron/` and all `src/server/plugins/*` handlers.
- **Host / Origin / Fetch-Site Validation**: Requests carrying a non-loopback `Host`, an `Origin` header not matching exact `http(s)://127.0.0.1:<port>` or `localhost:<port>`, `Origin: null`, or `Sec-Fetch-Site: cross-site` are rejected immediately with `403`.
- **Per-Launch `X-AstroLib-Token`**: `LocalServer` generates a 256-bit `crypto.randomBytes(32)` token on startup and enforces constant-time (`crypto.timingSafeEqual`) token verification (`401`) on all `/api/*` and `/__*` routes (excluding `/api/desktop/health`). Electron's main process attaches the token transparently via `session.defaultSession.webRequest.onBeforeSendHeaders` only for exact loopback host + port URLs, never exposing it to external origins or client globals.
- **Security Headers & CSP**: Every response carries `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: no-referrer`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`, `Cross-Origin-Resource-Policy: same-origin`, and `Content-Security-Policy` blocking `object-src`, untrusted scripts, external frames, and `form-action`.
- **Dev Tunnel Gating**: Vite `allowedHosts` in `astro.config.mjs` is disabled by default unless `ASTROLIB_ENABLE_TUNNEL=1` is explicitly set.

## 2. Electron Renderer & Navigation Sandbox

- `mainWindow`, `exportWin` (PDF & PNG), and offscreen `captureWin` run with `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`.
- `electron/preload.ts` avoids all Node globals (`process.env`, `fs`, `path`), retrieving `appVersion` synchronously over IPC (`astrolib:get-app-version-sync`).
- `setPermissionRequestHandler` and `setPermissionCheckHandler` deny all browser permission prompts.
- `will-navigate`, `setWindowOpenHandler`, and `astrolib:open-external-url` route through `openExternalSafely`, permitting only external `http:` / `https:` URLs in the OS browser while blocking dangerous schemes (`file:`, `javascript:`, `vbscript:`).

## 3. HTML XSS Sanitization

- **`src/core/security/html-sanitizer.ts` (`sanitizeAcademicHtml`)**: Uses `unified` + `rehype-parse` + `rehype-stringify` (HAST AST allowlist) rather than regex tag stripping. Drops dangerous subtrees (`<script>`, `<style>`, `<iframe>`, `<object>`, `<embed>`, `<form>`, `<foreignobject>`, `<animate>`, `<set>`), removes `on*`, `srcdoc`, and `formaction` attributes, blocks `javascript:`, `vbscript:`, `data:text/html`, and `data:image/svg+xml` URLs (including entity-encoded variants), restricts SVG `<use>` to local `#fragments`, enforces `rel="noopener noreferrer"` on `target="_blank"`, and neutralizes dangerous CSS expressions (`url(...)`, `expression(...)`, `@import`), while keeping KaTeX MathML/SVG/styles and academic `<details>`/`<summary>` intact.
- Wired into `reader-shell-template.ts`, `epub-adapter.ts`, `annotation-storage.ts`, `content-api-service.ts` (`getChapterNodeHtml`), and `/api/v1/content/annotations/render-markdown`.
- Browser views (`search-modal-client.ts`, `canvas/client-script.ts`, `reader-annotations-addon.ts`) apply `escapeHtml` / `sanitizeClientHtml` / `sanitizeCssColor` prior to DOM `innerHTML` insertion.

## 4. Subprocess, Path & Archive Safety

- **`src/core/security/child-env.ts` (`createSanitizedChildEnv`)**: Filters inherited `process.env` through an explicit non-secret allowlist and sensitive-name regex (`KEY`, `TOKEN`, `SECRET`, `PASSWORD`, `CREDENTIAL`, `AUTH`, etc.) before spawning Python runners (`model-manager.ts`, `qwen-engine.ts`, `qwen-highlight-service.ts`, `local-runner.ts`), `xelatex` (`chapter-export`), or CLI child processes (`content-api-service.ts`, `content-api/dev-server-plugin.mjs`).
- **`model-manager.ts`**: Validates HuggingFace mirror URLs against `https:` allowlist (`hf-mirror.com`, `huggingface.co`) and passes arguments via sanitized env vars instead of Python `-c` string interpolation.
- **ZipSlip & Shell-Free ZIP Extraction**: `mineru-api-client.ts` replaces `tar` / `powershell Expand-Archive` shell invocations with `extractZipSafely` backed by `ZipArchive.fromBytes(..., { strictSafePaths: true })` and `path.relative` destination containment + 100 MB ZIP / 256 MB extracted caps.
- **Path Containment**: Enforced in `DesktopBookManager`, `AnnotationStorageService` (`path.relative`), `ContentApiService`, `StaticHandler` (`/astrolib:*` redirects), and `remote-catalog-service.ts` (HTTPS/loopback check + 20 MB stream size cap).

## 5. Secrets at Rest & Credential Masking

- `SettingsManager` (`electron/services/settings-manager.ts`) encrypts API keys and tokens via Electron `safeStorage` (`enc:v1:...`), auto-migrating historical plaintext JSON values.
- `GET /api/ingest/token` returns `{ hasToken, maskedToken }` rather than raw MinerU credentials (`settings-ingest-client.ts` prompts only for replacement input).
