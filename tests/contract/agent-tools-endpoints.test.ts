/**
 * tests/contract/agent-tools-endpoints.test.ts
 * ============================================================================
 * Agent 扩展工具后端端点 (/api/v1/content/agent-tools/*) HTTP 契约测试
 * ============================================================================
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { URL } from 'node:url';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { handleAgentToolsRoute } from '../../src/server/plugins/content-api/agent-tools-handler.ts';

async function requestJson(
  baseUrl: string,
  method: string,
  urlPath: string,
  body?: Record<string, any>
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  return { status: res.status, json };
}

describe('Agent Tools HTTP Endpoints Contract Tests', () => {
  let server: http.Server;
  let baseUrl = '';
  let sandboxDir = '';
  let prevEnv: string | undefined;

  beforeAll(async () => {
    prevEnv = process.env.ASTROLIB_AGENT_WORKSPACE;
    sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'astrolib-agent-test-'));
    process.env.ASTROLIB_AGENT_WORKSPACE = sandboxDir;

    server = http.createServer(async (req, res) => {
      const parsedUrl = new URL(req.url || '/', 'http://127.0.0.1');
      const handled = await handleAgentToolsRoute(req, res, parsedUrl.pathname, parsedUrl);
      if (!handled) {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as any;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (prevEnv === undefined) {
      delete process.env.ASTROLIB_AGENT_WORKSPACE;
    } else {
      process.env.ASTROLIB_AGENT_WORKSPACE = prevEnv;
    }
    try {
      fs.rmSync(sandboxDir, { recursive: true, force: true });
    } catch {}
  });

  it('1. GET /agent-tools/source 应只读放行白名单插件源码并拒绝路径穿越/非白名单文件', async () => {
    const okRes = await requestJson(
      baseUrl,
      'GET',
      '/agent-tools/source?file=src/plugins/harness/builtin/ast.plugin.ts'
    );
    expect(okRes.status).toBe(200);
    expect(okRes.json.success).toBe(true);
    expect(okRes.json.data.content).toContain('AstPlugin');

    const traversal = await requestJson(
      baseUrl,
      'GET',
      '/agent-tools/source?file=../../package.json'
    );
    expect(traversal.status).toBe(403);
    expect(traversal.json.success).toBe(false);

    const nonWhitelisted = await requestJson(
      baseUrl,
      'GET',
      '/agent-tools/source?file=package.json'
    );
    expect(nonWhitelisted.status).toBe(403);
    expect(nonWhitelisted.json.success).toBe(false);
  });

  it('2. POST /agent-tools/fs/write 应严格将写操作限制在工作区沙箱内，阻止逃逸路径', async () => {
    const writeOk = await requestJson(baseUrl, 'POST', '/agent-tools/fs/write', {
      relPath: 'notes/verify.md',
      content: '# 验算记录\n行列式值为 -2',
    });
    expect(writeOk.status).toBe(200);
    expect(writeOk.json.success).toBe(true);
    expect(writeOk.json.data.relPath).toBe('notes/verify.md');
    expect(fs.existsSync(path.join(sandboxDir, 'notes/verify.md'))).toBe(true);

    const readBack = await requestJson(baseUrl, 'POST', '/agent-tools/fs/read', {
      filePath: 'workspace/notes/verify.md',
    });
    expect(readBack.status).toBe(200);
    expect(readBack.json.data.content).toContain('行列式值为 -2');

    const escapeWrite = await requestJson(baseUrl, 'POST', '/agent-tools/fs/write', {
      relPath: '../outside.txt',
      content: 'should not write',
    });
    expect(escapeWrite.status).toBe(403);
    expect(escapeWrite.json.success).toBe(false);
  });

  it('3. POST /agent-tools/search-library 应检索全库教材并返回标准 astrolib:// URI 命中', async () => {
    const searchRes = await requestJson(baseUrl, 'POST', '/agent-tools/search-library', {
      query: '行列式',
      maxResults: 8,
    });
    expect(searchRes.status).toBe(200);
    expect(searchRes.json.success).toBe(true);
    expect(Array.isArray(searchRes.json.data.hits)).toBe(true);
    expect(searchRes.json.data.hits.length).toBeGreaterThan(0);

    const first = searchRes.json.data.hits[0];
    expect(first.uri).toMatch(/^astrolib:\/\//);
    expect(first.text).toContain('行列式');
  });

  it('4. POST /agent-tools/python 应执行隔离开箱计算或优雅反馈 Python 不可用状态', async () => {
    const pyRes = await requestJson(baseUrl, 'POST', '/agent-tools/python', {
      code: 'print(6 * 7)',
    });
    if (pyRes.status === 200) {
      expect(pyRes.json.success).toBe(true);
      expect(pyRes.json.data.exitCode).toBe(0);
      expect(String(pyRes.json.data.stdout)).toContain('42');
    } else {
      // 环境无可用 Python 时应返回明确可读错误，不得崩溃
      expect(pyRes.json.success).toBe(false);
      expect(typeof pyRes.json.error).toBe('string');
    }
  });
});
