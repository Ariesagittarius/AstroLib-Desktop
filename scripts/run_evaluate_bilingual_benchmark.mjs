import { executeFullBenchmark } from './evaluate_bilingual_benchmark.ts';

async function main() {
  console.log("================================================================================");
  console.log(" AstroLib Phase 5: Real Textbook Cross-Lingual Evaluation Benchmark");
  console.log("================================================================================\n");

  const report = await executeFullBenchmark();

  console.log("--------------------------------------------------------------------------------");
  console.log(" [1] OVERALL ACCURACY & RETRIEVAL METRICS (INT8 vs FP32)");
  console.log("--------------------------------------------------------------------------------");
  console.table([
    {
      Dtype: 'INT8 (q8)',
      'Recall@1': `${(report.q8Metrics.recallAt1 * 100).toFixed(1)}%`,
      'Recall@5': `${(report.q8Metrics.recallAt5 * 100).toFixed(1)}%`,
      'Precision@1': `${(report.q8Metrics.precisionAt1 * 100).toFixed(1)}%`,
      'Precision@3': `${(report.q8Metrics.precisionAt3 * 100).toFixed(1)}%`,
      MRR: report.q8Metrics.mrr.toFixed(4),
      'Latency/item': `${report.q8Metrics.avgLatencyMs}ms`,
    },
    {
      Dtype: 'FP32',
      'Recall@1': `${(report.fp32Metrics.recallAt1 * 100).toFixed(1)}%`,
      'Recall@5': `${(report.fp32Metrics.recallAt5 * 100).toFixed(1)}%`,
      'Precision@1': `${(report.fp32Metrics.precisionAt1 * 100).toFixed(1)}%`,
      'Precision@3': `${(report.fp32Metrics.precisionAt3 * 100).toFixed(1)}%`,
      MRR: report.fp32Metrics.mrr.toFixed(4),
      'Latency/item': `${report.fp32Metrics.avgLatencyMs}ms`,
    },
  ]);

  console.log("\n--------------------------------------------------------------------------------");
  console.log(" [2] PERFORMANCE BY STRUCTURAL PARAGRAPH TYPE (INT8)");
  console.log("--------------------------------------------------------------------------------");
  console.table(Object.entries(report.q8Metrics.byType).map(([type, stats]) => ({
    'Paragraph Type': type,
    Samples: stats.count,
    'Recall@1': `${(stats.recallAt1 * 100).toFixed(1)}%`,
    MRR: stats.mrr.toFixed(4),
  })));

  console.log("\n--------------------------------------------------------------------------------");
  console.log(" [3] QUANTIZATION LOSS ANALYSIS (INT8 vs FP32 Coordinate Alignment)");
  console.log("--------------------------------------------------------------------------------");
  console.log(`  Vector-level Cosine Similarity: ${report.q8VsFp32Diff.cosineSimilarity.toFixed(6)}`);
  console.log(`  Maximum Coordinate Difference:  ${report.q8VsFp32Diff.maxAbsDiff.toFixed(6)}`);
  console.log(`  MRR Delta:                      ${report.q8VsFp32Diff.mrrDifference.toFixed(4)}`);

  console.log("\n================================================================================");
  console.log(" Benchmark Execution Complete.");
  console.log("================================================================================");
}

main().catch(console.error);
