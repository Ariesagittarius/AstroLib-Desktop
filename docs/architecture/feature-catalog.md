# Desktop Feature Catalog & Retirement Matrix

This catalog documents every active Desktop feature (the 16 modules declared in `src/config/features.config.ts` plus host subsystems) along with its entrypoint, server dependency, and configuration source, as well as legacy web-era modules permanently removed.

## 1. Active Feature Modules (`src/config/features.config.ts`)

| Feature ID | Category | Default | Purpose & Desktop Entrypoint |
| :--- | :--- | :--- | :--- |
| `katex` | `reader` | Enabled | Server/build-time KaTeX math typesetting with `data-latex` attributes (`src/plugins/rehype/` and `src/publishing/abp/compiler.ts`). |
| `mathPromote` | `reader` | Enabled | Promotes standalone mathematical symbols in prose into KaTeX nodes (requires `katex`). |
| `cjkPunctuation` | `reader` | Enabled | Normalizes academic CJK punctuation spacing at compile time. |
| `formulaActions` | `reader` | Enabled (UI) | Hover/click LaTeX source copy and SVG/PNG formula export inside chapter pages. |
| `theme` | `reader` | Enabled (UI) | Light/dark/auto switching and Material You seed color theming (`SettingsManager` + `ThemeSelectOverride.astro`). |
| `fonts` | `reader` | Enabled (UI) | Self-hosted Source Han Serif/Sans, Plus Jakarta Sans, and CJK indent controls (`src/styles/fonts.css`). |
| `crossRef` | `reader` | Enabled (UI) | Interactive theorem/equation/section cross-reference chips (`config.refs: 'interactive'`). |
| `imageBlur` | `reader` | Disabled (Opt-in) | Optional compile-time Gaussian LQIP image placeholders during ABP packing. |
| `mermaid` | `extra` | Enabled (UI) | Client-side Mermaid diagram rendering inside chapters (`mermaid-loader.ts`) and corpus integrity checks. |
| `chapterExport` | `extra` | Enabled (UI) | `#btn-chapter-export` (`Alt+X`) exporting active `content-sources/` chapter to `.tex`, compilable `.zip`, or local `xelatex -no-shell-escape` PDF via `/__chapter_export__/*`. |
| `loadingIndicator` | `reader` | Enabled (UI) | M3 morphing progress indicator (`@alerix/m3-loading-indicator` / `@material/web`). |
| `aiAsk` | `extra` | Enabled (UI) | Chapter RAG assistant in Sideload Dock (`ai-ask` panel, client BYOK / BUPT campus gateway, Gemini proxy). |
| `translation` | `reader` | Enabled (UI) | Textbook translation and side-by-side reader via `/api/translate` and `/api/dict` (`defaultDisplayMode: 'sidebar'`). |
| `bilingualComparison` | `reader` | Enabled (UI) | Local MiniLM ONNX & Qwen3 embedding alignment over `/__bilingual__/*` and `AlignmentHeatmapSheet.astro` (full UI rewrite planned separately). |
| `infoHighlight` | `reader` | Enabled (UI) | Focus lens (`Alt+I`) driven by local Qwen3-0.6B surprisal daemon over `/__info_highlight__/*`. |
| `exercises` | `reader` | Enabled (UI) | Static ABP chapter exercises, interactive practice modal (`ExerciseModal`), and `FeedbackSubmodal` (backed by `scripts/build-exercise-data.mjs`). |

## 2. Core Desktop & Agent Subsystems

| Subsystem | UI Entrypoint | Backend / IPC |
| :--- | :--- | :--- |
| Desktop Library & Multi-Fragment Host | `/desktop/` (`FragmentReaderHost.astro`, `NavigationRail.astro`) | `DesktopBookManager`, `DesktopLibraryManager`, `LocalServer`, `StaticHandler` |
| Reader Shell & Sideload Dock | `/collections/<col>/<book>/<slug>/` (`PageSidebarOverride.astro`) | `electron/server/reader-shell-template.ts`, `sideload-manager.ts` |
| Semantic Search & Discovery Modal | `Ctrl+K` (`search-modal-client.ts`) | Dynamic `/abp-packs/catalog.json` + `window.astrolib.getInstalledBooks` fallback + `SearchRecEngine` |
| Annotations & Infinite Canvas | Reader header/sideload (`reader-annotations-addon.ts`) & `/workspace/canvas/` | `AnnotationStorageService` (`.anp`), `/api/v1/content/annotations/*` |
| Agent Harness Sidecar | `/desktop/` sidecar (`HarnessTopBar.astro`, `harness-controller.ts`) | `PluginEnvironment`, `ContentApiService`, `/api/v1/content/*`, `astrolib-cli`, `astrolib-mcp` |
| Document Ingestion & PDF2ABP | `/workspace/ingest/` (`ingest.astro`) | `/api/ingest/*` (MinerU API, local `mupdf` preview), `/api/v1/pdf2abp/*`, `abp-importer.ts` |
| Settings Hub & Local Models | Settings overlay (`SettingsHubContent.astro`, `SettingsSystemPanels.astro`) | `SettingsManager` (`safeStorage`), `ModelManager`, `EnvDetector`, `AppUpdater` |

## 3. Permanently Retired Legacy Features

The following obsolete Web-era features and routes were deleted during the Desktop consolidation:
- `relationGraph` and static relation-graph data emission
- `inspector` and static inspector data emission
- `blankDocument` standalone scratchpad page
- `editor` dev writeback middleware
- `exercise-editor` server mutation endpoint
- `feedback` legacy floating widget
- `seo`, `pwa`, `analytics`, `prewarm`, SSR translation endpoint, and `vercel.json`
- Legacy standalone reader page and Starlight developer website docs
- Web `epub` toggle flag (replaced cleanly by the CLI script `npm run epub` and desktop `EpubBookAdapter` import)
