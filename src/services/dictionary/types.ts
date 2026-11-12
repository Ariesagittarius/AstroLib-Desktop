/**
 * src/services/dictionary/types.ts
 * ============================================================================
 * AstroLib 双语研判与英语学习：单词释义与词典数据模型
 * ============================================================================
 */

export interface WordMeaning {
  partOfSpeech: string; // n., v., adj., adv., vt., vi., etc.
  definitions: string[];
  examples?: string[];
}

export interface WordDefinitionResult {
  ok: boolean;
  word: string;
  phonetic?: string;
  audioUrl?: string;
  meanings: WordMeaning[];
  source?: string;
  error?: string;
}

export interface WordContextExplanationRequest {
  word: string;
  sentence: string;
  provider?: string;
  apiKey?: string;
  endpoint?: string;
  model?: string;
}

export interface WordContextExplanationResult {
  ok: boolean;
  word: string;
  explanation: string;
  provider?: string;
  error?: string;
}
