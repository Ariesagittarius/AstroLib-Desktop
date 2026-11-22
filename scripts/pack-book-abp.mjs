#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { cleanSlug } from '../src/utils/slug.ts';
import { collectHeadingsFromHtml } from '../src/core/content/headings.ts';
import { ABP_SCHEMA_VERSION } from '../src/types/content-package.ts';
import {
  compileMarkdownToSemanticResult,
  parseFrontmatter,
} from '../src/publishing/abp/compiler.ts';
import { getCatalogCollections } from '../src/config/collections.config.ts';
import { resolveAbpArtifactsDir, resolveBookSourceDir, CONTENT_CATALOG_REL } from '../src/core/catalog/content-paths.ts';
import { buildBookIndex } from '../src/ai/indexer.mjs';
import { buildGlobalBlockIndex } from '../src/core/indexing/cross-ref-indexer.mjs';
import { chunkMdx } from '../src/ai/chunker.mjs';
import { serializeEmbeddingsBinary } from '../src/features/search-rec/services/storage.ts';
import { SUPPORTED_EXERCISE_BOOKS } from './build-exercise-data.mjs';
import {
  DEFAULT_DESKTOP_RELEASE_REPO,
  buildReleaseCatalogUrl,
  buildReleasePackUrl,
  normalizeReleaseRepo,
} from '../src/config/release.config.ts';

const SUPPORTED_EXERCISE_SLUGS = new Set(SUPPORTED_EXERCISE_BOOKS.map((b) => b.slug));

