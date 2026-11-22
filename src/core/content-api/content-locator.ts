import type { BookMeta } from '../../plugins/harness/types.ts';

export interface ContentLocator {

  uri: string;

  entityKind?: 'book' | 'paper';

  sourceFormat?: 'mdx' | 'abp' | 'epub' | 'paper';

  colSlug: string;

  bookSlug: string;

  bookTitle?: string;

  chapterSlug?: string;

  chapterTitle?: string;

  cardId?: string;

  filePath?: string;

  isBookLevel: boolean;

  confidence: 'exact' | 'high' | 'ambiguous' | 'none';

  candidates?: ContentLocator[];

  reason?: string;
}

export interface ChapterIndexItem {
  colSlug: string;
  bookSlug: string;
  bookTitle: string;
  chapterSlug: string;
  chapterTitle: string;
  filePath?: string;
}

export class UniversalLocatorResolver {
  private static globalChapterIndex: ChapterIndexItem[] | null = null;
  private static cachedBooks: BookMeta[] = [];

  public static toUri(locator: Partial<ContentLocator>): string {
    const col = locator.colSlug || 'math';
    const book = locator.bookSlug || 'math_analysis';
    let uri = `astrolib://${col}/${book}`;
    if (locator.chapterSlug) {
      uri += `/${locator.chapterSlug}`;
    }
    if (locator.cardId) {
      uri += `#${locator.cardId}`;
    }
    return uri;
  }

