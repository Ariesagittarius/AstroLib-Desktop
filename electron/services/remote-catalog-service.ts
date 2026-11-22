import zlib from 'node:zlib';
import {
  ABP_SCHEMA_VERSION,
  validateAbpBundle,
  type CatalogBookEntry,
  type InstalledBookMeta,
  type LibraryCatalog,
} from '../../src/types/content-package.ts';
import {
  DEFAULT_DESKTOP_RELEASE_REPO,
  buildReleaseCatalogUrl,
  buildReleasePackUrl,
} from '../../src/config/release.config.ts';
import type { DesktopBookManager } from './book-manager.ts';

const MAX_CATALOG_BYTES = 5 * 1024 * 1024;
const MAX_PACK_BYTES = 20 * 1024 * 1024;

function assertHttpUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`无效的发行资产地址: ${rawUrl}`);
  }
  const isHttps = parsed.protocol === 'https:';
  const isLoopbackHttp =
    parsed.protocol === 'http:' &&
    (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost');
  if (!isHttps && !isLoopbackHttp) {
    throw new Error(`不支持的非安全发行资产协议 (${parsed.protocol}): ${rawUrl}`);
  }
  return parsed.toString();
}

async function readResponseBufferWithCap(resp: Response, maxBytes: number, urlForErr: string): Promise<Buffer> {
  const lenHeader = resp.headers.get('content-length');
  if (lenHeader) {
    const declaredLen = Number(lenHeader);
    if (Number.isFinite(declaredLen) && declaredLen > maxBytes) {
      throw new Error(`远端响应体积超出上限 (${declaredLen} > ${maxBytes} bytes): ${urlForErr}`);
    }
  }
  if (!resp.body) {
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.byteLength > maxBytes) {
      throw new Error(`远端响应体积超出上限 (${buf.byteLength} > ${maxBytes} bytes): ${urlForErr}`);
    }
    return buf;
  }
  const reader = resp.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          throw new Error(`远端响应体积流式超出上限 (> ${maxBytes} bytes): ${urlForErr}`);
        }
        chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
      }
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

export async function fetchOfficialCatalog(customUrl?: string): Promise<LibraryCatalog> {
  const targetUrl = assertHttpUrl(customUrl || buildReleaseCatalogUrl(DEFAULT_DESKTOP_RELEASE_REPO));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  let resp: Response;
  try {
    resp = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'AstroLib-Desktop-App',
        Accept: 'application/json',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
  } catch (err: any) {
    throw new Error(`拉取官方书库目录失败 [URL=${targetUrl}]: ${err?.message || err}`);
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    throw new Error(`拉取官方书库目录失败 [URL=${targetUrl}, HTTP=${resp.status} ${resp.statusText}]`);
  }

  let catalog: any;
  try {
    const rawBuf = await readResponseBufferWithCap(resp, MAX_CATALOG_BYTES, targetUrl);
    catalog = JSON.parse(rawBuf.toString('utf8'));
  } catch (err: any) {
    throw new Error(`解析官方书库目录 JSON 失败 [URL=${targetUrl}]: ${err?.message || err}`);
  }

  if (!catalog || typeof catalog !== 'object' || !Array.isArray(catalog.books)) {
    throw new Error(`官方书库目录格式非法 [URL=${targetUrl}]: 缺少 books 数组`);
  }
  if (catalog.schemaVersion && catalog.schemaVersion !== ABP_SCHEMA_VERSION) {
    throw new Error(
      `官方书库契约版本不兼容 [expected=${ABP_SCHEMA_VERSION}, actual=${catalog.schemaVersion}, URL=${targetUrl}]`
    );
  }

  return catalog as LibraryCatalog;
}

export async function installOfficialBook(
  entry: CatalogBookEntry,
  bookManager: DesktopBookManager
): Promise<InstalledBookMeta> {
  if (!entry || typeof entry !== 'object' || !entry.packFileName) {
    throw new Error('无效的官方书目条目：缺少 packFileName');
  }

  const downloadUrl = assertHttpUrl(
    entry.remotePackUrl || buildReleasePackUrl(entry.packFileName, DEFAULT_DESKTOP_RELEASE_REPO)
  );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);

  let resp: Response;
  try {
    resp = await fetch(downloadUrl, {
      headers: {
        'User-Agent': 'AstroLib-Desktop-App',
        Accept: 'application/octet-stream, application/gzip, */*',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
  } catch (err: any) {
    throw new Error(`下载教材包失败 [URL=${downloadUrl}]: ${err?.message || err}`);
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    throw new Error(`下载教材包失败 [URL=${downloadUrl}, HTTP=${resp.status} ${resp.statusText}]`);
  }

  const abpBuffer = await readResponseBufferWithCap(resp, MAX_PACK_BYTES, downloadUrl);

  if (typeof entry.sizeBytes === 'number' && entry.sizeBytes > 0 && abpBuffer.byteLength !== entry.sizeBytes) {
    throw new Error(
      `教材包体积校验失败 [${entry.id}: expected=${entry.sizeBytes}, actual=${abpBuffer.byteLength}, URL=${downloadUrl}]`
    );
  }

  let parsedBundle: ReturnType<typeof validateAbpBundle>;
  try {
    const jsonText = zlib.gunzipSync(abpBuffer).toString('utf8');
    parsedBundle = validateAbpBundle(JSON.parse(jsonText));
  } catch (err: any) {
    throw new Error(`教材包载荷校验失败 [${entry.id}, URL=${downloadUrl}]: ${err?.message || err}`);
  }

  if (
    entry.contentHash &&
    parsedBundle.manifest.contentHash &&
    entry.contentHash !== parsedBundle.manifest.contentHash
  ) {
    throw new Error(
      `教材包内容哈希校验失败 [${entry.id}: expected=${entry.contentHash}, actual=${parsedBundle.manifest.contentHash}]`
    );
  }

  return bookManager.installBookFromAbp(abpBuffer);
}
