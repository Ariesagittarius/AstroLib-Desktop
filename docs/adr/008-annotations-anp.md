# ADR-008: Portable Annotations and Canvas Format (ANP)

- **Status**: Accepted
- **Date**: 2026-11-17

## Context
Embedding annotations inside `.abp` packs or source `.mdx` files would lose reader notes on textbook updates or contaminate published chapters.

## Decision
Store user highlights, sidenotes, handwriting ink strokes, and infinite canvas state outside book bundles under `userData/annotations/` in JSON files conforming to AstroNote Package (`.anp`, `src/types/annotation-package.ts`), anchoring strokes using hybrid node-relative coordinates (`annotation-ast-linker.ts`).

## Consequences
- Zero mutation of textbook sources (Rule 9) and lossless backup/merge across devices.
- Rendered HTML fragments stored in canvas cards pass through `sanitizeAcademicHtml` to prevent stored XSS.
