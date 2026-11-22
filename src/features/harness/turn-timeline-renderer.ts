import type {
  ApprovalStep,
  StructuredTurn,
  ThinkingStep,
  ToolCallStep,
  ToolIconSpec,
  TurnStep,
} from './types.ts';

function esc(str: unknown): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeSvg(rawSvg: string): string {
  const s = (rawSvg || '').trim();
  if (!/^<svg[\s>]/i.test(s)) return '<span class="material-symbols-outlined">build</span>';
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '');
}

export function renderToolIconHtml(icon?: ToolIconSpec): string {
  if (!icon || !icon.value) {
    return '<span class="material-symbols-outlined metro-node-glyph" aria-hidden="true">build</span>';
  }
  if (icon.type === 'svg') {
    return `<span class="metro-node-custom-svg" aria-hidden="true">${sanitizeSvg(icon.value)}</span>`;
  }
  if (icon.type === 'image') {
    const safeUrl = /^(https?:|data:image\/|\/)/i.test(icon.value.trim()) ? icon.value.trim() : '';
    if (!safeUrl) {
      return '<span class="material-symbols-outlined metro-node-glyph" aria-hidden="true">build</span>';
    }
    return `<img class="metro-node-custom-img" src="${esc(safeUrl)}" alt="" aria-hidden="true" />`;
  }
  return `<span class="material-symbols-outlined metro-node-glyph" aria-hidden="true">${esc(icon.value)}</span>`;
}

