/**
 * tests/unit/antigravity-cli-integration.test.ts
 * ============================================================================
 * AstroLib Antigravity CLI 本地智能体接入与静默自省单元测试
 * ============================================================================
 */

import { describe, it, expect } from 'vitest';
import { AntigravityCliService } from '../../src/services/antigravity-cli/antigravity-cli-service.ts';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const execFileAsync = promisify(execFile);

describe('Antigravity CLI Agent Integration Tests', () => {
  const service = AntigravityCliService.getInstance(process.cwd());

  it('1. 静默环境自省应在未安装时静默返回 false，在安装时正确识别版本', async () => {
    const status = await service.detectCli();
    expect(status).toBeDefined();
    expect(typeof status.available).toBe('boolean');

    if (status.available) {
      expect(status.version).toBeDefined();
      expect(status.executablePath).toBeDefined();
      expect(status.models && status.models.length).toBeGreaterThan(0);
      expect(status.models?.some((m) => m.id === 'gemini-3.8-flash-high')).toBe(true);
    }
  });

  it('2. 默认模型列表应包含 Gemini 3.8 Flash (High) 与 Claude 系列高表述模型', () => {
    const models = service.getDefaultModels();
    expect(models.length).toBeGreaterThanOrEqual(4);

    const geminiHigh = models.find((m) => m.id === 'gemini-3.8-flash-high');
    expect(geminiHigh).toBeDefined();
    expect(geminiHigh?.name).toContain('Gemini 3.8 Flash (High)');
    expect(geminiHigh?.reasoningEffort).toBe('high');

    const claudeSonnet = models.find((m) => m.id === 'claude-sonnet-4-6');
    expect(claudeSonnet).toBeDefined();
    expect(claudeSonnet?.reasoningEffort).toBe('high');

    const claudeOpus = models.find((m) => m.id === 'claude-opus-4-6-thinking');
    expect(claudeOpus).toBeDefined();
    expect(claudeOpus?.reasoningEffort).toBe('max');
  });

  it('3. AstroLib 官方 MCP Server 应暴露完整 7 大核心学术工具', () => {
    const mcpScript = path.resolve(process.cwd(), 'bin/astrolib-mcp.mjs');
    const inputPayload = JSON.stringify({ jsonrpc: '2.0', id: 101, method: 'tools/list' }) + '\n';

    const stdout = execFileSync(process.execPath, [mcpScript], {
      input: inputPayload,
      encoding: 'utf-8',
      timeout: 10000,
    });

    const parsed = JSON.parse(stdout.trim());
    expect(parsed.jsonrpc).toBe('2.0');
    expect(parsed.id).toBe(101);
    expect(parsed.result?.tools).toBeDefined();

    const toolNames = parsed.result.tools.map((t: any) => t.name);
    expect(toolNames).toContain('locate_content');
    expect(toolNames).toContain('get_books_catalog');
    expect(toolNames).toContain('get_book_toc');
    expect(toolNames).toContain('get_chapter_ast');
    expect(toolNames).toContain('read_content_node');
    expect(toolNames).toContain('search_exercises');
    expect(toolNames).toContain('diff_chapters');
  });

  it('4. AstroLib 官方 MCP Server tools/call 可正确解析 locate_content 工具调用', () => {
    const mcpScript = path.resolve(process.cwd(), 'bin/astrolib-mcp.mjs');
    const inputPayload =
      JSON.stringify({
        jsonrpc: '2.0',
        id: 102,
        method: 'tools/call',
        params: {
          name: 'locate_content',
          arguments: { query: '数学分析 2.1' },
        },
      }) + '\n';

    const stdout = execFileSync(process.execPath, [mcpScript], {
      input: inputPayload,
      encoding: 'utf-8',
      timeout: 10000,
    });

    const parsed = JSON.parse(stdout.trim());
    expect(parsed.id).toBe(102);
    expect(parsed.result?.content?.[0]?.text).toBeDefined();

    const data = JSON.parse(parsed.result.content[0].text);
    expect(data.uri).toContain('astrolib://math/math_analysis');
    expect(data.bookSlug).toBe('math_analysis');
  });

  it('5. astrolib-cli 应支持 locate 和 read 命令行快捷调用', async () => {
    const cliScript = path.resolve(process.cwd(), 'bin/astrolib-cli.mjs');

    const { stdout: locateOut } = await execFileAsync(process.execPath, [cliScript, 'locate', '数学分析'], {
      timeout: 10000,
    });
    const locateData = JSON.parse(locateOut.trim());
    expect(locateData.success).toBe(true);
    expect(locateData.data.bookSlug).toBe('math_analysis');
  });
});
