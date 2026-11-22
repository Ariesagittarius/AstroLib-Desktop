import {
  ABP_SCHEMA_VERSION,
  type AbpBundlePayload,
  type AstroBookChapterPayload,
  type AstroBookManifest,
  type AstroBookSection,
  type BookFootnoteEntry,
  type ChapterContentKind,
  type ChapterHeadingItem,
} from '../../types/content-package.ts';
import {
  isSafeIdentifier,
  isSafeRelativePath,
  isSafeSlug,
} from '../../services/content-provider/install-validation.ts';
import { harmonizeEpubCss } from './css-harmonizer.ts';
import { sanitizeAcademicHtml } from '../security/html-sanitizer.ts';
import type {
  BookNormalizeOptions,
  IBookFormatAdapter,
  NormalizedBookResult,
} from './types.ts';
import {
  ZipArchive,
  encodeBytesToBase64,
  resolveZipRelativePath,
} from './zip-reader.ts';

interface OpfManifestItem {
  id: string;
  href: string;
  fullPath: string;
  mediaType: string;
  properties: string[];
}

interface NavTocNode {
  title: string;
  fullPath: string;
  fragment?: string;
  children: NavTocNode[];
}

interface SpineChapterRecord {
  index: number;
  slug: string;
  title: string;
  fullPath: string;
  rawBodyHtml: string;
  htmlClasses: string[];
  bodyClasses: string[];
  chapterKind: ChapterContentKind;
  headings: ChapterHeadingItem[];
  footnotes: Record<string, BookFootnoteEntry>;
  plainText: string;
  inNav: boolean;
}

const VOID_HTML_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

function fnv1aHex(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function decodeXmlEntities(str: string): string {
  return str
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/&#(\d+);/g, (_m, dec) => {
      const code = parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function parseAttributes(attrText: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z0-9_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrText)) !== null) {
    attrs[m[1].toLowerCase()] = decodeXmlEntities(m[2] ?? m[3] ?? '');
  }
  return attrs;
}

