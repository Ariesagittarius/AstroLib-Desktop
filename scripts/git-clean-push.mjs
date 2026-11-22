#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stripContentForFile } from './lib/comment-stripper.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

function getGitPath() {
  const candidates = [
    'git',
    'C:\\Program Files\\Git\\cmd\\git.exe',
    'C:\\Program Files (x86)\\Git\\cmd\\git.exe',
  ];
  for (const cmd of candidates) {
    try {
      execSync(`"${cmd}" --version`, { stdio: 'ignore' });
      return cmd;
    } catch {

    }
  }
  throw new Error('未找到 Git 可执行程序，请确认系统已安装 Git！');
}

const GIT = getGitPath();

function runGit(args, cwd = PROJECT_ROOT, options = {}) {
  const cmd = `"${GIT}" ${args}`;
  return execSync(cmd, { cwd, encoding: 'utf8', stdio: options.stdio || 'pipe', maxBuffer: 64 * 1024 * 1024, ...options });
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    mode: 'clean',
    dryRun: false,
    force: false,
    remote: '',
    privateRemote: 'private',
    branch: '',
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--clean' || arg === '-c') {
      options.mode = 'clean';
    } else if (arg === '--private' || arg === '-p') {
      options.mode = 'private';
    } else if (arg === '--all' || arg === '-a') {
      options.mode = 'all';
    } else if (arg === '--dry-run' || arg === '-d') {
      options.dryRun = true;
    } else if (arg === '--force' || arg === '-f') {
      options.force = true;
    } else if (arg === '--remote' && i + 1 < args.length) {
      options.remote = args[++i];
    } else if (arg === '--private-remote' && i + 1 < args.length) {
      options.privateRemote = args[++i];
    } else if (arg === '--branch' && i + 1 < args.length) {
      options.branch = args[++i];
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    }
  }

  return options;
}

function showHelp() {
  console.log(`
AstroLib Git 双模式推送工具 (Clean / Private / All)

使用方法:
  node scripts/git-clean-push.mjs [选项]
  npm run push:clean    # 剥离注释推送到公共仓库 (origin)
  npm run push:private  # 保留全部注释推送到私有仓库 (private)
  npm run push:all      # 双推：先推私有完整版，再推公共无注释版

选项:
  --clean, -c           剥离全部代码注释并推送到公共仓库 (默认模式)
  --private, -p         推送保留完整注释的代码到私有仓库
  --all, -a             同时推送到私有仓库（完整版）与公共仓库（无注释版）
  --dry-run, -d         演练模式：在临时沙箱中剥离并校验，不实际执行远程推送
  --force, -f           推送时附加 --force
  --remote <name>       公共仓库远程名称 (默认: origin)
  --private-remote <n>  私有仓库远程名称 (默认: private)
  --branch <name>       目标推送分支 (默认: 当前分支)
  --help, -h            显示帮助信息
`);
}

function getRepoInfo() {
  const branch = runGit('rev-parse --abbrev-ref HEAD').trim();
  const commit = runGit('rev-parse HEAD').trim();
  const commitMsg = runGit('log -1 --pretty=%B').trim();
  const remotes = runGit('remote').split(/\r?\n/).filter(Boolean);
  return { branch, commit, commitMsg, remotes };
}

async function pushPrivate(options, repoInfo) {
  console.log('\n[private-push] [1/2] Preparing full-comment push to private remote...');
  const targetBranch = options.branch || repoInfo.branch;
  const privateRemote = options.privateRemote;

  if (!repoInfo.remotes.includes(privateRemote)) {
    console.warn(`\n[private-push] Remote '${privateRemote}' is not configured.`);
    console.warn(`   git remote add ${privateRemote} <private-repo-url>\n`);
    if (options.mode === 'private') {
      process.exit(1);
    }
    console.log('[private-push] Skipping private remote push; continuing public push...');
    return false;
  }

  const forceFlag = options.force ? ' --force' : '';
  const pushCmd = `push ${privateRemote} ${repoInfo.branch}:${targetBranch}${forceFlag}`;

  if (options.dryRun) {
    console.log(`[private-push] [Dry Run] Would execute: git ${pushCmd}`);
  } else {
    console.log(`[private-push] Pushing full history to ${privateRemote}/${targetBranch}...`);
    runGit(pushCmd, PROJECT_ROOT, { stdio: 'inherit' });
    console.log('[private-push] Private repository push completed.');
  }
  return true;
}

