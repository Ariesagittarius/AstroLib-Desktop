# ADR-005: Headless Content API, CLI, and MCP Server

- **Status**: Accepted
- **Date**: 2026-11-16

## Context
AI tools, automated verification scripts, and external editors each parsed files on disk independently, creating inconsistent slug resolution and fragile path handling.

## Decision
Centralize catalog, AURP (`astrolib://`) resolution, AST extraction, exercise access, annotation storage, and chapter diffing inside `ContentApiService` (`src/core/content-api/content-api-service.ts`), exposing identical semantics through HTTP REST (`/api/v1/content/*`), CLI (`bin/astrolib-cli.mjs`), and stdio MCP (`bin/astrolib-mcp.mjs`).

## Consequences
- Single backend logic with source-MDX / compiled-ABP dual-mode fallback.
- Path/slug validation protects all four consumers uniformly.
