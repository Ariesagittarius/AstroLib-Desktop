# AstroLib Documentation Hub

Authoritative technical documentation for the AstroLib Desktop reading, research, agent harness, and academic publishing platform.

## Start Here

- [Project README](../README.md) — Overview, quick start, and license information.
- [Agent Workspace Rules](../AGENTS.md) — Architectural Ten Tenets, operational invariants, and commit/distribution rules.
- [Security Policy](../SECURITY.md) — Trust model and vulnerability reporting.
- [Testing Architecture](../tests/TESTING.md) — 6-project Vitest pyramid, `test:affected`, and CI gates.

## Guides (Task-Oriented Workflows)

- [Development Workflow](guides/development.md) — Local environment, Astro shell build, Electron bundling, and debugging.
- [Book Ingestion & PDF2ABP](guides/book-ingestion.md) — MinerU API/local OCR ingestion, PDF2ABP multi-agent authoring, EPUB import, and ABP compilation.
- [Desktop Packaging & Offline Assets](guides/desktop-packaging.md) — Self-hosted fonts/icons, unpacked Python runners, ASAR hygiene, and NSIS/Portable installers.
- [Agent CLI & MCP Integration](guides/agent-cli-mcp.md) — Operating `astrolib-cli`, `astrolib-mcp`, Content API, and builtin Harness plugins.
- [Release & Dual-Remote Push](guides/release-and-push.md) — Universal comment stripping, pre-push verification, and GitHub release automation.

## Architecture Reference

- [System Overview](architecture/overview.md) — Module topology, directory layout, and source-of-truth boundaries.
- [Desktop Runtime & IPC](architecture/desktop-runtime.md) — Electron main/preload processes, `LocalServer`, `StaticHandler`, `DesktopBookManager`, and `SettingsManager`.
- [Reader Shell & ABP Runtime](architecture/reader-and-abp.md) — Converged `/collections/` reading pipeline, `reader-shell-template.ts`, Sideload Dock, and Canvas workspace.
- [Agent Harness & Content API](architecture/agent-harness.md) — Embedded AI workspace, `PluginEnvironment`, builtin plugins, Content API, and PDF2ABP orchestrator.
- [Security Model](architecture/security-model.md) — Zero-trust external boundary, loopback `X-AstroLib-Token`, HAST HTML sanitization, subprocess env filtering, ZipSlip protection, and `safeStorage`.
- [Desktop Feature Catalog](architecture/feature-catalog.md) — Complete inventory of active Desktop features, configuration keys, runtime entrypoints, and retired legacy surfaces.

## Format Specifications

- [ABP Format Specification](specs/abp-format.md) — AstroLib Book Package (Schema 1.0.0) bundle, manifest, chapter JSON, and auxiliary indexes.
- [Academic Publishing & Notice Framework](specs/academic-publishing.md) — MDX academic card taxonomy, KaTeX/Typst/LaTeX/EPUB rules, and hierarchical Wiki Notice configuration.
- [Content API & AURP Specification](specs/content-api.md) — `astrolib://` URI resolution, Content API REST routes, and AST node schemas.
- [Annotations & ANP Specification](specs/annotations-anp.md) — AstroNote Package (Schema 1.0.0), highlight/sidenote/ink anchors, and canvas persistence.

## Architecture Decision Records (ADRs)

- [ADR-001: Framework-Content Decoupling via ABP](adr/001-abp-decoupling.md)
- [ADR-002: Reader Convergence onto StaticHandler and Collections Route](adr/002-reader-convergence.md)
- [ADR-003: Unified Material Design 3 Component Stack](adr/003-material-design-3-ui.md)
- [ADR-004: Single-Host Sideload Dock Pattern](adr/004-sideload-dock.md)
- [ADR-005: Headless Content API, CLI, and MCP Server](adr/005-content-api-cli-mcp.md)
- [ADR-006: Embedded Agent Harness and PluginEnvironment](adr/006-agent-harness.md)
- [ADR-007: PDF2ABP Multi-Agent Orchestrator Pipeline](adr/007-pdf2abp-pipeline.md)
- [ADR-008: Portable Annotations and Canvas Format (ANP)](adr/008-annotations-anp.md)
- [ADR-009: Offline-First Desktop Assets and MuPDF Preview](adr/009-offline-first-assets.md)
- [ADR-010: Zero-Trust Loopback and Renderer Sandboxing](adr/010-zero-trust-security.md)
- [ADR-011: 6-Project Vitest Pyramid and Affected Test Selection](adr/011-tiered-vitest-ci.md)
- [ADR-012: Universal Comment Stripping for Public Repository Pushes](adr/012-universal-clean-push.md)

## Historical Archive

- [Historical Archive Index](archive/README.md) — Preserved milestone audits, JSON signoff evidence, legacy handoffs, and pre-consolidation architecture documents.
