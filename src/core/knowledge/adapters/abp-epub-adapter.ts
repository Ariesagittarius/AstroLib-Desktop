import fs from 'node:fs';
import path from 'node:path';
import { resolveAbpPackCandidateDirs } from '../../catalog/content-paths.ts';
import type {
  AstroBookChapterPayload,
  AstroBookManifest,
} from '../../../types/content-package.ts';
import { parseAstrolibUri } from '../../../utils/astrolib-uri.ts';
import type {
  IKnowledgeAdapter,
  KnowledgeBlock,
  KnowledgeBlockKind,
  KnowledgeDocumentSummary,
  KnowledgeOutlineNode,
  KnowledgeSearchHit,
  KnowledgeSectionContent,
  KnowledgeSectionImage,
  KnowledgeSourceFormat,
  ReadSectionOptions,
  SearchKnowledgeOptions,
} from '../types.ts';

interface AbpPackEntry {
  key: string;
  abpRootDir: string;
  bookDir: string;
  manifest: AstroBookManifest;
  sourceFormat: 'abp' | 'epub';
}

interface CachedAbpChunk {
  sectionId: string;
  sectionTitle: string;
  blockId?: string;
  text: string;
}

interface CachedAbpIndex {
  schemaVersion: 1;
  updatedAt: string;
  chunks: CachedAbpChunk[];
}

function decodeHtmlEntities(str: string): string {
  return (str || '')
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

export function htmlFragmentToAcademicText(html: string): string {
  if (!html) return '';
  let work = html;

  work = work.replace(
    /<div\b[^>]*class="[^"]*katex-display-container[^"]*"[^>]*data-latex="([^"]*)"[^>]*>[\s\S]*?<\/div>(?:\s*<\/div>)?/gi,
    (_m, encoded) => {
      let tex = encoded;
      try {
        tex = decodeURIComponent(encoded);
      } catch {}
      tex = decodeHtmlEntities(tex).trim();
      return tex ? `\n$$\n${tex}\n$$\n` : ' ';
    }
  );

  work = work.replace(
    /<span\b[^>]*class="[^"]*\bkatex-display\b[^"]*"[^>]*>[\s\S]*?<annotation\s+encoding="application\/x-tex">([\s\S]*?)<\/annotation>[\s\S]*?<\/span>\s*<\/span>\s*<\/span>/gi,
    (_m, tex) => `\n$$\n${decodeHtmlEntities(tex).trim()}\n$$\n`
  );
  work = work.replace(
    /<span\b[^>]*class="[^"]*\bkatex\b[^"]*"[^>]*>[\s\S]*?<annotation\s+encoding="application\/x-tex">([\s\S]*?)<\/annotation>[\s\S]*?<\/span>\s*<\/span>/gi,
    (_m, tex) => `$${decodeHtmlEntities(tex).trim()}$`
  );

  work = work.replace(/<span\b[^>]*class="[^"]*katex-html[^"]*"[^>]*>[\s\S]*?<\/span>/gi, '');

  work = work
    .replace(/<rt\b[^>]*>[\s\S]*?<\/rt>/gi, '')
    .replace(/<rp\b[^>]*>[\s\S]*?<\/rp>/gi, '');

  work = work
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|tr|h[1-6]|blockquote|section|article|figcaption)>/gi, '\n')
    .replace(/<(?:td|th)\b[^>]*>/gi, ' | ');

  work = decodeHtmlEntities(work.replace(/<[^>]+>/g, ''));
  return work
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function findMatchingTagEnd(html: string, openTagStart: number, openTagEnd: number, tagName: string): number {
  const openRe = new RegExp(`<${tagName}(?:\\s|>)`, 'gi');
  const closeRe = new RegExp(`</${tagName}\\s*>`, 'gi');
  let depth = 1;
  let pos = openTagEnd;
  while (depth > 0 && pos < html.length) {
    openRe.lastIndex = pos;
    closeRe.lastIndex = pos;
    const nextOpen = openRe.exec(html);
    const nextClose = closeRe.exec(html);
    if (!nextClose) return html.length;
    if (nextOpen && nextOpen.index < nextClose.index) {
      depth++;
      pos = nextOpen.index + nextOpen[0].length;
    } else {
      depth--;
      pos = nextClose.index + nextClose[0].length;
      if (depth === 0) return pos;
    }
  }
  return html.length;
}

