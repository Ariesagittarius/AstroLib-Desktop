/**
 * src/core/knowledge/adapters/paper-ingest-adapter.ts
 * ============================================================================
 * MinerU 学术文献统一结构化适配器 (ingest-tasks & task/ingest)
 * ============================================================================
 * 职责：
 * 1. 自动聚合 %APPDATA%/AstroLib/ingest-tasks 与工作区 task/ingest 下的全部学术文献任务；
 * 2. 懒构建并缓存轻量结构化索引 (.cache/knowledge-index.v1.json)：
 *    自动提取文献真标题、层次大纲、分节正文块、LaTeX 公式、插图路径 (/api/ingest/image) 与页码映射；
 * 3. 提供与教材完全一致的 astrolib://paper/<taskId>[/<sectionId>] 寻址、分节阅读与全文检索能力。
 * ============================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import { resolveIngestCandidateDirs } from '../../catalog/content-paths.ts';
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

interface IngestMetaLite {
  taskId: string;
  fileName: string;
  fileSize?: number;
  pageCount?: number;
  pageRanges?: string;
  engine?: string;
  status: string;
  createdAt?: number;
  updatedAt?: number;
  completedAt?: number;
  hasImages?: boolean;
  imageCount?: number;
}

interface PaperTaskEntry {
  taskId: string;
  taskDir: string;
  unpackedDir: string;
  meta: IngestMetaLite;
}

interface PaperIndexedSection {
  id: string;
  title: string;
  depth: number;
  pageRange?: string;
  blocks: KnowledgeBlock[];
  markdown: string;
  images: KnowledgeSectionImage[];
}

interface PaperKnowledgeIndex {
  schemaVersion: 1;
  taskId: string;
  sourceMtimeMs: number;
  title: string;
  author?: string;
  abstractSnippet?: string;
  outline: KnowledgeOutlineNode[];
  sections: PaperIndexedSection[];
}

function findUnpackedArtifacts(unpackedDir: string): {
  mdPath: string | null;
  contentListPath: string | null;
  imagesDir: string | null;
} {
  if (!fs.existsSync(unpackedDir)) {
    return { mdPath: null, contentListPath: null, imagesDir: null };
  }

  let mdPath: string | null = null;
  let fallbackMdPath: string | null = null;
  let contentListV2: string | null = null;
  let contentListV1: string | null = null;
  let imagesDir: string | null = null;

  const walk = (dir: string, depth: number) => {
    if (depth > 3) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name.toLowerCase() === 'images' && !imagesDir) {
          imagesDir = full;
        } else if (!ent.name.startsWith('.')) {
          walk(full, depth + 1);
        }
      } else if (ent.isFile()) {
        const lower = ent.name.toLowerCase();
        if (lower === 'full.md' && !mdPath) {
          mdPath = full;
        } else if (lower.endsWith('.md') && !fallbackMdPath) {
          fallbackMdPath = full;
        } else if (lower.includes('content_list_v2') && lower.endsWith('.json') && !contentListV2) {
          contentListV2 = full;
        } else if (lower.includes('content_list') && lower.endsWith('.json') && !contentListV1) {
          contentListV1 = full;
        }
      }
    }
  };

  walk(unpackedDir, 0);

  return {
    mdPath: mdPath || fallbackMdPath,
    contentListPath: contentListV2 || contentListV1,
    imagesDir,
  };
}

function extractPageHintsFromContentList(contentListPath: string | null): Map<string, number> {
  const hints = new Map<string, number>();
  if (!contentListPath || !fs.existsSync(contentListPath)) return hints;

  try {
    const raw = JSON.parse(fs.readFileSync(contentListPath, 'utf-8'));
    const processItem = (it: any, defaultPage?: number) => {
      if (!it || typeof it !== 'object') return;
      const pageIdx = typeof it.page_idx === 'number' ? it.page_idx + 1 : defaultPage;
      if (!pageIdx) return;

      let text = '';
      if (typeof it.text === 'string') {
        text = it.text;
      } else if (it.content && typeof it.content === 'object') {
        const spans =
          it.content.title_content ||
          it.content.paragraph_content ||
          it.content.text_content ||
          [];
        if (Array.isArray(spans)) {
          text = spans.map((s: any) => s.content || '').join(' ');
        }
      }

      const key = text.replace(/\s+/g, ' ').trim().slice(0, 48).toLowerCase();
      if (key.length >= 6 && !hints.has(key)) {
        hints.set(key, pageIdx);
      }
    };

    if (Array.isArray(raw)) {
      raw.forEach((entry, idx) => {
        if (Array.isArray(entry)) {
          entry.forEach((sub) => processItem(sub, idx + 1));
        } else {
          processItem(entry);
        }
      });
    }
  } catch {}

  return hints;
}

function lookupPageHint(text: string, hints: Map<string, number>): number | undefined {
  if (hints.size === 0 || !text) return undefined;
  const clean = text.replace(/^#+\s*/, '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (clean.length < 6) return undefined;
  const probe = clean.slice(0, 48);
  const direct = hints.get(probe);
  if (direct) return direct;
  const shortProbe = clean.slice(0, 24);
  for (const [k, page] of hints.entries()) {
    if (k.startsWith(shortProbe) || probe.startsWith(k.slice(0, 24))) {
      return page;
    }
  }
  return undefined;
}

