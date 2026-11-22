/**
 * src/ai/agent/context-manager.ts
 * ============================================================================
 * AstroLib 通用 Agent 上下文管理器、单图滚动视觉槽与 Turn-Group 原子压缩引擎
 * ============================================================================
 * 核心职责：
 * 1. 按模型/网关声明能力矩阵（maxContextTokens、safeInputBudget、maxImagesPerRequest、
 *    defaultMaxOutputTokens、strictSystemPosition）；
 * 2. 严格执行 Rolling Vision Slot（默认 Youlabber 网关全对话最多 1 张图）：
 *    自动保留最新 N 张 image_url，将历史旧图替换为轻量文本面包屑并释放 Base64 内存；
 * 3. Token 预算守卫：采用 gpt-tokenizer 精确估算文本 + 工具 JSON + 视觉槽开销；
 *    超限时按「陈旧工具结果截断 → 原子 Turn-Group 滑动摘要压缩 → 紧急裁切」逐级退避，
 *    绝不破坏 assistant(tool_calls) <-> tool 配对关系，且不向对话中部注入 role:'system'。
 * ============================================================================
 */

import { encode } from 'gpt-tokenizer';

export interface ChatTextPart {
  type: 'text';
  text: string;
}

export interface ChatImageUrlPart {
  type: 'image_url';
  image_url: {
    url: string;
    detail?: 'low' | 'high' | 'auto';
  };
}

export type ChatContentPart = ChatTextPart | ChatImageUrlPart;

export interface ChatToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatMessageMeta {
  visionLabel?: string;
  visionRelPath?: string;
  syntheticVision?: boolean;
  evictedImage?: boolean;
  pinned?: boolean;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ChatContentPart[] | null;
  name?: string;
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
  /** 模型思维链（仅记录或追踪，默认不强制回传以遵循网关标准且省上下文） */
  reasoning_content?: string;
  /** 运行时内部元数据，序列化发送前自动剥离 */
  meta?: ChatMessageMeta;
}

export interface ProviderCapabilities {
  providerId: string;
  modelId: string;
  maxContextTokens: number;
  safeInputBudget: number;
  supportsVision: boolean;
  maxImagesPerRequest: number;
  defaultMaxOutputTokens: number;
  supportsStreaming: boolean;
  supportsReasoningField: boolean;
  isReasoningModel: boolean;
  strictSystemPosition: boolean;
}

export interface ProviderCapabilityOverrides {
  supportsVision?: boolean;
  maxImagesPerRequest?: number;
  maxContextTokens?: number;
  defaultMaxOutputTokens?: number;
}

export interface ContextPreparationStats {
  estimatedTokens: number;
  safeInputBudget: number;
  maxContextTokens: number;
  imageCount: number;
  maxImagesPerRequest: number;
  evictedImagesCount: number;
  truncatedToolsCount: number;
  droppedGroupsCount: number;
  compacted: boolean;
}

export interface ContextManagerOptions {
  capabilities: ProviderCapabilities;
  keepRecentTailGroups?: number;
  agedToolMaxChars?: number;
  tokensPerImageEstimate?: number;
}

/**
 * 解析各模型网关的能力边界。
 * 针对实测后的 Youlabber (baigong / ybg-youlaber-ds4f) 给出严格契约：
 * - 262,144 max_model_len
 * - maxImagesPerRequest = 1 (跨整个 messages[] 生效)
 * - max_tokens >= 16384 以防 reasoning_tokens 耗尽最终输出
 */
function applyCapabilityOverrides(
  base: ProviderCapabilities,
  overrides?: ProviderCapabilityOverrides
): ProviderCapabilities {
  if (!overrides) return base;
  const next = { ...base };

  if (typeof overrides.maxContextTokens === 'number' && overrides.maxContextTokens >= 4096) {
    next.maxContextTokens = Math.floor(overrides.maxContextTokens);
    next.safeInputBudget = Math.max(2048, Math.floor(next.maxContextTokens * 0.72));
  }
  if (typeof overrides.defaultMaxOutputTokens === 'number' && overrides.defaultMaxOutputTokens >= 1024) {
    next.defaultMaxOutputTokens = Math.floor(overrides.defaultMaxOutputTokens);
  }
  if (overrides.supportsVision === false) {
    next.supportsVision = false;
    next.maxImagesPerRequest = 0;
  } else if (typeof overrides.maxImagesPerRequest === 'number' && Number.isFinite(overrides.maxImagesPerRequest)) {
    next.maxImagesPerRequest = Math.max(0, Math.floor(overrides.maxImagesPerRequest));
    next.supportsVision = overrides.supportsVision ?? next.maxImagesPerRequest > 0;
  } else if (overrides.supportsVision === true) {
    next.supportsVision = true;
    next.maxImagesPerRequest = Math.max(1, next.maxImagesPerRequest || 1);
  }
  return next;
}

