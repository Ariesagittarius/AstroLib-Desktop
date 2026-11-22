/**
 * src/publishing/abp/index.ts
 * ============================================================================
 * AstroLib 独立无头 ABP 编译与校验公共导出
 * ============================================================================
 */

export {
  compileBookToAbp,
  compileMarkdownToSemanticHtml,
  compileMarkdownToSemanticResult,
  parseFrontmatter,
  DEFAULT_ACADEMIC_MODULES,
  DEFAULT_TRACK_CLASSES,
} from './compiler.ts';

export {
  validateMdxFile,
  validateBookDirectory,
  verifyAbpArchive,
} from './validator.ts';

export type {
  BookJsonConfig,
  BookJsonSectionConfig,
  AbpCompileOptions,
  AbpCompileResult,
  MdxValidationCategory,
  MdxValidationIssue,
  MdxValidationReport,
  AbpArchiveVerificationReport,
} from './types.ts';
