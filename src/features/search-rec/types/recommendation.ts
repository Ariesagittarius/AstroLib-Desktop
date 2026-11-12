/**
 * src/features/search-rec/types/recommendation.ts
 * 推荐效用模型与上下文定义
 */

export interface UserLearningContext {
  currentColSlug?: string;
  currentBookSlug?: string;
  currentChapterSlug?: string;
  currentConcept?: string;
  recentVisitedChapters?: string[]; // 近期浏览的章节列表 (FIFO 队列)
  masteredChunkIds?: string[];      // 已掌握标记列表 (负反馈过滤)
}

export interface RecommendationWeights {
  wRead: number;        // 概念理解权重 (默认 0.35)
  wDwell: number;       // 深度推导权重 (默认 0.25)
  wPractice: number;    // 习题自测权重 (默认 0.20)
  wCrossBook: number;   // 跨书知识迁移权重 (默认 0.20)
}

export const DEFAULT_REC_WEIGHTS: RecommendationWeights = {
  wRead: 0.35,
  wDwell: 0.25,
  wPractice: 0.20,
  wCrossBook: 0.20,
};