/**
 * 解析各模型网关的能力边界。
 * 针对实测后的 Youlabber (baigong / ybg-youlaber-ds4f) 给出严格契约：
 * - 262,144 max_model_len
 * - maxImagesPerRequest = 1 (跨整个 messages[] 生效)
 * - max_tokens >= 16384 以防 reasoning_tokens 耗尽最终输出
 * 针对 DeepSeek 等纯文本接口默认禁用 image_url（maxImagesPerRequest = 0）。
 */
export function resolveProviderCapabilities(
  providerId: string,
  modelId = '',
  overrides?: ProviderCapabilityOverrides
): ProviderCapabilities {
  const pid = (providerId || '').trim().toLowerCase();
  const mid = (modelId || '').trim().toLowerCase();

  if (
    pid === 'baigong' ||
    pid === 'youlabber' ||
    mid.startsWith('ybg-') ||
    mid.includes('youlaber')
  ) {
    return applyCapabilityOverrides(
      {
        providerId: providerId || 'baigong',
        modelId: modelId || 'ybg-youlaber-ds4f',
        maxContextTokens: 262_144,
        safeInputBudget: 120_000,
        supportsVision: true,
        maxImagesPerRequest: 1,
        defaultMaxOutputTokens: 16_384,
        supportsStreaming: true,
        supportsReasoningField: true,
        isReasoningModel: true,
        strictSystemPosition: true,
      },
      overrides
    );
  }

  if (pid === 'deepseek' || mid.startsWith('deepseek')) {
    const isReasoner = mid.includes('reasoner') || mid.includes('r1');
    const isVision = mid.includes('-vl') || mid.includes('vision');
    return applyCapabilityOverrides(
      {
        providerId: providerId || 'deepseek',
        modelId: modelId || 'deepseek-chat',
        maxContextTokens: 128_000,
        safeInputBudget: 92_000,
        supportsVision: isVision,
        maxImagesPerRequest: isVision ? 4 : 0,
        defaultMaxOutputTokens: isReasoner ? 16_384 : 8_192,
        supportsStreaming: true,
        supportsReasoningField: isReasoner,
        isReasoningModel: isReasoner,
        strictSystemPosition: true,
      },
      overrides
    );
  }

  if (pid === 'gemini' || mid.includes('gemini')) {
    return applyCapabilityOverrides(
      {
        providerId: providerId || 'gemini',
        modelId: modelId || 'gemini-2.5-flash',
        maxContextTokens: 1_000_000,
        safeInputBudget: 200_000,
        supportsVision: true,
        maxImagesPerRequest: 8,
        defaultMaxOutputTokens: 16_384,
        supportsStreaming: true,
        supportsReasoningField: false,
        isReasoningModel:
          mid.includes('2.5') || mid.includes('3') || mid.includes('thinking'),
        strictSystemPosition: true,
      },
      overrides
    );
  }

  if (pid === 'openai' || mid.startsWith('gpt-') || /^o[134]/.test(mid)) {
    const isLarge = mid.includes('gpt-4.1') || mid.includes('gpt-5');
    return applyCapabilityOverrides(
      {
        providerId: providerId || 'openai',
        modelId: modelId || 'gpt-4o',
        maxContextTokens: isLarge ? 400_000 : 128_000,
        safeInputBudget: isLarge ? 160_000 : 92_000,
        supportsVision: true,
        maxImagesPerRequest: 8,
        defaultMaxOutputTokens: 16_384,
        supportsStreaming: true,
        supportsReasoningField: false,
        isReasoningModel: /^o[134]/.test(mid) || mid.includes('gpt-5'),
        strictSystemPosition: false,
      },
      overrides
    );
  }

  if (pid === 'antigravity-cli') {
    return applyCapabilityOverrides(
      {
        providerId: 'antigravity-cli',
        modelId: modelId || 'antigravity-cli',
        maxContextTokens: 1_000_000,
        safeInputBudget: 200_000,
        supportsVision: true,
        maxImagesPerRequest: 8,
        defaultMaxOutputTokens: 16_384,
        supportsStreaming: true,
        supportsReasoningField: false,
        isReasoningModel: false,
        strictSystemPosition: false,
      },
      overrides
    );
  }

  const isReasoning =
    mid.includes('r1') ||
    mid.includes('reasoner') ||
    mid.includes('thinking') ||
    mid.includes('qvq');
  const likelyTextOnly =
    mid.includes('coder') ||
    (mid.includes('qwen') && !mid.includes('vl') && !mid.includes('omni') && !mid.includes('qvq'));
  const maxImgs = likelyTextOnly ? 0 : 1;

  return applyCapabilityOverrides(
    {
      providerId: providerId || 'custom',
      modelId: modelId || 'default',
      maxContextTokens: 131_072,
      safeInputBudget: 80_000,
      supportsVision: maxImgs > 0,
      maxImagesPerRequest: maxImgs,
      defaultMaxOutputTokens: isReasoning ? 16_384 : 8_192,
      supportsStreaming: true,
      supportsReasoningField: isReasoning,
      isReasoningModel: isReasoning,
      strictSystemPosition: true,
    },
    overrides
  );
}

