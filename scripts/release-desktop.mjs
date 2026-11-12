#!/usr/bin/env node
/**
 * scripts/release-desktop.mjs
 * ============================================================================
 * AstroLib 桌面端发布与 Git Tag 驱动工具 (Desktop Release Dispatcher)
 * ============================================================================
 * 职责：
 * 1. 检查本地工作区状态，确保无未提交变更；
 * 2. 交互式/参数化递增 package.json 版本号；
 * 3. 生成学术规范 Release 提交并打上 Git Tag (vX.X.X)；
 * 4. 安全推送 Tag 至 GitHub (origin & private)，触发 GitHub Actions 自动化编译；
 * 5. 确保日常开发与 Vercel 静态站发布 100% 隔离，互不干扰。
 * ============================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

function runGit(cmd) {
  return execSync(`git ${cmd}`, { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' }).trim();
}

function parseSemver(ver) {
  const parts = ver.replace(/^v/, '').split('.').map(Number);
  if (parts.length < 3 || parts.some(isNaN)) {
    throw new Error(`无效的语义化版本号格式: '${ver}' (需为 X.Y.Z)`);
  }
  return parts;
}

function bumpVersion(current, type) {
  const [major, minor, patch] = parseSemver(current);
  if (type === 'major') return `${major + 1}.0.0`;
  if (type === 'minor') return `${major}.${minor + 1}.0`;
  if (type === 'patch') return `${major}.${minor}.${patch + 1}`;
  return type.replace(/^v/, ''); // 自定义指定版本号
}

async function main() {
  console.log(`
===================================================================
  AstroLib 桌面端发布与 GitHub Actions 触发工具 (Desktop Release)
===================================================================
`);

  // 1. 检查工作区状态
  const status = runGit('status --porcelain');
  if (status.length > 0) {
    console.error('❌ 检测到工作区存在未提交的更改，请先使用 npm run push 完成提交后再发布！');
    process.exit(1);
  }

  // 2. 读取 package.json
  const pkgPath = path.join(ROOT, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const currentVer = pkg.version || '0.0.1';

  // 3. 解析目标版本号
  const arg = process.argv[2] || 'patch';
  const newVer = bumpVersion(currentVer, arg);
  const tag = `v${newVer}`;

  console.log(`📦 当前版本: v${currentVer} -> 目标发布版本: ${tag}`);

  // 4. 更新 package.json
  pkg.version = newVer;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  console.log(`✅ 已更新 package.json version: ${newVer}`);

  // 5. 提交版本变更与打 Tag
  runGit('add package.json');
  runGit(`commit -m "release(core): prepare desktop release ${tag}"`);
  runGit(`tag ${tag}`);
  console.log(`🏷️  已创建 Git Tag: ${tag}`);

  // 6. 推送至远程仓库
  console.log('🚀 正在推送提交与 Tag 到远程仓库...');
  const remotes = runGit('remote').split(/\r?\n/).filter(Boolean);

  if (remotes.includes('private')) {
    try {
      execSync(`git push private HEAD && git push private ${tag}`, { cwd: ROOT, stdio: 'inherit' });
      console.log('✅ 已推送到 private 仓库');
    } catch {
      console.warn('⚠️ 推送到 private 失败，继续推送 origin');
    }
  }

  if (remotes.includes('origin')) {
    execSync(`git push origin HEAD && git push origin ${tag}`, { cwd: ROOT, stdio: 'inherit' });
    console.log('✅ 已推送到 origin 仓库');
  }

  console.log(`
===================================================================
🎉 桌面端发布流水线已成功触发！
🔗 GitHub Actions 正在自动编译 Windows 安装包与绿色免安装包。
可在以下地址查看编译进度与 Release 产物：
https://github.com/Ariesagittarius/AstroLib/actions
===================================================================
`);
}

main().catch((err) => {
  console.error('❌ 发布异常:', err.message || err);
  process.exit(1);
});
