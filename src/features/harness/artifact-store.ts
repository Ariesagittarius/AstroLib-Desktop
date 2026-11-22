/**
 * src/features/harness/artifact-store.ts
 * ============================================================================
 * AstroLib 多态成果物历史仓状态机 (Polymorphic Artifact Hub Store)
 * ============================================================================
 * 职责：
 * 1. 统一托管 PDF2ABP 任务、AstroCanvas 交互画布、章节 AST、Python 产物与源码 Diff；
 * 2. 彻底替代旧版单槽覆盖模式，支持列表/详情双向切换、按类型筛选与历史回溯；
 * 3. 为交互画布 (Canvas) 提供不可变版本快照栈与撤销/重做能力。
 * ============================================================================
 */

import type {
  ArtifactItem,
  ArtifactKind,
  ArtifactPythonResult,
  ArtifactVersion,
  CanvasTelemetrySnapshot,
} from './types.ts';

export type ArtifactFilterKind = ArtifactKind | 'all';
export type ArtifactHubViewMode = 'list' | 'detail';

export interface ArtifactStoreState {
  items: ArtifactItem[];
  activeArtifactId: string | null;
  filterKind: ArtifactFilterKind;
  viewMode: ArtifactHubViewMode;
}

const ARTIFACT_STORAGE_KEY = 'astrolib_harness_artifacts_v1';
const MAX_STORED_ARTIFACTS = 40;

export class ArtifactStore {
  private static instance: ArtifactStore | null = null;
  private state: ArtifactStoreState;
  private listeners = new Set<(state: ArtifactStoreState) => void>();

  public static getInstance(): ArtifactStore {
    if (!ArtifactStore.instance) {
      ArtifactStore.instance = new ArtifactStore();
    }
    return ArtifactStore.instance;
  }

  /** 允许单测创建独立实例 */
  public static createIsolated(): ArtifactStore {
    return new ArtifactStore(true);
  }

  private constructor(skipStorage = false) {
    this.state = {
      items: skipStorage ? [] : this.loadFromStorage(),
      activeArtifactId: null,
      filterKind: 'all',
      viewMode: 'list',
    };
  }

