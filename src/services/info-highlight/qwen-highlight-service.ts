import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import type { InfoHighlightResult, InfoHighlightStatus } from '../../types/info-highlight.ts';
import { LocalModelIdleController, type RuntimeModelStatus } from '../local-model-lifecycle.ts';
import { createSanitizedChildEnv } from '../../core/security/child-env.ts';

const currentDir = typeof __dirname !== 'undefined'
  ? __dirname
  : path.dirname(fileURLToPath(import.meta.url));

export class QwenHighlightService {
  private static instance: QwenHighlightService | null = null;

  private pythonProcess: ChildProcess | null = null;
  private isInitializing = false;
  private isReady = false;
  private activeDevice = 'unknown';
  private activeVramMB = 0;
  private lastError: string | null = null;
  private idleCtrl = new LocalModelIdleController();

  private pendingRequests = new Map<
    string,
    { resolve: (val: InfoHighlightResult) => void; reject: (err: Error) => void; startTime: number }
  >();
  private requestCounter = 0;

  private resultCache = new Map<string, InfoHighlightResult>();
  private readonly maxCacheEntries = 64;

  private isDaemonLoaded = (): boolean => Boolean(this.pythonProcess && !this.pythonProcess.killed && this.isReady);
  private isDaemonBusy = (): boolean => this.isInitializing || this.pendingRequests.size > 0;
  private touchIdleTimer(): void {
    this.idleCtrl.touch(this.isDaemonBusy, this.isDaemonLoaded, () => this.destroy());
  }

  public setIdleTimeoutMs(ms: number): void {
    this.idleCtrl.setIdleTimeoutMs(ms, this.isDaemonBusy, this.isDaemonLoaded, () => this.destroy());
  }

  public getRuntimeInfo(): RuntimeModelStatus {
    const loaded = this.isDaemonLoaded();
    return {
      id: 'qwen-highlight',
      name: 'Qwen3-0.6B 信息高亮',
      loaded,
      initializing: this.isInitializing,
      device: loaded ? this.activeDevice : 'unloaded',
      vramMB: loaded ? this.activeVramMB : 0,
      lastUsedAt: this.idleCtrl.getLastUsedAt(),
      idleTimeoutMs: this.idleCtrl.getIdleTimeoutMs(),
    };
  }

  static getInstance(): QwenHighlightService {
    if (!this.instance) {
      this.instance = new QwenHighlightService();
    }
    return this.instance;
  }

  public findPythonPath(): string | null {
    if (process.env.PYTHON_PATH && fs.existsSync(process.env.PYTHON_PATH)) {
      return process.env.PYTHON_PATH;
    }

    const pySub = process.platform === 'win32' ? path.join('Scripts', 'python.exe') : path.join('bin', 'python');
    const candidatePaths = [
      path.resolve(process.cwd(), '.venv', pySub),
      path.resolve(process.cwd(), '..', '.venv', pySub),
      process.platform === 'win32' ? 'python.exe' : 'python3',
      'python',
    ];

    for (const p of candidatePaths) {
      try {
        if (path.isAbsolute(p)) {
          if (fs.existsSync(p)) return p;
        } else {
          return p;
        }
      } catch {

      }
    }

    return null;
  }

  public findModelPath(): string | null {
    if (process.env.QWEN_MODEL_PATH && fs.existsSync(process.env.QWEN_MODEL_PATH)) {
      return process.env.QWEN_MODEL_PATH;
    }

    const candidateDirs = [
      path.join(os.homedir(), '.cache', 'modelscope', 'models', 'Qwen--Qwen3-0.6B-Base', 'snapshots', 'master'),
      path.join(os.homedir(), '.cache', 'huggingface', 'hub', 'models--Qwen--Qwen3-0.6B-Base', 'snapshots', 'master'),
      path.join(os.homedir(), '.cache', 'huggingface', 'hub', 'models--Qwen--Qwen3-0.6B-Base'),
    ];

    for (const dir of candidateDirs) {
      if (fs.existsSync(dir)) {
        return dir;
      }
    }

    return null;
  }

