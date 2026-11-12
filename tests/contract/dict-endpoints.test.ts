/**
 * tests/contract/dict-endpoints.test.ts
 * ============================================================================
 * 契约测试：验证 api/dict.ts 端点协议与 CORS
 * ============================================================================
 */

import { describe, it, expect } from 'vitest';
import handler, { GET, POST, OPTIONS } from '../../api/translate';

describe('Vercel Serverless Function api/translate.ts Dictionary Suite', () => {
  it('OPTIONS 请求应正确返回 204 与 CORS 跨域响应头 (Web)', async () => {
    const req = new Request('https://astrolib.cloud/api/translate/dict', { method: 'OPTIONS' });
    const res = await OPTIONS(req);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET');
  });

  it('GET 词典请求缺少 word 时应返回 400 (Web)', async () => {
    const req = new Request('https://astrolib.cloud/api/translate/dict?word=', { method: 'GET' });
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  it('GET 请求有效单词应返回 200 与标准词典结构 (Web)', async () => {
    const req = new Request('https://astrolib.cloud/api/translate/dict?word=attention', { method: 'GET' });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.word).toBe('attention');
    expect(Array.isArray(body.meanings)).toBe(true);
    expect(body.meanings.length).toBeGreaterThan(0);
  });

  it('POST 请求应支持学术语境解析 (Web)', async () => {
    const req = new Request('https://astrolib.cloud/api/translate/dict/context', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        word: 'intermediate',
        sentence: 'to compute the intermediate values resulting in passes over Q.',
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.word).toBe('intermediate');
    expect(body.explanation).toBeDefined();
  });
});
