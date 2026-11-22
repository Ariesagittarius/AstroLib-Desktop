import type { SemanticParagraph, ParagraphStructuralType } from './types.ts';

export interface ExtractorOptions {
  enableOcrHealing?: boolean;
  prefix?: 'src' | 'tgt';
  defaultLang?: 'en' | 'zh' | 'auto';
}

export class SemanticParagraphExtractor {

  static isOcrNoise(text: string): boolean {
    const t = text.trim();
    if (!t) return true;

    if (/^\d{1,4}$/.test(t)) return true;

    if (/^第\s*\d+\s*页(\s*[^\n]+)?$/i.test(t)) return true;
    if (/^Page\s*\d+(\s*[^\n]+)?$/i.test(t)) return true;
    return false;
  }

  static detectLanguage(text: string): 'en' | 'zh' | 'other' {
    const zhMatches = text.match(/[\u4e00-\u9fa5]/g);
    const zhCount = zhMatches ? zhMatches.length : 0;
    const enMatches = text.match(/[a-zA-Z]/g);
    const enCount = enMatches ? enMatches.length : 0;

    if (zhCount > 5 || zhCount > enCount) return 'zh';
    if (enCount > 5) return 'en';
    return 'other';
  }

  static extractElementTextWithLatex(el: HTMLElement): { text: string; formulas: string[] } {
    const clone = (typeof el.cloneNode === 'function' ? el.cloneNode(true) : el) as HTMLElement;
    const formulas: string[] = [];

    if (clone.querySelectorAll) {

      clone.querySelectorAll<HTMLElement>('.card-mdicon, svg, [aria-hidden="true"], .sr-only').forEach((icon) => {
        icon.remove?.();
      });

      clone.querySelectorAll<HTMLElement>('.katex[data-latex], [data-latex]').forEach((kEl) => {
        const latex = kEl.getAttribute('data-latex') || '';
        if (latex) {
          formulas.push(latex);
          const isDisplay = kEl.classList.contains('katex-display') || kEl.getAttribute('data-display') === 'true';
          const replacement = document.createTextNode(isDisplay ? `\n$$${latex}$$\n` : ` $${latex}$ `);
          kEl.parentNode?.replaceChild(replacement, kEl);
        }
      });

      clone.querySelectorAll<HTMLElement>('.katex-mathml annotation').forEach((anno) => {
        const latex = anno.textContent?.trim() || '';
        if (latex) {
          formulas.push(latex);
          const replacement = document.createTextNode(` $${latex}$ `);
          const rootKatex = anno.closest('.katex') || anno;
          rootKatex.parentNode?.replaceChild(replacement, rootKatex);
        }
      });
    }

    const rawText = clone.textContent || '';
    const text = rawText
      .replace(/[ \t]+/g, ' ')
      .replace(/\r?\n\s*\r?\n/g, '\n')
      .trim();

    return { text, formulas };
  }

  static extractFromDom(
    container: HTMLElement,
    options: ExtractorOptions = {}
  ): SemanticParagraph[] {
    if (!container) return [];
    const prefix = options.prefix ?? 'src';
    const enableOcrHealing = options.enableOcrHealing ?? true;

    const selector = [
      'h1',
      'h2',
      'h3',
      'h4',
      'p',
      'blockquote',
      'th',
      'td',
      'pre',
      '.knowledge-card',
      '.example-card',
      '.variant-card',
      '.method-card',
      '.summary-card',
      '.exercise-card',
    ].join(', ');

    const elements = Array.from(container.querySelectorAll<HTMLElement>(selector));
    const rawUnits: Array<{
      el: HTMLElement;
      text: string;
      formulas: string[];
      type: ParagraphStructuralType;
      sectionContext: string;
    }> = [];

    let currentSectionContext = '';

    elements.forEach((el) => {

      if (
        el.tagName.toLowerCase() === 'p' &&
        el.closest('.knowledge-card, .example-card, .variant-card, .method-card, .summary-card, .exercise-card')
      ) {
        return;
      }

      if (el.closest('.katex-display') && el.tagName.toLowerCase() !== 'div') {
        return;
      }

      const tagName = el.tagName.toLowerCase();
      let type: ParagraphStructuralType = 'paragraph';

      if (tagName.startsWith('h')) {
        type = 'heading';
      } else if (tagName === 'blockquote') {
        type = 'quote';
      } else if (tagName === 'pre') {
        type = 'code';
      } else if (tagName === 'th' || tagName === 'td') {
        type = 'table-cell';
      } else if (el.className.includes('-card')) {
        type = 'card';
      }

      const { text, formulas } = this.extractElementTextWithLatex(el);
      if (!text || text.length < 1) return;

      if (type === 'heading') {
        currentSectionContext = text;
      }

      rawUnits.push({
        el,
        text,
        formulas,
        type,
        sectionContext: currentSectionContext,
      });
    });

    const paragraphs: SemanticParagraph[] = [];
    let pIndex = 0;

    for (let i = 0; i < rawUnits.length; i++) {
      const cur = rawUnits[i];

      const prevUnfinished =
        paragraphs.length > 0 &&
        paragraphs[paragraphs.length - 1].type === 'paragraph' &&
        !/[。！？\.!\?\:：]$/.test(paragraphs[paragraphs.length - 1].text);

      if (enableOcrHealing && !prevUnfinished && this.isOcrNoise(cur.text)) {
        continue;
      }

      let merged = false;
      if (enableOcrHealing && paragraphs.length > 0 && cur.type === 'paragraph') {
        const lastP = paragraphs[paragraphs.length - 1];
        const lastRaw = rawUnits[i - 1];

        const prevEndsSentence = /[。！？\.!\?\:：]$/.test(lastP.text);
        const currStartsFragment = /^[0-9a-zA-Z\)\],，、\+\-\*\/支配\^]/.test(cur.text) && cur.text.length < 35;
        const prevIsShortUnfinished = !prevEndsSentence && lastP.text.length < 120 && cur.text.length < 40;

        if (lastP.type === 'paragraph' && (currStartsFragment || prevIsShortUnfinished)) {

          lastP.text = `${lastP.text} ${cur.text}`.trim();
          if (cur.formulas.length > 0) {
            lastP.formulas = (lastP.formulas || []).concat(cur.formulas);
          }

          cur.el.setAttribute('data-trans-id', lastP.id);
          cur.el.setAttribute('data-trans-merged', 'true');
          merged = true;
        }
      }

