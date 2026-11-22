# Architecture Overview

AstroLib is organized as an offline-first **Electron Desktop Host** backed by a headless **TypeScript Domain Core**, **ABP 1.0.0 Portable Book Packages**, and a **Material Design 3** presentation shell.

## Architectural Layers

```text
+-------------------------------------------------------------------+
| Electron Host (electron/main.ts, preload.ts)                      |
|  - Window & Sandbox Management (mainWindow, exportWin, captureWin)|
|  - Loopback HTTP Server (127.0.0.1:62960 + X-AstroLib-Token)      |
|  - Services: BookManager, LibraryManager, SettingsManager,        |
|              ModelManager, EnvDetector, RemoteCatalogService      |
+-------------------------------------------------------------------+
        |                                       |
        v                                       v
+-------------------------------+  +--------------------------------+
| StaticHandler + Reader Shell  |  | Lazy Server Middleware Plugins |
| - /desktop/ (Library & Host)  |  | - /api/v1/content/*            |
| - /collections/:c/:b/:s/      |  | - /api/v1/pdf2abp/*            |
| - /workspace/canvas/          |  | - /api/ingest/*                |
| - /workspace/ingest/          |  | - /__chapter_export__/*        |
| - reader-shell-template.ts    |  | - /__bilingual__/*             |
|                               |  | - /__info_highlight__/*        |
|                               |  | - /api/translate*, /api/dict*  |
|                               |  | - /api/proxy/{gemini,bupt}/*   |
+-------------------------------+  +--------------------------------+
        |                                       |
        +-------------------+-------------------+
                            v
+-------------------------------------------------------------------+
| Domain Core & Publishing (src/core/, src/publishing/, src/services/)|
|  - ContentApiService & UniversalLocatorResolver (astrolib:// URI) |
|  - AnnotationStorageService & Canvas Linker (ANP 1.0.0)           |
|  - Book Format Adapters (EpubBookAdapter, ZipArchive)             |
|  - ABP Compiler, LaTeX/Typst/EPUB Publishers, Search-Rec Engine   |
|  - Security Primitives (sanitizeAcademicHtml, createSanitizedChildEnv)|
+-------------------------------------------------------------------+
```

## Directory Responsibility Map

| Path | Role | Boundary Invariant |
| :--- | :--- | :--- |
| `electron/` | Native desktop shell, local HTTP server, IPC, model/settings managers | No authoring source mutation; sandboxed renderers |
| `src/core/` | Pure domain models, Content API, ANP annotations, book formats, security primitives | Zero dependency on `src/components/` or UI state |
| `src/publishing/` | Headless compilers for ABP, LaTeX, Typst, EPUB (`pack-book-abp.mjs` targets) | Must not import UI components or browser state |
| `src/server/plugins/` | Vite & `LocalServer` Connect middleware routes | Never emits `Access-Control-Allow-Origin: *` |
| `src/plugins/harness/` | Agent `PluginEnvironment` and builtin tools (`ast`, `read`, `annotations`, etc.) | Read-only textbook tools; sandboxed file tools |
| `src/features/` | Isolated client subsystems (`harness`, `search-rec`, `doc-ingestion`, `exercises`, `info-highlight`) | State & UI logic cohesive per feature |
| `src/components/` | Material Design 3 UI shells (`m3/`, `desktop/`, `sideload/`, `harness/`, Starlight overrides) | Presentation only; no canonical domain types |
| `content-sources/` | Authoritative raw textbook MDX files & exercise datasets | Never compiled by Astro static build |
| `artifacts/abp-packs/` | Generated `.abp` bundles, chapter payloads, and `catalog.json` | Regenerable build output, never committed as source |
| `bin/` | Headless CLI (`astrolib-cli.mjs`) and MCP stdio server (`astrolib-mcp.mjs`) | Packaged inside Electron `build.files` |
