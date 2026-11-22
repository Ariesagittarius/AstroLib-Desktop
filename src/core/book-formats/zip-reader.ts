/**
 * src/core/book-formats/zip-reader.ts
 * ============================================================================
 * 零外部依赖标准 ZIP 只读解析器 (Cross-Platform Node & Browser ZipArchive)
 * ============================================================================
 * 特性：
 * - 纯 TypeScript 实现，不依赖 adm-zip / jszip 等外部库；
 * - 支持 Store (Method 0) 与 Deflate-Raw (Method 8)；
 * - 支持 Node (node:zlib) 与现代浏览器 (DecompressionStream('deflate-raw')) 双端运行；
 * - 严格路径穿越与安全性校验。
 * ============================================================================
 */

export interface ZipEntryMeta {
  fileName: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  crc32: number;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const LOCAL_HEADER_SIGNATURE = 0x04034b50;

const textDecoderUtf8 = new TextDecoder('utf-8', { fatal: false });

export function normalizeZipPath(rawPath: string): string {
  return rawPath
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/');
}

export function isSafeZipEntryPath(entryPath: string): boolean {
  if (!entryPath || entryPath.includes('\0')) return false;
  if (entryPath.startsWith('/') || entryPath.includes(':')) return false;
  const segments = entryPath.split('/');
  if (segments.includes('..')) return false;
  return true;
}

export function resolveZipRelativePath(baseEntryPath: string, relativeHref: string): string {
  const cleanHref = relativeHref.split('#')[0].split('?')[0].trim();
  if (!cleanHref) return '';

  let decodedHref = cleanHref;
  try {
    decodedHref = decodeURIComponent(cleanHref);
  } catch {
    decodedHref = cleanHref;
  }

  const baseDir = baseEntryPath.includes('/')
    ? baseEntryPath.slice(0, baseEntryPath.lastIndexOf('/'))
    : '';

  const combined = decodedHref.startsWith('/')
    ? decodedHref.slice(1)
    : baseDir
      ? `${baseDir}/${decodedHref}`
      : decodedHref;

  const parts = combined.replace(/\\/g, '/').split('/');
  const resolved: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (resolved.length > 0) resolved.pop();
      continue;
    }
    resolved.push(part);
  }
  return resolved.join('/');
}

export function encodeBytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
  }
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

export function decodeBase64ToBytes(base64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(base64, 'base64'));
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function inflateRawBytes(compressed: Uint8Array): Promise<Uint8Array> {
  // Node.js 优先使用原生同步 zlib，速度最快且零流分配开销
  if (typeof process !== 'undefined' && process.versions?.node) {
    const modName = 'node:zlib';
    const zlib: any = await import(/* @vite-ignore */ modName);
    const out = zlib.inflateRawSync(compressed);
    return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
  }

  if (typeof DecompressionStream !== 'undefined') {
    const ds = new DecompressionStream('deflate-raw');
    const copy = new Uint8Array(compressed.byteLength);
    copy.set(compressed);
    const stream = new Response(copy).body!.pipeThrough(ds);
    const ab = await new Response(stream).arrayBuffer();
    return new Uint8Array(ab);
  }

  throw new Error('当前运行时环境不支持 Deflate Raw 解压');
}

export class ZipArchive {
  private readonly bytes: Uint8Array;
  private readonly view: DataView;
  private readonly entries = new Map<string, ZipEntryMeta>();
  private readonly lowerIndex = new Map<string, string>();

