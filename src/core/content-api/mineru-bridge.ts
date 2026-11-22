/**
 * src/core/content-api/mineru-bridge.ts
 * ============================================================================
 * AstroLib MinerU 转换产物与物理切片桥接器 (MinerU Extraction Bridge)
 * ============================================================================
 * 职责：
 * 1. 扫描 task/ 摄取目录下的 MinerU 输出产物 (full.md, layout.json, block_list.json, images)；
 * 2. 提取 OCR 布局块与物理切片元数据，供 Agent 巡查与模块化识别；
 * 3. 支持按任务 Hash / 目录名称精细检索结构化数据。
 * ============================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import type { MineruTaskData } from './types.ts';

const TASK_DIR = path.resolve(process.cwd(), 'task');

/**
 * 扫描并列出所有 MinerU 产物目录
 */
export function listMineruTasks(): MineruTaskData[] {
  if (!fs.existsSync(TASK_DIR)) return [];

  const entries = fs.readdirSync(TASK_DIR, { withFileTypes: true });
  const tasks: MineruTaskData[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'ingest') continue;

    const fullDirPath = path.join(TASK_DIR, entry.name);
    const files = fs.readdirSync(fullDirPath);

    const hasFullMd = files.includes('full.md');
    const hasLayoutJson = files.includes('layout.json');
    const fullMarkdownPath = hasFullMd ? path.join(fullDirPath, 'full.md') : undefined;
    const layoutJsonPath = hasLayoutJson ? path.join(fullDirPath, 'layout.json') : undefined;

    const imagesDirPath = path.join(fullDirPath, 'images');
    let imageCount = 0;
    if (fs.existsSync(imagesDirPath)) {
      try {
        imageCount = fs.readdirSync(imagesDirPath).length;
      } catch {}
    }

    // 尝试寻找同目录下的原版 pdf 或 _origin.pdf
    let pdfPath: string | undefined;
    const pdfInDir = files.find((f) => f.endsWith('.pdf'));
    if (pdfInDir) {
      pdfPath = path.join(fullDirPath, pdfInDir);
    } else {
      // 提取 bookName 前缀看 task 根目录下是否存在
      const baseName = entry.name.split('.pdf-')[0];
      const rootPdf = path.join(TASK_DIR, `${baseName}.pdf`);
      if (fs.existsSync(rootPdf)) pdfPath = rootPdf;
    }

    // 提取 hash 标记
    const hashMatch = entry.name.match(/-([a-f0-9-]{8,})/i);
    const bookHash = hashMatch ? hashMatch[1] : entry.name;

    tasks.push({
      bookHash,
      dirPath: fullDirPath,
      pdfPath,
      fullMarkdownPath,
      layoutJsonPath,
      imagesDir: fs.existsSync(imagesDirPath) ? imagesDirPath : undefined,
      imageCount,
      hasFullMarkdown: hasFullMd,
      hasLayoutJson,
    });
  }

  return tasks;
}

/**
 * 获取指定任务的 MinerU 详细信息
 */
export function getMineruTaskData(taskIdentifier: string): MineruTaskData | null {
  const allTasks = listMineruTasks();
  const idLower = taskIdentifier.toLowerCase();

  const found = allTasks.find(
    (t) =>
      t.bookHash.toLowerCase().includes(idLower) ||
      path.basename(t.dirPath).toLowerCase().includes(idLower)
  );

  if (!found) return null;

  // 补充 sampleToc 如果存在
  const sampleTocFile = path.join(TASK_DIR, 'toc_sample.txt');
  if (fs.existsSync(sampleTocFile)) {
    try {
      found.sampleToc = fs.readFileSync(sampleTocFile, 'utf-8').slice(0, 2000);
    } catch {}
  }

  return found;
}

/**
 * 获取指定任务的 layout.json 或 block_list.json 内容切片
 */
export function getMineruLayoutSlice(
  taskIdentifier: string,
  limit: number = 50
): { success: boolean; blocks?: any[]; totalBlocks?: number; error?: string } {
  const task = getMineruTaskData(taskIdentifier);
  if (!task) return { success: false, error: `未找到 MinerU 任务: ${taskIdentifier}` };

  const blockListPath = path.join(task.dirPath, 'block_list.json');
  const targetPath = fs.existsSync(blockListPath) ? blockListPath : task.layoutJsonPath;

  if (!targetPath || !fs.existsSync(targetPath)) {
    return { success: false, error: '该任务不存在 layout.json 或 block_list.json' };
  }

  try {
    const raw = fs.readFileSync(targetPath, 'utf-8');
    const parsed = JSON.parse(raw);
    const blocks = Array.isArray(parsed)
      ? parsed
      : parsed.blocks || parsed.pdf_info || [];

    return {
      success: true,
      totalBlocks: blocks.length,
      blocks: blocks.slice(0, limit),
    };
  } catch (err: any) {
    return { success: false, error: `读取布局文件失败: ${err?.message || err}` };
  }
}
