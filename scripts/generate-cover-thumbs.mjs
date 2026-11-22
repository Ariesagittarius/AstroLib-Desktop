#!/usr/bin/env node
/**
 * scripts/generate-cover-thumbs.mjs
 * ============================================================================
 * 生成书库封面 360x480 WebP 缩略图并本地化外链封面
 * ============================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const COVERS_DIR = path.join(ROOT, 'public', 'covers');
const THUMBS_DIR = path.join(COVERS_DIR, 'thumbs');

const EXTERNAL_COVERS = [
  {
    filename: 'math_senior.jpg',
    title: '高中数学专题方法',
    subtitle: '三角函数 · 数列 · 导数',
    url: 'https://img.alicdn.com/bao/uploaded/i3/2222147525702/O1CN01uA0zRt1rzZVUNfX91_!!4611686018427386950-53-xy_item.heic_790x10000Q90.jpg_.webp',
    accent: '#0b57d0',
  },
  {
    filename: 'math_analysis.jpg',
    title: '数学分析（第五版）',
    subtitle: '华东师范大学数学系',
    url: 'https://images.unsplash.com/photo-1509228626012-67e33ae61292?auto=format&fit=crop&q=80&w=400',
    accent: '#146c2e',
  },
];

function buildFallbackCoverSvg(title, subtitle, accent) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="960" viewBox="0 0 720 960">
  <rect width="720" height="960" fill="#f7f9fb"/>
  <rect x="0" y="0" width="28" height="960" fill="${accent}"/>
  <line x1="76" y1="160" x2="644" y2="160" stroke="#dfe4ea" stroke-width="2"/>
  <text x="76" y="290" font-family="sans-serif" font-size="48" font-weight="700" fill="#1b1f24">${title}</text>
  <text x="76" y="360" font-family="sans-serif" font-size="26" fill="#525b66">${subtitle}</text>
  <line x1="76" y1="800" x2="644" y2="800" stroke="#dfe4ea" stroke-width="2"/>
  <text x="76" y="852" font-family="sans-serif" font-size="22" letter-spacing="3" fill="#6b7280">ASTROLIB ACADEMIC ARCHIVE</text>
</svg>`;
}

async function ensureLocalExternalCovers() {
  fs.mkdirSync(COVERS_DIR, { recursive: true });
  for (const item of EXTERNAL_COVERS) {
    const dest = path.join(COVERS_DIR, item.filename);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 1024) {
      continue;
    }

    let saved = false;
    try {
      const resp = await fetch(item.url, { signal: AbortSignal.timeout(8000) });
      if (resp.ok) {
        const buf = Buffer.from(await resp.arrayBuffer());
        await sharp(buf).jpeg({ quality: 88 }).toFile(dest);
        saved = true;
        console.log(`[thumbs] 已本地化外链封面 -> public/covers/${item.filename}`);
      }
    } catch {
      // 网络离线时自动降级生成本地学术封面
    }

    if (!saved) {
      const svg = buildFallbackCoverSvg(item.title, item.subtitle, item.accent);
      await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toFile(dest);
      console.log(`[thumbs] 外链不可达，已生成本地封面 -> public/covers/${item.filename}`);
    }
  }
}

async function main() {
  await ensureLocalExternalCovers();
  fs.mkdirSync(THUMBS_DIR, { recursive: true });

  const entries = fs.readdirSync(COVERS_DIR, { withFileTypes: true });
  const coverFiles = entries.filter(
    (e) => e.isFile() && /\.(jpe?g|png|webp)$/i.test(e.name)
  );

  let totalOriginalBytes = 0;
  let totalThumbBytes = 0;
  let generatedCount = 0;

  for (const file of coverFiles) {
    const srcPath = path.join(COVERS_DIR, file.name);
    const baseName = file.name.replace(/\.[^.]+$/, '');
    const thumbPath = path.join(THUMBS_DIR, `${baseName}.webp`);

    const origStat = fs.statSync(srcPath);
    totalOriginalBytes += origStat.size;

    await sharp(srcPath)
      .resize(360, 480, { fit: 'cover', position: 'centre' })
      .webp({ quality: 82 })
      .toFile(thumbPath);

    const thumbStat = fs.statSync(thumbPath);
    totalThumbBytes += thumbStat.size;
    generatedCount++;
  }

  const origKB = (totalOriginalBytes / 1024).toFixed(1);
  const thumbKB = (totalThumbBytes / 1024).toFixed(1);
  console.log(
    `[thumbs] 生成 ${generatedCount} 张 360x480 WebP 缩略图: ${origKB} KB -> ${thumbKB} KB`
  );
}

main().catch((err) => {
  console.error('[thumbs] 生成封面缩略图失败:', err);
  process.exit(1);
});
