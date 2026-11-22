import fs from 'node:fs';
import path from 'node:path';
import {
  ANP_SCHEMA_VERSION,
  createEmptyChapterAnnotationPayload,
  mergeChapterAnnotationPayloads,
  validateAnpPackage,
  type AstroNotePackagePayload,
  type BookAnnotationItem,
  type ChapterAnnotationPayload,
  type ChapterCanvasNote,
  type InkAnchorMode,
  type InkPoint,
} from '../../types/annotation-package.ts';
import { resolveAnnotationsArtifactsDir } from '../catalog/content-paths.ts';
import { sanitizeAcademicHtml } from '../security/html-sanitizer.ts';

export interface NodeBoxRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function toAnchoredInkPoint(params: {
  clientX: number;
  clientY: number;
  pressure: number;
  nodeRect: NodeBoxRect;
  anchorMode: InkAnchorMode;
  zoomScale: number;
  tiltX?: number;
  tiltY?: number;
  t?: number;
}): InkPoint {
  const safeZoom = params.zoomScale > 0.05 ? params.zoomScale : 1;
  const safeW = params.nodeRect.width > 1 ? params.nodeRect.width : 1;
  const safeH = params.nodeRect.height > 1 ? params.nodeRect.height : 1;

  if (params.anchorMode === 'node-relative') {
    return {
      u: Number(((params.clientX - params.nodeRect.left) / safeW).toFixed(6)),
      v: Number(((params.clientY - params.nodeRect.top) / safeH).toFixed(6)),
      pressure: Number(Math.max(0.05, Math.min(1, params.pressure)).toFixed(4)),
      ...(params.tiltX !== undefined ? { tiltX: params.tiltX } : {}),
      ...(params.tiltY !== undefined ? { tiltY: params.tiltY } : {}),
      ...(params.t !== undefined ? { t: params.t } : {}),
    };
  }

  return {
    u: Number(((params.clientX - params.nodeRect.left) / safeZoom).toFixed(3)),
    v: Number(((params.clientY - params.nodeRect.top) / safeZoom).toFixed(3)),
    pressure: Number(Math.max(0.05, Math.min(1, params.pressure)).toFixed(4)),
    ...(params.tiltX !== undefined ? { tiltX: params.tiltX } : {}),
    ...(params.tiltY !== undefined ? { tiltY: params.tiltY } : {}),
    ...(params.t !== undefined ? { t: params.t } : {}),
  };
}

export function projectInkPointToContainer(params: {
  point: InkPoint;
  anchorMode: InkAnchorMode;
  nodeRect: NodeBoxRect;
  containerRect: NodeBoxRect;
  zoomScale: number;
}): { x: number; y: number } {
  const safeZoom = params.zoomScale > 0.05 ? params.zoomScale : 1;
  if (params.anchorMode === 'node-relative') {
    const absX = params.nodeRect.left + params.point.u * params.nodeRect.width;
    const absY = params.nodeRect.top + params.point.v * params.nodeRect.height;
    return {
      x: (absX - params.containerRect.left) / safeZoom,
      y: (absY - params.containerRect.top) / safeZoom,
    };
  }

  const absX = params.nodeRect.left + params.point.u * safeZoom;
  const absY = params.nodeRect.top + params.point.v * safeZoom;
  return {
    x: (absX - params.containerRect.left) / safeZoom,
    y: (absY - params.containerRect.top) / safeZoom,
  };
}

function assertSafePathPart(segment: string, label: string): string {
  const normalized = segment.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!normalized || normalized.includes('..') || path.isAbsolute(normalized)) {
    throw new Error(`非法的${label}标识: ${segment}`);
  }
  return normalized;
}

export class AnnotationStorageService {
  private static instance: AnnotationStorageService | null = null;
  private baseDir: string;
  private chapterCache = new Map<string, ChapterAnnotationPayload>();
  private readonly maxCacheEntries = 64;
  private writeChains = new Map<string, Promise<void>>();
  private ensuredDirs = new Set<string>();

  public static getInstance(): AnnotationStorageService {
    if (!AnnotationStorageService.instance) {
      AnnotationStorageService.instance = new AnnotationStorageService();
    }
    return AnnotationStorageService.instance;
  }

  constructor(customBaseDir?: string) {
    this.baseDir = customBaseDir ? path.resolve(customBaseDir) : resolveAnnotationsArtifactsDir();
  }

  public getBaseDir(): string {
    return this.baseDir;
  }

