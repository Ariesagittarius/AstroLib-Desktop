#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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
    message: '',
    mode: 'all',
    force: false,
    dryRun: false,
    help: false,
  };

  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--clean' || arg === '-c') {
      options.mode = 'clean';
    } else if (arg === '--private' || arg === '-p') {
      options.mode = 'private';
    } else if (arg === '--all' || arg === '-a') {
      options.mode = 'all';
    } else if (arg === '--force' || arg === '-f') {
      options.force = true;
    } else if (arg === '--dry-run' || arg === '-d') {
      options.dryRun = true;
    } else if ((arg === '--message' || arg === '-m') && i + 1 < args.length) {
      options.message = args[++i];
    } else if (!arg.startsWith('-')) {
      positional.push(arg);
    }
  }

  if (!options.message && positional.length > 0) {
    options.message = positional.join(' ');
  }

  return options;
}

function showHelp() {
  console.log(`
===================================================================
  AstroLib 一键全自动同步与推送工具 (One-Click Sync & Push)
===================================================================

用法:
  npm run push                 # 一键暂存修改、生成学术规范提交并双推
  npm run update               # 同上 (别名)
  npm run push "feat(content): update math chapters"  # 自定义提交信息
  node scripts/one-click-push.mjs [选项] [提交说明]

选项:
  -m, --message <msg>  指定 Git 提交说明 (必须为英文学术规范格式)
  -a, --all            双推：推送到私有仓库与开源公共仓库 (默认模式)
  -c, --clean          仅推送到公共开源仓库 (origin, 自动剥离注释)
  -p, --private        仅推送到私有备份仓库 (private, 保留完整注释)
  -d, --dry-run        演练模式：检查工作区并模拟沙箱流程，不实际推送
  -f, --force          推送时附加 --force
  -h, --help           显示此帮助信息
`);
}

function generateSmartCommitMessage(statusLines) {
  const filePaths = statusLines.map((line) => line.slice(3).trim());

  const hasFeedback = filePaths.some((p) => p.includes('feedback') || p.includes('Feedback'));
  const hasFormula = filePaths.some((p) => p.includes('formula') || p.includes('katex'));
  const hasAi = filePaths.some((p) => p.includes('/ai/') || p.includes('ai-index') || p.includes('chat'));
  const hasInspector = filePaths.some((p) => p.includes('inspector') || p.includes('relation'));
  const hasContent = filePaths.some((p) => p.includes('content-sources/collections/'));
  const hasUi = filePaths.some(
    (p) => p.includes('src/components/') || p.includes('src/styles/') || p.includes('src/pages/')
  );
  const hasScripts = filePaths.some(
    (p) => p.startsWith('scripts/') || p.endsWith('.config.mjs') || p.endsWith('package.json')
  );

  let type = 'feat';
  let scope = 'core';
  let desc = 'update codebase assets and site configurations';

  if (hasFeedback && hasFormula) {
    type = 'feat';
    scope = 'feedback';
    desc = 'introduce errata submission workflow and modularize formula actions';
  } else if (hasFeedback) {
    type = 'feat';
    scope = 'feedback';
    desc = 'introduce errata reporting modal and feedback bot proxy';
  } else if (hasFormula) {
    type = 'feat';
    scope = 'katex';
    desc = 'modularize math formula actions and copy exporters';
  } else if (hasInspector) {
    type = 'feat';
    scope = 'editor';
    desc = 'update module inspector tools and relation graph data';
  } else if (hasAi) {
    type = 'feat';
    scope = 'ai';
    desc = 'update assistant chat controller and retrieval index';
  } else if (hasContent) {
    type = 'feat';
    scope = 'content';
    desc = 'update textbook chapters and learning resources';
  } else if (hasUi) {
    type = 'feat';
    scope = 'ui';
    desc = 'refine reader interface layout and styling components';
  } else if (hasScripts) {
    type = 'chore';
    scope = 'core';
    desc = 'update build scripts and project configurations';
  }

  return `${type}(${scope}): ${desc}`;
}

function normalizeCommitMessage(rawMsg, statusLines) {
  let msg = (rawMsg || '').trim();

  if (!msg) {
    return generateSmartCommitMessage(statusLines);
  }

  const asciiClean = msg.replace(/[^\x00-\x7F]/g, '').trim();

  const conventionalPattern =
    /^(feat|fix|perf|refactor|docs|style|chore|test|release|ci|build)(\([a-z0-9_/-]+\))?:\s+[a-z0-9].+$/;

  if (conventionalPattern.test(asciiClean)) {
    return asciiClean;
  }

  const sanitized = asciiClean.replace(/^[^a-zA-Z0-9]+/, '');
  if (sanitized.length > 0) {
    return `feat(core): ${sanitized.toLowerCase()}`;
  }

  return generateSmartCommitMessage(statusLines);
}

async function main() {
  const options = parseArgs();
  if (options.help) {
    showHelp();
    return;
  }

  console.log('\n===================================================================');
  console.log('  AstroLib One-Click Update & Push');
  console.log('===================================================================\n');

  const branch = runGit('rev-parse --abbrev-ref HEAD').trim();
  const remotes = runGit('remote').split(/\r?\n/).filter(Boolean);
  const statusOutput = runGit('status --porcelain').trim();
  const statusLines = statusOutput ? statusOutput.split(/\r?\n/).filter(Boolean) : [];

  console.log(`[push] Current branch: ${branch}`);
  console.log(`[push] Remotes: ${remotes.join(', ') || 'none'}`);

  if (statusLines.length > 0) {
    console.log(`\n[push] Detected ${statusLines.length} modified files:`);
    const preview = statusLines.slice(0, 8);
    for (const line of preview) {
      console.log(`   ${line}`);
    }
    if (statusLines.length > 8) {
      console.log(`   ... and ${statusLines.length - 8} more files`);
    }

    const commitMsg = normalizeCommitMessage(options.message, statusLines);
    console.log(`\n[push] Commit message: "${commitMsg}"`);

    if (!options.dryRun) {
      console.log('[push] Staging changes (git add -A)...');
      runGit('add -A');

      console.log('[push] Creating commit...');
      runGit(`commit -m "${commitMsg.replace(/"/g, '\\"')}"`);
      const newCommit = runGit('rev-parse --short HEAD').trim();
      console.log(`[push] Committed ${newCommit}`);
    } else {
      console.log('[push] [Dry Run] Skipping git add / git commit.');
    }
  } else {
    console.log('\n[push] Working tree clean.');
  }

  console.log('\n-------------------------------------------------------------------');
  console.log('[push] Invoking distribution pipeline (scripts/git-clean-push.mjs)...');
  console.log('-------------------------------------------------------------------');

  const pushFlags = [];
  if (options.mode === 'clean') pushFlags.push('--clean');
  else if (options.mode === 'private') pushFlags.push('--private');
  else pushFlags.push('--all');

  if (options.dryRun) pushFlags.push('--dry-run');
  if (options.force) pushFlags.push('--force');

  const pushScriptPath = path.join(PROJECT_ROOT, 'scripts', 'git-clean-push.mjs');
  const cmd = `node "${pushScriptPath}" ${pushFlags.join(' ')}`;

  try {
    execSync(cmd, { cwd: PROJECT_ROOT, stdio: 'inherit' });
  } catch (err) {
    console.error('\n[push] Push failed:', err.message);
    process.exit(1);
  }

  console.log('\n===================================================================');
  console.log('  Push workflow complete.');
  console.log('===================================================================\n');
}

main().catch((err) => {
  console.error('\n[push] Execution failed:', err.message);
  process.exit(1);
});
