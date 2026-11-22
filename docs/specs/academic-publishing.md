# Academic Publishing, Card Taxonomy & Notice Framework Specification

AstroLib follows the **Radical Subtraction** invariant: `Academic Rigor > Minimalism > Readability > Decoration`. Visual quality comes from typography, equation alignment, semantic hierarchy, and negative space rather than decorative badges or gamified dashboards.

## 1. Semantic Card & Component Taxonomy

Chapters authored under `content-sources/collections/` use declarative MDX components:

- **Core Academic Blocks**: `<Definition>`, `<Theorem>`, `<Lemma>`, `<Proposition>`, `<Corollary>`, `<Remark>`, `<Example>`, `<Method>`, `<Proof>`, `<Note>`, `<Warning>`, `<Algorithm>`, `<DigitalResource>`.
- **Collapsible Derivations**: `<Solution>` compiles cleanly to `<details class="solution-details">` ending with the academic QED tombstone `∎`.
- **Mathematical Typesetting**: Remark/Rehype pipeline renders KaTeX (`output: 'html'`), attaches `data-latex` source for click-to-copy / SVG-PNG export, normalizes CJK spacing (`cjkPunctuation`), promotes isolated variables (`mathPromote`), and resolves cross-references (`crossRef`).
- **Syntax Validation Gate**: All edited MDX chapters must pass `node scripts/scan-mdx.mjs <book-dir>`.

## 2. Export Targets

- **LaTeX / PDF (`src/publishing/latex/` & `/__chapter_export__/`)**: Targets `Jinwen-XU/homework` macro compatibility, compiling chapters cleanly via `xelatex -no-shell-escape` in temporary `os.tmpdir()` directories without touching `public/`.
- **Typst (`src/publishing/typst/`)**: Programmatic in-memory PDF compilation via `@myriaddreamin/typst-ts-node-compiler`.
- **EPUB3 (`scripts/generate-epub.mjs`)**: Clean offline EPUB3 bundling with KaTeX math support and image embedding.

## 3. Declarative Notice Framework Specification

AstroLib includes a cascading MediaWiki-ambox-inspired **Notice Framework** (`src/config/notices.config.ts`, `src/components/notice/NoticeFramework.astro`) displaying academic publishing provenance, AI-assistance disclosures, OCR extraction notices, translations, and errata channels.

### 3.1 Cascade Precedence (Highest to Lowest)

1. **Page Frontmatter (`notices` array in `.mdx`)** — Highest priority; can override template fields or suppress inherited notices with `disabled: true`.
2. **Book-Level (`book.notices` in `src/config/collections.config.ts`)** — Applies to every chapter in the book.
3. **Collection-Level (`col.notices` in `src/config/collections.config.ts`)** — Applies across a subject collection.
4. **Route-Level (`ROUTE_NOTICES` in `src/config/notices.config.ts`)** — Pattern/prefix rules matching route paths.

Within a merged notice stack, entries sharing the same `id` (or derived `template` name) merge top-down cleanly; `{ template: 'ocr', disabled: true }` silently removes an inherited notice for a verified chapter.

### 3.2 Frontmatter Usage Patterns

Override specific template parameters (`{param}` interpolation):

```yaml
---
title: 8.4 Convexity of Functions
notices:
  - template: aiGenerated
    model: Gemini 3.8 Flash
    tags: [AI-Assisted, Reviewed]
---
```

Ad-hoc unregistered chapter notice:

```yaml
---
title: Exercise Session 04
notices:
  - message: Solutions organized by {solver} ({date}), Lecture {lectureNo}.
    solver: Teaching Staff
    date: 2026-09-15
    lectureNo: 12
    severity: neutral
    icon: school
    tags: [Lecture Notes]
    items:
      - Errata submission via sidebar feedback action
---
```

### 3.3 Notice Field Reference (`src/config/notices.config.ts`)

| Field | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `template` | `string` | `''` | Registered template name in `NOTICE_TEMPLATES` (`aiGenerated`, `ocr`, `translation`, `peerReview`). Supports kebab-case or camelCase. |
| `message` | `string` | `''` | Core notice text supporting `{param}` interpolation. Legacy `title` folds into `message`. |
| `[custom]` | `any` | - | Arbitrary template placeholder inputs (`model`, `author`, `reviewer`, `date`, etc.). |
| `severity` | `'warning' \| 'info' \| 'neutral' \| 'accent'` | `'warning'` | Visual emphasis tone. |
| `icon` | `string` | `'smart_toy'` | Standard Material Symbol (`auto_awesome`, `smart_toy`, `rate_review`, `translate`, `school`, `science`, `warning`, `verified`, `info`). |
| `tags` | `string[]` | `[]` | M3 assist chips with `{param}` interpolation support. |
| `tagPosition` | `'lead' \| 'trail'` | `'trail'` | Chip alignment relative to message copy. |
| `items` | `Array<string \| { text: string }>` | `[]` | Expandable drawer entries supporting placeholder interpolation. |
| `collapsible` | `boolean` | `true` when `items` present | Enables expandable detail drawer. |
| `dismissible` | `boolean` | `false` | Optional session dismissal control. |
| `id` | `string` | Auto-derived | Override/disable match key across cascade layers. |
| `disabled` | `boolean` | `false` | Removes matching inherited notice during cascade merge. |
