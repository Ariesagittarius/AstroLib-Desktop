/**
 * src/features/search-rec/core/ranking/multi-task-ranker.ts
 * 学术多目标效用精排打分器
 */

import type { CandidateItem } from '../../types/candidate.ts';
import type { UserLearningContext, RecommendationWeights } from '../../types/recommendation.ts';
import { DEFAULT_REC_WEIGHTS } from '../../types/recommendation.ts';

export class MultiTaskRanker {
  private weights: RecommendationWeights;

  constructor(weights: RecommendationWeights = DEFAULT_REC_WEIGHTS) {
    this.weights = weights;
  }

  /**
   * 对粗排后的候选集执行多目标学术效用精排打分
   */
  rank(candidates: CandidateItem[], context?: UserLearningContext): CandidateItem[] {
    const { wRead, wDwell, wPractice, wCrossBook } = this.weights;
    const currentBook = context?.currentBookSlug || '';

    const scored = candidates.map((item) => {
      const chunk = item.chunk;

      // 1. P(Read) - 概念匹配与点击理解概率 (依托 RRF 分数与标题吻合度)
      const pRead = Math.min(1.0, (item.rrfScore || 0) * 30);

      // 2. P(Dwell) - 深度推导驻留概率 (公式密度、是否包含证明、文本深度)
      let pDwell = 0.2;
      if (chunk.hasLatex || (chunk.latexFormulas && chunk.latexFormulas.length > 0)) {
        pDwell += 0.4;
      }
      if (chunk.type === '定理' || chunk.type === '推论' || chunk.type === '引理' || chunk.text.includes('证明')) {
        pDwell += 0.3;
      }
      pDwell = Math.min(1.0, pDwell);

      // 3. P(Practice) - 习题自测尝试概率
      let pPractice = 0.1;
      if (chunk.type === '例题' || chunk.type === '例' || chunk.kind === 'exercise' || chunk.type.includes('题')) {
        pPractice = 0.85;
      }

      // 4. P(CrossBook) - 跨书知识迁移转化概率
      let pCrossBook = 0.1;
      if (currentBook && chunk.bookSlug !== currentBook) {
        pCrossBook = 0.9; // 跨书跨学科知识奖励
      }

      // 综合学术效用打分 U(c)
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
