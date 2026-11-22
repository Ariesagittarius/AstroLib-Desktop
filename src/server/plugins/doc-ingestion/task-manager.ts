/**
 * src/server/plugins/doc-ingestion/task-manager.ts
 * ============================================================================
 * AstroLib 文档摄取与解析任务生命周期管理器
 * ============================================================================
 * 职责：
 * 1. 任务创建与状态机持久化 (task/ingest/<taskId>/meta.json)；
 * 2. 调度 MineruApiClient (云端 API) 与 LocalPipelineRunner (本地 5060)；
 * 3. 产物解包与结构提取 (full.md, images/, layout.json)；
 * 4. 章节切分与一键入库至站点书籍合集。
 * ============================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import { MineruApiClient } from './mineru-api-client.ts';
import { LocalPipelineRunner } from './local-runner.ts';
import { compileIngestAST, synthesizeStructuredMarkdown } from './ast-compiler.ts';
import { isIngestRunningState } from '../../../features/library/core/entity-status.ts';
import type {
  IngestEngineType,
  IngestTaskMeta,
  LayoutBlock,
  ParseResultResponse,
  TaskStatus,
} from './types.ts';

export class TaskManager {
  private static instance: TaskManager | null = null;
  private readonly baseDir: string;
  private mineruClient: MineruApiClient;
  private localRunner: LocalPipelineRunner;
  private activeJobs = new Map<string, Promise<void>>();

  private constructor() {
    this.baseDir = process.env.ASTROLIB_INGEST_DIR
      ? path.resolve(process.env.ASTROLIB_INGEST_DIR)
      : path.resolve(process.cwd(), 'task/ingest');
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
    this.mineruClient = new MineruApiClient();
    this.localRunner = new LocalPipelineRunner();
  }

  public static getInstance(): TaskManager {
    if (!TaskManager.instance) {
      TaskManager.instance = new TaskManager();
    }
    return TaskManager.instance;
  }

  public getBaseDir(): string {
    return this.baseDir;
  }

  /**
   * 获取所有可能存放摄取任务的候选目录列表 (用户目录优先，回退工作区目录)
   */
  public getCandidateDirs(): string[] {
    const dirs: string[] = [];
    if (this.baseDir && !dirs.includes(this.baseDir)) {
      dirs.push(this.baseDir);
    }
    if (process.env.ASTROLIB_INGEST_DIR) {
      const envDir = path.resolve(process.env.ASTROLIB_INGEST_DIR);
      if (!dirs.includes(envDir)) dirs.push(envDir);
    }
    try {
      const appData = process.env.APPDATA;
      if (appData) {
        const userTasksDir = path.resolve(appData, 'AstroLib', 'ingest-tasks');
        if (!dirs.includes(userTasksDir)) dirs.push(userTasksDir);
      }
    } catch {}
    const cwdTaskDir = path.resolve(process.cwd(), 'task/ingest');
    if (!dirs.includes(cwdTaskDir)) dirs.push(cwdTaskDir);
    try {
      const exeDir = path.dirname(process.execPath);
      const relDevTaskDir = path.resolve(exeDir, '../../task/ingest');
      if (!dirs.includes(relDevTaskDir)) dirs.push(relDevTaskDir);
    } catch {}

    return dirs.filter((d) => fs.existsSync(d));
  }

  /**
   * 定位某个任务所在的真实物理目录
   */
  public findTaskDir(taskId: string): string | null {
    if (!taskId || taskId.includes('..')) return null;
    const candidateDirs = this.getCandidateDirs();
    for (const base of candidateDirs) {
      const candidate = path.join(base, taskId);
      const metaFile = path.join(candidate, 'meta.json');
      if (fs.existsSync(metaFile)) {
        return candidate;
      }
    }
    return null;
  }

  /**
   * 获取任务对应原始 PDF 的真实路径
   */
  public getOriginPdfPath(taskId: string): string | null {
    const dir = this.findTaskDir(taskId) || path.join(this.baseDir, taskId);
    const pdf = path.join(dir, 'origin.pdf');
    return fs.existsSync(pdf) ? pdf : null;
  }

  /**
   * 获取任务对应解包产物 unpacked 目录的真实路径
   */
  public getUnpackedDir(taskId: string): string | null {
    const dir = this.findTaskDir(taskId) || path.join(this.baseDir, taskId);
    const unpacked = path.join(dir, 'unpacked');
    return fs.existsSync(unpacked) ? unpacked : null;
  }

  public getApiClient(): MineruApiClient {
    return this.mineruClient;
  }

  public getLocalRunner(): LocalPipelineRunner {
    return this.localRunner;
  }

  /**
   * 快速计算 PDF 真实页数 (无需重量级依赖)
   * 优化策略：
   * 1. 严格在单个 PDF 字典 `<< ... >>` 内部定位 `/Type /Pages` 与对应的 `/Count`
   * 2. 统计所有独立叶子页对象 `/Type /Page\b` (排除 `/Pages`)
   * 3. 统计全局最大的合法 `/Count` (排除书签大纲较小计数值)
   */
  public countPdfPages(buffer: Buffer): number {
    const raw = buffer.toString('latin1');

    // 方案 1: 在同一个字典 << ... >> 内部查找 /Type /Pages 和 /Count
    const dictRegex = /<<([^>]+)>>/g;
    let maxPagesCount = 0;
    let match: RegExpExecArray | null;
    while ((match = dictRegex.exec(raw)) !== null) {
      const dictContent = match[1];
      if (/\/Type\s*\/Pages\b/.test(dictContent)) {
        const countM = dictContent.match(/\/Count\s+(\d+)/);
        if (countM) {
          const c = parseInt(countM[1], 10);
          if (c > maxPagesCount) maxPagesCount = c;
        }
      }
    }
    if (maxPagesCount > 0) return maxPagesCount;

    // 方案 2: 统计所有叶子页节点 /Type /Page\b (排除 /Pages)
    const pageMatches = raw.match(/\/Type\s*\/Page\b/g);
    if (pageMatches && pageMatches.length > 0) {
      return pageMatches.length;
    }

    // 方案 3: 全局最大的 /Count
    const allCounts = [...raw.matchAll(/\/Count\s+(\d+)/g)].map((m) => parseInt(m[1], 10)).filter((n) => !isNaN(n));
    if (allCounts.length > 0) {
      return Math.max(...allCounts);
    }
    return 1;
  }

  /**
   * 1. 创建新摄取任务并保存原始 PDF
   */
  public async createTask(
    fileName: string,
    fileBuffer: Buffer,
    options: { engine?: IngestEngineType; pageRanges?: string } = {}
  ): Promise<IngestTaskMeta> {
    const sanitizedName = path.basename(fileName).replace(/[^a-zA-Z0-9_\u4e00-\u9fa5\.\-\s]/g, '_');
    const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const taskDir = path.join(this.baseDir, taskId);
    fs.mkdirSync(taskDir, { recursive: true });

    const pdfPath = path.join(taskDir, 'origin.pdf');
    fs.writeFileSync(pdfPath, fileBuffer);

    const pageCount = this.countPdfPages(fileBuffer);
    const engine: IngestEngineType = options.engine || 'api';

    const meta: IngestTaskMeta = {
      taskId,
      fileName: sanitizedName,
      fileSize: fileBuffer.length,
      pageCount,
      pageRanges: options.pageRanges?.trim() || undefined,
      engine,
      status: 'idle',
      progress: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      outputDir: taskDir,
      hasImages: false,
      imageCount: 0,
    };

    this.saveTaskMeta(meta);
    return meta;
  }

  public isJobActive(taskId: string): boolean {
    return this.activeJobs.has(taskId);
  }

  /**
   * 2. 启动或重新启动异步解析工作流
   */
  public startParse(
    taskId: string,
    engine?: IngestEngineType,
    options?: { token?: string; pageRanges?: string }
  ): IngestTaskMeta {
    const meta = this.getTask(taskId);
    if (!meta) {
      throw new Error(`找不到任务 ${taskId}`);
    }

    if (engine) {
      meta.engine = engine;
    }

    if (options && options.pageRanges !== undefined) {
      meta.pageRanges = options.pageRanges.trim() || undefined;
    }

    if (options?.token) {
      this.mineruClient.persistToken(options.token);
    }

    if (this.activeJobs.has(taskId)) {
      return meta;
    }

    meta.status = 'uploading';
    meta.progress = 5;
    meta.error = undefined;
    meta.updatedAt = Date.now();
    this.saveTaskMeta(meta);

    const jobPromise = (async () => {
      try {
        if (meta.engine === 'api') {
          await this.executeApiParse(meta);
        } else if (meta.engine === 'agent') {
          await this.executeAgentParse(meta);
        } else {
          await this.executeLocalParse(meta);
        }
      } catch (err) {
        meta.status = 'failed';
        meta.error = err instanceof Error ? err.message : String(err);
        meta.updatedAt = Date.now();
        this.saveTaskMeta(meta);
      } finally {
        this.activeJobs.delete(taskId);
      }
    })();

    this.activeJobs.set(taskId, jobPromise);
    return meta;
  }

  /**
   * 若任务处于运行态但后台已无活跃作业（进程重启遗留僵尸任务），将其收敛为失败中断态
   */
  public reconcileStaleTask(taskId: string): IngestTaskMeta | null {
    const meta = this.getTask(taskId);
    if (!meta) return null;
    if (isIngestRunningState(meta.status) && !this.activeJobs.has(taskId)) {
      meta.status = 'failed';
      meta.error = '上次解析已中断，可点击重新解析';
      meta.updatedAt = Date.now();
      this.saveTaskMeta(meta);
    }
    return meta;
  }

  /**
   * 移除尚未运行中的任务物理目录
   */
  public deleteTask(taskId: string): boolean {
    if (!taskId || taskId.includes('..')) return false;
    if (this.activeJobs.has(taskId)) {
      throw new Error('该文献正在解析中，暂无法删除');
    }
    const taskDir = this.findTaskDir(taskId);
    if (!taskDir || !fs.existsSync(taskDir)) {
      return false;
    }
    fs.rmSync(taskDir, { recursive: true, force: true });
    return true;
  }

  /**
   * 执行云端 API 解析流
   */
  private async executeApiParse(meta: IngestTaskMeta): Promise<void> {
    const taskDir = meta.outputDir;
    const pdfPath = path.join(taskDir, 'origin.pdf');
    const unpackedDir = path.join(taskDir, 'unpacked');

    // 1. 申请上传预签名 URL
    meta.status = 'uploading';
    meta.progress = 10;
    this.saveTaskMeta(meta);

    const { batchId, fileUrl } = await this.mineruClient.requestBatchUploadUrls(
      meta.fileName,
      meta.taskId,
      {
        modelVersion: 'vlm',
        pageRanges: meta.pageRanges,
      }
    );

    meta.batchId = batchId;
    meta.status = 'waiting-file';
    meta.progress = 20;
    this.saveTaskMeta(meta);

    // 2. 上传文件到预签名 URL
    await this.mineruClient.uploadFileToPreSignedUrl(fileUrl, pdfPath);

    meta.status = 'processing';
    meta.progress = 30;
    this.saveTaskMeta(meta);

    // 3. 轮询云端状态
    const { fullZipUrl } = await this.mineruClient.pollBatchStatus(batchId, {
      intervalMs: 2500,
      onProgress: (state) => {
        if (state === 'pending') {
          meta.status = 'pending';
          meta.progress = 40;
        } else if (state === 'processing') {
          meta.status = 'processing';
          meta.progress = Math.min(85, (meta.progress || 40) + 5);
        }
        meta.updatedAt = Date.now();
        this.saveTaskMeta(meta);
      },
    });

    meta.fullZipUrl = fullZipUrl;
    meta.status = 'downloading';
    meta.progress = 88;
    this.saveTaskMeta(meta);

    // 4. 下载并解压结果 ZIP
    await this.mineruClient.downloadAndExtractZip(fullZipUrl, unpackedDir);

    meta.status = 'unpacking';
    meta.progress = 95;
    this.saveTaskMeta(meta);

    // 5. 校验与整理成果
    this.finalizeUnpackedArtifacts(meta, unpackedDir);

    meta.status = 'completed';
    meta.progress = 100;
    meta.error = undefined;
    meta.completedAt = Date.now();
    meta.updatedAt = Date.now();
    this.saveTaskMeta(meta);
  }

  /**
   * 执行 Agent 免密轻量解析流
   */
  private async executeAgentParse(meta: IngestTaskMeta): Promise<void> {
    const taskDir = meta.outputDir;
    const pdfPath = path.join(taskDir, 'origin.pdf');
    const unpackedDir = path.join(taskDir, 'unpacked');

    meta.status = 'processing';
    meta.progress = 20;
    this.saveTaskMeta(meta);

    const { markdown } = await this.mineruClient.parseWithAgentApi(pdfPath, {
      onProgress: (msg: string) => {
        meta.progress = Math.min(85, (meta.progress || 20) + 15);
        meta.updatedAt = Date.now();
        this.saveTaskMeta(meta);
      },
    });

    if (!fs.existsSync(unpackedDir)) {
      fs.mkdirSync(unpackedDir, { recursive: true });
    }

    const mdPath = path.join(unpackedDir, 'full.md');
    fs.writeFileSync(mdPath, markdown, 'utf-8');

    meta.status = 'completed';
    meta.progress = 100;
    meta.error = undefined;
    meta.completedAt = Date.now();
    meta.updatedAt = Date.now();
    this.saveTaskMeta(meta);
  }

  /**
   * 执行本地 5060 Pipeline 解析流
   */
  private async executeLocalParse(meta: IngestTaskMeta): Promise<void> {
    const taskDir = meta.outputDir;
    const pdfPath = path.join(taskDir, 'origin.pdf');
    const unpackedDir = path.join(taskDir, 'unpacked');

    meta.status = 'processing';
    meta.progress = 25;
    this.saveTaskMeta(meta);

    await this.localRunner.runPipeline(pdfPath, unpackedDir, (msg) => {
      meta.progress = Math.min(90, (meta.progress || 25) + 10);
      meta.updatedAt = Date.now();
      this.saveTaskMeta(meta);
    });

    this.finalizeUnpackedArtifacts(meta, unpackedDir);

    meta.status = 'completed';
    meta.progress = 100;
    meta.error = undefined;
    meta.completedAt = Date.now();
    meta.updatedAt = Date.now();
    this.saveTaskMeta(meta);
  }

  /**
   * 整理已解包目录中的 Markdown、图片与坐标元数据
   */
  private finalizeUnpackedArtifacts(meta: IngestTaskMeta, unpackedDir: string): void {
    // 递归寻找包含 full.md 或 *.md 的目录
    const findMdFile = (dir: string): string | null => {
      if (!fs.existsSync(dir)) return null;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const ent of entries) {
        const full = path.join(dir, ent.name);
        if (ent.isFile() && ent.name.toLowerCase() === 'full.md') {
          return full;
        }
      }
      for (const ent of entries) {
        const full = path.join(dir, ent.name);
        if (ent.isFile() && ent.name.endsWith('.md')) {
          return full;
        }
        if (ent.isDirectory()) {
          const res = findMdFile(full);
          if (res) return res;
        }
      }
      return null;
    };

    const targetMd = findMdFile(unpackedDir);
    if (targetMd) {
      const parentDir = path.dirname(targetMd);
      const imagesDir = path.join(parentDir, 'images');
      if (fs.existsSync(imagesDir)) {
        const imgs = fs.readdirSync(imagesDir);
        meta.hasImages = imgs.length > 0;
        meta.imageCount = imgs.length;
      }
    }
  }

  /**
   * 3. 读取任务元数据
   */
  public getTask(taskId: string): IngestTaskMeta | null {
    const taskDir = this.findTaskDir(taskId);
    if (!taskDir) return null;
    const metaPath = path.join(taskDir, 'meta.json');
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as IngestTaskMeta;
      if (meta) {
        meta.outputDir = taskDir;
      }
      return meta;
    } catch {
      return null;
    }
  }

  /**
   * 3.1 获取所有历史摄取任务列表 (按创建时间降序，跨所有候选目录聚合)
   */
  public listTasks(): IngestTaskMeta[] {
    const taskMap = new Map<string, IngestTaskMeta>();
    const candidateDirs = this.getCandidateDirs();
    for (const base of candidateDirs) {
      try {
        const entries = fs.readdirSync(base, { withFileTypes: true });
        for (const ent of entries) {
          if (ent.isDirectory() && ent.name.startsWith('task_')) {
            if (taskMap.has(ent.name) && taskMap.get(ent.name)!.status === 'completed') {
              continue;
            }
            const meta = this.getTask(ent.name);
            if (meta) {
              taskMap.set(meta.taskId, meta);
            }
          }
        }
      } catch {}
    }
    return Array.from(taskMap.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  /**
   * 4. 读取解析成果（供双栏对照渲染与坐标映射）
   */
  public getResult(taskId: string): ParseResultResponse | null {
    const meta = this.getTask(taskId);
    if (!meta || meta.status !== 'completed') return null;

    const taskDir = this.findTaskDir(taskId) || path.join(this.baseDir, taskId);
    const unpackedDir = path.join(taskDir, 'unpacked');

    // 搜索 Markdown 文件
    let markdown = '';
    let targetDir = unpackedDir;
    let rawJson = '';

    const findArtifacts = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const ent of entries) {
        const p = path.join(dir, ent.name);
        if (ent.isFile() && ent.name.toLowerCase() === 'full.md' && !markdown) {
          markdown = fs.readFileSync(p, 'utf-8');
          targetDir = dir;
        }
        if (ent.isFile() && ent.name.includes('content_list') && ent.name.endsWith('.json') && !rawJson) {
          try {
            rawJson = fs.readFileSync(p, 'utf-8');
          } catch {}
        }
      }
      if (!markdown) {
        for (const ent of entries) {
          const p = path.join(dir, ent.name);
          if (ent.isFile() && ent.name.endsWith('.md') && !markdown) {
            markdown = fs.readFileSync(p, 'utf-8');
            targetDir = dir;
          } else if (ent.isDirectory()) {
            findArtifacts(p);
          }
        }
      }
    };

    findArtifacts(unpackedDir);

    // 搜索图片
    const images: string[] = [];
    const imagesDir = path.join(targetDir, 'images');
    if (fs.existsSync(imagesDir)) {
      const imgFiles = fs.readdirSync(imagesDir);
      for (const f of imgFiles) {
        if (/\.(png|jpe?g|webp|svg)$/i.test(f)) {
          images.push(f);
        }
      }
    }

    // 解析版面坐标 Blocks (高保真 AST 编译，含 KaTeX HTML、图片路径与 1000 归一化坐标)
    const layoutBlocks = this.extractLayoutBlocks(targetDir, meta.taskId);

    // 优先采用结构化 AST 合成的高纯度 Markdown（去除突兀孤立页码，生成标准脚注与分页锚点）
    const cleanMarkdown = layoutBlocks.length > 0
      ? synthesizeStructuredMarkdown(layoutBlocks, markdown)
      : markdown;

    return {
      taskId: meta.taskId,
      fileName: meta.fileName,
      pageCount: meta.pageCount,
      markdown: cleanMarkdown,
      layoutBlocks,
      images,
      status: meta.status,
      engine: meta.engine,
      durationMs: meta.completedAt && meta.createdAt ? meta.completedAt - meta.createdAt : undefined,
      rawJson: rawJson || undefined,
    };
  }

  /**
   * 从 content_list_v2.json / layout.json / full.md 提取统一的高质量 LayoutBlock AST
   */
  private extractLayoutBlocks(targetDir: string, taskId: string): LayoutBlock[] {
    return compileIngestAST(targetDir, taskId);
  }

  /**
   * 5. 一键转入 AstroLib 书籍合集 (MDX 切分与静态资源迁移)
   */
  public async exportToCollection(
    taskId: string,
    collectionSlug: string,
    bookSlug: string,
    bookTitle: string
  ): Promise<{ success: boolean; outDir: string; chapterCount: number }> {
    const result = this.getResult(taskId);
    if (!result || !result.markdown) {
      throw new Error('未找到该任务的解析成果 Markdown');
    }

    const colDir = path.resolve(process.cwd(), `content-sources/imports/${collectionSlug}`);
    if (!fs.existsSync(colDir)) {
      fs.mkdirSync(colDir, { recursive: true });
    }

    const bookDir = path.join(colDir, bookSlug);
    if (!fs.existsSync(bookDir)) {
      fs.mkdirSync(bookDir, { recursive: true });
    }

    const bookImagesDir = path.join(bookDir, 'images');
    if (!fs.existsSync(bookImagesDir)) {
      fs.mkdirSync(bookImagesDir, { recursive: true });
    }

    // 拷贝提取出的图片
    const taskDir = this.findTaskDir(taskId) || path.join(this.baseDir, taskId);
    const unpackedDir = path.join(taskDir, 'unpacked');
    // 寻找源 images 目录
    const copyImages = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const ent of entries) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory() && ent.name.toLowerCase() === 'images') {
          const files = fs.readdirSync(p);
          for (const f of files) {
            fs.copyFileSync(path.join(p, f), path.join(bookImagesDir, f));
          }
          return;
        } else if (ent.isDirectory()) {
          copyImages(p);
        }
      }
    };
    copyImages(unpackedDir);

    // 转换 Markdown 为 JSX 安全的 MDX 内容
    // 转义非公式区域中的裸大括号 { -> &#123;, } -> &#125;
    const safeMdx = this.escapeMdxContent(result.markdown);

    // 写入主章节文件
    const mainChapterPath = path.join(bookDir, '01_全文研判.mdx');
    const mdxHeader = `---
title: "${bookTitle}"
description: "由 MinerU 智能解析与规整的学术文献"
---

`;
    fs.writeFileSync(mainChapterPath, mdxHeader + safeMdx, 'utf-8');

    return {
      success: true,
      outDir: bookDir,
      chapterCount: 1,
    };
  }

  /**
   * 转义 MDX 中的裸 JSX 字符（避免构建阻断）
   */
  private escapeMdxContent(content: string): string {
    // 保护 $$ ... $$ 与 $ ... $ 内的数学公式
    const mathTokens: string[] = [];
    let tokenized = content.replace(/\$\$[\s\S]*?\$\$|\$[^\$\n]+?\$/g, (match) => {
      mathTokens.push(match);
      return `___MATH_TOKEN_${mathTokens.length - 1}___`;
    });

    // 替换普通文本中的裸大括号与不合法波浪线
    tokenized = tokenized.replace(/\{/g, '&#123;').replace(/\}/g, '&#125;');
    tokenized = tokenized.replace(/(\d+)~(\d+)/g, '$1～$2');

    // 还原公式
    const restored = tokenized.replace(/___MATH_TOKEN_(\d+)___/g, (_, idx) => {
      return mathTokens[parseInt(idx, 10)] || '';
    });

    return restored;
  }

  private saveTaskMeta(meta: IngestTaskMeta): void {
    const taskDir = this.findTaskDir(meta.taskId) || path.join(this.baseDir, meta.taskId);
    if (!fs.existsSync(taskDir)) {
      fs.mkdirSync(taskDir, { recursive: true });
    }
    meta.outputDir = taskDir;
    const metaPath = path.join(taskDir, 'meta.json');
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
  }
}
