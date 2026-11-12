/**
 * src/services/content-provider/web-provider.ts
 * ============================================================================
 * Web 浏览器端内容提供者实现 (PWA / IndexedDB / DecompressionStream)
 * ============================================================================
 */

import type {
  AstroBookManifest,
  AstroBookChapterPayload,
  LibraryCatalog,
  InstalledBookMeta,
} from '../../types/content-package.ts';
import type { IContentProvider, RemoteSourceConfig, StorageStats } from './types.ts';
import { renderReaderPageHtml } from './reader-shell-template.ts';

const DB_NAME = 'astrolib_books_db';
const DB_VERSION = 1;
const STORE_MANIFESTS = 'manifests';
const STORE_CHAPTERS = 'chapters';
const STORE_ASSETS = 'assets';

/**
 * 极简 Promise 封装的 IndexedDB 客户端 (零外部依赖)
 */
class BrowserBookDb {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private static memoryFallback: {
    manifests: Map<string, any>;
    chapters: Map<string, any>;
    assets: Map<string, any>;
  } = {
    manifests: new Map(),
    chapters: new Map(),
    assets: new Map(),
  };

  private get isSupported(): boolean {
    return typeof indexedDB !== 'undefined';
  }

  private openDb(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    if (!this.isSupported) {
      return Promise.reject(new Error('当前环境不支持 IndexedDB'));
    }

    this.dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_MANIFESTS)) {
          db.createObjectStore(STORE_MANIFESTS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_CHAPTERS)) {
          // 键形如: 'math-linear_algebra:01_intro'
          db.createObjectStore(STORE_CHAPTERS, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains(STORE_ASSETS)) {
          // 键形如: 'math-linear_algebra:images/fig_1.png'
          db.createObjectStore(STORE_ASSETS, { keyPath: 'key' });
        }
      };

      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    return this.dbPromise;
  }

  async putManifest(meta: InstalledBookMeta): Promise<void> {
    if (!this.isSupported) {
      BrowserBookDb.memoryFallback.manifests.set(meta.manifest.id, meta);
      return;
    }
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_MANIFESTS, 'readwrite');
      tx.objectStore(STORE_MANIFESTS).put({ id: meta.manifest.id, meta });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getAllManifests(): Promise<InstalledBookMeta[]> {
    if (!this.isSupported) {
      return Array.from(BrowserBookDb.memoryFallback.manifests.values());
    }
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_MANIFESTS, 'readonly');
      const req = tx.objectStore(STORE_MANIFESTS).getAll();
      req.onsuccess = () => {
        const records = req.result || [];
        resolve(records.map((r: any) => r.meta));
      };
      req.onerror = () => reject(req.error);
    });
  }

  async getManifest(bookId: string): Promise<InstalledBookMeta | null> {
    if (!this.isSupported) {
      return BrowserBookDb.memoryFallback.manifests.get(bookId) || null;
    }
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_MANIFESTS, 'readonly');
      const req = tx.objectStore(STORE_MANIFESTS).get(bookId);
      req.onsuccess = () => resolve(req.result ? req.result.meta : null);
      req.onerror = () => reject(req.error);
    });
  }

  async putChapter(bookId: string, chapterSlug: string, payload: AstroBookChapterPayload): Promise<void> {
    if (!this.isSupported) {
      BrowserBookDb.memoryFallback.chapters.set(`${bookId}:${chapterSlug}`, payload);
      return;
    }
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_CHAPTERS, 'readwrite');
      tx.objectStore(STORE_CHAPTERS).put({ key: `${bookId}:${chapterSlug}`, payload });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getChapter(bookId: string, chapterSlug: string): Promise<AstroBookChapterPayload | null> {
    if (!this.isSupported) {
      return BrowserBookDb.memoryFallback.chapters.get(`${bookId}:${chapterSlug}`) || null;
    }
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_CHAPTERS, 'readonly');
      const req = tx.objectStore(STORE_CHAPTERS).get(`${bookId}:${chapterSlug}`);
      req.onsuccess = () => resolve(req.result ? req.result.payload : null);
      req.onerror = () => reject(req.error);
    });
  }

  async deleteBook(bookId: string): Promise<void> {
    if (!this.isSupported) {
      BrowserBookDb.memoryFallback.manifests.delete(bookId);
      for (const k of Array.from(BrowserBookDb.memoryFallback.chapters.keys())) {
        if (k.startsWith(`${bookId}:`)) BrowserBookDb.memoryFallback.chapters.delete(k);
      }
      return;
    }
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_MANIFESTS, STORE_CHAPTERS, STORE_ASSETS], 'readwrite');
      tx.objectStore(STORE_MANIFESTS).delete(bookId);
      const chapStore = tx.objectStore(STORE_CHAPTERS);
      const cursorReq = chapStore.openCursor();
      cursorReq.onsuccess = (e: any) => {
        const cursor = e.target.result;
        if (cursor) {
          if (String(cursor.key).startsWith(`${bookId}:`)) {
            cursor.delete();
          }
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

/**
 * 原生 DecompressionStream / Node 兼容 Gzip 解压
 */
async function decompressGzip(data: ArrayBuffer | Uint8Array): Promise<string> {
  const buffer = data instanceof Uint8Array ? data : new Uint8Array(data);

  if (typeof DecompressionStream !== 'undefined') {
    const ds = new DecompressionStream('gzip');
    const decompressedStream = new Response(buffer).body!.pipeThrough(ds);
    return await new Response(decompressedStream).text();
  }

  // Node 环境兼容回退
  try {
    const modName = 'node:zlib';
    const zlib: any = await import(/* @vite-ignore */ modName);
    const decompressed = zlib.gunzipSync(Buffer.from(buffer));
    return decompressed.toString('utf8');
  } catch (err) {
    throw new Error('当前环境不支持 DecompressionStream 且无法动态载入 zlib');
  }
}

export class WebContentProvider implements IContentProvider {
  private db: BrowserBookDb;
  private memoryCache: Map<string, any> = new Map();

  constructor() {
    this.db = new BrowserBookDb();
  }

  async getInstalledBooks(): Promise<InstalledBookMeta[]> {
    try {
      return await this.db.getAllManifests();
    } catch {
      return [];
    }
  }

  async getBookManifest(colSlug: string, bookSlug: string): Promise<AstroBookManifest | null> {
    const bookId = `${colSlug}-${bookSlug}`;
    const cached = this.memoryCache.get(`manifest:${bookId}`);
    if (cached) return cached;

    try {
      const meta = await this.db.getManifest(bookId);
      if (meta) {
        this.memoryCache.set(`manifest:${bookId}`, meta.manifest);
        return meta.manifest;
      }
    } catch {}

    return null;
  }

  async getChapterPayload(
    colSlug: string,
    bookSlug: string,
    chapterSlug: string
  ): Promise<AstroBookChapterPayload | null> {
    const bookId = `${colSlug}-${bookSlug}`;
    const cacheKey = `chapter:${bookId}:${chapterSlug}`;
    const cached = this.memoryCache.get(cacheKey);
    if (cached) return cached;

    try {
      const payload = await this.db.getChapter(bookId, chapterSlug);
      if (payload) {
        this.memoryCache.set(cacheKey, payload);
        return payload;
      }
    } catch {}

    return null;
  }

  async installBookFromAbp(
    abpData: ArrayBuffer | Uint8Array,
    onProgress?: (percent: number, stageText: string) => void
  ): Promise<InstalledBookMeta> {
    if (onProgress) onProgress(15, '正在解压 .abp 数据包...');

    const jsonText = await decompressGzip(abpData);

    if (onProgress) onProgress(45, '解析书籍目录与章节...');
    const bundle = JSON.parse(jsonText);
    const manifest: AstroBookManifest = bundle.manifest;
    const chapters: Record<string, AstroBookChapterPayload> = bundle.chapters || {};

    if (!manifest || !manifest.id || !manifest.slug) {
      throw new Error('无效的 ABP 数据包：缺少合法 manifest 清单！');
    }

    const meta: InstalledBookMeta = {
      manifest,
      installedAt: new Date().toISOString(),
      sourceType: 'local-file',
    };

    if (onProgress) onProgress(65, '写入本地存储与离线缓存...');
    await this.db.putManifest(meta);

    let count = 0;
    const total = Object.keys(chapters).length;
    let packCache: Cache | null = null;
    if (typeof caches !== 'undefined') {
      try {
        packCache = await caches.open('astrolib-pwa-v1-pack');
      } catch {}
    }

    for (const [slug, payload] of Object.entries(chapters)) {
      await this.db.putChapter(manifest.id, slug, payload);

      if (packCache) {
        try {
          const fullHtml = renderReaderPageHtml(manifest, payload);
          const routePath = `/collections/${manifest.colSlug}/${manifest.slug}/${slug}/`;
          const resp = new Response(fullHtml, {
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
              'X-Astrolib-Abp-Pack': 'true',
            },
          });
          await packCache.put(routePath, resp.clone());
          await packCache.put(routePath.slice(0, -1), resp);
        } catch {}
      }

      count++;
      if (onProgress && total > 0) {
        const pct = 65 + Math.floor((count / total) * 30);
        onProgress(pct, `持久化章节 (${count}/${total})...`);
      }
    }

    this.memoryCache.set(`manifest:${manifest.id}`, manifest);
    if (onProgress) onProgress(100, '安装完成！');
    return meta;
  }

  async removeBook(colSlug: string, bookSlug: string): Promise<boolean> {
    const bookId = `${colSlug}-${bookSlug}`;
    try {
      await this.db.deleteBook(bookId);
      this.memoryCache.delete(`manifest:${bookId}`);
      return true;
    } catch {
      return false;
    }
  }

  async fetchRemoteCatalog(source: RemoteSourceConfig): Promise<LibraryCatalog> {
    let url = source.urlOrRepo;
    if (source.type === 'github-repo' && !source.urlOrRepo.startsWith('/') && !source.urlOrRepo.startsWith('http')) {
      const cleanRepo = source.urlOrRepo.replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '');
      url = `https://raw.githubusercontent.com/${cleanRepo}/main/catalog.json`;
    }

    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(`无法从远程仓库获取 catalog.json (HTTP ${resp.status})`);
    }

    const catalog: LibraryCatalog = await resp.json();
    return catalog;
  }

  async getStorageStats(): Promise<StorageStats> {
    const books = await this.getInstalledBooks();
    let approxBytes = 0;
    for (const b of books) {
      approxBytes += (b.manifest.totalChapters || 1) * 350 * 1024;
    }

    return {
      usedBytes: approxBytes,
      bookCount: books.length,
    };
  }
}