  private constructor(bytes: Uint8Array, entriesList: ZipEntryMeta[]) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (const meta of entriesList) {
      this.entries.set(meta.fileName, meta);
      this.lowerIndex.set(meta.fileName.toLowerCase(), meta.fileName);
    }
  }

  public static fromBytes(
    input: ArrayBuffer | Uint8Array,
    options: { strictSafePaths?: boolean } = {}
  ): ZipArchive {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (bytes.byteLength < 22) {
      throw new Error('无效的 ZIP 文件：文件大小不足');
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    // 1. 自尾部查找 End of Central Directory (EOCD) 签名 0x06054b50
    const minSearchOffset = Math.max(0, bytes.byteLength - 65557);
    let eocdOffset = -1;
    for (let i = bytes.byteLength - 22; i >= minSearchOffset; i--) {
      if (view.getUint32(i, true) === EOCD_SIGNATURE) {
        const commentLen = view.getUint16(i + 20, true);
        if (i + 22 + commentLen <= bytes.byteLength) {
          eocdOffset = i;
          break;
        }
      }
    }

    if (eocdOffset < 0) {
      throw new Error('无效的 ZIP 文件：未找到中央目录结束标记 (EOCD)');
    }

    const totalEntries = view.getUint16(eocdOffset + 10, true);
    const centralDirSize = view.getUint32(eocdOffset + 12, true);
    const centralDirOffset = view.getUint32(eocdOffset + 16, true);

    if (centralDirOffset + centralDirSize > bytes.byteLength) {
      throw new Error('无效的 ZIP 文件：中央目录越界');
    }

    // 2. 遍历中央目录条目
    const entriesList: ZipEntryMeta[] = [];
    let cursor = centralDirOffset;
    const endCursor = centralDirOffset + centralDirSize;

    for (let idx = 0; idx < totalEntries && cursor + 46 <= endCursor; idx++) {
      const sig = view.getUint32(cursor, true);
      if (sig !== CENTRAL_DIR_SIGNATURE) {
        break;
      }

      const compressionMethod = view.getUint16(cursor + 10, true);
      const crc32 = view.getUint32(cursor + 16, true);
      const compressedSize = view.getUint32(cursor + 20, true);
      const uncompressedSize = view.getUint32(cursor + 24, true);
      const fileNameLen = view.getUint16(cursor + 28, true);
      const extraLen = view.getUint16(cursor + 30, true);
      const commentLen = view.getUint16(cursor + 32, true);
      const localHeaderOffset = view.getUint32(cursor + 42, true);

      const nameStart = cursor + 46;
      const nameEnd = nameStart + fileNameLen;
      if (nameEnd > bytes.byteLength) break;

      const rawName = textDecoderUtf8.decode(bytes.subarray(nameStart, nameEnd));
      const normalized = normalizeZipPath(rawName);

      if (normalized && !normalized.endsWith('/')) {
        if (!isSafeZipEntryPath(normalized) || rawName.includes('..') || rawName.startsWith('/') || rawName.startsWith('\\') || rawName.includes(':')) {
          if (options.strictSafePaths) {
            throw new Error(`检测到危险 ZIP 路径穿越条目 (ZipSlip): ${rawName}`);
          }
        } else {
          entriesList.push({
            fileName: normalized,
            compressionMethod,
            compressedSize,
            uncompressedSize,
            localHeaderOffset,
            crc32,
          });
        }
      }

      cursor = nameEnd + extraLen + commentLen;
    }

    return new ZipArchive(bytes, entriesList);
  }

  public listEntries(): string[] {
    return Array.from(this.entries.keys());
  }

  public resolveEntryName(entryPath: string): string | null {
    const clean = normalizeZipPath(entryPath);
    if (this.entries.has(clean)) return clean;
    const byLower = this.lowerIndex.get(clean.toLowerCase());
    if (byLower) return byLower;
    try {
      const decoded = normalizeZipPath(decodeURIComponent(clean));
      if (this.entries.has(decoded)) return decoded;
      const decodedLower = this.lowerIndex.get(decoded.toLowerCase());
      if (decodedLower) return decodedLower;
    } catch {}
    return null;
  }

  public hasEntry(entryPath: string): boolean {
    return this.resolveEntryName(entryPath) !== null;
  }

  public getEntryMeta(entryPath: string): ZipEntryMeta | null {
    const resolved = this.resolveEntryName(entryPath);
    return resolved ? this.entries.get(resolved) || null : null;
  }

  public async readEntryBytes(entryPath: string): Promise<Uint8Array> {
    const meta = this.getEntryMeta(entryPath);
    if (!meta) {
      throw new Error(`ZIP 条目不存在: ${entryPath}`);
    }

    const offset = meta.localHeaderOffset;
    if (offset + 30 > this.bytes.byteLength || this.view.getUint32(offset, true) !== LOCAL_HEADER_SIGNATURE) {
      throw new Error(`无效的 ZIP 本地文件头: ${meta.fileName}`);
    }

    const localNameLen = this.view.getUint16(offset + 26, true);
    const localExtraLen = this.view.getUint16(offset + 28, true);
    const dataStart = offset + 30 + localNameLen + localExtraLen;
    const dataEnd = dataStart + meta.compressedSize;

    if (dataEnd > this.bytes.byteLength) {
      throw new Error(`ZIP 条目数据越界: ${meta.fileName}`);
    }

    const compressedSlice = this.bytes.subarray(dataStart, dataEnd);

    if (meta.compressionMethod === 0) {
      return new Uint8Array(compressedSlice);
    }
    if (meta.compressionMethod === 8) {
      return await inflateRawBytes(compressedSlice);
    }

    throw new Error(`不支持的 ZIP 压缩算法 (${meta.compressionMethod}): ${meta.fileName}`);
  }

  public async readEntryText(entryPath: string): Promise<string> {
    const data = await this.readEntryBytes(entryPath);
    return textDecoderUtf8.decode(data);
  }
}
