# ADR-006: Embedded Agent Harness and PluginEnvironment

- **Status**: Accepted
- **Date**: 2026-11-18

## Context
AI interaction needed multi-provider streaming, structured tool invocation, sandboxed workspace edits, and strict separation between read-only textbook queries and user-approved mutations.

## Decision
Build `PluginEnvironment` (`src/plugins/harness/`) with modular builtin plugins (`src/plugins/harness/builtin/`) supporting OpenAI/Gemini tool schemas and `/desktop/` sidecar integration (`HarnessTopBar`, `harness-controller`). Keep Vite client plugins free of static `node:fs` imports via browser HTTP fetch + lazy `@vite-ignore` dynamic fallback.

## Consequences
- Unified tool surface usable in both browser Harness sessions and Node unit tests.
- Clean static Astro/Vite browser bundles with zero Node module externalization warnings.
