import {
  type AbpBundlePayload,
  type AstroBookManifest,
  type AstroBookChapterPayload,
  type LibraryCatalog,
  type InstalledBookMeta,
} from '../../types/content-package.ts';
import {
  validateInstallPayload,
  AbpInstallError,
  AbpInstallErrorCode,
} from './install-validation.ts';
import { bookFormatRegistry } from '../../core/book-formats/registry.ts';
import type { IContentProvider, RemoteSourceConfig, StorageStats } from './types.ts';

const DB_NAME = 'astrolib_books_db';
const DB_VERSION = 1;
const STORE_MANIFESTS = 'manifests';
const STORE_CHAPTERS = 'chapters';
const STORE_ASSETS = 'assets';

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

          db.createObjectStore(STORE_CHAPTERS, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains(STORE_ASSETS)) {

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

  async putAsset(bookId: string, relPath: string, dataBase64: string): Promise<void> {
    if (!this.isSupported) {
      BrowserBookDb.memoryFallback.assets.set(`${bookId}:${relPath}`, dataBase64);
      return;
    }
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_ASSETS, 'readwrite');
      tx.objectStore(STORE_ASSETS).put({ key: `${bookId}:${relPath}`, dataBase64 });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getAsset(bookId: string, relPath: string): Promise<string | null> {
    if (!this.isSupported) {
      return BrowserBookDb.memoryFallback.assets.get(`${bookId}:${relPath}`) || null;
    }
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_ASSETS, 'readonly');
      const req = tx.objectStore(STORE_ASSETS).get(`${bookId}:${relPath}`);
      req.onsuccess = () => resolve(req.result ? req.result.dataBase64 : null);
      req.onerror = () => reject(req.error);
    });
  }

  async deleteBook(bookId: string): Promise<void> {
    if (!this.isSupported) {
      BrowserBookDb.memoryFallback.manifests.delete(bookId);
      for (const k of Array.from(BrowserBookDb.memoryFallback.chapters.keys())) {
        if (k.startsWith(`${bookId}:`)) BrowserBookDb.memoryFallback.chapters.delete(k);
      }
      for (const k of Array.from(BrowserBookDb.memoryFallback.assets.keys())) {
        if (k.startsWith(`${bookId}:`)) BrowserBookDb.memoryFallback.assets.delete(k);
      }
      return;
    }
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_MANIFESTS, STORE_CHAPTERS, STORE_ASSETS], 'readwrite');
      tx.objectStore(STORE_MANIFESTS).delete(bookId);
      const cleanStore = (store: IDBObjectStore) => {
        const cursorReq = store.openCursor();
        cursorReq.onsuccess = (e: any) => {
          const cursor = e.target.result;
          if (cursor) {
            if (String(cursor.key).startsWith(`${bookId}:`)) {
              cursor.delete();
            }
            cursor.continue();
          }
        };
      };
      cleanStore(tx.objectStore(STORE_CHAPTERS));
      cleanStore(tx.objectStore(STORE_ASSETS));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async cleanStaleChapters(bookId: string, validSlugs: Set<string>): Promise<void> {
    if (!this.isSupported) {
      for (const k of Array.from(BrowserBookDb.memoryFallback.chapters.keys())) {
        if (k.startsWith(`${bookId}:`)) {
          const slug = k.slice(bookId.length + 1);
          if (!validSlugs.has(slug)) {
            BrowserBookDb.memoryFallback.chapters.delete(k);
          }
        }
      }
      return;
    }
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_CHAPTERS, 'readwrite');
      const chapStore = tx.objectStore(STORE_CHAPTERS);
      const cursorReq = chapStore.openCursor();
      cursorReq.onsuccess = (e: any) => {
        const cursor = e.target.result;
        if (cursor) {
          const key = String(cursor.key);
          if (key.startsWith(`${bookId}:`)) {
            const slug = key.slice(bookId.length + 1);
            if (!validSlugs.has(slug)) {
              cursor.delete();
            }
          }
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

async function decompressGzip(data: ArrayBuffer | Uint8Array): Promise<string> {
  const buffer = data instanceof Uint8Array ? data : new Uint8Array(data);

  if (typeof DecompressionStream !== 'undefined') {
    const ds = new DecompressionStream('gzip');
    const decompressedStream = new Response(buffer).body!.pipeThrough(ds);
    return await new Response(decompressedStream).text();
  }

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

  async getBookAsset(colSlug: string, bookSlug: string, relPath: string): Promise<string | null> {
    const bookId = `${colSlug}-${bookSlug}`;
    try {
      return await this.db.getAsset(bookId, relPath);
    } catch {
      return null;
    }
  }

  async installBookFromFile(
    fileName: string,
    fileData: ArrayBuffer | Uint8Array,
    onProgress?: (percent: number, stageText: string) => void
  ): Promise<InstalledBookMeta> {
    if (onProgress) onProgress(15, `正在解析书籍 ${fileName}...`);
    const normalized = await bookFormatRegistry.normalizeFile(fileName, fileData);
    return await this.installNormalizedBundle(normalized.bundle, onProgress);
  }

  async installBookFromAbp(
    abpData: ArrayBuffer | Uint8Array,
    onProgress?: (percent: number, stageText: string) => void
  ): Promise<InstalledBookMeta> {
    if (onProgress) onProgress(15, '正在解压 .abp 数据包...');

    let jsonText: string;
    try {
      jsonText = await decompressGzip(abpData);
    } catch (err: any) {
      throw new AbpInstallError(
        AbpInstallErrorCode.INVALID_PAYLOAD,
        `解压 .abp 数据包失败: ${err?.message || String(err)}`
      );
    }

    if (onProgress) onProgress(45, '解析书籍目录与章节...');
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
    return await this.installNormalizedBundle(bundle, onProgress);
  }

  private async installNormalizedBundle(
    bundleInput: AbpBundlePayload,
    onProgress?: (percent: number, stageText: string) => void
  ): Promise<InstalledBookMeta> {
    const bundle = validateInstallPayload(bundleInput);
    const manifest: AstroBookManifest = bundle.manifest;
    const chapters: Record<string, AstroBookChapterPayload> = bundle.chapters || {};
    const assets: Record<string, string> = bundle.assets || {};

    const meta: InstalledBookMeta = {
      manifest,
      installedAt: new Date().toISOString(),
      sourceType: 'local-file',
    };

    try {
      if (onProgress) onProgress(60, '持久化章节数据...');

      let count = 0;
      const total = Object.keys(chapters).length;

      for (const [slug, payload] of Object.entries(chapters)) {
        await this.db.putChapter(manifest.id, slug, payload);
        count++;
        if (onProgress && total > 0) {
          const pct = 60 + Math.floor((count / total) * 20);
          onProgress(pct, `持久化章节 (${count}/${total})...`);
        }
      }

      const assetEntries = Object.entries(assets);
      if (assetEntries.length > 0) {
        if (onProgress) onProgress(82, '写入书籍配图与字体资源...');
        for (const [relPath, b64] of assetEntries) {
          await this.db.putAsset(manifest.id, relPath, b64);
        }
      }

      if (onProgress) onProgress(88, '提交书籍主清单...');
      await this.db.putManifest(meta);

      if (onProgress) onProgress(94, '清理过时章节...');
      await this.db.cleanStaleChapters(manifest.id, new Set(Object.keys(chapters)));

      const validSlugs = new Set(Object.keys(chapters));
      for (const k of Array.from(this.memoryCache.keys())) {
        if (k.startsWith(`chapter:${manifest.id}:`)) {
          const slug = k.slice(`chapter:${manifest.id}:`.length);
          if (!validSlugs.has(slug)) {
            this.memoryCache.delete(k);
          }
        }
      }

      this.memoryCache.set(`manifest:${manifest.id}`, manifest);

      if (onProgress) onProgress(100, '安装完成！');
      return meta;
    } catch (err: any) {

      try {
        await this.db.deleteBook(manifest.id);
        this.memoryCache.delete(`manifest:${manifest.id}`);
        for (const k of Array.from(this.memoryCache.keys())) {
          if (k.startsWith(`chapter:${manifest.id}:`)) {
            this.memoryCache.delete(k);
          }
        }
      } catch {}

      throw err;
    }
  }

  async installToDisk(): Promise<never> {
    throw new AbpInstallError(
      AbpInstallErrorCode.OPERATION_NOT_SUPPORTED,
      'Web 浏览器环境不支持写入本地文件系统磁盘'
    );
  }

  async removeBook(colSlug: string, bookSlug: string): Promise<boolean> {
    const bookId = `${colSlug}-${bookSlug}`;
    try {
      await this.db.deleteBook(bookId);
      this.memoryCache.delete(`manifest:${bookId}`);
      for (const k of Array.from(this.memoryCache.keys())) {
        if (k.startsWith(`chapter:${bookId}:`)) {
          this.memoryCache.delete(k);
        }
      }
      if (typeof caches !== 'undefined') {
        await caches.delete('astrolib-pwa-v1-pack').catch(() => {});
      }
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
    let usedBytes = 0;

    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      try {
        const est = await navigator.storage.estimate();
        if (typeof est.usage === 'number') {
          usedBytes = est.usage;
        }
      } catch {}
    }

    if (usedBytes === 0 && books.length > 0) {
      for (const b of books) {
        const sumFromSections = (b.manifest.sections || []).reduce(
          (acc, sec) => acc + (sec.chapters || []).reduce((cAcc, ch) => cAcc + (ch.sizeBytes || 0), 0),
          0
        );
        usedBytes += sumFromSections || JSON.stringify(b.manifest).length;
      }
    }

    return {
      usedBytes,
      bookCount: books.length,
    };
  }
}
