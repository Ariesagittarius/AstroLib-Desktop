/**
 * src/services/pdf2abp/pdf-processor.ts
 * ============================================================================
 * 零 Python 依赖跨平台 PDF 处理引擎 (基于官方 mupdf WASM + sharp)
 * ============================================================================
 * 职责：
 * 1. PDF 体检与原生书签大纲提取 (inspectPdf)；
 * 2. 自动按照最大页数 (≤200) 与体积上限 (≤180MB) 物理拆分 PDF (splitPdfForMineru)；
 * 3. 按需缓存渲染单页高 DPI JPEG (renderPdfPages)；
 * 4. 拼合 2×2 总览拼图 / 2-up 对开双页图 (renderContactSheet)，突破网关单图限制；
 * 5. 精确裁剪封面或漏切插图 (cropPdfRegion)。
 * ============================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as mupdf from 'mupdf';
import sharp from 'sharp';
import type {
  ContactSheetResult,
  ContactSheetTile,
  PdfInspectResult,
  PdfOutlineItem,
  PdfSplitPart,
  RenderedPageInfo,
} from './types.ts';

function padNum(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

function flattenMupdfOutline(items: any[] | null | undefined, level: number = 1, out: PdfOutlineItem[] = []): PdfOutlineItem[] {
  if (!Array.isArray(items)) return out;
  for (const item of items) {
    if (!item) continue;
    const rawPage = typeof item.page === 'number' ? item.page : -1;
    let page = rawPage >= 0 ? rawPage + 1 : 1;
    if (rawPage < 0 && typeof item.uri === 'string') {
      const m = item.uri.match(/#page=(\d+)/i);
      if (m) page = Math.max(1, parseInt(m[1], 10));
    }
    if (item.title) {
      out.push({
        level,
        title: String(item.title).trim(),
        page,
      });
    }
    if (Array.isArray(item.down) && item.down.length > 0) {
      flattenMupdfOutline(item.down, level + 1, out);
    }
  }
  return out;
}

function openPdfDocument(pdfPath: string) {
  const resolved = path.resolve(pdfPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`PDF 文件不存在: ${resolved}`);
  }
  const buf = fs.readFileSync(resolved);
  const doc = mupdf.Document.openDocument(buf, 'application/pdf');
  return { doc, buf, resolved };
}

/**
 * 读取 PDF 元数据、总页数、书签大纲与文字层密度抽样
 */
export async function inspectPdf(pdfPath: string): Promise<PdfInspectResult> {
  const { doc, buf, resolved } = openPdfDocument(pdfPath);
  const pageCount = doc.countPages();
  const fileSizeBytes = buf.byteLength;

  let outline: PdfOutlineItem[] = [];
  try {
    outline = flattenMupdfOutline(doc.loadOutline(), 1, []);
  } catch {
    outline = [];
  }

  const sampleIndices = new Set<number>();
  if (pageCount > 0) {
    sampleIndices.add(0);
    if (pageCount > 1) sampleIndices.add(Math.min(pageCount - 1, Math.floor(pageCount * 0.25)));
    if (pageCount > 2) sampleIndices.add(Math.min(pageCount - 1, Math.floor(pageCount * 0.5)));
    if (pageCount > 3) sampleIndices.add(Math.min(pageCount - 1, Math.floor(pageCount * 0.75)));
    if (pageCount > 1) sampleIndices.add(pageCount - 1);
  }

  const pageDimensionsSample: PdfInspectResult['pageDimensionsSample'] = [];
  const textLayerSample: PdfInspectResult['textLayerSample'] = [];

  for (const idx of Array.from(sampleIndices).sort((a, b) => a - b)) {
    try {
      const page = doc.loadPage(idx);
      const bounds = page.getBounds();
      const widthPt = Math.round((bounds[2] - bounds[0]) * 10) / 10;
      const heightPt = Math.round((bounds[3] - bounds[1]) * 10) / 10;
      pageDimensionsSample.push({ page: idx + 1, widthPt, heightPt });

      const text = page.toStructuredText('preserve-whitespace').asText() || '';
      const compact = text.replace(/\s+/g, ' ').trim();
      textLayerSample.push({
        page: idx + 1,
        charCount: compact.length,
        preview: compact.slice(0, 120),
      });
    } catch {
      textLayerSample.push({ page: idx + 1, charCount: 0, preview: '' });
    }
  }

  const avgChars =
    textLayerSample.length > 0
      ? textLayerSample.reduce((s, x) => s + x.charCount, 0) / textLayerSample.length
      : 0;

  return {
    pdfPath: resolved,
    fileName: path.basename(resolved),
    fileSizeBytes,
    pageCount,
    pageDimensionsSample,
    outline,
    textLayerSample,
    likelyScanned: avgChars < 40,
  };
}

