import '@material/web/button/filled-button.js';
import '@material/web/button/outlined-button.js';
import '@material/web/button/text-button.js';
import '@material/web/divider/divider.js';

import './pdf2abp.css';
import type { Pdf2AbpEvent, Pdf2AbpJobState } from '../../../services/pdf2abp/types.ts';
import type {
  Pdf2AbpStore,
  Pdf2AbpStoreState,
  Pdf2AbpWorkspaceFile,
} from './pdf2abp-store.ts';
import {
  projectPdf2AbpTimeline,
  type Pdf2AbpTimelineModel,
  type SubagentSliceItem,
  type TimelineStageItem,
} from './pdf2abp-timeline.ts';
import { openPdf2AbpLauncherDialog } from './pdf2abp-launcher-dialog.ts';

type PanelTabKey = 'timeline' | 'files' | 'events';
type MatrixFilterKey = 'all' | 'running' | 'completed' | 'failed';
type EventFilterKey = 'all' | 'main' | 'subagent' | 'warn';

function esc(str: unknown): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatClock(ts: number): string {
  try {
    return new Date(ts).toTimeString().slice(0, 8);
  } catch {
    return '';
  }
}

export function formatDurationMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return '--';
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  if (mins < 60) return `${mins}m ${String(secs).padStart(2, '0')}s`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hrs}h ${String(remMins).padStart(2, '0')}m`;
}

function groupWorkspaceFiles(
  files: Pdf2AbpWorkspaceFile[]
): Array<{ key: string; title: string; defaultOpen: boolean; items: Pdf2AbpWorkspaceFile[] }> {
  const nonDirs = files.filter((f) => !f.isDirectory);
  const groups = new Map<string, Pdf2AbpWorkspaceFile[]>([
    ['plan', []],
    ['mdx', []],
    ['vision', []],
    ['verify', []],
    ['other', []],
  ]);

  for (const f of nonDirs) {
    const p = f.relPath;
    if (
      p === 'book-plan.json' ||
      p === 'book/book.json' ||
      p === 'chunks/manifest.json' ||
      p === 'mineru/structure-analysis.json' ||
      p === 'mineru/mineru-summary.json'
    ) {
      groups.get('plan')!.push(f);
    } else if (/^book\/.*\.mdx$/i.test(p) || /^chunks\/.*\.mdx$/i.test(p)) {
      groups.get('mdx')!.push(f);
    } else if (/\.(jpe?g|png|webp|gif|svg)$/i.test(p) || p.startsWith('vision/')) {
      groups.get('vision')!.push(f);
    } else if (
      p === 'job-state.json' ||
      p === 'chunks/coverage-audit.json' ||
      p.endsWith('.abp') ||
      /validation|verify|compile/i.test(p)
    ) {
      groups.get('verify')!.push(f);
    } else {
      groups.get('other')!.push(f);
    }
  }

  return [
    { key: 'plan', title: '配置与结构规划', defaultOpen: true, items: groups.get('plan')! },
    { key: 'mdx', title: '章节正文 (MDX)', defaultOpen: true, items: groups.get('mdx')! },
    { key: 'vision', title: '多模态视觉与插图', defaultOpen: false, items: groups.get('vision')! },
    { key: 'verify', title: '校验、审计与档案包', defaultOpen: true, items: groups.get('verify')! },
    { key: 'other', title: '日志与过程文件', defaultOpen: false, items: groups.get('other')! },
  ].filter((g) => g.items.length > 0);
}

export class Pdf2AbpArtifactsPanel {
  private readonly store: Pdf2AbpStore;
  private container: HTMLElement | null = null;
  private unsubscribe: (() => void) | null = null;
  private rafPending = false;
  private latestState: Pdf2AbpStoreState | null = null;
  private tickTimer: number | null = null;

  private activeTab: PanelTabKey = 'timeline';
  private matrixFilter: MatrixFilterKey = 'all';
  private eventFilter: EventFilterKey = 'all';
  private detailOpenState = new Map<string, boolean>([
    ['subagent-matrix', true],
    ['grp:plan', true],
    ['grp:mdx', true],
    ['grp:verify', true],
  ]);

  private lastJobSelectKey = '';
  private lastMetaKey = '';
  private lastTablistKey = '';
  private lastTimelineKey = '';
  private lastFilesTreeKey = '';
  private lastFilePreviewKey = '';
  private lastEventsKey = '';

  private onContainerClick = (ev: MouseEvent): void => {
    const t = ev.target as HTMLElement | null;
    if (!t || !this.container) return;

    const tabBtn = t.closest<HTMLElement>('[data-panel-tab]');
    if (tabBtn) {
      const nextTab = tabBtn.getAttribute('data-panel-tab') as PanelTabKey | null;
      if (nextTab && nextTab !== this.activeTab) {
        this.activeTab = nextTab;
        this.renderNow(this.store.getState());
      }
      return;
    }

    if (t.closest('#pdf2abp-panel-new-btn')) {
      void openPdf2AbpLauncherDialog(this.store);
      return;
    }

    if (t.closest('#pdf2abp-refresh-btn')) {
      void this.store.refreshJobs();
      const activeId = this.store.getState().activeJobId;
      if (activeId) {
        void this.store.selectJob(activeId);
      }
      return;
    }

    if (t.closest('#pdf2abp-cancel-job-btn')) {
      const id = this.store.getState().activeJobId;
      if (id) void this.store.cancelJob(id);
      return;
    }

    if (t.closest('#pdf2abp-resume-job-btn')) {
      const id = this.store.getState().activeJobId;
      if (id) void this.store.resumeJob(id);
      return;
    }

    if (t.closest('#pdf2abp-close-preview-btn')) {
      this.store.clearPreview();
      return;
    }

    const matrixFilterBtn = t.closest<HTMLElement>('[data-matrix-filter]');
    if (matrixFilterBtn) {
      const nextFilter = matrixFilterBtn.getAttribute('data-matrix-filter') as MatrixFilterKey | null;
      if (nextFilter) {
        this.matrixFilter = nextFilter;
        this.renderNow(this.store.getState());
      }
      return;
    }

    const eventFilterBtn = t.closest<HTMLElement>('[data-event-filter]');
    if (eventFilterBtn) {
      const nextFilter = eventFilterBtn.getAttribute('data-event-filter') as EventFilterKey | null;
      if (nextFilter) {
        this.eventFilter = nextFilter;
        this.renderNow(this.store.getState());
      }
      return;
    }

    const jumpFileBtn = t.closest<HTMLElement>('[data-jump-file]');
    if (jumpFileBtn) {
      const relPath = jumpFileBtn.getAttribute('data-jump-file');
      const id = this.store.getState().activeJobId;
      if (id && relPath) {
        this.activeTab = 'files';
        this.renderNow(this.store.getState());
        void this.store.previewFile(id, relPath);
      }
      return;
    }

    const fileBtn = t.closest<HTMLElement>('[data-file-path]');
    if (fileBtn) {
      const relPath = fileBtn.getAttribute('data-file-path');
      const id = this.store.getState().activeJobId;
      if (id && relPath) {
        void this.store.previewFile(id, relPath);
      }
      return;
    }
  };

  private onContainerChange = (ev: Event): void => {
    const t = ev.target as HTMLSelectElement | null;
    if (t && t.id === 'pdf2abp-job-select' && t.value) {
      void this.store.selectJob(t.value);
    }
  };

  private onContainerToggle = (ev: Event): void => {
    const details = ev.target as HTMLDetailsElement | null;
    if (!details || details.tagName !== 'DETAILS') return;
    const key = details.getAttribute('data-detail-key');
    if (key) {
      this.detailOpenState.set(key, details.open);
    }
  };

  private onContainerKeyDown = (ev: KeyboardEvent): void => {
    const target = ev.target as HTMLElement | null;
    if (!target || target.getAttribute('role') !== 'tab' || !this.container) return;
    const tabs = Array.from(this.container.querySelectorAll<HTMLElement>('[role="tab"]'));
    const idx = tabs.indexOf(target);
    if (idx < 0 || tabs.length === 0) return;

    let nextIdx = -1;
    if (ev.key === 'ArrowRight') nextIdx = (idx + 1) % tabs.length;
    else if (ev.key === 'ArrowLeft') nextIdx = (idx - 1 + tabs.length) % tabs.length;
    else if (ev.key === 'Home') nextIdx = 0;
    else if (ev.key === 'End') nextIdx = tabs.length - 1;
    if (nextIdx < 0) return;

    ev.preventDefault();
    const nextTab = tabs[nextIdx];
    const tabKey = nextTab.getAttribute('data-panel-tab') as PanelTabKey | null;
    if (tabKey) {
      this.activeTab = tabKey;
      this.renderNow(this.store.getState());
      const focusTarget = this.container.querySelector<HTMLElement>(`[data-panel-tab="${tabKey}"]`);
      focusTarget?.focus();
    }
  };

  constructor(store: Pdf2AbpStore) {
    this.store = store;
  }

  public mount(container: HTMLElement): void {
    if (this.container === container && this.unsubscribe) return;
    this.unmount();
    this.container = container;
    container.addEventListener('click', this.onContainerClick);
    container.addEventListener('change', this.onContainerChange);
    container.addEventListener('toggle', this.onContainerToggle, true);
    container.addEventListener('keydown', this.onContainerKeyDown);

    this.unsubscribe = this.store.subscribe((state) => {
      this.latestState = state;
      if (this.container && this.container.childElementCount === 0) {
        this.renderNow(state);
        return;
      }
      this.scheduleRender();
    });

    if (typeof window !== 'undefined') {
      this.tickTimer = window.setInterval(() => {
        const st = this.store.getState();
        const job = st.activeJob;
        if (!job || (job.status !== 'running' && job.status !== 'pending')) return;
        const clockEl = this.container?.querySelector<HTMLElement>('#pdf2abp-elapsed-clock');
        if (clockEl) {
          clockEl.textContent = formatDurationMs(Date.now() - (job.createdAt || Date.now()));
        }
      }, 1000);
    }

    void this.store.refreshJobs();
  }

  public unmount(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.tickTimer !== null) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    if (this.container) {
      this.container.removeEventListener('click', this.onContainerClick);
      this.container.removeEventListener('change', this.onContainerChange);
      this.container.removeEventListener('toggle', this.onContainerToggle, true);
      this.container.removeEventListener('keydown', this.onContainerKeyDown);
      this.container = null;
    }
    this.rafPending = false;
  }

  private scheduleRender(): void {
    if (typeof requestAnimationFrame !== 'function') {
      if (this.latestState) this.renderNow(this.latestState);
      return;
    }
    if (this.rafPending) return;
    this.rafPending = true;
    requestAnimationFrame(() => {
      this.rafPending = false;
      if (this.latestState) {
        this.renderNow(this.latestState);
      }
    });
  }

  private renderStageNodeIcon(stage: TimelineStageItem): string {
    if (stage.status === 'completed') {
      return '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><polyline points="3.5 8.5 6.5 11.5 12.5 5"/></svg>';
    }
    if (stage.status === 'failed') {
      return '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/></svg>';
    }
    if (stage.status === 'running') {
      return '<span class="pdf2abp-node-active-dot" aria-hidden="true"></span>';
    }
    if (stage.status === 'skipped') {
      return '<span aria-hidden="true">-</span>';
    }
    return `<span>${stage.index}</span>`;
  }

  private renderSubagentSection(
    model: Pdf2AbpTimelineModel,
    job: Pdf2AbpJobState
  ): string {
    const s = model.subagentSummary;
    const pct = s.total > 0 ? Math.round((s.completed / s.total) * 100) : 0;

    const activeCards = model.subagentMatrix.active
      .map(
        (w) => `
        <div class="pdf2abp-worker-card">
          <div class="pdf2abp-worker-top">
            <span class="pdf2abp-worker-id pdf2abp-mono">${esc(w.taskId)}</span>
            <span class="pdf2abp-meta-stat">${esc(w.pageRange || '')} · ${formatDurationMs(w.durationMs)}</span>
          </div>
          <div class="pdf2abp-worker-title" title="${esc(w.title)}">${esc(w.title)}</div>
          <div class="pdf2abp-worker-meta">
            <span>${w.currentTool ? '正在调用工具' : '模型思考 / 校对中'}</span>
            ${w.currentTool ? `<span class="pdf2abp-tool-pill">${esc(w.currentTool)}</span>` : ''}
          </div>
        </div>
      `
      )
      .join('');

    const allSlices: SubagentSliceItem[] = [
      ...model.subagentMatrix.active,
      ...model.subagentMatrix.failed,
      ...model.subagentMatrix.completed,
    ];
    const filteredSlices = allSlices.filter((item) => {
      if (this.matrixFilter === 'running') return item.status === 'running';
      if (this.matrixFilter === 'completed') return item.status === 'completed' || item.status === 'skipped';
      if (this.matrixFilter === 'failed') return item.status === 'failed';
      return true;
    });

    const isMatrixOpen = this.detailOpenState.get('subagent-matrix') ?? true;
    const matrixRows =
      filteredSlices.length > 0
        ? filteredSlices
            .map((item) => {
              const tagText =
                item.status === 'running'
                  ? '进行中'
                  : item.status === 'failed'
                    ? '失败/告警'
                    : item.status === 'skipped'
                      ? '跳过(缓存)'
                      : item.validationPassed
                        ? 'PASS'
                        : 'DONE';
              const stepStr = typeof item.stepsUsed === 'number' ? `${item.stepsUsed}步` : '';
              return `
                <div class="pdf2abp-matrix-item">
                  <div class="pdf2abp-matrix-main">
                    <span class="pdf2abp-mono">${esc(item.taskId)}</span>
                    <span class="pdf2abp-matrix-title" title="${esc(item.title)}">${esc(item.title)}</span>
                  </div>
                  <span class="pdf2abp-meta-stat">${esc(tagText)}${stepStr ? ` · ${stepStr}` : ''}</span>
                  ${
                    item.targetOutputRelPath && item.status !== 'running'
                      ? `<button type="button" class="pdf2abp-matrix-link" data-jump-file="${esc(item.targetOutputRelPath)}">MDX</button>`
                      : ''
                  }
                </div>
              `;
            })
            .join('')
        : '<div class="pdf2abp-muted">当前筛选下暂无切片记录</div>';

    return `
      <div class="pdf2abp-subagent-block">
        ${
          s.total > 0
            ? `
          <div class="pdf2abp-progress-wrap">
            <div class="pdf2abp-progress-label-row">
              <span>切片完成度 (${s.completed} / ${s.total})</span>
              <span>${pct}% · 并发上限 ${job.concurrency}${s.pending > 0 ? ` · 待调度 ${s.pending}` : ''}</span>
            </div>
            <div class="pdf2abp-progress-track">
              <div class="pdf2abp-progress-fill" style="width:${pct}%"></div>
            </div>
          </div>
        `
            : ''
        }

        ${
          model.subagentMatrix.active.length > 0
            ? `<div class="pdf2abp-active-workers">${activeCards}</div>`
            : s.total === 0 && model.status === 'running'
              ? '<div class="pdf2abp-muted">等待主代理分派校对切片...</div>'
              : ''
        }

        ${
          allSlices.length > 0
            ? `
          <details class="pdf2abp-subdetails" data-detail-key="subagent-matrix" ${isMatrixOpen ? 'open' : ''}>
            <summary>切片清单 (${allSlices.length}${s.total > allSlices.length ? ` / ${s.total}` : ''})</summary>
            <div class="pdf2abp-filter-row">
              <button type="button" class="pdf2abp-filter-pill ${this.matrixFilter === 'all' ? 'is-active' : ''}" data-matrix-filter="all">全部 (${allSlices.length})</button>
              <button type="button" class="pdf2abp-filter-pill ${this.matrixFilter === 'running' ? 'is-active' : ''}" data-matrix-filter="running">进行中 (${s.running})</button>
              <button type="button" class="pdf2abp-filter-pill ${this.matrixFilter === 'completed' ? 'is-active' : ''}" data-matrix-filter="completed">已完成 (${s.completed})</button>
              <button type="button" class="pdf2abp-filter-pill ${this.matrixFilter === 'failed' ? 'is-active' : ''}" data-matrix-filter="failed">失败 (${s.failed})</button>
            </div>
            <div class="pdf2abp-matrix-list">${matrixRows}</div>
          </details>
        `
            : ''
        }
      </div>
    `;
  }

  private renderTimelineTab(state: Pdf2AbpStoreState, model: Pdf2AbpTimelineModel, job: Pdf2AbpJobState): string {
    const stagesHtml = model.stages
      .map((stage) => {
        const badgesHtml = stage.badges
          .map((b) => `<span class="pdf2abp-info-chip">${esc(b)}</span>`)
          .join('');

        const visionHtml =
          stage.id === 'overview_vision' && model.recentVisions.length > 0
            ? `
          <div class="pdf2abp-vision-strip">
            ${model.recentVisions
              .slice(-10)
              .map((v) => {
                const thumbUrl = `/api/v1/pdf2abp/jobs/${encodeURIComponent(job.jobId)}/file?path=${encodeURIComponent(v.relPath)}`;
                return `
                  <button type="button" class="pdf2abp-vision-thumb" data-jump-file="${esc(v.relPath)}" title="${esc(v.label)}">
                    <img src="${esc(thumbUrl)}" alt="${esc(v.label)}" loading="lazy" />
                    <span>${esc(v.label)}</span>
                  </button>
                `;
              })
              .join('')}
          </div>
        `
            : '';

        const subagentHtml =
          stage.id === 'subagent_proofreading' && (stage.status === 'running' || stage.status === 'completed' || stage.status === 'failed' || model.subagentSummary.total > 0)
            ? this.renderSubagentSection(model, job)
            : '';

        const detailKey = `stage:${stage.id}`;
        const isOpen = this.detailOpenState.get(detailKey) ?? false;
        const highlightsHtml =
          stage.highlights.length > 0
            ? `
          <details class="pdf2abp-subdetails" data-detail-key="${esc(detailKey)}" ${isOpen ? 'open' : ''}>
            <summary>里程碑轨迹 (${stage.highlights.length})</summary>
            <ul class="pdf2abp-highlight-list">
              ${stage.highlights
                .map(
                  (h) =>
                    `<li class="pdf2abp-highlight-item ${h.tone === 'error' ? 'is-error' : ''}">` +
                    `<span class="pdf2abp-muted">${formatClock(h.timestamp)}</span> ` +
                    `<span class="pdf2abp-mono">[${esc(h.agentId)}]</span> ` +
                    `${esc(h.summary)}</li>`
                )
                .join('')}
            </ul>
          </details>
        `
            : '';

        const timeText =
          stage.status === 'running'
            ? stage.durationMs !== null
              ? `进行中 · ${formatDurationMs(stage.durationMs)}`
              : '进行中'
            : stage.durationMs && stage.durationMs >= 1000
              ? `${stage.statusLabel} · ${formatDurationMs(stage.durationMs)}`
              : stage.statusLabel;

        return `
          <li class="pdf2abp-stage-row is-${stage.status}">
            <div class="pdf2abp-rail-col">
              <div class="pdf2abp-node-badge">${this.renderStageNodeIcon(stage)}</div>
              <div class="pdf2abp-rail-line" aria-hidden="true"></div>
            </div>
            <div class="pdf2abp-stage-card">
              <div class="pdf2abp-stage-head">
                <span class="pdf2abp-stage-title">${stage.index}. ${esc(stage.title)}</span>
                <span class="pdf2abp-stage-time">${esc(timeText)}</span>
              </div>
              <p class="pdf2abp-stage-summary">${esc(stage.summary)}</p>
              ${badgesHtml ? `<div class="pdf2abp-stage-badges">${badgesHtml}</div>` : ''}
              ${visionHtml}
              ${subagentHtml}
              ${highlightsHtml}
            </div>
          </li>
        `;
      })
      .join('');

    return `<ol class="pdf2abp-timeline-list">${stagesHtml}</ol>`;
  }

  private renderFilesGroupsHtml(state: Pdf2AbpStoreState): string {
    const groups = groupWorkspaceFiles(state.files);
    if (groups.length === 0) {
      return '<div class="pdf2abp-empty-note">当前工作区尚无可见产出文件。</div>';
    }

    const groupsHtml = groups
      .map((g) => {
        const key = `grp:${g.key}`;
        const isOpen = this.detailOpenState.get(key) ?? g.defaultOpen;
        const rows = g.items
          .map(
            (f) => `
            <button type="button" class="pdf2abp-file-btn ${f.relPath === state.selectedFilePath ? 'active' : ''}" data-file-path="${esc(f.relPath)}">
              <span class="pdf2abp-mono" title="${esc(f.relPath)}">${esc(f.relPath)}</span>
              <span class="pdf2abp-muted">${Math.max(1, Math.round(f.sizeBytes / 1024))} KB</span>
            </button>
          `
          )
          .join('');
        return `
          <details class="pdf2abp-file-group" data-detail-key="${esc(key)}" ${isOpen ? 'open' : ''}>
            <summary>${esc(g.title)} (${g.items.length})</summary>
            <div class="pdf2abp-files-list">${rows}</div>
          </details>
        `;
      })
      .join('');

    return groupsHtml;
  }

  private renderFilePreviewHtml(state: Pdf2AbpStoreState): string {
    if (!state.selectedFilePath) return '';
    return `
      <div class="pdf2abp-file-preview">
        <div class="pdf2abp-preview-header">
          <span class="pdf2abp-preview-title pdf2abp-mono" title="${esc(state.selectedFilePath)}">${esc(state.selectedFilePath)}</span>
          <button type="button" class="pdf2abp-matrix-link" id="pdf2abp-close-preview-btn">收起</button>
        </div>
        ${
          state.selectedFileIsImage && state.selectedFilePreviewUrl
            ? `<img src="${esc(state.selectedFilePreviewUrl)}" alt="${esc(state.selectedFilePath)}" class="pdf2abp-preview-img" />`
            : `<pre class="pdf2abp-preview-code">${esc(state.selectedFileContent || '')}</pre>`
        }
      </div>
    `;
  }

  private renderEventsTab(events: Pdf2AbpEvent[]): string {
    const filtered = events.filter((e) => {
      if (this.eventFilter === 'main') return e.agentId === 'main' || e.agentId === 'system';
      if (this.eventFilter === 'subagent') return e.agentId.startsWith('subagent:');
      if (this.eventFilter === 'warn') return e.type === 'warning' || e.type === 'error' || Boolean(e.data?.isError);
      return true;
    });

    const rows = filtered
      .slice(-160)
      .reverse()
      .map(
        (e) =>
          `<div class="pdf2abp-log-line ${e.type === 'error' ? 'is-error' : ''}">` +
          `<span class="pdf2abp-muted">${formatClock(e.timestamp)}</span> ` +
          `<span class="pdf2abp-mono">[${esc(e.agentId)}]</span> ` +
          `<span class="pdf2abp-muted">${esc(e.type)}</span> ` +
          `${esc(e.message)}</div>`
      )
      .join('');

    return `
      <div class="pdf2abp-filter-row">
        <button type="button" class="pdf2abp-filter-pill ${this.eventFilter === 'all' ? 'is-active' : ''}" data-event-filter="all">全部 (${events.length})</button>
        <button type="button" class="pdf2abp-filter-pill ${this.eventFilter === 'main' ? 'is-active' : ''}" data-event-filter="main">主代理</button>
        <button type="button" class="pdf2abp-filter-pill ${this.eventFilter === 'subagent' ? 'is-active' : ''}" data-event-filter="subagent">子代理</button>
        <button type="button" class="pdf2abp-filter-pill ${this.eventFilter === 'warn' ? 'is-active' : ''}" data-event-filter="warn">告警与错误</button>
      </div>
      <div class="pdf2abp-event-log">${rows || '<div class="pdf2abp-muted">暂无符合条件的事件日志</div>'}</div>
    `;
  }

  private ensurePanelSkeleton(container: HTMLElement): void {
    if (container.querySelector('.pdf2abp-panel[data-incremental-panel="true"]')) {
      return;
    }
    this.lastJobSelectKey = '';
    this.lastMetaKey = '';
    this.lastTablistKey = '';
    this.lastTimelineKey = '';
    this.lastFilesTreeKey = '';
    this.lastFilePreviewKey = '';
    this.lastEventsKey = '';

    container.innerHTML = `
      <div class="pdf2abp-panel" data-incremental-panel="true">
        <div class="pdf2abp-top-chrome">
          <div class="pdf2abp-panel-header">
            <div class="pdf2abp-header-titles">
              <div class="pdf2abp-panel-title">PDF2ABP 数字化工坊</div>
              <div class="pdf2abp-muted">多智能体 MinerU 解析 · 整节精校 · ABP 入库</div>
            </div>
            <button type="button" class="pdf2abp-compact-btn is-primary" id="pdf2abp-panel-new-btn">新建转换</button>
          </div>

          <div class="pdf2abp-job-toolbar">
            <select id="pdf2abp-job-select" class="pdf2abp-job-select" aria-label="选择转换任务">
              <option value="">-- 选择转换任务 (0) --</option>
            </select>
            <button type="button" class="pdf2abp-compact-btn" id="pdf2abp-refresh-btn">刷新</button>
          </div>

          <div class="pdf2abp-dialog-error" id="pdf2abp-store-error" hidden></div>
          <div id="pdf2abp-job-meta-mount"></div>
          <div class="pdf2abp-dialog-error" id="pdf2abp-job-error" hidden></div>
          <div id="pdf2abp-tablist-mount"></div>
        </div>

        <div class="pdf2abp-tabpanel-host">
          <div role="tabpanel" id="pdf2abp-tabpanel-timeline" aria-labelledby="pdf2abp-tab-timeline" class="pdf2abp-tabpanel" hidden></div>
          <div role="tabpanel" id="pdf2abp-tabpanel-files" aria-labelledby="pdf2abp-tab-files" class="pdf2abp-tabpanel" hidden>
            <div class="pdf2abp-file-groups" id="pdf2abp-file-groups-host"></div>
            <div id="pdf2abp-file-preview-host"></div>
          </div>
          <div role="tabpanel" id="pdf2abp-tabpanel-events" aria-labelledby="pdf2abp-tab-events" class="pdf2abp-tabpanel" hidden></div>
          <div class="pdf2abp-empty-note" id="pdf2abp-empty-mount">点击「新建转换」或输入 <code>/pdf2abp</code> 选择 PDF 教材启动多智能体构建流程。</div>
        </div>
      </div>
    `;
  }

  private renderNow(state: Pdf2AbpStoreState): void {
    const container = this.container;
    if (!container) return;

    this.ensurePanelSkeleton(container);

    const job = state.activeJob;
    const model = job
      ? projectPdf2AbpTimeline({
          jobState: job,
          milestoneEvents: state.milestoneEvents,
          runningSubagents: state.runningSubagents,
          bookPlan: state.bookPlan,
          chunksManifest: state.chunksManifest,
          mineruSummary: state.mineruSummary,
          artifactPaths: state.files.map((f) => f.relPath),
        })
      : null;

    const selectEl = container.querySelector<HTMLSelectElement>('#pdf2abp-job-select');
    const selectKey = JSON.stringify([
      state.activeJobId || '',
      state.jobs.map((j) => [j.jobId, j.sourceFileName, j.status]),
    ]);
    if (selectEl && selectKey !== this.lastJobSelectKey) {
      this.lastJobSelectKey = selectKey;
      const jobOptions = state.jobs
        .map(
          (j) =>
            `<option value="${esc(j.jobId)}" ${j.jobId === state.activeJobId ? 'selected' : ''}>${esc(j.sourceFileName)} · ${esc(j.status)}</option>`
        )
        .join('');
      selectEl.innerHTML = `<option value="">-- 选择转换任务 (${state.jobs.length}) --</option>${jobOptions}`;
      if (state.activeJobId) selectEl.value = state.activeJobId;
    }

    const storeErrEl = container.querySelector<HTMLElement>('#pdf2abp-store-error');
    if (storeErrEl) {
      if (state.error) {
        storeErrEl.removeAttribute('hidden');
        if (storeErrEl.textContent !== state.error) storeErrEl.textContent = state.error;
      } else {
        storeErrEl.setAttribute('hidden', '');
      }
    }

    const jobErrEl = container.querySelector<HTMLElement>('#pdf2abp-job-error');
    if (jobErrEl) {
      if (job?.error) {
        jobErrEl.removeAttribute('hidden');
        if (jobErrEl.textContent !== job.error) jobErrEl.textContent = job.error;
      } else {
        jobErrEl.setAttribute('hidden', '');
      }
    }

    const emptyMount = container.querySelector<HTMLElement>('#pdf2abp-empty-mount');
    const timelinePanel = container.querySelector<HTMLElement>('#pdf2abp-tabpanel-timeline');
    const filesPanel = container.querySelector<HTMLElement>('#pdf2abp-tabpanel-files');
    const eventsPanel = container.querySelector<HTMLElement>('#pdf2abp-tabpanel-events');
    const metaMount = container.querySelector<HTMLElement>('#pdf2abp-job-meta-mount');
    const tablistMount = container.querySelector<HTMLElement>('#pdf2abp-tablist-mount');

    if (!job || !model) {
      if (metaMount && metaMount.innerHTML) {
        metaMount.innerHTML = '';
        this.lastMetaKey = '';
      }
      if (tablistMount && tablistMount.innerHTML) {
        tablistMount.innerHTML = '';
        this.lastTablistKey = '';
      }
      timelinePanel?.setAttribute('hidden', '');
      filesPanel?.setAttribute('hidden', '');
      eventsPanel?.setAttribute('hidden', '');
      emptyMount?.removeAttribute('hidden');
      return;
    }

    emptyMount?.setAttribute('hidden', '');

    const statusClass =
      job.status === 'running' || job.status === 'pending'
        ? 'is-running'
        : job.status === 'completed'
          ? 'is-completed'
          : job.status === 'failed' || job.status === 'cancelled'
            ? 'is-failed'
            : '';
    const readerLink = model.importLink?.readerUrl || job.importResult?.readerUrl || '';
    const metaKey = JSON.stringify([
      job.jobId,
      job.status,
      job.concurrency,
      model.statusLabel,
      model.completedStages,
      model.totalStages,
      model.phaseLabel,
      readerLink,
    ]);
    if (metaMount && metaKey !== this.lastMetaKey) {
      this.lastMetaKey = metaKey;
      metaMount.innerHTML = `
        <div class="pdf2abp-job-meta-bar">
          <div class="pdf2abp-job-badges">
            <span class="pdf2abp-status-pill ${statusClass}">
              <span class="pdf2abp-status-dot" aria-hidden="true"></span>
              <span>${esc(model.statusLabel)}</span>
            </span>
            <span class="pdf2abp-meta-stat">阶段 ${model.completedStages}/${model.totalStages} · ${esc(model.phaseLabel)}</span>
            <span class="pdf2abp-meta-stat" id="pdf2abp-elapsed-clock">${formatDurationMs(model.elapsedMs)}</span>
            <span class="pdf2abp-meta-stat">并发 ${job.concurrency}</span>
          </div>
          <div class="pdf2abp-job-actions">
            ${
              job.status === 'running' || job.status === 'pending'
                ? '<button type="button" class="pdf2abp-compact-btn is-danger" id="pdf2abp-cancel-job-btn">终止</button>'
                : '<button type="button" class="pdf2abp-compact-btn" id="pdf2abp-resume-job-btn">断点续跑</button>'
            }
            ${readerLink ? `<a class="pdf2abp-reader-link" href="${esc(readerLink)}">打开阅读</a>` : ''}
          </div>
        </div>
      `;
    }

    const fileCount = state.files.filter((f) => !f.isDirectory).length;
    const tabKey = `${this.activeTab}|${fileCount}|${state.events.length}`;
    if (tablistMount && tabKey !== this.lastTablistKey) {
      this.lastTablistKey = tabKey;
      tablistMount.innerHTML = `
        <div class="pdf2abp-tablist" role="tablist" aria-label="工坊检视视图">
          <button
            type="button"
            role="tab"
            id="pdf2abp-tab-timeline"
            class="pdf2abp-tab"
            data-panel-tab="timeline"
            aria-selected="${this.activeTab === 'timeline' ? 'true' : 'false'}"
            aria-controls="pdf2abp-tabpanel-timeline"
            tabindex="${this.activeTab === 'timeline' ? '0' : '-1'}"
          >过程导览</button>
          <button
            type="button"
            role="tab"
            id="pdf2abp-tab-files"
            class="pdf2abp-tab"
            data-panel-tab="files"
            aria-selected="${this.activeTab === 'files' ? 'true' : 'false'}"
            aria-controls="pdf2abp-tabpanel-files"
            tabindex="${this.activeTab === 'files' ? '0' : '-1'}"
          >产物浏览 <span class="pdf2abp-tab-count">${fileCount}</span></button>
          <button
            type="button"
            role="tab"
            id="pdf2abp-tab-events"
            class="pdf2abp-tab"
            data-panel-tab="events"
            aria-selected="${this.activeTab === 'events' ? 'true' : 'false'}"
            aria-controls="pdf2abp-tabpanel-events"
            tabindex="${this.activeTab === 'events' ? '0' : '-1'}"
          >原始事件 <span class="pdf2abp-tab-count">${state.events.length}</span></button>
        </div>
      `;
    }

    if (timelinePanel) {
      if (this.activeTab === 'timeline') timelinePanel.removeAttribute('hidden');
      else timelinePanel.setAttribute('hidden', '');
    }
    if (filesPanel) {
      if (this.activeTab === 'files') filesPanel.removeAttribute('hidden');
      else filesPanel.setAttribute('hidden', '');
    }
    if (eventsPanel) {
      if (this.activeTab === 'events') eventsPanel.removeAttribute('hidden');
      else eventsPanel.setAttribute('hidden', '');
    }

    if (this.activeTab === 'timeline' && timelinePanel) {
      const timelineKey = JSON.stringify([
        job.jobId,
        job.status,
        this.matrixFilter,
        model.stages.map((s) => [s.id, s.status, s.summary, s.highlights.length, s.badges.length]),
        model.subagentSummary,
        model.recentVisions.length,
        Object.values(state.runningSubagents).map((r: any) => [r.chunkId, r.status]),
        state.milestoneEvents.length,
      ]);
      if (timelineKey !== this.lastTimelineKey) {
        const savedTop = timelinePanel.scrollTop;
        this.lastTimelineKey = timelineKey;
        timelinePanel.innerHTML = this.renderTimelineTab(state, model, job);
        if (savedTop > 0) timelinePanel.scrollTop = savedTop;
      }
    }

    if (this.activeTab === 'files' && filesPanel) {
      const groupsHost = filesPanel.querySelector<HTMLElement>('#pdf2abp-file-groups-host');
      const previewHost = filesPanel.querySelector<HTMLElement>('#pdf2abp-file-preview-host');

      const treeKey = JSON.stringify([
        job.jobId,
        state.files.map((f) => [f.relPath, f.sizeBytes, f.isDirectory]),
      ]);
      if (groupsHost && treeKey !== this.lastFilesTreeKey) {
        this.lastFilesTreeKey = treeKey;
        groupsHost.innerHTML = this.renderFilesGroupsHtml(state);
      } else if (groupsHost) {

        groupsHost.querySelectorAll<HTMLElement>('.pdf2abp-file-btn').forEach((btn) => {
          btn.classList.toggle('active', btn.dataset.filePath === state.selectedFilePath);
        });
      }

      const previewKey = JSON.stringify([
        job.jobId,
        state.selectedFilePath || '',
        Boolean(state.selectedFileIsImage),
        state.selectedFilePreviewUrl || '',
        state.selectedFileContent ? state.selectedFileContent.length : 0,
        state.selectedFileContent ? state.selectedFileContent.slice(0, 64) : '',
      ]);
      if (previewHost && previewKey !== this.lastFilePreviewKey) {
        this.lastFilePreviewKey = previewKey;
        previewHost.innerHTML = this.renderFilePreviewHtml(state);
      }
    }

    if (this.activeTab === 'events' && eventsPanel) {
      const lastEvTs = state.events.length > 0 ? state.events[state.events.length - 1].timestamp : 0;
      const eventsKey = `${job.jobId}|${this.eventFilter}|${state.events.length}|${lastEvTs}`;
      if (eventsKey !== this.lastEventsKey) {
        const savedTop = eventsPanel.scrollTop;
        this.lastEventsKey = eventsKey;
        eventsPanel.innerHTML = this.renderEventsTab(state.events);
        if (savedTop > 0) eventsPanel.scrollTop = savedTop;
      }
    }
  }
}
