/**
 * tests/contract/cli-runner.test.ts
 * ============================================================================
 * Phase 1 astrolib-cli 命令行运行器端到端测试 (供第三方审计)
 * ============================================================================
 */

import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const execFileAsync = promisify(execFile);
const cliPath = path.resolve(process.cwd(), 'bin/astrolib-cli.mjs');

describe('Phase 1: astrolib-cli End-to-End CLI Tests', () => {
  it('1. books 命令应成功输出所有图书且返回 exit 0', async () => {
    const { stdout } = await execFileAsync(process.execPath, [cliPath, 'books']);
    const res = JSON.parse(stdout);
    expect(res.success).toBe(true);
    expect(res.count).toBeGreaterThanOrEqual(13);
    expect(Array.isArray(res.data)).toBe(true);
  });

  it('2. toc 命令应成功输出树状目录 JSON', async () => {
    const { stdout } = await execFileAsync(process.execPath, [cliPath, 'toc', 'math', 'linear_algebra_geometry']);
    const res = JSON.parse(stdout);
    expect(res.success).toBe(true);
    expect(res.data.catalog).toBeDefined();
    expect(res.data.catalog.length).toBeGreaterThan(0);
  });

  it('3. chapter 命令 --format=cards 应提取卡片列表', async () => {
    const { stdout } = await execFileAsync(process.execPath, [
      cliPath,
      'chapter',
      'math',
      'linear_algebra_geometry',
      '11_二三阶行列式',
      '--format=cards',
    ]);
    const res = JSON.parse(stdout);
    expect(res.success).toBe(true);
    expect(res.count).toBeGreaterThanOrEqual(8);
    expect(res.data[0].tag).toBeDefined();
    expect(res.data[0].lineStart).toBeGreaterThan(0);
  });

  it('4. chapter 命令 --format=formulas 应提取数学公式', async () => {
    const { stdout } = await execFileAsync(process.execPath, [
      cliPath,
      'chapter',
      'math',
      'linear_algebra_geometry',
      '11_二三阶行列式',
      '--format=formulas',
    ]);
    const res = JSON.parse(stdout);
    expect(res.success).toBe(true);
    expect(res.count).toBeGreaterThan(20);
    expect(res.data[0].latex).toBeDefined();
  });

  it('5. exercises 命令应检索指定章节习题', async () => {
    const { stdout } = await execFileAsync(process.execPath, [
      cliPath,
      'exercises',
      'math',
      'linear_algebra_geometry',
      '1.1_二三阶行列式',
    ]);
    const res = JSON.parse(stdout);
    expect(res.success).toBe(true);
    expect(res.count).toBeGreaterThanOrEqual(1);
    expect(res.data[0].question).toContain('行列式');
  });

  it('6. mineru 命令应列出已有 MinerU 任务', async () => {
    const { stdout } = await execFileAsync(process.execPath, [cliPath, 'mineru']);
    const res = JSON.parse(stdout);
    expect(res.success).toBe(true);
    expect(res.count).toBeGreaterThanOrEqual(1);
  });

  it('7. 错误参数时应返回结构化错误 JSON 并在 stderr/stdout 保持清晰', async () => {
    try {
      await execFileAsync(process.execPath, [cliPath, 'chapter', 'math', 'linear_algebra_geometry', 'non_existing_slug']);
      expect.fail('应触发非零退出码');
    } catch (err: any) {
      expect(err.code).toBe(1);
      const res = JSON.parse(err.stdout);
      expect(res.success).toBe(false);
      expect(res.error).toContain('未找到章节');
    }
  });
});
