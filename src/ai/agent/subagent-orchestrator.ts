/**
 * src/ai/agent/subagent-orchestrator.ts
 * ============================================================================
 * 有界并发校对子代理编排器 (Bounded Parallel Proofreader Subagent Orchestrator)
 * ============================================================================
 * 特性：
 * 1. 基于信号量工作池限制最大并发数（1..6，默认 3），兼顾速度与网关稳定性；
 * 2. 每个子代理拥有全新隔离上下文，仅注入子代理协议 + 必要 ABP 卡片/防线片段 +
 *    单章草稿与关联页码，彻底避免上下文污染与爆表；
 * 3. 检查点断点续传：优先校验 `subagents/<taskId>.result.json` 与磁盘 MDX 真实状态，
 *    已达标分片自动跳过不重复烧轮次；
 * 4. 独立外部验收（Zero Trust）：子代理退出后由编排器亲自用 `validateBookDirectory`
 *    校验目标文件（含多段分片 `assetBaseDir: workspace.bookDir`），绝不盲信口头声明。
 * ============================================================================
 */

import fs from 'node:fs';
import { readPdf2AbpSkill } from '../skills/pdf2abp/index.ts';
import { createBasePdf2AbpTools } from './pdf2abp-base-tools.ts';
import { runAgentLoop, type HarnessEvent } from './harness-runner.ts';
import type { ProviderCapabilities } from './context-manager.ts';
import { validateBookDirectory } from '../../publishing/abp/index.ts';
import type {
  JobWorkspace,
  SubagentTaskResult,
  SubagentTaskSpec,
} from '../../services/pdf2abp/index.ts';

export interface SubagentOrchestratorOptions {
  workspace: JobWorkspace;
  tasks: SubagentTaskSpec[];
  providerId: string;
  modelId: string;
  baseURL: string;
  apiKey?: string;
  extraHeaders?: Record<string, string>;
  capabilities?: Partial<ProviderCapabilities>;
  globalInstructions?: string;
  concurrency?: number;
  maxStepsPerSubagent?: number;
  requestTimeoutMs?: number;
  skipCompletedCheckpoint?: boolean;
  signal?: AbortSignal;
  onEvent?: (evt: HarnessEvent) => void;
  onSubagentStarted?: (task: SubagentTaskSpec) => void;
  onSubagentFinished?: (result: SubagentTaskResult) => void;
}

export interface SubagentBatchResult {
  totalTasks: number;
  completedCount: number;
  skippedCount: number;
  failedCount: number;
  allValidationPassed: boolean;
  results: SubagentTaskResult[];
}

interface ParsedSubagentReport {
  status?: string;
  outputFiles?: string[];
  imagesUsed?: string[];
  validationPassed?: boolean;
  anomalies?: string[];
  notes?: string;
}

