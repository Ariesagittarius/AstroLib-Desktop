import { unified } from 'unified';
import rehypeParse from 'rehype-parse';
import rehypeStringify from 'rehype-stringify';
import type { Element, Parent, Properties, Root, RootContent } from 'hast';
import { escapeHtml, escapeHtmlAttr } from './html-escape.ts';

export { escapeHtml, escapeHtmlAttr };

const DANGEROUS_DROP_TAGS = new Set([
  'script',
  'style',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'base',
  'meta',
  'link',
  'form',
  'input',
  'textarea',
  'select',
  'option',
  'optgroup',
  'noscript',
  'template',
  'slot',
  'title',
  'foreignobject',
  'animate',
  'animatemotion',
  'animatetransform',
  'set',
  'mpath',
  'handler',
  'listener',
  'audio',
  'video',
  'source',
  'track',
  'canvas',
  'portal',
]);

const ALLOWED_TAGS = new Set([
  'a', 'abbr', 'address', 'article', 'aside', 'b', 'bdi', 'bdo', 'blockquote', 'br', 'button',
  'caption', 'cite', 'code', 'col', 'colgroup', 'data', 'dd', 'del', 'details', 'dfn', 'div',
  'dl', 'dt', 'em', 'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'header', 'hgroup', 'hr', 'i', 'img', 'ins', 'kbd', 'li', 'main', 'mark', 'nav', 'ol', 'p',
  'pre', 'q', 'rp', 'rt', 'ruby', 's', 'samp', 'section', 'small', 'span', 'strong', 'sub',
  'summary', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'time', 'tr', 'u', 'ul',
  'var', 'wbr',
  'card', 'guide', 'note', 'sidenote', 'theorem', 'definition', 'lemma', 'proposition',
  'corollary', 'remark', 'example', 'proof', 'exercise', 'solution', 'algorithm', 'resource',
  'callout',
  'math', 'semantics', 'mrow', 'mi', 'mo', 'mn', 'ms', 'mtext', 'mspace', 'msup', 'msub',
  'msubsup', 'mfrac', 'msqrt', 'mroot', 'mtable', 'mtr', 'mtd', 'mover', 'munder', 'munderover',
  'mpadded', 'menclose', 'mstyle', 'mphantom', 'merror', 'mlabeledtr', 'annotation', 'annotation-xml',
  'svg', 'g', 'path', 'line', 'rect', 'circle', 'ellipse', 'polyline', 'polygon', 'text',
  'tspan', 'defs', 'clippath', 'mask', 'marker', 'use', 'lineargradient', 'radialgradient',
  'stop', 'pattern', 'symbol',
]);

const ALLOWED_GLOBAL_PROPS = new Set([
  'id',
  'class',
  'classname',
  'title',
  'role',
  'lang',
  'dir',
  'tabindex',
  'hidden',
  'style',
]);

const ALLOWED_ELEMENT_PROPS = new Set([
  'href', 'src', 'target', 'rel', 'alt', 'width', 'height', 'loading', 'decoding',
  'type', 'open', 'colspan', 'rowspan', 'scope', 'headers', 'start', 'reversed', 'datetime', 'value',
  'xmlns', 'display', 'encoding', 'mathvariant', 'stretchy', 'fence', 'separator', 'lspace', 'rspace',
  'accent', 'accentunder', 'columnalign', 'rowalign', 'columnspacing', 'rowspacing', 'scriptlevel',
  'displaystyle', 'linethickness', 'notation', 'symmetric', 'maxsize', 'minsize', 'movablelimits',
  'viewbox', 'preserveaspectratio', 'd', 'fill', 'fillopacity', 'fillrule', 'stroke', 'strokewidth',
  'strokelinecap', 'strokelinejoin', 'strokedasharray', 'strokedashoffset', 'strokeopacity', 'points',
  'x', 'y', 'x1', 'y1', 'x2', 'y2', 'dx', 'dy', 'cx', 'cy', 'r', 'rx', 'ry', 'fx', 'fy',
  'transform', 'opacity', 'textanchor', 'dominantbaseline', 'fontsize', 'fontfamily', 'fontweight',
  'fontstyle', 'markerstart', 'markermid', 'markerend', 'clippath', 'cliprule', 'offset',
  'stopcolor', 'stopopacity', 'gradientunits', 'gradienttransform', 'patternunits', 'xmlnsxlink',
  'xlinkhref', 'refx', 'refy', 'markerwidth', 'markerheight', 'orient',
]);

