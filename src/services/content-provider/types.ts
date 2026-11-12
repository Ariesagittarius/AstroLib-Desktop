/**
 * src/services/content-provider/types.ts
 * ============================================================================
 * AstroLib 多级存储与内容提供者引擎 (Content Provider Interface & Types)
 * ============================================================================
 * 遵循架构规范：
 * - Layer 3 (Service Abstraction)
 * - 统一屏蔽 Web (PWA / IndexedDB / CacheStorage) 与 Electron (Node.js FS / IPC)
 * - 遵循 Rule 1 (UI is not a domain model) & Rule 7 (Utils purity)
 * ============================================================================
 */

import type {
  AstroBookManifest,
  AstroBookChapterPayload,
  LibraryCatalog,
  InstalledBookMeta,
} from '../../types/content-package.ts';

export interface StorageStats {
  usedBytes: number;
  bookCount: number;
  availableBytes?: number;
}

export interface RemoteSourceConfig {
  id: string;
  name: string;
  type: 'github-repo' | 'cdn-url' | 'custom-api';
  urlOrRepo: string; // e.g. 'Ariesagittarius/AstroLib-Books' 或 'https://cdn.example.com/books'
  enabled: boolean;
  isOfficial?: boolean;
}

export interface IContentProvider {
  /**
   * 获取当前本地已安装的书籍列表
   */
  getInstalledBooks(): Promise<InstalledBookMeta[]>;

  /**
   * 获取指定合集与书籍的主清单
   */
  getBookManifest(colSlug: string, bookSlug: string): Promise<AstroBookManifest | null>;

  /**
   * 获取指定章节的有效负载 (语义 HTML + 大纲)
   */
  getChapterPayload(
    colSlug: string,
    bookSlug: string,
    chapterSlug: string
  ): Promise<AstroBookChapterPayload | null>;

  /**
   * 导入并安装单个 .abp 预编译包 (支持 ArrayBuffer / Uint8Array)
   */
  installBookFromAbp(
    abpData: ArrayBuffer | Uint8Array,
    onProgress?: (percent: number, stageText: string) => void
  ): Promise<InstalledBookMeta>;

  /**
   * 卸载/删除已安装的书籍
   */
  removeBook(colSlug: string, bookSlug: string): Promise<boolean>;

  /**
   * 连接并拉取远程书库目录清单 (如 GitHub 仓库或 CDN)
   */
  fetchRemoteCatalog(source: RemoteSourceConfig): Promise<LibraryCatalog>;

  /**
   * 获取当前端侧存储使用情况统计
   */
  getStorageStats(): Promise<StorageStats>;
}
