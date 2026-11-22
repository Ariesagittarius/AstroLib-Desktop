import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import {
  type AbpBundlePayload,
  type AstroBookManifest,
  type AstroBookChapterPayload,
  type InstalledBookMeta,
} from '../../src/types/content-package.ts';
import type { StorageStats } from '../../src/services/content-provider/types.ts';
import { validateInstallPayload } from '../../src/services/content-provider/install-validation.ts';
import { bookFormatRegistry } from '../../src/core/book-formats/registry.ts';
import type { BookNormalizeOptions, NormalizedSourceArchive } from '../../src/core/book-formats/types.ts';

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

  public async getInstalledBooks(): Promise<InstalledBookMeta[]> {
    try {
      if (!fs.existsSync(this.metaFile)) {
        return [];
      }
      const raw = fs.readFileSync(this.metaFile, 'utf8');
      const list: InstalledBookMeta[] = JSON.parse(raw);

      return list.filter((b) => {
        const bookDir = path.join(this.storageDir, `${b.manifest.colSlug}-${b.manifest.slug}`);
        return fs.existsSync(bookDir);
      });
    } catch (err) {
      console.error('[DesktopBookManager] 读取已安装图书清单失败:', err);
      return [];
    }
  }

  private toNodeBuffer(rawBuffer: Buffer | Uint8Array | ArrayBuffer | any): Buffer {
    if (Buffer.isBuffer(rawBuffer)) {
      return rawBuffer;
    }
    if (rawBuffer instanceof Uint8Array) {
      return Buffer.from(rawBuffer.buffer, rawBuffer.byteOffset, rawBuffer.byteLength);
    }
    if (rawBuffer instanceof ArrayBuffer) {
      return Buffer.from(rawBuffer);
    }
    if (Array.isArray(rawBuffer)) {
      return Buffer.from(rawBuffer);
    }
    if (typeof rawBuffer === 'object' && rawBuffer !== null) {
      const values = Object.values(rawBuffer) as number[];
      return Buffer.from(values);
    }
    return Buffer.from(rawBuffer as any);
  }

  public async installBookFromFile(
    fileName: string,
    fileBuffer: Buffer | Uint8Array | ArrayBuffer | any,
    options: BookNormalizeOptions = {}
  ): Promise<InstalledBookMeta> {
    const nodeBuf = this.toNodeBuffer(fileBuffer);
    const uint8 = new Uint8Array(nodeBuf.buffer, nodeBuf.byteOffset, nodeBuf.byteLength);
    const normalized = await bookFormatRegistry.normalizeFile(fileName, uint8, options);
    const validated = validateInstallPayload(normalized.bundle);
    return await this.installNormalizedBundle(validated, normalized.sourceArchive);
  }

  public async installBookFromAbp(abpBuffer: Buffer | Uint8Array | ArrayBuffer | any): Promise<InstalledBookMeta> {
    return await this.installBookFromFile('book.abp', abpBuffer);
  }

  public async installNormalizedBundle(
    bundleInput: AbpBundlePayload,
    sourceArchive?: NormalizedSourceArchive
  ): Promise<InstalledBookMeta> {
    const bundle = validateInstallPayload(bundleInput);
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

      writeFileAtomic(path.join(stagingDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

      for (const [chapKey, payload] of Object.entries(chapters)) {
        const chapFile = resolveSafeSubpath(stagingChaptersDir, `${chapKey}.json`);
        this.ensureDir(path.dirname(chapFile));
        fs.writeFileSync(chapFile, JSON.stringify(payload, null, 2), 'utf8');
      }

      for (const [relPath, b64Data] of Object.entries(assets)) {
        const destPath = resolveSafeSubpath(stagingDir, relPath);
        this.ensureDir(path.dirname(destPath));
        const imgBuffer = Buffer.from(b64Data, 'base64');
        fs.writeFileSync(destPath, imgBuffer);
      }

      if (sourceArchive && sourceArchive.bytes && sourceArchive.bytes.byteLength > 0) {
        const safeArchiveName = path.basename(sourceArchive.fileName || 'original.epub') || 'original.epub';
        const archivePath = resolveSafeSubpath(stagingDir, `source/${safeArchiveName}`);
        this.ensureDir(path.dirname(archivePath));
        fs.writeFileSync(archivePath, Buffer.from(sourceArchive.bytes.buffer, sourceArchive.bytes.byteOffset, sourceArchive.bytes.byteLength));
      } else if (bundle.sourceArchiveBase64) {
        const safeArchiveName = path.basename(bundle.sourceArchiveFileName || 'original.epub') || 'original.epub';
        const archivePath = resolveSafeSubpath(stagingDir, `source/${safeArchiveName}`);
        this.ensureDir(path.dirname(archivePath));
        fs.writeFileSync(archivePath, Buffer.from(bundle.sourceArchiveBase64, 'base64'));
      }

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

      if (bundle.aiIndex) {
        fs.writeFileSync(path.join(stagingDir, 'ai-index.json'), JSON.stringify(bundle.aiIndex, null, 2), 'utf8');
      }
      if (bundle.crossRefs) {
        fs.writeFileSync(path.join(stagingDir, 'cross-refs.json'), JSON.stringify(bundle.crossRefs, null, 2), 'utf8');
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

      if (fs.existsSync(bookDir)) {
        fs.renameSync(bookDir, backupDir);
        backedUp = true;
      }
      fs.renameSync(stagingDir, bookDir);
      swapped = true;

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

  public async getBookManifest(colSlug: string, bookSlug: string): Promise<AstroBookManifest | null> {
    try {
      const bookDir = resolveSafeSubpath(this.storageDir, `${colSlug}-${bookSlug}`);
      const manifestFile = path.join(bookDir, 'manifest.json');
      if (fs.existsSync(manifestFile)) {
        return JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
      }
    } catch {}
    return null;
  }

  public async getChapterPayload(
    colSlug: string,
    bookSlug: string,
    chapterSlug: string
  ): Promise<AstroBookChapterPayload | null> {
    try {
      const chapFile = resolveSafeSubpath(
        this.storageDir,
        `${colSlug}-${bookSlug}/chapters/${chapterSlug}.json`
      );
      if (fs.existsSync(chapFile)) {
        return JSON.parse(fs.readFileSync(chapFile, 'utf8'));
      }
    } catch {}
    return null;
  }

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
