import { pipeline, AutoTokenizer, AutoModel } from '@huggingface/transformers';

export interface DiagnosticsSample {
  id: string;
  en: string;
  zh: string;
  type: 'true_pair' | 'cross_topic' | 'unrelated' | 'math_formula' | 'ocr_fragment';
  expectedMatchId?: string;
}

export interface DiagnosticsResult {
  modelName: string;
  dtype: string;
  prefix: string;
  embeddingDim: number;
  tensorShapes: {
    beforePooling: number[];
    afterPooling: number[];
  };
  tokenStats: Array<{
    sampleId: string;
    lang: 'en' | 'zh';
    charCount: number;
    tokenCount: number;
    isTruncatedBy512Tokens: boolean;
    isTruncatedByOld512CharBug: boolean;
  }>;
  l2Norms: { [key: string]: number };
  selfSimilarity: {
    en: number;
    zh: number;
  };
  similarityDistribution: {
    min: number;
    max: number;
    mean: number;
    stdDev: number;
  };
  rankingMetrics: {
    recallAt1: number;
    recallAt5: number;
    mrr: number;
  };
  int8VsFp32Diff?: {
    avgCosineSimBetweenDtypes: number;
    maxAbsoluteError: number;
    meanSquaredError: number;
  };
  pairwiseDetails: Array<{
    pairName: string;
    similarity: number;
    description: string;
  }>;
}

export const DIAGNOSTICS_CORPUS: DiagnosticsSample[] = [
  {
    id: 'p1_intro',
    en: "We've just seen how sloppiness in the analysis of running times can lead to an unacceptable level of inaccuracy in the result. But the opposite danger is also present: it is possible to be too precise. An insightful analysis is based on the right simplifications.",
    zh: "我们刚刚看到了运行时间分析中的草率如何导致结果不准确的程度。但相反的危险也存在：可能过于精确。富有洞察力的分析基于正确的简化。",
    type: 'true_pair',
  },
  {
    id: 'p2_computer_steps',
    en: "Expressing running time in terms of basic computer steps is already a simplification. After all, the time taken by one such step depends crucially on the particular processor and even on details such as caching strategy (as a result of which the running time can differ subtly from one execution to the next).",
    zh: "用基本计算机步骤来表示运行时间已经是一种简化。毕竟，这样一个步骤所花费的时间在很大程度上取决于特定的处理器，甚至取决于缓存策略等细节（因此，每次执行的运行时间可能会略有不同）。",
    type: 'true_pair',
  },
  {
    id: 'p3_omit_lower_order',
    en: "Instead of reporting that an algorithm takes, say, 5n^3 + 4n + 3 steps on an input of size n, it is much simpler to leave out lower-order terms such as 4n and 3 (which become insignificant as n grows), and even the detail of the coefficient 5 in the leading term, and just say that the algorithm takes time O(n^3).",
    zh: "与报告算法在大小为 n 的输入上采用 5n^3 + 4n + 3 个步骤相比，忽略低阶项（例如 4n 和 3）（随着 n 的增长而变得微不足道）甚至首项系数 5 的细节要简单得多，只需说该算法耗时 O(n^3)。",
    type: 'true_pair',
  },
  {
    id: 'p4_math_rules',
    en: "Multiplicative constants can be omitted: 14n^2 becomes n^2. n^a dominates n^b if a > b: for instance, n^2 dominates n. Any exponential dominates any polynomial: 3^n dominates n^5 (it even dominates 2^n). Likewise, any polynomial dominates any logarithm: n dominates (log n)^3.",
    zh: "常系数可以忽略：14n^2 变为 n^2。当 a > b 时，n^a 支配 n^b：例如，n^2 支配 n。任何指数项支配任何多项式项：3^n 支配 n^5（甚至支配 2^n）。同样，任何多项式支配任何对数：n 支配 (log n)^3。",
    type: 'true_pair',
  },
  {
    id: 'p5_programmer_attitude',
    en: "Don't misunderstand this cavalier attitude toward constants. Programmers and algorithm developers are very interested in constants and would gladly stay up nights in order to make an algorithm run faster by a factor of 2. But understanding algorithms would be impossible without big-O notation.",
    zh: "不要误解这种对常数的漫不经心的态度。程序员和算法开发人员对常量非常感兴趣，并且很乐意熬夜以使算法运行速度提高 2 倍。但是，如果没有大 O 表示法所提供的简单性，要理解本书级别的算法是不可能的。",
    type: 'true_pair',
  },
  {
    id: 'p6_ocr_fragmented',
    en: "Multiplicative constants can be omitted: 14n^2 becomes n^2. n^a dominates n^b if a > b: for instance, n^2 dominates n.",
    zh: "支配 n\n5\n(它甚至支配 2\nn\n).\nn+1 2n+20<=20 同时，显然有 f3=O(f2)，这时 c=1。\n8\n第 23 页 序言",
    type: 'ocr_fragment',
  },
  {
    id: 'p7_unrelated_recipe',
    en: "A classic pancake batter requires two cups of unbleached all-purpose flour, two fresh eggs, one cup of whole milk, two tablespoons of melted butter, and a pinch of salt. Whisk until smooth.",
    zh: "今天下午北京天气晴朗温和，最高气温约二十摄氏度，微风习习，非常适合户外散步、慢跑与摄影活动。",
    type: 'unrelated',
  },
];

