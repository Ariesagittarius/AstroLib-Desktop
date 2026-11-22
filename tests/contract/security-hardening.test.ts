import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { describe, it, expect, afterEach } from 'vitest';
import { sanitizeAcademicHtml } from '../../src/core/security/html-sanitizer.ts';
import { createSanitizedChildEnv } from '../../src/core/security/child-env.ts';
import { LocalServer } from '../../electron/server/local-server.ts';
import { SettingsManager } from '../../electron/services/settings-manager.ts';
import { extractZipSafely } from '../../src/server/plugins/doc-ingestion/mineru-api-client.ts';

function buildStoredZip(entries: Array<{ name: string; data: string }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const dataBuf = Buffer.from(entry.data, 'utf8');

    const localHdr = Buffer.alloc(30);
    localHdr.writeUInt32LE(0x04034b50, 0);
    localHdr.writeUInt16LE(20, 4);
    localHdr.writeUInt16LE(0, 6);
    localHdr.writeUInt16LE(0, 8);
    localHdr.writeUInt32LE(dataBuf.length, 18);
    localHdr.writeUInt32LE(dataBuf.length, 22);
    localHdr.writeUInt16LE(nameBuf.length, 26);
    localHdr.writeUInt16LE(0, 28);

    const centralHdr = Buffer.alloc(46);
    centralHdr.writeUInt32LE(0x02014b50, 0);
    centralHdr.writeUInt16LE(20, 4);
    centralHdr.writeUInt16LE(20, 6);
    centralHdr.writeUInt16LE(0, 8);
    centralHdr.writeUInt16LE(0, 10);
    centralHdr.writeUInt32LE(dataBuf.length, 20);
    centralHdr.writeUInt32LE(dataBuf.length, 24);
    centralHdr.writeUInt16LE(nameBuf.length, 28);
    centralHdr.writeUInt16LE(0, 30);
    centralHdr.writeUInt16LE(0, 32);
    centralHdr.writeUInt32LE(offset, 42);

    localParts.push(localHdr, nameBuf, dataBuf);
    centralParts.push(centralHdr, nameBuf);
    offset += localHdr.length + nameBuf.length + dataBuf.length;
  }

  const centralBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...localParts, centralBuf, eocd]);
}

function rawHttpRequest(options: {
  port: number;
  path: string;
  headers?: Record<string, string>;
}): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: options.port,
        path: options.path,
        method: 'GET',
        headers: options.headers || {},
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode || 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

