import type { AcademicChunk, CandidateItem } from '../../types/candidate.ts';

const TAG_REGEX = /(?:式\s*\(?|tag:|\()?(\d+(?:\.\d+)*)\)?/i;
const THEOREM_NUM_REGEX = /(定理|定义|例|例题|引理|推论|性质|公式|算法|公理)\s*(\d+(?:\.\d+)*)/i;

function normalizeLatex(tex: string): string {
  return tex
    .replace(/\s+/g, '')
    .replace(/\\left|\\right/g, '')
    .replace(/\\,/g, '')
    .replace(/\\;/g, '')
    .replace(/\\quad/g, '')
    .toLowerCase();
}

export class ExactRetriever {

  static isExactIntent(query: string): boolean {
    const q = query.trim();
    if (q.includes('\\') || q.includes('$')) return true;
    if (TAG_REGEX.test(q)) return true;
    if (THEOREM_NUM_REGEX.test(q)) return true;
    return false;
  }

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

      if (targetThmType && targetThmNum) {
        if (chunk.type.includes(targetThmType) && chunk.number === targetThmNum) {
          score += 200;
          matchedToken = `${chunk.type} ${chunk.number}`;
        } else if (chunk.title.includes(targetThmType) && chunk.title.includes(targetThmNum)) {
          score += 150;
          matchedToken = `${targetThmType} ${targetThmNum}`;
        }
      }

      if (targetTag) {
        if (chunk.number === targetTag) {
          score += 180;
          matchedToken = `Tag: ${targetTag}`;
        } else if (chunk.text.includes(`(${targetTag})`) || chunk.text.includes(`tag{${targetTag}}`)) {
          score += 120;
          matchedToken = `(${targetTag})`;
        }
      }

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

        if (score === 0) {
          const normChunkText = normalizeLatex(chunk.text);
          if (normChunkText.includes(cleanLatexQuery)) {
            score += 100;
            matchedToken = q;
          }
        }
      }

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
