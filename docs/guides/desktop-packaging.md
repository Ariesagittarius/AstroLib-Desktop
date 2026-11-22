# Desktop Packaging & Offline Assets Guide

AstroLib Desktop targets offline-first reliability in Windows environments (`win32-x64`) with zero runtime CDN requirements.

## 1. Self-Hosted Offline Assets

External links to `fonts.googleapis.com`, `fonts.cdnfonts.com`, and unpkg/jsdelivr PDF.js CDNs are prohibited:

- **Typography**: Bundled via `@fontsource-variable/plus-jakarta-sans`, `@fontsource-variable/noto-sans-sc`, `@fontsource-variable/noto-serif-sc`, `@fontsource-variable/jetbrains-mono` (or fallbacks) and `src/styles/fonts.css`.
- **Icons**: Google Material Symbols Outlined (`material-symbols` package) copied to `public/fonts/material-symbols-outlined.woff2` and mapped via `.material-symbols-outlined` `@font-face` rules in both `src/styles/fonts.css` and `electron/server/canvas-workspace-template.ts`.
- **KaTeX & Canvas Offline Rendering**: `scripts/build-electron.mjs` copies `katex.min.css`, `katex.min.js`, `auto-render.min.js`, `mhchem.min.js`, and `.woff2` fonts into `dist-electron/katex/`, served locally under `/api/v1/content/annotations/*`.

## 2. Electron Build Pipeline (`scripts/build-electron.mjs`)

`node scripts/build-electron.mjs` bundles:

- `electron/main.ts` -> `dist-electron/main.mjs` (ESM, externalizing `'electron'`, `'@huggingface/transformers'`, `'onnxruntime-node'`, `'sharp'`, `'mupdf'`).
- `electron/preload.ts` -> `dist-electron/preload.cjs` (CJS sandbox-safe bridge).
- Python inference daemons into `dist-electron/`:
  - `qwen-highlight-runner.py` (from `src/services/info-highlight/`)
  - `qwen-runner.py` (from `src/server/plugins/bilingual-aligner/`)

## 3. ASAR Packaging Rules (`package.json` `build`)

Key packaging invariants verified by `tests/contract/packaging-hygiene.test.ts` and `tests/contract/zero-precompiled-books.test.ts`:

- `asar: true` with `asarUnpack` explicitly unpacking `dist-electron/qwen-highlight-runner.py`, `dist-electron/qwen-runner.py`, `public/favicon.png`, `**/*.node`, and `**/*.dll`.
- **Shipped runtime tools**: `bin/**/*` (`astrolib-cli.mjs`, `astrolib-mcp.mjs`) MUST remain included in `build.files`.
- **Zero precompiled books inside binary**: `!content-sources/**`, `!dist/collections/**`, `!dist/abp-packs/*.abp`, `!dist/abp-packs/*/**`, `!public/abp-packs/**` keep the installer under ASAR budget; books install on demand into `userData/abp-packs/`.
- **Non-Win-x64 native binaries pruned**: `@huggingface/transformers/src/**` and non-`win32/x64` ONNX binaries are excluded.

## 4. Building Portable Unpacked & Installers

```bash
# 1. Verify types, Astro checks, and static shell
npm run check:types
npm run check:astro

# 2. Build unpacked green portable directory (release/win-unpacked/AstroLib.exe)
npm run electron:pack

# 3. Build Windows NSIS Setup + Portable single-file executables (release/)
npm run electron:build
```

Note on Electron child Node spawns: inside packaged Electron, spawn `process.execPath` with `ELECTRON_RUN_AS_NODE: '1'` (via `createSanitizedChildEnv({ ELECTRON_RUN_AS_NODE: '1' })`) when invoking `bin/astrolib-cli.mjs` or `scripts/pack-book-abp.mjs`.
