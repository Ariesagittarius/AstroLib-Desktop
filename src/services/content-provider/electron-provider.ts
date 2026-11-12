/**
 * src/services/content-provider/electron-provider.ts
 * ============================================================================
 * Electron 桌面端内容提供者实现 (Node.js FS / IPC Bridge)
 * ============================================================================
 */

import type {
  AstroBookManifest,
  AstroBookChapterPayload,
  LibraryCatalog,
  InstalledBookMeta,
} from '../../types/content-package.ts';
import type { IContentProvider, RemoteSourceConfig, StorageStats } from './types.ts';

export class ElectronContentProvider implements IContentProvider {
  private get ipc() {
    if (typeof window !== 'undefined' && (window as any).astrolib) {
      return (window as any).astrolib;
    }
    return null;
  }

  private requireIpc() {
    const bridge = this.ipc;
    if (!bridge) {
      throw new Error('未检测到 Electron 桌面端 IPC 桥接接口');
    }
    return bridge;
  }

  async getInstalledBooks(): Promise<InstalledBookMeta[]> {
    const bridge = this.requireIpc();
    if (typeof bridge.getInstalledBooks !== 'function') {
      throw new Error('Electron IPC 缺少 getInstalledBooks 方法');
    }
    return await bridge.getInstalledBooks();
  }

  async getBookManifest(colSlug: string, bookSlug: string): Promise<AstroBookManifest | null> {
    const bridge = this.requireIpc();
    if (typeof bridge.getBookManifest !== 'function') {
      throw new Error('Electron IPC 缺少 getBookManifest 方法');
    }
    return await bridge.getBookManifest(colSlug, bookSlug);
  }

  async getChapterPayload(
    colSlug: string,
    bookSlug: string,
    chapterSlug: string
  ): Promise<AstroBookChapterPayload | null> {
    const bridge = this.requireIpc();
    if (typeof bridge.getChapterPayload !== 'function') {
      throw new Error('Electron IPC 缺少 getChapterPayload 方法');
    }
    return await bridge.getChapterPayload(colSlug, bookSlug, chapterSlug);
  }

  async installBookFromAbp(
    abpData: ArrayBuffer | Uint8Array,
    onProgress?: (percent: number, stageText: string) => void
  ): Promise<InstalledBookMeta> {
    const bridge = this.requireIpc();
    if (typeof bridge.installBookFromAbp !== 'function') {
      throw new Error('Electron IPC 缺少 installBookFromAbp 方法');
    }
    if (onProgress) onProgress(30, '正在通过桌面原生通道安装...');
    const meta = await bridge.installBookFromAbp(abpData);
    if (onProgress) onProgress(100, '安装完成');
    return meta;
  }

  async removeBook(colSlug: string, bookSlug: string): Promise<boolean> {
    const bridge = this.requireIpc();
    if (typeof bridge.removeBook !== 'function') {
      throw new Error('Electron IPC 缺少 removeBook 方法');
    }
    return await bridge.removeBook(colSlug, bookSlug);
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
    if (this.ipc && typeof this.ipc.getStorageStats === 'function') {
      return await this.ipc.getStorageStats();
    }
    return {
      usedBytes: 0,
      bookCount: 0,
    };
  }
}
