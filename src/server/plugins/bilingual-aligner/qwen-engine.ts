/**
 * src/server/plugins/bilingual-aligner/qwen-engine.ts
 * ============================================================================
 * AstroLib Qwen3-Embedding-0.6B 服务端常驻推理桥接器 (Qwen Embedding Engine Bridge)
 * ============================================================================
 * 核心设计：
 * 1. 管理 Python 常驻 Daemon 子进程 (qwen-runner.py)，一次加载模型，后续零重载延迟；
 * 2. 自动探测 Python 环境（优先复用 practice/.venv 与本工程 .venv，避免任何重复环境构建）；
 * 3. 严格离线加载，利用已下载的 ~/.cache/huggingface 权重，0 代理流量消耗；
 * 4. 出现环境未配置或 Python 缺失时，无缝向调用方抛出友好提示并支持降级。
 * ============================================================================
 */

import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import type { AlignResultPayload } from './onnx-engine.ts';
import { LocalModelIdleController, type RuntimeModelStatus } from '../../../services/local-model-lifecycle.ts';
import { createSanitizedChildEnv } from '../../../core/security/child-env.ts';

const currentDir = typeof __dirname !== 'undefined'
  ? __dirname
  : path.dirname(fileURLToPath(import.meta.url));

export class QwenEngine {
  private static instance: QwenEngine | null = null;

  private pythonProcess: ChildProcess | null = null;
  private isInitializing = false;
  private isReady = false;
  private activeDevice = 'unknown';
  private activeVramMB = 0;
  private cachedAvailability: boolean | null = null;
  private idleCtrl = new LocalModelIdleController();

