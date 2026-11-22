import { mdToHtml } from '../../ai/client/chat-markdown.ts';
import { renderToolIconHtml } from './turn-timeline-renderer.ts';
import type {
  ApprovalBlock,
  ApprovalStep,
  QuestionBlock,
  StatusBlock,
  StructuredTurn,
  TextBlock,
  ThinkingBlock,
  ThinkingStep,
  ToolBlock,
  ToolCallStep,
  TurnBlock,
  WidgetBlock,
} from './types.ts';

export type StepRailBlock = ThinkingBlock | ToolBlock | ApprovalBlock;

export type RenderSlot =
  | {
      kind: 'segment';
      id: string;
      blocks: StepRailBlock[];
    }
  | {
      kind: 'block';
      id: string;
      block: TextBlock | WidgetBlock | QuestionBlock | StatusBlock;
    };

export interface TurnInterleaveRenderOptions {
  autoCollapseTrace?: boolean;
  isTurnStreaming?: boolean;
}

export interface TurnStreamViewDeps {
  autoCollapseTrace?: () => boolean;
  onToggleStateChanged?: () => void;
  onJumpArtifact?: (artifactId: string) => void;
  onApprovalDecision?: (
    stepId: string,
    choice: 'approved-once' | 'approved-full' | 'denied'
  ) => void;
  onStatusAction?: (action: 'continue-exploring' | 'retry', block: StatusBlock) => void;
  hydrateProseElement?: (el: HTMLElement) => void;
  renderWidgetElement?: (
    block: WidgetBlock,
    existingEl: HTMLElement | null
  ) => HTMLElement;
  renderQuestionElement?: (
    block: QuestionBlock,
    existingEl: HTMLElement | null
  ) => HTMLElement;
}

