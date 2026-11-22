import type { UnifiedReadingEntity, LibraryShelf } from '../../../types/library-entity';

export interface OfficialCatalogBook {
  id: string;
  title: string;
  author?: string;
  publisher?: string;
  totalChapters?: number;
  sizeBytes?: number;
  contentHash?: string;
  packFileName?: string;
  remotePackUrl?: string;
}

export interface OfficialCatalog {
  sourceUrl?: string;
  releaseTag?: string;
  books: OfficialCatalogBook[];
}

export interface ILibraryClient {
  isElectron(): boolean;
  getEntities(forceRefresh?: boolean): Promise<UnifiedReadingEntity[]>;
  getShelves(): Promise<LibraryShelf[]>;
  createShelf(name: string): Promise<LibraryShelf>;
  installAbp(buffer: ArrayBuffer): Promise<void>;
  installBookFile(fileName: string, buffer: ArrayBuffer): Promise<void>;
  deletePaperTask(taskId: string): Promise<void>;
  fetchOfficialCatalog(): Promise<OfficialCatalog>;
  getInstalledBooks(): Promise<any[]>;
  installOfficialBook(entry: OfficialCatalogBook): Promise<void>;
}

export class LibraryClient implements ILibraryClient {
  private getBridge(): any | null {
    if (typeof window !== 'undefined' && (window as any).astrolib) {
      return (window as any).astrolib;
    }
    return null;
  }

  public isElectron(): boolean {
    return Boolean(this.getBridge());
  }

  public async getEntities(forceRefresh = false): Promise<UnifiedReadingEntity[]> {
    const bridge = this.getBridge();
    if (bridge && typeof bridge.getLibraryEntities === 'function') {
      return bridge.getLibraryEntities(forceRefresh);
    }
    const res = await fetch('/api/library/entities');
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: Failed to fetch entities`);
    }
    const data = await res.json();
    return Array.isArray(data.entities) ? data.entities : [];
  }

  public async getShelves(): Promise<LibraryShelf[]> {
    const bridge = this.getBridge();
    if (bridge && typeof bridge.getLibraryShelves === 'function') {
      return bridge.getLibraryShelves();
    }
    const res = await fetch('/api/library/shelves');
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: Failed to fetch shelves`);
    }
    const data = await res.json();
    return Array.isArray(data.shelves) ? data.shelves : [];
  }

  public async createShelf(name: string): Promise<LibraryShelf> {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new Error('Shelf name cannot be empty');
    }
    const bridge = this.getBridge();
    if (bridge && typeof bridge.createLibraryShelf === 'function') {
      return bridge.createLibraryShelf(trimmed);
    }
    const res = await fetch('/api/library/shelves', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: trimmed }),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: Failed to create shelf`);
    }
    const data = await res.json();
    if (!data.shelf) {
      throw new Error('Server returned invalid shelf payload');
    }
    return data.shelf;
  }

  public async installAbp(buffer: ArrayBuffer): Promise<void> {
    const bridge = this.getBridge();
    if (bridge && typeof bridge.installBookFromAbp === 'function') {
      await bridge.installBookFromAbp(buffer);
      return;
    }
    if (bridge && typeof bridge.installBookFromFile === 'function') {
      await bridge.installBookFromFile('book.abp', buffer);
      return;
    }
    const res = await fetch('/api/library/upload-abp', {
      method: 'POST',
      body: buffer,
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `HTTP ${res.status}: Failed to upload ABP package`);
    }
    const data = await res.json();
    if (!data.success) {
      throw new Error(data.error || 'Failed to install ABP package');
    }
  }

  public async installBookFile(fileName: string, buffer: ArrayBuffer): Promise<void> {
    const safeName = (fileName || 'book.abp').trim();
    if (safeName.toLowerCase().endsWith('.abp')) {
      return this.installAbp(buffer);
    }
    const bridge = this.getBridge();
    if (bridge && typeof bridge.installBookFromFile === 'function') {
      await bridge.installBookFromFile(safeName, buffer);
      return;
    }
    const res = await fetch('/api/library/upload-book', {
      method: 'POST',
      headers: {
        'x-file-name': encodeURIComponent(safeName),
      },
      body: buffer,
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `HTTP ${res.status}: 上传书籍文件失败`);
    }
    const data = await res.json();
    if (!data.success) {
      throw new Error(data.error || '安装书籍文件失败');
    }
  }

  public async deletePaperTask(taskId: string): Promise<void> {
    const res = await fetch(`/api/ingest/task?taskId=${encodeURIComponent(taskId)}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `HTTP ${res.status}: 删除文献失败`);
    }
  }

  public async fetchOfficialCatalog(): Promise<OfficialCatalog> {
    const bridge = this.getBridge();
    if (bridge && typeof bridge.fetchOfficialCatalog === 'function') {
      return bridge.fetchOfficialCatalog();
    }
    const res = await fetch('/abp-packs/catalog.json');
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: Failed to fetch catalog.json`);
    }
    return res.json();
  }

  public async getInstalledBooks(): Promise<any[]> {
    const bridge = this.getBridge();
    if (bridge && typeof bridge.getInstalledBooks === 'function') {
      return bridge.getInstalledBooks();
    }
    return [];
  }

  public async installOfficialBook(entry: OfficialCatalogBook): Promise<void> {
    const bridge = this.getBridge();
    if (bridge && typeof bridge.installOfficialBook === 'function') {
      await bridge.installOfficialBook(entry);
      return;
    }
    const packUrl = entry.remotePackUrl || `/abp-packs/${entry.packFileName}`;
    const packRes = await fetch(packUrl);
    if (!packRes.ok) {
      throw new Error(`HTTP ${packRes.status} (${packUrl})`);
    }
    const buf = await packRes.arrayBuffer();
    await this.installAbp(buf);
  }
}

export const libraryClient = new LibraryClient();
