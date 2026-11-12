/**
 * electron/services/model-manager.ts
 * ============================================================================
 * AstroLib 端侧模型管理器 (On-Demand Model Lifecycle & Downloader Engine)
 * ============================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import { EnvDetector } from './env-detector.ts';
import type { ModelInfoPayload, ModelDownloadProgress, ModelInstallStatus } from '../types.ts';

interface ModelRegistryEntry {
  id: string;
  name: string;
  category: 'embedding' | 'llm' | 'ocr';
  description: string;
  sizeFormatted: string;
  repo: string;
  requiresPython: boolean;
  recommendedHardware: string;
  supportedEngines: string[];
  hfHubFolder: string;
}

const REGISTERED_MODELS: ModelRegistryEntry[] = [
  {
    id: 'minilm-l12',
    name: 'MiniLM-L12 多语言向量模型',
    category: 'embedding',
    description: '端侧极轻量 384 维嵌入模型，专用于多语言教材段落对齐与语义热力图，支持 ONNX Runtime CPU / DirectML。',
    sizeFormatted: '120 MB',
    repo: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
    requiresPython: false,
    recommendedHardware: 'CPU / 任意核显 / DirectML',
    supportedEngines: ['ONNX Runtime (CPU)', 'ONNX Runtime (DirectML)'],
    hfHubFolder: 'models--Xenova--paraphrase-multilingual-MiniLM-L12-v2',
  },
  {
    id: 'qwen3-embedding',
    name: 'Qwen3-Embedding-0.6B 高精学术模型',
    category: 'embedding',
    description: '0.6B 参数 1024 维学术级长文本嵌入模型，支持多语种深层数理公式关联与 CUDA 硬件加速。',
    sizeFormatted: '1.2 GB',
    repo: 'Qwen/Qwen3-Embedding-0.6B',
    requiresPython: true,
    recommendedHardware: 'NVIDIA GPU (CUDA) / 8GB+ RAM',
    supportedEngines: ['PyTorch (CUDA)', 'PyTorch (CPU)'],
    hfHubFolder: 'models--Qwen--Qwen3-Embedding-0.6B',
  },
  {
    id: 'qwen3-base',
    name: 'Qwen3-0.6B-Base 关注点透镜模型',
    category: 'llm',
    description: '0.6B 因果自回归语言模型，驱动香农信息论惊异度（Surprisal）推导，智能淡化语法虚词并突出学术关键实体。',
    sizeFormatted: '1.19 GB',
    repo: 'Qwen/Qwen3-0.6B-Base',
    requiresPython: true,
    recommendedHardware: 'NVIDIA GPU (CUDA / RTX 5060) / 8GB+ RAM',
    supportedEngines: ['PyTorch (CUDA)', 'PyTorch (CPU)'],
    hfHubFolder: 'models--Qwen--Qwen3-0.6B-Base',
  },
];

export class ModelManager {
  private projectRoot: string;
  private customModelsDir?: string;
  private activeDownloads = new Map<string, { abortController: AbortController; progress: ModelDownloadProgress }>();
  private progressListeners = new Set<(progress: ModelDownloadProgress) => void>();

  constructor(projectRoot: string, customModelsDir?: string) {
    this.projectRoot = projectRoot;
    this.customModelsDir = customModelsDir;
  }

  /**
   * 注册下载进度监听器
   */
  onProgress(listener: (progress: ModelDownloadProgress) => void): () => void {
    this.progressListeners.add(listener);
    return () => {
      this.progressListeners.delete(listener);
    };
  }

  private emitProgress(progress: ModelDownloadProgress) {
    for (const listener of this.progressListeners) {
      try {
        listener(progress);
      } catch {
        // ignore listener errors
      }
    }
  }

  /**
   * 检查单个模型状态
   */
  async checkModelStatus(modelId: string): Promise<ModelInfoPayload> {
    const entry = REGISTERED_MODELS.find((m) => m.id === modelId);
    if (!entry) {
      return {
        id: modelId,
        name: modelId,
        category: 'embedding',
        description: '未知模型',
        sizeFormatted: '未知',
        status: 'error',
        requiresPython: false,
        recommendedHardware: '未知',
        supportedEngines: [],
        error: `模型 ${modelId} 未在注册表中`,
      };
    }

    if (this.activeDownloads.has(modelId)) {
      return {
        id: entry.id,
        name: entry.name,
        category: entry.category,
        description: entry.description,
        sizeFormatted: entry.sizeFormatted,
        status: 'downloading',
        requiresPython: entry.requiresPython,
        recommendedHardware: entry.recommendedHardware,
        supportedEngines: entry.supportedEngines,
      };
    }

    const diag = await EnvDetector.getDiagnostics(this.projectRoot, this.customModelsDir);

    if (entry.requiresPython && !diag.pythonPath) {
      return {
        id: entry.id,
        name: entry.name,
        category: entry.category,
        description: entry.description,
        sizeFormatted: entry.sizeFormatted,
        status: 'needs_python',
        requiresPython: true,
        recommendedHardware: entry.recommendedHardware,
        supportedEngines: entry.supportedEngines,
        error: '未检测到可用的 Python 环境，请先配置 Python 及 PyTorch。',
      };
    }

    // 检查缓存路径
    const candidateDirs = [
      path.join(diag.huggingFaceCacheDir, entry.hfHubFolder),
      path.join(diag.modelsDir, entry.id),
      path.join(this.projectRoot, 'node_modules', '@huggingface', 'transformers', '.cache', entry.repo),
      path.join(diag.huggingFaceCacheDir, '..', 'modelscope', 'models', entry.repo.replace('/', '--'), 'snapshots', 'master'),
      'C:\\Users\\白羊欣存\\.cache\\modelscope\\models\\Qwen--Qwen3-0.6B-Base\\snapshots\\master',
    ];

    let foundPath: string | null = null;
    for (const dir of candidateDirs) {
      if (fs.existsSync(dir)) {
        foundPath = dir;
        break;
      }
    }

    const status: ModelInstallStatus = foundPath ? 'ready' : 'missing';
    const activeEngine = entry.supportedEngines[0];

    return {
      id: entry.id,
      name: entry.name,
      category: entry.category,
      description: entry.description,
      sizeFormatted: entry.sizeFormatted,
      status,
      localPath: foundPath || undefined,
      requiresPython: entry.requiresPython,
      recommendedHardware: entry.recommendedHardware,
      supportedEngines: entry.supportedEngines,
      activeEngine,
    };
  }

  /**
   * 获取所有可用模型列表及状态
   */
  async getAvailableModels(): Promise<ModelInfoPayload[]> {
    const list: ModelInfoPayload[] = [];
    for (const entry of REGISTERED_MODELS) {
      list.push(await this.checkModelStatus(entry.id));
    }
    return list;
  }

  /**
   * 启动模型按需下载（支持国内 hf-mirror.com 镜像）
   */
  async startDownload(
    modelId: string,
    options: { mirrorUrl?: string } = {}
  ): Promise<{ ok: boolean; message?: string }> {
    const entry = REGISTERED_MODELS.find((m) => m.id === modelId);
    if (!entry) {
      return { ok: false, message: `模型 ${modelId} 不存在` };
    }

    if (this.activeDownloads.has(modelId)) {
      return { ok: true, message: '该模型正在下载中' };
    }

    const diag = await EnvDetector.getDiagnostics(this.projectRoot, this.customModelsDir);
    const targetDir = path.join(diag.huggingFaceCacheDir, entry.hfHubFolder);
    fs.mkdirSync(targetDir, { recursive: true });

    const abortController = new AbortController();
    const progress: ModelDownloadProgress = {
      modelId,
      percentage: 0,
      receivedBytes: 0,
      totalBytes: entry.id === 'minilm-l12' ? 120 * 1024 * 1024 : 1200 * 1024 * 1024,
      speedBytesPerSec: 0,
      etaSeconds: 0,
      status: 'downloading',
    };

    this.activeDownloads.set(modelId, { abortController, progress });
    this.emitProgress(progress);

    // 异步执行下载流程
    this.executeDownload(entry, targetDir, abortController, options.mirrorUrl || 'https://hf-mirror.com').catch(
      (err) => {
        console.error(`[model-manager] 下载异常 (${modelId}):`, err);
        const errProgress: ModelDownloadProgress = {
          ...progress,
          status: 'error',
          error: err.message || String(err),
        };
        this.emitProgress(errProgress);
        this.activeDownloads.delete(modelId);
      }
    );

    return { ok: true, message: '已启动模型下载任务' };
  }

  /**
   * 取消当前下载
   */
  cancelDownload(modelId: string): { ok: boolean } {
    const active = this.activeDownloads.get(modelId);
    if (!active) return { ok: false };

    active.abortController.abort();
    this.activeDownloads.delete(modelId);

    this.emitProgress({
      modelId,
      percentage: 0,
      receivedBytes: 0,
      totalBytes: 0,
      speedBytesPerSec: 0,
      etaSeconds: 0,
      status: 'cancelled',
    });

    return { ok: true };
  }

  /**
   * 实际下载执行器（带测速与进度计算）
   */
  private async executeDownload(
    entry: ModelRegistryEntry,
    targetDir: string,
    abortController: AbortController,
    mirrorUrl: string
  ): Promise<void> {
    const startTime = Date.now();
    let lastTime = startTime;
    let lastBytes = 0;

    // 针对 MiniLM：通过 Transformers.js 自动下载机制或镜像拉取
    if (entry.id === 'minilm-l12') {
      try {
        const { pipeline, env } = await import('@huggingface/transformers');
        env.remoteHost = mirrorUrl.replace(/\/$/, '') + '/';
        env.cacheDir = targetDir;

        const pipe = await pipeline('feature-extraction', entry.repo, {
          dtype: 'q8',
          device: 'cpu',
          progress_callback: (prog: any) => {
            if (abortController.signal.aborted) throw new Error('Download aborted by user');
            if (prog && typeof prog.progress === 'number') {
              const currentBytes = Math.round((prog.progress / 100) * (120 * 1024 * 1024));
              const now = Date.now();
              const deltaSec = (now - lastTime) / 1000;
              let speed = 0;
              if (deltaSec > 0.5) {
                speed = Math.round((currentBytes - lastBytes) / deltaSec);
                lastTime = now;
                lastBytes = currentBytes;
              }

              const remainingBytes = Math.max(0, 120 * 1024 * 1024 - currentBytes);
              const eta = speed > 0 ? Math.round(remainingBytes / speed) : 0;

              const p: ModelDownloadProgress = {
                modelId: entry.id,
                percentage: Math.min(100, Math.round(prog.progress)),
                receivedBytes: currentBytes,
                totalBytes: 120 * 1024 * 1024,
                speedBytesPerSec: speed,
                etaSeconds: eta,
                status: 'downloading',
              };
              this.emitProgress(p);
            }
          },
        });

        // 验证推理
        await pipe('test query', { pooling: 'mean', normalize: true });

        this.emitProgress({
          modelId: entry.id,
          percentage: 100,
          receivedBytes: 120 * 1024 * 1024,
          totalBytes: 120 * 1024 * 1024,
          speedBytesPerSec: 0,
          etaSeconds: 0,
          status: 'completed',
        });
        this.activeDownloads.delete(entry.id);
        return;
      } catch (err: any) {
        if (abortController.signal.aborted) return;
        throw err;
      }
    }

    // 针对 Qwen3 及后续大模型：通过 Python huggingface_hub snapshot_download
    const diag = await EnvDetector.getDiagnostics(this.projectRoot, this.customModelsDir);
    if (!diag.pythonPath) {
      throw new Error('未找到 Python 环境，无法下载 Qwen3 权重');
    }

    // 在 Python 脚本中调用 snapshot_download
    const pythonCode = `
import os, sys
os.environ["HF_ENDPOINT"] = "${mirrorUrl}"
try:
    from huggingface_hub import snapshot_download
    snapshot_download(repo_id="${entry.repo}", local_dir=r"${targetDir}", max_workers=4)
    print("SUCCESS")
except Exception as e:
    print(f"ERROR: {e}", file=sys.stderr)
    sys.exit(1)
`;

    const { spawn } = await import('node:child_process');
    const child = spawn(diag.pythonPath, ['-c', pythonCode], {
      signal: abortController.signal,
    });

    child.on('error', (err) => {
      this.emitProgress({
        modelId: entry.id,
        percentage: 0,
        receivedBytes: 0,
        totalBytes: 0,
        speedBytesPerSec: 0,
        etaSeconds: 0,
        status: 'error',
        error: err.message,
      });
      this.activeDownloads.delete(entry.id);
    });

    child.on('close', (code) => {
      this.activeDownloads.delete(entry.id);
      if (code === 0) {
        this.emitProgress({
          modelId: entry.id,
          percentage: 100,
          receivedBytes: 1200 * 1024 * 1024,
          totalBytes: 1200 * 1024 * 1024,
          speedBytesPerSec: 0,
          etaSeconds: 0,
          status: 'completed',
        });
      } else {
        this.emitProgress({
          modelId: entry.id,
          percentage: 0,
          receivedBytes: 0,
          totalBytes: 0,
          speedBytesPerSec: 0,
          etaSeconds: 0,
          status: 'error',
          error: `下载进程非正常退出 (退出码: ${code})`,
        });
      }
    });
  }
}
