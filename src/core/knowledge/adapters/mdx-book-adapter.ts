/**
 * src/core/knowledge/adapters/mdx-book-adapter.ts
 * ============================================================================
 * MDX 源码教材适配器 (content-sources/collections/*)
 * ============================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import { sourceCollections } from '../../../config/collections.config.ts';
import { buildBookCatalog, type BookCatalog } from '../../catalog/book-catalog.mjs';
import {
  findProjectRoot,
  resolveBookSourceDir,
  resolveCollectionsRoot,
} from '../../catalog/content-paths.ts';
import { extractChapterAst, extractFrontmatter, flattenTree } from '../../content-api/ast-extractor.ts';
import type { AstDocumentNode } from '../../content-api/types.ts';
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
  ReadSectionOptions,
  SearchKnowledgeOptions,
} from '../types.ts';

function parseBookRef(uriOrId: string): { colSlug?: string; bookSlug: string } | null {
  const s = (uriOrId || '').trim();
  if (!s) return null;
  if (s.startsWith('book:')) {
    const rest = s.slice('book:'.length);
    const idx = rest.indexOf('-');
    if (idx > 0) {
      return { colSlug: rest.slice(0, idx), bookSlug: rest.slice(idx + 1) };
    }
    return { bookSlug: rest };
  }
  const parsed = parseAstrolibUri(s);
  if (parsed && parsed.entityKind !== 'paper') {
    return { colSlug: parsed.colSlug, bookSlug: parsed.bookSlug };
  }
  if (s.includes('/')) {
    const [colSlug, bookSlug] = s.split('/');
    if (colSlug && bookSlug) return { colSlug, bookSlug };
  }
  return { bookSlug: s };
}

function mapAstNodeKind(type: AstDocumentNode['type']): KnowledgeBlockKind {
  switch (type) {
    case 'heading':
      return 'heading';
    case 'card':
    case 'exercise':
      return 'card';
    case 'math_block':
      return 'math';
    case 'table':
      return 'table';
    case 'list':
      return 'list';
    case 'code_block':
      return 'code';
    case 'quote':
      return 'quote';
    default:
      return 'paragraph';
  }
}

export class MdxBookAdapter implements IKnowledgeAdapter {
  public readonly adapterId = 'mdx-book';
  public readonly supportedFormats = ['mdx'] as const;

  public listDocuments(): KnowledgeDocumentSummary[] {
    const docs: KnowledgeDocumentSummary[] = [];
    for (const col of sourceCollections) {
      for (const book of col.books) {
        const sourceDir = resolveBookSourceDir(col.slug, book.slug);
        if (!fs.existsSync(sourceDir)) continue;

        let sectionCount = 0;
        try {
          const catalog = buildBookCatalog(sourceDir, { languages: book.languages });
          sectionCount = this.flattenChapters(catalog).length;
        } catch {}

        docs.push({
          uri: `astrolib://${col.slug}/${book.slug}`,
          id: `book:${col.slug}-${book.slug}`,
          kind: 'book',
          sourceFormat: 'mdx',
          colSlug: col.slug,
          slug: book.slug,
          title: book.title,
          author: book.author,
          publisher: book.publisher,
          edition: book.edition,
          category: book.category || col.slug,
          subject: book.subject || col.slug,
          description: book.description,
          tags: book.tags,
          sectionCount,
          entrySectionId: book.entryPoint || undefined,
          status: 'ready',
          sourceRoot: sourceDir,
        });
      }
    }
    return docs;
  }

  public supportsDocument(uriOrId: string): boolean {
    return this.resolveBook(uriOrId) !== null;
  }

  public getOutline(uriOrId: string): KnowledgeOutlineNode[] | null {
    const resolved = this.resolveBook(uriOrId);
    if (!resolved) return null;

    const { colSlug, book, sourceDir } = resolved;
    const catalog = buildBookCatalog(sourceDir, { languages: book.languages });

    const convert = (nodes: BookCatalog, depth: number): KnowledgeOutlineNode[] => {
      const out: KnowledgeOutlineNode[] = [];
      for (const node of nodes) {
        if (node.type === 'chapter') {
          const cleanSlug = (node.slug || '')
            .replace(/^collections\/[^/]+\/[^/]+\//, '')
            .replace(/\.(mdx|md)$/i, '');
          out.push({
            id: cleanSlug,
            title: node.title || cleanSlug,
            slug: cleanSlug,
            depth,
            kind: 'chapter',
            uri: `astrolib://${colSlug}/${book.slug}/${cleanSlug}`,
          });
        } else if (node.type === 'group') {
          const children = convert(node.children || [], depth + 1);
          out.push({
            id: `group:${node.title}`,
            title: node.title,
            slug: children[0]?.slug || node.title,
            depth,
            kind: 'section',
            uri: children[0]?.uri || `astrolib://${colSlug}/${book.slug}`,
            children,
          });
        }
      }
      return out;
    };

    return convert(catalog, 1);
  }

  public readSection(
    uriOrId: string,
    sectionId?: string,
    options: ReadSectionOptions = {}
  ): KnowledgeSectionContent | null {
    const resolved = this.resolveBook(uriOrId);
    if (!resolved) return null;

    const { colSlug, book, sourceDir } = resolved;
    const catalog = buildBookCatalog(sourceDir, { languages: book.languages });
    const chapters = this.flattenChapters(catalog);
    if (chapters.length === 0) return null;

    const parsedUri = parseAstrolibUri(uriOrId);
    const targetSlug = (sectionId || parsedUri?.chapterSlug || book.entryPoint || chapters[0].slug)
      .replace(/^collections\/[^/]+\/[^/]+\//, '')
      .replace(/\.(mdx|md)$/i, '');

    let targetIdx = chapters.findIndex(
      (c) =>
        c.slug === targetSlug ||
        c.slug.toLowerCase() === targetSlug.toLowerCase() ||
        c.slug.toLowerCase().includes(targetSlug.toLowerCase())
    );
    if (targetIdx < 0) {
      const fileHit = this.findChapterFile(sourceDir, targetSlug);
      if (!fileHit) return null;
      const mdxContent = fs.readFileSync(fileHit, 'utf-8');
      return this.buildSectionFromMdx({
        colSlug,
        bookSlug: book.slug,
        bookTitle: book.title,
        chapterSlug: targetSlug,
        chapterTitle: targetSlug,
        filePath: fileHit,
        mdxContent,
        options,
      });
    }

    const chapter = chapters[targetIdx];
    const fileHit = this.findChapterFile(sourceDir, chapter.slug);
    if (!fileHit || !fs.existsSync(fileHit)) return null;

    const mdxContent = fs.readFileSync(fileHit, 'utf-8');
    return this.buildSectionFromMdx({
      colSlug,
      bookSlug: book.slug,
      bookTitle: book.title,
      chapterSlug: chapter.slug,
      chapterTitle: chapter.title || chapter.slug,
      filePath: fileHit,
      mdxContent,
      prevSectionId: targetIdx > 0 ? chapters[targetIdx - 1].slug : undefined,
      nextSectionId: targetIdx + 1 < chapters.length ? chapters[targetIdx + 1].slug : undefined,
      options,
    });
  }

  public search(query: string, options: SearchKnowledgeOptions = {}): KnowledgeSearchHit[] {
    if (options.kind && options.kind !== 'all' && options.kind !== 'book') return [];
    if (options.format && options.format !== 'all' && options.format !== 'mdx') return [];
    const q = (query || '').trim();
    if (!q) return [];

    const limit = Math.max(1, Math.min(50, options.limit || 20));
    const hits: KnowledgeSearchHit[] = [];
    const matcher = options.regex ? this.tryRegex(q) : null;
    const lowerQ = q.toLowerCase();

    for (const col of sourceCollections) {
      if (options.colSlug && col.slug !== options.colSlug) continue;
      for (const book of col.books) {
        if (options.docSlug && book.slug !== options.docSlug) continue;
        const bookDir = resolveBookSourceDir(col.slug, book.slug);
        if (!fs.existsSync(bookDir)) continue;

        const files = this.collectMdxFiles(bookDir);
        const collectionsRoot = resolveCollectionsRoot();

        for (const f of files) {
          if (hits.length >= limit) break;
          let txt = '';
          try {
            txt = fs.readFileSync(f, 'utf-8');
          } catch {
            continue;
          }

          const rel = path.relative(collectionsRoot, f).replace(/\\/g, '/');
          const parts = rel.split('/');
          const chapterSlug = parts.slice(2).join('/').replace(/\.(mdx|md)$/i, '');
          const { frontmatter } = extractFrontmatter(txt);
          const sectionTitle = frontmatter.title || chapterSlug;

          const lines = txt.split(/\r?\n/);
          let fileMatches = 0;
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const matched = matcher ? matcher.test(line) : line.toLowerCase().includes(lowerQ);
            if (!matched) continue;

            hits.push({
              uri: `astrolib://${col.slug}/${book.slug}/${chapterSlug}`,
              docUri: `astrolib://${col.slug}/${book.slug}`,
              docTitle: book.title,
              kind: 'book',
              sourceFormat: 'mdx',
              colSlug: col.slug,
              docSlug: book.slug,
              sectionId: chapterSlug,
              sectionTitle,
              snippet: line.trim().slice(0, 220),
              lineNumber: i + 1,
              score: 1.0,
              matchSource: 'markdown',
            });
            fileMatches++;
            if (fileMatches >= 4 || hits.length >= limit) break;
          }
        }
      }
    }

    return hits;
  }

  private buildSectionFromMdx(params: {
    colSlug: string;
    bookSlug: string;
    bookTitle: string;
    chapterSlug: string;
    chapterTitle: string;
    filePath: string;
    mdxContent: string;
    prevSectionId?: string;
    nextSectionId?: string;
    options: ReadSectionOptions;
  }): KnowledgeSectionContent {
    const {
      colSlug,
      bookSlug,
      bookTitle,
      chapterSlug,
      chapterTitle,
      filePath,
      mdxContent,
      prevSectionId,
      nextSectionId,
      options,
    } = params;

    const relPath = path.relative(findProjectRoot(), filePath).replace(/\\/g, '/');
    const ast = extractChapterAst({
      colSlug,
      bookSlug,
      chapterSlug,
      rawSlug: chapterSlug,
      filePath: relPath,
      mdxContent,
      includeRawMdx: true,
    });

    const lines = mdxContent.split(/\r?\n/);
    const flatNodes = flattenTree(ast.tree);
    const leafOrPrimary = flatNodes.filter(
      (n) => n.type !== 'heading' || !n.children || n.children.length === 0
    );

    const allBlocks: KnowledgeBlock[] = (leafOrPrimary.length > 0 ? flatNodes : []).map((node) => {
      const slice = lines.slice(Math.max(0, node.lineStart - 1), node.lineEnd).join('\n').trim();
      return {
        id: node.id,
        kind: mapAstNodeKind(node.type),
        title: node.title,
        tag: node.tag,
        text: slice || node.preview || node.summary,
        latex: node.latex,
        lineStart: node.lineStart,
        lineEnd: node.lineEnd,
        uri: `astrolib://${colSlug}/${bookSlug}/${chapterSlug}#${node.id}`,
      };
    });

    const images: KnowledgeSectionImage[] = [];
    const imgRe = /!\[([^\]]*)\]\(([^)\s]+)\)/g;
    let im: RegExpExecArray | null;
    while ((im = imgRe.exec(mdxContent)) !== null) {
      images.push({ alt: im[1] || 'image', url: im[2] });
    }

    const offset = Math.max(0, Number(options.offset) || 0);
    const limit = Math.max(1, Math.min(200, Number(options.limit) || 60));
    const sliced = allBlocks.slice(offset, offset + limit);
    const { body } = extractFrontmatter(mdxContent);

    return {
      uri: `astrolib://${colSlug}/${bookSlug}/${chapterSlug}`,
      docUri: `astrolib://${colSlug}/${bookSlug}`,
      docTitle: bookTitle,
      kind: 'book',
      sourceFormat: 'mdx',
      sectionId: chapterSlug,
      sectionTitle: ast.title || chapterTitle,
      totalBlocks: allBlocks.length,
      offset,
      limit,
      hasMore: offset + sliced.length < allBlocks.length,
      blocks: sliced,
      plainText: sliced.map((b) => b.text).join('\n\n'),
      ...(options.includeMarkdown ? { markdown: body.trim() } : {}),
      images,
      prevSectionId,
      nextSectionId,
    };
  }

  private resolveBook(uriOrId: string) {
    const ref = parseBookRef(uriOrId);
    if (!ref) return null;
    for (const col of sourceCollections) {
      if (ref.colSlug && col.slug !== ref.colSlug) continue;
      for (const book of col.books) {
        if (book.slug === ref.bookSlug || book.title === ref.bookSlug) {
          const sourceDir = resolveBookSourceDir(col.slug, book.slug);
          if (fs.existsSync(sourceDir)) {
            return { colSlug: col.slug, book, sourceDir };
          }
        }
      }
    }
    return null;
  }

  private flattenChapters(catalog: BookCatalog): Array<{ slug: string; title: string }> {
    const out: Array<{ slug: string; title: string }> = [];
    const walk = (nodes: BookCatalog) => {
      for (const node of nodes) {
        if (node.type === 'chapter') {
          const cleanSlug = (node.slug || '')
            .replace(/^collections\/[^/]+\/[^/]+\//, '')
            .replace(/\.(mdx|md)$/i, '');
          out.push({ slug: cleanSlug, title: node.title || cleanSlug });
        } else if (node.type === 'group' && Array.isArray(node.children)) {
          walk(node.children);
        }
      }
    };
    walk(catalog);
    return out;
  }

  private findChapterFile(dir: string, targetSlug: string): string | null {
    if (!fs.existsSync(dir)) return null;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const normTarget = targetSlug
      .replace(/^collections\/[^/]+\/[^/]+\//, '')
      .replace(/\.(mdx|md)$/i, '')
      .toLowerCase();

    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory() && ent.name !== 'images' && ent.name !== '.git') {
        const hit = this.findChapterFile(full, targetSlug);
        if (hit) return hit;
      } else if (ent.isFile() && /\.(mdx|md)$/i.test(ent.name)) {
        const base = ent.name.replace(/\.(mdx|md)$/i, '').toLowerCase();
        if (base === normTarget || base.replace(/[\s._-]/g, '') === normTarget.replace(/[\s._-]/g, '')) {
          return full;
        }
      }
    }
    return null;
  }

  private collectMdxFiles(dir: string, out: string[] = []): string[] {
    if (!fs.existsSync(dir)) return out;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === 'images' || ent.name.startsWith('.')) continue;
        this.collectMdxFiles(full, out);
      } else if (ent.isFile() && /\.(mdx|md)$/i.test(ent.name)) {
        out.push(full);
      }
    }
    return out;
  }

  private tryRegex(pattern: string): RegExp | null {
    try {
      return new RegExp(pattern, 'i');
    } catch {
      return null;
    }
  }
}
