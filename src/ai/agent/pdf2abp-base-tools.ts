import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { listPdf2AbpSkills, readPdf2AbpSkill } from '../skills/pdf2abp/index.ts';
import {
  cropPdfRegion,
  inspectPdf,
  renderContactSheet,
  renderPdfPages,
  type JobWorkspace,
  type PdfInspectResult,
} from '../../services/pdf2abp/index.ts';
import {
  validateBookDirectory,
  type MdxValidationReport,
} from '../../publishing/abp/index.ts';
import type { AgentToolDefinition, AgentVisionAttachment } from './harness-runner.ts';

function readImageAsAttachment(
  absPath: string,
  relPath: string,
  label: string,
  detail: 'low' | 'high' | 'auto' = 'high'
): { attachment: AgentVisionAttachment; sizeBytes: number; mimeType: string } {
  if (!fs.existsSync(absPath)) {
    throw new Error(`图像文件不存在: ${relPath}`);
  }
  const ext = path.extname(absPath).toLowerCase();
  let mimeType = 'image/jpeg';
  if (ext === '.png') mimeType = 'image/png';
  else if (ext === '.webp') mimeType = 'image/webp';
  else if (ext === '.gif') mimeType = 'image/gif';

  const buf = fs.readFileSync(absPath);
  const b64 = buf.toString('base64');
  return {
    attachment: {
      base64DataUrl: `data:${mimeType};base64,${b64}`,
      label,
      relPath,
      detail,
    },
    sizeBytes: buf.byteLength,
    mimeType,
  };
}

export interface CreateBaseToolsOptions {
  workspace: JobWorkspace;

  includeOverviewTools?: boolean;
  onPdfInspected?: (info: PdfInspectResult) => void;
  onValidated?: (targetRel: string, report: MdxValidationReport) => void;
}

