/**
 * src/features/library/core/ingest-upload-pipeline.ts
 * ============================================================================
 * 研读书库统一混合上传与文献解析管线 (ABP + PDF Mixed Upload & Ingest Flow)
 * ============================================================================
 * 职责：
 * 1. 自动分流混合上传文件 (.abp 教材包 vs .pdf 学术文献)；
 * 2. 解析前置环境与凭证守卫：云端引擎缺 Token 时阻断并引导至全局设置；
 * 3. <= 200 页 PDF 静默后台解析；> 200 页 PDF 弹窗询问切片页码范围；
 * 4. 支持在研读书库对失败/中断/待解析文献直接触发重新解析。
 * ============================================================================
 */

import type { UnifiedReadingEntity } from '../../../types/library-entity';
import { getSavedMineruToken, readIngestSettings, type IngestEngineType } from '../../doc-ingestion/ingest-settings';
import { MINERU_MAX_PAGES_PER_PARSE } from './entity-status';
import { libraryClient } from './library-client';

export interface OversizedPdfTask {
  taskId: string;
  fileName: string;
  pageCount: number;
  defaultRange?: string;
}

export interface IngestPipelineCallbacks {
  onStatus: (message: string, autoHideMs?: number, isError?: boolean) => void;
  onRefreshLibrary: () => Promise<void>;
  onMissingMineruToken: (blockedFileNames: string[]) => void;
  onPromptOversizedPages: (
    tasks: OversizedPdfTask[]
  ) => Promise<Array<{ taskId: string; pageRanges: string }> | null>;
}

interface HealthResponse {
  maxPagesPerParse?: number;
  api?: { hasToken?: boolean };
  local?: { available?: boolean; message?: string };
}

async function fetchIngestHealth(): Promise<HealthResponse | null> {
  try {
    const res = await fetch('/api/ingest/health');
    if (!res.ok) return null;
    return (await res.json()) as HealthResponse;
  } catch {
    return null;
  }
}

async function ensureEngineReady(
  engine: IngestEngineType,
  blockedNames: string[],
  callbacks: IngestPipelineCallbacks
): Promise<{ ok: boolean; token: string }> {
  const localToken = getSavedMineruToken();

  if (engine === 'api') {
    if (localToken) {
      return { ok: true, token: localToken };
    }
    const health = await fetchIngestHealth();
    if (health?.api?.hasToken) {
      return { ok: true, token: '' };
    }
    callbacks.onMissingMineruToken(blockedNames);
    return { ok: false, token: '' };
  }

  if (engine === 'local') {
    const health = await fetchIngestHealth();
    if (health && health.local && health.local.available === false) {
      callbacks.onStatus(
        `本机硬件加速环境暂未就绪：${health.local.message || '请前往全局设置切换为云端 MinerU 或配置本地环境'}`,
        7000,
        true
      );
      return { ok: false, token: '' };
    }
  }

  return { ok: true, token: localToken };
}

async function startParseRequest(
  taskId: string,
  engine: IngestEngineType,
  token: string,
  pageRanges?: string
): Promise<void> {
  const res = await fetch('/api/ingest/parse', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      taskId,
      engine,
      token: token || undefined,
      ...(pageRanges !== undefined ? { pageRanges } : {}),
    }),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `HTTP ${res.status}: 启动解析失败`);
  }
}