  public static parseUri(raw: string): Partial<ContentLocator> | null {
    if (!raw || typeof raw !== 'string') return null;
    const trimmed = raw.trim();

    const paperMatch = trimmed.match(/^paper:\/\/([^/#]+)(?:\/([^#]+))?(?:#(.*))?$/i);
    if (paperMatch) {
      const bookSlug = paperMatch[1];
      const chapterSlug = paperMatch[2] ? decodeURIComponent(paperMatch[2]) : undefined;
      const cardId = paperMatch[3] ? decodeURIComponent(paperMatch[3]) : undefined;
      return {
        uri: UniversalLocatorResolver.toUri({ colSlug: 'paper', bookSlug, chapterSlug, cardId }),
        entityKind: 'paper',
        sourceFormat: 'paper',
        colSlug: 'paper',
        bookSlug,
        chapterSlug,
        cardId,
        isBookLevel: !chapterSlug,
      };
    }

    const uriMatch = trimmed.match(/^astrolib:\/\/([^/]+)\/([^/#]+)(?:\/([^#]+))?(?:#(.*))?$/i);
    if (uriMatch) {
      const colSlug = uriMatch[1];
      const bookSlug = uriMatch[2];
      const chapterSlug = uriMatch[3] ? decodeURIComponent(uriMatch[3]) : undefined;
      const cardId = uriMatch[4] ? decodeURIComponent(uriMatch[4]) : undefined;
      const isPaper = colSlug.toLowerCase() === 'paper';
      return {
        uri: trimmed,
        entityKind: isPaper ? 'paper' : 'book',
        ...(isPaper ? { sourceFormat: 'paper' as const } : {}),
        colSlug,
        bookSlug,
        chapterSlug,
        cardId,
        isBookLevel: !chapterSlug,
      };
    }

    const pathMatch = trimmed.match(/^([a-z0-9_-]+)\/([a-z0-9_-]+)(?:\/([^#\s]+))?(?:#(.*))?$/i);
    if (pathMatch) {
      const colSlug = pathMatch[1];
      const bookSlug = pathMatch[2];
      const chapterSlug = pathMatch[3] ? decodeURIComponent(pathMatch[3]) : undefined;
      const cardId = pathMatch[4] ? decodeURIComponent(pathMatch[4]) : undefined;
      return {
        uri: UniversalLocatorResolver.toUri({ colSlug, bookSlug, chapterSlug, cardId }),
        colSlug,
        bookSlug,
        chapterSlug,
        cardId,
        isBookLevel: !chapterSlug,
      };
    }

    return null;
  }

  public static updateIndex(books: BookMeta[], chapters?: ChapterIndexItem[]): void {
    UniversalLocatorResolver.cachedBooks = books || [];
    if (chapters) {
      UniversalLocatorResolver.globalChapterIndex = chapters;
    }
  }

  public static resolve(
    input: string | Partial<ContentLocator>,
    books: BookMeta[] = UniversalLocatorResolver.cachedBooks,
    chapterIndex?: ChapterIndexItem[]
  ): ContentLocator {
    if (books && books.length > 0) {
      UniversalLocatorResolver.cachedBooks = books;
    }
    const currentBooks = UniversalLocatorResolver.cachedBooks;
    const chapters = chapterIndex || UniversalLocatorResolver.globalChapterIndex || [];

    if (typeof input === 'object' && input !== null) {
      if (input.bookSlug) {
        const foundBook = currentBooks.find((b) => b.slug === input.bookSlug) || {
          colSlug: input.colSlug || 'math',
          slug: input.bookSlug,
          title: input.bookTitle || input.bookSlug,
        };
        const col = input.colSlug || foundBook.colSlug || 'math';
        return {
          uri: UniversalLocatorResolver.toUri({
            colSlug: col,
            bookSlug: input.bookSlug,
            chapterSlug: input.chapterSlug,
            cardId: input.cardId,
          }),
          colSlug: col,
          bookSlug: input.bookSlug,
          bookTitle: foundBook.title,
          chapterSlug: input.chapterSlug,
          chapterTitle: input.chapterTitle,
          cardId: input.cardId,
          isBookLevel: !input.chapterSlug,
          confidence: 'exact',
        };
      }
    }

    const rawStr = (typeof input === 'string' ? input : '').trim();
    if (!rawStr) {
      return {
        uri: 'astrolib://math/math_analysis',
        colSlug: 'math',
        bookSlug: 'math_analysis',
        bookTitle: '数学分析',
        isBookLevel: true,
        confidence: 'none',
        reason: '定位输入为空',
      };
    }

    const parsedUri = UniversalLocatorResolver.parseUri(rawStr);
    if (parsedUri && parsedUri.bookSlug) {
      const b = currentBooks.find((item) => item.slug === parsedUri.bookSlug);
      return {
        uri: parsedUri.uri || UniversalLocatorResolver.toUri(parsedUri),
        entityKind: parsedUri.entityKind || (parsedUri.colSlug === 'paper' ? 'paper' : 'book'),
        sourceFormat: parsedUri.sourceFormat,
        colSlug: parsedUri.colSlug || b?.colSlug || 'math',
        bookSlug: parsedUri.bookSlug,
        bookTitle: b?.title || parsedUri.bookSlug,
        chapterSlug: parsedUri.chapterSlug,
        cardId: parsedUri.cardId,
        isBookLevel: !parsedUri.chapterSlug,
        confidence: 'exact',
      };
    }

    const exactBook = UniversalLocatorResolver.matchExactBook(rawStr, currentBooks);
    if (exactBook) {
      return {
        uri: UniversalLocatorResolver.toUri({
          colSlug: exactBook.colSlug,
          bookSlug: exactBook.slug,
        }),
        colSlug: exactBook.colSlug,
        bookSlug: exactBook.slug,
        bookTitle: exactBook.title,
        isBookLevel: true,
        confidence: 'exact',
      };
    }

    const splitMatch = rawStr.match(/^([^\s:]+)[\s:](.+)$/);
    if (splitMatch) {
      const bookPart = splitMatch[1].trim();
      const chapterPart = splitMatch[2].trim();

      const matchedBook = UniversalLocatorResolver.matchBook(bookPart, currentBooks);
      if (matchedBook.book) {
        return {
          uri: UniversalLocatorResolver.toUri({
            colSlug: matchedBook.book.colSlug,
            bookSlug: matchedBook.book.slug,
            chapterSlug: chapterPart,
          }),
          colSlug: matchedBook.book.colSlug,
          bookSlug: matchedBook.book.slug,
          bookTitle: matchedBook.book.title,
          chapterSlug: chapterPart,
          isBookLevel: false,
          confidence: matchedBook.confidence,
        };
      }
    }

    if (chapters.length > 0) {
      const matchedChapters = UniversalLocatorResolver.matchChapterAcrossBooks(rawStr, chapters);
      if (matchedChapters.length === 1) {
        const top = matchedChapters[0];
        return {
          uri: UniversalLocatorResolver.toUri({
            colSlug: top.colSlug,
            bookSlug: top.bookSlug,
            chapterSlug: top.chapterSlug,
          }),
          colSlug: top.colSlug,
          bookSlug: top.bookSlug,
          bookTitle: top.bookTitle,
          chapterSlug: top.chapterSlug,
          chapterTitle: top.chapterTitle,
          filePath: top.filePath,
          isBookLevel: false,
          confidence: 'exact',
        };
      } else if (matchedChapters.length > 1) {
        const top = matchedChapters[0];
        const candidates = matchedChapters.map((c) => ({
          uri: UniversalLocatorResolver.toUri(c),
          colSlug: c.colSlug,
          bookSlug: c.bookSlug,
          bookTitle: c.bookTitle,
          chapterSlug: c.chapterSlug,
          chapterTitle: c.chapterTitle,
          filePath: c.filePath,
          isBookLevel: false,
          confidence: 'ambiguous' as const,
        }));

        return {
          uri: UniversalLocatorResolver.toUri(top),
          colSlug: top.colSlug,
          bookSlug: top.bookSlug,
          bookTitle: top.bookTitle,
          chapterSlug: top.chapterSlug,
          chapterTitle: top.chapterTitle,
          isBookLevel: false,
          confidence: 'ambiguous',
          candidates,
          reason: `章节关键词 "${rawStr}" 在多本教材中出现，已为您优先匹配《${top.bookTitle}》。`,
        };
      }
    }

    const bookMatch = UniversalLocatorResolver.matchBook(rawStr, currentBooks);
    if (bookMatch.book) {
      return {
        uri: UniversalLocatorResolver.toUri({
          colSlug: bookMatch.book.colSlug,
          bookSlug: bookMatch.book.slug,
        }),
        colSlug: bookMatch.book.colSlug,
        bookSlug: bookMatch.book.slug,
        bookTitle: bookMatch.book.title,
        isBookLevel: true,
        confidence: bookMatch.confidence,
        reason: bookMatch.reason,
      };
    }

    return {
      uri: `astrolib://unknown/${encodeURIComponent(rawStr)}`,
      colSlug: 'unknown',
      bookSlug: rawStr,
      bookTitle: rawStr,
      isBookLevel: false,
      confidence: 'none',
      reason: `无法定位目标 "${rawStr}"，请检查书名或章节 slug。`,
    };
  }

  private static matchExactBook(query: string, books: BookMeta[]): BookMeta | null {
    const q = query.trim().toLowerCase();
    if (!q || !books || books.length === 0) return null;

    if (/^\d+$/.test(q)) {
      const idx = parseInt(q, 10) - 1;
      if (idx >= 0 && idx < books.length) {
        return books[idx];
      }
    }

    const exact = books.find(
      (b) =>
        b.slug.toLowerCase() === q ||
        b.title.toLowerCase() === q ||
        `${b.colSlug}/${b.slug}`.toLowerCase() === q
    );
    if (exact) return exact;

    const cleanQ = q.replace(/（[^）]+）|\([^)]+\)/g, '').trim().toLowerCase();
    if (cleanQ.length >= 2) {
      const cleanMatch = books.find((b) => {
        const cleanTitle = b.title.replace(/（[^）]+）|\([^)]+\)/g, '').trim().toLowerCase();
        return cleanTitle === cleanQ;
      });
      if (cleanMatch) return cleanMatch;
    }

    return null;
  }

  private static matchBook(
    query: string,
    books: BookMeta[]
  ): { book: BookMeta | null; confidence: 'exact' | 'high' | 'ambiguous' | 'none'; reason?: string } {
    const q = query.trim().toLowerCase();
    if (!q || !books || books.length === 0) return { book: null, confidence: 'none' };

    const exact = UniversalLocatorResolver.matchExactBook(query, books);
    if (exact) return { book: exact, confidence: 'exact' };

    const contains = books.filter((b) => b.title.toLowerCase().includes(q) || b.slug.toLowerCase().includes(q));
    if (contains.length === 1) {
      return { book: contains[0], confidence: 'high' };
    } else if (contains.length > 1) {
      return {
        book: contains[0],
        confidence: 'ambiguous',
        reason: `找到 ${contains.length} 本相关教材，默认选择《${contains[0].title}》`,
      };
    }

    return { book: null, confidence: 'none' };
  }

  private static matchChapterAcrossBooks(query: string, chapters: ChapterIndexItem[]): ChapterIndexItem[] {
    const q = query.trim().toLowerCase().replace(/[\._\-]/g, '');
    const rawQ = query.trim().toLowerCase();

    const exact = chapters.filter(
      (c) =>
        c.chapterSlug.toLowerCase() === rawQ ||
        c.chapterSlug.toLowerCase().replace(/[\._\-]/g, '') === q ||
        c.chapterTitle.toLowerCase() === rawQ
    );
    if (exact.length > 0) return exact;

    return chapters.filter((c) => {
      const cSlugNorm = c.chapterSlug.toLowerCase().replace(/[\._\-]/g, '');
      const cTitleNorm = c.chapterTitle.toLowerCase().replace(/[\._\-]/g, '');
      return (
        cSlugNorm.includes(q) ||
        cTitleNorm.includes(rawQ) ||
        c.chapterSlug.toLowerCase().includes(rawQ)
      );
    });
  }
}
