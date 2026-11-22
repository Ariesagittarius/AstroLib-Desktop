/**
 * tests/contract/harness-chat-endpoint.test.ts
 * ============================================================================
 * AstroLib Agent Harness 对话端点与学校免费 API (baigong) 契约测试
 * ============================================================================
 */

import { describe, it, expect } from 'vitest';
import https from 'node:https';

describe('AstroLib Harness: School Free API (baigong) Contract Tests', () => {
  const BAIGONG_BASE_URL = 'https://gateway.baigongai.cn/v1';
  const BAIGONG_API_KEY = process.env.BAIGONG_API_KEY || process.env.ASTROLIB_YOULABBER_API_KEY || '';
  const RUN_LIVE_API_TESTS = process.env.ASTROLIB_RUN_LIVE_API_TESTS === '1' && Boolean(BAIGONG_API_KEY);
  const BAIGONG_SESSION_ID = 'youlabber-local-pc';
  const DEFAULT_MODEL = 'ybg-youlaber-ds4f';

  it.skipIf(!RUN_LIVE_API_TESTS)('1. 邮百工网关直连连通性验证 (Non-streaming)', async () => {
    const payload = JSON.stringify({
      model: DEFAULT_MODEL,
      messages: [{ role: 'user', content: 'Ping: 1+1=?' }],
      stream: false,
    });

    const result = await new Promise<{ statusCode?: number; data: any }>((resolve, reject) => {
      const req = https.request(
        `${BAIGONG_BASE_URL}/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${BAIGONG_API_KEY}`,
            'X-YBG-Session-ID': BAIGONG_SESSION_ID,
            'Content-Length': Buffer.byteLength(payload),
          },
          timeout: 10000,
        },
        (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => {
            try {
              resolve({ statusCode: res.statusCode, data: JSON.parse(body) });
            } catch (e) {
              resolve({ statusCode: res.statusCode, data: body });
            }
          });
        }
      );
      req.on('error', reject);
      req.write(payload);
      req.end();
    });

    expect(result.statusCode).toBe(200);
    expect(result.data).toBeDefined();
    expect(result.data.choices).toBeDefined();
    expect(result.data.choices.length).toBeGreaterThan(0);
    expect(result.data.choices[0].message.content).toBeDefined();
  }, 15000);

  it.skipIf(!RUN_LIVE_API_TESTS)('2. 邮百工网关 SSE 流式通信与 Reasoning/Content 字段契约验证', async () => {
    const payload = JSON.stringify({
      model: DEFAULT_MODEL,
      messages: [{ role: 'user', content: '简要计算 2+3' }],
      stream: true,
    });

    const chunks = await new Promise<string[]>((resolve, reject) => {
      const received: string[] = [];
      const req = https.request(
        `${BAIGONG_BASE_URL}/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${BAIGONG_API_KEY}`,
            'X-YBG-Session-ID': BAIGONG_SESSION_ID,
            'Content-Length': Buffer.byteLength(payload),
          },
          timeout: 10000,
        },
        (res) => {
          res.on('data', (c) => received.push(c.toString()));
          res.on('end', () => resolve(received));
        }
      );
      req.on('error', reject);
      req.write(payload);
      req.end();
    });

    expect(chunks.length).toBeGreaterThan(0);
    const fullText = chunks.join('');
    expect(fullText).toContain('data:');
    expect(fullText).toContain('[DONE]');

    // 验证能够解析出 reasoning 或 content
    const lines = fullText.split('\n').filter((l) => l.startsWith('data: ') && !l.includes('[DONE]'));
    let hasDelta = false;
    for (const l of lines) {
      try {
        const json = JSON.parse(l.replace('data: ', ''));
        const delta = json.choices?.[0]?.delta;
        if (delta && (delta.content !== undefined || delta.reasoning !== undefined)) {
          hasDelta = true;
          break;
        }
      } catch {}
    }
    expect(hasDelta).toBe(true);
  }, 15000);
});
