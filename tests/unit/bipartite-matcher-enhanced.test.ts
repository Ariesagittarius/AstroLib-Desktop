import { describe, it, expect } from 'vitest';
import { BipartiteMatcher } from '../../src/services/bilingual/bipartite-matcher.ts';
import type { SemanticParagraph } from '../../src/services/bilingual/types.ts';

describe('BipartiteMatcher (Phase 4 Enhanced)', () => {
  it('computes auxiliary scores with structural type and formula overlap bonuses', () => {
    const srcHeading: SemanticParagraph = {
      id: 'src-0',
      index: 0,
      text: '# 0.3 Big-O notation',
      type: 'heading',
      sectionContext: '0.3 Big-O notation',
    };

    const tgtHeading: SemanticParagraph = {
      id: 'tgt-0',
      index: 0,
      text: '# 0.3 大 O 符号',
      type: 'heading',
      sectionContext: '0.3 大 O 符号',
    };

    const tgtParagraph: SemanticParagraph = {
      id: 'tgt-1',
      index: 1,
      text: '我们刚刚看到了运行时间分析中的草率...',
      type: 'paragraph',
      sectionContext: '0.3 大 O 符号',
    };

    // Heading to heading should have bonus
    const headingScore = BipartiteMatcher.computeAuxiliaryScore(srcHeading, tgtHeading);
    expect(headingScore).toBeGreaterThan(0.05);

    // Heading to paragraph should be penalized
    const mismatchScore = BipartiteMatcher.computeAuxiliaryScore(srcHeading, tgtParagraph);
    expect(mismatchScore).toBeLessThan(0);

    // Formula overlap bonus
    const srcMath: SemanticParagraph = {
      id: 'src-m',
      index: 2,
      text: 'Rule with formula',
      type: 'paragraph',
      formulas: ['14n^2', 'O(n^2)'],
    };
    const tgtMath: SemanticParagraph = {
      id: 'tgt-m',
      index: 2,
      text: '公式规则',
      type: 'paragraph',
      formulas: ['14n^2', 'O(n^2)'],
    };

    const mathBonus = BipartiteMatcher.computeAuxiliaryScore(srcMath, tgtMath);
    expect(mathBonus).toBeGreaterThan(0.04);
  });

  it('correctly detects 1:N relations and bidirectional top-k', () => {
    // 1 source paragraph corresponds to 2 target paragraphs
    const sources: SemanticParagraph[] = [
      { id: 'src-0', index: 0, text: 'Long source paragraph covering concept A and B', type: 'paragraph' },
      { id: 'src-1', index: 1, text: 'Second source paragraph', type: 'paragraph' },
    ];

    const targets: SemanticParagraph[] = [
      { id: 'tgt-0', index: 0, text: 'Target part A', type: 'paragraph' },
      { id: 'tgt-1', index: 1, text: 'Target part B', type: 'paragraph' },
      { id: 'tgt-2', index: 2, text: 'Target for second paragraph', type: 'paragraph' },
    ];

    // Simulated matrix where src-0 is strongly similar to tgt-0 (0.85) and tgt-1 (0.80)
    const matrix = [
      [0.85, 0.80, 0.15],
      [0.10, 0.20, 0.88],
    ];

    const links = BipartiteMatcher.extractLinks(matrix, sources, targets, {
      threshold: 0.6,
      maxPerSource: 2,
    });

    expect(links.length).toBe(3);

    const src0Links = links.filter((l) => l.sourceId === 'src-0');
    expect(src0Links.length).toBe(2);
    expect(src0Links[0].matchRelation).toBe('one_to_many');
    expect(src0Links[0].targetId).toBe('tgt-0');
    expect(src0Links[1].targetId).toBe('tgt-1');

    const src1Links = links.filter((l) => l.sourceId === 'src-1');
    expect(src1Links.length).toBe(1);
    expect(src1Links[0].targetId).toBe('tgt-2');
  });

  it('detects unmatched paragraphs explicitly', () => {
    const sources: SemanticParagraph[] = [
      { id: 'src-0', index: 0, text: 'Matched source', type: 'paragraph' },
      { id: 'src-1', index: 1, text: 'Extra English paragraph not in translation', type: 'paragraph' },
    ];

    const targets: SemanticParagraph[] = [
      { id: 'tgt-0', index: 0, text: '匹配中文', type: 'paragraph' },
      { id: 'tgt-1', index: 1, text: '额外中文段落', type: 'paragraph' },
    ];

    const matrix = [
      [0.85, 0.10],
      [0.20, 0.15],
    ];

    const links = BipartiteMatcher.extractLinks(matrix, sources, targets, {
      threshold: 0.6,
    });

    const { unmatchedSourceIds, unmatchedTargetIds } = BipartiteMatcher.findUnmatched(
      links,
      sources,
      targets
    );

    expect(unmatchedSourceIds).toContain('src-1');
    expect(unmatchedSourceIds).not.toContain('src-0');
    expect(unmatchedTargetIds).toContain('tgt-1');
    expect(unmatchedTargetIds).not.toContain('tgt-0');
  });

  it('computes matrix distribution and provides calibrated threshold', () => {
    const matrix = [
      [0.85, 0.20, 0.10],
      [0.15, 0.80, 0.25],
      [0.05, 0.18, 0.90],
    ];

    const stats = BipartiteMatcher.computeMatrixStats(matrix);
    expect(stats.min).toBeLessThan(0.1);
    expect(stats.max).toBeGreaterThanOrEqual(0.9);
    expect(stats.mean).toBeGreaterThan(0.3);
    expect(stats.recommendedThreshold).toBeGreaterThanOrEqual(0.55);
    expect(stats.recommendedThreshold).toBeLessThanOrEqual(0.75);
  });
});
