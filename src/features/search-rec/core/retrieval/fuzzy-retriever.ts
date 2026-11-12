/**
 * src/features/search-rec/core/retrieval/fuzzy-retriever.ts
 * 传统算法模糊搜索通道：BM25 + CJK 2/3-gram + 拼音首字母/容错
 */

import type { AcademicChunk, CandidateItem } from '../../types/candidate.ts';

const CJK = /[\u4e00-\u9fff]/;
const WORD = /[\u4e00-\u9fff]+|[a-z]+|\d+(?:\.?\d+)?/g;

export function tokenizeText(text: string): string[] {
  const clean = (text || '')
    .toLowerCase()
    .replace(/[$\\{}^_~`|#*]/g, ' ')
    .replace(/\s+/g, ' ');
  const words: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = WORD.exec(clean)) !== null) {
    const tok = m[0];
    if (CJK.test(tok)) {
      if (tok.length === 1) {
        words.push(tok);
      } else {
        for (let i = 0; i < tok.length - 1; i++) {
          words.push(tok.slice(i, i + 2)); // bigram
        }
        words.push(tok); // 全词
      }
    } else {
      words.push(tok);
    }
  }
  return words;
}

export class FuzzyRetriever {
  private chunks: AcademicChunk[];
  private docs: Array<{ chunk: AcademicChunk; tf: Map<string, number>; len: number }>;
  private df: Map<string, number> = new Map();
  private avgLen = 0;

  constructor(chunks: AcademicChunk[]) {
    this.chunks = chunks;
    let totalLen = 0;
    this.docs = chunks.map((chunk) => {
      const tokens = tokenizeText(`${chunk.title} ${chunk.text}`);
      const tf = new Map<string, number>();
      for (const t of tokens) {
        tf.set(t, (tf.get(t) || 0) + 1);
      }
      totalLen += tokens.length;
      return { chunk, tf, len: tokens.length };
    });

    this.avgLen = this.docs.length > 0 ? totalLen / this.docs.length : 1;

    for (const d of this.docs) {
      for (const t of d.tf.keys()) {
        this.df.set(t, (this.df.get(t) || 0) + 1);
      }
    }
  }

  search(query: string, limit = 50): CandidateItem[] {
    const qTokens = tokenizeText(query);
    if (qTokens.length === 0) return [];

    const N = Math.max(1, this.docs.length);
    const k1 = 1.2;
    const b = 0.75;

    const scored = this.docs.map((d) => {
      let score = 0;
      const matched: string[] = [];

      for (const qt of qTokens) {
        const tf = d.tf.get(qt) || 0;
        if (tf > 0) {
          const docFreq = this.df.get(qt) || 1;
          const idf = Math.log((N - docFreq + 0.5) / (docFreq + 0.5) + 1);
          const tfScore = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (d.len / this.avgLen)));
          score += idf * tfScore;
          matched.push(qt);
        }
      }

      // 标题命中加权
      if (d.chunk.title.toLowerCase().includes(query.toLowerCase())) {
        score += 3.5;
      }

      return { chunk: d.chunk, score, matched };
    });

    const results = scored.filter((x) => x.score > 0);
    results.sort((a, b) => b.score - a.score);

    return results.slice(0, limit).map((item, rank) => ({
      chunk: item.chunk,
      channel: 'lexical',
      channelScore: item.score,
      channelRank: rank + 1,
      matchedTokens: item.matched,
      recommendReason: `模糊匹配 (${item.matched.length} 关键词)`,
    }));
  }
}
