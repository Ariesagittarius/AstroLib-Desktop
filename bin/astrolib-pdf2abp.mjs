#!/usr/bin/env node
/**
 * bin/astrolib-pdf2abp.mjs
 * ============================================================================
 * AstroLib 自动化 PDF2ABP 多智能体转换命令行工具
 * ============================================================================
 * 用法：
 *   node bin/astrolib-pdf2abp.mjs check [--json]
 *   node bin/astrolib-pdf2abp.mjs run "<abs-or-rel-pdf-path>" [options]
 *   node bin/astrolib-pdf2abp.mjs resume <jobId> [options]
 *   node bin/astrolib-pdf2abp.mjs inspect <jobId> [--json]
 *   node bin/astrolib-pdf2abp.mjs list [--json]
 *
 * 选项：
 *   --concurrency=<1..24>  并发校对子代理数量 (默认 12，支持自适应限流)
 *   --no-import            完成打包与校验后不自动导入书库
 *   --model=<id>           覆盖模型 ID (默认 ybg-youlaber-ds4f)
 *   --provider=<id>        网关提供方 ID (默认 baigong)
 *   --base-url=<url>       覆盖 OpenAI 兼容网关地址
 *   --api-key=<key>        覆盖 API Key
 *   --instructions=<text>  附加全书转换/排版要求
 *   --max-steps=<N>        主代理最大迭代步数 (默认 80)
 *   --job-id=<id>          自定义任务 ID
 *   --json                 以 JSON 输出最终结果（过程日志转至 stderr）
 * ============================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_YOULABBER_CONFIG,
  Pdf2AbpJobManager,
} from '../src/ai/agent/pdf2abp-agent.ts';
import { resolveProviderCapabilities } from '../src/ai/agent/context-manager.ts';
import { listPdf2AbpSkills } from '../src/ai/skills/pdf2abp/index.ts';
import {
  checkMineruAvailability,
  getPythonAvailability,
} from '../src/services/pdf2abp/index.ts';

function printHelp() {
  console.log(`AstroLib PDF2ABP CLI
Commands:
  check                        Check MuPDF, MinerU, Python, skills & gateway config
  run <pdfPath> [options]      Execute end-to-end automated PDF -> ABP pipeline
  resume <jobId> [options]     Resume an interrupted/failed PDF2ABP job from checkpoints
  inspect <jobId>              Inspect saved job state & event tail
  list                         List all PDF2ABP jobs in workspace root

Options:
  --concurrency=<1..24>        Max parallel subagents (default: 12, adaptive 429 throttle)
  --no-import                  Skip automatic import to app library after verify_abp
  --model=<id>                 Override model ID (default: ${DEFAULT_YOULABBER_CONFIG.modelId})
  --provider=<id>              Override provider ID (default: ${DEFAULT_YOULABBER_CONFIG.providerId})
  --base-url=<url>             Override gateway baseURL
  --api-key=<key>              Override API key
  --instructions=<text>        Extra book-level instructions
  --max-steps=<N>              Main agent max steps (default: 120)
  --job-id=<id>                Custom job ID
  --json                       Print final output as structured JSON
`);
}

function parseCliArgs(argv) {
  const positionals = [];
  const flags = {
    json: false,
    noImport: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      if (arg === '-h') flags.help = true;
      else positionals.push(arg);
      continue;
    }

    const eqIdx = arg.indexOf('=');
    let key;
    let val;
    if (eqIdx !== -1) {
      key = arg.slice(2, eqIdx);
      val = arg.slice(eqIdx + 1);
    } else {
      key = arg.slice(2);
      if (key === 'json' || key === 'no-import' || key === 'help') {
        val = true;
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        val = argv[++i];
      } else {
        val = true;
      }
    }

    if (key === 'json') flags.json = true;
    else if (key === 'no-import') flags.noImport = true;
    else if (key === 'help') flags.help = true;
    else if (key === 'concurrency') flags.concurrency = Number(val);
    else if (key === 'model') flags.model = String(val);
    else if (key === 'provider') flags.provider = String(val);
    else if (key === 'base-url') flags.baseUrl = String(val);
    else if (key === 'api-key') flags.apiKey = String(val);
    else if (key === 'instructions' || key === 'instruction') flags.instructions = String(val);
    else if (key === 'max-steps') flags.maxSteps = Number(val);
    else if (key === 'job-id') flags.jobId = String(val);
  }

  return { positionals, flags };
}

function logProgress(jsonMode, line) {
  if (jsonMode) {
    process.stderr.write(`${line}\n`);
  } else {
    console.log(line);
  }
}

function formatEventLine(evt) {
  const t = new Date(evt.timestamp).toISOString().slice(11, 19);
  const tag = `[${t}][${evt.agentId}][${evt.type}]`;
  // 高频 thinking 仅在非微碎时简洁输出
  if (evt.type === 'thinking') {
    const compact = String(evt.message || '').replace(/\s+/g, ' ').slice(0, 140);
    return `${tag} ${compact}`;
  }
  return `${tag} ${evt.message}`;
}

async function runCheckCommand(flags) {
  let mupdfVersion = null;
  let mupdfOk = false;
  try {
    const mupdf = await import('mupdf');
    mupdfOk = typeof mupdf.PDFDocument === 'function';
    mupdfVersion = 'wasm-ready';
  } catch (err) {
    mupdfVersion = err instanceof Error ? err.message : String(err);
  }

  const [mineru, python] = await Promise.all([
    checkMineruAvailability(),
    getPythonAvailability(),
  ]);
  const skills = listPdf2AbpSkills().map((s) => s.id);
  const providerId = flags.provider || DEFAULT_YOULABBER_CONFIG.providerId;
  const modelId = flags.model || DEFAULT_YOULABBER_CONFIG.modelId;
  const capabilities = resolveProviderCapabilities(providerId, modelId);

  const report = {
    ok: mupdfOk && mineru.ready,
    mupdf: { available: mupdfOk, status: mupdfVersion },
    mineru,
    python,
    skills,
    gateway: {
      providerId,
      modelId,
      baseURL: flags.baseUrl || DEFAULT_YOULABBER_CONFIG.baseURL,
      hasApiKey: Boolean(flags.apiKey || DEFAULT_YOULABBER_CONFIG.apiKey),
      capabilities,
    },
  };

  if (flags.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('=== AstroLib PDF2ABP Environment Check ===');
    console.log(`MuPDF WASM  : ${report.mupdf.available ? 'OK' : 'MISSING'} (${report.mupdf.status})`);
    console.log(`MinerU      : ${mineru.ready ? 'READY' : 'UNAVAILABLE'} (preferred=${mineru.preferredEngine}, hasToken=${mineru.hasApiToken}, token=${mineru.tokenPrefix || 'none'}, local=${mineru.localAvailable})`);
    console.log(`Python      : ${python.available ? 'READY' : 'MISSING'} (${python.pythonPath || 'none'})`);
    console.log(`Gateway     : ${report.gateway.providerId} / ${report.gateway.modelId} (${report.gateway.baseURL})`);
    console.log(`Vision Cap  : maxImagesPerRequest=${capabilities.maxImagesPerRequest}, safeInputBudget=${capabilities.safeInputBudget}, maxContextTokens=${capabilities.maxContextTokens}`);
    console.log(`Skills (${skills.length})  : ${skills.join(', ')}`);
    if (!mineru.ready) {
      console.log(`Guidance    : ${mineru.guidance}`);
    }
  }

  process.exit(report.ok ? 0 : 1);
}

async function main() {
  const { positionals, flags } = parseCliArgs(process.argv.slice(2));
  const cmd = positionals[0];

  if (!cmd || flags.help || cmd === 'help') {
    printHelp();
    process.exit(0);
  }

  if (cmd === 'check') {
    await runCheckCommand(flags);
    return;
  }

  const manager = Pdf2AbpJobManager.getInstance();

  if (cmd === 'list') {
    const jobs = manager.listJobs();
    if (flags.json) {
      console.log(JSON.stringify({ jobs }, null, 2));
    } else if (jobs.length === 0) {
      console.log('No PDF2ABP jobs found.');
    } else {
      for (const j of jobs) {
        console.log(
          `${j.jobId} | status=${j.status} | phase=${j.phase} | pdf=${j.sourceFileName} | abp=${j.compileResult?.abpPath || '-'}`
        );
      }
    }
    return;
  }

  if (cmd === 'inspect') {
    const jobId = positionals[1];
    if (!jobId) {
      console.error('Usage: node bin/astrolib-pdf2abp.mjs inspect <jobId>');
      process.exit(2);
    }
    const job = manager.getJob(jobId);
    if (!job) {
      console.error(`Job not found: ${jobId}`);
      process.exit(1);
    }
    const events = manager.getJobEvents(jobId);
    const ws = manager.getWorkspace(jobId);
    const files = ws ? ws.listFiles('', 3) : [];
    if (flags.json) {
      console.log(JSON.stringify({ job, filesCount: files.length, recentEvents: events.slice(-20) }, null, 2));
    } else {
      console.log(`Job ID      : ${job.jobId}`);
      console.log(`Status/Phase: ${job.status} / ${job.phase}`);
      console.log(`Source PDF  : ${job.sourcePdfPath}`);
      console.log(`Workspace   : ${job.workspaceDir} (${files.length} entries)`);
      if (job.error) console.log(`Error       : ${job.error}`);
      if (job.compileResult) console.log(`ABP Archive : ${job.compileResult.abpPath}`);
      if (job.verifyResult) console.log(`Verified    : passed=${job.verifyResult.passed}, chapters=${job.verifyResult.totalChapters}, assets=${job.verifyResult.totalAssets}`);
      if (job.importResult) console.log(`Imported    : ${job.importResult.readerUrl} (${job.importResult.storageDir})`);
      console.log(`Events      : ${events.length} total (last 5):`);
      for (const evt of events.slice(-5)) {
        console.log(`  ${formatEventLine(evt)}`);
      }
    }
    return;
  }

  if (cmd === 'run' || cmd === 'resume') {
    let initialJob;
    if (cmd === 'run') {
      const rawPdf = positionals[1];
      if (!rawPdf) {
        console.error('Usage: node bin/astrolib-pdf2abp.mjs run "<pdfPath>" [options]');
        process.exit(2);
      }
      const absPdf = path.resolve(rawPdf);
      if (!fs.existsSync(absPdf)) {
        console.error(`PDF file not found: ${absPdf}`);
        process.exit(1);
      }
      initialJob = manager.startJob({
        pdfPath: absPdf,
        jobId: flags.jobId,
        providerId: flags.provider,
        modelId: flags.model,
        baseURL: flags.baseUrl,
        apiKey: flags.apiKey,
        concurrency: Number.isFinite(flags.concurrency) ? flags.concurrency : undefined,
        autoImport: !flags.noImport,
        instructions: flags.instructions,
        maxSteps: Number.isFinite(flags.maxSteps) ? flags.maxSteps : undefined,
      });
    } else {
      const jobId = positionals[1];
      if (!jobId) {
        console.error('Usage: node bin/astrolib-pdf2abp.mjs resume <jobId> [options]');
        process.exit(2);
      }
      initialJob = manager.resumeJob(jobId, {
        providerId: flags.provider,
        modelId: flags.model,
        baseURL: flags.baseUrl,
        apiKey: flags.apiKey,
        concurrency: Number.isFinite(flags.concurrency) ? flags.concurrency : undefined,
        autoImport: flags.noImport ? false : undefined,
        instructions: flags.instructions,
        maxSteps: Number.isFinite(flags.maxSteps) ? flags.maxSteps : undefined,
      });
    }

    logProgress(flags.json, `[CLI] Job ${initialJob.jobId} active in ${initialJob.workspaceDir}`);
    const seenSeqs = new Set();
    for (const oldEvt of manager.getJobEvents(initialJob.jobId)) {
      seenSeqs.add(oldEvt.seq);
    }

    const unsubscribe = manager.subscribe(initialJob.jobId, (evt) => {
      if (seenSeqs.has(evt.seq)) return;
      seenSeqs.add(evt.seq);
      logProgress(flags.json, formatEventLine(evt));
    });

    const onSigInt = () => {
      logProgress(flags.json, '\n[CLI] Received SIGINT, cancelling job...');
      try {
        manager.cancelJob(initialJob.jobId);
      } catch {
        // ignore
      }
    };
    process.on('SIGINT', onSigInt);

    try {
      const finalJob = await manager.waitForJob(initialJob.jobId);
      if (flags.json) {
        console.log(JSON.stringify(finalJob, null, 2));
      } else {
        console.log('\n=== Final Result ===');
        console.log(`Job ID   : ${finalJob.jobId}`);
        console.log(`Status   : ${finalJob.status} (phase=${finalJob.phase})`);
        if (finalJob.error) console.log(`Error    : ${finalJob.error}`);
        if (finalJob.compileResult) {
          console.log(`ABP      : ${finalJob.compileResult.abpPath} (${finalJob.compileResult.totalChapters} ch, ${finalJob.compileResult.totalAssets} assets)`);
        }
        if (finalJob.verifyResult) {
          console.log(`Verify   : passed=${finalJob.verifyResult.passed}`);
        }
        if (finalJob.importResult) {
          console.log(`Imported : ${finalJob.importResult.readerUrl} (${finalJob.importResult.storageDir})`);
        }
        if (finalJob.finalSummary) {
          console.log('\n--- Main Agent Report ---');
          console.log(finalJob.finalSummary);
        }
      }
      process.exit(finalJob.status === 'completed' ? 0 : 1);
    } finally {
      process.off('SIGINT', onSigInt);
      unsubscribe();
    }
  }

  console.error(`Unknown command: ${cmd}`);
  printHelp();
  process.exit(2);
}

main().catch((err) => {
  console.error('[astrolib-pdf2abp] Fatal error:', err);
  process.exit(1);
});
