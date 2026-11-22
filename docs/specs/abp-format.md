# ABP Format Specification (Schema 1.0.0)

**AstroLib Book Package (`.abp`)** is the canonical portable unit linking compiled academic textbooks, EPUB imports, exercises, and AI retrieval chunks. Core TypeScript contracts live in `src/types/content-package.ts`.

## 1. Container Layout

An ABP distribution exists in two isomorphic representations:

1. **Compact Single-File `.abp` Bundle (`AbpBundlePayload`)**: Gzip-compressed JSON serialized at `artifacts/abp-packs/<col>-<book>.abp` (containing `manifest`, `chapters`, optional `aiIndex`, `crossRefs`, `exercises`, and `assets` base64 map). Installed atomically into `userData/abp-packs/` via `DesktopBookManager.installBookFromAbp` with zip/gzip validation (`validateAbpBundle`) and SHA/content hash verification.
2. **Unpacked Directory (`artifacts/abp-packs/<col>-<book>/` or `userData/abp-packs/<col>-<book>/`)**:
   - `manifest.json` (`AstroBookManifest`)
   - `chapters/<canonical-slug>.json` (`AstroBookChapterPayload`)
   - `ai-index.json` (chunked embeddings/text for RAG & Semantic Search)
   - `cross-refs.json` (precomputed theorem/equation reference targets)
   - `exercises.json` (compiled chapter exercise items)
   - `stylesheets/` & `images/` (book-local CSS stylesheets and binary images)

## 2. Manifest Contract (`AstroBookManifest`)

- `schemaVersion`: `'1.0.0'` (`ABP_SCHEMA_VERSION`)
- `id`: `<colSlug>-<bookSlug>`
- `colSlug`, `slug`, `title`, `author`, `publisher`, `edition`, `subject`, `stage`, `cover`, `tags`, `trackClasses`, `modules`
- `sourceFormat`: `'abp' | 'epub' | 'pdf-abp'`
- `readingProfile`: `'academic' | 'literary'`
- `entryPoint`: Canonical slug of default opening chapter (must exist in `sections[].chapters`)
- `totalChapters`, `contentHash`, `stylesheets`
- `sections`: Ordered outline tree with each chapter's canonical `slug` and optional `legacySlug` alias for HTTP `301` resolution

## 3. Chapter Payload Contract (`AstroBookChapterPayload`)

- `slug`, `title`, `order`
- `html`: Pre-compiled chapter HTML sanitized through `sanitizeAcademicHtml` (`katex` spans/MathML, semantic cards, `.solution-details` with QED tombstone `∎`, `.academic-digital-resource` cards, Mermaid code blocks)
- `headings`: Extracted heading outline (`depth`, `text`, `id`) where every `id` matches DOM `h1–h4` ids (`heading-contract.test.ts`)
- `chapterIntro`: Optional preamble (`slug`, `title`, `html`)
- `footnotes`: Optional `Record<string, BookFootnoteEntry>` (used heavily by EPUB 3 `noteref` resolution)
- `htmlClasses`, `bodyClasses`, `stylesheets`

## 4. Catalog Index (`catalog.json`)

Generated statically in `artifacts/abp-packs/catalog.json` by `scripts/pack-book-abp.mjs` and synthesized live at runtime by `StaticHandler` (`/abp-packs/catalog.json`), enabling offline library discovery and Mode A remote release updates (`remote-catalog-service.ts`).
