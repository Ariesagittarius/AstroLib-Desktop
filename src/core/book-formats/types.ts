import type {
  AbpBundlePayload,
  BookSourceFormat,
  ReadingProfile,
} from '../../types/content-package.ts';

export interface BookNormalizeOptions {

  fileName?: string;

  preferredCollection?: string;

  readingProfile?: ReadingProfile;

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

  canHandle(fileName: string, data?: Uint8Array): boolean;

  normalize(data: Uint8Array, options?: BookNormalizeOptions): Promise<NormalizedBookResult>;
}
