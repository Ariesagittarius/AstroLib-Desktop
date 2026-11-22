import type { CandidateItem } from '../../types/candidate.ts';
import type { UserLearningContext, RecommendationWeights } from '../../types/recommendation.ts';
import { DEFAULT_REC_WEIGHTS } from '../../types/recommendation.ts';

export class MultiTaskRanker {
  private weights: RecommendationWeights;

  constructor(weights: RecommendationWeights = DEFAULT_REC_WEIGHTS) {
    this.weights = weights;
  }

  rank(candidates: CandidateItem[], context?: UserLearningContext): CandidateItem[] {
    const { wRead, wDwell, wPractice, wCrossBook } = this.weights;
    const currentBook = context?.currentBookSlug || '';

    const scored = candidates.map((item) => {
      const chunk = item.chunk;

      const pRead = Math.min(1.0, (item.rrfScore || 0) * 30);

      let pDwell = 0.2;
      if (chunk.hasLatex || (chunk.latexFormulas && chunk.latexFormulas.length > 0)) {
        pDwell += 0.4;
      }
      if (chunk.type === '定理' || chunk.type === '推论' || chunk.type === '引理' || chunk.text.includes('证明')) {
        pDwell += 0.3;
      }
      pDwell = Math.min(1.0, pDwell);

      let pPractice = 0.1;
      if (chunk.type === '例题' || chunk.type === '例' || chunk.kind === 'exercise' || chunk.type.includes('题')) {
        pPractice = 0.85;
      }

      let pCrossBook = 0.1;
      if (currentBook && chunk.bookSlug !== currentBook) {
        pCrossBook = 0.9;
      }

      const finalUtility = wRead * pRead + wDwell * pDwell + wPractice * pPractice + wCrossBook * pCrossBook;

      return {
        ...item,
        rankScore: Number(finalUtility.toFixed(4)),
      };
    });

    scored.sort((a, b) => (b.rankScore || 0) - (a.rankScore || 0));
    return scored;
  }
}