export async function handleMixedFileUploads(
  fileList: File[] | FileList,
  callbacks: IngestPipelineCallbacks
): Promise<void> {
  const files = Array.from(fileList || []);
  if (files.length === 0) return;

  const bookFiles: File[] = [];
  const pdfFiles: File[] = [];
  const unsupportedFiles: string[] = [];

  for (const file of files) {
    const lower = file.name.toLowerCase();
    if (lower.endsWith('.abp') || lower.endsWith('.epub')) {
      bookFiles.push(file);
    } else if (lower.endsWith('.pdf')) {
      pdfFiles.push(file);
    } else {
      unsupportedFiles.push(file.name);
    }
  }

  if (unsupportedFiles.length > 0 && bookFiles.length === 0 && pdfFiles.length === 0) {
    callbacks.onStatus(
      `暂不支持的文件格式：${unsupportedFiles.join('、')}（仅支持 .abp / .epub 书籍与 .pdf 文献）`,
      5000,
      true
    );
    return;
  }

  // 1. 先安装所有 .abp / .epub 书籍文件（不依赖 MinerU Token）
  let installedBookCount = 0;
  for (const bookFile of bookFiles) {
    const isEpub = bookFile.name.toLowerCase().endsWith('.epub');
    const formatLabel = isEpub ? 'EPUB 电子书' : 'ABP 书籍包';
    try {
      callbacks.onStatus(`正在导入 ${formatLabel}《${bookFile.name}》...`);
      const buf = await bookFile.arrayBuffer();
      await libraryClient.installBookFile(bookFile.name, buf);
      installedBookCount++;
    } catch (err: any) {
      callbacks.onStatus(`${formatLabel}《${bookFile.name}》导入失败: ${err?.message || err}`, 6000, true);
    }
  }
  if (installedBookCount > 0) {
    await callbacks.onRefreshLibrary();
  }

  // 2. 处理 .pdf 文献队列
  if (pdfFiles.length === 0) {
    if (installedBookCount > 0) {
      const warnSuffix =
        unsupportedFiles.length > 0 ? `（已跳过不支持文件：${unsupportedFiles.join('、')}）` : '';
      callbacks.onStatus(`成功导入 ${installedBookCount} 本书籍${warnSuffix}`, 3500);
    }
    return;
  }

  const { engine } = readIngestSettings();
  const ready = await ensureEngineReady(
    engine,
    pdfFiles.map((f) => f.name),
    callbacks
  );
  if (!ready.ok) {
    return;
  }

  const oversizedTasks: OversizedPdfTask[] = [];
  let silentStartedCount = 0;

  for (const pdf of pdfFiles) {
    try {
      callbacks.onStatus(`正在上传文献《${pdf.name}》...`);
      const uploadRes = await fetch('/api/ingest/upload', {
        method: 'POST',
        headers: {
          'x-file-name': encodeURIComponent(pdf.name),
          'x-engine': engine,
        },
        body: pdf,
      });

      const uploadJson = await uploadRes.json().catch(() => ({}));
      if (!uploadRes.ok || !uploadJson?.success || !uploadJson?.task) {
        throw new Error(uploadJson?.error || `HTTP ${uploadRes.status}: 上传文献失败`);
      }

      const task = uploadJson.task as { taskId: string; fileName: string; pageCount: number };
      const pageCount = Number(task.pageCount || 1);

      if (pageCount > MINERU_MAX_PAGES_PER_PARSE) {
        oversizedTasks.push({
          taskId: task.taskId,
          fileName: task.fileName || pdf.name,
          pageCount,
          defaultRange: `1-${MINERU_MAX_PAGES_PER_PARSE}`,
        });
      } else {
        await startParseRequest(task.taskId, engine, ready.token);
        silentStartedCount++;
      }
    } catch (err: any) {
      callbacks.onStatus(`文献《${pdf.name}》处理失败: ${err?.message || err}`, 6500, true);
    }
  }

  await callbacks.onRefreshLibrary();

  if (oversizedTasks.length > 0) {
    const selections = await callbacks.onPromptOversizedPages(oversizedTasks);
    if (selections && selections.length > 0) {
      for (const sel of selections) {
        try {
          await startParseRequest(sel.taskId, engine, ready.token, sel.pageRanges);
          silentStartedCount++;
        } catch (err: any) {
          callbacks.onStatus(`启动切片解析失败: ${err?.message || err}`, 6500, true);
        }
      }
      await callbacks.onRefreshLibrary();
    }
  }

  if (silentStartedCount > 0 || installedBookCount > 0) {
    const parts: string[] = [];
    if (installedBookCount > 0) parts.push(`已导入 ${installedBookCount} 本书籍`);
    if (silentStartedCount > 0) parts.push(`${silentStartedCount} 篇文献已进入后台解析（可在文献论文栏查看）`);
    if (unsupportedFiles.length > 0) parts.push(`跳过 ${unsupportedFiles.length} 个不支持文件`);
    callbacks.onStatus(parts.join('；'), 4500);
  }
}

export async function reparseEntityTask(
  entity: UnifiedReadingEntity,
  callbacks: IngestPipelineCallbacks
): Promise<void> {
  const taskId = entity.metadata?.taskId;
  if (!taskId) return;

  const { engine } = readIngestSettings();
  const ready = await ensureEngineReady(engine, [entity.title], callbacks);
  if (!ready.ok) {
    return;
  }

  const totalPages = Number(entity.metadata?.totalPages || 0);
  let chosenPageRanges: string | undefined = entity.metadata?.pageRanges;

  if (totalPages > MINERU_MAX_PAGES_PER_PARSE) {
    const selections = await callbacks.onPromptOversizedPages([
      {
        taskId,
        fileName: `${entity.title}.pdf`,
        pageCount: totalPages,
        defaultRange: chosenPageRanges || `1-${MINERU_MAX_PAGES_PER_PARSE}`,
      },
    ]);
    if (!selections || selections.length === 0) {
      return;
    }
    chosenPageRanges = selections[0].pageRanges;
  }

  try {
    callbacks.onStatus(`正在启动重新解析《${entity.title}》...`);
    await startParseRequest(taskId, engine, ready.token, chosenPageRanges);
    await callbacks.onRefreshLibrary();
    callbacks.onStatus(`《${entity.title}》已重新加入后台解析队列`, 3500);
  } catch (err: any) {
    callbacks.onStatus(`重新解析失败: ${err?.message || err}`, 6000, true);
  }
}
