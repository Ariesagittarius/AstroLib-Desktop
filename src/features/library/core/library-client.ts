/**
 * src/features/library/core/library-client.ts
 * ============================================================================
 * Unified Library Client Adapter (Material 3 Desktop & Dev HTTP Pipeline)
 * ============================================================================
 * 规范：
 * 1. 显式分支：优先桥接 Electron IPC (window.astrolib)，回退至 Dev HTTP (/api/library/)；
 * 2. 纯粹适配器模式：书库状态与远程安装操作统一抽象，杜绝 DOM 内部碎片化 fetch；
 * 3. Ingest 解耦：文档 OCR/摄取流统一由 features/doc-ingestion 承接，书库专注教材包与实体目录。
 * ============================================================================
 */

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
  getEntities(): Promise<UnifiedReadingEntity[]>;
  getShelves(): Promise<LibraryShelf[]>;
  createShelf(name: string): Promise<LibraryShelf>;
  installAbp(buffer: ArrayBuffer): Promise<void>;
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

  public async getEntities(): Promise<UnifiedReadingEntity[]> {
    const bridge = this.getBridge();
    if (bridge && typeof bridge.getLibraryEntities === 'function') {
      return bridge.getLibraryEntities();
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
    const res = await fetch('/api/library/upload-abp', {
      method: 'POST',
      body: buffer,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: Failed to upload ABP package`);
    }
    const data = await res.json();
    if (!data.success) {
      throw new Error(data.error || 'Failed to install ABP package');
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
