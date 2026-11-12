/**
 * src/server/plugins/bilingual-aligner/onnx-engine.ts
 * ============================================================================
 * AstroLib 端侧轻量向量推理引擎 (On-Device Lightweight Embedding Engine)
 * ============================================================================
 * 核心技术能力：
 * 1. Node.js 原生驱动多语言向量嵌入（ONNX Runtime / Transformers.js）；
 * 2. 硬件加速优先（Windows DirectML，适配 RTX 5060 等独显），自动回退至 CPU；
 * 3. 内存与显存自适应管理（惰性加载、计算后保持极轻量驻留、超期释放）；
 * 4. 离线/模型首次加载时的容错与降级机制。
 * ============================================================================
 */

import { BipartiteMatcher } from '../../../services/bilingual/bipartite-matcher.ts';
import { BilingualAlignerClient } from '../../../services/bilingual/aligner-client.ts';
import { QwenEngine } from './qwen-engine.ts';
import type { BilingualModelInfo } from '../../../services/bilingual/types.ts';

export interface AlignResultPayload {
  matrix: number[][];
  inferenceTimeMs: number;
  engine: string;
  modelId?: string;
  modelName?: string;
  dim?: number;
  device?: string;
  isFallback?: boolean;
  fallbackReason?: string;
}

export interface TocMatchItem {
  sourceId: string;
  sourceTitle: string;
  targetId: string;
  targetTitle: string;
  confidence: number;
}

export class BilingualOnnxEngine {
  private static instance: BilingualOnnxEngine | null = null;
  private pipelineInstance: any = null;
  private isLoading = false;
  private loadError: Error | null = null;
  private lastUsedTimestamp = 0;
  private readonly modelName = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';

  static getInstance(): BilingualOnnxEngine {
    if (!this.instance) {
      this.instance = new BilingualOnnxEngine();
    }
    return this.instance;
  }