export class PaperIngestAdapter implements IKnowledgeAdapter {
  public readonly adapterId = 'paper-ingest';
  public readonly supportedFormats = ['paper'] as const;

  private tasksCache: PaperTaskEntry[] | null = null;
  private indexCache = new Map<string, PaperKnowledgeIndex>();

  public invalidateCache(): void {
    this.tasksCache = null;
    this.indexCache.clear();
  }

  private scanTasks(): PaperTaskEntry[] {
    if (this.tasksCache) return this.tasksCache;

    const candidateDirs = resolveIngestCandidateDirs();
    const taskMap = new Map<string, PaperTaskEntry>();

    for (const baseDir of candidateDirs) {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(baseDir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const ent of entries) {
        if (!ent.isDirectory() || !ent.name.startsWith('task_')) continue;
        const taskDir = path.join(baseDir, ent.name);
        const metaPath = path.join(taskDir, 'meta.json');
        if (!fs.existsSync(metaPath)) continue;

        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as IngestMetaLite;
          if (!meta || !meta.taskId) continue;

          const prev = taskMap.get(meta.taskId);
          if (prev && prev.meta.status === 'completed') continue;

          taskMap.set(meta.taskId, {
            taskId: meta.taskId,
            taskDir,
            unpackedDir: path.join(taskDir, 'unpacked'),
            meta,
          });
        } catch {}
      }
    }

