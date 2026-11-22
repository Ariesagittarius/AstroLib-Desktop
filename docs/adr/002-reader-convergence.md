# ADR-002: Reader Convergence onto StaticHandler and Collections Route

- **Status**: Accepted
- **Date**: 2026-11-22

## Context
Reading flows had split across a standalone Astro `/reader/` page, legacy static collection builds, and Electron's `/collections/:col/:book/:slug/` shell synthesizer (`reader-shell-template.ts`), creating duplicated link normalization and stale UI assumptions.

## Decision
Converge all desktop chapter reading onto `/collections/<col>/<book>/<slug>/` synthesized dynamically by `electron/server/static-handler.ts` + `electron/server/reader-shell-template.ts` atop the pre-built `dist/reader-shell/index.html` master chrome. Retire the legacy standalone reader Astro page, static Starlight book docs, and web developer documentation routes.

## Consequences
- Single canonical reading pipeline across all formats (`abp`, `epub`, `pdf-abp`).
- `StaticHandler` performs deterministic canonical matching and `legacySlug` `301` redirects without fuzzy scanning.
