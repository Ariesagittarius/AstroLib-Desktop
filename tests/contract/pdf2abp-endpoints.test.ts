import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pdf2abpDevServerPlugin } from '../../src/server/plugins/pdf2abp/dev-server-plugin.mjs';
import { JobWorkspace } from '../../src/services/pdf2abp/workspace-manager.ts';

describe('Contract: PDF2ABP REST/SSE Server Plugin (/api/v1/pdf2abp/*)', () => {
  let tmpRoot: string;
  let origJobsDirEnv: string | undefined;
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'astrolib-pdf2abp-http-'));
    origJobsDirEnv = process.env.ASTROLIB_PDF2ABP_DIR;
    process.env.ASTROLIB_PDF2ABP_DIR = path.join(tmpRoot, 'jobs');

    const middlewares: Array<(req: http.IncomingMessage, res: http.ServerResponse, next: () => void) => void> = [];
    const plugin = pdf2abpDevServerPlugin();
    plugin.configureServer({
      middlewares: {
        use(fn: any) {
          middlewares.push(fn);
        },
      },
    } as any);

    server = http.createServer((req, res) => {
      let idx = 0;
      const next = () => {
        const mw = middlewares[idx++];
        if (mw) {
          mw(req, res, next);
        } else {
          res.statusCode = 404;
          res.end('Not handled');
        }
      };
      next();
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (origJobsDirEnv === undefined) {
      delete process.env.ASTROLIB_PDF2ABP_DIR;
    } else {
      process.env.ASTROLIB_PDF2ABP_DIR = origJobsDirEnv;
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('returns gateway capabilities & environment health on GET /health', async () => {
    const res = await fetch(`${baseUrl}/api/v1/pdf2abp/health`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.ok).toBe(true);
    expect(json.mineru).toBeDefined();
    expect(json.python).toBeDefined();
    expect(json.defaultGateway.capabilities.maxImagesPerRequest).toBe(1);
    expect(json.defaultGateway.capabilities.maxContextTokens).toBe(262144);
  });

  it('lists and serves built-in PDF2ABP skills', async () => {
    const listRes = await fetch(`${baseUrl}/api/v1/pdf2abp/skills`);
    expect(listRes.status).toBe(200);
    const listJson = (await listRes.json()) as any;
    const ids = (listJson.skills || []).map((s: any) => s.id);
    expect(ids).toContain('abp-spec');
    expect(ids).toContain('pdf2abp-orchestrator-sop');
    expect(ids).toContain('subagent-proofreader-protocol');

    const readRes = await fetch(`${baseUrl}/api/v1/pdf2abp/skills/abp-spec`);
    expect(readRes.status).toBe(200);
    const readJson = (await readRes.json()) as any;
    expect(readJson.skill.id).toBe('abp-spec');
    expect(readJson.skill.content).toContain('<Knowledge');

    const missRes = await fetch(`${baseUrl}/api/v1/pdf2abp/skills/nonexistent`);
    expect(missRes.status).toBe(404);
  });

  it('rejects invalid PDF paths on POST /jobs and missing jobs on GET /jobs/:id', async () => {
    const emptyRes = await fetch(`${baseUrl}/api/v1/pdf2abp/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(emptyRes.status).toBe(400);

    const missingFileRes = await fetch(`${baseUrl}/api/v1/pdf2abp/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pdfPath: path.join(tmpRoot, 'does-not-exist.pdf') }),
    });
    expect(missingFileRes.status).toBe(400);
    const errJson = (await missingFileRes.json()) as any;
    expect(errJson.errorCode).toBe('PDF_NOT_FOUND');

    const txtFile = path.join(tmpRoot, 'notes.txt');
    fs.writeFileSync(txtFile, 'not pdf');
    const nonPdfRes = await fetch(`${baseUrl}/api/v1/pdf2abp/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pdfPath: txtFile }),
    });
    expect(nonPdfRes.status).toBe(400);

    const notFoundJob = await fetch(`${baseUrl}/api/v1/pdf2abp/jobs/job_missing_xyz`);
    expect(notFoundJob.status).toBe(404);
  });

  it('reads sandboxed workspace files and blocks path traversal on GET /jobs/:id/file', async () => {
    const dummyPdf = path.join(tmpRoot, 'book.pdf');
    fs.writeFileSync(dummyPdf, '%PDF-1.4\n');
    const ws = new JobWorkspace('job_http_sandbox_test', dummyPdf);
    ws.saveState({
      jobId: 'job_http_sandbox_test',
      sourcePdfPath: dummyPdf,
      sourceFileName: 'book.pdf',
      workspaceDir: ws.rootDir,
      status: 'completed',
      phase: 'done',
      providerId: 'baigong',
      modelId: 'ybg-youlaber-ds4f',
      baseURL: 'https://gateway.baigongai.cn/v1',
      concurrency: 3,
      autoImport: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    ws.writeFile('book/01_intro.mdx', '---\ntitle: "Intro"\n---\n\nHello');

    const jobRes = await fetch(`${baseUrl}/api/v1/pdf2abp/jobs/job_http_sandbox_test`);
    expect(jobRes.status).toBe(200);
    const jobJson = (await jobRes.json()) as any;
    expect(jobJson.job.status).toBe('completed');

    const filesRes = await fetch(`${baseUrl}/api/v1/pdf2abp/jobs/job_http_sandbox_test/files`);
    expect(filesRes.status).toBe(200);
    const filesJson = (await filesRes.json()) as any;
    expect(filesJson.entries.some((e: any) => e.relPath === 'book/01_intro.mdx')).toBe(true);

    const fileRes = await fetch(
      `${baseUrl}/api/v1/pdf2abp/jobs/job_http_sandbox_test/file?path=${encodeURIComponent('book/01_intro.mdx')}`
    );
    expect(fileRes.status).toBe(200);
    expect(await fileRes.text()).toContain('Hello');

    const traversalRes = await fetch(
      `${baseUrl}/api/v1/pdf2abp/jobs/job_http_sandbox_test/file?path=${encodeURIComponent('../../package.json')}`
    );
    expect(traversalRes.status).toBe(403);
    const travJson = (await traversalRes.json()) as any;
    expect(travJson.errorCode).toBe('PATH_TRAVERSAL_BLOCKED');

    const absRes = await fetch(
      `${baseUrl}/api/v1/pdf2abp/jobs/job_http_sandbox_test/file?path=${encodeURIComponent(path.resolve('package.json'))}`
    );
    expect(absRes.status).toBe(403);
  });
});
