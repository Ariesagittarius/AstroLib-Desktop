/**
 * src/services/pdf2abp/abp-importer.ts
 * ============================================================================
 * ABP 内容包应用内一键热导入器 (Rule 9 Compliant Library Installer)
 * ============================================================================
 * 职责：
 * 1. 读取并经由 AbpFormatAdapter + validateInstallPayload 校验 .abp 包；
 * 2. 根据运行环境原子安装至：
 *    - Electron 主进程钩子（DesktopBookManager -> userData/abp-packs + 刷新书库与通知窗口）；
 *    - 或 ASTROLIB_USER_ABP_DIR 环境变量目录；
 *    - 或开发态 .tmp/dev-abp-packs/<col>-<slug>/；
 * 3. 严守 Rule 9：绝不篡改 tracked Git 源码 (collections.config.ts / content-sources/)。
 * ============================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import { AbpFormatAdapter } from '../../core/book-formats/abp-adapter.ts';
import { validateInstallPayload } from '../content-provider/install-validation.ts';
import type { AbpBundlePayload, InstalledBookMeta } from '../../types/content-package.ts';
import type { AbpImportResult } from './types.ts';

export type ElectronAbpInstallHook = (abpBuffer: Buffer, abpPath: string) => Promise<InstalledBookMeta>;

let electronInstallHook: ElectronAbpInstallHook | null = null;

/**
 * 由 electron/main.ts 注册的原生书库安装钩子
 */
export function registerElectronAbpInstaller(hook: ElectronAbpInstallHook | null): void {
  electronInstallHook = hook;
}

function writeFileAtomic(filePath: string, data: string | Buffer): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
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
      try { fs.rmSync(tmpPath, { force: true }); } catch {}
    }
    throw err;
  }
}

function resolveSafeSubpath(baseDir: string, relPath: string): string {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('..') || path.isAbsolute(relPath)) {
    throw new Error(`非法路径: ${relPath}`);
  }
  const base = path.resolve(baseDir);
  const target = path.resolve(base, normalized);
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error(`路径越界: ${relPath}`);
  }
  return target;
}