export function safeCountTokens(text: string): number {
  if (!text) return 0;
  try {
    return encode(text).length;
  } catch {
    return Math.ceil(text.length / 2.5);
  }
}

function cloneMessage(msg: ChatMessage): ChatMessage {
  return {
    role: msg.role,
    content: Array.isArray(msg.content)
      ? msg.content.map((p) =>
          p.type === 'image_url'
            ? { type: 'image_url', image_url: { ...p.image_url } }
            : { type: 'text', text: p.text }
        )
      : msg.content,
    ...(msg.name ? { name: msg.name } : {}),
    ...(msg.tool_calls
      ? {
          tool_calls: msg.tool_calls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: { ...tc.function },
          })),
        }
      : {}),
    ...(msg.tool_call_id ? { tool_call_id: msg.tool_call_id } : {}),
    ...(msg.reasoning_content ? { reasoning_content: msg.reasoning_content } : {}),
    ...(msg.meta ? { meta: { ...msg.meta } } : {}),
  };
}

function isSyntheticVisionMessage(msg: ChatMessage): boolean {
  if (msg.role !== 'user') return false;
  if (msg.meta?.syntheticVision) return true;
  if (typeof msg.content === 'string') {
    return msg.content.startsWith('[Visual input attached:');
  }
  if (Array.isArray(msg.content)) {
    return msg.content.some(
      (p) => p.type === 'text' && p.text.startsWith('[Visual input attached:')
    );
  }
  return false;
}

function countImagesInMessage(msg: ChatMessage): number {
  if (!Array.isArray(msg.content)) return 0;
  let n = 0;
  for (const part of msg.content) {
    if (part.type === 'image_url') n++;
  }
  return n;
}

function normalizePartsAfterEviction(
  parts: ChatContentPart[]
): string | ChatContentPart[] {
  const hasImage = parts.some((p) => p.type === 'image_url');
  if (hasImage) return parts;
  return parts
    .map((p) => (p.type === 'text' ? p.text : ''))
    .filter(Boolean)
    .join('\n');
}

function truncateToolText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const headChars = Math.max(400, Math.floor(maxChars * 0.65));
  const tailChars = Math.max(200, maxChars - headChars - 80);
  const omitted = text.length - headChars - tailChars;
  if (omitted <= 0) return text;
  return (
    text.slice(0, headChars) +
    `\n... [older tool output truncated: omitted ${omitted} chars to save context budget] ...\n` +
    text.slice(text.length - tailChars)
  );
}

const COMPACTION_MARKER = '\n\n[CONTEXT COMPACTION SUMMARY]\n';

export class AgentContextManager {
  public readonly capabilities: ProviderCapabilities;
  private readonly keepRecentTailGroups: number;
  private readonly agedToolMaxChars: number;
  private readonly tokensPerImageEstimate: number;

  constructor(options: ContextManagerOptions) {
    this.capabilities = options.capabilities;
    this.keepRecentTailGroups = options.keepRecentTailGroups ?? 4;
    this.agedToolMaxChars = options.agedToolMaxChars ?? 3000;
    this.tokensPerImageEstimate = options.tokensPerImageEstimate ?? 1600;
  }

