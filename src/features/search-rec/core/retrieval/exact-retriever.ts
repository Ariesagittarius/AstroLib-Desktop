/**
 * src/features/search-rec/core/retrieval/exact-retriever.ts
 * 精确公式、编号与符号检索通道
 */

import type { AcademicChunk, CandidateItem } from '../../types/candidate.ts';

const TAG_REGEX = /(?:式\s*\(?|tag:|\()?(\d+(?:\.\d+)*)\)?/i;
const THEOREM_NUM_REGEX = /(定理|定义|例|例题|引理|推论|性质|公式|算法|公理)\s*(\d+(?:\.\d+)*)/i;

/** 归一化 LaTeX 公式，剔除多余空白与括号差异 */
function normalizeLatex(tex: string): string {
  return tex
    .replace(/\s+/g, '')
    .replace(/\\left|\\right/g, '')
    .replace(/\\,/g, '')
    .replace(/\\;/g, '')
    .replace(/\\quad/g, '')
    .toLowerCase();
}

/**
 * 精确检索器
 */
export class ExactRetriever {
  /**
   * 判断 Query 是否属于精确公式或特定符号查询
   */
  static isExactIntent(query: string): boolean {
    const q = query.trim();
    if (q.includes('\\') || q.includes('$')) return true; // 包含 LaTeX 命令
    if (TAG_REGEX.test(q)) return true; // 包含公式 tag 编号
    if (THEOREM_NUM_REGEX.test(q)) return true; // 包含定理/例题编号
    return false;
  }

  /**
   * 执行精确匹配检索
   */
  static search(chunks: AcademicChunk[], query: string, limit = 50): CandidateItem[] {
    const q = query.trim();
    if (!q) return [];

    const isLatex = q.includes('\\') || q.includes('$');
    const cleanLatexQuery = normalizeLatex(q.replace(/\$/g, ''));

    const tagMatch = q.match(TAG_REGEX);
    const targetTag = tagMatch ? tagMatch[1] : null;

    const thmMatch = q.match(THEOREM_NUM_REGEX);
    const targetThmType = thmMatch ? thmMatch[1] : null;
    const targetThmNum = thmMatch ? thmMatch[2] : null;

    const matchedCandidates: Array<{ chunk: AcademicChunk; score: number; token: string }> = [];

    for (const chunk of chunks) {
      let score = 0;
      let matchedToken = '';

      // 1. 定理/例题编号精准命中 (例：定理 2.1)
      if (targetThmType && targetThmNum) {
        if (chunk.type.includes(targetThmType) && chunk.number === targetThmNum) {
          score += 200;
          matchedToken = `${chunk.type} ${chunk.number}`;
        } else if (chunk.title.includes(targetThmType) && chunk.title.includes(targetThmNum)) {
          score += 150;
          matchedToken = `${targetThmType} ${targetThmNum}`;
        }
      }

      // 2. 公式 Tag 命中 (例：式 3.12)
      if (targetTag) {
        if (chunk.number === targetTag) {
          score += 180;
          matchedToken = `Tag: ${targetTag}`;
        } else if (chunk.text.includes(`(${targetTag})`) || chunk.text.includes(`tag{${targetTag}}`)) {
          score += 120;
          matchedToken = `(${targetTag})`;
        }
      }

      // 3. LaTeX 公式源码匹配
      if (isLatex && cleanLatexQuery) {
        const chunkLatexList = chunk.latexFormulas || [];
        for (const formula of chunkLatexList) {
          const cleanFm = normalizeLatex(formula);
          if (cleanFm.includes(cleanLatexQuery)) {
            score += cleanFm === cleanLatexQuery ? 250 : 160;
            matchedToken = formula;
            break;
          }
        }
        // 回退检查正文纯文本
        if (score === 0) {
          const normChunkText = normalizeLatex(chunk.text);
          if (normChunkText.includes(cleanLatexQuery)) {
            score += 100;
            matchedToken = q;
          }
        }
      }

      // 4. 精确标题全包含匹配
      if (q.length >= 2 && chunk.title.toLowerCase().includes(q.toLowerCase())) {
        score += 80;
        matchedToken = matchedToken || q;
      }

      if (score > 0) {
        matchedCandidates.push({ chunk, score, token: matchedToken });
      }
    }

    matchedCandidates.sort((a, b) => b.score - a.score);

    return matchedCandidates.slice(0, limit).map((item, rank) => ({
      chunk: item.chunk,
      channel: 'lexical',
      channelScore: item.score,
      channelRank: rank + 1,
      matchedTokens: item.token ? [item.token] : [],
      recommendReason: item.token ? `精确匹配: ${item.token}` : '精确检索',
    }));
  }
}
