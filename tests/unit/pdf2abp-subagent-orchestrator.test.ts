import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as mupdf from 'mupdf';
import sharp from 'sharp';
import { JobWorkspace } from '../../src/services/pdf2abp/workspace-manager.ts';
import { runSubagentBatch } from '../../src/ai/agent/subagent-orchestrator.ts';
import { createBasePdf2AbpTools } from '../../src/ai/agent/pdf2abp-base-tools.ts';

async function createTinyPdf(outPath: string, pages = 3): Promise<void> {
  const doc = new mupdf.PDFDocument();
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([0, 0, 595, 842], 0, null, `BT /Helv 16 Tf 72 720 Td (Sample Page ${i + 1}) Tj ET`);
    doc.insertPage(-1, page);
  }
  const saved = doc.saveToBuffer('compress');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, saved.asUint8Array());
}

async function createTinyJpg(outPath: string): Promise<void> {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const buf = await sharp({
    create: { width: 48, height: 48, channels: 3, background: { r: 60, g: 120, b: 200 } },
  })
    .jpeg({ quality: 85 })
    .toBuffer();
  fs.writeFileSync(outPath, buf);
}

describe('PDF2ABP Subagent Orchestrator & Youlabber Vision Gate Mock', () => {
  let tmpDir: string;
  let pdfPath: string;
  let server: http.Server;
  let baseURL: string;

  let totalHttpRequests = 0;
  let activeRequests = 0;
  let maxObservedConcurrency = 0;
  let lastWireMessages: any[] = [];

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'astrolib-suborch-'));
    pdfPath = path.join(tmpDir, 'sample.pdf');
    await createTinyPdf(pdfPath, 4);

    // 模拟严苛的 Youlabber /chat/completions 网关：
    // 1. 跨整个 messages[] 若出现 >1 张图直接 400
    // 2. 任意 role:'tool' 带图或出现孤立 tool_call_id 直接 400
    // 3. 记录并发峰值以验证 bounded concurrency
    server = http.createServer(async (req, res) => {
      if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
        res.statusCode = 404;
        res.end('Not found');
        return;
      }

      totalHttpRequests++;
      activeRequests++;
      if (activeRequests > maxObservedConcurrency) {
        maxObservedConcurrency = activeRequests;
      }

      try {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const body = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as any;
        const messages = Array.isArray(body.messages) ? body.messages : [];
        lastWireMessages = messages;

        // 统计全上下文图片数量 + 校验 tool 消息结构
        let imageCount = 0;
        const openToolIds = new Set<string>();
        for (const m of messages) {
          if (Array.isArray(m.content)) {
            for (const p of m.content) {
              if (p?.type === 'image_url') {
                if (m.role === 'tool') {
                  res.statusCode = 400;
                  res.end('role tool cannot contain image_url');
                  return;
                }
                imageCount++;
              }
            }
          }
          if (m.role === 'assistant' && Array.isArray(m.tool_calls)) {
            for (const tc of m.tool_calls) openToolIds.add(tc.id);
          } else if (m.role === 'tool') {
            if (!openToolIds.has(m.tool_call_id)) {
              res.statusCode = 400;
              res.end(`Orphaned tool_call_id: ${m.tool_call_id}`);
              return;
            }
            openToolIds.delete(m.tool_call_id);
          }
        }

        if (imageCount > 1) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              error: { message: `At most 1 image(s) may be provided in one prompt. Got ${imageCount}` },
            })
          );
          return;
        }

        // 微小延迟以便测试真实并发峰值 <= concurrency
        await new Promise((r) => setTimeout(r, 45));

        // 解析当前任务 ID / 输出路径与页码
        const userGoal = String(messages[1]?.content || '');
        const targetMatch = userGoal.match(/最终落盘路径[^`]*`([^`]+)`/);
        const draftMatch = userGoal.match(/初步草稿路径[^`]*`([^`]+)`/);
        const pageMatch = userGoal.match(/第 (\d+) 页 至 第 (\d+) 页/);

        const targetOut = targetMatch?.[1] || 'book/01_sample.mdx';
        const draftRel = draftMatch?.[1] || 'chunks/t1/draft.md';
        const startPage = Number(pageMatch?.[1] || 1);
        const endPage = Number(pageMatch?.[2] || startPage);

        const toolMessagesCount = messages.filter((m: any) => m.role === 'tool').length;

        const sendToolCalls = (
          calls: Array<{ id: string; name: string; args: Record<string, unknown> }>
        ) => {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/event-stream');
          const sse = [
            `data: ${JSON.stringify({
              choices: [
                {
                  index: 0,
                  delta: {
                    role: 'assistant',
                    reasoning_content: 'Reviewing task step cleanly.',
                    tool_calls: calls.map((c, idx) => ({
                      index: idx,
                      id: c.id,
                      type: 'function',
                      function: { name: c.name, arguments: JSON.stringify(c.args) },
                    })),
                  },
                  finish_reason: null,
                },
              ],
            })}\n\n`,
            `data: ${JSON.stringify({
              choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
              usage: { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160 },
            })}\n\n`,
            `data: [DONE]\n\n`,
          ].join('');
          res.end(sse);
        };

        if (toolMessagesCount === 0) {
          // 第 1 步：读草稿 + 看第 1 页图
          sendToolCalls([
            { id: `c_read_${startPage}`, name: 'read_workspace_file', args: { relPath: draftRel } },
            {
              id: `c_vis1_${startPage}`,
              name: 'inspect_pdf_page',
              args: { pages: [startPage], mode: 'single', dpi: 120 },
            },
          ]);
          return;
        }

        if (toolMessagesCount === 2) {
          // 第 2 步：再看 1 次图以触发 Rolling Vision Slot 淘汰旧图，验证双轮带图绝不 400
          sendToolCalls([
            {
              id: `c_vis2_${endPage}`,
              name: 'inspect_pdf_page',
              args: { pages: [endPage], mode: 'single', dpi: 120 },
            },
          ]);
          return;
        }

        if (toolMessagesCount === 3) {
          // 第 3 步：写入完整合法 MDX + 调用 validate_mdx 自检
          const mdxContent = [
            '---',
            `title: "Chapter Pages ${startPage}-${endPage}"`,
            '---',
            '',
            `## 本节核心内容（物理页 ${startPage}-${endPage}）`,
            '',
            '<Knowledge title="定理 1.1（欧拉公式）">',
            '对于任意实数 $\\theta$，均有 $e^{i\\theta} = \\cos\\theta + i\\sin\\theta$。',
            '</Knowledge>',
            '',
            '<figure class="vp-figure">![示意图 1](images/fig_test.jpg)<figcaption>图 1 示意图</figcaption></figure>',
            '',
          ].join('\n');

          sendToolCalls([
            {
              id: `c_write_${startPage}`,
              name: 'write_workspace_file',
              args: { relPath: targetOut, content: mdxContent },
            },
            {
              id: `c_val_${startPage}`,
              name: 'validate_mdx',
              args: { targetPath: targetOut },
            },
          ]);
          return;
        }

        // 第 4 步：输出最终 JSON 结果
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: JSON.stringify({
                    status: 'completed',
                    outputFiles: [targetOut],
                    imagesUsed: ['images/fig_test.jpg'],
                    validationPassed: true,
                    anomalies: [],
                    notes: `Verified pages ${startPage}-${endPage}`,
                  }),
                },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 200, completion_tokens: 60, total_tokens: 260 },
          })
        );
      } finally {
        activeRequests--;
      }
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as AddressInfo;
        baseURL = `http://127.0.0.1:${addr.port}/v1`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('runs bounded-concurrency subagents with Rolling Vision Slot, validates multi-part chunks against book/images, and reuses checkpoints', async () => {
    const ws = new JobWorkspace('job_suborch_test', pdfPath, path.join(tmpDir, 'jobs'));
    await createTinyJpg(path.join(ws.bookImagesDir, 'fig_test.jpg'));

    ws.writeFile('chunks/c1/draft.md', '# Page 1 Draft\nSample');
    ws.writeFile('chunks/c2_p1/draft.md', '# Page 2 Draft\nSample');
    ws.writeFile('chunks/c2_p2/draft.md', '# Page 3 Draft\nSample');

    const tasks = [
      {
        taskId: 'c1',
        title: 'Chapter 1',
        targetOutputRelPath: 'book/01_ch1.mdx',
        startPage: 1,
        endPage: 1,
        draftRelPath: 'chunks/c1/draft.md',
        referencedImages: ['images/fig_test.jpg'],
        instructions: 'Proofread page 1.',
      },
      {
        taskId: 'c2__part1of2',
        title: 'Chapter 2 (Part 1/2)',
        targetOutputRelPath: 'chunks/c2__part1of2/proofread_part.mdx',
        startPage: 2,
        endPage: 2,
        draftRelPath: 'chunks/c2_p1/draft.md',
        referencedImages: ['images/fig_test.jpg'],
        instructions: 'Proofread page 2.',
      },
      {
        taskId: 'c2__part2of2',
        title: 'Chapter 2 (Part 2/2)',
        targetOutputRelPath: 'chunks/c2__part2of2/proofread_part.mdx',
        startPage: 3,
        endPage: 4,
        draftRelPath: 'chunks/c2_p2/draft.md',
        referencedImages: ['images/fig_test.jpg'],
        instructions: 'Proofread pages 3-4.',
      },
    ];

    const startedIds: string[] = [];
    const finishedIds: string[] = [];

    const firstRun = await runSubagentBatch({
      workspace: ws,
      tasks,
      providerId: 'baigong',
      modelId: 'ybg-youlaber-ds4f',
      baseURL,
      apiKey: 'mock-key',
      concurrency: 2,
      onSubagentStarted: (t) => startedIds.push(t.taskId),
      onSubagentFinished: (r) => finishedIds.push(r.taskId),
    });

    expect(firstRun.totalTasks).toBe(3);
    expect(firstRun.completedCount).toBe(3);
    expect(firstRun.failedCount).toBe(0);
    expect(firstRun.allValidationPassed).toBe(true);
    expect(maxObservedConcurrency).toBeGreaterThanOrEqual(1);
    expect(maxObservedConcurrency).toBeLessThanOrEqual(2);
    expect(startedIds.length).toBe(3);
    expect(finishedIds.length).toBe(3);

    // 验证多段切片磁盘落盘及检查点落盘
    expect(fs.existsSync(ws.resolveWorkspacePath('book/01_ch1.mdx'))).toBe(true);
    expect(fs.existsSync(ws.resolveWorkspacePath('chunks/c2__part1of2/proofread_part.mdx'))).toBe(true);
    expect(fs.existsSync(ws.resolveWorkspacePath('subagents/c1.result.json'))).toBe(true);

    // 第二轮调用应 100% 命中检查点，发出 0 次 HTTP 请求
    const requestsBeforeSecondRun = totalHttpRequests;
    const secondRun = await runSubagentBatch({
      workspace: ws,
      tasks,
      providerId: 'baigong',
      modelId: 'ybg-youlaber-ds4f',
      baseURL,
      apiKey: 'mock-key',
      concurrency: 2,
      skipCompletedCheckpoint: true,
    });

    expect(secondRun.skippedCount).toBe(3);
    expect(secondRun.completedCount).toBe(0);
    expect(secondRun.allValidationPassed).toBe(true);
    expect(totalHttpRequests).toBe(requestsBeforeSecondRun);
  });

  it('supports high concurrency (>= 10), saves visual observations across Rolling Vision Slot & emits repeatViewWarning', async () => {
    const ws = new JobWorkspace('high_conc_vision_test', pdfPath, path.join(tmpDir, 'jobs2'));
    await createTinyJpg(ws.resolveWorkspacePath('book/images/fig_test.jpg'));
    ws.writeFile('book/book.json', JSON.stringify({ colSlug: 'math', slug: 'hc', title: 'High Concurrency Test' }));

    const tasks = Array.from({ length: 10 }, (_, idx) => {
      const n = idx + 1;
      const draftRel = `chunks/hc_${n}/draft.md`;
      ws.writeFile(draftRel, `---\ntitle: "Sec ${n}"\n---\n\nDraft content ${n}.`);
      return {
        taskId: `hc_${n}`,
        title: `Section ${n}`,
        targetOutputRelPath: `book/0${n}_sec.mdx`,
        startPage: 1,
        endPage: 2,
        draftRelPath: draftRel,
        referencedImages: ['images/fig_test.jpg'],
        instructions: `Proofread section ${n}.`,
      };
    });

    maxObservedConcurrency = 0;
    const batch = await runSubagentBatch({
      workspace: ws,
      tasks,
      providerId: 'baigong',
      modelId: 'ybg-youlaber-ds4f',
      baseURL,
      apiKey: 'mock-key',
      concurrency: 10,
    });

    expect(batch.totalTasks).toBe(10);
    expect(batch.completedCount).toBe(10);
    expect(batch.allValidationPassed).toBe(true);
    expect(maxObservedConcurrency).toBeGreaterThanOrEqual(6);

    // 验证 harness-runner 自动保留 syntheticVision 之后的 reasoningContent 摘要到 assistant.content
    expect(
      lastWireMessages.some(
        (m) => m?.role === 'assistant' && typeof m?.content === 'string' && m.content.includes('[视觉审视要点自动存档')
      )
    ).toBe(true);

    // 验证 inspect_pdf_page 支持 notesForPreviousImage 并在重复查看同页时给出温和警告
    const baseTools = createBasePdf2AbpTools({ workspace: ws, includeOverviewTools: false });
    const inspectTool = baseTools.find((t) => t.name === 'inspect_pdf_page')!;
    const first = await inspectTool.execute({ pages: [1], mode: 'single' }, { agentId: 'test-agent', step: 1 });
    expect(first.text).not.toContain('repeatViewWarning');

    const second = await inspectTool.execute(
      { pages: [1], mode: 'single', notesForPreviousImage: 'Page 1 contains Theorem 1.1 and shaded block.' },
      { agentId: 'test-agent', step: 2 }
    );
    expect(second.text).toContain('recordedNotes');
    expect(second.text).toContain('Theorem 1.1');
    expect(second.text).toContain('repeatViewWarning');
  });
});
