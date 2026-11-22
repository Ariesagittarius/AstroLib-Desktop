# ADR-007: PDF2ABP Multi-Agent Orchestrator Pipeline

- **Status**: Accepted
- **Date**: 2026-11-19

## Context
Single-shot OCR-to-MDX conversion struggled with multi-chapter alignment, equation verification, figure captions, and partial failure recovery.

## Decision
Introduce a stateful multi-agent pipeline (`src/services/pdf2abp/`) backed by isolated per-job workspaces (`workspace-manager.ts`, `job-manager.ts`), local `mupdf` + `sharp` visual slicing (`pdf-processor.ts`), bounded-concurrency proofreading subagents (`subagent-orchestrator.ts`), and direct ABP installation (`abp-importer.ts`).

## Consequences
- Resilient checkpointed conversion with `/api/v1/pdf2abp/*` SSE telemetry.
- Unpacked Python and `mupdf` assets keep visual verification completely offline.