export function extractBlocksFromCompiledHtml(params: {
  html: string;
  docUri: string;
  sectionId: string;
  colSlug: string;
  bookSlug: string;
}): { blocks: KnowledgeBlock[]; images: KnowledgeSectionImage[] } {
  const { html, docUri, sectionId, colSlug, bookSlug } = params;
  const blocks: KnowledgeBlock[] = [];
  const images: KnowledgeSectionImage[] = [];
  const seenImg = new Set<string>();

  if (!html) return { blocks, images };

  const imgTagRe = /<img\b([^>]*?)>/gi;
  let imgMatch: RegExpExecArray | null;
  while ((imgMatch = imgTagRe.exec(html)) !== null) {
    const attrs = imgMatch[1];
    const srcM = attrs.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
    if (!srcM) continue;
    let url = srcM[1].trim();
    if (!url.startsWith('/') && !url.startsWith('http') && !url.startsWith('data:')) {
      url = `/abp-packs/${colSlug}-${bookSlug}/${url.replace(/^\.?\//, '')}`;
    }
    const altM = attrs.match(/\balt\s*=\s*["']([^"']*)["']/i);
    const alt = decodeHtmlEntities(altM?.[1] || '插图');
    if (!seenImg.has(url)) {
      seenImg.add(url);
      images.push({ alt, url });
    }
  }

  const tokenRe =
    /<(h[1-6])\b([^>]*)>|<(div|details)\b([^>]*class="[^"]*(?:academic-[a-z0-9_-]+-card|solution-details|katex-display-container)[^"]*"[^>]*)>|<(p|li|blockquote|table|pre)\b([^>]*)>|<(img)\b([^>]*)>/gi;

  let cursor = 0;
  let blockIdx = 0;

  while (cursor < html.length) {
    tokenRe.lastIndex = cursor;
    const m = tokenRe.exec(html);
    if (!m) break;

    const matchStart = m.index;
    const matchTagEnd = tokenRe.lastIndex;

    if (m[1]) {

      const tag = m[1].toLowerCase();
      const attrs = m[2] || '';
      const endPos = findMatchingTagEnd(html, matchStart, matchTagEnd, tag);
      const inner = html.slice(matchTagEnd, endPos - `</${tag}>`.length);
      const idM = attrs.match(/\bid\s*=\s*["']([^"']+)["']/i);
      const id = idM?.[1] || `h-${++blockIdx}`;
      const text = htmlFragmentToAcademicText(inner);
      if (text) {
        blocks.push({
          id,
          kind: 'heading',
          title: text,
          text,
          uri: `${docUri}/${sectionId}#${id}`,
        });
      }
      cursor = endPos;
      continue;
    }

    if (m[3]) {

      const tag = m[3].toLowerCase();
      const attrs = m[4] || '';
      const endPos = findMatchingTagEnd(html, matchStart, matchTagEnd, tag);
      const fullSlice = html.slice(matchStart, endPos);

      if (/katex-display-container/i.test(attrs)) {
        const latexM = attrs.match(/\bdata-latex\s*=\s*["']([^"']*)["']/i);
        let latex = latexM?.[1] || '';
        try {
          latex = decodeURIComponent(latex);
        } catch {}
        latex = decodeHtmlEntities(latex).trim();
        const text = latex ? `$$\n${latex}\n$$` : htmlFragmentToAcademicText(fullSlice);
        const id = `math-${++blockIdx}`;
        if (text) {
          blocks.push({
            id,
            kind: 'math',
            text,
            latex: latex || undefined,
            uri: `${docUri}/${sectionId}#${id}`,
          });
        }
      } else {
        const idM = attrs.match(/\bid\s*=\s*["']([^"']+)["']/i);
        const titleM =
          attrs.match(/\bdata-card-title\s*=\s*["']([^"']*)["']/i) ||
          attrs.match(/\bdata-title\s*=\s*["']([^"']*)["']/i);
        const kindM = attrs.match(/academic-([a-z0-9_-]+)-card/i);
        const cardKind = /solution-details/i.test(attrs) ? 'solution' : kindM?.[1] || 'card';
        const id = idM?.[1] || `card-${++blockIdx}-${cardKind}`;
        const title = decodeHtmlEntities(titleM?.[1] || '') || (cardKind === 'solution' ? '解答' : undefined);
        const text = htmlFragmentToAcademicText(fullSlice);
        if (text) {
          blocks.push({
            id,
            kind: 'card',
            tag: cardKind,
            title,
            text,
            uri: `${docUri}/${sectionId}#${id}`,
          });
        }
      }
      cursor = endPos;
      continue;
    }

    if (m[5]) {
      const tag = m[5].toLowerCase();
      const attrs = m[6] || '';
      const endPos = findMatchingTagEnd(html, matchStart, matchTagEnd, tag);
      const fullSlice = html.slice(matchStart, endPos);
      const idM = attrs.match(/\bid\s*=\s*["']([^"']+)["']/i);
      const id = idM?.[1] || `${tag}-${++blockIdx}`;

      const innerImg = fullSlice.match(/<img\b([^>]*?)>/i);
      const text = htmlFragmentToAcademicText(fullSlice);
      if (innerImg && !text) {
        const srcM = innerImg[1].match(/\bsrc\s*=\s*["']([^"']+)["']/i);
        const altM = innerImg[1].match(/\balt\s*=\s*["']([^"']*)["']/i);
        if (srcM) {
          let url = srcM[1].trim();
          if (!url.startsWith('/') && !url.startsWith('http') && !url.startsWith('data:')) {
            url = `/abp-packs/${colSlug}-${bookSlug}/${url.replace(/^\.?\//, '')}`;
          }
          const alt = decodeHtmlEntities(altM?.[1] || '插图');
          blocks.push({
            id: `fig-${++blockIdx}`,
            kind: 'figure',
            title: alt,
            text: `[图: ${alt}] (${url})`,
            imageUrl: url,
            uri: `${docUri}/${sectionId}#fig-${blockIdx}`,
          });
        }
      } else if (text) {
        let kind: KnowledgeBlockKind = 'paragraph';
        if (tag === 'table') kind = 'table';
        else if (tag === 'pre') kind = 'code';
        else if (tag === 'blockquote') kind = 'quote';
        else if (tag === 'li') kind = 'list';

        blocks.push({
          id,
          kind,
          text,
          uri: `${docUri}/${sectionId}#${id}`,
        });
      }
      cursor = endPos;
      continue;
    }

    if (m[7]) {

      const attrs = m[8] || '';
      const srcM = attrs.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
      const altM = attrs.match(/\balt\s*=\s*["']([^"']*)["']/i);
      if (srcM) {
        let url = srcM[1].trim();
        if (!url.startsWith('/') && !url.startsWith('http') && !url.startsWith('data:')) {
          url = `/abp-packs/${colSlug}-${bookSlug}/${url.replace(/^\.?\//, '')}`;
        }
        const alt = decodeHtmlEntities(altM?.[1] || '插图');
        const id = `fig-${++blockIdx}`;
        blocks.push({
          id,
          kind: 'figure',
          title: alt,
          text: `[图: ${alt}] (${url})`,
          imageUrl: url,
          uri: `${docUri}/${sectionId}#${id}`,
        });
      }
      cursor = matchTagEnd;
      continue;
    }

    cursor = matchTagEnd;
  }

  if (blocks.length === 0) {
    const fallbackText = htmlFragmentToAcademicText(html);
    if (fallbackText) {
      blocks.push({
        id: 'p-1',
        kind: 'paragraph',
        text: fallbackText,
        uri: `${docUri}/${sectionId}#p-1`,
      });
    }
  }

  return { blocks, images };
}

