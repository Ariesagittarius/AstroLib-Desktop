# ADR-009: Offline-First Desktop Assets and MuPDF Preview

- **Status**: Accepted
- **Date**: 2026-11-22

## Context
Legacy pages referenced external font CDNs (`fonts.googleapis.com`, `fonts.cdnfonts.com`) and third-party PDF.js CDN workers, breaking offline launches and leaking desktop network telemetry.

## Decision
Bundle `material-symbols` WOFF2 glyphs into `public/fonts/`, self-host `@fontsource-variable/*` web fonts and KaTeX assets (`dist-electron/katex/`), replace PDF.js CDN previews with local `mupdf` endpoints (`/api/ingest/pdf/*`), and gate external BUPT/translation proxy calls strictly when valid loopback API endpoints exist.

## Consequences
- Full offline desktop fidelity with zero external CDN requests at runtime.
- Eliminates network errors on air-gapped or restrictive campus networks.
