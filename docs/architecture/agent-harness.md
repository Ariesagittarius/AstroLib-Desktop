# Agent Harness & Content API Architecture

## 1. Unified Content Facade (`ContentApiService`)

`src/core/content-api/content-api-service.ts` is the single backend service shared by:
- HTTP REST endpoints (`src/server/plugins/content-api/dev-server-plugin.mjs` under `/api/v1/content/*`)
- Agent Extension HTTP endpoints (`src/server/plugins/content-api/agent-tools-handler.ts` under `/api/v1/content/agent-tools/*`)
- CLI runner (`bin/astrolib-cli.mjs`)
- MCP stdio server (`bin/astrolib-mcp.mjs`)
- Embedded Harness `PluginEnvironment` builtin plugins

It provides dual-mode resolution: reading live MDX from `content-sources/collections/` when present, and automatically falling back to compiled ABP packs (`userData/abp-packs/` or `artifacts/abp-packs/`) when operating from a packaged desktop installation. Path parameters (`colSlug`, `bookSlug`, `chapterSlug`) and write paths are validated with `assertSafeSlug` and `isPathInside`.

## 2. Universal Content Locator Protocol (AURP)

`src/core/content-api/content-locator.ts` parses fuzzy titles, section numbers, book abbreviations, and canonical `astrolib://<col>/<book>/<chapter>#<nodeId>` URIs into deterministic locators used across search, canvas quotes, annotations, CLI, MCP, and Harness agents.

## 3. Embedded Agent Harness (`src/features/harness/` & `src/plugins/harness/`)

- **UI & Controller**: `src/components/harness/` (`HarnessTopBar.astro`, `harness-controller.ts`) and `src/features/harness/` (`btw-sidecar.ts`, `context-manager.ts`, `settings-store.ts`, `stream-adapter.ts`).
- **Plugin Environment**: Registers tool definitions for OpenAI/Gemini tool-calling compatibility and slash commands (`src/plugins/harness/builtin/`):
  - Read-only textbook/note tools: `books`, `toc`, `ast`, `read`, `exercises`, `annotations`, `knowledge`, `diff`.
  - Workspace & Canvas tools: `canvas`, `runtime-tools`, `interaction`, `web-search`.
- **Browser Safety**: Builtin content plugins (`read.plugin.ts`, `annotations.plugin.ts`) branch cleanly between browser `fetch()` over Content API HTTP and lazy `@vite-ignore` dynamic `node:fs` imports in headless Node/CLI contexts, preventing Node core leaks in Vite browser bundles.

## 4. PDF2ABP Multi-Agent Orchestrator (`src/services/pdf2abp/`)

Converts scanned/born-digital PDFs into ABP 1.0.0 textbook packages:
- `job-manager.ts` & `workspace-manager.ts`: Isolated per-job workspaces (`ASTROLIB_PDF2ABP_DIR`) exposed read-only over `/api/v1/pdf2abp/*`.
- `pdf-processor.ts`: Local `mupdf` page rasterization, contact-sheet composition (`sharp`), and region cropping.
- `subagent-orchestrator.ts`: Bounded-concurrency chapter authoring & proofreading with rolling visual slots and checkpoint reuse.
- `abp-importer.ts`: Compiles chapters with `pack-book-abp.mjs` and pushes packages directly into `DesktopBookManager`.
