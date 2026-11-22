/**
 * src/core/book-formats/css-harmonizer.ts
 * ============================================================================
 * EPUB 样式作用域隔离与 Material You 分层融合引擎
 * ============================================================================
 * 目标：
 * 1. 彻底杜绝原书 CSS 污染 AstroLib 壳层 UI（顶栏 / 侧栏 / 批注 / 弹窗）；
 * 2. 给内嵌 @font-face 加书级命名空间前缀，并自动附加系统回退字体栈防子集字体缺字；
 * 3. 输出分层声明以无缝支撑三种实时切换模式：
 *    - harmonized（主题融合，默认）：保留微排版与结构，色彩接入 Material You tokens 与暗黑安全；
 *    - original（出版原貌）：保留原书装饰色与字体，仅规避暗色模式下黑字黑底或纯白刺眼背景；
 *    - reflow（统一重排）：原书样式零介入，由系统统一阅读版面接管。
 * ============================================================================
 */

import { resolveZipRelativePath } from './zip-reader.ts';

export interface HarmonizeCssParams {
  cssText: string;
  cssRelPath: string;
  /** 指向该书资产前缀，例如 `/collections/${colSlug}/${bookSlug}/assets/` */
  assetUrlPrefix: string;
  /** 书级唯一字体命名空间，防跨书子集字体冲突 */
  fontNamespace: string;
}

export interface HarmonizeCssResult {
  scopedCss: string;
  hasEmbeddedFonts: boolean;
  fontFamilies: string[];
}

interface CssAstBlock {
  type: 'rule' | 'at-rule' | 'at-block';
  prelude: string;
  body: string;
  children?: CssAstBlock[];
}

const STRUCTURAL_PROPS = new Set([
  'text-align',
  'text-align-last',
  'text-indent',
  'line-height',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'margin-block',
  'margin-inline',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'padding-block',
  'padding-inline',
  'font-size',
  'font-weight',
  'font-style',
  'font-variant',
  'font-variant-ligatures',
  'font-feature-settings',
  'vertical-align',
  'writing-mode',
  'text-orientation',
  'text-emphasis',
  'text-emphasis-style',
  'text-emphasis-position',
  '-webkit-text-emphasis',
  '-webkit-text-emphasis-style',
  '-webkit-text-emphasis-position',
  'text-combine-upright',
  '-webkit-text-combine',
  '-webkit-text-combine-upright',
  '-epub-text-combine',
  'hanging-punctuation',
  'text-spacing-trim',
  'letter-spacing',
  'word-spacing',
  'line-break',
  '-webkit-line-break',
  'word-break',
  '-webkit-word-break',
  'overflow-wrap',
  'word-wrap',
  'hyphens',
  '-webkit-hyphens',
  'text-decoration',
  'text-decoration-line',
  'text-decoration-style',
  'text-underline-position',
  '-webkit-text-underline-position',
  'text-underline-offset',
  'opacity',
  'display',
  'max-width',
  'max-height',
  'min-width',
  'min-height',
  'border',
  'border-top',
  'border-right',
  'border-bottom',
  'border-left',
  'border-width',
  'border-style',
  'border-radius',
  'list-style',
  'list-style-type',
  'list-style-position',
  'page-break-inside',
  'break-inside',
  'white-space',
  'text-shadow',
  'box-sizing',
  'float',
  'clear',
  'text-transform',
]);

const COLOR_PROPS = new Set([
  'color',
  'background',
  'background-color',
  'border-color',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'text-decoration-color',
  'text-emphasis-color',
  '-webkit-text-emphasis-color',
]);

function stripCssComments(css: string): string {
  return css
    .replace(/^\uFEFF/, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@charset\s+[^;]+;/gi, '');
}

