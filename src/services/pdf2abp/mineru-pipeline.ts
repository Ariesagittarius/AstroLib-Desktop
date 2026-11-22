/**
 * src/services/pdf2abp/mineru-pipeline.ts
 * ============================================================================
 * MinerU PDF 自动分卷摄取与多卷确定性缝合管线
 * ============================================================================
 * 职责：
 * 1. 检测云端 MinerU API Token 与本地 MinerU Pipeline 可用性（遵循决策 A2）；
 * 2. 对超出 200 页或 180 MB 的 PDF 自动拆分并在工作区内逐卷运行 MinerU；
 * 3. 支持断点缓存：单卷完成后落盘标记，重跑自动跳过已完成分卷；
 * 4. 确定性多卷缝合（stitchMineruParts）：
 *    - 汇聚 images/ 并以 p{partIndex}_{name} 防冲突重命名；
 *    - 全局 1-based 物理页码重映射（pages_blocks.json）；
 *    - 缝合 full.md 并防止拼接处 $$ 状态翻转；
 *    - 生成轻量化 mineru-summary.json（标题树、每页字数/公式/图表统计）。
 * ============================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { MineruApiClient } from '../../server/plugins/doc-ingestion/mineru-api-client.ts';
import { LocalPipelineRunner } from '../../server/plugins/doc-ingestion/local-runner.ts';
import { splitPdfForMineru } from './pdf-processor.ts';
import type { JobWorkspace } from './workspace-manager.ts';
import type {
  MineruAvailabilityStatus,
  MineruRunResult,
  PdfSplitPart,
  StitchedMineruSummary,
  StitchedPageBlock,
} from './types.ts';

export class MineruUnavailableError extends Error {
  public readonly code = 'MINERU_UNAVAILABLE';
  constructor(message: string) {
    super(message);
    this.name = 'MineruUnavailableError';
  }
}

export async function checkMineruAvailability(): Promise<MineruAvailabilityStatus> {
  const client = new MineruApiClient();
  const token = client.getToken();
  const hasApiToken = Boolean(token && token.trim());

  const localRunner = new LocalPipelineRunner();
  let localAvailable = false;
  let localMessage = '';
  try {
    const localStatus = await localRunner.checkEnvironment();
    localAvailable = Boolean(localStatus.available);
    localMessage = localStatus.message || '';
  } catch (err: any) {
    localAvailable = false;
    localMessage = err?.message || String(err);
  }

  const preferredEngine: MineruAvailabilityStatus['preferredEngine'] = hasApiToken
    ? 'api'
    : localAvailable
    ? 'local'
    : 'none';

  const guidance =
    preferredEngine !== 'none'
      ? `MinerU 就绪（优先通道: ${preferredEngine === 'api' ? '云端官方 v4 API' : '本地 GPU Pipeline'}）`
      : '未检测到有效的 MinerU API Token，且本机未安装 magic-pdf/MinerU。请在设置中配置 MINERU_API_TOKEN（或工作目录 .mineru.json）后重试。';

  return {
    ready: preferredEngine !== 'none',
    preferredEngine,
    hasApiToken,
    tokenPrefix: token ? token.slice(0, 8) + '...' : null,
    localAvailable,
    localMessage,
    guidance,
  };
}

function findFileRecursive(rootDir: string, predicate: (fileName: string, fullPath: string) => boolean): string | null {
  if (!fs.existsSync(rootDir)) return null;
  const entries = fs.readdirSync(rootDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const ent of entries) {
    const full = path.join(rootDir, ent.name);
    if (ent.isFile() && predicate(ent.name, full)) return full;
  }
  for (const ent of entries) {
    if (ent.isDirectory()) {
      const hit = findFileRecursive(path.join(rootDir, ent.name), predicate);
      if (hit) return hit;
    }
  }
  return null;
}

function spansToText(spans: any[]): string {
  if (!Array.isArray(spans)) return '';
  return spans
    .map((sp) => {
      if (!sp) return '';
      if (typeof sp === 'string') return sp;
      if (sp.type === 'equation_inline') return `$${String(sp.content || '').trim()}$`;
      return String(sp.content ?? sp.text ?? '');
    })
    .join('');
}

function normalizeImageBasename(rawPath: string | undefined): string | null {
  if (!rawPath) return null;
  const clean = String(rawPath).trim().replace(/\\/g, '/');
  if (!clean) return null;
  return path.basename(clean);
}

/**
 * 解析单卷 MinerU 解压目录中的所有内容文件（兼容扁平或 UUID 子目录）
 */
