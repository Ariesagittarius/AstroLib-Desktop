import {
  validateAbpBundle,
  type AbpBundlePayload,
  type AstroBookManifest,
  type AstroBookChapterPayload,
} from '../../types/content-package.ts';

export const AbpInstallErrorCode = {
  INVALID_PAYLOAD: 'INVALID_PAYLOAD',
  SCHEMA_MISMATCH: 'SCHEMA_MISMATCH',
  MANIFEST_CORRUPT: 'MANIFEST_CORRUPT',
  CHAPTER_MISSING: 'CHAPTER_MISSING',
  CHAPTER_SLUG_MISMATCH: 'CHAPTER_SLUG_MISMATCH',
  CHAPTER_PATH_INVALID: 'CHAPTER_PATH_INVALID',
  PATH_TRAVERSAL_DETECTED: 'PATH_TRAVERSAL_DETECTED',
  OPERATION_NOT_SUPPORTED: 'OPERATION_NOT_SUPPORTED',
} as const;

export type AbpInstallErrorCodeType =
  (typeof AbpInstallErrorCode)[keyof typeof AbpInstallErrorCode];

export class AbpInstallError extends Error {
  readonly code: AbpInstallErrorCodeType;

  constructor(code: AbpInstallErrorCodeType, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'AbpInstallError';
    this.code = code;
  }
}

export function isSafeRelativePath(relPath: string): boolean {
  if (!relPath || typeof relPath !== 'string') return false;
  if (relPath.includes('\0')) return false;

  if (relPath.includes('\\')) return false;

  const segments = relPath.split('/');
  if (segments.includes('..')) return false;

  if (relPath.startsWith('/')) return false;

  if (relPath.includes(':')) return false;

  if (relPath.includes('//')) return false;
  return true;
}

export function isSafeSlug(slug: string): boolean {
  if (!isSafeRelativePath(slug)) return false;
  if (slug.endsWith('/')) return false;
  return true;
}

export function isSafeIdentifier(id: string): boolean {
  if (!isSafeSlug(id)) return false;
  if (id.includes('/')) return false;
  return true;
}

