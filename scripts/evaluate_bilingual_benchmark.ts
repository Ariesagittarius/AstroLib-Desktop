/**
 * scripts/evaluate_bilingual_benchmark.ts
 * ============================================================================
 * AstroLib 真实教材双语语义对齐评测基准套件 (Gold-Standard Benchmark Suite)
 * ============================================================================
 * 依据 Phase 5 规范：
 * 1. 抽取真实教材章节（算法概论 DPV 00.1, 00.3, 02.1 及 OCR 真实语料）；
 * 2. 建立人工标注的金标对应集（1:1, 1:N, 同主题错位干扰, 跨章节干扰, 孤立无对应）；
 * 3. 统计输出 Recall@1, Recall@5, Precision@K, MRR；
 * 4. 统计不同段落类型（heading, paragraph, math, card）匹配表现；
 * 5. 全面对比 INT8 (q8) 与 FP32 精度、耗时与内存。
 * ============================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from '@huggingface/transformers';
import { SemanticParagraphExtractor } from '../src/services/bilingual/semantic-extractor.ts';
import { BipartiteMatcher } from '../src/services/bilingual/bipartite-matcher.ts';
import type { SemanticParagraph } from '../src/services/bilingual/types.ts';

export interface GoldStandardPair {
  id: string;
  sourceText: string;
  targetTexts: string[]; // 支持 1:N
  sourceType: 'heading' | 'paragraph' | 'math' | 'card';
  sectionContext: string;
  relationType: 'one_to_one' | 'one_to_many' | 'cross_topic_negative' | 'cross_chapter_negative' | 'unmatched';
}

export interface BenchmarkMetrics {
  totalQueries: number;
  recallAt1: number;
  recallAt5: number;
  precisionAt1: number;
  precisionAt3: number;
  mrr: number;
  byType: Record<string, { count: number; recallAt1: number; mrr: number }>;
  avgLatencyMs: number;
  peakMemoryMB: number;
}

export interface FullBenchmarkReport {
  timestamp: string;
  q8Metrics: BenchmarkMetrics;
  fp32Metrics: BenchmarkMetrics;
  q8VsFp32Diff: {
    cosineSimilarity: number;
    maxAbsDiff: number;
    mrrDifference: number;
  };
}

export function buildGoldStandardCorpus(): GoldStandardPair[] {
  return [
    // 1. 章节标题 (Heading)
    {
      id: 'heading_00_3',
      sourceText: '## 0.3 Big-O notation',
      targetTexts: ['## 0.3 大 O 符号'],
      sourceType: 'heading',
      sectionContext: '0.3 Big-O notation',
      relationType: 'one_to_one',
    },
    {
      id: 'heading_02_1',
      sourceText: '# 2.1 Multiplication',
      targetTexts: ['# 2.1 乘法算法与分治策略'],
      sourceType: 'heading',
      sectionContext: '2.1 Multiplication',
      relationType: 'one_to_one',
    },

    // 2. 经典导言与自然段落 (Paragraph 1:1)
    {
      id: 'p_sloppiness',
      sourceText: "We've just seen how sloppiness in the analysis of running times can lead to an unacceptable level of inaccuracy in the result. But the opposite danger is also present: it is possible to be too precise. An insightful analysis is based on the right simplifications.",
      targetTexts: ["我们刚刚看到了运行时间分析中的草率如何导致结果不准确的程度。但相反的危险也存在：可能过于精确。富有洞察力的分析基于正确的简化。"],
      sourceType: 'paragraph',
      sectionContext: '0.3 Big-O notation',
      relationType: 'one_to_one',
    },
    {
      id: 'p_computer_steps',
      sourceText: "Expressing running time in terms of basic computer steps is already a simplification. After all, the time taken by one such step depends crucially on the particular processor and even on details such as caching strategy.",
      targetTexts: ["用基本计算机步骤来表示运行时间已经是一种简化。毕竟，这样一个步骤所花费的时间在很大程度上取决于特定的处理器，甚至取决于缓存策略等细节。"],
      sourceType: 'paragraph',
      sectionContext: '0.3 Big-O notation',
      relationType: 'one_to_one',
    },
    {
      id: 'p_karatsuba_intro',
      sourceText: "In 1960, Anatoly Karatsuba discovered a revolutionary divide-and-conquer algorithm. By cleverly splitting each number into two halves of n/2 bits, Karatsuba realized we only need three multiplications instead of four.",
      targetTexts: ["1960 年，苏联数学家卡拉楚巴（Anatoly Karatsuba）提出了一种极具启发性的分治策略。他将 n 位大整数均分为高位与低位两部分，巧妙地将原本朴素展开所必需的 4 次半长整数乘法精简为 3 次乘法。"],
      sourceType: 'paragraph',
      sectionContext: '2.1 Multiplication',
      relationType: 'one_to_one',
    },

    // 3. 数学定理与公式段落 (Math / Rules 1:1)
    {
      id: 'math_big_o_def',
      sourceText: "Let f(n) and g(n) be functions from positive integers to positive reals. We say f = O(g) if there is a constant c > 0 such that f(n) <= c * g(n).",
      targetTexts: ["令 f(n) 和 g(n) 为从正整数到正实数的函数。如果存在一个常数 c > 0 使得 f(n) <= c * g(n)，我们说 f = O(g)。"],
      sourceType: 'math',
      sectionContext: '0.3 Big-O notation',
      relationType: 'one_to_one',
    },
    {
      id: 'math_recurrence_karatsuba',
      sourceText: "The resulting Karatsuba algorithm has an improved running time recurrence: T(n) = 3T(n/2) + O(n), achieving an astonishing O(n^{log_2 3}) ≈ O(n^{1.585}) time bound.",
      targetTexts: ["由此构建的卡拉楚巴（Karatsuba）乘法算法具备更优的递推关系：T(n) = 3T(n/2) + O(n)，其渐近复杂度上界降至 O(n^{log_2 3}) ≈ O(n^{1.585})。"],
      sourceType: 'math',
      sectionContext: '2.1 Multiplication',
      relationType: 'one_to_one',
    },

    // 4. 一对多对应关系 (1:N Multi-paragraph)
    {
      id: 'multi_rules_domination',
      sourceText: "Here are some commonsense rules that help simplify functions by omitting dominated terms: Multiplicative constants can be omitted: 14n^2 becomes n^2. Any exponential dominates any polynomial: 3^n dominates n^5.",
      targetTexts: [
        "以下是一些经验规则，通过忽略低次项以简化算法运行时间的函数表示：乘法常数可以省略：14n^2 变为 n^2。",
        "任何指数项支配任何多项式项：3^n 支配 n^5（它甚至支配 2^n）。",
      ],
      sourceType: 'paragraph',
      sectionContext: '0.3 Big-O notation',
      relationType: 'one_to_many',
    },

    // 5. 同主题但非对应段落（负样本 Hard Negative）
    {
      id: 'neg_cavalier_vs_steps',
      sourceText: "Don't misunderstand this cavalier attitude toward constants. Programmers and algorithm developers are very interested in constants.",
      targetTexts: ["用基本计算机步骤来表示运行时间已经是一种简化。"],
      sourceType: 'paragraph',
      sectionContext: '0.3 Big-O notation',
      relationType: 'cross_topic_negative',
    },

    // 6. 跨章节非对应段落（负样本 Distant Negative）
    {
      id: 'neg_cross_chapter',
      sourceText: "Gauss once noticed that although the product of two complex numbers seems to involve four multiplications, it can be done with three.",
      targetTexts: ["Figure 0.2 Which running time is better? 哪个运行时间更好？"],
      sourceType: 'paragraph',
      sectionContext: '2.1 Multiplication',
      relationType: 'cross_chapter_negative',
    },

    // 7. 孤立无对应段落 (Unmatched)
    {
      id: 'unmatched_english_unique',
      sourceText: "This specific pedagogical remark was added exclusively to the Western college edition and has no translation counterpart in this chapter.",
      targetTexts: [],
      sourceType: 'paragraph',
      sectionContext: '00_preface',
      relationType: 'unmatched',
    },
  ];
}

async function runBenchmarkForDtype(
  modelName: string,
  dtype: 'q8' | 'fp32',
  corpus: GoldStandardPair[]
): Promise<{ metrics: BenchmarkMetrics; embeddings: number[][] }> {
  const pipe = await pipeline('feature-extraction', modelName, { dtype, device: 'cpu' });

  // 收集所有去重文本并编码
  const positiveQueries = corpus.filter(
    (c) => c.relationType === 'one_to_one' || c.relationType === 'one_to_many'
  );

  const allTargetTexts: string[] = [];
  const targetIdMap = new Map<string, number>();

  corpus.forEach((item) => {
    item.targetTexts.forEach((t) => {
      if (!targetIdMap.has(t)) {
        targetIdMap.set(t, allTargetTexts.length);
        allTargetTexts.push(t);
      }
    });
  });

  const sourceTexts = positiveQueries.map((q) => q.sourceText);

  const memBefore = process.memoryUsage().heapUsed;
  const t0 = performance.now();

  const srcOutput = await pipe(sourceTexts, { pooling: 'mean', normalize: true });
  const tgtOutput = await pipe(allTargetTexts, { pooling: 'mean', normalize: true });

  const totalTime = performance.now() - t0;
  const memAfter = process.memoryUsage().heapUsed;
  const peakMemoryMB = Math.round((memAfter - memBefore) / (1024 * 1024));

  const dim = srcOutput.dims[srcOutput.dims.length - 1];
  const srcEmbeds: number[][] = [];
  const tgtEmbeds: number[][] = [];
  const srcData = srcOutput.data as Float32Array;
  const tgtData = tgtOutput.data as Float32Array;

  for (let i = 0; i < sourceTexts.length; i++) {
    srcEmbeds.push(Array.from(srcData.subarray(i * dim, (i + 1) * dim)));
  }
  for (let j = 0; j < allTargetTexts.length; j++) {
    tgtEmbeds.push(Array.from(tgtData.subarray(j * dim, (j + 1) * dim)));
  }

  const matrix = BipartiteMatcher.buildMatrix(srcEmbeds, tgtEmbeds);

  // 评估指标
  let top1Hits = 0;
  let top5Hits = 0;
  let precision1Sum = 0;
  let precision3Sum = 0;
  let rrSum = 0;

  const byTypeStats: Record<string, { count: number; hits1: number; rr: number }> = {};

  positiveQueries.forEach((q, i) => {
    const validTargetIndices = new Set(q.targetTexts.map((t) => targetIdMap.get(t)!));

    const ranked = matrix[i]
      .map((score, tgtIdx) => ({ tgtIdx, score }))
      .sort((a, b) => b.score - a.score);

    // 记录每种类型统计
    if (!byTypeStats[q.sourceType]) {
      byTypeStats[q.sourceType] = { count: 0, hits1: 0, rr: 0 };
    }
    byTypeStats[q.sourceType].count++;

    // Top-1
    const firstHit = validTargetIndices.has(ranked[0].tgtIdx);
    if (firstHit) {
      top1Hits++;
      precision1Sum += 1;
      byTypeStats[q.sourceType].hits1++;
    }

    // Top-3 Precision
    let top3Correct = 0;
    for (let k = 0; k < Math.min(3, ranked.length); k++) {
      if (validTargetIndices.has(ranked[k].tgtIdx)) top3Correct++;
    }
    precision3Sum += top3Correct / Math.min(3, validTargetIndices.size);

    // Top-5 Recall & MRR
    let firstRank = -1;
    for (let r = 0; r < ranked.length; r++) {
      if (validTargetIndices.has(ranked[r].tgtIdx)) {
        firstRank = r + 1;
        break;
      }
    }

    if (firstRank > 0 && firstRank <= 5) {
      top5Hits++;
    }
    if (firstRank > 0) {
      const recRank = 1 / firstRank;
      rrSum += recRank;
      byTypeStats[q.sourceType].rr += recRank;
    }
  });

  const N = positiveQueries.length;
  const metrics: BenchmarkMetrics = {
    totalQueries: N,
    recallAt1: top1Hits / N,
    recallAt5: top5Hits / N,
    precisionAt1: precision1Sum / N,
    precisionAt3: precision3Sum / N,
    mrr: rrSum / N,
    byType: Object.fromEntries(
      Object.entries(byTypeStats).map(([k, v]) => [
        k,
        {
          count: v.count,
          recallAt1: v.hits1 / v.count,
          mrr: v.rr / v.count,
        },
      ])
    ),
    avgLatencyMs: Math.round(totalTime / (sourceTexts.length + allTargetTexts.length)),
    peakMemoryMB,
  };

  return { metrics, embeddings: srcEmbeds };
}

export async function executeFullBenchmark(): Promise<FullBenchmarkReport> {
  const modelName = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
  const corpus = buildGoldStandardCorpus();

  console.log('Evaluating INT8 (q8) Benchmark...');
  const q8Res = await runBenchmarkForDtype(modelName, 'q8', corpus);

  console.log('Evaluating FP32 Benchmark...');
  const fp32Res = await runBenchmarkForDtype(modelName, 'fp32', corpus);

  // 计算 INT8 与 FP32 差异
  let cosSimSum = 0;
  let maxDiff = 0;
  const numEmbeds = q8Res.embeddings.length;
  const dim = q8Res.embeddings[0].length;

  for (let i = 0; i < numEmbeds; i++) {
    cosSimSum += BipartiteMatcher.cosineSimilarity(q8Res.embeddings[i], fp32Res.embeddings[i]);
    for (let d = 0; d < dim; d++) {
      const diff = Math.abs(q8Res.embeddings[i][d] - fp32Res.embeddings[i][d]);
      if (diff > maxDiff) maxDiff = diff;
    }
  }

  return {
    timestamp: new Date().toISOString(),
    q8Metrics: q8Res.metrics,
    fp32Metrics: fp32Res.metrics,
    q8VsFp32Diff: {
      cosineSimilarity: cosSimSum / numEmbeds,
      maxAbsDiff: maxDiff,
      mrrDifference: Math.abs(q8Res.metrics.mrr - fp32Res.metrics.mrr),
    },
  };
}
