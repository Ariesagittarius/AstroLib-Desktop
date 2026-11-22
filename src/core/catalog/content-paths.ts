import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CONTENT_SOURCES_REL = 'content-sources';
export const CONTENT_COLLECTIONS_REL = 'content-sources/collections';
export const ARTIFACTS_ABP_REL = 'artifacts/abp-packs';
export const ARTIFACTS_ANNOTATIONS_REL = 'artifacts/annotations';

export const CONTENT_CATALOG_REL = 'content-sources/catalog.json';

let cachedProjectRoot: string | null = null;

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

export function resolveCollectionsRoot(root: string = findProjectRoot()): string {
  return path.resolve(root, CONTENT_COLLECTIONS_REL);
}

export function resolveBookSourceDir(
  colSlug: string,
  bookSlug: string,
  root: string = findProjectRoot()
): string {
  return path.resolve(root, CONTENT_COLLECTIONS_REL, colSlug, bookSlug);
}

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

  const normalized = filePath.replace(/\\/g, '/');
  const idx = normalized.indexOf('collections/');
  if (idx >= 0) {
    return normalized.slice(idx).replace(/\.(mdx|md)$/i, '');
  }
  return normalized.replace(/\.(mdx|md)$/i, '');
}

export function resolveAbpArtifactsDir(root: string = findProjectRoot()): string {
  return path.resolve(root, ARTIFACTS_ABP_REL);
}

export function resolveAnnotationsArtifactsDir(root: string = findProjectRoot()): string {
  if (process.env.ASTROLIB_ANNOTATIONS_DIR) {
    return path.resolve(process.env.ASTROLIB_ANNOTATIONS_DIR);
  }
  return path.resolve(root, ARTIFACTS_ANNOTATIONS_REL);
}

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