    const list = Array.from(taskMap.values()).sort(
      (a, b) => (b.meta.createdAt || 0) - (a.meta.createdAt || 0)
    );
    this.tasksCache = list;
    return list;
  }

  private resolveTask(uriOrId: string): PaperTaskEntry | null {
    const s = (uriOrId || '').trim();
    if (!s) return null;
    const tasks = this.scanTasks();

    const parsed = parseAstrolibUri(s);
    if (parsed && parsed.entityKind === 'paper' && parsed.taskId) {
      return tasks.find((t) => t.taskId === parsed.taskId) || null;
    }

    const cleanId = s.replace(/^paper:/i, '').split('/')[0].split('#')[0].trim();
    const byId = tasks.find((t) => t.taskId === cleanId);
    if (byId) return byId;

    const lower = s.toLowerCase();
    return (
      tasks.find((t) => {
        const cleanName = (t.meta.fileName || '').replace(/\.pdf$/i, '').toLowerCase();
        if (cleanName === lower || cleanName.includes(lower)) return true;
        if (t.meta.status === 'completed') {
          const idx = this.getOrBuildIndex(t);
          if (idx && idx.title.toLowerCase().includes(lower)) return true;
        }
        return false;
      }) || null
    );
  }

  private getOrBuildIndex(entry: PaperTaskEntry): PaperKnowledgeIndex | null {
    const { taskId, taskDir, unpackedDir, meta } = entry;
    const { mdPath, contentListPath, imagesDir } = findUnpackedArtifacts(unpackedDir);
    if (!mdPath || !fs.existsSync(mdPath)) return null;

    let mtimeMs = meta.updatedAt || meta.completedAt || 0;
    try {
      mtimeMs = fs.statSync(mdPath).mtimeMs;
    } catch {}

    const memCached = this.indexCache.get(taskId);
    if (memCached && memCached.sourceMtimeMs === mtimeMs) {
      return memCached;
    }

    const cacheFile = path.join(taskDir, '.cache', 'knowledge-index.v1.json');
    if (fs.existsSync(cacheFile)) {
      try {
        const disk = JSON.parse(fs.readFileSync(cacheFile, 'utf-8')) as PaperKnowledgeIndex;
        if (disk && disk.schemaVersion === 1 && disk.sourceMtimeMs === mtimeMs) {
          this.indexCache.set(taskId, disk);
          return disk;
        }
      } catch {}
    }

    const rawMd = fs.readFileSync(mdPath, 'utf-8');
    const pageHints = extractPageHintsFromContentList(contentListPath);
    const built = this.buildIndexFromMarkdown({
      taskId,
      rawMd,
      fallbackTitle: (meta.fileName || taskId).replace(/\.pdf$/i, '').replace(/[_-]+/g, ' '),
      mtimeMs,
      pageHints,
      imagesDir,
    });

    this.indexCache.set(taskId, built);
    try {
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify(built), 'utf-8');
    } catch {}

    return built;
  }

  private buildIndexFromMarkdown(params: {
    taskId: string;
    rawMd: string;
    fallbackTitle: string;
    mtimeMs: number;
    pageHints: Map<string, number>;
    imagesDir: string | null;
  }): PaperKnowledgeIndex {
    const { taskId, rawMd, fallbackTitle, mtimeMs, pageHints, imagesDir } = params;
    const docUri = `astrolib://paper/${taskId}`;
    const lines = rawMd.split(/\r?\n/);

    let docTitle = fallbackTitle;
    let foundFirstH1 = false;

    interface RawSec {
      id: string;
      title: string;
      depth: number;
      startLine: number;
      lines: string[];
    }

    const rawSections: RawSec[] = [];
    let currentSec: RawSec | null = null;
    let inFence = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*(?:```|~~~)/.test(line)) {
        inFence = !inFence;
      }

      const hMatch = !inFence ? line.match(/^(#{1,4})\s+(.+?)\s*$/) : null;
      if (hMatch) {
        const depth = hMatch[1].length;
        const headingText = hMatch[2].replace(/\$+/g, '').replace(/\s+/g, ' ').trim();
        if (depth === 1 && !foundFirstH1 && headingText.length > 2) {
          docTitle = headingText;
          foundFirstH1 = true;
        }

        if (currentSec) {
          rawSections.push(currentSec);
        }
        const secId = `sec-${rawSections.length + 1}`;
        currentSec = {
          id: secId,
          title: headingText || `Section ${rawSections.length + 1}`,
          depth,
          startLine: i + 1,
          lines: [line],
        };
      } else {
        if (!currentSec) {
          currentSec = {
            id: 'sec-1',
            title: '首页与导言',
            depth: 1,
            startLine: 1,
            lines: [],
          };
        }
        currentSec.lines.push(line);
      }
    }
    if (currentSec) {
      rawSections.push(currentSec);
    }

    // 解析每个小节内的结构化块与插图
    const sections: PaperIndexedSection[] = [];
    let abstractSnippet: string | undefined;

    for (const sec of rawSections) {
      const { blocks, images } = this.parseMarkdownSectionBlocks({
        taskId,
        docUri,
        sectionId: sec.id,
        sectionLines: sec.lines,
        baseLine: sec.startLine,
        pageHints,
        imagesDir,
      });

      const pages = blocks.map((b) => b.page).filter((p): p is number => typeof p === 'number');
      const minPage = pages.length > 0 ? Math.min(...pages) : undefined;
      const maxPage = pages.length > 0 ? Math.max(...pages) : undefined;
      const pageRange =
        minPage !== undefined
          ? minPage === maxPage
            ? `p.${minPage}`
            : `p.${minPage}-${maxPage}`
          : undefined;

      if (!abstractSnippet && /abstract|摘要/i.test(sec.title)) {
        abstractSnippet = blocks
          .filter((b) => b.kind === 'paragraph')
          .map((b) => b.text)
          .join(' ')
          .slice(0, 240);
      }

      sections.push({
        id: sec.id,
        title: sec.title,
        depth: sec.depth,
        pageRange,
        blocks,
        markdown: sec.lines.join('\n').trim(),
        images,
      });
    }

    // 构造层次大纲树
    const outline: KnowledgeOutlineNode[] = [];
    const stack: Array<{ depth: number; node: KnowledgeOutlineNode }> = [];

    for (const sec of sections) {
      const node: KnowledgeOutlineNode = {
        id: sec.id,
        title: sec.title,
        slug: sec.id,
        depth: sec.depth,
        kind: 'section',
        uri: `${docUri}/${sec.id}`,
        pageRange: sec.pageRange,
        wordCount: sec.markdown.length,
        children: [],
      };

      while (stack.length > 0 && stack[stack.length - 1].depth >= sec.depth) {
        stack.pop();
      }
      if (stack.length === 0) {
        outline.push(node);
      } else {
        stack[stack.length - 1].node.children!.push(node);
      }
      stack.push({ depth: sec.depth, node });
    }

    // 清理空 children 字段以节省体积
    const prune = (nodes: KnowledgeOutlineNode[]) => {
      for (const n of nodes) {
        if (n.children && n.children.length === 0) {
          delete n.children;
        } else if (n.children) {
          prune(n.children);
        }
      }
    };
    prune(outline);

    return {
      schemaVersion: 1,
      taskId,
      sourceMtimeMs: mtimeMs,
      title: docTitle,
      abstractSnippet,
      outline,
      sections,
    };
  }

  private parseMarkdownSectionBlocks(params: {
    taskId: string;
    docUri: string;
    sectionId: string;
    sectionLines: string[];
    baseLine: number;
    pageHints: Map<string, number>;
    imagesDir: string | null;
  }): { blocks: KnowledgeBlock[]; images: KnowledgeSectionImage[] } {
    const { taskId, docUri, sectionId, sectionLines, baseLine, pageHints, imagesDir } = params;
    const blocks: KnowledgeBlock[] = [];
    const images: KnowledgeSectionImage[] = [];
    const seenImgs = new Set<string>();

    let i = 0;
    let bIdx = 0;

    while (i < sectionLines.length) {
      const line = sectionLines[i];
      if (!line.trim()) {
        i++;
        continue;
      }

      const lineNum = baseLine + i;

      // 1. 标题
      const hM = line.match(/^(#{1,6})\s+(.+?)\s*$/);
      if (hM) {
        const text = hM[2].trim();
        const id = `${sectionId}-h-${++bIdx}`;
        blocks.push({
          id,
          kind: 'heading',
          title: text,
          text,
          page: lookupPageHint(text, pageHints),
          lineStart: lineNum,
          lineEnd: lineNum,
          uri: `${docUri}/${sectionId}#${id}`,
        });
        i++;
        continue;
      }

      // 2. 独立公式块 $$ ... $$
      if (/^\s*\$\$/.test(line)) {
        const buf = [line];
        const startL = lineNum;
        if (!/^\s*\$\$.+\$\$\s*$/.test(line)) {
          i++;
          while (i < sectionLines.length) {
            buf.push(sectionLines[i]);
            if (/\$\$\s*$/.test(sectionLines[i])) break;
            i++;
          }
        }
        const fullText = buf.join('\n').trim();
        const latex = fullText.replace(/^\$\$\s*/, '').replace(/\s*\$\$$/, '').trim();
        const id = `${sectionId}-math-${++bIdx}`;
        blocks.push({
          id,
          kind: 'math',
          text: fullText,
          latex,
          lineStart: startL,
          lineEnd: baseLine + i,
          uri: `${docUri}/${sectionId}#${id}`,
        });
        i++;
        continue;
      }

      // 3. 图片行 ![alt](images/xxx.jpg)
      const imgM = line.match(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/);
      if (imgM && line.trim().startsWith('![')) {
        const rawSrc = imgM[2].trim();
        const fileName = path.basename(rawSrc);
        const url = `/api/ingest/image?taskId=${encodeURIComponent(taskId)}&name=${encodeURIComponent(fileName)}`;
        const localPath = imagesDir ? path.join(imagesDir, fileName) : undefined;
        let caption = (imgM[1] || imgM[3] || '').trim();
        if (i + 1 < sectionLines.length && /^(?:Fig\.?|Figure|图)\s*\d+/i.test(sectionLines[i + 1].trim())) {
          caption = sectionLines[i + 1].trim();
          i++;
        }
        const alt = caption || fileName;
        if (!seenImgs.has(url)) {
          seenImgs.add(url);
          images.push({ alt, url, localPath });
        }
        const id = `${sectionId}-fig-${++bIdx}`;
        blocks.push({
          id,
          kind: 'figure',
          title: alt,
          text: `[插图: ${alt}] (${url})`,
          imageUrl: url,
          localImagePath: localPath,
          page: lookupPageHint(alt, pageHints),
          lineStart: lineNum,
          lineEnd: baseLine + i,
          uri: `${docUri}/${sectionId}#${id}`,
        });
        i++;
        continue;
      }

      // 4. 代码块
      const fenceM = line.match(/^\s*(```+|~~~+)/);
      if (fenceM) {
        const marker = fenceM[1][0];
        const startL = lineNum;
        const buf = [line];
        i++;
        while (i < sectionLines.length && !new RegExp(`^\\s*${marker}{3,}\\s*$`).test(sectionLines[i])) {
          buf.push(sectionLines[i]);
          i++;
        }
        if (i < sectionLines.length) buf.push(sectionLines[i]);
        const id = `${sectionId}-code-${++bIdx}`;
        blocks.push({
          id,
          kind: 'code',
          text: buf.join('\n'),
          lineStart: startL,
          lineEnd: baseLine + i,
          uri: `${docUri}/${sectionId}#${id}`,
        });
        i++;
        continue;
      }

      // 5. 表格 (HTML table 或 Markdown pipe table)
      if (/^\s*<table\b/i.test(line) || (line.includes('|') && i + 1 < sectionLines.length && /^\s*\|?[\s:-]+\|/.test(sectionLines[i + 1]))) {
        const startL = lineNum;
        const buf = [line];
        const isHtmlTable = /^\s*<table\b/i.test(line);
        i++;
        while (i < sectionLines.length) {
          const cur = sectionLines[i];
          if (isHtmlTable) {
            buf.push(cur);
            if (/<\/table>/i.test(cur)) {
              i++;
              break;
            }
          } else {
            if (!cur.trim() || !cur.includes('|')) break;
            buf.push(cur);
          }
          i++;
        }
        const id = `${sectionId}-table-${++bIdx}`;
        blocks.push({
          id,
          kind: 'table',
          text: buf.join('\n').trim(),
          lineStart: startL,
          lineEnd: baseLine + i - 1,
          uri: `${docUri}/${sectionId}#${id}`,
        });
        continue;
      }

      // 6. 普通段落聚合
      const startL = lineNum;
      const buf = [line];
      i++;
      while (
        i < sectionLines.length &&
        sectionLines[i].trim() !== '' &&
        !/^#{1,6}\s/.test(sectionLines[i]) &&
        !/^\s*\$\$/.test(sectionLines[i]) &&
        !/^\s*!\[/.test(sectionLines[i]) &&
        !/^\s*(?:```+|~~~+)/.test(sectionLines[i]) &&
        !/^\s*<table\b/i.test(sectionLines[i])
      ) {
        buf.push(sectionLines[i]);
        i++;
      }

      const text = buf.join(' ').replace(/\s+/g, ' ').trim();
      if (text) {
        const id = `${sectionId}-p-${++bIdx}`;
        const kind: KnowledgeBlockKind = /^[-*+]\s|^\d+[.)]\s/.test(buf[0].trim())
          ? 'list'
          : /^>\s/.test(buf[0].trim())
            ? 'quote'
            : 'paragraph';
        blocks.push({
          id,
          kind,
          text,
          page: lookupPageHint(text, pageHints),
          lineStart: startL,
          lineEnd: baseLine + i - 1,
          uri: `${docUri}/${sectionId}#${id}`,
        });
      }
    }

    return { blocks, images };
  }

  public listDocuments(): KnowledgeDocumentSummary[] {
    return this.scanTasks().map((entry) => {
      const m = entry.meta;
      const isReady = m.status === 'completed';
      const idx = isReady ? this.getOrBuildIndex(entry) : null;

      return {
        uri: `astrolib://paper/${m.taskId}`,
        id: `paper:${m.taskId}`,
        kind: 'paper',
        sourceFormat: 'paper',
        colSlug: 'paper',
        slug: m.taskId,
        title: idx?.title || (m.fileName || m.taskId).replace(/\.pdf$/i, ''),
        author: idx?.author || 'MinerU 学术文献',
        publisher: m.fileName,
        category: 'paper',
        subject: 'paper',
        description: idx?.abstractSnippet || `PDF 学术文献 · ${m.pageCount || '?'} 页`,
        sectionCount: idx?.sections.length || 0,
        entrySectionId: idx?.sections[0]?.id,
        status:
          m.status === 'completed'
            ? 'ready'
            : m.status === 'failed'
              ? 'error'
              : m.status === 'idle'
                ? 'idle'
                : 'processing',
        updatedAt: m.completedAt || m.updatedAt || m.createdAt,
        pageCount: m.pageCount,
        imageCount: m.imageCount,
        sourceRoot: entry.taskDir,
      };
    });
  }

  public supportsDocument(uriOrId: string): boolean {
    return this.resolveTask(uriOrId) !== null;
  }

  public getOutline(uriOrId: string): KnowledgeOutlineNode[] | null {
    const task = this.resolveTask(uriOrId);
    if (!task) return null;
    const idx = this.getOrBuildIndex(task);
    return idx?.outline || [];
  }

  public readSection(
    uriOrId: string,
    sectionId?: string,
    options: ReadSectionOptions = {}
  ): KnowledgeSectionContent | null {
    const task = this.resolveTask(uriOrId);
    if (!task) return null;
    const idx = this.getOrBuildIndex(task);
    if (!idx || idx.sections.length === 0) return null;

    const parsedUri = parseAstrolibUri(uriOrId);
    const targetSecId = (sectionId || parsedUri?.sectionId || idx.sections[0].id).trim();

    let secIdx = idx.sections.findIndex(
      (s) =>
        s.id === targetSecId ||
        s.id.toLowerCase() === targetSecId.toLowerCase() ||
        s.title.toLowerCase() === targetSecId.toLowerCase()
    );
    if (secIdx < 0) {
      secIdx = idx.sections.findIndex((s) =>
        s.title.toLowerCase().includes(targetSecId.toLowerCase())
      );
    }
    if (secIdx < 0) {
      secIdx = 0;
    }

    const sec = idx.sections[secIdx];
    const offset = Math.max(0, Number(options.offset) || 0);
    const limit = Math.max(1, Math.min(200, Number(options.limit) || 80));
    const sliced = sec.blocks.slice(offset, offset + limit);
    const docUri = `astrolib://paper/${task.taskId}`;

    return {
      uri: `${docUri}/${sec.id}`,
      docUri,
      docTitle: idx.title,
      kind: 'paper',
      sourceFormat: 'paper',
      sectionId: sec.id,
      sectionTitle: sec.title,
      pageRange: sec.pageRange,
      totalBlocks: sec.blocks.length,
      offset,
      limit,
      hasMore: offset + sliced.length < sec.blocks.length,
      blocks: sliced,
      plainText: sliced.map((b) => b.text).join('\n\n'),
      ...(options.includeMarkdown ? { markdown: sec.markdown } : {}),
      images: sec.images,
      prevSectionId: secIdx > 0 ? idx.sections[secIdx - 1].id : undefined,
      nextSectionId: secIdx + 1 < idx.sections.length ? idx.sections[secIdx + 1].id : undefined,
    };
  }

  public search(query: string, options: SearchKnowledgeOptions = {}): KnowledgeSearchHit[] {
    if (options.kind && options.kind !== 'all' && options.kind !== 'paper') return [];
    if (options.format && options.format !== 'all' && options.format !== 'paper') return [];
    const q = (query || '').trim();
    if (!q) return [];

    const limit = Math.max(1, Math.min(50, options.limit || 20));
    const hits: KnowledgeSearchHit[] = [];
    const matcher = options.regex ? this.tryRegex(q) : null;
    const lowerQ = q.toLowerCase();

    for (const task of this.scanTasks()) {
      if (hits.length >= limit) break;
      if (task.meta.status !== 'completed') continue;
      if (options.docSlug && task.taskId !== options.docSlug) continue;

      const idx = this.getOrBuildIndex(task);
      if (!idx) continue;

      const docUri = `astrolib://paper/${task.taskId}`;
      let perDocMatches = 0;

      for (const sec of idx.sections) {
        if (perDocMatches >= 5 || hits.length >= limit) break;
        for (const blk of sec.blocks) {
          const hay = `${sec.title} ${blk.text}`;
          const matched = matcher ? matcher.test(hay) : hay.toLowerCase().includes(lowerQ);
          if (!matched) continue;

          hits.push({
            uri: `${docUri}/${sec.id}#${blk.id}`,
            docUri,
            docTitle: idx.title,
            kind: 'paper',
            sourceFormat: 'paper',
            colSlug: 'paper',
            docSlug: task.taskId,
            sectionId: sec.id,
            sectionTitle: sec.title,
            blockId: blk.id,
            snippet: this.extractSnippet(blk.text, q, matcher),
            lineNumber: blk.lineStart,
            page: blk.page,
            score: 0.96,
            matchSource: 'knowledge-index',
          });
          perDocMatches++;
          if (perDocMatches >= 5 || hits.length >= limit) break;
        }
      }
    }

    return hits;
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
