import { marked } from 'marked';
import katex from 'katex';
import type { PdfBlockItem } from './pdf-viewport';

export function safeParsePaperMarkdown(content: string): string {
  if (!content) return '';
  const displayMathMap: string[] = [];
  const inlineMathMap: string[] = [];

  let protectedMd = content.replace(/\$\$([\s\S]*?)\$\$/g, (_, eq) => {
    const idx = displayMathMap.length;
    try {
      const rendered = katex.renderToString(eq.trim(), { displayMode: true, throwOnError: false });
      displayMathMap.push(`<div class="doc-equation-display">${rendered}</div>`);
    } catch {
      displayMathMap.push(`<div class="doc-equation-display">$$\n${eq}\n$$</div>`);
    }
    return `\n\n%%ASTROLIB_DISPLAY_MATH_${idx}%%\n\n`;
  });

  protectedMd = protectedMd.replace(/\$([^\$\n]+?)\$/g, (_, eq) => {
    const idx = inlineMathMap.length;
    try {
      const rendered = katex.renderToString(eq.trim(), { displayMode: false, throwOnError: false });
      inlineMathMap.push(`<span class="katex-inline-wrapper">${rendered}</span>`);
    } catch {
      inlineMathMap.push(`$${eq}$`);
    }
    return `%%ASTROLIB_INLINE_MATH_${idx}%%`;
  });

  let html = '';
  try {
    html = marked.parse(protectedMd) as string;
  } catch {
    html = `<pre>${content}</pre>`;
  }

  html = html.replace(/%%ASTROLIB_DISPLAY_MATH_(\d+)%%/g, (_, idx) => displayMathMap[parseInt(idx, 10)] || '');
  html = html.replace(/%%ASTROLIB_INLINE_MATH_(\d+)%%/g, (_, idx) => inlineMathMap[parseInt(idx, 10)] || '');
  return html;
}

export class BilingualTranslator {
  private cache = new Map<string, string>();
  private provider: string;

  constructor(provider: string) {
    this.provider = provider || 'google';
  }

  public setProvider(provider: string): void {
    this.provider = provider || 'google';
  }

  public getCachedHtml(blockId: string): string | undefined {
    return this.cache.get(blockId);
  }

  public async translateSingleBlock(block: PdfBlockItem, forceRefresh = false): Promise<void> {
    const transEl = document.getElementById(`trans_${block.id}`);
    if (!transEl) return;
    const transBody = transEl.querySelector('.translation-body') as HTMLElement | null;
    if (!transBody) return;

    if (!forceRefresh && this.cache.has(block.id)) {
      transEl.style.display = 'block';
      transBody.innerHTML = this.cache.get(block.id)!;
      return;
    }

    transEl.style.display = 'block';
    transBody.innerHTML = '<span class="translation-loading">正在进行结构保护学术研判...</span>';

    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: block.text,
          provider: this.provider,
          sourceLang: 'en',
          targetLang: 'zh',
          preserveStructure: true,
        }),
      });
      const data = await res.json();
      if (data.ok && data.translatedText) {
        const rendered = safeParsePaperMarkdown(data.translatedText);
        this.cache.set(block.id, rendered);
        transBody.innerHTML = rendered;
      } else {
        transBody.innerHTML = `<span style="color: var(--md-sys-color-error, #ba1a1a);">研判未命中: ${data.error || '通道繁忙'}</span>`;
      }
    } catch (e: any) {
      transBody.innerHTML = `<span style="color: var(--md-sys-color-error, #ba1a1a);">研判异常: ${e?.message || e}</span>`;
    }
  }

  public async translatePageBlocks(blocks: PdfBlockItem[], pageIndex: number, force = false): Promise<void> {
    const pageBlocks = blocks.filter(
      (b) => b.pageIndex === pageIndex && (b.type === 'text' || b.type === 'title') && b.text
    );
    for (const b of pageBlocks) {
      if (force || !this.cache.has(b.id)) {
        await this.translateSingleBlock(b, force);
      }
    }
  }

  public async translateAllBlocks(blocks: PdfBlockItem[]): Promise<void> {
    const textBlocks = blocks.filter((b) => (b.type === 'text' || b.type === 'title') && b.text);
    for (const b of textBlocks) {
      if (!this.cache.has(b.id)) {
        await this.translateSingleBlock(b, false);
      }
    }
  }
}
