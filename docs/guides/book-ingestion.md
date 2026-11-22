# Book Ingestion, PDF2ABP & EPUB Import Guide

AstroLib supports three textbook ingestion paths, all converging on canonical **ABP 1.0.0** bundles (`src/types/content-package.ts`).

## 1. MinerU PDF Ingestion (`/workspace/ingest/`)

The Ingestion Studio (`src/pages/workspace/ingest.astro` + `src/server/plugins/doc-ingestion/dev-server-plugin.mjs`) provides two parsing channels plus local MuPDF visual preview:

- **Cloud High-Precision API (`mineru-api-client.ts`)**: Uploads PDFs via MinerU v4 presigned URLs, polls task status, downloads the output ZIP over HTTPS, and unpacks via `extractZipSafely` (`src/core/book-formats/zip-reader.ts`) with strict ZipSlip and size limits. Store your MinerU API token in Settings (`POST /api/ingest/token`; `GET /api/ingest/token` returns masked metadata only).
- **Local GPU Pipeline (`local-runner.ts`)**: Runs `magic_pdf.tools.cli` via the user's configured Python executable with `createSanitizedChildEnv`.
- **Offline Page Previews**: Rendered directly via local `mupdf` endpoints (`GET /api/ingest/pdf/meta` and `GET /api/ingest/pdf/page`) with zero external PDF.js CDN requests.

## 2. PDF2ABP Multi-Agent Pipeline (`src/services/pdf2abp/`)

Mounted at `/api/v1/pdf2abp/*` and operated from Harness / Ingestion Studio:

1. Upload or select a local PDF job (`Pdf2AbpJobManager` stores working state under `ASTROLIB_PDF2ABP_DIR` or OS userData).
2. Slice contact sheets and inspect structural layout via `mupdf` + `sharp`.
3. Orchestrator (`subagent-orchestrator.ts`) schedules bounded-concurrency proofreader subagents, builds MDX chapters using `abp-spec` skill rules, compiles ABP packs via `node scripts/pack-book-abp.mjs`, and installs atomically into `DesktopBookManager` via `abp-importer.ts`.

## 3. Manual / Agent MDX Authoring & Packing

For curated textbooks under `content-sources/collections/<col>/<book>/`:

1. Ensure clean MDX chapters pass `node scripts/scan-mdx.mjs content-sources/collections/<col>/<book>`.
2. Add or verify exercise links (`src/core/content-api/exercise-bridge.ts` and `scripts/build-exercise-data.mjs`).
3. Compile into `artifacts/abp-packs/`:
   ```bash
   node scripts/pack-book-abp.mjs --col <col> --book <book>
   ```
   `pack-book-abp.mjs` generates `manifest.json`, pre-rendered `chapters/*.json` (`html`, `headings`, `toc`, footnotes), `ai-index.json`, `cross-refs.json`, and the gzip-packed `<col>-<book>.abp` bundle.

## 4. EPUB 2 / EPUB 3 Direct Import & Export

- **Desktop Import**: `DesktopBookManager.installBookFromFile` (`electron/services/book-manager.ts`) dispatches `.epub` files through `EpubBookAdapter` (`src/core/book-formats/epub-adapter.ts`). Every XHTML spine document is expanded (`expandNonVoidSelfClosingTags`), sanitized through `sanitizeAcademicHtml`, CSS-harmonized (`css-harmonizer.ts`), and packaged natively into ABP format alongside extracted footnotes and AI chunks.
- **EPUB Export CLI**: Build downloadable EPUB3 books from source MDX using:
  ```bash
  npm run epub
  ```
  Managed by `scripts/generate-epub.mjs` and `.github/workflows/epub-release.yml`.
