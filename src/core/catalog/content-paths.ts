/**
 * src/core/catalog/content-paths.ts
 * ============================================================================
 * 内容源与 ABP 产物路径单一可信解析器 (Canonical Content & Artifact Paths)
 * ============================================================================
 */

import path from 'node:path';

export const CONTENT_SOURCES_REL = 'content-sources';
export const CONTENT_COLLECTIONS_REL = 'content-sources/collections';
export const ARTIFACTS_ABP_REL = 'artifacts/abp-packs';
/**
 * 发布投影目录清单（Generated Projection Only）：
 * 由 scripts/pack-book-abp.mjs 从 src/config/collections.config.ts#sourceCollections 投影生成，
 * 严禁作为人工维护源或运行时读取源（遵循 Rule 3 / Rule 4）。
 */
export const CONTENT_CATALOG_REL = 'content-sources/catalog.json';

/**
 * 解析教材源码根目录 (content-sources/collections)
 */
export function resolveCollectionsRoot(root: string = process.cwd()): string {
  return path.resolve(root, CONTENT_COLLECTIONS_REL);
}

/**
 * 解析指定合集与书目的源码目录 (content-sources/collections/<col>/<book>)
 */
export function resolveBookSourceDir(
  colSlug: string,
  bookSlug: string,
  root: string = process.cwd()
): string {
  return path.resolve(root, CONTENT_COLLECTIONS_REL, colSlug, bookSlug);
}

/**
 * 将磁盘上的章节文件路径规范化为相对 collections 根的路径（含 collections/ 前缀），
 * 用以生成与路由 `/collections/<col>/<book>/<cleanSlug>/` 对齐的 rawSlug。
 */
export function toCollectionRelativeSlug(
  filePath: string,
  root: string = process.cwd()
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
export function resolveAbpArtifactsDir(root: string = process.cwd()): string {
  return path.resolve(root, ARTIFACTS_ABP_REL);
}
