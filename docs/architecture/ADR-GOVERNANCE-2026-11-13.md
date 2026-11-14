# Architecture Decision Record: P1-E Dependency, Type & Governance Architecture

- **Status**: Accepted / Active
- **Date**: 2026-11-13 (Implemented 2026-11-14)
- **Scope**: Entire AstroLib Codebase (Core, Services, Features, Utils, Types, CI)
- **Supervising Standards**: `AGENTS.md` 10 Central Architectural Tenets, `PROJECT_ARCHITECTURE_AUDIT_2026-11-12.md`

---

## 1. Context & Motivation

During the initial growth of AstroLib, several architectural boundary inversions emerged:
1. **Dependency Direction Inversions**:
   - `src/services/` imported UI controllers and DOM classes from `src/components/` (`sideload-manager`, `sidebar`).
   - `src/utils/` imported build-time server adapters from `src/server/adapters/`.
2. **One-Line Legacy Shims**:
   - 10 `.mjs` files in `src/config/` and `src/utils/` served purely as re-export shims (`export * from './*.ts'`), creating confusion between TypeScript sources and ES modules.
3. **Weakened Type Contracts**:
   - Critical domain types in `src/types/` (`CollectionId`, `BookKey`, `QuestionType`, `SemanticLayer`) used `| string` widening, degrading TypeScript compile-time safety.
4. **Duplicated Stacks**:
   - `api/translate.ts` maintained a 535-line self-contained implementation duplicating the server translation plugins and providers.
   - AI model configurations were duplicated across `ai-config.ts` and `features.config.ts`.
5. **CI Gaps**:
   - CI ran tests and typechecks, but lacked strict architectural linting against dependency inversions, `.astro` `<script>` type checks, and route availability.

---

## 2. Decision & Architectural Layering Matrix

### 2.1 Layer Hierarchy & Allowed Dependency Directions

The codebase is organized into strict layers with unidirectional top-down dependencies:

```text
  [Electron / Main / Shell]  -->  [Pages / UI Presentation (src/pages, src/components)]
                                            │
                                            ▼
                               [Features (src/features/*)]
                                            │
                                            ▼
                               [Services (src/services/*)]
                                            │
                                            ▼
                        [Kernel / Domain Core (src/types, src/config)]
                                            │
                                            ▼
                           [Pure Utils (src/utils/* - Stateless)]
```

#### Layer Dependency Rules:
| Layer | Location | Allowed to Depend On | Strictly Forbidden to Depend On |
| :--- | :--- | :--- | :--- |
| **Pure Utils** | `src/utils/` | External pure utilities, KaTeX types | `src/server/`, `src/components/`, `src/features/`, `src/services/`, DOM/browser globals |
| **Types / Domain** | `src/types/` | Pure type definitions | Any runtime logic, components, server, services |
| **Config** | `src/config/` | `src/types/`, `src/utils/` | `src/components/`, `src/features/`, `src/services/`, `src/server/` |
| **Services** | `src/services/` | `src/types/`, `src/config/`, `src/utils/`, shared UI state contracts (`src/features/sideload/contract`) | `src/components/` (No direct UI component imports!) |
| **Features** | `src/features/` | `src/services/`, `src/types/`, `src/config/`, `src/utils/` | Sibling feature internals (only via public feature contracts) |
| **Components & UI**| `src/components/` | `src/features/`, `src/services/`, `src/types/`, `src/utils/` | `src/server/` (runtime build plugins) |
| **Server Plugins** | `src/server/` | `src/services/`, `src/types/`, `src/config/`, `src/utils/` | `src/components/` |

### 2.2 Sideload State Contract Extraction
- To eliminate `services → components/sideload` dependency inversion, UI sidebar/sideload states are abstracted into a shared contract: `src/features/sideload/contract.ts`.
- `services` interact only with this pure contract or state-machine interface, eliminating concrete DOM controller imports.

### 2.3 Strict Type Narrowing (Branded Unions)
- Any extensible union type must NOT use raw `| string`, which dissolves autocomplete and exhaustiveness checks.
- If backward-compatible or dynamic strings must be accepted, use TypeScript's branded literal union idiom:
  ```typescript
  export type KnownKey = 'key-a' | 'key-b';
  export type ExtensibleKey = KnownKey | (string & {});
  ```
- Core schema-bound identifiers (`CollectionId`, `QuestionType`) are strictly closed unions (`'math' | 'cs' | 'science' | 'telecom'`).

### 2.4 Removal of Re-Export Shims
- All 10 one-line `.mjs` shims in `src/config/` and `src/utils/` are deleted.
- Consumers must import directly from explicit TypeScript modules or canonical configs.

### 2.5 Translation Core Extraction
- Common translation logic (prompt generation, formula masking/unmasking, provider routing, error wrapping) is extracted into `src/services/translation/core/`.
- Both `api/translate.ts` (Vercel serverless function) and `src/server/plugins/translation/` (Vite dev server plugin) consume the unified core, keeping handler implementations thin (< 150 lines).

### 2.6 CI Architecture Gates
- Add automated architectural guard tests:
  - `rg "from '.*components/" src/services` must equal 0.
  - `rg "from '.*server/" src/utils` must equal 0.
  - One-line shims count in `src/` must equal 0.
  - `check:types` runs with strict typechecking across all TypeScript and Astro files.

---

## 3. Reader Shell Decoupling & AGENTS.md §8.2 Amendment

The reader pipeline is fully modernized:
- All canonical reading routes are served by `/reader/` and dynamic collection routing (`/collections/...`).
- `reader-shell-template.ts` serves solely as the offline Master Shell synthesis bridge for Electron desktop release packaging and local offline caching. It is completely decoupled from Astro's runtime page compilation.
