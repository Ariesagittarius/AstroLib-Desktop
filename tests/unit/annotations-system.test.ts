/**
 * tests/unit/annotations-system.test.ts
 * ============================================================================
 * 书籍段落批注、数位板混合双层手写、自由画布与只读 Agent 接口自动化测试套件
 * ============================================================================
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ANP_SCHEMA_VERSION,
  validateAnpPackage,
  type BookAnnotationItem,
  type ChapterCanvasNote,
} from '../../src/types/annotation-package.ts';
import {
  AnnotationStorageService,
  projectInkPointToContainer,
  toAnchoredInkPoint,
} from '../../src/core/annotations/annotation-storage.ts';
import { ContentApiService } from '../../src/core/content-api/content-api-service.ts';
import { PluginEnvironment } from '../../src/plugins/harness/plugin-environment.ts';
import { StaticHandler } from '../../electron/server/static-handler.ts';

describe('AstroLib 批注、手写同步、自由画布与只读 Agent 系统测试', () => {
  const ROOT = path.resolve(__dirname, '../..');
  let tempDir = '';
  let storage: AnnotationStorageService;
  const contentApi = ContentApiService.getInstance();
  let originalStorage: AnnotationStorageService;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'astrolib-ann-test-'));
    storage = new AnnotationStorageService(tempDir);
    originalStorage = contentApi.getAnnotationStorage();
    contentApi.setAnnotationStorage(storage);
  });

  afterAll(() => {
    contentApi.setAnnotationStorage(originalStorage);
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('1. 混合双层手写坐标锚定与窗口缩放/重排同步精度', () => {
    it('1.1 正文块内锚定 (node-relative) 应在窗口放大与节点尺寸重排后无误差逆投影', () => {
      const originNodeRect = { left: 100, top: 200, width: 600, height: 120 };
      const pt = toAnchoredInkPoint({
        clientX: 400, // 中心 X: u = 0.5
        clientY: 260, // 中心 Y: v = 0.5
        pressure: 0.72,
        nodeRect: originNodeRect,
        anchorMode: 'node-relative',
        zoomScale: 1.0,
      });

      expect(pt.u).toBeCloseTo(0.5, 4);
      expect(pt.v).toBeCloseTo(0.5, 4);

      // 模拟窗口放大 1.5x 且上方折叠块展开导致节点向下位移 180px，同时容器左上角也在 1.5x 下偏移
      const zoomedScale = 1.5;
      const zoomedContainerRect = { left: 40, top: 80, width: 1200, height: 1800 };
      const movedZoomedNodeRect = { left: 130, top: 470, width: 900, height: 180 };

      const projected = projectInkPointToContainer({
        point: pt,
        anchorMode: 'node-relative',
        nodeRect: movedZoomedNodeRect,
        containerRect: zoomedContainerRect,
        zoomScale: zoomedScale,
      });

      // 屏幕中心为 (130 + 450, 470 + 90) = (580, 560)，减容器 (40, 80) 除以 1.5 = (360, 320)
      expect(projected.x).toBeCloseTo(360, 2);
      expect(projected.y).toBeCloseTo(320, 2);
    });

    it('1.2 页边距/空白区锚定 (margin-offset) 应在缩放 1.6x 与节点下移后保持相对偏移向量同步', () => {
      const originNodeRect = { left: 200, top: 300, width: 500, height: 100 };
      // 在左侧页边距 clientX = 160（距节点左边 -40px），clientY = 320（距节点顶部 +20px）
      const pt = toAnchoredInkPoint({
        clientX: 160,
        clientY: 320,
        pressure: 0.65,
        nodeRect: originNodeRect,
        anchorMode: 'margin-offset',
        zoomScale: 1.0,
      });

      expect(pt.u).toBeCloseTo(-40, 3);
      expect(pt.v).toBeCloseTo(20, 3);

      // 模拟缩放 1.6x，节点下移到 top = 540
      const zoom = 1.6;
      const containerRect = { left: 20, top: 50, width: 1400, height: 2000 };
      const movedNodeRect = { left: 260, top: 540, width: 800, height: 160 };

      const projected = projectInkPointToContainer({
        point: pt,
        anchorMode: 'margin-offset',
        nodeRect: movedNodeRect,
        containerRect,
        zoomScale: zoom,
      });

      // 预期屏幕位置: (260 + (-40)*1.6, 540 + 20*1.6) = (196, 572) -> 转本地逻辑坐标: ((196-20)/1.6, (572-50)/1.6) = (110, 326.25)
      expect(projected.x).toBeCloseTo(110, 2);
      expect(projected.y).toBeCloseTo(326.25, 2);
    });
  });

  describe('2. AST 外接存储、整书全景统计与 .anp 无损打包导入导出', () => {
    const colSlug = 'math';
    const bookSlug = 'math_analysis';
    const chapterSlug = '6.2_高阶导数及其他求导法则';

    it('2.1 应正确写入高亮、Markdown/LaTeX 侧注、双层手写笔迹与章节自由画布，并与真实 AST 树外接', () => {
      const now = new Date().toISOString();
      const highlight: BookAnnotationItem = {
        id: 'hl-leibniz-1',
        kind: 'highlight',
        anchor: {
          colSlug,
          bookSlug,
          chapterSlug,
          nodeId: 'p-18',
          uri: `astrolib://${colSlug}/${bookSlug}/${chapterSlug}#p-18`,
          nodeType: 'paragraph',
          quote: { exact: 'Leibniz (莱布尼茨) 公式是主要工具' },
          position: { start: 2, end: 24 },
        },
        color: '#fde047',
        tags: ['高阶导数', '重点公式'],
        createdAt: now,
        updatedAt: now,
      };

      const sidenote: BookAnnotationItem = {
        id: 'sn-example-621',
        kind: 'sidenote',
        anchor: {
          colSlug,
          bookSlug,
          chapterSlug,
          nodeId: 'card-28-example',
          uri: `astrolib://${colSlug}/${bookSlug}/${chapterSlug}#card-28-example`,
          nodeType: 'card',
          quote: { exact: '求 (x^2 sin x)^(80)' },
        },
        markdown: '利用二项式展开系数 $\\binom{80}{k}$，注意 $k \\ge 3$ 时 $(x^2)^{(k)} = 0$。',
        color: '#93c5fd',
        tags: ['高阶导数', '例题技巧'],
        createdAt: now,
        updatedAt: now,
      };

      const ink: BookAnnotationItem = {
        id: 'ink-math-20',
        kind: 'ink',
        anchorMode: 'node-relative',
        anchor: {
          colSlug,
          bookSlug,
          chapterSlug,
          nodeId: 'math-20',
          uri: `astrolib://${colSlug}/${bookSlug}/${chapterSlug}#math-20`,
          nodeType: 'math_block',
        },
        tool: 'pen',
        color: '#ef4444',
        strokeWidth: 2.5,
        opacity: 0.95,
        baseWidth: 520,
        baseHeight: 80,
        zoomScaleAtCreation: 1,
        points: [
          { u: 0.1, v: 0.2, pressure: 0.6 },
          { u: 0.5, v: 0.4, pressure: 0.8 },
        ],
        createdAt: now,
        updatedAt: now,
      };

      contentApi.upsertChapterAnnotation(colSlug, bookSlug, chapterSlug, highlight, '6.2 高阶导数及其他求导法则');
      contentApi.upsertChapterAnnotation(colSlug, bookSlug, chapterSlug, sidenote, '6.2 高阶导数及其他求导法则');
      contentApi.upsertChapterAnnotation(colSlug, bookSlug, chapterSlug, ink, '6.2 高阶导数及其他求导法则');

      const canvasNote: ChapterCanvasNote = {
        chapterSlug,
        title: '6.2 高阶导数 · 自由画布',
        blocks: [
          {
            id: 'blk-1',
            kind: 'ast-quote',
            x: 40,
            y: 40,
            width: 320,
            height: 200,
            markdown: '推演笔记：结合 `math-20` Leibniz 展开公式，处理多项式乘三角函数的高阶导数。',
            astRef: {
              colSlug,
              bookSlug,
              chapterSlug,
              nodeId: 'math-20',
              uri: `astrolib://${colSlug}/${bookSlug}/${chapterSlug}#math-20`,
              nodeType: 'math_block',
            },
            createdAt: now,
            updatedAt: now,
          },
        ],
        strokes: [
          {
            id: 'cv-stroke-1',
            tool: 'highlighter',
            color: '#fde047',
            strokeWidth: 3,
            opacity: 0.34,
            points: [
              { u: 80, v: 90, pressure: 0.5 },
              { u: 220, v: 95, pressure: 0.5 },
            ],
            createdAt: now,
          },
        ],
        viewport: { panX: -10, panY: -20, zoom: 1.2 },
        updatedAt: now,
      };
      contentApi.saveChapterCanvasNote(colSlug, bookSlug, chapterSlug, canvasNote, '6.2 高阶导数及其他求导法则');

      // 验证外接 AST 读取
      const withAst = contentApi.getChapterAnnotationsWithAst(colSlug, bookSlug, chapterSlug);
      expect(withAst.summary.highlightsCount).toBe(1);
      expect(withAst.summary.sidenotesCount).toBe(1);
      expect(withAst.summary.inkStrokesCount).toBe(1);
      expect(withAst.summary.canvasBlocksCount).toBe(1);
      expect(withAst.summary.canvasInkStrokesCount).toBe(1);

      const enrichedSn = withAst.enrichedAnnotations.find((e) => e.annotation.id === 'sn-example-621');
      expect(enrichedSn?.astNode).not.toBeNull();
      expect(enrichedSn?.astNode?.type).toBe('card');
      expect(enrichedSn?.astNode?.title).toContain('6.2.1');

      const enrichedInk = withAst.enrichedAnnotations.find((e) => e.annotation.id === 'ink-math-20');
      expect(enrichedInk?.astNode?.type).toBe('math_block');
      expect(enrichedInk?.astNode?.latex).toContain('(u v) ^ {(n)}');

      const enrichedBlock = withAst.enrichedCanvasBlocks[0];
      expect(enrichedBlock.astNode?.nodeId).toBe('math-20');
      expect(enrichedBlock.astNode?.latex).toContain('binom');
    });

    it('2.2 getBookAnnotationsOverview 与 searchAnnotations 应准确汇总全书批注态势', () => {
      const overview = contentApi.getBookAnnotationsOverview(colSlug, bookSlug);
      expect(overview.totalAnnotatedChapters).toBe(1);
      expect(overview.highlightsCount).toBe(1);
      expect(overview.sidenotesCount).toBe(1);
      expect(overview.inkStrokesCount).toBe(1);
      expect(overview.canvasBlocksCount).toBe(1);
      expect(overview.allTags.some((t) => t.tag === '高阶导数' && t.count === 2)).toBe(true);

      const searchHits = contentApi.searchAnnotations('二项式', { colSlug, bookSlug });
      expect(searchHits.length).toBe(1);
      expect(searchHits[0].hitType).toBe('sidenote');
      expect(searchHits[0].nodeId).toBe('card-28-example');
    });

    it('2.3 .anp 打包导出与跨设备幂等导入合并应无损保留数据并拒绝非法载荷', () => {
      const exported = contentApi.exportBookAnp(colSlug, bookSlug);
      expect(exported.schemaVersion).toBe(ANP_SCHEMA_VERSION);
      expect(Object.keys(exported.chapters).length).toBe(1);

      // 校验非法 ANP 包会抛出异常
      expect(() => validateAnpPackage({ schemaVersion: '0.0.1' })).toThrowError(/ANP/);

      // 在新隔离存储中导入，再补充新批注做幂等合并验证
      const remoteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'astrolib-anp-remote-'));
      try {
        const remoteStorage = new AnnotationStorageService(remoteDir);
        const importRes = remoteStorage.importBookAnp(exported, 'merge');
        expect(importRes.importedChapters).toBe(1);
        expect(importRes.totalAnnotations).toBe(3);
        expect(importRes.totalCanvasBlocks).toBe(1);

        // 重复导入同一份包应保持幂等不重复
        const secondImport = remoteStorage.importBookAnp(exported, 'merge');
        expect(secondImport.totalAnnotations).toBe(3);
        expect(secondImport.totalCanvasBlocks).toBe(1);
      } finally {
        fs.rmSync(remoteDir, { recursive: true, force: true });
      }
    });
  });

  describe('3. Agent 友好的只读感知 API 与插件工具链边界', () => {
    it('3.1 Harness 批注工具链应仅暴露只读查询工具，严禁暴露写操作工具', async () => {
      const env = PluginEnvironment.getInstance();
      const openAiTools = env.toOpenAITools().map((t) => t.function.name);
      const annoTools = openAiTools.filter((n) => n.includes('annotation'));
      expect(annoTools).toEqual([
        'get_book_annotations_overview',
        'get_chapter_annotations',
        'search_user_annotations',
      ]);
      expect(annoTools.some((n) => /write|update|delete|upsert|create|add/i.test(n))).toBe(false);

      const ov: any = await env.executeAgentTool(
        'get_book_annotations_overview',
        { colSlug: 'math', bookSlug: 'math_analysis' },
        { books: contentApi.listBooks() as any, chapters: contentApi.buildGlobalChapterIndex() as any }
      );
      expect(ov.success).toBe(true);
      expect(ov.contextText).toContain('整书批注概览');

      const ch: any = await env.executeAgentTool(
        'get_chapter_annotations',
        { colSlug: 'math', bookSlug: 'math_analysis', chapterSlug: '6.2_高阶导数及其他求导法则' },
        { books: contentApi.listBooks() as any, chapters: contentApi.buildGlobalChapterIndex() as any }
      );
      expect(ch.success).toBe(true);
      expect(ch.contextText).toContain('math-20');
    });

    it('3.2 首屏 Harness PluginEnvironment 应注册 /notes 指令与只读批注工具', async () => {
      const env = PluginEnvironment.getInstance();
      const openAiTools = env.toOpenAITools().map((t) => t.function.name);
      expect(openAiTools).toContain('get_book_annotations_overview');
      expect(openAiTools).toContain('get_chapter_annotations');
      expect(openAiTools).toContain('search_user_annotations');
      expect(openAiTools.some((n) => /annotation.*(write|edit|delete|add)/i.test(n))).toBe(false);

      const cmdRes = await env.executeCommand('/notes math_analysis', {
        books: contentApi.listBooks() as any,
        chapters: contentApi.buildGlobalChapterIndex() as any,
      });
      expect(cmdRes.success).toBe(true);
      expect(cmdRes.contextText).toContain('整书批注全景');
      expect(cmdRes.contextText).toContain('高亮: 1');
    });
  });

  describe('4. Electron 阅读器注入与分屏自由画布路由验证', () => {
    it('4.1 StaticHandler /workspace/canvas/ 应返回自由画布工作台 HTML', async () => {
      const handler = new StaticHandler(path.join(ROOT, 'dist'), undefined, ROOT);
      let statusCode = 0;
      let headers: Record<string, string> = {};
      let buf: Buffer | null = null;

      const handled = await handler.handle(
        { method: 'GET', url: '/workspace/canvas/?col=math&book=math_senior&chapter=07_11_%E5%9F%BA%E6%9C%AC%E5%85%AC%E5%BC%8F', headers: {} } as any,
        {
          writeHead: (code: number, h: any) => {
            statusCode = code;
            headers = h;
          },
          end: (chunk?: any) => {
            if (chunk) buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          },
        } as any
      );

      expect(handled).toBe(true);
      expect(statusCode).toBe(200);
      expect(headers['Content-Type']).toContain('text/html');
      const html = buf!.toString('utf8');
      expect(html).toContain('cv-ink-static');
      expect(html).toContain('cv-ink-live');
      expect(html).toContain('cv-brush-style-row');
      expect(html).toContain('btn-undo');
      expect(html).toContain('btn-redo');
      expect(html).toContain('btn-export-pdf');
      expect(html).toContain('btn-export-png');
      expect(html).toContain('astrolib:switch-canvas-chapter');
      expect(html).toContain('pickSafeInkEvents');
      expect(html).not.toContain("addEventListener('pointerrawupdate'");
      expect(html).toContain('releaseAllKeyStates');
      expect(html).toContain('cv-ast-quote-original');
      expect(html).not.toContain('📝');
      expect(html).not.toContain('📌');
      expect(html).not.toContain('🗒️');
      expect(html).toContain('data:image/svg+xml');
      expect(html).not.toContain('cursor: crosshair');
      expect(html).not.toContain('desynchronized: true');
      expect(html).toContain('--md-sys-color-primary');
      expect(html).toContain('M3_THEME_COLOR_CHANGED');
      expect(html).toContain('starlight-font');
      expect(html).toContain('syncParentFontFaces');
      expect(html).not.toContain('Microsoft YaHei');
    });

    it('4.1b StaticHandler /workspace/canvas/?exportMode=pdf 应输出导出模式', async () => {
      const handler = new StaticHandler(path.join(ROOT, 'dist'), undefined, ROOT);
      let statusCode = 0;
      let buf: Buffer | null = null;

      const handled = await handler.handle(
        { method: 'GET', url: '/workspace/canvas/?col=math&book=math_senior&chapter=07_11_%E5%9F%BA%E6%9C%AC%E5%85%AC%E5%BC%8F&exportMode=pdf', headers: {} } as any,
        {
          writeHead: (code: number) => {
            statusCode = code;
          },
          end: (chunk?: any) => {
            if (chunk) buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          },
        } as any
      );

      expect(handled).toBe(true);
      expect(statusCode).toBe(200);
      const html = buf!.toString('utf8');
      expect(html).toContain('cv-export-mode');
      expect(html).toContain('__astrolibExportReady');
    });

    it('4.2 StaticHandler 合成的阅读器页面应包含 ViewTransitions 重挂载、Ctrl+Z 撤销、隐藏多余汉堡按钮与无正文手写层', async () => {
      const handler = new StaticHandler(path.join(ROOT, 'dist'), undefined, ROOT);
      let statusCode = 0;
      let buf: Buffer | null = null;

      const handled = await handler.handle(
        { method: 'GET', url: '/collections/math/math_senior/07_11_%E5%9F%BA%E6%9C%AC%E5%85%AC%E5%BC%8F/', headers: {} } as any,
        {
          writeHead: (code: number) => {
            statusCode = code;
          },
          end: (chunk?: any) => {
            if (chunk) buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          },
        } as any
      );

      expect(handled).toBe(true);
      expect(statusCode).toBe(200);
      const html = buf!.toString('utf8');
      expect(html).toContain('id="vp-annotations-btn"');
      expect(html).toContain('data-tooltip="批注与笔记 (Alt+N)"');
      expect(html).not.toContain('id="vp-ink-toolbar-btn"');
      expect(html).not.toContain('astrolib-ink-overlay');
      expect(html).toContain('astro:page-load');
      expect(html).toContain('astrolib:chapter-changed');
      expect(html).toContain('performUndo');
      expect(html).toContain('#m3-hamburger-btn');
      expect(html).toContain('data-panel-id="annotations"');
      expect(html).toContain('initAstrolibAnnotationsRuntime');
    });

    it('4.3 FragmentReaderHost.astro 与 SplitResizer 必须统一承载分屏拖拽与消息桥接，StaticHandler 严禁重复注入分界线', async () => {
      const source = [
        fs.readFileSync(path.join(ROOT, 'src', 'components', 'desktop', 'FragmentReaderHost.astro'), 'utf8'),
        fs.readFileSync(path.join(ROOT, 'src', 'features', 'reader-host', 'reader-host-controller.ts'), 'utf8'),
        fs.readFileSync(path.join(ROOT, 'src', 'features', 'reader-host', 'split-resizer.ts'), 'utf8'),
      ].join('\n');
      expect(source).toContain('astrolib:open-canvas-split');
      expect(source).toContain('astrolib:focus-ast-node');
      expect(source).toContain('astrolib:chapter-changed');
      expect(source).toContain('astrolib:export-canvas');
      expect(source).toContain('split-divider-handle');
      expect(source).toContain('SplitResizer');

      const staticHandlerSrc = fs.readFileSync(
        path.join(ROOT, 'electron', 'server', 'static-handler.ts'),
        'utf8'
      );
      expect(staticHandlerSrc).not.toContain('__astrolibCanvasSplitBridge');
      expect(staticHandlerSrc).not.toContain("id = 'split-divider-handle'");
    });

    it('4.4 ContentApiService.getChapterNodeHtml 应支持抓取原文 AST 节点编译 HTML', () => {
      const colRoot = path.join(ROOT, 'artifacts', 'abp-packs');
      const mathDir = path.join(colRoot, 'math-math_senior');
      if (!fs.existsSync(mathDir)) return;
      const ast = contentApi.getChapterAst('math', 'math_senior', '07_11_基本公式');
      if (!ast || ast.tree.length === 0) return;
      const firstId = ast.tree[0].id;
      const nodeHtml = contentApi.getChapterNodeHtml('math', 'math_senior', '07_11_基本公式', firstId);
      expect(nodeHtml).not.toBeNull();
      expect(nodeHtml?.html.length).toBeGreaterThan(0);
    });
  });
});
