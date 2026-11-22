# AstroLib Testing Architecture & Verification Guide

AstroLib uses **Vitest 5 (`test.projects`)**, strict **TypeScript** (`tsc --noEmit`), **Astro diagnostics** (`astro check`), and targeted Git-diff test selection (`scripts/test-affected.mjs`) to keep everyday feedback under 10 seconds while preserving deep corpus, packaging, and compiler coverage.

## 1. The 6-Project Vitest Architecture

Configured in [vitest.config.ts](../vitest.config.ts) and [vitest.benchmark.config.ts](../vitest.benchmark.config.ts):

| Project / Suite | Location Pattern | Scope & Purpose | Typical Runtime |
| :--- | :--- | :--- | :--- |
| `unit` | `tests/unit/**/*.test.ts` (excluding `heading-contract.test.ts`) | Pure domain logic, state machines, URIs, AI/translation helpers, PDF2ABP unit logic, Electron services | ~2-4s |
| `contract-static` | `tests/contract/**/*.test.ts` (excluding `integration` and `corpus` suites) | Architecture boundaries, feature/collection schemas, security hardening, docs hygiene, packaging hygiene, z-index layer tokens | ~1-2s |
| `integration` | Server plugin & CLI contracts (`agent-tools`, `cli-runner`, `external-script`, `harness-chat`, `ingest`, `internal-content-api`, `pdf2abp`) | Real HTTP loopback middleware checks, spawned CLI/MCP JSON-RPC flows, sandboxed filesystem bounds | ~4-6s |
| `corpus` | `heading-contract`, `epub-heading-parity`, `image-assets`, `mermaid-integrity`, `reader-routability`, `reader-full-routability` | Scans full textbook corpus in `content-sources/collections/` and all 13 compiled packs in `artifacts/abp-packs/` | ~3-5s (`reader-full-routability` excluded by default, opt-in full sweep) |
| `artifacts` | `tests/acceptance/**/*.test.ts` | End-to-end ABP packaging/serving, release distribution verification, EPUB adaptation, LaTeX/Typst/exercise exports | ~15-20s |
| `system` | `tests/system/**/*.test.ts` | Physical compiler integration (`xelatex`, `@myriaddreamin/typst-ts-node-compiler`) and UI stacking checks (gracefully skips missing OS binaries) | ~5-10s |
| `benchmarks` (`vitest.benchmark.config.ts`) | `tests/benchmarks/**/*.test.ts` | Heavy local model recall/latency benchmarks gated behind `ASTROLIB_RUN_MODEL_TESTS=1` | On demand |

## 2. NPM Scripts & Developer Workflow

```bash
# Fast inner loop (Unit + Static Contracts)
npm run test:smoke

# Default pre-commit test suite (Unit + Static Contracts + Integration)
npm test

# Individual tiers
npm run test:unit
npm run test:contract
npm run test:integration
npm run test:corpus
npm run test:full-routability
npm run test:artifacts
npm run test:system
ASTROLIB_RUN_MODEL_TESTS=1 npm run test:benchmark

# Targeted test selection from Git changes
npm run test:affected
node scripts/test-affected.mjs --dry-run
node scripts/test-affected.mjs --staged

# Static type and Astro checks
npm run check:types
npm run check:astro
```

## 3. Targeted Test Selection (`scripts/test-affected.mjs`)

`scripts/test-affected.mjs` inspects modified paths via Git (or explicit `--files` CSV) and maps changes to the smallest sufficient Vitest projects:

- Documentation (`docs/**`, `README.md`, `AGENTS.md`, `SECURITY.md`, `tests/TESTING.md`) -> `tests/contract/docs-hygiene.test.ts`
- Textbook sources (`content-sources/**`) -> `corpus`
- Desktop, HTTP server, or security modules (`electron/**`, `src/server/**`, `src/core/security/**`) -> `unit`, `integration`, `tests/contract/security-hardening.test.ts`
- Publishing or pack scripts (`src/publishing/**`, `scripts/pack-book-abp.mjs`, `scripts/build-exercise-data.mjs`) -> `unit`, `artifacts`
- Styles (`src/styles/**`) -> `window-layers.test.ts`, `typography-presets.test.ts`
- Test/build config (`vitest.config.ts`, `package.json`, `astro.config.mjs`) -> `unit`, `contract-static`, `integration`

## 4. Test Invariants

1. **Zero Disk Pollution**: Tests must never write temporary files into `public/`, `content-sources/`, or tracked fixture directories. Use `os.tmpdir()` and clean up in `afterEach`/`afterAll`.
2. **Environment-Adaptive System Tests**: Tests requiring external binaries (XeLaTeX, Chromium, local HuggingFace weights, local raw MinerU tasks) must detect availability cleanly and skip rather than fail in clean CI containers.
3. **Security Regression Coverage**: `tests/contract/security-hardening.test.ts` guards `sanitizeAcademicHtml`, `createSanitizedChildEnv`, `LocalServer` loopback `Origin`/`Host`/`Sec-Fetch-Site`/`X-AstroLib-Token` enforcement, zero wildcard CORS, `SettingsManager` `safeStorage` encryption, and `extractZipSafely` ZipSlip protection.
4. **Documentation Regression Coverage**: `tests/contract/docs-hygiene.test.ts` verifies documentation existence, internal markdown links, zero emojis, zero leaked secret patterns, and zero references to deleted legacy entrypoints.

## 5. CI Pipeline Tiers (`.github/workflows/ci.yml`)

GitHub Actions uses Node 22 with path-filtered `detect-changes` outputs so documentation-only changes run `docs-hygiene` without rebuilding Electron, while code/corpus/publishing edits trigger only their matching gates.