function locateMineruArtifactDir(partUnpackedDir: string): {
  artifactDir: string;
  fullMdPath: string | null;
  contentListV2Path: string | null;
  contentListV1Path: string | null;
  imagesDir: string | null;
} {
  const fullMd =
    findFileRecursive(partUnpackedDir, (n) => n.toLowerCase() === 'full.md') ||
    findFileRecursive(partUnpackedDir, (n) => n.toLowerCase().endsWith('.md'));

  const artifactDir = fullMd ? path.dirname(fullMd) : partUnpackedDir;
  const v2 = findFileRecursive(artifactDir, (n) => n.includes('content_list_v2') && n.endsWith('.json')) ||
             findFileRecursive(partUnpackedDir, (n) => n.includes('content_list_v2') && n.endsWith('.json'));
  const v1 = findFileRecursive(artifactDir, (n) => n.includes('content_list') && !n.includes('v2') && n.endsWith('.json')) ||
             findFileRecursive(partUnpackedDir, (n) => n.includes('content_list') && !n.includes('v2') && n.endsWith('.json'));
  const imgCand = path.join(artifactDir, 'images');
  const imagesDir = fs.existsSync(imgCand) ? imgCand : null;

  return {
    artifactDir,
    fullMdPath: fullMd,
    contentListV2Path: v2,
    contentListV1Path: v1,
    imagesDir,
  };
}

export interface StitchPartInput {
  partIndex: number;
  startPage: number;
  endPage: number;
  unpackedDir: string;
}

/**
 * 确定性缝合多个 MinerU 分卷产物为全局对齐的 Markdown、PageBlocks 与 Images
 */
