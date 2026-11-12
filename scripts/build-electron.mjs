#!/usr/bin/env node
/**
 * scripts/build-electron.mjs
 * ============================================================================
 * AstroLib Electron 主进程与预加载脚本编译工具 (基于 esbuild，毫秒级快速打包)
 * ============================================================================
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'dist-electron');

fs.mkdirSync(OUT_DIR, { recursive: true });

async function build() {
  const startTime = Date.now();
  console.log('⚡ 正在编译 Electron 主进程与 Preload 脚本...');

  // 1. 编译 main.ts -> dist-electron/main.mjs
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'electron/main.ts')],
    outfile: path.join(OUT_DIR, 'main.mjs'),
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    sourcemap: true,
    external: [
      'electron',
      '@huggingface/transformers',
      'onnxruntime-node',
      'sharp',
    ],
  });

  // 2. 编译 preload.ts -> dist-electron/preload.cjs (必须为 CommonJS 格式，确保 Chromium 渲染层原生执行)
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'electron/preload.ts')],
    outfile: path.join(OUT_DIR, 'preload.cjs'),
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    sourcemap: true,
    external: ['electron'],
  });

  // 3. 复制 Python 常驻推理脚本到 dist-electron
  const pyRunnerSrc = path.join(ROOT, 'src/services/info-highlight/qwen-highlight-runner.py');
  if (fs.existsSync(pyRunnerSrc)) {
    fs.copyFileSync(pyRunnerSrc, path.join(OUT_DIR, 'qwen-highlight-runner.py'));
  }

  console.log(`✅ Electron 脚本编译成功！耗时: ${Date.now() - startTime}ms -> dist-electron/`);
}

build().catch((err) => {
  console.error('❌ Electron 脚本编译失败:', err);
  process.exit(1);
});
