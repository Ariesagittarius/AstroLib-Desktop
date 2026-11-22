import { describe, it, expect } from 'vitest';
import { executeFullBenchmark } from '../../scripts/evaluate_bilingual_benchmark.ts';

const RUN_MODEL_TESTS = process.env.ASTROLIB_RUN_MODEL_TESTS === '1';

describe.skipIf(!RUN_MODEL_TESTS)('Bilingual Alignment Real Textbook Benchmark (Phase 5)', () => {
  it('achieves >= 90% Recall@1, 100% Recall@5, and negligible INT8 vs FP32 degradation', async () => {
    const report = await executeFullBenchmark();

    // 1. INT8 performance
    expect(report.q8Metrics.recallAt1).toBeGreaterThanOrEqual(0.9);
    expect(report.q8Metrics.recallAt5).toBe(1.0);
    expect(report.q8Metrics.mrr).toBeGreaterThanOrEqual(0.95);

    // 2. Latency verification: INT8 must be <= 60ms per item under multi-worker parallel CPU load
    expect(report.q8Metrics.avgLatencyMs).toBeLessThanOrEqual(60);

    // 3. INT8 vs FP32 consistency verification: Cosine Sim > 0.99
    expect(report.q8VsFp32Diff.cosineSimilarity).toBeGreaterThan(0.99);
    expect(report.q8VsFp32Diff.mrrDifference).toBeLessThan(0.05);
  }, 30000);
});
