import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { renderReaderPageHtml } from '../../electron/server/reader-shell-template.ts';
import type { AstroBookManifest, AstroBookChapterPayload } from '../../src/types/content-package.ts';

const ROOT = path.resolve(__dirname, '../..');
const ABP = path.join(ROOT, 'artifacts', 'abp-packs');

function loadManifest(bookDir: string): AstroBookManifest {
  return JSON.parse(fs.readFileSync(path.join(ABP, bookDir, 'manifest.json'), 'utf8')) as AstroBookManifest;
}

function loadPayload(bookDir: string, chapterSlug: string): AstroBookChapterPayload {
  return JSON.parse(
    fs.readFileSync(path.join(ABP, bookDir, 'chapters', `${chapterSlug}.json`), 'utf8')
  ) as AstroBookChapterPayload;
}

function extractCollectionLinks(html: string): string[] {
  const links = new Set<string>();
  for (const m of html.matchAll(/\/collections\/([^"'\s<>)]+)/g)) {
    links.add(decodeURIComponent(m[1]).replace(/\/+$/, ''));
  }
  return [...links];
}

describe('Reader Shell canonical link contract (P1-A2)', () => {
  const mathSenior = loadManifest('math-math_senior');
  const algorithms = loadManifest('cs-algorithms');

  const cases: Array<{ bookDir: string; manifest: AstroBookManifest; chapterSlug: string }> = [
    { bookDir: 'math-math_senior', manifest: mathSenior, chapterSlug: '07_11_基本公式' },
    { bookDir: 'cs-algorithms', manifest: algorithms, chapterSlug: 'zh-wp/001_books-and-algorithms' },
  ];

  for (const { bookDir, manifest, chapterSlug } of cases) {
    it(`1. ${bookDir} / ${chapterSlug} 生成的所有 /collections 链接必须为 Canonical Slug`, () => {
      const payload = loadPayload(bookDir, chapterSlug);
      const html = renderReaderPageHtml(manifest, payload, path.join(ROOT, 'dist'));

      const links = extractCollectionLinks(html);
      expect(links.length).toBeGreaterThan(0);

      const canonicalByBook = new Map<string, Set<string>>();
      for (const dir of fs.readdirSync(ABP, { withFileTypes: true }).filter((d) => d.isDirectory())) {
        const m = loadManifest(dir.name);
        const set = new Set<string>();
        for (const section of m.sections ?? []) {
          for (const chapter of section.chapters ?? []) set.add(chapter.slug);
        }
        canonicalByBook.set(`${m.colSlug}/${m.slug}`, set);
      }

      const legacySlugs = new Set<string>();
      for (const section of manifest.sections ?? []) {
        for (const chapter of section.chapters ?? []) {
          if (chapter.legacySlug) legacySlugs.add(chapter.legacySlug);
        }
      }

      for (const link of links) {
        const parts = link.split('/');

        expect(parts.length, `非法链接: ${link}`).toBeGreaterThanOrEqual(2);
        const [col, book, ...rest] = parts;
        const canonicalSet = canonicalByBook.get(`${col}/${book}`);
        expect(canonicalSet, `未知书籍: ${link}`).toBeTruthy();
        const restSlug = rest.join('/');
        if (restSlug && !restSlug.startsWith('images/')) {
          expect(canonicalSet!.has(restSlug), `非 Canonical 章节链接: ${link}`).toBe(true);
          expect(legacySlugs.has(restSlug), `链接出现 legacySlug: ${link}`).toBe(false);
        }
      }
    });
  }

  it('2. 侧边栏必须覆盖全部多级章节 slug（zh-wp/…、zh/…），不遗漏任何章节', () => {
    const payload = loadPayload('cs-algorithms', 'zh-wp/001_books-and-algorithms');
    const html = renderReaderPageHtml(algorithms, payload, path.join(ROOT, 'dist'));
    const links = extractCollectionLinks(html);

    const allSlugs = new Set<string>();
    for (const section of algorithms.sections ?? []) {
      for (const chapter of section.chapters ?? []) allSlugs.add(chapter.slug);
    }
    const nestedSlugs = [...allSlugs].filter((s) => s.includes('/'));
    expect(nestedSlugs.length).toBe(138);

    const linkedSlugs = new Set(links.filter((l) => l.startsWith('cs/algorithms/')).map((l) => l.slice('cs/algorithms/'.length)));
    for (const slug of nestedSlugs) {
      expect(linkedSlugs.has(slug), `侧边栏遗漏多级章节: ${slug}`).toBe(true);
    }
  });

  it('3. reader-shell-template 不得再引入或调用 cleanSlug（slug 只由编译器归一化）', () => {
    const source = fs.readFileSync(path.join(ROOT, 'electron', 'server', 'reader-shell-template.ts'), 'utf8');
    expect(source).not.toMatch(/from\s+['"][^'"]*utils\/slug\.ts['"]/);
    expect(source).not.toMatch(/cleanSlug\s*\(/);
  });

  it('4. FragmentReaderHost 必须桥接 iframe 的 astrolib:switch-fragment 消息', () => {
    const source = [
      fs.readFileSync(path.join(ROOT, 'src', 'components', 'desktop', 'FragmentReaderHost.astro'), 'utf8'),
      fs.readFileSync(path.join(ROOT, 'src', 'features', 'reader-host', 'reader-host-controller.ts'), 'utf8'),
    ].join('\n');
    expect(source).toMatch(/addEventListener\(\s*['"]message['"]/);
    expect(source).toMatch(/astrolib:switch-fragment/);
    expect(source).toMatch(/contentWindow\s*===\s*e\.source/);
  });
});
