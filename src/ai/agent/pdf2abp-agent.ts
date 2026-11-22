import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readPdf2AbpSkill } from '../skills/pdf2abp/index.ts';
import {
  JobWorkspace,
  resolvePdf2AbpJobsRoot,
  type Pdf2AbpEvent,
  type Pdf2AbpJobState,
  type Pdf2AbpPhase,
} from '../../services/pdf2abp/index.ts';
import { runAgentLoop } from './harness-runner.ts';
import { createMainPdf2AbpTools } from './pdf2abp-tools.ts';

export const DEFAULT_YOULABBER_CONFIG = {
  providerId: 'baigong',
  modelId: process.env.ASTROLIB_YOULABBER_MODEL || 'ybg-youlaber-ds4f',
  baseURL: process.env.ASTROLIB_YOULABBER_BASE_URL || 'https://gateway.baigongai.cn/v1',
  apiKey:
    process.env.ASTROLIB_YOULABBER_API_KEY ||
    process.env.BAIGONG_API_KEY ||
    '',
  extraHeaders: {
    'X-YBG-Session-ID': process.env.ASTROLIB_YOULABBER_SESSION_ID || 'youlabber-local-pc',
  },
} as const;

export interface StartPdf2AbpJobRequest {
  pdfPath: string;
  jobId?: string;
  customRootDir?: string;
  providerId?: string;
  modelId?: string;
  baseURL?: string;
  apiKey?: string;
  extraHeaders?: Record<string, string>;
  concurrency?: number;
  autoImport?: boolean;
  instructions?: string;
  maxSteps?: number;
}

export type Pdf2AbpEventListener = (event: Pdf2AbpEvent) => void;

interface ActiveJobRuntime {
  workspace: JobWorkspace;
  state: Pdf2AbpJobState;
  extraHeaders?: Record<string, string>;
  apiKey?: string;
  maxSteps: number;
  abortController?: AbortController;
  promise?: Promise<Pdf2AbpJobState>;
  listeners: Set<Pdf2AbpEventListener>;
  seqCounter: number;
}

function generateJobId(pdfPath: string): string {
  const base = path
    .basename(pdfPath, path.extname(pdfPath))
    .replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 28) || 'book';
  const rand = crypto.randomBytes(3).toString('hex');
  return `pdf2abp_${Date.now()}_${base}_${rand}`;
}

function createMainAgentSystemPrompt(): string {
  const sop = readPdf2AbpSkill('pdf2abp-orchestrator-sop');
  const manifestSpec = readPdf2AbpSkill('abp-spec', 'book-json');
  const cardOverview = readPdf2AbpSkill('abp-spec', 'components');

  return [
    '你是 AstroLib 的全自动学术出版主控 Agent（PDF2ABP Orchestrator）。你的任务是将用户指定的一本原始 PDF 教材、论文、讲义或试卷，端到端地高保真数字化、经多子代理视觉校对后编译并通过验收为官方 ABP 内容包，并导入应用书库。',
    '',
    '## 核心行为铁律',
    '1. **主动探索并用好工具与规范**：需要更深入的排版细节或 Python 技巧时，随时调用 `list_skills` / `read_skill` 读取 `abp-spec`、`academic-typesetting-rules` 与 `mineru-pitfalls-and-python-recipes`。',
    '2. **善用 `run_python`**：遇到超过 30 页的目录对齐、页码偏移修正、习题答案反查拼接、批量元数据生成时，不要手算或靠记忆拼凑，用 `run_python` 写短脚本确定性统计并落盘 JSON。',
    '3. **严格管控上下文与单图槽**：',
    '   - 禁止直接用 `read_workspace_file` 无分页通读整本 `mineru/stitched/full.md`；请优先读 `mineru/mineru-summary.json`（不超过几百行即可总览所有 detected headings 和每页统计），或用 `startLine`/`endLine` 局部查看。',
    '   - 每次模型请求网关最多允许 1 张图片。看多页时使用 `render_contact_sheet`（`2x2` 每图看 4 页）+ `inspect_image`；看到图后**当场记录观察要点**再切下一张。',
    '4. **不半途而废**：除非遇到硬性环境阻断（如 `MINERU_UNAVAILABLE`），必须把流水线一杆子跑到底：校验无误 (`validate_mdx` passed) → 打包 (`pack_abp`) → 归档验收 (`verify_abp` passed) → 按配置导入 (`import_abp`)，最后给用户详实、准确、基于实测结果（禁止编造数字）的成果交付报告。',
    '',
    '---',
    sop.content,
    '',
    '---',
    manifestSpec.content,
    '',
    '---',
    cardOverview.content,
  ].join('\n');
}

