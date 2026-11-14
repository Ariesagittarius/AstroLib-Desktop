/**
 * src/services/translation/translation-core.ts
 * ============================================================================
 * Unified Translation Core dispatcher for Vercel Serverless Function & Dev Plugin
 * ============================================================================
 */
import { translationService } from './service.ts';
import { dictionaryService } from '../dictionary/dictionary-service.ts';
import type { TranslationProviderId, TranslateOptions } from './types.ts';

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
  'Cache-Control': 'no-cache, no-store, must-revalidate',
};

export const DEFAULT_PROVIDERS = [
  { id: 'google', label: 'Google 翻译 (官方/默认)', desc: 'Google 官方成熟机器翻译引擎，响应迅速、翻译稳定' },
  { id: 'zhipu', label: '智谱 GLM-4 (免费)', desc: '智谱开放平台 GLM-4-Flash 官方永久免费模型，国内免翻直连' },
  { id: 'gemini', label: 'Google Gemini (学术推理)', desc: 'Google 官方前沿学术与理科推理模型' },
  { id: 'bupt', label: '北京邮电大学 (校内专属)', desc: '北京邮电大学「人人有算力」校内专属服务，免翻直连' },
];

export async function dispatchTranslate(body: any): Promise<{ status: number; data: any }> {
  const { text, provider = 'google', apiKey, endpoint, model } = body || {};
  if (!text || typeof text !== 'string' || !text.trim()) {
    return { status: 400, data: { ok: false, error: '缺少有效待翻译文本 (text)' } };
  }

  try {
    const opts: TranslateOptions = {
      provider: provider as TranslationProviderId,
      apiKey,
      endpoint,
      model,
    };
    const result = await translationService.translate(text, opts);
    return {
      status: 200,
      data: {
        ok: true,
        translatedText: result.translatedText,
        provider: result.provider,
        cached: (result as any).cached || false,
      },
    };
  } catch (err: any) {
    return {
      status: 500,
      data: {
        ok: false,
        error: err?.message || '翻译失败',
      },
    };
  }
}

export async function dispatchBatchTranslate(body: any): Promise<{ status: number; data: any }> {
  const { paragraphs, provider = 'google', apiKey, endpoint, model } = body || {};
  if (!Array.isArray(paragraphs)) {
    return { status: 400, data: { ok: false, error: '缺少 paragraphs 数组参数' } };
  }

  try {
    const opts: TranslateOptions = {
      provider: provider as TranslationProviderId,
      apiKey,
      endpoint,
      model,
    };
    const results = await translationService.translateParagraphs(paragraphs, opts);
    return {
      status: 200,
      data: {
        ok: true,
        paragraphs: results,
      },
    };
  } catch (err: any) {
    return {
      status: 500,
      data: {
        ok: false,
        error: err?.message || '批量翻译失败',
      },
    };
  }
}

export async function dispatchDictLookup(word: string, provider = 'auto'): Promise<{ status: number; data: any }> {
  if (!word || typeof word !== 'string' || !word.trim()) {
    return { status: 400, data: { ok: false, error: '缺少 word 参数' } };
  }

  const result = await dictionaryService.lookup(word, provider);
  return {
    status: result.ok ? 200 : 400,
    data: result,
  };
}

export async function dispatchDictContext(body: any): Promise<{ status: number; data: any }> {
  const { word, sentence, context } = body || {};
  if (!word) {
    return { status: 400, data: { ok: false, error: '缺少 word 参数' } };
  }

  const result = await dictionaryService.explainInContext({
    word,
    sentence: sentence || context || '',
  });
  return {
    status: result.ok ? 200 : 400,
    data: result,
  };
}
