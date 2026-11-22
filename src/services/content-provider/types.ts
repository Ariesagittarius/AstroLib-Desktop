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
  urlOrRepo: string;
  enabled: boolean;
  isOfficial?: boolean;
}

export interface IContentProvider {

  getInstalledBooks(): Promise<InstalledBookMeta[]>;

  getBookManifest(colSlug: string, bookSlug: string): Promise<AstroBookManifest | null>;

  getChapterPayload(
    colSlug: string,
    bookSlug: string,
    chapterSlug: string
  ): Promise<AstroBookChapterPayload | null>;

  installBookFromAbp(
    abpData: ArrayBuffer | Uint8Array,
    onProgress?: (percent: number, stageText: string) => void
  ): Promise<InstalledBookMeta>;

  installBookFromFile?(
    fileName: string,
    fileData: ArrayBuffer | Uint8Array,
    onProgress?: (percent: number, stageText: string) => void
  ): Promise<InstalledBookMeta>;

  removeBook(colSlug: string, bookSlug: string): Promise<boolean>;

  fetchRemoteCatalog(source: RemoteSourceConfig): Promise<LibraryCatalog>;

  getStorageStats(): Promise<StorageStats>;
}
