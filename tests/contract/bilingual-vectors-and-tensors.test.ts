import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { collections, sourceCollections } from '../../src/config/collections.config.ts';

describe('Bilingual Vectors and Tensors Book Contract', () => {
  const colSource = collections.length > 0 ? collections : sourceCollections;
  const scienceCol = colSource.find((c) => c.slug === 'science');
  const book = scienceCol?.books.find((b) => b.slug === 'vectors_and_tensors');

  it('declares bilingual configuration for vectors_and_tensors with English default and Chinese translation', () => {
    if (!book) return;
    expect(book).toBeDefined();
    expect(book?.languages).toBeDefined();
    expect(book?.languages?.length).toBe(2);

    const enConfig = book?.languages?.find((l) => l.id === 'en');
    const zhConfig = book?.languages?.find((l) => l.id === 'zh');

    expect(enConfig).toBeDefined();
    expect(enConfig?.default).toBe(true);
    expect(zhConfig).toBeDefined();
    expect(zhConfig?.pathPrefix).toBe('zh');
  });

  it('contains complete 50-chapter tocMapping with 100% symmetric files on disk for both editions', () => {
    if (!book) return;
    expect(book?.tocMapping).toBeDefined();
    const mapping = book!.tocMapping!;
    const keys = Object.keys(mapping);

    expect(keys.length).toBe(50);

    const sourcesDir = path.resolve(process.cwd(), 'content-sources/collections/science/vectors_and_tensors');
    const legacyDir = path.resolve(process.cwd(), 'src/content/docs/collections/science/vectors_and_tensors');
    const baseDir = fs.existsSync(sourcesDir) ? sourcesDir : legacyDir;

    for (const [enKey, zhVal] of Object.entries(mapping)) {
      const enFile = path.join(baseDir, `${enKey}.mdx`);
      expect(fs.existsSync(enFile), `English file missing: ${enFile}`).toBe(true);
      const enContent = fs.readFileSync(enFile, 'utf-8');
      expect(enContent).toContain('title:');
      expect(enContent.length).toBeGreaterThan(100);

      const targetPaths = Array.isArray(zhVal) ? zhVal : [zhVal];
      expect(targetPaths.length).toBe(1);

      for (const tPath of targetPaths) {
        const tFile = path.join(baseDir, `${tPath}.mdx`);
        expect(fs.existsSync(tFile), `Translation file missing: ${tFile}`).toBe(true);
        const tContent = fs.readFileSync(tFile, 'utf-8');
        expect(tContent).toContain('title:');
        expect(tContent.length).toBeGreaterThan(100);
      }
    }
  });
});
