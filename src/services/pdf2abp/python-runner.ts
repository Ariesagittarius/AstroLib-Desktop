/**
 * src/services/pdf2abp/python-runner.ts
 * ============================================================================
 * 沙箱化 Python 脚本执行器 (Workspace-Scoped Python Runner)
 * ============================================================================
 * 职责：
 * 1. 自动探测最佳可用 Python 解释器（.venv / EnvDetector / 系统 python）；
 * 2. 将内联代码或工作区脚本限制在当前任务工作区内执行，注入 ASTROLIB_* 环境变量；
 * 3. 返回受控长度的 stdout/stderr（同时把全量日志写入工作区），并返回工作区新增/修改文件。
 * ============================================================================
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { JobWorkspace } from './workspace-manager.ts';

const execFileAsync = promisify(execFile);

let cachedPythonExe: string | null | undefined = undefined;
let cachedAgentPythonExe: { customKey: string; exe: string | null } | null = null;
let cachedAgentEnvInfo: {
  exe: string;
  ts: number;
  info: AgentPythonEnvInfo;
} | null = null;

export interface AgentPythonEnvInfo {
  available: boolean;
  pythonPath: string | null;
  pythonVersion: string;
  isolated: boolean;
  sandboxDir: string;
  packages: Array<{ name: string; version: string }>;
}

export function clearAgentPythonCache(): void {
  cachedAgentPythonExe = null;
  cachedAgentEnvInfo = null;
}

/**
 * 为通用学术计算 Agent 探测独立隔离的 Python 解释器。
 * 优先级：用户显式 customPath / ASTROLIB_AGENT_PYTHON -> .venv-agent -> .venv -> 系统 Python。
 * 与 pdf2abp 流水线使用的 findBestPythonExecutable() 彻底解耦。
 */
export async function findAgentPythonExecutable(customPath?: string): Promise<string | null> {
  const customKey = (customPath || process.env.ASTROLIB_AGENT_PYTHON || '').trim();
  if (cachedAgentPythonExe && cachedAgentPythonExe.customKey === customKey) {
    return cachedAgentPythonExe.exe;
  }

  const isWin = os.platform() === 'win32';
  const pySub = isWin ? path.join('Scripts', 'python.exe') : path.join('bin', 'python');
  const candidates: string[] = [];

  if (customKey && fs.existsSync(customKey)) {
    candidates.push(customKey);
  }

  const root = process.cwd();
  candidates.push(path.resolve(root, '.venv-agent', pySub));
  if (process.env.ASTROLIB_USER_DATA_DIR) {
    candidates.push(path.resolve(process.env.ASTROLIB_USER_DATA_DIR, 'venv-agent', pySub));
  }
  candidates.push(path.resolve(root, '.venv', pySub));
  if (process.env.PYTHON_PATH && fs.existsSync(process.env.PYTHON_PATH)) {
    candidates.push(process.env.PYTHON_PATH);
  }
  if (isWin) {
    candidates.push('C:\\Program Files\\PyManager\\python.exe');
    candidates.push(path.join(os.homedir(), 'AppData\\Local\\Programs\\Python\\Python313\\python.exe'));
    candidates.push(path.join(os.homedir(), 'AppData\\Local\\Programs\\Python\\Python312\\python.exe'));
    candidates.push(path.join(os.homedir(), 'AppData\\Local\\Programs\\Python\\Python311\\python.exe'));
  }
  candidates.push('python3', 'python');

  for (const cand of candidates) {
    if (path.isAbsolute(cand) && !fs.existsSync(cand)) continue;
    try {
      const { stdout } = await execFileAsync(cand, ['-c', 'import sys; print(sys.executable)'], { timeout: 4000 });
      if (stdout.trim()) {
        const resolved = path.isAbsolute(cand) ? cand : stdout.trim();
        cachedAgentPythonExe = { customKey, exe: resolved };
        return resolved;
      }
    } catch {
      // try next
    }
  }

  cachedAgentPythonExe = { customKey, exe: null };
  return null;
}