function buildInitialUserPrompt(state: Pdf2AbpJobState, isResume: boolean): string {
  const autoImportText = state.autoImport
    ? '启用（verify_abp 通过后必须调用 import_abp 导入项目书库）'
    : '关闭（仅需完成 verify_abp 归档验收，无需调用 import_abp）';

  if (isResume) {
    return [
      `# 断点恢复 PDF2ABP 任务: ${state.jobId}`,
      `- 源 PDF 路径：\`${state.sourcePdfPath}\``,
      `- 并发上限：${state.concurrency}`,
      `- 自动导入书库：${autoImportText}`,
      state.instructions ? `- 用户附加要求：${state.instructions}` : '',
      '',
      '这是一个从中断/失败状态恢复的任务。请先调用 `list_workspace_files` 与 `read_workspace_file` 检查 `job-state.json`、`mineru/mineru-summary.json`、`chunks/manifest.json` 与 `subagents/` 已有检查点：',
      '1. 如果 MinerU 结果已存在，`run_mineru_pipeline` 会自动复用缓存（`reuseCache: true`）；',
      '2. 如果 `chunks/manifest.json` 与子代理检查点已部分完成，调用 `dispatch_subagents` 会自动跳过已通过验收的分片；',
      '3. 继续完成缺失步骤、合并多段章 (`merge_chapter_parts`)、全书总门禁 (`validate_mdx` on `"book"`)、`pack_abp`、`verify_abp` 以及（若开启）`import_abp`，最后输出真实可核验的完整成果汇报。',
    ]
      .filter(Boolean)
      .join('\n');
  }

  return [
    `# 启动自动化 PDF2ABP 数字化转换任务`,
    `- **任务 ID**：\`${state.jobId}\``,
    `- **源 PDF 绝对路径**：\`${state.sourcePdfPath}\``,
    `- **子代理并发度**：${state.concurrency}`,
    `- **自动导入书库**：${autoImportText}`,
    state.instructions ? `- **用户额外要求**：${state.instructions}` : '',
    '',
    '请你严格按照 SOP 全自主执行：',
    '1. 先调用 `read_skill` 详读 `abp-spec` 与 `orchestrator-sop`（或按需查 `academic-typesetting-rules`），同时调用 `check_mineru_status` 和 `inspect_pdf`；',
    '2. 若 MinerU 可用，调用 `run_mineru_pipeline`（如用户仅指定部分章节/页段可结合先验目录传 `pageRange`；否则全书按最大 200 页分卷并并发提取缝合）；若不可用 (`MINERU_UNAVAILABLE`) 请清晰说明原因后结束；',
    '3. 调用确定性工具 `analyze_book_structure` 获取目录/索引跳过页、章首导语 (chapter-intro)、1:1 二级小节边界与脚注/算法页列表，再结合 `render_contact_sheet`（2×2 拼图）与 `inspect_image` 抽样审阅封面与典型正文/代码页；',
    '4. 使用 `crop_pdf_region` 裁剪封面到 `book/images/cover.jpg`（如封面页清晰）；编写全书规划并写入 `book-plan.json`（严格保持小节 1:1 拆分、独立章首导语使用 `kind: "chapter-intro"` 并绑定于 `sections[].intro`、跳过纯目录/索引页）后调用 `prepare_chapter_chunks`；',
    `5. 调用 \`dispatch_subagents\` 按整节并发校对（默认并发度 \`${state.concurrency}\`，上限 24；若用户指令明确要求其他并发度可按需覆盖传入，等待全部完成并在存在失败分片时自愈修复）；`,
    '6. 对超长多段章调用 `merge_chapter_parts`，调用 `audit_book_coverage` 核验正文/插图/脚注覆盖度，再对 `"book"` 运行全书 `validate_mdx` 直到 0 错误；',
    '7. 调用 `pack_abp` 与 `verify_abp` 确保归档 100% 合法；',
    state.autoImport
      ? '8. 调用 `import_abp` 导入 AstroLib 书库，最后向用户输出包含真实指标与阅读链接的最终成果报告。'
      : '8. 完成 `verify_abp` 后（当前未开启自动导入），向用户输出包含真实指标与 `.abp` 路径的最终成果报告。',
  ]
    .filter(Boolean)
    .join('\n');
}

