# ADR-011: Six-Project Vitest Pyramid and Affected Test Selection

- **Status**: Accepted
- **Date**: 2026-11-22

## Context
Running every suite together forced a ~60-second loop dominated by 1,251-route ABP sweeps and corpus checks during minor UI/unit changes, while benchmark suites lived inside unit directories.

## Decision
Split `vitest.config.ts` into 6 Vitest 5 projects (`unit`, `contract-static`, `integration`, `corpus`, `artifacts`, `system`), isolate heavy ML benchmarks in `vitest.benchmark.config.ts` (`tests/benchmarks/`), implement `scripts/test-affected.mjs`, and add path-filtered CI jobs in `.github/workflows/ci.yml` on Node 22.

## Consequences
- Inner `test:smoke` + `npm test` completes in ~9 seconds.
- Corpus, artifact, and CI gates run only when their matching paths change.
