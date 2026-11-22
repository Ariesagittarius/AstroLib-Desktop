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

  static setCustomPythonPath(pythonPath: string | null) {
    this.customPythonPath = pythonPath;
    this.cachedDiagnostics = null;
  }

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

    }
    return { name: null, vramMB: null, driverVersion: null, hasCuda: false };
  }

  static async getDiagnostics(projectRoot: string, customModelsDir?: string, force = false): Promise<SystemDiagnostics> {
    const now = Date.now();
    if (!force && this.cachedDiagnostics && now - this.lastProbeTime < this.CACHE_TTL_MS) {
      return this.cachedDiagnostics;
    }

    const cpus = os.cpus();
    const cpuModel = cpus.length > 0 ? cpus[0].model : 'Unknown CPU';
    const totalMemMB = Math.round(os.totalmem() / (1024 * 1024));
    const freeMemMB = Math.round(os.freemem() / (1024 * 1024));

    let diskFreeGB = 0;
    try {
      if (typeof fs.statfs === 'function') {
        const stats = await promisify(fs.statfs)(projectRoot);
        diskFreeGB = Math.round((stats.bfree * stats.bsize) / (1024 * 1024 * 1024));
      }
    } catch {
      diskFreeGB = 50;
    }

    const hfCacheDir = process.env.HF_HOME
      ? path.join(process.env.HF_HOME, 'hub')
      : path.join(os.homedir(), '.cache', 'huggingface', 'hub');
    const modelsDir = customModelsDir || path.join(os.homedir(), '.cache', 'astrolib', 'models');

    const gpuInfo = await this.probeGpu();

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

    const candidateSet = new Set<string>();

    if (this.customPythonPath && fs.existsSync(this.customPythonPath)) {
      candidateSet.add(this.customPythonPath);
    }
    if (process.env.PYTHON_PATH && fs.existsSync(process.env.PYTHON_PATH)) {
      candidateSet.add(process.env.PYTHON_PATH);
    }

    const localCandidates = [
      path.join(projectRoot, '.venv', pyExe),
      path.join(projectRoot, '.venv-agent', pyExe),
      path.resolve(projectRoot, '..', '.venv', pyExe),
      isWin ? path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Python', 'Python312', 'python.exe') : null,
      isWin ? path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Python', 'Python311', 'python.exe') : null,
      isWin ? path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Python', 'Python310', 'python.exe') : null,
    ];

    for (const p of localCandidates) {
      if (p && fs.existsSync(p)) {
        candidateSet.add(p);
      }
    }

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

    await Promise.all(
      Array.from(candidateSet).map(async (cand) => {
        try {
          const { stdout } = await execFileAsync(cand, ['-c', probeCode], { timeout: 6000 });
          const marker = '___ASTROLIB_PY___';
          const idx = stdout.indexOf(marker);
          if (idx !== -1) {
            const jsonStr = stdout.slice(idx + marker.length).trim();
            const data = JSON.parse(jsonStr);

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
        } catch {

        }
      })
    );

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
