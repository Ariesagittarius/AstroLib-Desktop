# Antigravity / Agent Workspace Rules for AstroLib

## 1. Development & Server Management

When starting the Astro dev server inside agent workflows, use background mode:

```bash
astro dev --background
```

Manage background dev instances with:
- `astro dev status` - Check server status and port
- `astro dev logs` - View real-time log outputs
- `astro dev stop` - Stop the server using its PID lockfile

## 2. Core Architecture Rules & Constraints

### 2.1 Central Architecture Invariants (The 10 Tenets)

1. **Rule 1 — UI is not a domain model**:
   `components/` must never serve as the source of domain data models or shared type definitions. Shared models belong in `src/types/` and `src/core/`.
2. **Rule 2 — Publishing is independent**:
   Publishing and export systems (LaTeX / Typst / EPUB / PDF / ABP) must not depend on UI components or browser controllers.
3. **Rule 3 — Source of Truth**:
   Generated artifacts must never become a source of truth. `src/config/collections.config.ts`, `src/config/features.config.ts`, `content-sources/`, and raw exercise datasets are sources of truth.
4. **Rule 4 — Generated Data**:
   All regenerable artifacts (`artifacts/abp-packs/`, pre-rendered indices) must explicitly remain traceable to their generator scripts and raw sources.
5. **Rule 5 — Public Directory Hygiene**:
   `public/` is strictly reserved for static browser assets. Never place test outputs (`test_*.pdf`, `test_*.tex`, `test_*.typ`), compiler intermediate files (`*.aux`, `*.idx`, `*.mst`), logs (`*.log`), or temporary files inside `public/`.
6. **Rule 6 — Feature Isolation**:
   Primary logic of a feature (UI, state, client controllers) resides within that feature's cohesive boundary.
7. **Rule 7 — Utils Purity**:
   Do not add domain-specific modules (AI, Exercise, Editor, Publishing, Security, Annotations) to `src/utils/`. Keep `src/utils/` strictly for pure, stateless helpers.
8. **Rule 8 — Scripts Boundary & Test Architecture**:
   `scripts/` handles build, import, pack, export, clean-push, and maintenance automation. Runtime business logic must not depend on `scripts/`. Automated tests live in `tests/` under the 6-project Vitest architecture.
9. **Rule 9 — Runtime must not mutate source**:
   Dev servers, Vite plugins, and Electron runtime handlers must never silently mutate tracked source files on disk during normal reading flows.
10. **Rule 10 — Small Migrations (No Big Bang Rewrite)**:
    Architectural refactoring follows: **one boundary -> one migration -> one verification**.

### 2.2 Operational Constraints

- **Single Sources of Truth**: `src/config/collections.config.ts` (collections/books) and `src/config/features.config.ts` (16 active features).
- **Routing & Clean Slugs**: All chapter links must use `cleanSlug()` from `src/utils/sidebar.ts` or canonical slugs from ABP manifests. Never hardcode raw filenames into URLs.
- **Testing & Quality Gates**: Before committing, run `npm run check:types`, `npm run check:astro`, and relevant Vitest suites (`npm run test:smoke`, `npm test`, `npm run test:affected`).
- **MDX Syntax Validation**: Run `node scripts/scan-mdx.mjs content-sources/collections/<collection>/<book>` when editing textbook chapters.
- **No Emojis**: Emojis are prohibited in code, UI chrome, CI workflows, documentation, and Git commit messages.

## 3. Documentation & References

Consult [docs/README.md](docs/README.md) for the authoritative index of guides, system architecture, security model, ADRs, format specifications, and the archived historical baseline in [docs/archive/README.md](docs/archive/README.md).

## 4. Git Commit & Distribution Standards

### 4.1 Academic & Restrained Commit Specification

All Git commits must follow the **Academic Restrained Conventional Specification**:
- **English Only (ASCII)**: No Chinese text in commit headers or bodies.
- **No Emojis**: Strictly prohibited.
- **Restrained & Objective Tone**: Describe *what* changed and *why* in the imperative mood.
- **Format**: `<type>(<scope>): <imperative summary>`
  - Types: `feat`, `fix`, `perf`, `refactor`, `docs`, `style`, `chore`, `test`, `release`, `ci`, `build`
  - Scopes: `(content)`, `(katex)`, `(ui)`, `(ai)`, `(epub)`, `(sidebar)`, `(header)`, `(render)`, `(security)`, `(ci)`, `(core)`, `(desktop)`, `(test)`, `(docs)`

### 4.2 Dual-Repository Distribution Rules

