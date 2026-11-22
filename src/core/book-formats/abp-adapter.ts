/**
 * src/core/book-formats/abp-adapter.ts
 * ============================================================================
 * 标准 .abp 预编译学术数据包适配器
 * ============================================================================
 */

import {
  AbpInstallError,
  AbpInstallErrorCode,
  validateInstallPayload,
} from '../../services/content-provider/install-validation.ts';
import type { BookNormalizeOptions, IBookFormatAdapter, NormalizedBookResult } from './types.ts';

async function gunzipToUtf8(data: Uint8Array): Promise<string> {
  if (typeof process !== 'undefined' && process.versions?.node) {
    const modName = 'node:zlib';
    const zlib: any = await import(/* @vite-ignore */ modName);
    const out = zlib.gunzipSync(data);
    return out.toString('utf8');
  }

  if (typeof DecompressionStream !== 'undefined') {
    const ds = new DecompressionStream('gzip');
    const copy = new Uint8Array(data.byteLength);
    copy.set(data);
    const stream = new Response(copy).body!.pipeThrough(ds);
    return await new Response(stream).text();
  }

  throw new Error('当前运行时环境不支持 Gzip 解压');
}

export class AbpFormatAdapter implements IBookFormatAdapter {
  public readonly format = 'abp' as const;
  public readonly extensions = ['.abp'] as const;

  public canHandle(fileName: string, data?: Uint8Array): boolean {
    if (fileName && fileName.toLowerCase().endsWith('.abp')) {
      return true;
    }
    // Gzip 魔数 1f 8b
    if (data && data.byteLength >= 2 && data[0] === 0x1f && data[1] === 0x8b) {
      return true;
    }
    return false;
  }

  public async normalize(data: Uint8Array, options: BookNormalizeOptions = {}): Promise<NormalizedBookResult> {
    let jsonText: string;
    try {
      jsonText = await gunzipToUtf8(data);
    } catch (err: any) {
      throw new AbpInstallError(
        AbpInstallErrorCode.INVALID_PAYLOAD,
        `解压 .abp 数据包失败: ${err?.message || String(err)}`
      );
    }

    let rawJson: unknown;
    try {
      rawJson = JSON.parse(jsonText);
    } catch (err: any) {
      throw new AbpInstallError(
        AbpInstallErrorCode.INVALID_PAYLOAD,
        `解析 ABP JSON 失败: ${err?.message || String(err)}`
      );
    }

    const bundle = validateInstallPayload(rawJson);
    if (!bundle.manifest.sourceFormat) {
      bundle.manifest.sourceFormat = 'abp';
    }
    if (!bundle.manifest.readingProfile) {
      bundle.manifest.readingProfile = options.readingProfile || 'academic';
    }

    return {
      bundle,
      sourceFormat: 'abp',
    };
  }
}