export class Pdf2AbpJobManager {
  private static instance: Pdf2AbpJobManager | null = null;
  private readonly jobs = new Map<string, ActiveJobRuntime>();

  private constructor() {}

  public static getInstance(): Pdf2AbpJobManager {
    if (!Pdf2AbpJobManager.instance) {
      Pdf2AbpJobManager.instance = new Pdf2AbpJobManager();
    }
    return Pdf2AbpJobManager.instance;
  }

  private emitEvent(
    runtime: ActiveJobRuntime,
    partial: Omit<Pdf2AbpEvent, 'seq' | 'timestamp' | 'jobId'>
  ): void {
    runtime.seqCounter += 1;
    const evt: Pdf2AbpEvent = {
      seq: runtime.seqCounter,
      timestamp: Date.now(),
      jobId: runtime.state.jobId,
      agentId: partial.agentId,
      type: partial.type,
      message: partial.message,
      ...(partial.data ? { data: partial.data } : {}),
    };
    runtime.workspace.appendEvent(evt);
    for (const listener of runtime.listeners) {
      try {
        listener(evt);
      } catch {

      }
    }
  }

  private persistState(runtime: ActiveJobRuntime): void {
    runtime.state.updatedAt = Date.now();
    runtime.workspace.saveState(runtime.state);
  }

  private ensureLoaded(jobId: string, customRootDir?: string): ActiveJobRuntime | null {
    const existing = this.jobs.get(jobId);
    if (existing) return existing;

    try {
      const { workspace, state } = JobWorkspace.loadExisting(jobId, customRootDir);
      const events = workspace.readEvents();
      const seqCounter = events.length > 0 ? events[events.length - 1].seq : 0;
      const runtime: ActiveJobRuntime = {
        workspace,
        state,
        maxSteps: 120,
        listeners: new Set(),
        seqCounter,
      };
      this.jobs.set(jobId, runtime);
      return runtime;
    } catch {
      return null;
    }
  }

  public getWorkspace(jobId: string, customRootDir?: string): JobWorkspace | null {
    return this.ensureLoaded(jobId, customRootDir)?.workspace ?? null;
  }

  public getJob(jobId: string, customRootDir?: string): Pdf2AbpJobState | null {
    return this.ensureLoaded(jobId, customRootDir)?.state ?? null;
  }

