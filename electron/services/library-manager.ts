/**
 * electron/services/library-manager.ts
 * ============================================================================
 * AstroLib 统一研读实体与书库聚合管理服务 (Unified Library Manager)
 * ============================================================================
 * 职责：
 * 1. 同级化聚合「ABP 教材书籍」与「MinerU 学术文献/论文」，构建一等公民实体池；
 * 2. 维护持久化用户书架、自建分类与阅读进度 (library-registry.json)；
 * 3. 配合 IPC 与 RESTful 接口向前端提供统一的书库数据源。
 * ============================================================================
 */

import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import type {
  UnifiedReadingEntity,
  LibraryShelf,
  ReadingEntityKind,
} from '../../src/types/library-entity.ts';
import { DesktopBookManager } from './book-manager.ts';
import { TaskManager } from '../../src/server/plugins/doc-ingestion/task-manager.ts';

interface RegistryStore {
  shelves: LibraryShelf[];
  customMeta: Record<
    string,
    {
      shelfId?: string;
      lastReadAt?: number;
      readProgress?: number;
      favorite?: boolean;
    }
  >;
}

export class DesktopLibraryManager {
  private static instance: DesktopLibraryManager | null = null;
  private readonly registryFile: string;
  private readonly bookManager: DesktopBookManager;
  private readonly projectRoot: string;
  private store: RegistryStore = {
    shelves: [],
    customMeta: {},
  };

  constructor(bookManager: DesktopBookManager, projectRoot: string) {
    this.bookManager = bookManager;
    this.projectRoot = projectRoot;
    const userDataDir = app.getPath('userData');
    this.registryFile = path.join(userDataDir, 'library-registry.json');
    this.loadStore();
  }

  public static getInstance(bookManager?: DesktopBookManager, projectRoot?: string): DesktopLibraryManager {
    if (!DesktopLibraryManager.instance) {
      if (!bookManager) {
        const defaultAbpDir = path.join(app.getPath('userData'), 'abp-packs');
        bookManager = new DesktopBookManager(defaultAbpDir);
      }
      DesktopLibraryManager.instance = new DesktopLibraryManager(bookManager, projectRoot || process.cwd());
    }
    return DesktopLibraryManager.instance;
  }

  private loadStore(): void {
    try {
      if (fs.existsSync(this.registryFile)) {
        const raw = fs.readFileSync(this.registryFile, 'utf8');
        this.store = JSON.parse(raw);
      } else {
        // 初始化默认书架
        this.store = {
          shelves: [
            { id: 'shelf-math-core', name: '数学基础核心', itemCount: 0, createdAt: Date.now() },
            { id: 'shelf-papers-unread', name: '待研读文献', itemCount: 0, createdAt: Date.now() },
          ],
          customMeta: {},
        };
        this.saveStore();
      }
    } catch (err) {
      console.error('[DesktopLibraryManager] 加载注册表失败，重置为空:', err);
    }
  }

  private saveStore(): void {
    try {
      fs.writeFileSync(this.registryFile, JSON.stringify(this.store, null, 2), 'utf8');
    } catch (err) {
      console.error('[DesktopLibraryManager] 保存注册表失败:', err);
    }
  }

