import { AbpFormatAdapter } from './abp-adapter.ts';
import { EpubFormatAdapter } from './epub-adapter.ts';
import type { BookNormalizeOptions, IBookFormatAdapter, NormalizedBookResult } from './types.ts';

export class BookFormatRegistry {
  private readonly adapters: IBookFormatAdapter[] = [];

  constructor(initialAdapters: IBookFormatAdapter[] = []) {
    for (const adapter of initialAdapters) {
      this.register(adapter);
    }
  }

  public register(adapter: IBookFormatAdapter): void {
    const idx = this.adapters.findIndex((a) => a.format === adapter.format);
    if (idx >= 0) {
      this.adapters[idx] = adapter;
    } else {
      this.adapters.push(adapter);
    }
  }

  public getSupportedExtensions(): string[] {
    const set = new Set<string>();
    for (const adapter of this.adapters) {
      for (const ext of adapter.extensions) {
        set.add(ext);
      }
    }
    return Array.from(set);
  }

  public resolveAdapter(fileName: string, data?: Uint8Array): IBookFormatAdapter | null {
    for (const adapter of this.adapters) {
      if (adapter.canHandle(fileName, data)) {
        return adapter;
      }
    }
    return null;
  }

  public canHandle(fileName: string, data?: Uint8Array): boolean {
    return this.resolveAdapter(fileName, data) !== null;
  }

  public async normalizeFile(
    fileName: string,
    inputData: ArrayBuffer | Uint8Array,
    options: BookNormalizeOptions = {}
  ): Promise<NormalizedBookResult> {
    const bytes = inputData instanceof Uint8Array
      ? inputData
      : new Uint8Array(inputData);

    const adapter = this.resolveAdapter(fileName, bytes);
    if (!adapter) {
      const supported = this.getSupportedExtensions().join(' / ');
      throw new Error(`暂不支持的书籍格式: ${fileName || '(未知文件)'}（当前支持 ${supported}）`);
    }

    return await adapter.normalize(bytes, {
      ...options,
      fileName: options.fileName || fileName,
    });
  }
}

export const bookFormatRegistry = new BookFormatRegistry([
  new AbpFormatAdapter(),
  new EpubFormatAdapter(),
]);
