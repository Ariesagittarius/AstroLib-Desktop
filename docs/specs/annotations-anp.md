# Annotations & AstroNote Package (`.anp`) Specification

User notes, text highlights, academic sidenotes, handwriting ink strokes, and infinite canvas workspaces are stored decoupled from textbook sources under `userData/annotations/` (`resolveAnnotationsArtifactsDir()`).

Core schema types and validators live in `src/types/annotation-package.ts`; storage persistence lives in `src/core/annotations/annotation-storage.ts` (`AnnotationStorageService`).

## 1. Per-Chapter Storage Format (`ChapterAnnotationPayload`)

- `schemaVersion`: `'1.0.0'` (`ANP_SCHEMA_VERSION`)
- `colSlug`, `bookSlug`, `chapterSlug`, `chapterTitle`, `updatedAt`
- `annotations`: Array of `BookAnnotationItem` (`highlight` | `sidenote` | `ink`):
  - Anchored via `nodeId` + canonical `astrolib://` URI + text quote offsets (`exact`, `prefix`, `suffix`) in `annotation-ast-linker.ts`
  - Stylus/handwriting `ink` strokes record hybrid normalized node-relative + margin-offset vectors so strokes track text smoothly across viewport resizes and collapsed `<details>` blocks
- `canvasNote` (`ChapterCanvasNote`):
  - Free-form infinite canvas `blocks` (Markdown/KaTeX note cards and live `ast-quote` excerpt cards linked by `astRef.nodeId`)
  - Canvas vector `strokes` and viewport pan/zoom state

## 2. Export Bundle Format (`AstroNotePackagePayload`)

`.anp` JSON packages wrap a single chapter or an entire book (`colSlug`, `bookSlug`, `bookTitle`, `exportedAt`, `chapters: Record<slug, ChapterAnnotationPayload>`).

- `validateAnpPackage` strictly validates untrusted imported bundles before persistence.
- `importBookAnp(rawPkg, mode)` supports deterministic UUID-keyed `'merge'` (`mergeChapterAnnotationPayloads`) and `'overwrite'` workflows.
- Both `getChapterAnnotations` persistence and `buildNextPayload` / `render-markdown` sanitize any `astRef.renderedHtml` payloads through `sanitizeAcademicHtml` (`src/core/security/html-sanitizer.ts`), while `getChapterFilePath` blocks path traversal via `path.relative`.