function formatSec(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0.1 秒';
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)} 秒`;
  const mins = Math.floor(sec / 60);
  const rem = Math.round(sec % 60);
  return `${mins} 分 ${rem} 秒`;
}

function buildSummaryText(turn: StructuredTurn, now = Date.now()): string {
  const toolCount = turn.steps.filter((s) => s.kind === 'tool').length;
  const thinkCount = turn.steps.filter((s) => s.kind === 'thinking').length;
  const elapsedMs = (turn.endedAt ?? now) - turn.startedAt;
  const timeStr = formatSec(elapsedMs);

  if (turn.status === 'streaming') {
    const runningTool = [...turn.steps]
      .reverse()
      .find((s): s is ToolCallStep => s.kind === 'tool' && s.status === 'running');
    if (runningTool) {
      return `${runningTool.label} · 用时 ${timeStr}`;
    }
    const pendingApproval = turn.steps.find(
      (s): s is ApprovalStep => s.kind === 'approval' && s.status === 'pending'
    );
    if (pendingApproval) {
      return `等待权限确认 · ${pendingApproval.label}`;
    }
    return `正在思考与推演 (${timeStr})`;
  }

  if (turn.status === 'aborted') {
    return toolCount > 0
      ? `已手动中止 · 已执行 ${toolCount} 项操作，用时 ${timeStr}`
      : `已手动中止 · 用时 ${timeStr}`;
  }

  if (turn.status === 'error') {
    return `执行异常 · 用时 ${timeStr}`;
  }

  if (toolCount > 0) {
    return `已完成，执行了 ${toolCount} 项操作，用时 ${timeStr}`;
  }
  if (thinkCount > 0) {
    return `已完成深度思考，用时 ${timeStr}`;
  }
  return `已完成，用时 ${timeStr}`;
}

function renderThinkingNode(step: ThinkingStep): string {
  const isRunning = step.status === 'running';
  const isExpanded = step.expanded ?? isRunning;
  const oneLine = (step.content || '').replace(/\s+/g, ' ').trim();
  const preview = oneLine.length > 92 ? oneLine.slice(0, 92) + '…' : oneLine || '正在整理思路…';
  const durStr = step.endedAt ? ` (${((step.endedAt - step.startedAt) / 1000).toFixed(1)}s)` : '';

  return `
    <li class="metro-step metro-step--thinking ${isRunning ? 'is-running' : ''} ${isExpanded ? 'is-expanded' : ''}" data-step-id="${esc(step.id)}">
      <div class="metro-rail-col">
        <span class="metro-node-dot ${isRunning ? 'is-pulsing' : ''}">
          <span class="material-symbols-outlined metro-node-glyph" aria-hidden="true">psychology</span>
        </span>
        <span class="metro-rail-line" aria-hidden="true"></span>
      </div>
      <div class="metro-step-body">
        <button type="button" class="metro-step-head" data-metro-toggle="${esc(step.id)}" aria-expanded="${isExpanded ? 'true' : 'false'}">
          <span class="metro-step-title">思考${esc(durStr)}</span>
          ${!isExpanded ? `<span class="metro-step-preview">${esc(preview)}</span>` : ''}
          <span class="material-symbols-outlined metro-chevron" aria-hidden="true">${isExpanded ? 'expand_less' : 'expand_more'}</span>
        </button>
        <div class="metro-thinking-drawer" ${isExpanded ? '' : 'hidden'}>
          <div class="metro-thinking-text">${esc(step.content || (isRunning ? '…' : ''))}</div>
        </div>
      </div>
    </li>
  `.trim();
}

function renderToolNode(step: ToolCallStep): string {
  const isRunning = step.status === 'running';
  const isError = step.status === 'error' || step.status === 'denied';
  const isExpanded = Boolean(step.expanded);

  let statusTag = '';
  if (isRunning) {
    statusTag = '<span class="metro-status-pill is-running">执行中</span>';
  } else if (step.status === 'denied') {
    statusTag = '<span class="metro-status-pill is-error">已拒绝</span>';
  } else if (step.status === 'aborted') {
    statusTag = '<span class="metro-status-pill is-muted">已中止</span>';
  } else if (isError) {
    statusTag = '<span class="metro-status-pill is-error">失败</span>';
  } else if (step.endedAt) {
    const dt = (step.endedAt - step.startedAt) / 1000;
    if (dt >= 0.2) {
      statusTag = `<span class="metro-status-pill is-muted">${dt.toFixed(1)}s</span>`;
    }
  }

  let argsJson = '';
  try {
    argsJson = JSON.stringify(step.args || {}, null, 2);
  } catch {
    argsJson = String(step.args || '');
  }

  const outputText = step.errorMessage || step.resultText || step.resultSummary || '';

  return `
    <li class="metro-step metro-step--tool ${isRunning ? 'is-running' : ''} ${isError ? 'is-error' : ''} ${isExpanded ? 'is-expanded' : ''}" data-step-id="${esc(step.id)}">
      <div class="metro-rail-col">
        <span class="metro-node-dot ${isRunning ? 'is-pulsing' : ''}">
          ${renderToolIconHtml(step.icon)}
        </span>
        <span class="metro-rail-line" aria-hidden="true"></span>
      </div>
      <div class="metro-step-body">
        <div class="metro-step-row-wrap">
          <button type="button" class="metro-step-head" data-metro-toggle="${esc(step.id)}" aria-expanded="${isExpanded ? 'true' : 'false'}">
            <span class="metro-step-label">${esc(step.label)}</span>
            ${statusTag}
            <span class="material-symbols-outlined metro-chevron" aria-hidden="true">${isExpanded ? 'expand_less' : 'expand_more'}</span>
          </button>
          ${
            step.artifactId
              ? `<button type="button" class="metro-artifact-jump" data-jump-artifact="${esc(step.artifactId)}" title="在右侧「成果物」面板查看详情">
                  <span class="material-symbols-outlined" aria-hidden="true">open_in_new</span>
                  <span>查看产物</span>
                </button>`
              : ''
          }
        </div>
        <div class="metro-tool-drawer" ${isExpanded ? '' : 'hidden'}>
          <div class="metro-drawer-meta">
            <span>工具标识：<code>${esc(step.toolName)}</code></span>
            ${step.resultSummary ? `<span>摘要：${esc(step.resultSummary)}</span>` : ''}
          </div>
          ${
            argsJson && argsJson !== '{}'
              ? `<div class="metro-drawer-section">
                  <div class="metro-drawer-label">调用参数</div>
                  <pre class="metro-drawer-pre">${esc(argsJson)}</pre>
                </div>`
              : ''
          }
          ${
            outputText
              ? `<div class="metro-drawer-section">
                  <div class="metro-drawer-label">返回结果</div>
                  <pre class="metro-drawer-pre">${esc(outputText)}</pre>
                </div>`
              : ''
          }
        </div>
      </div>
    </li>
  `.trim();
}

function renderApprovalNode(step: ApprovalStep): string {
  const isPending = step.status === 'pending';
  const resolvedLabel =
    step.status === 'approved-once'
      ? '已允许本次操作'
      : step.status === 'approved-full'
        ? '已授权并切换为「完全权限」模式'
        : '已拒绝此操作';

  return `
    <li class="metro-step metro-step--approval ${isPending ? 'is-pending' : ''}" data-step-id="${esc(step.id)}">
      <div class="metro-rail-col">
        <span class="metro-node-dot ${isPending ? 'is-warning' : ''}">
          <span class="material-symbols-outlined metro-node-glyph" aria-hidden="true">gpp_maybe</span>
        </span>
        <span class="metro-rail-line" aria-hidden="true"></span>
      </div>
      <div class="metro-step-body">
        <div class="metro-approval-card">
          <div class="metro-approval-title">${esc(step.label)}</div>
          <div class="metro-approval-reason">${esc(step.reason)}</div>
          ${step.targetPath ? `<div class="metro-approval-path">目标路径：<code>${esc(step.targetPath)}</code></div>` : ''}
          ${
            isPending
              ? `<div class="metro-approval-actions">
                  <button type="button" class="metro-approval-btn is-primary" data-approval-id="${esc(step.id)}" data-approval-choice="approved-once">允许本次</button>
                  <button type="button" class="metro-approval-btn is-tonal" data-approval-id="${esc(step.id)}" data-approval-choice="approved-full">切换为完全权限</button>
                  <button type="button" class="metro-approval-btn is-ghost" data-approval-id="${esc(step.id)}" data-approval-choice="denied">拒绝</button>
                </div>`
              : `<div class="metro-approval-resolved">${esc(resolvedLabel)}</div>`
          }
        </div>
      </div>
    </li>
  `.trim();
}

function renderCompleteNode(step: Extract<TurnStep, { kind: 'complete' }>): string {
  const icon =
    step.status === 'aborted'
      ? 'cancel'
      : step.status === 'error'
        ? 'error'
        : 'check_circle';
  return `
    <li class="metro-step metro-step--complete is-${step.status}" data-step-id="${esc(step.id)}">
      <div class="metro-rail-col">
        <span class="metro-node-dot">
          <span class="material-symbols-outlined metro-node-glyph" aria-hidden="true">${icon}</span>
        </span>
      </div>
      <div class="metro-step-body">
        <div class="metro-step-head is-static">
          <span class="metro-step-label">${esc(step.label)}</span>
        </div>
      </div>
    </li>
  `.trim();
}

export function renderTurnTimelineHtml(
  turn: StructuredTurn,
  options: { autoCollapseTrace?: boolean } = {}
): string {
  if (!turn.steps || turn.steps.length === 0) {
    return '';
  }

  const autoCollapse = options.autoCollapseTrace !== false;
  const hasPendingApproval = turn.steps.some(
    (s) => s.kind === 'approval' && s.status === 'pending'
  );

  const isExpanded =
    turn.status === 'streaming' ||
    hasPendingApproval ||
    (turn.collapseSummaryOverride !== undefined ? !turn.collapseSummaryOverride : !autoCollapse);

  const summaryText = buildSummaryText(turn);
  const stepsHtml = turn.steps
    .map((step) => {
      if (step.kind === 'thinking') return renderThinkingNode(step);
      if (step.kind === 'tool') return renderToolNode(step);
      if (step.kind === 'approval') return renderApprovalNode(step);
      return renderCompleteNode(step);
    })
    .join('');

  return `
    <div class="metro-timeline-wrap ${isExpanded ? 'is-open' : 'is-collapsed'} is-${turn.status}" data-turn-timeline="${esc(turn.id)}">
      <button type="button" class="metro-summary-bar" data-metro-summary-toggle="${esc(turn.id)}" aria-expanded="${isExpanded ? 'true' : 'false'}">
        <span class="metro-summary-indicator" aria-hidden="true">
          ${
            turn.status === 'streaming'
              ? '<span class="material-symbols-outlined metro-spin">progress_activity</span>'
              : turn.status === 'aborted'
                ? '<span class="material-symbols-outlined">stop_circle</span>'
                : turn.status === 'error'
                  ? '<span class="material-symbols-outlined">error_outline</span>'
                  : '<span class="material-symbols-outlined">checklist</span>'
          }
        </span>
        <span class="metro-summary-text">${esc(summaryText)}</span>
        <span class="material-symbols-outlined metro-chevron" aria-hidden="true">${isExpanded ? 'expand_less' : 'expand_more'}</span>
      </button>
      <div class="metro-rail-container" ${isExpanded ? '' : 'hidden'}>
        <ol class="metro-rail-list">${stepsHtml}</ol>
      </div>
    </div>
  `.trim();
}

export function bindTimelineInteractions(
  container: HTMLElement,
  deps: {
    getTurn?: (turnId: string) => StructuredTurn | undefined;
    onJumpArtifact?: (artifactId: string) => void;
    onApprovalDecision?: (
      stepId: string,
      choice: 'approved-once' | 'approved-full' | 'denied'
    ) => void;
    onToggleStateChanged?: () => void;
  } = {}
): void {
  if (!container) return;

  container.querySelectorAll<HTMLElement>('[data-metro-summary-toggle]').forEach((btn) => {
    if (btn.dataset.boundMetroSummary === 'true') return;
    btn.dataset.boundMetroSummary = 'true';

    btn.addEventListener('click', () => {
      const turnId = btn.dataset.metroSummaryToggle || '';
      const wrap = btn.closest<HTMLElement>('.metro-timeline-wrap');
      const rail = wrap?.querySelector<HTMLElement>('.metro-rail-container');
      if (!wrap || !rail) return;

      const nextOpen = !wrap.classList.contains('is-open');
      wrap.classList.toggle('is-open', nextOpen);
      wrap.classList.toggle('is-collapsed', !nextOpen);
      btn.setAttribute('aria-expanded', String(nextOpen));
      const chev = btn.querySelector('.metro-chevron');
      if (chev) chev.textContent = nextOpen ? 'expand_less' : 'expand_more';

      if (nextOpen) rail.removeAttribute('hidden');
      else rail.setAttribute('hidden', '');

      const turn = deps.getTurn?.(turnId);
      if (turn) {
        turn.collapseSummaryOverride = !nextOpen;
        deps.onToggleStateChanged?.();
      }
    });
  });

  container.querySelectorAll<HTMLElement>('[data-metro-toggle]').forEach((btn) => {
    if (btn.dataset.boundMetroStep === 'true') return;
    btn.dataset.boundMetroStep = 'true';

    btn.addEventListener('click', () => {
      const stepId = btn.dataset.metroToggle || '';
      const stepEl = btn.closest<HTMLElement>('.metro-step');
      const wrap = btn.closest<HTMLElement>('.metro-timeline-wrap');
      const turnId = wrap?.dataset.turnTimeline || '';
      const drawer = stepEl?.querySelector<HTMLElement>('.metro-thinking-drawer, .metro-tool-drawer');
      if (!stepEl || !drawer) return;

      const nextExpanded = !stepEl.classList.contains('is-expanded');
      stepEl.classList.toggle('is-expanded', nextExpanded);
      btn.setAttribute('aria-expanded', String(nextExpanded));
      const chev = btn.querySelector('.metro-chevron');
      if (chev) chev.textContent = nextExpanded ? 'expand_less' : 'expand_more';

      const preview = btn.querySelector<HTMLElement>('.metro-step-preview');
      if (preview) {
        preview.style.display = nextExpanded ? 'none' : '';
      }

      if (nextExpanded) drawer.removeAttribute('hidden');
      else drawer.setAttribute('hidden', '');

      const turn = deps.getTurn?.(turnId);
      const stepObj = turn?.steps.find((s) => s.id === stepId);
      if (stepObj && (stepObj.kind === 'thinking' || stepObj.kind === 'tool')) {
        stepObj.expanded = nextExpanded;
        deps.onToggleStateChanged?.();
      }
    });
  });

  container.querySelectorAll<HTMLElement>('[data-jump-artifact]').forEach((btn) => {
    if (btn.dataset.boundJumpArt === 'true') return;
    btn.dataset.boundJumpArt = 'true';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const artId = btn.dataset.jumpArtifact;
      if (artId) deps.onJumpArtifact?.(artId);
    });
  });

  container.querySelectorAll<HTMLElement>('[data-approval-choice]').forEach((btn) => {
    if (btn.dataset.boundApproval === 'true') return;
    btn.dataset.boundApproval = 'true';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const stepId = btn.dataset.approvalId || '';
      const choice = btn.dataset.approvalChoice as 'approved-once' | 'approved-full' | 'denied';
      if (stepId && choice) {
        deps.onApprovalDecision?.(stepId, choice);
      }
    });
  });
}
