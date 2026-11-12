/**
 * src/features/search-rec/core/engine.ts
 * 统一搜索与推荐核心编排引擎 (Unified Search & Recommendation Engine)
 */

import type { AcademicChunk, CandidateItem } from '../types/candidate.ts';
import type { SearchQuery, SearchResult, SearchMode } from '../types/search.ts';
import type { UserLearningContext } from '../types/recommendation.ts';
import { ExactRetriever } from './retrieval/exact-retriever.ts';
import { FuzzyRetriever } from './retrieval/fuzzy-retriever.ts';
import { DenseRetriever, type DenseVectorIndex } from './retrieval/dense-retriever.ts';
import { GraphRetriever, type RelationGraphData } from './retrieval/graph-retriever.ts';
import { fuseWithRrf } from './fusion/rrf-fusion.ts';
import { MultiTaskRanker } from './ranking/multi-task-ranker.ts';
import { diversifyWithMmr } from './reranking/mmr-diversifier.ts';
import { parseEmbeddingsBinary } from '../services/storage.ts';

export class SearchRecEngine {
  private chunks: AcademicChunk[] = [];
  private chunkMap: Map<string, AcademicChunk> = new Map();
  private fuzzyRetriever: FuzzyRetriever | null = null;
  private denseRetriever: DenseRetriever | null = null;
  private graphRetriever: GraphRetriever | null = null;
  private ranker: MultiTaskRanker = new MultiTaskRanker();
  private denseIndex: DenseVectorIndex = {
    dim: 512,
    format: 'int8',
    chunks: [],
    int8Vectors: [],
  };

  /**
   * 注册图书切片、向量与图谱数据
   */
  registerBook(
    bookChunks: AcademicChunk[],
    embeddingsBinary?: ArrayBuffer,
    graphData?: RelationGraphData,
  ): void {
    for (const c of bookChunks) {
      if (!this.chunkMap.has(c.id)) {
        this.chunkMap.set(c.id, c);
        this.chunks.push(c);
      }
    }

    // 重建模糊检索器
    this.fuzzyRetriever = new FuzzyRetriever(this.chunks);

    // 载入或追加向量
    if (embeddingsBinary) {
      try {
        const parsed = parseEmbeddingsBinary(embeddingsBinary);
        this.denseIndex.dim = parsed.dim;
        this.denseIndex.format = parsed.format;
        this.denseIndex.chunks.push(...bookChunks);
        if (parsed.format === 'int8' && parsed.int8Vectors) {
          this.denseIndex.int8Vectors = (this.denseIndex.int8Vectors || []).concat(parsed.int8Vectors);
        } else if (parsed.float32Vectors) {
          this.denseIndex.float32Vectors = (this.denseIndex.float32Vectors || []).concat(parsed.float32Vectors);
        }
        this.denseRetriever = new DenseRetriever(this.denseIndex);
      } catch (e) {
        console.warn('[search-rec] 向量解析异常:', e);
      }
    }

    // 更新知识图谱
    if (!this.graphRetriever) {
      this.graphRetriever = new GraphRetriever(this.chunks, graphData);
    } else if (graphData) {
      this.graphRetriever.setGraph(graphData);
    }
  }

  /**
   * 首屏无输入态：即时上下文探索流 (Context-Aware Discovery Stream)
   * 以读者当前阅读的章节/书目为锚点，召回跨学科前置、推导与配套习题
   */
  getContextDiscoveryStream(context: UserLearningContext, limit = 10): CandidateItem[] {
    const { currentBookSlug, currentChapterSlug } = context;
    if (!currentBookSlug && this.chunks.length > 0) {
      // 若无上下文，展现核心定理与典型例题
      const defs = this.chunks.filter((c) => c.type === '定理' || c.type === '定义').slice(0, limit);
      return defs.map((chunk, rank) => ({
        chunk,
        channel: 'scaffold',
        channelScore: 1.0,
        channelRank: rank + 1,
        recommendReason: '全书库精选核心概念',
      }));
    }

    // 1. 图谱拓扑召回
    let graphHits: CandidateItem[] = [];
    if (this.graphRetriever && currentBookSlug && currentChapterSlug) {
      const seedKey = `${currentBookSlug}/${currentChapterSlug}`;
      graphHits = this.graphRetriever.walk(seedKey, 15);
    }

    // 2. 章节同位与跨书启发式召回
    const companionHits: CandidateItem[] = [];
    for (const c of this.chunks) {
      // 跨书推荐：在其他书籍中同属于该学科核心定理或例题的切片
      if (c.bookSlug !== currentBookSlug && (c.type === '定理' || c.type === '例题' || c.type === '定义')) {
        companionHits.push({
          chunk: c,
          channel: 'scaffold',
          channelScore: 0.8,
          channelRank: companionHits.length + 1,
          recommendReason: `跨学科拓展: ${c.bookTitle}`,
        });
        if (companionHits.length >= 10) break;
      }
    }

    // 融合并 MMR 重排
    const fused = fuseWithRrf([graphHits, companionHits]);
    const ranked = this.ranker.rank(fused, context);
    return diversifyWithMmr(ranked, limit, 0.6);
  }