/**
 * 按页数上限 (默认 200 页) 与体积上限 (默认 180 MB) 自动拆分 PDF
 */
export async function splitPdfForMineru(
  pdfPath: string,
  outDir: string,
  options: { maxPages?: number; maxSizeMB?: number; pageRange?: [number, number] } = {}
): Promise<PdfSplitPart[]> {
  const maxPages = Math.max(1, options.maxPages ?? 200);
  const maxSizeBytes = Math.max(1, options.maxSizeMB ?? 180) * 1024 * 1024;

  const { doc, buf, resolved } = openPdfDocument(pdfPath);
  const totalDocPages = doc.countPages();
  const rangeStart = options.pageRange
    ? Math.max(1, Math.min(totalDocPages, Math.floor(options.pageRange[0])))
    : 1;
  const rangeEnd = options.pageRange
    ? Math.max(rangeStart, Math.min(totalDocPages, Math.floor(options.pageRange[1])))
    : totalDocPages;
  const isFullRange = rangeStart === 1 && rangeEnd === totalDocPages;
  const pageCount = rangeEnd - rangeStart + 1;

  if (isFullRange && pageCount <= maxPages && buf.byteLength <= maxSizeBytes) {
    return [
      {
        partIndex: 1,
        totalParts: 1,
        startPage: 1,
        endPage: totalDocPages,
        pageCount: totalDocPages,
        filePath: resolved,
        fileSizeBytes: buf.byteLength,
        isOriginalFile: true,
      },
    ];
  }

  const srcPdf = doc.asPDF();
  if (!srcPdf) {
    throw new Error('源文档无法转换为 PDFDocument 对象，无法物理拆分');
  }

  fs.mkdirSync(outDir, { recursive: true });
  const rawParts: Array<{ startPage: number; endPage: number; bytes: Uint8Array }> = [];

  let cursor = rangeStart - 1; // 0-based
  const cursorLimit = rangeEnd; // exclusive 0-based upper bound
  while (cursor < cursorLimit) {
    let span = Math.min(maxPages, cursorLimit - cursor);
    let chosenBytes: Uint8Array | null = null;

    while (span >= 1) {
      const dstPdf = new mupdf.PDFDocument();
      for (let i = 0; i < span; i++) {
        dstPdf.graftPage(-1, srcPdf, cursor + i);
      }
      const saved = dstPdf.saveToBuffer('compress');
      const bytes = saved.asUint8Array();
      if (bytes.byteLength <= maxSizeBytes || span === 1) {
        chosenBytes = bytes;
        break;
      }
      span = Math.max(1, Math.floor(span / 2));
    }

    if (!chosenBytes) {
      throw new Error(`拆分 PDF 第 ${cursor + 1} 页起失败`);
    }

    rawParts.push({
      startPage: cursor + 1,
      endPage: cursor + span,
      bytes: chosenBytes,
    });
    cursor += span;
  }

  const totalParts = rawParts.length;
  const parts: PdfSplitPart[] = [];
  for (let i = 0; i < rawParts.length; i++) {
    const p = rawParts[i];
    const partIndex = i + 1;
    const fileName = `part_${padNum(partIndex, 3)}_p${p.startPage}-${p.endPage}.pdf`;
    const filePath = path.join(outDir, fileName);
    fs.writeFileSync(filePath, p.bytes);
    parts.push({
      partIndex,
      totalParts,
      startPage: p.startPage,
      endPage: p.endPage,
      pageCount: p.endPage - p.startPage + 1,
      filePath,
      fileSizeBytes: p.bytes.byteLength,
      isOriginalFile: false,
    });
  }

  return parts;
}

/**
 * 按需将指定物理页码渲染为高清晰度 JPEG（带磁盘缓存，不重复渲染）
 */
