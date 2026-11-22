import { describe, expect, it } from 'vitest';
import {
  AgentContextManager,
  resolveProviderCapabilities,
  type ChatMessage,
} from '../../src/ai/agent/context-manager.ts';

function makeDummyBase64(tag: string): string {
  return `data:image/jpeg;base64,${Buffer.from(tag).toString('base64')}`;
}

function countAllImageParts(messages: ChatMessage[]): number {
  let count = 0;
  for (const m of messages) {
    if (Array.isArray(m.content)) {
      for (const p of m.content) {
        if (p.type === 'image_url') count++;
      }
    }
  }
  return count;
}

describe('PDF2ABP AgentContextManager', () => {
  it('enforces Youlabber maxImagesPerRequest=1 Rolling Vision Slot across 5+ turns and strips tool images', () => {
    const caps = resolveProviderCapabilities('baigong', 'ybg-youlaber-ds4f');
    expect(caps.maxImagesPerRequest).toBe(1);
    expect(caps.maxContextTokens).toBe(262_144);
    expect(caps.defaultMaxOutputTokens).toBeGreaterThanOrEqual(16384);

    const mgr = new AgentContextManager({ capabilities: caps });

    const history: ChatMessage[] = [
      { role: 'system', content: 'You are an academic publisher.' },
      { role: 'user', content: 'Convert test.pdf to ABP.' },
    ];

    for (let turn = 1; turn <= 5; turn++) {
      history.push({
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: `call_${turn}`,
            type: 'function',
            function: { name: 'inspect_pdf_page', arguments: JSON.stringify({ pages: [turn] }) },
          },
        ],
      });
      // 模拟意外传入 tool 的图片，测试必须将其剥离
      history.push({
        role: 'tool',
        tool_call_id: `call_${turn}`,
        content:
          turn === 2
            ? ([
                { type: 'text', text: '{"page":2}' },
                { type: 'image_url', image_url: { url: makeDummyBase64('bad-tool-img') } },
              ] as any)
            : JSON.stringify({ page: turn }),
      });
      history.push({
        role: 'user',
        meta: {
          syntheticVision: true,
          visionLabel: `PDF Page ${turn}`,
          visionRelPath: `pages/page_${turn}.jpg`,
        },
        content: [
          { type: 'text', text: `[Visual input attached: PDF Page ${turn}]` },
          { type: 'image_url', image_url: { url: makeDummyBase64(`page-${turn}`), detail: 'high' } },
        ],
      });
    }

    const { wireMessages, stats } = mgr.prepareContext(history);

    expect(stats.imageCount).toBe(1);
    expect(countAllImageParts(wireMessages)).toBe(1);
    expect(stats.evictedImagesCount).toBe(5); // 4 old synthetic user images + 1 invalid tool image

    // 确认保留的是最后一张第 5 页图片
    const lastVisionMsg = wireMessages.find(
      (m) => Array.isArray(m.content) && m.content.some((p) => p.type === 'image_url')
    )!;
    const imgPart = (lastVisionMsg.content as any[]).find((p) => p.type === 'image_url');
    expect(imgPart.image_url.url).toBe(makeDummyBase64('page-5'));

    // 确认旧的 syntheticVision 消息已被折叠为字符串面包屑
    const page1User = wireMessages.find(
      (m) => m.role === 'user' && typeof m.content === 'string' && m.content.includes('PDF Page 1')
    );
    expect(page1User).toBeDefined();
    expect(typeof page1User!.content).toBe('string');
    expect(page1User!.content).toContain('Earlier visual slot evicted');

    // 确认 role:'tool' 无任何 image_url 残留
    for (const m of wireMessages) {
      if (m.role === 'tool') {
        expect(typeof m.content).toBe('string');
      }
    }
  });

  it('compacts over-budget turns atomically without orphan tool messages or mid-conversation system roles', () => {
    const baseCaps = resolveProviderCapabilities('baigong', 'ybg-youlaber-ds4f');
    const tightMgr = new AgentContextManager({
      capabilities: {
        ...baseCaps,
        safeInputBudget: 750,
      },
      keepRecentTailGroups: 2,
      agedToolMaxChars: 240,
    });

    const history: ChatMessage[] = [
      { role: 'system', content: 'System Instructions Base.' },
      { role: 'user', content: 'Original Goal: convert /books/algebra.pdf carefully.' },
    ];

    // 构造 8 组较长的工具调用历史（包含单轮双工具调用 + 合成视觉回复）
    for (let i = 1; i <= 8; i++) {
      history.push({
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: `tc_${i}_a`,
            type: 'function',
            function: { name: 'read_workspace_file', arguments: `{"relPath":"chunks/c${i}.md"}` },
          },
          {
            id: `tc_${i}_b`,
            type: 'function',
            function: { name: 'inspect_pdf_page', arguments: `{"pages":[${i}]}` },
          },
        ],
      });
      history.push({
        role: 'tool',
        tool_call_id: `tc_${i}_a`,
        content: `Chunk ${i} draft content: ` + `Theorem ${i}.1 equation block $x^2+y^2=z^2$. `.repeat(20),
      });
      history.push({
        role: 'tool',
        tool_call_id: `tc_${i}_b`,
        content: JSON.stringify({ page: i, ok: true }),
      });
      history.push({
        role: 'user',
        meta: { syntheticVision: true, visionLabel: `Page ${i}` },
        content: [
          { type: 'text', text: `[Visual input attached: Page ${i}]` },
          { type: 'image_url', image_url: { url: makeDummyBase64(`p-${i}`) } },
        ],
      });
    }

    const { wireMessages, stats } = tightMgr.prepareContext(history);

    expect(stats.compacted).toBe(true);
    expect(stats.droppedGroupsCount).toBeGreaterThan(0);
    expect(stats.imageCount).toBe(1);

    // 1. 仅 index 0 为 role:'system'，中部禁止出现 role:'system'
    const systemIndices = wireMessages
      .map((m, idx) => (m.role === 'system' ? idx : -1))
      .filter((idx) => idx !== -1);
    expect(systemIndices).toEqual([0]);
    expect(String(wireMessages[0].content)).toContain('[CONTEXT COMPACTION SUMMARY]');

    // 2. 初始用户任务 Goal 必须保留在 index 1
    expect(wireMessages[1].role).toBe('user');
    expect(String(wireMessages[1].content)).toContain('/books/algebra.pdf');

    // 3. 严格检查 assistant(tool_calls) <-> tool 配对完整性
    const pendingIds = new Set<string>();
    for (const msg of wireMessages) {
      if (msg.role === 'assistant') {
        expect(pendingIds.size).toBe(0);
        if (msg.tool_calls) {
          for (const tc of msg.tool_calls) pendingIds.add(tc.id);
        }
      } else if (msg.role === 'tool') {
        expect(msg.tool_call_id).toBeTruthy();
        expect(pendingIds.has(msg.tool_call_id!)).toBe(true);
        pendingIds.delete(msg.tool_call_id!);
      } else if (msg.role === 'user') {
        expect(pendingIds.size).toBe(0);
      }
    }
    expect(pendingIds.size).toBe(0);
  });
});
