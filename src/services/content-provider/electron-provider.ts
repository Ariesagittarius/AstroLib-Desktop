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
  private webFallbackInstance: any = null;

  private async getWebFallback(): Promise<any> {
    if (!this.webFallbackInstance) {
      const { WebContentProvider } = await import('./web-provider.ts');
      this.webFallbackInstance = new WebContentProvider();
    }
    return this.webFallbackInstance;
  }

  private get ipc() {
    if (typeof window !== 'undefined' && (window as any).astrolib) {
      return (window as any).astrolib;
    }
    return null;
  }

  async getInstalledBooks(): Promise<InstalledBookMeta[]> {
    let desktopBooks: InstalledBookMeta[] = [];
    if (this.ipc && typeof this.ipc.getInstalledBooks === 'function') {
      try {
        desktopBooks = await this.ipc.getInstalledBooks();
      } catch (err) {
        console.warn('[ElectronContentProvider] 获取桌面端已安装书籍失败:', err);
      }
    }
    // 汇总降级库中的书籍（确保兼容）
    try {
      const web = await this.getWebFallback();
      const webBooks = await web.getInstalledBooks();
      const ids = new Set(desktopBooks.map((b) => b.manifest.id));
      for (const wb of webBooks) {
        if (!ids.has(wb.manifest.id)) {
          desktopBooks.push(wb);
        }
      }
    } catch {}
    return desktopBooks;
  }

  async getBookManifest(colSlug: string, bookSlug: string): Promise<AstroBookManifest | null> {
    if (this.ipc && typeof this.ipc.getBookManifest === 'function') {
      try {
        const res = await this.ipc.getBookManifest(colSlug, bookSlug);
        if (res) return res;
      } catch {}
    }
    const web = await this.getWebFallback();
    return await web.getBookManifest(colSlug, bookSlug);
  }

  async getChapterPayload(
    colSlug: string,
    bookSlug: string,
    chapterSlug: string
  ): Promise<AstroBookChapterPayload | null> {
    if (this.ipc && typeof this.ipc.getChapterPayload === 'function') {
      try {
        const res = await this.ipc.getChapterPayload(colSlug, bookSlug, chapterSlug);
        if (res) return res;
      } catch {}
    }
    const web = await this.getWebFallback();
    return await web.getChapterPayload(colSlug, bookSlug, chapterSlug);
  }

  async installBookFromAbp(
    abpData: ArrayBuffer | Uint8Array,
    onProgress?: (percent: number, stageText: string) => void
  ): Promise<InstalledBookMeta> {
    if (this.ipc && typeof this.ipc.installBookFromAbp === 'function') {
      try {
        if (onProgress) onProgress(30, '正在通过桌面原生通道安装...');
        const meta = await this.ipc.installBookFromAbp(abpData);
        if (onProgress) onProgress(100, '安装完成');
        return meta;
      } catch (err: any) {
        console.error('[ElectronContentProvider] 原生安装失败，尝试降级:', err);
      }
    }

    // 智能双轨降级：使用 WebContentProvider 浏览器 IndexedDB 离线存储与解压
    console.warn('[ElectronContentProvider] 未检测到主进程 IPC 或原生解压异常，自动降级至 Web 存储引擎');
    const web = await this.getWebFallback();
    return await web.installBookFromAbp(abpData, onProgress);
  }

  async removeBook(colSlug: string, bookSlug: string): Promise<boolean> {
    let removed = false;
    if (this.ipc && typeof this.ipc.removeBook === 'function') {
      try {
        removed = await this.ipc.removeBook(colSlug, bookSlug);
      } catch {}
    }
    try {
      const web = await this.getWebFallback();
      await web.removeBook(colSlug, bookSlug);
      removed = true;
    } catch {}
    return removed;
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