  /**
   * 聚合获取全库统一实体 (书籍 + 文献)
   */
  public async getAllEntities(): Promise<UnifiedReadingEntity[]> {
    const entities: UnifiedReadingEntity[] = [];

    // 1. 聚合已安装的 ABP 书籍
    try {
      const installedBooks = await this.bookManager.getInstalledBooks();
      for (const b of installedBooks) {
        const m = b.manifest;
        const entityId = `book:${m.colSlug}-${m.slug}`;
        const userMeta = this.store.customMeta[entityId] || {};

        entities.push({
          id: entityId,
          kind: 'book',
          title: m.title,
          subtitle: m.description || '',
          author: m.author || 'AstroLib 编委会',
          publisher: m.publisher || '高等教育出版社',
          cover: m.cover || '/favicon.png',
          category: m.colSlug || 'math',
          shelfId: userMeta.shelfId,
          createdAt: (b.installedAt ? Date.parse(b.installedAt) : 0) || (m.updatedAt ? Date.parse(m.updatedAt) : 0) || Date.now(),
          lastReadAt: userMeta.lastReadAt,
          readProgress: userMeta.readProgress || 0,
          status: 'ready',
          metadata: {
            colSlug: m.colSlug,
            bookSlug: m.slug,
            entryPoint: m.entryPoint || 'chapter-01',
            abpPackPath: `/abp-packs/${m.colSlug}-${m.slug}`,
            edition: m.edition,
            isbn: m.isbn,
          },
        });
      }

      // 若用户目录下书籍较少，从工程 public/abp-packs/catalog.json 补充内置可选书籍
      const catalogPath = path.join(this.projectRoot, 'public', 'abp-packs', 'catalog.json');
      if (fs.existsSync(catalogPath)) {
        try {
          const cat = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
          for (const cb of cat.books || []) {
            const entityId = `book:${cb.colSlug}-${cb.slug}`;
            if (!entities.some((e) => e.id === entityId)) {
              const userMeta = this.store.customMeta[entityId] || {};
              entities.push({
                id: entityId,
                kind: 'book',
                title: cb.title,
                subtitle: cb.subtitle || '',
                author: cb.author || 'AstroLib',
                publisher: cb.publisher || '高等教育出版社',
                cover: cb.cover || '/favicon.png',
                category: cb.colSlug || 'math',
                shelfId: userMeta.shelfId,
                createdAt: Date.now() - 86400000 * 10,
                lastReadAt: userMeta.lastReadAt,
                readProgress: userMeta.readProgress || 0,
                status: 'ready',
                metadata: {
                  colSlug: cb.colSlug,
                  bookSlug: cb.slug,
                  entryPoint: cb.entryPoint || 'chapter-01',
                  abpPackPath: `/abp-packs/${cb.colSlug}-${cb.slug}`,
                  edition: cb.edition,
                  isbn: cb.isbn,
                },
              });
            }
          }
        } catch {}
      }
    } catch (err) {
      console.error('[DesktopLibraryManager] 聚合书籍失败:', err);
    }

    // 2. 聚合 MinerU 解析的学术文献
    try {
      const taskMgr = TaskManager.getInstance();
      const tasks = taskMgr.listTasks();
      for (const t of tasks) {
        const entityId = `paper:${t.taskId}`;
        const userMeta = this.store.customMeta[entityId] || {};

        let entityStatus: 'ready' | 'processing' | 'error' = 'ready';
        let statusMsg = '';
        if (t.status === 'completed') {
          entityStatus = 'ready';
        } else if (t.status === 'failed') {
          entityStatus = 'error';
          statusMsg = t.error || '解析失败';
        } else {
          entityStatus = 'processing';
          statusMsg = `MinerU 解析中 ${t.progress || 0}%`;
        }

        // 智能提取干净文献名（去除 .pdf 扩展名）
        const cleanName = t.fileName.replace(/\.pdf$/i, '');

        entities.push({
          id: entityId,
          kind: 'paper',
          title: cleanName,
          subtitle: `PDF 学术文献 · ${t.engine === 'api' ? '云端 MinerU' : '本地加速引擎'}`,
          author: 'MinerU 学术摄取',
          publisher: '学术文献库',
          cover: '/astrolib-logo.webp',
          category: 'paper',
          shelfId: userMeta.shelfId,
          createdAt: t.createdAt || Date.now(),
          lastReadAt: userMeta.lastReadAt,
          readProgress: userMeta.readProgress || 0,
          status: entityStatus,
          statusMessage: statusMsg,
          metadata: {
            taskId: t.taskId,
            originPdfUrl: `/api/ingest/pdf?taskId=${t.taskId}`,
            markdownUrl: `/api/ingest/result?taskId=${t.taskId}`,
            hasBookmarks: true,
            hasAnnotations: true,
            fileSizeBytes: t.fileSize,
            totalPages: t.pageCount,
          },
        });
      }
    } catch (err) {
      console.error('[DesktopLibraryManager] 聚合文献任务失败:', err);
    }

    // 按最近阅读与创建时间倒序排列
    return entities.sort((a, b) => {
      const aTime = a.lastReadAt || a.createdAt;
      const bTime = b.lastReadAt || b.createdAt;
      return bTime - aTime;
    });
  }

  public getShelves(): LibraryShelf[] {
    return this.store.shelves;
  }

  public createShelf(name: string): LibraryShelf {
    const newShelf: LibraryShelf = {
      id: `shelf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: name.trim(),
      itemCount: 0,
      createdAt: Date.now(),
    };
    this.store.shelves.push(newShelf);
    this.saveStore();
    return newShelf;
  }

  public removeShelf(shelfId: string): boolean {
    this.store.shelves = this.store.shelves.filter((s) => s.id !== shelfId);
    for (const key of Object.keys(this.store.customMeta)) {
      if (this.store.customMeta[key]?.shelfId === shelfId) {
        delete this.store.customMeta[key].shelfId;
      }
    }
    this.saveStore();
    return true;
  }

  public updateEntityMeta(
    entityId: string,
    updates: {
      shelfId?: string | null;
      lastReadAt?: number;
      readProgress?: number;
      favorite?: boolean;
    }
  ): void {
    if (!this.store.customMeta[entityId]) {
      this.store.customMeta[entityId] = {};
    }
    const current = this.store.customMeta[entityId];
    if (updates.shelfId !== undefined) {
      if (updates.shelfId === null) {
        delete current.shelfId;
      } else {
        current.shelfId = updates.shelfId;
      }
    }
    if (updates.lastReadAt !== undefined) current.lastReadAt = updates.lastReadAt;
    if (updates.readProgress !== undefined) current.readProgress = updates.readProgress;
    if (updates.favorite !== undefined) current.favorite = updates.favorite;
    this.saveStore();
  }
}
