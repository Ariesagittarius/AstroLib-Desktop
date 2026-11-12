/**
 * src/services/bilingual/semantic-extractor.ts
 * ============================================================================
 * AstroLib 结构化语义段落提取器 (Semantic Paragraph Extractor)
 * ============================================================================
 * 遵循 Rule 1 (UI is not a domain model) & Rule 7 (Utils Purity)
 *
 * 核心设计目标：
 * 1. 结构化抽取：产出包含稳定 ID、章节上下文、结构类型、公式原文的 SemanticParagraph；
 * 2. 数学公式保护：利用 rehype-katex-source 注入的 data-latex 还原 $formula$，
 *    彻底杜绝 DOM innerText 造成的上下标断行与字符坍塌；
 * 3. OCR 碎片自愈 (Micro-Fragment Healing)：识别 MinerU OCR 产生的页码、断行
 *    与孤立上下标，在语义向量化前自愈拼合为完整段落；
 * 4. 双模支持：同时支持从浏览器 DOM 容器提取与从 MDX/Markdown 源码预编译提取。
 * ============================================================================
 */

import type { SemanticParagraph, ParagraphStructuralType } from './types.ts';

export interface ExtractorOptions {
  enableOcrHealing?: boolean;
  prefix?: 'src' | 'tgt';
  defaultLang?: 'en' | 'zh' | 'auto';
}

export class SemanticParagraphExtractor {
  /**
   * 判定是否属于 OCR 产生的无语义噪点（如孤立页码、章节页眉）
   */
  static isOcrNoise(text: string): boolean {
    const t = text.trim();
    if (!t) return true;
    // 纯数字页码，如 "8", "23"
    if (/^\d{1,4}$/.test(t)) return true;
    // 孤立页眉页脚，如 "第 23 页 序言", "Page 24 Preface"
    if (/^第\s*\d+\s*页(\s*[^\n]+)?$/i.test(t)) return true;
    if (/^Page\s*\d+(\s*[^\n]+)?$/i.test(t)) return true;
    return false;
  }

  /**
   * 自动探测文本语言倾向
   */
  static detectLanguage(text: string): 'en' | 'zh' | 'other' {
    const zhMatches = text.match(/[\u4e00-\u9fa5]/g);
    const zhCount = zhMatches ? zhMatches.length : 0;
    const enMatches = text.match(/[a-zA-Z]/g);
    const enCount = enMatches ? enMatches.length : 0;

    if (zhCount > 5 || zhCount > enCount) return 'zh';
    if (enCount > 5) return 'en';
    return 'other';
  }