export async function getAgentPythonEnvInfo(
  customPath?: string,
  forceRefresh = false
): Promise<AgentPythonEnvInfo> {
  const exe = await findAgentPythonExecutable(customPath);
  const sandboxDir = path.resolve(process.cwd(), '.venv-agent');
  if (!exe) {
    return {
      available: false,
      pythonPath: null,
      pythonVersion: '',
      isolated: false,
      sandboxDir,
      packages: [],
    };
  }

  const now = Date.now();
  if (
    !forceRefresh &&
    cachedAgentEnvInfo &&
    cachedAgentEnvInfo.exe === exe &&
    now - cachedAgentEnvInfo.ts < 15_000
  ) {
    return cachedAgentEnvInfo.info;
  }

  const probePy =
    'import sys, json, importlib.metadata as m; ' +
    'pkgs = {}; ' +
    '[pkgs.setdefault(d.metadata["Name"], d.version) for d in m.distributions() if d.metadata.get("Name")]; ' +
    'print(json.dumps({"version": sys.version.split()[0], "packages": [{"name": k, "version": pkgs[k]} for k in sorted(pkgs, key=str.lower)]}))';

  let pythonVersion = '';
  let packages: Array<{ name: string; version: string }> = [];
  try {
    const { stdout } = await execFileAsync(exe, ['-c', probePy], {
      timeout: 5000,
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    });
    const parsed = JSON.parse(stdout.trim() || '{}');
    pythonVersion = String(parsed.version || '');
    if (Array.isArray(parsed.packages)) {
      packages = parsed.packages.map((p: any) => ({
        name: String(p.name || ''),
        version: String(p.version || ''),
      }));
    }
  } catch {
    // keep basic executable info
  }

  const info: AgentPythonEnvInfo = {
    available: true,
    pythonPath: exe,
    pythonVersion,
    isolated: exe.toLowerCase().includes('.venv-agent') || exe.toLowerCase().includes('venv-agent'),
    sandboxDir,
    packages,
  };
  cachedAgentEnvInfo = { exe, ts: now, info };
  return info;
}

export async function findBestPythonExecutable(): Promise<string | null> {
  if (cachedPythonExe !== undefined) return cachedPythonExe;

  const isWin = os.platform() === 'win32';
  const pySub = isWin ? path.join('Scripts', 'python.exe') : path.join('bin', 'python');
  const candidates: string[] = [];

  if (process.env.PYTHON_PATH && fs.existsSync(process.env.PYTHON_PATH)) {
    candidates.push(process.env.PYTHON_PATH);
  }
  candidates.push(path.resolve(process.cwd(), '.venv', pySub));
  candidates.push(path.resolve(process.cwd(), '..', 'practice', '.venv', pySub));
  if (isWin) {
    candidates.push('C:\\Program Files\\PyManager\\python.exe');
    candidates.push(path.join(os.homedir(), 'AppData\\Local\\Programs\\Python\\Python313\\python.exe'));
    candidates.push(path.join(os.homedir(), 'AppData\\Local\\Programs\\Python\\Python312\\python.exe'));
    candidates.push(path.join(os.homedir(), 'AppData\\Local\\Programs\\Python\\Python311\\python.exe'));
  }
  candidates.push('python3', 'python');

  for (const cand of candidates) {
    if (path.isAbsolute(cand) && !fs.existsSync(cand)) continue;
    try {
      const { stdout } = await execFileAsync(cand, ['-c', 'import sys; print(sys.executable)'], { timeout: 4000 });
      if (stdout.trim()) {
        cachedPythonExe = path.isAbsolute(cand) ? cand : stdout.trim();
        return cachedPythonExe;
      }
    } catch {
      // try next
    }
  }

  cachedPythonExe = null;
  return null;
}

export async function getPythonAvailability(): Promise<{ available: boolean; pythonPath: string | null }> {
  const pythonPath = await findBestPythonExecutable();
  return { available: Boolean(pythonPath), pythonPath };
}

export interface RunWorkspacePythonOptions {
  workspace: JobWorkspace;
  code?: string;
  scriptRelPath?: string;
  args?: string[];
  timeoutMs?: number;
}

