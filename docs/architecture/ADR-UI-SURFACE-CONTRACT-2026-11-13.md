# ADR: UI Surface Contract & Single Production Implementation (P1-D)

**Status**: Accepted  
**Date**: 2026-11-13  
**Authors**: Architecture Committee & Execution Agent  
**Context**: `PROJECT_ARCHITECTURE_AUDIT_2026-11-12.md` §5 (P1-02, P1-03, P1-04, P1-05, P1-07, P1-08, P1-13) & `P1_D_E_HANDOFF_2026-11-13.md` §2  

---

## 1. Context & Problem Statement

Prior to P1-D, AstroLib's user interface layer suffered from multi-implementation drift:
1. **Settings Triplication**:
   - `src/components/FeatureToggles.astro` (899 lines) rendered a quick-settings drawer in documentation pages via `ThemeSelectOverride.astro`.
   - `src/components/desktop/SettingsHubContent.astro` (1,998 lines) rendered a tabbed settings hub in `/desktop/` and `/hub/`.
   - Both independently hardcoded identical toggle IDs, native checkboxes, and local storage bindings, while `src/scripts/feature-toggles.ts` (2,049 lines) attempted to manage both with global selectors, causing non-idempotent re-initializations and conflicting event bindings.
2. **Header Duplication & Dead Shims**:
   - `HeaderOverride.astro` (Starlight header override) and `M3TopNavBar.astro` (standalone application header) maintained diverging action button implementations.
   - `VpNav.astro` remained as an unused 0-reference forwarding proxy.
3. **Library UI Isolation**:
   - `FragmentLibrary.astro` (828 lines) resided under `components/desktop/` rather than within `features/library/ui/`, intermixing Electron IPC and dev HTTP routes without a dedicated adapter interface.
4. **God Controllers & Missing State Tests**:
   - `chat-controller.ts` (2,455 lines), `exercise-controller.ts` (2,532 lines), and `translation-dock-controller.ts` (2,189 lines) mixed DOM queries, IPC/HTTP network calls, and state transitions in single monolithic files without DOM-free unit tests.
5. **CSS `!important` Arms Race**:
   - 29 CSS stylesheets contained 6,190 `!important` declarations, with unlayered imports between `custom.css` and `astro.config.mjs`.

---

## 2. Decision & Architectural Contracts

### 2.1 Settings Single Source of Truth (`D1`)
- **Single Settings Registry**: Create `src/features/settings/settings-registry.ts` defining all switch categories, default states, localStorage keys, and DOM attribute bindings (`data-feature-id`).
- **Surface Roles**:
  - `SettingsHubContent.astro` remains the canonical, comprehensive tabbed settings interface (Desktop / Hub).
  - `FeatureToggles.astro` is refactored into a thin, drawer-compatible wrapper that consumes the shared registry and renders standard M3 switch components (`<md-switch>`) without duplicating business schemas.
  - `feature-toggles.ts` retains only state persistence and DOM synchronization logic. `initFeatureToggles()` is strictly idempotent via `WeakSet` / element dataset guard flags.
  - Assert that duplicate `data-feature-id` declarations across an active DOM surface are 0, and native checkboxes are replaced with M3 standards.

### 2.2 Header Convergence (`D2`)
- **Delete `VpNav.astro`**: Eliminate `src/components/VpNav.astro` after verifying 0 imports in the repository.
- **Unified Event Contract**: Create `src/core/ui-state/header-events.ts` specifying common event signatures:
  - `astrolib:theme-change`: `{ mode: 'light' | 'dark' | 'auto' }`
  - `astrolib:search-open`: `{}`
  - `astrolib:settings-toggle`: `{ open?: boolean }`
- `HeaderOverride.astro` acts purely as a Starlight integration bridge, emitting identical events and sharing top navigation layout tokens with `M3TopNavBar.astro`.

### 2.3 Library UI Architecture (`D3`)
- Relocate `FragmentLibrary.astro` to `src/features/library/ui/FragmentLibrary.astro`.
- Provide a clean export and update `src/pages/desktop.astro` to import from the feature boundary.
- Abstract data acquisition and installation into a `LibraryClient` interface supporting:
  - Electron mode: `window.astrolib.fetchInstalledBooks()`, `installBookFromAbp()`
  - Web/Dev mode: `/api/library/books`, `/api/library/books/:bookKey`
- Ensure book cards, filter chips, and download progress flows share identical DOM structures.

### 2.4 Controller Decomposition & DOM-Free State Engines (`D4`)
Each controller is decomposed into a three-layer model:
1. `*.state.ts`: Pure TypeScript state reducer/machine. Zero DOM dependencies (`window`, `document`, `HTMLElement`, `querySelector` are strictly forbidden). Emits state transitions and maintains history.
2. `*.effects.ts`: Side effects and network drivers (LLM streaming, translation provider calls, storage persistence).
3. `*.ts` (Controller view): View orchestrator, handles DOM event listeners and reflects state changes into UI nodes. File size capped under 1,500 lines.
4. **Test Mandate**: Each state machine must have at least 6 dedicated Vitest unit tests in `tests/unit/`:
   - Initial state verification
   - Valid transition state changes
   - Rejection/noop on invalid transitions
   - State hydration from persisted snapshot
   - Error recovery state
   - Concurrency & idempotency

### 2.5 CSS Layering & `!important` Reduction (`D5`)
- Enforce strict cascade layers:
  1. `tokens` (`src/styles/tokens/`, M3 color and typography design tokens)
  2. `base` (resets, typography defaults, viewport rules)
  3. `components` (M3 and Starlight component styling)
  4. `features` (isolated feature styles)
  5. `overrides` (targeted integration patches)
- Eliminate duplicate `@import` statements between `astro.config.mjs` and `src/styles/custom.css`.
- Impose a hard ceiling on `!important`:
  - Baseline: 6,190
  - P1-D Ceiling: <= 5,200
  - Net additions: 0

### 2.6 Sideload & Shell Minor Defects (`D6`)
- Align `sideload-manager.ts` width ladder strictly with `AGENTS.md` §7.2:
  - `compact: 16.5rem`
  - `medium: 20rem`
  - `wide: 24.5rem`
  - `full: 28rem`
- Ensure all global event listeners in `sideload-manager.ts` and `feature-toggles.ts` are guarded against multiple calls.
- Maintain `/reader/` navigation route availability from `/desktop/`.

---

## 3. Compliance & Verification

- `npm run check:types`: 0 errors
- `npm test`: all unit, contract, and acceptance tests pass
- State machine unit tests: >= 18 tests passing
- `!important` count: strictly <= 5,200
