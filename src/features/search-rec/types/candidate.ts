/**
 * src/features/search-rec/types/candidate.ts
 * 候选知识单元与切片领域模型
 */

export type AcademicChunkKind = 'card' | 'heading' | 'exercise' | 'digital-resource';

export interface AcademicChunk {
  id: string;               // 全局或书内唯一切片 ID
  bookId: string;           // 所属书籍唯一标识，如 'math-linear_algebra'
  colSlug: string;          // 合集 slug，如 'math'
  bookSlug: string;         // 书籍 slug，如 'linear_algebra'
  bookTitle: string;        // 书名，如 '线性代数及其应用'
  chapterSlug: string;      // 章节 slug
  chapterTitle: string;     // 章节标题
  kind: AcademicChunkKind;  // 卡片或标题
  type: string;             // '定理' | '定义' | '例题' | '性质' | '推论' | '引理' | '习题' | '方法' 等
  title: string;            // 卡片标题
  number?: string;          // 编号，如 '1.74'
  text: string;             // 正文纯文本
  anchor?: string;          // URL 锚点
  url: string;              // 完整跳转链接
  hasLatex?: boolean;       // 是否包含 LaTeX 公式
  latexFormulas?: string[]; // 提取的公式源码列表
  line?: number;
}

export interface CandidateItem {
  chunk: AcademicChunk;
  channel: 'lexical' | 'dense' | 'graph' | 'scaffold';
  channelScore: number;     // 原始通道分数
  channelRank: number;      // 该通道内部的排名
  matchedTokens?: string[]; // 命中的检索词或概念
  rrfScore?: number;        // RRF 融合打分
  rankScore?: number;       // 精排最终打分
  recommendReason?: string; // 推荐原因说明 (如 '前驱基石', '跨书应用', '经典例题')
}