1. **Local & Private Commits Keep Full Comments**: Local history and `private` remote retain full code documentation and comments.
2. **Public Repository Strips Comments Universally**: Public pushes (`origin`) must never run bare `git push origin`. Always push through the worktree sanitization pipeline (`scripts/git-clean-push.mjs`), which strips comments across all code and configuration file types (`.ts`, `.js`, `.astro`, `.css`, `.mdx`, `.py`, `.yml`, `.sh`, `.ps1`, `.html`, `.svg`, `.typ`, `.tex`, `.toml`, `.sql`, dotfiles, commented JSON).
3. **Zero Agent / Secret Leakage**: `.agents/`, `.dsh/`, `.codex/`, `.gemini/`, `.env*` (except `.env.example`), `.mineru.json`, `workspace/`, `task/`, and backup folders are excluded from public releases.
4. **Recommended Commands**:
   - Dry run: `node scripts/git-clean-push.mjs --dry-run --clean`
   - Dual push: `npm run push:all` (or `npm run push`)
   - Clean public push only: `npm run push:clean`
   - Private full backup only: `npm run push:private`

## 5. Academic Publishing & Radical Subtraction Principles

AstroLib produces university-level mathematical and scientific materials. Visual sophistication emerges solely from typography, mathematical typesetting, alignment, hierarchy, proportion, and deliberate negative space.
- Prohibited elements: gamified scores, mastery bars, study tips, motivational slogans, pill-tag spam, gray answer boxes, nested borders, and decorative icons.
- Precedence: `Academic Rigor > Minimalism > Readability > Decoration`.

## 6. Material Design 3 UI Architecture

- Unified design system: **Material Design 3** (`@material/web`, `@m3e/web`, and `src/components/m3/`). Legacy Starlight/VitePress overrides have been unified onto `M3*` primitives.
- All top-bar and overlay icons use standard official vectors (Google Material Symbols self-hosted in `public/fonts/material-symbols-outlined.woff2` and clean SVG icons), aligned optically at `20px` inside standard touch targets.
- Layer z-index values must reference `var(--layer-*)` semantic tokens in `src/styles/tokens/layers.css`.

## 7. Sideload Dock Architecture

- Right-side auxiliary tools mount strictly inside `.astrolib-sideload-dock` (`PageSidebarOverride.astro`).
- State, width tiers (`compact`, `medium`, `wide`, `full`), and `--sl-sideload-width` are controlled solely by `sideloadManager` (`src/components/sideload/sideload-manager.ts`).
- `toc` is the default panel; every non-default panel supports the back-to-TOC button, `Escape`, and scrim dismissal.

## 8. Desktop Architecture, Security & Reader Convergence

### 8.1 Zero-Builtin Books & ABP Contract
- `src/content/docs/collections/` stays empty so Astro never statically compiles 1,250+ chapters. Source books reside in `content-sources/collections/` and compile into ABP 1.0.0 packs (`artifacts/abp-packs/`) via `node scripts/pack-book-abp.mjs --all`.
- Preserve `src/types/content-package.ts` core contracts cleanly.

### 8.2 Converged Reader Path (`/collections/<col>/<book>/<slug>/`)
- Desktop reading is served dynamically by `electron/server/static-handler.ts` + `electron/server/reader-shell-template.ts` against `/collections/<col>/<book>/<slug>/` (`dist/reader-shell/index.html` master shell + ABP chapter payloads). Legacy `/reader/` and standalone web routes have been retired.
- `<Solution>` compiles to `.solution-details` with the end-of-proof tombstone marker.

### 8.3 Desktop Security & Runtime Persistence
- **Renderer Hardening**: `BrowserWindow` instances run with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. Permission requests default-deny; `will-navigate` and `shell.openExternal` strictly allow-list safe URLs.
- **Loopback Auth**: `LocalServer` generates a per-launch `X-AstroLib-Token`, verifies loopback `Host`/`Origin`/`Sec-Fetch-Site`, prohibits `Access-Control-Allow-Origin: *`, and sets CSP + `nosniff` + `SAMEORIGIN`.
- **Sanitization & Secrets**: Use `sanitizeAcademicHtml` (`src/core/security/html-sanitizer.ts`), `createSanitizedChildEnv` (`src/core/security/child-env.ts`), and Electron `safeStorage` in `SettingsManager` (`electron/services/settings-manager.ts`).

### 8.4 Desktop Verification & Build Pipeline
After modifying desktop, compiler, or server logic:
1. `npm run check:types`
2. `npm run check:astro`
3. `npm run build && node scripts/build-electron.mjs`
4. `npm run test:smoke` (and `npm test` / `npm run test:artifacts` for affected tiers)
5. `npm run electron:pack` (portable unpacked build) or `npm run electron:build` (NSIS/Portable installers)
