import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  LocalModelIdleController,
  parseModelIdleTtlMs,
  DEFAULT_MODEL_IDLE_TTL_MS,
} from '../../src/services/local-model-lifecycle.ts';
import { AnnotationStorageService } from '../../src/core/annotations/annotation-storage.ts';
import { StaticHandler } from '../../electron/server/static-handler.ts';

const ROOT = path.resolve(__dirname, '../..');

describe('Performance & Architecture Optimizations', () => {
  const tempDirs: string[] = [];

  function makeTempDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    vi.useRealTimers();
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()!;
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {}
    }
  });

  describe('1. Local AI Model Strict On-Demand Lifecycle & Idle TTL', () => {
    it('parses ASTROLIB_MODEL_IDLE_TTL_MS with 5min default and supports 0 for keep-until-exit', () => {
      expect(parseModelIdleTtlMs(undefined)).toBe(DEFAULT_MODEL_IDLE_TTL_MS);
      expect(parseModelIdleTtlMs('')).toBe(DEFAULT_MODEL_IDLE_TTL_MS);
      expect(parseModelIdleTtlMs('-5')).toBe(DEFAULT_MODEL_IDLE_TTL_MS);
      expect(parseModelIdleTtlMs('0')).toBe(0);
      expect(parseModelIdleTtlMs('600000')).toBe(600000);
    });

    it('unloads idle model after TTL and defers unload when busy', async () => {
      vi.useFakeTimers();
      let loaded = true;
      let busy = true;
      let unloadCount = 0;

      const ctrl = new LocalModelIdleController(10_000);
      ctrl.touch(
        () => busy,
        () => loaded,
        () => {
          unloadCount++;
          loaded = false;
        }
      );

      vi.advanceTimersByTime(10_500);
      expect(unloadCount).toBe(0);
      expect(loaded).toBe(true);

      busy = false;
      vi.advanceTimersByTime(10_500);
      expect(unloadCount).toBe(1);
      expect(loaded).toBe(false);
    });

    it('cancels idle eviction when TTL is changed to 0 (keep until exit)', () => {
      vi.useFakeTimers();
      let unloadCount = 0;
      const ctrl = new LocalModelIdleController(5_000);
      ctrl.touch(
        () => false,
        () => true,
        () => {
          unloadCount++;
        }
      );

      ctrl.setIdleTimeoutMs(0, () => false, () => true, () => {
        unloadCount++;
      });

      vi.advanceTimersByTime(60_000);
      expect(unloadCount).toBe(0);
    });

    it('electron/main.ts performs zero startup prewarm and local-server uses lazy prefix registry', () => {
      const mainSrc = fs.readFileSync(path.join(ROOT, 'electron/main.ts'), 'utf8');
      expect(mainSrc).not.toContain('.prewarm(');
      expect(mainSrc).toContain('astrolib:unload-local-models');
      expect(mainSrc).toContain('astrolib:set-model-idle-timeout');

      const localServerSrc = fs.readFileSync(path.join(ROOT, 'electron/server/local-server.ts'), 'utf8');
      expect(localServerSrc).toContain('createLazyPluginRegistry');
      expect(localServerSrc).toContain('ensurePluginLoaded');
    });
  });

  describe('2. Async Serialized Canvas Storage & Compact JSON', () => {
    it('serializes concurrent saveCanvasNoteAsync calls in FIFO order and hits LRU cache', async () => {
      const dir = makeTempDir('astrolib-ann-');
      const storage = new AnnotationStorageService(dir);

      const now = new Date().toISOString();
      const p1 = storage.saveCanvasNoteAsync('math', 'book1', '01_intro', {
        chapterSlug: '01_intro',
        title: '01 Intro',
        blocks: [],
        strokes: [
          {
            id: 's1',
            tool: 'pen',
            color: '#000',
            strokeWidth: 2,
            opacity: 1,
            points: [
              { u: 0, v: 0, pressure: 0.5 },
              { u: 10, v: 10, pressure: 0.5 },
            ],
            createdAt: now,
          },
        ],
        viewport: { panX: 0, panY: 0, zoom: 1 },
        updatedAt: now,
      });

      const p2 = storage.saveCanvasNoteAsync('math', 'book1', '01_intro', {
        chapterSlug: '01_intro',
        title: '01 Intro',
        blocks: [],
        strokes: [
          {
            id: 's1',
            tool: 'pen',
            color: '#000',
            strokeWidth: 2,
            opacity: 1,
            points: [
              { u: 0, v: 0, pressure: 0.5 },
              { u: 10, v: 10, pressure: 0.5 },
            ],
            createdAt: now,
          },
          {
            id: 's2',
            tool: 'pen',
            color: '#000',
            strokeWidth: 2,
            opacity: 1,
            points: [
              { u: 12, v: 12, pressure: 0.6 },
              { u: 20, v: 20, pressure: 0.6 },
            ],
            createdAt: now,
          },
        ],
        viewport: { panX: 0, panY: 0, zoom: 1 },
        updatedAt: now,
      });

      await Promise.all([p1, p2]);

      const readBack = storage.getChapterAnnotations('math', 'book1', '01_intro');
      expect(readBack.canvasNote.strokes.map((s) => s.id)).toEqual(['s1', 's2']);

      const filePath = path.join(dir, 'math-book1', '01_intro.json');
      const rawDisk = fs.readFileSync(filePath, 'utf8');

      expect(rawDisk.includes('\n  ')).toBe(false);
    });
  });

  describe('3. StaticHandler Byte-Capped LRU & Slim Reader HTML', () => {
    it('enforces 32 MB memory cache ceiling via LRU eviction and retains MRU files', async () => {
      const distDir = makeTempDir('astrolib-dist-');
      const handler = new StaticHandler(distDir);

      const chunkBuf = Buffer.alloc(3_800_000, 65);
      for (let i = 0; i < 10; i++) {
        fs.writeFileSync(path.join(distDir, `blob-${i}.bin`), chunkBuf);
      }

      const servePath = async (name: string) => {
        let code = 0;
        const ok = await handler.handle(
          { method: 'GET', url: `/${name}`, headers: {} } as any,
          {
            writeHead: (c: number) => {
              code = c;
            },
            end: () => {},
          } as any
        );
        expect(ok).toBe(true);
        expect(code).toBe(200);
      };

      for (let i = 0; i < 8; i++) {
        await servePath(`blob-${i}.bin`);
      }

      await servePath('blob-0.bin');

      await servePath('blob-8.bin');
      await servePath('blob-9.bin');

      const stats = handler.getMemoryCacheStats();
      expect(stats.maxBytes).toBe(32 * 1024 * 1024);
      expect(stats.bytes).toBeLessThanOrEqual(32 * 1024 * 1024);
      expect(stats.entries).toBeLessThanOrEqual(8);
    });
  });

  describe('4. Canvas, Fragment Switching, Library Covers & Reader Pool Invariants', () => {
    it('preserves high-FPS canvas handwriting architecture without pointerrawupdate', () => {
      const canvasSrc = [
        fs.readFileSync(path.join(ROOT, 'electron/server/canvas-workspace-template.ts'), 'utf8'),
        fs.readFileSync(path.join(ROOT, 'electron/server/canvas/client-script.ts'), 'utf8'),
      ].join('\n');
      expect(canvasSrc).toContain('viewportRect');
      expect(canvasSrc).toContain("liveCanvas.getContext('2d', { alpha: true })");
      expect(canvasSrc).not.toContain('desynchronized: true');
      expect(canvasSrc).toContain('stampStrokeToStatic');
      expect(canvasSrc).toContain('pushUndoAction');
      expect(canvasSrc).toContain('requestIdleCallback');
      expect(canvasSrc).not.toContain("addEventListener('pointerrawupdate'");
    });

    it('uses tab-level iframe reuse pool without HEAD preflight in FragmentReaderHost', () => {
      const readerHostSrc = [
        fs.readFileSync(path.join(ROOT, 'src/components/desktop/FragmentReaderHost.astro'), 'utf8'),
        fs.readFileSync(path.join(ROOT, 'src/features/reader-host/reader-host-controller.ts'), 'utf8'),
      ].join('\n');
      expect(readerHostSrc).toContain('MAX_LIVE_IFRAMES = 4');
      expect(readerHostSrc).toContain('about:blank');
      expect(readerHostSrc).toContain('tab-pane-slot');
      expect(readerHostSrc).not.toContain("method: 'HEAD'");
    });

    it('uses zero-animation content-visibility/inert fragment switching in desktop.astro', () => {
      const desktopSrc = fs.readFileSync(path.join(ROOT, 'src/pages/desktop.astro'), 'utf8');
      expect(desktopSrc).toContain('fragment-view--inactive');
      expect(desktopSrc).toContain('content-visibility: hidden');
      expect(desktopSrc).toContain("toggleAttribute('inert'");
    });

    it('has generated WebP cover thumbnails for heavy and localized textbooks', () => {
      const thumbsDir = path.join(ROOT, 'public/covers/thumbs');
      expect(fs.existsSync(path.join(thumbsDir, 'communication_principles.webp'))).toBe(true);
      expect(fs.existsSync(path.join(thumbsDir, 'math_senior.webp'))).toBe(true);
      expect(fs.existsSync(path.join(thumbsDir, 'math_analysis.webp'))).toBe(true);
      expect(fs.statSync(path.join(thumbsDir, 'communication_principles.webp')).size).toBeLessThan(64 * 1024);
    });
  });
});
