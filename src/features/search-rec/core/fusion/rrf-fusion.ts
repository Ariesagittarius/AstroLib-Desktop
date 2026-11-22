import type { CandidateItem } from '../../types/candidate.ts';

export const DEFAULT_RRF_K = 60;

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
      const rankPos = rank + 1;
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

  results.sort((a, b) => (b.rrfScore || 0) - (a.rrfScore || 0));

  return results;
}
