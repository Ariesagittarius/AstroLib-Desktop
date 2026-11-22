import type { TokenSurprisal, HighlightConfig } from '../../types/info-highlight.ts';

interface TextNodeMapping {
  node: Text;
  start: number;
  end: number;
}

export class InfoHighlightRenderer {
  private static styleElement: HTMLStyleElement | null = null;
  private static activeRanges: Map<string, Range[]> = new Map();
  private static mappedText = '';
  private static textNodes: TextNodeMapping[] = [];

  private static ensureStyles(): void {
    if (this.styleElement && document.head.contains(this.styleElement)) {
      return;
    }

    const css = `
      /* AstroLib InfoLens 关注点透镜 CSS Custom Highlight 规则 */
      ::highlight(astrolib-focus-faded) {
        color: var(--focus-fade-color, rgba(140, 142, 150, 0.35));
      }

      ::highlight(astrolib-focus-anchor) {
        color: var(--focus-anchor-color, inherit);
        text-decoration: underline var(--focus-anchor-underline, rgba(0, 90, 193, 0.45)) 2px;
        text-underline-offset: 3px;
      }

      ::highlight(astrolib-focus-block-high) {
        background-color: var(--focus-block-high, rgba(0, 90, 193, 0.18));
      }

      ::highlight(astrolib-focus-block-med) {
        background-color: var(--focus-block-med, rgba(0, 90, 193, 0.09));
      }

      ::highlight(astrolib-focus-underline) {
        text-decoration: underline var(--focus-underline-color, #005ac1) 2px;
        text-underline-offset: 3px;
      }

      :root[data-theme='dark'] {
        --focus-fade-color: rgba(145, 148, 160, 0.32);
        --focus-block-high: rgba(168, 199, 250, 0.22);
        --focus-block-med: rgba(168, 199, 250, 0.11);
        --focus-anchor-underline: rgba(168, 199, 250, 0.55);
        --focus-underline-color: #a8c7fa;
      }
    `;

    const el = document.createElement('style');
    el.id = 'astrolib-info-highlight-styles';
    el.textContent = css;
    document.head.appendChild(el);
    this.styleElement = el;
  }

  static extractTextWithMapping(root: HTMLElement): { text: string; nodes: TextNodeMapping[] } {
    const nodes: TextNodeMapping[] = [];
    let currentOffset = 0;

    const ignoredTags = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'MD-ICON', 'SVG', 'RT', 'RP']);

    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node: Node) {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          if (ignoredTags.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
          if (
            parent.closest('.katex-mathml') ||
            parent.closest('.sideload-panel-view') ||
            parent.closest('.noteref') ||
            parent.closest('[data-astrolib-footnote]') ||
            parent.closest('.astrolib-footnote-popover')
          ) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );

    let textAcc = '';
    let curr = walker.nextNode();
    while (curr) {
      const textNode = curr as Text;
      const val = textNode.nodeValue || '';
      const len = val.length;
      if (len > 0) {
        nodes.push({
          node: textNode,
          start: currentOffset,
          end: currentOffset + len,
        });
        textAcc += val;
        currentOffset += len;
      }
      curr = walker.nextNode();
    }

    this.mappedText = textAcc;
    this.textNodes = nodes;
    return { text: textAcc, nodes };
  }

  private static createRangeFromOffsets(start: number, end: number): Range | null {
    if (start >= end || this.textNodes.length === 0) return null;

    let startNode: Text | null = null;
    let startOffset = 0;
    let endNode: Text | null = null;
    let endOffset = 0;

    for (const item of this.textNodes) {
      if (!startNode && start >= item.start && start < item.end) {
        startNode = item.node;
        startOffset = start - item.start;
      }
      if (!endNode && end > item.start && end <= item.end) {
        endNode = item.node;
        endOffset = end - item.start;
      }
      if (startNode && endNode) break;
    }

    if (!startNode || !endNode) return null;

    try {
      const range = document.createRange();
      range.setStart(startNode, startOffset);
      range.setEnd(endNode, endOffset);
      return range;
    } catch {
      return null;
    }
  }

  static apply(tokens: TokenSurprisal[], config: HighlightConfig): void {
    if (typeof CSS === 'undefined' || !(CSS as any).highlights) {
      console.warn('[InfoHighlightRenderer] 当前环境不支持 CSS Custom Highlight API');
      return;
    }

    this.ensureStyles();
    this.clear();

    const threshold = (config.thresholdPct || 35) / 100;
    const fadeRanges: Range[] = [];
    const anchorRanges: Range[] = [];
    const blockHighRanges: Range[] = [];
    const blockMedRanges: Range[] = [];
    const underlineRanges: Range[] = [];

    for (const tok of tokens) {
      const range = this.createRangeFromOffsets(tok.offset[0], tok.offset[1]);
      if (!range) continue;

      if (config.mode === 'fade') {
        if (tok.ciRatio < threshold) {

          fadeRanges.push(range);
        } else if (tok.ciRatio >= 0.65 || tok.level >= 10) {

          anchorRanges.push(range);
        }
      } else if (config.mode === 'block') {
        if (tok.ciRatio >= Math.max(threshold, 0.6)) {
          blockHighRanges.push(range);
        } else if (tok.ciRatio >= threshold) {
          blockMedRanges.push(range);
        }
      } else if (config.mode === 'underline') {
        if (tok.ciRatio >= threshold) {
          underlineRanges.push(range);
        }
      }
    }

    const hlRegistry = (CSS as any).highlights;
    const HighlightCtor = (window as any).Highlight;

    if (fadeRanges.length > 0) {
      hlRegistry.set('astrolib-focus-faded', new HighlightCtor(...fadeRanges));
    }
    if (anchorRanges.length > 0) {
      hlRegistry.set('astrolib-focus-anchor', new HighlightCtor(...anchorRanges));
    }
    if (blockHighRanges.length > 0) {
      hlRegistry.set('astrolib-focus-block-high', new HighlightCtor(...blockHighRanges));
    }
    if (blockMedRanges.length > 0) {
      hlRegistry.set('astrolib-focus-block-med', new HighlightCtor(...blockMedRanges));
    }
    if (underlineRanges.length > 0) {
      hlRegistry.set('astrolib-focus-underline', new HighlightCtor(...underlineRanges));
    }
  }

  static clear(): void {
    if (typeof CSS === 'undefined' || !(CSS as any).highlights) return;
    const hlRegistry = (CSS as any).highlights;
    const names = [
      'astrolib-focus-faded',
      'astrolib-focus-anchor',
      'astrolib-focus-block-high',
      'astrolib-focus-block-med',
      'astrolib-focus-underline',
    ];
    for (const name of names) {
      if (hlRegistry.has(name)) {
        hlRegistry.delete(name);
      }
    }
  }
}
