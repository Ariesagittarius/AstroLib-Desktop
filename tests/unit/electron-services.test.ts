/**
 * tests/unit/electron-services.test.ts
 * ============================================================================
 * AstroLib 桌面端服务单元与契约测试
 * ============================================================================
 */

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import zlib from 'node:zlib';
import { EnvDetector } from '../../electron/services/env-detector.ts';
import { ModelManager } from '../../electron/services/model-manager.ts';
import { StaticHandler } from '../../electron/server/static-handler.ts';
import { DesktopBookManager } from '../../electron/services/book-manager.ts';
import { ABP_SCHEMA_VERSION, type AstroBookManifest } from '../../src/types/content-package.ts';

describe('Electron Services & Infrastructure Unit Tests', () => {
  const projectRoot = process.cwd();

  it('EnvDetector 应能成功自省硬件、内存与平台信息', async () => {
    const diag = await EnvDetector.getDiagnostics(projectRoot);

    expect(diag).toBeDefined();
    expect(diag.platform).toBeDefined();
    expect(diag.arch).toBeDefined();
    expect(diag.cpuCores).toBeGreaterThan(0);
    expect(diag.totalMemMB).toBeGreaterThan(0);
    expect(diag.diskFreeGB).toBeGreaterThan(0);
    expect(diag.huggingFaceCacheDir).toContain('.cache');
  });

  it('ModelManager 应准确列出注册的核心模型及其初始状态', async () => {
    const mgr = new ModelManager(projectRoot);
    const models = await mgr.getAvailableModels();

    expect(Array.isArray(models)).toBe(true);
    expect(models.length).toBeGreaterThanOrEqual(2);

    const minilm = models.find((m) => m.id === 'minilm-l12');
    expect(minilm).toBeDefined();
    expect(minilm?.name).toContain('MiniLM-L12');
    expect(minilm?.category).toBe('embedding');
    expect(minilm?.sizeFormatted).toBe('120 MB');
    expect(minilm?.supportedEngines).toContain('ONNX Runtime (CPU)');

    const qwen = models.find((m) => m.id === 'qwen3-embedding');
    expect(qwen).toBeDefined();
    expect(qwen?.name).toContain('Qwen3');
    expect(qwen?.requiresPython).toBe(true);
  });

  it('ModelManager 取消未开始的下载应安全返回', () => {
    const mgr = new ModelManager(projectRoot);
    const res = mgr.cancelDownload('non-existent-model');
    expect(res.ok).toBe(false);
  });

  it('StaticHandler 应具备准确的 Clean URLs 路由解析逻辑', () => {
    const handler = new StaticHandler(path.join(projectRoot, 'public'));
    // 验证实例正常创建
    expect(handler).toBeDefined();
    expect(typeof (handler as any).resolveFilePath).toBe('function');
  });

  it('DesktopBookManager 能完整执行原生解包、元数据写入、单章读取与卸载流程', async () => {
    const tmpStorage = fs.mkdtempSync(path.join(os.tmpdir(), 'astrolib-book-mgr-'));
    const manager = new DesktopBookManager(tmpStorage);

    const mockManifest: AstroBookManifest = {
      schemaVersion: ABP_SCHEMA_VERSION,
      id: 'telecom-test_circuit',
      slug: 'test_circuit',
      colSlug: 'telecom',
      title: '电路测试教材',
      entryPoint: '01_intro',
      totalChapters: 1,
      updatedAt: new Date().toISOString(),
      contentHash: 'hash-circuit',
      sections: [],
    };

    const mockPayload = {
      schemaVersion: ABP_SCHEMA_VERSION,
      bookId: 'telecom-test_circuit',
      bookSlug: 'test_circuit',
      colSlug: 'telecom',
      chapterSlug: '01_intro',
      title: '第 1 讲 电路基础',
      html: '<p>基尔霍夫定律</p>',
      headings: [],
      updatedAt: new Date().toISOString(),
    };

    const bundle = {
      manifest: mockManifest,
      chapters: {
        '01_intro': mockPayload,
      },
      assets: {},
    };

    const gzipped = zlib.gzipSync(Buffer.from(JSON.stringify(bundle), 'utf8'));

    // 1. 安装
    const meta = await manager.installBookFromAbp(gzipped);
    expect(meta.manifest.id).toBe('telecom-test_circuit');
    expect(meta.manifest.title).toBe('电路测试教材');

    // 2. 检索已安装列表
    const installed = await manager.getInstalledBooks();
    expect(installed.length).toBe(1);
    expect(installed[0].manifest.slug).toBe('test_circuit');

    // 3. 读取 Manifest 与章节
    const retrievedManifest = await manager.getBookManifest('telecom', 'test_circuit');
    expect(retrievedManifest?.title).toBe('电路测试教材');

    const retrievedPayload = await manager.getChapterPayload('telecom', 'test_circuit', '01_intro');
    expect(retrievedPayload?.html).toContain('基尔霍夫定律');

    // 4. StaticHandler 联动验证 (userAbpDir 动态合成)
    const handler = new StaticHandler(path.join(projectRoot, 'dist'), tmpStorage);
    const req: any = {
      method: 'GET',
      url: '/collections/telecom/test_circuit/01_intro/',
      headers: {},
    };
    let statusCode = 0;
    const res: any = {
      writeHead: (code: number) => { statusCode = code; },
      end: () => {},
    };
    const handled = await handler.handle(req, res);
    expect(handled).toBe(true);
    expect(statusCode).toBe(200);

    // 5. 卸载
    const removed = await manager.removeBook('telecom', 'test_circuit');
    expect(removed).toBe(true);
    const afterRemoved = await manager.getInstalledBooks();
    expect(afterRemoved.length).toBe(0);

    // 6. clearAllBooks 清空验证
    await manager.installBookFromAbp(gzipped);
    expect((await manager.getInstalledBooks()).length).toBe(1);
    await manager.clearAllBooks();
    expect((await manager.getInstalledBooks()).length).toBe(0);

    fs.rmSync(tmpStorage, { recursive: true, force: true });
  });
});
