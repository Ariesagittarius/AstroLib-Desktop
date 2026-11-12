/**
 * src/features/search-rec/core/retrieval/dense-retriever.ts
 * 稠密语义向量双塔检索通道 (支持 Int8 与 Float32 统一检索)
 */

import type { AcademicChunk, CandidateItem } from '../../types/candidate.ts';
import { dotProductFloatAndInt8, dotProductFloat32 } from '../vector/quantizer.ts';

export interface DenseVectorIndex {
  dim: number;
  format: 'int8' | 'float32';
  chunks: AcademicChunk[];
  // Int8 模式: 每项为 scale 和 Int8Array
  int8Vectors?: Array<{ scale: number; data: Int8Array }>;
  // Float32 模式: 每项为 Float32Array
  float32Vectors?: Float32Array[];
}

export class DenseRetriever {
  private index: DenseVectorIndex;

  constructor(index: DenseVectorIndex) {
    this.index = index;
  }

  /**
   * 使用用户查询向量对全库切片执行最近邻相似度检索
   * @param queryVec 归一化的 Float32 查询向量
   * @param limit 返回 Top-K 数量
   */
  search(queryVec: Float32Array | number[], limit = 50): CandidateItem[] {
    const { chunks, format, int8Vectors, float32Vectors } = this.index;
    if (chunks.length === 0) return [];

    const scored: Array<{ chunk: AcademicChunk; score: number }> = [];

    if (format === 'int8' && int8Vectors) {
      for (let i = 0; i < chunks.length; i++) {
        const docVec = int8Vectors[i];
        if (!docVec) continue;
        const score = dotProductFloatAndInt8(queryVec, docVec.data, docVec.scale);
        scored.push({ chunk: chunks[i], score });
      }
    } else if (float32Vectors) {
      for (let i = 0; i < chunks.length; i++) {
        const docVec = float32Vectors[i];
        if (!docVec) continue;
        const score = dotProductFloat32(queryVec, docVec);
        scored.push({ chunk: chunks[i], score });
      }
    }

    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, limit).map((item, rank) => ({
      chunk: item.chunk,
      channel: 'dense',
      channelScore: Number(item.score.toFixed(4)),
      channelRank: rank + 1,
      recommendReason: `语义相关度: ${(Math.max(0, item.score) * 100).toFixed(0)}%`,
    }));
  }
}
