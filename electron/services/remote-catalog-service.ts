/**
 * electron/services/remote-catalog-service.ts
 * ============================================================================
 * AstroLib 官方 Release 书库拉取与完整性校验安装服务 (Mode A Distribution)
 * ============================================================================
 */

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

function assertHttpUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`无效的发行资产地址: ${rawUrl}`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`不支持的发行资产协议 (${parsed.protocol}): ${rawUrl}`);
  }
  return parsed.toString();
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
    catalog = await resp.json();
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

  const abpBuffer = Buffer.from(await resp.arrayBuffer());

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
