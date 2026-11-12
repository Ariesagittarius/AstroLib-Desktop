/**
 * src/services/bilingual/aligner-client.ts
 * ============================================================================
 * AstroLib 双语对照与关联分析客户端调度中心 (Bilingual Aligner Client)
 * ============================================================================
 * 负责客户端：
 * 1. 依托 SemanticParagraphExtractor 从左右双栏文章 DOM 中提取结构化段落；
 * 2. 调度服务端/端侧推理端点（/__bilingual__/align）；
 * 3. 维护客户端结果缓存（避免重复滚动与对比时重复推理）；
 * 4. 计算综合矩阵统计、自适应阈值校准与未匹配状态探测。
 * ============================================================================
 */

import { BipartiteMatcher } from './bipartite-matcher.ts';
import { SemanticParagraphExtractor } from './semantic-extractor.ts';
import type { AlignmentMatrixResult, ParagraphLink, SemanticParagraph, BilingualModelInfo } from './types.ts';

export class BilingualAlignerClient {
  private static cache = new Map<string, AlignmentMatrixResult>();

  /**
   * 从 DOM 容器中提取结构化语义段落（依托 SemanticParagraphExtractor，彻底保护 KaTeX 公式与自愈 OCR 碎片）
   */
  static extractTokens(container: HTMLElement, prefix: 'src' | 'tgt'): SemanticParagraph[] {
    if (!container) return [];
    return SemanticParagraphExtractor.extractFromDom(container, {
      prefix,
      enableOcrHealing: true,
    });
  }

  /**
   * 查询当前服务支持的向量对齐模型清单
   */
  static async getAvailableModels(): Promise<BilingualModelInfo[]> {
    try {
      const resp = await fetch('/__bilingual__/models');
      if (resp.ok) {
        const data = await resp.json();
        if (Array.isArray(data.models)) {
          return data.models;
        }
      }
    } catch {
      // 离线环境静默使用内置预设
    }

    return [
      {
        id: 'minilm-l12',
        name: 'paraphrase-multilingual-MiniLM-L12-v2',
        label: 'MiniLM-L12 (轻量版 · CPU量化)',
        dim: 384,
        description: '极致轻量，纯 Node.js CPU/AVX2 推理，低配置设备首选',
        isAvailable: true,
        provider: 'onnx-node',
      },
      {
        id: 'qwen3-0.6b',
        name: 'Qwen/Qwen3-Embedding-0.6B',
        label: 'Qwen3-Embedding-0.6B (大参数增强版)',
        dim: 1024,
        description: '0.6B 参数大模型，因果自回归架构，消除各向异性锥状坍缩，跨语言语义区分度极高',
        isAvailable: true,
        provider: 'python-qwen',
      },
    ];
  }

  /**
   * 调度向量对齐计算（支持按需选择模型：轻量 MiniLM 或高精 Qwen3-Embedding）
   */
  static async computeAlignment(
    sources: SemanticParagraph[],
    targets: SemanticParagraph[],
    options: {
      threshold?: number;
      monotonicBias?: number;
      bypassCache?: boolean;
      model?: string;
    } = {}
  ): Promise<AlignmentMatrixResult> {
    const threshold = options.threshold ?? 0.6;
    const model = options.model || 'minilm-l12';
    const cacheKey = `${sources.map((s) => s.text.slice(0, 30)).join('|')}:::${targets.map((t) => t.text.slice(0, 30)).join('|')}:::${model}:::${threshold}`;

    if (!options.bypassCache && this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    const startTime = performance.now();

    try {
      // 发送至服务端端点
      const resp = await fetch('/__bilingual__/align', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceTexts: sources.map((s) => s.text),
          targetTexts: targets.map((t) => t.text),
          threshold,
          model,
        }),
      });

