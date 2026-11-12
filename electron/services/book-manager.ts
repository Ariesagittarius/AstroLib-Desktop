/**
 * electron/services/book-manager.ts
 * ============================================================================
 * AstroLib 桌面端原生图书包与书架管理服务 (Node.js FS / zlib / IPC)
 * ============================================================================
 */

import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import zlib from 'node:zlib';
import {
  validateAbpBundle,
  type AstroBookManifest,
  type AstroBookChapterPayload,
  type InstalledBookMeta,
} from '../../src/types/content-package.ts';
import type { StorageStats } from '../../src/services/content-provider/types.ts';

/**
 * 校验相对路径安全拼接：严禁路径穿越或写至基准目录之外
 */
function resolveSafeSubpath(baseDir: string, relPath: string): string {
  if (!relPath || typeof relPath !== 'string') {
    throw new Error('非法的相对路径（空路径）');
  }
  const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (normalized.includes('..') || path.isAbsolute(relPath)) {
    throw new Error(`检测到非法路径穿越字符: ${relPath}`);
  }
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(resolvedBase, normalized);
  if (resolvedTarget !== resolvedBase && !resolvedTarget.startsWith(resolvedBase + path.sep)) {
    throw new Error(`路径越界: ${relPath}`);
  }
  return resolvedTarget;
}

function writeFileAtomic(filePath: string, data: string | Buffer): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmpPath = `${filePath}.tmp.${process.pid}`;
  try {
    if (typeof data === 'string') {
      fs.writeFileSync(tmpPath, data, 'utf8');
    } else {
      fs.writeFileSync(tmpPath, data);
    }
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    if (fs.existsSync(tmpPath)) {
      try {
        fs.rmSync(tmpPath, { force: true });
      } catch {}
    }
    throw err;
  }
}

export class DesktopBookManager {
  private readonly storageDir: string;
  private readonly metaFile: string;

  constructor(customStorageDir?: string) {
    this.storageDir = customStorageDir || path.join(app.getPath('userData'), 'abp-packs');
    this.metaFile = path.join(this.storageDir, 'installed_books.json');
    this.ensureDir(this.storageDir);
  }

  public getStorageDir(): string {
    return this.storageDir;
  }

  private ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * 获取本地已安装的书籍列表
   */
  public async getInstalledBooks(): Promise<InstalledBookMeta[]> {
    try {
      if (!fs.existsSync(this.metaFile)) {
        return [];
      }
      const raw = fs.readFileSync(this.metaFile, 'utf8');
      const list: InstalledBookMeta[] = JSON.parse(raw);
      // 验证书籍物理目录是否存在
      return list.filter((b) => {
        const bookDir = path.join(this.storageDir, `${b.manifest.colSlug}-${b.manifest.slug}`);
        return fs.existsSync(bookDir);
      });
    } catch (err) {
      console.error('[DesktopBookManager] 读取已安装图书清单失败:', err);
      return [];
    }
  }

