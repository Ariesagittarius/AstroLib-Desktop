import type {
  MineruAvailabilityStatus,
  Pdf2AbpEvent,
  Pdf2AbpJobState,
} from '../../../services/pdf2abp/types.ts';
import {
  parseSubagentStartedMessage,
  type RunningSubagentInfo,
} from './pdf2abp-timeline.ts';

export interface Pdf2AbpWorkspaceFile {
  relPath: string;
  name: string;
  isDirectory: boolean;
  sizeBytes: number;
  mtimeMs: number;
}

export interface Pdf2AbpHealthStatus {
  ok: boolean;
  mineru: MineruAvailabilityStatus;
  python: {
    available: boolean;
    executable?: string;
    version?: string;
  };
  defaultGateway: {
    providerId: string;
    modelId: string;
    baseURL: string;
  };
}

export interface Pdf2AbpStartInput {
  pdfPath: string;
  documentMode?: 'textbook' | 'paper' | 'exam' | 'monograph';
  concurrency?: number;
  autoImport?: boolean;
  instructions?: string;
}

export interface Pdf2AbpStoreState {
  health: Pdf2AbpHealthStatus | null;
  jobs: Pdf2AbpJobState[];
  activeJobId: string | null;
  activeJob: Pdf2AbpJobState | null;
  events: Pdf2AbpEvent[];
  milestoneEvents: Pdf2AbpEvent[];
  runningSubagents: Record<string, RunningSubagentInfo>;
  bookPlan: Record<string, any> | null;
  chunksManifest: Record<string, any> | null;
  mineruSummary: Record<string, any> | null;
  files: Pdf2AbpWorkspaceFile[];
  selectedFilePath: string | null;
  selectedFileContent: string | null;
  selectedFileIsImage: boolean;
  selectedFilePreviewUrl: string | null;
  loading: boolean;
  error: string | null;
}

export interface EventSourceLike {
  addEventListener(type: string, listener: (evt: { data: string }) => void): void;
  close(): void;
  onerror: ((err: any) => void) | null;
  onmessage: ((evt: any) => void) | null;
}

export interface Pdf2AbpStoreDeps {
  apiBase?: string;
  fetchFn?: typeof fetch;
  eventSourceFactory?: (url: string) => EventSourceLike;
}

type StoreListener = (state: Pdf2AbpStoreState) => void;
type CompletedListener = (job: Pdf2AbpJobState) => void;

const SSE_EVENT_TYPES = [
  'job_started',
  'phase_changed',
  'thinking',
  'tool_start',
  'tool_result',
  'vision_attached',
  'subagent_started',
  'subagent_finished',
  'artifact_written',
  'assistant_message',
  'warning',
  'error',
  'job_completed',
  'job_cancelled',
] as const;

const STRUCTURAL_EVENT_TYPES = new Set<string>([
  'job_started',
  'phase_changed',
  'subagent_started',
  'subagent_finished',
  'vision_attached',
  'warning',
  'error',
  'job_completed',
  'job_cancelled',
]);

const MAX_EVENT_LOG = 400;
const MAX_MILESTONE_LOG = 3000;
const PROBE_PATHS = [
  'book-plan.json',
  'chunks/manifest.json',
  'mineru/mineru-summary.json',
] as const;

function isStructuralMilestone(evt: Pdf2AbpEvent): boolean {
  if (STRUCTURAL_EVENT_TYPES.has(evt.type)) return true;
  if (evt.agentId === 'main' && (evt.type === 'tool_start' || evt.type === 'tool_result' || evt.type === 'assistant_message')) {
    return true;
  }
  if (evt.type === 'tool_result' && evt.data?.isError) {
    return true;
  }
  return false;
}

function extractTaskIdFromEvent(evt: Pdf2AbpEvent): string {
  if (typeof evt.data?.taskId === 'string' && evt.data.taskId) {
    return evt.data.taskId;
  }
  if (evt.agentId.startsWith('subagent:')) {
    return evt.agentId.slice('subagent:'.length);
  }
  return '';
}

