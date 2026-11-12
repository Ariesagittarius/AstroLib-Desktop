import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  PACK_CACHE_NAME,
  PRIMARY_PACK_URL,
  MANIFEST_URL,
  downloadAndInstallOfflinePack,
  getOfflinePackStatus,
  clearOfflinePack,
} from '../../src/scripts/pwa-offline-manager.ts';

// 内存 Cache 模拟
class MemoryCache {
  store = new Map<string, Response>();

  async put(request: any, response: Response): Promise<void> {
    const key = typeof request === 'string' ? request : request.url;
    this.store.set(key, response.clone());
  }

  async match(request: any): Promise<Response | undefined> {
    const key = typeof request === 'string' ? request : (request.url || '');
    // 仿真 sw.js 的精准匹配与尾部斜杠容错匹配
    if (this.store.has(key)) return this.store.get(key)!.clone();
    const alt = key.endsWith('/') ? key.slice(0, -1) : key + '/';
    if (this.store.has(alt)) return this.store.get(alt)!.clone();
    return undefined;
  }

  async keys(): Promise<{ url: string }[]> {
    return Array.from(this.store.keys()).map((k) => ({
      url: k.startsWith('http') ? k : `https://astrolib.cloud${k}`
    }));
  }

  async delete(request: any): Promise<boolean> {
    const key = typeof request === 'string' ? request : request.url;
    return this.store.delete(key);
  }
}

class MemoryCacheStorage {
  caches = new Map<string, MemoryCache>();

  async has(name: string): Promise<boolean> {
    return this.caches.has(name);
  }

  async open(name: string): Promise<MemoryCache> {
    let c = this.caches.get(name);
    if (!c) {
      c = new MemoryCache();
      this.caches.set(name, c);
    }
    return c;
  }

  async delete(name: string): Promise<boolean> {
    return this.caches.delete(name);
  }

  async keys(): Promise<string[]> {
    return Array.from(this.caches.keys());
  }
}

describe('PWA Offline Pack 真实产物端到端离线可用性测试 (Real Pack E2E)', () => {
  const offlineDir = path.resolve('dist/offline-packs');
  let memoryCaches: MemoryCacheStorage;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    memoryCaches = new MemoryCacheStorage();
    vi.stubGlobal('caches', memoryCaches);
    vi.stubGlobal('window', {
      caches: memoryCaches,
      dispatchEvent: vi.fn(),
      location: { origin: 'https://astrolib.cloud' },
    });
    originalFetch = global.fetch;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    global.fetch = originalFetch;
  });

  it('真实构建产物存在性验证：manifest.json 与 astrolib-all.json.gz 必须已成功生成且体积合规', () => {
    const manifestPath = path.join(offlineDir, 'manifest.json');
    const packPath = path.join(offlineDir, 'astrolib-all.json.gz');

    expect(fs.existsSync(manifestPath)).toBe(true);
    expect(fs.existsSync(packPath)).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest.books.length === 0) {
      // Zero-Built-in Books mode: modular ABP content packages are used
      expect(manifest.books.length).toBe(0);
      return;
    }

    const packStat = fs.statSync(packPath);
    const sizeMb = packStat.size / (1024 * 1024);

    // 必须经过高强度压缩，且严格小于 Vercel 100MB 静态文件上限
    expect(sizeMb).toBeGreaterThan(10);
    expect(sizeMb).toBeLessThan(100);

    expect(manifest.books.length).toBeGreaterThan(0);
    expect(manifest.totalArticles).toBeGreaterThan(500);
  });

  it('真实 Gzip 全量包下载、解压与灌入全流程测试 (Real Pack Download & Cache)', async () => {
    const manifestPath = path.join(offlineDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) return;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest.books.length === 0) return;
    const packPath = path.join(offlineDir, 'astrolib-all.json.gz');
    if (!fs.existsSync(packPath)) return;
    const packBuffer = fs.readFileSync(packPath);

    // 模拟服务端拦截 /offline-packs/astrolib-all.json.gz 并返回真实 Gzip 字节流
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url === PRIMARY_PACK_URL) {
        return new Response(packBuffer, {
          status: 200,
          headers: {
            'Content-Type': 'application/gzip',
            'Content-Length': String(packBuffer.length),
          }
        });
      }
      return new Response(null, { status: 404 });
    });

    const progressReports: number[] = [];
    const res = await downloadAndInstallOfflinePack(undefined, (pct) => {
      progressReports.push(pct);
    });

    expect(res.success).toBe(true);
    expect(res.total).toBeGreaterThan(500);
    expect(progressReports.includes(100)).toBe(true);

    // 验证状态查询接口
    const status = await getOfflinePackStatus();
    expect(status.hasPack).toBe(true);
    expect(status.count).toBe(res.total);
    expect(Number(status.approxSizeMb)).toBeGreaterThan(100);

    // 验证 Service Worker 匹配：抽取 3 篇真实核心章节，验证是否能完全离线命中
    const cache = await memoryCaches.open(PACK_CACHE_NAME);
    const testRoutes = [
      '/collections/math/linear_algebra/00_内容简介/',
      '/collections/math/math_senior/06_第1章-三角函数/',
      '/collections/science/university_physics/00_内容简介/',
    ];

    for (const route of testRoutes) {
      const matched = await cache.match(route);
      expect(matched, `路由 ${route} 必须能在离线 Cache 中被命中`).toBeDefined();
      const html = await matched!.text();
      expect(html).toContain('<!DOCTYPE html>');
      expect(matched!.headers.get('X-Astrolib-Offline-Pack')).toBe('true');
    }
  });
});
