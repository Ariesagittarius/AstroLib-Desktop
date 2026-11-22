/**
 * src/core/catalog/content-paths.ts
 * ============================================================================
 * 内容源与 ABP 产物路径单一可信解析器 (Canonical Content & Artifact Paths)
 * ============================================================================
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CONTENT_SOURCES_REL = 'content-sources';
export const CONTENT_COLLECTIONS_REL = 'content-sources/collections';
export const ARTIFACTS_ABP_REL = 'artifacts/abp-packs';
export const ARTIFACTS_ANNOTATIONS_REL = 'artifacts/annotations';
/**
 * 发布投影目录清单（Generated Projection Only）：
 * 由 scripts/pack-book-abp.mjs 从 src/config/collections.config.ts#sourceCollections 投影生成，
 * 严禁作为人工维护源或运行时读取源（遵循 Rule 3 / Rule 4）。
 */
export const CONTENT_CATALOG_REL = 'content-sources/catalog.json';

let cachedProjectRoot: string | null = null;

/**
 * 智能探测 AstroLib 项目或运行时根目录 (兼容 Dev、桌面打包与跨目录执行)
 */
export function findProjectRoot(startDir: string = process.cwd()): string {
  if (process.env.ASTROLIB_ROOT && fs.existsSync(process.env.ASTROLIB_ROOT)) {
    return path.resolve(process.env.ASTROLIB_ROOT);
  }
  if (cachedProjectRoot) return cachedProjectRoot;

  let current = path.resolve(startDir);
  for (let i = 0; i < 6; i++) {
    const hasPkg = fs.existsSync(path.join(current, 'package.json'));
    const hasSources = fs.existsSync(path.join(current, CONTENT_COLLECTIONS_REL));
    const hasAbp = fs.existsSync(path.join(current, ARTIFACTS_ABP_REL));

    if (hasSources || hasAbp || (hasPkg && fs.existsSync(path.join(current, 'astro.config.mjs')))) {
      cachedProjectRoot = current;
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  cachedProjectRoot = path.resolve(startDir);
  return cachedProjectRoot;
}

/**
 * 解析教材源码根目录 (content-sources/collections)
 */
export function resolveCollectionsRoot(root: string = findProjectRoot()): string {
  return path.resolve(root, CONTENT_COLLECTIONS_REL);
}

/**
 * 解析指定合集与书目的源码目录 (content-sources/collections/<col>/<book>)
 */
export function resolveBookSourceDir(
  colSlug: string,
  bookSlug: string,
  root: string = findProjectRoot()
): string {
  return path.resolve(root, CONTENT_COLLECTIONS_REL, colSlug, bookSlug);
}

/**
 * 将磁盘上的章节文件路径规范化为相对 collections 根的路径（含 collections/ 前缀），
 * 用以生成与路由 `/collections/<col>/<book>/<cleanSlug>/` 对齐的 rawSlug。
 */
export function toCollectionRelativeSlug(
  filePath: string,
  root: string = findProjectRoot()
): string {
  const sourcesRoot = path.resolve(root, CONTENT_SOURCES_REL);
  const absFile = path.resolve(filePath);
  const rel = path.relative(sourcesRoot, absFile).replace(/\\/g, '/');
  if (!rel.startsWith('..')) {
    return rel.replace(/\.(mdx|md)$/i, '');
  }
  // 兼容传入相对路径或历史路径的情形
  const normalized = filePath.replace(/\\/g, '/');
  const idx = normalized.indexOf('collections/');
  if (idx >= 0) {
    return normalized.slice(idx).replace(/\.(mdx|md)$/i, '');
  }
  return normalized.replace(/\.(mdx|md)$/i, '');
}

/**
 * 解析 ABP 编译产物根目录 (artifacts/abp-packs)
 */
export function resolveAbpArtifactsDir(root: string = findProjectRoot()): string {
  return path.resolve(root, ARTIFACTS_ABP_REL);
}

/**
 * 解析书籍批注与自由画布独立持久化目录 (artifacts/annotations 或打包后 ASTROLIB_ANNOTATIONS_DIR)
 */
export function resolveAnnotationsArtifactsDir(root: string = findProjectRoot()): string {
  if (process.env.ASTROLIB_ANNOTATIONS_DIR) {
    return path.resolve(process.env.ASTROLIB_ANNOTATIONS_DIR);
  }
  return path.resolve(root, ARTIFACTS_ANNOTATIONS_REL);
}

/**
 * 跨平台探测 Electron 桌面端用户数据根目录 (userData/AstroLib)
 */
export function resolveDesktopUserDataRoot(): string {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'AstroLib');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'AstroLib');
  }
  const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(configHome, 'AstroLib');
}

/**
 * 解析用户动态安装的 ABP / EPUB 图书包目录 (兼容桌面端与 astro dev 模式)
 */
export function resolveUserAbpDir(): string | null {
  if (process.env.ASTROLIB_USER_ABP_DIR) {
    const envDir = path.resolve(process.env.ASTROLIB_USER_ABP_DIR);
    return fs.existsSync(envDir) ? envDir : null;
  }
  const desktopAbp = path.join(resolveDesktopUserDataRoot(), 'abp-packs');
  if (fs.existsSync(desktopAbp)) {
    return desktopAbp;
  }
  return null;
}

/**
 * 返回全部存在且可能存放 ABP / EPUB 内容包的物理根目录（按优先级排序去重）
 */
export function resolveAbpPackCandidateDirs(root: string = findProjectRoot()): string[] {
  const candidates: string[] = [];
  const addIfExists = (dir: string | null | undefined) => {
    if (!dir) return;
    const resolved = path.resolve(dir);
    if (!candidates.includes(resolved) && fs.existsSync(resolved)) {
      candidates.push(resolved);
    }
  };

  if (process.env.ASTROLIB_USER_ABP_DIR) {
    addIfExists(process.env.ASTROLIB_USER_ABP_DIR);
  }
  addIfExists(path.join(resolveDesktopUserDataRoot(), 'abp-packs'));
  addIfExists(path.resolve(root, '.tmp', 'dev-abp-packs'));
  addIfExists(resolveAbpArtifactsDir(root));

  return candidates;
}

/**
 * 返回全部存在且可能存放 MinerU 学术文献摄取任务的候选物理目录（按优先级排序去重）
 */
export function resolveIngestCandidateDirs(root: string = findProjectRoot()): string[] {
  const candidates: string[] = [];
  const addIfExists = (dir: string | null | undefined) => {
    if (!dir) return;
    const resolved = path.resolve(dir);
    if (!candidates.includes(resolved) && fs.existsSync(resolved)) {
      candidates.push(resolved);
    }
  };

  if (process.env.ASTROLIB_INGEST_DIR) {
    addIfExists(process.env.ASTROLIB_INGEST_DIR);
  }
  addIfExists(path.join(resolveDesktopUserDataRoot(), 'ingest-tasks'));
  addIfExists(path.resolve(root, 'task', 'ingest'));
  addIfExists(path.resolve(process.cwd(), 'task', 'ingest'));

  return candidates;
}
