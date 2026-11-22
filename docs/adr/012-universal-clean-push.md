# ADR-012: Universal Comment Stripping for Public Repository Pushes

- **Status**: Accepted
- **Date**: 2026-11-22

## Context
AstroLib maintains a full-comment private repository alongside a public repository where stripped comments reduce stale commentary noise for downstream tools. Earlier stripping skipped non-JS/YAML extensions or mishandled hash literals in YAML.

## Decision
Expand `scripts/lib/comment-stripper.mjs` (`stripContentForFile`) to cover all tracked code/config extensions and dotfiles safely while preserving compiler/bundler directives (`/// <reference>`, `@vite-ignore`, `@ts-expect-error`, shebangs) and non-comment tokens (YAML `#fff` colors, URL fragments), enforced inside isolated worktrees by `scripts/git-clean-push.mjs`.

## Consequences
- Private remotes preserve full developer annotations while public pushes strip comments uniformly across the entire tree without altering local working state.
