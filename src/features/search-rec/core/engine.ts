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
  private finalized = false;

  registerBook(
    bookChunks: AcademicChunk[],
    embeddingsBinary?: ArrayBuffer,
    graphData?: RelationGraphData,
  ): void {
    const freshChunks: AcademicChunk[] = [];
    const freshIndexes: number[] = [];
    bookChunks.forEach((c, i) => {
      if (!this.chunkMap.has(c.id)) {
        this.chunkMap.set(c.id, c);
        this.chunks.push(c);
        freshChunks.push(c);
        freshIndexes.push(i);
      }
    });

    if (embeddingsBinary && freshIndexes.length > 0) {
      try {
        const parsed = parseEmbeddingsBinary(embeddingsBinary);
        this.denseIndex.dim = parsed.dim;
        this.denseIndex.format = parsed.format;
        this.denseIndex.chunks.push(...freshChunks);
        if (parsed.format === 'int8' && parsed.int8Vectors) {
          const picked = freshIndexes.map((i) => parsed.int8Vectors![i]);
          this.denseIndex.int8Vectors = (this.denseIndex.int8Vectors || []).concat(picked);
        } else if (parsed.float32Vectors) {
          const picked = freshIndexes.map((i) => parsed.float32Vectors![i]);
          this.denseIndex.float32Vectors = (this.denseIndex.float32Vectors || []).concat(picked);
        }
      } catch (e) {
        console.warn('[search-rec] 向量解析异常:', e);
      }
    }

    if (!this.graphRetriever) {
      this.graphRetriever = new GraphRetriever(this.chunks, graphData);
    } else if (graphData) {
      this.graphRetriever.setGraph(graphData);
    }

    if (freshChunks.length > 0 || graphData) {
      this.finalized = false;
    }
  }

  finalize(): void {
    if (this.finalized) return;
    if (!this.fuzzyRetriever) {
      this.fuzzyRetriever = new FuzzyRetriever(this.chunks);
    } else if (this.fuzzyRetriever.size < this.chunks.length) {
      this.fuzzyRetriever.addChunks(this.chunks.slice(this.fuzzyRetriever.size));
    }
    this.denseRetriever = this.denseIndex.chunks.length ? new DenseRetriever(this.denseIndex) : null;
    this.finalized = true;
  }

  async finalizeAsync(batchSize = 2000): Promise<void> {
    if (this.finalized) return;
    if (!this.fuzzyRetriever) {
      this.fuzzyRetriever = new FuzzyRetriever();
    }
    const currentSize = this.fuzzyRetriever.size;
    const remainingChunks = this.chunks.slice(currentSize);
    for (let i = 0; i < remainingChunks.length; i += batchSize) {
      const slice = remainingChunks.slice(i, i + batchSize);
      this.fuzzyRetriever.addChunks(slice);
      if (typeof window !== 'undefined') {
        const yieldFn = (window as any).scheduler?.yield;
        if (typeof yieldFn === 'function') {
          await yieldFn.call((window as any).scheduler);
        } else {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
    }
    this.denseRetriever = this.denseIndex.chunks.length ? new DenseRetriever(this.denseIndex) : null;
    this.finalized = true;
  }

  private ensureFinalized(): void {
    if (!this.finalized) {
      this.finalize();
    }
  }

  getContextDiscoveryStream(context: UserLearningContext, limit = 10): CandidateItem[] {
    this.ensureFinalized();
    const { currentBookSlug, currentChapterSlug } = context;
    if (!currentBookSlug && this.chunks.length > 0) {

      const defs = this.chunks.filter((c) => c.type === '定理' || c.type === '定义').slice(0, limit);
      return defs.map((chunk, rank) => ({
        chunk,
        channel: 'scaffold',
        channelScore: 1.0,
        channelRank: rank + 1,
        recommendReason: '全书库精选核心概念',
      }));
    }

    let graphHits: CandidateItem[] = [];
    if (this.graphRetriever && currentBookSlug && currentChapterSlug) {
      const seedKey = `${currentBookSlug}/${currentChapterSlug}`;
      graphHits = this.graphRetriever.walk(seedKey, 15);
    }

    const companionHits: CandidateItem[] = [];
    for (const c of this.chunks) {

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

    const fused = fuseWithRrf([graphHits, companionHits]);
    const ranked = this.ranker.rank(fused, context);
    return diversifyWithMmr(ranked, limit, 0.6);
  }

  async search(
    query: SearchQuery,
    queryEmbedding?: Float32Array | number[],
  ): Promise<SearchResult> {
    this.ensureFinalized();
    const tStart = Date.now();
    const raw = query.raw.trim();
    const mode = query.mode;
    const topK = query.topK || 15;

    let candidateLists: CandidateItem[][] = [];

    if (mode === 'exact') {

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

      const fuzzyHits = this.fuzzyRetriever ? this.fuzzyRetriever.search(raw, 50) : [];
      return {
        query,
        items: fuzzyHits.slice(0, topK),
        totalMatches: fuzzyHits.length,
        timeMs: Date.now() - tStart,
        modeUsed: 'fuzzy',
      };
    }

    const exactCandidates = ExactRetriever.search(this.chunks, raw, 20);
    if (exactCandidates.length > 0) candidateLists.push(exactCandidates);

    if (this.fuzzyRetriever) {
      const fuzzyCandidates = this.fuzzyRetriever.search(raw, 30);
      if (fuzzyCandidates.length > 0) candidateLists.push(fuzzyCandidates);
    }

    if (this.denseRetriever && queryEmbedding) {
      const denseCandidates = this.denseRetriever.search(queryEmbedding, 40);
      if (denseCandidates.length > 0) candidateLists.push(denseCandidates);
    }

    if (this.graphRetriever && candidateLists.length > 0 && candidateLists[0].length > 0) {
      const topHit = candidateLists[0][0].chunk;
      const graphCandidates = this.graphRetriever.walk(topHit.id, 15);
      if (graphCandidates.length > 0) candidateLists.push(graphCandidates);
    }

    const fused = fuseWithRrf(candidateLists);

    const userContext: UserLearningContext = {
      currentBookSlug: query.contextBookSlug,
      currentChapterSlug: query.contextChapterSlug,
      currentColSlug: query.contextColSlug,
    };
    const ranked = this.ranker.rank(fused, userContext);

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
