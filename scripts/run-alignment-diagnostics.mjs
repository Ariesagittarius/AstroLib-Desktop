import { runDiagnostics } from './alignment-diagnostics.ts';

async function main() {
  console.log("================================================================================");
  console.log(" AstroLib Cross-Lingual Alignment Diagnostics & Verification Suite");
  console.log("================================================================================\n");

  const result = await runDiagnostics({
    modelName: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
    dtype: 'q8',
    compareWithFp32: true,
  });

  console.log(`[1] Model Profile:`);
  console.log(`    Model Name:     ${result.modelName}`);
  console.log(`    Quantization:   ${result.dtype}`);
  console.log(`    Embedding Dim:  ${result.embeddingDim}`);
  console.log(`    Tensor Shape:   Before Pooling: [${result.tensorShapes.beforePooling.join(', ')}] -> After Pooling: [${result.tensorShapes.afterPooling.join(', ')}]`);

  console.log(`\n[2] Tokenization & Length Audit:`);
  console.table(result.tokenStats.map(s => ({
    sample: s.sampleId,
    lang: s.lang,
    chars: s.charCount,
    tokens: s.tokenCount,
    "char/tok": (s.charCount / s.tokenCount).toFixed(2),
    "token>512": s.isTruncatedBy512Tokens,
    "char>512Bug": s.isTruncatedByOld512CharBug,
  })));

  console.log(`\n[3] Model Invariants & Health Verification:`);
  console.log(`    Self-similarity EN: ${result.selfSimilarity.en.toFixed(6)} (Target: 1.000000)`);
  console.log(`    Self-similarity ZH: ${result.selfSimilarity.zh.toFixed(6)} (Target: 1.000000)`);
  const norms = Object.values(result.l2Norms);
  const avgNorm = norms.reduce((a, b) => a + b, 0) / norms.length;
  console.log(`    Mean L2 Vector Norm: ${avgNorm.toFixed(6)} (Target: 1.000000)`);

  console.log(`\n[4] INT8 vs FP32 Quantization Differential:`);
  if (result.int8VsFp32Diff) {
    console.log(`    Average Cosine Sim between INT8 & FP32: ${result.int8VsFp32Diff.avgCosineSimBetweenDtypes.toFixed(6)}`);
    console.log(`    Max Absolute Difference:              ${result.int8VsFp32Diff.maxAbsoluteError.toFixed(6)}`);
    console.log(`    Mean Squared Error:                    ${result.int8VsFp32Diff.meanSquaredError.toExponential(4)}`);
  }

  console.log(`\n[5] Similarity Distribution & Key Test Pairs:`);
  console.log(`    Matrix Stats: Min=${result.similarityDistribution.min.toFixed(4)}, Max=${result.similarityDistribution.max.toFixed(4)}, Mean=${result.similarityDistribution.mean.toFixed(4)}, StdDev=${result.similarityDistribution.stdDev.toFixed(4)}`);
  console.table(result.pairwiseDetails.map(p => ({
    Pair: p.pairName,
    Similarity: p.similarity.toFixed(4),
    Description: p.description,
  })));

  console.log(`\n[6] True Pair Ranking Quality:`);
  console.log(`    Recall@1: ${(result.rankingMetrics.recallAt1 * 100).toFixed(1)}%`);
  console.log(`    Recall@5: ${(result.rankingMetrics.recallAt5 * 100).toFixed(1)}%`);
  console.log(`    MRR:      ${result.rankingMetrics.mrr.toFixed(4)}`);

  console.log("\n================================================================================");
  console.log(" Diagnostics Complete.");
  console.log("================================================================================");
}

main().catch(console.error);
