/**
 * src/core/book-formats/types.ts
 * ============================================================================
 * 格式无关书籍归一化适配层契约 (Book Format Adapter Contract)
 * ============================================================================
 * 遵循 Rule 1 & Rule 7：
 * - 纯 TypeScript 接口声明，严禁依赖 DOM 或 UI 组件；
 * - 将外部格式 (.abp / .epub / 未来扩展格式) 在导入边界归一化为统一标准内容包。
 * ============================================================================
 */

import type {
  AbpBundlePayload,
  BookSourceFormat,
  ReadingProfile,
} from '../../types/content-package.ts';

export interface BookNormalizeOptions {
  /** 原始文件名（用于推断 slug、标题兜底或格式识别） */
  fileName?: string;
  /** 可选指定归入的合集 slug（如 'acg', 'literature', 'aesthetics', 'math'） */
  preferredCollection?: string;
  /** 可选显式指定默认阅读体裁 */
  readingProfile?: ReadingProfile;
  /** 是否保留原始文件归档（默认 true，供后续重编译或原包导出使用） */
  keepOriginalArchive?: boolean;
}

export interface NormalizedSourceArchive {
  fileName: string;
  bytes: Uint8Array;
}

export interface NormalizedBookResult {
  bundle: AbpBundlePayload;
  sourceFormat: BookSourceFormat;
  sourceArchive?: NormalizedSourceArchive;
}

export interface IBookFormatAdapter {
  readonly format: BookSourceFormat;
  readonly extensions: readonly string[];

  /**
   * 判断该适配器是否可处理当前文件
   */
  canHandle(fileName: string, data?: Uint8Array): boolean;

  /**
   * 将输入二进制数据归一化为标准 AbpBundlePayload
   */
  normalize(data: Uint8Array, options?: BookNormalizeOptions): Promise<NormalizedBookResult>;
}
