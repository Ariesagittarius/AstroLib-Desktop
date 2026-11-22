/**
 * src/components/harness/pdf2abp/pdf2abp-timeline.ts
 * ============================================================================
 * Pure Linear Milestone & Subagent Timeline Projector for PDF2ABP Workshop
 * ============================================================================
 * Transforms raw job-state snapshots, untruncated structural milestone events,
 * live subagent tracker records, and workspace manifests (book-plan.json,
 * chunks/manifest.json, mineru-summary.json) into a deterministic, UI-ready
 * 8-stage linear milestone guide (GitHub Issue timeline inspired).
 */

import type {
  Pdf2AbpEvent,
  Pdf2AbpJobState,
  Pdf2AbpJobStatus,
  Pdf2AbpPhase,
  SubagentTaskResult,
} from '../../../services/pdf2abp/types.ts';

export type TimelineStageId =
  | 'inspect'
  | 'mineru'
  | 'overview_vision'
  | 'planning_and_slicing'
  | 'subagent_proofreading'
  | 'merge_and_validate'
  | 'pack_and_verify'
  | 'import';

export type TimelineStageStatus = 'completed' | 'running' | 'pending' | 'failed' | 'skipped';

export interface RunningSubagentInfo {
  taskId: string;
  title?: string;
  startPage?: number;
  endPage?: number;
  targetOutputRelPath?: string;
  startedAt: number;
  updatedAt: number;
  currentTool?: string;
  recentTools: string[];
  visionRelPath?: string;
}

export interface SubagentSliceItem {
  taskId: string;
  title: string;
  pageRange: string;
  targetOutputRelPath?: string;
  status: 'running' | 'completed' | 'failed' | 'skipped' | 'pending';
  validationPassed?: boolean;
  stepsUsed?: number;
  durationMs?: number;
  currentTool?: string;
  notes?: string;
  anomalies?: string[];
  validationErrors?: string[];
}

export interface VisionAttachmentItem {
  relPath: string;
  label: string;
  timestamp: number;
  agentId: string;
}

export interface TimelineHighlightItem {
  timestamp: number;
  agentId: string;
  summary: string;
  tone: 'info' | 'warning' | 'error' | 'success';
}

export interface TimelineStageItem {
  id: TimelineStageId;
  index: number;
  title: string;
  status: TimelineStageStatus;
  statusLabel: string;
  summary: string;
  badges: string[];
  startedAt: number | null;
  completedAt: number | null;
  durationMs: number | null;
  highlights: TimelineHighlightItem[];
}

export interface Pdf2AbpTimelineModel {
  jobId: string;
  sourceFileName: string;
  status: Pdf2AbpJobStatus;
  statusLabel: string;
  phase: Pdf2AbpPhase;
  phaseLabel: string;
  elapsedMs: number;
  completedStages: number;
  totalStages: number;
  concurrency: number;
  stages: TimelineStageItem[];
  subagentSummary: {
    total: number;
    running: number;
    completed: number;
    failed: number;
    skipped: number;
    pending: number;
  };
  subagentMatrix: {
    active: SubagentSliceItem[];
    completed: SubagentSliceItem[];
    failed: SubagentSliceItem[];
    pendingCount: number;
  };
  recentVisions: VisionAttachmentItem[];
  importLink?: {
    readerUrl: string;
    canonicalUrl?: string;
    title?: string;
  };
  errorMessage?: string;
}

export interface TimelineProjectorInput {
  jobState: Pdf2AbpJobState;
  milestoneEvents?: Pdf2AbpEvent[];
  runningSubagents?: Record<string, RunningSubagentInfo>;
  bookPlan?: Record<string, any> | null;
  chunksManifest?: Record<string, any> | null;
  mineruSummary?: Record<string, any> | null;
  artifactPaths?: string[];
  nowMs?: number;
}

