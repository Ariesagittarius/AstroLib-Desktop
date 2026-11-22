/**
 * src/components/harness/pdf2abp/pdf2abp-inline-card.ts
 * ============================================================================
 * /pdf2abp 独立对话内联参数配置与紧凑里程碑进度卡片
 * ============================================================================
 * 规范：
 * 1. 输入 /pdf2abp 后直接在对话区呈现，与上下文对话流完全独立；
 * 2. 完整对齐 Material Design 3 表单参数配置（源路径、结构模式、并发数、附加指令）；
 * 3. 启动后原地平滑切换为紧凑里程碑进度轨，并提供「在右侧成果物展开详览」直达按钮。
 * ============================================================================
 */

import '@material/web/textfield/outlined-text-field.js';
import '@material/web/button/filled-button.js';
import '@material/web/button/outlined-button.js';
import '@material/web/button/text-button.js';
import '@material/web/chips/chip-set.js';
import '@material/web/chips/filter-chip.js';

import type { Pdf2AbpHealthStatus, Pdf2AbpStore, Pdf2AbpStoreState } from './pdf2abp-store.ts';
import { projectPdf2AbpTimeline } from './pdf2abp-timeline.ts';
import { formatDurationMs } from './pdf2abp-artifacts-panel.ts';
import { ArtifactStore } from '../../../features/harness/artifact-store.ts';

function esc(str: unknown): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderHealthSummary(health: Pdf2AbpHealthStatus | null): string {
  if (!health) return '正在检测 MinerU 与 Python 运行环境…';
  const mineruText = health.mineru.ready
    ? `MinerU (${health.mineru.preferredEngine})`
    : 'MinerU 未就绪';
  const pyText = health.python.available
    ? `Python (${health.python.version || 'ready'})`
    : 'Python 未检测';
  return `${mineruText} · ${pyText} · ${health.defaultGateway.modelId}`;
}

export function renderPdf2AbpInlineCardPlaceholder(prefillPdfPath = ''): string {
  return `<div class="pdf2abp-inline-host" data-pdf2abp-inline="1" data-prefill="${esc(prefillPdfPath)}"></div>`;
}