function stripTagsToPlainText(html: string, stripRubyAnnotations = true): string {
  let work = html;
  if (stripRubyAnnotations) {
    work = work
      .replace(/<rt\b[^>]*>[\s\S]*?<\/rt>/gi, '')
      .replace(/<rp\b[^>]*>[\s\S]*?<\/rp>/gi, '');
  }
  return decodeXmlEntities(work.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function expandNonVoidSelfClosingTags(xhtml: string): string {
  return xhtml.replace(/<([a-zA-Z][a-zA-Z0-9:-]*)(\s+[^>]*?)?\s*\/>/g, (full, tagName: string, attrs = '') => {
    const lower = tagName.toLowerCase();
    if (VOID_HTML_TAGS.has(lower) || lower === 'svg' || lower === 'image' || lower === 'path' || lower === 'use') {
      return full;
    }
    return `<${tagName}${attrs}></${tagName}>`;
  });
}

function makeSafeSlugToken(raw: string, fallbackPrefix: string): string {
  const normalized = raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  if (normalized && isSafeSlug(normalized)) {
    return normalized.slice(0, 64);
  }
  return `${fallbackPrefix}-${fnv1aHex(raw)}`;
}

function inferCollectionSlug(params: {
  preferredCollection?: string;
  title: string;
  publisher?: string;
  subjects: string[];
  description?: string;
}): string {
  const { preferredCollection, title, publisher = '', subjects, description = '' } = params;
  if (preferredCollection && isSafeIdentifier(preferredCollection)) {
    return preferredCollection;
  }

  const hay = `${title} ${publisher} ${subjects.join(' ')} ${description}`.toLowerCase();
  if (/电击文库|轻小说|角川|富士见|mf文库|ga文库|二次元|acg|とある|暗部|物语|异世界|魔法禁书/i.test(hay)) {
    return 'acg';
  }
  if (/美学|艺术|设计|摄影|建筑|绘画|美术|版画|书法/i.test(hay)) {
    return 'aesthetics';
  }
  if (/微积分|线性代数|概率论|图论|数学分析|物理|量子|通信|算法|计算机/.test(hay)) {
    return 'general';
  }
  return 'literature';
}

function parseContainerRootfile(containerXml: string): string {
  const m = containerXml.match(/<rootfile\b[^>]*full-path\s*=\s*["']([^"']+)["']/i);
  if (!m || !m[1]) {
    throw new Error('EPUB 缺少有效的 META-INF/container.xml rootfile 路径');
  }
  return m[1].trim().replace(/^\/+/, '');
}

function parseOpfDocument(opfXml: string, opfPath: string): {
  title: string;
  author: string;
  publisher: string;
  description: string;
  language: string;
  identifier: string;
  subjects: string[];
  coverHref: string | null;
  writingMode: 'horizontal-tb' | 'vertical-rl';
  manifestById: Map<string, OpfManifestItem>;
  manifestByPath: Map<string, OpfManifestItem>;
  spineIds: string[];
  navFullPath: string | null;
  ncxFullPath: string | null;
} {
  const extractFirstTagText = (tag: string): string => {
    const re = new RegExp(`<(?:[a-z0-9_-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[a-z0-9_-]+:)?${tag}>`, 'i');
    const m = opfXml.match(re);
    return m ? stripTagsToPlainText(m[1], false) : '';
  };

  const extractAllTagTexts = (tag: string): string[] => {
    const re = new RegExp(`<(?:[a-z0-9_-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[a-z0-9_-]+:)?${tag}>`, 'gi');
    const results: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(opfXml)) !== null) {
      const text = stripTagsToPlainText(m[1], false);
      if (text) results.push(text);
    }
    return results;
  };

  const title = extractFirstTagText('title') || '未命名 EPUB 图书';
  const creators = extractAllTagTexts('creator');
  const author = creators.join('、');
  const publisher = extractFirstTagText('publisher');
  const description = extractFirstTagText('description');
  const language = extractFirstTagText('language') || 'zh-CN';
  const identifier = extractFirstTagText('identifier') || title;
  const subjects = extractAllTagTexts('subject');

  const manifestById = new Map<string, OpfManifestItem>();
  const manifestByPath = new Map<string, OpfManifestItem>();
  let navFullPath: string | null = null;
  let ncxFullPath: string | null = null;
  let coverIdFromMeta: string | null = null;
  let coverHref: string | null = null;

  const metaRe = /<meta\b([^>]*?)\/?>/gi;
  let mm: RegExpExecArray | null;
  while ((mm = metaRe.exec(opfXml)) !== null) {
    const attrs = parseAttributes(mm[1]);
    if (attrs.name === 'cover' && attrs.content) {
      coverIdFromMeta = attrs.content.trim();
    }
  }

  const itemRe = /<item\b([^>]*?)\/?>/gi;
  while ((mm = itemRe.exec(opfXml)) !== null) {
    const attrs = parseAttributes(mm[1]);
    const id = attrs.id || '';
    const href = attrs.href || '';
    const mediaType = (attrs['media-type'] || '').toLowerCase();
    const props = (attrs.properties || '').split(/\s+/).filter(Boolean);
    if (!id || !href) continue;

    const fullPath = resolveZipRelativePath(opfPath, href);
    const entry: OpfManifestItem = { id, href, fullPath, mediaType, properties: props };
    manifestById.set(id, entry);
    manifestByPath.set(fullPath.toLowerCase(), entry);

    if (props.includes('nav')) {
      navFullPath = fullPath;
    }
    if (mediaType === 'application/x-dtbncx+xml') {
      ncxFullPath = fullPath;
    }
    if (props.includes('cover-image')) {
      coverHref = fullPath;
    }
  }

  if (!coverHref && coverIdFromMeta && manifestById.has(coverIdFromMeta)) {
    coverHref = manifestById.get(coverIdFromMeta)!.fullPath;
  }
  if (!coverHref) {
    for (const item of manifestById.values()) {
      if (item.mediaType.startsWith('image/') && /(?:^|\/)cover\.(?:jpe?g|png|webp|gif)$/i.test(item.fullPath)) {
        coverHref = item.fullPath;
        break;
      }
    }
  }

  const spineTagMatch = opfXml.match(/<spine\b([^>]*)>([\s\S]*?)<\/spine>/i);
  const spineAttrs = spineTagMatch ? parseAttributes(spineTagMatch[1]) : {};
  const ppd = (spineAttrs['page-progression-direction'] || '').toLowerCase();
  const writingMode: 'horizontal-tb' | 'vertical-rl' = ppd === 'rtl' ? 'vertical-rl' : 'horizontal-tb';

  const spineIds: string[] = [];
  if (spineTagMatch) {
    const itemrefRe = /<itemref\b([^>]*?)\/?>/gi;
    let rm: RegExpExecArray | null;
    while ((rm = itemrefRe.exec(spineTagMatch[2])) !== null) {
      const attrs = parseAttributes(rm[1]);
      if (attrs.linear === 'no') continue;
      if (attrs.idref) spineIds.push(attrs.idref);
    }
  }

  return {
    title,
    author,
    publisher,
    description,
    language,
    identifier,
    subjects,
    coverHref,
    writingMode,
    manifestById,
    manifestByPath,
    spineIds,
    navFullPath,
    ncxFullPath,
  };
}

function parseNavOlList(olInnerHtml: string, baseFilePath: string): NavTocNode[] {
  const nodes: NavTocNode[] = [];
  let cursor = 0;

  while (cursor < olInnerHtml.length) {
    const liOpenIdx = olInnerHtml.indexOf('<li', cursor);
    if (liOpenIdx < 0) break;
    const liTagEnd = olInnerHtml.indexOf('>', liOpenIdx);
    if (liTagEnd < 0) break;

    let depth = 1;
    let scan = liTagEnd + 1;
    const liRegex = /<\/?li\b[^>]*>/gi;
    liRegex.lastIndex = scan;
    let m: RegExpExecArray | null;
    let liCloseIdx = olInnerHtml.length;

    while ((m = liRegex.exec(olInnerHtml)) !== null) {
      if (m[0].toLowerCase().startsWith('</li')) {
        depth--;
        if (depth === 0) {
          liCloseIdx = m.index;
          cursor = liRegex.lastIndex;
          break;
        }
      } else {
        depth++;
      }
    }
    if (depth > 0) cursor = olInnerHtml.length;

    const liInner = olInnerHtml.slice(liTagEnd + 1, liCloseIdx);
    const olIdx = liInner.search(/<ol\b/i);
    const headPart = olIdx >= 0 ? liInner.slice(0, olIdx) : liInner;
    const tailPart = olIdx >= 0 ? liInner.slice(olIdx) : '';

    const aMatch = headPart.match(/<a\b([^>]*)>([\s\S]*?)<\/a>/i);
    let children: NavTocNode[] = [];
    if (tailPart) {
      const nestedOl = tailPart.match(/<ol\b[^>]*>([\s\S]*)<\/ol>/i);
      if (nestedOl) {
        children = parseNavOlList(nestedOl[1], baseFilePath);
      }
    }

    if (aMatch) {
      const attrs = parseAttributes(aMatch[1]);
      const href = attrs.href || '';
      const hashIdx = href.indexOf('#');
      const rawPath = hashIdx >= 0 ? href.slice(0, hashIdx) : href;
      const fragment = hashIdx >= 0 ? href.slice(hashIdx + 1) : undefined;
      const fullPath = rawPath ? resolveZipRelativePath(baseFilePath, rawPath) : baseFilePath;
      const title = stripTagsToPlainText(aMatch[2], true) || '未命名章节';
      nodes.push({ title, fullPath, fragment, children });
    }
  }

  return nodes;
}