  public estimateMessageTokens(msg: ChatMessage): number {
    let tokens = 6; // role + wrapper overhead
    if (typeof msg.content === 'string') {
      tokens += safeCountTokens(msg.content);
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === 'text') {
          tokens += safeCountTokens(part.text);
        } else if (part.type === 'image_url') {
          // Base64 字符串本身不按纯字符 tokenizer 计，而是按视觉分辨率固定预算估算
          tokens += this.tokensPerImageEstimate;
        }
      }
    }
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      for (const tc of msg.tool_calls) {
        tokens += safeCountTokens(tc.function.name) + safeCountTokens(tc.function.arguments) + 8;
      }
    }
    if (msg.tool_call_id) {
      tokens += 6;
    }
    return tokens;
  }

  public estimateMessagesTokens(messages: ChatMessage[]): number {
    let total = 0;
    for (const msg of messages) {
      total += this.estimateMessageTokens(msg);
    }
    return total;
  }

  public countTotalImages(messages: ChatMessage[]): number {
    let total = 0;
    for (const msg of messages) {
      total += countImagesInMessage(msg);
    }
    return total;
  }

  /**
   * 滚动视觉槽 (Rolling Vision Slot)：
   * 从尾到头扫描整个消息队列，仅保留最新 `maxImages` 张 `image_url`。
   * 较旧图片原地替换为简洁文本提示，彻底规避单图网关 HTTP 400 并释放内存。
   * 同时强制剥离任何误放在 role:'tool' 中的 image_url（OpenAI/vLLM 协议禁止 tool 带图）。
   */
  public enforceVisionSlot(
    messages: ChatMessage[],
    maxImages = this.capabilities.maxImagesPerRequest
  ): { messages: ChatMessage[]; evictedCount: number } {
    const next = messages.map(cloneMessage);
    let keptImages = 0;
    let evictedCount = 0;

    for (let i = next.length - 1; i >= 0; i--) {
      const msg = next[i];
      if (!Array.isArray(msg.content)) continue;

      const updatedParts: ChatContentPart[] = [];
      let changed = false;

      // tool 消息禁止保留图片，一律转为占位文本
      const disallowInThisRole = msg.role === 'tool' || msg.role === 'assistant';

      for (let pIdx = msg.content.length - 1; pIdx >= 0; pIdx--) {
        const part = msg.content[pIdx];
        if (part.type !== 'image_url') {
          updatedParts.unshift(part);
          continue;
        }

        if (!disallowInThisRole && keptImages < maxImages) {
          keptImages++;
          updatedParts.unshift(part);
        } else {
          evictedCount++;
          changed = true;
          const label =
            msg.meta?.visionLabel || msg.meta?.visionRelPath || 'previous page/image';
          const evictionText =
            maxImages <= 0
              ? `[Image omitted (${label}): active model "${this.capabilities.modelId}" does not support image_url inputs; rely on text/structural telemetry or ask the user to switch to a vision-capable model.]`
              : `[Earlier visual slot evicted (${label}); re-inspect with render_pdf_page/inspect_image only if specific details were missed.]`;
          updatedParts.unshift({
            type: 'text',
            text: evictionText,
          });
        }
      }

      if (changed) {
        msg.content = normalizePartsAfterEviction(updatedParts);
        msg.meta = { ...(msg.meta ?? {}), evictedImage: true };
      }
    }

    return { messages: next, evictedCount };
  }

  /**
   * 将非前置 system 消息切分为原子 Turn-Group：
   * `[assistant(tool_calls), tool..., optional synthetic vision user msg]` 永不拆散，
   * 确保压缩后不会出现孤立 tool_call_id 导致 400 Bad Request。
   */
  public splitIntoAtomicGroups(messages: ChatMessage[]): {
    leadingSystems: ChatMessage[];
    initialUserGoal: ChatMessage | null;
    groups: ChatMessage[][];
  } {
    const leadingSystems: ChatMessage[] = [];
    let cursor = 0;

    while (cursor < messages.length && messages[cursor].role === 'system') {
      leadingSystems.push(messages[cursor]);
      cursor++;
    }

    let initialUserGoal: ChatMessage | null = null;
    if (cursor < messages.length && messages[cursor].role === 'user') {
      initialUserGoal = messages[cursor];
      cursor++;
    }

    const groups: ChatMessage[][] = [];
    while (cursor < messages.length) {
      const msg = messages[cursor];
      if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
        const group: ChatMessage[] = [msg];
        cursor++;
        while (cursor < messages.length && messages[cursor].role === 'tool') {
          group.push(messages[cursor]);
          cursor++;
        }
        while (cursor < messages.length && isSyntheticVisionMessage(messages[cursor])) {
          group.push(messages[cursor]);
          cursor++;
        }
        groups.push(group);
        continue;
      }

      // 防御性清理：若意外存在孤立 tool 消息，丢弃或单独归组（后续配对修复会处理）
      groups.push([msg]);
      cursor++;
    }

    return { leadingSystems, initialUserGoal, groups };
  }

  /**
   * 构造被折叠轮次的紧凑摘要文本（用于合并进首条 system 消息）
   */
  private summarizeDroppedGroups(droppedGroups: ChatMessage[][]): string {
    const actions: string[] = [];
    for (const group of droppedGroups) {
      for (const msg of group) {
        if (msg.role === 'assistant' && msg.tool_calls) {
          const names = msg.tool_calls.map((tc) => tc.function.name);
          actions.push(`called(${names.join(', ')})`);
        } else if (msg.role === 'user' && typeof msg.content === 'string') {
          const preview = msg.content.replace(/\s+/g, ' ').slice(0, 90);
          actions.push(`user("${preview}")`);
        } else if (msg.role === 'assistant' && typeof msg.content === 'string' && msg.content.trim()) {
          const preview = msg.content.replace(/\s+/g, ' ').slice(0, 90);
          actions.push(`note("${preview}")`);
        }
      }
    }
    const trimmedActions =
      actions.length > 18
        ? [...actions.slice(0, 6), `...(${actions.length - 14} omitted steps)...`, ...actions.slice(-8)]
        : actions;
    return `Omitted ${droppedGroups.length} earlier turn groups to fit context budget.\nTimeline: ${trimmedActions.join(' -> ')}`;
  }

  /**
   * 执行全链路上下文整理（既返回可继续保存在 session 里的干净消息，也返回可直接 POST 给 API 的 wireMessages）。
   */
  public prepareContext(rawMessages: ChatMessage[]): {
    compactedHistory: ChatMessage[];
    wireMessages: ChatMessage[];
    stats: ContextPreparationStats;
  } {
    // 1. 强制 Rolling Vision Slot（同时消除已滑出的 Base64 膨胀）
    const visionPass = this.enforceVisionSlot(
      rawMessages,
      this.capabilities.maxImagesPerRequest
    );
    let working = visionPass.messages;
    let truncatedToolsCount = 0;
    let droppedGroupsCount = 0;
    let compacted = false;

    const budget = this.capabilities.safeInputBudget;
    let currentTokens = this.estimateMessagesTokens(working);

    if (currentTokens > budget) {
      compacted = true;
      const { leadingSystems, initialUserGoal, groups } = this.splitIntoAtomicGroups(working);

      // Phase A: 对非最近 N 个 Turn-Group 中的超长 tool 返回进行温和截断
      const tailBoundary = Math.max(0, groups.length - this.keepRecentTailGroups);
      for (let gIdx = 0; gIdx < tailBoundary; gIdx++) {
        for (const msg of groups[gIdx]) {
          if (
            msg.role === 'tool' &&
            typeof msg.content === 'string' &&
            msg.content.length > this.agedToolMaxChars
          ) {
            msg.content = truncateToolText(msg.content, this.agedToolMaxChars);
            truncatedToolsCount++;
          }
        }
      }

      const rebuild = (
        sysList: ChatMessage[],
        goal: ChatMessage | null,
        keptGroups: ChatMessage[][]
      ): ChatMessage[] => {
        const res: ChatMessage[] = [...sysList.map(cloneMessage)];
        if (goal) res.push(cloneMessage(goal));
        for (const g of keptGroups) {
          for (const m of g) res.push(cloneMessage(m));
        }
        return res;
      };

      working = rebuild(leadingSystems, initialUserGoal, groups);
      currentTokens = this.estimateMessagesTokens(working);

      // Phase B: 若仍超预算，逐组丢弃最老的非 tail Turn-Group，并合并摘要到 leading system
      if (currentTokens > budget && groups.length > 2) {
        const droppedGroups: ChatMessage[][] = [];
        const keptGroups = [...groups];

        while (
          keptGroups.length > 2 &&
          this.estimateMessagesTokens(rebuild(leadingSystems, initialUserGoal, keptGroups)) >
            budget
        ) {
          const dropped = keptGroups.shift();
          if (dropped) {
            droppedGroups.push(dropped);
            droppedGroupsCount++;
          }
        }

        if (droppedGroups.length > 0) {
          const summaryText = this.summarizeDroppedGroups(droppedGroups);
          const updatedSystems = leadingSystems.map(cloneMessage);
          if (updatedSystems.length > 0 && typeof updatedSystems[0].content === 'string') {
            const baseContent = updatedSystems[0].content.split(COMPACTION_MARKER)[0];
            updatedSystems[0].content = `${baseContent}${COMPACTION_MARKER}${summaryText}`;
          } else {
            updatedSystems.unshift({
              role: 'system',
              content: `[CONTEXT COMPACTION SUMMARY]\n${summaryText}`,
            });
          }
          working = rebuild(updatedSystems, initialUserGoal, keptGroups);
          currentTokens = this.estimateMessagesTokens(working);
        }
      }

      // Phase C: 极端情况下即使剩最近 2 组仍超限，对其中的 tool 输出进行硬截断（保最后一组最后条除外）
      if (currentTokens > budget) {
        for (let i = 0; i < working.length - 2; i++) {
          const msg = working[i];
          if (msg.role === 'tool' && typeof msg.content === 'string' && msg.content.length > 1200) {
            msg.content = truncateToolText(msg.content, 1200);
            truncatedToolsCount++;
          }
        }
      }
    }

    // 最终完整性修复与 Wire 剥离：
    // 1. 再次确保图片数量严格 <= maxImagesPerRequest（防止 initialUserGoal 带旧图）
    const finalVision = this.enforceVisionSlot(
      working,
      this.capabilities.maxImagesPerRequest
    );
    const cleanHistory = finalVision.messages;

    // 2. 修复潜在的孤立 role:'tool' 并剥离内部 meta/reasoning_content 生成 wireMessages
    const wireMessages: ChatMessage[] = [];
    const activeToolCallIds = new Set<string>();

    for (const msg of cleanHistory) {
      if (msg.role === 'assistant') {
        activeToolCallIds.clear();
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          for (const tc of msg.tool_calls) activeToolCallIds.add(tc.id);
        }
        wireMessages.push({
          role: 'assistant',
          content: msg.content ?? null,
          ...(msg.tool_calls && msg.tool_calls.length > 0
            ? {
                tool_calls: msg.tool_calls.map((tc) => ({
                  id: tc.id,
                  type: 'function' as const,
                  function: { ...tc.function },
                })),
              }
            : {}),
        });
        continue;
      }

      if (msg.role === 'tool') {
        if (msg.tool_call_id && !activeToolCallIds.has(msg.tool_call_id)) {
          // 跳过已失去配对 assistant(tool_calls) 的孤立 tool 消息，防止网关报 400
          continue;
        }
        wireMessages.push({
          role: 'tool',
          tool_call_id: msg.tool_call_id,
          content:
            typeof msg.content === 'string'
              ? msg.content
              : JSON.stringify(msg.content ?? ''),
        });
        continue;
      }

      if (msg.role === 'system' || msg.role === 'user') {
        // user/system 开始新话轮时清空未配对 tool_call_id 状态
        if (msg.role === 'user' && !isSyntheticVisionMessage(msg)) {
          activeToolCallIds.clear();
        }
        wireMessages.push({
          role: msg.role,
          content: Array.isArray(msg.content)
            ? msg.content.map((p) =>
                p.type === 'image_url'
                  ? { type: 'image_url', image_url: { ...p.image_url } }
                  : { type: 'text', text: p.text }
              )
            : (msg.content ?? ''),
        });
      }
    }

    const totalEvicted = visionPass.evictedCount + finalVision.evictedCount;
    const stats: ContextPreparationStats = {
      estimatedTokens: this.estimateMessagesTokens(wireMessages),
      safeInputBudget: budget,
      maxContextTokens: this.capabilities.maxContextTokens,
      imageCount: this.countTotalImages(wireMessages),
      maxImagesPerRequest: this.capabilities.maxImagesPerRequest,
      evictedImagesCount: totalEvicted,
      truncatedToolsCount,
      droppedGroupsCount,
      compacted,
    };

    return {
      compactedHistory: cleanHistory,
      wireMessages,
      stats,
    };
  }
}
