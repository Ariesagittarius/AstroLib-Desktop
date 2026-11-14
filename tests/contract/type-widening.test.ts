/**
 * tests/contract/type-widening.test.ts
 * ============================================================================
 * Type Widening & Strict Schema Governance Contract Suite (P1-E3)
 * ============================================================================
 * 规范与约束：
 * 1. 严禁在 src/types/ 中出现 'literal' | string 形式的宽泛字面量联合；
 * 2. 严禁在 src/types/ 中出现 (string & {}) 伪收窄 hack；
 * 3. 允许合法的标量与数组值联合，如 tocMapping: Record<string, string | string[]>；
 * 4. 确保类型系统真实起到编译期静态拦截作用。
 * ============================================================================
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

function getFilesRecursively(dir: string, ext = '.ts'): string[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getFilesRecursively(fullPath, ext));
    } else if (entry.isFile() && entry.name.endsWith(ext)) {
      files.push(fullPath);
    }
  }
  return files;
}

describe('Type Widening Contract Suite (P1-E3 / ADR-GOVERNANCE)', () => {
  const typesDir = path.resolve('src/types');
  const typeFiles = getFilesRecursively(typesDir);

  it('1. src/types/ 中严禁出现字面量宽泛联合 (\'literal\' | string 或 "literal" | string)', () => {
    const violations: string[] = [];
    const literalPipeStringRegex = /['"][^'"]+['"]\s*\|\s*string\b|string\s*\|\s*['"][^'"]+['"]/;

    for (const file of typeFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        // 排除注释
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;

        if (literalPipeStringRegex.test(line)) {
          violations.push(`${path.relative(process.cwd(), file)}:${idx + 1} -> ${trimmed}`);
        }
      });
    }

    expect(violations, `发现非法宽泛字面量联合:\n${violations.join('\n')}`).toEqual([]);
  });

  it('2. src/types/ 中严禁使用 (string & {}) 伪收窄技巧', () => {
    const violations: string[] = [];
    const pseudoBrandRegex = /string\s*&\s*\{\s*\}/;

    for (const file of typeFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;

        if (pseudoBrandRegex.test(line)) {
          violations.push(`${path.relative(process.cwd(), file)}:${idx + 1} -> ${trimmed}`);
        }
      });
    }

    expect(violations, `发现 (string & {}) 伪收窄 hack:\n${violations.join('\n')}`).toEqual([]);
  });

  it('3. 允许合法的标量/数组值联合例外 (如 string | string[])', () => {
    const collectionsTypeFile = path.join(typesDir, 'collections.ts');
    expect(fs.existsSync(collectionsTypeFile)).toBe(true);
    const content = fs.readFileSync(collectionsTypeFile, 'utf-8');
    expect(content).toContain('tocMapping?: Record<string, string | string[]>');
  });
});