export interface RunWorkspacePythonResult {
  success: boolean;
  exitCode: number;
  scriptRelPath: string;
  stdout: string;
  stderr: string;
  truncated: boolean;
  logRelPath: string;
  durationMs: number;
}

export async function runWorkspacePython(options: RunWorkspacePythonOptions): Promise<RunWorkspacePythonResult> {
  const { workspace, code, scriptRelPath, args = [], timeoutMs = 60000 } = options;
  const pythonExe = await findBestPythonExecutable();
  if (!pythonExe) {
    throw new Error('未检测到可用的 Python 解释器。请安装 Python 3 或配置 PYTHON_PATH 环境变量。');
  }

  let targetScriptAbs: string;
  let targetScriptRel: string;

  if (code && code.trim()) {
    const fileName = `_agent_run_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.py`;
    targetScriptRel = `scripts/${fileName}`;
    targetScriptAbs = workspace.resolveWorkspacePath(targetScriptRel);
    fs.mkdirSync(path.dirname(targetScriptAbs), { recursive: true });
    fs.writeFileSync(targetScriptAbs, code, 'utf-8');
  } else if (scriptRelPath && scriptRelPath.trim()) {
    targetScriptAbs = workspace.resolveWorkspacePath(scriptRelPath);
    if (!fs.existsSync(targetScriptAbs)) {
      throw new Error(`Python 脚本不存在: ${scriptRelPath}`);
    }
    targetScriptRel = workspace.toRelativePath(targetScriptAbs);
  } else {
    throw new Error('必须提供 code 或 scriptRelPath 之一');
  }

  const clampedTimeout = Math.max(1000, Math.min(180000, timeoutMs));
  const t0 = Date.now();
  let exitCode = 0;
  let rawStdout = '';
  let rawStderr = '';

  try {
    const res = await execFileAsync(pythonExe, [targetScriptAbs, ...args], {
      cwd: workspace.rootDir,
      timeout: clampedTimeout,
      maxBuffer: 8 * 1024 * 1024,
      env: {
        ...process.env,
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
        ASTROLIB_WORKSPACE_DIR: workspace.rootDir,
        ASTROLIB_JOB_WORKSPACE: workspace.rootDir,
        ASTROLIB_SOURCE_PDF: workspace.sourcePdfPath,
        ASTROLIB_MINERU_DIR: workspace.mineruStitchedDir,
        ASTROLIB_BOOK_DIR: workspace.bookDir,
        ASTROLIB_CHUNKS_DIR: workspace.chunksDir,
        ASTROLIB_DIST_DIR: workspace.distDir,
      },
    });
    rawStdout = res.stdout || '';
    rawStderr = res.stderr || '';
  } catch (err: any) {
    exitCode = typeof err?.code === 'number' ? err.code : 1;
    rawStdout = err?.stdout || '';
    rawStderr = err?.stderr || err?.message || String(err);
  }

  const durationMs = Date.now() - t0;
  const logRelPath = 'scripts/_last_output.log';
  const fullLog = `=== EXIT CODE: ${exitCode} (${durationMs}ms) ===\n--- STDOUT ---\n${rawStdout}\n--- STDERR ---\n${rawStderr}\n`;
  workspace.writeFile(logRelPath, fullLog);

  const MAX_RETURN = 12000;
  let truncated = false;
  let stdout = rawStdout;
  let stderr = rawStderr;
  if (stdout.length > MAX_RETURN) {
    stdout = stdout.slice(0, MAX_RETURN) + `\n... [stdout truncated, full log in ${logRelPath}]`;
    truncated = true;
  }
  if (stderr.length > 4000) {
    stderr = stderr.slice(0, 4000) + `\n... [stderr truncated, full log in ${logRelPath}]`;
    truncated = true;
  }

  return {
    success: exitCode === 0,
    exitCode,
    scriptRelPath: targetScriptRel,
    stdout,
    stderr,
    truncated,
    logRelPath,
    durationMs,
  };
}
