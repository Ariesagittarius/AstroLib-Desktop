#!/usr/bin/env node
/**
 * scripts/test-affected.mjs
 * Compute changed files from Git and execute the targeted Vitest projects / suites.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const opts = {
    base: '',
    staged: false,
    dryRun: false,
    files: [],
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--staged') {
      opts.staged = true;
    } else if (arg === '--dry-run' || arg === '-d') {
      opts.dryRun = true;
    } else if (arg === '--base' && i + 1 < argv.length) {
      opts.base = argv[++i];
    } else if (arg.startsWith('--base=')) {
      opts.base = arg.slice('--base='.length);
    } else if (arg === '--files' && i + 1 < argv.length) {
      opts.files.push(...argv[++i].split(',').map((s) => s.trim()).filter(Boolean));
    } else if (arg.startsWith('--files=')) {
      opts.files.push(...arg.slice('--files='.length).split(',').map((s) => s.trim()).filter(Boolean));
    }
  }

  return opts;
}

function getGitChangedFiles(opts) {
  if (opts.files.length > 0) {
    return opts.files.map((f) => f.replace(/\\/g, '/'));
  }

  const changed = new Set();
  const gitArgsList = [];

  if (opts.staged) {
    gitArgsList.push(['-c', 'core.quotePath=false', 'diff', '--name-only', '--cached']);
  } else if (opts.base) {
    gitArgsList.push(['-c', 'core.quotePath=false', 'diff', '--name-only', `${opts.base}...HEAD`]);
    gitArgsList.push(['-c', 'core.quotePath=false', 'diff', '--name-only']);
  } else {
    gitArgsList.push(['-c', 'core.quotePath=false', 'diff', '--name-only', 'HEAD']);
    gitArgsList.push(['-c', 'core.quotePath=false', 'ls-files', '--others', '--exclude-standard']);
  }

  for (const args of gitArgsList) {
    try {
      const out = execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
      for (const line of out.split(/\r?\n/)) {
        const clean = line.trim().replace(/\\/g, '/');
        if (clean) changed.add(clean);
      }
    } catch {
      // Fallback when HEAD or merge-base is unavailable (e.g. initial commit)
    }
  }

  if (changed.size === 0 && !opts.staged && !opts.base) {
    try {
      const out = execFileSync('git', ['-c', 'core.quotePath=false', 'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'], {
        cwd: ROOT,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
      });
      for (const line of out.split(/\r?\n/)) {
        const clean = line.trim().replace(/\\/g, '/');
        if (clean) changed.add(clean);
      }
    } catch {
      // ignore
    }
  }

  return Array.from(changed).sort();
}

function planAffectedTests(files) {
  const projects = new Set();
  const explicitFiles = new Set();
  const excludes = new Set();

  if (files.length === 0) {
    return {
      projects: ['unit', 'contract-static'],
      explicitFiles: [],
      excludes: [],
    };
  }

  for (const rawFile of files) {
    const file = rawFile.replace(/\\/g, '/');

    if (
      file === 'README.md' ||
      file === 'AGENTS.md' ||
      file === 'SECURITY.md' ||
      file === 'tests/TESTING.md' ||
      file.startsWith('docs/')
    ) {
      explicitFiles.add('tests/contract/docs-hygiene.test.ts');
      continue;
    }

    if (file.startsWith('content-sources/')) {
      projects.add('corpus');
      excludes.add('**/reader-full-routability.test.ts');
      continue;
    }

    if (file === 'vitest.config.ts' || file === 'package.json' || file === 'astro.config.mjs' || file === 'tsconfig.json') {
      projects.add('unit');
      projects.add('contract-static');
      projects.add('integration');
      continue;
    }

    if (file.startsWith('electron/') || file.startsWith('src/server/') || file.startsWith('src/core/security/')) {
      projects.add('unit');
      projects.add('integration');
      explicitFiles.add('tests/contract/security-hardening.test.ts');
      continue;
    }

    if (
      file.startsWith('src/publishing/') ||
      file === 'scripts/pack-book-abp.mjs' ||
      file === 'scripts/build-exercise-data.mjs'
    ) {
      projects.add('unit');
      projects.add('artifacts');
      continue;
    }

    if (file.startsWith('scripts/lib/comment-stripper') || file === 'scripts/git-clean-push.mjs') {
      explicitFiles.add('tests/unit/comment-stripper.test.ts');
      continue;
    }

    if (file.startsWith('tests/unit/')) {
      projects.add('unit');
      continue;
    }
    if (file.startsWith('tests/acceptance/')) {
      projects.add('artifacts');
      continue;
    }
    if (file.startsWith('tests/system/')) {
      projects.add('system');
      continue;
    }
    if (file.startsWith('tests/contract/')) {
      projects.add('contract-static');
      projects.add('integration');
      continue;
    }

    if (file.startsWith('src/styles/')) {
      explicitFiles.add('tests/contract/window-layers.test.ts');
      explicitFiles.add('tests/contract/typography-presets.test.ts');
      continue;
    }

    if (file.startsWith('src/') || file.startsWith('bin/') || file.startsWith('scripts/')) {
      projects.add('unit');
      projects.add('contract-static');
      if (
        file.includes('content-api') ||
        file.includes('pdf2abp') ||
        file.includes('doc-ingestion') ||
        file.includes('harness')
      ) {
        projects.add('integration');
      }
    }
  }

  return {
    projects: Array.from(projects),
    explicitFiles: Array.from(explicitFiles),
    excludes: Array.from(excludes),
  };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const changedFiles = getGitChangedFiles(opts);
  const plan = planAffectedTests(changedFiles);

  const runs = [];
  if (plan.projects.length > 0) {
    const args = ['run'];
    for (const p of plan.projects) {
      args.push('--project', p);
    }
    for (const ex of plan.excludes) {
      args.push('--exclude', ex);
    }
    runs.push(args);
  }

  const standaloneFiles = plan.explicitFiles.filter((f) => {
    if (!fs.existsSync(path.join(ROOT, f))) return false;
    if (f.startsWith('tests/unit/') && plan.projects.includes('unit')) return false;
    if (f === 'tests/contract/docs-hygiene.test.ts' && plan.projects.includes('contract-static')) return false;
    if (f === 'tests/contract/security-hardening.test.ts' && plan.projects.includes('contract-static')) return false;
    if (f.startsWith('tests/contract/') && plan.projects.includes('contract-static')) return false;
    return true;
  });

  if (standaloneFiles.length > 0) {
    runs.push(['run', ...standaloneFiles]);
  }

  console.log('[test-affected] Changed files:', changedFiles.length);
  for (const f of changedFiles.slice(0, 25)) {
    console.log(`  - ${f}`);
  }
  if (changedFiles.length > 25) {
    console.log(`  ... and ${changedFiles.length - 25} more`);
  }
  console.log('[test-affected] Planned runs:');
  for (const args of runs) {
    console.log(`  vitest ${args.join(' ')}`);
  }

  if (opts.dryRun) {
    return;
  }

  const vitestBin = path.join(ROOT, 'node_modules', 'vitest', 'vitest.mjs');
  for (const args of runs) {
    const res = spawnSync(process.execPath, [vitestBin, ...args], {
      cwd: ROOT,
      stdio: 'inherit',
    });
    if ((res.status ?? 1) !== 0) {
      process.exit(res.status ?? 1);
    }
  }
}

main();
