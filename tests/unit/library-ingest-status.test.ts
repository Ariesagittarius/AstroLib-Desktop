import { describe, it, expect } from 'vitest';
import {
  mapIngestTaskToEntityStatus,
  MINERU_MAX_PAGES_PER_PARSE,
  validatePageRanges,
} from '../../src/features/library/core/entity-status';

describe('Library Ingest Status Mapper & Page Range Validation', () => {
  it('1. idle 任务绝不应误映射为 processing 0%', () => {
    const normalIdle = mapIngestTaskToEntityStatus(
      { status: 'idle', progress: 0, pageCount: 22 },
      false
    );
    expect(normalIdle.status).toBe('idle');
    expect(normalIdle.statusMessage).toBe('待解析');

    const oversizedIdle = mapIngestTaskToEntityStatus(
      { status: 'idle', progress: 0, pageCount: 479 },
      false
    );
    expect(oversizedIdle.status).toBe('idle');
    expect(oversizedIdle.statusMessage).toContain('479 页');
  });

  it('2. 运行中间态仅在 isJobActive=true 时展示解析进度；进程脱管时降级为可重解析错误态', () => {
    const active = mapIngestTaskToEntityStatus(
      { status: 'processing', progress: 64 },
      true
    );
    expect(active.status).toBe('processing');
    expect(active.statusMessage).toBe('MinerU 解析中 64%');

    const zombie = mapIngestTaskToEntityStatus(
      { status: 'uploading', progress: 10 },
      false
    );
    expect(zombie.status).toBe('error');
    expect(zombie.statusMessage).toContain('中断');
  });

  it('3. completed 与 failed 应精确映射到 ready 与 error', () => {
    expect(mapIngestTaskToEntityStatus({ status: 'completed', progress: 100 }, false)).toEqual({
      status: 'ready',
      statusMessage: '',
    });

    const failed = mapIngestTaskToEntityStatus(
      { status: 'failed', error: 'HTTP 413 Payload Too Large' },
      false
    );
    expect(failed.status).toBe('error');
    expect(failed.statusMessage).toBe('HTTP 413 Payload Too Large');
  });

  it('4. validatePageRanges 应正确校验 200 页上限、空输入、格式与重叠去重', () => {
    expect(MINERU_MAX_PAGES_PER_PARSE).toBe(200);

    expect(validatePageRanges('', 120).valid).toBe(true);

    expect(validatePageRanges('', 479).valid).toBe(false);

    const exact200 = validatePageRanges('1-200', 479);
    expect(exact200.valid).toBe(true);
    expect(exact200.totalSelectedPages).toBe(200);
    expect(exact200.normalized).toBe('1-200');

    expect(validatePageRanges('1-201', 479).valid).toBe(false);

    const multi = validatePageRanges('1-50，40–100, 200', 479);
    expect(multi.valid).toBe(true);
    expect(multi.totalSelectedPages).toBe(101);
    expect(multi.normalized).toBe('1-50,40-100,200');

    expect(validatePageRanges('50-10', 479).valid).toBe(false);
    expect(validatePageRanges('480', 479).valid).toBe(false);
    expect(validatePageRanges('abc', 479).valid).toBe(false);
  });
});