  async getStatus(): Promise<InfoHighlightStatus> {
    const pythonPath = this.findPythonPath();
    const modelPath = this.findModelPath();
    const available = Boolean(pythonPath && modelPath);

    return {
      available,
      ready: this.isReady,
      modelPath,
      pythonPath,
      device: this.activeDevice,
      error: this.lastError || undefined,
    };
  }

  async prewarm(): Promise<boolean> {
    try {
      const status = await this.getStatus();
      if (!status.available) return false;
      await this.ensureDaemon();
      return true;
    } catch {
      return false;
    }
  }

  private async ensureDaemon(): Promise<ChildProcess> {
    if (this.pythonProcess && !this.pythonProcess.killed && this.isReady) {
      this.touchIdleTimer();
      return this.pythonProcess;
    }

    if (this.isInitializing) {
      while (this.isInitializing) {
        await new Promise((r) => setTimeout(r, 100));
      }
      if (this.pythonProcess && this.isReady) {
        this.touchIdleTimer();
        return this.pythonProcess;
      }
    }

    this.isInitializing = true;
    const pythonPath = this.findPythonPath();
    if (!pythonPath) {
      this.isInitializing = false;
      this.lastError = '未找到可用的 Python 运行环境';
      throw new Error(this.lastError);
    }

    const resPath = typeof (process as any).resourcesPath === 'string' ? (process as any).resourcesPath : '';
    const runnerCandidates = [
      resPath ? path.join(resPath, 'app.asar.unpacked', 'dist-electron', 'qwen-highlight-runner.py') : '',
      path.resolve(currentDir, 'qwen-highlight-runner.py'),
      path.resolve(currentDir, 'src/services/info-highlight/qwen-highlight-runner.py'),
      path.resolve(currentDir, '../src/services/info-highlight/qwen-highlight-runner.py'),
      path.resolve(process.cwd(), 'src/services/info-highlight/qwen-highlight-runner.py'),
      path.resolve(process.cwd(), 'dist-electron/qwen-highlight-runner.py'),
    ].filter(Boolean);
    const runnerPath = runnerCandidates.find((p) => fs.existsSync(p)) || runnerCandidates[0];
    const modelPath = this.findModelPath();

    return new Promise((resolve, reject) => {
      try {
        const env = createSanitizedChildEnv({
          HF_HUB_OFFLINE: '1',
          TRANSFORMERS_OFFLINE: '1',
          PYTHONIOENCODING: 'utf-8',
          ...(modelPath ? { QWEN_MODEL_PATH: modelPath } : {}),
        });

        const proc = spawn(pythonPath, [runnerPath, '--daemon'], {
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
          env,
        });

        this.pythonProcess = proc;

        const timer = setTimeout(() => {
          if (!this.isReady) {
            this.isInitializing = false;
            try { proc.kill(); } catch {}
            reject(new Error('Qwen 模型初始化超时 (90s)'));
          }
        }, 90000);

        const rl = readline.createInterface({
          input: proc.stdout!,
          crlfDelay: Infinity,
        });

        rl.on('line', (line) => {
          const trimmed = line.trim().replace(/^\uFEFF/, '');
          if (!trimmed) return;

          try {
            const data = JSON.parse(trimmed);

            if (data.status === 'ready') {
              clearTimeout(timer);
              this.isReady = true;
              this.isInitializing = false;
              this.activeDevice = data.device || 'cuda';
              this.activeVramMB = data.vramAllocatedMB || 0;
              this.lastError = null;
              this.touchIdleTimer();
              resolve(proc);
              return;
            }

            if (data.id && this.pendingRequests.has(data.id)) {
              const { resolve: reqResolve, reject: reqReject } = this.pendingRequests.get(data.id)!;
              this.pendingRequests.delete(data.id);

              if (data.status === 'ok') {
                reqResolve({
                  tokens: data.tokens || [],
                  inputTokens: data.inputTokens || 0,
                  inferenceTimeMs: data.inferenceTimeMs || 0,
                  modelName: data.modelName || 'Qwen3-0.6B-Base',
                  device: data.device || this.activeDevice,
                  vramAllocatedMB: data.vramAllocatedMB || this.activeVramMB,
                });
              } else {
                reqReject(new Error(data.error || 'Qwen highlight inference error'));
              }
            }
          } catch (err) {
            console.warn('[qwen-highlight] Failed to parse daemon line:', trimmed, err);
          }
        });

        proc.stderr?.on('data', (data) => {
          const msg = data.toString();
          if (msg.includes('ERROR') || msg.includes('Traceback')) {
            console.error('[qwen-highlight-daemon stderr]:', msg);
            this.lastError = msg;
          }
        });

        proc.on('error', (err) => {
          this.idleCtrl.reset();
          this.isReady = false;
          this.isInitializing = false;
          this.activeDevice = 'unknown';
          this.activeVramMB = 0;
          this.lastError = err.message;
          reject(err);
        });

        proc.on('close', (code) => {
          clearTimeout(timer);
          this.idleCtrl.reset();
          const wasReady = this.isReady;
          this.isReady = false;
          this.isInitializing = false;
          this.activeDevice = 'unknown';
          this.activeVramMB = 0;
          this.pythonProcess = null;
          const errMsg = this.lastError || `Qwen highlight daemon exited with code ${code}`;
          if (!wasReady) {
            reject(new Error(errMsg));
          }
          if (code !== 0) {
            for (const [, req] of this.pendingRequests.entries()) {
              req.reject(new Error(errMsg));
            }
            this.pendingRequests.clear();
          }
        });
      } catch (err) {
        this.isInitializing = false;
        reject(err);
      }
    });
  }

