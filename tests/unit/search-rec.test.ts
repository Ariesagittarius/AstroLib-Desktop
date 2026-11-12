/**
 * tests/unit/search-rec.test.ts
 * AstroLib 跨书知识整合与搜索推荐系统单元测试套件
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  quantizeToInt8,
  dequantizeFromInt8,
  dotProductFloatAndInt8,
  dotProductFloat32,
} from '../../src/features/search-rec/core/vector/quantizer.ts';
import { ExactRetriever } from '../../src/features/search-rec/core/retrieval/exact-retriever.ts';
import { FuzzyRetriever } from '../../src/features/search-rec/core/retrieval/fuzzy-retriever.ts';
import { DenseRetriever } from '../../src/features/search-rec/core/retrieval/dense-retriever.ts';
import { fuseWithRrf } from '../../src/features/search-rec/core/fusion/rrf-fusion.ts';
import { MultiTaskRanker } from '../../src/features/search-rec/core/ranking/multi-task-ranker.ts';
import { diversifyWithMmr } from '../../src/features/search-rec/core/reranking/mmr-diversifier.ts';
import { SearchRecEngine } from '../../src/features/search-rec/core/engine.ts';
import { serializeEmbeddingsBinary, parseEmbeddingsBinary } from '../../src/features/search-rec/services/storage.ts';
import type { AcademicChunk } from '../../src/features/search-rec/types/candidate.ts';

describe('Search & Recommendation Engine Unit Tests', () => {
  const sampleChunks: AcademicChunk[] = [
    {
      id: 'math-la-ch1-1',
      bookId: 'math-linear_algebra',
      colSlug: 'math',
      bookSlug: 'linear_algebra',
      bookTitle: '线性代数及其应用',
      chapterSlug: 'ch1_matrix',
      chapterTitle: '第一章 矩阵与线性方程组',
      kind: 'card',
      type: '定理',
      title: '定理 1.4 正交对角化充要条件',
      number: '1.4',
      text: '实对称矩阵必然可以正交对角化，其特征值全为实数。公式为 $A = Q \\Lambda Q^T$。',
      url: '/collections/math/linear_algebra/ch1_matrix/#定理-1.4',
      hasLatex: true,
      latexFormulas: ['A = Q \\Lambda Q^T', '\\det(A - \\lambda I) = 0'],
    },
    {
      id: 'math-ma-ch3-2',
      bookId: 'math-math_analysis',
      colSlug: 'math',
      bookSlug: 'math_analysis',
      bookTitle: '数学分析基础',
      chapterSlug: 'ch3_differential',
      chapterTitle: '第三章 微分中值定理',
      kind: 'card',
      type: '定理',
      title: '定理 3.2 柯西中值定理',
      number: '3.2',
      text: '设函数 f 与 g 在闭区间连续且可导，则存在一点使得 $[f(b)-f(a)]g\'(\\xi) = [g(b)-g(a)]f\'(\\xi)$。',
      url: '/collections/math/math_analysis/ch3_differential/#定理-3.2',
      hasLatex: true,
      latexFormulas: ['\\frac{f\'(\\xi)}{g\'(\\xi)} = \\frac{f(b)-f(a)}{g(b)-g(a)}'],
    },
    {
      id: 'telecom-cp-ch4-1',
      bookId: 'telecom-communication_principles',
      colSlug: 'telecom',
      bookSlug: 'communication_principles',
      bookTitle: '通信原理第5版',
      chapterSlug: 'ch4_fourier',
      chapterTitle: '第四章 频域传输与信道容量',
      kind: 'card',
      type: '例题',
      title: '例题 4.1 香农公式信道容量计算',
      number: '4.1',
      text: '计算高斯白噪声信道下的极限信道容量：$C = B \\log_2(1 + \\frac{S}{N})$。',
      url: '/collections/telecom/communication_principles/ch4_fourier/#例题-4.1',
      hasLatex: true,
      latexFormulas: ['C = B \\log_2(1 + \\frac{S}{N})'],
    },
  ];

  describe('1. Int8 量化与二进制反量化保真度', () => {
    it('应实现 Int8 对称标量量化且反量化保真度 > 0.999', () => {
      const original = new Float32Array([0.15, -0.42, 0.88, -0.99, 0.05, 0.0, 0.33]);
      const { data, scale } = quantizeToInt8(original);

      expect(data).toBeInstanceOf(Int8Array);
      expect(scale).toBeGreaterThan(0);

      const restored = dequantizeFromInt8(data, scale);
      const dot = dotProductFloat32(original, restored);
      const normA = Math.sqrt(dotProductFloat32(original, original));
      const normB = Math.sqrt(dotProductFloat32(restored, restored));
      const cosSim = dot / (normA * normB);

      expect(cosSim).toBeGreaterThan(0.999);
    });

    it('Float32 与 Int8 直接内积应与反量化内积结果一致', () => {
      const q = new Float32Array([0.2, -0.5, 0.8, -0.1]);
      const doc = new Float32Array([0.1, -0.3, 0.9, 0.4]);
      const { data, scale } = quantizeToInt8(doc);

      const directDot = dotProductFloatAndInt8(q, data, scale);
      const restored = dequantizeFromInt8(data, scale);
      const restoredDot = dotProductFloat32(q, restored);

      expect(Math.abs(directDot - restoredDot)).toBeLessThan(1e-5);
    });

    it('ABP1 二进制文件序列化与解析应完整保留格式与维度', () => {
      const v1 = new Float32Array([0.1, 0.2, 0.3, 0.4]);
      const v2 = new Float32Array([-0.5, 0.6, -0.7, 0.8]);
      const { buffer, dim, count } = serializeEmbeddingsBinary([v1, v2], 'int8');

      expect(dim).toBe(4);
      expect(count).toBe(2);

      const parsed = parseEmbeddingsBinary(buffer as ArrayBuffer);
      expect(parsed.dim).toBe(4);
      expect(parsed.count).toBe(2);
      expect(parsed.format).toBe('int8');
      expect(parsed.int8Vectors).toBeDefined();
      expect(parsed.int8Vectors!.length).toBe(2);
    });
  });

  describe('2. 精确搜索通道 (ExactRetriever)', () => {
    it('精准命中 LaTeX 公式源码', () => {
      const hits = ExactRetriever.search(sampleChunks, 'A = Q \\Lambda Q^T');
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0].chunk.id).toBe('math-la-ch1-1');
      expect(hits[0].channel).toBe('lexical');
    });

    it('精准命中定理编号 (定理 3.2)', () => {
      const hits = ExactRetriever.search(sampleChunks, '定理 3.2');
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0].chunk.title).toContain('柯西中值定理');
    });

    it('精准命中公式 Tag 编号', () => {
      const hits = ExactRetriever.search(sampleChunks, '式 4.1');
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0].chunk.id).toBe('telecom-cp-ch4-1');
    });
  });

  describe('3. 传统模糊搜索通道 (FuzzyRetriever)', () => {
    it('BM25 正确召回中文字词并按相关度排序', () => {
      const retriever = new FuzzyRetriever(sampleChunks);
      const hits = retriever.search('矩阵 线性方程组');
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0].chunk.id).toBe('math-la-ch1-1');
    });

    it('多关键词检索能正确累加权重', () => {
      const retriever = new FuzzyRetriever(sampleChunks);
      const hits = retriever.search('香农公式 信道容量 高斯白噪声');
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0].chunk.id).toBe('telecom-cp-ch4-1');
    });
  });

  describe('4. RRF 倒数排名融合算法 (fuseWithRrf)', () => {
    it('多通道协同命中的候选应获得显著的分数提升', () => {
      const channel1 = [
        { chunk: sampleChunks[0], channel: 'dense' as const, channelScore: 0.95, channelRank: 1 },
        { chunk: sampleChunks[1], channel: 'dense' as const, channelScore: 0.80, channelRank: 2 },
      ];
      const channel2 = [
        { chunk: sampleChunks[1], channel: 'lexical' as const, channelScore: 100, channelRank: 1 },
        { chunk: sampleChunks[0], channel: 'lexical' as const, channelScore: 50, channelRank: 2 },
      ];

      const fused = fuseWithRrf([channel1, channel2], 60);
      expect(fused.length).toBe(2);
      expect(fused[0].rrfScore).toBeDefined();
      expect(fused[0].recommendReason).toContain('多路协同推荐');
    });
  });

  describe('5. MMR 跨书多样性去重重排 (diversifyWithMmr)', () => {
    it('应有效惩罚同书连续堆叠，提升跨书多样性', () => {
      const duplicateBookChunks = [
        { chunk: sampleChunks[0], channel: 'dense' as const, channelScore: 0.95, channelRank: 1, rankScore: 0.95 },
        // 伪造一条来自同一本书的切片
        {
          chunk: { ...sampleChunks[0], id: 'math-la-ch1-2', title: '定理 1.5 伴随矩阵' },
          channel: 'dense' as const,
          channelScore: 0.94,
          channelRank: 2,
          rankScore: 0.94,
        },
        // 来自不同书的切片 (虽然分数略低一点)
        { chunk: sampleChunks[2], channel: 'dense' as const, channelScore: 0.90, channelRank: 3, rankScore: 0.90 },
      ];

      const diversified = diversifyWithMmr(duplicateBookChunks, 3, 0.5);
      expect(diversified.length).toBe(3);
      // 第 2 条应优先选不同书目的切片 (telecom-cp-ch4-1)
      expect(diversified[1].chunk.bookSlug).toBe('communication_principles');
    });
  });

  describe('6. 统一编排引擎 (SearchRecEngine)', () => {
    let engine: SearchRecEngine;

    beforeEach(() => {
      engine = new SearchRecEngine();
      engine.registerBook(sampleChunks);
    });

    it('精确模式应只返回精确命中结果', async () => {
      const res = await engine.search({
        raw: '定理 3.2',
        mode: 'exact',
      });
      expect(res.modeUsed).toBe('exact');
      expect(res.items.length).toBeGreaterThan(0);
      expect(res.items[0].chunk.title).toContain('柯西中值定理');
    });

    it('模糊模式应只返回 BM25 词法命中结果', async () => {
      const res = await engine.search({
        raw: '信道容量',
        mode: 'fuzzy',
      });
      expect(res.modeUsed).toBe('fuzzy');
      expect(res.items.length).toBeGreaterThan(0);
      expect(res.items[0].chunk.bookSlug).toBe('communication_principles');
    });

    it('首屏即时上下文探索流应基于当前阅读书籍产生跨书拓展推荐', () => {
      const stream = engine.getContextDiscoveryStream({
        currentBookSlug: 'linear_algebra',
        currentChapterSlug: 'ch1_matrix',
      }, 5);

      expect(stream.length).toBeGreaterThan(0);
      // 应包含跨书建议
      const crossBook = stream.find((item) => item.chunk.bookSlug !== 'linear_algebra');
      expect(crossBook).toBeDefined();
    });
  });
});
