import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function getFilesRecursively(dir: string, ext = '.ts'): string[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getFilesRecursively(fullPath, ext));
    } else if (entry.isFile() && (entry.name.endsWith(ext) || entry.name.endsWith('.mjs'))) {
      files.push(fullPath);
    }
  }
  return files;
}

describe('Architecture Boundary Contract Tests', () => {
  it('src/services/ 严禁反向依赖 UI 层 src/components/', () => {
    const servicesDir = path.resolve('src/services');
    const serviceFiles = getFilesRecursively(servicesDir);

    const violations: string[] = [];
    for (const file of serviceFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        if (/from\s+['"].*components\//.test(line)) {
          violations.push(`${path.relative(process.cwd(), file)}:${idx + 1} -> ${line.trim()}`);
        }
      });
    }

    expect(violations).toEqual([]);
  });

  it('src/utils/ 纯函数层严禁依赖构建适配器 src/server/', () => {
    const utilsDir = path.resolve('src/utils');
    const utilFiles = getFilesRecursively(utilsDir);

    const violations: string[] = [];
    for (const file of utilFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        if (/from\s+['"].*server\//.test(line)) {
          violations.push(`${path.relative(process.cwd(), file)}:${idx + 1} -> ${line.trim()}`);
        }
      });
    }

    expect(violations).toEqual([]);
  });

  it('src/config/ 与 src/utils/ 严禁存在一行 export * from 垫片文件', () => {
    const targetDirs = [path.resolve('src/config'), path.resolve('src/utils')];
    const shims: string[] = [];

    for (const dir of targetDirs) {
      const files = getFilesRecursively(dir);
      for (const file of files) {
        const content = fs.readFileSync(file, 'utf-8').trim();
        const lines = content.split('\n').filter((l) => l.trim().length > 0 && !l.trim().startsWith('//') && !l.trim().startsWith('/*') && !l.trim().startsWith('*'));
        if (lines.length === 1 && lines[0].startsWith('export * from')) {
          shims.push(path.relative(process.cwd(), file));
        }
      }
    }

    expect(shims).toEqual([]);
  });
});
