import type {
  ParagraphLink,
  SemanticParagraph,
  ParagraphStructuralType,
} from './types.ts';

export interface MatchOptions {
  threshold?: number;
  maxPerSource?: number;
  maxPerTarget?: number;
  monotonicBias?: number;
  enableContextBonus?: boolean;
  enableTypeBonus?: boolean;
  enableFormulaBonus?: boolean;
}

export class BipartiteMatcher {

  static cosineSimilarity(a: Float32Array | number[], b: Float32Array | number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      const valA = a[i];
      const valB = b[i];
      dot += valA * valB;
      normA += valA * valA;
      normB += valB * valB;
    }

    if (normA === 0 || normB === 0) return 0;
    const sim = dot / (Math.sqrt(normA) * Math.sqrt(normB));
    return Math.max(0, Math.min(1, Math.round(sim * 10000) / 10000));
  }

  static buildMatrix(
    sourceEmbeddings: (Float32Array | number[])[],
    targetEmbeddings: (Float32Array | number[])[]
  ): number[][] {
    const M = sourceEmbeddings.length;
    const N = targetEmbeddings.length;
    const matrix: number[][] = Array.from({ length: M }, () => new Array(N).fill(0));

    for (let i = 0; i < M; i++) {
      for (let j = 0; j < N; j++) {
        matrix[i][j] = this.cosineSimilarity(sourceEmbeddings[i], targetEmbeddings[j]);
      }
    }

    return matrix;
  }

  static computeMatrixStats(matrix: number[][]): {
    min: number;
    max: number;
    mean: number;
    stdDev: number;
    recommendedThreshold: number;
  } {
    const M = matrix.length;
    const N = M > 0 ? matrix[0].length : 0;
    if (M === 0 || N === 0) {
      return { min: 0, max: 0, mean: 0, stdDev: 0, recommendedThreshold: 0.6 };
    }

    let min = 1;
    let max = 0;
    let sum = 0;
    let count = 0;

    for (let i = 0; i < M; i++) {
      for (let j = 0; j < N; j++) {
        const v = matrix[i][j];
        if (v < min) min = v;
        if (v > max) max = v;
        sum += v;
        count++;
      }
    }

    const mean = count > 0 ? sum / count : 0;
    let varianceSum = 0;
    for (let i = 0; i < M; i++) {
      for (let j = 0; j < N; j++) {
        varianceSum += Math.pow(matrix[i][j] - mean, 2);
      }
    }
    const stdDev = count > 0 ? Math.sqrt(varianceSum / count) : 0;

    const dynamicThresh = Math.max(0.50, Math.min(0.75, Math.round((mean + stdDev * 1.1) * 100) / 100));

    return {
      min: Math.round(min * 1000) / 1000,
      max: Math.round(max * 1000) / 1000,
      mean: Math.round(mean * 1000) / 1000,
      stdDev: Math.round(stdDev * 1000) / 1000,
      recommendedThreshold: dynamicThresh,
    };
  }

  static computeAuxiliaryScore(
    src: SemanticParagraph,
    tgt: SemanticParagraph,
    options: MatchOptions = {}
  ): number {
    let bonus = 0;

    if (options.enableTypeBonus !== false) {
      if (src.type === tgt.type) {
        if (src.type === 'heading') bonus += 0.05;
        else if (src.type === 'card' || src.type === 'theorem') bonus += 0.03;
        else if (src.type === 'code' || src.type === 'math') bonus += 0.04;
      } else {

        if (
          (src.type === 'heading' && tgt.type === 'paragraph') ||
          (src.type === 'paragraph' && tgt.type === 'heading')
        ) {
          bonus -= 0.06;
        }
      }
    }

    if (options.enableContextBonus !== false && src.sectionContext && tgt.sectionContext) {
      const normSrcSec = src.sectionContext.toLowerCase().replace(/[^\w\u4e00-\u9fa5]/g, '');
      const normTgtSec = tgt.sectionContext.toLowerCase().replace(/[^\w\u4e00-\u9fa5]/g, '');

      const numSrc = src.sectionContext.match(/\d+[\.\-_]\d+/)?.[0];
      const numTgt = tgt.sectionContext.match(/\d+[\.\-_]\d+/)?.[0];

      if (numSrc && numTgt && numSrc === numTgt) {
        bonus += 0.04;
      } else if (normSrcSec && normTgtSec && (normSrcSec.includes(normTgtSec) || normTgtSec.includes(normSrcSec))) {
        bonus += 0.03;
      }
    }

    if (options.enableFormulaBonus !== false && src.formulas && tgt.formulas && src.formulas.length > 0 && tgt.formulas.length > 0) {
      const srcFormulaSet = new Set(src.formulas.map((f) => f.replace(/\s+/g, '')));
      let matchCount = 0;

      tgt.formulas.forEach((f) => {
        const compact = f.replace(/\s+/g, '');
        if (srcFormulaSet.has(compact) && compact.length >= 3) {
          matchCount++;
        }
      });

      if (matchCount > 0) {
        bonus += Math.min(0.08, matchCount * 0.03);
      }
    }

    return bonus;
  }

  static extractLinks(
    matrix: number[][],
    sources: SemanticParagraph[],
    targets: SemanticParagraph[],
    options: MatchOptions = {}
  ): ParagraphLink[] {
    const threshold = options.threshold ?? 0.6;
    const maxPerSource = options.maxPerSource ?? 3;
    const maxPerTarget = options.maxPerTarget ?? 3;
    const monotonicBias = options.monotonicBias ?? 0;

    const M = matrix.length;
    const N = M > 0 ? matrix[0].length : 0;
    if (M === 0 || N === 0) return [];

    const adjustedMatrix: number[][] = Array.from({ length: M }, () => new Array(N).fill(0));

    for (let i = 0; i < M; i++) {
      const src = sources[i];
      const relPosI = M > 1 ? i / (M - 1) : 0;

      for (let j = 0; j < N; j++) {
        const tgt = targets[j];
        let score = matrix[i][j];

        if (src && tgt) {
          score += this.computeAuxiliaryScore(src, tgt, options);
        }

        if (monotonicBias > 0) {
          const relPosJ = N > 1 ? j / (N - 1) : 0;
          const posDiff = Math.abs(relPosI - relPosJ);
          score = Math.max(0, score - posDiff * monotonicBias);
        }

        adjustedMatrix[i][j] = Math.max(0, Math.min(1, Math.round(score * 10000) / 10000));
      }
    }

    const srcTopMap = new Map<number, Array<{ j: number; score: number; rawScore: number }>>();
    for (let i = 0; i < M; i++) {
      const list: Array<{ j: number; score: number; rawScore: number }> = [];
      for (let j = 0; j < N; j++) {
        if (adjustedMatrix[i][j] >= threshold) {
          list.push({ j, score: adjustedMatrix[i][j], rawScore: matrix[i][j] });
        }
      }
      list.sort((a, b) => b.score - a.score);
      srcTopMap.set(i, list.slice(0, maxPerSource));
    }

    const tgtTopMap = new Map<number, Array<{ i: number; score: number }>>();
    for (let j = 0; j < N; j++) {
      const list: Array<{ i: number; score: number }> = [];
      for (let i = 0; i < M; i++) {
        if (adjustedMatrix[i][j] >= threshold) {
          list.push({ i, score: adjustedMatrix[i][j] });
        }
      }
      list.sort((a, b) => b.score - a.score);
      tgtTopMap.set(j, list.slice(0, maxPerTarget));
    }

    const links: ParagraphLink[] = [];
    const targetLinkCounts = new Map<number, number>();

    for (let i = 0; i < M; i++) {
      const candidates = srcTopMap.get(i) || [];
      const isOneToMany = candidates.length > 1;

      candidates.forEach((c, rank) => {
        const tgtCandidates = tgtTopMap.get(c.j) || [];
        const isReciprocalTop1 = rank === 0 && tgtCandidates[0]?.i === i;
        const targetUsageCount = (targetLinkCounts.get(c.j) || 0) + 1;
        targetLinkCounts.set(c.j, targetUsageCount);

        let matchRelation: ParagraphLink['matchRelation'] = 'one_to_one';
        if (isOneToMany) {
          matchRelation = 'one_to_many';
        } else if (tgtCandidates.length > 1) {
          matchRelation = 'many_to_one';
        }

        let confidenceLevel: ParagraphLink['confidenceLevel'] = 'medium';
        if (isReciprocalTop1 || c.rawScore >= 0.75) {
          confidenceLevel = 'high';
        } else if (c.rawScore < threshold + 0.05) {
          confidenceLevel = 'weak';
        }

        links.push({
          sourceIndex: i,
          sourceId: sources[i]?.id ?? `src-${i}`,
          targetIndex: c.j,
          targetId: targets[c.j]?.id ?? `tgt-${c.j}`,
          similarity: c.rawScore,
          adjustedScore: c.score,
          isPrimary: rank === 0,
          matchRelation,
          confidenceLevel,
        });
      });
    }

    return links;
  }

  static findUnmatched(
    links: ParagraphLink[],
    sources: SemanticParagraph[],
    targets: SemanticParagraph[]
  ): { unmatchedSourceIds: string[]; unmatchedTargetIds: string[] } {
    const matchedSourceIds = new Set<string>(links.map((l) => l.sourceId));
    const matchedTargetIds = new Set<string>(links.map((l) => l.targetId));

    const unmatchedSourceIds = sources
      .filter((s) => !matchedSourceIds.has(s.id))
      .map((s) => s.id);

    const unmatchedTargetIds = targets
      .filter((t) => !matchedTargetIds.has(t.id))
      .map((t) => t.id);

    return { unmatchedSourceIds, unmatchedTargetIds };
  }
}