let embeddingPipelineInstance = null;
async function getEmbeddingPipeline() {
  if (!embeddingPipelineInstance) {
    let transformersMod;
    try {
      transformersMod = await import('@huggingface/transformers');
    } catch {
      const nodeImport = new Function('m', 'return import(m)');
      transformersMod = await nodeImport('@huggingface/transformers');
    }
    const { pipeline } = transformersMod;
    embeddingPipelineInstance = await pipeline('feature-extraction', 'Xenova/bge-small-zh-v1.5', {
      dtype: 'q8',
      device: 'cpu',
    });
  }
  return embeddingPipelineInstance;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

function computeHash(content) {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

export async function packBook({
  bookDir,
  outDir,
  customManifest = null,
  withVectors = true,
  vectorFormat = 'int8',
  includeAuxiliary = true,
  releaseRepo = DEFAULT_DESKTOP_RELEASE_REPO,
  releaseTag = process.env.ASTROLIB_RELEASE_TAG || '',
}) {
  if (!fs.existsSync(bookDir)) {
    throw new Error(`目标书籍目录不存在: ${bookDir}`);
  }

  const resolvedDir = path.resolve(bookDir);
  const dirParts = resolvedDir.replace(/\\/g, '/').split('/');
  const bookSlug = dirParts[dirParts.length - 1];
  const colSlug = dirParts[dirParts.length - 2] || 'general';

  let existingBook = null;
  for (const col of getCatalogCollections()) {
    const found = (col.books || []).find((b) => b.slug === bookSlug && col.slug === colSlug)
      || (col.books || []).find((b) => b.slug === bookSlug);
    if (found) {
      existingBook = found;
      break;
    }
  }

  const manifest = {
    schemaVersion: ABP_SCHEMA_VERSION,
    id: `${colSlug}-${bookSlug}`,
    slug: bookSlug,
    colSlug: colSlug,
    title: existingBook?.title || customManifest?.title || bookSlug,
    author: existingBook?.author || customManifest?.author || 'AstroLib',
    publisher: existingBook?.publisher || customManifest?.publisher,
    isbn: existingBook?.isbn || customManifest?.isbn,
    edition: existingBook?.edition || customManifest?.edition,
    stage: existingBook?.stage || customManifest?.stage,
    stageLabel: existingBook?.stageLabel || customManifest?.stageLabel,
    category: existingBook?.category || customManifest?.category || 'textbook',
    categoryLabel: existingBook?.categoryLabel || customManifest?.categoryLabel || '教材',
    subject: existingBook?.subject || customManifest?.subject || colSlug,
    subjectLabel: existingBook?.subjectLabel || customManifest?.subjectLabel || '理学',
    description: existingBook?.description || customManifest?.description || '',
    tags: existingBook?.tags || customManifest?.tags || [],
    cover: existingBook?.cover || customManifest?.cover,
    entryPoint: existingBook?.entryPoint || customManifest?.entryPoint || '',
    trackClasses: (existingBook?.trackClasses && existingBook.trackClasses.length > 0) ? existingBook.trackClasses : ['.toc-chunk'],
    notices: existingBook?.notices || customManifest?.notices,
    languages: existingBook?.languages || customManifest?.languages,
    modules: (existingBook?.modules && Object.keys(existingBook.modules).length > 0)
      ? existingBook.modules
      : {
          '定理': { short: '理' },
          '定义': { short: '定' },
          '例题': { short: '例' },
          '习题': { short: '习' },
          '性质': { short: '性' },
          '推论': { short: '推' },
          '引理': { short: '引' },
          '命题': { short: '命' },
          '公理': { short: '公' },
          '方法': { short: '法' },
          '注': { short: '注' },
          '知识要点': { short: '知' },
          '知识板块': { short: '块' },
        },
    sections: [],
    totalChapters: 0,
    updatedAt: new Date().toISOString(),
    contentHash: '',
    assets: [],
  };

  function findChapterFiles(dir, baseDir = dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    let results = [];
    for (const entry of entries) {
      if (entry.name === 'images' || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results = results.concat(findChapterFiles(full, baseDir));
      } else if (entry.isFile() && (entry.name.endsWith('.mdx') || entry.name.endsWith('.md'))) {
        const rel = path.relative(baseDir, full).replace(/\\/g, '/');
        results.push(rel);
      }
    }
    return results.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  }

  const chapterFiles = findChapterFiles(resolvedDir);

  if (chapterFiles.length === 0) {
    throw new Error(`未在目录 ${bookDir} 中找到任何 .mdx 或 .md 章节文件！`);
  }

  const rawEntry = manifest.entryPoint || chapterFiles[0].replace(/\.(mdx|md)$/, '');
  manifest.entryPoint = cleanSlug(rawEntry);

  const chapterPayloads = {};
  const sectionChapters = [];
  const allBookChunks = [];
  let combinedHashData = '';

  for (const cFile of chapterFiles) {
    const fullPath = path.join(resolvedDir, cFile);
    const rawContent = fs.readFileSync(fullPath, 'utf8');
    const { frontmatter, body } = parseFrontmatter(rawContent);
    const rawChapterSlug = cFile.replace(/\.(mdx|md)$/, '');
    const chapterSlug = cleanSlug(rawChapterSlug);
    const legacySlug = rawChapterSlug !== chapterSlug ? rawChapterSlug : undefined;
    const chapterTitle = frontmatter.title || rawChapterSlug;
    const chapterHash = computeHash(rawContent);
    combinedHashData += chapterHash;

    try {
      const fileChunks = chunkMdx({ source: rawContent, modules: manifest.modules || {} });
      for (const fc of fileChunks) {
        if (fc.text && fc.text.length > 5) {
          allBookChunks.push({
            id: `${chapterSlug}-${fc.anchor || allBookChunks.length}`,
            chapterSlug,
            title: fc.title,
            type: fc.type || '正文',
            number: fc.number || '',
            text: fc.text,
            anchor: fc.anchor,
          });
        }
      }
    } catch {}

    const compiled = compileMarkdownToSemanticResult(body, {
      colSlug: manifest.colSlug,
      bookSlug: manifest.slug,
      bookTitle: manifest.title,
      chapterSlug,
      includeBuptExerciseBank: SUPPORTED_EXERCISE_SLUGS.has(manifest.slug),
    });
    const html = compiled.html;
    const headings = collectHeadingsFromHtml(html);

    const payload = {
      schemaVersion: ABP_SCHEMA_VERSION,
      bookId: manifest.id,
      bookSlug: manifest.slug,
      colSlug: manifest.colSlug,
      chapterSlug: chapterSlug,
      title: chapterTitle,
      html: html,
      headings: headings,
      ...(Object.keys(compiled.footnotes).length > 0 ? { footnotes: compiled.footnotes } : {}),
      updatedAt: manifest.updatedAt,
    };

    chapterPayloads[chapterSlug] = payload;

    const summary = {
      id: `ch-${chapterSlug}`,
      title: chapterTitle,
      slug: chapterSlug,
      sourcePath: cFile,
      path: `chapters/${chapterSlug}.json`,
      hash: chapterHash,
      sizeBytes: Buffer.byteLength(JSON.stringify(payload), 'utf8'),
    };
    if (legacySlug) {
      summary.legacySlug = legacySlug;
    }
    sectionChapters.push(summary);
  }

  manifest.sections = [
    {
      id: 'section-main',
      title: '全部章节',
      slug: 'main',
      collapsed: false,
      chapters: sectionChapters,
    },
  ];
  manifest.totalChapters = sectionChapters.length;
  manifest.contentHash = computeHash(combinedHashData);

  const imagesDir = path.join(resolvedDir, 'images');
  const assetBuffers = {};
  if (fs.existsSync(imagesDir)) {
    const imgFiles = fs.readdirSync(imagesDir);
    for (const imgName of imgFiles) {
      const imgPath = path.join(imagesDir, imgName);
      if (fs.statSync(imgPath).isFile()) {
        const relAssetPath = `images/${imgName}`;
        manifest.assets.push(relAssetPath);
        assetBuffers[relAssetPath] = fs.readFileSync(imgPath).toString('base64');
      }
    }
  }

  const bookOutDir = path.join(outDir, `${manifest.colSlug}-${manifest.slug}`);
  const chaptersOutDir = path.join(bookOutDir, 'chapters');
  if (fs.existsSync(chaptersOutDir)) {
    fs.rmSync(chaptersOutDir, { recursive: true, force: true });
  }
  fs.mkdirSync(chaptersOutDir, { recursive: true });

  fs.writeFileSync(path.join(bookOutDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  for (const [slug, payload] of Object.entries(chapterPayloads)) {
    const chapJsonFile = path.join(chaptersOutDir, `${slug}.json`);
    fs.mkdirSync(path.dirname(chapJsonFile), { recursive: true });
    fs.writeFileSync(chapJsonFile, JSON.stringify(payload, null, 2), 'utf8');
  }

  if (Object.keys(assetBuffers).length > 0) {
    const assetsOutDir = path.join(bookOutDir, 'images');
    fs.mkdirSync(assetsOutDir, { recursive: true });
    for (const [relPath, base64Data] of Object.entries(assetBuffers)) {
      const fileName = path.basename(relPath);
      fs.writeFileSync(path.join(assetsOutDir, fileName), Buffer.from(base64Data, 'base64'));
    }
  }

  let embeddingAsset = null;
  if (withVectors && allBookChunks.length > 0) {
    try {
      process.stdout.write(`   - 正在向量化 ${allBookChunks.length} 个知识切片 (BGE-small-zh-v1.5 / ${vectorFormat})... `);
      const pipe = await getEmbeddingPipeline();
      const vectors = [];
      for (const c of allBookChunks) {
        const textToEncode = `${c.title}。${c.text.slice(0, 300)}`;
        const out = await pipe(textToEncode, { pooling: 'cls', normalize: true });
        vectors.push(new Float32Array(out.data));
      }

      const { buffer: vecBuf, dim, count } = serializeEmbeddingsBinary(vectors, vectorFormat);
      const binBuffer = Buffer.from(vecBuf);
      fs.writeFileSync(path.join(bookOutDir, 'embeddings.bin'), binBuffer);

      const metaJson = {
        model: 'Xenova/bge-small-zh-v1.5',
        dim,
        format: vectorFormat,
        count,
        chunks: allBookChunks,
        generatedAt: new Date().toISOString(),
      };
      fs.writeFileSync(path.join(bookOutDir, 'embeddings.meta.json'), JSON.stringify(metaJson, null, 2), 'utf8');

      manifest.hasEmbeddings = true;
      manifest.embeddingMeta = {
        model: 'Xenova/bge-small-zh-v1.5',
        dim,
        format: vectorFormat,
        vectorCount: count,
        generatedAt: metaJson.generatedAt,
      };
      fs.writeFileSync(path.join(bookOutDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

      embeddingAsset = {
        binaryBase64: binBuffer.toString('base64'),
        meta: metaJson,
      };
      console.log(`✔ 完成 (${(binBuffer.length / 1024).toFixed(1)} KB)`);
    } catch (e) {
      console.log(`⚠️ 向量化跳过: ${e.message}`);
    }
  }

  let aiIndex = null;
  let crossRefs = null;
  let exercisesBundle = null;

  if (includeAuxiliary) {
    try {
      aiIndex = buildBookIndex({
        colSlug: manifest.colSlug,
        bookSlug: manifest.slug,
        bookDir: resolvedDir,
        modules: manifest.modules || {},
        title: manifest.title,
      });
      fs.writeFileSync(path.join(bookOutDir, 'ai-index.json'), JSON.stringify(aiIndex), 'utf8');
    } catch (e) {
      console.warn(`   ⚠️ AI 索引生成跳过: ${e.message}`);
    }

    try {
      crossRefs = buildGlobalBlockIndex(manifest.colSlug, manifest.slug);
      if (crossRefs && Object.keys(crossRefs).length > 0) {
        fs.writeFileSync(path.join(bookOutDir, 'cross-refs.json'), JSON.stringify(crossRefs), 'utf8');
      }
    } catch (e) {
      console.warn(`   ⚠️ 跨页引用生成跳过: ${e.message}`);
    }

    const primaryExDir = path.join(ROOT, 'artifacts', 'exercises', manifest.slug);
    const legacyExDir = path.join(ROOT, 'public', 'data', 'exercises', manifest.slug);
    let exSrcDir = fs.existsSync(primaryExDir) ? primaryExDir : null;
    if (!exSrcDir && fs.existsSync(legacyExDir)) {
      console.warn(`   ⚠️ [DEPRECATED] 正在回退读取旧路径 ${path.relative(ROOT, legacyExDir)}，请改用 npm run build:exercises 生成 artifacts/exercises/`);
      exSrcDir = legacyExDir;
    }
    if (!exSrcDir && SUPPORTED_EXERCISE_SLUGS.has(manifest.slug)) {
      console.log(`   ℹ️ 题库切片缺失，正在自动构建: node scripts/build-exercise-data.mjs...`);
      try {
        const { execSync } = await import('node:child_process');
        execSync(`node "${path.join(ROOT, 'scripts', 'build-exercise-data.mjs')}"`, { stdio: 'inherit' });
        if (fs.existsSync(primaryExDir)) {
          exSrcDir = primaryExDir;
        }
      } catch (err) {
        console.warn(`   ⚠️ 自动编译题库失败: ${err.message}`);
      }
    }

    if (exSrcDir) {
      const exMap = {};
      const collectEx = (dir) => {
        for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, ent.name);
          if (ent.isDirectory()) collectEx(full);
          else if (ent.isFile() && ent.name.endsWith('.json')) {
            const rel = path.relative(exSrcDir, full).replace(/\\/g, '/');
            const content = fs.readFileSync(full, 'utf8');
            exMap[rel] = content;
            const dest = path.join(bookOutDir, 'exercises', rel);
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.writeFileSync(dest, content, 'utf8');
          }
        }
      };
      collectEx(exSrcDir);
      if (Object.keys(exMap).length > 0) {
        exercisesBundle = exMap;
      } else if (SUPPORTED_EXERCISE_SLUGS.has(manifest.slug)) {
        throw new Error(`支持题库的书籍 ${manifest.id} 在 ${exSrcDir} 下未找到任何 .json 题库切片`);
      }
    } else if (SUPPORTED_EXERCISE_SLUGS.has(manifest.slug)) {
      throw new Error(`支持题库的书籍 ${manifest.id} 缺少已编译题库目录: ${primaryExDir}，请先执行 npm run build:exercises`);
    } else {
      console.log(`   ℹ️ 题库状态 [unsupported]: ${manifest.id} 在 src/data/exercises/ 中无结构化题库，保持 exercises=null`);
    }
  }

  const fullBundle = {
    manifest,
    chapters: chapterPayloads,
    assets: assetBuffers,
    embeddings: embeddingAsset,
    aiIndex,
    crossRefs,
    exercises: exercisesBundle,
  };
  const bundleJson = JSON.stringify(fullBundle);
  const abpBuffer = zlib.gzipSync(Buffer.from(bundleJson, 'utf8'), { level: 9 });
  const abpPath = path.join(outDir, `${manifest.colSlug}-${manifest.slug}.abp`);
  const abpTmpPath = `${abpPath}.tmp.${process.pid}`;
  fs.writeFileSync(abpTmpPath, abpBuffer);
  fs.renameSync(abpTmpPath, abpPath);

  const abpSizeMb = (abpBuffer.length / (1024 * 1024)).toFixed(2);
  console.log(`\n✅ 成功编译图书包: [${manifest.title}] (${manifest.id})`);
  console.log(`   - 章节总数: ${manifest.totalChapters} 篇`);
  console.log(`   - 散列目录: ${bookOutDir}`);
  console.log(`   - 单文件包: ${abpPath} (${abpSizeMb} MB)`);

  updateCatalogJson(outDir, manifest, `${manifest.colSlug}-${manifest.slug}.abp`, abpBuffer.length, {
    releaseRepo,
    releaseTag,
  });

  return {
    manifest,
    abpPath,
    bookOutDir,
    sizeBytes: abpBuffer.length,
  };
}

export function updateCatalogJson(outDir, manifest, packFileName, sizeBytes, releaseOpts = {}) {
  const catalogPath = path.join(outDir, 'catalog.json');
  const releaseRepo = normalizeReleaseRepo(releaseOpts.releaseRepo || DEFAULT_DESKTOP_RELEASE_REPO);
  const releaseTag = String(releaseOpts.releaseTag || '').trim() || undefined;
  let catalog = {
    schemaVersion: ABP_SCHEMA_VERSION,
    catalogName: 'AstroLib Book Catalog',
    releaseRepo,
    ...(releaseTag ? { releaseTag } : {}),
    sourceUrl: buildReleaseCatalogUrl(releaseRepo, releaseTag),
    generatedBy: 'scripts/pack-book-abp.mjs',
    sourceInput: 'src/config/collections.config.ts#sourceCollections',
    generatedAt: new Date().toISOString(),
    books: [],
  };

  if (fs.existsSync(catalogPath)) {
    try {
      catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
      if (!Array.isArray(catalog.books)) catalog.books = [];
    } catch {}
  }

  const existingIdx = catalog.books.findIndex((b) => b.id === manifest.id);
  const entry = {
    id: manifest.id,
    slug: manifest.slug,
    colSlug: manifest.colSlug,
    title: manifest.title,
    author: manifest.author,
    edition: manifest.edition,
    category: manifest.category,
    subject: manifest.subject,
    description: manifest.description,
    cover: manifest.cover,
    entryPoint: manifest.entryPoint,
    totalChapters: manifest.totalChapters,
    sizeBytes: sizeBytes,
    packFileName: packFileName,
    remotePackUrl: buildReleasePackUrl(packFileName, releaseRepo, releaseTag),
    contentHash: manifest.contentHash,
    updatedAt: manifest.updatedAt,
  };

  if (existingIdx >= 0) {
    catalog.books[existingIdx] = entry;
  } else {
    catalog.books.push(entry);
  }

  catalog.schemaVersion = ABP_SCHEMA_VERSION;
  catalog.releaseRepo = releaseRepo;
  if (releaseTag) {
    catalog.releaseTag = releaseTag;
  } else {
    delete catalog.releaseTag;
  }
  catalog.sourceUrl = buildReleaseCatalogUrl(releaseRepo, releaseTag);
  catalog.generatedBy = 'scripts/pack-book-abp.mjs';
  catalog.sourceInput = 'src/config/collections.config.ts#sourceCollections';
  catalog.generatedAt = new Date().toISOString();
  const payload = JSON.stringify(catalog, null, 2);
  const tmpPath = `${catalogPath}.tmp.${process.pid}`;
  fs.writeFileSync(tmpPath, payload, 'utf8');
  fs.renameSync(tmpPath, catalogPath);
}

if (process.argv[1] && process.argv[1].endsWith('pack-book-abp.mjs')) {
  const args = process.argv.slice(2);
  const outArg = args.find((a) => a.startsWith('--out='))?.slice('--out='.length);
  const releaseRepoArg = args.find((a) => a.startsWith('--release-repo='))?.slice('--release-repo='.length);
  const releaseTagArg = args.find((a) => a.startsWith('--release-tag='))?.slice('--release-tag='.length);
  const releaseRepo = normalizeReleaseRepo(releaseRepoArg || DEFAULT_DESKTOP_RELEASE_REPO);
  const releaseTag = (releaseTagArg || process.env.ASTROLIB_RELEASE_TAG || '').trim();
  const outDir = outArg ? path.resolve(ROOT, outArg) : resolveAbpArtifactsDir(ROOT);
  fs.mkdirSync(outDir, { recursive: true });

  async function run() {
    const withVectors = !args.includes('--no-vectors');
    const includeAuxiliary = !args.includes('--no-auxiliary');
    const vectorFormat = args.includes('--format=float32') ? 'float32' : 'int8';

    if (args.includes('--all')) {
      console.log('📦 正在依据 SSOT 目录批量编译全站书籍为自包含 ABP 内容包...\n');
      const allBooks = [];
      for (const col of getCatalogCollections()) {
        for (const book of col.books || []) {
          const bookDir = resolveBookSourceDir(col.slug, book.slug, ROOT);
          if (!fs.existsSync(bookDir)) {
            throw new Error(`SSOT 目录书目源码缺失: ${bookDir}`);
          }
          allBooks.push({
            bookDir,
            title: `${col.slug}/${book.slug}`,
            id: `${col.slug}-${book.slug}`,
          });
        }
      }

      if (allBooks.length === 0) {
        throw new Error('SSOT 目录中没有任何可打包的书目！');
      }

      for (const b of allBooks) {
        console.log(`⏳ 正在打包: ${b.title}...`);
        await packBook({
          bookDir: b.bookDir,
          outDir,
          withVectors,
          vectorFormat,
          includeAuxiliary,
          releaseRepo,
          releaseTag,
        });
      }

      const generatedCatalog = path.join(outDir, 'catalog.json');
      if (fs.existsSync(generatedCatalog)) {
        fs.copyFileSync(generatedCatalog, path.join(ROOT, CONTENT_CATALOG_REL));
      }

      console.log(`\n🎉 全站 ${allBooks.length} 本书籍已全部打包完成！`);
      console.log(`   - 产物目录: ${outDir}`);
      console.log(`   - 目录投影: ${path.join(ROOT, CONTENT_CATALOG_REL)}`);
    } else {
      const defaultDir = path.join('content-sources', 'collections', 'math', 'math_senior');
      const targetDir = args.find((a) => !a.startsWith('--')) || defaultDir;
      await packBook({
        bookDir: path.resolve(ROOT, targetDir),
        outDir,
        withVectors,
        vectorFormat,
        includeAuxiliary,
        releaseRepo,
        releaseTag,
      });
    }
  }

  run().catch((err) => {
    console.error('❌ 打包失败:', err);
    process.exit(1);
  });
}
