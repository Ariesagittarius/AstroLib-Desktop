# AstroLib Desktop

An offline-first Electron reading, annotation, research, and academic publishing environment for university mathematics, physics, computer science, and engineering textbooks.

## Core Design Principles

- **The Content is the Interface**: Mathematical typography, KaTeX rendering, structured theorem/definition hierarchy, and quiet negative space take precedence over decorative UI chrome.
- **Framework-Content Decoupling**: Compiled chapters live in portable AstroLib Book Packages (`.abp` Schema 1.0.0) generated from `content-sources/collections/` into `artifacts/abp-packs/`, keeping the Astro + Electron application shell lightweight and instant-booting.
- **Offline-First & Zero-Trust Local Security**: Self-hosted web fonts, Material Symbols glyphs, local MuPDF PDF previews, loopback `X-AstroLib-Token` authentication, renderer sandboxing, AST HTML sanitization, and Electron `safeStorage` credential protection.
- **Agent-Native Workspace**: Unified `ContentApiService`, CLI (`bin/astrolib-cli.mjs`), MCP stdio server (`bin/astrolib-mcp.mjs`), embedded AI Harness, and PDF2ABP multi-agent textbook digitization pipeline.

## Key Capabilities

- **Desktop Reader Shell (`/collections/<col>/<book>/<slug>/`)**: Unified `StaticHandler` + `reader-shell-template.ts` runtime supporting Material Design 3 surfaces, left collection/book tree navigation, right Sideload Dock (`toc`, `exercises`, `aiAsk`, `translation`, `bilingualComparison`, `infoHighlight`, `annotations`), and collapsible solution blocks.
- **Academic Annotations & Infinite Canvas (`/workspace/canvas/`)**: Portable AstroNote Packages (`.anp`), AST-anchored highlights and sidenotes, and pen/highlighter infinite canvas synced with `AnnotationStorageService`.
- **Agent Harness (`/desktop/` Sidecar) & PDF2ABP (`/workspace/ingest/`)**: Streamlined multi-provider AI assistant, read-only & sandboxed workspace plugin tools, MinerU document ingestion, and multi-agent PDF-to-ABP authoring.
- **Publishing & Export**: Chapter LaTeX/ZIP/PDF export (`Jinwen-XU/homework` macro compatibility, `-no-shell-escape`), Typst programmatic PDF compilation, and EPUB3 packaging (`scripts/generate-epub.mjs` and EPUB import adapter).

## Quick Start

```bash
npm install
npm run build
node scripts/build-electron.mjs
npm run pack:books
npm run electron:dev
```

## Verification & Testing

```bash
npm run check:types        # Astro sync + strict tsc --noEmit
npm run check:astro        # Astro component & script diagnostics
npm run test:smoke         # Fast Unit + Static Contracts (~3s)
npm test                   # Unit + Static Contracts + Integration (~10s)
npm run test:corpus        # Corpus integrity (headings, Mermaid, images, 1,251 routes)
npm run test:affected      # Git-diff targeted Vitest runner
```

See [tests/TESTING.md](tests/TESTING.md) for the complete 6-project test pyramid.

## Documentation Map

- [Documentation Hub](docs/README.md) — Central index of architecture docs, ADRs, guides, and format specifications.
- [Agent Workspace Rules](AGENTS.md) — Architectural Ten Tenets, feature registry constraints, commit format, and dual-repo push rules.
- [Security Policy](SECURITY.md) — Trust model, loopback authentication, sanitization, and vulnerability reporting.

## Licenses

- Codebase: [GNU General Public License v3.0 or later](LICENSE)
- Bundled textbook & exercise datasets: [CC BY-NC-SA 4.0](LICENSE-CONTENT)
