import type { CandidateItem } from '../../types/candidate.ts';

function chunkDomainSimilarity(a: CandidateItem, b: CandidateItem): number {
  if (a.chunk.id === b.chunk.id) return 1.0;
  if (a.chunk.bookSlug === b.chunk.bookSlug && a.chunk.chapterSlug === b.chunk.chapterSlug) {
    return 0.85;
  }
  if (a.chunk.bookSlug === b.chunk.bookSlug) {
    return 0.6;
  }
  if (a.chunk.colSlug === b.chunk.colSlug) {
    return 0.3;
  }
  return 0.05;
}

export function diversifyWithMmr(candidates: CandidateItem[], topK = 15, lambda = 0.65): CandidateItem[] {
  if (candidates.length <= 1) return candidates;

  const targetCount = Math.min(topK, candidates.length);
  const pool = [...candidates];
  const selected: CandidateItem[] = [];

  selected.push(pool.shift()!);

  while (selected.length < targetCount && pool.length > 0) {
    let bestIdx = -1;
    let bestMmrScore = -Infinity;

    for (let i = 0; i < pool.length; i++) {
      const candidate = pool[i];
      const relScore = candidate.rankScore || candidate.rrfScore || 0;

      let maxSim = 0;
      for (const s of selected) {
        const sim = chunkDomainSimilarity(candidate, s);
        if (sim > maxSim) maxSim = sim;
      }

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