  private pendingRequests = new Map<
    string,
    { resolve: (val: AlignResultPayload) => void; reject: (err: Error) => void; startTime: number }
  >();
  private requestCounter = 0;

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
      id: 'qwen-align',
      name: 'Qwen3-Embedding 双语对齐',
      loaded,
      initializing: this.isInitializing,
      device: loaded ? this.activeDevice : 'unloaded',
      vramMB: loaded ? this.activeVramMB : 0,
      lastUsedAt: this.idleCtrl.getLastUsedAt(),
      idleTimeoutMs: this.idleCtrl.getIdleTimeoutMs(),
    };
  }

  static getInstance(): QwenEngine {
    if (!this.instance) {
      this.instance = new QwenEngine();
    }
    return this.instance;
  }

  /**
   * 自动探测可用的 Python 解释器路径
   */
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
        // continue
      }
    }

    return null;
  }

  /**
   * 检查 Qwen3 模型与 Python 引擎是否可用（极速文件系统探测 + 缓存）
   */
  async isAvailable(): Promise<boolean> {
    if (this.cachedAvailability !== null) {
      return this.cachedAvailability;
    }

    if (this.isReady) {
      this.cachedAvailability = true;
      return true;
    }

    const pythonPath = this.findPythonPath();
    if (!pythonPath) {
      this.cachedAvailability = false;
      return false;
    }

    // 检查本地 HuggingFace 缓存目录中是否存在 Qwen3-Embedding-0.6B 权重
    const hubDir = path.join(
      os.homedir(),
      '.cache',
      'huggingface',
      'hub',
      'models--Qwen--Qwen3-Embedding-0.6B'
    );
    const hasCachedWeights = fs.existsSync(hubDir);

    this.cachedAvailability = Boolean(pythonPath && hasCachedWeights);
    return this.cachedAvailability;
  }

  /**
   * 确保常驻 Daemon 子进程运行
   */
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
      throw new Error('Python interpreter not found for Qwen3 engine');
    }

    const resPath = typeof (process as any).resourcesPath === 'string' ? (process as any).resourcesPath : '';
    const runnerCandidates = [
      resPath ? path.join(resPath, 'app.asar.unpacked', 'dist-electron', 'qwen-runner.py') : '',
      path.resolve(currentDir, 'qwen-runner.py'),
      path.resolve(process.cwd(), 'dist-electron', 'qwen-runner.py'),
      path.resolve(process.cwd(), 'src/server/plugins/bilingual-aligner/qwen-runner.py'),
    ].filter(Boolean);
    const runnerPath = runnerCandidates.find((p) => fs.existsSync(p)) || path.resolve(currentDir, 'qwen-runner.py');

    return new Promise((resolve, reject) => {
      try {
        const proc = spawn(pythonPath, [runnerPath, '--daemon'], {
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: createSanitizedChildEnv({
            HF_HUB_OFFLINE: '1',
            HF_ENDPOINT: 'https://hf-mirror.com',
            PYTHONIOENCODING: 'utf-8',
          }),
        });

        this.pythonProcess = proc;

        const rl = readline.createInterface({
          input: proc.stdout,
          crlfDelay: Infinity,
        });

        rl.on('line', (line) => {
          const trimmed = line.trim().replace(/^\uFEFF/, '');
          if (!trimmed) return;

          try {
            const data = JSON.parse(trimmed);

            // 首次就绪通知
            if (data.status === 'ready') {
              this.isReady = true;
              this.isInitializing = false;
              this.activeDevice = data.device || 'cuda';
              this.activeVramMB = data.vramAllocatedMB || 0;
              this.touchIdleTimer();
              resolve(proc);
              return;
            }

            // 匹配请求 ID
            if (data.id && this.pendingRequests.has(data.id)) {
              const { resolve: reqResolve, reject: reqReject } = this.pendingRequests.get(data.id)!;
              this.pendingRequests.delete(data.id);

              if (data.status === 'ok') {
                if (data.device) this.activeDevice = data.device;
                if (typeof data.vramAllocatedMB === 'number') this.activeVramMB = data.vramAllocatedMB;
                this.touchIdleTimer();
                reqResolve({
                  matrix: data.matrix || [],
                  inferenceTimeMs: data.inferenceTimeMs || 0,
                  engine: data.engine || 'Qwen3-Embedding-0.6B',
                  modelId: data.modelId || 'qwen3-0.6b',
                  modelName: data.modelName || 'Qwen/Qwen3-Embedding-0.6B',
                  dim: data.dim || 1024,
                  device: data.device || 'CUDA',
                });
              } else {
                this.touchIdleTimer();
                reqReject(new Error(data.error || 'Qwen3 engine inference error'));
              }
            }
          } catch (err) {
            console.warn('[qwen-bridge] Failed to parse daemon output line:', trimmed, err);
          }
        });

        proc.stderr.on('data', (data) => {
          const msg = data.toString();
          // 仅打印关键警告，忽略标准 loading 进度条
          if (msg.includes('Error') || msg.includes('Exception') || msg.includes('Traceback')) {
            console.warn('[qwen-bridge-stderr]:', msg.trim());
          }
        });

        proc.on('close', (code) => {
          this.idleCtrl.reset();
          this.isReady = false;
          this.isInitializing = false;
          this.activeDevice = 'unknown';
          this.activeVramMB = 0;
          this.pythonProcess = null;

          // Reject any pending requests
          this.pendingRequests.forEach(({ reject }) => {
            reject(new Error(`Qwen process exited unexpectedly with code ${code}`));
          });
          this.pendingRequests.clear();
        });

        proc.on('error', (err) => {
          this.idleCtrl.reset();
          this.isReady = false;
          this.isInitializing = false;
          this.activeDevice = 'unknown';
          this.activeVramMB = 0;
          this.pythonProcess = null;
          reject(err);
        });

        // 首次加载模型（~600M 参数）的保护超时时间
        setTimeout(() => {
          if (!this.isReady) {
            proc.kill();
            this.isInitializing = false;
            reject(new Error('Qwen daemon startup timed out (60s)'));
          }
        }, 60000);
      } catch (e) {
        this.isInitializing = false;
        reject(e);
      }
    });
  }

  /**
   * 调用 Qwen3-Embedding 执行双语段落语义对齐
   */
  async alignParagraphs(sourceTexts: string[], targetTexts: string[]): Promise<AlignResultPayload> {
    const proc = await this.ensureDaemon();
    const reqId = `qwen_req_${Date.now()}_${++this.requestCounter}`;
    const startTime = performance.now();

    return new Promise<AlignResultPayload>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (this.pendingRequests.has(reqId)) {
          this.pendingRequests.delete(reqId);
          reject(new Error('Qwen3 inference request timed out (30s)'));
        }
      }, 30000);

      this.pendingRequests.set(reqId, {
        resolve: (val) => {
          clearTimeout(timeoutId);
          this.touchIdleTimer();
          resolve(val);
        },
        reject: (err) => {
          clearTimeout(timeoutId);
          this.touchIdleTimer();
          reject(err);
        },
        startTime,
      });

      const payload = JSON.stringify({
        id: reqId,
        action: 'align',
        sourceTexts,
        targetTexts,
        batchSize: 16,
      }) + '\n';

      this.touchIdleTimer();
      proc.stdin?.write(payload, 'utf-8', (err) => {
        if (err) {
          this.pendingRequests.delete(reqId);
          reject(err);
        }
      });
    });
  }

  /**
   * 优雅停止 Daemon 进程
   */
  destroy() {
    this.idleCtrl.reset();
    if (this.pythonProcess && !this.pythonProcess.killed) {
      try {
        this.pythonProcess.kill();
      } catch {
        // ignore
      }
      this.pythonProcess = null;
    }
    this.isReady = false;
    this.isInitializing = false;
    this.activeDevice = 'unknown';
    this.activeVramMB = 0;
    this.pendingRequests.forEach(({ reject }) => {
      reject(new Error('Qwen3 align engine unloaded'));
    });
    this.pendingRequests.clear();
  }
}