  /**
   * 从 DOM 元素中提取保留 LaTeX 公式语法的规范化纯文本
   */
  static extractElementTextWithLatex(el: HTMLElement): { text: string; formulas: string[] } {
    const clone = (typeof el.cloneNode === 'function' ? el.cloneNode(true) : el) as HTMLElement;
    const formulas: string[] = [];

    if (clone.querySelectorAll) {
      // 1. 移除无障碍语音辅助、卡片图标、装饰性 SVG 等噪声
      clone.querySelectorAll<HTMLElement>('.card-mdicon, svg, [aria-hidden="true"], .sr-only').forEach((icon) => {
        icon.remove?.();
      });

      // 2. 优先提取携带 data-latex 的 KaTeX 节点
      clone.querySelectorAll<HTMLElement>('.katex[data-latex], [data-latex]').forEach((kEl) => {
        const latex = kEl.getAttribute('data-latex') || '';
        if (latex) {
          formulas.push(latex);
          const isDisplay = kEl.classList.contains('katex-display') || kEl.getAttribute('data-display') === 'true';
          const replacement = document.createTextNode(isDisplay ? `\n$$${latex}$$\n` : ` $${latex}$ `);
          kEl.parentNode?.replaceChild(replacement, kEl);
        }
      });

      // 3. 兜底提取无 data-latex 的 MathML annotation 标签
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

    // 4. 清洗换行与多余空白
    const rawText = clone.textContent || '';
    const text = rawText
      .replace(/[ \t]+/g, ' ')
      .replace(/\r?\n\s*\r?\n/g, '\n')
      .trim();

    return { text, formulas };
  }

  /**
   * 从 DOM 容器中提取结构化段落单元并赋予稳定 data-trans-id
   */
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
      // 避免重复提取嵌套在卡片内部的普通段落（由卡片逻辑统一提取）
      if (
        el.tagName.toLowerCase() === 'p' &&
        el.closest('.knowledge-card, .example-card, .variant-card, .method-card, .summary-card, .exercise-card')
      ) {
        return;
      }

      // 跳过行间公式单独外层容器以避免与正文断开
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

    // 执行碎片自愈与 ID 挂载
    const paragraphs: SemanticParagraph[] = [];
    let pIndex = 0;

    for (let i = 0; i < rawUnits.length; i++) {
      const cur = rawUnits[i];

      const prevUnfinished =
        paragraphs.length > 0 &&
        paragraphs[paragraphs.length - 1].type === 'paragraph' &&
        !/[。！？\.!\?\:：]$/.test(paragraphs[paragraphs.length - 1].text);

      // 过滤页码与孤立页眉等 OCR 噪声（若前句未闭合，短数字通常为上下标，不作为页码丢弃）
      if (enableOcrHealing && !prevUnfinished && this.isOcrNoise(cur.text)) {
        continue;
      }

      // 自愈判定：检测当前元素是否是前一段落由于换行/公式而断裂的碎片
      let merged = false;
      if (enableOcrHealing && paragraphs.length > 0 && cur.type === 'paragraph') {
        const lastP = paragraphs[paragraphs.length - 1];
        const lastRaw = rawUnits[i - 1];

        // 若前一段落也是普通段落或列表，且未以终结标点结束，或者当前段落以运算符/孤立符号开头
        const prevEndsSentence = /[。！？\.!\?\:：]$/.test(lastP.text);
        const currStartsFragment = /^[0-9a-zA-Z\)\],，、\+\-\*\/支配\^]/.test(cur.text) && cur.text.length < 35;
        const prevIsShortUnfinished = !prevEndsSentence && lastP.text.length < 120 && cur.text.length < 40;

        if (lastP.type === 'paragraph' && (currStartsFragment || prevIsShortUnfinished)) {
          // 合并进上一段落的语义模型
          lastP.text = `${lastP.text} ${cur.text}`.trim();
          if (cur.formulas.length > 0) {
            lastP.formulas = (lastP.formulas || []).concat(cur.formulas);
          }
          // 在 DOM 元素上标记同一父段落 ID，使高亮和点击依然能无缝溯源
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

  /**
   * 从纯 MDX/Markdown 源码中提取结构化语义段落（用于离线评测与预处理）
   */
  static extractFromMarkdown(
    markdown: string,
    options: ExtractorOptions = {}
  ): SemanticParagraph[] {
    if (!markdown) return [];
    const prefix = options.prefix ?? 'src';
    const enableOcrHealing = options.enableOcrHealing ?? true;

    // 1. 剔除 Frontmatter 与 import 声明
    const body = markdown
      .replace(/^---[\r\n]+[\s\S]*?[\r\n]+---(?:\r?\n)?/, '')
      .replace(/^(?:import\s+[\s\S]*?from\s+['"][^'"]+['"];?|import\s+['"][^'"]+['"];?)\s*$/gm, '');

    // 2. 双换行分块
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

      // 若前一句未闭合，孤立数字通常为上下标（如 n^5 中的 5），不应作为页码丢弃
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

      // 提取公式源码
      const formulaMatches = cleanText.match(/\$\$[\s\S]*?\$\$|\$[^\$\n]+\$/g) || [];
      const formulas = formulaMatches.map((f) => f.replace(/^\${1,2}|\${1,2}$/g, '').trim());

      // 自愈判定
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