export async function renderPdfPages(
  pdfPath: string,
  pages: number[],
  outDir: string,
  options: { dpi?: number; quality?: number; workspaceRoot?: string } = {}
): Promise<RenderedPageInfo[]> {
  const dpi = Math.max(72, Math.min(350, options.dpi ?? 150));
  const quality = Math.max(50, Math.min(98, options.quality ?? 85));
  fs.mkdirSync(outDir, { recursive: true });

  const { doc } = openPdfDocument(pdfPath);
  const pageCount = doc.countPages();
  const validPages = Array.from(
    new Set(pages.map((p) => Math.floor(Number(p))).filter((p) => Number.isFinite(p) && p >= 1 && p <= pageCount))
  ).sort((a, b) => a - b);

  if (validPages.length === 0) {
    throw new Error(`请求渲染的页码均超出有效范围 (1~${pageCount}): ${JSON.stringify(pages)}`);
  }

  const scale = dpi / 72;
  const results: RenderedPageInfo[] = [];

  for (const pageNum of validPages) {
    const fileName = `page_${padNum(pageNum, 4)}_${dpi}dpi.jpg`;
    const filePath = path.join(outDir, fileName);
    const relPath = options.workspaceRoot
      ? path.relative(options.workspaceRoot, filePath).replace(/\\/g, '/')
      : fileName;

    if (fs.existsSync(filePath)) {
      const meta = await sharp(filePath).metadata();
      const stat = fs.statSync(filePath);
      results.push({
        page: pageNum,
        filePath,
        relPath,
        width: meta.width || 0,
        height: meta.height || 0,
        dpi,
        sizeBytes: stat.size,
      });
      continue;
    }

    const page = doc.loadPage(pageNum - 1);
    const pix = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true);
    const pngBuf = Buffer.from(pix.asPNG());
    const jpegBuf = await sharp(pngBuf).jpeg({ quality }).toBuffer();
    fs.writeFileSync(filePath, jpegBuf);
    const meta = await sharp(jpegBuf).metadata();

    results.push({
      page: pageNum,
      filePath,
      relPath,
      width: meta.width || pix.getWidth(),
      height: meta.height || pix.getHeight(),
      dpi,
      sizeBytes: jpegBuf.byteLength,
    });
  }

  return results;
}

/**
 * 将多页 PDF 拼接为单张带页码角标的高可读性拼图（支持 2x2 总览图或 2-up 双页校对图）
 */
export async function renderContactSheet(
  pdfPath: string,
  pages: number[],
  outDir: string,
  options: {
    cols?: number;
    rows?: number;
    dpi?: number;
    quality?: number;
    workspaceRoot?: string;
    labelPrefix?: string;
  } = {}
): Promise<ContactSheetResult> {
  const cols = Math.max(1, Math.min(3, options.cols ?? 2));
  const rows = Math.max(1, Math.min(3, options.rows ?? 2));
  const maxTiles = cols * rows;
  const dpi = Math.max(72, Math.min(200, options.dpi ?? (cols === 2 && rows === 1 ? 130 : 95)));
  const quality = Math.max(60, Math.min(95, options.quality ?? 82));
  const labelPrefix = options.labelPrefix || 'PAGE';

  fs.mkdirSync(outDir, { recursive: true });
  const { doc } = openPdfDocument(pdfPath);
  const pageCount = doc.countPages();

  const validPages = pages
    .map((p) => Math.floor(Number(p)))
    .filter((p) => Number.isFinite(p) && p >= 1 && p <= pageCount)
    .slice(0, maxTiles);

  if (validPages.length === 0) {
    throw new Error(`拼图页码超出有效范围 (1~${pageCount}): ${JSON.stringify(pages)}`);
  }

  const keySig = `${cols}x${rows}_${dpi}dpi_${validPages.join('-')}`;
  const safeName = keySig.length > 80
    ? `sheet_${cols}x${rows}_${crypto.createHash('md5').update(keySig).digest('hex').slice(0, 10)}.jpg`
    : `sheet_${keySig}.jpg`;
  const filePath = path.join(outDir, safeName);
  const relPath = options.workspaceRoot
    ? path.relative(options.workspaceRoot, filePath).replace(/\\/g, '/')
    : safeName;

  const scale = dpi / 72;
  const rawTiles: Array<{ page: number; buf: Buffer; width: number; height: number }> = [];

  for (const pageNum of validPages) {
    const page = doc.loadPage(pageNum - 1);
    const pix = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true);
    const buf = Buffer.from(pix.asPNG());
    rawTiles.push({
      page: pageNum,
      buf,
      width: pix.getWidth(),
      height: pix.getHeight(),
    });
  }

  const cellW = Math.max(...rawTiles.map((t) => t.width));
  const cellH = Math.max(...rawTiles.map((t) => t.height));
  const headerH = 34;
  const gap = 16;
  const actualRows = Math.ceil(rawTiles.length / cols);
  const actualCols = Math.min(cols, rawTiles.length);

  const canvasW = actualCols * cellW + (actualCols + 1) * gap;
  const canvasH = actualRows * (cellH + headerH) + (actualRows + 1) * gap;

  const composites: sharp.OverlayOptions[] = [];
  const tiles: ContactSheetTile[] = [];

  for (let idx = 0; idx < rawTiles.length; idx++) {
    const tile = rawTiles[idx];
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const x = gap + col * (cellW + gap);
    const y = gap + row * (cellH + headerH + gap);

    const bannerSvg = Buffer.from(
      `<svg width="${cellW}" height="${headerH}" xmlns="http://www.w3.org/2000/svg">` +
        `<rect x="0" y="0" width="${cellW}" height="${headerH}" fill="#1e293b"/>` +
        `<text x="14" y="23" font-family="Arial, sans-serif" font-size="18" font-weight="bold" fill="#f8fafc">${labelPrefix} ${tile.page}</text>` +
      `</svg>`
    );

    const normalizedPageBuf =
      tile.width === cellW && tile.height === cellH
        ? tile.buf
        : await sharp(tile.buf)
            .resize(cellW, cellH, {
              fit: 'contain',
              background: { r: 255, g: 255, b: 255, alpha: 1 },
            })
            .png()
            .toBuffer();

    composites.push({ input: bannerSvg, left: x, top: y });
    composites.push({ input: normalizedPageBuf, left: x, top: y + headerH });

    tiles.push({
      page: tile.page,
      col,
      row,
      x,
      y: y + headerH,
      width: cellW,
      height: cellH,
    });
  }

  const outBuf = await sharp({
    create: {
      width: canvasW,
      height: canvasH,
      channels: 3,
      background: { r: 226, g: 232, b: 240 },
    },
  })
    .composite(composites)
    .jpeg({ quality })
    .toBuffer();

  fs.writeFileSync(filePath, outBuf);

  return {
    filePath,
    relPath,
    cols: actualCols,
    rows: actualRows,
    dpi,
    width: canvasW,
    height: canvasH,
    sizeBytes: outBuf.byteLength,
    pages: validPages,
    tiles,
  };
}

