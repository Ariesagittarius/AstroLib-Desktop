/**
 * src/services/pdf2abp/book-analyzer.ts
 * ============================================================================
 * 确定性全书结构剖析器与覆盖度审计器 (Deterministic Book Structure & Coverage Tools)
 * ============================================================================
 * 为 PDF2ABP 主 Agent 提供零幻觉、确定性的统计与边界识别：
 * 1. analyzeBookStructure: 识别需跳过的目录/框目/索引页、提取章首导语 (chapter-intro)、
 *    按原书 1:1 二级小节输出精确物理起止页与同页切分锚点 (startAnchor/endAnchor)、标注脚注与算法密度页；
 * 2. auditBookCoverage: 对比 book/book.json + *.mdx 与 MinerU pages_blocks.json，
 *    核验正文文本覆盖率、插图与脚注留存率、sections[].intro 合规性及重复标题残留。
 * ============================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import type { BookJsonConfig } from '../../publishing/abp/types.ts';
import type { PdfInspectResult, StitchedPageBlock } from './types.ts';

export interface AnalyzedSectionCandidate {
  id: string;
  kind: 'frontmatter' | 'chapter-intro' | 'body' | 'exercises';
  title: string;
  parentChapter?: string;
  startPage: number;
  endPage: number;
  pageCount: number;
  startAnchor?: string;
  endAnchor?: string;
  subHeadings?: string[];
}

export interface BookStructureAnalysis {
  totalPagesAnalyzed: number;
  totalBlocks: number;
  pdfOutlineCount: number;
  suggestedDocumentMode: 'textbook' | 'paper' | 'exam' | 'monograph';
  tocAndIndexPagesToSkip: Array<{ page: number; reason: string }>;
  majorChapters: Array<{ page: number; title: string }>;
  sections: AnalyzedSectionCandidate[];
  density: {
    pagesWithFootnotes: Array<{ page: number; count: number }>;
    pagesWithCodeOrAlgorithm: Array<{ page: number; hints: string[] }>;
    pagesWithFigures: Array<{ page: number; count: number }>;
  };
}

export interface BookCoverageFileReport {
  relPath: string;
  title: string;
  textChars: number;
  footnoteDefs: number;
  footnoteRefs: number;
  unconvertedFootnoteHints: number;
  duplicateTopHeading: boolean;
  missingImages: string[];
  imageRefsCount: number;
}

export interface BookCoverageAuditReport {
  ok: boolean;
  totalMdxFiles: number;
  totalRegisteredEntries: number;
  missingRegisteredFiles: string[];
  introConfigIssues: string[];
  mineruStats: {
    totalBlocks: number;
    totalTextChars: number;
    totalImages: number;
    totalFootnotes: number;
  };
  outputStats: {
    totalTextChars: number;
    totalFootnoteDefs: number;
    totalImageRefs: number;
    totalUnconvertedHints: number;
    duplicateHeadingFiles: string[];
    missingImageFiles: string[];
  };
  charCoverageRatio: number;
  warnings: string[];
  errors: string[];
  files: BookCoverageFileReport[];
}

function slugifyId(raw: string, fallback: string): string {
  const s = raw
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return s || fallback;
}

export function analyzeBookStructure(
  pagesBlocksPath: string,
  pdfInfo?: PdfInspectResult
): BookStructureAnalysis {
  if (!fs.existsSync(pagesBlocksPath)) {
    throw new Error(`找不到 MinerU blocks 文件: ${pagesBlocksPath}`);
  }
  const allBlocks = JSON.parse(fs.readFileSync(pagesBlocksPath, 'utf-8')) as StitchedPageBlock[];
  const byPage = new Map<number, StitchedPageBlock[]>();
  let maxPage = 0;

  for (const b of allBlocks) {
    if (b.page > maxPage) maxPage = b.page;
    if (!byPage.has(b.page)) byPage.set(b.page, []);
    byPage.get(b.page)!.push(b);
  }

  const tocTitleRe =
    /^(?:(?:table\s+of\s+)?contents|list\s+of\s+(?:boxes|figures|tables)|(?:subject\s+|author\s+)?index|bibliography|references|目录|全书目录|插图目录|表格目录|索引|名词索引|参考文献)$/i;
  const frontmatterRe =
    /^(?:preface|foreword|acknowledgments?|acknowledgements?|about\s+this\s+book|to\s+the\s+reader|序|前\s*言|致\s*谢|内容提要|译者序)$/i;
  const chapterRe = /^(?:chapter\s+\d+\b|part\s+[ivx0-9]+\b|第\s*\d+\s*章\b)/i;
  const sec2Re = /^(\d+\.\d+)(?!\.\d)\b\s*(.*)$/;
  const sec3Re = /^(\d+\.\d+\.\d+)\b\s*(.*)$/;
  const exerciseRe = /^(?:exercises?|problems?|review\s+exercises?|习\s*题|练习|思考题|本章习题)\b/i;

  const skippedPages = new Map<number, string>();
  const pagesWithFootnotes: Array<{ page: number; count: number }> = [];
  const pagesWithCodeOrAlgorithm: Array<{ page: number; hints: string[] }> = [];
  const pagesWithFigures: Array<{ page: number; count: number }> = [];

  interface RawBoundary {
    kind: 'frontmatter' | 'chapter-intro' | 'body' | 'exercises';
    title: string;
    page: number;
    anchor: string;
    parentChapter?: string;
    chapterNum?: string;
  }

  const boundaries: RawBoundary[] = [];
  const majorChapters: Array<{ page: number; title: string }> = [];
  const subHeadingsBySec = new Map<string, string[]>();

  let currentMajorChapter = '';
  let currentChapterNum = '';
  let lastSecKey = '';

  const pageNumbers = Array.from(byPage.keys()).sort((a, b) => a - b);

  for (const p of pageNumbers) {
    const blocks = byPage.get(p) || [];
    let fnCount = 0;
    let figCount = 0;
    const codeHints = new Set<string>();
    let tocLineHits = 0;
    let pageFirstHeadingToc = '';

    for (const blk of blocks) {
      const txt = (blk.text || '').trim();
      if (blk.type === 'footnote') fnCount++;
      if (blk.type === 'image' || blk.type === 'chart') figCount++;
      if (blk.type === 'code') codeHints.add('code_block');
      if (
        blk.type !== 'title' &&
        (/(?:^|\n)\s*(?:function|procedure|algorithm)\s+[A-Za-z_]/i.test(txt) ||
          ((/\bInput:\b/.test(txt) && /\bOutput:\b/.test(txt)) ||
            (/\bif\s+[^:\n]+:\s*return\b/i.test(txt))))
      ) {
        codeHints.add('pseudocode_signature');
      }
      // 统计疑似目录点阵行或章节页码行
      const lines = txt.split(/\r?\n/);
      for (const ln of lines) {
        if (/(?:\.{3,}|…{2,})\s*\d+\s*$/.test(ln.trim()) || /^\d+(?:\.\d+)*\s+\S.{2,45}\s+\d{1,4}\s*$/.test(ln.trim())) {
          tocLineHits++;
        }
      }
    }

    if (fnCount > 0) pagesWithFootnotes.push({ page: p, count: fnCount });
    if (figCount > 0) pagesWithFigures.push({ page: p, count: figCount });
    if (codeHints.size > 0) pagesWithCodeOrAlgorithm.push({ page: p, hints: Array.from(codeHints) });

    // 判断整页是否为纯目录/索引页
    for (const blk of blocks) {
      if (blk.type === 'title') {
        const cleanT = blk.text.replace(/\s+/g, ' ').trim();
        if (tocTitleRe.test(cleanT)) {
          pageFirstHeadingToc = cleanT;
          break;
        }
      }
    }
    if (pageFirstHeadingToc || tocLineHits >= 6) {
      skippedPages.set(p, pageFirstHeadingToc ? `Heading: ${pageFirstHeadingToc}` : `TOC/Index lines (${tocLineHits})`);
      continue;
    }

    // 扫描本页所有 title 块构建层级边界
    for (let bi = 0; bi < blocks.length; bi++) {
      const blk = blocks[bi];
      if (blk.type !== 'title') continue;
      const t = blk.text.replace(/\s+/g, ' ').trim();
      if (!t) continue;

      if (frontmatterRe.test(t) && !currentChapterNum) {
        boundaries.push({
          kind: 'frontmatter',
          title: t,
          page: p,
          anchor: t,
        });
        lastSecKey = '';
        continue;
      }

      if (chapterRe.test(t)) {
        // 检查下一个非空块是否为紧随其后的章标题（例如 "Chapter 0" 后紧跟 "Prologue" 或 "Algorithms with numbers"）
        let chapFullTitle = t;
        let anchorText = t;
        const nextBlk = blocks[bi + 1];
        if (nextBlk && nextBlk.type === 'title') {
          const nextT = nextBlk.text.replace(/\s+/g, ' ').trim();
          if (nextT && !sec2Re.test(nextT) && !chapterRe.test(nextT)) {
            chapFullTitle = `${t} · ${nextT}`;
            bi++;
          }
        }
        currentMajorChapter = chapFullTitle;
        const chNumMatch = t.match(/\d+/);
        currentChapterNum = chNumMatch ? chNumMatch[0] : '';
        majorChapters.push({ page: p, title: chapFullTitle });

        // 检查紧随章标题后、下一条二级小节前是否存在直属该章的章首导语 prose
        const remBlocks = blocks.slice(bi + 1);
        let hasProseBeforeSec = false;
        for (const rb of remBlocks) {
          if (rb.type === 'title' && (sec2Re.test(rb.text.trim()) || exerciseRe.test(rb.text.trim()))) {
            break;
          }
          if (rb.type === 'paragraph' && rb.text.trim().length >= 50) {
            hasProseBeforeSec = true;
            break;
          }
        }
        // 也允许下一页在第一个 X.1 出现前有导语
        if (!hasProseBeforeSec && blocks.slice(bi + 1).every((rb) => rb.type !== 'title' || !sec2Re.test(rb.text.trim()))) {
          const nextPageBlocks = byPage.get(p + 1) || [];
          for (const rb of nextPageBlocks) {
            if (rb.type === 'title' && sec2Re.test(rb.text.trim())) break;
            if (rb.type === 'paragraph' && rb.text.trim().length >= 50) {
              hasProseBeforeSec = true;
              break;
            }
          }
        }

        if (hasProseBeforeSec) {
          boundaries.push({
            kind: 'chapter-intro',
            title: `${chapFullTitle} 导语`,
            page: p,
            anchor: anchorText,
            parentChapter: chapFullTitle,
            chapterNum: currentChapterNum,
          });
        }
        lastSecKey = '';
        continue;
      }

      const m2 = t.match(sec2Re);
      if (m2) {
        const key = `${p}:${t}`;
        boundaries.push({
          kind: 'body',
          title: t,
          page: p,
          anchor: t,
          parentChapter: currentMajorChapter || undefined,
          chapterNum: m2[1].split('.')[0],
        });
        lastSecKey = key;
        if (!subHeadingsBySec.has(key)) subHeadingsBySec.set(key, []);
        continue;
      }

      const m3 = t.match(sec3Re);
      if (m3 && lastSecKey) {
        subHeadingsBySec.get(lastSecKey)!.push(t);
        continue;
      }

      if (exerciseRe.test(t) && currentMajorChapter) {
        boundaries.push({
          kind: 'exercises',
          title: `Exercises (${currentChapterNum ? `Chapter ${currentChapterNum}` : currentMajorChapter})`,
          page: p,
          anchor: t,
          parentChapter: currentMajorChapter,
          chapterNum: currentChapterNum,
        });
        lastSecKey = '';
      }
    }
  }

  // 根据相邻边界计算每节精确起止页与同页 endAnchor
  const sections: AnalyzedSectionCandidate[] = [];
  for (let i = 0; i < boundaries.length; i++) {
    const cur = boundaries[i];
    const next = boundaries[i + 1];
    let endPage = next ? next.page : maxPage;

    // 若下一页已被判定为跳过的目录/索引页，则上一节在该跳过页之前结束
    for (let p = cur.page + 1; p <= endPage; p++) {
      if (skippedPages.has(p)) {
        endPage = Math.max(cur.page, p - 1);
        break;
      }
    }

    // 若 cur 与 next 在不同页，但 next 紧随其后且 next.page 第一块就是 next.anchor，则前一小节通常在 next.page - 1 结束；
    // 若 next 落在页面中部（该页在 next.anchor 之前还有属于上一节的段落/公式），则 endPage === next.page 且附带 endAnchor!
    let endAnchor: string | undefined;
    if (next && endPage === next.page) {
      if (cur.page === next.page) {
        endAnchor = next.anchor;
      } else {
        const endBlocks = byPage.get(endPage) || [];
        const nextAnchorIdx = endBlocks.findIndex(
          (b) => b.type === 'title' && b.text.replace(/\s+/g, ' ').trim().toLowerCase().includes(next.anchor.toLowerCase())
        );
        if (nextAnchorIdx > 0) {
          endAnchor = next.anchor;
        } else {
          endPage = Math.max(cur.page, next.page - 1);
        }
      }
    }

    const secKey = `${cur.page}:${cur.title}`;
    const subs = subHeadingsBySec.get(secKey);

    sections.push({
      id: `${cur.kind === 'chapter-intro' ? 'intro' : cur.kind === 'exercises' ? 'ex' : 'sec'}_${String(i + 1).padStart(2, '0')}_${slugifyId(cur.title, 'item')}`,
      kind: cur.kind,
      title: cur.title,
      ...(cur.parentChapter ? { parentChapter: cur.parentChapter } : {}),
      startPage: cur.page,
      endPage: Math.max(cur.page, endPage),
      pageCount: Math.max(1, endPage - cur.page + 1),
      startAnchor: cur.anchor,
      ...(endAnchor ? { endAnchor } : {}),
      ...(subs && subs.length > 0 ? { subHeadings: subs } : {}),
    });
  }

  const tocArr = Array.from(skippedPages.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([page, reason]) => ({ page, reason }));

  const hasNumberedSec2 = sections.some((s) => s.kind === 'body');
  const suggestedDocumentMode: BookStructureAnalysis['suggestedDocumentMode'] =
    hasNumberedSec2 || majorChapters.length >= 2
      ? 'textbook'
      : maxPage <= 35
        ? 'paper'
        : 'monograph';

  return {
    totalPagesAnalyzed: pageNumbers.length,
    totalBlocks: allBlocks.length,
    pdfOutlineCount: pdfInfo?.outline?.length ?? 0,
    suggestedDocumentMode,
    tocAndIndexPagesToSkip: tocArr,
    majorChapters,
    sections,
    density: {
      pagesWithFootnotes,
      pagesWithCodeOrAlgorithm,
      pagesWithFigures,
    },
  };
}

function walkMdxRelativePaths(dir: string, prefix = ''): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkMdxRelativePaths(full, rel));
    } else if (/\.mdx$/i.test(entry.name)) {
      results.push(rel.replace(/\\/g, '/'));
    }
  }
  return results.sort();
}

export function auditBookCoverage(
  bookDir: string,
  pagesBlocksPath: string
): BookCoverageAuditReport {
  const errors: string[] = [];
  const warnings: string[] = [];

  const resolvedBookDir = path.resolve(bookDir);
  const bookJsonPath = path.join(resolvedBookDir, 'book.json');
  if (!fs.existsSync(bookJsonPath)) {
    throw new Error(`找不到 book.json: ${bookJsonPath}`);
  }
  if (!fs.existsSync(pagesBlocksPath)) {
    throw new Error(`找不到 MinerU blocks 文件: ${pagesBlocksPath}`);
  }

  const bookJson = JSON.parse(fs.readFileSync(bookJsonPath, 'utf-8')) as BookJsonConfig;
  const allBlocks = JSON.parse(fs.readFileSync(pagesBlocksPath, 'utf-8')) as StitchedPageBlock[];
  const mdxFiles = walkMdxRelativePaths(resolvedBookDir);
  const mdxStemMap = new Map<string, string>();
  for (const rel of mdxFiles) {
    mdxStemMap.set(rel.replace(/\.mdx$/i, ''), rel);
    mdxStemMap.set(rel, rel);
  }

  const registeredSet = new Set<string>();
  const missingRegisteredFiles: string[] = [];
  const introConfigIssues: string[] = [];

  const registerSlug = (raw: string): boolean => {
    const clean = String(raw || '').replace(/\\/g, '/').replace(/^\//, '').replace(/\.mdx$/i, '');
    if (!clean) return true;
    registeredSet.add(clean);
    if (!mdxStemMap.has(clean)) {
      missingRegisteredFiles.push(`${clean}.mdx`);
      return false;
    }
    return true;
  };

  for (const sec of bookJson.sections || []) {
    const secChaps = new Set((sec.chapters || []).map((c) => String(c || '').replace(/\\/g, '/').replace(/\.mdx$/i, '')));
    if (sec.intro) {
      const cleanIntro = String(sec.intro).replace(/\\/g, '/').replace(/\.mdx$/i, '');
      registerSlug(cleanIntro);
      if (secChaps.has(cleanIntro)) {
        introConfigIssues.push(`Section "${sec.title}" 将 intro="${sec.intro}" 同时列入了 chapters[]`);
      }
    }
    for (const c of sec.chapters || []) {
      registerSlug(c);
    }
  }

  if (missingRegisteredFiles.length > 0) {
    errors.push(`book.json 引用的 ${missingRegisteredFiles.length} 个 MDX 文件缺失: ${missingRegisteredFiles.join(', ')}`);
  }
  if (introConfigIssues.length > 0) {
    errors.push(...introConfigIssues);
  }

  let outputTextChars = 0;
  let outputFootnoteDefs = 0;
  let outputImageRefs = 0;
  let totalUnconvertedHints = 0;
  const duplicateHeadingFiles: string[] = [];
  const missingImageFiles: string[] = [];
  const fileReports: BookCoverageFileReport[] = [];

  for (const rel of mdxFiles) {
    const full = path.join(resolvedBookDir, rel);
    const content = fs.readFileSync(full, 'utf-8').replace(/^\uFEFF/, '');
    const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    const title = fmMatch?.[1].match(/^title\s*:\s*(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '') || rel;
    const body = fmMatch ? content.slice(fmMatch[0].length) : content;

    const maskedBody = body.replace(/```[\s\S]*?```/g, '');
    const strippedTextLen = maskedBody
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<\/?[A-Za-z][^>]*>/g, '')
      .replace(/\s+/g, '')
      .length;
    outputTextChars += strippedTextLen;

    const defs = Array.from(maskedBody.matchAll(/^\[\^([A-Za-z0-9_.-]+)\]:/gm));
    const refs = Array.from(maskedBody.matchAll(/\[\^([A-Za-z0-9_.-]+)\](?!:)/g));
    const unconverted = Array.from(maskedBody.matchAll(/^\s*>\s*\[页脚注释\]|<!--\s*MINERU_FOOTNOTE\b/gm));

    outputFootnoteDefs += defs.length;
    totalUnconvertedHints += unconverted.length;
    if (unconverted.length > 0) {
      errors.push(`${rel}: 存在 ${unconverted.length} 条未处理的 MINERU_FOOTNOTE 注释提示`);
    }

    const firstHeading = maskedBody
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l && !/^<!--[\s\S]*?-->$/.test(l));
    const dupHead = Boolean(
      firstHeading &&
        (/^#\s+\S/.test(firstHeading) ||
          (firstHeading.startsWith('## ') &&
            firstHeading.slice(3).trim().toLowerCase() === title.trim().toLowerCase()))
    );
    if (dupHead) {
      duplicateHeadingFiles.push(rel);
      errors.push(`${rel}: 首行存在与 frontmatter.title 重复的顶层标题 (${firstHeading})`);
    }

    const imgRefs = Array.from(body.matchAll(/!\[[^\]]*\]\(([^)]+)\)|<img[^>]+src=["']([^"']+)["']/gi))
      .map((m) => (m[1] || m[2] || '').trim())
      .filter((s) => s && !/^https?:\/\//i.test(s) && !s.startsWith('data:'));

    const missingImgs: string[] = [];
    for (const src of imgRefs) {
      const cleanSrc = src.replace(/^\.?\//, '');
      const absCandidate1 = path.resolve(path.dirname(full), cleanSrc);
      const absCandidate2 = path.resolve(resolvedBookDir, cleanSrc.replace(/^\//, ''));
      if (!fs.existsSync(absCandidate1) && !fs.existsSync(absCandidate2)) {
        missingImgs.push(src);
        missingImageFiles.push(`${rel}:${src}`);
      }
    }
    outputImageRefs += imgRefs.length;

    fileReports.push({
      relPath: rel,
      title,
      textChars: strippedTextLen,
      footnoteDefs: defs.length,
      footnoteRefs: refs.length,
      unconvertedFootnoteHints: unconverted.length,
      duplicateTopHeading: dupHead,
      missingImages: missingImgs,
      imageRefsCount: imgRefs.length,
    });
  }

  let mineruTextChars = 0;
  let mineruImages = 0;
  let mineruFootnotes = 0;
  for (const b of allBlocks) {
    if (b.type === 'footnote') mineruFootnotes++;
    else if (b.type === 'image' || b.type === 'chart') mineruImages++;
    else mineruTextChars += (b.text || '').replace(/\s+/g, '').length;
  }

  const charCoverageRatio = mineruTextChars > 0 ? Number((outputTextChars / mineruTextChars).toFixed(3)) : 1;

  if (mineruFootnotes > 0 && outputFootnoteDefs === 0) {
    warnings.push(`MinerU 检测到 ${mineruFootnotes} 条页脚注释，但输出 MDX 中共有 0 条 [^id]: 脚注定义，请确认是否有遗漏。`);
  }
  if (missingImageFiles.length > 0) {
    errors.push(`存在 ${missingImageFiles.length} 处断链图片引用: ${missingImageFiles.slice(0, 8).join(', ')}`);
  }

  return {
    ok: errors.length === 0,
    totalMdxFiles: mdxFiles.length,
    totalRegisteredEntries: registeredSet.size,
    missingRegisteredFiles,
    introConfigIssues,
    mineruStats: {
      totalBlocks: allBlocks.length,
      totalTextChars: mineruTextChars,
      totalImages: mineruImages,
      totalFootnotes: mineruFootnotes,
    },
    outputStats: {
      totalTextChars: outputTextChars,
      totalFootnoteDefs: outputFootnoteDefs,
      totalImageRefs: outputImageRefs,
      totalUnconvertedHints,
      duplicateHeadingFiles,
      missingImageFiles,
    },
    charCoverageRatio,
    warnings,
    errors,
    files: fileReports,
  };
}
