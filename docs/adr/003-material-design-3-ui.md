# ADR-003: Unified Material Design 3 Component Stack

- **Status**: Accepted
- **Date**: 2026-11-14

## Context
Early iterations mixed VitePress/Starlight styling tokens with custom CSS controls, producing visual drift across dialogs, switches, segmented filters, and overlay z-index stacking.

## Decision
Standardize all desktop surfaces on Material Design 3 (`@material/web`, `@m3e/web`, and `src/components/m3/`), enforce semantic `var(--layer-*)` tokens from `src/styles/tokens/layers.css`, and delete legacy VitePress/Starlight theme layers.

## Consequences
- Consistent typography, outlines, focus states, and dynamic Material You color adaptation across reading, Settings Hub, and Harness views.
- Contract check `window-layers.test.ts` prevents magic-number `z-index` regressions.
