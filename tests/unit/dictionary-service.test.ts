/**
 * tests/unit/dictionary-service.test.ts
 * ============================================================================
 * DictionaryService 单元测试：验证聚合查词、多源解析、本地缓存与语境解析
 * ============================================================================
 */

import { describe, it, expect, vi } from 'vitest';
import { dictionaryService, DictionaryService } from '../../src/services/dictionary/dictionary-service';

describe('DictionaryService Suite', () => {
  it('应成功获取单例实例', () => {
    const instance = DictionaryService.getInstance();
    expect(instance).toBe(dictionaryService);
  });

  it('无效单词应返回 ok: false 与错误信息', async () => {
    const resEmpty = await dictionaryService.lookup('');
    expect(resEmpty.ok).toBe(false);
    expect(resEmpty.error).toBeDefined();

    const resNumber = await dictionaryService.lookup('12345');
    expect(resNumber.ok).toBe(false);
  });

  it('查询常用英文单词应返回结构化词典结果（含音标、发音与词性释义）', async () => {
    const result = await dictionaryService.lookup('attention');
    expect(result.ok).toBe(true);
    expect(result.word.toLowerCase()).toBe('attention');
    expect(result.meanings.length).toBeGreaterThan(0);
    expect(result.audioUrl).toBeDefined();

    const firstMeaning = result.meanings[0];
    expect(firstMeaning.definitions.length).toBeGreaterThan(0);
  });

  it('第二次查询相同单词应命中内存缓存', async () => {
    const res1 = await dictionaryService.lookup('memory');
    const res2 = await dictionaryService.lookup('memory');
    expect(res1).toBe(res2); // 引用一致证明命中 LRU 缓存
  });

  it('学术语境解析在缺少目标单词时应快速返回错误', async () => {
    const res = await dictionaryService.explainInContext({
      word: '',
      sentence: 'The SRAM size of M is limited.',
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBeDefined();
  });

  it('学术语境解析应准确提取词义且绝不泄漏任何 Prompt 提示词', async () => {
    const res = await dictionaryService.explainInContext({
      word: 'critical',
      sentence: 'Our findings highlight a critical safety gap in current agentic MLLMs: external tools such as zoom',
      provider: 'google',
    });

    expect(res.ok).toBe(true);
    expect(res.word).toBe('critical');
    expect(res.explanation).toBeDefined();

    // 严格断言：绝对不能含有任何系统提示词残留！
    expect(res.explanation).not.toContain('你是一位');
    expect(res.explanation).not.toContain('您是一位');
    expect(res.explanation).not.toContain('学术顾问');
    expect(res.explanation).not.toContain('严禁寒暄');
    expect(res.explanation).not.toContain('纯中文精炼输出');
    expect(res.explanation).not.toContain('直奔主题');

    // 断言：包含学术语境与原句译文
    expect(res.explanation).toContain('critical');
    expect(res.explanation).toContain('原句译文');
  });
});
