/**
 * src/features/search-rec/core/vector/similarity.ts
 * 向量相似度与距离度量
 */

import { dotProductFloat32 } from './quantizer.ts';

/**
 * 计算向量 L2 范数 (模长)
 */
export function vectorNorm(v: Float32Array | number[]): number {
  let sumSq = 0;
  for (let i = 0; i < v.length; i++) {
    sumSq += v[i] * v[i];
  }
  return Math.sqrt(sumSq);
}

/**
 * 向量归一化 (原地或新数组)
 */
export function normalizeVector(v: Float32Array | number[]): Float32Array {
  const norm = vectorNorm(v);
  const out = new Float32Array(v.length);
  if (norm === 0) return out;
  for (let i = 0; i < v.length; i++) {
    out[i] = v[i] / norm;
  }
  return out;
}

/**
 * 余弦相似度
 */
export function cosineSimilarity(a: Float32Array | number[], b: Float32Array | number[]): number {
  const normA = vectorNorm(a);
  const normB = vectorNorm(b);
  if (normA === 0 || normB === 0) return 0;
  return dotProductFloat32(a, b) / (normA * normB);
}
