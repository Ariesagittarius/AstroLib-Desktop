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
import { mapIngestTaskToEntityStatus } from '../../src/features/library/core/entity-status.ts';

interface IngestTaskMetaLite {
  taskId: string;
  fileName: string;
  status: string;
  progress?: number;
  error?: string;
  engine?: string;
  createdAt?: number;
  fileSize?: number;
  pageCount?: number;
  pageRanges?: string;
}

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
    this.invalidateCache();
    try {
      fs.writeFileSync(this.registryFile, JSON.stringify(this.store, null, 2), 'utf8');
    } catch (err) {
      console.error('[DesktopLibraryManager] 保存注册表失败:', err);
    }
  }

  /**
   * 获取所有可能存放文献摄取任务的候选物理目录
   */
  private getIngestCandidateDirs(): string[] {
    const candidates: string[] = [];
    if (process.env.ASTROLIB_INGEST_DIR) {
      const envDir = path.resolve(process.env.ASTROLIB_INGEST_DIR);
      if (!candidates.includes(envDir)) candidates.push(envDir);
    }
    try {
      const userDataDir = path.join(app.getPath('userData'), 'ingest-tasks');
      if (!candidates.includes(userDataDir)) candidates.push(userDataDir);
    } catch {}
    if (this.projectRoot) {
      const projTaskDir = path.resolve(this.projectRoot, 'task/ingest');
      if (!candidates.includes(projTaskDir)) candidates.push(projTaskDir);
    }
    const cwdTaskDir = path.resolve(process.cwd(), 'task/ingest');
    if (!candidates.includes(cwdTaskDir)) candidates.push(cwdTaskDir);
    try {
      const exeDir = path.dirname(app.getPath('exe'));
      const devRootTaskDir = path.resolve(exeDir, '../../task/ingest');
      if (!candidates.includes(devRootTaskDir)) candidates.push(devRootTaskDir);
    } catch {}

    return candidates.filter((dir) => fs.existsSync(dir));
  }

  private entitiesCache: { data: UnifiedReadingEntity[]; expiresAt: number } | null = null;
  private entitiesInFlight: Promise<UnifiedReadingEntity[]> | null = null;
  private readonly entitiesCacheTtlMs = 3000;

  public invalidateCache(): void {
    this.entitiesCache = null;
  }

  /**
   * 聚合获取全库统一实体 (书籍 + 文献)，附带 3 秒短期内存缓存与并发去重
   */
  public async getAllEntities(forceRefresh = false): Promise<UnifiedReadingEntity[]> {
    const now = Date.now();
    if (!forceRefresh && this.entitiesCache && now < this.entitiesCache.expiresAt) {
      return this.entitiesCache.data;
    }
    if (forceRefresh) {
      this.entitiesCache = null;
    }
    if (!forceRefresh && this.entitiesInFlight) {
      return this.entitiesInFlight;
    }

    this.entitiesInFlight = this.scanAllEntities().finally(() => {
      this.entitiesInFlight = null;
    });
    const result = await this.entitiesInFlight;
    this.entitiesCache = { data: result, expiresAt: Date.now() + this.entitiesCacheTtlMs };
    return result;
  }

  private async scanAllEntities(): Promise<UnifiedReadingEntity[]> {
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
          author: m.author || '',
          publisher: m.publisher || '',
          cover: m.cover || '/favicon.png',
          category: m.colSlug || 'general',
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
            sourceFormat: m.sourceFormat || 'abp',
            readingProfile: m.readingProfile || (m.sourceFormat === 'epub' ? 'literary' : 'academic'),
          },
        });
      }

    } catch (err) {
      console.error('[DesktopLibraryManager] 聚合书籍失败:', err);
    }

    // 2. 聚合 MinerU 解析的学术文献（异步并行目录扫描，避免同步 IO 卡死主线程）
    try {
      const candidateDirs = this.getIngestCandidateDirs();
      const taskMap = new Map<string, IngestTaskMetaLite>();

      const dirResults = await Promise.all(
        candidateDirs.map(async (baseDir) => {
          try {
            const entries = await fs.promises.readdir(baseDir, { withFileTypes: true });
            const taskEntries = entries.filter((ent) => ent.isDirectory() && ent.name.startsWith('task_'));
            const metas = await Promise.all(
              taskEntries.map(async (ent) => {
                const metaPath = path.join(baseDir, ent.name, 'meta.json');
                try {
                  const raw = await fs.promises.readFile(metaPath, 'utf8');
                  return JSON.parse(raw) as IngestTaskMetaLite;
                } catch {
                  return null;
                }
              })
            );
            return metas;
          } catch {
            return [];
          }
        })
      );

      for (const metas of dirResults) {
        for (const parsed of metas) {
          if (!parsed || !parsed.taskId) continue;
          const prev = taskMap.get(parsed.taskId);
          if (prev && prev.status === 'completed') continue;
          taskMap.set(parsed.taskId, parsed);
        }
      }

      const taskManager = TaskManager.getInstance();
      const tasks = Array.from(taskMap.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      for (const t of tasks) {
        const entityId = `paper:${t.taskId}`;
        const userMeta = this.store.customMeta[entityId] || {};

        const mappedStatus = mapIngestTaskToEntityStatus(t, taskManager.isJobActive(t.taskId));

        // 智能提取干净文献名（去除 .pdf 扩展名）
        const cleanName = t.fileName.replace(/\.pdf$/i, '');

        entities.push({
          id: entityId,
          kind: 'paper',
          title: cleanName,
          subtitle: `PDF 学术文献 · ${t.engine === 'api' ? '云端 MinerU' : t.engine === 'agent' ? 'Agent 通道' : '本地加速引擎'}`,
          author: 'MinerU 学术摄取',
          publisher: '学术文献库',
          cover: '/astrolib-logo.webp',
          category: 'paper',
          shelfId: userMeta.shelfId,
          createdAt: t.createdAt || Date.now(),
          lastReadAt: userMeta.lastReadAt,
          readProgress: userMeta.readProgress || 0,
          status: mappedStatus.status,
          statusMessage: mappedStatus.statusMessage,
          metadata: {
            taskId: t.taskId,
            originPdfUrl: `/api/ingest/pdf?taskId=${t.taskId}`,
            markdownUrl: `/api/ingest/result?taskId=${t.taskId}`,
            hasBookmarks: true,
            hasAnnotations: true,
            fileSizeBytes: t.fileSize,
            totalPages: t.pageCount,
            pageRanges: t.pageRanges,
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
