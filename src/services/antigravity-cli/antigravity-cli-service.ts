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

  public async findExecutable(): Promise<string | null> {
    const isWin = process.platform === 'win32';
    const binaryName = isWin ? 'agy.exe' : 'agy';

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

          if (isWin) return p;
        }
      }
    }

    try {
      const tool = isWin ? 'where.exe' : 'which';
      const { stdout } = await execFileAsync(tool, ['agy'], { timeout: 2000 });
      const firstLine = stdout.trim().split(/\r?\n/)[0]?.trim();
      if (firstLine && fs.existsSync(firstLine)) {
        return firstLine;
      }
    } catch {

    }

    return null;
  }

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

      await this.ensureMcpServer(exePath);

      this.cachedStatus = {
        available: true,
        version,
        executablePath: exePath,
        models: this.getDefaultModels(),
      };
      return this.cachedStatus;
    } catch {

      this.cachedStatus = { available: false };
      return this.cachedStatus;
    }
  }

  public getSafeCwd(): string {
    let candidate = this.projectRoot;

    if (candidate.includes('.asar')) {
      const parts = candidate.split(path.sep);
      const asarIdx = parts.findIndex((p) => p.endsWith('.asar'));
      if (asarIdx >= 0) {
        candidate = parts.slice(0, asarIdx).join(path.sep);
      }
    }

    try {
      if (fs.existsSync(candidate)) {
        const stat = fs.statSync(candidate);
        if (!stat.isDirectory()) {
          candidate = path.dirname(candidate);
        }
      }
    } catch {}

    let curr = candidate;
    for (let i = 0; i < 4; i++) {
      if (fs.existsSync(path.join(curr, 'bin', 'astrolib-mcp.mjs')) || fs.existsSync(path.join(curr, 'package.json'))) {
        return curr;
      }
      const parent = path.dirname(curr);
      if (parent === curr) break;
      curr = parent;
    }

    try {
      const cwd = process.cwd();
      if (fs.existsSync(cwd) && fs.statSync(cwd).isDirectory()) {
        return cwd;
      }
    } catch {}

    return os.homedir();
  }

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

    }
  }

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
