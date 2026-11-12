/**
 * src/features/search-rec/core/reranking/mmr-diversifier.ts
 * MMR (Maximal Marginal Relevance) 跨书与跨学科多样性重排算法
 */

import type { CandidateItem } from '../../types/candidate.ts';

/**
 * 计算两个知识切片之间的领域重叠相似度 (用于去重惩罚)
 */
function chunkDomainSimilarity(a: CandidateItem, b: CandidateItem): number {
  if (a.chunk.id === b.chunk.id) return 1.0;
  if (a.chunk.bookSlug === b.chunk.bookSlug && a.chunk.chapterSlug === b.chunk.chapterSlug) {
    return 0.85; // 同一小节
  }
  if (a.chunk.bookSlug === b.chunk.bookSlug) {
    return 0.6; // 同一本书
  }
  if (a.chunk.colSlug === b.chunk.colSlug) {
    return 0.3; // 同一学科 (如都属于数学)
  }
  return 0.05; // 跨学科完全独立
}

/**
 * MMR 贪心多样性选择重排
 * @param candidates 精排后的候选集
 * @param topK 需要返回的数量
 * @param lambda 相关性与多样性的权衡因子 (0.7 偏重相关性，0.3 偏重多样性，默认 0.65)
 */
export function diversifyWithMmr(candidates: CandidateItem[], topK = 15, lambda = 0.65): CandidateItem[] {
  if (candidates.length <= 1) return candidates;

  const targetCount = Math.min(topK, candidates.length);
  const pool = [...candidates];
  const selected: CandidateItem[] = [];

  // 第 1 条直接选精排最高分
  selected.push(pool.shift()!);

  while (selected.length < targetCount && pool.length > 0) {
    let bestIdx = -1;
    let bestMmrScore = -Infinity;

    for (let i = 0; i < pool.length; i++) {
      const candidate = pool[i];
      const relScore = candidate.rankScore || candidate.rrfScore || 0;

      // 计算与已选择集合的最大相似度
      let maxSim = 0;
      for (const s of selected) {
        const sim = chunkDomainSimilarity(candidate, s);
        if (sim > maxSim) maxSim = sim;
      }

      // MMR 效用公式
      const mmrScore = lambda * relScore - (1 - lambda) * maxSim;

      if (mmrScore > bestMmrScore) {
        bestMmrScore = mmrScore;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0) {
      selected.push(pool.splice(bestIdx, 1)[0]);
    } else {
      break;
    }
  }

  return selected;
}