export function mountPdf2AbpInlineCards(
  root: HTMLElement,
  deps: {
    store: Pdf2AbpStore;
    onInspectJob: (jobId: string) => void;
    onJobStarted?: (jobId: string) => void;
  }
): void {
  if (!root) return;
  const hosts = root.querySelectorAll<HTMLElement>('.pdf2abp-inline-host');
  hosts.forEach((host) => {
    if (host.dataset.mounted === 'true') return;
    host.dataset.mounted = 'true';

    let boundJobId = host.dataset.jobId || '';

    const renderConfigForm = () => {
      const prefill = host.dataset.prefill || '';
      const bridge = window.astrolibDesktop || window.astrolib;
      const showBrowse = Boolean(bridge?.selectPdfFile);

      host.innerHTML = `
        <div class="pdf2abp-inline-card">
          <div class="pdf2abp-inline-card__head">
            <div class="pdf2abp-inline-card__title-wrap">
              <span class="material-symbols-outlined pdf2abp-inline-card__icon" aria-hidden="true">menu_book</span>
              <div>
                <div class="pdf2abp-inline-card__title">PDF 数字化编译为 ABP</div>
                <div class="pdf2abp-inline-card__sub">独立多智能体工作台 · 与当前对话上下文隔离</div>
              </div>
            </div>
            <span class="pdf2abp-inline-health" data-role="health">正在检测运行环境…</span>
          </div>

          <div class="pdf2abp-inline-card__form">
            <div class="pdf2abp-path-row">
              <md-outlined-text-field
                data-role="pdf-path"
                label="源 PDF 路径（本地绝对路径）"
                placeholder="D:\\books\\algorithms.pdf"
                value="${esc(prefill)}"
                class="pdf2abp-path-input"
              ></md-outlined-text-field>
              ${
                showBrowse
                  ? `<md-outlined-button data-role="browse-btn" type="button">选择文件</md-outlined-button>`
                  : ''
              }
            </div>

            <div class="pdf2abp-field-group">
              <span class="pdf2abp-field-label">文献结构模式</span>
              <md-chip-set data-role="mode-chips" aria-label="文献结构模式">
                <md-filter-chip label="教材 (textbook)" data-mode="textbook" selected></md-filter-chip>
                <md-filter-chip label="论文 (paper)" data-mode="paper"></md-filter-chip>
                <md-filter-chip label="试卷 (exam)" data-mode="exam"></md-filter-chip>
                <md-filter-chip label="专著 (monograph)" data-mode="monograph"></md-filter-chip>
              </md-chip-set>
            </div>

            <div class="pdf2abp-inline-fields">
              <md-outlined-text-field
                data-role="concurrency"
                type="number"
                min="1"
                max="24"
                value="12"
                label="并发校对子代理 (1–24)"
                class="pdf2abp-concurrency-input"
              ></md-outlined-text-field>
            </div>

            <md-outlined-text-field
              data-role="instructions"
              type="textarea"
              rows="2"
              label="附加范围或排版指令（可选）"
              placeholder="例如：仅处理 Preface 与 Chapter 0 到 Chapter 4（含章首导语与课后习题，跳过目录）"
              class="pdf2abp-full-width"
            ></md-outlined-text-field>

            <div class="pdf2abp-dialog-error" data-role="error" hidden></div>

            <div class="pdf2abp-inline-card__actions">
              <md-filled-button data-role="start-btn" type="button">开始构建</md-filled-button>
            </div>
          </div>
        </div>
      `;

      const pathInput = host.querySelector<any>('[data-role="pdf-path"]');
      const browseBtn = host.querySelector<HTMLElement>('[data-role="browse-btn"]');
      const modeChips = Array.from(host.querySelectorAll<any>('[data-role="mode-chips"] md-filter-chip'));
      const concurrencyInput = host.querySelector<any>('[data-role="concurrency"]');
      const instructionsInput = host.querySelector<any>('[data-role="instructions"]');
      const healthEl = host.querySelector<HTMLElement>('[data-role="health"]');
      const errorBox = host.querySelector<HTMLElement>('[data-role="error"]');
      const startBtn = host.querySelector<any>('[data-role="start-btn"]');

      void deps.store.fetchHealth().then((h) => {
        if (healthEl) healthEl.textContent = renderHealthSummary(h);
      });

      browseBtn?.addEventListener('click', async () => {
        const picked = await bridge?.selectPdfFile?.();
        if (picked && pathInput) {
          pathInput.value = picked;
        }
      });

      modeChips.forEach((chip) => {
        chip.addEventListener('click', () => {
          const selectedMode = chip.dataset.mode || 'textbook';
          modeChips.forEach((c) => {
            c.selected = (c.dataset.mode || '') === selectedMode;
          });
        });
      });

      startBtn?.addEventListener('click', async () => {
        const pdfPath = String(pathInput?.value || '').trim();
        if (!pdfPath) {
          if (errorBox) {
            errorBox.textContent = '请填写或选择本地 PDF 文件路径。';
            errorBox.hidden = false;
          }
          return;
        }
        const activeChip = modeChips.find((c) => c.selected);
        const documentMode = (activeChip?.dataset.mode || 'textbook') as
          | 'textbook'
          | 'paper'
          | 'exam'
          | 'monograph';
        const rawConc = Number(concurrencyInput?.value || 12);
        const concurrency = Number.isFinite(rawConc)
          ? Math.max(1, Math.min(24, Math.floor(rawConc)))
          : 12;

        startBtn.disabled = true;
        if (errorBox) errorBox.hidden = true;

        try {
          const job = await deps.store.startJob({
            pdfPath,
            documentMode,
            concurrency,
            autoImport: true,
            instructions: String(instructionsInput?.value || '').trim(),
          });
          boundJobId = job.jobId;
          host.dataset.jobId = job.jobId;
          ArtifactStore.getInstance().syncPdf2AbpJob(job, false);
          deps.onJobStarted?.(job.jobId);
          subscribeToJobProgress();
        } catch (err) {
          if (errorBox) {
            errorBox.textContent = err instanceof Error ? err.message : String(err);
            errorBox.hidden = false;
          }
          startBtn.disabled = false;
        }
      });
    };

    let unsub: (() => void) | null = null;
    let tickTimer: number | null = null;
    let lastFingerprint = '';
    let delegatedBound = false;

    const ensureDelegatedClick = () => {
      if (delegatedBound) return;
      delegatedBound = true;
      host.addEventListener('click', (ev) => {
        const target = ev.target as HTMLElement | null;
        if (!target || !boundJobId) return;
        if (target.closest('[data-role="inspect-job"]')) {
          void deps.store.selectJob(boundJobId);
          deps.onInspectJob(boundJobId);
          return;
        }
        if (target.closest('[data-role="cancel-job"]')) {
          void deps.store.cancelJob(boundJobId);
          return;
        }
        if (target.closest('[data-role="resume-job"]')) {
          void deps.store.resumeJob(boundJobId);
        }
      });
    };

    const renderJobProgress = (state: Pdf2AbpStoreState) => {
      ensureDelegatedClick();
      const job = state.jobs.find((j) => j.jobId === boundJobId);
      if (!job) {
        if (!host.querySelector('.pdf2abp-inline-card--waiting')) {
          host.innerHTML = `<div class="pdf2abp-inline-card pdf2abp-inline-card--waiting"><div class="pdf2abp-inline-card__sub">正在同步任务 ${esc(boundJobId)} 状态...</div></div>`;
        }
        return;
      }

      const isActiveJob = state.activeJobId === job.jobId;
      const model = projectPdf2AbpTimeline({
        jobState: job,
        milestoneEvents: isActiveJob ? state.milestoneEvents : [],
        runningSubagents: isActiveJob ? state.runningSubagents : {},
        bookPlan: isActiveJob ? state.bookPlan : null,
        chunksManifest: isActiveJob ? state.chunksManifest : null,
        mineruSummary: isActiveJob ? state.mineruSummary : null,
        artifactPaths: isActiveJob ? state.files.map((f) => f.relPath) : [],
      });

      const statusClass =
        job.status === 'running' || job.status === 'pending'
          ? 'is-running'
          : job.status === 'completed'
            ? 'is-completed'
            : 'is-failed';

      const sub = model.subagentSummary;
      const pct = sub.total > 0 ? Math.round((sub.completed / sub.total) * 100) : 0;
      const readerLink = model.importLink?.readerUrl || job.importResult?.readerUrl || '';

      const fingerprint = JSON.stringify([
        job.jobId,
        job.status,
        job.sourceFileName,
        job.concurrency,
        job.error || '',
        model.phaseLabel,
        model.completedStages,
        model.totalStages,
        model.statusLabel,
        model.stages.map((s) => [s.index, s.status, s.title, s.summary]),
        sub.completed,
        sub.total,
        readerLink,
      ]);

      if (fingerprint === lastFingerprint && host.querySelector('.pdf2abp-inline-card--progress')) {
        return;
      }
      lastFingerprint = fingerprint;

      let card = host.querySelector<HTMLElement>('.pdf2abp-inline-card--progress');
      if (!card || card.dataset.boundJob !== job.jobId) {
        const stagesMiniHtml = model.stages
          .map(
            (st) => `
          <div class="pdf2abp-mini-stage is-${st.status}" data-stage-idx="${st.index}" title="${esc(st.title)}: ${esc(st.summary)}">
            <span class="pdf2abp-mini-stage__dot">${st.status === 'completed' ? '✓' : st.index}</span>
            <span class="pdf2abp-mini-stage__name">${esc(st.title)}</span>
          </div>
        `
          )
          .join('');

        host.innerHTML = `
          <div class="pdf2abp-inline-card pdf2abp-inline-card--progress" data-bound-job="${esc(job.jobId)}">
            <div class="pdf2abp-inline-card__head">
              <div class="pdf2abp-inline-card__title-wrap">
                <span class="material-symbols-outlined pdf2abp-inline-card__icon" aria-hidden="true">menu_book</span>
                <div>
                  <div class="pdf2abp-inline-card__title" data-role="title">${esc(job.sourceFileName)}</div>
                  <div class="pdf2abp-inline-card__sub"><span data-role="phase">${esc(model.phaseLabel)} · 阶段 ${model.completedStages}/${model.totalStages}</span> · <span data-role="clock">${formatDurationMs(model.elapsedMs)}</span></div>
                </div>
              </div>
              <span class="pdf2abp-status-pill ${statusClass}" data-role="status-pill">
                <span class="pdf2abp-status-dot" aria-hidden="true"></span>
                <span data-role="status-label">${esc(model.statusLabel)}</span>
              </span>
            </div>

            <div class="pdf2abp-mini-stages" data-role="stages-wrap">${stagesMiniHtml}</div>

            <div class="pdf2abp-progress-wrap" data-role="progress-wrap" style="margin-top:8px;" ${sub.total > 0 ? '' : 'hidden'}>
              <div class="pdf2abp-progress-label-row">
                <span data-role="progress-label">切片校对 (${sub.completed}/${sub.total})</span>
                <span data-role="progress-meta">${pct}% · 并发 ${job.concurrency}</span>
              </div>
              <div class="pdf2abp-progress-track">
                <div class="pdf2abp-progress-fill" data-role="progress-fill" style="width:${pct}%"></div>
              </div>
            </div>

            <div class="pdf2abp-dialog-error" data-role="error" style="margin-top:8px;" ${job.error ? '' : 'hidden'}>${esc(job.error || '')}</div>

            <div class="pdf2abp-inline-card__actions" style="margin-top:10px;">
              <button type="button" class="pdf2abp-compact-btn is-danger" data-role="cancel-job" ${job.status === 'running' || job.status === 'pending' ? '' : 'hidden'}>终止</button>
              <button type="button" class="pdf2abp-compact-btn" data-role="resume-job" ${job.status === 'failed' || job.status === 'cancelled' ? '' : 'hidden'}>断点续跑</button>
              <a class="pdf2abp-reader-link" data-role="reader-link" href="${esc(readerLink || '#')}" ${readerLink ? '' : 'hidden'}>打开阅读</a>
              <button type="button" class="pdf2abp-compact-btn is-primary" data-role="inspect-job">在右侧成果物展开详览</button>
            </div>
          </div>
        `;
        return;
      }

      // 增量原地补丁更新，绝不销毁已有节点，保护脉冲点动画与进度条过渡效果
      const titleEl = card.querySelector<HTMLElement>('[data-role="title"]');
      if (titleEl && titleEl.textContent !== job.sourceFileName) {
        titleEl.textContent = job.sourceFileName;
      }

      const phaseEl = card.querySelector<HTMLElement>('[data-role="phase"]');
      const nextPhase = `${model.phaseLabel} · 阶段 ${model.completedStages}/${model.totalStages}`;
      if (phaseEl && phaseEl.textContent !== nextPhase) {
        phaseEl.textContent = nextPhase;
      }

      const statusPill = card.querySelector<HTMLElement>('[data-role="status-pill"]');
      if (statusPill) {
        statusPill.className = `pdf2abp-status-pill ${statusClass}`;
        const statusLbl = statusPill.querySelector<HTMLElement>('[data-role="status-label"]');
        if (statusLbl && statusLbl.textContent !== model.statusLabel) {
          statusLbl.textContent = model.statusLabel;
        }
      }

      const stagesWrap = card.querySelector<HTMLElement>('[data-role="stages-wrap"]');
      if (stagesWrap) {
        for (const st of model.stages) {
          const stEl = stagesWrap.querySelector<HTMLElement>(`[data-stage-idx="${st.index}"]`);
          if (stEl) {
            stEl.className = `pdf2abp-mini-stage is-${st.status}`;
            stEl.title = `${st.title}: ${st.summary}`;
            const dotEl = stEl.querySelector<HTMLElement>('.pdf2abp-mini-stage__dot');
            const nextDot = st.status === 'completed' ? '✓' : String(st.index);
            if (dotEl && dotEl.textContent !== nextDot) dotEl.textContent = nextDot;
          }
        }
      }

      const progWrap = card.querySelector<HTMLElement>('[data-role="progress-wrap"]');
      if (progWrap) {
        if (sub.total > 0) {
          progWrap.removeAttribute('hidden');
          const lbl = progWrap.querySelector<HTMLElement>('[data-role="progress-label"]');
          const meta = progWrap.querySelector<HTMLElement>('[data-role="progress-meta"]');
          const fill = progWrap.querySelector<HTMLElement>('[data-role="progress-fill"]');
          const nextLbl = `切片校对 (${sub.completed}/${sub.total})`;
          const nextMeta = `${pct}% · 并发 ${job.concurrency}`;
          if (lbl && lbl.textContent !== nextLbl) lbl.textContent = nextLbl;
          if (meta && meta.textContent !== nextMeta) meta.textContent = nextMeta;
          if (fill) fill.style.width = `${pct}%`;
        } else {
          progWrap.setAttribute('hidden', '');
        }
      }

      const errEl = card.querySelector<HTMLElement>('[data-role="error"]');
      if (errEl) {
        if (job.error) {
          errEl.removeAttribute('hidden');
          if (errEl.textContent !== job.error) errEl.textContent = job.error;
        } else {
          errEl.setAttribute('hidden', '');
        }
      }

      const cancelBtn = card.querySelector<HTMLElement>('[data-role="cancel-job"]');
      if (cancelBtn) {
        if (job.status === 'running' || job.status === 'pending') cancelBtn.removeAttribute('hidden');
        else cancelBtn.setAttribute('hidden', '');
      }

      const resumeBtn = card.querySelector<HTMLElement>('[data-role="resume-job"]');
      if (resumeBtn) {
        if (job.status === 'failed' || job.status === 'cancelled') resumeBtn.removeAttribute('hidden');
        else resumeBtn.setAttribute('hidden', '');
      }

      const readerEl = card.querySelector<HTMLAnchorElement>('[data-role="reader-link"]');
      if (readerEl) {
        if (readerLink) {
          readerEl.removeAttribute('hidden');
          if (readerEl.getAttribute('href') !== readerLink) readerEl.href = readerLink;
        } else {
          readerEl.setAttribute('hidden', '');
        }
      }
    };

    const subscribeToJobProgress = () => {
      unsub?.();
      if (tickTimer !== null) {
        clearInterval(tickTimer);
        tickTimer = null;
      }

      unsub = deps.store.subscribe((st) => {
        if (!host.isConnected) {
          unsub?.();
          if (tickTimer !== null) clearInterval(tickTimer);
          return;
        }
        renderJobProgress(st);
      });

      if (deps.store.getState().jobs.length === 0) {
        void deps.store.refreshJobs();
      }

      tickTimer = window.setInterval(() => {
        if (!host.isConnected) {
          if (tickTimer !== null) clearInterval(tickTimer);
          return;
        }
        const job = deps.store.getState().jobs.find((j) => j.jobId === boundJobId);
        if (!job || (job.status !== 'running' && job.status !== 'pending')) return;
        const clock = host.querySelector<HTMLElement>('[data-role="clock"]');
        if (clock) {
          clock.textContent = formatDurationMs(Date.now() - (job.createdAt || Date.now()));
        }
      }, 1000);
    };

    if (boundJobId) {
      subscribeToJobProgress();
    } else {
      renderConfigForm();
    }
  });
}
