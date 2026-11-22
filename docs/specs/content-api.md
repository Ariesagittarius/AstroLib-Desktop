# Content API & AURP Specification

## 1. AstroLib Universal Resource Protocol (`astrolib://`)

Canonical academic URIs identify any textbook, chapter, section, card, formula, paragraph, or exercise deterministically:

```text
astrolib://<colSlug>/<bookSlug>[/<chapterSlug>[#<nodeId>]]
```

Implemented by `UniversalLocatorResolver` (`src/core/content-api/content-locator.ts`) and `src/utils/astrolib-uri.ts`. Fuzzy natural-language queries (book abbreviations, Chinese titles, section numbers like `1.1`, heading keywords) resolve into ranked `ContentLocator` targets.

In `electron/server/static-handler.ts`, `/astrolib:*` requests are validated against traversal characters and redirected safely via HTTP `302` to `/collections/<col>/<book>/<chapter>/`.

## 2. Headless Service Facade (`ContentApiService`)

Defined in `src/core/content-api/content-api-service.ts`, enforcing `assertSafeSlug` and `isPathInside` boundary checks on every file lookup/write:

- **Catalog & Outlines**: `listBooks()`, `getBookToc(col, book)`
- **AST & Nodes**: `getChapterAst(col, book, chapter, opts)`, `readChapterNode(col, book, chapter, nodeId)`, `getChapterNodeHtml(col, book, chapter, nodeId)` (output sanitized with `sanitizeAcademicHtml`)
- **Cross-Chapter Search & Diff**: `locateContent(query)`, `diffChapters(...)`
- **Exercises & MinerU Bridges**: `getChapterExercises`, `searchExercises`, `listMineruTasks`, `getMineruTaskData`, `getMineruLayoutSlice`
- **Annotations & Canvas**: `getBookAnnotationsOverview`, `getChapterAnnotationsRaw`, `getChapterAnnotationsWithAst`, `searchAnnotations`, `upsertChapterAnnotation`, `deleteChapterAnnotation`, `saveChapterAnnotationsPayload`, `exportBookAnp`, `importBookAnp`
- **Mutations & Packing**: `saveChapterMdx`, `packBookAbp` (`ELECTRON_RUN_AS_NODE=1` + `createSanitizedChildEnv`), `importBookFromMineru`

## 3. REST Endpoint Surface (`/api/v1/content/*`)

Mounted via `src/server/plugins/content-api/dev-server-plugin.mjs` and `agent-tools-handler.ts`:

- `GET /api/v1/content/books` — All discovered books (source + ABP packs)
- `GET /api/v1/content/locate?q=...` — AURP resolution
- `GET /api/v1/content/books/:col/:book/toc` — Book outline tree
- `GET /api/v1/content/books/:col/:book/chapters/:slug/ast` — Structured chapter AST tree
- `GET /api/v1/content/books/:col/:book/chapters/:slug/nodes/:nodeId/html` — Sanitized compiled HTML fragment for a single AST node (used by Canvas quotes)
- `POST /api/v1/content/annotations/render-markdown` — Offline Markdown + KaTeX rendering sanitized via `sanitizeAcademicHtml`
- `GET /api/v1/content/annotations/books/:col/:book/chapters/:slug` — Chapter annotations + optional AST linking
- `POST /api/v1/content/annotations/books/:col/:book/chapters/:slug` — Save/upsert/delete chapter annotations or canvas payload
- `GET /api/v1/content/annotations/books/:col/:book/export` / `POST .../import` — Export/import `.anp` bundles
- `GET|POST /api/v1/content/agent-tools/*` — Sandboxed workspace files, whitelisted plugin source read, workspace canvas screenshot, and `POST /api/v1/content/cli` execution