function parseEpub3Nav(navXhtml: string, navPath: string): NavTocNode[] {
  const tocNavMatch =
    navXhtml.match(/<nav\b[^>]*epub:type\s*=\s*["'][^"']*\btoc\b[^"']*["'][^>]*>([\s\S]*?)<\/nav>/i) ||
    navXhtml.match(/<nav\b[^>]*>([\s\S]*?)<\/nav>/i);
  if (!tocNavMatch) return [];
  const olMatch = tocNavMatch[1].match(/<ol\b[^>]*>([\s\S]*)<\/ol>/i);
  if (!olMatch) return [];
  return parseNavOlList(olMatch[1], navPath);
}

function parseNcxNavMap(ncxXml: string, ncxPath: string): NavTocNode[] {
  const navMapMatch = ncxXml.match(/<navMap\b[^>]*>([\s\S]*?)<\/navMap>/i);
  if (!navMapMatch) return [];

  const nodes: NavTocNode[] = [];
  const npRe = /<navPoint\b[^>]*>([\s\S]*?)<\/navPoint>/gi;
  let m: RegExpExecArray | null;
  while ((m = npRe.exec(navMapMatch[1])) !== null) {
    const body = m[1];
    const labelMatch = body.match(/<navLabel\b[^>]*>[\s\S]*?<text\b[^>]*>([\s\S]*?)<\/text>[\s\S]*?<\/navLabel>/i);
    const contentMatch = body.match(/<content\b[^>]*src\s*=\s*["']([^"']+)["']/i);
    if (labelMatch && contentMatch) {
      const href = decodeXmlEntities(contentMatch[1]);
      const hashIdx = href.indexOf('#');
      const rawPath = hashIdx >= 0 ? href.slice(0, hashIdx) : href;
      const fragment = hashIdx >= 0 ? href.slice(hashIdx + 1) : undefined;
      const fullPath = resolveZipRelativePath(ncxPath, rawPath);
      const title = stripTagsToPlainText(labelMatch[1], true) || '未命名章节';
      nodes.push({ title, fullPath, fragment, children: [] });
    }
  }
  return nodes;
}

function findBalancedClosingIndex(html: string, openTagEnd: number, tagName: string): number {
  const tagRegex = new RegExp(`<(/?)${tagName}\\b[^>]*>`, 'gi');
  tagRegex.lastIndex = openTagEnd;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = tagRegex.exec(html)) !== null) {
    const isSelfClosing = m[0].endsWith('/>');
    if (isSelfClosing) continue;
    if (m[1] === '/') {
      depth--;
      if (depth === 0) return m.index + m[0].length;
    } else {
      depth++;
    }
  }
  return -1;
}