/**
 * 根据归一化 1000 分制坐标 [x0, y0, x1, y1] 精准裁剪 PDF 单页区域（如封面或漏切插图）
 */
export async function cropPdfRegion(
  pdfPath: string,
  pageNum: number,
  bboxNorm1000: [number, number, number, number],
  outPath: string,
  options: { dpi?: number; quality?: number } = {}
): Promise<{ filePath: string; width: number; height: number; sizeBytes: number }> {
  const dpi = Math.max(72, Math.min(350, options.dpi ?? 220));
  const quality = Math.max(60, Math.min(98, options.quality ?? 90));

  const { doc } = openPdfDocument(pdfPath);
  const pageCount = doc.countPages();
  const clampedPage = Math.max(1, Math.min(pageCount, Math.floor(pageNum)));
  const page = doc.loadPage(clampedPage - 1);

  const scale = dpi / 72;
  const pix = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true);
  const fullPng = Buffer.from(pix.asPNG());
  const imgW = pix.getWidth();
  const imgH = pix.getHeight();

  const [rx0, ry0, rx1, ry1] = bboxNorm1000;
  const x0 = Math.max(0, Math.min(imgW - 1, Math.floor((Math.min(rx0, rx1) / 1000) * imgW)));
  const y0 = Math.max(0, Math.min(imgH - 1, Math.floor((Math.min(ry0, ry1) / 1000) * imgH)));
  const x1 = Math.max(x0 + 1, Math.min(imgW, Math.ceil((Math.max(rx0, rx1) / 1000) * imgW)));
  const y1 = Math.max(y0 + 1, Math.min(imgH, Math.ceil((Math.max(ry0, ry1) / 1000) * imgH)));

  const cropW = Math.max(1, x1 - x0);
  const cropH = Math.max(1, y1 - y0);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  let pipeline = sharp(fullPng).extract({ left: x0, top: y0, width: cropW, height: cropH });
  const ext = path.extname(outPath).toLowerCase();
  if (ext === '.png') {
    pipeline = pipeline.png();
  } else if (ext === '.webp') {
    pipeline = pipeline.webp({ quality });
  } else {
    pipeline = pipeline.jpeg({ quality });
  }

  const outBuf = await pipeline.toBuffer();
  fs.writeFileSync(outPath, outBuf);

  return {
    filePath: outPath,
    width: cropW,
    height: cropH,
    sizeBytes: outBuf.byteLength,
  };
}
