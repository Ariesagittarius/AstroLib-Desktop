# ADR-010: Zero-Trust Loopback and Renderer Sandboxing

- **Status**: Accepted
- **Date**: 2026-11-22

## Context
Historical Vite dev plugins emitted `Access-Control-Allow-Origin: *`, ran Electron `mainWindow` with `sandbox: false`, used regex HTML sanitizers, spawned child shells (`tar`, PowerShell) with unstripped credentials, and persisted API keys in plaintext JSON.

## Decision
Adopt a strict zero-trust boundary around the embedded loopback server (`127.0.0.1` + per-launch `X-AstroLib-Token` + exact loopback `Origin`/`Host`/`Sec-Fetch-Site`), enable `sandbox: true` on all `BrowserWindow`s with IPC version lookup, sanitize HTML via `unified` HAST allowlist (`sanitizeAcademicHtml`), extract ZIPs purely in Node (`extractZipSafely`), filter child environments (`createSanitizedChildEnv`), and encrypt stored secrets via Electron `safeStorage`.

## Consequences
- Blocks cross-site loopback requests, stored/reflected XSS across EPUB/ABP/annotations, ZipSlip traversal, shell command injection, and secret leakage to child tools.
- Verified automatically by `tests/contract/security-hardening.test.ts`.
