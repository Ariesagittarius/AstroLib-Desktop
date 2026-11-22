#!/usr/bin/env node

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
      'mupdf',
    ],
  });

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

  for (const pySrc of [
    'src/services/info-highlight/qwen-highlight-runner.py',
    'src/server/plugins/bilingual-aligner/qwen-runner.py',
  ]) {
    const absSrc = path.join(ROOT, pySrc);
    if (fs.existsSync(absSrc)) {
      fs.copyFileSync(absSrc, path.join(OUT_DIR, path.basename(pySrc)));
    }
  }

  const katexDistSrc = path.join(ROOT, 'node_modules/katex/dist');
  const katexCssSrc = path.join(katexDistSrc, 'katex.min.css');
  if (fs.existsSync(katexCssSrc)) {
    const katexOutDir = path.join(OUT_DIR, 'katex');
    const fontsOutDir = path.join(katexOutDir, 'fonts');
    fs.mkdirSync(fontsOutDir, { recursive: true });
    fs.copyFileSync(katexCssSrc, path.join(katexOutDir, 'katex.min.css'));

    const jsCopies = [
      [path.join(katexDistSrc, 'katex.min.js'), 'katex.min.js'],
      [path.join(katexDistSrc, 'contrib', 'auto-render.min.js'), 'katex-auto-render.min.js'],
      [path.join(katexDistSrc, 'contrib', 'mhchem.min.js'), 'katex-mhchem.min.js'],
    ];
    for (const [srcFile, targetName] of jsCopies) {
      if (fs.existsSync(srcFile)) {
        fs.copyFileSync(srcFile, path.join(katexOutDir, targetName));
      }
    }

    const fontsSrc = path.join(katexDistSrc, 'fonts');
    if (fs.existsSync(fontsSrc)) {
      for (const f of fs.readdirSync(fontsSrc)) {
        if (f.endsWith('.woff2')) {
          fs.copyFileSync(path.join(fontsSrc, f), path.join(fontsOutDir, f));
        }
      }
    }
  }

  console.log(`✅ Electron 脚本编译成功！耗时: ${Date.now() - startTime}ms -> dist-electron/`);
}

build().catch((err) => {
  console.error('❌ Electron 脚本编译失败:', err);
  process.exit(1);
});
