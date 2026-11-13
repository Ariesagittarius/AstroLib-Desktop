import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  parseReaderQuery,
  splitBookId,
  buildEmptyStateViewModel,
  buildOutlineItems,
  type EmptyStateReason,
} from '../../src/services/content-provider/reader-entry.ts';

describe('Universal Reader Entry Pure Functions (P1-A3)', () => {
  describe('parseReaderQuery()', () => {
    it('应正确解析合法参数', () => {
      const q1 = parseReaderQuery('?book=math-math_senior&chapter=07_11_%E5%9F%BA%E6%9C%AC%E5%85%AC%E5%BC%8F');
      expect(q1.error).toBeNull();
      expect(q1.bookId).toBe('math-math_senior');
      expect(q1.chapterSlug).toBe('07_11_基本公式');

      // 不带 ? 前缀
      const q2 = parseReaderQuery('book=cs-algorithms&chapter=01_intro');
      expect(q2.error).toBeNull();
      expect(q2.bookId).toBe('cs-algorithms');
      expect(q2.chapterSlug).toBe('01_intro');
    });

    it('应正确解析含多级路径与中文的 chapterSlug', () => {
      const q = parseReaderQuery('?book=cs-algorithms&chapter=zh-wp/01_%E7%AE%97%E6%B3%95%E5%AF%BC%E8%AE%BA');
      expect(q.error).toBeNull();
      expect(q.bookId).toBe('cs-algorithms');
      expect(q.chapterSlug).toBe('zh-wp/01_算法导论');
    });

    it('应忽略无关的多余查询参数', () => {
      const q = parseReaderQuery('?book=cs-algo&chapter=01&theme=dark&page=2&lang=zh');
      expect(q.error).toBeNull();
      expect(q.bookId).toBe('cs-algo');
      expect(q.chapterSlug).toBe('01');
    });

    it('缺少 book 参数时返回 missing-book 错误', () => {
      expect(parseReaderQuery('').error).toBe('missing-book');
      expect(parseReaderQuery('?').error).toBe('missing-book');
      expect(parseReaderQuery('?chapter=01').error).toBe('missing-book');
      expect(parseReaderQuery('?book=&chapter=01').error).toBe('missing-book');
      expect(parseReaderQuery('?book=%20%20&chapter=01').error).toBe('missing-book');
    });

    it('book 参数不含合法层级结构（无 -）时返回 invalid-book-id', () => {
      expect(parseReaderQuery('?book=mathsenior&chapter=01').error).toBe('invalid-book-id');
      expect(parseReaderQuery('?book=-senior&chapter=01').error).toBe('invalid-book-id');
      expect(parseReaderQuery('?book=math-&chapter=01').error).toBe('invalid-book-id');
    });

    it('缺少 chapter 参数时返回 missing-chapter 错误', () => {
      const q = parseReaderQuery('?book=math-senior');
      expect(q.error).toBe('missing-chapter');
      expect(q.bookId).toBe('math-senior');
      expect(q.chapterSlug).toBeNull();

      const qEmpty = parseReaderQuery('?book=math-senior&chapter=');
      expect(qEmpty.error).toBe('missing-chapter');
    });
  });

  describe('splitBookId()', () => {
    it('按第一个横杠精准拆分 colSlug 与 bookSlug', () => {
      expect(splitBookId('cs-algorithms')).toEqual({
        colSlug: 'cs',
        bookSlug: 'algorithms',
      });
      expect(splitBookId('math-math_senior')).toEqual({
        colSlug: 'math',
        bookSlug: 'math_senior',
      });
      expect(splitBookId('science-quantum-physics-intro')).toEqual({
        colSlug: 'science',
        bookSlug: 'quantum-physics-intro',
      });
    });

    it('非法格式返回 null', () => {
      expect(splitBookId('')).toBeNull();
      expect(splitBookId('singleword')).toBeNull();
      expect(splitBookId('-startwithdash')).toBeNull();
      expect(splitBookId('endwithdash-')).toBeNull();
      expect(splitBookId(null as unknown as string)).toBeNull();
    });
  });

  describe('buildEmptyStateViewModel()', () => {
    const reasons: EmptyStateReason[] = [
      'missing-book',
      'missing-chapter',
      'not-installed',
      'chapter-missing',
    ];

    it.each(reasons)('各空态原因 [%s] 均具备非空学术文案且导航动作回退至 /desktop/', (reason) => {
      const vm = buildEmptyStateViewModel(reason);
      expect(vm.title).toBeTruthy();
      expect(typeof vm.title).toBe('string');
      expect(vm.description).toBeTruthy();
      expect(typeof vm.description).toBe('string');
      expect(vm.action.href).toBe('/desktop/');
      expect(vm.action.label).toBeTruthy();
    });

    it('invalid-book-id 原因同样回退至 /desktop/', () => {
      const vm = buildEmptyStateViewModel('invalid-book-id');
      expect(vm.title).toBeTruthy();
      expect(vm.description).toBeTruthy();
      expect(vm.action.href).toBe('/desktop/');
    });
  });

  describe('buildOutlineItems()', () => {
    it('仅保留 h2/h3，且锚点必须取自 heading.id（回归 #undefined）', () => {
      const items = buildOutlineItems([
        { depth: 1, text: '章标题', id: 'chapter' },
        { depth: 2, text: '小节 A', id: 'sec-a' },
        { depth: 3, text: '子节 B', id: 'sec-b' },
        { depth: 4, text: '过深标题', id: 'too-deep' },
      ]);

      expect(items).toEqual([
        { href: '#sec-a', text: '小节 A', depth: 2 },
        { href: '#sec-b', text: '子节 B', depth: 3 },
      ]);
      expect(items.some((item) => item.href === '#undefined')).toBe(false);
    });

    it('缺少 id 的标题必须跳过，空输入返回空数组', () => {
      const items = buildOutlineItems([
        { depth: 2, text: '无锚点标题', id: '' },
        { depth: 3, text: '有效标题', id: 'ok' },
      ]);

      expect(items).toHaveLength(1);
      expect(items[0].href).toBe('#ok');
      expect(buildOutlineItems(undefined)).toEqual([]);
      expect(buildOutlineItems(null)).toEqual([]);
      expect(buildOutlineItems([])).toEqual([]);
    });

    it('reader.astro 必须经 buildOutlineItems 渲染大纲，且不得引用 heading.slug', () => {
      const source = fs.readFileSync(path.resolve(process.cwd(), 'src/pages/reader.astro'), 'utf8');
      expect(source).toContain('buildOutlineItems(');
      expect(source).not.toMatch(/h\.slug|heading\.slug|\$\{h\.slug\}/);
    });
  });

  describe('浏览器端打包安全性负向断言 (Zero Node API in Client Bundles)', () => {    const targetFiles = [
      'src/services/content-provider/reader-entry.ts',
      'src/pages/reader.astro',
      'src/services/content-provider/web-provider.ts',
      'src/services/content-provider/electron-provider.ts',
    ];

    it.each(targetFiles)('文件 %s 严禁包含 Node 专属模块或 API', (filePath) => {
      const fullPath = path.resolve(process.cwd(), filePath);
      expect(fs.existsSync(fullPath)).toBe(true);

      const content = fs.readFileSync(fullPath, 'utf-8');

      // 负向检测：禁止出现 node:fs, node:path, process.cwd(, from 'fs'
      expect(content).not.toMatch(/node:fs/);
      expect(content).not.toMatch(/node:path/);
      expect(content).not.toMatch(/process\.cwd\(/);
      expect(content).not.toMatch(/from\s+['"]fs['"]/);
    });
  });
});