export function cosineSimilarity(a: number[] | Float32Array, b: number[] | Float32Array): number {
  let dot = 0, nA = 0, nB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    nA += a[i] * a[i];
    nB += b[i] * b[i];
  }
  if (nA === 0 || nB === 0) return 0;
  return dot / (Math.sqrt(nA) * Math.sqrt(nB));
}

export function computeL2Norm(vec: number[] | Float32Array): number {
  let sum = 0;
  for (let i = 0; i < vec.length; i++) sum += vec[i] * vec[i];
  return Math.sqrt(sum);
}

export async function runDiagnostics(options: {
  modelName?: string;
  dtype?: 'q8' | 'fp32';
  prefix?: string;
  compareWithFp32?: boolean;
} = {}): Promise<DiagnosticsResult> {
  const modelName = options.modelName ?? 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
  const dtype = options.dtype ?? 'q8';
  const prefix = options.prefix ?? '';

  const tokenizer = await AutoTokenizer.from_pretrained(modelName);
  const pipe = await pipeline('feature-extraction', modelName, { dtype, device: 'cpu' });

  // 1. Inspect Tokenizer and Token counts
  const tokenStats: DiagnosticsResult['tokenStats'] = [];
  for (const item of DIAGNOSTICS_CORPUS) {
    const enTokens = tokenizer(prefix + item.en);
    const zhTokens = tokenizer(prefix + item.zh);

    tokenStats.push({
      sampleId: item.id,
      lang: 'en',
      charCount: item.en.length,
      tokenCount: enTokens.input_ids.data.length,
      isTruncatedBy512Tokens: enTokens.input_ids.data.length >= 512,
      isTruncatedByOld512CharBug: item.en.length > 512,
    });

    tokenStats.push({
      sampleId: item.id,
      lang: 'zh',
      charCount: item.zh.length,
      tokenCount: zhTokens.input_ids.data.length,
      isTruncatedBy512Tokens: zhTokens.input_ids.data.length >= 512,
      isTruncatedByOld512CharBug: item.zh.length > 512,
    });
  }

  // 2. Measure tensor shapes before and after pooling
  const singleTestEn = prefix + DIAGNOSTICS_CORPUS[0].en;
  const singleInput = tokenizer(singleTestEn);
  const rawModel = await AutoModel.from_pretrained(modelName, { dtype });
  const rawOut = await rawModel(singleInput);
  const shapeBefore = Array.from(rawOut.last_hidden_state.dims as number[]);

  const pooledOut = await pipe([singleTestEn], { pooling: 'mean', normalize: true });
  const shapeAfter = Array.from(pooledOut.dims as number[]);

  // 3. Extract embeddings for all corpus items
  const enTexts = DIAGNOSTICS_CORPUS.map((s) => prefix + s.en);
  const zhTexts = DIAGNOSTICS_CORPUS.map((s) => prefix + s.zh);

  const enBatchOut = await pipe(enTexts, { pooling: 'mean', normalize: true });
  const zhBatchOut = await pipe(zhTexts, { pooling: 'mean', normalize: true });

  const dim = enBatchOut.dims[enBatchOut.dims.length - 1];

  const enEmbeds: number[][] = [];
  const zhEmbeds: number[][] = [];
  const enData = enBatchOut.data as Float32Array;
  const zhData = zhBatchOut.data as Float32Array;

  for (let i = 0; i < DIAGNOSTICS_CORPUS.length; i++) {
    enEmbeds.push(Array.from(enData.subarray(i * dim, (i + 1) * dim)));
    zhEmbeds.push(Array.from(zhData.subarray(i * dim, (i + 1) * dim)));
  }

  // 4. Measure L2 Norms
  const l2Norms: { [key: string]: number } = {};
  DIAGNOSTICS_CORPUS.forEach((s, idx) => {
    l2Norms[`en_${s.id}`] = computeL2Norm(enEmbeds[idx]);
    l2Norms[`zh_${s.id}`] = computeL2Norm(zhEmbeds[idx]);
  });

  // 5. Measure Self-Similarity
  const selfSimEn = cosineSimilarity(enEmbeds[0], enEmbeds[0]);
  const selfSimZh = cosineSimilarity(zhEmbeds[0], zhEmbeds[0]);

  // 6. Build Cross-Lingual Matrix [M x N]
  const M = enEmbeds.length;
  const N = zhEmbeds.length;
  const matrix: number[][] = [];
  const allValues: number[] = [];

  for (let i = 0; i < M; i++) {
    const row: number[] = [];
    for (let j = 0; j < N; j++) {
      const sim = cosineSimilarity(enEmbeds[i], zhEmbeds[j]);
      row.push(sim);
      allValues.push(sim);
    }
    matrix.push(row);
  }

  const minVal = Math.min(...allValues);
  const maxVal = Math.max(...allValues);
  const meanVal = allValues.reduce((a, b) => a + b, 0) / allValues.length;
  const variance = allValues.reduce((a, b) => a + Math.pow(b - meanVal, 2), 0) / allValues.length;
  const stdDev = Math.sqrt(variance);

  // 7. Measure Ranking Metrics (Recall@1, Recall@5, MRR on True Pairs)
  const truePairs = DIAGNOSTICS_CORPUS.map((s, idx) => ({ ...s, idx })).filter(
    (s) => s.type === 'true_pair'
  );

  let top1Hits = 0;
  let top5Hits = 0;
  let rrSum = 0;

  truePairs.forEach(({ idx }) => {
    const scores = matrix[idx].map((score, tgtIdx) => ({ tgtIdx, score }));
    scores.sort((a, b) => b.score - a.score);

    const rank = scores.findIndex((s) => s.tgtIdx === idx) + 1;
    if (rank === 1) top1Hits++;
    if (rank <= 5) top5Hits++;
    rrSum += 1 / rank;
  });

  const recallAt1 = top1Hits / truePairs.length;
  const recallAt5 = top5Hits / truePairs.length;
  const mrr = rrSum / truePairs.length;

  // 8. Pairwise details
  const pairwiseDetails: DiagnosticsResult['pairwiseDetails'] = [
    {
      pairName: 'Self-Similarity (EN == EN)',
      similarity: selfSimEn,
      description: 'Identical English text vector comparison',
    },
    {
      pairName: 'Self-Similarity (ZH == ZH)',
      similarity: selfSimZh,
      description: 'Identical Chinese text vector comparison',
    },
    {
      pairName: 'True Pair 1 (Intro EN <-> ZH)',
      similarity: matrix[0][0],
      description: 'Human-translated Chapter 0.3 introduction paragraph',
    },
    {
      pairName: 'True Pair 4 (Math rules EN <-> ZH)',
      similarity: matrix[3][3],
      description: 'Big-O mathematical domination rules with formulas',
    },
    {
      pairName: 'Cross-Topic (Intro vs Domination rules)',
      similarity: matrix[0][3],
      description: 'Different paragraphs from same chapter',
    },
    {
      pairName: 'OCR Fragmented (Clean EN vs Raw OCR ZH)',
      similarity: matrix[3][5],
      description: 'Math domination rule against raw OCR fragmented paragraph',
    },
    {
      pairName: 'Completely Unrelated (Algorithm vs Pancake Recipe)',
      similarity: matrix[0][6],
      description: 'Semantic contrast check between computer science and recipe',
    },
  ];

  // 9. INT8 vs FP32 comparison (if requested)
  let int8VsFp32Diff: DiagnosticsResult['int8VsFp32Diff'] | undefined;
  if (options.compareWithFp32 && dtype === 'q8') {
    const pipeFp32 = await pipeline('feature-extraction', modelName, { dtype: 'fp32', device: 'cpu' });
    const enFp32Out = await pipeFp32(enTexts, { pooling: 'mean', normalize: true });

    let cosSum = 0;
    let maxAbs = 0;
    let mseSum = 0;
    let totalDimCount = 0;

    const fp32Data = enFp32Out.data as Float32Array;

    for (let i = 0; i < M; i++) {
      const q8Vec = enEmbeds[i];
      const fp32Vec = Array.from(fp32Data.subarray(i * dim, (i + 1) * dim)) as number[];

      cosSum += cosineSimilarity(q8Vec, fp32Vec);

      for (let d = 0; d < dim; d++) {
        const diff = Math.abs(q8Vec[d] - fp32Vec[d]);
        if (diff > maxAbs) maxAbs = diff;
        mseSum += diff * diff;
        totalDimCount++;
      }
    }

    int8VsFp32Diff = {
      avgCosineSimBetweenDtypes: cosSum / M,
      maxAbsoluteError: maxAbs,
      meanSquaredError: mseSum / totalDimCount,
    };
  }

  return {
    modelName,
    dtype,
    prefix,
    embeddingDim: dim,
    tensorShapes: {
      beforePooling: shapeBefore,
      afterPooling: shapeAfter,
    },
    tokenStats,
    l2Norms,
    selfSimilarity: {
      en: selfSimEn,
      zh: selfSimZh,
    },
    similarityDistribution: {
      min: minVal,
      max: maxVal,
      mean: meanVal,
      stdDev: stdDev,
    },
    rankingMetrics: {
      recallAt1,
      recallAt5,
      mrr,
    },
    int8VsFp32Diff,
    pairwiseDetails,
  };
}