const ORDERED_STAGE_META: Array<{ id: TimelineStageId; index: number; title: string }> = [
  { id: 'inspect', index: 1, title: '原书结构侦察' },
  { id: 'mineru', index: 2, title: 'MinerU 文档解析' },
  { id: 'overview_vision', index: 3, title: '全书多模态视觉预览' },
  { id: 'planning_and_slicing', index: 4, title: '章节规划与工单切片' },
  { id: 'subagent_proofreading', index: 5, title: '多子代理并行精校与门禁' },
  { id: 'merge_and_validate', index: 6, title: '分片归并、审计与 MDX 编译校验' },
  { id: 'pack_and_verify', index: 7, title: 'ABP 标准化打包与契约核验' },
  { id: 'import', index: 8, title: '写入本地书库索引' },
];

const PHASE_TO_STAGE_INDEX: Record<Pdf2AbpPhase, number> = {
  init: 0,
  skills_and_inspect: 0,
  mineru: 1,
  overview_vision: 2,
  planning_and_slicing: 3,
  subagent_proofreading: 4,
  merge_and_validate: 5,
  pack_and_verify: 6,
  import: 7,
  done: 8,
};

const PHASE_LABELS: Record<Pdf2AbpPhase, string> = {
  init: '初始化环境',
  skills_and_inspect: '原书侦察与技能加载',
  mineru: 'MinerU 解析',
  overview_vision: '全书视觉预览',
  planning_and_slicing: '规划与切片',
  subagent_proofreading: '子代理并行校对',
  merge_and_validate: '归并审计与编译校验',
  pack_and_verify: 'ABP 打包与核验',
  import: '书库导入',
  done: '已完成',
};

const STATUS_LABELS: Record<Pdf2AbpJobStatus, string> = {
  pending: '排队中',
  running: '进行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已终止',
};

const STAGE_STATUS_LABELS: Record<TimelineStageStatus, string> = {
  completed: '已完成',
  running: '进行中',
  pending: '等待中',
  failed: '失败',
  skipped: '已跳过',
};

function mapPhaseToStageId(phase: string | undefined): TimelineStageId | null {
  switch (phase) {
    case 'init':
    case 'skills_and_inspect':
      return 'inspect';
    case 'mineru':
      return 'mineru';
    case 'overview_vision':
      return 'overview_vision';
    case 'planning_and_slicing':
      return 'planning_and_slicing';
    case 'subagent_proofreading':
      return 'subagent_proofreading';
    case 'merge_and_validate':
      return 'merge_and_validate';
    case 'pack_and_verify':
      return 'pack_and_verify';
    case 'import':
      return 'import';
    default:
      return null;
  }
}

