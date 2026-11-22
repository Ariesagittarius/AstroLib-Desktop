# ADR-004: Single-Host Sideload Dock Pattern

- **Status**: Accepted
- **Date**: 2026-11-15

## Context
Independent sidebars/drawers for exercises, AI Q&A, translation, focus lens, and annotations risked overlapping geometry, conflicting shortcuts, and mobile viewport overflow.

## Decision
Mount all auxiliary reading views inside `.astrolib-sideload-dock` (`PageSidebarOverride.astro`) controlled solely by the `sideloadManager` singleton (`src/components/sideload/sideload-manager.ts`), with `toc` as default view and responsive desktop dock / tablet side sheet / mobile bottom sheet transitions.

## Consequences
- Width coordination flows through a single `--sl-sideload-width` variable without content reflow glitches.
- Users always have uniform exit affordances (back-to-TOC button, `Escape`, scrim click).
