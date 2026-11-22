export interface UserLearningContext {
  currentColSlug?: string;
  currentBookSlug?: string;
  currentChapterSlug?: string;
  currentConcept?: string;
  recentVisitedChapters?: string[];
  masteredChunkIds?: string[];
}

export interface RecommendationWeights {
  wRead: number;
  wDwell: number;
  wPractice: number;
  wCrossBook: number;
}

export const DEFAULT_REC_WEIGHTS: RecommendationWeights = {
  wRead: 0.35,
  wDwell: 0.25,
  wPractice: 0.20,
  wCrossBook: 0.20,
};
