/**
 * src/ai/agent/harness-runner.ts
 * ============================================================================
 * 通用 Agent Tool-Calling 执行循环器 (OpenAI-Compatible Streaming & Sync Runner)
 * ============================================================================
 * 特性：
 * 1. 基于 Zod v4 (`z.toJSONSchema`) 自动导出工具 Schema 并做严格入参校验；
 * 2. 原生支持 SSE 流式与普通 JSON 双响应，兼容推理模型的 `reasoning_content` / `reasoning`；
 * 3. 与 `AgentContextManager` 深度绑定，保证任意网关（含 Youlabber 单图槽限制）零溢出运行；
 * 4. 工具返回的 `visionAttachment` 在同一 Turn 所有 `role:'tool'` 落盘后以合成 `user` 消息注入；
 * 5. 支持瞬时故障指数退避重试、`AbortSignal` 优雅取消、`finish_reason === 'length'` 自动续写。
 * ============================================================================
 */

import { z } from 'zod';
import {
  AgentContextManager,
  resolveProviderCapabilities,
  type ChatMessage,
  type ChatToolCall,
  type ContextPreparationStats,
  type ProviderCapabilities,
} from './context-manager.ts';

export interface AgentVisionAttachment {
  base64DataUrl: string;
  label: string;
  relPath?: string;
  detail?: 'low' | 'high' | 'auto';
}

export interface AgentToolResult {
  text: string;
  summary?: string;
  visionAttachment?: AgentVisionAttachment;
  artifactPath?: string;
  data?: Record<string, unknown>;
  isError?: boolean;
}

export interface AgentToolContext {
  agentId: string;
  step: number;
  signal?: AbortSignal;
}

export interface AgentToolDefinition<TParams extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  parameters: TParams;
  execute: (args: z.infer<TParams>, ctx: AgentToolContext) => Promise<AgentToolResult>;
}

export type HarnessEventType =
  | 'thinking'
  | 'tool_start'
  | 'tool_result'
  | 'vision_attached'
  | 'artifact_written'
  | 'assistant_message'
  | 'warning'
  | 'error';

export interface HarnessEvent {
  agentId: string;
  type: HarnessEventType;
  message: string;
  data?: Record<string, unknown>;
}

export interface AgentLoopConfig {
  agentId: string;
  providerId: string;
  modelId: string;
  baseURL: string;
  apiKey?: string;
  extraHeaders?: Record<string, string>;
  systemPrompt: string;
  initialUserPrompt: string;
  tools: AgentToolDefinition<any>[];
  capabilities?: Partial<ProviderCapabilities>;
  maxSteps?: number;
  temperature?: number;
  maxTokens?: number;
  requestTimeoutMs?: number;
  stream?: boolean;
  signal?: AbortSignal;
  onEvent?: (evt: HarnessEvent) => void;
  onHttp429?: () => void;
  onHttpOk?: () => void;
}

export interface AgentRunResult {
  finalText: string;
  stepsUsed: number;
  toolCallsCount: number;
  aborted: boolean;
  finishReason: string;
  durationMs: number;
  totalUsage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  lastContextStats?: ContextPreparationStats;
}

interface RawCompletionResponse {
  content: string;
  reasoningContent: string;
  toolCalls: ChatToolCall[];
  finishReason: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

function toOpenAiTools(tools: AgentToolDefinition<any>[]): Array<Record<string, unknown>> {
  return tools.map((tool) => {
    const rawSchema = z.toJSONSchema(tool.parameters) as Record<string, unknown>;
    const cleanSchema = { ...rawSchema };
    delete cleanSchema.$schema;
    return {
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: cleanSchema,
      },
    };
  });
}

function resolveEndpointUrl(baseURL: string): string {
  const clean = baseURL.trim().replace(/\/+$/, '');
  if (clean.endsWith('/chat/completions')) return clean;
  return `${clean}/chat/completions`;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

class HttpGatewayError extends Error {
  public readonly status: number;
  public readonly body: string;
  constructor(status: number, body: string) {
    super(`LLM gateway HTTP ${status}: ${body.slice(0, 600)}`);
    this.status = status;
    this.body = body;
  }
}

function isRetryableError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === 'AbortError') return false;
  if (err instanceof Error && err.name === 'AbortError') return false;
  if (err instanceof HttpGatewayError) {
    return err.status === 429 || err.status >= 500;
  }
  // 网络抖动 / 连接重置 / JSON 截断
  return true;
}