  async analyze(text: string): Promise<InfoHighlightResult> {
    const cleanText = (text || '').trim();
    if (!cleanText) {
      return {
        tokens: [],
        inputTokens: 0,
        inferenceTimeMs: 0,
        modelName: 'Qwen3-0.6B-Base',
        device: this.activeDevice,
      };
    }

    const cacheKey = cleanText;
    if (this.resultCache.has(cacheKey)) {
      return this.resultCache.get(cacheKey)!;
    }

    const proc = await this.ensureDaemon();

    return new Promise<InfoHighlightResult>((resolve, reject) => {
      const id = `hl-${++this.requestCounter}-${Date.now()}`;
      const payload = JSON.stringify({ id, action: 'analyze', text: cleanText }) + '\n';

      const timer = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Qwen highlight inference timeout (60s)'));
        }
      }, 60000);

      this.pendingRequests.set(id, {
        resolve: (val) => {
          clearTimeout(timer);
          this.touchIdleTimer();

          if (this.resultCache.size >= this.maxCacheEntries) {
            const firstKey = this.resultCache.keys().next().value;
            if (firstKey) this.resultCache.delete(firstKey);
          }
          this.resultCache.set(cacheKey, val);
          resolve(val);
        },
        reject: (err) => {
          clearTimeout(timer);
          this.touchIdleTimer();
          reject(err);
        },
        startTime: Date.now(),
      });

      this.touchIdleTimer();
      proc.stdin!.write(payload);
    });
  }

  destroy(): void {
    this.idleCtrl.reset();
    if (this.pythonProcess && !this.pythonProcess.killed) {
      try {
        this.pythonProcess.kill('SIGTERM');
      } catch {}
      this.pythonProcess = null;
    }
    this.isReady = false;
    this.isInitializing = false;
    this.activeDevice = 'unknown';
    this.activeVramMB = 0;
    for (const [, req] of this.pendingRequests.entries()) {
      req.reject(new Error('Qwen highlight service unloaded'));
    }
    this.pendingRequests.clear();
  }
}
