import { describe, expect, it, vi } from 'vitest';
import {
  Pdf2AbpStore,
  type EventSourceLike,
} from '../../src/components/harness/pdf2abp/pdf2abp-store.ts';

class MockEventSource implements EventSourceLike {
  public listeners = new Map<string, Array<(evt: { data: string }) => void>>();
  public onerror: ((err: unknown) => void) | null = null;
  public onmessage: ((evt: { data: string }) => void) | null = null;
  public closed = false;

  public addEventListener(type: string, listener: (evt: { data: string }) => void): void {
    const arr = this.listeners.get(type) || [];
    arr.push(listener);
    this.listeners.set(type, arr);
  }

  public emit(type: string, data: unknown): void {
    const payload = { data: JSON.stringify(data) };
    for (const fn of this.listeners.get(type) || []) {
      fn(payload);
    }
  }

  public close(): void {
    this.closed = true;
  }
}

describe('Pdf2AbpStore (Phase 2 Harness UI State)', () => {
  it('supports health check, startJob, SSE event streaming, file preview & completion callback', async () => {
    let lastSse: MockEventSource | null = null;
    let jobStatus: 'running' | 'completed' | 'cancelled' = 'running';

    const mockFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/health')) {
        return new Response(
          JSON.stringify({
            ok: true,
            mineru: { ready: true, preferredEngine: 'api', hasApiToken: true, tokenPrefix: 'sk-', localAvailable: false, guidance: '' },
            python: { available: true, version: '3.12' },
            defaultGateway: { providerId: 'baigong', modelId: 'ybg-youlaber-ds4f', baseURL: 'https://gateway.baigongai.cn/v1' },
          }),
          { status: 200 }
        );
      }
      if (url.endsWith('/jobs') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body || '{}'));
        expect(body.concurrency).toBe(12);
        return new Response(
          JSON.stringify({
            job: {
              jobId: 'job_1',
              sourcePdfPath: body.pdfPath,
              sourceFileName: 'algorithms.pdf',
              workspaceDir: '/tmp/job_1',
              status: 'running',
              phase: 'init',
              providerId: 'baigong',
              modelId: 'ybg-youlaber-ds4f',
              baseURL: 'https://gateway.baigongai.cn/v1',
              concurrency: body.concurrency,
              autoImport: true,
              createdAt: 1000,
              updatedAt: 1000,
              subagentTasks: {},
            },
          }),
          { status: 202 }
        );
      }
      if (url.endsWith('/jobs/job_1')) {
        return new Response(
          JSON.stringify({
            job: {
              jobId: 'job_1',
              sourcePdfPath: 'D:\\algorithms.pdf',
              sourceFileName: 'algorithms.pdf',
              workspaceDir: '/tmp/job_1',
              status: jobStatus,
              phase: jobStatus === 'completed' ? 'done' : 'mineru',
              providerId: 'baigong',
              modelId: 'ybg-youlaber-ds4f',
              baseURL: 'https://gateway.baigongai.cn/v1',
              concurrency: 12,
              autoImport: true,
              createdAt: 1000,
              updatedAt: 2000,
              ...(jobStatus === 'completed'
                ? { importResult: { installed: true, readerUrl: '/reader/?book=cs-algorithms' } }
                : {}),
              subagentTasks: {},
            },
          }),
          { status: 200 }
        );
      }
      if (url.includes('/jobs/job_1/files')) {
        return new Response(
          JSON.stringify({
            jobId: 'job_1',
            entries: [
              { relPath: 'book/01_0.1.mdx', name: '01_0.1.mdx', isDirectory: false, sizeBytes: 512, mtimeMs: 1000 },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.includes('/jobs/job_1/file?path=')) {
        return new Response('---\ntitle: "0.1 Books"\n---\nHello\n', { status: 200 });
      }
      if (url.endsWith('/jobs/job_1/cancel')) {
        jobStatus = 'cancelled';
        return new Response(JSON.stringify({ job: { jobId: 'job_1', status: 'cancelled' } }), { status: 200 });
      }
      return new Response(JSON.stringify({ jobs: [] }), { status: 200 });
    });

    const store = new Pdf2AbpStore({
      fetchFn: mockFetch as unknown as typeof fetch,
      eventSourceFactory: () => {
        lastSse = new MockEventSource();
        return lastSse;
      },
    });

    const completedSpy = vi.fn();
    store.onJobCompleted(completedSpy);

    const health = await store.fetchHealth();
    expect(health?.ok).toBe(true);

    await store.startJob({
      pdfPath: 'D:\\algorithms.pdf',
      documentMode: 'textbook',
      concurrency: 12,
      instructions: 'Ch 0-4',
    });

    expect(store.getState().activeJobId).toBe('job_1');
    expect(store.getState().files).toHaveLength(1);
    expect(lastSse).not.toBeNull();

    // Simulate incoming SSE phase & completion events
    lastSse!.emit('phase_changed', {
      seq: 1,
      timestamp: 1500,
      jobId: 'job_1',
      agentId: 'main',
      type: 'phase_changed',
      message: 'Running MinerU',
      data: { phase: 'subagent_proofreading' },
    });
    expect(store.getState().activeJob?.phase).toBe('subagent_proofreading');
    expect(store.getState().events).toHaveLength(1);

    jobStatus = 'completed';
    lastSse!.emit('done', {
      job: {
        ...store.getState().activeJob!,
        status: 'completed',
        phase: 'done',
      },
    });
    expect(lastSse!.closed).toBe(true);
    expect(completedSpy).toHaveBeenCalledTimes(1);

    await store.previewFile('job_1', 'book/01_0.1.mdx');
    expect(store.getState().selectedFileContent).toContain('0.1 Books');

    store.dispose();
  });

  it('tracks live runningSubagents, untruncated milestoneEvents, auto-selects running job & probes manifests', async () => {
    let lastSse: MockEventSource | null = null;
    const runningJob = {
      jobId: 'job_mythical',
      sourcePdfPath: 'D:\\mythical.pdf',
      sourceFileName: '人月神话.pdf',
      workspaceDir: '/tmp/job_mythical',
      status: 'running',
      phase: 'subagent_proofreading',
      providerId: 'baigong',
      modelId: 'ybg-youlaber-ds4f',
      baseURL: 'https://gateway.baigongai.cn/v1',
      concurrency: 12,
      autoImport: true,
      createdAt: 1000,
      updatedAt: 2000,
      subagentTasks: {},
    };

    const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/jobs')) {
        return new Response(JSON.stringify({ jobs: [runningJob] }), { status: 200 });
      }
      if (url.endsWith('/jobs/job_mythical')) {
        return new Response(JSON.stringify({ job: runningJob }), { status: 200 });
      }
      if (url.includes('/jobs/job_mythical/files')) {
        return new Response(
          JSON.stringify({
            jobId: 'job_mythical',
            entries: [
              { relPath: 'book-plan.json', name: 'book-plan.json', isDirectory: false, sizeBytes: 512, mtimeMs: 10 },
              { relPath: 'chunks/manifest.json', name: 'manifest.json', isDirectory: false, sizeBytes: 1024, mtimeMs: 10 },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.includes('path=book-plan.json')) {
        return new Response(JSON.stringify({ documentMode: 'monograph', bookConfig: { title: '人月神话' }, chapters: [] }), { status: 200 });
      }
      if (url.includes('path=chunks%2Fmanifest.json')) {
        return new Response(
          JSON.stringify({
            totalWorkOrders: 1,
            workOrders: [
              {
                chunkId: 'ch1-s1',
                chapterTitle: '1.1 焦油坑',
                targetOutputRelPath: 'book/01_ch1.mdx',
                partIndex: 1,
                totalParts: 1,
                startPage: 1,
                endPage: 4,
              },
            ],
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({}), { status: 404 });
    });

    const store = new Pdf2AbpStore({
      fetchFn: mockFetch as unknown as typeof fetch,
      eventSourceFactory: () => {
        lastSse = new MockEventSource();
        return lastSse;
      },
    });

    await store.refreshJobs();
    // wait microtasks for auto-select selectJob + probes
    await new Promise((r) => setTimeout(r, 20));

    expect(store.getState().activeJobId).toBe('job_mythical');
    expect(store.getState().bookPlan?.bookConfig?.title).toBe('人月神话');
    expect(store.getState().chunksManifest?.totalWorkOrders).toBe(1);
    expect(lastSse).not.toBeNull();

    lastSse!.emit('subagent_started', {
      seq: 10,
      timestamp: 3000,
      jobId: 'job_mythical',
      agentId: 'subagent:ch1-s1',
      type: 'subagent_started',
      message: 'Started subagent ch1-s1 (1.1 焦油坑, p.1-4)',
      data: { taskId: 'ch1-s1', startPage: 1, endPage: 4, targetOutputRelPath: 'book/01_ch1.mdx' },
    });
    lastSse!.emit('tool_start', {
      seq: 11,
      timestamp: 3100,
      jobId: 'job_mythical',
      agentId: 'subagent:ch1-s1',
      type: 'tool_start',
      message: 'Calling inspect_pdf_page',
      data: { toolName: 'inspect_pdf_page' },
    });

    expect(store.getState().runningSubagents['ch1-s1']).toBeDefined();
    expect(store.getState().runningSubagents['ch1-s1']?.currentTool).toBe('inspect_pdf_page');
    expect(store.getState().milestoneEvents.some((e) => e.seq === 10)).toBe(true);

    lastSse!.emit('subagent_finished', {
      seq: 12,
      timestamp: 4000,
      jobId: 'job_mythical',
      agentId: 'subagent:ch1-s1',
      type: 'subagent_finished',
      message: 'Subagent ch1-s1 completed',
      data: { taskId: 'ch1-s1', status: 'completed', validationPassed: true, stepsUsed: 5 },
    });

    expect(store.getState().runningSubagents['ch1-s1']).toBeUndefined();
    expect(store.getState().activeJob?.subagentTasks?.['ch1-s1']?.validationPassed).toBe(true);
    store.dispose();
  });
});