export function validateInstallPayload(raw: unknown): AbpBundlePayload {

  let bundle: AbpBundlePayload;
  try {
    bundle = validateAbpBundle(raw);
  } catch (err: any) {
    const msg = err?.message || String(err);
    let code: AbpInstallErrorCodeType = AbpInstallErrorCode.SCHEMA_MISMATCH;
    if (msg.includes('缺少入口章节') || msg.includes('不存在的章节')) {
      code = AbpInstallErrorCode.CHAPTER_MISSING;
    } else if (msg.includes('缺少合法') || msg.includes('缺少 manifest') || msg.includes('sections 必须为数组')) {
      code = AbpInstallErrorCode.MANIFEST_CORRUPT;
    } else if (msg.includes('根节点必须为 JSON 对象')) {
      code = AbpInstallErrorCode.INVALID_PAYLOAD;
    }
    throw new AbpInstallError(code, `ABP 数据包校验失败: ${msg}`);
  }

  const manifest = bundle.manifest;

  if (!isSafeIdentifier(manifest.colSlug) || !isSafeIdentifier(manifest.slug)) {
    throw new AbpInstallError(
      AbpInstallErrorCode.PATH_TRAVERSAL_DETECTED,
      `书籍标识包含非法或路径逃逸字符: colSlug=${String(manifest.colSlug)}, slug=${String(manifest.slug)}`
    );
  }

  const expectedBookKey = `${manifest.colSlug}-${manifest.slug}`;
  if (!isSafeIdentifier(expectedBookKey)) {
    throw new AbpInstallError(
      AbpInstallErrorCode.PATH_TRAVERSAL_DETECTED,
      `书籍复合键包含非法字符: ${expectedBookKey}`
    );
  }

  if (!isSafeSlug(manifest.entryPoint)) {
    throw new AbpInstallError(
      AbpInstallErrorCode.PATH_TRAVERSAL_DETECTED,
      `入口章节 entryPoint 包含非法或路径逃逸字符: ${manifest.entryPoint}`
    );
  }

  if (!Object.prototype.hasOwnProperty.call(bundle.chapters, manifest.entryPoint)) {
    throw new AbpInstallError(
      AbpInstallErrorCode.CHAPTER_MISSING,
      `入口章节不存在于 chapters 数据字典: ${manifest.entryPoint}`
    );
  }

  for (const [slugKey, payload] of Object.entries(bundle.chapters)) {
    if (!isSafeSlug(slugKey)) {
      throw new AbpInstallError(
        AbpInstallErrorCode.PATH_TRAVERSAL_DETECTED,
        `章节键包含非法或逃逸字符: ${slugKey}`
      );
    }

    if (payload.chapterSlug !== slugKey) {
      throw new AbpInstallError(
        AbpInstallErrorCode.CHAPTER_SLUG_MISMATCH,
        `章节键与载荷内部 chapterSlug 不一致: key='${slugKey}', chapterSlug='${payload.chapterSlug}'`
      );
    }

    if ((payload as any).path) {
      const expectedPath = `chapters/${slugKey}.json`;
      if ((payload as any).path !== expectedPath) {
        throw new AbpInstallError(
          AbpInstallErrorCode.CHAPTER_PATH_INVALID,
          `章节载荷 path 属性不符合规范: 实际='${(payload as any).path}', 期望='${expectedPath}'`
        );
      }
    }
  }

  for (const sec of manifest.sections || []) {
    if (sec.introSlug) {
      if (!isSafeSlug(sec.introSlug)) {
        throw new AbpInstallError(
          AbpInstallErrorCode.PATH_TRAVERSAL_DETECTED,
          `清单引用了包含非法字符的导语章节 slug: ${sec.introSlug}`
        );
      }
      if (!Object.prototype.hasOwnProperty.call(bundle.chapters, sec.introSlug)) {
        throw new AbpInstallError(
          AbpInstallErrorCode.CHAPTER_MISSING,
          `清单声明的导语章节缺失实体数据: ${sec.introSlug}`
        );
      }
    }
    for (const ch of sec.chapters || []) {
      if (!isSafeSlug(ch.slug)) {
        throw new AbpInstallError(
          AbpInstallErrorCode.PATH_TRAVERSAL_DETECTED,
          `清单引用了包含非法字符的章节 slug: ${ch.slug}`
        );
      }

      if (!Object.prototype.hasOwnProperty.call(bundle.chapters, ch.slug)) {
        throw new AbpInstallError(
          AbpInstallErrorCode.CHAPTER_MISSING,
          `清单声明的章节缺失实体数据: ${ch.slug}`
        );
      }

      const expectedPath = `chapters/${ch.slug}.json`;
      if (ch.path !== expectedPath) {
        throw new AbpInstallError(
          AbpInstallErrorCode.CHAPTER_PATH_INVALID,
          `清单章节 path 属性不符合规范: 实际='${ch.path}', 期望='${expectedPath}'`
        );
      }
    }
  }

  if (bundle.assets && typeof bundle.assets === 'object') {
    for (const relPath of Object.keys(bundle.assets)) {
      if (!isSafeRelativePath(relPath)) {
        throw new AbpInstallError(
          AbpInstallErrorCode.PATH_TRAVERSAL_DETECTED,
          `资源文件路径包含非法或逃逸字符: ${relPath}`
        );
      }
    }
  }

  if (bundle.exercises && typeof bundle.exercises === 'object') {
    for (const relPath of Object.keys(bundle.exercises)) {
      if (!isSafeRelativePath(relPath)) {
        throw new AbpInstallError(
          AbpInstallErrorCode.PATH_TRAVERSAL_DETECTED,
          `习题数据路径包含非法或逃逸字符: ${relPath}`
        );
      }
    }
  }

  return bundle;
}
