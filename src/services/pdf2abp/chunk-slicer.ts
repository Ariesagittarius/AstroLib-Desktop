import fs from 'node:fs';
import path from 'node:path';
import type { JobWorkspace } from './workspace-manager.ts';
import type { BookPlanSpec, ChapterChunkWorkOrder, StitchedPageBlock } from './types.ts';

function formatBlockToDraftLine(b: StitchedPageBlock): string {
  if (b.type === 'title') {
    const hashes = '#'.repeat(Math.max(1, Math.min(4, b.level || 2)));
    return `${hashes} ${b.text}`;
  }
  if (b.type === 'equation') {
    return b.text;
  }
  if (b.type === 'image' || b.type === 'chart') {
    return b.caption
      ? `<figure class="vp-figure">![${b.caption}](${b.imgPath})<figcaption>${b.caption}</figcaption></figure>`
      : `![](${b.imgPath})`;
  }
  if (b.type === 'table') {
    if (b.text && b.text.startsWith('<table')) {
      return b.caption ? `**${b.caption}**\n\n${b.text}` : b.text;
    }
    return b.imgPath
      ? (b.caption ? `<figure class="vp-figure">![${b.caption}](${b.imgPath})<figcaption>${b.caption}</figcaption></figure>` : `![](${b.imgPath})`)
      : b.text;
  }
  if (b.type === 'footnote') {
    return `<!-- MINERU_FOOTNOTE p${b.page}: ${b.text.replace(/\s+/g, ' ').trim()} -->`;
  }
  return b.text;
}

export function precleanDraft(text: string): string {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd() + '\n';
}