async function pushClean(options, repoInfo) {
  console.log('\n[clean-push] [2/2] Preparing comment-stripped push to public remote...');
  const targetBranch = options.branch || repoInfo.branch;
  const remote = options.remote || (repoInfo.remotes.includes('origin') ? 'origin' : '');

  if (!remote || !repoInfo.remotes.includes(remote)) {
    throw new Error(
      `Public remote '${options.remote || 'origin'}' not found (remotes: ${repoInfo.remotes.join(', ') || 'none'}).`
    );
  }

  const tempDir = path.join(PROJECT_ROOT, 'node_modules', '.cache', `_git_clean_${Date.now()}`);
  fs.mkdirSync(path.dirname(tempDir), { recursive: true });

  console.log(`[clean-push] Creating temporary worktree: ${path.basename(tempDir)}`);
  try {

    runGit(`worktree add --detach "${tempDir}" HEAD`);

    const trackedFiles = runGit('-c core.quotePath=false ls-files', tempDir)
      .split(/\r?\n/)
      .map(f => f.trim())
      .filter(Boolean);

    const bannedPrefixes = [
      '.agents',
      '.dsh',
      '.codex',
      '.gemini',
      '.antigravity',
      '.backups',
      '.venv',
      '.venv-agent',
      'dist-electron',
      'release',
      'task',
      'backup',
      'workspace',
      'test/data',
      'test/output',
    ];
    const bannedExact = new Set([
      'CLAUDE.md',
      '.mineru.json',
      '.env',
      '.env.local',
      '.env.production',
      '.env.development',
      'academic-semantic-hierarchy-audit.md',
      'academic-typography-audit.md',
      'performance-baseline.md',
      'performance-optimization-report.md',
      'src/data/exercises/bupt_math_full_database.json',
      'src/components/ChapterQuiz.astro',
      'src/components/VpFooter.astro',
    ]);
    const bannedSubstrings = [
      'public/data/exercises/',
      'public/inspector-data/',
      'public/relation-graphs/',
      'public/data/cross-ref/',
      'public/ai-index/',
      'public/epub/',
      'src/data/exercises/raw_papers/',
      'src/data/exercises/legacy_pages/',
    ];

    function isBannedFile(relPath) {
      const normalized = relPath.replace(/\\/g, '/');
      const baseName = path.basename(normalized);
      if (bannedPrefixes.some(p => normalized === p || normalized.startsWith(p + '/'))) return true;
      if (bannedExact.has(normalized) || bannedExact.has(baseName)) return true;
      if (baseName.startsWith('.env.') && baseName !== '.env.example') return true;
      if (bannedSubstrings.some(sub => normalized.startsWith(sub) || normalized.includes('/' + sub))) return true;
      if (normalized.endsWith('.cmd') || normalized.endsWith('.bak')) return true;
      if (normalized.startsWith('scripts/_test-') || normalized.startsWith('scripts/rollback_')) return true;
      return false;
    }

    let agentCleanedCount = 0;
    for (const relPath of trackedFiles) {
      if (isBannedFile(relPath)) {
        const fullPath = path.join(tempDir, relPath);
        if (fs.existsSync(fullPath)) {
          fs.rmSync(fullPath, { recursive: true, force: true });
          agentCleanedCount++;
        }
      }
    }
    if (agentCleanedCount > 0) {
      runGit('add -u', tempDir);
      console.log(`[clean-push] Excluded ${agentCleanedCount} banned local/secret/derived files from public worktree`);
    }

    console.log(`[clean-push] Scanning and stripping comments across ${trackedFiles.length} tracked files...`);
    let strippedCount = 0;
    const processExtensions = new Set([
      '.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.jsx', '.tsx', '.json', '.jsonc',
      '.css', '.scss', '.less',
      '.astro',
      '.md', '.mdx',
      '.py',
      '.yml', '.yaml',
      '.sh', '.bash', '.ps1',
      '.html', '.xml', '.xhtml', '.svg', '.plist',
      '.typ', '.tex', '.sty', '.cls',
      '.toml', '.ini', '.conf', '.cfg', '.env',
      '.sql', '.bat', '.cmd',
    ]);
    const processBasenames = new Set([
      '.gitignore',
      '.gitattributes',
      '.editorconfig',
      '.dockerignore',
      '.npmrc',
      '.prettierignore',
      '.eslintignore',
      '.env.example',
    ]);

    for (const relPath of trackedFiles) {
      if (isBannedFile(relPath)) continue;
      const baseName = path.basename(relPath).toLowerCase();
      const ext = path.extname(relPath).toLowerCase();
      if (!processExtensions.has(ext) && !processBasenames.has(baseName)) continue;

      const fullPath = path.join(tempDir, relPath);
      if (!fs.existsSync(fullPath)) continue;

      const original = fs.readFileSync(fullPath, 'utf8');
      const stripped = stripContentForFile(original, relPath);

      if (original !== stripped) {
        fs.writeFileSync(fullPath, stripped, 'utf8');
        strippedCount++;
      }
    }

    console.log(`[clean-push] Stripped comments from ${strippedCount} files`);

    console.log('[clean-push] Verifying syntax in stripped worktree...');
    for (const checkTarget of ['bin/astrolib-cli.mjs', 'bin/astrolib-mcp.mjs', 'scripts/pack-book-abp.mjs']) {
      if (fs.existsSync(path.join(tempDir, checkTarget))) {
        execSync(`node --check "${checkTarget}"`, { cwd: tempDir, stdio: 'pipe' });
      }
    }
    if (fs.existsSync(path.join(tempDir, 'scripts/scan-mdx.mjs'))) {
      execSync('node scripts/scan-mdx.mjs content-sources/collections/math/math_analysis', {
        cwd: tempDir,
        stdio: 'ignore',
      });
    }
    console.log('[clean-push] Stripped worktree syntax and MDX checks passed');

    const status = runGit('status --porcelain', tempDir).trim();
    let strippedCommit = repoInfo.commit;

    if (status) {
      runGit('add -A', tempDir);
      const isSkipCi = /\[(skip ci|ci skip|skip vercel|vercel skip)\]/i.test(repoInfo.commitMsg);
      const cleanCommitMsg = `release(distribution): strip code annotations for public repository${isSkipCi ? ' [skip ci]' : ''}`;
      runGit(`commit -m "${cleanCommitMsg.replace(/"/g, '\\"')}"`, tempDir);
      strippedCommit = runGit('rev-parse HEAD', tempDir).trim();
      console.log(`[clean-push] Created clean commit ${strippedCommit.slice(0, 8)}`);
    } else {
      console.log(`[clean-push] No comment diffs; using current commit ${strippedCommit.slice(0, 8)}`);
    }

    const forceFlag = ' --force';
    const pushCmd = `push ${remote} ${strippedCommit}:refs/heads/${targetBranch}${forceFlag}`;

    if (options.dryRun) {
      console.log(`[clean-push] [Dry Run] Would execute: git ${pushCmd}`);
      console.log(`[clean-push] [Dry Run] Verification succeeded without pushing.`);
    } else {
      console.log(`[clean-push] Pushing comment-stripped snapshot to ${remote}/${targetBranch}...`);
      runGit(pushCmd, tempDir, { stdio: 'inherit' });
      console.log(`[clean-push] Public repository push completed.`);
    }
  } finally {

    try {
      console.log('[clean-push] Cleaning up temporary worktree...');
      runGit(`worktree remove --force "${tempDir}"`, PROJECT_ROOT);
      runGit('worktree prune', PROJECT_ROOT);
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch (cleanupErr) {

    }
  }
}

async function main() {
  const options = parseArgs();
  if (options.help) {
    showHelp();
    return;
  }

  const repoInfo = getRepoInfo();
  console.log(`[clean-push] Branch: ${repoInfo.branch} | Commit: ${repoInfo.commit.slice(0, 8)}`);

  if (options.mode === 'private') {
    await pushPrivate(options, repoInfo);
  } else if (options.mode === 'clean') {
    await pushClean(options, repoInfo);
  } else if (options.mode === 'all') {
    await pushPrivate(options, repoInfo);
    await pushClean(options, repoInfo);
  }

  console.log('\n[clean-push] All operations complete; local workspace comments preserved.\n');
}

main().catch(err => {
  console.error('\n[clean-push] Push failed:', err.message);
  process.exit(1);
});
