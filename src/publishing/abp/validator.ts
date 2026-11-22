import fs from 'node:fs';
import path from 'node:path';
import { compile } from '@mdx-js/mdx';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import katex from 'katex';
import { AbpFormatAdapter } from '../../core/book-formats/abp-adapter.ts';
import { validateInstallPayload } from '../../services/content-provider/install-validation.ts';
import { naturalSort } from '../../utils/natural-sort.ts';
import type {
  AbpArchiveVerificationReport,
  MdxValidationIssue,
  MdxValidationReport,
} from './types.ts';

function buildLineResolver(content: string): (charIdx: number) => number {
  const offsets = [0];
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10) offsets.push(i + 1);
  }
  return (idx: number) => {
    let low = 0;
    let high = offsets.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (offsets[mid] <= idx) low = mid + 1;
      else high = mid - 1;
    }
    return high + 1;
  };
}

function walkMdxFiles(target: string): string[] {
  const resolved = path.resolve(target);
  if (!fs.existsSync(resolved)) return [];
  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) {
    return /\.(mdx|md)$/i.test(resolved) ? [resolved] : [];
  }
  const list: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'images' || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(mdx|md)$/i.test(entry.name)) list.push(full);
    }
  };
  walk(resolved);
  return list.sort(naturalSort);
}

