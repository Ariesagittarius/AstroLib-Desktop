import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');

const REQUIRED_ACTIVE_DOCS = [
  'README.md',
  'AGENTS.md',
  'SECURITY.md',
  'tests/TESTING.md',
  'docs/README.md',
  'docs/archive/README.md',
  'docs/guides/development.md',
  'docs/guides/book-ingestion.md',
  'docs/guides/desktop-packaging.md',
  'docs/guides/agent-cli-mcp.md',
  'docs/guides/release-and-push.md',
  'docs/architecture/overview.md',
  'docs/architecture/desktop-runtime.md',
  'docs/architecture/reader-and-abp.md',
  'docs/architecture/agent-harness.md',
  'docs/architecture/security-model.md',
  'docs/architecture/feature-catalog.md',
  'docs/adr/001-abp-decoupling.md',
  'docs/adr/002-reader-convergence.md',
  'docs/adr/003-material-design-3-ui.md',
  'docs/adr/004-sideload-dock.md',
  'docs/adr/005-content-api-cli-mcp.md',
  'docs/adr/006-agent-harness.md',
  'docs/adr/007-pdf2abp-pipeline.md',
  'docs/adr/008-annotations-anp.md',
  'docs/adr/009-offline-first-assets.md',
  'docs/adr/010-zero-trust-security.md',
  'docs/adr/011-tiered-vitest-ci.md',
  'docs/adr/012-universal-clean-push.md',
  'docs/specs/abp-format.md',
  'docs/specs/academic-publishing.md',
  'docs/specs/content-api.md',
  'docs/specs/annotations-anp.md',
];

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u2600-\u26FF\u2700-\u27BF]/u;
const SECRET_RE = /(?:AIza[0-9A-Za-z_-]{35}|sk-[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{30,}\.eyJ)/;
const BANNED_LEGACY_RE = /(?:src\/pages\/reader\.astro|src\/content\/docs\/dev\/|\/__edit__\/|\/__inspector__\/|\/__relation_graph__\/|\/blank\/|file:\/\/\/[A-Za-z]:\/)/;

describe('Contract: Documentation Hygiene & Link Integrity', () => {
  it('1. All required active Single-Source-of-Truth documentation files exist', () => {
    const missing = REQUIRED_ACTIVE_DOCS.filter((rel) => !fs.existsSync(path.join(ROOT, rel)));
    expect(missing).toEqual([]);
  });

  it('2. Active docs contain zero broken relative markdown links', () => {
    const broken: Array<{ source: string; link: string; resolved: string }> = [];

    for (const rel of REQUIRED_ACTIVE_DOCS) {
      const absFile = path.join(ROOT, rel);
      const raw = fs.readFileSync(absFile, 'utf8');
      const withoutCodeBlocks = raw.replace(/```[\s\S]*?```/g, '');
      const dir = path.dirname(absFile);

      const linkRe = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
      let match: RegExpExecArray | null;
      while ((match = linkRe.exec(withoutCodeBlocks)) !== null) {
        const target = match[1].trim();
        if (
          !target ||
          target.startsWith('#') ||
          target.startsWith('http://') ||
          target.startsWith('https://') ||
          target.startsWith('mailto:') ||
          target.startsWith('astrolib://')
        ) {
          continue;
        }
        const pathOnly = target.split('#')[0].split('?')[0];
        if (!pathOnly) continue;
        const resolved = path.resolve(dir, pathOnly);
        if (!fs.existsSync(resolved)) {
          broken.push({
            source: rel,
            link: target,
            resolved: path.relative(ROOT, resolved).replace(/\\/g, '/'),
          });
        }
      }
    }

    expect(broken).toEqual([]);
  });

  it('3. Active docs are free of emojis, secret key patterns, and retired legacy paths', () => {
    const emojiHits: string[] = [];
    const secretHits: string[] = [];
    const legacyHits: string[] = [];

    for (const rel of REQUIRED_ACTIVE_DOCS) {
      const raw = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      if (EMOJI_RE.test(raw)) emojiHits.push(rel);
      if (SECRET_RE.test(raw)) secretHits.push(rel);
      if (BANNED_LEGACY_RE.test(raw)) legacyHits.push(rel);
    }

    expect(emojiHits).toEqual([]);
    expect(secretHits).toEqual([]);
    expect(legacyHits).toEqual([]);
  });

  it('4. Retired src/content/docs/dev directory does not exist', () => {
    expect(fs.existsSync(path.join(ROOT, 'src', 'content', 'docs', 'dev'))).toBe(false);
  });
});