function esc(str: unknown): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatSec(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0.1 秒';
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)} 秒`;
  const mins = Math.floor(sec / 60);
  const rem = Math.round(sec % 60);
  return `${mins} 分 ${rem} 秒`;
}

function isStepRailBlock(block: TurnBlock): block is StepRailBlock {
  return block.kind === 'thinking' || block.kind === 'tool' || block.kind === 'approval';
}

export function normalizeTurnBlocks(turn: StructuredTurn): TurnBlock[] {
  if (Array.isArray(turn.blocks) && turn.blocks.length > 0) {
    return turn.blocks;
  }

  const fallback: TurnBlock[] = [];
  for (const step of turn.steps || []) {
    if (step.kind === 'thinking') {
      fallback.push({
        id: step.id,
        kind: 'thinking',
        stepId: step.id,
        content: step.content,
        startedAt: step.startedAt,
        endedAt: step.endedAt,
        status: step.status,
        expanded: step.expanded,
      });
    } else if (step.kind === 'tool') {
      fallback.push({
        id: step.id,
        kind: 'tool',
        stepId: step.id,
        toolName: step.toolName,
        label: step.label,
        icon: step.icon,
        args: step.args,
        resultSummary: step.resultSummary,
        resultText: step.resultText,
        status: step.status,
        startedAt: step.startedAt,
        endedAt: step.endedAt,
        artifactId: step.artifactId,
        errorMessage: step.errorMessage,
        expanded: step.expanded,
      });
    } else if (step.kind === 'approval') {
      fallback.push({
        id: step.id,
        kind: 'approval',
        stepId: step.id,
        toolName: step.toolName,
        label: step.label,
        reason: step.reason,
        targetPath: step.targetPath,
        status: step.status,
        createdAt: step.createdAt,
        resolvedAt: step.resolvedAt,
      });
    }
  }

  if (turn.contentMarkdown && turn.contentMarkdown.trim().length > 0) {
    fallback.push({
      id: `${turn.id}_legacy_text`,
      kind: 'text',
      markdown: turn.contentMarkdown,
      startedAt: turn.startedAt,
      endedAt: turn.endedAt,
      status: turn.status === 'streaming' ? 'streaming' : 'completed',
    });
  }

  if (turn.errorMessage && (turn.status === 'error' || turn.status === 'aborted')) {
    fallback.push({
      id: `${turn.id}_legacy_status`,
      kind: 'status',
      tone: turn.status === 'error' ? 'error' : 'warning',
      label: turn.status === 'error' ? '本轮执行出现中断' : '本轮响应已中止',
      detail: turn.errorMessage,
      timestamp: turn.endedAt || Date.now(),
    });
  }

  return fallback;
}

export function groupTurnBlocksIntoSegments(blocks: TurnBlock[]): RenderSlot[] {
  const slots: RenderSlot[] = [];
  let currentSteps: StepRailBlock[] = [];

  const flushSegment = () => {
    if (currentSteps.length === 0) return;
    slots.push({
      kind: 'segment',
      id: `seg_${currentSteps[0].id}`,
      blocks: currentSteps,
    });
    currentSteps = [];
  };

  for (const block of blocks) {
    if (isStepRailBlock(block)) {
      currentSteps.push(block);
      continue;
    }
    flushSegment();
    slots.push({
      kind: 'block',
      id: block.id,
      block,
    });
  }

  flushSegment();
  return slots;
}

export function buildSegmentSummaryText(
  segmentBlocks: StepRailBlock[],
  now = Date.now()
): { text: string; isActive: boolean; hasError: boolean; hasPendingApproval: boolean } {
  let startAt = Number.MAX_SAFE_INTEGER;
  let endAt = 0;
  let isActive = false;
  let hasError = false;
  let hasPendingApproval = false;
  let toolCount = 0;
  let thinkCount = 0;
  let runningToolLabel = '';

  for (const b of segmentBlocks) {
    if (b.kind === 'thinking') {
      thinkCount++;
      startAt = Math.min(startAt, b.startedAt);
      if (b.status === 'running') isActive = true;
      endAt = Math.max(endAt, b.endedAt ?? now);
    } else if (b.kind === 'tool') {
      toolCount++;
      startAt = Math.min(startAt, b.startedAt);
      if (b.status === 'running') {
        isActive = true;
        runningToolLabel = b.label;
      }
      if (b.status === 'error' || b.status === 'denied') hasError = true;
      endAt = Math.max(endAt, b.endedAt ?? now);
    } else if (b.kind === 'approval') {
      startAt = Math.min(startAt, b.createdAt);
      if (b.status === 'pending') {
        hasPendingApproval = true;
        isActive = true;
      }
      endAt = Math.max(endAt, b.resolvedAt ?? now);
    }
  }

  const elapsedMs = startAt < Number.MAX_SAFE_INTEGER ? Math.max(0, endAt - startAt) : 0;
  const timeStr = formatSec(elapsedMs);

  if (hasPendingApproval) {
    const pending = segmentBlocks.find(
      (b): b is ApprovalBlock => b.kind === 'approval' && b.status === 'pending'
    );
    return {
      text: `等待权限确认 · ${pending?.label || '敏感操作'}`,
      isActive: true,
      hasError: false,
      hasPendingApproval: true,
    };
  }

  if (isActive) {
    if (runningToolLabel) {
      return {
        text: `${runningToolLabel} · 用时 ${timeStr}`,
        isActive: true,
        hasError,
        hasPendingApproval: false,
      };
    }
    return {
      text: `正在思考与推演 (${timeStr})`,
      isActive: true,
      hasError,
      hasPendingApproval: false,
    };
  }

  if (toolCount > 0 && thinkCount > 0) {
    return {
      text: `思考并执行了 ${toolCount} 项操作 · ${timeStr}`,
      isActive: false,
      hasError,
      hasPendingApproval: false,
    };
  }
  if (toolCount > 0) {
    return {
      text: `执行了 ${toolCount} 项操作 · ${timeStr}`,
      isActive: false,
      hasError,
      hasPendingApproval: false,
    };
  }
  return {
    text: `深度思考 · ${timeStr}`,
    isActive: false,
    hasError,
    hasPendingApproval: false,
  };
}

function renderThinkingBlockHtml(block: ThinkingBlock): string {
  const isRunning = block.status === 'running';
  const isExpanded = block.expanded ?? isRunning;
  const oneLine = (block.content || '').replace(/\s+/g, ' ').trim();
  const preview = oneLine.length > 92 ? oneLine.slice(0, 92) + '…' : oneLine || '正在整理思路…';
  const durStr = block.endedAt ? ` (${((block.endedAt - block.startedAt) / 1000).toFixed(1)}s)` : '';

  return `
    <li class="metro-step metro-step--thinking ${isRunning ? 'is-running' : ''} ${isExpanded ? 'is-expanded' : ''}" data-step-id="${esc(block.stepId)}" data-block-id="${esc(block.id)}">
      <div class="metro-rail-col">
        <span class="metro-node-dot ${isRunning ? 'is-pulsing' : ''}">
          <span class="material-symbols-outlined metro-node-glyph" aria-hidden="true">psychology</span>
        </span>
        <span class="metro-rail-line" aria-hidden="true"></span>
      </div>
      <div class="metro-step-body">
        <button type="button" class="metro-step-head" data-metro-toggle="${esc(block.stepId)}" aria-expanded="${isExpanded ? 'true' : 'false'}">
          <span class="metro-step-title">思考${esc(durStr)}</span>
          <span class="metro-step-preview" ${isExpanded ? 'style="display:none"' : ''}>${esc(preview)}</span>
          <span class="material-symbols-outlined metro-chevron" aria-hidden="true">${isExpanded ? 'expand_less' : 'expand_more'}</span>
        </button>
        <div class="metro-thinking-drawer" ${isExpanded ? '' : 'hidden'}>
          <div class="metro-thinking-text">${esc(block.content || (isRunning ? '…' : ''))}</div>
        </div>
      </div>
    </li>
  `.trim();
}

function computeToolStatusBadge(block: ToolBlock): { label: string; cls: string } | null {
  if (block.status === 'running') return { label: '执行中', cls: 'is-running' };
  if (block.status === 'denied') return { label: '已拒绝', cls: 'is-error' };
  if (block.status === 'aborted') return { label: '已中止', cls: 'is-muted' };
  if (block.status === 'error') return { label: '失败', cls: 'is-error' };
  if (block.endedAt) {
    const dt = (block.endedAt - block.startedAt) / 1000;
    if (dt >= 0.2) return { label: `${dt.toFixed(1)}s`, cls: 'is-muted' };
  }
  return null;
}

function renderToolBlockHtml(block: ToolBlock): string {
  const isRunning = block.status === 'running';
  const isError = block.status === 'error' || block.status === 'denied';
  const isExpanded = Boolean(block.expanded);
  const badge = computeToolStatusBadge(block);
  const statusTag = badge
    ? `<span class="metro-status-pill ${badge.cls}">${esc(badge.label)}</span>`
    : '';

  let argsJson = '';
  try {
    argsJson = JSON.stringify(block.args || {}, null, 2);
  } catch {
    argsJson = String(block.args || '');
  }
  const outputText = block.errorMessage || block.resultText || block.resultSummary || '';

  return `
    <li class="metro-step metro-step--tool ${isRunning ? 'is-running' : ''} ${isError ? 'is-error' : ''} ${isExpanded ? 'is-expanded' : ''}" data-step-id="${esc(block.stepId)}" data-block-id="${esc(block.id)}">
      <div class="metro-rail-col">
        <span class="metro-node-dot ${isRunning ? 'is-pulsing' : ''}">
          ${renderToolIconHtml(block.icon)}
        </span>
        <span class="metro-rail-line" aria-hidden="true"></span>
      </div>
      <div class="metro-step-body">
        <div class="metro-step-row-wrap">
          <button type="button" class="metro-step-head" data-metro-toggle="${esc(block.stepId)}" aria-expanded="${isExpanded ? 'true' : 'false'}">
            <span class="metro-step-label">${esc(block.label)}</span>
            ${statusTag}
            <span class="material-symbols-outlined metro-chevron" aria-hidden="true">${isExpanded ? 'expand_less' : 'expand_more'}</span>
          </button>
          <span class="metro-tool-jump-slot">
            ${
              block.artifactId
                ? `<button type="button" class="metro-artifact-jump" data-jump-artifact="${esc(block.artifactId)}" title="在右侧「成果物」面板查看详情">
                    <span class="material-symbols-outlined" aria-hidden="true">open_in_new</span>
                    <span>查看产物</span>
                  </button>`
                : ''
            }
          </span>
        </div>
        <div class="metro-tool-drawer" ${isExpanded ? '' : 'hidden'}>
          <div class="metro-drawer-meta">
            <span>工具标识：<code>${esc(block.toolName)}</code></span>
            <span class="metro-drawer-summary">${block.resultSummary ? `摘要：${esc(block.resultSummary)}` : ''}</span>
          </div>
          ${
            argsJson && argsJson !== '{}'
              ? `<div class="metro-drawer-section metro-drawer-args">
                  <div class="metro-drawer-label">调用参数</div>
                  <pre class="metro-drawer-pre">${esc(argsJson)}</pre>
                </div>`
              : ''
          }
          <div class="metro-drawer-section metro-drawer-output" ${outputText ? '' : 'hidden'}>
            <div class="metro-drawer-label">返回结果</div>
            <pre class="metro-drawer-pre">${esc(outputText)}</pre>
          </div>
        </div>
      </div>
    </li>
  `.trim();
}

function renderApprovalBlockHtml(block: ApprovalBlock): string {
  const isPending = block.status === 'pending';
  const resolvedLabel =
    block.status === 'approved-once'
      ? '已允许本次操作'
      : block.status === 'approved-full'
        ? '已授权并切换为「完全权限」模式'
        : '已拒绝此操作';

  return `
    <li class="metro-step metro-step--approval ${isPending ? 'is-pending' : ''}" data-step-id="${esc(block.stepId)}" data-block-id="${esc(block.id)}">
      <div class="metro-rail-col">
        <span class="metro-node-dot ${isPending ? 'is-warning' : ''}">
          <span class="material-symbols-outlined metro-node-glyph" aria-hidden="true">gpp_maybe</span>
        </span>
        <span class="metro-rail-line" aria-hidden="true"></span>
      </div>
      <div class="metro-step-body">
        <div class="metro-approval-card">
          <div class="metro-approval-title">${esc(block.label)}</div>
          <div class="metro-approval-reason">${esc(block.reason)}</div>
          ${block.targetPath ? `<div class="metro-approval-path">目标路径：<code>${esc(block.targetPath)}</code></div>` : ''}
          <div class="metro-approval-state-slot">
            ${
              isPending
                ? `<div class="metro-approval-actions">
                    <button type="button" class="metro-approval-btn is-primary" data-approval-id="${esc(block.stepId)}" data-approval-choice="approved-once">允许本次</button>
                    <button type="button" class="metro-approval-btn is-tonal" data-approval-id="${esc(block.stepId)}" data-approval-choice="approved-full">切换为完全权限</button>
                    <button type="button" class="metro-approval-btn is-ghost" data-approval-id="${esc(block.stepId)}" data-approval-choice="denied">拒绝</button>
                  </div>`
                : `<div class="metro-approval-resolved">${esc(resolvedLabel)}</div>`
            }
          </div>
        </div>
      </div>
    </li>
  `.trim();
}

function renderStatusBlockHtml(block: StatusBlock): string {
  const icon =
    block.tone === 'error'
      ? 'error_outline'
      : block.tone === 'warning'
        ? 'warning_amber'
        : block.tone === 'completed'
          ? 'task_alt'
          : 'info';

  return `
    <div class="harness-status-block is-${esc(block.tone)}" data-block-id="${esc(block.id)}">
      <span class="material-symbols-outlined harness-status-icon" aria-hidden="true">${icon}</span>
      <div class="harness-status-copy">
        <div class="harness-status-label">${esc(block.label)}</div>
        ${block.detail ? `<div class="harness-status-detail">${esc(block.detail)}</div>` : ''}
      </div>
      ${
        block.action === 'continue-exploring'
          ? `<button type="button" class="harness-status-action-btn" data-turn-status-action="continue-exploring" data-block-id="${esc(block.id)}">继续探索</button>`
          : block.action === 'retry'
            ? `<button type="button" class="harness-status-action-btn" data-turn-status-action="retry" data-block-id="${esc(block.id)}">重试</button>`
            : ''
      }
    </div>
  `.trim();
}

export function renderSegmentHtml(
  segmentId: string,
  blocks: StepRailBlock[],
  turn: StructuredTurn,
  options: TurnInterleaveRenderOptions = {}
): string {
  const summary = buildSegmentSummaryText(blocks);
  const autoCollapse = options.autoCollapseTrace !== false;
  const isTurnStreaming = turn.status === 'streaming';
  const isExpanded =
    isTurnStreaming ||
    summary.isActive ||
    summary.hasPendingApproval ||
    (turn.collapseSummaryOverride !== undefined ? !turn.collapseSummaryOverride : !autoCollapse);

  const indicatorHtml = summary.isActive
    ? '<span class="material-symbols-outlined metro-spin">progress_activity</span>'
    : summary.hasError
      ? '<span class="material-symbols-outlined">error_outline</span>'
      : '<span class="material-symbols-outlined">checklist</span>';

  const itemsHtml = blocks
    .map((b) => {
      if (b.kind === 'thinking') return renderThinkingBlockHtml(b);
      if (b.kind === 'tool') return renderToolBlockHtml(b);
      return renderApprovalBlockHtml(b);
    })
    .join('');

  return `
    <div class="metro-timeline-wrap metro-segment ${isExpanded ? 'is-open' : 'is-collapsed'} is-${esc(turn.status)}" data-segment-id="${esc(segmentId)}" data-turn-timeline="${esc(turn.id)}">
      <button type="button" class="metro-summary-bar" data-segment-toggle="${esc(segmentId)}" aria-expanded="${isExpanded ? 'true' : 'false'}">
        <span class="metro-summary-indicator" aria-hidden="true">${indicatorHtml}</span>
        <span class="metro-summary-text">${esc(summary.text)}</span>
        <span class="material-symbols-outlined metro-chevron" aria-hidden="true">${isExpanded ? 'expand_less' : 'expand_more'}</span>
      </button>
      <div class="metro-rail-container" ${isExpanded ? '' : 'hidden'}>
        <ol class="metro-rail-list">${itemsHtml}</ol>
      </div>
    </div>
  `.trim();
}

export function renderTurnInterleavedHtml(
  turn: StructuredTurn,
  options: TurnInterleaveRenderOptions = {}
): string {
  const blocks = normalizeTurnBlocks(turn);
  const slots = groupTurnBlocksIntoSegments(blocks);

  return slots
    .map((slot) => {
      if (slot.kind === 'segment') {
        return renderSegmentHtml(slot.id, slot.blocks, turn, options);
      }
      const b = slot.block;
      if (b.kind === 'text') {
        return `<div class="harness-prose-block" data-block-id="${esc(b.id)}"><div class="harness-prose-rendered harness-markdown">${mdToHtml(b.markdown, true)}</div></div>`;
      }
      if (b.kind === 'status') {
        return renderStatusBlockHtml(b);
      }
      if (b.kind === 'widget') {
        return `<div class="harness-widget-block" data-block-id="${esc(b.id)}" data-widget-type="${esc(b.widgetType)}" data-artifact-id="${esc(b.artifactId || '')}" data-job-id="${esc(b.jobId || '')}"></div>`;
      }
      if (b.kind === 'question') {
        return `<div class="harness-question-block" data-block-id="${esc(b.id)}" data-question-id="${esc(b.questionId)}"></div>`;
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

interface ProseCacheEntry {
  el: HTMLElement;
  innerEl: HTMLElement;
  lastMarkdown: string;
  lastStatus: TextBlock['status'];
  prevRawNodesHtml: string[];
}

interface WidgetCacheEntry {
  el: HTMLElement;
  fingerprint: string;
}

export class TurnStreamView {
  private readonly hostEl: HTMLElement;
  private readonly deps: TurnStreamViewDeps;
  private currentTurn: StructuredTurn | null = null;

  private readonly segmentEls = new Map<string, HTMLElement>();
  private readonly stepEls = new Map<string, HTMLElement>();
  private readonly manualSegmentOpen = new Map<string, boolean>();
  private readonly manualStepOpen = new Map<string, boolean>();
  private readonly proseCache = new Map<string, ProseCacheEntry>();
  private readonly widgetCache = new Map<string, WidgetCacheEntry>();
  private readonly statusCache = new Map<string, { el: HTMLElement; fingerprint: string }>();
  private readonly questionCache = new Map<string, { el: HTMLElement; fingerprint: string }>();

  constructor(hostEl: HTMLElement, deps: TurnStreamViewDeps = {}) {
    this.hostEl = hostEl;
    this.deps = deps;
    this.hostEl.classList.add('harness-turn-stream');
    this.bindDelegatedEvents();
  }

  public sync(turn: StructuredTurn): void {
    this.currentTurn = turn;
    const blocks = normalizeTurnBlocks(turn);
    const slots = groupTurnBlocksIntoSegments(blocks);
    const liveSlotIds = new Set(slots.map((s) => s.id));

    for (const [id, el] of this.segmentEls) {
      if (!liveSlotIds.has(id)) {
        el.remove();
        this.segmentEls.delete(id);
      }
    }
    for (const [id, entry] of this.proseCache) {
      if (!liveSlotIds.has(id)) {
        entry.el.remove();
        this.proseCache.delete(id);
      }
    }
    for (const [id, entry] of this.widgetCache) {
      if (!liveSlotIds.has(id)) {
        entry.el.remove();
        this.widgetCache.delete(id);
      }
    }
    for (const [id, entry] of this.statusCache) {
      if (!liveSlotIds.has(id)) {
        entry.el.remove();
        this.statusCache.delete(id);
      }
    }
    for (const [id, entry] of this.questionCache) {
      if (!liveSlotIds.has(id)) {
        entry.el.remove();
        this.questionCache.delete(id);
      }
    }

    slots.forEach((slot, idx) => {
      let slotEl: HTMLElement;
      if (slot.kind === 'segment') {
        slotEl = this.syncSegmentSlot(slot.id, slot.blocks, turn);
      } else if (slot.block.kind === 'text') {
        slotEl = this.syncTextSlot(slot.block);
      } else if (slot.block.kind === 'widget') {
        slotEl = this.syncWidgetSlot(slot.block);
      } else if (slot.block.kind === 'question') {
        slotEl = this.syncQuestionSlot(slot.block);
      } else {
        slotEl = this.syncStatusSlot(slot.block);
      }

      const currentAtIdx = this.hostEl.children[idx];
      if (currentAtIdx !== slotEl) {
        this.hostEl.insertBefore(slotEl, currentAtIdx || null);
      }
    });
  }

  private syncSegmentSlot(
    segmentId: string,
    blocks: StepRailBlock[],
    turn: StructuredTurn
  ): HTMLElement {
    let segEl = this.segmentEls.get(segmentId);
    const summary = buildSegmentSummaryText(blocks);
    const autoCollapse = this.deps.autoCollapseTrace ? this.deps.autoCollapseTrace() : true;

    const manualOpen = this.manualSegmentOpen.get(segmentId);
    const isExpanded =
      manualOpen !== undefined
        ? manualOpen
        : turn.status === 'streaming' || summary.isActive || summary.hasPendingApproval
          ? true
          : turn.collapseSummaryOverride !== undefined
            ? !turn.collapseSummaryOverride
            : !autoCollapse;

    if (!segEl) {
      const tpl = document.createElement('template');
      tpl.innerHTML = renderSegmentHtml(segmentId, blocks, turn, {
        autoCollapseTrace: autoCollapse,
        isTurnStreaming: turn.status === 'streaming',
      });
      segEl = tpl.content.firstElementChild as HTMLElement;
      this.segmentEls.set(segmentId, segEl);
      segEl.querySelectorAll<HTMLElement>('[data-block-id]').forEach((li) => {
        const bid = li.dataset.blockId;
        if (bid) this.stepEls.set(bid, li);
      });
      return segEl;
    }

    segEl.classList.toggle('is-open', isExpanded);
    segEl.classList.toggle('is-collapsed', !isExpanded);
    segEl.classList.toggle('is-streaming', turn.status === 'streaming');
    segEl.classList.toggle('is-completed', turn.status === 'completed');
    segEl.classList.toggle('is-aborted', turn.status === 'aborted');
    segEl.classList.toggle('is-error', turn.status === 'error');

    const barBtn = segEl.querySelector<HTMLElement>('.metro-summary-bar');
    if (barBtn) {
      barBtn.setAttribute('aria-expanded', String(isExpanded));
      const chev = barBtn.querySelector('.metro-chevron');
      if (chev && chev.textContent !== (isExpanded ? 'expand_less' : 'expand_more')) {
        chev.textContent = isExpanded ? 'expand_less' : 'expand_more';
      }
    }

    const railContainer = segEl.querySelector<HTMLElement>('.metro-rail-container');
    if (railContainer) {
      if (isExpanded) railContainer.removeAttribute('hidden');
      else railContainer.setAttribute('hidden', '');
    }

    const indicatorEl = segEl.querySelector<HTMLElement>('.metro-summary-indicator');
    if (indicatorEl) {
      const nextIndicatorKey = summary.isActive
        ? 'active'
        : summary.hasError
          ? 'error'
          : 'done';
      if (indicatorEl.dataset.indicatorKey !== nextIndicatorKey) {
        indicatorEl.dataset.indicatorKey = nextIndicatorKey;
        indicatorEl.innerHTML =
          nextIndicatorKey === 'active'
            ? '<span class="material-symbols-outlined metro-spin">progress_activity</span>'
            : nextIndicatorKey === 'error'
              ? '<span class="material-symbols-outlined">error_outline</span>'
              : '<span class="material-symbols-outlined">checklist</span>';
      }
    }

    const summaryTextEl = segEl.querySelector<HTMLElement>('.metro-summary-text');
    if (summaryTextEl && summaryTextEl.textContent !== summary.text) {
      summaryTextEl.textContent = summary.text;
    }

    const listEl = segEl.querySelector<HTMLElement>('.metro-rail-list');
    if (listEl) {
      const liveStepIds = new Set(blocks.map((b) => b.id));
      Array.from(listEl.children).forEach((child) => {
        const el = child as HTMLElement;
        const bid = el.dataset.blockId || '';
        if (!liveStepIds.has(bid)) {
          el.remove();
          this.stepEls.delete(bid);
        }
      });

      blocks.forEach((b, stepIdx) => {
        const li = this.syncStepLi(b);
        const cur = listEl.children[stepIdx];
        if (cur !== li) {
          listEl.insertBefore(li, cur || null);
        }
      });
    }

    return segEl;
  }

  private syncStepLi(block: StepRailBlock): HTMLElement {
    let li = this.stepEls.get(block.id);
    if (!li) {
      const tpl = document.createElement('template');
      if (block.kind === 'thinking') tpl.innerHTML = renderThinkingBlockHtml(block);
      else if (block.kind === 'tool') tpl.innerHTML = renderToolBlockHtml(block);
      else tpl.innerHTML = renderApprovalBlockHtml(block);
      li = tpl.content.firstElementChild as HTMLElement;
      this.stepEls.set(block.id, li);
      return li;
    }

    if (block.kind === 'thinking') {
      const isRunning = block.status === 'running';
      const userExpanded = this.manualStepOpen.get(block.stepId);
      const isExpanded = userExpanded !== undefined ? userExpanded : (block.expanded ?? isRunning);

      li.classList.toggle('is-running', isRunning);
      li.classList.toggle('is-expanded', isExpanded);

      const dot = li.querySelector('.metro-node-dot');
      if (dot) dot.classList.toggle('is-pulsing', isRunning);

      const durStr = block.endedAt
        ? ` (${((block.endedAt - block.startedAt) / 1000).toFixed(1)}s)`
        : '';
      const titleText = `思考${durStr}`;
      const titleEl = li.querySelector('.metro-step-title');
      if (titleEl && titleEl.textContent !== titleText) {
        titleEl.textContent = titleText;
      }

      const oneLine = (block.content || '').replace(/\s+/g, ' ').trim();
      const previewText =
        oneLine.length > 92 ? oneLine.slice(0, 92) + '…' : oneLine || '正在整理思路…';
      const previewEl = li.querySelector<HTMLElement>('.metro-step-preview');
      if (previewEl) {
        if (previewEl.textContent !== previewText) previewEl.textContent = previewText;
        previewEl.style.display = isExpanded ? 'none' : '';
      }

      const headBtn = li.querySelector<HTMLElement>('.metro-step-head');
      if (headBtn) headBtn.setAttribute('aria-expanded', String(isExpanded));
      const chev = li.querySelector('.metro-chevron');
      if (chev) chev.textContent = isExpanded ? 'expand_less' : 'expand_more';

      const drawer = li.querySelector<HTMLElement>('.metro-thinking-drawer');
      if (drawer) {
        if (isExpanded) drawer.removeAttribute('hidden');
        else drawer.setAttribute('hidden', '');
      }

      const textEl = li.querySelector<HTMLElement>('.metro-thinking-text');
      const nextText = block.content || (isRunning ? '…' : '');
      if (textEl && textEl.textContent !== nextText) {
        textEl.textContent = nextText;
      }
      return li;
    }

    if (block.kind === 'tool') {
      const isRunning = block.status === 'running';
      const isError = block.status === 'error' || block.status === 'denied';
      const userExpanded = this.manualStepOpen.get(block.stepId);
      const isExpanded = userExpanded !== undefined ? userExpanded : Boolean(block.expanded);

      li.classList.toggle('is-running', isRunning);
      li.classList.toggle('is-error', isError);
      li.classList.toggle('is-expanded', isExpanded);

      const dot = li.querySelector('.metro-node-dot');
      if (dot) dot.classList.toggle('is-pulsing', isRunning);

      const labelEl = li.querySelector('.metro-step-label');
      if (labelEl && labelEl.textContent !== block.label) {
        labelEl.textContent = block.label;
      }

      const badge = computeToolStatusBadge(block);
      const headBtn = li.querySelector<HTMLElement>('.metro-step-head');
      if (headBtn) {
        headBtn.setAttribute('aria-expanded', String(isExpanded));
        let pillEl = headBtn.querySelector<HTMLElement>('.metro-status-pill');
        if (badge) {
          if (!pillEl) {
            pillEl = document.createElement('span');
            pillEl.className = `metro-status-pill ${badge.cls}`;
            const chev = headBtn.querySelector('.metro-chevron');
            headBtn.insertBefore(pillEl, chev || null);
          } else {
            pillEl.className = `metro-status-pill ${badge.cls}`;
          }
          if (pillEl.textContent !== badge.label) pillEl.textContent = badge.label;
        } else if (pillEl) {
          pillEl.remove();
        }
        const chev = headBtn.querySelector('.metro-chevron');
        if (chev) chev.textContent = isExpanded ? 'expand_less' : 'expand_more';
      }

      const jumpSlot = li.querySelector<HTMLElement>('.metro-tool-jump-slot');
      if (jumpSlot) {
        const curArt = jumpSlot.dataset.artifactId || '';
        const nextArt = block.artifactId || '';
        if (curArt !== nextArt) {
          jumpSlot.dataset.artifactId = nextArt;
          jumpSlot.innerHTML = nextArt
            ? `<button type="button" class="metro-artifact-jump" data-jump-artifact="${esc(nextArt)}" title="在右侧「成果物」面板查看详情"><span class="material-symbols-outlined" aria-hidden="true">open_in_new</span><span>查看产物</span></button>`
            : '';
        }
      }

      const drawer = li.querySelector<HTMLElement>('.metro-tool-drawer');
      if (drawer) {
        if (isExpanded) drawer.removeAttribute('hidden');
        else drawer.setAttribute('hidden', '');
      }

      const summaryEl = li.querySelector<HTMLElement>('.metro-drawer-summary');
      const nextSummary = block.resultSummary ? `摘要：${block.resultSummary}` : '';
      if (summaryEl && summaryEl.textContent !== nextSummary) {
        summaryEl.textContent = nextSummary;
      }

      const outputWrap = li.querySelector<HTMLElement>('.metro-drawer-output');
      const outputPre = outputWrap?.querySelector<HTMLElement>('.metro-drawer-pre');
      const outputText = block.errorMessage || block.resultText || block.resultSummary || '';
      if (outputWrap && outputPre) {
        if (outputText) {
          outputWrap.removeAttribute('hidden');
          if (outputPre.textContent !== outputText) outputPre.textContent = outputText;
        } else {
          outputWrap.setAttribute('hidden', '');
        }
      }
      return li;
    }

    const isPending = block.status === 'pending';
    li.classList.toggle('is-pending', isPending);
    const dot = li.querySelector('.metro-node-dot');
    if (dot) dot.classList.toggle('is-warning', isPending);

    const stateSlot = li.querySelector<HTMLElement>('.metro-approval-state-slot');
    if (stateSlot && stateSlot.dataset.approvalStatus !== block.status) {
      stateSlot.dataset.approvalStatus = block.status;
      if (!isPending) {
        const resolvedLabel =
          block.status === 'approved-once'
            ? '已允许本次操作'
            : block.status === 'approved-full'
              ? '已授权并切换为「完全权限」模式'
              : '已拒绝此操作';
        stateSlot.innerHTML = `<div class="metro-approval-resolved">${esc(resolvedLabel)}</div>`;
      }
    }

    return li;
  }

  private syncTextSlot(block: TextBlock): HTMLElement {
    let entry = this.proseCache.get(block.id);
    if (!entry) {
      const el = document.createElement('div');
      el.className = 'harness-prose-block';
      el.dataset.blockId = block.id;
      const innerEl = document.createElement('div');
      innerEl.className = 'harness-prose-rendered harness-markdown';
      el.appendChild(innerEl);
      entry = {
        el,
        innerEl,
        lastMarkdown: '',
        lastStatus: block.status,
        prevRawNodesHtml: [],
      };
      this.proseCache.set(block.id, entry);
    }

    if (entry.lastMarkdown === block.markdown && entry.lastStatus === block.status) {
      return entry.el;
    }

    entry.el.dataset.blockStatus = block.status;

    const rawHtml = mdToHtml(block.markdown || '', true);
    const tpl = document.createElement('template');
    tpl.innerHTML = rawHtml;
    const nextNodes = Array.from(tpl.content.childNodes).filter(
      (n) => n.nodeType === Node.ELEMENT_NODE || (n.nodeType === Node.TEXT_NODE && (n.textContent || '').trim().length > 0)
    );
    const nextRawStrings = nextNodes.map((n) =>
      n.nodeType === Node.ELEMENT_NODE ? (n as HTMLElement).outerHTML : String(n.textContent || '')
    );

    const prevRaw = entry.prevRawNodesHtml;
    const liveNodes = Array.from(entry.innerEl.childNodes);

    while (liveNodes.length > nextNodes.length) {
      const last = liveNodes.pop();
      last?.parentNode?.removeChild(last);
    }

    for (let i = 0; i < nextNodes.length; i++) {
      if (i < liveNodes.length && prevRaw[i] === nextRawStrings[i]) {
        continue;
      }
      const nextNode = nextNodes[i];
      if (i < liveNodes.length) {
        entry.innerEl.replaceChild(nextNode, liveNodes[i]);
      } else {
        entry.innerEl.appendChild(nextNode);
      }
      if (nextNode.nodeType === Node.ELEMENT_NODE) {
        this.deps.hydrateProseElement?.(nextNode as HTMLElement);
      }
    }

    entry.prevRawNodesHtml = nextRawStrings;
    entry.lastMarkdown = block.markdown;
    entry.lastStatus = block.status;
    return entry.el;
  }

  private syncWidgetSlot(block: WidgetBlock): HTMLElement {
    const fingerprint = JSON.stringify([
      block.widgetType,
      block.artifactId || '',
      block.jobId || '',
      block.imageUrl || '',
      block.alt || '',
      block.caption || '',
      block.rawJson || '',
    ]);
    const existing = this.widgetCache.get(block.id);
    if (existing && existing.fingerprint === fingerprint) {
      return existing.el;
    }

    let nextEl: HTMLElement;
    if (this.deps.renderWidgetElement) {
      nextEl = this.deps.renderWidgetElement(block, existing?.el || null);
    } else {
      nextEl = existing?.el || document.createElement('div');
      nextEl.className = 'harness-widget-block';
    }
    nextEl.dataset.blockId = block.id;
    this.widgetCache.set(block.id, { el: nextEl, fingerprint });
    return nextEl;
  }

  private syncQuestionSlot(block: QuestionBlock): HTMLElement {
    const fingerprint = JSON.stringify([
      block.questionId,
      block.status,
      block.answers || null,
      block.questions,
    ]);
    const existing = this.questionCache.get(block.id);
    if (existing && existing.fingerprint === fingerprint) {
      return existing.el;
    }

    let nextEl: HTMLElement;
    if (this.deps.renderQuestionElement) {
      nextEl = this.deps.renderQuestionElement(block, existing?.el || null);
    } else {
      nextEl = existing?.el || document.createElement('div');
      nextEl.className = 'harness-question-block';
    }
    nextEl.dataset.blockId = block.id;
    this.questionCache.set(block.id, { el: nextEl, fingerprint });
    return nextEl;
  }

  private syncStatusSlot(block: StatusBlock): HTMLElement {
    const fingerprint = JSON.stringify([block.tone, block.label, block.detail || '', block.action || '']);
    const existing = this.statusCache.get(block.id);
    if (existing && existing.fingerprint === fingerprint) {
      return existing.el;
    }
    const tpl = document.createElement('template');
    tpl.innerHTML = renderStatusBlockHtml(block);
    const nextEl = tpl.content.firstElementChild as HTMLElement;
    this.statusCache.set(block.id, { el: nextEl, fingerprint });
    return nextEl;
  }

  private bindDelegatedEvents(): void {
    if (this.hostEl.dataset.boundTurnStream === 'true') return;
    this.hostEl.dataset.boundTurnStream = 'true';

    this.hostEl.addEventListener('click', (e) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      const segBtn = target.closest<HTMLElement>('[data-segment-toggle]');
      if (segBtn) {
        const segmentId = segBtn.dataset.segmentToggle || '';
        const segWrap = segBtn.closest<HTMLElement>('.metro-segment');
        const rail = segWrap?.querySelector<HTMLElement>('.metro-rail-container');
        if (!segWrap || !rail) return;

        const nextOpen = !segWrap.classList.contains('is-open');
        this.manualSegmentOpen.set(segmentId, nextOpen);
        segWrap.classList.toggle('is-open', nextOpen);
        segWrap.classList.toggle('is-collapsed', !nextOpen);
        segBtn.setAttribute('aria-expanded', String(nextOpen));
        const chev = segBtn.querySelector('.metro-chevron');
        if (chev) chev.textContent = nextOpen ? 'expand_less' : 'expand_more';
        if (nextOpen) rail.removeAttribute('hidden');
        else rail.setAttribute('hidden', '');

        if (this.currentTurn) {
          this.currentTurn.collapseSummaryOverride = !nextOpen;
          this.deps.onToggleStateChanged?.();
        }
        return;
      }

      const jumpBtn = target.closest<HTMLElement>('[data-jump-artifact]');
      if (jumpBtn) {
        e.stopPropagation();
        const artId = jumpBtn.dataset.jumpArtifact || '';
        if (artId) this.deps.onJumpArtifact?.(artId);
        return;
      }

      const stepBtn = target.closest<HTMLElement>('[data-metro-toggle]');
      if (stepBtn) {
        const stepId = stepBtn.dataset.metroToggle || '';
        const stepEl = stepBtn.closest<HTMLElement>('.metro-step');
        const drawer = stepEl?.querySelector<HTMLElement>('.metro-thinking-drawer, .metro-tool-drawer');
        if (!stepEl || !drawer) return;

        const nextExpanded = !stepEl.classList.contains('is-expanded');
        this.manualStepOpen.set(stepId, nextExpanded);
        stepEl.classList.toggle('is-expanded', nextExpanded);
        stepBtn.setAttribute('aria-expanded', String(nextExpanded));
        const chev = stepBtn.querySelector('.metro-chevron');
        if (chev) chev.textContent = nextExpanded ? 'expand_less' : 'expand_more';
        const preview = stepBtn.querySelector<HTMLElement>('.metro-step-preview');
        if (preview) preview.style.display = nextExpanded ? 'none' : '';
        if (nextExpanded) drawer.removeAttribute('hidden');
        else drawer.setAttribute('hidden', '');

        if (this.currentTurn) {
          for (const b of this.currentTurn.blocks || []) {
            if ((b.kind === 'thinking' || b.kind === 'tool') && b.stepId === stepId) {
              b.expanded = nextExpanded;
            }
          }
          const st = this.currentTurn.steps.find((s) => s.id === stepId) as
            | ThinkingStep
            | ToolCallStep
            | ApprovalStep
            | undefined;
          if (st && (st.kind === 'thinking' || st.kind === 'tool')) {
            st.expanded = nextExpanded;
          }
          this.deps.onToggleStateChanged?.();
        }
        return;
      }

      const apprBtn = target.closest<HTMLElement>('[data-approval-choice]');
      if (apprBtn) {
        e.stopPropagation();
        const stepId = apprBtn.dataset.approvalId || '';
        const choice = apprBtn.dataset.approvalChoice as
          | 'approved-once'
          | 'approved-full'
          | 'denied';
        if (stepId && choice) {
          this.deps.onApprovalDecision?.(stepId, choice);
        }
        return;
      }

      const statusBtn = target.closest<HTMLElement>('[data-turn-status-action]');
      if (statusBtn && this.currentTurn) {
        const action = statusBtn.dataset.turnStatusAction as 'continue-exploring' | 'retry';
        const blockId = statusBtn.dataset.blockId || '';
        const block = (this.currentTurn.blocks || []).find(
          (b): b is StatusBlock => b.kind === 'status' && b.id === blockId
        );
        if (action && block) {
          this.deps.onStatusAction?.(action, block);
        }
      }
    });
  }
}
