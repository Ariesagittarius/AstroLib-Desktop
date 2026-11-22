import type {
  WordDefinitionResult,
  WordMeaning,
  WordContextExplanationRequest,
  WordContextExplanationResult,
} from './types.ts';
import { translationService } from '../translation/service.ts';
import type { TranslationProviderId } from '../translation/types.ts';

export class DictionaryService {
  private static instance: DictionaryService;
  private defCache = new Map<string, WordDefinitionResult>();
  private contextCache = new Map<string, WordContextExplanationResult>();
  private readonly maxCacheSize = 500;

  private constructor() {}

  public static getInstance(): DictionaryService {
    if (!DictionaryService.instance) {
      DictionaryService.instance = new DictionaryService();
    }
    return DictionaryService.instance;
  }

  public async lookup(rawWord: string, preferredProvider = 'auto'): Promise<WordDefinitionResult> {
    const word = (rawWord || '').trim().toLowerCase();
    if (!word || !/^[a-zA-Z\-'’]+$/.test(word)) {
      return {
        ok: false,
        word: rawWord,
        meanings: [],
        error: '无效的英文单词',
      };
    }

    const cacheKey = `${preferredProvider}::${word}`;
    if (this.defCache.has(cacheKey)) {
      return this.defCache.get(cacheKey)!;
    }

    let result: WordDefinitionResult | null = null;

    if (preferredProvider === 'youdao') {
      result = await this.fetchYoudaoJsonApi(word).catch(() => null);
      if (!result) result = await this.fetchYoudaoDict(word).catch(() => null);
    } else if (preferredProvider === 'google') {
      result = await this.fetchGoogleDict(word).catch(() => null);
    } else if (preferredProvider === 'free') {
      result = await this.fetchFreeDictApi(word).catch(() => null);
    }

    if (!result || result.meanings.length === 0) {

      try {
        result = await this.fetchYoudaoJsonApi(word);
      } catch {
        result = null;
      }
    }

    if (!result || result.meanings.length === 0) {

      try {
        result = await this.fetchGoogleDict(word);
      } catch {
        result = null;
      }
    }

    if (!result || result.meanings.length === 0) {

      try {
        result = await this.fetchYoudaoDict(word);
      } catch {
        result = null;
      }
    }

    if (!result || result.meanings.length === 0) {

      try {
        result = await this.fetchFreeDictApi(word);
      } catch {
        result = null;
      }
    }

    if (!result || result.meanings.length === 0) {

      try {
        result = await this.fallbackTranslateWord(word);
      } catch {
        result = {
          ok: false,
          word,
          meanings: [],
          error: '未能检索到释义',
        };
      }
    }

    if (result && !result.audioUrl) {
      result.audioUrl = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word)}&type=2`;
    }

    if (this.defCache.size >= this.maxCacheSize) {
      const oldestKey = this.defCache.keys().next().value;
      if (oldestKey) this.defCache.delete(oldestKey);
    }
    this.defCache.set(cacheKey, result);

    return result;
  }

  private async fetchYoudaoJsonApi(word: string): Promise<WordDefinitionResult | null> {
    const url = `https://dict.youdao.com/jsonapi?q=${encodeURIComponent(word)}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)',
      },
    });
    if (!res.ok) return null;

    const d = await res.json();
    const simpleWord = d.simple?.word?.[0];
    const phonetic = simpleWord?.usphone ? `/${simpleWord.usphone}/` : (simpleWord?.ukphone ? `/${simpleWord.ukphone}/` : undefined);
    const audioUrl = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word)}&type=2`;
    const trs = d.ec?.word?.[0]?.trs;
    const meanings: WordMeaning[] = [];

    if (Array.isArray(trs)) {
      for (const item of trs) {
        const text = item?.tr?.[0]?.l?.i?.[0] || '';
        if (!text) continue;
        const m = text.match(/^([a-z]+\.)\s*(.+)$/i);
        if (m) {
          const pos = this.normalizePos(m[1]);
          const defs = m[2].split(/[,，、；;]/).map((s: string) => s.trim()).filter(Boolean);
          if (defs.length > 0) {
            meanings.push({ partOfSpeech: pos, definitions: defs.slice(0, 5) });
          }
        } else {
          meanings.push({ partOfSpeech: '', definitions: [text] });
        }
      }
    }

    if (meanings.length === 0) return null;

    return {
      ok: true,
      word,
      phonetic,
      audioUrl,
      meanings,
      source: 'youdao-jsonapi',
    };
  }

  private async fetchGoogleDict(word: string): Promise<WordDefinitionResult | null> {
    const gtxUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&dt=bd&dt=rm&q=${encodeURIComponent(word)}`;
    const res = await fetch(gtxUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      },
    });
    if (!res.ok) return null;

    const data = await res.json();
    if (!Array.isArray(data)) return null;

    const meanings: WordMeaning[] = [];
    let phonetic: string | undefined;

    if (Array.isArray(data[1])) {
      for (const group of data[1]) {
        if (!Array.isArray(group)) continue;
        const rawPos = group[0] || '';
        const pos = this.normalizePos(rawPos);
        const defs: string[] = [];

        if (Array.isArray(group[1])) {
          defs.push(...group[1].filter((d: any) => typeof d === 'string' && d.trim()));
        }

        if (defs.length > 0) {
          meanings.push({
            partOfSpeech: pos,
            definitions: defs.slice(0, 5),
          });
        }
      }
    }

    if (Array.isArray(data[0])) {
      for (const item of data[0]) {
        if (Array.isArray(item) && typeof item[3] === 'string' && item[3].trim()) {
          phonetic = item[3].trim();
          break;
        }
      }
    }

    if (meanings.length === 0 && Array.isArray(data[0]) && data[0][0] && typeof data[0][0][0] === 'string') {
      const basicTrans = data[0][0][0].trim();
      if (basicTrans && basicTrans.toLowerCase() !== word) {
        meanings.push({
          partOfSpeech: '',
          definitions: [basicTrans],
        });
      }
    }

    if (meanings.length === 0) return null;

    return {
      ok: true,
      word,
      phonetic: phonetic ? `/${phonetic.replace(/^\/|\/$/g, '')}/` : undefined,
      audioUrl: `https://translate.google.com/translate_tts?ie=UTF-8&tl=en&client=tw-ob&q=${encodeURIComponent(word)}`,
      meanings,
      source: 'google-dict',
    };
  }

  private async fetchYoudaoDict(word: string): Promise<WordDefinitionResult | null> {
    const url = `https://dict.youdao.com/suggest?num=1&doctype=json&q=${encodeURIComponent(word)}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)',
      },
    });
    if (!res.ok) return null;

    const json = await res.json();
    const entry = json?.data?.entries?.[0];
    if (!entry || !entry.explain) return null;

    const rawExplains = entry.explain.split(';').map((s: string) => s.trim()).filter(Boolean);
    const meaningsMap = new Map<string, string[]>();

    for (const exp of rawExplains) {
      const posMatch = exp.match(/^([a-z]+\.)\s*(.+)$/i);
      if (posMatch) {
        const pos = posMatch[1].toLowerCase();
        const defs = posMatch[2].split(/[,，、；;]/).map((d: string) => d.trim()).filter(Boolean);
        if (!meaningsMap.has(pos)) meaningsMap.set(pos, []);
        meaningsMap.get(pos)!.push(...defs);
      } else {
        if (!meaningsMap.has('')) meaningsMap.set('', []);
        meaningsMap.get('')!.push(exp);
      }
    }

    const meanings: WordMeaning[] = [];
    for (const [pos, defs] of meaningsMap.entries()) {
      meanings.push({
        partOfSpeech: pos,
        definitions: Array.from(new Set(defs)).slice(0, 5),
      });
    }

    return {
      ok: true,
      word,
      audioUrl: `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word)}&type=2`,
      meanings,
      source: 'youdao-suggest',
    };
  }

  private async fetchFreeDictApi(word: string): Promise<WordDefinitionResult | null> {
    const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`;
    const res = await fetch(url);
    if (!res.ok) return null;

    const data = await res.json();
    if (!Array.isArray(data) || !data[0]) return null;

    const item = data[0];
    let phonetic = item.phonetic;
    let audioUrl: string | undefined;

    if (Array.isArray(item.phonetics)) {
      for (const p of item.phonetics) {
        if (!phonetic && p.text) phonetic = p.text;
        if (!audioUrl && p.audio) audioUrl = p.audio;
      }
    }

    const meanings: WordMeaning[] = [];
    if (Array.isArray(item.meanings)) {
      for (const m of item.meanings) {
        const pos = this.normalizePos(m.partOfSpeech || '');
        const defs: string[] = [];
        const examples: string[] = [];

        if (Array.isArray(m.definitions)) {
          for (const d of m.definitions.slice(0, 3)) {
            if (d.definition) defs.push(d.definition);
            if (d.example) examples.push(d.example);
          }
        }

        if (defs.length > 0) {
          meanings.push({
            partOfSpeech: pos,
            definitions: defs,
            examples: examples.slice(0, 2),
          });
        }
      }
    }

    if (meanings.length === 0) return null;

    return {
      ok: true,
      word,
      phonetic,
      audioUrl,
      meanings,
      source: 'free-dictionary-api',
    };
  }

  private async fallbackTranslateWord(word: string): Promise<WordDefinitionResult> {
    const trans = await translationService.translate(word, {
      sourceLang: 'en',
      targetLang: 'zh',
      preserveStructure: false,
    });

    if (trans && trans.translatedText && trans.translatedText.trim().toLowerCase() !== word) {
      return {
        ok: true,
        word,
        audioUrl: `https://translate.google.com/translate_tts?ie=UTF-8&tl=en&client=tw-ob&q=${encodeURIComponent(word)}`,
        meanings: [
          {
            partOfSpeech: '',
            definitions: [trans.translatedText.trim()],
          },
        ],
        source: 'translation-fallback',
      };
    }

    return {
      ok: false,
      word,
      meanings: [],
      error: '未查找到该单词的有效释义',
    };
  }

  public async explainInContext(req: WordContextExplanationRequest): Promise<WordContextExplanationResult> {
    const word = (req.word || '').trim();
    const sentence = (req.sentence || '').trim();
    const provider = req.provider || 'google';

    if (!word) {
      return { ok: false, word, explanation: '', error: '缺少目标单词' };
    }

    const cacheKey = `${provider}::${word.toLowerCase()}::${sentence}`;
    if (this.contextCache.has(cacheKey)) {
      return this.contextCache.get(cacheKey)!;
    }

    try {
      let explanation = '';

      const isLlmProvider = ['gemini', 'zhipu', 'bupt', 'deepseek'].includes(provider);
      if (isLlmProvider) {
        try {
          explanation = await this.queryLlmContext(word, sentence, provider, req);
        } catch {
          explanation = '';
        }
      }

      if (!explanation) {
        explanation = await this.extractAlignedContext(word, sentence);
      }

      const finalResult: WordContextExplanationResult = {
        ok: true,
        word,
        explanation: explanation || `在当前学术语境中，**${word}** 充当关键学术术语。`,
        provider,
      };

      if (this.contextCache.size >= this.maxCacheSize) {
        const oldest = this.contextCache.keys().next().value;
        if (oldest) this.contextCache.delete(oldest);
      }
      this.contextCache.set(cacheKey, finalResult);

      return finalResult;
    } catch (e: any) {

      try {
        const fallbackExpl = await this.extractAlignedContext(word, sentence);
        return {
          ok: true,
          word,
          explanation: fallbackExpl,
          provider,
        };
      } catch {
        return {
          ok: false,
          word,
          explanation: '',
          provider,
          error: e.message || '语境解析请求失败',
        };
      }
    }
  }

  public async extractAlignedContext(word: string, sentence: string): Promise<string> {
    const rawSentence = (sentence || word).trim();

    let translatedSentence = '';
    try {
      const transRes = await translationService.translate(rawSentence, {
        provider: 'google',
        sourceLang: 'en',
        targetLang: 'zh',
        preserveStructure: true,
      });
      translatedSentence = (transRes?.translatedText || '').trim();
    } catch {
      translatedSentence = '';
    }

    const dict = await this.lookup(word);

    let matched: { keyword: string; fullDef: string; pos?: string } | null = null;
    if (translatedSentence && dict && dict.meanings.length > 0) {
      for (const m of dict.meanings) {
        for (const def of m.definitions) {

          const candidates = def.split(/[/；，、\s]+/);
          for (const cand of candidates) {

            const cleanKeyword = cand.trim().replace(/[的地理于着]+$/, '');
            if (cleanKeyword.length >= 1 && translatedSentence.includes(cleanKeyword)) {
              if (!matched || cleanKeyword.length > matched.keyword.length) {
                matched = { keyword: cleanKeyword, fullDef: def, pos: m.partOfSpeech };
              }
            }
          }
        }
      }
    }

    if (matched && translatedSentence) {

      const highlighted = translatedSentence.replace(matched.keyword, `【${matched.keyword}】`);
      const posText = matched.pos ? `（${matched.pos}）` : '';
      return `在当前学术语境中，**${word}** 意为“**${matched.fullDef}**”${posText}。\n\n**原句译文**：${highlighted}`;
    }

    if (translatedSentence) {
      const primaryDef = dict?.meanings?.[0]?.definitions?.slice(0, 3).join(' / ') || '学术专业术语';
      return `**原句译文**：${translatedSentence}\n\n**学术取义**：在当前语境中通常取“**${primaryDef}**”之义，用于学术论证与修辞。`;
    }

    const defSummary = dict?.meanings?.map(m => `${m.partOfSpeech ? `${m.partOfSpeech} ` : ''}${m.definitions.slice(0, 2).join('；')}`).join(' | ');
    return `**${word}**：${defSummary || '暂未检索到学术语境释义'}`;
  }

  private async queryLlmContext(
    word: string,
    sentence: string,
    provider: string,
    req: WordContextExplanationRequest
  ): Promise<string> {
    const rawSentence = (sentence || word).trim();
    const systemPrompt =
      '你是一位严谨的高校计算机与理工科学术英语顾问。请针对学术文献原句中的核心单词，进行极简典雅的学术语境释义。';
    const userPrompt =
      `原句：${rawSentence}\n目标词：${word}\n请用1到2句话精炼说明该词在此语境下的确切学术含义及修辞/论述作用。严禁废话寒暄，严禁重复输出原句。`;

    if (provider === 'gemini') {
      const apiKey =
        req.apiKey ||
        (typeof process !== 'undefined' ? process.env?.GEMINI_API_KEY : '') ||
        (typeof localStorage !== 'undefined' ? localStorage.getItem('astrolib_ai_provider_key_gemini') || '' : '');
      if (!apiKey) return '';
      const endpoint = req.endpoint || 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
      const model = req.model || 'gemini-2.5-flash';

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        }),
      });
      if (!res.ok) return '';
      const data = await res.json();
      return this.cleanLlmOutput(data?.choices?.[0]?.message?.content || '');
    }

    if (provider === 'zhipu') {
      const apiKey =
        req.apiKey ||
        (typeof process !== 'undefined' ? process.env?.ZHIPU_API_KEY : '') ||
        (typeof localStorage !== 'undefined' ? localStorage.getItem('astrolib_ai_provider_key_zhipu') || '' : '');
      if (!apiKey) return '';
      const endpoint = req.endpoint || 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
      const model = req.model || 'glm-4-flash';

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        }),
      });
      if (!res.ok) return '';
      const data = await res.json();
      return this.cleanLlmOutput(data?.choices?.[0]?.message?.content || '');
    }

    if (provider === 'bupt' || provider === 'deepseek') {
      const apiKey =
        req.apiKey ||
        (typeof process !== 'undefined' ? process.env?.BUPT_API_KEY : '') ||
        (typeof localStorage !== 'undefined' ? localStorage.getItem('astrolib_ai_provider_key_bupt') || '' : '');
      const endpoint = req.endpoint || 'http://10.3.242.238:3000/v1/chat/completions';
      const model = req.model || 'DeepSeek-V3';

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          temperature: 0.2,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        }),
      });
      if (!res.ok) return '';
      const data = await res.json();
      return this.cleanLlmOutput(data?.choices?.[0]?.message?.content || '');
    }

    return '';
  }

  private cleanLlmOutput(raw: string): string {
    let text = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    if (text.startsWith('```') && text.endsWith('```')) {
      text = text.replace(/^```(?:markdown|md|text)?\n([\s\S]*?)\n```$/i, '$1').trim();
    }
    return text.replace(/^(?:好的[，,！!]?|针对该词的语境解读如下[：:]?|学术语境解析[：:]?)\s*/i, '').trim();
  }

  private normalizePos(raw: string): string {
    const lower = raw.trim().toLowerCase();
    if (lower.startsWith('noun') || lower === 'n') return 'n.';
    if (lower.startsWith('verb') || lower === 'v') return 'v.';
    if (lower.startsWith('adj') || lower === 'adjective') return 'adj.';
    if (lower.startsWith('adv') || lower === 'adverb') return 'adv.';
    if (lower.startsWith('prep') || lower === 'preposition') return 'prep.';
    if (lower.startsWith('conj') || lower === 'conjunction') return 'conj.';
    if (lower.startsWith('pron') || lower === 'pronoun') return 'pron.';
    if (lower.startsWith('interj') || lower === 'interjection') return 'int.';
    return lower.endsWith('.') ? lower : `${lower}.`;
  }
}

export const dictionaryService = DictionaryService.getInstance();
