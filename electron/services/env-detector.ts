/**
 * electron/services/env-detector.ts
 * ============================================================================
 * AstroLib 运行环境自省引擎 (Hardware & Python & Model Environment Detector)
 * ============================================================================
 */

import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { SystemDiagnostics } from '../types.ts';

const execFileAsync = promisify(execFile);

export class EnvDetector {
  private static cachedDiagnostics: SystemDiagnostics | null = null;
  private static lastProbeTime = 0;
  private static readonly CACHE_TTL_MS = 15000;
  private static customPythonPath: string | null = null;

  /**
   * 手动设置用户自定义 Python 解释器路径
   */
  static setCustomPythonPath(pythonPath: string | null) {
    this.customPythonPath = pythonPath;
    this.cachedDiagnostics = null; // 清除缓存强制重新探测
  }

  /**
   * 独立探测 NVIDIA 独立显卡与 CUDA 支持情况
   */
  private static async probeGpu(): Promise<{
    name: string | null;
    vramMB: number | null;
    driverVersion: string | null;
    hasCuda: boolean;
  }> {
    try {
      const { stdout } = await execFileAsync(
        'nvidia-smi',
        ['--query-gpu=name,memory.total,driver_version', '--format=csv,noheader,nounits'],
        { timeout: 4000 }
      );
      const lines = stdout.trim().split('\n');
      if (lines.length > 0 && lines[0].trim()) {
        const parts = lines[0].split(',').map((p) => p.trim());
        const name = parts[0] || 'NVIDIA GPU';
        const vramMB = parseInt(parts[1], 10) || null;
        const driverVersion = parts[2] || null;
        return {
          name,
          vramMB,
          driverVersion,
          hasCuda: true,
        };
      }
    } catch {
      // 无 nvidia-smi 或非 NVIDIA 显卡
    }
    return { name: null, vramMB: null, driverVersion: null, hasCuda: false };
  }

  /**
   * 探测全局系统硬件与运行环境
   */
  static async getDiagnostics(projectRoot: string, customModelsDir?: string, force = false): Promise<SystemDiagnostics> {
    const now = Date.now();
    if (!force && this.cachedDiagnostics && now - this.lastProbeTime < this.CACHE_TTL_MS) {
      return this.cachedDiagnostics;
    }

    const cpus = os.cpus();
    const cpuModel = cpus.length > 0 ? cpus[0].model : 'Unknown CPU';
    const totalMemMB = Math.round(os.totalmem() / (1024 * 1024));
    const freeMemMB = Math.round(os.freemem() / (1024 * 1024));

    // 磁盘剩余空间 (GB)
    let diskFreeGB = 0;
    try {
      if (typeof fs.statfs === 'function') {
        const stats = await promisify(fs.statfs)(projectRoot);
        diskFreeGB = Math.round((stats.bfree * stats.bsize) / (1024 * 1024 * 1024));
      }
    } catch {
      diskFreeGB = 50; // 兜底默认值
    }

    // 模型存储目录
    const hfCacheDir = process.env.HF_HOME
      ? path.join(process.env.HF_HOME, 'hub')
      : path.join(os.homedir(), '.cache', 'huggingface', 'hub');
    const modelsDir = customModelsDir || path.join(os.homedir(), '.cache', 'astrolib', 'models');

    // 1. 独立探针：显卡硬件
    const gpuInfo = await this.probeGpu();

    // 2. 启发式探测与优选 Python 运行环境
    const pythonInfo = await this.probePython(projectRoot);

    const diagnostics: SystemDiagnostics = {
      platform: os.platform(),
      arch: os.arch(),
      osRelease: os.release(),
      cpuModel,
      cpuCores: cpus.length,
      totalMemMB,
      freeMemMB,
      diskFreeGB,
      gpuName: gpuInfo.name || undefined,
      gpuVramMB: gpuInfo.vramMB || undefined,
      gpuDriverVersion: gpuInfo.driverVersion || undefined,
      hasCuda: gpuInfo.hasCuda || pythonInfo.hasCuda,
      hasDirectML: os.platform() === 'win32',
      pythonPath: pythonInfo.path,
      pythonVersion: pythonInfo.version,
      hasTorch: pythonInfo.hasTorch,
      hasHfTransformers: pythonInfo.hasTransformers,
      cudaDeviceName: pythonInfo.cudaDeviceName || (gpuInfo.name || undefined),
      huggingFaceCacheDir: hfCacheDir,
      modelsDir,
    };

    this.cachedDiagnostics = diagnostics;
    this.lastProbeTime = now;
    return diagnostics;
  }

