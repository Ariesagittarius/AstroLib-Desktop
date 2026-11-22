# Reader Shell, ABP Runtime & Sideload Dock

## 1. Converged Reader Path (`/collections/<col>/<book>/<slug>/`)

Desktop reading no longer uses static Astro book compilation or the legacy `/reader/` route. Every chapter request resolves dynamically through `StaticHandler`:

1. Locate the canonical chapter JSON from installed packs (`userData/abp-packs/<col>-<book>/chapters/<slug>.json`) or dev packs (`artifacts/abp-packs/`).
2. If the requested slug matches a `legacySlug` alias in `manifest.json`, emit `HTTP 301` redirecting to the canonical URL; if missing, render a structured 404 academic diagnostic view.
3. Synthesize the HTML document via `synthesizeReaderPageHtml` in `electron/server/reader-shell-template.ts` using `dist/reader-shell/index.html` as the styling/chrome master shell:
   - Sanitize `payload.html` and `payload.chapterIntro.html` through `sanitizeAcademicHtml`.
   - Build cross-collection / multi-book navigation sidebar trees (`collections`, expand/collapse, active highlight).
   - Extract structured outline HTML via `buildStructuredTocHtml()` with module chips (`[引]`, `[习]`, `[定]`, `[理]`, `[例]`) and `.toc-collapse-btn`.
   - Render `<Solution>` blocks as `.solution-details` (`<details>`) preserving the QED tombstone marker (`∎`), and compile digital resources as `.academic-digital-resource` cards.

## 2. Sideload Dock Architecture

Right-hand auxiliary reading tools mount inside a single host `.astrolib-sideload-dock` (`PageSidebarOverride.astro`), arbitrated exclusively by `sideloadManager` (`src/components/sideload/sideload-manager.ts`):

- **Default panel**: `toc` (chapter outline + `.toc-chunk` academic blocks).
- **Panels**: `exercises` (`ExerciseModal` / `ExerciseSidebarController`), `aiAsk`, `translation`, `bilingualComparison`, `infoHighlight`, `annotations` (injected by `reader-annotations-addon.ts`).
- **Responsive sheets**: Docked side-by-side (`--sl-sideload-width`) on desktop (`>= 72rem`), M3 Side Sheet overlay with scrim on tablet (`50rem–72rem`), and M3 Bottom Sheet (`100vw`, `max-height: 85vh`) on mobile (`< 50rem`).
- **Standard exits**: Header back-to-TOC button (`#sideload-back-to-toc`), `Escape` key, and scrim click always return safely to `toc`.

## 3. Infinite Canvas & Annotations (`/workspace/canvas/`)

- Template & scripts: `electron/server/canvas-workspace-template.ts`, `electron/server/canvas/client-script.ts`, and `electron/server/reader-annotations-addon.ts`.
- Persistent highlights, sidenotes, freehand ink strokes, and AST-quoted canvas blocks store out-of-tree via `AnnotationStorageService` (`src/core/annotations/annotation-storage.ts`) using `.anp` packages.
- Self-hosted KaTeX assets served from `/api/v1/content/annotations/*` enable instant offline math rendering inside both sidenotes and free canvas cards.
