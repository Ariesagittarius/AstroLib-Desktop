/**
 * src/features/search-rec/core/fusion/rrf-fusion.ts
 * 倒数排名融合算法 (Reciprocal Rank Fusion)
 * 工业界成熟方案：有效消除稠密向量、BM25 与图谱打分尺度的不一致
 */

import type { CandidateItem } from '../../types/candidate.ts';

export const DEFAULT_RRF_K = 60;

/**
 * 将多路召回通道输出的候选列表按 RRF 融合为单一有序候选列表
 * @param channelLists 各通道产生的候选集合数组 (每组已按通道内部得分从高到低排序)
 * @param k RRF 常数平滑项 (工业标准默认 60)
 */
export function fuseWithRrf(channelLists: CandidateItem[][], k = DEFAULT_RRF_K): CandidateItem[] {
  const mergedMap = new Map<string, {
    item: CandidateItem;
    rrfSum: number;
    hitChannels: Set<string>;
    bestTokens: Set<string>;
  }>();

  for (const list of channelLists) {
    for (let rank = 0; rank < list.length; rank++) {
      const candidate = list[rank];
      const chunkId = candidate.chunk.id;
      const rankPos = rank + 1; // 1-based rank
      const rrfIncrement = 1 / (k + rankPos);

      if (!mergedMap.has(chunkId)) {
        mergedMap.set(chunkId, {
          item: { ...candidate },
          rrfSum: rrfIncrement,
          hitChannels: new Set([candidate.channel]),
          bestTokens: new Set(candidate.matchedTokens || []),
        });
      } else {
        const record = mergedMap.get(chunkId)!;
        record.rrfSum += rrfIncrement;
        record.hitChannels.add(candidate.channel);
        if (candidate.matchedTokens) {
          for (const tok of candidate.matchedTokens) record.bestTokens.add(tok);
        }
      }
    }
  }

  const results: CandidateItem[] = [];
  for (const { item, rrfSum, hitChannels, bestTokens } of mergedMap.values()) {
    results.push({
      ...item,
      rrfScore: Number(rrfSum.toFixed(6)),
      matchedTokens: Array.from(bestTokens),
      recommendReason: hitChannels.size > 1
        ? `多路协同推荐 (${Array.from(hitChannels).join(' + ')})`
        : item.recommendReason,
    });
  }

  // 按 RRF 分数从高到低排序
  results.sort((a, b) => (b.rrfScore || 0) - (a.rrfScore || 0));

  return results;
}
