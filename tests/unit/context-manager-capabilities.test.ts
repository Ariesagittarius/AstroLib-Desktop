import { describe, it, expect } from 'vitest';
import {
  AgentContextManager,
  resolveProviderCapabilities,
  type ChatMessage,
} from '../../src/ai/agent/context-manager.ts';

describe('AgentContextManager 模型能力边界与多模态/无视觉降级测试', () => {
  it('1. DeepSeek 模型默认识别为无图像输入能力 (maxImagesPerRequest = 0)', () => {
    const dsChat = resolveProviderCapabilities('deepseek', 'deepseek-chat');
    expect(dsChat.supportsVision).toBe(false);
    expect(dsChat.maxImagesPerRequest).toBe(0);
    expect(dsChat.defaultMaxOutputTokens).toBe(8_192);

    const dsReasoner = resolveProviderCapabilities('deepseek', 'deepseek-reasoner');
    expect(dsReasoner.supportsVision).toBe(false);
    expect(dsReasoner.maxImagesPerRequest).toBe(0);
    expect(dsReasoner.isReasoningModel).toBe(true);
    expect(dsReasoner.defaultMaxOutputTokens).toBe(16_384);
  });

  it('2. Youlabber 网关严格锁死单图窗口与高输出上限', () => {
    const cap = resolveProviderCapabilities('baigong', 'ybg-youlaber-ds4f');
    expect(cap.supportsVision).toBe(true);
    expect(cap.maxImagesPerRequest).toBe(1);
    expect(cap.maxContextTokens).toBe(262_144);
    expect(cap.defaultMaxOutputTokens).toBeGreaterThanOrEqual(16_384);
  });

  it('3. 支持自定义模型能力覆写 (overrides) 并安全缩放安全输入预算', () => {
    const custom = resolveProviderCapabilities('custom', 'my-model', {
      supportsVision: true,
      maxImagesPerRequest: 3,
      maxContextTokens: 64_000,
      defaultMaxOutputTokens: 12_000,
    });
    expect(custom.supportsVision).toBe(true);
    expect(custom.maxImagesPerRequest).toBe(3);
    expect(custom.maxContextTokens).toBe(64_000);
    expect(custom.safeInputBudget).toBe(Math.floor(64_000 * 0.72));
    expect(custom.defaultMaxOutputTokens).toBe(12_000);

    const disabledVision = resolveProviderCapabilities('openai', 'gpt-4o', {
      supportsVision: false,
      maxImagesPerRequest: 4,
    });
    expect(disabledVision.supportsVision).toBe(false);
    expect(disabledVision.maxImagesPerRequest).toBe(0);
  });

  it('4. 无视觉模型发送含图上下文时自动剥离 image_url 并降级为纯文本提示', () => {
    const dsCap = resolveProviderCapabilities('deepseek', 'deepseek-reasoner');
    const manager = new AgentContextManager({ capabilities: dsCap });

    const history: ChatMessage[] = [
      { role: 'system', content: '你是学术助手' },
      {
        role: 'user',
        content: [
          { type: 'text', text: '请识别图中公式' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
        ],
        meta: { visionLabel: 'formula.png' },
      },
    ];

    const prepared = manager.prepareContext(history);
    expect(prepared.stats.imageCount).toBe(0);
    expect(prepared.stats.evictedImagesCount).toBe(1);
    expect(typeof prepared.wireMessages[1].content).toBe('string');
    expect(String(prepared.wireMessages[1].content)).toContain('does not support image_url inputs');
    expect(String(prepared.wireMessages[1].content)).toContain('formula.png');
  });

  it('5. 单图网关在多轮传图时严格只保留最后 1 张视觉槽', () => {
    const ybgCap = resolveProviderCapabilities('baigong', 'ybg-youlaber-ds4f');
    const manager = new AgentContextManager({ capabilities: ybgCap });

    const history: ChatMessage[] = [
      { role: 'system', content: '系统提示词' },
      {
        role: 'user',
        content: [
          { type: 'text', text: '第一页扫描' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,PAGE1' } },
        ],
        meta: { visionLabel: 'page_1.png' },
      },
      { role: 'assistant', content: '已观察第一页。' },
      {
        role: 'user',
        content: [
          { type: 'text', text: '第二页扫描' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,PAGE2' } },
        ],
        meta: { visionLabel: 'page_2.png' },
      },
    ];

    const prepared = manager.prepareContext(history);
    expect(prepared.stats.imageCount).toBe(1);
    expect(prepared.stats.evictedImagesCount).toBe(1);
    expect(typeof prepared.wireMessages[1].content).toBe('string');
    expect(Array.isArray(prepared.wireMessages[3].content)).toBe(true);
  });
});
