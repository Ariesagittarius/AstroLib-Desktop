# Security Policy

## Trust Model

AstroLib is a local-first Electron desktop reading, research, and publishing environment designed around two explicit trust boundaries:

1. **Untrusted External Boundary (Zero-Trust)**: External links, imported EPUB/ABP/ZIP archives, HTML fragments rendered in the reader or canvas, third-party HTTP origins, and subprocess environments.
2. **Trusted Local Single-User Agent**: First-party workspace tooling (`PluginEnvironment`, Content API, CLI/MCP runners, PDF2ABP orchestrator) invoked by the local user inside Electron or local development.

## Desktop Hardening Controls

- **Renderer Isolation**: All Electron `BrowserWindow` instances (main window, offscreen capture windows, and export windows) enforce `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`. Preload (`electron/preload.ts`) exposes only typed IPC channels through `contextBridge`.
- **Loopback Server Authentication**: `electron/server/local-server.ts` binds strictly to `127.0.0.1` and generates a per-launch random `X-AstroLib-Token` (`crypto.randomBytes(32)`), injected automatically into same-port loopback requests via Electron `session.defaultSession.webRequest.onBeforeSendHeaders`. Cross-site `Sec-Fetch-Site`, mismatched `Host`, cross-origin or wrong-port loopback `Origin`, and wildcard CORS headers (`Access-Control-Allow-Origin: *`) are rejected (`403`/`401`).
- **CSP & Permissions**: HTTP responses carry strict security headers (`X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: no-referrer`, `Cross-Origin-Resource-Policy: same-origin`, and `Content-Security-Policy`). Session permission requests are denied by default.
- **HTML & XSS Sanitization**: Reader pages (`electron/server/reader-shell-template.ts`), EPUB ingestion (`src/core/book-formats/epub-adapter.ts`), annotation markdown rendering (`src/server/plugins/content-api/dev-server-plugin.mjs`), annotation persistence (`src/core/annotations/annotation-storage.ts`), and Content API node extracts run through `sanitizeAcademicHtml` (`src/core/security/html-sanitizer.ts`, backed by `unified` + `rehype-parse` + `rehype-stringify`), while client surfaces escape/sanitize before DOM injection.
- **Secrets at Rest & Child Env Isolation**: `SettingsManager` (`electron/services/settings-manager.ts`) encrypts API keys and tokens via Electron `safeStorage` (`enc:v1:...`), and `createSanitizedChildEnv` (`src/core/security/child-env.ts`) strips credential environment variables from Python/LaTeX/CLI child processes.
- **Path & Archive Safety**: Book storage, annotations, Content API file writes, and MinerU ZIP extraction (`extractZipSafely` reusing `ZipArchive`) enforce canonical `path.relative` containment checks and size caps against path traversal and ZipSlip.

## Reporting a Vulnerability

If you discover a security issue in AstroLib, please report reproduction steps and impact privately to the repository maintainers before disclosing details publicly. Do not commit secrets, API keys, `.env*` files, or `.mineru.json` into version control.
