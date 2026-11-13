import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import asar from '@electron/asar';

describe('Electron Packaging Hygiene & Forbidden Paths Contract', () => {
  const ROOT = path.resolve(__dirname, '../..');

  it('package.json build.files 必须排除缓存、临时文件、非 Win-x64 原生二进制与源码树', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const files: string[] = pkg.build?.files || [];

    expect(files).toContain('!**/.cache/**');
    expect(files).toContain('!**/*.tmp*');
    expect(files).toContain('!node_modules/onnxruntime-web/**');
    expect(files).toContain('!node_modules/**/onnxruntime-node/bin/**/darwin/**');
    expect(files).toContain('!node_modules/**/onnxruntime-node/bin/**/linux/**');
    expect(files).toContain('!node_modules/**/onnxruntime-node/bin/**/win32/arm64/**');
    expect(files).toContain('!content-sources/**');
    expect(files).toContain('!dist/collections/**');
    expect(files).toContain('!dist/abp-packs/*.abp');
    expect(files).toContain('!dist/abp-packs/*/**');
  });

  it('若本地存在 release/win-unpacked/resources/app.asar，则禁止路径违规必须为 0 且体积 <= 200 MB', () => {
    const asarPath = path.join(ROOT, 'release', 'win-unpacked', 'resources', 'app.asar');
    if (!fs.existsSync(asarPath)) {
      // 未运行 electron-builder --dir 的 CI/单元测试阶段仅校验打包配置契约
      return;
    }

    const sizeMb = fs.statSync(asarPath).size / (1024 * 1024);
    expect(sizeMb).toBeLessThanOrEqual(200);

    const raw = asar.getRawHeader(asarPath);
    const forbidden: RegExp[] = [
      /^src\//,
      /^content-sources\//,
      /^public\/abp-packs\//,
      /^dist\/collections\//,
      /\/\.cache\//,
      /\.tmp/i,
      /\/bin\/napi-v\d+\/(darwin|linux)\//,
      /\/win32\/arm64\//,
      /^node_modules\/onnxruntime-web\//,
      /\.abp$/i,
    ];

    const violations: string[] = [];
    function walk(node: any, prefix: string) {
      if (node.files) {
        for (const [k, v] of Object.entries(node.files)) {
          walk(v, prefix ? `${prefix}/${k}` : k);
        }
      } else {
        for (const re of forbidden) {
          if (re.test(prefix)) {
            violations.push(prefix);
            break;
          }
        }
      }
    }
    walk(raw.header, '');
    expect(violations).toEqual([]);
  });

  it('package.json build 配置必须显式固定 nsis 与 portable 的无空格 artifactName', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.build?.nsis?.artifactName).toBe('${productName}-Setup-${version}.${ext}');
    expect(pkg.build?.portable?.artifactName).toBe('${productName}-Portable-${version}.${ext}');
  });
});
