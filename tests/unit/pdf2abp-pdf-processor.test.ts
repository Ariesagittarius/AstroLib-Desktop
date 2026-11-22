import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {
  inspectPdf,
  splitPdfForMineru,
  renderPdfPages,
  renderContactSheet,
  cropPdfRegion,
} from '../../src/services/pdf2abp/pdf-processor.ts';

const SAMPLE_4P_PDF = path.resolve(
  process.cwd(),
  '.agents/src/2026新高考I+II数学by Charlie/2026新高考I卷数学.pdf'
);
const SAMPLE_552P_PDF = path.resolve(process.cwd(), '.agents/src/大邮数学集-1.4.2.pdf');

describe('PDF Processor (mupdf WASM + sharp)', () => {
  let tmpDir = '';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'astrolib-pdfproc-'));
  });

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('inspectPdf 能正确提取真实 PDF 页数、书签大纲与文字层密度', async () => {
    const info = await inspectPdf(SAMPLE_4P_PDF);
    expect(info.pageCount).toBe(4);
    expect(info.outline.length).toBeGreaterThanOrEqual(4);
    expect(info.outline[0].page).toBe(1);
    expect(info.likelyScanned).toBe(false);
    expect(info.textLayerSample.length).toBeGreaterThan(0);

    if (fs.existsSync(SAMPLE_552P_PDF)) {
      const bigInfo = await inspectPdf(SAMPLE_552P_PDF);
      expect(bigInfo.pageCount).toBe(552);
      expect(bigInfo.outline.length).toBeGreaterThan(100);
    }
  });

  it('splitPdfForMineru 能按页数上限与体积上限双重约束拆分 PDF', async () => {

    const single = await splitPdfForMineru(SAMPLE_4P_PDF, path.join(tmpDir, 'single'), {
      maxPages: 200,
      maxSizeMB: 180,
    });
    expect(single).toHaveLength(1);
    expect(single[0].isOriginalFile).toBe(true);
    expect(single[0].startPage).toBe(1);
    expect(single[0].endPage).toBe(4);

    const byPages = await splitPdfForMineru(SAMPLE_4P_PDF, path.join(tmpDir, 'by-pages'), {
      maxPages: 2,
      maxSizeMB: 180,
    });
    expect(byPages).toHaveLength(2);
    expect(byPages[0]).toMatchObject({ startPage: 1, endPage: 2, pageCount: 2, isOriginalFile: false });
    expect(byPages[1]).toMatchObject({ startPage: 3, endPage: 4, pageCount: 2, isOriginalFile: false });
    expect((await inspectPdf(byPages[0].filePath)).pageCount).toBe(2);
    expect((await inspectPdf(byPages[1].filePath)).pageCount).toBe(2);

    const printPdf = path.resolve(process.cwd(), 'task/print.pdf');
    if (fs.existsSync(printPdf)) {
      const bySize = await splitPdfForMineru(printPdf, path.join(tmpDir, 'by-size'), {
        maxPages: 200,
        maxSizeMB: 0.45,
      });
      expect(bySize.length).toBeGreaterThanOrEqual(2);
      expect(bySize.reduce((acc, p) => acc + p.pageCount, 0)).toBe(3);
    }
  });

  it('renderPdfPages、renderContactSheet (2x2 与 2-up) 与 cropPdfRegion 输出有效 JPEG/PNG', async () => {
    const pagesDir = path.join(tmpDir, 'pages');
    const rendered = await renderPdfPages(SAMPLE_4P_PDF, [1, 2], pagesDir, { dpi: 120 });
    expect(rendered).toHaveLength(2);
    expect(fs.existsSync(rendered[0].filePath)).toBe(true);
    expect(rendered[0].width).toBeGreaterThan(500);

    const sheet2x2 = await renderContactSheet(SAMPLE_4P_PDF, [1, 2, 3, 4], pagesDir, {
      cols: 2,
      rows: 2,
      dpi: 90,
    });
    expect(fs.existsSync(sheet2x2.filePath)).toBe(true);
    expect(sheet2x2.pages).toEqual([1, 2, 3, 4]);
    expect(sheet2x2.tiles).toHaveLength(4);
    const meta2x2 = await sharp(sheet2x2.filePath).metadata();
    expect(meta2x2.format).toBe('jpeg');
    expect(meta2x2.width).toBe(sheet2x2.width);

    const sheet2up = await renderContactSheet(SAMPLE_4P_PDF, [1, 2], pagesDir, {
      cols: 2,
      rows: 1,
      dpi: 120,
    });
    expect(sheet2up.cols).toBe(2);
    expect(sheet2up.rows).toBe(1);

    const cropOut = path.join(tmpDir, 'cover.jpg');
    const cropped = await cropPdfRegion(SAMPLE_4P_PDF, 1, [0, 0, 1000, 400], cropOut, { dpi: 150 });
    expect(fs.existsSync(cropped.filePath)).toBe(true);
    expect(cropped.width).toBeGreaterThan(500);
    expect(cropped.height).toBeGreaterThan(300);
  });
});