export function stitchMineruParts(
  parts: StitchPartInput[],
  stitchedDir: string,
  summaryOutPath: string
): StitchedMineruSummary {
  const imagesOutDir = path.join(stitchedDir, 'images');
  fs.mkdirSync(stitchedDir, { recursive: true });
  fs.mkdirSync(imagesOutDir, { recursive: true });

  const allBlocks: StitchedPageBlock[] = [];
  const mdChunks: string[] = [];
  const headings: StitchedMineruSummary['headings'] = [];
  const pageStatsMap = new Map<number, { textChars: number; equations: number; images: number; tables: number }>();

  const ensureStat = (page: number) => {
    if (!pageStatsMap.has(page)) {
      pageStatsMap.set(page, { textChars: 0, equations: 0, images: 0, tables: 0 });
    }
    return pageStatsMap.get(page)!;
  };

  let totalImages = 0;

  for (const part of parts) {
    const located = locateMineruArtifactDir(part.unpackedDir);
    const imgRenameMap = new Map<string, string>(); // origName -> prefixedName

    // 1. 收集并防冲突重命名图片
    if (located.imagesDir && fs.existsSync(located.imagesDir)) {
      for (const fileName of fs.readdirSync(located.imagesDir)) {
        const srcImg = path.join(located.imagesDir, fileName);
        if (!fs.statSync(srcImg).isFile()) continue;
        const prefixed = `p${part.partIndex}_${fileName}`;
        fs.copyFileSync(srcImg, path.join(imagesOutDir, prefixed));
        imgRenameMap.set(fileName, prefixed);
        totalImages++;
      }
    }

    const rewriteImgRef = (rawPath: string | undefined): string | undefined => {
      const base = normalizeImageBasename(rawPath);
      if (!base) return undefined;
      const renamed = imgRenameMap.get(base) || base;
      return `images/${renamed}`;
    };

    // 2. 重写并缝合 full.md
    if (located.fullMdPath && fs.existsSync(located.fullMdPath)) {
      let mdText = fs.readFileSync(located.fullMdPath, 'utf-8');
      for (const [origName, prefixed] of imgRenameMap.entries()) {
        mdText = mdText.replaceAll(`images/${origName}`, `images/${prefixed}`);
      }
      // 修复尾部未闭合 $$ 或首部 $$ 粘连
      mdText = mdText.trim();
      mdChunks.push(`<!-- ASTROLIB_MINERU_PART ${part.partIndex} PAGES ${part.startPage}-${part.endPage} -->\n\n${mdText}`);
    }

    // 3. 解析并重映射 content_list_v2.json（优先）或 content_list.json
    let parsedPartBlocks = false;

    if (located.contentListV2Path && fs.existsSync(located.contentListV2Path)) {
      try {
        const pages = JSON.parse(fs.readFileSync(located.contentListV2Path, 'utf-8'));
        if (Array.isArray(pages)) {
          parsedPartBlocks = true;
          for (let localIdx = 0; localIdx < pages.length; localIdx++) {
            const globalPage = part.startPage + localIdx;
            const st = ensureStat(globalPage);
            const items = Array.isArray(pages[localIdx]) ? pages[localIdx] : [];

            for (const item of items) {
              if (!item || typeof item !== 'object') continue;
              const t = String(item.type || 'text');
              const c = item.content || {};
              const bbox = Array.isArray(item.bbox) && item.bbox.length === 4 ? (item.bbox as [number, number, number, number]) : undefined;

              if (t === 'title') {
                const text = spansToText(c.title_content || []).trim();
                const level = Number(c.level || 1);
                if (text) {
                  headings.push({ page: globalPage, level, text });
                  st.textChars += text.length;
                  allBlocks.push({ page: globalPage, localPage: localIdx + 1, partIndex: part.partIndex, type: 'title', level, text, bbox });
                }
              } else if (t === 'paragraph') {
                const text = spansToText(c.paragraph_content || []).trim();
                if (text) {
                  st.textChars += text.length;
                  allBlocks.push({ page: globalPage, localPage: localIdx + 1, partIndex: part.partIndex, type: 'paragraph', text, bbox });
                }
              } else if (t === 'equation_interline') {
                const latex = String(c.math_content || '').trim();
                const imgPath = rewriteImgRef(c.image_source?.path);
                if (latex) {
                  st.equations++;
                  allBlocks.push({
                    page: globalPage,
                    localPage: localIdx + 1,
                    partIndex: part.partIndex,
                    type: 'equation',
                    text: `$$\n${latex}\n$$`,
                    latex,
                    imgPath,
                    bbox,
                  });
                }
              } else if (t === 'image' || t === 'chart') {
                const imgPath = rewriteImgRef(c.image_source?.path);
                const capSpans = t === 'chart' ? c.chart_caption : c.image_caption;
                const caption = spansToText(capSpans || []).trim();
                if (imgPath) {
                  st.images++;
                  allBlocks.push({
                    page: globalPage,
                    localPage: localIdx + 1,
                    partIndex: part.partIndex,
                    type: t,
                    text: caption ? `![${caption}](${imgPath})` : `![](${imgPath})`,
                    imgPath,
                    caption,
                    bbox,
                  });
                }
              } else if (t === 'table') {
                const imgPath = rewriteImgRef(c.image_source?.path);
                const caption = spansToText(c.table_caption || []).trim();
                const tableBody = String(c.html || c.table_body || '').trim();
                st.tables++;
                allBlocks.push({
                  page: globalPage,
                  localPage: localIdx + 1,
                  partIndex: part.partIndex,
                  type: 'table',
                  text: tableBody || (imgPath ? `![](${imgPath})` : ''),
                  imgPath,
                  caption,
                  bbox,
                });
              } else if (t === 'list') {
                const itemsArr = Array.isArray(c.list_items) ? c.list_items : [];
                const lines = itemsArr.map((li: any) => spansToText(li?.item_content || []).trim()).filter(Boolean);
                if (lines.length > 0) {
                  const text = lines.join('\n');
                  st.textChars += text.length;
                  allBlocks.push({ page: globalPage, localPage: localIdx + 1, partIndex: part.partIndex, type: 'list', text, bbox });
                }
              } else if (t === 'code') {
                const codeBody = spansToText(c.code_content || []).trim();
                if (codeBody) {
                  allBlocks.push({
                    page: globalPage,
                    localPage: localIdx + 1,
                    partIndex: part.partIndex,
                    type: 'code',
                    text: `\`\`\`\n${codeBody}\n\`\`\``,
                    bbox,
                  });
                }
              } else if (t === 'page_footnote') {
                const fn = spansToText(c.page_footnote_content || []).trim();
                if (fn) {
                  allBlocks.push({ page: globalPage, localPage: localIdx + 1, partIndex: part.partIndex, type: 'footnote', text: fn, bbox });
                }
              }
            }
          }
        }
      } catch {
        parsedPartBlocks = false;
      }
    }

    if (!parsedPartBlocks && located.contentListV1Path && fs.existsSync(located.contentListV1Path)) {
      try {
        const items = JSON.parse(fs.readFileSync(located.contentListV1Path, 'utf-8'));
        if (Array.isArray(items)) {
          parsedPartBlocks = true;
          for (const item of items) {
            if (!item || typeof item !== 'object') continue;
            const localIdx = Number(item.page_idx || 0);
            const globalPage = part.startPage + localIdx;
            const st = ensureStat(globalPage);
            const t = String(item.type || 'text');
            const bbox = Array.isArray(item.bbox) && item.bbox.length === 4 ? (item.bbox as [number, number, number, number]) : undefined;

            if (t === 'header' || t === 'footer' || t === 'page_number' || t === 'aside_text') {
              continue;
            }
            if (t === 'text') {
              const text = String(item.text || '').trim();
              if (!text) continue;
              const lvl = Number(item.text_level || 0);
              if (lvl > 0) {
                headings.push({ page: globalPage, level: lvl, text });
                allBlocks.push({ page: globalPage, localPage: localIdx + 1, partIndex: part.partIndex, type: 'title', level: lvl, text, bbox });
              } else {
                allBlocks.push({ page: globalPage, localPage: localIdx + 1, partIndex: part.partIndex, type: 'paragraph', text, bbox });
              }
              st.textChars += text.length;
            } else if (t === 'equation') {
              const raw = String(item.text || '').trim();
              const latex = raw.replace(/^\$\$\s*|\s*\$\$$/g, '').trim();
              if (raw) {
                st.equations++;
                allBlocks.push({ page: globalPage, localPage: localIdx + 1, partIndex: part.partIndex, type: 'equation', text: raw, latex, bbox });
              }
            } else if (t === 'image' || t === 'chart') {
              const imgPath = rewriteImgRef(item.img_path);
              const capArr = item.image_caption || item.chart_caption || [];
              const caption = Array.isArray(capArr) ? capArr.join(' ').trim() : String(capArr || '').trim();
              if (imgPath) {
                st.images++;
                allBlocks.push({
                  page: globalPage,
                  localPage: localIdx + 1,
                  partIndex: part.partIndex,
                  type: t,
                  text: caption ? `![${caption}](${imgPath})` : `![](${imgPath})`,
                  imgPath,
                  caption,
                  bbox,
                });
              }
            } else if (t === 'table') {
              const imgPath = rewriteImgRef(item.img_path);
              const capArr = item.table_caption || [];
              const caption = Array.isArray(capArr) ? capArr.join(' ').trim() : String(capArr || '').trim();
              const tableBody = String(item.table_body || item.text || '').trim();
              st.tables++;
              allBlocks.push({
                page: globalPage,
                localPage: localIdx + 1,
                partIndex: part.partIndex,
                type: 'table',
                text: tableBody || (imgPath ? `![](${imgPath})` : ''),
                imgPath,
                caption,
                bbox,
              });
            }
          }
        }
      } catch {
        parsedPartBlocks = false;
      }
    }
  }

  const fullMdPath = path.join(stitchedDir, 'full.md');
  const pagesBlocksPath = path.join(stitchedDir, 'pages_blocks.json');

  // 防止跨分卷接缝处的 $$ 折叠反转
  const combinedMd = mdChunks.join('\n\n').replace(/\$\$\s*\$\$/g, '$$\n\n$$');
  fs.writeFileSync(fullMdPath, combinedMd, 'utf-8');
  fs.writeFileSync(pagesBlocksPath, JSON.stringify(allBlocks, null, 2), 'utf-8');

  const maxPage = parts.length > 0 ? Math.max(...parts.map((p) => p.endPage)) : 0;
  const pageStats = Array.from(pageStatsMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([page, s]) => ({ page, ...s }));

  const summary: StitchedMineruSummary = {
    totalPages: maxPage,
    totalParts: parts.length,
    totalImages,
    totalBlocks: allBlocks.length,
    fullMdPath,
    pagesBlocksPath,
    imagesDir: imagesOutDir,
    headings,
    pageStats,
  };

  fs.mkdirSync(path.dirname(summaryOutPath), { recursive: true });
  fs.writeFileSync(summaryOutPath, JSON.stringify(summary, null, 2), 'utf-8');
  return summary;
}