      if (resp.ok) {
        const data = await resp.json();
        const matrix = data.matrix as number[][];
        const stats = BipartiteMatcher.computeMatrixStats(matrix);

        const links = BipartiteMatcher.extractLinks(matrix, sources, targets, {
          threshold,
          monotonicBias: options.monotonicBias,
        });

        const { unmatchedSourceIds, unmatchedTargetIds } = BipartiteMatcher.findUnmatched(
          links,
          sources,
          targets
        );

        const result: AlignmentMatrixResult = {
          sourceParagraphs: sources,
          targetParagraphs: targets,
          matrix,
          links,
          unmatchedSourceIds,
          unmatchedTargetIds,
          stats,
          calibratedThreshold: stats.recommendedThreshold,
          inferenceTimeMs: data.inferenceTimeMs || Math.round(performance.now() - startTime),
          engine: data.engine || 'node-onnx',
          modelId: data.modelId || model,
          modelName: data.modelName,
          dim: data.dim,
          device: data.device,
          isFallback: data.isFallback,
          fallbackReason: data.fallbackReason,
        };

        this.cache.set(cacheKey, result);
        return result;
      }
    } catch {
      // 后台服务离线或未运行时的降级处理：使用轻量词法相似度兜底
    }

    // 本地降级轻量对齐（基于 Jaccard + 共有词元匹配）
    const matrix = this.fallbackLexicalMatrix(sources, targets);
    const stats = BipartiteMatcher.computeMatrixStats(matrix);
    const links = BipartiteMatcher.extractLinks(matrix, sources, targets, {
      threshold,
      monotonicBias: options.monotonicBias,
    });
    const { unmatchedSourceIds, unmatchedTargetIds } = BipartiteMatcher.findUnmatched(
      links,
      sources,
      targets
    );

    const result: AlignmentMatrixResult = {
      sourceParagraphs: sources,
      targetParagraphs: targets,
      matrix,
      links,
      unmatchedSourceIds,
      unmatchedTargetIds,
      stats,
      calibratedThreshold: stats.recommendedThreshold,
      inferenceTimeMs: Math.round(performance.now() - startTime),
      engine: 'lexical-fallback',
    };

    this.cache.set(cacheKey, result);
    return result;
  }

  /**
   * 计算机科学与数学高频跨语言双语同义词/同义概念词典
   */
  private static readonly CS_MATH_COGNATES: Record<string, string[]> = {
    prologue: ['序言', '前言'],
    preface: ['前言', '序言'],
    algorithm: ['算法'],
    algorithms: ['算法'],
    algorithmic: ['算法'],
    multiply: ['乘法', '相乘'],
    multiplication: ['乘法'],
    addition: ['加法'],
    divide: ['分治', '除法'],
    conquer: ['分治'],
    recurrence: ['递归'],
    recursion: ['递归'],
    recursive: ['递归'],
    complexity: ['复杂'],
    integer: ['整数'],
    integers: ['整数'],
    graph: ['图'],
    graphs: ['图论'],
    tree: ['树'],
    trees: ['树'],
    matrix: ['矩阵'],
    matrices: ['矩阵'],
    polynomial: ['多项'],
    theorem: ['定理'],
    proof: ['证明'],
    exercise: ['习题', '练习'],
    exercises: ['习题', '练习'],
    sort: ['排序'],
    sorting: ['排序'],
    search: ['搜索'],
    flow: ['网络流'],
    greedy: ['贪心'],
    dynamic: ['动态'],
    programming: ['规划'],
    linear: ['线性'],
    reduction: ['归约'],
    reductions: ['归约'],
    approximation: ['近似'],
    np: ['np'],
    dijkstra: ['dijkstra', '狄克斯特拉'],
    karatsuba: ['karatsuba', '卡拉楚巴'],
    rsa: ['rsa'],
  };

  /**
   * 提取中英文本中的跨语言词元特征集合（含数学公式、数值、拉丁专有词与汉字二元组）
   */
  public static tokenizeMultilingual(text: string): Set<string> {
    const tokens = new Set<string>();
    const lower = text.toLowerCase();

    // 1. 提取所有数值 (例如 02.1, 1960, 3, 1.585)
    const numbers = lower.match(/\b\d+(?:\.\d+)?\b/g);
    if (numbers) {
      numbers.forEach((n) => tokens.add(n));
    }

    // 2. 提取 LaTeX 数学公式表达式与核心符号
    const mathFormulas = lower.match(/\$[^$]+\$/g);
    if (mathFormulas) {
      mathFormulas.forEach((m) => {
        tokens.add(m.replace(/\s+/g, ''));
      });
    }

    // 3. 提取英文词汇并进行同源词映射
    const words = lower.match(/[a-z]{3,}/g);
    if (words) {
      words.forEach((w) => {
        tokens.add(w);
        const mappedZh = this.CS_MATH_COGNATES[w];
        if (mappedZh) {
          mappedZh.forEach((z) => tokens.add(z));
        }
      });
    }

    // 4. 提取中文汉字及连续二元字组 (Bigram)
    const zhChars = lower.match(/[\u4e00-\u9fa5]/g);
    if (zhChars) {
      zhChars.forEach((c) => tokens.add(c));
      for (let i = 0; i < zhChars.length - 1; i++) {
        tokens.add(zhChars[i] + zhChars[i + 1]);
      }
    }

    return tokens;
  }

  /**
   * 词法启发式备选矩阵构建（用于离线或服务未就绪时的无缝降级）
   */
  public static fallbackLexicalMatrix(
    sources: SemanticParagraph[],
    targets: SemanticParagraph[]
  ): number[][] {
    const M = sources.length;
    const N = targets.length;
    const matrix: number[][] = Array.from({ length: M }, () => new Array(N).fill(0));

    const srcSets = sources.map((s) => this.tokenizeMultilingual(s.text));
    const tgtSets = targets.map((t) => this.tokenizeMultilingual(t.text));

    for (let i = 0; i < M; i++) {
      const setA = srcSets[i];
      for (let j = 0; j < N; j++) {
        const setB = tgtSets[j];
        if (setA.size === 0 || setB.size === 0) continue;

        let common = 0;
        setA.forEach((w) => {
          if (setB.has(w)) common++;
        });

        const union = setA.size + setB.size - common;
        const jaccard = union > 0 ? common / union : 0;
        const minSize = Math.min(setA.size, setB.size);
        const overlap = minSize > 0 ? common / minSize : 0;
        const lexicalScore = jaccard * 0.4 + overlap * 0.6;

        // 局部位置亲和度
        const relPosA = M > 1 ? i / (M - 1) : 0;
        const relPosB = N > 1 ? j / (N - 1) : 0;
        const posProximity = Math.max(0, 1 - Math.abs(relPosA - relPosB) * 1.3);

        const sim = Math.max(0, Math.min(1, lexicalScore * 0.6 + posProximity * 0.4));
        matrix[i][j] = Math.round(sim * 1000) / 1000;
      }
    }

    return matrix;
  }
}