export async function validateMdxFile(
  filePath: string,
  options: { baseDir?: string; assetBaseDir?: string; skipMath?: boolean; skipMdxCompile?: boolean } = {}
): Promise<MdxValidationIssue[]> {
  const issues: MdxValidationIssue[] = [];
  const resolvedFile = path.resolve(filePath);
  if (!fs.existsSync(resolvedFile)) {
    return [
      {
        file: filePath,
        severity: 'error',
        category: 'mdx-syntax',
        message: `文件不存在: ${filePath}`,
      },
    ];
  }

  const content = fs.readFileSync(resolvedFile, 'utf-8').replace(/^\uFEFF/, '');
  const relFile = options.baseDir
    ? path.relative(path.resolve(options.baseDir), resolvedFile).replace(/\\/g, '/')
    : path.basename(resolvedFile);
  const getLine = buildLineResolver(content);

  let frontmatterTitle = '';
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!fmMatch) {
    issues.push({
      file: relFile,
      severity: 'error',
      category: 'frontmatter',
      line: 1,
      message: '缺少 YAML Frontmatter（必须包含 --- 块与 title 字段）',
    });
  } else {
    const titleMatch = fmMatch[1].match(/^title\s*:\s*(.+)$/m);
    if (!titleMatch || !titleMatch[1].trim()) {
      issues.push({
        file: relFile,
        severity: 'error',
        category: 'frontmatter',
        line: 1,
        message: 'Frontmatter 中缺少必需的 title 字段',
      });
    } else {
      frontmatterTitle = titleMatch[1].trim().replace(/^["']|["']$/g, '').trim();
    }
  }

  const body = fmMatch ? content.slice(fmMatch[0].length) : content;
  const bodyOffset = fmMatch ? fmMatch[0].length : 0;

  if (body.trim().length < 15) {
    issues.push({
      file: relFile,
      severity: 'warning',
      category: 'empty-content',
      line: getLine(bodyOffset),
      message: '章节正文过短（不足 15 个字符），请核对是否漏页或截断',
    });
  }

  if (!options.skipMdxCompile) {
    try {
      const compiled = await compile(
        { value: body, path: resolvedFile },
        {
          remarkPlugins: [remarkMath],
          rehypePlugins: [[rehypeKatex, { strict: false }]],
          jsx: true,
        }
      );
      const compiledStr = String(compiled);
      if (compiledStr.includes('katex-error')) {
        const idx = compiledStr.indexOf('katex-error');
        issues.push({
          file: relFile,
          severity: 'error',
          category: 'katex',
          message: 'MDX 编译产物中出现 katex-error（请检查公式语法）',
          snippet: compiledStr.slice(Math.max(0, idx - 30), idx + 180).replace(/\s+/g, ' '),
        });
      }
    } catch (err: any) {
      issues.push({
        file: relFile,
        severity: 'error',
        category: 'mdx-syntax',
        line: typeof err?.line === 'number' ? err.line + getLine(bodyOffset) - 1 : undefined,
        column: err?.column,
        message: err?.message || String(err),
      });
    }
  }

  if (!options.skipMath) {
    const maskedCode = content.replace(/```[\s\S]*?```/g, (m) => ' '.repeat(m.length));

    for (const m of maskedCode.matchAll(/\$\$([\s\S]+?)\$\$/g)) {
      const raw = m[1].trim();
      if (!raw) continue;
      try {
        katex.renderToString(raw, { displayMode: true, throwOnError: true, strict: false });
      } catch (err: any) {
        issues.push({
          file: relFile,
          severity: 'error',
          category: 'katex',
          line: getLine(m.index ?? 0),
          message: `块级公式错误: ${err?.message || String(err)}`,
          snippet: raw.replace(/\s+/g, ' ').slice(0, 100),
        });
      }
    }

    const noBlocks = maskedCode.replace(/\$\$[\s\S]+?\$\$/g, (m) => ' '.repeat(m.length));
    for (const m of noBlocks.matchAll(/(?<!\\)\$([^\$\n\r]+?)(?<!\\)\$/g)) {
      const raw = m[1].trim();
      if (!raw) continue;
      try {
        katex.renderToString(raw, { displayMode: false, throwOnError: true, strict: false });
      } catch (err: any) {
        issues.push({
          file: relFile,
          severity: 'error',
          category: 'katex',
          line: getLine(m.index ?? 0),
          message: `行内公式错误: ${err?.message || String(err)}`,
          snippet: raw.replace(/\s+/g, ' ').slice(0, 100),
        });
      }
    }
  }

  const bookRootDir = path.dirname(resolvedFile);
  for (const m of content.matchAll(/!\[[^\]]*\]\(([^)\n]+)\)/g)) {
    const rawPath = (m[1] || '').trim();
    if (!rawPath || /^(?:https?:\/\/|data:)/i.test(rawPath)) continue;
    const cleanPath = rawPath.split('?')[0].split('#')[0];
    const relKey = cleanPath.startsWith('/') ? cleanPath.slice(1) : cleanPath;
    const resolvedAsset = path.resolve(bookRootDir, relKey);
    const fallbackAsset = options.assetBaseDir ? path.resolve(options.assetBaseDir, relKey) : null;
    const exists =
      fs.existsSync(resolvedAsset) || (fallbackAsset !== null && fs.existsSync(fallbackAsset));
    if (!exists) {
      issues.push({
        file: relFile,
        severity: 'error',
        category: 'image-asset',
        line: getLine(m.index ?? 0),
        message: `引用的本地图片在磁盘上不存在: ${rawPath}`,
        snippet: m[0],
      });
    }
  }

  for (const m of content.matchAll(/<img\b[^>]*src=["']([^"']+)["']/gi)) {
    const rawPath = (m[1] || '').trim();
    if (rawPath.startsWith('./') || rawPath.startsWith('../') || rawPath.includes('images/')) {
      issues.push({
        file: relFile,
        severity: 'error',
        category: 'image-asset',
        line: getLine(m.index ?? 0),
        message: `禁止在 MDX 中使用原生 HTML <img src="${rawPath}"> 引用本地图片，必须改为 Markdown 语法 ![图注](${rawPath})`,
        snippet: m[0],
      });
    }
  }

  let figDepth = 0;
  for (const fm of content.matchAll(/<figure\b[^>]*>|<\/figure\s*>/gi)) {
    const tag = fm[0].toLowerCase();
    if (tag.startsWith('</')) {
      figDepth = Math.max(0, figDepth - 1);
    } else {
      if (figDepth > 0) {
        issues.push({
          file: relFile,
          severity: 'error',
          category: 'figure-nesting',
          line: getLine(fm.index ?? 0),
          message: '检测到嵌套 <figure> 标签，必须去除重复嵌套以防图注错位',
          snippet: fm[0],
        });
        break;
      }
      figDepth++;
    }
  }

  const lines = body.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const t = lines[i].trim();
    if (!t) continue;
    if (/^#{1,6}\s+\S/.test(t)) {
      issues.push({
        file: relFile,
        severity: 'error',
        category: 'trailing-heading',
        line: getLine(bodyOffset) + i,
        message: `章节末尾残留悬空标题行（疑似下一节标题泄漏）: "${t}"`,
        snippet: t,
      });
    }
    break;
  }

  if (/注解/.test(path.basename(resolvedFile)) && /<Knowledge\b/i.test(body)) {
    const m = /<Knowledge\b/i.exec(body);
    issues.push({
      file: relFile,
      severity: 'error',
      category: 'annotation-card',
      line: m ? getLine(bodyOffset + m.index) : undefined,
      message: '注解章节（*注解*.mdx）禁止使用 <Knowledge> 定理卡片，请还原为纯学术自然段落',
    });
  }

  const bodyLines = body.split(/\r?\n/);
  for (let i = 0; i < bodyLines.length; i++) {
    const ln = bodyLines[i];
    if (ln.trim().startsWith('|') && /\d+\s*~\s*\d+/.test(ln)) {
      issues.push({
        file: relFile,
        severity: 'warning',
        category: 'table-tilde',
        line: getLine(bodyOffset) + i,
        message: '表格行内发现半角 ~ 数值范围（可能触发 Markdown 删除线语法），建议替换为全角 ～',
        snippet: ln.trim().slice(0, 100),
      });
    }
  }

  for (const m of content.matchAll(/```mermaid\s*\r?\n([\s\S]*?)```/gi)) {
    const code = m[1].trim();
    const firstLine = (code.split(/\r?\n/).find((l) => l.trim() && !l.trim().startsWith('%%')) || '').trim();
    if (!/^(?:flowchart|graph|sequenceDiagram|stateDiagram(?:-v2)?|classDiagram|erDiagram|xychart-beta|pie|mindmap|gantt)\b/i.test(firstLine)) {
      issues.push({
        file: relFile,
        severity: 'warning',
        category: 'mermaid',
        line: getLine(m.index ?? 0),
        message: `Mermaid 图表首行指令可能不合法: "${firstLine}"`,
        snippet: firstLine,
      });
    }
  }

  const maskedBody = body.replace(/```[\s\S]*?```/g, (m) => m.replace(/[^\r\n]/g, ' '));
  const maskedBodyLines = maskedBody.split(/\r?\n/);

  for (let i = 0; i < maskedBodyLines.length; i++) {
    const t = maskedBodyLines[i].trim();
    if (/^#\s+\S/.test(t)) {
      issues.push({
        file: relFile,
        severity: 'error',
        category: 'duplicate-heading',
        line: getLine(bodyOffset) + i,
        message: `正文禁止使用一级标题 "# "（阅读器已将 frontmatter title 渲染为页面 <h1>）: "${t}"`,
        snippet: t.slice(0, 100),
      });
    }
  }

  if (frontmatterTitle) {
    const normHeadingText = (s: string) =>
      s
        .replace(/[`*_~]/g, '')
        .replace(/\s+/g, ' ')
        .replace(/[.:：。]+$/g, '')
        .trim()
        .toLowerCase();
    const stripSecPrefix = (s: string) =>
      s.replace(/^(?:chapter|section|ch\.?|§|第)?\s*\d+(?:\.\d+)*\s*[.:：、·—-]?\s*/i, '').trim();

    for (let i = 0; i < maskedBodyLines.length; i++) {
      const t = maskedBodyLines[i].trim();
      if (!t || /^<!--[\s\S]*?-->$/.test(t)) continue;
      const h2Match = t.match(/^##\s+(.+)$/);
      if (h2Match) {
        const normH = normHeadingText(h2Match[1]);
        const normT = normHeadingText(frontmatterTitle);
        const stripH = stripSecPrefix(normH);
        const stripT = stripSecPrefix(normT);
        const isDuplicate =
          normH === normT ||
          (normH.length >= 4 && normT.includes(normH)) ||
          (stripH.length >= 4 && stripT.length >= 4 && (stripH === stripT || stripT.includes(stripH) || stripH.includes(stripT)));
        if (isDuplicate) {
          issues.push({
            file: relFile,
            severity: 'error',
            category: 'duplicate-heading',
            line: getLine(bodyOffset) + i,
            message: `正文首行二级标题 "## ${h2Match[1].trim()}" 与 frontmatter title ("${frontmatterTitle}") 重复，请删除正文重复标题`,
            snippet: t.slice(0, 100),
          });
        }
      }
      break;
    }
  }

  for (const am of body.matchAll(/<Algorithm\b[^>]*>([\s\S]*?)<\/Algorithm>/gi)) {
    const inner = am[1] || '';
    const badTag = inner.match(/<br\s*\/?>|&nbsp;/i);
    if (badTag) {
      const baseLine = getLine(bodyOffset + (am.index ?? 0));
      issues.push({
        file: relFile,
        severity: 'error',
        category: 'algorithm-syntax',
        line: baseLine,
        message: `<Algorithm> 内部禁止使用 ${badTag[0]}（请使用真实换行符与 2 空格缩进编写干净伪代码，切勿用 <br/> 或 &nbsp;）`,
        snippet: badTag[0],
      });
    }
  }

  const fnDefs = new Map<string, number[]>();
  const fnRefs = new Map<string, number[]>();
  for (let i = 0; i < maskedBodyLines.length; i++) {
    const lineNo = getLine(bodyOffset) + i;
    const rawLn = maskedBodyLines[i];
    if (/^\s*>\s*\[页脚注释\]|<!--\s*MINERU_FOOTNOTE\b/i.test(rawLn)) {
      issues.push({
        file: relFile,
        severity: 'error',
        category: 'footnote',
        line: lineNo,
        message: '检测到未转换的 MinerU 原始页脚注释提示，请将其规范化为文内 [^id] 与文末 [^id]: 定义',
        snippet: rawLn.trim().slice(0, 100),
      });
    }
    const defMatch = rawLn.match(/^\[\^([A-Za-z0-9_.-]+)\]:\s*(.*)$/);
    let scanPart = rawLn;
    if (defMatch) {
      const id = defMatch[1];
      const arr = fnDefs.get(id) || [];
      arr.push(lineNo);
      fnDefs.set(id, arr);
      scanPart = defMatch[2] || '';
    }
    for (const rm of scanPart.matchAll(/\[\^([A-Za-z0-9_.-]+)\](?!:)/g)) {
      const id = rm[1];
      const arr = fnRefs.get(id) || [];
      arr.push(lineNo);
      fnRefs.set(id, arr);
    }
  }

  for (const [id, lineNos] of fnDefs.entries()) {
    if (lineNos.length > 1) {
      issues.push({
        file: relFile,
        severity: 'error',
        category: 'footnote',
        line: lineNos[1],
        message: `存在重复脚注定义 [^${id}]:（共出现 ${lineNos.length} 次，建议统一采用页码作用域前缀 [^p页码-序号]）`,
        snippet: `[^${id}]:`,
      });
    }
    if (!fnRefs.has(id)) {
      issues.push({
        file: relFile,
        severity: 'warning',
        category: 'footnote',
        line: lineNos[0],
        message: `脚注定义 [^${id}]: 未在正文被引用`,
        snippet: `[^${id}]:`,
      });
    }
  }

  for (const [id, lineNos] of fnRefs.entries()) {
    if (!fnDefs.has(id)) {
      issues.push({
        file: relFile,
        severity: 'error',
        category: 'footnote',
        line: lineNos[0],
        message: `正文引用了未定义的孤立脚注 [^${id}]`,
        snippet: `[^${id}]`,
      });
    }
  }

  return issues;
}

export async function validateBookDirectory(
  targetPath: string,
  options: { assetBaseDir?: string; skipMath?: boolean; skipMdxCompile?: boolean } = {}
): Promise<MdxValidationReport> {
  const resolved = path.resolve(targetPath);
  const files = walkMdxFiles(resolved);
  const baseDir = fs.existsSync(resolved) && fs.statSync(resolved).isDirectory() ? resolved : path.dirname(resolved);

  const errors: MdxValidationIssue[] = [];
  const warnings: MdxValidationIssue[] = [];
  let passedFiles = 0;

  for (const file of files) {
    const issues = await validateMdxFile(file, { baseDir, ...options });
    const fileErrors = issues.filter((i) => i.severity === 'error');
    const fileWarnings = issues.filter((i) => i.severity === 'warning');
    errors.push(...fileErrors);
    warnings.push(...fileWarnings);
    if (fileErrors.length === 0) passedFiles++;
  }

  return {
    passed: files.length > 0 && errors.length === 0,
    targetPath: resolved,
    totalFiles: files.length,
    passedFiles,
    errorCount: errors.length,
    warningCount: warnings.length,
    errors,
    warnings,
  };
}

export async function verifyAbpArchive(abpPath: string): Promise<AbpArchiveVerificationReport> {
  const resolved = path.resolve(abpPath);
  if (!fs.existsSync(resolved)) {
    return {
      passed: false,
      abpPath: resolved,
      bookId: '',
      title: '',
      totalChapters: 0,
      totalAssets: 0,
      katexErrorChapters: [],
      missingAssets: [],
      errors: [`ABP 文件不存在: ${resolved}`],
      warnings: [],
    };
  }

  const errors: string[] = [];
  const warnings: string[] = [];
  const katexErrorChapters: string[] = [];
  const missingAssets: string[] = [];

  try {
    const bytes = new Uint8Array(fs.readFileSync(resolved));
    const adapter = new AbpFormatAdapter();
    const normalized = await adapter.normalize(bytes);
    const bundle = validateInstallPayload(normalized.bundle);
    const manifest = bundle.manifest;
    const assets = bundle.assets || {};
    const chapters = bundle.chapters || {};
    const chapterCount = Object.keys(chapters).length;

    if (chapterCount === 0) {
      errors.push('ABP 包内 chapters 为空');
    }

    const assetPrefix = `/collections/${manifest.colSlug}/${manifest.slug}/`;
    for (const [slug, ch] of Object.entries(chapters)) {
      if (!ch.html || ch.html.trim().length === 0) {
        errors.push(`章节 ${slug} 编译 HTML 为空`);
        continue;
      }
      if (ch.html.includes('katex-error')) {
        katexErrorChapters.push(slug);
      }

      for (const m of ch.html.matchAll(/<img\b[^>]*src=["']([^"']+)["']/gi)) {
        const src = decodeURI(m[1]);
        if (src.startsWith(assetPrefix)) {
          const relAsset = src.slice(assetPrefix.length);
          if (!Object.prototype.hasOwnProperty.call(assets, relAsset)) {
            const msg = `${slug} -> ${relAsset}`;
            if (!missingAssets.includes(msg)) missingAssets.push(msg);
          }
        }
      }
    }

    if (katexErrorChapters.length > 0) {
      errors.push(`以下章节预渲染 HTML 中存在 katex-error: ${katexErrorChapters.join(', ')}`);
    }
    if (missingAssets.length > 0) {
      errors.push(`以下章节引用的图片资产未打包进 ABP assets: ${missingAssets.join('; ')}`);
    }

    if (manifest.cover && manifest.cover.startsWith(`/abp-packs/${manifest.id}/`)) {
      const relCover = manifest.cover.slice(`/abp-packs/${manifest.id}/`.length);
      if (!Object.prototype.hasOwnProperty.call(assets, relCover)) {
        errors.push(`manifest.cover 指向的包内资产缺失: ${relCover}`);
      }
    } else if (!manifest.cover) {
      warnings.push('manifest.cover 未设置，建议裁剪 PDF 首页作为内嵌封面 images/cover.jpg');
    }

    return {
      passed: errors.length === 0,
      abpPath: resolved,
      bookId: manifest.id,
      title: manifest.title,
      totalChapters: chapterCount,
      totalAssets: Object.keys(assets).length,
      katexErrorChapters,
      missingAssets,
      errors,
      warnings,
      manifest,
      bundleSummary: {
        hasAiIndex: Boolean(bundle.aiIndex),
        hasCrossRefs: Boolean(bundle.crossRefs),
        hasRelationGraph: Boolean(bundle.relationGraph),
        hasInspectorData: Boolean(bundle.inspectorData),
        hasEmbeddings: Boolean(bundle.embeddings),
      },
    };
  } catch (err: any) {
    errors.push(err?.message || String(err));
    return {
      passed: false,
      abpPath: resolved,
      bookId: '',
      title: '',
      totalChapters: 0,
      totalAssets: 0,
      katexErrorChapters,
      missingAssets,
      errors,
      warnings,
    };
  }
}
