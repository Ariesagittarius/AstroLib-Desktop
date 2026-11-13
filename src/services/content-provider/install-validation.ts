/**
 * src/services/content-provider/install-validation.ts
 * ============================================================================
 * AstroLib ABP 书籍包安装统一校验引擎 (Single Source of Install Validation)
 * ============================================================================
 * 遵循架构规范：
 * - Layer 3 (Service & Validation Engine)
 * - 集中收敛全站所有端（Electron / Web / Dev Server）的 ABP 安装校验逻辑
 * - 结合 validateAbpBundle 基础 Schema 校验，深度执行一致性、完备性与路径安全防护
 * - 遵循 Rule 3 (Source of Truth), Rule 6 (Feature Isolation) & ADR-LIBRARY-CONTRACT
 * ============================================================================
 */

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

/**
 * 校验路径/slug 是否安全，防范目录穿越、绝对路径、Windows 盘符逃逸与特殊注入字符
 */
export function isSafeRelativePath(relPath: string): boolean {
  if (!relPath || typeof relPath !== 'string') return false;
  if (relPath.includes('\0')) return false;
  // 严禁反斜杠
  if (relPath.includes('\\')) return false;
  // 严禁目录穿越 ..
  const segments = relPath.split('/');
  if (segments.includes('..')) return false;
  // 严禁以 / 开头（绝对路径）
  if (relPath.startsWith('/')) return false;
  // 严禁盘符 (如 C: 或带有冒号)
  if (relPath.includes(':')) return false;
  // 严禁空段 (如 a//b)
  if (relPath.includes('//')) return false;
  return true;
}

/**
 * 校验章节 slug 是否安全合规
 */
export function isSafeSlug(slug: string): boolean {
  if (!isSafeRelativePath(slug)) return false;
  if (slug.endsWith('/')) return false;
  return true;
}

/**
 * 校验单一标识符（如 colSlug, bookSlug, bookKey，严禁含层级斜杠）
 */
export function isSafeIdentifier(id: string): boolean {
  if (!isSafeSlug(id)) return false;
  if (id.includes('/')) return false;
  return true;
}

/**
 * 全站统一的 ABP 安装载荷校验入口
 * @param raw 未经解包验证的任意输入对象
 * @returns 经过严格 Schema 校验、完备性对齐与路径安全检查的 AbpBundlePayload
 * @throws {AbpInstallError} 校验失败时抛出带显式 code 的错误
 */
export function validateInstallPayload(raw: unknown): AbpBundlePayload {
  // 1. 基础 Schema 与必要字段校验
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

  // 2. 书籍基本标识安全校验 (colSlug, slug, id)
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

  // 3. 入口章节有效性与安全性校验
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

  // 4. 章节键值与载荷一致性校验
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

  // 5. 清单分区与章节引用的一致性、完备性校验
  for (const sec of manifest.sections || []) {
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

  // 6. 配图资源路径安全校验
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

  // 7. 习题等自包含数据路径安全校验
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
