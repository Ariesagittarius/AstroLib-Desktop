import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { DesktopBookManager } from '../../electron/services/book-manager.ts';
import { fetchOfficialCatalog, installOfficialBook } from '../../electron/services/remote-catalog-service.ts';
import { resolveAbpArtifactsDir, resolveBookSourceDir } from '../../src/core/catalog/content-paths.ts';
import { DEFAULT_DESKTOP_RELEASE_REPO } from '../../src/config/release.config.ts';
import { ABP_SCHEMA_VERSION } from '../../src/types/content-package.ts';

describe('Mode A Release & Content Distribution Acceptance Test (Gate G3)', () => {
  const ROOT = path.resolve(__dirname, '../..');
  const artifactsAbpDir = resolveAbpArtifactsDir(ROOT);
  const testUserAbpDir = path.join(ROOT, 'tests', 'fixtures', 'runtime-g3-distribution');

  let server: http.Server;
  let baseUrl = '';
  let sampleCatalog: any;

  beforeAll(async () => {
    const eaAbp = path.join(artifactsAbpDir, 'math-engineering_analysis.abp');
    const catFile = path.join(artifactsAbpDir, 'catalog.json');
    if (!fs.existsSync(eaAbp) || !fs.existsSync(catFile)) {
      const { execFileSync } = await import('node:child_process');
      execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-exercise-data.mjs')], { cwd: ROOT });
      const { packBook } = await import('../../scripts/pack-book-abp.mjs');
      await packBook({
        bookDir: resolveBookSourceDir('math', 'engineering_analysis', ROOT),
        outDir: artifactsAbpDir,
        withVectors: false,
        includeAuxiliary: true,
      });
    }

    sampleCatalog = JSON.parse(fs.readFileSync(catFile, 'utf8'));

    server = http.createServer((req, res) => {
      const urlPath = (req.url || '/').split('?')[0];
      if (urlPath === '/releases/latest/download/catalog.json') {
        const dynamicBooks = sampleCatalog.books.map((b: any) => ({
          ...b,
          remotePackUrl: `${baseUrl}/releases/latest/download/${b.packFileName}`,
        }));
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(
          JSON.stringify({
            ...sampleCatalog,
            sourceUrl: `${baseUrl}/releases/latest/download/catalog.json`,
            books: dynamicBooks,
          })
        );
        return;
      }

      if (urlPath.startsWith('/releases/latest/download/') && urlPath.endsWith('.abp')) {
        const fileName = path.basename(urlPath);
        const abpPath = path.join(artifactsAbpDir, fileName);
        if (fs.existsSync(abpPath)) {
          res.writeHead(200, { 'content-type': 'application/octet-stream' });
          fs.createReadStream(abpPath).pipe(res);
          return;
        }
      }

      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not Found');
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as any;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  }, 120000);

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    if (fs.existsSync(testUserAbpDir)) {
      fs.rmSync(testUserAbpDir, { recursive: true, force: true });
    }
  });

  it('electron-release.yml 与 package.json 必须严格契合模式 A（壳体与 ABP 资产分离同步发布）', () => {
    const workflowPath = path.join(ROOT, '.github', 'workflows', 'electron-release.yml');
    const yml = fs.readFileSync(workflowPath, 'utf8');
    expect(yml).toContain('npm run build:exercises');
    expect(yml).toContain('pack-book-abp.mjs --all');
    expect(yml).toContain('--release-tag="${{ inputs.tag || github.ref_name }}"');
    expect(yml).toContain('tag_name: ${{ inputs.tag || github.ref_name }}');
    expect(yml).toContain('artifacts/abp-packs/catalog.json');
    expect(yml).toContain('artifacts/abp-packs/*.abp');
    expect(yml).toContain('release/*.exe');
    expect(DEFAULT_DESKTOP_RELEASE_REPO).toBe('Ariesagittarius/AstroLib-Desktop');

    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const files: string[] = pkg.build?.files || [];
    expect(files.some((f) => f.includes('artifacts/abp-packs'))).toBe(false);
    expect(files.some((f) => !f.startsWith('!') && f.includes('.abp'))).toBe(false);
  });

  it('fetchOfficialCatalog + installOfficialBook 能走通版本/哈希校验并原子安装真实 ABP', async () => {
    const catalog = await fetchOfficialCatalog(`${baseUrl}/releases/latest/download/catalog.json`);
    expect(catalog.schemaVersion).toBe(ABP_SCHEMA_VERSION);
    expect(Array.isArray(catalog.books)).toBe(true);

    const eaEntry = catalog.books.find((b) => b.id === 'math-engineering_analysis');
    expect(eaEntry).toBeDefined();
    expect(eaEntry!.remotePackUrl).toContain(baseUrl);
    expect(eaEntry!.contentHash).toBeTruthy();

    fs.rmSync(testUserAbpDir, { recursive: true, force: true });
    const manager = new DesktopBookManager(testUserAbpDir);
    const meta = await installOfficialBook(eaEntry!, manager);
    expect(meta.manifest.id).toBe('math-engineering_analysis');

    const installed = await manager.getInstalledBooks();
    expect(installed.some((b) => b.manifest.id === 'math-engineering_analysis')).toBe(true);
  });

  it('哈希校验不匹配与远端 404 必须阻断安装并给出含 URL 的可诊断错误', async () => {
    const catalog = await fetchOfficialCatalog(`${baseUrl}/releases/latest/download/catalog.json`);
    const eaEntry = catalog.books.find((b) => b.id === 'math-engineering_analysis')!;

    const tamperedDir = path.join(testUserAbpDir, 'tampered');
    fs.rmSync(tamperedDir, { recursive: true, force: true });
    const manager = new DesktopBookManager(tamperedDir);

    await expect(
      installOfficialBook({ ...eaEntry, contentHash: 'deadbeef00000000' }, manager)
    ).rejects.toThrow(/哈希校验失败/);
    expect(await manager.getInstalledBooks()).toHaveLength(0);

    await expect(
      fetchOfficialCatalog(`${baseUrl}/releases/latest/download/missing.json`)
    ).rejects.toThrow(/HTTP=404/);
  });
});