  public listJobs(customRootDir?: string): Pdf2AbpJobState[] {
    const root = resolvePdf2AbpJobsRoot();
    const scanDir = customRootDir ? path.resolve(customRootDir) : root;
    const seen = new Map<string, Pdf2AbpJobState>();

    if (fs.existsSync(scanDir)) {
      for (const entry of fs.readdirSync(scanDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const runtime = this.ensureLoaded(entry.name, scanDir);
        if (runtime) {
          seen.set(runtime.state.jobId, runtime.state);
        }
      }
    }

    for (const [id, rt] of this.jobs.entries()) {
      if (!seen.has(id)) {
        seen.set(id, rt.state);
      }
    }

    return Array.from(seen.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  public getJobEvents(jobId: string, customRootDir?: string): Pdf2AbpEvent[] {
    const rt = this.ensureLoaded(jobId, customRootDir);
    if (!rt) return [];
    return rt.workspace.readEvents();
  }

  public subscribe(
    jobId: string,
    listener: Pdf2AbpEventListener,
    customRootDir?: string
  ): () => void {
    const rt = this.ensureLoaded(jobId, customRootDir);
    if (!rt) {
      throw new Error(`未找到任务: ${jobId}`);
    }
    rt.listeners.add(listener);
    return () => {
      rt.listeners.delete(listener);
    };
  }

  public startJob(req: StartPdf2AbpJobRequest): Pdf2AbpJobState {
    if (!req.pdfPath || !req.pdfPath.trim()) {
      throw new Error('pdfPath 不能为空');
    }
    const resolvedPdf = path.resolve(req.pdfPath);
    if (!fs.existsSync(resolvedPdf) || fs.statSync(resolvedPdf).isDirectory()) {
      throw new Error(`源 PDF 文件不存在或不是文件: ${resolvedPdf}`);
    }
    if (path.extname(resolvedPdf).toLowerCase() !== '.pdf') {
      throw new Error(`仅支持 .pdf 文件: ${resolvedPdf}`);
    }

    const jobId = req.jobId?.trim() || generateJobId(resolvedPdf);
    const workspace = new JobWorkspace(jobId, resolvedPdf, req.customRootDir);

    const providerId = req.providerId || DEFAULT_YOULABBER_CONFIG.providerId;
    const modelId = req.modelId || DEFAULT_YOULABBER_CONFIG.modelId;
    const baseURL = req.baseURL || DEFAULT_YOULABBER_CONFIG.baseURL;
    const apiKey =
      req.apiKey !== undefined
        ? req.apiKey
        : providerId === 'baigong' || baseURL.includes('baigongai.cn')
          ? DEFAULT_YOULABBER_CONFIG.apiKey
          : process.env.OPENAI_API_KEY || '';
    const extraHeaders =
      req.extraHeaders ??
      (providerId === 'baigong' || baseURL.includes('baigongai.cn')
        ? { ...DEFAULT_YOULABBER_CONFIG.extraHeaders }
        : undefined);

    const now = Date.now();
    const state: Pdf2AbpJobState = {
      jobId,
      sourcePdfPath: resolvedPdf,
      sourceFileName: path.basename(resolvedPdf),
      workspaceDir: workspace.rootDir,
      status: 'running',
      phase: 'init',
      providerId,
      modelId,
      baseURL,
      concurrency: Math.max(1, Math.min(24, Math.floor(req.concurrency ?? 12))),
      autoImport: req.autoImport ?? true,
      ...(req.instructions ? { instructions: req.instructions } : {}),
      createdAt: now,
      updatedAt: now,
      subagentTasks: {},
    };

    const runtime: ActiveJobRuntime = {
      workspace,
      state,
      apiKey,
      extraHeaders,
      maxSteps: req.maxSteps ?? 120,
      abortController: new AbortController(),
      listeners: new Set(),
      seqCounter: 0,
    };

    this.jobs.set(jobId, runtime);
    this.persistState(runtime);

    runtime.promise = this.executeJob(runtime, false);
    return state;
  }

  public resumeJob(
    jobId: string,
    overrides: Partial<Omit<StartPdf2AbpJobRequest, 'pdfPath' | 'jobId'>> = {}
  ): Pdf2AbpJobState {
    const rt = this.ensureLoaded(jobId, overrides.customRootDir);
    if (!rt) {
      throw new Error(`未找到可恢复的任务: ${jobId}`);
    }
    if (rt.state.status === 'running' && rt.abortController && !rt.abortController.signal.aborted) {
      throw new Error(`任务 ${jobId} 正在运行中，请勿重复恢复`);
    }

    if (overrides.providerId) rt.state.providerId = overrides.providerId;
    if (overrides.modelId) rt.state.modelId = overrides.modelId;
    if (overrides.baseURL) rt.state.baseURL = overrides.baseURL;
    if (overrides.concurrency !== undefined) {
      rt.state.concurrency = Math.max(1, Math.min(24, Math.floor(overrides.concurrency)));
    }
    if (overrides.autoImport !== undefined) {
      rt.state.autoImport = overrides.autoImport;
    }
    if (overrides.instructions !== undefined) {
      rt.state.instructions = overrides.instructions;
    }
    if (overrides.apiKey !== undefined) {
      rt.apiKey = overrides.apiKey;
    } else if (!rt.apiKey && (rt.state.providerId === 'baigong' || rt.state.baseURL.includes('baigongai.cn'))) {
      rt.apiKey = DEFAULT_YOULABBER_CONFIG.apiKey;
      rt.extraHeaders = { ...DEFAULT_YOULABBER_CONFIG.extraHeaders };
    }
    if (overrides.extraHeaders) {
      rt.extraHeaders = overrides.extraHeaders;
    }
    if (overrides.maxSteps !== undefined) {
      rt.maxSteps = overrides.maxSteps;
    }

    rt.state.status = 'running';
    rt.state.error = undefined;
    rt.state.completedAt = undefined;
    rt.abortController = new AbortController();
    this.persistState(rt);

    rt.promise = this.executeJob(rt, true);
    return rt.state;
  }

  public cancelJob(jobId: string, customRootDir?: string): Pdf2AbpJobState {
    const rt = this.ensureLoaded(jobId, customRootDir);
    if (!rt) {
      throw new Error(`未找到任务: ${jobId}`);
    }
    if (rt.abortController && !rt.abortController.signal.aborted) {
      rt.abortController.abort(new Error('Cancelled by user'));
    }
    if (rt.state.status === 'running' || rt.state.status === 'pending') {
      rt.state.status = 'cancelled';
      rt.state.error = 'Cancelled by user';
      rt.state.completedAt = Date.now();
      this.persistState(rt);
      this.emitEvent(rt, {
        agentId: 'system',
        type: 'job_cancelled',
        message: `Job ${jobId} cancelled by user request`,
      });
    }
    return rt.state;
  }

  public async waitForJob(jobId: string, customRootDir?: string): Promise<Pdf2AbpJobState> {
    const rt = this.ensureLoaded(jobId, customRootDir);
    if (!rt) {
      throw new Error(`未找到任务: ${jobId}`);
    }
    if (rt.promise) {
      return await rt.promise;
    }
    return rt.state;
  }

  private async executeJob(
    runtime: ActiveJobRuntime,
    isResume: boolean
  ): Promise<Pdf2AbpJobState> {
    const { workspace, state } = runtime;
    const signal = runtime.abortController?.signal;

    const setPhase = (phase: Pdf2AbpPhase, message?: string) => {
      if (state.phase === phase) return;
      state.phase = phase;
      this.persistState(runtime);
      this.emitEvent(runtime, {
        agentId: 'system',
        type: 'phase_changed',
        message: message || `Phase transitioned to ${phase}`,
        data: { phase },
      });
    };

    this.emitEvent(runtime, {
      agentId: 'system',
      type: 'job_started',
      message: isResume
        ? `Resumed pdf2abp job ${state.jobId}`
        : `Started pdf2abp job ${state.jobId} for ${state.sourceFileName}`,
      data: {
        sourcePdfPath: state.sourcePdfPath,
        providerId: state.providerId,
        modelId: state.modelId,
        concurrency: state.concurrency,
        autoImport: state.autoImport,
      },
    });

    setPhase('skills_and_inspect', 'Initializing main orchestrator agent & tools');

    const tools = createMainPdf2AbpTools({
      workspace,
      providerId: state.providerId,
      modelId: state.modelId,
      baseURL: state.baseURL,
      apiKey: runtime.apiKey,
      extraHeaders: runtime.extraHeaders,
      defaultConcurrency: state.concurrency,
      autoImport: state.autoImport,
      onEvent: (evt) => {
        this.emitEvent(runtime, {
          agentId: evt.agentId,
          type: evt.type,
          message: evt.message,
          data: evt.data,
        });
      },
      onPhaseChange: (phase, msg) => setPhase(phase, msg),
      onPdfInspected: (info) => {
        state.pdfInfo = info;
        this.persistState(runtime);
      },
      onMineruCompleted: (res) => {
        state.mineruResult = res;
        this.persistState(runtime);
      },
      onSubagentStarted: (task) => {
        this.emitEvent(runtime, {
          agentId: `subagent:${task.taskId}`,
          type: 'subagent_started',
          message: `Started subagent ${task.taskId} (${task.title}, p.${task.startPage}-${task.endPage})`,
          data: {
            taskId: task.taskId,
            title: task.title,
            startPage: task.startPage,
            endPage: task.endPage,
            targetOutputRelPath: task.targetOutputRelPath,
          },
        });
      },
      onSubagentFinished: (res) => {
        state.subagentTasks = state.subagentTasks ?? {};
        state.subagentTasks[res.taskId] = res;
        this.persistState(runtime);
        this.emitEvent(runtime, {
          agentId: `subagent:${res.taskId}`,
          type: 'subagent_finished',
          message: `Subagent ${res.taskId} ${res.status} (valid=${res.validationPassed}, steps=${res.stepsUsed})`,
          data: {
            taskId: res.taskId,
            status: res.status,
            validationPassed: res.validationPassed,
            outputFiles: res.outputFiles,
            validationErrors: res.validationErrors,
            stepsUsed: res.stepsUsed,
            durationMs: res.durationMs,
            notes: res.notes,
            anomalies: res.anomalies,
          },
        });
      },
      onValidated: (_targetRel, report) => {
        state.validationReport = report;
        this.persistState(runtime);
      },
      onCompiled: (res) => {
        state.compileResult = res;
        this.persistState(runtime);
      },
      onVerified: (res) => {
        state.verifyResult = res;
        this.persistState(runtime);
      },
      onImported: (res) => {
        state.importResult = res;
        this.persistState(runtime);
      },
    });

    try {
      const systemPrompt = createMainAgentSystemPrompt();
      const userPrompt = buildInitialUserPrompt(state, isResume);

      const result = await runAgentLoop({
        agentId: 'main',
        providerId: state.providerId,
        modelId: state.modelId,
        baseURL: state.baseURL,
        apiKey: runtime.apiKey,
        extraHeaders: runtime.extraHeaders,
        systemPrompt,
        initialUserPrompt: userPrompt,
        tools,
        maxSteps: runtime.maxSteps,
        requestTimeoutMs: 240_000,
        signal,
        onEvent: (evt) => {
          this.emitEvent(runtime, {
            agentId: evt.agentId,
            type: evt.type,
            message: evt.message,
            data: evt.data,
          });
        },
      });

      state.finalSummary = result.finalText;

      if (result.aborted || signal?.aborted || state.status === 'cancelled') {
        state.status = 'cancelled';
        state.error = state.error || 'Cancelled by user';
        state.completedAt = Date.now();
        this.persistState(runtime);
        this.emitEvent(runtime, {
          agentId: 'system',
          type: 'job_cancelled',
          message: state.error,
        });
        return state;
      }

      const verifyOk = Boolean(state.verifyResult?.passed);
      const importOk = !state.autoImport || Boolean(state.importResult?.installed);

      if (verifyOk && importOk) {
        state.phase = 'done';
        state.status = 'completed';
        state.completedAt = Date.now();
        this.persistState(runtime);
        this.emitEvent(runtime, {
          agentId: 'system',
          type: 'job_completed',
          message: `Completed pdf2abp job ${state.jobId}: ${state.compileResult?.manifest.title || state.sourceFileName}`,
          data: {
            abpPath: state.compileResult?.abpPath,
            importResult: state.importResult,
            totalUsage: result.totalUsage,
            stepsUsed: result.stepsUsed,
          },
        });
        return state;
      }

      const hasMineruBlock = /MINERU_UNAVAILABLE/i.test(result.finalText || '');
      const failureReason = hasMineruBlock
        ? 'MINERU_UNAVAILABLE: 未配置有效的 MinerU 云端 Token 或本地服务，任务终止。'
        : !state.compileResult
          ? `Main agent stopped at phase "${state.phase}" without compiling an .abp package (${result.finishReason}).`
          : !verifyOk
            ? 'Compiled .abp failed verify_abp validation.'
            : 'Verified .abp was not imported into the library as required.';

      state.status = 'failed';
      state.error = failureReason;
      state.completedAt = Date.now();
      this.persistState(runtime);
      this.emitEvent(runtime, {
        agentId: 'system',
        type: 'error',
        message: failureReason,
        data: { finishReason: result.finishReason, stepsUsed: result.stepsUsed },
      });
      return state;
    } catch (err) {
      const isAbort =
        signal?.aborted ||
        (err instanceof Error && (err.name === 'AbortError' || /Aborted/i.test(err.message)));

      if (isAbort) {
        state.status = 'cancelled';
        state.error = 'Cancelled by user';
        state.completedAt = Date.now();
        this.persistState(runtime);
        this.emitEvent(runtime, {
          agentId: 'system',
          type: 'job_cancelled',
          message: state.error,
        });
        return state;
      }

      const msg = err instanceof Error ? err.message : String(err);
      state.status = 'failed';
      state.error = msg;
      state.completedAt = Date.now();
      this.persistState(runtime);
      this.emitEvent(runtime, {
        agentId: 'system',
        type: 'error',
        message: msg,
      });
      return state;
    }
  }
}