function extractFootnotesFromXhtml(
  xhtml: string,
  chapterSlug: string,
  referencedTargetIds: Set<string>
): Record<string, BookFootnoteEntry> {
  const entries: Record<string, BookFootnoteEntry> = {};

  const explicitRe =
    /<([a-z0-9]+)\b([^>]*\b(?:epub:type\s*=\s*["'][^"']*(?:footnote|endnote|rearnote)[^"']*["']|class\s*=\s*["'][^"']*\bfootnote\b[^"']*["'])[^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = explicitRe.exec(xhtml)) !== null) {
    const tagName = m[1];
    const attrs = parseAttributes(m[2]);
    const id = attrs.id;
    if (!id) continue;
    const endIdx = findBalancedClosingIndex(xhtml, m.index + m[0].length, tagName);
    if (endIdx < 0) continue;

    const fullBlock = xhtml.slice(m.index, endIdx);
    const innerOnly = fullBlock
      .replace(/^<[^>]+>/, '')
      .replace(/<\/[^>]+>$/, '')
      .replace(/<a\b[^>]*>(?:\s*⤶\s*|\s*↩\s*|\s*↑\s*|\s*back\s*)<\/a>/gi, '')
      .trim();
    const expanded = expandNonVoidSelfClosingTags(innerOnly);
    const text = stripTagsToPlainText(expanded, true);
    if (text) {
      entries[id] = { id, html: expanded, text, chapterSlug };
    }
  }

  for (const targetId of referencedTargetIds) {
    if (entries[targetId]) continue;
    const escaped = targetId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const idRe = new RegExp(`<([a-z0-9]+)\\b([^>]*\\bid\\s*=\\s*["']${escaped}["'][^>]*)>`, 'i');
    const hit = idRe.exec(xhtml);
    if (!hit) continue;
    const tagName = hit[1];
    const endIdx = findBalancedClosingIndex(xhtml, hit.index + hit[0].length, tagName);
    if (endIdx < 0) continue;
    const fullBlock = xhtml.slice(hit.index, endIdx);
    const innerOnly = fullBlock
      .replace(/^<[^>]+>/, '')
      .replace(/<\/[^>]+>$/, '')
      .replace(/<a\b[^>]*>(?:\s*⤶\s*|\s*↩\s*|\s*↑\s*|\s*back\s*)<\/a>/gi, '')
      .trim();
    const expanded = expandNonVoidSelfClosingTags(innerOnly);
    const text = stripTagsToPlainText(expanded, true);
    if (text) {
      entries[targetId] = { id: targetId, html: expanded, text, chapterSlug };
    }
  }

  return entries;
}

function detectChapterKind(params: {
  spinePath: string;
  bodyInnerHtml: string;
  bodyClasses: string[];
  bodyEpType?: string;
  navTitle?: string;
}): ChapterContentKind {
  const { spinePath, bodyInnerHtml, bodyClasses, bodyEpType = '', navTitle = '' } = params;
  const plain = stripTagsToPlainText(bodyInnerHtml, true);
  const hasImg = /<(?:img|image|svg)\b/i.test(bodyInnerHtml);
  const lowerPath = spinePath.toLowerCase();
  const lowerEpType = bodyEpType.toLowerCase();

  if (lowerEpType.includes('cover') || /cover/.test(lowerPath)) {
    if (hasImg && plain.length < 30 && !/allcover/.test(lowerPath)) {
      return 'cover';
    }
  }
  if (/colophon|制作信息|版权/.test(lowerPath + ' ' + bodyClasses.join(' ') + ' ' + navTitle)) {
    return 'colophon';
  }
  if (/note|注释/.test(lowerPath) || lowerEpType.includes('endnotes') || /footnote/.test(bodyInnerHtml)) {
    if (plain.includes('译注') || /注释/.test(navTitle) || /p-note/i.test(lowerPath)) {
      return 'notes';
    }
  }
  if (hasImg && plain.length < 28) {
    return 'illustration';
  }
  if (/caution|fmatter|titlepage|frontmatter/.test(lowerPath)) {
    return 'frontmatter';
  }
  return 'body';
}

function inferFallbackSpineTitle(params: {
  spinePath: string;
  bodyInnerHtml: string;
  chapterKind: ChapterContentKind;
  illustrationCounter: { count: number };
}): string {
  const { spinePath, bodyInnerHtml, chapterKind, illustrationCounter } = params;
  const lowerPath = spinePath.toLowerCase();

  if (chapterKind === 'cover') return '封面';
  if (lowerPath.includes('titlepage')) return '扉页';
  if (lowerPath.includes('allcover')) return '全幅封面插画';
  if (lowerPath.includes('caution')) return '阅读说明';
  if (lowerPath.includes('colophon')) return '制作与版权信息';
  if (lowerPath.includes('p-note')) return '译注与注释';

  const h1Match = bodyInnerHtml.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match) {
    const t = stripTagsToPlainText(h1Match[1], true);
    if (t) return t;
  }
  const h2Match = bodyInnerHtml.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i);
  if (h2Match) {
    const t = stripTagsToPlainText(h2Match[1], true);
    if (t) return t;
  }

  if (chapterKind === 'illustration') {
    const altMatch = bodyInnerHtml.match(/\balt\s*=\s*["']([^"']+)["']/i);
    if (altMatch && altMatch[1].trim()) {
      return altMatch[1].trim();
    }
    illustrationCounter.count++;
    return `卷首彩插 ${illustrationCounter.count}`;
  }

  const baseName = spinePath.split('/').pop()?.replace(/\.x?html?$/i, '') || '章节';
  return baseName;
}

export class EpubFormatAdapter implements IBookFormatAdapter {
  public readonly format = 'epub' as const;
  public readonly extensions = ['.epub'] as const;

  public canHandle(fileName: string, data?: Uint8Array): boolean {
    if (fileName && fileName.toLowerCase().endsWith('.epub')) {
      return true;
    }
    if (data && data.byteLength >= 4) {

      if (data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04) {
        try {
          const zip = ZipArchive.fromBytes(data);
          return zip.hasEntry('META-INF/container.xml');
        } catch {
          return false;
        }
      }
    }
    return false;
  }