  private loadFromStorage(): ArtifactItem[] {
    try {
      if (typeof localStorage === 'undefined') return [];
      const raw = localStorage.getItem(ARTIFACT_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private saveToStorage(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      let toSave = this.state.items
        .slice(0, MAX_STORED_ARTIFACTS)
        .map((item) =>
          item.screenshotDataUrl ? { ...item, screenshotDataUrl: undefined } : item
        );
      let serialized = JSON.stringify(toSave);
      while (serialized.length > 1_500_000 && toSave.length > 1) {
        toSave = toSave.slice(0, toSave.length - 1);
        serialized = JSON.stringify(toSave);
      }
      localStorage.setItem(ARTIFACT_STORAGE_KEY, serialized);
    } catch {}
  }

  private emit(): void {
    this.saveToStorage();
    for (const fn of this.listeners) {
      try {
        fn(this.state);
      } catch {}
    }
  }

  public subscribe(listener: (state: ArtifactStoreState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getState(): ArtifactStoreState {
    return this.state;
  }

  public getArtifact(id: string): ArtifactItem | undefined {
    return this.state.items.find((item) => item.id === id);
  }

  public getActiveArtifact(): ArtifactItem | undefined {
    if (!this.state.activeArtifactId) return undefined;
    return this.getArtifact(this.state.activeArtifactId);
  }

  public setFilterKind(kind: ArtifactFilterKind): void {
    this.state = { ...this.state, filterKind: kind };
    this.emit();
  }

  public showList(): void {
    this.state = { ...this.state, viewMode: 'list' };
    this.emit();
  }

  public selectArtifact(id: string, enterDetail = true): ArtifactItem | undefined {
    const found = this.getArtifact(id);
    if (!found) return undefined;
    this.state = {
      ...this.state,
      activeArtifactId: id,
      viewMode: enterDetail ? 'detail' : this.state.viewMode,
    };
    this.emit();
    return found;
  }

  public upsertArtifact(
    input: Omit<ArtifactItem, 'id' | 'createdAt' | 'updatedAt'> & {
      id?: string;
      createdAt?: number;
      updatedAt?: number;
    },
    options: { activate?: boolean } = {}
  ): ArtifactItem {
    const now = Date.now();
    const id = input.id || `art-${now}-${Math.random().toString(36).slice(2, 7)}`;
    const existingIdx = this.state.items.findIndex((i) => i.id === id);

    let item: ArtifactItem;
    if (existingIdx >= 0) {
      const prev = this.state.items[existingIdx];
      item = {
        ...prev,
        ...input,
        id,
        createdAt: prev.createdAt,
        updatedAt: input.updatedAt ?? now,
      };
      const nextItems = [...this.state.items];
      nextItems.splice(existingIdx, 1);
      nextItems.unshift(item);
      this.state = {
        ...this.state,
        items: nextItems,
        ...(options.activate
          ? { activeArtifactId: id, viewMode: 'detail' as ArtifactHubViewMode }
          : {}),
      };
    } else {
      item = {
        ...input,
        id,
        createdAt: input.createdAt ?? now,
        updatedAt: input.updatedAt ?? now,
      };
      if (item.kind === 'canvas' && item.code && (!item.versions || item.versions.length === 0)) {
        item.versions = [
          {
            version: 1,
            timestamp: now,
            code: item.code,
            summary: '初始版本',
          },
        ];
        item.activeVersionIndex = 0;
      }
      this.state = {
        ...this.state,
        items: [item, ...this.state.items].slice(0, MAX_STORED_ARTIFACTS),
        ...(options.activate
          ? { activeArtifactId: id, viewMode: 'detail' as ArtifactHubViewMode }
          : {}),
      };
    }

    this.emit();
    return item;
  }

  /**
   * 同步 PDF2ABP 任务至历史仓（同 jobId 仅维护唯一记录）
   */
  public syncPdf2AbpJob(job: {
    jobId: string;
    sourceFileName: string;
    status: string;
    phase: string;
    createdAt: number;
    updatedAt: number;
  }, activate = false): ArtifactItem {
    const id = `pdf2abp:${job.jobId}`;
    const statusMap: Record<string, string> = {
      pending: '排队中',
      running: '构建中',
      completed: '已完成',
      failed: '失败',
      cancelled: '已中止',
    };
    return this.upsertArtifact(
      {
        id,
        kind: 'pdf2abp',
        title: job.sourceFileName || `PDF2ABP 任务 ${job.jobId}`,
        badge: statusMap[job.status] || job.status,
        pdf2abpJobId: job.jobId,
        sourceCommand: '/pdf2abp',
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
      },
      { activate }
    );
  }

  /**
   * 追加画布新版本，支持版本回溯
   */
  public pushCanvasVersion(
    id: string,
    nextCode: string,
    summary?: string,
    title?: string
  ): ArtifactItem | undefined {
    const item = this.getArtifact(id);
    if (!item || item.kind !== 'canvas') return undefined;

    const versions: ArtifactVersion[] = [...(item.versions || [])];
    const currentIdx = item.activeVersionIndex ?? Math.max(0, versions.length - 1);
    const truncated = versions.slice(0, currentIdx + 1);
    const nextVersionNum = (truncated[truncated.length - 1]?.version || 0) + 1;
    const now = Date.now();
    truncated.push({
      version: nextVersionNum,
      timestamp: now,
      code: nextCode,
      summary: summary || `v${nextVersionNum}`,
    });

    return this.upsertArtifact({
      ...item,
      ...(title ? { title } : {}),
      code: nextCode,
      badge: `Canvas · v${nextVersionNum}`,
      versions: truncated,
      activeVersionIndex: truncated.length - 1,
      updatedAt: now,
    });
  }

  public stepCanvasVersion(id: string, delta: -1 | 1): ArtifactItem | undefined {
    const item = this.getArtifact(id);
    if (!item || item.kind !== 'canvas' || !item.versions || item.versions.length === 0) {
      return undefined;
    }
    const curr = item.activeVersionIndex ?? item.versions.length - 1;
    const nextIdx = curr + delta;
    if (nextIdx < 0 || nextIdx >= item.versions.length) return undefined;

    const targetVer = item.versions[nextIdx];
    return this.upsertArtifact({
      ...item,
      code: targetVer.code,
      badge: `Canvas · v${targetVer.version}`,
      activeVersionIndex: nextIdx,
    });
  }

  public recordPythonRun(opts: {
    title: string;
    code: string;
    result: ArtifactPythonResult;
  }): ArtifactItem {
    return this.upsertArtifact({
      kind: 'python',
      title: opts.title,
      badge: opts.result.exitCode === 0 ? `Python · ${opts.result.durationMs}ms` : `Exit ${opts.result.exitCode}`,
      code: opts.code,
      pythonResult: opts.result,
      sourceCommand: 'run_python',
    });
  }

  public updateCanvasTelemetry(
    artifactId: string,
    telemetry: CanvasTelemetrySnapshot,
    screenshotDataUrl?: string
  ): void {
    const item = this.getArtifact(artifactId);
    if (!item) return;
    item.canvasTelemetry = telemetry;
    if (screenshotDataUrl) {
      item.screenshotDataUrl = screenshotDataUrl;
    }
    this.saveToStorage();
  }

  public removeArtifact(id: string): void {
    const nextItems = this.state.items.filter((i) => i.id !== id);
    const nextActive = this.state.activeArtifactId === id ? null : this.state.activeArtifactId;
    this.state = {
      ...this.state,
      items: nextItems,
      activeArtifactId: nextActive,
      viewMode: nextActive ? this.state.viewMode : 'list',
    };
    this.emit();
  }

  public clearNonRunning(): void {
    const nextItems = this.state.items.filter((i) => i.kind === 'pdf2abp');
    this.state = {
      ...this.state,
      items: nextItems,
      activeArtifactId: nextItems.some((i) => i.id === this.state.activeArtifactId)
        ? this.state.activeArtifactId
        : null,
      viewMode: 'list',
    };
    this.emit();
  }
}