function sanitizeTaskId(taskId: string): string {
  return taskId.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function buildSubagentSystemPrompt(): string {
  const protocol = readPdf2AbpSkill('subagent-proofreader-protocol');
  const mdxCards = readPdf2AbpSkill('abp-spec', 'components');
  const mediaKatex = readPdf2AbpSkill('abp-spec', 'media-and-katex');
  const defenses = readPdf2AbpSkill('academic-typesetting-rules', 'five-defenses');

  return [
    protocol.content,
    '\n---\n',
    mdxCards.content,
    '\n---\n',
    mediaKatex.content,
    '\n---\n',
    defenses.content,
  ].join('\n');
}

function buildSubagentUserPrompt(
  workspace: JobWorkspace,
  task: SubagentTaskSpec,
  globalInstructions?: string
): string {
  const lines: string[] = [
    `# 子代理校对工作令 (${task.taskId})`,
    `- **章节/分片标题**：${task.title}`,
    `- **对应物理 PDF 页码**：第 ${task.startPage} 页 至 第 ${task.endPage} 页（共 ${task.endPage - task.startPage + 1} 页）`,
    `- **最终落盘路径（必须精确匹配）**：\`${task.targetOutputRelPath}\``,
  ];

  if (task.draftRelPath) {
    let lineHint = '';
    try {
      const absDraft = workspace.resolveWorkspacePath(task.draftRelPath);
      if (fs.existsSync(absDraft)) {
        const lineCount = fs.readFileSync(absDraft, 'utf-8').split(/\r?\n/).length;
        lineHint = `（约 ${lineCount} 行）`;
      }
    } catch {
      // ignore
    }
    lines.push(`- **MinerU 初步草稿路径**：\`${task.draftRelPath}\`${lineHint}`);
  }

  if (task.referencedImages && task.referencedImages.length > 0) {
    lines.push(
      `- **本页段关联插图（已预拷贝至 book/images/）**：${task.referencedImages.map((s) => `\`${s}\``).join(', ')}`
    );
  } else {
    lines.push(
      `- **本页段 MinerU 切图清单**：空（请对照原页高清图检查：若原页实际上存在插图但 MinerU 漏切，请立即使用 \`crop_pdf_region\` 补切至 \`book/images/${sanitizeTaskId(task.taskId)}_fig1.jpg\` 并用 Markdown 插入！）`
    );
  }

  lines.push('');
  lines.push('## 全局与本书专属校对指令');
  if (globalInstructions?.trim()) {
    lines.push(globalInstructions.trim());
  }
  if (task.instructions?.trim()) {
    lines.push(task.instructions.trim());
  }
  lines.push('');
  lines.push('## 执行步骤清单（严格按顺序完成）');
  lines.push(
    task.draftRelPath
      ? `1. 调用 \`read_workspace_file\` 读取 \`${task.draftRelPath}\`。`
      : `1. 如无现成草稿，先检查相关目录，并以对应物理页原图为准录入。`
  );
  lines.push(
    `2. 使用 \`inspect_pdf_page\` 查看第 ${task.startPage}~${task.endPage} 页原书高清图（2页一图优先 \`mode: "two_up"\`，公式或下标极密时用 \`mode: "single", dpi: 185\`）。请记住同一对话最多保留 1 张图，切换下一张图前务必在当前思考/笔记里记下全部修订点；不要对同一页反复调用 \`inspect_pdf_page\` 或重复 \`inspect_image\` 超过 2 次，以免耗尽步数。`
  );
  lines.push(
    `3. 严禁删节、偷懒省略任何题目、推导或文字！修正形近错字、公式括号/希腊字母/粗体，封装合法学术卡片，清除页眉页码与末尾下一节悬空标题。`
  );
  lines.push(
    `4. 调用 \`write_workspace_file\` 将完整成果写入 \`${task.targetOutputRelPath}\`，随后 **必须** 调用 \`validate_mdx\` 检查 \`${task.targetOutputRelPath}\` 并修复所有报错直至 \`passed: true\`。`
  );
  lines.push(
    `5. 全部验收通过后，最后一条消息只输出干净的 JSON 报告（包含 status, outputFiles, imagesUsed, validationPassed, anomalies, notes）。`
  );

  return lines.join('\n');
}

function extractSubagentJsonReport(text: string): ParsedSubagentReport {
  const trimmed = (text || '').trim();
  if (!trimmed) return {};

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fenced?.[1]?.trim(), trimmed];

  // 也尝试提取最后一个平衡花括号块
  const lastBrace = trimmed.lastIndexOf('}');
  const firstBrace = trimmed.indexOf('{');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  for (const cand of candidates) {
    if (!cand) continue;
    try {
      const obj = JSON.parse(cand);
      if (obj && typeof obj === 'object') {
        return obj as ParsedSubagentReport;
      }
    } catch {
      // try next
    }
  }

  return { notes: trimmed.slice(0, 500) };
}

function isRetryableTransientError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  if (/AbortError|Aborted/i.test(msg)) return false;
  if (/HTTP 400|HTTP 401|HTTP 403/i.test(msg)) return false;
  return true;
}

async function tryLoadValidCheckpoint(
  workspace: JobWorkspace,
  task: SubagentTaskSpec,
  checkpointRelPath: string
): Promise<SubagentTaskResult | null> {
  try {
    const absCkpt = workspace.resolveWorkspacePath(checkpointRelPath);
    if (!fs.existsSync(absCkpt)) return null;
    const saved = JSON.parse(fs.readFileSync(absCkpt, 'utf-8')) as SubagentTaskResult;
    if (!saved || !saved.validationPassed || saved.status === 'failed') return null;
    const expectedFiles =
      Array.isArray(saved.outputFiles) && saved.outputFiles.length > 0
        ? saved.outputFiles
        : [task.targetOutputRelPath];

    for (const rel of expectedFiles) {
      const absOut = workspace.resolveWorkspacePath(rel);
      if (!fs.existsSync(absOut) || fs.statSync(absOut).size < 16) return null;
      const report = await validateBookDirectory(absOut, {
        assetBaseDir: workspace.bookDir,
        skipMath: false,
        skipMdxCompile: false,
      });
      if (!report.passed) return null;
    }

    return {
      ...saved,
      status: 'skipped_from_checkpoint',
    };
  } catch {
    return null;
  }
}

interface GateController {
  acquire: () => Promise<boolean>;
  release: () => void;
  onHttp429: () => void;
  onHttpOk: () => void;
  dispose: () => void;
}