  public async normalize(data: Uint8Array, options: BookNormalizeOptions = {}): Promise<NormalizedBookResult> {
    const zip = ZipArchive.fromBytes(data);
    if (!zip.hasEntry('META-INF/container.xml')) {
      throw new Error('无效的 EPUB 文件：缺少 META-INF/container.xml');
    }

    const containerXml = await zip.readEntryText('META-INF/container.xml');
    const opfPath = parseContainerRootfile(containerXml);
    if (!zip.hasEntry(opfPath)) {
      throw new Error(`无效的 EPUB 文件：未找到 OPF 清单 ${opfPath}`);
    }

    const opfXml = await zip.readEntryText(opfPath);
    const opf = parseOpfDocument(opfXml, opfPath);

    const fileStem = (options.fileName || 'epub-book').replace(/\.epub$/i, '');
    const resolvedTitle = opf.title || fileStem;
    const colSlug = inferCollectionSlug({
      preferredCollection: options.preferredCollection,
      title: resolvedTitle,
      publisher: opf.publisher,
      subjects: opf.subjects,
      description: opf.description,
    });
    const bookSlug = makeSafeSlugToken(
      `${fileStem}-${opf.identifier}`,
      'epub'
    );
    const bookId = `${colSlug}-${bookSlug}`;
    const readingProfile = options.readingProfile || 'literary';

    let navNodes: NavTocNode[] = [];
    if (opf.navFullPath && zip.hasEntry(opf.navFullPath)) {
      const navHtml = await zip.readEntryText(opf.navFullPath);
      navNodes = parseEpub3Nav(navHtml, opf.navFullPath);
    }
    if (navNodes.length === 0 && opf.ncxFullPath && zip.hasEntry(opf.ncxFullPath)) {
      const ncxXml = await zip.readEntryText(opf.ncxFullPath);
      navNodes = parseNcxNavMap(ncxXml, opf.ncxFullPath);
    }

    const navTitleByPath = new Map<string, string>();
    const navSubHeadingsByPath = new Map<string, Array<{ title: string; fragment: string }>>();

    const walkNav = (nodes: NavTocNode[], isTopLevel: boolean) => {
      for (const n of nodes) {
        const pathKey = n.fullPath.toLowerCase();
        if (!n.fragment && !navTitleByPath.has(pathKey)) {
          navTitleByPath.set(pathKey, n.title);
        } else if (isTopLevel && !navTitleByPath.has(pathKey)) {
          navTitleByPath.set(pathKey, n.title);
        }
        if (n.fragment) {
          const list = navSubHeadingsByPath.get(pathKey) || [];
          list.push({ title: n.title, fragment: n.fragment });
          navSubHeadingsByPath.set(pathKey, list);
        }
        if (n.children.length > 0) {
          walkNav(n.children, false);
        }
      }
    };
    walkNav(navNodes, true);

    const bundleAssets: Record<string, string> = {};
    const manifestAssetList: string[] = [];
    const zipPathToAssetRelPath = new Map<string, string>();
    const cssItems: OpfManifestItem[] = [];

    for (const item of opf.manifestById.values()) {
      if (!zip.hasEntry(item.fullPath)) continue;
      const lowerMime = item.mediaType.toLowerCase();
      if (lowerMime === 'text/css' || item.fullPath.toLowerCase().endsWith('.css')) {
        cssItems.push(item);
        continue;
      }
      if (
        lowerMime === 'application/xhtml+xml' ||
        lowerMime === 'text/html' ||
        lowerMime === 'application/x-dtbncx+xml'
      ) {
        continue;
      }

      const rawBytes = await zip.readEntryBytes(item.fullPath);
      const assetRel = `assets/${item.fullPath}`.replace(/\/+/g, '/');
      if (!isSafeRelativePath(assetRel)) continue;

      bundleAssets[assetRel] = encodeBytesToBase64(rawBytes);
      manifestAssetList.push(assetRel);
      zipPathToAssetRelPath.set(item.fullPath.toLowerCase(), assetRel);
    }

    let combinedScopedCss = '';
    let hasEmbeddedFonts = false;
    const assetRoutePrefix = `/collections/${colSlug}/${bookSlug}/`;
    const fontNamespace = `ep_${fnv1aHex(bookId)}`;

    for (const cssItem of cssItems) {
      const cssRaw = await zip.readEntryText(cssItem.fullPath);
      const result = harmonizeEpubCss({
        cssText: cssRaw,
        cssRelPath: cssItem.fullPath,
        assetUrlPrefix: `${assetRoutePrefix}assets/`,
        fontNamespace,
      });
      if (result.scopedCss.trim()) {
        combinedScopedCss += `\n/* source: ${cssItem.fullPath} */\n${result.scopedCss}\n`;
      }
      if (result.hasEmbeddedFonts) {
        hasEmbeddedFonts = true;
      }
    }

    const stylesheets: string[] = [];
    if (combinedScopedCss.trim()) {
      const cssRel = 'styles/epub-book.css';
      const cssBytes = new TextEncoder().encode(combinedScopedCss);
      bundleAssets[cssRel] = encodeBytesToBase64(cssBytes);
      manifestAssetList.push(cssRel);
      stylesheets.push(cssRel);
    }

    const spinePaths: string[] = [];
    for (const idref of opf.spineIds) {
      const item = opf.manifestById.get(idref);
      if (item && zip.hasEntry(item.fullPath)) {
        spinePaths.push(item.fullPath);
      }
    }
    if (spinePaths.length === 0) {
      for (const item of opf.manifestById.values()) {
        if (
          (item.mediaType === 'application/xhtml+xml' || item.mediaType === 'text/html') &&
          item.fullPath !== opf.navFullPath &&
          zip.hasEntry(item.fullPath)
        ) {
          spinePaths.push(item.fullPath);
        }
      }
    }
    if (spinePaths.length === 0) {
      throw new Error('EPUB 中未包含可读章节文件');
    }

    const slugBySpinePath = new Map<string, string>();
    const usedSlugs = new Set<string>();
    spinePaths.forEach((fullPath, idx) => {
      const pad = String(idx + 1).padStart(3, '0');
      const stem = (fullPath.split('/').pop() || `chap-${pad}`).replace(/\.x?html?$/i, '');
      let candidate = `${pad}_${makeSafeSlugToken(stem, `ch${pad}`)}`;
      let dup = 2;
      while (usedSlugs.has(candidate)) {
        candidate = `${pad}_${makeSafeSlugToken(stem, `ch${pad}`)}_${dup++}`;
      }
      usedSlugs.add(candidate);
      slugBySpinePath.set(fullPath.toLowerCase(), candidate);
    });

    const rawHtmlBySpinePath = new Map<string, string>();
    const referencedNoteIdsByPath = new Map<string, Set<string>>();

    for (const spinePath of spinePaths) {
      const rawHtml = await zip.readEntryText(spinePath);
      rawHtmlBySpinePath.set(spinePath, rawHtml);

      const noteRefRe = /<a\b([^>]*?)>/gi;
      let m: RegExpExecArray | null;
      while ((m = noteRefRe.exec(rawHtml)) !== null) {
        const attrs = parseAttributes(m[1]);
        const href = attrs.href || '';
        const epubType = (attrs['epub:type'] || '').toLowerCase();
        const cls = (attrs.class || '').toLowerCase();
        if (!href) continue;
        if (epubType.includes('noteref') || cls.includes('noteref') || href.includes('#note')) {
          const hashIdx = href.indexOf('#');
          if (hashIdx >= 0) {
            const targetId = href.slice(hashIdx + 1).trim();
            const relPart = href.slice(0, hashIdx);
            const targetPath = relPart ? resolveZipRelativePath(spinePath, relPart) : spinePath;
            const set = referencedNoteIdsByPath.get(targetPath.toLowerCase()) || new Set<string>();
            if (targetId) set.add(targetId);
            referencedNoteIdsByPath.set(targetPath.toLowerCase(), set);
          }
        }
      }
    }

    const globalFootnotes: Record<string, BookFootnoteEntry> = {};
    for (const spinePath of spinePaths) {
      const rawHtml = rawHtmlBySpinePath.get(spinePath) || '';
      const chapSlug = slugBySpinePath.get(spinePath.toLowerCase())!;
      const refSet = referencedNoteIdsByPath.get(spinePath.toLowerCase()) || new Set<string>();
      const extracted = extractFootnotesFromXhtml(rawHtml, chapSlug, refSet);
      for (const [noteId, entry] of Object.entries(extracted)) {
        globalFootnotes[noteId] = entry;
      }
    }

    const records: SpineChapterRecord[] = [];
    const illustrationCounter = { count: 0 };
    const updatedAt = new Date().toISOString();

    for (let idx = 0; idx < spinePaths.length; idx++) {
      const spinePath = spinePaths[idx];
      const chapSlug = slugBySpinePath.get(spinePath.toLowerCase())!;
      const rawXhtml = rawHtmlBySpinePath.get(spinePath) || '';

      const htmlAttrMatch = rawXhtml.match(/<html\b([^>]*)>/i);
      const htmlAttrs = htmlAttrMatch ? parseAttributes(htmlAttrMatch[1]) : {};
      const htmlClasses = (htmlAttrs.class || '').split(/\s+/).filter(Boolean);

      const bodyMatch = rawXhtml.match(/<body\b([^>]*)>([\s\S]*?)<\/body>/i);
      const bodyAttrs = bodyMatch ? parseAttributes(bodyMatch[1]) : {};
      const bodyClasses = (bodyAttrs.class || '').split(/\s+/).filter(Boolean);
      const bodyEpType = bodyAttrs['epub:type'] || '';
      const rawBody = bodyMatch ? bodyMatch[2] : rawXhtml;

      const navTitle = navTitleByPath.get(spinePath.toLowerCase());
      const chapterKind = detectChapterKind({
        spinePath,
        bodyInnerHtml: rawBody,
        bodyClasses,
        bodyEpType,
        navTitle,
      });

      const title =
        navTitle ||
        inferFallbackSpineTitle({
          spinePath,
          bodyInnerHtml: rawBody,
          chapterKind,
          illustrationCounter,
        });

      let cleanBody = sanitizeAcademicHtml(expandNonVoidSelfClosingTags(rawBody));

      cleanBody = cleanBody.replace(
        /(\b(?:src|xlink:href|poster)\s*=\s*)(["'])([^"']+)\2/gi,
        (full, prefix, quote, rawVal: string) => {
          const val = rawVal.trim();
          if (!val || /^(?:data:|https?:|#|mailto:)/i.test(val)) {
            return full;
          }
          const resolvedZip = resolveZipRelativePath(spinePath, val);
          const assetRel = zipPathToAssetRelPath.get(resolvedZip.toLowerCase());
          if (assetRel) {
            return `${prefix}${quote}${assetRoutePrefix}${encodeURI(assetRel)}${quote}`;
          }
          return full;
        }
      );
      cleanBody = cleanBody.replace(
        /(<image\b[^>]*?\bhref\s*=\s*)(["'])([^"']+)\2/gi,
        (full, prefix, quote, rawVal: string) => {
          const val = rawVal.trim();
          if (!val || /^(?:data:|https?:|#|mailto:)/i.test(val)) {
            return full;
          }
          const resolvedZip = resolveZipRelativePath(spinePath, val);
          const assetRel = zipPathToAssetRelPath.get(resolvedZip.toLowerCase());
          if (assetRel) {
            return `${prefix}${quote}${assetRoutePrefix}${encodeURI(assetRel)}${quote}`;
          }
          return full;
        }
      );

      const chapterFootnotes: Record<string, BookFootnoteEntry> = {};
      cleanBody = cleanBody.replace(/<a\b([^>]*)>/gi, (full, attrText: string) => {
        const attrs = parseAttributes(attrText);
        const href = attrs.href;
        if (!href || /^(?:https?:|mailto:|tel:)/i.test(href)) {
          return full;
        }

        const hashIdx = href.indexOf('#');
        const relPart = hashIdx >= 0 ? href.slice(0, hashIdx) : href;
        const fragment = hashIdx >= 0 ? href.slice(hashIdx + 1) : '';
        const targetZip = relPart ? resolveZipRelativePath(spinePath, relPart) : spinePath;
        const targetSlug = slugBySpinePath.get(targetZip.toLowerCase());

        let newHref = href;
        if (targetSlug) {
          const baseHref = `/collections/${colSlug}/${bookSlug}/${targetSlug}/`;
          newHref = fragment ? `${baseHref}#${encodeURIComponent(fragment)}` : baseHref;
        } else {
          const assetRel = zipPathToAssetRelPath.get(targetZip.toLowerCase());
          if (assetRel) {
            newHref = `${assetRoutePrefix}${encodeURI(assetRel)}`;
          }
        }

        let updatedTag = full.replace(
          /(\bhref\s*=\s*)(["'])([^"']*)\2/i,
          `$1"${newHref.replace(/"/g, '&quot;')}"`
        );

        const isNoteRef =
          (attrs['epub:type'] || '').toLowerCase().includes('noteref') ||
          (attrs.class || '').toLowerCase().includes('noteref');
        if (fragment && globalFootnotes[fragment] && isNoteRef) {
          chapterFootnotes[fragment] = globalFootnotes[fragment];
          if (!/\bdata-astrolib-footnote\s*=/.test(updatedTag)) {
            updatedTag = updatedTag.replace(/^<a\b/i, `<a data-astrolib-footnote="${fragment.replace(/"/g, '&quot;')}"`);
          }
        }

        return updatedTag;
      });

      let autoHeadingSeq = 0;
      const headings: ChapterHeadingItem[] = [];
      const seenHeadingIds = new Set<string>();

      cleanBody = cleanBody.replace(/<h([2-4])\b([^>]*)>([\s\S]*?)<\/h\1>/gi, (full, lvlStr, attrText, inner) => {
        const depth = parseInt(lvlStr, 10);
        const attrs = parseAttributes(attrText);
        let hid = attrs.id || '';
        const text = stripTagsToPlainText(inner, true);
        let resultTag = full;
        if (!hid) {
          autoHeadingSeq++;
          hid = `ep-h-${idx + 1}-${autoHeadingSeq}`;
          resultTag = `<h${lvlStr} id="${hid}"${attrText}>${inner}</h${lvlStr}>`;
        }
        if (text && !seenHeadingIds.has(hid)) {
          seenHeadingIds.add(hid);
          headings.push({ depth, text, id: hid });
        }
        return resultTag;
      });

      const navSubs = navSubHeadingsByPath.get(spinePath.toLowerCase()) || [];
      for (const sub of navSubs) {
        if (!seenHeadingIds.has(sub.fragment)) {
          seenHeadingIds.add(sub.fragment);
          headings.push({ depth: 2, text: sub.title, id: sub.fragment });
        }
      }

      let autoParaSeq = 0;
      cleanBody = cleanBody.replace(/<p\b([^>]*)>/gi, (full, attrText: string) => {
        if (/\bid\s*=/.test(attrText)) return full;
        autoParaSeq++;
        return `<p id="ep-${idx + 1}-p-${autoParaSeq}"${attrText}>`;
      });

      const plainText = stripTagsToPlainText(cleanBody, true);

      records.push({
        index: idx,
        slug: chapSlug,
        title,
        fullPath: spinePath,
        rawBodyHtml: cleanBody,
        htmlClasses,
        bodyClasses,
        chapterKind,
        headings,
        footnotes: chapterFootnotes,
        plainText,
        inNav: Boolean(navTitle),
      });
    }

    const chapters: Record<string, AstroBookChapterPayload> = {};
    const contentSeedParts: string[] = [resolvedTitle, opf.author, opf.publisher];

    for (const rec of records) {
      const wordCount = rec.plainText.length;
      const readingTimeMinutes = Math.max(1, Math.round(wordCount / 360));
      contentSeedParts.push(`${rec.slug}:${rec.plainText.length}`);

      chapters[rec.slug] = {
        schemaVersion: ABP_SCHEMA_VERSION,
        bookId,
        bookSlug,
        colSlug,
        chapterSlug: rec.slug,
        title: rec.title,
        html: rec.rawBodyHtml,
        headings: rec.headings,
        readingTimeMinutes,
        chapterKind: rec.chapterKind,
        bodyClasses: rec.bodyClasses,
        htmlClasses: rec.htmlClasses,
        stylesheets: stylesheets.length > 0 ? stylesheets : undefined,
        footnotes: Object.keys(rec.footnotes).length > 0 ? rec.footnotes : undefined,
        updatedAt,
      };
    }

    const frontmatterRecords: SpineChapterRecord[] = [];
    const mainRecords: SpineChapterRecord[] = [];
    let passedBodyStart = false;

    for (const rec of records) {
      const isFrontDecor =
        !passedBodyStart &&
        !rec.inNav &&
        (rec.chapterKind === 'cover' || rec.chapterKind === 'illustration' || rec.chapterKind === 'frontmatter');

      if (isFrontDecor) {
        frontmatterRecords.push(rec);
      } else {
        if (rec.chapterKind === 'body' || rec.inNav) {
          passedBodyStart = true;
        }
        mainRecords.push(rec);
      }
    }

    const sections: AstroBookSection[] = [];
    const toChapterSummary = (rec: SpineChapterRecord, order: number) => ({
      id: `ch-${rec.slug}`,
      title: rec.title,
      slug: rec.slug,
      sourcePath: rec.fullPath,
      path: `chapters/${rec.slug}.json`,
      hash: fnv1aHex(`${rec.slug}:${rec.rawBodyHtml}`),
      sizeBytes: new TextEncoder().encode(rec.rawBodyHtml).byteLength,
      order,
    });

    if (frontmatterRecords.length > 1) {
      sections.push({
        id: 'sec-frontmatter',
        slug: 'frontmatter',
        title: '卷首彩插与扉页',
        collapsed: true,
        order: 0,
        chapters: frontmatterRecords.map((r, i) => toChapterSummary(r, i)),
      });
    } else if (frontmatterRecords.length === 1) {
      mainRecords.unshift(frontmatterRecords[0]);
    }

    sections.push({
      id: 'sec-main',
      slug: 'main',
      title: sections.length > 0 ? '正文与附录' : '全部章节',
      collapsed: false,
      order: sections.length,
      chapters: mainRecords.map((r, i) => toChapterSummary(r, i)),
    });

    const preferredEntry =
      records.find((r) => r.inNav && r.chapterKind === 'body') ||
      records.find((r) => r.chapterKind === 'body') ||
      records[0];

    const coverAssetRel = opf.coverHref ? zipPathToAssetRelPath.get(opf.coverHref.toLowerCase()) : undefined;
    const coverUrl = coverAssetRel ? `/abp-packs/${bookId}/${coverAssetRel}` : undefined;

    const aiChunks: Array<{
      id: string;
      kind: 'heading' | 'paragraph';
      type: string;
      title: string;
      number: string;
      text: string;
      url: string;
      line: number;
    }> = [];

    for (const rec of records) {
      const pageUrl = `/collections/${colSlug}/${bookSlug}/${rec.slug}/`;
      if (rec.plainText.length > 0) {

        aiChunks.push({
          id: `${rec.slug}-heading`,
          kind: 'heading',
          type: '章节',
          title: rec.title,
          number: String(rec.index + 1),
          text: rec.plainText.slice(0, 800),
          url: pageUrl,
          line: 1,
        });
      }

      const text = rec.plainText;
      const chunkLen = 750;
      for (let pos = 0, partIdx = 0; pos < text.length; pos += chunkLen, partIdx++) {
        const slice = text.slice(pos, pos + chunkLen);
        if (slice.length < 12 && partIdx > 0) continue;
        const firstHeading = rec.headings[0]?.id;
        aiChunks.push({
          id: `${rec.slug}-chunk-${partIdx}`,
          kind: 'paragraph',
          type: '正文',
          title: partIdx === 0 ? rec.title : `${rec.title}（${partIdx + 1}）`,
          number: `${rec.index + 1}.${partIdx + 1}`,
          text: slice,
          url: partIdx === 0 && firstHeading ? `${pageUrl}#${encodeURIComponent(firstHeading)}` : pageUrl,
          line: partIdx * 20 + 2,
        });
      }
    }

    const aiIndex = {
      meta: {
        col: colSlug,
        book: bookSlug,
        title: resolvedTitle,
        count: aiChunks.length,
        updatedAt,
      },
      chunks: aiChunks,
    };

    const manifest: AstroBookManifest = {
      schemaVersion: ABP_SCHEMA_VERSION,
      id: bookId,
      slug: bookSlug,
      colSlug,
      title: resolvedTitle,
      ...(opf.author ? { author: opf.author } : {}),
      ...(opf.publisher ? { publisher: opf.publisher } : {}),
      ...(opf.description ? { description: opf.description } : {}),
      ...(opf.subjects.length > 0 ? { tags: opf.subjects } : {}),
      ...(coverUrl ? { cover: coverUrl } : {}),
      category: colSlug,
      categoryLabel:
        colSlug === 'acg'
          ? '轻小说与二次元'
          : colSlug === 'aesthetics'
            ? '艺术与美学'
            : colSlug === 'literature'
              ? '文学与文化'
              : '综合读物',
      entryPoint: preferredEntry.slug,
      sections,
      totalChapters: records.length,
      updatedAt,
      contentHash: fnv1aHex(contentSeedParts.join('|')),
      assets: manifestAssetList,
      sourceFormat: 'epub',
      readingProfile,
      writingMode: opf.writingMode,
      language: opf.language,
      stylesheets: stylesheets.length > 0 ? stylesheets : undefined,
      hasEmbeddedFonts,
      ...(options.keepOriginalArchive !== false ? { originalArchive: 'source/original.epub' } : {}),
      ...(Object.keys(globalFootnotes).length > 0 ? { footnotes: globalFootnotes } : {}),
    };

    const bundle: AbpBundlePayload = {
      manifest,
      chapters,
      assets: bundleAssets,
      aiIndex,
    };

    const result: NormalizedBookResult = {
      bundle,
      sourceFormat: 'epub',
    };

    if (options.keepOriginalArchive !== false) {
      result.sourceArchive = {
        fileName: 'original.epub',
        bytes: data,
      };
    }

    return result;
  }
}