  /**
   * 从 .abp (Gzip 压缩 JSON) 字节流安装书籍到本地持久化存储
   */
  public async installBookFromAbp(abpBuffer: Buffer | Uint8Array | ArrayBuffer | any): Promise<InstalledBookMeta> {
    let nodeBuf: Buffer;
    if (Buffer.isBuffer(abpBuffer)) {
      nodeBuf = abpBuffer;
    } else if (abpBuffer instanceof Uint8Array) {
      nodeBuf = Buffer.from(abpBuffer.buffer, abpBuffer.byteOffset, abpBuffer.byteLength);
    } else if (abpBuffer instanceof ArrayBuffer) {
      nodeBuf = Buffer.from(abpBuffer);
    } else if (Array.isArray(abpBuffer)) {
      nodeBuf = Buffer.from(abpBuffer);
    } else if (typeof abpBuffer === 'object' && abpBuffer !== null) {
      const values = Object.values(abpBuffer) as number[];
      nodeBuf = Buffer.from(values);
    } else {
      nodeBuf = Buffer.from(abpBuffer as any);
    }

    // 1. Gzip 解压缩
    let jsonText: string;
    try {
      const decompressed = zlib.gunzipSync(nodeBuf);
      jsonText = decompressed.toString('utf8');
    } catch (err: any) {
      throw new Error(`解压 .abp 数据包失败: ${err.message}`);
    }

    // 2. 解析并严格校验 ABP 数据包结构
    const bundle = validateAbpBundle(JSON.parse(jsonText));
    const manifest: AstroBookManifest = bundle.manifest;
    const chapters: Record<string, AstroBookChapterPayload> = bundle.chapters || {};
    const assets: Record<string, string> = bundle.assets || {};

    const bookKey = `${manifest.colSlug}-${manifest.slug}`;
    const bookDir = resolveSafeSubpath(this.storageDir, bookKey);
    const stagingDir = resolveSafeSubpath(this.storageDir, `${bookKey}.__staging_${Date.now()}_${process.pid}`);
    const backupDir = resolveSafeSubpath(this.storageDir, `${bookKey}.__backup_${Date.now()}_${process.pid}`);
    const stagingChaptersDir = path.join(stagingDir, 'chapters');
    const stagingExercisesDir = path.join(stagingDir, 'exercises');

    this.ensureDir(stagingChaptersDir);

    let backedUp = false;
    let swapped = false;
    try {
      // 3. 写入 manifest.json
      writeFileAtomic(path.join(stagingDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

      // 4. 写入全部章节 JSON（校验章节 key 无路径穿越）
      for (const [chapKey, payload] of Object.entries(chapters)) {
        const chapFile = resolveSafeSubpath(stagingChaptersDir, `${chapKey}.json`);
        this.ensureDir(path.dirname(chapFile));
        fs.writeFileSync(chapFile, JSON.stringify(payload, null, 2), 'utf8');
      }

      // 5. 写入配图资源 (Base64 解码，严格校验相对路径)
      for (const [relPath, b64Data] of Object.entries(assets)) {
        const destPath = resolveSafeSubpath(stagingDir, relPath);
        this.ensureDir(path.dirname(destPath));
        const imgBuffer = Buffer.from(b64Data, 'base64');
        fs.writeFileSync(destPath, imgBuffer);
      }

      // 5.1 写入切片元数据与离线量化向量 (若 bundle 包含 embeddings)
      if (bundle.embeddings) {
        if (bundle.embeddings.meta) {
          fs.writeFileSync(
            path.join(stagingDir, 'embeddings.meta.json'),
            JSON.stringify(bundle.embeddings.meta, null, 2),
            'utf8'
          );
        }
        if (bundle.embeddings.binaryBase64) {
          const binBuf = Buffer.from(bundle.embeddings.binaryBase64, 'base64');
          fs.writeFileSync(path.join(stagingDir, 'embeddings.bin'), binBuf);
        }
      }

      // 5.2 写入自包含辅助数据（AI 索引、知识图谱、交叉引用、模块巡检、课后习题）
      if (bundle.aiIndex) {
        fs.writeFileSync(path.join(stagingDir, 'ai-index.json'), JSON.stringify(bundle.aiIndex, null, 2), 'utf8');
      }
      if (bundle.relationGraph) {
        fs.writeFileSync(path.join(stagingDir, 'relation-graph.json'), JSON.stringify(bundle.relationGraph, null, 2), 'utf8');
      }
      if (bundle.crossRefs) {
        fs.writeFileSync(path.join(stagingDir, 'cross-refs.json'), JSON.stringify(bundle.crossRefs, null, 2), 'utf8');
      }
      if (bundle.inspectorData) {
        fs.writeFileSync(path.join(stagingDir, 'inspector-data.json'), JSON.stringify(bundle.inspectorData, null, 2), 'utf8');
      }
      if (bundle.exercises && typeof bundle.exercises === 'object') {
        this.ensureDir(stagingExercisesDir);
        for (const [relPath, rawJson] of Object.entries(bundle.exercises)) {
          if (typeof rawJson !== 'string') continue;
          const destPath = resolveSafeSubpath(stagingExercisesDir, relPath);
          this.ensureDir(path.dirname(destPath));
          fs.writeFileSync(destPath, rawJson, 'utf8');
        }
      }

      // 5.3 原子替换目标目录（保留 backupDir 直至元数据落盘成功）
      if (fs.existsSync(bookDir)) {
        fs.renameSync(bookDir, backupDir);
        backedUp = true;
      }
      fs.renameSync(stagingDir, bookDir);
      swapped = true;

      // 6. 更新已安装图书元数据（原子写入；失败时在 catch 中回滚 bookDir）
      const installed = await this.getInstalledBooks();
      const existingIdx = installed.findIndex(
        (b) => b.manifest.id === manifest.id || (b.manifest.colSlug === manifest.colSlug && b.manifest.slug === manifest.slug)
      );

      const meta: InstalledBookMeta = {
        installedAt: new Date().toISOString(),
        sourceType: 'local-file',
        localPath: bookDir,
        manifest,
      };

      if (existingIdx >= 0) {
        installed[existingIdx] = meta;
      } else {
        installed.unshift(meta);
      }

      writeFileAtomic(this.metaFile, JSON.stringify(installed, null, 2));

      if (backedUp && fs.existsSync(backupDir)) {
        fs.rmSync(backupDir, { recursive: true, force: true });
      }
      const bookCacheDir = resolveSafeSubpath(this.storageDir, `.cache/${bookKey}`);
      if (fs.existsSync(bookCacheDir)) {
        fs.rmSync(bookCacheDir, { recursive: true, force: true });
      }

      console.log(`[DesktopBookManager] 成功安装图书: 《${manifest.title}》(${bookKey})`);
      return meta;
    } catch (err) {
      if (swapped) {
        try {
          if (fs.existsSync(bookDir)) {
            fs.rmSync(bookDir, { recursive: true, force: true });
          }
          if (backedUp && fs.existsSync(backupDir)) {
            fs.renameSync(backupDir, bookDir);
          }
        } catch {}
      } else if (backedUp && fs.existsSync(backupDir) && !fs.existsSync(bookDir)) {
        try {
          fs.renameSync(backupDir, bookDir);
        } catch {}
      }
      if (fs.existsSync(stagingDir)) {
        fs.rmSync(stagingDir, { recursive: true, force: true });
      }
      throw err;
    }
  }

  /**
   * 卸载图书并清理磁盘资源与渲染缓存
   */
  public async removeBook(colSlug: string, bookSlug: string): Promise<boolean> {
    const bookKey = `${colSlug}-${bookSlug}`;
    const bookDir = resolveSafeSubpath(this.storageDir, bookKey);
    const bookCacheDir = resolveSafeSubpath(this.storageDir, `.cache/${bookKey}`);

    try {
      if (fs.existsSync(bookDir)) {
        fs.rmSync(bookDir, { recursive: true, force: true });
      }
      if (fs.existsSync(bookCacheDir)) {
        fs.rmSync(bookCacheDir, { recursive: true, force: true });
      }

      const installed = await this.getInstalledBooks();
      const filtered = installed.filter((b) => !(b.manifest.colSlug === colSlug && b.manifest.slug === bookSlug));
      writeFileAtomic(this.metaFile, JSON.stringify(filtered, null, 2));
      console.log(`[DesktopBookManager] 成功卸载图书: ${bookKey}`);
      return true;
    } catch (err) {
      console.error(`[DesktopBookManager] 卸载图书失败: ${bookKey}`, err);
      return false;
    }
  }

  /**
   * 获取单本书籍的 Manifest
   */
  public async getBookManifest(colSlug: string, bookSlug: string): Promise<AstroBookManifest | null> {
    const manifestFile = path.join(this.storageDir, `${colSlug}-${bookSlug}`, 'manifest.json');
    if (fs.existsSync(manifestFile)) {
      try {
        return JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
      } catch {}
    }
    return null;
  }

  /**
   * 获取单章节 Payload 数据
   */
  public async getChapterPayload(
    colSlug: string,
    bookSlug: string,
    chapterSlug: string
  ): Promise<AstroBookChapterPayload | null> {
    const chapFile = path.join(this.storageDir, `${colSlug}-${bookSlug}`, 'chapters', `${chapterSlug}.json`);
    if (fs.existsSync(chapFile)) {
      try {
        return JSON.parse(fs.readFileSync(chapFile, 'utf8'));
      } catch {}
    }
    return null;
  }

  /**
   * 磁盘占用统计
   */
  public async getStorageStats(): Promise<StorageStats> {
    const installed = await this.getInstalledBooks();
    let totalBytes = 0;

    const calcDirSize = (dir: string): number => {
      let size = 0;
      if (!fs.existsSync(dir)) return 0;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) size += calcDirSize(full);
        else if (entry.isFile()) size += fs.statSync(full).size;
      }
      return size;
    };

    totalBytes = calcDirSize(this.storageDir);

    return {
      usedBytes: totalBytes,
      bookCount: installed.length,
    };
  }

  /**
   * 清空所有本地安装的书籍包与索引
   */
  public async clearAllBooks(): Promise<void> {
    try {
      if (fs.existsSync(this.metaFile)) {
        fs.unlinkSync(this.metaFile);
      }
      if (fs.existsSync(this.storageDir)) {
        for (const item of fs.readdirSync(this.storageDir)) {
          const itemPath = path.join(this.storageDir, item);
          fs.rmSync(itemPath, { recursive: true, force: true });
        }
      }
      console.log('[DesktopBookManager] 已清空所有本地安装的书籍数据');
    } catch (err) {
      console.error('[DesktopBookManager] 清空所有图书失败:', err);
      throw err;
    }
  }
}
