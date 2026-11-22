/**
 * src/services/antigravity-cli/antigravity-cli-service.ts
 * ============================================================================
 * AstroLib Antigravity CLI 本地智能体独立调度服务 (Independent CLI Service)
 * ============================================================================
 * 职责：
 * 1. 静默环境自省：探测本地是否安装 antigravity-cli (agy)，未安装时完全静默隐藏；
 * 2. 多模型矩阵管理：暴露 Gemini 3.8 Flash (High) / Claude Sonnet / Opus 等高表现力模型；
 * 3. 独立进程流式调度：基于 agy --output-format stream-json 实现全双工事件流；
 * 4. 具备与远程 API 相同规格的工具调用与任务执行能力，无缝打通 AstroLib 学术知识库。
 * ============================================================================
 */

import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface AntigravityCliModelOption {
  id: string;
  name: string;
  reasoningEffort: 'off' | 'low' | 'medium' | 'high' | 'max';
  desc: string;
  badge?: string;
}

export interface AntigravityCliStatus {
  available: boolean;
  version?: string;
  executablePath?: string;
  models?: AntigravityCliModelOption[];
  error?: string;
}

export type AntigravityCliStreamEvent =
  | { type: 'init'; conversationId?: string; model?: string }
  | { type: 'reasoning_delta'; delta: string }
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_start'; toolCallId: string; toolName: string; parameters: Record<string, any> }
  | { type: 'tool_done'; toolCallId: string; toolName: string; output: string; durationSeconds?: number }
  | { type: 'finish'; conversationId?: string; usage?: { inputTokens?: number; outputTokens?: number; thinkingTokens?: number; totalTokens?: number } }
  | { type: 'error'; error: string };

export class AntigravityCliService {
  private static instance: AntigravityCliService | null = null;
  private cachedStatus: AntigravityCliStatus | null = null;
  private projectRoot: string;

  public static getInstance(projectRoot?: string): AntigravityCliService {
    if (!AntigravityCliService.instance) {
      AntigravityCliService.instance = new AntigravityCliService(projectRoot || process.cwd());
    }
    return AntigravityCliService.instance;
  }

  constructor(projectRoot: string) {
    this.projectRoot = path.resolve(projectRoot);
  }

  /**
   * 默认支持的模型矩阵 (具备高表述能力与深度学术思考能力)
   */
  public getDefaultModels(): AntigravityCliModelOption[] {
    return [
      {
        id: 'gemini-3.8-flash-high',
        name: 'Gemini 3.8 Flash (High)',
        reasoningEffort: 'high',
        desc: 'Google 官方前沿混合长文推理模型 · 极强理科表述能力与长上下文',
        badge: '推荐 · 强表述',
      },
      {
        id: 'claude-sonnet-4-6',
        name: 'Claude Sonnet 4.6',
        reasoningEffort: 'high',
        desc: '严密逻辑推导与复杂数学推演 · 完整思考链',
        badge: '深度思考',
      },
      {
        id: 'claude-opus-4-6-thinking',
        name: 'Claude Opus 4.6',
        reasoningEffort: 'max',
        desc: '复杂学术文献论证与极限数学证明推导',
        badge: '极限推导',
      },
      {
        id: 'gemini-3.8-flash-medium',
        name: 'Gemini 3.8 Flash (Med)',
        reasoningEffort: 'medium',
        desc: '高速通识推导与高性价比日常学术交互',
        badge: '快速推理',
      },
      {
        id: 'gpt-oss-120b-medium',
        name: 'GPT-OSS 120B',
        reasoningEffort: 'medium',
        desc: '开源超大规模权重模型 · 宽广通识基底',
        badge: '开源巨构',
      },
    ];
  }