const SAFE_URL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:', 'astrolib:']);
const SAFE_DATA_IMAGE_RE = /^data:image\/(?:png|jpe?g|gif|webp|avif|bmp|ico);base64,[a-z0-9+/=\s]+$/i;
const SAFE_DATA_SVG_RE = /^data:image\/svg\+xml/i;
const DANGEROUS_STYLE_RE = /(?:url\s*\(|expression\s*\(|@import|-moz-binding|behavior\s*:|javascript:|vbscript:|<\/style)/i;

function createHtmlProcessor() {
  return unified()
    .use(rehypeParse, { fragment: true })
    .use(rehypeStringify, { allowDangerousHtml: false });
}

let htmlProcessor: ReturnType<typeof createHtmlProcessor> | null = null;

function getProcessor() {
  if (!htmlProcessor) {
    htmlProcessor = createHtmlProcessor();
  }
  return htmlProcessor;
}

export function isSafeUrl(rawUrl: string, context: 'href' | 'src' | 'use' = 'href'): boolean {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return false;
  }

  const normalized = trimmed.replace(/[\u0000-\u0020\u007f]+/g, '');
  if (!normalized) {
    return false;
  }

  if (context === 'use') {
    return normalized.startsWith('#');
  }

  if (
    normalized.startsWith('#') ||
    normalized.startsWith('./') ||
    normalized.startsWith('../') ||
    normalized.startsWith('?') ||
    (normalized.startsWith('/') && !normalized.startsWith('//'))
  ) {
    return true;
  }

  if (SAFE_DATA_SVG_RE.test(normalized)) {
    return false;
  }

  if (context === 'src' && SAFE_DATA_IMAGE_RE.test(normalized)) {
    return true;
  }

  const schemeMatch = normalized.match(/^([a-z][a-z0-9+.-]*):/i);
  if (!schemeMatch) {
    return !normalized.startsWith('//');
  }

  const protocol = `${schemeMatch[1].toLowerCase()}:`;
  return SAFE_URL_PROTOCOLS.has(protocol);
}

export function sanitizeCssStyle(styleValue: string): string {
  const declarations = styleValue.split(';');
  const safeParts: string[] = [];
  for (const decl of declarations) {
    const trimmed = decl.trim();
    if (!trimmed) continue;
    if (DANGEROUS_STYLE_RE.test(trimmed)) continue;
    safeParts.push(trimmed);
  }
  return safeParts.join('; ');
}

function isAllowedCustomProp(key: string): boolean {
  if (/^data[A-Z0-9_-]/.test(key) || key.startsWith('data-')) {
    return true;
  }
  if (/^aria[A-Z0-9_-]/.test(key) || key.startsWith('aria-')) {
    return true;
  }
  return false;
}

function sanitizeProperties(tagName: string, rawProps: Properties | undefined): Properties {
  const safeProps: Properties = {};
  if (!rawProps) {
    return safeProps;
  }

  let hasBlankTarget = false;

  for (const [key, val] of Object.entries(rawProps)) {
    if (val === undefined || val === null) continue;

    if (/^on/i.test(key) || key === 'srcdoc' || key === 'srcDoc' || key === 'formaction' || key === 'formAction') {
      continue;
    }

    const lowerKey = key.toLowerCase();
    const isAllowed =
      ALLOWED_GLOBAL_PROPS.has(lowerKey) ||
      ALLOWED_ELEMENT_PROPS.has(lowerKey) ||
      isAllowedCustomProp(key);

    if (!isAllowed) {
      continue;
    }

    if (lowerKey === 'style') {
      const cleanedStyle = sanitizeCssStyle(String(val));
      if (cleanedStyle) {
        safeProps[key] = cleanedStyle;
      }
      continue;
    }

    if (lowerKey === 'href' || lowerKey === 'xlinkhref') {
      const urlStr = String(val);
      const urlCtx = tagName === 'use' ? 'use' : 'href';
      if (!isSafeUrl(urlStr, urlCtx)) {
        continue;
      }
      safeProps[key] = urlStr.trim();
      continue;
    }

    if (lowerKey === 'src') {
      const urlStr = String(val);
      if (!isSafeUrl(urlStr, 'src')) {
        continue;
      }
      safeProps[key] = urlStr.trim();
      continue;
    }

    if (tagName === 'button' && lowerKey === 'type') {
      const btnType = String(val).toLowerCase();
      safeProps[key] = btnType === 'reset' ? 'reset' : 'button';
      continue;
    }

    if (tagName === 'a' && lowerKey === 'target') {
      const targetVal = String(val).trim();
      if (targetVal === '_blank') {
        hasBlankTarget = true;
      }
      safeProps[key] = targetVal;
      continue;
    }

    if (Array.isArray(val)) {
      safeProps[key] = val.map((item) => String(item));
    } else if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
      safeProps[key] = val;
    }
  }

  if (tagName === 'a' && hasBlankTarget) {
    const rawRel = safeProps.rel;
    const existingTokens = Array.isArray(rawRel)
      ? rawRel.map(String)
      : String(rawRel ?? '').split(/\s+/).filter(Boolean);
    const tokens = new Set(existingTokens);
    tokens.add('noopener');
    tokens.add('noreferrer');
    safeProps.rel = Array.from(tokens);
  }

  return safeProps;
}

function sanitizeChildren(children: RootContent[]): RootContent[] {
  const result: RootContent[] = [];

  for (const child of children) {
    if (child.type === 'text') {
      result.push(child);
      continue;
    }

    if (child.type === 'comment' || child.type === 'doctype') {
      continue;
    }

    if (child.type === 'element') {
      const tag = child.tagName.toLowerCase();

      if (DANGEROUS_DROP_TAGS.has(tag)) {
        continue;
      }

      const sanitizedSubChildren = sanitizeChildren(child.children as RootContent[]);

      if (!ALLOWED_TAGS.has(tag)) {
        for (const unwrapped of sanitizedSubChildren) {
          result.push(unwrapped);
        }
        continue;
      }

      const cleanedEl: Element = {
        type: 'element',
        tagName: tag,
        properties: sanitizeProperties(tag, child.properties),
        children: sanitizedSubChildren as Element['children'],
      };
      result.push(cleanedEl);
    }
  }

  return result;
}

export function sanitizeAcademicHtml(html: string): string {
  if (!html) {
    return '';
  }

  const processor = getProcessor();
  const root = processor.parse(html) as Root;
  root.children = sanitizeChildren((root as Parent).children as RootContent[]);
  return String(processor.stringify(root));
}
