# Agent CLI, MCP Server & Content API Integration Guide

AstroLib exposes all textbook catalogs, outlines, chapter AST nodes, formulas, semantic cards, exercises, and annotation read/write capabilities through a single headless facade: `ContentApiService` (`src/core/content-api/content-api-service.ts`).

## 1. CLI Runner (`bin/astrolib-cli.mjs`)

Run directly with Node.js (or inside Electron with `ELECTRON_RUN_AS_NODE=1`):

```bash
node bin/astrolib-cli.mjs books
node bin/astrolib-cli.mjs toc math linear_algebra_geometry
node bin/astrolib-cli.mjs locate "数学分析 2.1"
node bin/astrolib-cli.mjs chapter math linear_algebra_geometry 11_二三阶行列式 --format=ast
node bin/astrolib-cli.mjs chapter math linear_algebra_geometry 11_二三阶行列式 --format=cards
node bin/astrolib-cli.mjs chapter math linear_algebra_geometry 11_二三阶行列式 --format=formulas
node bin/astrolib-cli.mjs exercises math linear_algebra_geometry 1.1_二三阶行列式
node bin/astrolib-cli.mjs search-exercises "行列式" --limit=5
node bin/astrolib-cli.mjs read "astrolib://math/math_analysis/00_intro#p-1"
node bin/astrolib-cli.mjs mineru
```

## 2. MCP Stdio Server (`bin/astrolib-mcp.mjs`)

Implements JSON-RPC 2.0 MCP over `stdin`/`stdout`, exposing 7 core tools:

| Tool | Purpose |
| :--- | :--- |
| `locate_content` | Solve natural-language chapter/book queries into canonical `astrolib://` URIs via `UniversalLocatorResolver`. |
| `get_books_catalog` | Return all discovered books across `content-sources/` and installed/artifact ABP packs. |
| `get_book_toc` | Return hierarchical section/chapter outline for `<col>/<book>`. |
| `get_chapter_ast` | Parse or recover AST tree, cards, formulas, and reading metadata for a chapter. |
| `read_content_node` | Read full MDX/LaTeX/summary for an exact `#nodeId` or URI. |
| `search_exercises` | Full-text query over exercise questions, official solutions, and hints. |
| `diff_chapters` | Unified diff between two chapters. |

Configure any MCP client (such as `agy`) against:

```text
node <repo-or-app-root>/bin/astrolib-mcp.mjs
```

## 3. Embedded Agent Harness & Builtin Plugins

Inside the desktop app, `PluginEnvironment` (`src/plugins/harness/`) orchestrates builtin workspace tools located in `src/plugins/harness/builtin/`:

- **Content & Reading (Read-Only)**: `books.plugin.ts`, `toc.plugin.ts`, `ast.plugin.ts`, `read.plugin.ts`, `exercises.plugin.ts`, `annotations.plugin.ts`, `knowledge.plugin.ts`, `diff.plugin.ts`.
- **Desktop / Agent Operations**: `canvas.plugin.ts` (infinite canvas inspection and capture), `runtime-tools.plugin.ts`, `interaction.plugin.ts`, `web-search.plugin.ts`.
- Server HTTP endpoints for Harness live under `/api/v1/content/*` (`src/server/plugins/content-api/dev-server-plugin.mjs` and `agent-tools-handler.ts`), protected in Desktop runtime by `LocalServer`'s loopback origin check and `X-AstroLib-Token`.
