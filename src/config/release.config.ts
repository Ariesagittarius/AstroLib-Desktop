export const DEFAULT_DESKTOP_RELEASE_REPO =
  (typeof process !== 'undefined' && process.env?.ASTROLIB_RELEASE_REPO) || 'Ariesagittarius/AstroLib-Desktop';

export function normalizeReleaseRepo(repo?: string): string {
  const raw = (repo || DEFAULT_DESKTOP_RELEASE_REPO).trim();
  return raw.replace(/^https?:\/\/github\.com\//i, '').replace(/\/+$/, '');
}

export function buildReleaseBaseUrl(repo?: string, releaseTag?: string): string {
  const cleanRepo = normalizeReleaseRepo(repo);
  const tag = releaseTag?.trim();
  if (tag && tag !== 'latest') {
    return `https://github.com/${cleanRepo}/releases/download/${encodeURIComponent(tag)}`;
  }
  return `https://github.com/${cleanRepo}/releases/latest/download`;
}

export function buildReleaseCatalogUrl(repo?: string, releaseTag?: string): string {
  return `${buildReleaseBaseUrl(repo, releaseTag)}/catalog.json`;
}

export function buildReleasePackUrl(
  packFileName: string,
  repo?: string,
  releaseTag?: string
): string {
  const safeName = encodeURIComponent(packFileName.trim());
  return `${buildReleaseBaseUrl(repo, releaseTag)}/${safeName}`;
}