  /**
   * 探测并优选 Python 环境及其依赖（按 PyTorch + CUDA 能力加权评分）
   */
  private static async probePython(projectRoot: string): Promise<{
    path: string | null;
    version: string | null;
    hasTorch: boolean;
    hasTransformers: boolean;
    hasCuda: boolean;
    cudaDeviceName: string | null;
  }> {
    const isWin = os.platform() === 'win32';
    const pyExe = isWin ? 'Scripts/python.exe' : 'bin/python';

    // 智能收集所有可能存在的 Python 路径候选
    const candidateSet = new Set<string>();

    // 1. 用户自定义与环境变量
    if (this.customPythonPath && fs.existsSync(this.customPythonPath)) {
      candidateSet.add(this.customPythonPath);
    }
    if (process.env.PYTHON_PATH && fs.existsSync(process.env.PYTHON_PATH)) {
      candidateSet.add(process.env.PYTHON_PATH);
    }

    // 2. 本项目及常用工作区虚拟环境 (绝对与相对路径)
    const localCandidates = [
      path.join(projectRoot, '.venv', pyExe),
      path.resolve(projectRoot, '..', 'practice', '.venv', pyExe),
      'D:\\Antigravity\\project\\practice\\.venv\\Scripts\\python.exe',
      'D:\\Antigravity\\project\\AstroLib\\.venv\\Scripts\\python.exe',
      isWin ? 'C:\\Program Files\\PyManager\\python.exe' : null,
      isWin ? path.join(os.homedir(), 'AppData\\Local\\Programs\\Python\\Python312\\python.exe') : null,
      isWin ? path.join(os.homedir(), 'AppData\\Local\\Programs\\Python\\Python311\\python.exe') : null,
      isWin ? path.join(os.homedir(), 'AppData\\Local\\Programs\\Python\\Python310\\python.exe') : null,
    ];

    for (const p of localCandidates) {
      if (p && fs.existsSync(p)) {
        candidateSet.add(p);
      }
    }

    // 3. 系统全局 PATH
    candidateSet.add('python3');
    candidateSet.add('python');

    interface EvaluatedCandidate {
      path: string;
      version: string | null;
      hasTorch: boolean;
      hasTransformers: boolean;
      hasCuda: boolean;
      cudaDeviceName: string | null;
      score: number;
    }

    const evaluated: EvaluatedCandidate[] = [];

    const probeCode = [
      'import sys, json',
      'info = {"ver": sys.version.split()[0], "torch": False, "tf": False, "cuda": False, "device": ""}',
      'try:',
      '    import torch',
      '    info["torch"] = True',
      '    info["cuda"] = bool(torch.cuda.is_available())',
      '    if info["cuda"] and torch.cuda.device_count() > 0:',
      '        info["device"] = torch.cuda.get_device_name(0)',
      'except Exception: pass',
      'try:',
      '    import transformers',
      '    info["tf"] = True',
      'except Exception: pass',
      'print("___ASTROLIB_PY___" + json.dumps(info))',
    ].join('\n');

    for (const cand of candidateSet) {
      try {
        const { stdout } = await execFileAsync(cand, ['-c', probeCode], { timeout: 12000 });
        const marker = '___ASTROLIB_PY___';
        const idx = stdout.indexOf(marker);
        if (idx !== -1) {
          const jsonStr = stdout.slice(idx + marker.length).trim();
          const data = JSON.parse(jsonStr);

          // 启发式评分：CUDA 加速(10分) > PyTorch(4分) > Transformers(2分) > 基础可用(1分)
          let score = 1;
          if (data.cuda) score += 10;
          if (data.torch) score += 4;
          if (data.tf) score += 2;

          evaluated.push({
            path: cand,
            version: data.ver || null,
            hasTorch: Boolean(data.torch),
            hasTransformers: Boolean(data.tf),
            hasCuda: Boolean(data.cuda),
            cudaDeviceName: data.device || null,
            score,
          });
        }
      } catch (err) {
        // 该候选执行失败，跳过继续测试下一个
      }
    }

    // 按得分由高到低排序，优选最高质量的环境
    evaluated.sort((a, b) => b.score - a.score);

    if (evaluated.length > 0) {
      const best = evaluated[0];
      return {
        path: best.path,
        version: best.version,
        hasTorch: best.hasTorch,
        hasTransformers: best.hasTransformers,
        hasCuda: best.hasCuda,
        cudaDeviceName: best.cudaDeviceName,
      };
    }

    return {
      path: null,
      version: null,
      hasTorch: false,
      hasTransformers: false,
      hasCuda: false,
      cudaDeviceName: null,
    };
  }
}