export function validateBookPlan(plan: BookPlanSpec): {
  ok: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!plan || !Array.isArray(plan.chapters) || plan.chapters.length === 0) {
    errors.push('BookPlanSpec.chapters 不能为空。');
    return { ok: false, errors, warnings };
  }

  const seenIds = new Set<string>();
  const seenFiles = new Set<string>();
  const stemToChapter = new Map<string, BookPlanSpec['chapters'][number]>();

  for (const ch of plan.chapters) {
    if (!ch.id || !ch.id.trim()) {
      errors.push('存在缺少 id 的章节规划条目。');
    } else if (seenIds.has(ch.id)) {
      errors.push(`存在重复章节 id: "${ch.id}"。`);
    } else {
      seenIds.add(ch.id);
    }

    const cleanFn = String(ch.filename || '').replace(/\\/g, '/').replace(/^book\//, '').replace(/\.mdx$/i, '');
    if (!cleanFn) {
      errors.push(`章节 "${ch.id}" 缺少有效 filename。`);
    } else if (seenFiles.has(cleanFn)) {
      errors.push(`存在重复输出文件路径: "${ch.filename}"。`);
    } else {
      seenFiles.add(cleanFn);
      stemToChapter.set(cleanFn, ch);
      stemToChapter.set(path.basename(cleanFn), ch);
    }

    if (!Number.isFinite(ch.startPage) || !Number.isFinite(ch.endPage) || ch.startPage < 1 || ch.endPage < ch.startPage) {
      errors.push(`章节 "${ch.id}" ("${ch.title}") 页码区间非法: [${ch.startPage}, ${ch.endPage}]。`);
    }
  }

  const docMode = plan.documentMode ?? 'textbook';
  if (docMode === 'textbook') {
    const pureTocOrIndexRe =
      /^(?:(?:table of )?contents(?:\s+and\s+list\s+of\s+(?:boxes|figures|tables))?|list\s+of\s+(?:boxes|figures|tables)|(?:subject\s+|author\s+)?index|目录|全书目录|插图目录|表格目录|图表目录|索引|名词索引|术语索引)$/i;
    const mergedSiblingRe =
      /(?:^|[\s·,&/+])\d+\.\d+(?:\.\d+)?\b[\s\S]*?(?:·|&|\/|\+|\band\b|与|和)\s*\d+\.\d+(?:\.\d+)?\b/i;

    const twoLevelChapters = new Set<string>();
    for (const ch of plan.chapters) {
      if (ch.kind === 'exercises' || ch.kind === 'frontmatter' || ch.kind === 'chapter-intro') continue;
      const m2 = (ch.title || '').trim().match(/^(\d+)\.\d+(?!\.\d)\b/);
      if (m2) twoLevelChapters.add(m2[1]);
    }

    for (const ch of plan.chapters) {
      const trimmedTitle = (ch.title || '').trim();
      if (pureTocOrIndexRe.test(trimmedTitle)) {
        errors.push(
          `教材模式 (textbook) 禁止录入纯目录/框目表/索引页 ("${trimmedTitle}", id="${ch.id}")；全书目录应直接跳过，仅保留 Preface/Foreword/Prologue 等正式前置正文。`
        );
      }
      if (ch.kind !== 'exercises' && mergedSiblingRe.test(trimmedTitle)) {
        errors.push(
          `禁止将多个平级小节合并为单篇章节 ("${trimmedTitle}", id="${ch.id}")；必须按原书小节 1:1 严格拆分为独立章节。`
        );
      }
      if (ch.kind !== 'exercises' && ch.kind !== 'frontmatter' && ch.kind !== 'chapter-intro') {
        const m3 = trimmedTitle.match(/^(\d+\.\d+\.\d+)\b/);
        if (m3) {
          const topChap = m3[1].split('.')[0];
          if (twoLevelChapters.has(topChap)) {
            errors.push(
              `禁止将第 ${topChap} 章的三级子标题 "${trimmedTitle}" (${m3[1]}) 从所属二级小节拆出并列，请合并回对应二级小节中。`
            );
          }
        }
      }
    }
  }

  if (Array.isArray(plan.bookConfig?.sections)) {
    for (const sec of plan.bookConfig.sections) {
      const secChapters = new Set(
        (sec.chapters || []).map((c) => String(c || '').replace(/\\/g, '/').replace(/\.mdx$/i, ''))
      );
      if (sec.intro) {
        const introNorm = String(sec.intro).replace(/\\/g, '/').replace(/^book\//, '').replace(/\.mdx$/i, '');
        const introChap = stemToChapter.get(introNorm) || stemToChapter.get(path.basename(introNorm));
        if (!introChap) {
          errors.push(`bookConfig.sections ("${sec.title}") 的 intro="${sec.intro}" 未在 plan.chapters 中规划。`);
        } else if (introChap.kind !== 'chapter-intro') {
          errors.push(`bookConfig.sections ("${sec.title}") 引用的 intro "${sec.intro}" 必须声明 kind: "chapter-intro"。`);
        }
        if (secChapters.has(introNorm) || secChapters.has(path.basename(introNorm))) {
          errors.push(`章首导语 "${sec.intro}" 已配置为 sections.intro，严禁同时重复放入 sections.chapters[] 数组中。`);
        }
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

function findAnchorBlockIndex(
  blocks: StitchedPageBlock[],
  anchor: string,
  fromIdx: number,
  preferHeading: boolean
): number {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  const stripPunct = (s: string) => norm(s).replace(/[^\p{L}\p{N}\s.]/gu, '');
  const needle = norm(anchor);
  const needleLoose = stripPunct(anchor);
  if (!needle) return -1;

  const matches = (blk: StitchedPageBlock, loose: boolean) => {
    const text = `${blk.text || ''} ${blk.caption || ''}`;
    return loose
      ? needleLoose.length >= 4 && stripPunct(text).includes(needleLoose)
      : norm(text).includes(needle);
  };

  if (preferHeading) {
    for (let i = fromIdx; i < blocks.length; i++) {
      if ((blocks[i].type === 'title' || blocks[i].type === 'heading') && matches(blocks[i], false)) {
        return i;
      }
    }
  }
  for (let i = fromIdx; i < blocks.length; i++) {
    if (matches(blocks[i], false)) return i;
  }
  if (needleLoose.length >= 4) {
    for (let i = fromIdx; i < blocks.length; i++) {
      if (matches(blocks[i], true)) return i;
    }
  }
  return -1;
}

export function prepareChapterChunks(params: {
  workspace: JobWorkspace;
  plan: BookPlanSpec;
  maxPagesPerChunk?: number;
}): {
  workOrders: ChapterChunkWorkOrder[];
  copiedImagesCount: number;
  chunkManifestRelPath: string;
  warnings: string[];
} {
  const { workspace, plan } = params;
  const planCheck = validateBookPlan(plan);
  if (!planCheck.ok) {
    throw new Error(`书籍结构规划校验失败：\n- ${planCheck.errors.join('\n- ')}`);
  }

  const explicitCap =
    typeof params.maxPagesPerChunk === 'number' && params.maxPagesPerChunk > 0
      ? Math.max(2, Math.min(28, Math.floor(params.maxPagesPerChunk)))
      : 0;

  const pagesBlocksPath = path.join(workspace.mineruStitchedDir, 'pages_blocks.json');
  if (!fs.existsSync(pagesBlocksPath)) {
    throw new Error('尚未运行 MinerU 或缺少 mineru/stitched/pages_blocks.json');
  }

  const allBlocks = JSON.parse(fs.readFileSync(pagesBlocksPath, 'utf-8')) as StitchedPageBlock[];
  const blocksByPage = new Map<number, StitchedPageBlock[]>();
  for (const b of allBlocks) {
    if (!blocksByPage.has(b.page)) blocksByPage.set(b.page, []);
    blocksByPage.get(b.page)!.push(b);
  }

  if (plan.bookConfig) {
    workspace.writeFile('book/book.json', JSON.stringify(plan.bookConfig, null, 2));
  }

  const workOrders: ChapterChunkWorkOrder[] = [];
  const warnings: string[] = [...planCheck.warnings];
  const copiedImages = new Set<string>();
  const globalRulesText = Array.isArray(plan.globalProofreadingRules)
    ? plan.globalProofreadingRules.join('\n')
    : '';

  for (const ch of plan.chapters || []) {
    const startP = Math.max(1, Math.floor(ch.startPage));
    const endP = Math.max(startP, Math.floor(ch.endPage));
    const totalSpan = endP - startP + 1;
    const chunkSpan = explicitCap > 0 ? explicitCap : totalSpan > 28 ? 20 : totalSpan;
    const totalParts = Math.ceil(totalSpan / chunkSpan);
    const cleanFilename = ch.filename.replace(/\\/g, '/').replace(/^book\//, '');
    const targetOutputRelPath = `book/${cleanFilename}`;

    for (let partIdx = 1; partIdx <= totalParts; partIdx++) {
      const pStart = startP + (partIdx - 1) * chunkSpan;
      const pEnd = Math.min(endP, pStart + chunkSpan - 1);
      const chunkId = totalParts === 1 ? ch.id : `${ch.id}__part${partIdx}of${totalParts}`;

      const pageSections: string[] = [];
      const referencedImages = new Set<string>();

      for (let p = pStart; p <= pEnd; p++) {
        const pageBlocks = blocksByPage.get(p) || [];
        let sliceStartIdx = 0;
        let sliceEndIdx = pageBlocks.length;

        if (p === startP && ch.startAnchor && ch.startAnchor.trim()) {
          const foundStart = findAnchorBlockIndex(pageBlocks, ch.startAnchor, 0, true);
          if (foundStart >= 0) {
            sliceStartIdx = foundStart;
          } else {
            warnings.push(`章节 "${ch.id}" 起始页 p${p} 未命中 startAnchor="${ch.startAnchor}"，已退回整页起点。`);
          }
        }

        if (p === endP && ch.endAnchor && ch.endAnchor.trim()) {
          const searchFrom = p === startP ? sliceStartIdx + 1 : 0;
          const foundEnd = findAnchorBlockIndex(pageBlocks, ch.endAnchor, searchFrom, true);
          if (foundEnd >= 0) {
            sliceEndIdx = foundEnd;
          } else {
            warnings.push(`章节 "${ch.id}" 结束页 p${p} 未命中 endAnchor="${ch.endAnchor}"，已退回至页末。`);
          }
        }

        const slicedBlocks = pageBlocks.slice(sliceStartIdx, sliceEndIdx);
        const lines: string[] = [`<!-- PHYSICAL_PAGE ${p} -->`];
        for (const blk of slicedBlocks) {
          lines.push(formatBlockToDraftLine(blk));
          if (blk.imgPath) {
            const imgName = path.basename(blk.imgPath);
            referencedImages.add(`images/${imgName}`);
            const srcImg = path.join(workspace.mineruStitchedDir, 'images', imgName);
            const destImg = path.join(workspace.bookImagesDir, imgName);
            if (fs.existsSync(srcImg) && !copiedImages.has(imgName)) {
              fs.mkdirSync(workspace.bookImagesDir, { recursive: true });
              fs.copyFileSync(srcImg, destImg);
              copiedImages.add(imgName);
            }
          }
        }
        pageSections.push(lines.join('\n\n'));
      }

      const draftHeader =
        partIdx === 1
          ? `---\ntitle: "${ch.title.replace(/"/g, '\\"')}"\n---\n\n`
          : `---\ntitle: "${ch.title.replace(/"/g, '\\"')} (Part ${partIdx})"\n---\n\n`;

      const draftRelPath = `chunks/${chunkId}/draft.md`;
      workspace.writeFile(draftRelPath, precleanDraft(draftHeader + pageSections.join('\n\n')));

      const partOutputRelPath =
        totalParts === 1
          ? targetOutputRelPath
          : `chunks/${chunkId}/proofread_part.mdx`;

      const combinedRules = [
        globalRulesText,
        ch.kind === 'notes' ? '【特别铁律】本章为注解/考据章节：严禁包装任何 <Knowledge> 定理卡片！' : '',
        ch.kind === 'exercises' ? '【特别铁律】本章为课后习题章节：每题必须独立封装为 <Exercise title="练习 N">，若有提示/解答则内嵌 <Solution title="提示">！' : '',
        ch.kind === 'chapter-intro' ? '【章首导语规则】本文件为归属整章本身的章首导语（如 Prologue / 章前导言），请保持纯净正文，禁止写一级标题 # 或重复章/节标题，也不包含后续第一节正文。' : '',
        ch.rules || '',
        totalParts > 1 ? `【分片提示】这是《${ch.title}》的第 ${partIdx}/${totalParts} 段（物理页 ${pStart}-${pEnd}）。请专注校对本页段全部内容，勿擅自补全未在本页段出现的后续内容。` : '',
      ]
        .filter(Boolean)
        .join('\n');

      const order: ChapterChunkWorkOrder = {
        chunkId,
        chapterId: ch.id,
        chapterTitle: ch.title,
        targetOutputRelPath: partOutputRelPath,
        partIndex: partIdx,
        totalParts,
        startPage: pStart,
        endPage: pEnd,
        draftRelPath,
        workOrderRelPath: `chunks/${chunkId}/work-order.json`,
        referencedImages: Array.from(referencedImages),
        rules: combinedRules,
      };

      workspace.writeFile(order.workOrderRelPath, JSON.stringify(order, null, 2));
      workOrders.push(order);
    }
  }

  const chunkManifestRelPath = 'chunks/manifest.json';
  workspace.writeFile(
    chunkManifestRelPath,
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        totalWorkOrders: workOrders.length,
        warnings,
        workOrders,
      },
      null,
      2
    )
  );

  return {
    workOrders,
    copiedImagesCount: copiedImages.size,
    chunkManifestRelPath,
    warnings,
  };
}

export function mergeChapterParts(params: {
  workspace: JobWorkspace;
  targetOutputRelPath: string;
  partRelPaths: string[];
  chapterTitle: string;
}): { targetOutputRelPath: string; mergedParts: number; bytesWritten: number } {
  const { workspace, targetOutputRelPath, partRelPaths, chapterTitle } = params;
  if (!partRelPaths || partRelPaths.length === 0) {
    throw new Error('partRelPaths 不能为空');
  }

  const bodyParts: string[] = [];
  for (let i = 0; i < partRelPaths.length; i++) {
    const raw = workspace.readFile(partRelPaths[i], { startLine: 1, endLine: 20000, maxChars: 500000 }).content;
    const stripped = raw
      .replace(/^\uFEFF/, '')
      .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
      .trim();
    if (stripped) {
      bodyParts.push(stripped);
    }
  }

  const normalizedTarget = targetOutputRelPath.startsWith('book/')
    ? targetOutputRelPath
    : `book/${targetOutputRelPath.replace(/^\/+/, '')}`;

  const safeTitle = chapterTitle.replace(/"/g, '\\"');
  const fullContent = `---\ntitle: "${safeTitle}"\n---\n\n${bodyParts.join('\n\n')}\n`;
  const written = workspace.writeFile(normalizedTarget, fullContent);

  return {
    targetOutputRelPath: written.relPath,
    mergedParts: partRelPaths.length,
    bytesWritten: written.bytesWritten,
  };
}
