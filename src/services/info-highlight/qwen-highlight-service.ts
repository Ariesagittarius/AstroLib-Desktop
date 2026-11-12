/**
 * src/services/info-highlight/qwen-highlight-service.ts
 * ============================================================================
 * AstroLib Qwen3-0.6B 信息高亮后端服务 (Shannon Surprisal Daemon Bridge)
 * ============================================================================
 * 职责：
 * 1. 管理 Python 常驻 Daemon 子进程 (qwen-highlight-runner.py)，模型一次载入显存，后续零开销；
 * 2. 严格优先复用本地已探明的 Python 环境与已下载的 Qwen 权重（零网络消耗，省流量）；
 * 3. 内存级分析结果 LRU 缓存，同一章节或段落切回即显；
 * 4. 健壮的并发请求队列与崩溃自愈重启机制。
 * ============================================================================
 */

import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import type { InfoHighlightResult, InfoHighlightStatus } from '../../types/info-highlight.ts';

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

  private pendingRequests = new Map<
    string,
    { resolve: (val: InfoHighlightResult) => void; reject: (err: Error) => void; startTime: number }
  >();
  private requestCounter = 0;

  // 内存结果缓存 (按文本哈希缓存)
  private resultCache = new Map<string, InfoHighlightResult>();
  private readonly maxCacheEntries = 64;

  static getInstance(): QwenHighlightService {
    if (!this.instance) {
      this.instance = new QwenHighlightService();
    }
    return this.instance;
  }

  /**
   * 自动探测可用的 Python 解释器路径 (严格优先复用本机带有 PyTorch/CUDA 的虚拟环境)
   */
  public findPythonPath(): string | null {
    if (process.env.PYTHON_PATH && fs.existsSync(process.env.PYTHON_PATH)) {
      return process.env.PYTHON_PATH;
    }

    const candidatePaths = [
      'D:\\Antigravity\\project\\test\\.venv\\Scripts\\python.exe',
      'D:\\Antigravity\\project\\practice\\.venv\\Scripts\\python.exe',
      path.resolve(process.cwd(), '../test/.venv/Scripts/python.exe'),
      path.resolve(process.cwd(), '../practice/.venv/Scripts/python.exe'),
      path.resolve(process.cwd(), '.venv/Scripts/python.exe'),
      'C:\\Program Files\\PyManager\\python.exe',
      'python.exe',
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
        // continue
      }
    }

    return null;
  }

  /**
   * 自动探测本地已就绪的 Qwen3-0.6B-Base 模型路径
   */
  public findModelPath(): string | null {
    if (process.env.QWEN_MODEL_PATH && fs.existsSync(process.env.QWEN_MODEL_PATH)) {
      return process.env.QWEN_MODEL_PATH;
    }

    const candidateDirs = [
      path.join(os.homedir(), '.cache', 'modelscope', 'models', 'Qwen--Qwen3-0.6B-Base', 'snapshots', 'master'),
      'C:\\Users\\白羊欣存\\.cache\\modelscope\\models\\Qwen--Qwen3-0.6B-Base\\snapshots\\master',
      path.join(os.homedir(), '.cache', 'huggingface', 'hub', 'models--Qwen--Qwen3-0.6B-Base', 'snapshots', 'master'),
    ];

    for (const dir of candidateDirs) {
      if (fs.existsSync(dir)) {
        return dir;
      }
    }

    return null;
  }

  /**
   * 检查服务与模型就绪状态
   */
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

  /**
   * 后台静默预热常驻守护进程（预载模型至显存）
   */
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

  /**
   * 确保常驻 Daemon 子进程运行
   */
  private async ensureDaemon(): Promise<ChildProcess> {
    if (this.pythonProcess && !this.pythonProcess.killed && this.isReady) {
      return this.pythonProcess;
    }

    if (this.isInitializing) {
      while (this.isInitializing) {
        await new Promise((r) => setTimeout(r, 100));
      }
      if (this.pythonProcess && this.isReady) return this.pythonProcess;
    }

    this.isInitializing = true;
    const pythonPath = this.findPythonPath();
    if (!pythonPath) {
      this.isInitializing = false;
      this.lastError = '未找到可用的 Python 运行环境';
      throw new Error(this.lastError);
    }

    const runnerCandidates = [
      path.resolve(currentDir, 'qwen-highlight-runner.py'),
      path.resolve(currentDir, 'src/services/info-highlight/qwen-highlight-runner.py'),
      path.resolve(currentDir, '../src/services/info-highlight/qwen-highlight-runner.py'),
      path.resolve(process.cwd(), 'src/services/info-highlight/qwen-highlight-runner.py'),
      path.resolve(process.cwd(), 'dist-electron/qwen-highlight-runner.py'),
    ];
    const runnerPath = runnerCandidates.find((p) => fs.existsSync(p)) || runnerCandidates[0];
    const modelPath = this.findModelPath();

    return new Promise((resolve, reject) => {
      try {
        const env = {
          ...process.env,
          HF_HUB_OFFLINE: '1',
          TRANSFORMERS_OFFLINE: '1',
          PYTHONIOENCODING: 'utf-8',
          ...(modelPath ? { QWEN_MODEL_PATH: modelPath } : {}),
        };

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

            // 首次就绪通知
            if (data.status === 'ready') {
              clearTimeout(timer);
              this.isReady = true;
              this.isInitializing = false;
              this.activeDevice = data.device || 'cuda';
              this.activeVramMB = data.vramAllocatedMB || 0;
              this.lastError = null;
              resolve(proc);
              return;
            }

            // 匹配请求 ID
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
          this.isReady = false;
          this.isInitializing = false;
          this.lastError = err.message;
          reject(err);
        });

        proc.on('close', (code) => {
          clearTimeout(timer);
          const wasReady = this.isReady;
          this.isReady = false;
          this.isInitializing = false;
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

  /**
   * 分析文本信息量与惊异度
   */
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

    // 检查缓存
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
          // 写入 LRU 缓存
          if (this.resultCache.size >= this.maxCacheEntries) {
            const firstKey = this.resultCache.keys().next().value;
            if (firstKey) this.resultCache.delete(firstKey);
          }
          this.resultCache.set(cacheKey, val);
          resolve(val);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
        startTime: Date.now(),
      });

      proc.stdin!.write(payload);
    });
  }

  /**
   * 显式销毁常驻进程（释放显存）
   */
  destroy(): void {
    if (this.pythonProcess && !this.pythonProcess.killed) {
      try {
        this.pythonProcess.kill('SIGTERM');
      } catch {}
      this.pythonProcess = null;
    }
    this.isReady = false;
    this.pendingRequests.clear();
  }
}
