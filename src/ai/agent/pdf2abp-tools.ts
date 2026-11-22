import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import {
  MineruUnavailableError,
  analyzeBookStructure,
  auditBookCoverage,
  checkMineruAvailability,
  getPythonAvailability,
  importAbpToAppLibrary,
  inspectPdf,
  mergeChapterParts,
  prepareChapterChunks,
  runMineruOnPdf,
  runWorkspacePython,
  type AbpImportResult,
  type BookPlanSpec,
  type ChapterChunkWorkOrder,
  type JobWorkspace,
  type MineruRunResult,
  type Pdf2AbpPhase,
  type PdfInspectResult,
  type SubagentTaskResult,
  type SubagentTaskSpec,
} from '../../services/pdf2abp/index.ts';
import {
  compileBookToAbp,
  verifyAbpArchive,
  type AbpArchiveVerificationReport,
  type AbpCompileResult,
  type MdxValidationReport,
} from '../../publishing/abp/index.ts';
import { createBasePdf2AbpTools } from './pdf2abp-base-tools.ts';
import { runSubagentBatch } from './subagent-orchestrator.ts';
import type { AgentToolDefinition, HarnessEvent } from './harness-runner.ts';
import type { ProviderCapabilities } from './context-manager.ts';

export interface MainToolsOptions {
  workspace: JobWorkspace;
  providerId: string;
  modelId: string;
  baseURL: string;
  apiKey?: string;
  extraHeaders?: Record<string, string>;
  capabilities?: Partial<ProviderCapabilities>;
  defaultConcurrency: number;
  autoImport: boolean;
  onEvent?: (evt: HarnessEvent) => void;
  onPhaseChange?: (phase: Pdf2AbpPhase, message?: string) => void;
  onPdfInspected?: (info: PdfInspectResult) => void;
  onMineruCompleted?: (res: MineruRunResult) => void;
  onSubagentStarted?: (task: SubagentTaskSpec) => void;
  onSubagentFinished?: (res: SubagentTaskResult) => void;
  onCompiled?: (res: AbpCompileResult) => void;
  onVerified?: (res: AbpArchiveVerificationReport) => void;
  onValidated?: (targetRel: string, res: MdxValidationReport) => void;
  onImported?: (res: AbpImportResult) => void;
}

const subagentTaskInputSchema = z.object({
  taskId: z.string(),
  title: z.string(),
  targetOutputRelPath: z.string(),
  startPage: z.number().int().min(1),
  endPage: z.number().int().min(1),
  draftRelPath: z.string().optional(),
  referencedImages: z.array(z.string()).optional(),
  instructions: z.string(),
});

const plannedChapterInputSchema = z.object({
  id: z.string(),
  filename: z.string(),
  title: z.string(),
  sectionTitle: z.string().optional(),
  startPage: z.number().int().min(1),
  endPage: z.number().int().min(1),
  startAnchor: z
    .string()
    .optional()
    .describe('可选：该节在 startPage 起始处的精确标题或首句锚点文本（用于与上一节/章首导语共享同一页时精准切分）'),
  endAnchor: z
    .string()
    .optional()
    .describe('可选：该节在 endPage 停止的排他边界文本（通常为下一节标题；命中后截断至其之前一块）'),
  kind: z
    .enum(['frontmatter', 'chapter-intro', 'body', 'exercises', 'notes', 'appendix'])
    .optional(),
  rules: z.string().optional(),
});