      if (!merged) {
        const transId = `${prefix}-p-${pIndex}`;
        cur.el.setAttribute('data-trans-id', transId);

        paragraphs.push({
          id: transId,
          index: pIndex,
          text: cur.text,
          type: cur.type,
          sectionContext: cur.sectionContext || undefined,
          formulas: cur.formulas.length > 0 ? cur.formulas : undefined,
          lang: options.defaultLang ?? this.detectLanguage(cur.text),
        });

        pIndex++;
      }
    }

    return paragraphs;
  }

  static extractFromMarkdown(
    markdown: string,
    options: ExtractorOptions = {}
  ): SemanticParagraph[] {
    if (!markdown) return [];
    const prefix = options.prefix ?? 'src';
    const enableOcrHealing = options.enableOcrHealing ?? true;

    const body = markdown
      .replace(/^---[\r\n]+[\s\S]*?[\r\n]+---(?:\r?\n)?/, '')
      .replace(/^(?:import\s+[\s\S]*?from\s+['"][^'"]+['"];?|import\s+['"][^'"]+['"];?)\s*$/gm, '');

    const rawBlocks = body.split(/(?:\r?\n){2,}/);
    const paragraphs: SemanticParagraph[] = [];
    let currentSectionContext = '';
    let pIndex = 0;

    for (const raw of rawBlocks) {
      const trimmed = raw.trim();
      if (!trimmed) continue;

      const prevUnfinished =
        paragraphs.length > 0 &&
        paragraphs[paragraphs.length - 1].type === 'paragraph' &&
        !/[。！？\.!\?\:：]$/.test(paragraphs[paragraphs.length - 1].text);

      if (enableOcrHealing && !prevUnfinished && this.isOcrNoise(trimmed)) {
        continue;
      }

      let type: ParagraphStructuralType = 'paragraph';
      let cleanText = trimmed;

      if (trimmed.startsWith('#')) {
        type = 'heading';
        currentSectionContext = trimmed.replace(/^#+\s*/, '').trim();
      } else if (trimmed.startsWith('$$')) {
        type = 'math';
      } else if (trimmed.startsWith('```')) {
        type = 'code';
      } else if (trimmed.startsWith('>')) {
        type = 'quote';
        cleanText = trimmed.replace(/^>\s*/gm, '');
      } else if (trimmed.startsWith('<')) {
        type = 'card';
      }

      const formulaMatches = cleanText.match(/\$\$[\s\S]*?\$\$|\$[^\$\n]+\$/g) || [];
      const formulas = formulaMatches.map((f) => f.replace(/^\${1,2}|\${1,2}$/g, '').trim());

      let merged = false;
      if (enableOcrHealing && paragraphs.length > 0 && type === 'paragraph') {
        const lastP = paragraphs[paragraphs.length - 1];
        const prevEndsSentence = /[。！？\.!\?\:：]$/.test(lastP.text);
        const currStartsFragment = /^[0-9a-zA-Z\)\],，、\+\-\*\/支配\^]/.test(cleanText) && cleanText.length < 35;
        const prevIsShortUnfinished = !prevEndsSentence && lastP.text.length < 120 && cleanText.length < 40;

        if (lastP.type === 'paragraph' && (currStartsFragment || prevIsShortUnfinished)) {
          lastP.text = `${lastP.text} ${cleanText}`.trim();
          if (formulas.length > 0) {
            lastP.formulas = (lastP.formulas || []).concat(formulas);
          }
          merged = true;
        }
      }

      if (!merged) {
        paragraphs.push({
          id: `${prefix}-p-${pIndex}`,
          index: pIndex,
          text: cleanText,
          type,
          sectionContext: currentSectionContext || undefined,
          formulas: formulas.length > 0 ? formulas : undefined,
          lang: options.defaultLang ?? this.detectLanguage(cleanText),
        });
        pIndex++;
      }
    }

    return paragraphs;
  }
}