  /**
   * 启发式探测本地 antigravity-cli (agy) 可执行程序路径
   * 若未安装则静默返回 null，杜绝抛出任何错误或产生可见垃圾日志
   */
  public async findExecutable(): Promise<string | null> {
    const isWin = process.platform === 'win32';
    const binaryName = isWin ? 'agy.exe' : 'agy';

    // 1. 尝试从常见默认安装目录探测
    const home = os.homedir();
    const candidatePaths: string[] = [];

    if (isWin) {
      const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
      candidatePaths.push(
        path.join(localAppData, 'agy', 'bin', 'agy.exe'),
        path.join(home, '.gemini', 'bin', 'agy.exe'),
        path.join(home, '.gemini', 'antigravity-cli', 'bin', 'agy.exe')
      );
    } else {
      candidatePaths.push(
        path.join(home, '.local', 'bin', 'agy'),
        path.join(home, '.gemini', 'bin', 'agy'),
        '/usr/local/bin/agy',
        '/usr/bin/agy'
      );
    }

    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        try {
          fs.accessSync(p, fs.constants.X_OK);
          return p;
        } catch {
          // 在 Windows 下某些非执行权限文件跳过
          if (isWin) return p;
        }
      }
    }

    // 2. 尝试从系统环境变量 PATH 查找
    try {
      const tool = isWin ? 'where.exe' : 'which';
      const { stdout } = await execFileAsync(tool, ['agy'], { timeout: 2000 });
      const firstLine = stdout.trim().split(/\r?\n/)[0]?.trim();
      if (firstLine && fs.existsSync(firstLine)) {
        return firstLine;
      }
    } catch {
      // PATH 中不存在 agy
    }

    return null;
  }

  /**
   * 静默环境自省 (Silent Diagnostics)
   * 如果用户没有安装 antigravity-cli，此内容应当静默隐藏，不留痕迹
   */
  public async detectCli(force = false): Promise<AntigravityCliStatus> {
    if (!force && this.cachedStatus) {
      return this.cachedStatus;
    }

    const exePath = await this.findExecutable();
    if (!exePath) {
      this.cachedStatus = { available: false };
      return this.cachedStatus;
    }

    try {
      const { stdout } = await execFileAsync(exePath, ['--version'], { timeout: 3000 });
      const version = stdout.trim();

      // 确保 AstroLib 官方 MCP 工具集挂载在本地 agy 配置中
      await this.ensureMcpServer(exePath);

      this.cachedStatus = {
        available: true,
        version,
        executablePath: exePath,
        models: this.getDefaultModels(),
      };
      return this.cachedStatus;
    } catch {
      // 无法正常执行，判定为不可用并静默隐藏
      this.cachedStatus = { available: false };
      return this.cachedStatus;
    }
  }

  /**
   * 解析安全可执行的宿主物理目录作为 CWD
   * 杜绝将 Electron 内部虚拟路径 (app.asar) 作为子进程工作目录导致 ENOENT
   */
  public getSafeCwd(): string {
    let candidate = this.projectRoot;

    // 1. 如果路径包含 .asar（Electron 虚拟归档，外部 OS 进程无法作为 cwd），剥离并定位真实目录
    if (candidate.includes('.asar')) {
      const parts = candidate.split(path.sep);
      const asarIdx = parts.findIndex((p) => p.endsWith('.asar'));
      if (asarIdx >= 0) {
        candidate = parts.slice(0, asarIdx).join(path.sep);
      }
    }

    // 2. 如果 candidate 是一个文件，取其所在父目录
    try {
      if (fs.existsSync(candidate)) {
        const stat = fs.statSync(candidate);
        if (!stat.isDirectory()) {
          candidate = path.dirname(candidate);
        }
      }
    } catch {}

    // 3. 向上回溯探测是否有 AstroLib 源码或可执行文件所在的实际工作根目录
    let curr = candidate;
    for (let i = 0; i < 4; i++) {
      if (fs.existsSync(path.join(curr, 'bin', 'astrolib-mcp.mjs')) || fs.existsSync(path.join(curr, 'package.json'))) {
        return curr;
      }
      const parent = path.dirname(curr);
      if (parent === curr) break;
      curr = parent;
    }

    // 4. 优先检查当前 process.cwd()
    try {
      const cwd = process.cwd();
      if (fs.existsSync(cwd) && fs.statSync(cwd).isDirectory()) {
        return cwd;
      }
    } catch {}

    // 5. 兜底用户主目录
    return os.homedir();
  }

  /**
   * 确保 AstroLib 官方 MCP 工具集自动注册到本地 agy
   */
  private async ensureMcpServer(exePath: string): Promise<void> {
    const safeCwd = this.getSafeCwd();
    let mcpScriptPath = path.resolve(safeCwd, 'bin', 'astrolib-mcp.mjs');
    if (!fs.existsSync(mcpScriptPath)) {
      const fallback = path.resolve(process.cwd(), 'bin', 'astrolib-mcp.mjs');
      if (fs.existsSync(fallback)) {
        mcpScriptPath = fallback;
      } else {
        return;
      }
    }

    try {
      const { stdout } = await execFileAsync(exePath, ['mcp', 'list'], { timeout: 3000 });
      if (!stdout.includes('astrolib')) {
        await execFileAsync(exePath, ['mcp', 'add', 'astrolib', 'node', mcpScriptPath], {
          timeout: 4000,
        });
      }
    } catch {
      // 若注册遇到权限或网络问题，静默跳过，底层仍支持 CLI 兜底
    }
  }

  /**
   * 执行单次任务并以异步生成器模式推送结构化事件流 (Stream-JSON Relay)
   */
  public async *streamTask(params: {
    prompt: string;
    model?: string;
    reasoningEffort?: string;
    agyConversationId?: string;
    signal?: AbortSignal;
    systemPrompt?: string;
  }): AsyncGenerator<AntigravityCliStreamEvent, void, unknown> {
    const status = await this.detectCli();
    if (!status.available || !status.executablePath) {
      yield { type: 'error', error: '未在当前系统中检测到有效的 antigravity-cli (agy) 安装' };
      return;
    }

    const {
      prompt,
      model = 'gemini-3.8-flash-high',
      reasoningEffort = 'high',
      agyConversationId,
      signal,
      systemPrompt,
    } = params;

    const fullPrompt = systemPrompt ? `[SYSTEM INSTRUCTION]\n${systemPrompt}\n\n[USER REQUEST]\n${prompt}` : prompt;

    const args: string[] = [];
    if (agyConversationId) {
      args.push('--conversation', agyConversationId);
    }
    args.push(
      '-p',
      fullPrompt,
      '--model',
      model,
      '--effort',
      reasoningEffort,
      '--output-format',
      'stream-json',
      '--dangerously-skip-permissions'
    );

    const safeCwd = this.getSafeCwd();

    const child = spawn(status.executablePath, args, {
      cwd: safeCwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
      },
    });

    if (signal) {
      const onAbort = () => {
        try {
          child.kill('SIGINT');
          setTimeout(() => {
            if (!child.killed) child.kill('SIGKILL');
          }, 1000);
        } catch {}
      };
      if (signal.aborted) {
        onAbort();
        yield { type: 'error', error: 'User aborted task' };
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    const eventQueue: AntigravityCliStreamEvent[] = [];
    let isFinished = false;
    let finishError: Error | null = null;
    let notifyNewData: (() => void) | null = null;

    const pushEvent = (evt: AntigravityCliStreamEvent) => {
      eventQueue.push(evt);
      if (notifyNewData) {
        notifyNewData();
        notifyNewData = null;
      }
    };

    let partialLine = '';

    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      const lines = (partialLine + text).split('\n');
      partialLine = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const parsed = JSON.parse(trimmed);
          if (parsed.event === 'init') {
            pushEvent({
              type: 'init',
              conversationId: parsed.conversation_id,
              model: parsed.init?.model,
            });
          } else if (parsed.event === 'step_update') {
            const step = parsed.step_update;
            if (!step) continue;

            if (step.step_type === 'agent_response') {
              if (step.text_delta) {
                pushEvent({ type: 'text_delta', delta: step.text_delta });
              }
              if (step.thinking_delta) {
                pushEvent({ type: 'reasoning_delta', delta: step.thinking_delta });
              }
            } else if (step.step_type === 'tool') {
              const toolName = step.tool_name || step.tool_info?.name || 'unknown_tool';
              const callId = `tc-${step.step_index ?? Date.now()}`;

              if (step.state === 'ACTIVE') {
                pushEvent({
                  type: 'tool_start',
                  toolCallId: callId,
                  toolName,
                  parameters: step.tool_info?.parameters || {},
                });
              } else if (step.state === 'DONE') {
                pushEvent({
                  type: 'tool_done',
                  toolCallId: callId,
                  toolName,
                  output: step.tool_info?.output || '',
                  durationSeconds: step.duration_seconds,
                });
              }
            }
          } else if (parsed.event === 'result') {
            const res = parsed.result;
            pushEvent({
              type: 'finish',
              conversationId: res?.conversation_id,
              usage: {
                inputTokens: res?.usage?.input_tokens,
                outputTokens: res?.usage?.output_tokens,
                thinkingTokens: res?.usage?.thinking_tokens,
                totalTokens: res?.usage?.total_tokens,
              },
            });
          }
        } catch {
          // 非 JSON 输出行（例如 CLI 启动日志）
        }
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      const errText = chunk.toString('utf-8');
      if (errText.includes('FATAL') || errText.includes('Error:')) {
        pushEvent({ type: 'error', error: errText });
      }
    });

    child.on('error', (err) => {
      finishError = err;
      isFinished = true;
      if (notifyNewData) notifyNewData();
    });

    child.on('close', (code) => {
      if (code !== 0 && code !== null && !finishError && eventQueue.length === 0) {
        finishError = new Error(`antigravity-cli exited with code ${code}`);
      }
      isFinished = true;
      if (notifyNewData) notifyNewData();
    });

    while (!isFinished || eventQueue.length > 0) {
      if (eventQueue.length > 0) {
        const evt = eventQueue.shift()!;
        yield evt;
      } else {
        await new Promise<void>((resolve) => {
          notifyNewData = resolve;
        });
      }
    }

    if (finishError) {
      yield { type: 'error', error: (finishError as Error).message };
    }
  }
}