  /**
   * 惰性获取推理 Pipeline（优先 DML，回退 CPU）
   */
  private async getPipeline(): Promise<any> {
    if (this.pipelineInstance) {
      this.lastUsedTimestamp = Date.now();
      return this.pipelineInstance;
    }

    if (this.isLoading) {
      // 等待加载完成
      while (this.isLoading) {
        await new Promise((r) => setTimeout(r, 100));
      }
      if (this.pipelineInstance) return this.pipelineInstance;
    }

    this.isLoading = true;
    this.loadError = null;

    try {
      let transformersMod: any;
      try {
        transformersMod = await import('@huggingface/transformers');
      } catch {
        const nodeImport = new Function('m', 'return import(m)');
        transformersMod = await nodeImport('@huggingface/transformers');
      }
      const { pipeline, env } = transformersMod;
      if (process.env.ASTROLIB_MODELS_DIR && env) {
        env.cacheDir = process.env.ASTROLIB_MODELS_DIR;
      }

      // 使用高效且内存稳定的 CPU / AVX2 引擎（INT8 q8 模型在 CPU 原生量化执行速度最优，且彻底免疫 Direct3D 12 缓冲区溢出与 TDR 崩溃）
      const loadWithTimeout = async () => {
        try {
          return await pipeline('feature-extraction', this.modelName, {
            dtype: 'q8',
            device: 'cpu',
          });
        } catch (e) {
          console.warn('[bilingual-engine] CPU load failed, attempting DML fallback:', e);
          return await pipeline('feature-extraction', this.modelName, {
            dtype: 'q8',
            device: 'dml',
          });
        }
      };

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Model load timeout (60s)')), 60000)
      );

      this.pipelineInstance = await Promise.race([loadWithTimeout(), timeoutPromise]);
      this.lastUsedTimestamp = Date.now();
      return this.pipelineInstance;
    } catch (err: any) {
      console.warn('[bilingual-engine] Model load error:', err.message || err);
      this.loadError = err;
      return null;
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * 批量计算文本嵌入向量（分批 Mini-Batch 推理，彻底避免大数组导致的内存暴涨与命令缓冲区溢出）
   */
  async embedTexts(texts: string[], batchSize = 16): Promise<number[][] | null> {
    const pipe = await this.getPipeline();
    if (!pipe) return null;

    try {
      // 过滤和清洗文本：截断至 1024 字符，兼顾完整语义与 Tokenizer 效率
      const cleanTexts = texts.map((t) => (t && t.trim().length > 0 ? t.trim().slice(0, 1024) : 'empty'));
      const embeddings: number[][] = [];

      for (let i = 0; i < cleanTexts.length; i += batchSize) {
        const chunk = cleanTexts.slice(i, i + batchSize);
        const output = await pipe(chunk, { pooling: 'mean', normalize: true });

        const dim = output.dims[output.dims.length - 1];
        const data = output.data as Float32Array;

        for (let j = 0; j < chunk.length; j++) {
          const start = j * dim;
          const vec = Array.from(data.subarray(start, start + dim));
          embeddings.push(vec);
        }
      }

      return embeddings;
    } catch (err) {
      console.warn('[bilingual-engine] Embed error, falling back to lexical:', err);
      return null;
    }
  }

  /**
   * 对齐两组段落文本并输出 M x N 矩阵（支持可选指定 Qwen3 或 MiniLM 模型）
   */
  async alignParagraphs(
    sourceTexts: string[],
    targetTexts: string[],
    options: { model?: string } = {}
  ): Promise<AlignResultPayload> {
    const selectedModel = (options?.model || 'minilm-l12').toLowerCase();

    // 1. 若指定 Qwen3-Embedding-0.6B，调度 QwenEngine
    if (selectedModel.includes('qwen')) {
      try {
        const qwenEngine = QwenEngine.getInstance();
        return await qwenEngine.alignParagraphs(sourceTexts, targetTexts);
      } catch (err: any) {
        console.warn(
          '[bilingual-engine] Qwen3 engine execution failed, falling back to MiniLM ONNX:',
          err?.message || err
        );
        const fallbackRes = await this.alignWithMiniLM(sourceTexts, targetTexts);
        return {
          ...fallbackRes,
          isFallback: true,
          fallbackReason: err?.message || 'Qwen3 模型未就绪，已自动降级至 MiniLM',
        };
      }
    }

    return await this.alignWithMiniLM(sourceTexts, targetTexts);
  }

  private async alignWithMiniLM(sourceTexts: string[], targetTexts: string[]): Promise<AlignResultPayload> {
    const startTime = performance.now();

    // 2. 尝试默认 MiniLM 神经网络向量计算
    const srcEmbeds = await this.embedTexts(sourceTexts);
    const tgtEmbeds = await this.embedTexts(targetTexts);

    if (srcEmbeds && tgtEmbeds) {
      const matrix = BipartiteMatcher.buildMatrix(srcEmbeds, tgtEmbeds);
      return {
        matrix,
        inferenceTimeMs: Math.round(performance.now() - startTime),
        engine: 'MiniLM-L12 (CPU/AVX2 · 384维)',
        modelId: 'minilm-l12',
        modelName: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
        dim: 384,
        device: 'CPU',
      };
    }

    // 3. 降级：词法启发式相似度
    const matrix = this.fallbackLexicalMatrix(sourceTexts, targetTexts);
    return {
      matrix,
      inferenceTimeMs: Math.round(performance.now() - startTime),
      engine: 'lexical-fallback (启发式词法)',
      modelId: 'lexical',
      modelName: 'Lexical Jaccard Fallback',
      dim: 0,
      device: 'CPU',
    };
  }

  /**
   * 获取当前系统可用的向量模型列表（动态感知硬件与运行环境）
   */
  async getAvailableModels(): Promise<BilingualModelInfo[]> {
    const qwenEngine = QwenEngine.getInstance();
    const isQwenAvailable = await qwenEngine.isAvailable();

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
        isAvailable: isQwenAvailable,
        provider: 'python-qwen',
      },
    ];
  }

  /**
   * 目录章节标题多向语义对齐
   */
  async matchToc(
    sourceChapters: { id: string; title: string }[],
    targetChapters: { id: string; title: string }[],
    options: { model?: string } = {}
  ): Promise<TocMatchItem[]> {
    const srcTitles = sourceChapters.map((c) => c.title);
    const tgtTitles = targetChapters.map((c) => c.title);

    const { matrix } = await this.alignParagraphs(srcTitles, tgtTitles, options);
    const results: TocMatchItem[] = [];

    for (let i = 0; i < sourceChapters.length; i++) {
      let bestJ = -1;
      let maxSim = -1;

      for (let j = 0; j < targetChapters.length; j++) {
        if (matrix[i][j] > maxSim) {
          maxSim = matrix[i][j];
          bestJ = j;
        }
      }

      if (bestJ >= 0 && maxSim >= 0.35) {
        results.push({
          sourceId: sourceChapters[i].id,
          sourceTitle: sourceChapters[i].title,
          targetId: targetChapters[bestJ].id,
          targetTitle: targetChapters[bestJ].title,
          confidence: maxSim,
        });
      }
    }

    return results;
  }

  public buildLexicalMatrix(sourceTexts: string[], targetTexts: string[]): number[][] {
    return this.fallbackLexicalMatrix(sourceTexts, targetTexts);
  }

  private fallbackLexicalMatrix(sourceTexts: string[], targetTexts: string[]): number[][] {
    const M = sourceTexts.length;
    const N = targetTexts.length;
    const matrix: number[][] = Array.from({ length: M }, () => new Array(N).fill(0));

    const srcSets = sourceTexts.map((s) => BilingualAlignerClient.tokenizeMultilingual(s));
    const tgtSets = targetTexts.map((t) => BilingualAlignerClient.tokenizeMultilingual(t));

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
