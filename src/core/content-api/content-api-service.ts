import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { sourceCollections } from '../../config/collections.config.ts';
import { buildBookCatalog, type BookCatalog } from '../catalog/book-catalog.mjs';
import {
  resolveBookSourceDir,
  resolveAbpArtifactsDir,
  resolveAbpPackCandidateDirs,
  findProjectRoot,
} from '../catalog/content-paths.ts';
import { KnowledgeRegistry } from '../knowledge/knowledge-registry.ts';
import { extractBlocksFromCompiledHtml } from '../knowledge/adapters/abp-epub-adapter.ts';
import type {
  KnowledgeDocumentSummary,
  KnowledgeEntityKind,
  KnowledgeOutlineNode,
  KnowledgeSearchHit,
  KnowledgeSectionContent,
  KnowledgeSourceFormat,
  ReadSectionOptions,
  SearchKnowledgeOptions,
} from '../knowledge/types.ts';
import { extractChapterAst, findNodeById, flattenTree } from './ast-extractor.ts';
import { getExercisesForChapter, searchExercises } from './exercise-bridge.ts';
import { listMineruTasks, getMineruTaskData, getMineruLayoutSlice } from './mineru-bridge.ts';
import { UniversalLocatorResolver, type ContentLocator, type ChapterIndexItem } from './content-locator.ts';
import { AnnotationStorageService } from '../annotations/annotation-storage.ts';
import { createSanitizedChildEnv } from '../security/child-env.ts';
import { sanitizeAcademicHtml } from '../security/html-sanitizer.ts';
import {
  aggregateBookAnnotationsOverview,
  buildFallbackAstTreeFromHtml,
  linkChapterAnnotationsWithAst,
  searchAnnotationsAcrossBooks,
} from '../annotations/annotation-ast-linker.ts';
import type {
  AnnotationSearchHit,
  AstroNotePackagePayload,
  BookAnnotationItem,
  BookAnnotationsOverview,
  ChapterAnnotationPayload,
  ChapterAnnotationsWithAstResult,
  ChapterCanvasNote,
} from '../../types/annotation-package.ts';
import type {
  BookSummary,
  ChapterAstData,
  ExerciseItem,
  MineruTaskData,
  IContentMutationService,
  ChapterNodeReadResult,
  AstDocumentNode,
} from './types.ts';

const execFileAsync = promisify(execFile);