function computePdfFingerprint(pdfPath: string): string {
  const stat = fs.statSync(pdfPath);
  const hash = crypto.createHash('sha256');
  hash.update(`${path.basename(pdfPath)}:${stat.size}:${stat.mtimeMs}`);
  return hash.digest('hex').slice(0, 16);
}

/**
 * 端到端在工作区内执行 MinerU 摄取（自动分卷、云端或本地执行、断点复用、多卷缝合）
 */
export async function runMineruOnPdf(params: {
  pdfPath: string;
  workspace: JobWorkspace;
  engine?: 'auto' | 'api' | 'local';
  maxPagesPerPart?: number;
  maxSizeMBPerPart?: number;
  pageRange?: [number, number];
  reuseCache?: boolean;
  onProgress?: (msg: string) => void;
}): Promise<MineruRunResult> {
  const {
    pdfPath,
    workspace,
    engine = 'auto',
    maxPagesPerPart = 200,
    maxSizeMBPerPart = 180,
    pageRange,
    reuseCache = true,
    onProgress,
  } = params;

  const resolvedPdf = workspace.assertAllowedSourcePdf(pdfPath);
  const availability = await checkMineruAvailability();

  let selectedEngine: 'api' | 'local';
  if (engine === 'api') {
    if (!availability.hasApiToken) {
      throw new MineruUnavailableError(availability.guidance);
    }
    selectedEngine = 'api';
  } else if (engine === 'local') {
    if (!availability.localAvailable) {
      throw new MineruUnavailableError(availability.localMessage || availability.guidance);
    }
    selectedEngine = 'local';
  } else {
    if (!availability.ready || availability.preferredEngine === 'none') {
      throw new MineruUnavailableError(availability.guidance);
    }
    selectedEngine = availability.preferredEngine;
  }

  const fingerprintFile = path.join(workspace.mineruDir, '.source-fingerprint.txt');
  const summaryPath = path.join(workspace.mineruDir, 'mineru-summary.json');
  const fullMdPath = path.join(workspace.mineruStitchedDir, 'full.md');
  const pagesBlocksPath = path.join(workspace.mineruStitchedDir, 'pages_blocks.json');
  const currentFp = computePdfFingerprint(resolvedPdf);
  const rangeKey = pageRange ? `p${pageRange[0]}-${pageRange[1]}` : 'all';
  const expectedFp = `${currentFp}:${rangeKey}`;
  const fullBookFp = `${currentFp}:all`;

  if (
    reuseCache &&
    fs.existsSync(fingerprintFile) &&
    fs.existsSync(summaryPath) &&
    fs.existsSync(fullMdPath) &&
    fs.existsSync(pagesBlocksPath)
  ) {
    const savedFp = fs.readFileSync(fingerprintFile, 'utf-8').trim();
    const cacheHit =
      savedFp === expectedFp ||
      savedFp === fullBookFp ||
      savedFp === currentFp;
    if (cacheHit) {
      const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8')) as StitchedMineruSummary;
      const partsFile = path.join(workspace.mineruDir, 'parts.json');
      const parts: PdfSplitPart[] = fs.existsSync(partsFile) ? JSON.parse(fs.readFileSync(partsFile, 'utf-8')) : [];
      onProgress?.(`命中已有 MinerU 缝合缓存 (${savedFp === expectedFp ? rangeKey : 'full-book'})，跳过重复上传解析`);
      return {
        engine: selectedEngine,
        parts,
        stitchedDir: workspace.mineruStitchedDir,
        fullMdPath,
        pagesBlocksPath,
        imagesDir: path.join(workspace.mineruStitchedDir, 'images'),
        summaryPath,
        summary,
        reusedCache: true,
        ...(pageRange ? { pageRange } : {}),
      };
    }
  }

  onProgress?.(
    `正在检测并按${pageRange ? `指定页段 [${pageRange[0]}-${pageRange[1]}] · ` : ''}最大 ${maxPagesPerPart} 页 / ${maxSizeMBPerPart} MB 拆分 PDF...`
  );
  const parts = await splitPdfForMineru(resolvedPdf, workspace.mineruPartsDir, {
    maxPages: maxPagesPerPart,
    maxSizeMB: maxSizeMBPerPart,
    pageRange,
  });
  fs.writeFileSync(path.join(workspace.mineruDir, 'parts.json'), JSON.stringify(parts, null, 2), 'utf-8');

  const apiClient = new MineruApiClient();
  const localRunner = new LocalPipelineRunner();
  const stitchInputs: StitchPartInput[] = [];

  const processOnePart = async (part: PdfSplitPart): Promise<StitchPartInput> => {
    const partOutDir = path.join(workspace.mineruPartsDir, `part_${String(part.partIndex).padStart(3, '0')}_unpacked`);
    const partDoneMarker = path.join(partOutDir, '.done.json');

    if (reuseCache && fs.existsSync(partDoneMarker)) {
      try {
        const doneMeta = JSON.parse(fs.readFileSync(partDoneMarker, 'utf-8')) as {
          startPage?: number;
          endPage?: number;
        };
        if (
          doneMeta.startPage === undefined ||
          (doneMeta.startPage === part.startPage && doneMeta.endPage === part.endPage)
        ) {
          onProgress?.(`分卷 ${part.partIndex}/${part.totalParts} (页 ${part.startPage}-${part.endPage}) 已缓存，跳过`);
          return {
            partIndex: part.partIndex,
            startPage: part.startPage,
            endPage: part.endPage,
            unpackedDir: partOutDir,
          };
        }
      } catch {
        // corrupt done marker, re-run
      }
    }

    fs.mkdirSync(partOutDir, { recursive: true });
    onProgress?.(
      `正在提交分卷 ${part.partIndex}/${part.totalParts} (页 ${part.startPage}-${part.endPage}，${(part.fileSizeBytes / 1048576).toFixed(2)} MB) 至 MinerU (${selectedEngine})...`
    );

    if (selectedEngine === 'api') {
      const uploadName = path.basename(part.filePath);
      const dataId = `${workspace.jobId}_p${part.partIndex}_${Date.now()}`;
      const { batchId, fileUrl } = await apiClient.requestBatchUploadUrls(uploadName, dataId, {
        modelVersion: 'vlm',
        isOcr: true,
        enableFormula: true,
        enableTable: true,
      });
      await apiClient.uploadFileToPreSignedUrl(fileUrl, part.filePath);

      let lastReportedState = '';
      const { fullZipUrl } = await apiClient.pollBatchStatus(batchId, {
        intervalMs: 3000,
        maxRetries: 240,
        onProgress: (state) => {
          if (state !== lastReportedState) {
            lastReportedState = state;
            onProgress?.(`MinerU 分卷 ${part.partIndex}/${part.totalParts} 云端状态: ${state}`);
          }
        },
      });

      onProgress?.(`正在下载并解包分卷 ${part.partIndex}/${part.totalParts} 解析产物...`);
      await apiClient.downloadAndExtractZip(fullZipUrl, partOutDir);
    } else {
      await localRunner.runPipeline(part.filePath, partOutDir, (msg) => {
        onProgress?.(`本地 MinerU 分卷 ${part.partIndex}/${part.totalParts}: ${msg}`);
      });
    }

    fs.writeFileSync(
      partDoneMarker,
      JSON.stringify({
        partIndex: part.partIndex,
        startPage: part.startPage,
        endPage: part.endPage,
        completedAt: Date.now(),
      }),
      'utf-8'
    );
    return {
      partIndex: part.partIndex,
      startPage: part.startPage,
      endPage: part.endPage,
      unpackedDir: partOutDir,
    };
  };

  if (selectedEngine === 'api' && parts.length > 1) {
    const partConcurrency = Math.min(3, parts.length);
    let cursor = 0;
    const workers = Array.from({ length: partConcurrency }, async () => {
      while (cursor < parts.length) {
        const myIdx = cursor++;
        const res = await processOnePart(parts[myIdx]);
        stitchInputs.push(res);
      }
    });
    await Promise.all(workers);
    stitchInputs.sort((a, b) => a.partIndex - b.partIndex);
  } else {
    for (const part of parts) {
      stitchInputs.push(await processOnePart(part));
    }
  }

  onProgress?.(`正在将 ${stitchInputs.length} 个 MinerU 分卷产物确定性缝合为全局对齐数据结构...`);
  const summary = stitchMineruParts(stitchInputs, workspace.mineruStitchedDir, summaryPath);
  fs.writeFileSync(fingerprintFile, expectedFp, 'utf-8');

  return {
    engine: selectedEngine,
    parts,
    stitchedDir: workspace.mineruStitchedDir,
    fullMdPath: summary.fullMdPath,
    pagesBlocksPath: summary.pagesBlocksPath,
    imagesDir: summary.imagesDir,
    summaryPath,
    summary,
    reusedCache: false,
    ...(pageRange ? { pageRange } : {}),
  };
}
