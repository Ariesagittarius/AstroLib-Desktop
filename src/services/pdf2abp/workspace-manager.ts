/**
 * src/services/pdf2abp/workspace-manager.ts
 * ============================================================================
 * PDF2ABP 任务工作区沙箱管理器 (Workspace Sandbox & Checkpoint Persistence)
 * ============================================================================
 * 职责：
 * 1. 创建与解析每项 pdf2abp 任务的隔离工作区目录；
 * 2. 严格路径越狱防护（只允许读写工作区内文件；源 PDF 仅限只读白名单）；
 * 3. 提供分页读取、原子写入、精准局部编辑、文件枚举、状态检查点持久化。
 * ============================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Pdf2AbpEvent, Pdf2AbpJobState, WorkspaceFileEntry } from './types.ts';

export function resolvePdf2AbpJobsRoot(projectRoot: string = process.cwd()): string {
  if (process.env.ASTROLIB_PDF2ABP_DIR) {
    return path.resolve(process.env.ASTROLIB_PDF2ABP_DIR);
  }
  if (process.env.ASTROLIB_USER_DATA_DIR) {
    return path.join(path.resolve(process.env.ASTROLIB_USER_DATA_DIR), 'pdf2abp-jobs');
  }
  return path.resolve(projectRoot, '.tmp', 'pdf2abp-jobs');
}

export class JobWorkspace {
  public readonly jobId: string;
  public readonly rootDir: string;
  public readonly sourcePdfPath: string;
  public readonly mineruDir: string;
  public readonly mineruPartsDir: string;
  public readonly mineruStitchedDir: string;
  public readonly pagesDir: string;
  public readonly chunksDir: string;
  public readonly subagentsDir: string;
  public readonly bookDir: string;
  public readonly bookImagesDir: string;
  public readonly distDir: string;
  public readonly scriptsDir: string;
  public readonly statePath: string;
  public readonly eventsLogPath: string;

  constructor(jobId: string, sourcePdfPath: string, customRootDir?: string) {
    if (!jobId || /[\\/:*?"<>|]|\.\./.test(jobId)) {
      throw new Error(`非法的 jobId: ${jobId}`);
    }
    this.jobId = jobId;
    this.sourcePdfPath = path.resolve(sourcePdfPath);
    const jobsRoot = customRootDir ? path.resolve(customRootDir) : resolvePdf2AbpJobsRoot();
    this.rootDir = path.resolve(jobsRoot, jobId);

    this.mineruDir = path.join(this.rootDir, 'mineru');
    this.mineruPartsDir = path.join(this.mineruDir, 'parts');
    this.mineruStitchedDir = path.join(this.mineruDir, 'stitched');
    this.pagesDir = path.join(this.rootDir, 'pages');
    this.chunksDir = path.join(this.rootDir, 'chunks');
    this.subagentsDir = path.join(this.rootDir, 'subagents');
    this.bookDir = path.join(this.rootDir, 'book');
    this.bookImagesDir = path.join(this.bookDir, 'images');
    this.distDir = path.join(this.rootDir, 'dist');
    this.scriptsDir = path.join(this.rootDir, 'scripts');
    this.statePath = path.join(this.rootDir, 'job-state.json');
    this.eventsLogPath = path.join(this.rootDir, 'events.jsonl');

    this.ensureStructure();
  }

  public static loadExisting(jobId: string, customRootDir?: string): { workspace: JobWorkspace; state: Pdf2AbpJobState } {
    const jobsRoot = customRootDir ? path.resolve(customRootDir) : resolvePdf2AbpJobsRoot();
    const statePath = path.join(jobsRoot, jobId, 'job-state.json');
    if (!fs.existsSync(statePath)) {
      throw new Error(`未找到任务工作区状态文件: ${jobId}`);
    }
    const state = JSON.parse(fs.readFileSync(statePath, 'utf-8')) as Pdf2AbpJobState;
    const workspace = new JobWorkspace(jobId, state.sourcePdfPath, jobsRoot);
    return { workspace, state };
  }

  public ensureStructure(): void {
    for (const dir of [
      this.rootDir,
      this.mineruDir,
      this.mineruPartsDir,
      this.mineruStitchedDir,
      this.pagesDir,
      this.chunksDir,
      this.subagentsDir,
      this.bookDir,
      this.bookImagesDir,
      this.distDir,
      this.scriptsDir,
    ]) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * 严格路径越狱校验：把任意工作区相对路径安全映射为绝对路径
   */
  public resolveWorkspacePath(relPath: string): string {
    if (typeof relPath !== 'string' || !relPath.trim()) {
      throw new Error('工作区路径不能为空');
    }
    let normalized = relPath.trim().replace(/\\/g, '/');
    if (path.isAbsolute(normalized) || /^[a-zA-Z]:/.test(normalized) || normalized.startsWith('/')) {
      // 允许传入恰好位于本工作区内部的绝对路径，但先规范化回相对路径
      const absCandidate = path.resolve(relPath.trim());
      const rel = path.relative(this.rootDir, absCandidate).replace(/\\/g, '/');
      if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new Error(`安全拦截：禁止越界访问工作区之外的路径 "${relPath}"`);
      }
      normalized = rel;
    }

    if (normalized.includes('\0')) {
      throw new Error('路径包含非法空字节');
    }

    const segments = normalized.split('/').filter(Boolean);
    if (segments.includes('..')) {
      throw new Error(`安全拦截：路径中包含禁止的 ".." 穿越段 "${relPath}"`);
    }

    const target = path.resolve(this.rootDir, normalized);
    if (target !== this.rootDir && !target.startsWith(this.rootDir + path.sep)) {
      throw new Error(`安全拦截：路径逃逸工作区 "${relPath}"`);
    }
    return target;
  }

  public toRelativePath(absPath: string): string {
    return path.relative(this.rootDir, path.resolve(absPath)).replace(/\\/g, '/');
  }

  public assertAllowedSourcePdf(candidatePdfPath?: string): string {
    if (!candidatePdfPath) return this.sourcePdfPath;
    const resolved = path.resolve(candidatePdfPath);
    if (resolved !== this.sourcePdfPath) {
      // 允许读取工作区内的拆分 PDF（mineru/parts/...）
      if (resolved.startsWith(this.rootDir + path.sep)) {
        return resolved;
      }
      throw new Error(`安全拦截：禁止访问非本任务指定的外部 PDF "${candidatePdfPath}"`);
    }
    return resolved;
  }

  public listFiles(relDir: string = '', maxDepth: number = 3): WorkspaceFileEntry[] {
    const startDir = relDir ? this.resolveWorkspacePath(relDir) : this.rootDir;
    if (!fs.existsSync(startDir)) return [];
    const results: WorkspaceFileEntry[] = [];

    const walk = (dir: string, depth: number) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        const stat = fs.statSync(full);
        results.push({
          relPath: this.toRelativePath(full),
          name: entry.name,
          isDirectory: entry.isDirectory(),
          sizeBytes: entry.isDirectory() ? 0 : stat.size,
          mtimeMs: stat.mtimeMs,
        });
        if (entry.isDirectory() && depth < maxDepth) {
          walk(full, depth + 1);
        }
      }
    };

    walk(startDir, 0);
    return results;
  }

  public readFile(
    relPath: string,
    options: { startLine?: number; endLine?: number; maxChars?: number } = {}
  ): {
    relPath: string;
    totalLines: number;
    startLine: number;
    endLine: number;
    truncated: boolean;
    content: string;
  } {
    const fullPath = this.resolveWorkspacePath(relPath);
    if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
      throw new Error(`工作区文件不存在: ${relPath}`);
    }
    const raw = fs.readFileSync(fullPath, 'utf-8');
    const lines = raw.split(/\r?\n/);
    const totalLines = lines.length;

    const startLine = Math.max(1, options.startLine || 1);
    const defaultSpan = options.endLine ? options.endLine : Math.min(totalLines, startLine + 399);
    const endLine = Math.min(totalLines, Math.max(startLine, defaultSpan));
    let slice = lines.slice(startLine - 1, endLine).join('\n');

    const maxChars = options.maxChars || 36000;
    let truncated = endLine < totalLines;
    if (slice.length > maxChars) {
      slice = slice.slice(0, maxChars);
      truncated = true;
    }

    return {
      relPath: this.toRelativePath(fullPath),
      totalLines,
      startLine,
      endLine,
      truncated,
      content: slice,
    };
  }

  public writeFile(relPath: string, content: string): { relPath: string; bytesWritten: number } {
    const fullPath = this.resolveWorkspacePath(relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    const tmpPath = `${fullPath}.tmp.${process.pid}`;
    fs.writeFileSync(tmpPath, content, 'utf-8');
    fs.renameSync(tmpPath, fullPath);
    return {
      relPath: this.toRelativePath(fullPath),
      bytesWritten: Buffer.byteLength(content, 'utf-8'),
    };
  }

  public editFile(
    relPath: string,
    target: string,
    replacement: string,
    replaceAll: boolean = false
  ): { relPath: string; replacements: number; bytesWritten: number } {
    const fullPath = this.resolveWorkspacePath(relPath);
    if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
      throw new Error(`工作区文件不存在: ${relPath}`);
    }
    const raw = fs.readFileSync(fullPath, 'utf-8');
    if (!target) {
      throw new Error('target 不能为空字符串');
    }
    if (!raw.includes(target)) {
      throw new Error(`在文件 ${relPath} 中未找到完全匹配的 target 片段`);
    }

    let replacements = 0;
    let next = raw;
    if (replaceAll) {
      const parts = raw.split(target);
      replacements = parts.length - 1;
      next = parts.join(replacement);
    } else {
      const idx = raw.indexOf(target);
      next = raw.slice(0, idx) + replacement + raw.slice(idx + target.length);
      replacements = 1;
    }

    const res = this.writeFile(relPath, next);
    return { ...res, replacements };
  }

  public deleteFile(relPath: string): { relPath: string; deleted: boolean } {
    const fullPath = this.resolveWorkspacePath(relPath);
    if (fullPath === this.rootDir) {
      throw new Error('禁止删除工作区根目录');
    }
    if (!fs.existsSync(fullPath)) {
      return { relPath, deleted: false };
    }
    fs.rmSync(fullPath, { recursive: true, force: true });
    return { relPath, deleted: true };
  }

  public saveState(state: Pdf2AbpJobState): void {
    const tmp = `${this.statePath}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8');
    fs.renameSync(tmp, this.statePath);
  }

  public appendEvent(evt: Pdf2AbpEvent): void {
    fs.appendFileSync(this.eventsLogPath, JSON.stringify(evt) + '\n', 'utf-8');
  }

  public readEvents(): Pdf2AbpEvent[] {
    if (!fs.existsSync(this.eventsLogPath)) return [];
    const raw = fs.readFileSync(this.eventsLogPath, 'utf-8').trim();
    if (!raw) return [];
    const list: Pdf2AbpEvent[] = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        list.push(JSON.parse(line) as Pdf2AbpEvent);
      } catch {}
    }
    return list;
  }
}