function parseCssBlocks(raw: string): CssAstBlock[] {
  const blocks: CssAstBlock[] = [];
  let i = 0;
  const len = raw.length;

  while (i < len) {
    while (i < len && /\s/.test(raw[i])) i++;
    if (i >= len) break;

    let prelude = '';
    let inQuote: string | null = null;

    while (i < len) {
      const ch = raw[i];
      if (inQuote) {
        prelude += ch;
        if (ch === '\\' && i + 1 < len) {
          prelude += raw[++i];
        } else if (ch === inQuote) {
          inQuote = null;
        }
        i++;
        continue;
      }
      if (ch === '"' || ch === "'") {
        inQuote = ch;
        prelude += ch;
        i++;
        continue;
      }
      if (ch === '{' || ch === ';') break;
      prelude += ch;
      i++;
    }

    prelude = prelude.trim();
    if (i >= len) break;

    if (raw[i] === ';') {
      i++;
      if (prelude.startsWith('@')) {
        blocks.push({ type: 'at-rule', prelude, body: '' });
      }
      continue;
    }

    // raw[i] === '{'
    i++;
    let depth = 1;
    let body = '';
    inQuote = null;
    while (i < len && depth > 0) {
      const ch = raw[i];
      if (inQuote) {
        body += ch;
        if (ch === '\\' && i + 1 < len) {
          body += raw[++i];
        } else if (ch === inQuote) {
          inQuote = null;
        }
        i++;
        continue;
      }
      if (ch === '"' || ch === "'") {
        inQuote = ch;
        body += ch;
        i++;
        continue;
      }
      if (ch === '{') {
        depth++;
        body += ch;
      } else if (ch === '}') {
        depth--;
        if (depth > 0) body += ch;
      } else {
        body += ch;
      }
      i++;
    }

    const trimmedPrelude = prelude.trim();
    if (/^@(?:media|supports|layer|document|container)\b/i.test(trimmedPrelude)) {
      blocks.push({
        type: 'at-block',
        prelude: trimmedPrelude,
        body: body.trim(),
        children: parseCssBlocks(body),
      });
    } else if (trimmedPrelude.startsWith('@')) {
      blocks.push({
        type: 'at-rule',
        prelude: trimmedPrelude,
        body: body.trim(),
      });
    } else if (trimmedPrelude) {
      blocks.push({
        type: 'rule',
        prelude: trimmedPrelude,
        body: body.trim(),
      });
    }
  }

  return blocks;
}

function parseDeclarations(body: string): Array<{ prop: string; value: string }> {
  const decls: Array<{ prop: string; value: string }> = [];
  let current = '';
  let inQuote: string | null = null;
  let parenDepth = 0;

  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inQuote) {
      current += ch;
      if (ch === '\\' && i + 1 < body.length) {
        current += body[++i];
      } else if (ch === inQuote) {
        inQuote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuote = ch;
      current += ch;
      continue;
    }
    if (ch === '(') {
      parenDepth++;
      current += ch;
      continue;
    }
    if (ch === ')') {
      parenDepth = Math.max(0, parenDepth - 1);
      current += ch;
      continue;
    }
    if (ch === ';' && parenDepth === 0) {
      pushDecl(current, decls);
      current = '';
      continue;
    }
    current += ch;
  }
  pushDecl(current, decls);
  return decls;
}