export class Pdf2AbpStore {
  private readonly apiBase: string;
  private readonly fetchFn: typeof fetch;
  private readonly createEventSource: ((url: string) => EventSourceLike) | null;
  private readonly listeners = new Set<StoreListener>();
  private readonly completedListeners = new Set<CompletedListener>();
  private readonly notifiedCompletedJobs = new Set<string>();
  private activeSse: EventSourceLike | null = null;
  private activeSseJobId: string | null = null;
  private seenSeq = new Set<number>();
  private hasAutoSelected = false;
  private probeCacheSignature = new Map<string, string>();
  private scheduledFilesTimer: ReturnType<typeof setTimeout> | null = null;

  private state: Pdf2AbpStoreState = {
    health: null,
    jobs: [],
    activeJobId: null,
    activeJob: null,
    events: [],
    milestoneEvents: [],
    runningSubagents: {},
    bookPlan: null,
    chunksManifest: null,
    mineruSummary: null,
    files: [],
    selectedFilePath: null,
    selectedFileContent: null,
    selectedFileIsImage: false,
    selectedFilePreviewUrl: null,
    loading: false,
    error: null,
  };

  constructor(deps: Pdf2AbpStoreDeps = {}) {
    this.apiBase = (deps.apiBase || '/api/v1/pdf2abp').replace(/\/+$/, '');
    this.fetchFn = deps.fetchFn || ((input, init) => fetch(input, init));
    this.createEventSource =
      deps.eventSourceFactory ??
      (typeof EventSource !== 'undefined' ? (url: string) => new EventSource(url) : null);
  }

  public getState(): Pdf2AbpStoreState {
    return this.state;
  }

