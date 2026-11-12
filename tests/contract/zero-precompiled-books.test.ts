import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { collections } from '../../src/config/collections.config.ts';

describe('Zero Precompiled Books Invariant Contract (零预编译书籍架构契约)', () => {
  const ROOT = path.resolve(__dirname, '../..');

  it('1. src/content/docs/collections 物理目录必须彻底不存在或为空，杜绝被 Astro 静态编译', () => {
    const legacyCollectionsDir = path.join(ROOT, 'src', 'content', 'docs', 'collections');
    if (fs.existsSync(legacyCollectionsDir)) {
      const entries = fs.readdirSync(legacyCollectionsDir);
      expect(entries.length).toBe(0);
    } else {
      expect(fs.existsSync(legacyCollectionsDir)).toBe(false);
    }
  });

  it('2. content-sources/collections 必须完整保留离线书籍源码资产', () => {
    const sourcesDir = path.join(ROOT, 'content-sources', 'collections');
    expect(fs.existsSync(sourcesDir)).toBe(true);

    const subDirs = fs.readdirSync(sourcesDir).filter((d) => {
      return fs.statSync(path.join(sourcesDir, d)).isDirectory();
    });

    expect(subDirs).toContain('math');
    expect(subDirs).toContain('science');
    expect(subDirs).toContain('cs');
    expect(subDirs).toContain('telecom');
  });

  it('3. collections.config.ts 默认必须为零内置书目 (collections.length === 0)', () => {
    expect(Array.isArray(collections)).toBe(true);
    expect(collections.length).toBe(0);
  });

  it('4. package.json 的 electron-builder 配置必须严格排除预编译书籍与 .abp 实体包', () => {
    const pkgPath = path.join(ROOT, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const files: string[] = pkg.build?.files || [];

    expect(files).toContain('!dist/collections/**');
    expect(files).toContain('!dist/abp-packs/*.abp');
    expect(files).toContain('!dist/abp-packs/*/**');
    expect(files).toContain('!content-sources/**');
  });

  it('5. DesktopBookManager 在全新启动时已安装书架必须绝对为空 (0 本书)', async () => {
    const { DesktopBookManager } = await import('../../electron/services/book-manager.ts');
    const freshDir = path.join(ROOT, 'tests', 'fixtures', 'zero-book-fresh-launch');
    if (fs.existsSync(freshDir)) {
      fs.rmSync(freshDir, { recursive: true, force: true });
    }
    fs.mkdirSync(freshDir, { recursive: true });

    const manager = new DesktopBookManager(freshDir);
    const books = await manager.getInstalledBooks();
    expect(Array.isArray(books)).toBe(true);
    expect(books.length).toBe(0);

    const stats = await manager.getStorageStats();
    expect(stats.bookCount).toBe(0);
  });
});