export function createMainPdf2AbpTools(
  options: MainToolsOptions
): AgentToolDefinition<any>[] {
  const { workspace } = options;

  const baseTools = createBasePdf2AbpTools({
    workspace,
    includeOverviewTools: true,
    onPdfInspected: (info) => {
      options.onPdfInspected?.(info);
    },
    onValidated: (targetRel, report) => {
      options.onValidated?.(targetRel, report);
    },
  });

  const deleteWorkspaceFileTool: AgentToolDefinition<any> = {
    name: 'delete_workspace_file',
    description: '删除当前任务工作区内的临时或废弃文件/目录（禁止删除根目录）。',
    parameters: z.object({
      relPath: z.string().describe('待删除的工作区相对路径'),
    }),
    execute: async (args: { relPath: string }) => {
      const res = workspace.deleteFile(args.relPath);
      return {
        text: JSON.stringify(res, null, 2),
        summary: res.deleted ? `Deleted ${res.relPath}` : `File not found: ${res.relPath}`,
      };
    },
  };

  const runPythonTool: AgentToolDefinition<any> = {
    name: 'run_python',
    description:
      '在当前任务沙箱工作区内执行自定义 Python 脚本（默认工作目录即为工作区根目录，已注入 ASTROLIB_WORKSPACE_DIR / ASTROLIB_SOURCE_PDF / ASTROLIB_MINERU_DIR / ASTROLIB_BOOK_DIR 等环境变量）。适用于大书目录抽取、物理页码偏移计算、答案按题号精确映射、自定义 JSON/MDX 批量清洗与统计。',
    parameters: z.object({
      code: z
        .string()
        .optional()
        .describe('内联 Python 脚本代码（会自动落盘到 scripts/ 并执行）'),
      scriptRelPath: z
        .string()
        .optional()
        .describe('若不传 code，则执行工作区内已有的 .py 脚本路径'),
      args: z.array(z.string()).optional().describe('传给 Python 脚本的命令行参数'),
      timeoutMs: z.number().int().min(1000).max(300000).optional().describe('超时毫秒，默认 60000'),
    }),
    execute: async (args: {
      code?: string;
      scriptRelPath?: string;
      args?: string[];
      timeoutMs?: number;
    }) => {
      const res = await runWorkspacePython({
        workspace,
        code: args.code,
        scriptRelPath: args.scriptRelPath,
        args: args.args,
        timeoutMs: args.timeoutMs,
      });
      return {
        isError: !res.success,
        text: JSON.stringify(res, null, 2),
        summary: `Python (${res.scriptRelPath}) exit=${res.exitCode} in ${res.durationMs}ms`,
        artifactPath: res.scriptRelPath,
      };
    },
  };

  const checkMineruStatusTool: AgentToolDefinition<any> = {
    name: 'check_mineru_status',
    description:
      '检测当前环境 MinerU 引擎可用性（云端 v4 Token 或本地 GPU 管线）以及 Python 解释器状态。',
    parameters: z.object({}),
    execute: async () => {
      const mineru = await checkMineruAvailability();
      const python = await getPythonAvailability();
      return {
        text: JSON.stringify({ mineru, python }, null, 2),
        summary: `MinerU ready=${mineru.ready} (${mineru.preferredEngine}), Python=${python.available}`,
        data: { mineruReady: mineru.ready, preferredEngine: mineru.preferredEngine },
      };
    },
  };

  const runMineruPipelineTool: AgentToolDefinition<any> = {
    name: 'run_mineru_pipeline',
    description:
      '对源 PDF 运行完整 MinerU 解析管线：自动按最大 200 页且不超过 180 MB 拆分分卷、交付 MinerU 提取（云端多卷并发提取），并将分卷 Markdown / blocks JSON / images 确定性缝合对齐全局 1-based 物理页码。\n' +
      '若用户任务仅需处理部分章节且你已通过 inspect_pdf / 前几页目录确认了物理页范围，可传 pageRange: [startPage, endPage] 仅提取目标连续页段（仍保留全局物理页码）。',
    parameters: z.object({
      engine: z.enum(['auto', 'api', 'local']).optional().describe('默认 auto'),
      maxPagesPerPart: z.number().int().min(10).max(200).optional().describe('每卷最大页数，默认 200'),
      maxSizeMBPerPart: z.number().min(10).max(195).optional().describe('每卷最大 MB，默认 180'),
      pageRange: z
        .array(z.number().int().min(1))
        .length(2)
        .optional()
        .describe('可选物理页码闭区间 [startPage, endPage]（1-based），仅解析该子区间并保留真实全局页码'),
      reuseCache: z.boolean().optional().describe('若指纹一致是否复用工作区缓存结果，默认 true'),
    }),
    execute: async (args: {
      engine?: 'auto' | 'api' | 'local';
      maxPagesPerPart?: number;
      maxSizeMBPerPart?: number;
      pageRange?: number[];
      reuseCache?: boolean;
    }) => {
      options.onPhaseChange?.('mineru', 'Running MinerU parsing & part stitching pipeline');
      const parsedRange: [number, number] | undefined =
        Array.isArray(args.pageRange) && args.pageRange.length === 2
          ? [Math.min(args.pageRange[0], args.pageRange[1]), Math.max(args.pageRange[0], args.pageRange[1])]
          : undefined;
      try {
        const res = await runMineruOnPdf({
          pdfPath: workspace.sourcePdfPath,
          workspace,
          engine: args.engine ?? 'auto',
          maxPagesPerPart: args.maxPagesPerPart ?? 200,
          maxSizeMBPerPart: args.maxSizeMBPerPart ?? 180,
          ...(parsedRange ? { pageRange: parsedRange } : {}),
          reuseCache: args.reuseCache ?? true,
          onProgress: (msg) => {
            options.onEvent?.({
              agentId: 'main',
              type: 'tool_result',
              message: msg,
              data: { toolName: 'run_mineru_pipeline', stage: 'progress' },
            });
          },
        });
        options.onMineruCompleted?.(res);
        options.onPhaseChange?.('overview_vision', 'MinerU finished; reviewing book overview');

        const summaryRel = path
          .relative(workspace.rootDir, res.summaryPath)
          .replace(/\\/g, '/');

        return {
          text: JSON.stringify(
            {
              engine: res.engine,
              reusedCache: res.reusedCache,
              totalParts: res.parts.length,
              totalPages: res.summary.totalPages,
              totalImages: res.summary.totalImages,
              totalBlocks: res.summary.totalBlocks,
              detectedHeadingsCount: res.summary.headings.length,
              summaryRelPath: summaryRel,
              fullMdRelPath: path
                .relative(workspace.rootDir, res.fullMdPath)
                .replace(/\\/g, '/'),
              pagesBlocksRelPath: path
                .relative(workspace.rootDir, res.pagesBlocksPath)
                .replace(/\\/g, '/'),
              headingsPreview: res.summary.headings.slice(0, 60),
            },
            null,
            2
          ),
          summary: `MinerU (${res.engine}) parsed ${res.summary.totalPages}p, ${res.summary.totalImages} imgs (${res.parts.length} part(s))`,
          artifactPath: summaryRel,
          data: {
            totalPages: res.summary.totalPages,
            totalImages: res.summary.totalImages,
          },
        };
      } catch (err) {
        if (err instanceof MineruUnavailableError) {
          const mineruStatus = await checkMineruAvailability();
          return {
            isError: true,
            text: JSON.stringify(
              {
                errorCode: err.code,
                message: err.message,
                status: mineruStatus,
              },
              null,
              2
            ),
            summary: 'MINERU_UNAVAILABLE: configure MinerU Token or local service',
          };
        }
        throw err;
      }
    },
  };

  const prepareChapterChunksTool: AgentToolDefinition<any> = {
    name: 'prepare_chapter_chunks',
    description:
      '根据全书结构蓝图 BookPlanSpec（含 documentMode、bookConfig、globalProofreadingRules、每节精确物理页码 startPage..endPage 与同页起止锚点 startAnchor/endAnchor），运行确定性结构护栏校验并将 MinerU 全局 blocks 与配图按【完整小节】切片到 chunks/（默认不强行按页数拆碎小节，仅在单节超 28 页时分段），同步生成 book/book.json 与 chunks/manifest.json。若未直接传入 plan 对象，则自动从工作区 planRelPath（默认 "book-plan.json"）读取。',
    parameters: z.object({
      plan: z
        .object({
          documentMode: z
            .enum(['textbook', 'paper', 'exam', 'monograph'])
            .optional()
            .describe('书籍形态模式，默认 textbook（启用教材级目录跳过与小节 1:1 拆分校验）'),
          bookConfig: z.record(z.string(), z.unknown()),
          coverPage: z.number().int().min(1).optional(),
          coverBboxNorm1000: z.array(z.number()).length(4).optional(),
          globalProofreadingRules: z.array(z.string()).default([]),
          chapters: z.array(plannedChapterInputSchema).min(1),
        })
        .optional()
        .describe('可选：直接传入 BookPlanSpec；大数据也可先 write_workspace_file 到 book-plan.json 再传 planRelPath'),
      planRelPath: z
        .string()
        .optional()
        .describe('工作区规划文件路径，默认 "book-plan.json"'),
      maxPagesPerChunk: z
        .number()
        .int()
        .min(0)
        .max(28)
        .optional()
        .describe('可选：强制按页数再分片的上限；默认 0（整小节 1 个切片，仅 >28 页自动拆分）'),
    }),
    execute: async (args: {
      plan?: Record<string, unknown>;
      planRelPath?: string;
      maxPagesPerChunk?: number;
    }) => {
      options.onPhaseChange?.(
        'planning_and_slicing',
        'Slicing stitched MinerU blocks & images into chapter work orders'
      );

      let spec: BookPlanSpec;
      const planRel = args.planRelPath ?? 'book-plan.json';
      if (args.plan) {
        spec = args.plan as unknown as BookPlanSpec;
        workspace.writeFile(planRel, JSON.stringify(spec, null, 2));
      } else {
        const absPlan = workspace.resolveWorkspacePath(planRel);
        if (!fs.existsSync(absPlan)) {
          return {
            isError: true,
            text: JSON.stringify({
              error: `未传入 plan 对象，且工作区内不存在 ${planRel}。请先撰写或传入 BookPlanSpec。`,
            }),
            summary: `Missing ${planRel}`,
          };
        }
        spec = JSON.parse(fs.readFileSync(absPlan, 'utf-8')) as BookPlanSpec;
      }

      if (!spec.chapters || spec.chapters.length === 0) {
        return {
          isError: true,
          text: JSON.stringify({ error: 'BookPlanSpec.chapters 不能为空' }),
          summary: 'Empty chapters in BookPlanSpec',
        };
      }

      try {
        const res = prepareChapterChunks({
          workspace,
          plan: spec,
          maxPagesPerChunk: args.maxPagesPerChunk ?? 0,
        });

        return {
          text: JSON.stringify(
            {
              chunkManifestRelPath: res.chunkManifestRelPath,
              totalWorkOrders: res.workOrders.length,
              copiedImagesCount: res.copiedImagesCount,
              ...(res.warnings.length > 0 ? { warnings: res.warnings } : {}),
              workOrders: res.workOrders,
            },
            null,
            2
          ),
          summary: `Prepared ${res.workOrders.length} chunk work order(s), copied ${res.copiedImagesCount} image(s)`,
          artifactPath: res.chunkManifestRelPath,
          data: {
            totalWorkOrders: res.workOrders.length,
            copiedImagesCount: res.copiedImagesCount,
            warningsCount: res.warnings.length,
          },
        };
      } catch (err) {
        return {
          isError: true,
          text: JSON.stringify(
            {
              error: err instanceof Error ? err.message : String(err),
            },
            null,
            2
          ),
          summary: 'BookPlan validation failed',
        };
      }
    },
  };

  const analyzeBookStructureTool: AgentToolDefinition<any> = {
    name: 'analyze_book_structure',
    description:
      '在运行完 MinerU 后调用：确定性扫描 mineru/stitched/pages_blocks.json 与 PDF 大纲书签，识别应跳过的目录/框目表/索引页、提取各章章首导语 (chapter-intro)、按原书 1:1 二级小节推算精确起止物理页与同页 startAnchor/endAnchor、并汇总含脚注/代码/插图的页面密度。结果同时保存到 mineru/structure-analysis.json。',
    parameters: z.object({}),
    execute: async () => {
      const blocksPath = path.join(workspace.mineruStitchedDir, 'pages_blocks.json');
      if (!fs.existsSync(blocksPath)) {
        return {
          isError: true,
          text: JSON.stringify({
            error: '尚未发现 mineru/stitched/pages_blocks.json，请先运行 run_mineru_pipeline。',
          }),
          summary: 'Missing MinerU blocks for structure analysis',
        };
      }
      let pdfInfo: PdfInspectResult | undefined;
      try {
        pdfInfo = await inspectPdf(workspace.sourcePdfPath);
      } catch {
        pdfInfo = undefined;
      }
      const analysis = analyzeBookStructure(blocksPath, pdfInfo);
      const written = workspace.writeFile('mineru/structure-analysis.json', JSON.stringify(analysis, null, 2));
      return {
        text: JSON.stringify(
          {
            analysisRelPath: written.relPath,
            ...analysis,
          },
          null,
          2
        ),
        summary: `Analyzed structure: ${analysis.sections.length} section candidate(s), skip ${analysis.tocAndIndexPagesToSkip.length} TOC/Index page(s)`,
        artifactPath: written.relPath,
        data: {
          sectionsCount: analysis.sections.length,
          skipPagesCount: analysis.tocAndIndexPagesToSkip.length,
        },
      };
    },
  };

  const auditBookCoverageTool: AgentToolDefinition<any> = {
    name: 'audit_book_coverage',
    description:
      '在所有子代理校对完成后、打包前调用：确定性核查 book/book.json 与全部 .mdx 产物的文本字符覆盖率、插图完整性、sections[].intro 互斥配置、脚注留存与未处理 MINERU_FOOTNOTE 残留及正文重复标题，生成完整审计报告 chunks/coverage-audit.json。',
    parameters: z.object({}),
    execute: async () => {
      const blocksPath = path.join(workspace.mineruStitchedDir, 'pages_blocks.json');
      if (!fs.existsSync(blocksPath)) {
        return {
          isError: true,
          text: JSON.stringify({ error: '缺少 mineru/stitched/pages_blocks.json，无法对照审计。' }),
          summary: 'Missing MinerU blocks for coverage audit',
        };
      }
      if (!fs.existsSync(path.join(workspace.bookDir, 'book.json'))) {
        return {
          isError: true,
          text: JSON.stringify({ error: '缺少 book/book.json。' }),
          summary: 'Missing book/book.json',
        };
      }
      const report = auditBookCoverage(workspace.bookDir, blocksPath);
      const written = workspace.writeFile('chunks/coverage-audit.json', JSON.stringify(report, null, 2));
      return {
        text: JSON.stringify(
          {
            auditRelPath: written.relPath,
            ...report,
          },
          null,
          2
        ),
        summary: `Coverage audit ok=${report.ok} (${report.totalMdxFiles} files, ratio=${report.charCoverageRatio}, footnotes=${report.outputStats.totalFootnoteDefs}/${report.mineruStats.totalFootnotes})`,
        artifactPath: written.relPath,
      };
    },
  };

  const dispatchSubagentsTool: AgentToolDefinition<any> = {
    name: 'dispatch_subagents',
    description:
      '并行分派任务给多个隔离上下文的校对子代理，每个子代理只加载自身章节草稿与高清页图进行校对并落盘 MDX + 自检。\n' +
      '- 推荐直接传 manifestRelPath="chunks/manifest.json" 自动读取 prepare_chapter_chunks 生成的所有切片；\n' +
      '- 也支持传入 tasks[] 自定义工作令，或用 taskIds[] 仅重跑失败的切片（成功分片默认自动走检查点跳过）。',
    parameters: z.object({
      manifestRelPath: z
        .string()
        .optional()
        .describe('从该清单加载 workOrders，默认 "chunks/manifest.json"'),
      tasks: z
        .array(subagentTaskInputSchema)
        .optional()
        .describe('可选：直接自定义分派子代理任务列表（若传入则优先使用）'),
      taskIds: z
        .array(z.string())
        .optional()
        .describe('可选：仅执行/重跑指定 taskId 列表'),
      globalInstructions: z
        .string()
        .optional()
        .describe('传给所有子代理的附加全书统一规则'),
      concurrency: z
        .number()
        .int()
        .min(1)
        .max(24)
        .optional()
        .describe('并发子代理上限（1~24，默认采用任务配置 12；遇 429 自动降速）'),
      skipCompletedCheckpoint: z
        .boolean()
        .optional()
        .describe('是否跳过已通过验证的缓存分片，默认 true'),
    }),
    execute: async (
      args: {
        manifestRelPath?: string;
        tasks?: SubagentTaskSpec[];
        taskIds?: string[];
        globalInstructions?: string;
        concurrency?: number;
        skipCompletedCheckpoint?: boolean;
      },
      ctx
    ) => {
      options.onPhaseChange?.(
        'subagent_proofreading',
        'Dispatching bounded-concurrency proofreader subagents'
      );

      let taskList: SubagentTaskSpec[] = [];
      let inferredGlobalInstructions = args.globalInstructions || '';

      if (args.tasks && args.tasks.length > 0) {
        taskList = args.tasks;
      } else {
        const manifestRel = args.manifestRelPath ?? 'chunks/manifest.json';
        const absManifest = workspace.resolveWorkspacePath(manifestRel);
        if (!fs.existsSync(absManifest)) {
          return {
            isError: true,
            text: JSON.stringify({
              error: `未传入 tasks[] 且未找到 ${manifestRel}。请先运行 prepare_chapter_chunks 或显式传入 tasks[]。`,
            }),
            summary: `Missing ${manifestRel}`,
          };
        }
        const manifest = JSON.parse(fs.readFileSync(absManifest, 'utf-8')) as {
          workOrders?: ChapterChunkWorkOrder[];
        };
        const workOrders = manifest.workOrders || [];
        taskList = workOrders.map((wo) => ({
          taskId: wo.chunkId,
          title:
            wo.totalParts > 1
              ? `${wo.chapterTitle} (Part ${wo.partIndex}/${wo.totalParts})`
              : wo.chapterTitle,
          targetOutputRelPath: wo.targetOutputRelPath,
          startPage: wo.startPage,
          endPage: wo.endPage,
          draftRelPath: wo.draftRelPath,
          referencedImages: wo.referencedImages,
          instructions: wo.rules,
        }));
      }

      if (!inferredGlobalInstructions) {
        try {
          const absPlan = workspace.resolveWorkspacePath('book-plan.json');
          if (fs.existsSync(absPlan)) {
            const planObj = JSON.parse(fs.readFileSync(absPlan, 'utf-8')) as Partial<BookPlanSpec>;
            if (Array.isArray(planObj.globalProofreadingRules)) {
              inferredGlobalInstructions = planObj.globalProofreadingRules.join('\n');
            }
          }
        } catch {

        }
      }

      if (args.taskIds && args.taskIds.length > 0) {
        const allow = new Set(args.taskIds);
        taskList = taskList.filter((t) => allow.has(t.taskId));
      }

      if (taskList.length === 0) {
        return {
          isError: true,
          text: JSON.stringify({ error: '没有任何可执行的子代理任务（taskList 为空）' }),
          summary: 'No subagent tasks to execute',
        };
      }

      const batch = await runSubagentBatch({
        workspace,
        tasks: taskList,
        providerId: options.providerId,
        modelId: options.modelId,
        baseURL: options.baseURL,
        apiKey: options.apiKey,
        extraHeaders: options.extraHeaders,
        capabilities: options.capabilities,
        globalInstructions: inferredGlobalInstructions,
        concurrency: args.concurrency ?? options.defaultConcurrency,
        skipCompletedCheckpoint: args.skipCompletedCheckpoint ?? true,
        signal: ctx.signal,
        onEvent: options.onEvent,
        onSubagentStarted: options.onSubagentStarted,
        onSubagentFinished: options.onSubagentFinished,
      });

      options.onPhaseChange?.(
        'merge_and_validate',
        'Subagents finished; merging multi-part chapters and running book QA'
      );

      return {
        text: JSON.stringify(batch, null, 2),
        summary: `Subagents finished: ${batch.completedCount} completed, ${batch.skippedCount} checkpointed, ${batch.failedCount} failed (allValidationPassed=${batch.allValidationPassed})`,
        data: {
          totalTasks: batch.totalTasks,
          completedCount: batch.completedCount,
          failedCount: batch.failedCount,
          allValidationPassed: batch.allValidationPassed,
        },
      };
    },
  };

  const mergeChapterPartsTool: AgentToolDefinition<any> = {
    name: 'merge_chapter_parts',
    description:
      '将同一章节的多个校对分片 MDX（chunks/*/proofread_part.mdx）按序无损拼接为最终 book/<chapter>.mdx。',
    parameters: z.object({
      targetOutputRelPath: z
        .string()
        .describe('最终输出路径，例如 "book/03_第三章.mdx"'),
      partRelPaths: z
        .array(z.string())
        .min(1)
        .describe('按章节顺序排列的分片相对路径数组'),
      chapterTitle: z.string().describe('合并后章节 YAML Frontmatter 标题'),
    }),
    execute: async (args: {
      targetOutputRelPath: string;
      partRelPaths: string[];
      chapterTitle: string;
    }) => {
      options.onPhaseChange?.('merge_and_validate', `Merging parts into ${args.targetOutputRelPath}`);
      const res = mergeChapterParts({
        workspace,
        targetOutputRelPath: args.targetOutputRelPath,
        partRelPaths: args.partRelPaths,
        chapterTitle: args.chapterTitle,
      });
      return {
        text: JSON.stringify(res, null, 2),
        summary: `Merged ${res.mergedParts} part(s) -> ${res.targetOutputRelPath}`,
        artifactPath: res.targetOutputRelPath,
      };
    },
  };

  const packAbpTool: AgentToolDefinition<any> = {
    name: 'pack_abp',
    description:
      '运行无头官方 ABP 编译器，将工作区 book/（含 book.json、*.mdx 与 images/）编译为符合 Schema 1.0.0 的标准 .abp 内容包到 dist/ 目录（含 ai-index / cross-refs）。',
    parameters: z.object({
      bookDirRelPath: z.string().optional().describe('默认 "book"'),
      outDirRelPath: z.string().optional().describe('默认 "dist"'),
      colSlug: z.string().optional().describe('合集 ID（如 math / cs / science / telecom）'),
      bookSlug: z.string().optional().describe('书籍 ASCII slug'),
      withVectors: z.boolean().optional().describe('是否生成语义向量索引，默认 false'),
      writeExpanded: z.boolean().optional().describe('是否同时写出解包目录，默认 true'),
    }),
    execute: async (args: {
      bookDirRelPath?: string;
      outDirRelPath?: string;
      colSlug?: string;
      bookSlug?: string;
      withVectors?: boolean;
      writeExpanded?: boolean;
    }) => {
      options.onPhaseChange?.('pack_and_verify', 'Compiling book workspace into .abp archive');
      const bookDirRel = args.bookDirRelPath ?? 'book';
      const outDirRel = args.outDirRelPath ?? 'dist';
      const absBookDir = workspace.resolveWorkspacePath(bookDirRel);
      const absOutDir = workspace.resolveWorkspacePath(outDirRel);

      const bookJsonPath = path.join(absBookDir, 'book.json');
      if (!fs.existsSync(bookJsonPath)) {
        return {
          isError: true,
          text: JSON.stringify({
            error: `缺少 ${bookDirRel}/book.json，请先写入完整的 book.json 元数据配置再打包。`,
          }),
          summary: `Missing ${bookDirRel}/book.json`,
        };
      }

      const res = await compileBookToAbp({
        bookDir: absBookDir,
        outDir: absOutDir,
        colSlug: args.colSlug,
        bookSlug: args.bookSlug,
        withVectors: args.withVectors ?? false,
        includeAuxiliary: true,
        writeExpanded: args.writeExpanded ?? true,
      });

      options.onCompiled?.(res);
      const abpRelPath = path
        .relative(workspace.rootDir, res.abpPath)
        .replace(/\\/g, '/');

      return {
        text: JSON.stringify(
          {
            abpRelPath,
            abpPath: res.abpPath,
            sizeBytes: res.sizeBytes,
            bookId: res.manifest.id,
            colSlug: res.manifest.colSlug,
            bookSlug: res.manifest.slug,
            title: res.manifest.title,
            entryPoint: res.manifest.entryPoint,
            totalChapters: res.totalChapters,
            totalAssets: res.totalAssets,
            warnings: res.warnings,
          },
          null,
          2
        ),
        summary: `Compiled ${abpRelPath} (${res.totalChapters} chapters, ${res.totalAssets} assets, ${Math.round(res.sizeBytes / 1024)} KB)`,
        artifactPath: abpRelPath,
      };
    },
  };

  const verifyAbpTool: AgentToolDefinition<any> = {
    name: 'verify_abp',
    description:
      '对打包好的 .abp 归档包执行端到端解包验收：Schema 契约、HTML 内零 KaTeX 报错、全资产闭环（缺失图片/封面）以及 AI/交叉引用附属数据完整性。',
    parameters: z.object({
      abpRelPath: z.string().describe('.abp 文件在工作区内的相对路径，例如 "dist/math-book.abp"'),
    }),
    execute: async (args: { abpRelPath: string }) => {
      options.onPhaseChange?.('pack_and_verify', `Verifying archive ${args.abpRelPath}`);
      const absAbp = workspace.resolveWorkspacePath(args.abpRelPath);
      const report = await verifyAbpArchive(absAbp);
      options.onVerified?.(report);
      return {
        text: JSON.stringify(report, null, 2),
        summary: `ABP verify (${args.abpRelPath}): passed=${report.passed}, errors=${report.errors.length}, katexErrs=${report.katexErrorChapters.length}, missingAssets=${report.missingAssets.length}`,
        data: {
          passed: report.passed,
          errorsCount: report.errors.length,
        },
      };
    },
  };

  const importAbpTool: AgentToolDefinition<any> = {
    name: 'import_abp',
    description:
      '将通过 verify_abp 验收的 .abp 内容包原子导入 AstroLib 应用书库（不修改 tracked Git 源码），返回可点击阅读路径 readerUrl 与 canonicalUrl。',
    parameters: z.object({
      abpRelPath: z.string().describe('已验收通过的 .abp 工作区相对路径'),
    }),
    execute: async (args: { abpRelPath: string }) => {
      if (!options.autoImport) {
        return {
          text: JSON.stringify(
            {
              imported: false,
              skipped: true,
              reason: '当前任务开启了 --no-import / autoImport=false，仅完成校验打包，未执行自动入库。',
              abpRelPath: args.abpRelPath,
            },
            null,
            2
          ),
          summary: 'Skipped import_abp because autoImport=false',
        };
      }

      options.onPhaseChange?.('import', `Importing ${args.abpRelPath} into app library`);
      const absAbp = workspace.resolveWorkspacePath(args.abpRelPath);
      const verification = await verifyAbpArchive(absAbp);
      if (!verification.passed) {
        return {
          isError: true,
          text: JSON.stringify(
            {
              error: '拒绝导入尚未通过 verify_abp 严格验收的 .abp 文件！请先修复下列问题并重打重验：',
              verification,
            },
            null,
            2
          ),
          summary: `Import blocked: verify_abp failed (${verification.errors.length} error(s))`,
        };
      }

      const imported = await importAbpToAppLibrary(absAbp);
      options.onImported?.(imported);
      options.onPhaseChange?.('done', 'Book imported cleanly into AstroLib library');

      return {
        text: JSON.stringify(imported, null, 2),
        summary: `Imported "${imported.title}" -> ${imported.targetMode} (${imported.readerUrl})`,
        data: { ...imported },
      };
    },
  };

  return [
    ...baseTools,
    deleteWorkspaceFileTool,
    runPythonTool,
    checkMineruStatusTool,
    runMineruPipelineTool,
    analyzeBookStructureTool,
    prepareChapterChunksTool,
    dispatchSubagentsTool,
    mergeChapterPartsTool,
    auditBookCoverageTool,
    packAbpTool,
    verifyAbpTool,
    importAbpTool,
  ];
}