function isPathInside(baseDir: string, targetPath: string): boolean {
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(targetPath);
  const rel = path.relative(resolvedBase, resolvedTarget);
  return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function assertSafeSlug(rawValue: string, label: string, allowSlash = false): string {
  const val = String(rawValue || '').trim();
  if (!val || val.includes('\0') || val.includes('..') || val.includes('\\') || val.includes(':')) {
    throw new Error(`非法的${label}路径标识: ${rawValue}`);
  }
  if (!allowSlash && val.includes('/')) {
    throw new Error(`非法的${label}单级标识: ${rawValue}`);
  }
  if (path.isAbsolute(val)) {
    throw new Error(`禁止使用绝对${label}路径: ${rawValue}`);
  }
  return val;
}

export class ContentApiService implements IContentMutationService {
  private static instance: ContentApiService | null = null;
  private cachedChapterIndex: ChapterIndexItem[] | null = null;
  private annotationStorage: AnnotationStorageService = AnnotationStorageService.getInstance();

  public setAnnotationStorage(storage: AnnotationStorageService): void {
    this.annotationStorage = storage;
  }

  public getAnnotationStorage(): AnnotationStorageService {
    return this.annotationStorage;
  }

  public static getInstance(): ContentApiService {
    if (!ContentApiService.instance) {
      ContentApiService.instance = new ContentApiService();

      ContentApiService.instance.buildGlobalChapterIndex();
    }
    return ContentApiService.instance;
  }

  public listBooks(): BookSummary[] {
    const list: BookSummary[] = [];
    const seenKeys = new Set<string>();
    const abpDir = resolveAbpArtifactsDir();

    for (const col of sourceCollections) {
      for (const book of col.books) {
        const sourceDir = resolveBookSourceDir(col.slug, book.slug);
        const abpPackFile = path.join(abpDir, `${col.slug}-${book.slug}.abp`);
        const hasAbpPack = fs.existsSync(abpPackFile);
        seenKeys.add(`${col.slug}-${book.slug}`);

        list.push({
          id: book.id,
          slug: book.slug,
          colSlug: col.slug,
          title: book.title,
          author: book.author,
          publisher: book.publisher,
          edition: book.edition,
          subject: book.subject,
          stage: book.stage,
          category: book.category,
          cover: book.cover,
          entryPoint: book.entryPoint || '',
          tags: book.tags,
          trackClasses: book.trackClasses,
          sourceDir: path.relative(findProjectRoot(), sourceDir).replace(/\\/g, '/'),
          hasAbpPack,
          sourceFormat: 'mdx',
        });
      }
    }

    const extraPackRoots = resolveAbpPackCandidateDirs();
    for (const rootDir of extraPackRoots) {
      if (!fs.existsSync(rootDir)) continue;
      try {
        for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
          if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name.includes('.__')) continue;
          const manifestPath = path.join(rootDir, entry.name, 'manifest.json');
          if (!fs.existsSync(manifestPath)) continue;
          try {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
            const colSlug = manifest.colSlug || 'general';
            const slug = manifest.slug;
            if (!slug) continue;
            const key = `${colSlug}-${slug}`;
            if (seenKeys.has(key)) continue;
            seenKeys.add(key);

            const isEpub =
              manifest.sourceFormat === 'epub' ||
              manifest.readingProfile === 'literary' ||
              (Array.isArray(manifest.stylesheets) &&
                manifest.stylesheets.some((s: string) => s.includes('epub')));

            list.push({
              id: manifest.id || key,
              slug,
              colSlug,
              title: manifest.title || slug,
              author: manifest.author,
              publisher: manifest.publisher,
              edition: manifest.edition,
              subject: manifest.subject || colSlug,
              stage: manifest.stage,
              category: manifest.category || colSlug,
              cover: manifest.cover,
              entryPoint: manifest.entryPoint || '',
              tags: manifest.tags,
              trackClasses: manifest.trackClasses,
              sourceDir: path.relative(findProjectRoot(), path.join(rootDir, entry.name)).replace(/\\/g, '/'),
              hasAbpPack: true,
              sourceFormat: isEpub ? 'epub' : 'abp',
            });
          } catch {}
        }
      } catch {}
    }

    return list;
  }

  public getBookToc(colSlug: string, bookSlug: string): {
    bookSlug: string;
    colSlug: string;
    title: string;
    catalog: BookCatalog;
  } {
    const safeCol = assertSafeSlug(colSlug, '合集');
    const safeBook = assertSafeSlug(bookSlug, '图书');
    const bookMeta = this.findBookMeta(safeCol, safeBook);
    const bookDir = resolveBookSourceDir(safeCol, safeBook);
    let catalog: BookCatalog = [];
    let resolvedTitle = bookMeta?.title || safeBook;

    if (fs.existsSync(bookDir)) {
      catalog = buildBookCatalog(bookDir, { languages: bookMeta?.languages });
    }

    if (!catalog || catalog.length === 0) {
      const abpCandidateRoots = resolveAbpPackCandidateDirs();
      for (const abpDir of abpCandidateRoots) {
        const manifestPath = path.resolve(abpDir, `${safeCol}-${safeBook}`, 'manifest.json');
        if (isPathInside(abpDir, manifestPath) && fs.existsSync(manifestPath)) {
          try {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
            if (manifest.title) resolvedTitle = manifest.title;
            const sections = manifest.sections || [];
            if (sections.length > 1) {
              const groups: any[] = sections.map((sec: any) => ({
                type: 'group',
                title: sec.title || sec.slug,
                children: (sec.chapters || []).map((ch: any) => ({
                  type: 'chapter',
                  title: ch.title,
                  slug: `collections/${colSlug}/${bookSlug}/${ch.slug}`,
                  filePath: ch.sourcePath || ch.path,
                })),
              }));
              if (groups.length > 0) {
                catalog = groups;
                break;
              }
            } else {
              const items: any[] = [];
              for (const sec of sections) {
                for (const ch of sec.chapters || []) {
                  items.push({
                    type: 'chapter',
                    title: ch.title,
                    slug: `collections/${colSlug}/${bookSlug}/${ch.slug}`,
                    filePath: ch.sourcePath || ch.path,
                  });
                }
              }
              if (items.length > 0) {
                catalog = items;
                break;
              }
            }
          } catch {}
        }
      }
    }

    return {
      bookSlug,
      colSlug,
      title: resolvedTitle,
      catalog,
    };
  }

  public getChapterAst(
    colSlug: string,
    bookSlug: string,
    chapterSlug: string,
    options: { includeRawMdx?: boolean } = {}
  ): ChapterAstData {
    const safeCol = assertSafeSlug(colSlug, '合集');
    const safeBook = assertSafeSlug(bookSlug, '图书');
    const safeChap = assertSafeSlug(chapterSlug, '章节', true);
    const bookDir = resolveBookSourceDir(safeCol, safeBook);
    const targetFile = fs.existsSync(bookDir) ? this.findChapterFile(bookDir, safeChap) : null;

    if (targetFile) {
      const mdxContent = fs.readFileSync(targetFile, 'utf-8');
      const relPath = path.relative(findProjectRoot(), targetFile).replace(/\\/g, '/');

      return extractChapterAst({
        colSlug: safeCol,
        bookSlug: safeBook,
        chapterSlug: safeChap,
        rawSlug: chapterSlug,
        filePath: relPath,
        mdxContent,
        includeRawMdx: options.includeRawMdx,
      });
    }

    const cleanSlug = assertSafeSlug(
      safeChap.replace(/^collections\/[^/]+\/[^/]+\//, '').replace(/\.(mdx|md)$/i, ''),
      '章节',
      true
    );

    const abpRoots = resolveAbpPackCandidateDirs();
    const jsonCandidates: string[] = [];
    for (const abpDir of abpRoots) {
      const cand1 = path.resolve(abpDir, `${safeCol}-${safeBook}`, 'chapters', `${cleanSlug}.json`);
      const cand2 = path.resolve(abpDir, `${safeCol}-${safeBook}`, 'chapters', `${encodeURIComponent(cleanSlug)}.json`);
      if (isPathInside(abpDir, cand1)) jsonCandidates.push(cand1);
      if (isPathInside(abpDir, cand2)) jsonCandidates.push(cand2);
    }

    for (const jsonCandidate of jsonCandidates) {
      if (fs.existsSync(jsonCandidate)) {
        try {
          const rawJson = JSON.parse(fs.readFileSync(jsonCandidate, 'utf-8'));
          const headings = (rawJson.headings || []).map((h: any) => ({
            depth: h.depth || 2,
            text: h.text || h.title || '',
            slug: h.slug || h.id || '',
          }));

          const html = rawJson.html || '';
          const cards: any[] = [];
          const cardRegex = /<div class="academic-([a-z0-9_-]+)-card"[^>]*data-card-title="([^"]*)"[^>]*>/gi;
          let cMatch: RegExpExecArray | null;
          let cardIdx = 1;
          while ((cMatch = cardRegex.exec(html)) !== null) {
            const type = cMatch[1];
            const title = cMatch[2] || `${type} ${cardIdx++}`;
            cards.push({
              id: `card-${cards.length + 1}`,
              tag: type.charAt(0).toUpperCase() + type.slice(1),
              type,
              title,
              lineStart: cardIdx * 10,
              lineEnd: cardIdx * 10 + 5,
              content: title,
            });
          }

          const formulas: any[] = [];
          const texRegex = /<span class="katex[^"]*"[^>]*data-raw-tex="([^"]*)"[^>]*>/gi;
          let fMatch: RegExpExecArray | null;
          while ((fMatch = texRegex.exec(html)) !== null) {
            formulas.push({
              id: `eq-${formulas.length + 1}`,
              latex: fMatch[1],
              rawTex: fMatch[1],
              displayMode: fMatch[0].includes('display') ? 'block' : 'inline',
              line: formulas.length + 1,
            });
          }

          const combinedHtml = `${rawJson.chapterIntro?.html ? `<h2>${rawJson.chapterIntro.title || '章首导语'}</h2>\n${rawJson.chapterIntro.html}\n` : ''}${html}`;
          let fallbackTree = buildFallbackAstTreeFromHtml(combinedHtml);
          const extracted = extractBlocksFromCompiledHtml({
            html: combinedHtml,
            docUri: `astrolib://${colSlug}/${bookSlug}`,
            sectionId: cleanSlug,
            colSlug,
            bookSlug,
          });

          if (fallbackTree.length === 0 && extracted.blocks.length > 0) {
            fallbackTree = extracted.blocks.map((b, bIdx) => ({
              id: b.id,
              type:
                b.kind === 'heading'
                  ? 'heading'
                  : b.kind === 'card'
                    ? 'card'
                    : b.kind === 'math'
                      ? 'math_block'
                      : b.kind === 'table'
                        ? 'table'
                        : b.kind === 'list'
                          ? 'list'
                          : b.kind === 'code'
                            ? 'code_block'
                            : 'paragraph',
              title: b.title,
              tag: b.tag,
              kind: b.tag,
              latex: b.latex,
              rawMdx: b.text,
              preview: b.text.slice(0, 140),
              summary: b.title ? `【${b.tag || b.kind}】${b.title}` : b.text.slice(0, 80),
              contentLength: b.text.length,
              lineStart: bIdx + 1,
              lineEnd: bIdx + 1,
            }));
          } else {

            for (const fn of fallbackTree) {
              const matchedBlock = extracted.blocks.find(
                (b) => b.id === fn.id || (fn.title && b.title === fn.title)
              );
              if (matchedBlock && matchedBlock.text) {
                fn.rawMdx = matchedBlock.text;
                fn.contentLength = matchedBlock.text.length;
              }
            }
          }

          return {
            colSlug,
            bookSlug,
            chapterSlug: cleanSlug,
            rawSlug: cleanSlug,
            filePath: `abp-packs/${colSlug}-${bookSlug}/chapters/${cleanSlug}.json`,
            title: rawJson.title || cleanSlug,
            wordCount: Math.round(combinedHtml.length / 2),
            readingTimeMinutes: Math.max(1, Math.round((combinedHtml.length / 2) / 300)),
            headings,
            cards,
            formulas,
            paragraphs: extracted.blocks
              .filter((b) => b.kind === 'paragraph')
              .map((b, pIdx) => ({
                index: pIdx + 1,
                text: b.text,
                lineStart: pIdx + 1,
                lineEnd: pIdx + 1,
              })),
            tree: fallbackTree,
          };
        } catch {}
      }
    }

    throw new Error(`在 ${colSlug}/${bookSlug} 中未找到章节: ${chapterSlug}`);
  }

  public readChapterNode(
    colSlug: string,
    bookSlug: string,
    chapterSlug: string,
    nodeId: string,
    options: { includeChildren?: boolean } = {}
  ): ChapterNodeReadResult {
    const bookDir = resolveBookSourceDir(colSlug, bookSlug);
    const targetFile = fs.existsSync(bookDir) ? this.findChapterFile(bookDir, chapterSlug) : null;

    if (!targetFile || !fs.existsSync(targetFile)) {

      try {
        const abpAst = this.getChapterAst(colSlug, bookSlug, chapterSlug);
        const allNodes = flattenTree(abpAst.tree);
        const fallbackNode =
          findNodeById(abpAst.tree, nodeId) ||
          allNodes.find((n) => n.id.toLowerCase() === nodeId.toLowerCase()) ||
          null;
        if (fallbackNode) {
          return {
            success: true,
            id: fallbackNode.id,
            type: fallbackNode.type,
            title: fallbackNode.title,
            tag: fallbackNode.tag,
            kind: fallbackNode.kind,
            lineStart: fallbackNode.lineStart,
            lineEnd: fallbackNode.lineEnd,
            chapterTitle: abpAst.title,
            chapterSlug,
            bookSlug,
            colSlug,
            uri: `astrolib://${colSlug}/${bookSlug}/${chapterSlug}#${fallbackNode.id}`,
            rawMdx:
              fallbackNode.rawMdx ||
              (fallbackNode.latex
                ? `$$\n${fallbackNode.latex}\n$$`
                : fallbackNode.preview || fallbackNode.summary),
            latex: fallbackNode.latex,
            summary: fallbackNode.summary,
            parentRefId: fallbackNode.parentRefId,
            childrenCount: fallbackNode.children?.length || 0,
          };
        }
      } catch {}
      throw new Error(`在 ${colSlug}/${bookSlug} 中未找到章节文件: ${chapterSlug}`);
    }

    const mdxContent = fs.readFileSync(targetFile, 'utf-8');
    const allLines = mdxContent.split(/\r?\n/);
    const relPath = path.relative(findProjectRoot(), targetFile).replace(/\\/g, '/');

    const ast = extractChapterAst({
      colSlug,
      bookSlug,
      chapterSlug,
      rawSlug: chapterSlug,
      filePath: relPath,
      mdxContent,
    });

    let targetNode = findNodeById(ast.tree, nodeId);
    if (!targetNode) {

      const allNodes = flattenTree(ast.tree);
      targetNode = allNodes.find((n) => n.id.toLowerCase() === nodeId.toLowerCase()) || null;
      if (!targetNode) {
        const lineNumMatch = nodeId.match(/(\d+)/);
        if (lineNumMatch) {
          const lNum = parseInt(lineNumMatch[1], 10);
          targetNode =
            allNodes.find((n) => n.lineStart === lNum || (lNum >= n.lineStart && lNum <= n.lineEnd)) || null;
        }
      }
    }

    if (!targetNode) {
      throw new Error(`在章节《${ast.title}》中未找到 ID 为 "${nodeId}" 的 AST 节点`);
    }

    return this.buildNodeReadResult(targetNode, allLines, ast, colSlug, bookSlug, chapterSlug, options);
  }

  private buildNodeReadResult(
    node: AstDocumentNode,
    allLines: string[],
    ast: ChapterAstData,
    colSlug: string,
    bookSlug: string,
    chapterSlug: string,
    options: { includeChildren?: boolean } = {}
  ): ChapterNodeReadResult {
    let startLine = node.lineStart;
    let endLine = node.lineEnd;

    if (options.includeChildren && node.children && node.children.length > 0) {
      const maxChildLine = Math.max(...node.children.map((c) => c.lineEnd));
      if (maxChildLine > endLine) endLine = maxChildLine;
    }

    const rawMdx = allLines.slice(startLine - 1, endLine).join('\n');
    const canonicalUri = `astrolib://${colSlug}/${bookSlug}/${chapterSlug}#${node.id}`;

    return {
      success: true,
      id: node.id,
      type: node.type,
      title: node.title,
      tag: node.tag,
      kind: node.kind,
      lineStart: startLine,
      lineEnd: endLine,
      chapterTitle: ast.title,
      chapterSlug,
      bookSlug,
      colSlug,
      uri: canonicalUri,
      rawMdx,
      latex: node.latex,
      summary: node.summary,
      parentRefId: node.parentRefId,
      childrenCount: node.children?.length || 0,
    };
  }

  public getChapterNodeHtml(
    colSlug: string,
    bookSlug: string,
    chapterSlug: string,
    nodeId: string
  ): { success: boolean; nodeId: string; html: string; title?: string } {
    const safeCol = assertSafeSlug(colSlug, '合集');
    const safeBook = assertSafeSlug(bookSlug, '图书');
    const safeChap = assertSafeSlug(chapterSlug, '章节', true);
    const cleanSlug = assertSafeSlug(
      safeChap.replace(/^collections\/[^/]+\/[^/]+\//, '').replace(/\.(mdx|md)$/i, ''),
      '章节',
      true
    );

    const abpRoots = resolveAbpPackCandidateDirs();

    let chapterHtml = '';
    for (const abpDir of abpRoots) {
      const candidates = [
        path.resolve(abpDir, `${safeCol}-${safeBook}`, 'chapters', `${cleanSlug}.json`),
        path.resolve(abpDir, `${safeCol}-${safeBook}`, 'chapters', `${encodeURIComponent(cleanSlug)}.json`),
      ].filter((cand) => isPathInside(abpDir, cand));
      for (const c of candidates) {
        if (fs.existsSync(c)) {
          try {
            const parsed = JSON.parse(fs.readFileSync(c, 'utf-8'));
            if (typeof parsed.html === 'string') {
              chapterHtml = parsed.html;
              break;
            }
          } catch {}
        }
      }
      if (chapterHtml) break;
    }

    if (chapterHtml) {

      const escapedId = nodeId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const directElRe = new RegExp(`<([a-z0-9]+)[^>]*\\sid=["']${escapedId}["'][^>]*>`, 'i');
      const directMatch = directElRe.exec(chapterHtml);
      if (directMatch && directMatch.index !== undefined) {
        const tag = directMatch[1].toLowerCase();
        const startIdx = directMatch.index;
        const openRe = new RegExp(`<${tag}(?:\\s|>)`, 'gi');
        const closeRe = new RegExp(`</${tag}>`, 'gi');
        let depth = 1;
        let scanPos = startIdx + directMatch[0].length;
        while (depth > 0 && scanPos < chapterHtml.length) {
          openRe.lastIndex = scanPos;
          closeRe.lastIndex = scanPos;
          const nextOpen = openRe.exec(chapterHtml);
          const nextClose = closeRe.exec(chapterHtml);
          if (!nextClose) break;
          if (nextOpen && nextOpen.index < nextClose.index) {
            depth++;
            scanPos = nextOpen.index + nextOpen[0].length;
          } else {
            depth--;
            scanPos = nextClose.index + nextClose[0].length;
            if (depth === 0) {
              return { success: true, nodeId, html: sanitizeAcademicHtml(chapterHtml.slice(startIdx, scanPos)) };
            }
          }
        }
      }

      try {
        const nodeInfo = this.readChapterNode(safeCol, safeBook, safeChap, nodeId);
        if (nodeInfo.type === 'card' && nodeInfo.title) {
          const escapedTitle = nodeInfo.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const cardRe = new RegExp(`<div[^>]*class="[^"]*academic-[^"]*"[^>]*data-title="[^"]*${escapedTitle}[^"]*"[^>]*>`, 'i');
          const cMatch = cardRe.exec(chapterHtml);
          if (cMatch && cMatch.index !== undefined) {
            const startIdx = cMatch.index;
            const openRe = /<div(?:\s|>)/gi;
            const closeRe = /<\/div>/gi;
            let depth = 1;
            let scanPos = startIdx + cMatch[0].length;
            while (depth > 0 && scanPos < chapterHtml.length) {
              openRe.lastIndex = scanPos;
              closeRe.lastIndex = scanPos;
              const nextOpen = openRe.exec(chapterHtml);
              const nextClose = closeRe.exec(chapterHtml);
              if (!nextClose) break;
              if (nextOpen && nextOpen.index < nextClose.index) {
                depth++;
                scanPos = nextOpen.index + nextOpen[0].length;
              } else {
                depth--;
                scanPos = nextClose.index + nextClose[0].length;
                if (depth === 0) {
                  return { success: true, nodeId, title: nodeInfo.title, html: sanitizeAcademicHtml(chapterHtml.slice(startIdx, scanPos)) };
                }
              }
            }
          }
        } else if (nodeInfo.type === 'math_block' && nodeInfo.latex) {
          const compactTarget = nodeInfo.latex.replace(/\s+/g, '').slice(0, 20);
          const mathRe = /<div\s+class="katex-display-container"[^>]*data-latex="([^"]*)"[^>]*>[\s\S]*?<\/div>\s*(?:<\/div>)?/gi;
          let m: RegExpExecArray | null;
          while ((m = mathRe.exec(chapterHtml)) !== null) {
            let decoded = '';
            try { decoded = decodeURIComponent(m[1]); } catch {}
            if (decoded.replace(/\s+/g, '').includes(compactTarget)) {
              return { success: true, nodeId, html: sanitizeAcademicHtml(m[0]) };
            }
          }
        } else if (nodeInfo.type === 'paragraph') {
          const plainSnippet = nodeInfo.rawMdx.replace(/\$[^$]*\$/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, '').slice(0, 14);
          if (plainSnippet) {
            const pRe = /<p(?:\s+[^>]*)?>[\s\S]*?<\/p>/gi;
            let pm: RegExpExecArray | null;
            while ((pm = pRe.exec(chapterHtml)) !== null) {
              const pClean = pm[0].replace(/<[^>]+>/g, '').replace(/\s+/g, '');
              if (pClean.includes(plainSnippet)) {
                return { success: true, nodeId, html: sanitizeAcademicHtml(pm[0]) };
              }
            }
          }
        }
      } catch {}
    }

    return { success: false, nodeId, html: '' };
  }

  public getChapterExercises(
    colSlug: string,
    bookSlug: string,
    chapterSlug: string
  ): ExerciseItem[] {
    return getExercisesForChapter(colSlug, bookSlug, chapterSlug);
  }

  public searchExercises(query: string, limit: number = 20): ExerciseItem[] {
    return searchExercises(query, limit);
  }

  public buildGlobalChapterIndex(): ChapterIndexItem[] {
    if (this.cachedChapterIndex && this.cachedChapterIndex.length > 0) {
      return this.cachedChapterIndex;
    }

    const items: ChapterIndexItem[] = [];
    const books = this.listBooks();

    const flattenCatalog = (
      nodeList: any[],
      colSlug: string,
      bookSlug: string,
      bookTitle: string
    ) => {
      for (const node of nodeList) {
        if (node.type === 'chapter') {
          const rawSlug = (node.slug || '')
            .replace(/^collections\/[^/]+\/[^/]+\//, '')
            .replace(/\.(mdx|md)$/i, '');
          items.push({
            colSlug,
            bookSlug,
            bookTitle,
            chapterSlug: rawSlug,
            chapterTitle: node.title || rawSlug,
            filePath: node.filePath,
          });
        } else if (node.type === 'group' && Array.isArray(node.children)) {
          flattenCatalog(node.children, colSlug, bookSlug, bookTitle);
        }
      }
    };

    for (const b of books) {
      try {
        const toc = this.getBookToc(b.colSlug, b.slug);
        flattenCatalog(toc.catalog, b.colSlug, b.slug, b.title);
      } catch {}
    }

    this.cachedChapterIndex = items;
    UniversalLocatorResolver.updateIndex(books, items);
    return items;
  }

  public locateContent(query: string | Partial<ContentLocator>): ContentLocator {
    const chapters = this.buildGlobalChapterIndex();
    return UniversalLocatorResolver.resolve(query, this.listBooks(), chapters);
  }

  public listMineruTasks(): MineruTaskData[] {
    return listMineruTasks();
  }

  public getMineruTask(hashOrPath: string): MineruTaskData | null {
    return getMineruTaskData(hashOrPath);
  }

  public getMineruLayout(hashOrPath: string, limit: number = 50) {
    return getMineruLayoutSlice(hashOrPath, limit);
  }

  public invalidateKnowledgeCache(): void {
    this.cachedChapterIndex = null;
    KnowledgeRegistry.getInstance().invalidateCache();
  }

  public listKnowledgeItems(filter?: {
    kind?: 'all' | KnowledgeEntityKind;
    format?: 'all' | KnowledgeSourceFormat;
    colSlug?: string;
    query?: string;
  }): KnowledgeDocumentSummary[] {
    return KnowledgeRegistry.getInstance().listAllDocuments(filter);
  }

  public getKnowledgeOutline(uriOrId: string): {
    document: KnowledgeDocumentSummary;
    outline: KnowledgeOutlineNode[];
  } | null {
    return KnowledgeRegistry.getInstance().getDocumentOutline(uriOrId);
  }

  public readKnowledgeSection(
    uriOrId: string,
    sectionId?: string,
    options: ReadSectionOptions = {}
  ): KnowledgeSectionContent | null {
    return KnowledgeRegistry.getInstance().readDocumentSection(uriOrId, sectionId, options);
  }

  public searchKnowledge(
    query: string,
    options: SearchKnowledgeOptions = {}
  ): KnowledgeSearchHit[] {
    return KnowledgeRegistry.getInstance().searchAll(query, options);
  }

  public getBookAnnotationsOverview(colSlug: string, bookSlug: string): BookAnnotationsOverview {
    const meta = this.findBookMeta(colSlug, bookSlug);
    return aggregateBookAnnotationsOverview({
      storage: this.annotationStorage,
      colSlug,
      bookSlug,
      bookTitle: meta?.title || bookSlug,
    });
  }

  public getChapterAnnotationsWithAst(
    colSlug: string,
    bookSlug: string,
    chapterSlug: string
  ): ChapterAnnotationsWithAstResult {
    let chapterTitle = chapterSlug;
    let astTree: AstDocumentNode[] = [];
    let resolvedChapterSlug = chapterSlug;

    try {
      const ast = this.getChapterAst(colSlug, bookSlug, chapterSlug);
      chapterTitle = ast.title || chapterSlug;
      astTree = ast.tree || [];
      resolvedChapterSlug = ast.chapterSlug || chapterSlug;
    } catch {

    }

    const payload = this.annotationStorage.getChapterAnnotations(
      colSlug,
      bookSlug,
      resolvedChapterSlug,
      chapterTitle
    );

    return linkChapterAnnotationsWithAst({
      colSlug,
      bookSlug,
      chapterSlug: resolvedChapterSlug,
      chapterTitle,
      payload,
      astTree,
    });
  }

  public searchAnnotations(
    query: string,
    options: { colSlug?: string; bookSlug?: string; limit?: number } = {}
  ): AnnotationSearchHit[] {
    let targetBooks = this.listBooks().map((b) => ({ colSlug: b.colSlug, slug: b.slug }));
    if (options.colSlug && options.bookSlug) {
      targetBooks = [{ colSlug: options.colSlug, slug: options.bookSlug }];
    } else if (options.colSlug) {
      targetBooks = targetBooks.filter((b) => b.colSlug === options.colSlug);
    } else if (options.bookSlug) {
      targetBooks = targetBooks.filter((b) => b.slug === options.bookSlug);
    }

    return searchAnnotationsAcrossBooks({
      storage: this.annotationStorage,
      books: targetBooks,
      query,
      limit: options.limit,
    });
  }

  public getChapterAnnotationsRaw(
    colSlug: string,
    bookSlug: string,
    chapterSlug: string
  ): ChapterAnnotationPayload {
    return this.annotationStorage.getChapterAnnotations(colSlug, bookSlug, chapterSlug);
  }

  public upsertChapterAnnotation(
    colSlug: string,
    bookSlug: string,
    chapterSlug: string,
    item: BookAnnotationItem,
    chapterTitle?: string
  ): ChapterAnnotationPayload {
    return this.annotationStorage.upsertAnnotationItem(colSlug, bookSlug, chapterSlug, item, chapterTitle);
  }

  public deleteChapterAnnotation(
    colSlug: string,
    bookSlug: string,
    chapterSlug: string,
    annotationId: string
  ): ChapterAnnotationPayload {
    return this.annotationStorage.deleteAnnotationItem(colSlug, bookSlug, chapterSlug, annotationId);
  }

  public saveChapterCanvasNote(
    colSlug: string,
    bookSlug: string,
    chapterSlug: string,
    canvasNote: ChapterCanvasNote,
    chapterTitle?: string
  ): ChapterAnnotationPayload {
    return this.annotationStorage.saveCanvasNote(colSlug, bookSlug, chapterSlug, canvasNote, chapterTitle);
  }

  public saveChapterCanvasNoteAsync(
    colSlug: string,
    bookSlug: string,
    chapterSlug: string,
    canvasNote: ChapterCanvasNote,
    chapterTitle?: string
  ): Promise<ChapterAnnotationPayload> {
    return this.annotationStorage.saveCanvasNoteAsync(colSlug, bookSlug, chapterSlug, canvasNote, chapterTitle);
  }

  public saveChapterAnnotationsPayload(
    colSlug: string,
    bookSlug: string,
    chapterSlug: string,
    updates: Partial<ChapterAnnotationPayload>
  ): ChapterAnnotationPayload {
    return this.annotationStorage.saveChapterAnnotations(colSlug, bookSlug, chapterSlug, updates);
  }

  public exportBookAnp(
    colSlug: string,
    bookSlug: string,
    chapterSlug?: string
  ): AstroNotePackagePayload {
    const meta = this.findBookMeta(colSlug, bookSlug);
    return this.annotationStorage.exportBookAnp(colSlug, bookSlug, meta?.title || bookSlug, chapterSlug);
  }

  public importBookAnp(rawPkg: unknown, mode: 'merge' | 'overwrite' = 'merge') {
    return this.annotationStorage.importBookAnp(rawPkg, mode);
  }

  public async saveChapterMdx(
    colSlug: string,
    bookSlug: string,
    chapterSlug: string,
    content: string
  ): Promise<{ success: boolean; bytesWritten: number }> {
    const safeCol = assertSafeSlug(colSlug, '合集');
    const safeBook = assertSafeSlug(bookSlug, '图书');
    const safeChap = assertSafeSlug(chapterSlug, '章节', true);
    const bookDir = resolveBookSourceDir(safeCol, safeBook);
    const targetFile = this.findChapterFile(bookDir, safeChap);
    const writePath = path.resolve(targetFile || path.join(bookDir, `${safeChap}.mdx`));
    if (!isPathInside(bookDir, writePath)) {
      throw new Error(`非法章节写入路径逃逸: ${chapterSlug}`);
    }

    fs.mkdirSync(path.dirname(writePath), { recursive: true });
    fs.writeFileSync(writePath, content, 'utf-8');
    this.cachedChapterIndex = null;
    return { success: true, bytesWritten: Buffer.byteLength(content, 'utf-8') };
  }

  public async packBookAbp(
    colSlug: string,
    bookSlug: string
  ): Promise<{ success: boolean; outputPath: string; manifestPath: string }> {
    const safeCol = assertSafeSlug(colSlug, '合集');
    const safeBook = assertSafeSlug(bookSlug, '图书');
    const packScript = path.resolve(findProjectRoot(), 'scripts/pack-book-abp.mjs');
    await execFileAsync(
      process.execPath,
      [packScript, '--col', safeCol, '--book', safeBook],
      { cwd: findProjectRoot(), env: createSanitizedChildEnv({ ELECTRON_RUN_AS_NODE: '1' }) }
    );

    const abpDir = resolveAbpArtifactsDir();
    const packFile = path.join(abpDir, `${safeCol}-${safeBook}.abp`);
    const manifestFile = path.join(abpDir, `${safeCol}-${safeBook}`, 'manifest.json');

    return {
      success: true,
      outputPath: packFile,
      manifestPath: manifestFile,
    };
  }

  public async importBookFromMineru(params: {
    colSlug: string;
    bookSlug: string;
    title: string;
    mineruDir: string;
  }): Promise<{ success: boolean; bookPath: string }> {
    const safeCol = assertSafeSlug(params.colSlug, '合集');
    const safeBook = assertSafeSlug(params.bookSlug, '图书');
    const targetDir = resolveBookSourceDir(safeCol, safeBook);
    fs.mkdirSync(targetDir, { recursive: true });

    const resolvedMineruDir = path.resolve(params.mineruDir);
    const fullMd = path.join(resolvedMineruDir, 'full.md');
    if (fs.existsSync(fullMd)) {
      const destFile = path.join(targetDir, '01_full_import.mdx');
      const content = `---\ntitle: '${params.title}'\n---\n\n` + fs.readFileSync(fullMd, 'utf-8');
      fs.writeFileSync(destFile, content, 'utf-8');
    }

    const imagesSrc = path.join(resolvedMineruDir, 'images');
    const imagesDest = path.join(targetDir, 'images');
    if (fs.existsSync(imagesSrc)) {
      fs.cpSync(imagesSrc, imagesDest, { recursive: true });
    }

    this.cachedChapterIndex = null;
    return { success: true, bookPath: targetDir };
  }

  private findBookMeta(colSlug: string, bookSlug: string) {
    const col = sourceCollections.find((c) => c.slug === colSlug);
    return col?.books.find((b) => b.slug === bookSlug);
  }

  private findChapterFile(dir: string, targetSlug: string): string | null {
    if (!fs.existsSync(dir)) return null;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const normalizedTarget = targetSlug
      .replace(/^collections\/[^/]+\/[^/]+\//, '')
      .replace(/\.(mdx|md)$/i, '')
      .toLowerCase();

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== 'images' && entry.name !== '.git') {
        const found = this.findChapterFile(fullPath, targetSlug);
        if (found) return found;
      } else if (entry.isFile() && (entry.name.endsWith('.mdx') || entry.name.endsWith('.md'))) {
        const baseName = entry.name.replace(/\.(mdx|md)$/i, '');
        const baseNameClean = baseName.replace(/[\s\._\-]/g, '').toLowerCase();
        const targetClean = normalizedTarget.replace(/[\s\._\-]/g, '');

        if (
          baseName.toLowerCase() === normalizedTarget ||
          baseNameClean === targetClean ||
          baseNameClean.includes(targetClean) ||
          targetClean.includes(baseNameClean) ||
          baseName.toLowerCase().includes(normalizedTarget) ||
          normalizedTarget.includes(baseName.toLowerCase())
        ) {
          return fullPath;
        }
      }
    }

    return null;
  }
}