async function parseCompletionResponse(
  response: Response,
  agentId: string,
  onEvent?: (evt: HarnessEvent) => void
): Promise<RawCompletionResponse> {
  const contentType = (response.headers.get('content-type') || '').toLowerCase();

  // 非流式 JSON 直接解析
  if (!contentType.includes('text/event-stream')) {
    const json = (await response.json()) as any;
    const choice = json?.choices?.[0];
    const message = choice?.message ?? {};
    const toolCalls: ChatToolCall[] = Array.isArray(message.tool_calls)
      ? message.tool_calls.map((tc: any, idx: number) => ({
          id: tc.id || `call_${idx}_${Date.now()}`,
          type: 'function' as const,
          function: {
            name: String(tc.function?.name ?? ''),
            arguments:
              typeof tc.function?.arguments === 'string'
                ? tc.function.arguments
                : JSON.stringify(tc.function?.arguments ?? {}),
          },
        }))
      : [];

    const reasoning = String(message.reasoning_content || message.reasoning || '');
    if (reasoning.trim()) {
      onEvent?.({
        agentId,
        type: 'thinking',
        message: reasoning.slice(0, 400),
        data: { chars: reasoning.length },
      });
    }

    return {
      content: typeof message.content === 'string' ? message.content : '',
      reasoningContent: reasoning,
      toolCalls,
      finishReason: String(choice?.finish_reason || (toolCalls.length > 0 ? 'tool_calls' : 'stop')),
      usage: {
        promptTokens: Number(json?.usage?.prompt_tokens ?? 0),
        completionTokens: Number(json?.usage?.completion_tokens ?? 0),
        totalTokens: Number(json?.usage?.total_tokens ?? 0),
      },
    };
  }

  // SSE 流式累积解析
  if (!response.body) {
    throw new Error('SSE response has empty body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let content = '';
  let reasoningContent = '';
  let finishReason = '';
  const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  const toolCallsAcc = new Map<
    number,
    { id: string; name: string; arguments: string }
  >();

  let lastThinkingEmitAt = Date.now();
  let thinkingBuffer = '';

  const flushThinking = (force = false) => {
    const now = Date.now();
    if (!thinkingBuffer.trim()) return;
    if (force || now - lastThinkingEmitAt >= 1400 || thinkingBuffer.length >= 600) {
      onEvent?.({
        agentId,
        type: 'thinking',
        message: thinkingBuffer.trim().slice(0, 320),
        data: { streaming: !force },
      });
      thinkingBuffer = '';
      lastThinkingEmitAt = now;
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
      const rawLine = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);

      if (!rawLine || rawLine.startsWith(':')) continue;
      if (!rawLine.startsWith('data:')) continue;
      const payload = rawLine.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;

      let chunk: any;
      try {
        chunk = JSON.parse(payload);
      } catch {
        continue;
      }

      if (chunk.usage) {
        usage.promptTokens = Number(chunk.usage.prompt_tokens ?? usage.promptTokens);
        usage.completionTokens = Number(chunk.usage.completion_tokens ?? usage.completionTokens);
        usage.totalTokens = Number(chunk.usage.total_tokens ?? usage.totalTokens);
      }

      const choice = chunk.choices?.[0];
      if (!choice) continue;
      if (choice.finish_reason) {
        finishReason = String(choice.finish_reason);
      }

      const delta = choice.delta ?? choice.message;
      if (!delta) continue;

      const rDelta = delta.reasoning_content ?? delta.reasoning;
      if (typeof rDelta === 'string' && rDelta.length > 0) {
        reasoningContent += rDelta;
        thinkingBuffer += rDelta;
        flushThinking(false);
      }

      if (typeof delta.content === 'string' && delta.content.length > 0) {
        content += delta.content;
      }

      if (Array.isArray(delta.tool_calls)) {
        for (let i = 0; i < delta.tool_calls.length; i++) {
          const tc = delta.tool_calls[i];
          const idx = typeof tc.index === 'number' ? tc.index : i;
          const cur = toolCallsAcc.get(idx) ?? {
            id: tc.id || `call_${idx}_${Date.now()}`,
            name: '',
            arguments: '',
          };
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name += tc.function.name;
          if (typeof tc.function?.arguments === 'string') {
            cur.arguments += tc.function.arguments;
          }
          toolCallsAcc.set(idx, cur);
        }
      }
    }
  }

  flushThinking(true);

  const sortedIndices = [...toolCallsAcc.keys()].sort((a, b) => a - b);
  const toolCalls: ChatToolCall[] = sortedIndices.map((idx) => {
    const tc = toolCallsAcc.get(idx)!;
    return {
      id: tc.id,
      type: 'function',
      function: {
        name: tc.name,
        arguments: tc.arguments,
      },
    };
  });

  if (!finishReason) {
    finishReason = toolCalls.length > 0 ? 'tool_calls' : 'stop';
  }

  return {
    content,
    reasoningContent,
    toolCalls,
    finishReason,
    usage,
  };
}

async function callGatewayWithRetry(
  endpointUrl: string,
  headers: Record<string, string>,
  bodyPayload: Record<string, unknown>,
  requestTimeoutMs: number,
  agentId: string,
  signal?: AbortSignal,
  onEvent?: (evt: HarnessEvent) => void,
  onHttp429?: () => void,
  onHttpOk?: () => void
): Promise<RawCompletionResponse> {
  const maxAttempts = 3;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('LLM request timeout')), requestTimeoutMs);
    const onParentAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', onParentAbort, { once: true });

    try {
      const response = await fetch(endpointUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(bodyPayload),
        signal: controller.signal,
      });

      if (!response.ok) {
        if (response.status === 429) {
          onHttp429?.();
        }
        const errBody = await response.text().catch(() => '');
        throw new HttpGatewayError(response.status, errBody);
      }

      const parsed = await parseCompletionResponse(response, agentId, onEvent);
      onHttpOk?.();
      return parsed;
    } catch (err) {
      lastError = err;
      if (signal?.aborted || !isRetryableError(err) || attempt === maxAttempts) {
        throw err;
      }
      const backoffMs = attempt === 1 ? 1000 : 2500;
      onEvent?.({
        agentId,
        type: 'warning',
        message: `Gateway transient error (attempt ${attempt}/${maxAttempts}), retrying in ${backoffMs}ms: ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
      await sleep(backoffMs, signal);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onParentAbort);
    }
  }

  throw lastError;
}

export async function runAgentLoop(config: AgentLoopConfig): Promise<AgentRunResult> {
  const startedAt = Date.now();
  const baseCaps = resolveProviderCapabilities(config.providerId, config.modelId);
  const capabilities: ProviderCapabilities = {
    ...baseCaps,
    ...config.capabilities,
  };

  const contextManager = new AgentContextManager({ capabilities });
  const maxSteps = config.maxSteps ?? 72;
  const temperature = config.temperature ?? 0.2;
  const maxTokens = Math.max(
    config.maxTokens ?? capabilities.defaultMaxOutputTokens,
    capabilities.isReasoningModel ? 16384 : 4096
  );
  const requestTimeoutMs = config.requestTimeoutMs ?? 240_000;
  const endpointUrl = resolveEndpointUrl(config.baseURL);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    ...(config.extraHeaders ?? {}),
  };

  const openAiTools = toOpenAiTools(config.tools);
  const toolMap = new Map<string, AgentToolDefinition<any>>();
  for (const tool of config.tools) {
    toolMap.set(tool.name, tool);
  }

  let history: ChatMessage[] = [
    { role: 'system', content: config.systemPrompt },
    { role: 'user', content: config.initialUserPrompt },
  ];

  let stepsUsed = 0;
  let toolCallsCount = 0;
  let consecutiveLengthRetries = 0;
  let consecutiveEmptyStopRetries = 0;
  let lastFinishReason = 'unknown';
  let lastContextStats: ContextPreparationStats | undefined;
  const totalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  while (stepsUsed < maxSteps) {
    if (config.signal?.aborted) {
      return {
        finalText: '',
        stepsUsed,
        toolCallsCount,
        aborted: true,
        finishReason: 'aborted',
        durationMs: Date.now() - startedAt,
        totalUsage,
        lastContextStats,
      };
    }

    stepsUsed++;
    const prep = contextManager.prepareContext(history);
    history = prep.compactedHistory;
    lastContextStats = prep.stats;

    if (prep.stats.compacted) {
      config.onEvent?.({
        agentId: config.agentId,
        type: 'warning',
        message: `Context compacted: ~${prep.stats.estimatedTokens} tokens (droppedGroups=${prep.stats.droppedGroupsCount}, truncatedTools=${prep.stats.truncatedToolsCount}, evictedImages=${prep.stats.evictedImagesCount})`,
        data: { ...prep.stats },
      });
    }

    const requestBody: Record<string, unknown> = {
      model: config.modelId,
      messages: prep.wireMessages,
      ...(openAiTools.length > 0 ? { tools: openAiTools, tool_choice: 'auto' } : {}),
      max_tokens: maxTokens,
      temperature,
      stream: config.stream ?? capabilities.supportsStreaming,
    };

    const completion = await callGatewayWithRetry(
      endpointUrl,
      headers,
      requestBody,
      requestTimeoutMs,
      config.agentId,
      config.signal,
      config.onEvent,
      config.onHttp429,
      config.onHttpOk
    );

    totalUsage.promptTokens += completion.usage.promptTokens;
    totalUsage.completionTokens += completion.usage.completionTokens;
    totalUsage.totalTokens += completion.usage.totalTokens;
    lastFinishReason = completion.finishReason;

    if (completion.toolCalls.length > 0) {
      consecutiveLengthRetries = 0;
      consecutiveEmptyStopRetries = 0;

      // 防止视觉槽被下一轮图像顶出后模型产生“视觉失忆”：若本轮紧随 syntheticVision 且仅输出了 reasoningContent 而未落盘文本，自动提取视觉观察摘要写入 assistant.content
      let assistantContent: string | null = completion.content ? completion.content : null;
      const lastMsg = history.length > 0 ? history[history.length - 1] : undefined;
      if (
        lastMsg?.role === 'user' &&
        Boolean(lastMsg.meta?.syntheticVision) &&
        !(assistantContent && assistantContent.trim()) &&
        Boolean(completion.reasoningContent && completion.reasoningContent.trim())
      ) {
        const cleanedReasoning = completion.reasoningContent.replace(/\s+/g, ' ').trim();
        const excerpt =
          cleanedReasoning.length <= 640
            ? cleanedReasoning
            : `${cleanedReasoning.slice(0, 310)} ... ${cleanedReasoning.slice(-310)}`;
        const visLabel = String(lastMsg.meta?.visionLabel || 'previous image');
        assistantContent = `[视觉审视要点自动存档 · ${visLabel}] ${excerpt}`;
      }

      history.push({
        role: 'assistant',
        content: assistantContent,
        tool_calls: completion.toolCalls,
        ...(completion.reasoningContent
          ? { reasoning_content: completion.reasoningContent }
          : {}),
      });

      const pendingVisions: AgentVisionAttachment[] = [];

      for (const tc of completion.toolCalls) {
        if (config.signal?.aborted) break;
        toolCallsCount++;

        const fnName = tc.function.name;
        const toolDef = toolMap.get(fnName);

        let parsedArgs: unknown = {};
        let parseError: string | null = null;
        try {
          parsedArgs = tc.function.arguments.trim()
            ? JSON.parse(tc.function.arguments)
            : {};
        } catch (err) {
          parseError = err instanceof Error ? err.message : String(err);
        }

        config.onEvent?.({
          agentId: config.agentId,
          type: 'tool_start',
          message: `Calling ${fnName}`,
          data: {
            toolCallId: tc.id,
            toolName: fnName,
            argsPreview: tc.function.arguments.slice(0, 240),
          },
        });

        let toolResult: AgentToolResult;
        if (!toolDef) {
          toolResult = {
            isError: true,
            text: JSON.stringify({ error: `Unknown tool: ${fnName}` }),
            summary: `Unknown tool ${fnName}`,
          };
        } else if (parseError) {
          toolResult = {
            isError: true,
            text: JSON.stringify({
              error: `Invalid JSON arguments for ${fnName}: ${parseError}`,
              rawArgumentsPreview: tc.function.arguments.slice(0, 300),
            }),
            summary: `Invalid JSON args for ${fnName}`,
          };
        } else {
          const zodCheck = toolDef.parameters.safeParse(parsedArgs);
          if (!zodCheck.success) {
            const formattedIssues = zodCheck.error.issues.map(
              (iss: { path: PropertyKey[]; message: string }) =>
                `${iss.path.map(String).join('.') || '<root>'}: ${iss.message}`
            );
            toolResult = {
              isError: true,
              text: JSON.stringify({
                error: `Parameter validation failed for ${fnName}`,
                issues: formattedIssues,
              }),
              summary: `Invalid params for ${fnName}`,
            };
          } else {
            try {
              toolResult = await toolDef.execute(zodCheck.data, {
                agentId: config.agentId,
                step: stepsUsed,
                signal: config.signal,
              });
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : String(err);
              toolResult = {
                isError: true,
                text: JSON.stringify({
                  error: `Tool ${fnName} threw exception: ${errMsg}`,
                }),
                summary: `${fnName} failed: ${errMsg.slice(0, 120)}`,
              };
            }
          }
        }

        history.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: toolResult.text,
        });

        config.onEvent?.({
          agentId: config.agentId,
          type: 'tool_result',
          message: toolResult.summary || `${fnName} completed`,
          data: {
            toolCallId: tc.id,
            toolName: fnName,
            isError: Boolean(toolResult.isError),
            chars: toolResult.text.length,
          },
        });

        if (toolResult.artifactPath) {
          config.onEvent?.({
            agentId: config.agentId,
            type: 'artifact_written',
            message: `Artifact updated: ${toolResult.artifactPath}`,
            data: { path: toolResult.artifactPath, toolName: fnName },
          });
        }

        if (toolResult.visionAttachment) {
          pendingVisions.push(toolResult.visionAttachment);
        }
      }

      // 所有 role:'tool' 落盘后再追加合成 user 图片消息，防止破坏 tool_calls 配对
      if (pendingVisions.length > 0 && capabilities.maxImagesPerRequest > 0) {
        const sliced = pendingVisions.slice(-capabilities.maxImagesPerRequest);
        const droppedLabels = pendingVisions
          .slice(0, Math.max(0, pendingVisions.length - sliced.length))
          .map((v) => v.label);
        const dropNotice =
          droppedLabels.length > 0
            ? ` Note: ${droppedLabels.length} earlier image(s) from this turn were omitted to fit the ${capabilities.maxImagesPerRequest}-image gateway limit (${droppedLabels.join(', ')}); inspect them one per turn if still needed.`
            : '';

        for (const vis of sliced) {
          history.push({
            role: 'user',
            meta: {
              syntheticVision: true,
              visionLabel: vis.label,
              visionRelPath: vis.relPath,
            },
            content: [
              {
                type: 'text',
                text: `[Visual input attached: ${vis.label}] Inspect this image carefully against your current task requirements and note key textual, formula, or figure observations immediately (older images will rotate out when new images are loaded).${dropNotice}`,
              },
              {
                type: 'image_url',
                image_url: {
                  url: vis.base64DataUrl,
                  detail: vis.detail ?? 'high',
                },
              },
            ],
          });
          config.onEvent?.({
            agentId: config.agentId,
            type: 'vision_attached',
            message: `Attached visual input: ${vis.label}`,
            data: { label: vis.label, relPath: vis.relPath },
          });
        }
      }

      if (
        maxSteps >= 10 &&
        (stepsUsed === Math.floor(maxSteps * 0.7) || stepsUsed === maxSteps - 3)
      ) {
        history.push({
          role: 'user',
          content: `[Step Budget Notice: step ${stepsUsed}/${maxSteps}. Do NOT repeatedly re-inspect pages/images you already observed. Persist your target deliverable via write_workspace_file / tool calls now and run validation before the step limit ends.]`,
        });
      }

      continue;
    }

    // 无 tool_calls 返回
    const trimmedContent = completion.content.trim();
    if (completion.finishReason === 'length' && consecutiveLengthRetries < 2) {
      consecutiveLengthRetries++;
      history.push({
        role: 'assistant',
        content: completion.content || null,
      });
      history.push({
        role: 'user',
        content:
          'Your previous reply hit max_tokens before finishing. Continue concisely, or invoke tools (write_workspace_file / validate_mdx / etc.) directly without printing large files in chat.',
      });

      continue;
    }

    if (!trimmedContent && consecutiveEmptyStopRetries < 1) {
      consecutiveEmptyStopRetries++;
      history.push({
        role: 'assistant',
        content: completion.content || '',
      });
      history.push({
        role: 'user',
        content:
          'You returned an empty message without tool calls. If the task is unfinished, call the next tool; if finished, output your concise structured final summary.',
      });

      continue;
    }

    history.push({
      role: 'assistant',
      content: completion.content,
    });

    config.onEvent?.({
      agentId: config.agentId,
      type: 'assistant_message',
      message: trimmedContent.slice(0, 400),
      data: { fullLength: trimmedContent.length },
    });

    return {
      finalText: completion.content,
      stepsUsed,
      toolCallsCount,
      aborted: false,
      finishReason: lastFinishReason,
      durationMs: Date.now() - startedAt,
      totalUsage,
      lastContextStats,
    };
  }

  return {
    finalText: `Agent reached maxSteps (${maxSteps}) without explicit termination.`,
    stepsUsed,
    toolCallsCount,
    aborted: false,
    finishReason: 'max_steps',
    durationMs: Date.now() - startedAt,
    totalUsage,
    lastContextStats,
  };
}
