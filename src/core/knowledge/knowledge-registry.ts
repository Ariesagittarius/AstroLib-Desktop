/**
 * src/core/knowledge/knowledge-registry.ts
 * ============================================================================
 * AstroLib 统一知识库聚合注册中心 (Unified Knowledge Registry)
 * ============================================================================
 * 职责：
 * 1. 聚合 MDX 源码教材、ABP/pdf2abp 书籍、EPUB 电子书与 MinerU 学术文献；
 * 2. 支持动态挂载扩展适配器 (slides / videos / notes)；
 * 3. 提供统一列举、目录提取、分节无损读取与跨源全文检索，自动去重。
 * ============================================================================
 */

import { MdxBookAdapter } from './adapters/mdx-book-adapter.ts';
import { AbpEpubAdapter } from './adapters/abp-epub-adapter.ts';
import { PaperIngestAdapter } from './adapters/paper-ingest-adapter.ts';
import { parseAstrolibUri } from '../../utils/astrolib-uri.ts';
import type {
  IKnowledgeAdapter,
  KnowledgeDocumentSummary,
  KnowledgeEntityKind,
  KnowledgeOutlineNode,
  KnowledgeSearchHit,
  KnowledgeSectionContent,
  KnowledgeSourceFormat,
  ReadSectionOptions,
  SearchKnowledgeOptions,
} from './types.ts';

export class KnowledgeRegistry {
  private static instance: KnowledgeRegistry | null = null;
  private adapters: IKnowledgeAdapter[] = [];

  private constructor(adapters?: IKnowledgeAdapter[]) {
    this.adapters = adapters || [
      new MdxBookAdapter(),
      new AbpEpubAdapter(),
      new PaperIngestAdapter(),
    ];
  }

  public static getInstance(): KnowledgeRegistry {
    if (!KnowledgeRegistry.instance) {
      KnowledgeRegistry.instance = new KnowledgeRegistry();
    }
    return KnowledgeRegistry.instance;
  }

  /**
   * 供测试或新模态扩展插件注入独立适配器实例
   */
  public static createIsolated(adapters: IKnowledgeAdapter[]): KnowledgeRegistry {
    return new KnowledgeRegistry(adapters);
  }

  public registerAdapter(adapter: IKnowledgeAdapter): void {
    if (!this.adapters.some((a) => a.adapterId === adapter.adapterId)) {
      this.adapters.push(adapter);
    }
  }

  public invalidateCache(): void {
    for (const adapter of this.adapters) {
      adapter.invalidateCache?.();
    }
  }

  public listAllDocuments(filter?: {
    kind?: 'all' | KnowledgeEntityKind;
    format?: 'all' | KnowledgeSourceFormat;
    colSlug?: string;
    query?: string;
  }): KnowledgeDocumentSummary[] {
    const byUri = new Map<string, KnowledgeDocumentSummary>();

    for (const adapter of this.adapters) {
      for (const doc of adapter.listDocuments()) {
        if (!byUri.has(doc.uri)) {
          byUri.set(doc.uri, doc);
        }
      }
    }

    let list = Array.from(byUri.values());

    if (filter?.kind && filter.kind !== 'all') {
      list = list.filter((d) => d.kind === filter.kind);
    }
    if (filter?.format && filter.format !== 'all') {
      list = list.filter((d) => d.sourceFormat === filter.format);
    }
    if (filter?.colSlug) {
      list = list.filter((d) => d.colSlug === filter.colSlug);
    }
    if (filter?.query && filter.query.trim()) {
      const q = filter.query.trim().toLowerCase();
      list = list.filter(
        (d) =>
          d.title.toLowerCase().includes(q) ||
          d.slug.toLowerCase().includes(q) ||
          (d.author || '').toLowerCase().includes(q) ||
          (d.description || '').toLowerCase().includes(q) ||
          (d.tags || []).some((t) => t.toLowerCase().includes(q))
      );
    }

    return list;
  }

  public findDocument(uriOrId: string): KnowledgeDocumentSummary | null {
    const q = (uriOrId || '').trim();
    if (!q) return null;
    const all = this.listAllDocuments();

    const parsed = parseAstrolibUri(q);
    if (parsed) {
      const baseUri =
        parsed.entityKind === 'paper'
          ? `astrolib://paper/${parsed.taskId || parsed.bookSlug}`
          : `astrolib://${parsed.colSlug}/${parsed.bookSlug}`;
      const byUri = all.find((d) => d.uri === baseUri || d.slug === parsed.bookSlug);
      if (byUri) return byUri;
    }

    const lower = q.toLowerCase();
    return (
      all.find((d) => d.uri === q || d.id === q || d.slug === q) ||
      all.find(
        (d) =>
          d.uri.toLowerCase() === lower ||
          d.slug.toLowerCase() === lower ||
          d.title.toLowerCase() === lower
      ) ||
      all.find((d) => d.title.toLowerCase().includes(lower) || d.slug.toLowerCase().includes(lower)) ||
      null
    );
  }

  public getDocumentOutline(uriOrId: string): {
    document: KnowledgeDocumentSummary;
    outline: KnowledgeOutlineNode[];
  } | null {
    const doc = this.findDocument(uriOrId);
    const lookupKey = doc?.uri || uriOrId;

    for (const adapter of this.adapters) {
      if (!adapter.supportsDocument(lookupKey)) continue;
      const outline = adapter.getOutline(lookupKey);
      if (outline && doc) {
        return { document: doc, outline };
      }
      if (outline) {
        return {
          document: {
            uri: lookupKey,
            id: lookupKey,
            kind: lookupKey.includes('://paper/') ? 'paper' : 'book',
            sourceFormat: lookupKey.includes('://paper/') ? 'paper' : 'abp',
            colSlug: lookupKey.includes('://paper/') ? 'paper' : 'general',
            slug: lookupKey,
            title: lookupKey,
            category: 'general',
            sectionCount: outline.length,
            status: 'ready',
          },
          outline,
        };
      }
    }
    return null;
  }

  public readDocumentSection(
    uriOrId: string,
    sectionId?: string,
    options: ReadSectionOptions = {}
  ): KnowledgeSectionContent | null {
    const parsed = parseAstrolibUri(uriOrId);
    const effectiveSectionId = sectionId || parsed?.sectionId || parsed?.chapterSlug;
    const doc = this.findDocument(uriOrId);
    const lookupKey = doc?.uri || uriOrId;

    for (const adapter of this.adapters) {
      if (!adapter.supportsDocument(lookupKey)) continue;
      const content = adapter.readSection(lookupKey, effectiveSectionId, options);
      if (content) return content;
    }
    return null;
  }

  public searchAll(query: string, options: SearchKnowledgeOptions = {}): KnowledgeSearchHit[] {
    const q = (query || '').trim();
    if (!q) return [];
    const limit = Math.max(1, Math.min(60, options.limit || 20));
    const allHits: KnowledgeSearchHit[] = [];
    const seenKeys = new Set<string>();

    for (const adapter of this.adapters) {
      const perAdapterLimit = limit;
      const hits = adapter.search(q, { ...options, limit: perAdapterLimit });
      for (const h of hits) {
        const dedupKey = `${h.colSlug}/${h.docSlug}/${h.sectionId}:${h.lineNumber ?? h.blockId ?? h.snippet.slice(0, 32)}`;
        if (seenKeys.has(dedupKey)) continue;
        seenKeys.add(dedupKey);
        allHits.push(h);
        if (allHits.length >= limit) break;
      }
      if (allHits.length >= limit) break;
    }

    return allHits;
  }
}