  /**
   * 用户有输入时的检索与推荐主方法
   */
  async search(
    query: SearchQuery,
    queryEmbedding?: Float32Array | number[],
  ): Promise<SearchResult> {
    const tStart = Date.now();
    const raw = query.raw.trim();
    const mode = query.mode;
    const topK = query.topK || 15;

    let candidateLists: CandidateItem[][] = [];

    if (mode === 'exact') {
      // 精确模式：仅执行严格 AST / Tag / 符号匹配
      const exactHits = ExactRetriever.search(this.chunks, raw, 50);
      if (exactHits.length > 0) {
        return {
          query,
          items: exactHits.slice(0, topK),
          totalMatches: exactHits.length,
          timeMs: Date.now() - tStart,
          modeUsed: 'exact',
        };
      }

      // 友好容错：若未命中公式或编号语法，自动执行智能词法补充并提示
      const fallbackHits = this.fuzzyRetriever ? this.fuzzyRetriever.search(raw, topK) : [];
      fallbackHits.forEach((hit) => {
        hit.recommendReason = '未匹配到公式或编号，自动转为词法检索';
      });
      return {
        query,
        items: fallbackHits,
        totalMatches: fallbackHits.length,
        timeMs: Date.now() - tStart,
        modeUsed: 'exact',
      };
    }

    if (mode === 'fuzzy') {
      // 模糊模式：仅执行极速 BM25 + 拼音 CJK 检索
      const fuzzyHits = this.fuzzyRetriever ? this.fuzzyRetriever.search(raw, 50) : [];
      return {
        query,
        items: fuzzyHits.slice(0, topK),
        totalMatches: fuzzyHits.length,
        timeMs: Date.now() - tStart,
        modeUsed: 'fuzzy',
      };
    }

    // ------------------------------------------------------------------------
    // 语义与推荐模式 (Neural Semantic & Recommendation Mode)
    // 执行前沿工业级四路召回与多阶段排序
    // ------------------------------------------------------------------------

    // 通道 1: 精确与词法补充
    const exactCandidates = ExactRetriever.search(this.chunks, raw, 20);
    if (exactCandidates.length > 0) candidateLists.push(exactCandidates);

    // 通道 2: BM25 词法
    if (this.fuzzyRetriever) {
      const fuzzyCandidates = this.fuzzyRetriever.search(raw, 30);
      if (fuzzyCandidates.length > 0) candidateLists.push(fuzzyCandidates);
    }

    // 通道 3: 稠密语义向量 (若提供了查询向量)
    if (this.denseRetriever && queryEmbedding) {
      const denseCandidates = this.denseRetriever.search(queryEmbedding, 40);
      if (denseCandidates.length > 0) candidateLists.push(denseCandidates);
    }

    // 通道 4: 知识图谱游走 (以词法命中的首个切片为锚点)
    if (this.graphRetriever && candidateLists.length > 0 && candidateLists[0].length > 0) {
      const topHit = candidateLists[0][0].chunk;
      const graphCandidates = this.graphRetriever.walk(topHit.id, 15);
      if (graphCandidates.length > 0) candidateLists.push(graphCandidates);
    }

    // 阶段 2: RRF 融合
    const fused = fuseWithRrf(candidateLists);

    // 阶段 3: 多目标精排
    const userContext: UserLearningContext = {
      currentBookSlug: query.contextBookSlug,
      currentChapterSlug: query.contextChapterSlug,
      currentColSlug: query.contextColSlug,
    };
    const ranked = this.ranker.rank(fused, userContext);

    // 阶段 4: MMR 跨书多样性去重重排
    const diverseItems = diversifyWithMmr(ranked, topK, 0.65);

    return {
      query,
      items: diverseItems,
      totalMatches: fused.length,
      timeMs: Date.now() - tStart,
      modeUsed: 'neural',
    };
  }
}
