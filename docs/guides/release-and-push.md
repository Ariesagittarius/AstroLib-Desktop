# Release, Commit & Dual-Remote Push Guide

AstroLib distributes a **full-comment private branch** (`private`) alongside a **universally comment-stripped public repository** (`origin`), ensuring external agents and public readers consume clean source without stale inline commentary or local dev tooling leakage.

## 1. Commit Message Specification

Verified optionally via `npm run check:commit`:

- **Format**: `<type>(<scope>): <imperative summary>`
- **Language**: Restrained ASCII English only.
- **Zero Emojis**: Any emoji fails policy.
- **Types**: `feat`, `fix`, `perf`, `refactor`, `docs`, `style`, `chore`, `test`, `release`, `ci`, `build`.

## 2. Universal Comment Stripping (`scripts/lib/comment-stripper.mjs`)

`stripContentForFile(content, filePath)` runs automatically inside a detached Git worktree during `push:clean` / `push:all`:

- Covers JS/TS/JSX/TSX/JSONC (and commented `.json` such as `tsconfig.json`), CSS/SCSS/LESS, Astro templates, Markdown/MDX, Python, YAML (preserving `#` hex colors/URL anchors), Shell/PowerShell, HTML/XML/SVG/PLIST, Typst (`.typ`), TeX/LaTeX (`.tex`/`.sty`/`.cls`), TOML/INI/CONF/dotfiles (`.gitignore`, `.editorconfig`, `.env.example`, `.npmrc`, `.dockerignore`), SQL, and Batch (`.bat`/`.cmd`).
- **Preserved Directives**: Keeps line-1 `#!` shebangs, Python encoding cookies (`# -*- coding: utf-8 -*-`), XML declarations, `/// <reference .../>`, `/* @vite-ignore */`, `// @ts-ignore`, `// @ts-expect-error`, `// @ts-nocheck`, and `c8` / `v8 ignore` hints.
- Stripped sandboxes also remove local agent/workspace folders (`.agents/`, `.dsh/`, `.codex/`, `.gemini/`, `.mineru.json`, `.env*` except `.env.example`, `task/`, `backup/`, `workspace/`, `test/data/`, `test/output/`) before validating MDX & TypeScript syntax.

## 3. Standard Release & Push Commands

```bash
# 1. Run pre-push verification gates
npm run check:types
npm run check:astro
npm test
npm run test:corpus

# 2. Dry-run comment stripping and clean worktree verification
node scripts/git-clean-push.mjs --dry-run --clean

# 3. Push full history to private AND comment-stripped tree to origin
npm run push:all
```

Never run raw `git push origin` when publishing branches to the public remote; always use `npm run push:clean`, `npm run push:all`, or `npm run push`.