export class AbpEpubAdapter implements IKnowledgeAdapter {
  public readonly adapterId = 'abp-epub';
  public readonly supportedFormats = ['abp', 'epub'] as const;

  private packsCache: AbpPackEntry[] | null = null;
  private indexCache = new Map<string, CachedAbpIndex>();

  public invalidateCache(): void {
    this.packsCache = null;
    this.indexCache.clear();
  }

  private scanPacks(): AbpPackEntry[] {
    if (this.packsCache) return this.packsCache;

    const dirs = resolveAbpPackCandidateDirs();
    const seen = new Set<string>();
    const entries: AbpPackEntry[] = [];

    for (const rootDir of dirs) {
      let dirItems: fs.Dirent[];
      try {
        dirItems = fs.readdirSync(rootDir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const ent of dirItems) {
        if (!ent.isDirectory() || ent.name.startsWith('.') || ent.name.includes('.__')) continue;
        const bookDir = path.join(rootDir, ent.name);
        const manifestPath = path.join(bookDir, 'manifest.json');
        if (!fs.existsSync(manifestPath)) continue;

        try {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as AstroBookManifest;
          const colSlug = manifest.colSlug || 'general';
          const slug = manifest.slug;
          if (!slug) continue;
          const key = `${colSlug}-${slug}`;
          if (seen.has(key)) continue;
          seen.add(key);

          const isEpub =
            manifest.sourceFormat === 'epub' ||
            manifest.readingProfile === 'literary' ||
            (Array.isArray(manifest.stylesheets) &&
              manifest.stylesheets.some((s) => s.includes('epub'))) ||
            (typeof manifest.originalArchive === 'string' &&
              manifest.originalArchive.toLowerCase().endsWith('.epub'));

          entries.push({
            key,
            abpRootDir: rootDir,
            bookDir,
            manifest,
            sourceFormat: isEpub ? 'epub' : 'abp',
          });
        } catch {}
      }
    }

    this.packsCache = entries;
    return entries;
  }

  private resolvePack(uriOrId: string): AbpPackEntry | null {
    const s = (uriOrId || '').trim();
    if (!s) return null;
    const packs = this.scanPacks();

    if (s.startsWith('book:')) {
      const key = s.slice('book:'.length);
      return packs.find((p) => p.key === key || p.manifest.slug === key) || null;
    }

    const parsed = parseAstrolibUri(s);
    if (parsed && parsed.entityKind !== 'paper') {
      return (
        packs.find(
          (p) => p.manifest.colSlug === parsed.colSlug && p.manifest.slug === parsed.bookSlug
        ) ||
        packs.find((p) => p.manifest.slug === parsed.bookSlug) ||
        null
      );
    }

    if (s.includes('/')) {
      const [col, slug] = s.split('/');
      const exact = packs.find((p) => p.manifest.colSlug === col && p.manifest.slug === slug);
      if (exact) return exact;
    }

    return (
      packs.find(
        (p) =>
          p.manifest.slug === s ||
          p.key === s ||
          p.manifest.title.toLowerCase() === s.toLowerCase()
      ) || null
    );
  }

  public listDocuments(): KnowledgeDocumentSummary[] {
    return this.scanPacks().map((p) => {
      const m = p.manifest;
      const chapters = this.flattenChapters(m);
      return {
        uri: `astrolib://${m.colSlug}/${m.slug}`,
        id: `book:${m.colSlug}-${m.slug}`,
        kind: 'book',
        sourceFormat: p.sourceFormat,
        colSlug: m.colSlug,
        slug: m.slug,
        title: m.title || m.slug,
        author: m.author,
        publisher: m.publisher,
        edition: m.edition,
        category: m.category || m.colSlug,
        subject: m.subject || m.colSlug,
        description: m.description,
        tags: m.tags,
        sectionCount: m.totalChapters || chapters.length,
        entrySectionId: m.entryPoint || chapters[0]?.slug,
        status: 'ready',
        updatedAt: m.updatedAt ? Date.parse(m.updatedAt) || undefined : undefined,
        sourceRoot: p.bookDir,
      };
    });
  }

  public supportsDocument(uriOrId: string): boolean {
    return this.resolvePack(uriOrId) !== null;
  }

  public getOutline(uriOrId: string): KnowledgeOutlineNode[] | null {
    const pack = this.resolvePack(uriOrId);
    if (!pack) return null;
    const m = pack.manifest;

    const sections = m.sections || [];
    if (sections.length === 1) {
      return (sections[0].chapters || []).map((ch) => ({
        id: ch.slug,
        title: ch.title || ch.slug,
        slug: ch.slug,
        depth: 1,
        kind: 'chapter',
        uri: `astrolib://${m.colSlug}/${m.slug}/${ch.slug}`,
      }));
    }

    return sections.map((sec) => {
      const children: KnowledgeOutlineNode[] = (sec.chapters || []).map((ch) => ({
        id: ch.slug,
        title: ch.title || ch.slug,
        slug: ch.slug,
        depth: 2,
        kind: 'chapter',
        uri: `astrolib://${m.colSlug}/${m.slug}/${ch.slug}`,
      }));
      return {
        id: sec.id || sec.slug,
        title: sec.title,
        slug: sec.slug,
        depth: 1,
        kind: 'section',
        uri: children[0]?.uri || `astrolib://${m.colSlug}/${m.slug}`,
        children,
      };
    });
  }

  public readSection(
    uriOrId: string,
    sectionId?: string,
    options: ReadSectionOptions = {}
  ): KnowledgeSectionContent | null {
    const pack = this.resolvePack(uriOrId);
    if (!pack) return null;
    const m = pack.manifest;
    const chapters = this.flattenChapters(m);
    if (chapters.length === 0) return null;

    const parsedUri = parseAstrolibUri(uriOrId);
    const cleanTarget = (sectionId || parsedUri?.chapterSlug || m.entryPoint || chapters[0].slug)
      .replace(/^collections\/[^/]+\/[^/]+\//, '')
      .replace(/\.(mdx|md)$/i, '');

    let idx = chapters.findIndex(
      (c) =>
        c.slug === cleanTarget ||
        c.slug.toLowerCase() === cleanTarget.toLowerCase() ||
        c.title.toLowerCase() === cleanTarget.toLowerCase()
    );
    if (idx < 0) {
      idx = chapters.findIndex(
        (c) =>
          c.slug.toLowerCase().includes(cleanTarget.toLowerCase()) ||
          c.title.toLowerCase().includes(cleanTarget.toLowerCase())
      );
    }

    const chapterSlug = idx >= 0 ? chapters[idx].slug : cleanTarget;
    const payload = this.readChapterJson(pack, chapterSlug);
    if (!payload) return null;

    const docUri = `astrolib://${m.colSlug}/${m.slug}`;
    const allBlocks: KnowledgeBlock[] = [];
    const allImages: KnowledgeSectionImage[] = [];

    if (payload.chapterIntro && payload.chapterIntro.html) {
      const introTitle = payload.chapterIntro.title || '章首导语';
      allBlocks.push({
        id: 'intro-heading',
        kind: 'heading',
        title: introTitle,
        text: introTitle,
        uri: `${docUri}/${chapterSlug}#intro-heading`,
      });
      const introParsed = extractBlocksFromCompiledHtml({
        html: payload.chapterIntro.html,
        docUri,
        sectionId: chapterSlug,
        colSlug: m.colSlug,
        bookSlug: m.slug,
      });
      allBlocks.push(
        ...introParsed.blocks.map((b, i) => ({
          ...b,
          id: `intro-${b.id || i}`,
        }))
      );
      allImages.push(...introParsed.images);
    }

    const mainParsed = extractBlocksFromCompiledHtml({
      html: payload.html || '',
      docUri,
      sectionId: chapterSlug,
      colSlug: m.colSlug,
      bookSlug: m.slug,
    });
    allBlocks.push(...mainParsed.blocks);
    for (const im of mainParsed.images) {
      if (!allImages.some((x) => x.url === im.url)) {
        allImages.push(im);
      }
    }

    if (payload.footnotes && Object.keys(payload.footnotes).length > 0) {
      for (const [fnId, fnEntry] of Object.entries(payload.footnotes)) {
        const text = fnEntry.text || htmlFragmentToAcademicText(fnEntry.html);
        if (text) {
          allBlocks.push({
            id: `fn-${fnId}`,
            kind: 'footnote',
            title: fnEntry.title || fnId,
            text: `[脚注 ${fnEntry.title || fnId}] ${text}`,
            uri: `${docUri}/${chapterSlug}#${fnId}`,
          });
        }
      }
    }

    const offset = Math.max(0, Number(options.offset) || 0);
    const limit = Math.max(1, Math.min(200, Number(options.limit) || 80));
    const sliced = allBlocks.slice(offset, offset + limit);

    return {
      uri: `${docUri}/${chapterSlug}`,
      docUri,
      docTitle: m.title,
      kind: 'book',
      sourceFormat: pack.sourceFormat,
      sectionId: chapterSlug,
      sectionTitle: payload.title || chapters[idx]?.title || chapterSlug,
      totalBlocks: allBlocks.length,
      offset,
      limit,
      hasMore: offset + sliced.length < allBlocks.length,
      blocks: sliced,
      plainText: sliced.map((b) => b.text).join('\n\n'),
      images: allImages,
      prevSectionId: idx > 0 ? chapters[idx - 1].slug : undefined,
      nextSectionId: idx >= 0 && idx + 1 < chapters.length ? chapters[idx + 1].slug : undefined,
    };
  }

  public search(query: string, options: SearchKnowledgeOptions = {}): KnowledgeSearchHit[] {
    if (options.kind && options.kind !== 'all' && options.kind !== 'book') return [];
    const q = (query || '').trim();
    if (!q) return [];

    const limit = Math.max(1, Math.min(50, options.limit || 20));
    const hits: KnowledgeSearchHit[] = [];
    const matcher = options.regex ? this.tryRegex(q) : null;
    const lowerQ = q.toLowerCase();

    for (const pack of this.scanPacks()) {
      if (hits.length >= limit) break;
      if (options.format && options.format !== 'all' && options.format !== pack.sourceFormat) continue;
      if (options.colSlug && pack.manifest.colSlug !== options.colSlug) continue;
      if (options.docSlug && pack.manifest.slug !== options.docSlug) continue;

      const m = pack.manifest;
      const docUri = `astrolib://${m.colSlug}/${m.slug}`;
      let perDocMatches = 0;

      const aiIndexPath = path.join(pack.bookDir, 'ai-index.json');
      if (fs.existsSync(aiIndexPath)) {
        try {
          const parsed = JSON.parse(fs.readFileSync(aiIndexPath, 'utf-8'));
          const chunks = Array.isArray(parsed?.chunks) ? parsed.chunks : [];
          for (const chunk of chunks) {
            const text = String(chunk.text || '');
            const title = String(chunk.title || '');
            const combined = `${title} ${text}`;
            const matched = matcher ? matcher.test(combined) : combined.toLowerCase().includes(lowerQ);
            if (!matched) continue;

            let secId = '';
            if (typeof chunk.url === 'string' && chunk.url.includes('/')) {
              const segs = chunk.url.replace(/\/+$/, '').split('/');
              secId = decodeURIComponent(segs[segs.length - 1] || '');
            } else if (typeof chunk.id === 'string') {
              secId = chunk.id.replace(/-(?:heading|chunk-\d+)$/, '');
            }
            if (!secId) continue;

            hits.push({
              uri: `${docUri}/${secId}`,
              docUri,
              docTitle: m.title,
              kind: 'book',
              sourceFormat: pack.sourceFormat,
              colSlug: m.colSlug,
              docSlug: m.slug,
              sectionId: secId,
              sectionTitle: title || secId,
              blockId: chunk.id,
              snippet: this.extractSnippet(text || title, q, matcher),
              score: 0.95,
              matchSource: 'ai-index',
            });
            perDocMatches++;
            if (perDocMatches >= 5 || hits.length >= limit) break;
          }
          continue;
        } catch {}
      }

      const idxData = this.getOrBuildLazyIndex(pack);
      for (const ch of idxData.chunks) {
        const hay = `${ch.sectionTitle} ${ch.text}`;
        const matched = matcher ? matcher.test(hay) : hay.toLowerCase().includes(lowerQ);
        if (!matched) continue;

        hits.push({
          uri: `${docUri}/${ch.sectionId}`,
          docUri,
          docTitle: m.title,
          kind: 'book',
          sourceFormat: pack.sourceFormat,
          colSlug: m.colSlug,
          docSlug: m.slug,
          sectionId: ch.sectionId,
          sectionTitle: ch.sectionTitle,
          blockId: ch.blockId,
          snippet: this.extractSnippet(ch.text, q, matcher),
          score: 0.9,
          matchSource: 'knowledge-index',
        });
        perDocMatches++;
        if (perDocMatches >= 5 || hits.length >= limit) break;
      }
    }

    return hits;
  }

  private getOrBuildLazyIndex(pack: AbpPackEntry): CachedAbpIndex {
    const cached = this.indexCache.get(pack.key);
    const updatedAt = pack.manifest.updatedAt || '';
    if (cached && cached.updatedAt === updatedAt) {
      return cached;
    }

    const cacheFile = path.join(pack.abpRootDir, '.cache', pack.key, 'knowledge-index.v1.json');
    if (fs.existsSync(cacheFile)) {
      try {
        const disk = JSON.parse(fs.readFileSync(cacheFile, 'utf-8')) as CachedAbpIndex;
        if (disk && disk.schemaVersion === 1 && disk.updatedAt === updatedAt) {
          this.indexCache.set(pack.key, disk);
          return disk;
        }
      } catch {}
    }

    const chunks: CachedAbpChunk[] = [];
    for (const ch of this.flattenChapters(pack.manifest)) {
      const payload = this.readChapterJson(pack, ch.slug);
      if (!payload) continue;
      const parsed = extractBlocksFromCompiledHtml({
        html: `${payload.chapterIntro?.html || ''}\n${payload.html || ''}`,
        docUri: `astrolib://${pack.manifest.colSlug}/${pack.manifest.slug}`,
        sectionId: ch.slug,
        colSlug: pack.manifest.colSlug,
        bookSlug: pack.manifest.slug,
      });
      for (const b of parsed.blocks) {
        if (!b.text) continue;
        chunks.push({
          sectionId: ch.slug,
          sectionTitle: payload.title || ch.title || ch.slug,
          blockId: b.id,
          text: b.text,
        });
      }
    }

    const built: CachedAbpIndex = { schemaVersion: 1, updatedAt, chunks };
    this.indexCache.set(pack.key, built);
    try {
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify(built), 'utf-8');
    } catch {}
    return built;
  }

  private readChapterJson(pack: AbpPackEntry, chapterSlug: string): AstroBookChapterPayload | null {
    const candidates = [
      path.join(pack.bookDir, 'chapters', `${chapterSlug}.json`),
      path.join(pack.bookDir, 'chapters', `${encodeURIComponent(chapterSlug)}.json`),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        try {
          return JSON.parse(fs.readFileSync(p, 'utf-8')) as AstroBookChapterPayload;
        } catch {}
      }
    }
    return null;
  }

  private flattenChapters(manifest: AstroBookManifest): Array<{ slug: string; title: string }> {
    const out: Array<{ slug: string; title: string }> = [];
    for (const sec of manifest.sections || []) {
      for (const ch of sec.chapters || []) {
        out.push({ slug: ch.slug, title: ch.title || ch.slug });
      }
    }
    return out;
  }

  private extractSnippet(text: string, query: string, matcher: RegExp | null): string {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (clean.length <= 220) return clean;
    let idx = -1;
    if (matcher) {
      const m = matcher.exec(clean);
      if (m) idx = m.index;
    } else {
      idx = clean.toLowerCase().indexOf(query.toLowerCase());
    }
    if (idx < 0) return clean.slice(0, 220) + '…';
    const start = Math.max(0, idx - 60);
    const end = Math.min(clean.length, idx + 160);
    return (start > 0 ? '…' : '') + clean.slice(start, end) + (end < clean.length ? '…' : '');
  }

  private tryRegex(pattern: string): RegExp | null {
    try {
      return new RegExp(pattern, 'i');
    } catch {
      return null;
    }
  }
}