function createAdaptiveGate(
  requestedMax: number,
  signal: AbortSignal | undefined,
  onWarn?: (msg: string) => void
): GateController {
  const floor = Math.min(requestedMax, 2);
  let targetLimit = requestedMax;
  let activeCount = 0;
  let consecutiveOk = 0;
  let lastDownshiftAt = 0;
  const waiters: Array<(ok: boolean) => void> = [];

  const wakeWaiters = () => {
    while (waiters.length > 0 && activeCount < targetLimit && !signal?.aborted) {
      activeCount++;
      const resolve = waiters.shift()!;
      resolve(true);
    }
  };

  const onAbort = () => {
    while (waiters.length > 0) {
      const resolve = waiters.shift()!;
      resolve(false);
    }
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  return {
    acquire: () => {
      if (signal?.aborted) return Promise.resolve(false);
      if (activeCount < targetLimit) {
        activeCount++;
        return Promise.resolve(true);
      }
      return new Promise<boolean>((resolve) => {
        waiters.push(resolve);
      });
    },
    release: () => {
      activeCount = Math.max(0, activeCount - 1);
      wakeWaiters();
    },
    onHttp429: () => {
      const now = Date.now();
      if (now - lastDownshiftAt < 1500) return;
      lastDownshiftAt = now;
      consecutiveOk = 0;
      const prev = targetLimit;
      targetLimit = Math.max(floor, Math.floor(targetLimit / 2));
      if (targetLimit < prev) {
        onWarn?.(`Adaptive concurrency gate: HTTP 429 received, throttling subagent pool ${prev} -> ${targetLimit}`);
      }
    },
    onHttpOk: () => {
      consecutiveOk++;
      if (consecutiveOk >= 6 && targetLimit < requestedMax) {
        consecutiveOk = 0;
        targetLimit++;
        wakeWaiters();
      }
    },
    dispose: () => {
      signal?.removeEventListener('abort', onAbort);
      onAbort();
    },
  };
}

async function executeSingleSubagentTask(
  options: SubagentOrchestratorOptions,
  task: SubagentTaskSpec,
  systemPrompt: string,
  gate?: GateController
): Promise<SubagentTaskResult> {
  const { workspace } = options;
  const startedAt = Date.now();
  const safeId = sanitizeTaskId(task.taskId);
  const checkpointRelPath = `subagents/${safeId}.result.json`;
  const agentId = `subagent:${safeId}`;

  if (options.skipCompletedCheckpoint !== false) {
    const cached = await tryLoadValidCheckpoint(workspace, task, checkpointRelPath);
    if (cached) {
      options.onSubagentStarted?.(task);
      options.onSubagentFinished?.(cached);
      return cached;
    }
  }

  options.onSubagentStarted?.(task);

  const subTools = createBasePdf2AbpTools({
    workspace,
    includeOverviewTools: false,
  });
  const basePrompt = buildSubagentUserPrompt(workspace, task, options.globalInstructions);

  let runResult: Awaited<ReturnType<typeof runAgentLoop>> | null = null;
  let runtimeError: string | undefined;

  for (let attempt = 1; attempt <= 2; attempt++) {
    if (options.signal?.aborted) {
      runtimeError = 'Task aborted by cancellation signal';
      break;
    }

    const attemptPrompt =
      attempt === 1
        ? basePrompt
        : `${basePrompt}\n\n[RETRY NOTICE] 上一次尝试未成功将 \`${task.targetOutputRelPath}\` 写入磁盘。本次请精简轮次：最多按页序看图 1 遍并立即记录要点，尽早调用 \`write_workspace_file\` 落盘后再跑 \`validate_mdx\`。`;

    try {
      runResult = await runAgentLoop({
        agentId,
        providerId: options.providerId,
        modelId: options.modelId,
        baseURL: options.baseURL,
        apiKey: options.apiKey,
        extraHeaders: options.extraHeaders,
        capabilities: options.capabilities,
        systemPrompt,
        initialUserPrompt: attemptPrompt,
        tools: subTools,
        maxSteps: options.maxStepsPerSubagent ?? 36,
        requestTimeoutMs: options.requestTimeoutMs ?? 210_000,
        signal: options.signal,
        onEvent: options.onEvent,
        onHttp429: gate?.onHttp429,
        onHttpOk: gate?.onHttpOk,
      });

      // 若目标文件完全尚未落盘，且非主动取消，给一次温和重试机会
      const absExpected = workspace.resolveWorkspacePath(task.targetOutputRelPath);
      if (
        attempt === 1 &&
        !runResult.aborted &&
        (!fs.existsSync(absExpected) || fs.statSync(absExpected).size < 10)
      ) {
        options.onEvent?.({
          agentId,
          type: 'warning',
          message: `Subagent finished without writing ${task.targetOutputRelPath}, retrying once...`,
        });
        continue;
      }

      runtimeError = undefined;
      break;
    } catch (err) {
      runtimeError = err instanceof Error ? err.message : String(err);
      if (attempt === 1 && isRetryableTransientError(err) && !options.signal?.aborted) {
        options.onEvent?.({
          agentId,
          type: 'warning',
          message: `Subagent crashed transiently (${runtimeError}), retrying attempt 2...`,
        });
        continue;
      }
      break;
    }
  }

  const parsed = extractSubagentJsonReport(runResult?.finalText ?? '');
  const candidateFiles = [task.targetOutputRelPath];
  if (Array.isArray(parsed.outputFiles)) {
    for (const f of parsed.outputFiles) {
      if (typeof f === 'string' && f.trim() && !candidateFiles.includes(f.trim())) {
        candidateFiles.push(f.trim());
      }
    }
  }

  const existingOutputFiles: string[] = [];
  const validationErrors: string[] = [];

  for (const rel of candidateFiles) {
    try {
      const abs = workspace.resolveWorkspacePath(rel);
      if (fs.existsSync(abs) && fs.statSync(abs).size > 0) {
        existingOutputFiles.push(rel);
      }
    } catch {
      // ignore out-of-sandbox claims
    }
  }

  // 强制检查约定目标文件是否落盘
  const primaryOutRel = existingOutputFiles.includes(task.targetOutputRelPath)
    ? task.targetOutputRelPath
    : existingOutputFiles[0];

  if (!primaryOutRel) {
    validationErrors.push(
      `目标输出文件未落盘或为空: ${task.targetOutputRelPath}`
    );
  } else {
    const absTarget = workspace.resolveWorkspacePath(primaryOutRel);
    const qaReport = await validateBookDirectory(absTarget, {
      assetBaseDir: workspace.bookDir,
      skipMath: false,
      skipMdxCompile: false,
    });
    if (!qaReport.passed) {
      for (const issue of qaReport.errors) {
        validationErrors.push(
          `${issue.file}${issue.line ? `:L${issue.line}` : ''} [${issue.category}] ${issue.message}`
        );
      }
    }
  }

  const validationPassed =
    Boolean(primaryOutRel) && validationErrors.length === 0 && !runtimeError;

  const result: SubagentTaskResult = {
    taskId: task.taskId,
    status: validationPassed ? 'completed' : 'failed',
    outputFiles: primaryOutRel ? [primaryOutRel] : [],
    imagesUsed: Array.isArray(parsed.imagesUsed)
      ? parsed.imagesUsed.map(String)
      : task.referencedImages ?? [],
    validationPassed,
    validationErrors,
    anomalies: Array.isArray(parsed.anomalies) ? parsed.anomalies.map(String) : [],
    notes:
      parsed.notes ||
      (runResult?.finalText ? runResult.finalText.slice(0, 300) : ''),
    stepsUsed: runResult?.stepsUsed ?? 0,
    durationMs: Date.now() - startedAt,
    ...(runtimeError ? { error: runtimeError } : {}),
  };

  workspace.writeFile(checkpointRelPath, JSON.stringify(result, null, 2));
  options.onSubagentFinished?.(result);

  return result;
}

export async function runSubagentBatch(
  options: SubagentOrchestratorOptions
): Promise<SubagentBatchResult> {
  const tasks = options.tasks || [];
  if (tasks.length === 0) {
    return {
      totalTasks: 0,
      completedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      allValidationPassed: true,
      results: [],
    };
  }

  const concurrency = Math.max(1, Math.min(24, Math.floor(options.concurrency ?? 12)));
  const systemPrompt = buildSubagentSystemPrompt();
  const results: SubagentTaskResult[] = new Array(tasks.length);
  const poolSize = Math.min(concurrency, tasks.length);
  const gate = createAdaptiveGate(poolSize, options.signal, (msg) => {
    options.onEvent?.({
      agentId: 'main',
      type: 'warning',
      message: msg,
    });
  });

  let cursor = 0;

  const worker = async () => {
    while (true) {
      if (options.signal?.aborted) break;
      const acquired = await gate.acquire();
      if (!acquired) break;
      try {
        const idx = cursor++;
        if (idx >= tasks.length) break;
        const task = tasks[idx];
        results[idx] = await executeSingleSubagentTask(options, task, systemPrompt, gate);
      } finally {
        gate.release();
      }
    }
  };

  try {
    await Promise.all(Array.from({ length: poolSize }, () => worker()));
  } finally {
    gate.dispose();
  }

  const settled = results.filter(Boolean);
  const completedCount = settled.filter((r) => r.status === 'completed').length;
  const skippedCount = settled.filter((r) => r.status === 'skipped_from_checkpoint').length;
  const failedCount = settled.filter((r) => r.status === 'failed').length;
  const allValidationPassed =
    settled.length === tasks.length &&
    failedCount === 0 &&
    settled.every((r) => r.validationPassed);

  return {
    totalTasks: tasks.length,
    completedCount,
    skippedCount,
    failedCount,
    allValidationPassed,
    results: settled,
  };
}
