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

  reasoning_content?: string;

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
    let tokens = 6;
    if (typeof msg.content === 'string') {
      tokens += safeCountTokens(msg.content);
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === 'text') {
          tokens += safeCountTokens(part.text);
        } else if (part.type === 'image_url') {

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

      groups.push([msg]);
      cursor++;
    }

    return { leadingSystems, initialUserGoal, groups };
  }

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

  public prepareContext(rawMessages: ChatMessage[]): {
    compactedHistory: ChatMessage[];
    wireMessages: ChatMessage[];
    stats: ContextPreparationStats;
  } {

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

    const finalVision = this.enforceVisionSlot(
      working,
      this.capabilities.maxImagesPerRequest
    );
    const cleanHistory = finalVision.messages;

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
