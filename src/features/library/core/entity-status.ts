/**
 * src/features/library/core/entity-status.ts
 * ============================================================================
 * 学术文献状态映射器与 MinerU 页码阈值校验器 (Shared Domain Helper)
 * ============================================================================
 * 规范：
 * 1. Electron LibraryManager 与 Dev Server Library Plugin 共同依赖此单一映射器，
 *    禁止双份拷贝；
 * 2. 区分 idle（待解析）、active processing（真正在途解析）、interrupted（僵尸中断）与 error；
 * 3. 统一定义 MinerU 单次处理页数阈值 (200 页) 与页码范围解析校验逻辑。
 * ============================================================================
 */

import type { EntityStatus } from '../../../types/library-entity';

export const MINERU_MAX_PAGES_PER_PARSE = 200;

export const INGEST_ACTIVE_STATES = new Set([
  'uploading',
  'waiting-file',
  'pending',
  'processing',
  'downloading',
  'unpacking',
]);

export interface TaskStatusLike {
  status: string;
  progress?: number;
  error?: string;
  pageCount?: number;
  pageRanges?: string;
}

export interface MappedEntityStatus {
  status: EntityStatus;
  statusMessage: string;
}

export function isIngestRunningState(status: string | undefined): boolean {
  return Boolean(status && INGEST_ACTIVE_STATES.has(status));
}

export function mapIngestTaskToEntityStatus(
  task: TaskStatusLike,
  isJobActive: boolean
): MappedEntityStatus {
  if (task.status === 'completed') {
    return { status: 'ready', statusMessage: '' };
  }

  if (task.status === 'failed') {
    return {
      status: 'error',
      statusMessage: task.error || '解析失败，可点击重新解析',
    };
  }

  if (task.status === 'idle') {
    const pages = Number(task.pageCount || 0);
    if (pages > MINERU_MAX_PAGES_PER_PARSE && !task.pageRanges) {
      return {
        status: 'idle',
        statusMessage: `待解析（共 ${pages} 页，需指定页码）`,
      };
    }
    return {
      status: 'idle',
      statusMessage: '待解析',
    };
  }

  if (isIngestRunningState(task.status)) {
    if (isJobActive) {
      const pct = typeof task.progress === 'number' ? task.progress : 0;
      return {
        status: 'processing',
        statusMessage: `MinerU 解析中 ${pct}%`,
      };
    }
    // 进程已重启或任务异常脱管：绝不永久卡在 "解析中 0%"
    return {
      status: 'error',
      statusMessage: '上次解析已中断，可点击重新解析',
    };
  }

  return {
    status: 'error',
    statusMessage: task.error || '状态异常，可点击重新解析',
  };
}

export interface PageRangeValidationResult {
  valid: boolean;
  totalSelectedPages: number;
  normalized?: string;
  error?: string;
}

/**
 * 解析并校验页码范围字符串（例如 "1-50", "3, 5, 7-20"）
 * - 自动校验格式、边界 (1..totalPages) 及去重后的总页数是否 <= maxPages
 */
export function validatePageRanges(
  raw: string,
  totalPages: number,
  maxPages: number = MINERU_MAX_PAGES_PER_PARSE
): PageRangeValidationResult {
  const trimmed = (raw || '').trim();
  if (!trimmed) {
    if (totalPages > maxPages) {
      return {
        valid: false,
        totalSelectedPages: totalPages,
        error: `该文献共 ${totalPages} 页，超过单次解析上限（${maxPages} 页），请填写页码范围（例如 1-${maxPages}）。`,
      };
    }
    return {
      valid: true,
      totalSelectedPages: Math.max(1, totalPages),
      normalized: undefined,
    };
  }

  const normalizedInput = trimmed.replace(/，/g, ',').replace(/[–—~～]/g, '-');
  const tokens = normalizedInput.split(',').map((s) => s.trim()).filter(Boolean);
  if (tokens.length === 0) {
    return {
      valid: false,
      totalSelectedPages: 0,
      error: '请输入有效的页码范围，例如 1-50 或 1-20, 35-60。',
    };
  }

  const selectedPages = new Set<number>();
  const normalizedParts: string[] = [];
  const effectiveMaxPage = totalPages > 0 ? totalPages : Number.MAX_SAFE_INTEGER;

  for (const token of tokens) {
    const singleMatch = token.match(/^(\d+)$/);
    if (singleMatch) {
      const p = parseInt(singleMatch[1], 10);
      if (p < 1 || p > effectiveMaxPage) {
        return {
          valid: false,
          totalSelectedPages: 0,
          error: `页码 ${p} 超出文档范围（1-${effectiveMaxPage}）。`,
        };
      }
      selectedPages.add(p);
      normalizedParts.push(String(p));
      continue;
    }

    const rangeMatch = token.match(/^(\d+)\s*-\s*(\d+)$/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);
      if (start < 1 || end < start || end > effectiveMaxPage) {
        return {
          valid: false,
          totalSelectedPages: 0,
          error: `页码区间 "${token}" 无效（合法范围 1-${effectiveMaxPage} 且起始页不大于结束页）。`,
        };
      }
      for (let p = start; p <= end; p++) {
        selectedPages.add(p);
      }
      normalizedParts.push(`${start}-${end}`);
      continue;
    }

    return {
      valid: false,
      totalSelectedPages: 0,
      error: `无法识别的页码片段 "${token}"，请使用如 1-50 或 3,5,10-30 格式。`,
    };
  }

  const count = selectedPages.size;
  if (count === 0) {
    return {
      valid: false,
      totalSelectedPages: 0,
      error: '至少需要选择 1 页进行解析。',
    };
  }

  if (count > maxPages) {
    return {
      valid: false,
      totalSelectedPages: count,
      error: `当前共选中 ${count} 页，超过单次最大限制（${maxPages} 页），请缩减页码范围。`,
    };
  }

  return {
    valid: true,
    totalSelectedPages: count,
    normalized: normalizedParts.join(','),
  };
}