export function parseSubagentStartedMessage(message: string): {
  taskId?: string;
  title?: string;
  startPage?: number;
  endPage?: number;
} {
  const m = String(message || '').match(
    /Started\s+subagent\s+([^\s(]+)\s*\((.+?),\s*p\.(\d+)-(\d+)\)/i
  );
  if (!m) return {};
  return {
    taskId: m[1],
    title: m[2]?.trim(),
    startPage: Number(m[3]),
    endPage: Number(m[4]),
  };
}

function inferStageForEvent(evt: Pdf2AbpEvent, fallbackStage: TimelineStageId): TimelineStageId {
  if (evt.type === 'phase_changed') {
    const mapped = mapPhaseToStageId(typeof evt.data?.phase === 'string' ? evt.data.phase : undefined);
    if (mapped) return mapped;
  }
  if (evt.type === 'subagent_started' || evt.type === 'subagent_finished' || evt.agentId.startsWith('subagent:')) {
    return 'subagent_proofreading';
  }
  const msg = `${evt.message} ${typeof evt.data?.toolName === 'string' ? evt.data.toolName : ''}`;
  if (/inspect_pdf|skill/i.test(msg)) return 'inspect';
  if (/run_mineru_pipeline|mineru/i.test(msg)) return 'mineru';
  if (/render_pdf_pages|make_contact_sheet|inspect_pdf_page|crop_pdf_region/i.test(msg)) {
    return fallbackStage === 'inspect' || fallbackStage === 'mineru' ? 'overview_vision' : fallbackStage;
  }
  if (/prepare_chapter_chunks|analyze_book_structure|book-plan/i.test(msg)) return 'planning_and_slicing';
  if (/dispatch_subagents/i.test(msg)) return 'subagent_proofreading';
  if (/audit_book_coverage|validate_mdx/i.test(msg)) return 'merge_and_validate';
  if (/pack_book_abp|verify_abp/i.test(msg)) return 'pack_and_verify';
  if (/import_abp/i.test(msg)) return 'import';
  return fallbackStage;
}

export function projectPdf2AbpTimeline(input: TimelineProjectorInput): Pdf2AbpTimelineModel {
  const {
    jobState,
    milestoneEvents = [],
    runningSubagents = {},
    bookPlan = null,
    chunksManifest = null,
    mineruSummary = null,
    artifactPaths = [],
    nowMs = Date.now(),
  } = input;

  const endTimestamp =
    jobState.completedAt ||
    (jobState.status === 'running' || jobState.status === 'pending' ? nowMs : jobState.updatedAt || nowMs);
  const elapsedMs = Math.max(0, endTimestamp - (jobState.createdAt || endTimestamp));

  const workOrderById = new Map<string, Record<string, any>>();
  const workOrders: Array<Record<string, any>> = Array.isArray(chunksManifest?.workOrders)
    ? chunksManifest!.workOrders
    : [];
  for (const wo of workOrders) {
    if (wo && typeof wo.chunkId === 'string') {
      workOrderById.set(wo.chunkId, wo);
    }
  }

  const stageTiming = new Map<TimelineStageId, { startedAt: number | null; completedAt: number | null }>();
  const stageHighlights = new Map<TimelineStageId, TimelineHighlightItem[]>();
  for (const meta of ORDERED_STAGE_META) {
    stageTiming.set(meta.id, { startedAt: null, completedAt: null });
    stageHighlights.set(meta.id, []);
  }

  const recentVisions: VisionAttachmentItem[] = [];
  const seenVisions = new Set<string>();
  const startedTitleByTaskId = new Map<string, { title?: string; startPage?: number; endPage?: number; target?: string }>();

  let cursorStage: TimelineStageId = mapPhaseToStageId(jobState.phase) || 'inspect';
  if (milestoneEvents.length > 0) {
    cursorStage = 'inspect';
  }

  for (const evt of milestoneEvents) {
    if (evt.type === 'phase_changed') {
      const nextStage = mapPhaseToStageId(typeof evt.data?.phase === 'string' ? evt.data.phase : undefined);
      if (nextStage && nextStage !== cursorStage) {
        const prevT = stageTiming.get(cursorStage);
        if (prevT && prevT.completedAt === null) {
          prevT.completedAt = evt.timestamp;
        }
        const nextT = stageTiming.get(nextStage);
        if (nextT && nextT.startedAt === null) {
          nextT.startedAt = evt.timestamp;
        }
        cursorStage = nextStage;
      } else if (evt.data?.phase === 'done') {
        const prevT = stageTiming.get(cursorStage);
        if (prevT && prevT.completedAt === null) {
          prevT.completedAt = evt.timestamp;
        }
      }
    }

    if (evt.type === 'subagent_started') {
      const parsed = parseSubagentStartedMessage(evt.message);
      const taskId = (typeof evt.data?.taskId === 'string' ? evt.data.taskId : parsed.taskId) || '';
      if (taskId) {
        startedTitleByTaskId.set(taskId, {
          title: (typeof evt.data?.title === 'string' ? evt.data.title : parsed.title) || undefined,
          startPage: typeof evt.data?.startPage === 'number' ? evt.data.startPage : parsed.startPage,
          endPage: typeof evt.data?.endPage === 'number' ? evt.data.endPage : parsed.endPage,
          target: typeof evt.data?.targetOutputRelPath === 'string' ? evt.data.targetOutputRelPath : undefined,
        });
      }
    }

    if (evt.type === 'vision_attached' && typeof evt.data?.relPath === 'string') {
      const relPath = evt.data.relPath;
      if (!seenVisions.has(relPath)) {
        seenVisions.add(relPath);
        recentVisions.push({
          relPath,
          label: typeof evt.data?.label === 'string' ? evt.data.label : relPath,
          timestamp: evt.timestamp,
          agentId: evt.agentId,
        });
      }
    }

    const stageForEvt = inferStageForEvent(evt, cursorStage);
    const tInfo = stageTiming.get(stageForEvt);
    if (tInfo && tInfo.startedAt === null) {
      tInfo.startedAt = evt.timestamp;
    }

    // Subagent milestones have their own dedicated slice matrix; keep stage highlights concise & semantic
    if (!evt.agentId.startsWith('subagent:') || evt.type === 'error' || evt.type === 'warning') {
      if (evt.type !== 'thinking') {
        const list = stageHighlights.get(stageForEvt)!;
        const tone: TimelineHighlightItem['tone'] =
          evt.type === 'error'
            ? 'error'
            : evt.type === 'warning'
              ? 'warning'
              : evt.type === 'job_completed' || evt.type === 'phase_changed'
                ? 'success'
                : 'info';
        const last = list[list.length - 1];
        if (!last || last.summary !== evt.message) {
          list.push({
            timestamp: evt.timestamp,
            agentId: evt.agentId,
            summary: evt.message,
            tone,
          });
        }
      }
    }
  }

  // Fallback stage artifacts presence detection
  const hasBookPlanArtifact =
    Boolean(bookPlan) || artifactPaths.some((p) => p === 'book-plan.json');
  const hasChunksArtifact =
    Boolean(chunksManifest) || artifactPaths.some((p) => p === 'chunks/manifest.json');
  const hasOverviewImages =
    recentVisions.some((v) => !v.agentId.startsWith('subagent:')) ||
    artifactPaths.some((p) => p.startsWith('vision/sheet_') || p.startsWith('vision/page_'));
  const hasCoverageAudit = artifactPaths.some((p) => p === 'chunks/coverage-audit.json');

  // Construct Subagent Matrix
  const rawResults = jobState.subagentTasks || {};
  const completedSlices: SubagentSliceItem[] = [];
  const failedSlices: SubagentSliceItem[] = [];
  const activeSlices: SubagentSliceItem[] = [];
  let skippedCount = 0;

  const formatPageRange = (s?: number, e?: number): string => {
    if (typeof s === 'number' && typeof e === 'number') return `p.${s}-${e}`;
    if (typeof s === 'number') return `p.${s}`;
    return '';
  };

  for (const [taskId, res] of Object.entries(rawResults) as Array<[string, SubagentTaskResult]>) {
    const wo = workOrderById.get(taskId);
    const startedMeta = startedTitleByTaskId.get(taskId);
    const rawTitle = startedMeta?.title || wo?.chapterTitle || taskId;
    const title =
      wo && wo.totalParts > 1 && !/\(Part\s+\d+\//.test(String(rawTitle))
        ? `${rawTitle} (Part ${wo.partIndex}/${wo.totalParts})`
        : String(rawTitle);
    const pageRange = formatPageRange(
      startedMeta?.startPage ?? wo?.startPage,
      startedMeta?.endPage ?? wo?.endPage
    );

    const isSkipped = res.status === 'skipped_from_checkpoint';
    if (isSkipped) skippedCount++;

    const slice: SubagentSliceItem = {
      taskId,
      title,
      pageRange,
      targetOutputRelPath: res.outputFiles?.[0] || startedMeta?.target || wo?.targetOutputRelPath,
      status: res.status === 'failed' || !res.validationPassed ? 'failed' : isSkipped ? 'skipped' : 'completed',
      validationPassed: res.validationPassed,
      stepsUsed: res.stepsUsed,
      durationMs: res.durationMs,
      notes: res.notes,
      anomalies: res.anomalies,
      validationErrors: res.validationErrors,
    };

    if (slice.status === 'failed') {
      failedSlices.push(slice);
    } else {
      completedSlices.push(slice);
    }
  }

  for (const activeInfo of Object.values(runningSubagents)) {
    if (rawResults[activeInfo.taskId]) continue;
    const wo = workOrderById.get(activeInfo.taskId);
    const startedMeta = startedTitleByTaskId.get(activeInfo.taskId);
    const title =
      activeInfo.title ||
      startedMeta?.title ||
      (wo
        ? wo.totalParts > 1
          ? `${wo.chapterTitle} (Part ${wo.partIndex}/${wo.totalParts})`
          : wo.chapterTitle
        : activeInfo.taskId);

    activeSlices.push({
      taskId: activeInfo.taskId,
      title: String(title || activeInfo.taskId),
      pageRange: formatPageRange(
        activeInfo.startPage ?? startedMeta?.startPage ?? wo?.startPage,
        activeInfo.endPage ?? startedMeta?.endPage ?? wo?.endPage
      ),
      targetOutputRelPath:
        activeInfo.targetOutputRelPath || startedMeta?.target || wo?.targetOutputRelPath,
      status: 'running',
      durationMs: Math.max(0, nowMs - activeInfo.startedAt),
      currentTool: activeInfo.currentTool,
    });
  }

  const knownSliceTotal = Math.max(
    workOrders.length,
    Object.keys(rawResults).length + activeSlices.length
  );
  const pendingSliceCount = Math.max(
    0,
    knownSliceTotal - completedSlices.length - failedSlices.length - activeSlices.length
  );

  // Determine current phase index cleanly from jobState.phase and actual progress
  let activeStageIdx = PHASE_TO_STAGE_INDEX[jobState.phase] ?? 0;
  if (jobState.status === 'completed' || jobState.phase === 'done') {
    activeStageIdx = 8;
  } else if (
    activeStageIdx < 4 &&
    (activeSlices.length > 0 || completedSlices.length > 0 || failedSlices.length > 0)
  ) {
    activeStageIdx = 4;
  }

  const resolveStatus = (idx: number, hasArtifactEvidence: boolean): TimelineStageStatus => {
    if (activeStageIdx >= 8) {
      if (idx === 7 && !jobState.autoImport && !jobState.importResult?.installed) {
        return 'skipped';
      }
      return 'completed';
    }
    if (idx < activeStageIdx) {
      return 'completed';
    }
    if (idx === activeStageIdx) {
      if (jobState.status === 'failed') return 'failed';
      if (jobState.status === 'cancelled') return 'failed';
      if (idx === 7 && !jobState.autoImport) return 'skipped';
      return 'running';
    }
    return hasArtifactEvidence ? 'completed' : 'pending';
  };

  const stages: TimelineStageItem[] = ORDERED_STAGE_META.map((meta, idx) => {
    const timing = stageTiming.get(meta.id)!;
    let evidenceDone = false;
    let summary = '等待前序阶段完成';
    const badges: string[] = [];

    if (meta.id === 'inspect') {
      evidenceDone = Boolean(jobState.pdfInfo);
      if (jobState.pdfInfo) {
        badges.push(`${jobState.pdfInfo.pageCount} 页`);
        badges.push(`${(jobState.pdfInfo.fileSizeBytes / 1048576).toFixed(1)} MB`);
        if (jobState.pdfInfo.outline?.length) {
          badges.push(`${jobState.pdfInfo.outline.length} 条 PDF 书签`);
        }
        badges.push(jobState.pdfInfo.likelyScanned ? '扫描型 PDF' : '含原生文本层');
        summary = `已侦察源文件《${jobState.pdfInfo.fileName}》物理页数与书签结构`;
      } else {
        summary = '侦察 PDF 物理页数、文本层密度、页面尺寸与原生书签大纲';
      }
    } else if (meta.id === 'mineru') {
      const mr = jobState.mineruResult;
      const totalPages = mr?.summary?.totalPages ?? mineruSummary?.totalPages;
      const totalImages = mr?.summary?.totalImages ?? mineruSummary?.totalImages;
      const totalBlocks = mr?.summary?.totalBlocks ?? mineruSummary?.totalBlocks;
      evidenceDone = Boolean(mr || mineruSummary);
      if (mr || mineruSummary) {
        if (mr?.engine) badges.push(`引擎: ${mr.engine}`);
        if (mr?.reusedCache) badges.push('命中缓存');
        if (typeof totalPages === 'number') badges.push(`${totalPages} 页`);
        if (typeof totalImages === 'number') badges.push(`${totalImages} 张配图`);
        if (typeof totalBlocks === 'number') badges.push(`${totalBlocks} 个语义块`);
        summary = '已完成分片 OCR 解析与全书语义块/插图缝合';
      } else {
        summary = '按每 200 页自动拆分提交 MinerU 解析，并缝合为全书连续物理页语义块';
      }
    } else if (meta.id === 'overview_vision') {
      const overviewCount = recentVisions.filter((v) => !v.agentId.startsWith('subagent:')).length;
      evidenceDone = hasOverviewImages && activeStageIdx > 2;
      if (overviewCount > 0) {
        badges.push(`${overviewCount} 帧视觉缩略图`);
        summary = '主代理已审阅目录页、正文样式与插图采样，确认全书体例规范';
      } else if (activeStageIdx === 2) {
        summary = '主代理正在按需渲染目录与代表性页面图像，核验字体样式与体例边界';
      } else {
        summary = '按需生成概览拼接图与采样页，以视觉信息辅助规划结构';
      }
    } else if (meta.id === 'planning_and_slicing') {
      evidenceDone = hasBookPlanArtifact || hasChunksArtifact;
      const titleFromPlan = bookPlan?.bookConfig?.title;
      const docMode = bookPlan?.documentMode;
      const chapCount = Array.isArray(bookPlan?.chapters) ? bookPlan!.chapters.length : 0;
      if (docMode) badges.push(`体裁: ${docMode}`);
      if (chapCount > 0) badges.push(`${chapCount} 章结构`);
      if (workOrders.length > 0) badges.push(`${workOrders.length} 个工单切片`);
      if (titleFromPlan || workOrders.length > 0) {
        summary = `已完成《${titleFromPlan || jobState.sourceFileName}》结构规划，生成 ${workOrders.length || '若干'} 个按完整小节切分的工单`;
      } else {
        summary = '拟定 BookPlanSpec 规划书并切分完整章节草稿与独立校对工单';
      }
    } else if (meta.id === 'subagent_proofreading') {
      badges.push(`并发上限 ${jobState.concurrency}`);
      if (knownSliceTotal > 0) {
        badges.push(`完成 ${completedSlices.length}/${knownSliceTotal}`);
      }
      if (activeSlices.length > 0) badges.push(`运行中 ${activeSlices.length}`);
      if (failedSlices.length > 0) badges.push(`失败 ${failedSlices.length}`);
      if (skippedCount > 0) badges.push(`复用检查点 ${skippedCount}`);
      evidenceDone = knownSliceTotal > 0 && pendingSliceCount === 0 && activeSlices.length === 0 && failedSlices.length === 0;
      if (activeSlices.length > 0 || completedSlices.length > 0) {
        summary =
          knownSliceTotal > 0
            ? `并行派发校对子代理逐节重写为规范 MDX：已完成 ${completedSlices.length} / ${knownSliceTotal}，当前 ${activeSlices.length} 个正在执行`
            : `并行派发校对子代理：当前 ${activeSlices.length} 个正在执行，已完成 ${completedSlices.length} 个`;
      } else {
        summary = '派发隔离上下文的校对子代理，对照页图完成 MDX 排版精校与单节门禁检查';
      }
    } else if (meta.id === 'merge_and_validate') {
      const vr = jobState.validationReport;
      evidenceDone = Boolean(vr?.passed);
      if (vr) {
        badges.push(vr.passed ? '门禁通过' : `存在 ${vr.errorCount || vr.errors?.length || 0} 处报错`);
        badges.push(`${vr.passedFiles}/${vr.totalFiles} 章节`);
        if (vr.warningCount > 0) badges.push(`${vr.warningCount} 条告警`);
        if (hasCoverageAudit) badges.push('覆盖率审计完成');
        summary = vr.passed
          ? `已完成多片章节归并与全书 ${vr.totalFiles} 份 MDX 语法门禁校验`
          : `全书校验发现 ${vr.errorCount || vr.errors?.length || 0} 项待修复错误`;
      } else {
        summary = '合并跨片多段章节，执行字符/脚注覆盖率审计与全书 MDX 静态编译检查';
      }
    } else if (meta.id === 'pack_and_verify') {
      const cr = jobState.compileResult;
      const vrf = jobState.verifyResult;
      evidenceDone = Boolean(cr?.abpPath && (!vrf || vrf.passed));
      if (cr) {
        if (cr.totalChapters) badges.push(`${cr.totalChapters} 章已编译`);
        if (cr.sizeBytes) badges.push(`${(cr.sizeBytes / 1048576).toFixed(2)} MB`);
      }
      if (vrf) {
        badges.push(vrf.passed ? 'ABP Schema 1.0.0 校验通过' : 'ABP 校验告警');
      }
      summary = cr?.abpPath
        ? `已生成标准 .abp 档案包并完成离线 AST / 资源契约验证`
        : '将全书章节、book.json 与配图打包为官方 ABP 1.0.0 标准内容包并核验完整性';
    } else if (meta.id === 'import') {
      const imp = jobState.importResult;
      evidenceDone = Boolean(imp?.installed);
      if (imp?.installed) {
        badges.push(`${imp.colSlug}/${imp.bookSlug}`);
        badges.push('已入库');
        summary = `《${imp.title}》已自动安装至本地书库目录，可直接在阅读器中打开`;
      } else if (!jobState.autoImport) {
        summary = '当前任务未开启自动入库，已保留生成的 .abp 档案包于工作区';
      } else {
        summary = '将校验通过的 .abp 写入本地书库并刷新书库索引';
      }
    }

    const status = resolveStatus(idx, evidenceDone);
    const stageStarted = timing.startedAt ?? (idx === 0 ? jobState.createdAt : null);
    const stageCompleted =
      timing.completedAt ??
      (status === 'completed' && idx === 7 ? jobState.completedAt || jobState.updatedAt : null);
    const durationMs =
      stageStarted !== null
        ? Math.max(
            0,
            (stageCompleted ?? (status === 'running' ? nowMs : stageStarted)) - stageStarted
          )
        : null;

    return {
      id: meta.id,
      index: meta.index,
      title: meta.title,
      status,
      statusLabel: STAGE_STATUS_LABELS[status],
      summary,
      badges,
      startedAt: stageStarted,
      completedAt: stageCompleted,
      durationMs,
      highlights: (stageHighlights.get(meta.id) || []).slice(-12),
    };
  });

  const completedStages = stages.filter((s) => s.status === 'completed' || s.status === 'skipped').length;

  return {
    jobId: jobState.jobId,
    sourceFileName: jobState.sourceFileName,
    status: jobState.status,
    statusLabel: STATUS_LABELS[jobState.status] || jobState.status,
    phase: jobState.phase,
    phaseLabel: PHASE_LABELS[jobState.phase] || jobState.phase,
    elapsedMs,
    completedStages,
    totalStages: ORDERED_STAGE_META.length,
    concurrency: jobState.concurrency,
    stages,
    subagentSummary: {
      total: knownSliceTotal,
      running: activeSlices.length,
      completed: completedSlices.length,
      failed: failedSlices.length,
      skipped: skippedCount,
      pending: pendingSliceCount,
    },
    subagentMatrix: {
      active: activeSlices.sort((a, b) => a.taskId.localeCompare(b.taskId)),
      completed: completedSlices.sort((a, b) => a.taskId.localeCompare(b.taskId)),
      failed: failedSlices.sort((a, b) => a.taskId.localeCompare(b.taskId)),
      pendingCount: pendingSliceCount,
    },
    recentVisions: recentVisions.slice(-16),
    ...(jobState.importResult?.readerUrl
      ? {
          importLink: {
            readerUrl: jobState.importResult.readerUrl,
            canonicalUrl: jobState.importResult.canonicalUrl,
            title: jobState.importResult.title,
          },
        }
      : {}),
    ...(jobState.error ? { errorMessage: jobState.error } : {}),
  };
}
