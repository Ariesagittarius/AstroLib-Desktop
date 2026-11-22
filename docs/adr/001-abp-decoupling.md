# ADR-001: Framework-Content Decoupling via ABP

- **Status**: Accepted
- **Date**: 2026-11-12

## Context
Compiling 1,250+ MDX mathematical chapters directly through Astro's static site tree bloated build times, inflated Electron ASAR packages beyond size limits, and coupled app updates tightly to textbook revisions.

## Decision
Separate raw textbook sources (`content-sources/collections/`) from the application shell (`dist/`, `dist-electron/`), compiling books into self-contained AstroLib Book Packages (`artifacts/abp-packs/`, `.abp` Schema 1.0.0) managed at runtime by `DesktopBookManager`. Keep `src/content/docs/collections/` empty.

## Consequences
- Installer binaries exclude compiled books and stay compact.
- Application upgrades and textbook additions/updates ship independently via Mode A release catalogs or local `.abp`/`.epub` imports.