function installBundleToDir(bundle: AbpBundlePayload, baseDir: string, updateInstalledBooksMeta: boolean): string {
  const manifest = bundle.manifest;
  const bookKey = `${manifest.colSlug}-${manifest.slug}`;
  const bookDir = resolveSafeSubpath(baseDir, bookKey);
  const ts = Date.now();
  const stagingDir = resolveSafeSubpath(baseDir, `${bookKey}.__staging_${ts}_${process.pid}`);
  const backupDir = resolveSafeSubpath(baseDir, `${bookKey}.__backup_${ts}_${process.pid}`);

  fs.mkdirSync(path.join(stagingDir, 'chapters'), { recursive: true });

  let backedUp = false;
  let swapped = false;

  try {
    writeFileAtomic(path.join(stagingDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

    for (const [chapSlug, payload] of Object.entries(bundle.chapters || {})) {
      const chapFile = resolveSafeSubpath(path.join(stagingDir, 'chapters'), `${chapSlug}.json`);
      fs.mkdirSync(path.dirname(chapFile), { recursive: true });
      fs.writeFileSync(chapFile, JSON.stringify(payload, null, 2), 'utf8');
    }

    for (const [relPath, b64] of Object.entries(bundle.assets || {})) {
      const destPath = resolveSafeSubpath(stagingDir, relPath);
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.writeFileSync(destPath, Buffer.from(b64, 'base64'));
    }

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
    if (bundle.embeddings) {
      if (bundle.embeddings.meta) {
        fs.writeFileSync(path.join(stagingDir, 'embeddings.meta.json'), JSON.stringify(bundle.embeddings.meta, null, 2), 'utf8');
      }
      if (bundle.embeddings.binaryBase64) {
        fs.writeFileSync(path.join(stagingDir, 'embeddings.bin'), Buffer.from(bundle.embeddings.binaryBase64, 'base64'));
      }
    }

    if (fs.existsSync(bookDir)) {
      fs.renameSync(bookDir, backupDir);
      backedUp = true;
    }
    fs.renameSync(stagingDir, bookDir);
    swapped = true;

    if (updateInstalledBooksMeta) {
      const metaFile = path.join(baseDir, 'installed_books.json');
      let installed: InstalledBookMeta[] = [];
      if (fs.existsSync(metaFile)) {
        try {
          installed = JSON.parse(fs.readFileSync(metaFile, 'utf8')) as InstalledBookMeta[];
        } catch {
          installed = [];
        }
      }
      const meta: InstalledBookMeta = {
        installedAt: new Date().toISOString(),
        sourceType: 'local-file',
        localPath: bookDir,
        manifest,
      };
      const idx = installed.findIndex(
        (b) => b.manifest.id === manifest.id || (b.manifest.colSlug === manifest.colSlug && b.manifest.slug === manifest.slug)
      );
      if (idx >= 0) installed[idx] = meta;
      else installed.unshift(meta);
      writeFileAtomic(metaFile, JSON.stringify(installed, null, 2));
    }

    if (backedUp && fs.existsSync(backupDir)) {
      fs.rmSync(backupDir, { recursive: true, force: true });
    }
    const cacheDir = resolveSafeSubpath(baseDir, `.cache/${bookKey}`);
    if (fs.existsSync(cacheDir)) {
      fs.rmSync(cacheDir, { recursive: true, force: true });
    }

    return bookDir;
  } catch (err) {
    if (swapped) {
      try {
        if (fs.existsSync(bookDir)) fs.rmSync(bookDir, { recursive: true, force: true });
        if (backedUp && fs.existsSync(backupDir)) fs.renameSync(backupDir, bookDir);
      } catch {}
    } else if (backedUp && fs.existsSync(backupDir) && !fs.existsSync(bookDir)) {
      try { fs.renameSync(backupDir, bookDir); } catch {}
    }
    if (fs.existsSync(stagingDir)) {
      try { fs.rmSync(stagingDir, { recursive: true, force: true }); } catch {}
    }
    throw err;
  }
}

export async function importAbpToAppLibrary(
  abpPath: string,
  options: { targetDir?: string } = {}
): Promise<AbpImportResult> {
  const resolved = path.resolve(abpPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`待导入的 .abp 文件不存在: ${resolved}`);
  }

  const buf = fs.readFileSync(resolved);
  const adapter = new AbpFormatAdapter();
  const normalized = await adapter.normalize(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
  const bundle = validateInstallPayload(normalized.bundle);
  const m = bundle.manifest;

  let targetMode: AbpImportResult['targetMode'] = 'dev-abp-packs';
  let storageDir = '';

  if (options.targetDir) {
    storageDir = installBundleToDir(bundle, path.resolve(options.targetDir), Boolean(process.env.ASTROLIB_USER_ABP_DIR));
    targetMode = process.env.ASTROLIB_USER_ABP_DIR ? 'user-abp-dir' : 'dev-abp-packs';
  } else if (electronInstallHook) {
    const installedMeta = await electronInstallHook(buf, resolved);
    targetMode = 'electron-hook';
    storageDir = installedMeta.localPath || '';
  } else if (process.env.ASTROLIB_USER_ABP_DIR) {
    storageDir = installBundleToDir(bundle, path.resolve(process.env.ASTROLIB_USER_ABP_DIR), true);
    targetMode = 'user-abp-dir';
  } else {
    const devPacksDir = path.resolve(process.cwd(), '.tmp', 'dev-abp-packs');
    storageDir = installBundleToDir(bundle, devPacksDir, false);
    targetMode = 'dev-abp-packs';
  }

  // 若 ContentApiService 已在内存中实例化，则刷新其全局章节与统一知识库索引缓存
  try {
    const mod = await import('../../core/content-api/content-api-service.ts');
    const ServiceCls = mod.ContentApiService as any;
    if (ServiceCls?.instance) {
      if (typeof ServiceCls.instance.invalidateKnowledgeCache === 'function') {
        ServiceCls.instance.invalidateKnowledgeCache();
      } else if ('cachedChapterIndex' in ServiceCls.instance) {
        ServiceCls.instance.cachedChapterIndex = null;
      }
    }
  } catch {}

  const entryPoint = m.entryPoint;
  const canonicalUrl = `/collections/${m.colSlug}/${m.slug}/${entryPoint}/`;
  return {
    installed: true,
    targetMode,
    bookId: m.id,
    colSlug: m.colSlug,
    bookSlug: m.slug,
    title: m.title,
    entryPoint,
    readerUrl: canonicalUrl,
    canonicalUrl,
    storageDir,
  };
}
