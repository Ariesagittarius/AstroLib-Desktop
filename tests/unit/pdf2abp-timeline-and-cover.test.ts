import { describe, expect, it } from 'vitest';
import {
  parseSubagentStartedMessage,
  projectPdf2AbpTimeline,
} from '../../src/components/harness/pdf2abp/pdf2abp-timeline.ts';
import {
  buildAcademicDefaultCoverHtml,
  getLocalCoverFallbackCandidates,
} from '../../src/features/library/core/default-cover.ts';
import type { Pdf2AbpJobState } from '../../src/services/pdf2abp/types.ts';
import type { UnifiedReadingEntity } from '../../src/types/library-entity.ts';

describe('PDF2ABP Linear Timeline Projector', () => {
  it('parses title and page range from legacy subagent_started messages and builds 8-stage timeline', () => {
    const parsed = parseSubagentStartedMessage('Started subagent ch8-s3 (8.3 没有银弹, p.62-64)');
    expect(parsed).toEqual({
      taskId: 'ch8-s3',
      title: '8.3 没有银弹',
      startPage: 62,
      endPage: 64,
    });

    const jobState: Pdf2AbpJobState = {
      jobId: 'job_1',
      sourcePdfPath: 'D:\\mythical.pdf',
      sourceFileName: '人月神话.pdf',
      workspaceDir: '/tmp/job_1',
      status: 'running',
      phase: 'subagent_proofreading',
      providerId: 'baigong',
      modelId: 'ybg',
      baseURL: 'https://gateway.baigongai.cn/v1',
      concurrency: 12,
      autoImport: true,
      createdAt: 10_000,
      updatedAt: 70_000,
      pdfInfo: {
        pdfPath: 'D:\\mythical.pdf',
        fileName: '人月神话.pdf',
        fileSizeBytes: 10_485_760,
        pageCount: 280,
        pageDimensionsSample: [],
        outline: [],
        textLayerSample: [],
        likelyScanned: false,
      },
      subagentTasks: {
        'ch1-s1': {
          taskId: 'ch1-s1',
          status: 'completed',
          outputFiles: ['book/01_ch1.mdx'],
          imagesUsed: [],
          validationPassed: true,
          validationErrors: [],
          anomalies: [],
          notes: '',
          stepsUsed: 4,
          durationMs: 18_000,
        },
      },
    };

    const model = projectPdf2AbpTimeline({
      jobState,
      nowMs: 70_000,
      chunksManifest: {
        workOrders: [
          { chunkId: 'ch1-s1', chapterTitle: '1.1 焦油坑', startPage: 1, endPage: 8, partIndex: 1, totalParts: 1 },
          { chunkId: 'ch8-s3', chapterTitle: '8.3 没有银弹', startPage: 62, endPage: 64, partIndex: 1, totalParts: 1 },
          { chunkId: 'ch9-s1', chapterTitle: '9.1 全书结语', startPage: 65, endPage: 70, partIndex: 1, totalParts: 1 },
        ],
      },
      runningSubagents: {
        'ch8-s3': {
          taskId: 'ch8-s3',
          startedAt: 50_000,
          updatedAt: 65_000,
          currentTool: 'validate_mdx',
          recentTools: ['read_workspace_file', 'validate_mdx'],
        },
      },
      milestoneEvents: [
        {
          seq: 1,
          timestamp: 10_000,
          jobId: 'job_1',
          agentId: 'main',
          type: 'phase_changed',
          message: 'Inspect',
          data: { phase: 'skills_and_inspect' },
        },
        {
          seq: 2,
          timestamp: 45_000,
          jobId: 'job_1',
          agentId: 'main',
          type: 'phase_changed',
          message: 'Subagent dispatch',
          data: { phase: 'subagent_proofreading' },
        },
      ],
    });

    expect(model.stages).toHaveLength(8);
    expect(model.completedStages).toBe(4);
    expect(model.stages[0]?.status).toBe('completed');
    expect(model.stages[4]?.id).toBe('subagent_proofreading');
    expect(model.stages[4]?.status).toBe('running');
    expect(model.stages[5]?.status).toBe('pending');
    expect(model.subagentSummary).toEqual({
      total: 3,
      running: 1,
      completed: 1,
      failed: 0,
      skipped: 0,
      pending: 1,
    });
    expect(model.subagentMatrix.active[0]?.title).toBe('8.3 没有银弹');
    expect(model.subagentMatrix.active[0]?.currentTool).toBe('validate_mdx');
    expect(model.subagentMatrix.completed[0]?.targetOutputRelPath).toBe('book/01_ch1.mdx');
  });
});

describe('Academic Default Cover & Local Cover Fallback', () => {
  it('resolves local cover fallback candidates for books whose remote cover fails', () => {
    const mathBook: UnifiedReadingEntity = {
      id: 'book:math-math_analysis',
      kind: 'book',
      title: '数学分析 <第一卷>',
      author: '华东师范大学数学系',
      cover: 'https://images.unsplash.com/photo-broken',
      category: 'math',
      createdAt: 1000,
      status: 'ready',
      metadata: { colSlug: 'math', bookSlug: 'math_analysis', sourceFormat: 'abp' },
    };

    const candidates = getLocalCoverFallbackCandidates(mathBook, [mathBook.cover!]);
    expect(candidates[0]).toBe('/covers/thumbs/math_analysis.webp');
    expect(candidates[1]).toBe('/covers/math_analysis.jpg');
    expect(candidates).not.toContain('/favicon.png');

    const html = buildAcademicDefaultCoverHtml(mathBook);
    expect(html).toContain('academic-default-cover is-tone-math');
    expect(html).toContain('数学分析 &lt;第一卷&gt;');
    expect(html).toContain('MATHEMATICS');
    expect(html).toContain('华东师范大学数学系');
  });

  it('builds refined default cover HTML for EPUB books and PDF papers', () => {
    const paper: UnifiedReadingEntity = {
      id: 'paper:p1',
      kind: 'paper',
      title: 'Attention Is All You Need',
      publisher: 'NeurIPS',
      category: 'cs',
      createdAt: 1000,
      status: 'ready',
      metadata: {},
    };
    const paperHtml = buildAcademicDefaultCoverHtml(paper);
    expect(paperHtml).toContain('is-tone-paper');
    expect(paperHtml).toContain('NEURIPS · PAPER');
  });
});
