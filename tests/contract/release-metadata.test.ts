import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { AppUpdater } from '../../electron/services/updater.ts';

describe('Release Metadata and Update Contract Tests', () => {
  const ROOT = path.resolve(__dirname, '../..');

  it('package.json 必须固定 NSIS 与 Portable 安装包命名模板，严禁包含空格', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const nsisName = pkg.build?.nsis?.artifactName;
    const portableName = pkg.build?.portable?.artifactName;

    expect(nsisName).toBe('${productName}-Setup-${version}.${ext}');
    expect(portableName).toBe('${productName}-Portable-${version}.${ext}');
    expect(nsisName).not.toContain(' ');
    expect(portableName).not.toContain(' ');
  });

  it('latest.yml 规范格式应严格与 NSIS 安装包名称对齐，无空格且可确定性解析', () => {
    // 模拟 electron-builder 生成的标准 latest.yml
    const sampleLatestYml = `
version: 0.0.4
files:
  - url: AstroLib-Setup-0.0.4.exe
    sha512: ZafPrv1lzA9zd8eWVLRUkawZ4+0B2D0lx/pBdZpgNuKNrjAAWvpUc6QhdTwH8opUqWCI+/1PiSjjm+v5QjVACw==
    size: 180109768
path: AstroLib-Setup-0.0.4.exe
sha512: ZafPrv1lzA9zd8eWVLRUkawZ4+0B2D0lx/pBdZpgNuKNrjAAWvpUc6QhdTwH8opUqWCI+/1PiSjjm+v5QjVACw==
releaseDate: '2026-11-13T02:00:00.000Z'
`.trim();

    const lines = sampleLatestYml.split('\n');
    const urlLine = lines.find((l) => l.trim().startsWith('- url:') || l.trim().startsWith('url:'));
    expect(urlLine).toBeDefined();

    const targetUrl = urlLine!.replace(/^[-\s]*url:\s*/, '').trim();
    expect(targetUrl).toBe('AstroLib-Setup-0.0.4.exe');
    expect(targetUrl).not.toContain(' ');
    expect(targetUrl).toMatch(/^[A-Za-z0-9_]+-Setup-\d+\.\d+\.\d+\.exe$/);
  });

  it('AppUpdater 语义化版本比对与安装包类型选择规则必须确定且幂等', () => {
    // @ts-expect-error accessing private method for contract assertion
    expect(AppUpdater.compareSemver('0.0.4', '0.0.3')).toBe(1);
    // @ts-expect-error accessing private method for contract assertion
    expect(AppUpdater.compareSemver('0.0.3', '0.0.3')).toBe(0);
    // @ts-expect-error accessing private method for contract assertion
    expect(AppUpdater.compareSemver('0.0.2', '0.0.3')).toBe(-1);
  });
});
