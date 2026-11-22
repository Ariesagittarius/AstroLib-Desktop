import { describe, it, expect } from 'vitest';
import { runDiagnostics, cosineSimilarity, computeL2Norm } from '../../scripts/alignment-diagnostics.ts';

const RUN_MODEL_TESTS = process.env.ASTROLIB_RUN_MODEL_TESTS === '1';

describe.skipIf(!RUN_MODEL_TESTS)('Alignment Diagnostics & Health Suite', () => {
  it('passes health check on embedding dimensions, L2 norms and self-similarity', async () => {
    const res = await runDiagnostics({
      modelName: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
      dtype: 'q8',
      compareWithFp32: false,
    });

    expect(res.embeddingDim).toBe(384);
    expect(res.tensorShapes.beforePooling[2]).toBe(384);
    expect(res.tensorShapes.afterPooling[1]).toBe(384);

    for (const [key, norm] of Object.entries(res.l2Norms)) {
      expect(norm).toBeGreaterThan(0.9999);
      expect(norm).toBeLessThan(1.0001);
    }

    expect(res.selfSimilarity.en).toBeGreaterThan(0.9999);
    expect(res.selfSimilarity.zh).toBeGreaterThan(0.9999);

    const truePair1 = res.pairwiseDetails.find((p) => p.pairName.includes('True Pair 1'))!;
    const crossTopic = res.pairwiseDetails.find((p) => p.pairName.includes('Cross-Topic'))!;
    const unrelated = res.pairwiseDetails.find((p) => p.pairName.includes('Unrelated'))!;

    expect(truePair1.similarity).toBeGreaterThan(0.70);
    expect(crossTopic.similarity).toBeLessThan(0.35);
    expect(unrelated.similarity).toBeLessThan(0.15);

    expect(truePair1.similarity - unrelated.similarity).toBeGreaterThan(0.60);

    expect(res.rankingMetrics.recallAt1).toBe(1.0);
    expect(res.rankingMetrics.recallAt5).toBe(1.0);
    expect(res.rankingMetrics.mrr).toBe(1.0);
  }, 45000);
});
