import { describe, it, expect } from 'vitest';
import {
  buildSegmentSummaryText,
  groupTurnBlocksIntoSegments,
  normalizeTurnBlocks,
  renderTurnInterleavedHtml,
} from '../../src/features/harness/turn-block-renderer.ts';
import type { StructuredTurn, TurnBlock } from '../../src/features/harness/types.ts';

describe('TurnBlock 交错流式结构化与兼容测试', () => {
  it('1. 按自然时间顺序切分 Thinking/Tool 片段与正文块（拒绝全顶堆叠）', () => {
    const blocks: TurnBlock[] = [
      {
        id: 'blk_think_1',
        kind: 'thinking',
        stepId: 'think-1',
        content: '先检索章节大纲。',
        startedAt: 1000,
        endedAt: 1400,
        status: 'completed',
      },
      {
        id: 'blk_tool_1',
        kind: 'tool',
        stepId: 'tool-1',
        toolName: 'get_document_outline',
        label: '读取文档大纲',
        icon: { type: 'mdicon', value: 'toc' },
        args: { uri: 'astrolib://math/linear_algebra_geometry' },
        status: 'completed',
        startedAt: 1400,
        endedAt: 1800,
      },
      {
        id: 'blk_text_1',
        kind: 'text',
        markdown: '第一阶段已完成大纲扫描，接下来深入阅读核心章节。',
        startedAt: 1850,
        endedAt: 2200,
        status: 'completed',
      },
      {
        id: 'blk_tool_2',
        kind: 'tool',
        stepId: 'tool-2',
        toolName: 'read_document_section',
        label: '读取矩阵乘法章节',
        icon: { type: 'mdicon', value: 'menu_book' },
        args: { sectionId: 'sec-2' },
        status: 'completed',
        startedAt: 2250,
        endedAt: 2800,
      },
      {
        id: 'blk_text_2',
        kind: 'text',
        markdown: '综合两步检索结果，定理推导如下：$AB \\neq BA$。',
        startedAt: 2850,
        endedAt: 3400,
        status: 'completed',
      },
      {
        id: 'blk_status_1',
        kind: 'status',
        tone: 'warning',
        label: '已达到探索轮次上限',
        action: 'continue-exploring',
        timestamp: 3500,
      },
    ];

    const slots = groupTurnBlocksIntoSegments(blocks);
    expect(slots.map((s) => (s.kind === 'segment' ? `segment(${s.blocks.length})` : s.block.kind))).toEqual([
      'segment(2)',
      'text',
      'segment(1)',
      'text',
      'status',
    ]);

    const html = renderTurnInterleavedHtml({
      id: 'turn-interleaved',
      startedAt: 1000,
      endedAt: 3500,
      status: 'completed',
      steps: [],
      blocks,
      contentMarkdown: '',
    });

    const idxSeg1 = html.indexOf('data-segment-id="seg_blk_think_1"');
    const idxText1 = html.indexOf('第一阶段已完成大纲扫描');
    const idxSeg2 = html.indexOf('data-segment-id="seg_blk_tool_2"');
    const idxText2 = html.indexOf('定理推导如下');
    const idxStatus = html.indexOf('data-turn-status-action="continue-exploring"');

    expect(idxSeg1).toBeGreaterThan(-1);
    expect(idxText1).toBeGreaterThan(idxSeg1);
    expect(idxSeg2).toBeGreaterThan(idxText1);
    expect(idxText2).toBeGreaterThan(idxSeg2);
    expect(idxStatus).toBeGreaterThan(idxText2);
  });

  it('2. 无损兼容历史仅包含 steps + contentMarkdown 的旧版 StructuredTurn', () => {
    const legacyTurn: StructuredTurn = {
      id: 'turn-legacy-1',
      startedAt: 1000,
      endedAt: 2500,
      status: 'completed',
      steps: [
        {
          id: 'step-t',
          kind: 'thinking',
          content: '历史思考记录',
          startedAt: 1000,
          endedAt: 1500,
          status: 'completed',
        },
        {
          id: 'step-call',
          kind: 'tool',
          toolName: 'search_library_text',
          label: '全文检索极限定义',
          icon: { type: 'mdicon', value: 'search' },
          args: { query: 'Stolz' },
          status: 'completed',
          startedAt: 1500,
          endedAt: 2100,
        },
      ],
      contentMarkdown: '这是旧版对话存档的正文结论。',
    };

    const blocks = normalizeTurnBlocks(legacyTurn);
    expect(blocks.map((b) => b.kind)).toEqual(['thinking', 'tool', 'text']);

    const summary = buildSegmentSummaryText(blocks.slice(0, 2) as any);
    expect(summary.isActive).toBe(false);
    expect(summary.text).toContain('1 项操作');
  });
});