export function createBasePdf2AbpTools(
  options: CreateBaseToolsOptions
): AgentToolDefinition<any>[] {
  const { workspace, includeOverviewTools = true } = options;

  const listSkillsTool: AgentToolDefinition<any> = {
    name: 'list_skills',
    description:
      '列出系统内置的所有 PDF2ABP 规范文档与实战 Skill 摘要（含 ABP 格式契约、学术排版防线、主从编排 SOP、Python 常见脚本配方）。',
    parameters: z.object({}),
    execute: async () => {
      const skills = listPdf2AbpSkills();
      return {
        text: JSON.stringify({ skills }, null, 2),
        summary: `Listed ${skills.length} built-in skills`,
      };
    },
  };

  const readSkillTool: AgentToolDefinition<any> = {
    name: 'read_skill',
    description:
      '按 skillId（以及可选 sectionId）读取完整规范文档内容，是掌握 ABP 功能与排版规则的权威依据。',
    parameters: z.object({
      skillId: z
        .string()
        .describe(
          'Skill ID，例如 "abp-spec"、"academic-typesetting-rules"、"pdf2abp-orchestrator-sop"、"subagent-proofreader-protocol"、"mineru-pitfalls-and-python-recipes"'
        ),
      sectionId: z
        .string()
        .optional()
        .describe('可选：仅读取指定章节 sectionId 以节省上下文'),
    }),
    execute: async (args: { skillId: string; sectionId?: string }) => {
      try {
        const doc = readPdf2AbpSkill(args.skillId, args.sectionId);
        return {
          text: doc.content,
          summary: `Read skill ${args.skillId}${args.sectionId ? `#${args.sectionId}` : ''}`,
        };
      } catch (err) {
        return {
          isError: true,
          text: JSON.stringify({
            error: err instanceof Error ? err.message : String(err),
            availableSkillIds: listPdf2AbpSkills().map((s) => s.id),
          }),
          summary: `Skill not found: ${args.skillId}`,
        };
      }
    },
  };

  const listWorkspaceFilesTool: AgentToolDefinition<any> = {
    name: 'list_workspace_files',
    description:
      '列出当前任务沙箱工作区内的目录与文件（工作区外路径不可访问）。',
    parameters: z.object({
      relDir: z
        .string()
        .optional()
        .describe('工作区相对目录，例如 ""、"mineru"、"chunks"、"book"、"pages"'),
      maxDepth: z
        .number()
        .int()
        .min(1)
        .max(6)
        .optional()
        .describe('递归最大深度，默认 3'),
    }),
    execute: async (args: { relDir?: string; maxDepth?: number }) => {
      const entries = workspace.listFiles(args.relDir ?? '', args.maxDepth ?? 3);
      return {
        text: JSON.stringify(
          {
            relDir: args.relDir ?? '',
            count: entries.length,
            entries: entries.slice(0, 300),
            truncated: entries.length > 300,
          },
          null,
          2
        ),
        summary: `Listed ${entries.length} entries in ${args.relDir || '/'}`,
      };
    },
  };

  const readWorkspaceFileTool: AgentToolDefinition<any> = {
    name: 'read_workspace_file',
    description:
      '按行分页读取工作区内文本/JSON/MDX/Markdown 文件内容。注意：读取大文件（如 mineru/stitched/full.md）必须传入 startLine/endLine，避免挤爆上下文。',
    parameters: z.object({
      relPath: z.string().describe('工作区相对文件路径，例如 "mineru/mineru-summary.json" 或 "chunks/c1/draft.md"'),
      startLine: z.number().int().min(1).optional().describe('起始行号（从 1 开始）'),
      endLine: z.number().int().min(1).optional().describe('结束行号（含）'),
      maxChars: z.number().int().min(500).max(40000).optional().describe('最大返回字符数，默认 18000'),
    }),
    execute: async (args: {
      relPath: string;
      startLine?: number;
      endLine?: number;
      maxChars?: number;
    }) => {
      const res = workspace.readFile(args.relPath, {
        startLine: args.startLine,
        endLine: args.endLine,
        maxChars: args.maxChars ?? 18000,
      });
      return {
        text: JSON.stringify(res, null, 2),
        summary: `Read ${args.relPath} (lines ${args.startLine ?? 1}..${args.endLine ?? res.totalLines}/${res.totalLines})`,
      };
    },
  };

  const writeWorkspaceFileTool: AgentToolDefinition<any> = {
    name: 'write_workspace_file',
    description:
      '在当前任务工作区内原子创建或覆盖文件（如写入 book-plan.json、book/book.json、book/*.mdx 或 scripts/*.py）。',
    parameters: z.object({
      relPath: z.string().describe('工作区相对文件路径，例如 "book/01_引言.mdx" 或 "book/book.json"'),
      content: z.string().describe('完整文件内容'),
    }),
    execute: async (args: { relPath: string; content: string }) => {
      const written = workspace.writeFile(args.relPath, args.content);
      return {
        text: JSON.stringify(
          {
            ok: true,
            relPath: written.relPath,
            bytesWritten: written.bytesWritten,
          },
          null,
          2
        ),
        summary: `Wrote ${written.relPath} (${written.bytesWritten} bytes)`,
        artifactPath: written.relPath,
      };
    },
  };

  const editWorkspaceFileTool: AgentToolDefinition<any> = {
    name: 'edit_workspace_file',
    description:
      '精确替换工作区内现有文件中的目标文本块（用于微调修复 MDX、book.json 或计划文件）。',
    parameters: z.object({
      relPath: z.string().describe('工作区相对文件路径'),
      target: z.string().describe('待替换的原文本（必须精确匹配）'),
      replacement: z.string().describe('替换后的新文本'),
      replaceAll: z.boolean().optional().describe('是否替换全部匹配项，默认 false'),
    }),
    execute: async (args: {
      relPath: string;
      target: string;
      replacement: string;
      replaceAll?: boolean;
    }) => {
      const edited = workspace.editFile(
        args.relPath,
        args.target,
        args.replacement,
        args.replaceAll ?? false
      );
      return {
        text: JSON.stringify({ ok: true, ...edited }, null, 2),
        summary: `Edited ${edited.relPath} (${edited.replacements} replacement(s))`,
        artifactPath: edited.relPath,
      };
    },
  };

  const pageViewCounts = new Map<string, Map<number, number>>();
  const imageViewCounts = new Map<string, Map<string, number>>();

  const recordPageViews = (agentId: string, pageNums: number[]) => {
    let map = pageViewCounts.get(agentId);
    if (!map) {
      map = new Map<number, number>();
      pageViewCounts.set(agentId, map);
    }
    const repeated: Array<{ page: number; count: number }> = [];
    for (const p of pageNums) {
      const next = (map.get(p) ?? 0) + 1;
      map.set(p, next);
      if (next >= 2) repeated.push({ page: p, count: next });
    }
    return repeated;
  };

  const inspectPdfPageTool: AgentToolDefinition<any> = {
    name: 'inspect_pdf_page',
    description:
      '渲染并立即在视觉槽中查看指定物理 PDF 页码（Ground Truth 原书页面）。\n' +
      '- 当查看 1 页或需要看清密密麻麻的小字/上下标公式时，传 1 个页码并用 mode="single" (dpi=165~220)；\n' +
      '- 当浏览连续页时，传 2~4 个页码并用 mode="two_up" / "contact_sheet"，在单一图像窗口内一次审阅多页以节省轮次。\n' +
      '- 重要：调用本工具切图前，若上一张视觉图有尚未写入文件的观察结论，请务必填写 notesForPreviousImage，防止图像被新图替换后遗忘。',
    parameters: z.object({
      pages: z
        .array(z.number().int().min(1))
        .min(1)
        .max(4)
        .describe('1-based 物理页码数组，1~4 页，例如 [5] 或 [5, 6]'),
      mode: z
        .enum(['single', 'two_up', 'contact_sheet'])
        .optional()
        .describe('渲染视图模式：1页用 single，2页用 two_up，3-4页用 contact_sheet'),
      dpi: z
        .number()
        .int()
        .min(80)
        .max(260)
        .optional()
        .describe('渲染清晰度：single 默认 165，two_up/contact_sheet 默认 135'),
      detail: z.enum(['low', 'high', 'auto']).optional().describe('图像细节级别，默认 high'),
      notesForPreviousImage: z
        .string()
        .optional()
        .describe('在切换查看新页面前，记录上一张视觉图中观测到的关键文本、公式、插图名称或卡片结构要点'),
    }),
    execute: async (
      args: {
        pages: number[];
        mode?: 'single' | 'two_up' | 'contact_sheet';
        dpi?: number;
        detail?: 'low' | 'high' | 'auto';
        notesForPreviousImage?: string;
      },
      ctx
    ) => {
      const pages = Array.from(new Set(args.pages)).slice(0, 4);
      const effectiveMode =
        args.mode ?? (pages.length === 1 ? 'single' : pages.length <= 2 ? 'two_up' : 'contact_sheet');
      const repeatedViews = recordPageViews(ctx?.agentId || 'default', pages);
      const repeatViewWarning =
        repeatedViews.length > 0
          ? `注意：你已查看过同一页多次 (${repeatedViews.map((r) => `p${r.page}x${r.count}`).join(', ')})。视觉槽每次仅保留最新一张图，切勿反复翻看同页；请先将本页关键信息写入文本或 notesForPreviousImage！`
          : undefined;
      const recordedNotes = args.notesForPreviousImage?.trim() || undefined;

      if (effectiveMode === 'single' || pages.length === 1) {
        const dpi = args.dpi ?? 165;
        const rendered = await renderPdfPages(
          workspace.sourcePdfPath,
          [pages[0]],
          workspace.pagesDir,
          { dpi, quality: 86, workspaceRoot: workspace.rootDir }
        );
        const info = rendered[0];
        const img = readImageAsAttachment(
          info.filePath,
          info.relPath,
          `PDF Page ${info.page} (${info.dpi} DPI)`,
          args.detail ?? 'high'
        );
        return {
          text: JSON.stringify(
            {
              mode: 'single',
              page: info.page,
              relPath: info.relPath,
              width: info.width,
              height: info.height,
              dpi: info.dpi,
              sizeBytes: img.sizeBytes,
              ...(recordedNotes ? { recordedNotes } : {}),
              ...(repeatViewWarning ? { repeatViewWarning } : {}),
            },
            null,
            2
          ),
          summary: `Viewed PDF page ${info.page} (${info.width}x${info.height})${repeatedViews.length > 0 ? ' [repeat]' : ''}`,
          visionAttachment: img.attachment,
        };
      }

      const dpi = args.dpi ?? (pages.length <= 2 ? 135 : 105);
      const sheet = await renderContactSheet(
        workspace.sourcePdfPath,
        pages,
        workspace.pagesDir,
        {
          cols: 2,
          rows: pages.length <= 2 ? 1 : 2,
          dpi,
          quality: 84,
          workspaceRoot: workspace.rootDir,
          labelPrefix: 'Page',
        }
      );
      const img = readImageAsAttachment(
        sheet.filePath,
        sheet.relPath,
        `PDF Pages [${sheet.pages.join(', ')}] (${sheet.cols}x${sheet.rows}, ${sheet.dpi} DPI)`,
        args.detail ?? 'high'
      );
      return {
        text: JSON.stringify(
          {
            mode: effectiveMode,
            pages: sheet.pages,
            relPath: sheet.relPath,
            cols: sheet.cols,
            rows: sheet.rows,
            width: sheet.width,
            height: sheet.height,
            dpi: sheet.dpi,
            sizeBytes: img.sizeBytes,
            ...(recordedNotes ? { recordedNotes } : {}),
            ...(repeatViewWarning ? { repeatViewWarning } : {}),
          },
          null,
          2
        ),
        summary: `Viewed ${sheet.pages.length}-up sheet for pages [${sheet.pages.join(', ')}]${repeatedViews.length > 0 ? ' [repeat]' : ''}`,
        visionAttachment: img.attachment,
      };
    },
  };

  const inspectImageTool: AgentToolDefinition<any> = {
    name: 'inspect_image',
    description:
      '将工作区内任意已有图像（如 render_contact_sheet 拼图、MinerU 切出的插图、裁剪封面等）载入视觉槽进行观察。注意同一轮最多保留 1 张图，请在 notesForPreviousImage 中记录上一张图的结论。',
    parameters: z.object({
      relPath: z.string().describe('工作区相对图像路径，例如 "pages/sheet_p1-4.jpg" 或 "book/images/cover.jpg"'),
      detail: z.enum(['low', 'high', 'auto']).optional().describe('默认 high'),
      notesForPreviousImage: z
        .string()
        .optional()
        .describe('在加载新图前，记录上一张视觉图中观测到的要点以防止视觉槽替换后失忆'),
    }),
    execute: async (
      args: { relPath: string; detail?: 'low' | 'high' | 'auto'; notesForPreviousImage?: string },
      ctx
    ) => {
      const agentId = ctx?.agentId || 'default';
      let imgMap = imageViewCounts.get(agentId);
      if (!imgMap) {
        imgMap = new Map<string, number>();
        imageViewCounts.set(agentId, imgMap);
      }
      const nextCount = (imgMap.get(args.relPath) ?? 0) + 1;
      imgMap.set(args.relPath, nextCount);
      const repeatViewWarning =
        nextCount >= 2
          ? `注意：你已查看图像 "${args.relPath}" 共 ${nextCount} 次，请避免反复重看同一文件。`
          : undefined;
      const recordedNotes = args.notesForPreviousImage?.trim() || undefined;

      const absPath = workspace.resolveWorkspacePath(args.relPath);
      const img = readImageAsAttachment(
        absPath,
        args.relPath,
        `Image ${args.relPath}`,
        args.detail ?? 'high'
      );
      return {
        text: JSON.stringify(
          {
            relPath: args.relPath,
            mimeType: img.mimeType,
            sizeBytes: img.sizeBytes,
            ...(recordedNotes ? { recordedNotes } : {}),
            ...(repeatViewWarning ? { repeatViewWarning } : {}),
          },
          null,
          2
        ),
        summary: `Loaded image ${args.relPath} (${Math.round(img.sizeBytes / 1024)} KB)`,
        visionAttachment: img.attachment,
      };
    },
  };

  const cropPdfRegionTool: AgentToolDefinition<any> = {
    name: 'crop_pdf_region',
    description:
      '按归一化 1000 分制坐标 [x0, y0, x1, y1] 从原始高清 PDF 精准裁剪出图像并保存到工作区（常用于提取封面 book/images/cover.jpg 或补救 MinerU 漏切的几何图/示意图）。',
    parameters: z.object({
      page: z.number().int().min(1).describe('1-based 物理页码'),
      bboxNorm1000: z
        .array(z.number().min(0).max(1000))
        .length(4)
        .optional()
        .describe('归一化千分比区域 [x0, y0, x1, y1]，默认全页 [0, 0, 1000, 1000]'),
      outRelPath: z
        .string()
        .describe('输出相对路径，建议放在 book/images/ 下，例如 "book/images/cover.jpg"'),
      dpi: z.number().int().min(96).max(320).optional().describe('默认 220'),
      quality: z.number().int().min(60).max(98).optional().describe('JPEG 质量，默认 90'),
      preview: z.boolean().optional().describe('是否紧接着把裁剪结果载入视觉槽自检，默认 false'),
    }),
    execute: async (args: {
      page: number;
      bboxNorm1000?: number[];
      outRelPath: string;
      dpi?: number;
      quality?: number;
      preview?: boolean;
    }) => {
      const absOut = workspace.resolveWorkspacePath(args.outRelPath);
      const bbox: [number, number, number, number] =
        args.bboxNorm1000 && args.bboxNorm1000.length === 4
          ? [
              args.bboxNorm1000[0],
              args.bboxNorm1000[1],
              args.bboxNorm1000[2],
              args.bboxNorm1000[3],
            ]
          : [0, 0, 1000, 1000];

      const res = await cropPdfRegion(workspace.sourcePdfPath, args.page, bbox, absOut, {
        dpi: args.dpi ?? 220,
        quality: args.quality ?? 90,
      });

      const visionAttachment = args.preview
        ? readImageAsAttachment(
            absOut,
            args.outRelPath,
            `Cropped ${args.outRelPath} from p.${args.page}`,
            'high'
          ).attachment
        : undefined;

      return {
        text: JSON.stringify(
          {
            ok: true,
            page: args.page,
            bboxNorm1000: bbox,
            outRelPath: args.outRelPath,
            width: res.width,
            height: res.height,
            sizeBytes: res.sizeBytes,
          },
          null,
          2
        ),
        summary: `Cropped p.${args.page} -> ${args.outRelPath} (${res.width}x${res.height})`,
        artifactPath: args.outRelPath,
        visionAttachment,
      };
    },
  };

  const validateMdxTool: AgentToolDefinition<any> = {
    name: 'validate_mdx',
    description:
      '调用无头真实 Astro/MDX/KaTeX 编译器与五大学术防线质检指定 .mdx 文件或整个目录（例如 "book" 或 "book/01_xxx.mdx"）。返回精确报错行号与分类。',
    parameters: z.object({
      targetPath: z
        .string()
        .optional()
        .describe('工作区相对文件或目录路径，默认 "book"'),
      skipMath: z.boolean().optional().describe('是否跳过 KaTeX 渲染验证，默认 false'),
      skipMdxCompile: z.boolean().optional().describe('是否跳过 MDX JSX 编译验证，默认 false'),
    }),
    execute: async (args: {
      targetPath?: string;
      skipMath?: boolean;
      skipMdxCompile?: boolean;
    }) => {
      const targetRel = args.targetPath ?? 'book';
      const absTarget = workspace.resolveWorkspacePath(targetRel);
      const report = await validateBookDirectory(absTarget, {
        assetBaseDir: workspace.bookDir,
        skipMath: args.skipMath ?? false,
        skipMdxCompile: args.skipMdxCompile ?? false,
      });
      options.onValidated?.(targetRel, report);
      const compactReport = {
        ...report,
        errors: report.errors.slice(0, 30),
        warnings: report.warnings.slice(0, 20),
        errorsTruncated: report.errors.length > 30,
      };
      return {
        text: JSON.stringify(compactReport, null, 2),
        summary: `MDX QA (${targetRel}): passed=${report.passed}, errors=${report.errorCount}, warnings=${report.warningCount}`,
        data: {
          passed: report.passed,
          errorCount: report.errorCount,
          warningCount: report.warningCount,
        },
      };
    },
  };

  const tools: AgentToolDefinition<any>[] = [
    listSkillsTool,
    readSkillTool,
    listWorkspaceFilesTool,
    readWorkspaceFileTool,
    writeWorkspaceFileTool,
    editWorkspaceFileTool,
    inspectPdfPageTool,
    inspectImageTool,
    cropPdfRegionTool,
    validateMdxTool,
  ];

  if (includeOverviewTools) {
    const inspectPdfTool: AgentToolDefinition<any> = {
      name: 'inspect_pdf',
      description:
        '使用内置 MuPDF 引擎检测源 PDF 的总页数、文件体积、尺寸采样、内置书签大纲（outline）以及是否属于纯扫描件。',
      parameters: z.object({}),
      execute: async () => {
        const info = await inspectPdf(workspace.sourcePdfPath);
        workspace.writeFile('pdf-inspect.json', JSON.stringify(info, null, 2));
        options.onPdfInspected?.(info);
        return {
          text: JSON.stringify(info, null, 2),
          summary: `Inspected PDF: ${info.pageCount} pages, outline=${info.outline.length}, scanned=${info.likelyScanned}`,
          artifactPath: 'pdf-inspect.json',
          data: {
            pageCount: info.pageCount,
            fileSizeBytes: info.fileSizeBytes,
            outlineCount: info.outline.length,
          },
        };
      },
    };

    const renderPdfPagesTool: AgentToolDefinition<any> = {
      name: 'render_pdf_pages',
      description:
        '批量将指定物理 PDF 页渲染为高 DPI JPEG 图像落盘到 pages/ 目录（不占用当前上下文视觉槽，适合配合或预生成全书/指定区间高清晰度图集）。',
      parameters: z.object({
        pages: z
          .array(z.number().int().min(1))
          .min(1)
          .max(60)
          .describe('待渲染的 1-based 物理页码列表（单次最多 60 页；若全书较多可分批或由子代理按需渲染）'),
        dpi: z.number().int().min(72).max(260).optional().describe('默认 150 DPI'),
        quality: z.number().int().min(50).max(96).optional().describe('JPEG 质量，默认 85'),
      }),
      execute: async (args: { pages: number[]; dpi?: number; quality?: number }) => {
        const rendered = await renderPdfPages(
          workspace.sourcePdfPath,
          args.pages,
          workspace.pagesDir,
          {
            dpi: args.dpi ?? 150,
            quality: args.quality ?? 85,
            workspaceRoot: workspace.rootDir,
          }
        );
        return {
          text: JSON.stringify(
            {
              count: rendered.length,
              pagesDir: 'pages',
              files: rendered.map((r) => ({
                page: r.page,
                relPath: r.relPath,
                width: r.width,
                height: r.height,
                sizeBytes: r.sizeBytes,
              })),
            },
            null,
            2
          ),
          summary: `Rendered ${rendered.length} PDF page(s) at ${args.dpi ?? 150} DPI`,
        };
      },
    };

    const renderContactSheetTool: AgentToolDefinition<any> = {
      name: 'render_contact_sheet',
      description:
        '将多页 PDF（推荐 4 页 2x2 或 2 页 2x1）拼合成一张带清晰大字页码标签的总览缩略图，便于在单图网关限制下快速批量总览版面与目录。生成后可用 inspect_image 查看，或设 attachVision=true 直接查看。',
      parameters: z.object({
        pages: z.array(z.number().int().min(1)).min(1).max(9).describe('待拼合页码数组，例如 [1, 2, 3, 4]'),
        cols: z.number().int().min(1).max(3).optional().describe('列数，默认 2'),
        rows: z.number().int().min(1).max(3).optional().describe('行数，默认按页数自动推导'),
        dpi: z.number().int().min(72).max(160).optional().describe('默认 95 DPI（2x2 拼图既清晰又紧凑）'),
        attachVision: z.boolean().optional().describe('是否在生成后直接将此拼图放入视觉槽查看，默认 false'),
      }),
      execute: async (args: {
        pages: number[];
        cols?: number;
        rows?: number;
        dpi?: number;
        attachVision?: boolean;
      }) => {
        const cols = args.cols ?? 2;
        const rows = args.rows ?? Math.ceil(args.pages.length / cols);
        const sheet = await renderContactSheet(
          workspace.sourcePdfPath,
          args.pages,
          workspace.pagesDir,
          {
            cols,
            rows,
            dpi: args.dpi ?? 95,
            quality: 82,
            workspaceRoot: workspace.rootDir,
            labelPrefix: 'Page',
          }
        );
        const visionAttachment = args.attachVision
          ? readImageAsAttachment(
              sheet.filePath,
              sheet.relPath,
              `Contact sheet pages [${sheet.pages.join(', ')}]`,
              'high'
            ).attachment
          : undefined;

        return {
          text: JSON.stringify(
            {
              relPath: sheet.relPath,
              pages: sheet.pages,
              cols: sheet.cols,
              rows: sheet.rows,
              width: sheet.width,
              height: sheet.height,
              dpi: sheet.dpi,
              sizeBytes: sheet.sizeBytes,
            },
            null,
            2
          ),
          summary: `Generated contact sheet ${sheet.relPath} for pages [${sheet.pages.join(', ')}]`,
          artifactPath: sheet.relPath,
          visionAttachment,
        };
      },
    };

    tools.push(inspectPdfTool, renderPdfPagesTool, renderContactSheetTool);
  }

  return tools;
}