function pushDecl(rawDecl: string, target: Array<{ prop: string; value: string }>): void {
  const trimmed = rawDecl.trim();
  if (!trimmed) return;
  const colonIdx = trimmed.indexOf(':');
  if (colonIdx <= 0) return;
  const prop = trimmed.slice(0, colonIdx).trim().toLowerCase();
  const value = trimmed.slice(colonIdx + 1).trim();
  if (!prop || !value) return;
  if (/javascript:|expression\s*\(/i.test(value)) return;
  target.push({ prop, value });
}

function splitCommaTopLevel(input: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuote: string | null = null;
  let parenDepth = 0;
  let bracketDepth = 0;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inQuote) {
      current += ch;
      if (ch === '\\' && i + 1 < input.length) {
        current += input[++i];
      } else if (ch === inQuote) {
        inQuote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuote = ch;
      current += ch;
      continue;
    }
    if (ch === '(') parenDepth++;
    else if (ch === ')') parenDepth = Math.max(0, parenDepth - 1);
    else if (ch === '[') bracketDepth++;
    else if (ch === ']') bracketDepth = Math.max(0, bracketDepth - 1);
    else if (ch === ',' && parenDepth === 0 && bracketDepth === 0) {
      if (current.trim()) result.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) result.push(current.trim());
  return result;
}

function stripQuotes(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

function normalizeColorToRgb(val: string): { r: number; g: number; b: number; alpha: number } | null {
  const v = val.replace(/\s*!important$/i, '').trim().toLowerCase();
  if (v === 'black') return { r: 0, g: 0, b: 0, alpha: 1 };
  if (v === 'white') return { r: 255, g: 255, b: 255, alpha: 1 };
  if (v === 'transparent') return { r: 0, g: 0, b: 0, alpha: 0 };

  const hex3 = v.match(/^#([0-9a-f]{3})$/);
  if (hex3) {
    const h = hex3[1];
    return {
      r: parseInt(h[0] + h[0], 16),
      g: parseInt(h[1] + h[1], 16),
      b: parseInt(h[2] + h[2], 16),
      alpha: 1,
    };
  }
  const hex6 = v.match(/^#([0-9a-f]{6})$/);
  if (hex6) {
    const h = hex6[1];
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      alpha: 1,
    };
  }
  const rgbMatch = v.match(/^rgba?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*[,\s]\s*([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/);
  if (rgbMatch) {
    return {
      r: Number(rgbMatch[1]),
      g: Number(rgbMatch[2]),
      b: Number(rgbMatch[3]),
      alpha: rgbMatch[4] !== undefined ? Number(rgbMatch[4]) : 1,
    };
  }
  return null;
}

function isNeutralGrayOrBlackWhite(rgb: { r: number; g: number; b: number }): boolean {
  const max = Math.max(rgb.r, rgb.g, rgb.b);
  const min = Math.min(rgb.r, rgb.g, rgb.b);
  // 极低饱和度视为黑白灰中性色
  return max - min <= 22;
}

function scopeSingleSelector(selector: string, scopeAttrPrefix: string): string {
  let s = selector.trim();
  if (!s) return '';

  // 替换 html / :root / body 为正文内置安全嵌套宿主类名
  s = s.replace(/(^|[\s>+~])(:root|html)(?=$|[\s.#:[>+~])/gi, '$1.astrolib-epub-html');
  s = s.replace(/(^|[\s>+~])body(?=$|[\s.#:[>+~])/gi, '$1.astrolib-epub-body');

  if (s.startsWith('.astrolib-epub-html') || s.startsWith('.astrolib-epub-body')) {
    return `${scopeAttrPrefix} ${s}`;
  }
  return `${scopeAttrPrefix} ${s}`;
}

function buildScopedSelectors(rawPrelude: string, scopeAttrPrefix: string): string {
  const prefixes = splitCommaTopLevel(scopeAttrPrefix);
  const rawSelectors = splitCommaTopLevel(rawPrelude);
  const parts: string[] = [];
  for (const prefix of prefixes) {
    for (const sel of rawSelectors) {
      const scoped = scopeSingleSelector(sel, prefix);
      if (scoped) parts.push(scoped);
    }
  }
  return parts.join(', ');
}

function rewriteFontFamilyValue(
  rawValue: string,
  fontMap: Map<string, string>,
  fallbackStack: string
): string {
  const hasImportant = /\s*!important$/i.test(rawValue);
  const cleanVal = rawValue.replace(/\s*!important$/i, '').trim();
  const families = splitCommaTopLevel(cleanVal);
  const mapped: string[] = [];

  for (const f of families) {
    const name = stripQuotes(f);
    if (!name) continue;
    const scoped = fontMap.get(name.toLowerCase());
    if (scoped) {
      mapped.push(`"${scoped}"`);
    } else {
      mapped.push(f);
    }
  }

  // 子集字体必须追加完整字库兜底栈，避免生僻字或标点退回浏览器粗糙宋体
  if (mapped.length > 0 && !cleanVal.includes('var(--academic-font-cjk')) {
    mapped.push(fallbackStack);
  }

  const out = mapped.join(', ') || cleanVal;
  return hasImportant ? `${out} !important` : out;
}

export function harmonizeEpubCss(params: HarmonizeCssParams): HarmonizeCssResult {
  const { cssText, cssRelPath, assetUrlPrefix, fontNamespace } = params;
  const cleaned = stripCssComments(cssText);
  const blocks = parseCssBlocks(cleaned);

  const fontMap = new Map<string, string>();
  const fontFamilies: string[] = [];
  const fontFaceRules: string[] = [];

  // 第一遍扫描所有 @font-face，建立命名空间字体映射并重写相对字体路径
  const collectFontFaces = (list: CssAstBlock[]) => {
    for (const block of list) {
      if (block.type === 'at-rule' && /^@font-face$/i.test(block.prelude)) {
        const decls = parseDeclarations(block.body);
        const origFamilyDecl = decls.find((d) => d.prop === 'font-family');
        if (!origFamilyDecl) continue;

        const origFamily = stripQuotes(origFamilyDecl.value);
        if (!origFamily) continue;

        const scopedFamily = `${fontNamespace}__${origFamily}`;
        if (!fontMap.has(origFamily.toLowerCase())) {
          fontMap.set(origFamily.toLowerCase(), scopedFamily);
          fontFamilies.push(origFamily);
        }

        const rewrittenDecls: string[] = [];
        for (const d of decls) {
          if (d.prop === 'font-family') {
            rewrittenDecls.push(`font-family: "${scopedFamily}"`);
          } else if (d.prop === 'src') {
            const rewrittenSrc = d.value.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (_m, _q, relUrl) => {
              const trimmedUrl = String(relUrl || '').trim();
              if (/^(?:data:|https?:|\/)/i.test(trimmedUrl)) {
                return `url("${trimmedUrl}")`;
              }
              const resolvedRel = resolveZipRelativePath(cssRelPath, trimmedUrl);
              return `url("${assetUrlPrefix}${encodeURI(resolvedRel)}")`;
            });
            rewrittenDecls.push(`src: ${rewrittenSrc}`);
          } else {
            rewrittenDecls.push(`${d.prop}: ${d.value}`);
          }
        }
        fontFaceRules.push(`@font-face {\n  ${rewrittenDecls.join(';\n  ')};\n}`);
      } else if (block.type === 'at-block' && block.children) {
        collectFontFaces(block.children);
      }
    }
  };

  collectFontFaces(blocks);

  const fallbackFontStack =
    'var(--font-reading, "Noto Serif SC Variable", "Noto Sans SC Variable", "Source Han Serif SC", "Source Han Sans SC", sans-serif)';

  const processBlockList = (list: CssAstBlock[]): string => {
    const out: string[] = [];

    for (const block of list) {
      if (block.type === 'at-rule') {
        // @font-face 已顶层输出，@import / @page 不透传破坏全局
        continue;
      }

      if (block.type === 'at-block' && block.children) {
        const inner = processBlockList(block.children);
        if (inner.trim()) {
          out.push(`${block.prelude} {\n${inner}\n}`);
        }
        continue;
      }

      if (block.type === 'rule') {
        const decls = parseDeclarations(block.body);
        if (decls.length === 0) continue;

        const isRootTarget = /(?:^|[\s,])(?:html|body|:root)(?:$|[.\s#:[>+~,])/i.test(block.prelude);

        const structuralDecls: string[] = [];
        const fontDecls: string[] = [];
        const originalColorLightDecls: string[] = [];
        const originalColorDarkDecls: string[] = [];
        const harmonizedColorLightDecls: string[] = [];
        const harmonizedColorDarkDecls: string[] = [];

        for (const { prop, value } of decls) {
          // 跳过破坏壳层视口或分页容器的定位与绝对宽度规则
          if (prop === 'position' && /\b(?:fixed|sticky)\b/i.test(value)) continue;
          if (prop === 'overflow' || prop === 'overflow-x' || prop === 'overflow-y') {
            if (isRootTarget) continue;
          }
          if ((prop === 'width' || prop === 'height') && isRootTarget && !/^auto$/i.test(value)) {
            continue;
          }

          if (prop === 'font-family') {
            const rewritten = rewriteFontFamilyValue(value, fontMap, fallbackFontStack);
            fontDecls.push(`font-family: ${rewritten}`);
            continue;
          }

          if (prop === 'content') {
            // 仅允许安全文本伪元素内容（例如 .hanla:after { content: " "; } 或 content: none）
            if (/^none$|^normal$/i.test(value) || /^(['"]).*\1$/.test(value)) {
              structuralDecls.push(`${prop}: ${value}`);
            }
            continue;
          }

          if (prop === 'width' || prop === 'height') {
            // 图片、表格等容器可保留合法尺寸，但不能强制溢出容器
            structuralDecls.push(`${prop}: ${value}`);
            continue;
          }

          if (STRUCTURAL_PROPS.has(prop)) {
            // 对根节点 body/html 的背景与全局字号留给系统滑块协调，但保留 line-height、text-align 等排版节奏
            if (isRootTarget && prop === 'font-size') {
              continue;
            }
            structuralDecls.push(`${prop}: ${value}`);
            continue;
          }

          if (COLOR_PROPS.has(prop)) {
            if (isRootTarget && (prop === 'background' || prop === 'background-color')) {
              // 根容器背景交由主题切换，避免遮挡暗色表面
              continue;
            }
            const rgb = normalizeColorToRgb(value);

            // A. 出版原貌 (original)
            if (prop === 'background' || prop === 'background-color') {
              originalColorLightDecls.push(`${prop}: ${value}`);
              if (!rgb || (rgb.alpha > 0 && rgb.r < 220 && rgb.g < 220 && rgb.b < 220)) {
                originalColorDarkDecls.push(`${prop}: ${value}`);
              }
            } else if (prop === 'color') {
              originalColorLightDecls.push(`${prop}: ${value}`);
              if (!rgb || !isNeutralGrayOrBlackWhite(rgb) || (rgb.r > 130 && rgb.g > 130 && rgb.b > 130)) {
                originalColorDarkDecls.push(`${prop}: ${value}`);
              }
            } else {
              originalColorLightDecls.push(`${prop}: ${value}`);
              originalColorDarkDecls.push(`${prop}: ${value}`);
            }

            // B. 主题融合 (harmonized)
            if (prop === 'color' && rgb && !isNeutralGrayOrBlackWhite(rgb)) {
              const cleanColor = value.replace(/\s*!important$/i, '').trim();
              harmonizedColorLightDecls.push(
                `color: color-mix(in srgb, var(--md-sys-color-primary, #0b57d0) 68%, ${cleanColor})`
              );
              harmonizedColorDarkDecls.push(
                `color: color-mix(in srgb, var(--md-sys-color-primary, #a8c7fa) 45%, ${cleanColor})`
              );
            } else if (prop.includes('border') && rgb && !isNeutralGrayOrBlackWhite(rgb)) {
              const cleanColor = value.replace(/\s*!important$/i, '').trim();
              harmonizedColorLightDecls.push(
                `${prop}: color-mix(in srgb, var(--md-sys-color-primary, #0b57d0) 55%, ${cleanColor})`
              );
              harmonizedColorDarkDecls.push(
                `${prop}: color-mix(in srgb, var(--md-sys-color-primary, #a8c7fa) 55%, ${cleanColor})`
              );
            }
          }
        }

        // 1. 结构微排版：适用于 harmonized 与 original
        if (structuralDecls.length > 0) {
          const sel = buildScopedSelectors(
            block.prelude,
            'html:not([data-style-mode="reflow"]) .astrolib-book-scope'
          );
          if (sel) {
            out.push(`${sel} {\n  ${structuralDecls.join(';\n  ')};\n}`);
          }
        }

        // 2. 原书嵌入字体：original 默认使用，harmonized 在启用“优先原书字体”时使用
        if (fontDecls.length > 0) {
          const sel = buildScopedSelectors(
            block.prelude,
            'html[data-style-mode="original"] .astrolib-book-scope, html[data-style-mode="harmonized"][data-use-book-fonts="true"] .astrolib-book-scope'
          );
          if (sel) {
            out.push(`${sel} {\n  ${fontDecls.join(';\n  ')};\n}`);
          }
        }

        // 3. 色彩分层：出版原貌（区分明暗安全）
        if (originalColorLightDecls.length > 0) {
          const sel = buildScopedSelectors(
            block.prelude,
            'html[data-style-mode="original"]:not([data-theme="dark"]) .astrolib-book-scope'
          );
          if (sel) {
            out.push(`${sel} {\n  ${originalColorLightDecls.join(';\n  ')};\n}`);
          }
        }
        if (originalColorDarkDecls.length > 0) {
          const sel = buildScopedSelectors(
            block.prelude,
            'html[data-style-mode="original"][data-theme="dark"] .astrolib-book-scope'
          );
          if (sel) {
            out.push(`${sel} {\n  ${originalColorDarkDecls.join(';\n  ')};\n}`);
          }
        }

        // 4. 色彩分层：主题融合（有色装饰融入 M3 Primary）
        if (harmonizedColorLightDecls.length > 0) {
          const sel = buildScopedSelectors(
            block.prelude,
            'html[data-style-mode="harmonized"]:not([data-theme="dark"]) .astrolib-book-scope'
          );
          if (sel) {
            out.push(`${sel} {\n  ${harmonizedColorLightDecls.join(';\n  ')};\n}`);
          }
        }
        if (harmonizedColorDarkDecls.length > 0) {
          const sel = buildScopedSelectors(
            block.prelude,
            'html[data-style-mode="harmonized"][data-theme="dark"] .astrolib-book-scope'
          );
          if (sel) {
            out.push(`${sel} {\n  ${harmonizedColorDarkDecls.join(';\n  ')};\n}`);
          }
        }
      }
    }

    return out.join('\n\n');
  };

  const bodyRulesCss = processBlockList(blocks);
  const scopedCss = [fontFaceRules.join('\n\n'), bodyRulesCss].filter(Boolean).join('\n\n');

  return {
    scopedCss,
    hasEmbeddedFonts: fontFamilies.length > 0,
    fontFamilies,
  };
}
