# Development Workflow Guide

## Prerequisites

- **Node.js 22+** and `npm`
- Optional local accelerators:
  - Python `.venv` with `torch` / `transformers` / `huggingface_hub` for Qwen local models (`Qwen3-Embedding-0.6B`, `Qwen3-0.6B-Base`) or MinerU local GPU pipeline
  - TeX Live (`xelatex`) for local LaTeX -> PDF compilation (pure Node Typst compiler `@myriaddreamin/typst-ts-node-compiler` is bundled automatically)

## Repository Layout Essentials

- `content-sources/collections/` — Source MDX textbooks (`cs/`, `math/`, `science/`, `telecom/`) and images. Never built statically by Astro (`src/content/docs/collections/` must remain absent/empty).
- `artifacts/abp-packs/` — Compiled `.abp` bundles, unpacked directories, and `catalog.json` generated from `content-sources/`.
- `src/` — Astro shell pages (`/desktop/`, `/workspace/ingest/`, `/workspace/canvas/`, `/reader-shell/`), UI components (`src/components/m3/`, `src/components/sideload/`, `src/components/harness/`), core domain engines (`src/core/`), services (`src/services/`), and Vite/LocalServer middleware plugins (`src/server/plugins/`).
- `electron/` — Electron main process (`main.ts`), sandboxed preload (`preload.ts`), embedded HTTP server (`server/local-server.ts`, `server/static-handler.ts`, `server/reader-shell-template.ts`), and desktop managers (`services/*`).
- `bin/` — Headless entrypoints `astrolib-cli.mjs` and `astrolib-mcp.mjs` shipped inside Electron builds.

## Inner Development Loops

### 1. Web / Vite Shell Development

```bash
npm run dev
```

Vite loads middleware plugins configured in `astro.config.mjs` (when not static building). Manage background servers in automated sessions using `astro dev --background` / `astro dev status` / `astro dev stop`.

### 2. Full Electron Desktop Loop

```bash
# 1. Build Astro desktop shell + reader-shell into dist/
npm run build

# 2. Bundle electron/main.ts and electron/preload.ts into dist-electron/
node scripts/build-electron.mjs

# 3. Ensure compiled ABP packs exist in artifacts/abp-packs/
npm run pack:books

# 4. Launch Electron against dist/ and artifacts/abp-packs/
npm run electron:dev
```

Whenever changing code only under `electron/`, re-running `node scripts/build-electron.mjs && npm run electron:dev` avoids a full Astro rebuild. Whenever modifying Astro pages, styles, or client scripts under `src/`, run `npm run build` as well.

### 3. Adding or Updating Exercises and Book Packs

```bash
# Regenerate consolidated exercise datasets
npm run build:exercises

# Pack a single book or all 13 source books
node scripts/pack-book-abp.mjs --col math --book math_analysis
npm run pack:books
```

### 4. MDX Validation Before Committing

```bash
node scripts/scan-mdx.mjs content-sources/collections/math/math_analysis
npm run check:types
npm run check:astro
npm run test:affected
```