describe('Contract: Security & Privacy Hardening', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()!;
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {}
    }
  });

  it('1. sanitizeAcademicHtml strips XSS payloads while preserving KaTeX, MathML, SVG and academic tags', () => {
    const dirty = [
      '<script>alert(1)</script>',
      '<iframe src="https://evil.example"></iframe>',
      '<object data="x"></object>',
      '<embed src="x">',
      '<form action="https://evil.example"><input name="x"></form>',
      '<style>body{background:url(javascript:alert(1))}</style>',
      '<svg viewBox="0 0 100 100" onload="alert(1)"><path d="M0 0 L10 10" stroke="#000" stroke-width="2"></path></svg>',
      '<img src="javascript:alert(1)" onerror="alert(1)" alt="bad">',
      '<details class="solution-details" open ontoggle="alert(1)"><summary>解</summary><p>Step</p></details>',
      '<a href="&#x6a;avascript:alert(1)">bad1</a>',
      '<a href="vbscript:msgbox(1)">bad2</a>',
      '<a href="data:text/html,<script>alert(1)</script>">bad3</a>',
      '<a href="https://example.com" target="_blank">good-link</a>',
      '<span class="katex-html" style="top:-0.25em;height:1.2em" data-latex="\\alpha"><math xmlns="http://www.w3.org/1998/Math/MathML"><mrow><mi>x</mi></mrow></math></span>',
    ].join('\n');

    const clean = sanitizeAcademicHtml(dirty);
    expect(clean).not.toContain('<script');
    expect(clean).not.toContain('alert(1)');
    expect(clean).not.toContain('<iframe');
    expect(clean).not.toContain('<object');
    expect(clean).not.toContain('<embed');
    expect(clean).not.toContain('<form');
    expect(clean).not.toContain('<style');
    expect(clean).not.toMatch(/\son(?:load|error|toggle)\s*=/i);
    expect(clean).not.toMatch(/javascript:/i);
    expect(clean).not.toMatch(/vbscript:/i);
    expect(clean).not.toMatch(/data:text\/html/i);

    expect(clean).toContain('viewBox="0 0 100 100"');
    expect(clean).toContain('d="M0 0 L10 10"');
    expect(clean).toContain('class="solution-details"');
    expect(clean).toContain('<summary>解</summary>');
    expect(clean).toContain('data-latex="\\alpha"');
    expect(clean).toContain('top:-0.25em; height:1.2em');
    expect(clean).toContain('rel="noopener noreferrer"');
    expect(clean).toContain('<math');
  });

  it('2. createSanitizedChildEnv strips secret keys while retaining OS basics and explicit overrides', () => {
    const fakeParentEnv: NodeJS.ProcessEnv = {
      PATH: 'C:\\Windows\\system32',
      GEMINI_API_KEY: 'secret-gemini',
      MINERU_API_TOKEN: 'secret-mineru',
      OPENAI_API_KEY: 'secret-openai',
      AWS_SECRET_ACCESS_KEY: 'secret-aws',
      RANDOM_TOKEN: 'secret-random',
      PYTHONUTF8: '1',
    };

    const sanitized = createSanitizedChildEnv(
      { ELECTRON_RUN_AS_NODE: '1', HF_ENDPOINT: 'https://hf-mirror.com' },
      { sourceEnv: fakeParentEnv }
    );

    expect(sanitized.PATH).toBe('C:\\Windows\\system32');
    expect(sanitized.PYTHONUTF8).toBe('1');
    expect(sanitized.ELECTRON_RUN_AS_NODE).toBe('1');
    expect(sanitized.HF_ENDPOINT).toBe('https://hf-mirror.com');
    expect(sanitized.GEMINI_API_KEY).toBeUndefined();
    expect(sanitized.MINERU_API_TOKEN).toBeUndefined();
    expect(sanitized.OPENAI_API_KEY).toBeUndefined();
    expect(sanitized.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(sanitized.RANDOM_TOKEN).toBeUndefined();
  });

  it('3. LocalServer enforces loopback origin, Sec-Fetch-Site, CSP, and X-AstroLib-Token auth', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'astrolib-sec-srv-'));
    tempDirs.push(tmpRoot);
    fs.mkdirSync(path.join(tmpRoot, 'dist'), { recursive: true });
    fs.mkdirSync(path.join(tmpRoot, 'user-abp'), { recursive: true });

    const server = new LocalServer(tmpRoot, path.join(tmpRoot, 'dist'), path.join(tmpRoot, 'user-abp'));
    const port = await server.start(0);
    const token = server.getAuthToken();

    try {
      const evilOrigin = await rawHttpRequest({
        port,
        path: '/api/desktop/health',
        headers: { Origin: 'https://evil.example' },
      });
      expect(evilOrigin.statusCode).toBe(403);

      const crossPortOrigin = await rawHttpRequest({
        port,
        path: '/api/desktop/health',
        headers: { Origin: `http://127.0.0.1:${port + 1}` },
      });
      expect(crossPortOrigin.statusCode).toBe(403);

      const nullOrigin = await rawHttpRequest({
        port,
        path: '/api/desktop/health',
        headers: { Origin: 'null' },
      });
      expect(nullOrigin.statusCode).toBe(403);

      const crossSite = await rawHttpRequest({
        port,
        path: '/api/desktop/health',
        headers: { 'Sec-Fetch-Site': 'cross-site' },
      });
      expect(crossSite.statusCode).toBe(403);

      const badHost = await rawHttpRequest({
        port,
        path: '/api/desktop/health',
        headers: { Host: 'evil.example:62960' },
      });
      expect(badHost.statusCode).toBe(403);

      const unauthApi = await rawHttpRequest({
        port,
        path: '/api/v1/content/books',
      });
      expect(unauthApi.statusCode).toBe(401);

      const wrongToken = await rawHttpRequest({
        port,
        path: '/api/ingest/health',
        headers: { 'X-AstroLib-Token': 'wrong-token' },
      });
      expect(wrongToken.statusCode).toBe(401);

      const healthOk = await rawHttpRequest({
        port,
        path: '/api/desktop/health',
        headers: { Origin: `http://127.0.0.1:${port}` },
      });
      expect(healthOk.statusCode).toBe(200);
      expect(healthOk.headers['access-control-allow-origin']).not.toBe('*');
      expect(healthOk.headers['x-content-type-options']).toBe('nosniff');
      expect(healthOk.headers['content-security-policy']).toContain("object-src 'none'");

      const authedApi = await rawHttpRequest({
        port,
        path: '/api/ingest/health',
        headers: { 'X-AstroLib-Token': token },
      });
      expect(authedApi.statusCode).toBe(200);
      expect(authedApi.headers['access-control-allow-origin']).toBeUndefined();
    } finally {
      await server.stop();
    }
  });

  it('4. Static scan verifies zero wildcard Access-Control-Allow-Origin headers remain in server/electron', () => {
    const ROOT = path.resolve(__dirname, '../..');
    const badFiles: string[] = [];
    for (const relDir of ['electron', 'src/server/plugins']) {
      const absDir = path.join(ROOT, relDir);
      if (!fs.existsSync(absDir)) continue;
      const walk = (d: string) => {
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
          const full = path.join(d, entry.name);
          if (entry.isDirectory()) {
            walk(full);
          } else if (/\.(ts|mts|js|mjs)$/.test(entry.name)) {
            const txt = fs.readFileSync(full, 'utf8');
            if (/Access-Control-Allow-Origin['"]?\s*[:=,]\s*['"]\*/i.test(txt)) {
              badFiles.push(path.relative(ROOT, full));
            }
          }
        }
      };
      walk(absDir);
    }
    expect(badFiles).toEqual([]);
  });

  it('5. SettingsManager encrypts sensitive API keys on disk via safeStorage and decrypts on reload', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'astrolib-sec-settings-'));
    tempDirs.push(tmpDir);

    const mgr = new SettingsManager(tmpDir);
    const fakeKey = 'secret_key_for_unit_test_only';
    mgr.set('astrolib_gemini_api_key', fakeKey);
    mgr.set('starlight-font', '{"latin":"sans","cjk":"han-sans"}');
    mgr.flushToDiskSync();

    const rawDisk = fs.readFileSync(path.join(tmpDir, 'user_preferences.json'), 'utf8');
    expect(rawDisk).not.toContain(fakeKey);
    const parsedDisk = JSON.parse(rawDisk);
    expect(parsedDisk.astrolib_gemini_api_key).toMatch(/^enc:v1:/);
    expect(parsedDisk['starlight-font']).toBe('{"latin":"sans","cjk":"han-sans"}');

    const reloaded = new SettingsManager(tmpDir);
    expect(reloaded.get('astrolib_gemini_api_key')).toBe(fakeKey);
  });

  it('6. extractZipSafely rejects ZipSlip traversal entries and extracts valid archives', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'astrolib-sec-zip-'));
    tempDirs.push(tmpDir);

    const slipOut = path.join(tmpDir, 'slip-target');
    const maliciousZip = buildStoredZip([{ name: '../escape.txt', data: 'owned' }]);
    await expect(extractZipSafely(maliciousZip, slipOut)).rejects.toThrow(/ZipSlip|穿越/);
    expect(fs.existsSync(path.join(tmpDir, 'escape.txt'))).toBe(false);

    const safeOut = path.join(tmpDir, 'safe-target');
    const goodZip = buildStoredZip([{ name: 'nested/readme.txt', data: 'hello-abp' }]);
    const files = await extractZipSafely(goodZip, safeOut);
    expect(files).toEqual(['nested/readme.txt']);
    expect(fs.readFileSync(path.join(safeOut, 'nested', 'readme.txt'), 'utf8')).toBe('hello-abp');
  });
});