  private getBookDir(colSlug: string, bookSlug: string): string {
    const safeCol = assertSafePathPart(colSlug, '合集');
    const safeBook = assertSafePathPart(bookSlug, '图书').replace(/\//g, '_');
    return path.join(this.baseDir, `${safeCol}-${safeBook}`);
  }

  private getChapterFilePath(colSlug: string, bookSlug: string, chapterSlug: string): string {
    const bookDir = this.getBookDir(colSlug, bookSlug);
    const cleanChap = assertSafePathPart(
      chapterSlug.replace(/^collections\/[^/]+\/[^/]+\//, '').replace(/\.(mdx|md)$/i, ''),
      '章节'
    );
    const resolved = path.resolve(bookDir, `${cleanChap}.json`);
    const baseDir = path.resolve(bookDir);
    const rel = path.relative(baseDir, resolved);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`非法章节批注路径逃逸: ${chapterSlug}`);
    }
    return resolved;
  }

  private sanitizeCanvasNoteHtml(canvasNote: ChapterCanvasNote): ChapterCanvasNote {
    if (!canvasNote || !Array.isArray(canvasNote.blocks)) {
      return canvasNote;
    }
    return {
      ...canvasNote,
      blocks: canvasNote.blocks.map((block) => {
        if (block?.astRef && typeof block.astRef.renderedHtml === 'string') {
          return {
            ...block,
            astRef: {
              ...block.astRef,
              renderedHtml: sanitizeAcademicHtml(block.astRef.renderedHtml),
            },
          };
        }
        return block;
      }),
    };
  }

  private getCachedPayload(filePath: string): ChapterAnnotationPayload | undefined {
    const hit = this.chapterCache.get(filePath);
    if (!hit) return undefined;
    this.chapterCache.delete(filePath);
    this.chapterCache.set(filePath, hit);
    return hit;
  }

  private setCachedPayload(filePath: string, payload: ChapterAnnotationPayload): void {
    if (this.chapterCache.has(filePath)) {
      this.chapterCache.delete(filePath);
    } else if (this.chapterCache.size >= this.maxCacheEntries) {
      const oldestKey = this.chapterCache.keys().next().value;
      if (oldestKey !== undefined) this.chapterCache.delete(oldestKey);
    }
    this.chapterCache.set(filePath, payload);
  }

  private ensureDirSync(dirPath: string): void {
    if (this.ensuredDirs.has(dirPath)) return;
    fs.mkdirSync(dirPath, { recursive: true });
    this.ensuredDirs.add(dirPath);
  }

  private async ensureDirAsync(dirPath: string): Promise<void> {
    if (this.ensuredDirs.has(dirPath)) return;
    await fs.promises.mkdir(dirPath, { recursive: true });
    this.ensuredDirs.add(dirPath);
  }

  private buildNextPayload(
    colSlug: string,
    bookSlug: string,
    chapterSlug: string,
    updates: Partial<ChapterAnnotationPayload>
  ): ChapterAnnotationPayload {
    const existing = this.getChapterAnnotations(colSlug, bookSlug, chapterSlug, updates.chapterTitle);
    const now = new Date().toISOString();
    const nextCanvasNote = updates.canvasNote
      ? this.sanitizeCanvasNoteHtml({
          ...updates.canvasNote,
          chapterSlug: existing.chapterSlug,
          updatedAt: updates.canvasNote.updatedAt || now,
        })
      : existing.canvasNote;
    return {
      schemaVersion: ANP_SCHEMA_VERSION,
      colSlug: existing.colSlug,
      bookSlug: existing.bookSlug,
      chapterSlug: existing.chapterSlug,
      chapterTitle: updates.chapterTitle || existing.chapterTitle,
      annotations: Array.isArray(updates.annotations) ? updates.annotations : existing.annotations,
      canvasNote: nextCanvasNote,
      updatedAt: now,
    };
  }

