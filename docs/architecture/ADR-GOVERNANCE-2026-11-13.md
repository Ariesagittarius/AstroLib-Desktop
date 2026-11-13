# ADR: Architectural Governance, Inverted Dependency Remediation & Release Gates (P1-E)

**Status**: Accepted  
**Date**: 2026-11-13  
**Authors**: Architecture Committee & Execution Agent  
**Context**: `PROJECT_ARCHITECTURE_AUDIT_2026-11-12.md` §5 (P1-06, P1-09, P1-11, P1-12) & `P1_D_E_HANDOFF_2026-11-13.md` §3  

---

## 1. Context & Objectives

P1-E targets long-term system hygiene, strict dependency layering, and CI enforcement:
1. **Dependency Inversions**:
   - `src/services/` directly importing from `src/components/` (3 instances). Services must be headless and never import visual UI components.
   - `src/utils/` importing from `src/server/` (1 instance in `src/utils/sidebar.ts`). Utilities must be pure and free of server/filesystem dependencies.
2. **One-Line `.mjs` Shim Debt**:
   - 10 legacy files containing only `export * from './*.ts'` creating confusion for bundlers and TypeScript resolution.
3. **Type Widening Decay**:
   - Unconstrained `| string` union pollutions in `src/types/` weakening static analysis.
4. **Redundant Stack Proliferation**:
   - 535 lines of self-contained translation code in `api/translate.ts` duplicated with internal services.
   - Dual AI model catalogs in `src/ai/ai-config.ts` vs `src/config/features.config.ts`.
5. **CI Quality Gate Gaps**:
   - CI missing `astro check` on `.astro` script tags, allowing client script errors to escape.
   - CI missing route smoke checks.
6. **Documentation & Spec Synchronization**:
   - Outdated Starlight coupling references in `AGENTS.md` §8.2.

---

## 2. Dependency Layering Matrix

The project strictly follows a unidirectional dependency hierarchy:

```text
               ┌────────────────────────────────────────────────────────┐
               │                        electron                        │
               └───────────┬────────────────────────────────┬───────────┘
                           │                                │
                           ▼                                ▼
               ┌───────────────────────┐        ┌───────────────────────┐
               │       features        │        │      publishing       │
               └───────────┬───────────┘        └───────────┬───────────┘
                           │                                │
                           ▼                                ▼
               ┌────────────────────────────────────────────────────────┐
               │                        services                        │
               └───────────┬────────────────────────────────┬───────────┘
                           │                                │
                           ▼                                ▼
               ┌───────────────────────┐        ┌───────────────────────┐
               │        content        │        │        kernel         │
               └───────────┬───────────┘        └───────────┬───────────┘
                           │                                │
                           ▼                                ▼
               ┌────────────────────────────────────────────────────────┐
               │                         utils                          │
               └────────────────────────────────────────────────────────┘
```

### Layer Dependency Rules:
| Layer | May Depend On | Strictly Forbidden To Depend On |
|---|---|---|
| `utils` | *(None / Pure standard library)* | `components`, `server`, `services`, `features`, `electron`, `publishing` |
| `kernel` / `content` | `utils` | `components`, `services`, `features`, `electron`, `publishing` |
| `services` | `kernel`, `content`, `utils` | `components`, `electron`, `features` (must consume contracts from `core/` or `types/`) |
| `features` | `services`, `kernel`, `content`, `utils`, `components/m3` | Internal private files of other features (must use feature public API) |
| `publishing` | `kernel`, `content`, `utils` | `components`, `features`, `electron` (publishing is 100% headless) |
| `electron` | `services`, `kernel`, `content`, `utils` | `src/server/plugins` (dev plugins must not be bundled into desktop runtime) |

---

## 3. Inverted Dependency Remediation Plan (`E1`)

1. **Sideload & Sidebar Layout Contracts**:
   - Create `src/core/contracts/sideload-contract.ts` and `src/core/contracts/layout-contract.ts`.
   - `in-page-compare-controller.ts` and `translation-dock-controller.ts` will depend on these headless interfaces rather than concrete UI component controllers in `src/components/`.
2. **Decouple Starlight Sidebar from `src/utils/sidebar.ts`**:
   - Move `generateStarlightBookSidebar` out of `src/utils/` to `src/build/starlight-sidebar-adapter.ts`.
   - `src/utils/sidebar.ts` retains only pure URL formatting, sorting, and tree traversal functions.

---

## 4. Legacy Shim Elimination (`E2`)

Migrate all consumers of the 10 legacy `.mjs` re-export shims to import directly from `.ts`, and delete the shims:
1. `src/config/collections.config.mjs`
2. `src/config/features.config.mjs`
3. `src/config/notices.config.mjs`
4. `src/config/themes.config.mjs`
5. `src/utils/module-inspector/scanner.mjs`
6. `src/utils/relation-graph/generator.mjs`
7. `src/utils/natural-sort.mjs`
8. `src/utils/render-title.mjs`
9. `src/utils/sidebar.mjs`
10. `src/utils/slug.mjs`

---

## 5. Type Narrowing Strategy (`E3`)

Replace arbitrary `| string` escape hatches with branded types (`(string & {})` for open autocompletion unions) or strict closed unions:
- `src/types/chapter-semantic.ts`:
  - `typography?: 'scholarly' | 'classic' | 'mathematical' | 'lecture' | (string & {});`
  - `cjkFont?: 'default' | 'sourcehan' | 'song' | 'kai' | (string & {});`
- `src/types/collections.ts`:
  - `tocMapping?: Record<string, string | string[]>;` (explicitly document semantic scope)
- `src/types/exercises.ts`:
  - `group?: 'A' | 'B' | (string & {});`

---

## 6. Redundant Stack Consolidation (`E4`)

1. **Translation Kernel**:
   - Extract `src/services/translation/core/engine.ts` containing the headless translation provider execution, payload framing, and error normalization.
   - Refactor `api/translate.ts` to be a lightweight serverless handler (< 150 lines) importing the core engine.
2. **AI Model Catalog**:
   - Unify AI model definitions in `src/config/ai-models.config.ts`, referenced by both `src/ai/ai-config.ts` and `src/config/features.config.ts`.

---

## 7. CI Pipeline Enhancements (`E5`)

Update `.github/workflows/ci.yml` and project scripts:
1. Include `astro check` in verification to inspect `<script>` tags in `.astro` files.
2. Add route smoke test suite validating that canonical desktop, reader, and collection routes resolve with status 200.
3. Validate that dependency inversion assertions run automatically during typecheck / test phases.

---

## 8. Specification & Agent Rules Alignment (`E6` & `E7`)

1. **Update `AGENTS.md` §8.2**:
   - Clarify that Reader Shell synthesis is detached from Starlight documentation compilation, operating via canonical `/reader/` and headless ABP hydration.
2. **Legacy Path Policy**:
   - Production code must have 0 references to legacy `src/content/docs/collections` or `public/abp-packs`.
   - Historical documentation files referencing legacy paths are marked with archival notices.