  public subscribe(listener: StoreListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public onJobCompleted(listener: CompletedListener): () => void {
    this.completedListeners.add(listener);
    return () => {
      this.completedListeners.delete(listener);
    };
  }

  private emit(): void {
    const snap = this.state;
    for (const fn of this.listeners) {
      fn(snap);
    }
  }

  private patch(partial: Partial<Pdf2AbpStoreState>): void {
    this.state = { ...this.state, ...partial };
    this.emit();
  }

  private upsertJob(job: Pdf2AbpJobState): void {
    const idx = this.state.jobs.findIndex((j) => j.jobId === job.jobId);
    const nextJobs =
      idx >= 0
        ? this.state.jobs.map((j, i) => (i === idx ? job : j))
        : [job, ...this.state.jobs];
    const isActive = this.state.activeJobId === job.jobId;
    this.patch({
      jobs: nextJobs,
      ...(isActive ? { activeJob: job } : {}),
    });

    if (job.status === 'completed' && !this.notifiedCompletedJobs.has(job.jobId)) {
      this.notifiedCompletedJobs.add(job.jobId);
      for (const cb of this.completedListeners) {
        cb(job);
      }
    }
  }

  private async requestJson<T>(relPath: string, init?: RequestInit): Promise<T> {
    const res = await this.fetchFn(`${this.apiBase}${relPath}`, init);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (data as { error?: string })?.error || `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return data as T;
  }

  public async fetchHealth(): Promise<Pdf2AbpHealthStatus | null> {
    try {
      const health = await this.requestJson<Pdf2AbpHealthStatus>('/health');
      this.patch({ health, error: null });
      return health;
    } catch (err) {
      this.patch({ error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  }

  public async refreshJobs(): Promise<Pdf2AbpJobState[]> {
    try {
      const res = await this.requestJson<{ jobs: Pdf2AbpJobState[] }>('/jobs');
      const jobs = res.jobs || [];
      const activeJob =
        this.state.activeJobId
          ? jobs.find((j) => j.jobId === this.state.activeJobId) ?? this.state.activeJob
          : this.state.activeJob;
      this.patch({ jobs, activeJob, error: null });

      if (this.state.activeJobId === null && jobs.length > 0 && !this.hasAutoSelected) {
        this.hasAutoSelected = true;
        const preferred =
          jobs.find((j) => j.status === 'running' || j.status === 'pending') ?? jobs[0];
        if (preferred) {
          void this.selectJob(preferred.jobId);
        }
      }
      return jobs;
    } catch (err) {
      this.patch({ error: err instanceof Error ? err.message : String(err) });
      return [];
    }
  }

  public async startJob(input: Pdf2AbpStartInput): Promise<Pdf2AbpJobState> {
    const pdfPath = input.pdfPath.trim();
    if (!pdfPath) {
      throw new Error('请输入源 PDF 路径');
    }

    const modeTag =
      input.documentMode && input.documentMode !== 'textbook'
        ? `[documentMode=${input.documentMode}] `
        : '';
    const mergedInstructions = `${modeTag}${(input.instructions || '').trim()}`.trim();

    this.patch({ loading: true, error: null });
    try {
      const res = await this.requestJson<{ job: Pdf2AbpJobState }>('/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pdfPath,
          concurrency: input.concurrency ?? 12,
          autoImport: input.autoImport ?? true,
          ...(mergedInstructions ? { instructions: mergedInstructions } : {}),
        }),
      });
      this.upsertJob(res.job);
      this.patch({ loading: false });
      await this.selectJob(res.job.jobId);
      return res.job;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.patch({ loading: false, error: msg });
      throw err;
    }
  }

  public async selectJob(jobId: string): Promise<void> {
    this.closeStream();
    if (this.scheduledFilesTimer) {
      clearTimeout(this.scheduledFilesTimer);
      this.scheduledFilesTimer = null;
    }
    this.seenSeq.clear();
    this.probeCacheSignature.clear();
    this.hasAutoSelected = true;

    this.patch({
      activeJobId: jobId,
      events: [],
      milestoneEvents: [],
      runningSubagents: {},
      bookPlan: null,
      chunksManifest: null,
      mineruSummary: null,
      files: [],
      selectedFilePath: null,
      selectedFileContent: null,
      selectedFileIsImage: false,
      selectedFilePreviewUrl: null,
      loading: true,
      error: null,
    });

    try {
      const res = await this.requestJson<{ job: Pdf2AbpJobState }>(
        `/jobs/${encodeURIComponent(jobId)}`
      );
      this.upsertJob(res.job);
      this.patch({ activeJob: res.job, loading: false });
      const entries = await this.refreshFiles(jobId);

      if (res.job.status === 'running' || res.job.status === 'pending') {
        this.openStream(jobId);
      } else if (entries.some((e) => !e.isDirectory && e.relPath === 'events.jsonl')) {
        void this.loadHistoricalEventsFromFile(jobId);
      }
    } catch (err) {
      this.patch({
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async loadHistoricalEventsFromFile(jobId: string): Promise<void> {
    try {
      const fileUrl = `${this.apiBase}/jobs/${encodeURIComponent(jobId)}/file?path=events.jsonl`;
      const res = await this.fetchFn(fileUrl);
      if (!res.ok) return;
      const raw = await res.text();
      if (this.state.activeJobId !== jobId) return;

      const lines = raw.split(/\r?\n/);
      let nextEvents = [...this.state.events];
      let nextMilestones = [...this.state.milestoneEvents];
      let nextRunning = { ...this.state.runningSubagents };
      let nextActive = this.state.activeJob;

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const evt = JSON.parse(trimmed) as Pdf2AbpEvent;
          if (!evt || typeof evt.seq !== 'number' || this.seenSeq.has(evt.seq)) continue;
          this.seenSeq.add(evt.seq);
          const applied = this.reduceEvent(evt, nextEvents, nextMilestones, nextRunning, nextActive);
          nextEvents = applied.events;
          nextMilestones = applied.milestoneEvents;
          nextRunning = applied.runningSubagents;
          nextActive = applied.activeJob;
        } catch {

        }
      }

      this.patch({
        events: nextEvents.slice(-MAX_EVENT_LOG),
        milestoneEvents: nextMilestones.slice(-MAX_MILESTONE_LOG),
        runningSubagents: nextRunning,
        ...(nextActive ? { activeJob: nextActive } : {}),
      });
    } catch {

    }
  }

  private reduceEvent(
    evt: Pdf2AbpEvent,
    events: Pdf2AbpEvent[],
    milestoneEvents: Pdf2AbpEvent[],
    runningSubagents: Record<string, RunningSubagentInfo>,
    activeJob: Pdf2AbpJobState | null
  ): {
    events: Pdf2AbpEvent[];
    milestoneEvents: Pdf2AbpEvent[];
    runningSubagents: Record<string, RunningSubagentInfo>;
    activeJob: Pdf2AbpJobState | null;
  } {
    const nextEvents = [...events, evt].slice(-MAX_EVENT_LOG);
    const nextMilestones = isStructuralMilestone(evt)
      ? [...milestoneEvents, evt].slice(-MAX_MILESTONE_LOG)
      : milestoneEvents;

    let nextRunning = runningSubagents;
    const taskId = extractTaskIdFromEvent(evt);

    if (evt.type === 'subagent_started' && taskId) {
      const parsed = parseSubagentStartedMessage(evt.message);
      const prev = nextRunning[taskId];
      nextRunning = {
        ...nextRunning,
        [taskId]: {
          taskId,
          title:
            (typeof evt.data?.title === 'string' && evt.data.title) ||
            parsed.title ||
            prev?.title,
          startPage:
            typeof evt.data?.startPage === 'number'
              ? evt.data.startPage
              : parsed.startPage ?? prev?.startPage,
          endPage:
            typeof evt.data?.endPage === 'number'
              ? evt.data.endPage
              : parsed.endPage ?? prev?.endPage,
          targetOutputRelPath:
            typeof evt.data?.targetOutputRelPath === 'string'
              ? evt.data.targetOutputRelPath
              : prev?.targetOutputRelPath,
          startedAt: prev?.startedAt || evt.timestamp,
          updatedAt: evt.timestamp,
          currentTool: prev?.currentTool,
          recentTools: prev?.recentTools || [],
          visionRelPath: prev?.visionRelPath,
        },
      };
    } else if (evt.type === 'subagent_finished' && taskId) {
      if (nextRunning[taskId]) {
        const copy = { ...nextRunning };
        delete copy[taskId];
        nextRunning = copy;
      }
    } else if (evt.agentId.startsWith('subagent:') && taskId && nextRunning[taskId]) {
      const prev = nextRunning[taskId];
      let nextTool = prev.currentTool;
      let nextRecent = prev.recentTools;
      let nextVision = prev.visionRelPath;

      if (evt.type === 'tool_start') {
        const toolName =
          (typeof evt.data?.toolName === 'string' && evt.data.toolName) ||
          evt.message.replace(/^Calling\s+/i, '').trim();
        nextTool = toolName;
        nextRecent = [...prev.recentTools.filter((t) => t !== toolName), toolName].slice(-5);
      } else if (evt.type === 'vision_attached' && typeof evt.data?.relPath === 'string') {
        nextVision = evt.data.relPath;
      }

      if (nextTool !== prev.currentTool || nextVision !== prev.visionRelPath) {
        nextRunning = {
          ...nextRunning,
          [taskId]: {
            ...prev,
            updatedAt: evt.timestamp,
            currentTool: nextTool,
            recentTools: nextRecent,
            visionRelPath: nextVision,
          },
        };
      }
    }

    let nextActive = activeJob;
    if (nextActive && nextActive.jobId === evt.jobId) {
      if (evt.type === 'phase_changed' && typeof evt.data?.phase === 'string') {
        nextActive = {
          ...nextActive,
          phase: evt.data.phase as Pdf2AbpJobState['phase'],
          updatedAt: evt.timestamp,
        };
      }
      if (evt.type === 'subagent_finished' && taskId) {
        const prevMap = nextActive.subagentTasks || {};
        nextActive = {
          ...nextActive,
          subagentTasks: {
            ...prevMap,
            [taskId]: {
              ...(prevMap[taskId] || {}),
              ...(evt.data as unknown as NonNullable<Pdf2AbpJobState['subagentTasks']>[string]),
            },
          },
          updatedAt: evt.timestamp,
        };
      }
    }

    return {
      events: nextEvents,
      milestoneEvents: nextMilestones,
      runningSubagents: nextRunning,
      activeJob: nextActive,
    };
  }

  private handleIncomingEvent(evt: Pdf2AbpEvent): void {
    if (this.seenSeq.has(evt.seq)) return;
    this.seenSeq.add(evt.seq);

    const applied = this.reduceEvent(
      evt,
      this.state.events,
      this.state.milestoneEvents,
      this.state.runningSubagents,
      this.state.activeJob
    );

    this.patch({
      events: applied.events,
      milestoneEvents: applied.milestoneEvents,
      runningSubagents: applied.runningSubagents,
      ...(applied.activeJob ? { activeJob: applied.activeJob } : {}),
    });

    if (evt.type === 'artifact_written' && this.state.activeJobId === evt.jobId) {
      const writtenPath = typeof evt.data?.relPath === 'string' ? evt.data.relPath : '';
      if (PROBE_PATHS.includes(writtenPath as (typeof PROBE_PATHS)[number])) {
        void this.refreshFiles(evt.jobId);
      } else {
        this.scheduleRefreshFiles(evt.jobId);
      }
    }
    if (evt.type === 'job_completed' || evt.type === 'job_cancelled') {
      void this.refreshSingleJob(evt.jobId);
      void this.refreshFiles(evt.jobId);
      this.closeStream();
    }
  }

  private scheduleRefreshFiles(jobId: string): void {
    if (this.scheduledFilesTimer) return;
    this.scheduledFilesTimer = setTimeout(() => {
      this.scheduledFilesTimer = null;
      if (this.state.activeJobId === jobId) {
        void this.refreshFiles(jobId);
      }
    }, 1500);
  }

  private async refreshSingleJob(jobId: string): Promise<void> {
    try {
      const res = await this.requestJson<{ job: Pdf2AbpJobState }>(
        `/jobs/${encodeURIComponent(jobId)}`
      );
      this.upsertJob(res.job);
    } catch {

    }
  }

  private openStream(jobId: string): void {
    if (!this.createEventSource) return;
    this.closeStream();

    const sse = this.createEventSource(`${this.apiBase}/jobs/${encodeURIComponent(jobId)}/stream`);
    this.activeSse = sse;
    this.activeSseJobId = jobId;

    for (const typeName of SSE_EVENT_TYPES) {
      sse.addEventListener(typeName, (raw) => {
        try {
          const parsed = JSON.parse(raw.data) as Pdf2AbpEvent;
          if (parsed && typeof parsed.seq === 'number') {
            this.handleIncomingEvent(parsed);
          }
        } catch {

        }
      });
    }

    sse.addEventListener('done', (raw) => {
      try {
        const payload = JSON.parse(raw.data) as { job?: Pdf2AbpJobState };
        if (payload?.job) {
          this.upsertJob(payload.job);
        }
      } catch {

      }
      void this.refreshFiles(jobId);
      this.closeStream();
    });

    sse.onmessage = (raw) => {
      try {
        const parsed = JSON.parse(raw.data) as Pdf2AbpEvent;
        if (parsed && typeof parsed.seq === 'number') {
          this.handleIncomingEvent(parsed);
        }
      } catch {

      }
    };

    sse.onerror = () => {
      if (this.activeSseJobId === jobId) {
        void this.refreshSingleJob(jobId);
      }
    };
  }

  private closeStream(): void {
    if (this.activeSse) {
      this.activeSse.close();
      this.activeSse = null;
      this.activeSseJobId = null;
    }
  }

  public async cancelJob(jobId: string): Promise<Pdf2AbpJobState | null> {
    try {
      const res = await this.requestJson<{ job: Pdf2AbpJobState }>(
        `/jobs/${encodeURIComponent(jobId)}/cancel`,
        { method: 'POST' }
      );
      this.upsertJob(res.job);
      this.closeStream();
      return res.job;
    } catch (err) {
      this.patch({ error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  }

  public async resumeJob(jobId: string): Promise<Pdf2AbpJobState | null> {
    try {
      const res = await this.requestJson<{ job: Pdf2AbpJobState }>(
        `/jobs/${encodeURIComponent(jobId)}/resume`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }
      );
      this.upsertJob(res.job);
      await this.selectJob(res.job.jobId);
      return res.job;
    } catch (err) {
      this.patch({ error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  }

  private async probeStructuredManifests(
    jobId: string,
    entries: Pdf2AbpWorkspaceFile[]
  ): Promise<void> {
    const byRel = new Map<string, Pdf2AbpWorkspaceFile>();
    for (const f of entries) {
      if (!f.isDirectory) byRel.set(f.relPath, f);
    }

    const targets: Array<{
      relPath: (typeof PROBE_PATHS)[number];
      field: 'bookPlan' | 'chunksManifest' | 'mineruSummary';
    }> = [
      { relPath: 'book-plan.json', field: 'bookPlan' },
      { relPath: 'chunks/manifest.json', field: 'chunksManifest' },
      { relPath: 'mineru/mineru-summary.json', field: 'mineruSummary' },
    ];

    const updates: Partial<Pdf2AbpStoreState> = {};

    await Promise.all(
      targets.map(async ({ relPath, field }) => {
        const entry = byRel.get(relPath);
        if (!entry) return;
        const cacheKey = `${jobId}:${relPath}`;
        const sig = `${entry.sizeBytes}:${entry.mtimeMs}`;
        if (this.probeCacheSignature.get(cacheKey) === sig) return;

        try {
          const url = `${this.apiBase}/jobs/${encodeURIComponent(jobId)}/file?path=${encodeURIComponent(relPath)}`;
          const res = await this.fetchFn(url);
          if (!res.ok) return;
          const parsed = (await res.json()) as Record<string, any>;
          if (parsed && typeof parsed === 'object') {
            this.probeCacheSignature.set(cacheKey, sig);
            updates[field] = parsed;
          }
        } catch {

        }
      })
    );

    if (this.state.activeJobId === jobId && Object.keys(updates).length > 0) {
      this.patch(updates);
    }
  }

  public async refreshFiles(jobId: string, dir = ''): Promise<Pdf2AbpWorkspaceFile[]> {
    try {
      const qs = new URLSearchParams({ maxDepth: '3' });
      if (dir) qs.set('dir', dir);
      const res = await this.requestJson<{ entries: Pdf2AbpWorkspaceFile[] }>(
        `/jobs/${encodeURIComponent(jobId)}/files?${qs.toString()}`
      );
      const entries = res.entries || [];
      if (this.state.activeJobId === jobId) {
        this.patch({ files: entries });
        void this.probeStructuredManifests(jobId, entries);
      }
      return entries;
    } catch {
      return [];
    }
  }

  public async previewFile(jobId: string, relPath: string): Promise<void> {
    const fileUrl = `${this.apiBase}/jobs/${encodeURIComponent(jobId)}/file?path=${encodeURIComponent(relPath)}`;
    if (/\.(jpe?g|png|webp|gif|svg)$/i.test(relPath)) {
      this.patch({
        selectedFilePath: relPath,
        selectedFileContent: null,
        selectedFileIsImage: true,
        selectedFilePreviewUrl: fileUrl,
      });
      return;
    }

    try {
      const res = await this.fetchFn(fileUrl);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const raw = await res.text();
      const clipped = raw.length > 120_000 ? `${raw.slice(0, 120_000)}\n\n... [truncated]` : raw;
      this.patch({
        selectedFilePath: relPath,
        selectedFileContent: clipped,
        selectedFileIsImage: false,
        selectedFilePreviewUrl: null,
      });
    } catch (err) {
      this.patch({
        selectedFilePath: relPath,
        selectedFileContent: `无法读取文件: ${err instanceof Error ? err.message : String(err)}`,
        selectedFileIsImage: false,
        selectedFilePreviewUrl: null,
      });
    }
  }

  public clearPreview(): void {
    this.patch({
      selectedFilePath: null,
      selectedFileContent: null,
      selectedFileIsImage: false,
      selectedFilePreviewUrl: null,
    });
  }

  public dispose(): void {
    this.closeStream();
    if (this.scheduledFilesTimer) {
      clearTimeout(this.scheduledFilesTimer);
      this.scheduledFilesTimer = null;
    }
    this.listeners.clear();
    this.completedListeners.clear();
  }
}

let sharedStore: Pdf2AbpStore | null = null;

export function getPdf2AbpStore(): Pdf2AbpStore {
  if (!sharedStore) {
    sharedStore = new Pdf2AbpStore();
  }
  return sharedStore;
}