  private buildCanvasNoteUpdates(
    chapterSlug: string,
    canvasNote: ChapterCanvasNote,
    chapterTitle?: string
  ): Partial<ChapterAnnotationPayload> {
    return {
      chapterTitle,
      canvasNote: {
        ...canvasNote,
        chapterSlug: chapterSlug.replace(/^collections\/[^/]+\/[^/]+\//, '').replace(/\.(mdx|md)$/i, ''),
        updatedAt: new Date().toISOString(),
      },
    };
  }

  public getChapterAnnotations(
    colSlug: string,
    bookSlug: string,
    chapterSlug: string,
    chapterTitle?: string
  ): ChapterAnnotationPayload {
    const filePath = this.getChapterFilePath(colSlug, bookSlug, chapterSlug);
    const cached = this.getCachedPayload(filePath);
    if (cached) {
      if (chapterTitle && !cached.chapterTitle) {
        return { ...cached, chapterTitle };
      }
      return cached;
    }

    const cleanChap = chapterSlug.replace(/^collections\/[^/]+\/[^/]+\//, '').replace(/\.(mdx|md)$/i, '');
    if (!fs.existsSync(filePath)) {
      return createEmptyChapterAnnotationPayload(colSlug, bookSlug, cleanChap, chapterTitle);
    }

    try {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Partial<ChapterAnnotationPayload>;
      const fallback = createEmptyChapterAnnotationPayload(colSlug, bookSlug, cleanChap, chapterTitle);
      const payload: ChapterAnnotationPayload = {
        schemaVersion: ANP_SCHEMA_VERSION,
        colSlug: raw.colSlug || colSlug,
        bookSlug: raw.bookSlug || bookSlug,
        chapterSlug: raw.chapterSlug || cleanChap,
        chapterTitle: raw.chapterTitle || chapterTitle,
        annotations: Array.isArray(raw.annotations) ? raw.annotations : [],
        canvasNote: raw.canvasNote && Array.isArray(raw.canvasNote.blocks) && Array.isArray(raw.canvasNote.strokes)
          ? raw.canvasNote
          : fallback.canvasNote,
        updatedAt: raw.updatedAt || fallback.updatedAt,
      };
      this.setCachedPayload(filePath, payload);
      return payload;
    } catch {
      return createEmptyChapterAnnotationPayload(colSlug, bookSlug, cleanChap, chapterTitle);
    }
  }

  public saveChapterAnnotations(
    colSlug: string,
    bookSlug: string,
    chapterSlug: string,
    updates: Partial<ChapterAnnotationPayload>
  ): ChapterAnnotationPayload {
    const nextPayload = this.buildNextPayload(colSlug, bookSlug, chapterSlug, updates);
    const filePath = this.getChapterFilePath(colSlug, bookSlug, chapterSlug);
    this.ensureDirSync(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(nextPayload), 'utf-8');
    this.setCachedPayload(filePath, nextPayload);
    return nextPayload;
  }

  public async saveChapterAnnotationsAsync(
    colSlug: string,
    bookSlug: string,
    chapterSlug: string,
    updates: Partial<ChapterAnnotationPayload>
  ): Promise<ChapterAnnotationPayload> {
    const nextPayload = this.buildNextPayload(colSlug, bookSlug, chapterSlug, updates);
    const filePath = this.getChapterFilePath(colSlug, bookSlug, chapterSlug);
    this.setCachedPayload(filePath, nextPayload);

    const serialized = JSON.stringify(nextPayload);
    const dirPath = path.dirname(filePath);
    const prevChain = this.writeChains.get(filePath) || Promise.resolve();
    const writeOp = prevChain.catch(() => {}).then(async () => {
      await this.ensureDirAsync(dirPath);
      try {
        await fs.promises.writeFile(filePath, serialized, 'utf-8');
      } catch (err: any) {
        if (err?.code === 'ENOENT') {
          this.ensuredDirs.delete(dirPath);
          await this.ensureDirAsync(dirPath);
          await fs.promises.writeFile(filePath, serialized, 'utf-8');
          return;
        }
        throw err;
      }
    });
    const chainTail = writeOp.catch(() => {});
    this.writeChains.set(filePath, chainTail);
    try {
      await writeOp;
    } finally {
      if (this.writeChains.get(filePath) === chainTail) {
        this.writeChains.delete(filePath);
      }
    }
    return nextPayload;
  }

  public upsertAnnotationItem(
    colSlug: string,
    bookSlug: string,
    chapterSlug: string,
    item: BookAnnotationItem,
    chapterTitle?: string
  ): ChapterAnnotationPayload {
    const current = this.getChapterAnnotations(colSlug, bookSlug, chapterSlug, chapterTitle);
    const idx = current.annotations.findIndex((a) => a.id === item.id);
    const nextAnnotations = [...current.annotations];
    if (idx >= 0) {
      nextAnnotations[idx] = { ...item, updatedAt: new Date().toISOString() };
    } else {
      nextAnnotations.push(item);
    }
    return this.saveChapterAnnotations(colSlug, bookSlug, chapterSlug, {
      chapterTitle: chapterTitle || current.chapterTitle,
      annotations: nextAnnotations,
    });
  }

  public deleteAnnotationItem(
    colSlug: string,
    bookSlug: string,
    chapterSlug: string,
    annotationId: string
  ): ChapterAnnotationPayload {
    const current = this.getChapterAnnotations(colSlug, bookSlug, chapterSlug);
    const nextAnnotations = current.annotations.filter((a) => a.id !== annotationId);
    return this.saveChapterAnnotations(colSlug, bookSlug, chapterSlug, {
      annotations: nextAnnotations,
    });
  }

  public saveCanvasNote(
    colSlug: string,
    bookSlug: string,
    chapterSlug: string,
    canvasNote: ChapterCanvasNote,
    chapterTitle?: string
  ): ChapterAnnotationPayload {
    return this.saveChapterAnnotations(
      colSlug,
      bookSlug,
      chapterSlug,
      this.buildCanvasNoteUpdates(chapterSlug, canvasNote, chapterTitle)
    );
  }

  public saveCanvasNoteAsync(
    colSlug: string,
    bookSlug: string,
    chapterSlug: string,
    canvasNote: ChapterCanvasNote,
    chapterTitle?: string
  ): Promise<ChapterAnnotationPayload> {
    return this.saveChapterAnnotationsAsync(
      colSlug,
      bookSlug,
      chapterSlug,
      this.buildCanvasNoteUpdates(chapterSlug, canvasNote, chapterTitle)
    );
  }

  public listAnnotatedChapterSlugs(colSlug: string, bookSlug: string): string[] {
    const bookDir = this.getBookDir(colSlug, bookSlug);
    if (!fs.existsSync(bookDir)) return [];

    const results: string[] = [];
    const walk = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile() && entry.name.endsWith('.json')) {
          const rel = path.relative(bookDir, full).replace(/\\/g, '/').replace(/\.json$/i, '');
          results.push(rel);
        }
      }
    };
    walk(bookDir);
    return results.sort();
  }

  public exportBookAnp(
    colSlug: string,
    bookSlug: string,
    bookTitle?: string,
    chapterSlug?: string
  ): AstroNotePackagePayload {
    const chapters: Record<string, ChapterAnnotationPayload> = {};
    const targetSlugs = chapterSlug
      ? [chapterSlug.replace(/^collections\/[^/]+\/[^/]+\//, '').replace(/\.(mdx|md)$/i, '')]
      : this.listAnnotatedChapterSlugs(colSlug, bookSlug);

    for (const slug of targetSlugs) {
      const payload = this.getChapterAnnotations(colSlug, bookSlug, slug);
      const hasContent =
        payload.annotations.length > 0 ||
        payload.canvasNote.blocks.length > 0 ||
        payload.canvasNote.strokes.length > 0;
      if (hasContent || chapterSlug) {
        chapters[slug] = payload;
      }
    }

    return {
      schemaVersion: ANP_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      colSlug,
      bookSlug,
      bookTitle: bookTitle || bookSlug,
      chapters,
    };
  }

  public importBookAnp(
    rawPkg: unknown,
    mode: 'merge' | 'overwrite' = 'merge'
  ): {
    colSlug: string;
    bookSlug: string;
    importedChapters: number;
    totalAnnotations: number;
    totalCanvasBlocks: number;
  } {
    const pkg = validateAnpPackage(rawPkg);
    let importedChapters = 0;
    let totalAnnotations = 0;
    let totalCanvasBlocks = 0;

    for (const [slugKey, incomingPayload] of Object.entries(pkg.chapters)) {
      const targetCol = incomingPayload.colSlug || pkg.colSlug;
      const targetBook = incomingPayload.bookSlug || pkg.bookSlug;
      const targetChap = incomingPayload.chapterSlug || slugKey;

      let finalPayload: ChapterAnnotationPayload;
      if (mode === 'overwrite') {
        finalPayload = {
          ...incomingPayload,
          colSlug: targetCol,
          bookSlug: targetBook,
          chapterSlug: targetChap,
          updatedAt: new Date().toISOString(),
        };
      } else {
        const existing = this.getChapterAnnotations(targetCol, targetBook, targetChap, incomingPayload.chapterTitle);
        finalPayload = mergeChapterAnnotationPayloads(existing, incomingPayload);
      }

      const filePath = this.getChapterFilePath(targetCol, targetBook, targetChap);
      this.ensureDirSync(path.dirname(filePath));
      fs.writeFileSync(filePath, JSON.stringify(finalPayload), 'utf-8');
      this.setCachedPayload(filePath, finalPayload);

      importedChapters++;
      totalAnnotations += finalPayload.annotations.length;
      totalCanvasBlocks += finalPayload.canvasNote.blocks.length;
    }

    return {
      colSlug: pkg.colSlug,
      bookSlug: pkg.bookSlug,
      importedChapters,
      totalAnnotations,
      totalCanvasBlocks,
    };
  }
}
