/**
 * src/services/content-provider/reader-entry.ts
 * ============================================================================
 * Universal Reader 运行时入口纯函数模块 (Runtime Entry Pure Utilities)
 * ============================================================================
 * 架构规范：
 * - 纯函数模块，禁止引用 node:* / astro:*，确保浏览器/Electron客户端安全打包
 * - 遵循 Rule 1 (UI is not a domain model) & Rule 7 (Utils purity)
 * - 遵循 P1-A3 门禁规格与 ADR-READER-CONTRACT-2026-11-13
 * ============================================================================
 */

import type { ChapterHeadingItem } from '../../types/content-package.ts';

export type EmptyStateReason =
  | 'missing-book'
  | 'missing-chapter'
  | 'not-installed'
  | 'chapter-missing';

export interface ReaderQueryParams {
  bookId: string | null;
  chapterSlug: string | null;
  error: EmptyStateReason | 'invalid-book-id' | null;
}

export interface SplitBookIdResult {
  colSlug: string;
  bookSlug: string;
}

export interface EmptyStateAction {
  label: string;
  href: string;
}

export interface EmptyStateViewModel {
  title: string;
  description: string;
  action: EmptyStateAction;
}

export interface ReaderOutlineItem {
  href: string;
  text: string;
  depth: 2 | 3;
}

/**
 * 将章节 payload 的 headings 映射为右侧大纲条目。
 * 仅保留 h2/h3 且具备有效锚点 id 的标题：payload 的 ChapterHeadingItem 字段为
 * `{ depth, text, id }`，锚点必须取自 `id`（历史实现误用不存在的 `slug` 字段，
 * 导致所有大纲链接退化为 `#undefined`）。
 */
export function buildOutlineItems(
  headings: readonly ChapterHeadingItem[] | null | undefined
): ReaderOutlineItem[] {
  if (!Array.isArray(headings)) return [];

  const items: ReaderOutlineItem[] = [];
  for (const heading of headings) {
    if (!heading || (heading.depth !== 2 && heading.depth !== 3)) continue;
    const id = typeof heading.id === 'string' ? heading.id.trim() : '';
    if (!id) continue;
    items.push({
      href: `#${id}`,
      text: typeof heading.text === 'string' ? heading.text : '',
      depth: heading.depth,
    });
  }
  return items;
}

/**
 * 解析 Reader URL 查询字符串
 * @param search location.search 字符串（可带或不带前置 '?'）
 */
export function parseReaderQuery(search: string): ReaderQueryParams {
  if (!search || search.trim() === '') {
    return { bookId: null, chapterSlug: null, error: 'missing-book' };
  }

  const normalized = search.startsWith('?') ? search.slice(1) : search;
  const params = new URLSearchParams(normalized);

  const rawBook = params.get('book');
  const bookId = rawBook ? rawBook.trim() : null;

  const rawChapter = params.get('chapter');
  const chapterSlug = rawChapter ? rawChapter.trim() : null;

  if (!bookId) {
    return { bookId: null, chapterSlug, error: 'missing-book' };
  }

  if (!splitBookId(bookId)) {
    return { bookId, chapterSlug, error: 'invalid-book-id' };
  }

  if (!chapterSlug) {
    return { bookId, chapterSlug: null, error: 'missing-chapter' };
  }

  return { bookId, chapterSlug, error: null };
}

/**
 * 分割书本标识为学科集合标识与书籍标识
 * 规则：以第一个 '-' 为界，前置为 colSlug，后续为 bookSlug
 * 若格式不符合（无 '-' 或某一部分为空），返回 null
 */
export function splitBookId(bookId: string): SplitBookIdResult | null {
  if (!bookId || typeof bookId !== 'string') {
    return null;
  }

  const trimmed = bookId.trim();
  const dashIndex = trimmed.indexOf('-');

  if (dashIndex <= 0 || dashIndex === trimmed.length - 1) {
    return null;
  }

  const colSlug = trimmed.slice(0, dashIndex);
  const bookSlug = trimmed.slice(dashIndex + 1);

  return { colSlug, bookSlug };
}

/**
 * 构建学术克制空态视图模型
 */
export function buildEmptyStateViewModel(
  reason: EmptyStateReason | 'invalid-book-id'
): EmptyStateViewModel {
  const defaultAction: EmptyStateAction = {
    label: '返回研读书库',
    href: '/desktop/',
  };

  switch (reason) {
    case 'missing-book':
      return {
        title: '未指定图书',
        description: 'URL 查询参数中未包含有效的图书标识。请通过研读书库选择书籍。',
        action: defaultAction,
      };
    case 'invalid-book-id':
      return {
        title: '图书标识格式不合规',
        description: '图书标识须符合学科-书名层级结构规范。请通过研读书库选择书籍。',
        action: defaultAction,
      };
    case 'missing-chapter':
      return {
        title: '未指定章节',
        description: 'URL 查询参数中未包含章节标识。请指定要阅读的具体章节。',
        action: defaultAction,
      };
    case 'not-installed':
      return {
        title: '图书未安装',
        description: '当前运行环境中未检测到该图书的内容包，请在研读书库中完成安装。',
        action: defaultAction,
      };
    case 'chapter-missing':
      return {
        title: '章节不存在',
        description: '所请求的章节未在当前图书的内容清单中注册，请核对章节标识。',
        action: defaultAction,
      };
    default:
      return {
        title: '内容不可用',
        description: '所请求的内容暂时无法读取或未就绪。',
        action: defaultAction,
      };
  }
}
