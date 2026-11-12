import { describe, it, expect } from 'vitest';
import { SemanticParagraphExtractor } from '../../src/services/bilingual/semantic-extractor.ts';

describe('SemanticParagraphExtractor', () => {
  it('correctly filters out OCR noise (page numbers and header artifacts)', () => {
    expect(SemanticParagraphExtractor.isOcrNoise('8')).toBe(true);
    expect(SemanticParagraphExtractor.isOcrNoise('23')).toBe(true);
    expect(SemanticParagraphExtractor.isOcrNoise('第 23 页 序言')).toBe(true);
    expect(SemanticParagraphExtractor.isOcrNoise('Page 15')).toBe(true);
    expect(SemanticParagraphExtractor.isOcrNoise('   ')).toBe(true);

    expect(SemanticParagraphExtractor.isOcrNoise('0.3 Big-O notation')).toBe(false);
    expect(SemanticParagraphExtractor.isOcrNoise('常系数可以忽略：14n^2 可以变为 n^2。')).toBe(false);
  });

  it('detects language accurately', () => {
    expect(SemanticParagraphExtractor.detectLanguage('We have just seen how sloppiness in the analysis of running times')).toBe('en');
    expect(SemanticParagraphExtractor.detectLanguage('我们刚刚看到了运行时间分析中的草率如何导致结果不准确')).toBe('zh');
  });

  it('extracts structured SemanticParagraphs from Markdown preserving formulas and section context', () => {
    const markdown = `---
title: '0.3 Big-O notation'
---

import Guide from '@/components/Guide.astro';

## 0.3 Big-O notation

We've just seen how sloppiness in the analysis of running times can lead to an unacceptable level of inaccuracy.

$$
\\frac{f_2(n)}{f_1(n)} = \\frac{2n + 20}{n^2} \\le 22
$$

Multiplicative constants can be omitted: $14n^2$ becomes $n^2$.
`;

    const paras = SemanticParagraphExtractor.extractFromMarkdown(markdown, { prefix: 'src' });

    expect(paras.length).toBe(4);
    // 0: heading
    expect(paras[0].type).toBe('heading');
    expect(paras[0].text).toContain('0.3 Big-O notation');
    expect(paras[0].sectionContext).toBe('0.3 Big-O notation');

    // 1: paragraph
    expect(paras[1].type).toBe('paragraph');
    expect(paras[1].text).toContain('sloppiness');
    expect(paras[1].sectionContext).toBe('0.3 Big-O notation');

    // 2: math
    expect(paras[2].type).toBe('math');
    expect(paras[2].text).toContain('\\frac{f_2(n)}{f_1(n)}');

    // 3: paragraph with inline formula
    expect(paras[3].type).toBe('paragraph');
    expect(paras[3].formulas).toBeDefined();
    expect(paras[3].formulas?.length).toBeGreaterThan(0);
    expect(paras[3].formulas).toContain('14n^2');
  });

  it('heals fragmented OCR broken lines into unified semantic paragraphs', () => {
    const rawOcrMarkdown = `## 0.3 大 O 符号

第 23 页 序言

8

常系数可以忽略：14n2 可以变为 n2。当 a>b 时，na支配nb：例如，n2支配n。

任何指数项支配任何多项式项：3n

支配 n

5

(它甚至支配 2

n

)。

同理，任何多项式项支配对数项：n 支配 (logn) 3。进一步的，例如，n 2 支配 nlogn。
`;

    const paras = SemanticParagraphExtractor.extractFromMarkdown(rawOcrMarkdown, {
      prefix: 'tgt',
      enableOcrHealing: true,
    });

    // Check that standalone page number "8" and "第 23 页 序言" were eliminated
    const texts = paras.map((p) => p.text);
    expect(texts.some((t) => t.includes('第 23 页'))).toBe(false);
    expect(texts.some((t) => t === '8')).toBe(false);

    // Check that Rule 3 was healed together
    const rule3 = paras.find((p) => p.text.includes('任何指数项支配任何多项式项'));
    expect(rule3).toBeDefined();
    expect(rule3?.text).toContain('3n');
    expect(rule3?.text).toContain('支配 n 5');
    expect(rule3?.text).toContain('(它甚至支配 2 n )。');
  });
});
