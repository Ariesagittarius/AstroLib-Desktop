/**
 * src/core/content-api/content-locator.ts
 * ============================================================================
 * AstroLib 统一内容定位协议规范与解析引擎 (Unified Content Locator Protocol)
 * ============================================================================
 * 规范：
 * 1. 唯一指向源协议 (Single Source of Truth Protocol - Canonical URI):
 *    - 书籍级: astrolib://<colSlug>/<bookSlug>
 *    - 章节级: astrolib://<colSlug>/<bookSlug>/<chapterSlug>
 *    - 卡片级: astrolib://<colSlug>/<bookSlug>/<chapterSlug>#<cardIdOrAnchor>
 * 2. 规范数据结构 (Standard Locator Object):
 *    让 Agent 与前端拥有统一、严密、自描述的寻址表达能力；
 * 3. 跨书全局拓扑消歧 (Cross-Book Global Disambiguation):
 *    用户/Agent 输入单章节 slug（如 "06_第1章-三角函数"）或模糊中文名时，
 *    通过全局章节索引自动反向定位所属合集与书籍，严禁盲目绑定默认图书；
 * 4. 纯函数式与热插拔：无静态写死字典，随图书库动态热重载。
 * ============================================================================
 */

import type { BookMeta } from '../../plugins/harness/types.ts';

export interface ContentLocator {
  /** 规范唯一协议 URI，如 "astrolib://math/math_senior/06_第1章-三角函数" 或 "astrolib://paper/task_xxx" */
  uri: string;
  /** 实体类别：book (教材/EPUB/ABP) 或 paper (学术文献) */
  entityKind?: 'book' | 'paper';
  /** 内容来源格式 */
  sourceFormat?: 'mdx' | 'abp' | 'epub' | 'paper';
  /** 学科合集 slug，如 "math", "science", "telecom", "cs", "paper" */
  colSlug: string;
  /** 书籍唯一标识 slug，或文献 taskId */
  bookSlug: string;
  /** 书籍或文献展示标题 */
  bookTitle?: string;
  /** 章节 slug 或文献节 ID */
  chapterSlug?: string;
  /** 章节或节标题 */
  chapterTitle?: string;
  /** 章节内学术卡片或锚点 ID，如 "thm-1" */
  cardId?: string;
  /** 相对内容源文件物理路径 */
  filePath?: string;
  /** 是否仅为书籍/文献级定位 */
  isBookLevel: boolean;
  /** 置信度等级 */
  confidence: 'exact' | 'high' | 'ambiguous' | 'none';
  /** 存在歧义或模糊时的候选列表 */
  candidates?: ContentLocator[];
  /** 解析说明或建议提示 */
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

  /**
   * 将定位器对象序列化为标准协议 URI
   */
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

  /**
   * 解析标准协议 URI (如 "astrolib://math/math_analysis/21_数列极限的基本概念#thm-1")
   */
  public static parseUri(raw: string): Partial<ContentLocator> | null {
    if (!raw || typeof raw !== 'string') return null;
    const trimmed = raw.trim();

    // 匹配 paper://<taskId>[/<sectionId>][#<blockId>]
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

    // 匹配 astrolib://<col>/<book>[/<chapter>][#<card>]
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

    // 匹配裸路径格式 col/book/chapter 或 col/book
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

  /**
   * 注册或更新全局图书与章节索引缓存 (支持热插拔)
   */
  public static updateIndex(books: BookMeta[], chapters?: ChapterIndexItem[]): void {
    UniversalLocatorResolver.cachedBooks = books || [];
    if (chapters) {
      UniversalLocatorResolver.globalChapterIndex = chapters;
    }
  }

  /**
   * 智能统一求解定位器 (Universal Resolve)
   * 支持多形态输入：
   * 1. 规范 URI: astrolib://math/math_analysis/21_xxx
   * 2. 路径: math/math_senior/06_第1章-三角函数
   * 3. 复合格式: math_analysis:21_xxx 或 "数学分析 2.1"
   * 4. 裸章节名 (全局跨书反向搜): "06_第1章-三角函数" -> 自动精准定位到 math/math_senior
   * 5. 纯书名/序号: "数学分析" 或 "2" -> 书籍级定位
   */
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

    // 1. 若入参为对象，且已提供明确的 colSlug 和 bookSlug
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

    // 2. 检查是否为标准 URI 或 col/book[/chapter] 格式
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

    // 3. 优先检查是否为精确书籍匹配 (Exact Book Match - slug / title / index / cleanTitle)
    // 确保纯书名输入 (如 "数学分析" 或 "2") 绝不会被其他包含 "数学分析" 字样的章节篡夺
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

    // 4. 检查复合输入: <bookQuery> <chapterQuery> 或 <bookQuery>:<chapterQuery>
    // 例如 "math_analysis 21_数列极限的基本概念" 或 "数学分析:2.1"
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

    // 5. 全局跨书反向匹配章节 (Cross-Book Chapter Matching):
    // 当输入形如 "06_第1章-三角函数"、"11_二三阶行列式"、"数列极限"
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

    // 6. 启发式书籍匹配 (模糊包含)
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

    // 7. 兜底未识别 (返回消歧候选)
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

  /**
   * 精确匹配图书 (优先于章节模糊搜索)
   */
  private static matchExactBook(query: string, books: BookMeta[]): BookMeta | null {
    const q = query.trim().toLowerCase();
    if (!q || !books || books.length === 0) return null;

    // 1-based 序号
    if (/^\d+$/.test(q)) {
      const idx = parseInt(q, 10) - 1;
      if (idx >= 0 && idx < books.length) {
        return books[idx];
      }
    }

    // 精确 slug 或 title 或 col/slug
    const exact = books.find(
      (b) =>
        b.slug.toLowerCase() === q ||
        b.title.toLowerCase() === q ||
        `${b.colSlug}/${b.slug}`.toLowerCase() === q
    );
    if (exact) return exact;

    // 去除版本括号后精确匹配 (例如 "工科数学分析基础" 匹配 "工科数学分析基础（第三版）")
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

  /**
   * 启发式匹配图书
   */
  private static matchBook(
    query: string,
    books: BookMeta[]
  ): { book: BookMeta | null; confidence: 'exact' | 'high' | 'ambiguous' | 'none'; reason?: string } {
    const q = query.trim().toLowerCase();
    if (!q || !books || books.length === 0) return { book: null, confidence: 'none' };

    const exact = UniversalLocatorResolver.matchExactBook(query, books);
    if (exact) return { book: exact, confidence: 'exact' };

    // title 包含
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

  /**
   * 全局跨书反向章节模糊/精确匹配
   */
  private static matchChapterAcrossBooks(query: string, chapters: ChapterIndexItem[]): ChapterIndexItem[] {
    const q = query.trim().toLowerCase().replace(/[\._\-]/g, '');
    const rawQ = query.trim().toLowerCase();

    // 1. 完全精确匹配 slug 或 filePath 或 title
    const exact = chapters.filter(
      (c) =>
        c.chapterSlug.toLowerCase() === rawQ ||
        c.chapterSlug.toLowerCase().replace(/[\._\-]/g, '') === q ||
        c.chapterTitle.toLowerCase() === rawQ
    );
    if (exact.length > 0) return exact;

    // 2. 章节 slug 或 title 包含 query
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
