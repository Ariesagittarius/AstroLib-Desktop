/**
 * src/core/content-api/ast-extractor.ts
 * ============================================================================
 * AstroLib 章节结构化语义提取引擎 (MDX AST & Academic Card Extractor)
 * ============================================================================
 * 职责：
 * 1. 深度解析 MDX 源码，提取 Frontmatter 元数据与多级标题 (H1-H6)；
 * 2. 识别与抽取学术卡片体系 (<Theorem>, <Definition>, <Example>, <Solution> 等)，支持嵌套解构；
 * 3. 抽离独立行间与行内 KaTeX 数学公式，保留完整精确 LaTeX 表述与行号；
 * 4. 抽取全部正文段落、代码块、列表、表格并建立抽象层语义定性描述；
 * 5. 生成层次分明、唯一可寻址的真实 AST 语法树 (AstDocumentNode)，支撑精确内容读取；
 * 6. 100% 纯函数与无副作用，严格支撑外部脚本、MCP 与 Agent 结构化分析。
 * ============================================================================
 */

import type { ChapterHeadingItem } from '../../types/content-package.ts';
import type {
  AcademicCardNode,
  MathFormulaNode,
  ParagraphNode,
  ChapterAstData,
  AstDocumentNode,
  AstNodeType,
} from './types.ts';
import { slugifyHeading } from '../content/headings.ts';

const KNOWN_ACADEMIC_TAGS = new Set([
  'Theorem',
  'Definition',
  'Example',
  'Solution',
  'Proof',
  'Remark',
  'Lemma',
  'Corollary',
  'Proposition',
  'Summary',
  'Card',
  'Note',
  'Guide',
  'Knowledge',
  'Analysis',
  'Variant',
  'Block',
  'Method',
  'Exercise',
]);

/**
 * 1. 从 MDX 中抽取 Frontmatter 元数据
 */
export function extractFrontmatter(mdxContent: string): {
  frontmatter: Record<string, string>;
  body: string;
  frontmatterLines: number;
} {
  const match = mdxContent.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    return { frontmatter: {}, body: mdxContent, frontmatterLines: 0 };
  }

  const rawYaml = match[1];
  const body = mdxContent.slice(match[0].length);
  const frontmatterLines = (match[0].match(/\n/g) || []).length;
  const frontmatter: Record<string, string> = {};

  const lines = rawYaml.split(/\r?\n/);
  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      let val = line.slice(colonIdx + 1).trim();
      if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) {
        val = val.slice(1, -1);
      }
      frontmatter[key] = val;
    }
  }

  return { frontmatter, body, frontmatterLines };
}

/**
 * 抽象层：分析行间数学公式的学术定性描述
 */
function summarizeMathFormula(latex: string): string {
  const clean = latex.replace(/\s+/g, ' ').trim();
  const tags: string[] = [];

  if (clean.includes('Leibniz') || clean.includes('binom') || clean.includes('(u v) ^ {(n)}')) {
    tags.push('Leibniz 高阶求导展开');
  }
  if (clean.includes('\\sum')) tags.push('求和级数');
  if (clean.includes('\\int')) tags.push('积分表达式');
  if (clean.includes('\\lim')) tags.push('极限计算');
  if (clean.includes('\\frac{\\partial') || clean.includes('\\partial')) tags.push('偏导数');
  if (clean.includes('\\begin{matrix}') || clean.includes('\\begin{pmatrix}') || clean.includes('\\begin{vmatrix}')) {
    tags.push('矩阵/行列式');
  }
  if (clean.includes('Taylor') || clean.includes('Peano') || clean.includes('Lagrange')) {
    tags.push('中值定理/泰勒展开');
  }

  const tagPrefix = tags.length > 0 ? `[${tags.join(', ')}] ` : '';
  const snippet = clean.length > 80 ? clean.slice(0, 77) + '...' : clean;
  return `【独立公式】${tagPrefix}$$${snippet}$$`;
}

/**
 * 抽象层：分析学术卡片语义并生成学术定性摘要
 */
function summarizeCard(tag: string, title?: string, firstChildPreview?: string): string {
  const label = title || tag;
  const childHint = firstChildPreview ? `：${firstChildPreview.slice(0, 50)}` : '';

  switch (tag) {
    case 'Example':
      return `【例题示范】${label}${childHint}`;
    case 'Solution':
      return `【题解/推导证明】${label || '解'}${childHint}`;
    case 'Theorem':
      return `【核心定理】${label}${childHint}`;
    case 'Definition':
      return `【概念定义】${label}${childHint}`;
    case 'Proof':
      return `【严密数学证明】${label || '证明'}`;
    case 'Knowledge':
      return `【知识点卡片】${label}${childHint}`;
    case 'Remark':
    case 'Note':
      return `【注记与警示】${label}${childHint}`;
    case 'Method':
      return `【方法论与求解技巧】${label}${childHint}`;
    case 'Exercise':
      return `【课后习题/练习题】${label}${childHint}`;
    default:
      return `【学术模块 ${tag}】${label}${childHint}`;
  }
}

/**
 * 抽象层：分析段落语义并生成学术定性摘要
 */
function summarizeParagraph(text: string): string {
  const clean = text
    .replace(/<[^>]*>/g, '')
    .replace(/\$\$[\s\S]*?\$\$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (clean.length <= 60) {
    return `【正文段落】${clean}`;
  }

  // 提取首句作为核心论点
  const firstSentenceMatch = clean.match(/^([^。！？\n]+[。！？])/);
  const firstSentence = firstSentenceMatch ? firstSentenceMatch[1] : clean.slice(0, 60);

  return `【正文段落】${firstSentence}...`;
}

/**
 * 递归解析特定行区间内的语法块，生成具有完整层级与定性性质的 AST 节点
 */
function parseLinesToNodes(
  allLines: string[],
  startLineIdx: number,
  endLineIdx: number,
  parentId?: string
): AstDocumentNode[] {
  const nodes: AstDocumentNode[] = [];
  let i = startLineIdx;

  while (i < endLineIdx) {
    const line = allLines[i];
    const trimmed = line.trim();
    const currentLineNum = i + 1; // 1-based 全文行号

    // 1. 空行
    if (!trimmed) {
      i++;
      continue;
    }

    // 2. import 模块语句忽略
    if (trimmed.startsWith('import ') && (trimmed.includes(' from ') || trimmed.endsWith(';'))) {
      i++;
      continue;
    }

    // 3. 标题 (H1-H6)
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      let text = headingMatch[2].trim().replace(/<[^>]*>/g, '').trim();
      const id = `h${level}-${currentLineNum}`;
      nodes.push({
        id,
        type: 'heading',
        level,
        title: text,
        summary: `【大纲标题 H${level}】${text}`,
        preview: text,
        contentLength: trimmed.length,
        lineStart: currentLineNum,
        lineEnd: currentLineNum,
        parentRefId: parentId,
        children: [],
      });
      i++;
      continue;
    }

    // 4. 数学公式块 $$ ... $$
    if (trimmed.startsWith('$$')) {
      const formulaStartLine = currentLineNum;
      const formulaLines: string[] = [];

      // 单行 $$ formula $$
      const singleMatch = trimmed.match(/^\$\$(.+?)\$\$$/);
      if (singleMatch) {
        const latex = singleMatch[1].trim();
        const id = `math-${formulaStartLine}`;
        nodes.push({
          id,
          type: 'math_block',
          latex,
          summary: summarizeMathFormula(latex),
          preview: `$$ ${latex.slice(0, 90)} $$`,
          contentLength: trimmed.length,
          lineStart: formulaStartLine,
          lineEnd: formulaStartLine,
          parentRefId: parentId,
        });
        i++;
        continue;
      }

      // 多行 $$ ... $$
      const firstRest = trimmed.slice(2).trim();
      if (firstRest) formulaLines.push(firstRest);
      i++;
      while (i < endLineIdx) {
        const curTrim = allLines[i].trim();
        if (curTrim.endsWith('$$')) {
          const lastRest = curTrim.slice(0, -2).trim();
          if (lastRest) formulaLines.push(lastRest);
          break;
        } else {
          formulaLines.push(allLines[i]);
          i++;
        }
      }
      const formulaEndLine = i < endLineIdx ? i + 1 : endLineIdx;
      const id = `math-${formulaStartLine}`;
      const latex = formulaLines.join('\n').trim();

      nodes.push({
        id,
        type: 'math_block',
        latex,
        summary: summarizeMathFormula(latex),
        preview: `$$ ${latex.slice(0, 90)} $$`,
        contentLength: latex.length + 4,
        lineStart: formulaStartLine,
        lineEnd: formulaEndLine,
        parentRefId: parentId,
      });
      i++;
      continue;
    }

    // 5. 学术卡片标签 <Tag ...> ... </Tag>
    const openTagMatch = trimmed.match(/^<([A-Z][a-zA-Z0-9]*)([^>]*)>/);
    if (openTagMatch) {
      const tag = openTagMatch[1];
      const attrs = openTagMatch[2] || '';
      const cardStartLine = currentLineNum;
      const titleAttrMatch = attrs.match(/title\s*=\s*['"](.*?)['"]/);
      const title = titleAttrMatch ? titleAttrMatch[1] : tag;

      // 自闭合卡片 (如 <QRCodeVideo ... />)
      if (trimmed.endsWith('/>') || attrs.endsWith('/')) {
        const id = `card-${cardStartLine}-${tag.toLowerCase()}`;
        nodes.push({
          id,
          type: 'card',
          tag,
          title,
          summary: `【${tag} 自闭合模块】${title}`,
          preview: trimmed.slice(0, 100),
          contentLength: trimmed.length,
          lineStart: cardStartLine,
          lineEnd: cardStartLine,
          parentRefId: parentId,
          children: [],
        });
        i++;
        continue;
      }

      // 容器卡片：扫描匹配闭合标签 </Tag>，精准支持内部嵌套
      let depth = 1;
      let j = i + 1;
      const openPattern = new RegExp(`<${tag}[^>]*>`, 'g');
      const closePattern = new RegExp(`</${tag}>`, 'g');

      // 检查首行是否包含闭合
      const firstLineAfterTag = line.slice(openTagMatch.index! + openTagMatch[0].length);
      if (firstLineAfterTag.includes(`</${tag}>`)) {
        depth = 0;
        j = i;
      }

      while (j < endLineIdx && depth > 0) {
        const curLine = allLines[j];
        const openMatches = curLine.match(openPattern);
        const closeMatches = curLine.match(closePattern);
        if (openMatches) depth += openMatches.length;
        if (closeMatches) depth -= closeMatches.length;

        if (depth === 0) break;
        j++;
      }

      const cardEndLine = j < endLineIdx ? j + 1 : endLineIdx;
      const cardId = `card-${cardStartLine}-${tag.toLowerCase()}`;

      // 递归解析卡片内部子节点（起始于 cardStartLine + 1，结束于 cardEndLine - 1）
      const innerChildren =
        cardEndLine > cardStartLine + 1
          ? parseLinesToNodes(allLines, cardStartLine, cardEndLine - 1, cardId)
          : [];

      // 提取内部首个段落预览
      const firstP = innerChildren.find((c) => c.type === 'paragraph');
      const summary = summarizeCard(tag, title, firstP?.preview);

      nodes.push({
        id: cardId,
        type: 'card',
        tag,
        kind: tag.toLowerCase(),
        title,
        summary,
        preview: title || tag,
        contentLength: (cardEndLine - cardStartLine + 1) * 20,
        lineStart: cardStartLine,
        lineEnd: cardEndLine,
        parentRefId: parentId,
        children: innerChildren,
      });

      i = cardEndLine;
      continue;
    }

    // 6. 代码块 ``` ... ```
    if (trimmed.startsWith('```')) {
      const codeStartLine = currentLineNum;
      const lang = trimmed.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < endLineIdx && !allLines[i].trim().startsWith('```')) {
        codeLines.push(allLines[i]);
        i++;
      }
      const codeEndLine = i < endLineIdx ? i + 1 : endLineIdx;
      const id = `code-${codeStartLine}`;
      nodes.push({
        id,
        type: 'code_block',
        title: lang ? `代码块 (${lang})` : '代码块',
        summary: `【代码块】${lang || 'text'} (${codeLines.length} 行)`,
        preview: codeLines.slice(0, 3).join('\n'),
        contentLength: codeLines.join('\n').length,
        lineStart: codeStartLine,
        lineEnd: codeEndLine,
        parentRefId: parentId,
      });
      i++;
      continue;
    }

    // 7. 列表项 (- / * / 1.)
    if (/^(\s*[-*+]|\s*\d+\.)\s+/.test(trimmed)) {
      const listStartLine = currentLineNum;
      const listLines: string[] = [];
      while (i < endLineIdx) {
        const curTrim = allLines[i].trim();
        if (!curTrim || !/^(\s*[-*+]|\s*\d+\.)\s+/.test(curTrim)) break;
        listLines.push(allLines[i]);
        i++;
      }
      const listEndLine = i;
      const id = `list-${listStartLine}`;
      nodes.push({
        id,
        type: 'list',
        summary: `【列表清单】包含 ${listLines.length} 个条目`,
        preview: listLines.slice(0, 2).join('\n'),
        contentLength: listLines.join('\n').length,
        lineStart: listStartLine,
        lineEnd: listEndLine,
        parentRefId: parentId,
      });
      continue;
    }

    // 8. 表格块 (| ... |)
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      const tableStartLine = currentLineNum;
      const tableLines: string[] = [];
      while (i < endLineIdx) {
        const curTrim = allLines[i].trim();
        if (!curTrim || !curTrim.startsWith('|')) break;
        tableLines.push(allLines[i]);
        i++;
      }
      const tableEndLine = i;
      const id = `table-${tableStartLine}`;
      nodes.push({
        id,
        type: 'table',
        summary: `【数据表格】共 ${tableLines.length} 行`,
        preview: tableLines.slice(0, 2).join('\n'),
        contentLength: tableLines.join('\n').length,
        lineStart: tableStartLine,
        lineEnd: tableEndLine,
        parentRefId: parentId,
      });
      continue;
    }

    // 9. 引用块 (> ...)
    if (trimmed.startsWith('>')) {
      const quoteStartLine = currentLineNum;
      const quoteLines: string[] = [];
      while (i < endLineIdx) {
        const curTrim = allLines[i].trim();
        if (!curTrim || !curTrim.startsWith('>')) break;
        quoteLines.push(allLines[i]);
        i++;
      }
      const quoteEndLine = i;
      const id = `quote-${quoteStartLine}`;
      const quoteText = quoteLines.map((l) => l.replace(/^>\s*/, '')).join('\n');
      nodes.push({
        id,
        type: 'quote',
        summary: `【引用/提示】${quoteText.slice(0, 60)}`,
        preview: quoteText.slice(0, 100),
        contentLength: quoteText.length,
        lineStart: quoteStartLine,
        lineEnd: quoteEndLine,
        parentRefId: parentId,
      });
      continue;
    }

    // 10. 普通正文段落 (Paragraph) - 聚合连续文字行
    const pStartLine = currentLineNum;
    const pLines: string[] = [];
    while (i < endLineIdx) {
      const curTrim = allLines[i].trim();
      if (!curTrim) break;
      if (
        curTrim.match(/^(#{1,6})\s+/) ||
        curTrim.startsWith('$$') ||
        curTrim.match(/^<[A-Z][a-zA-Z0-9]*/) ||
        curTrim.startsWith('```') ||
        curTrim.startsWith('>') ||
        (curTrim.startsWith('|') && curTrim.endsWith('|')) ||
        /^(\s*[-*+]|\s*\d+\.)\s+/.test(curTrim)
      ) {
        break;
      }
      pLines.push(allLines[i]);
      i++;
    }

    const pText = pLines.join('\n').trim();
    if (pText) {
      const pEndLine = i;
      const id = `p-${pStartLine}`;
      nodes.push({
        id,
        type: 'paragraph',
        summary: summarizeParagraph(pText),
        preview: pText.slice(0, 120),
        contentLength: pText.length,
        lineStart: pStartLine,
        lineEnd: pEndLine,
        parentRefId: parentId,
      });
    }
  }

  return nodes;
}

/**
 * 组装 Heading 层级拓扑树 (Sections Hierarchy Tree)
 * 将扁平的各级标题与下属段落、公式、模块组织为真正的 AST 结构
 */
function assembleHeadingHierarchy(flatNodes: AstDocumentNode[]): AstDocumentNode[] {
  const rootTree: AstDocumentNode[] = [];
  const headingStack: AstDocumentNode[] = [];

  for (const node of flatNodes) {
    if (node.type === 'heading') {
      const level = node.level || 2;
      while (headingStack.length > 0 && (headingStack[headingStack.length - 1].level || 2) >= level) {
        headingStack.pop();
      }

      if (headingStack.length === 0) {
        rootTree.push(node);
      } else {
        const parentHeading = headingStack[headingStack.length - 1];
        node.parentRefId = parentHeading.id;
        parentHeading.children = parentHeading.children || [];
        parentHeading.children.push(node);
      }
      headingStack.push(node);
    } else {
      if (headingStack.length === 0) {
        rootTree.push(node);
      } else {
        const curHeading = headingStack[headingStack.length - 1];
        node.parentRefId = curHeading.id;
        curHeading.children = curHeading.children || [];
        curHeading.children.push(node);
      }
    }
  }

  return rootTree;
}

/**
 * 扁平化收集树中所有的节点
 */
export function flattenTree(tree: AstDocumentNode[]): AstDocumentNode[] {
  const result: AstDocumentNode[] = [];
  for (const node of tree) {
    result.push(node);
    if (node.children && node.children.length > 0) {
      result.push(...flattenTree(node.children));
    }
  }
  return result;
}

/**
 * 根据唯一 ID 在 AST 树中查找目标节点
 */
export function findNodeById(tree: AstDocumentNode[], nodeId: string): AstDocumentNode | null {
  for (const node of tree) {
    if (node.id === nodeId) return node;
    if (node.children && node.children.length > 0) {
      const found = findNodeById(node.children, nodeId);
      if (found) return found;
    }
  }
  return null;
}

/**
 * 将层次化 AST 树格式化为适合 Agent 阅读理解的缩进大纲文本
 */
export function formatAstTreeOutline(nodes: AstDocumentNode[], indent = '', maxDepth = 4): string {
  const lines: string[] = [];

  for (const node of nodes) {
    let lineStr = '';
    const rangeStr = `(id: "${node.id}", 行 ${node.lineStart}-${node.lineEnd})`;

    switch (node.type) {
      case 'heading':
        lineStr = `${indent}- [H${node.level}] ${node.title} ${rangeStr}`;
        break;
      case 'card':
        lineStr = `${indent}- [${node.tag || 'Card'}] ${node.title || ''} ${rangeStr}`;
        break;
      case 'math_block':
        lineStr = `${indent}- [公式] ${rangeStr}: $$ ${node.latex?.slice(0, 60).replace(/\s+/g, ' ')} $$`;
        break;
      case 'paragraph':
        lineStr = `${indent}- [段落] ${rangeStr}: ${node.preview?.slice(0, 60).replace(/\s+/g, ' ')}...`;
        break;
      default:
        lineStr = `${indent}- [${node.type}] ${rangeStr}: ${node.summary}`;
        break;
    }
    lines.push(lineStr);

    if (node.children && node.children.length > 0 && indent.length / 2 < maxDepth) {
      lines.push(formatAstTreeOutline(node.children, indent + '  ', maxDepth));
    }
  }

  return lines.join('\n');
}

/**
 * 提取标题大纲 (Headings) - 保持向后兼容
 */
export function extractHeadings(mdxContent: string): ChapterHeadingItem[] {
  const headings: ChapterHeadingItem[] = [];
  const lines = mdxContent.split(/\r?\n/);
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      const depth = match[1].length;
      let text = match[2].trim().replace(/<[^>]*>/g, '').trim();
      const id = slugifyHeading(text);
      headings.push({ depth, text, id });
    }
  }

  return headings;
}

/**
 * 提取学术卡片 (Academic Cards) - 保持向后兼容
 */
export function extractAcademicCards(mdxContent: string): AcademicCardNode[] {
  const cards: AcademicCardNode[] = [];
  const lines = mdxContent.split(/\r?\n/);
  const cardRegex = /<([A-Z][a-zA-Z0-9]*)([^>]*)>([\s\S]*?)<\/\1>/g;

  const lineOffsets: number[] = [0];
  for (let i = 0; i < lines.length; i++) {
    lineOffsets.push(lineOffsets[i] + lines[i].length + 1);
  }

  function getLineNumber(offset: number): number {
    let low = 0;
    let high = lineOffsets.length - 1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (lineOffsets[mid] <= offset) {
        if (mid === lineOffsets.length - 1 || lineOffsets[mid + 1] > offset) {
          return mid + 1;
        }
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return 1;
  }

  let match: RegExpExecArray | null;
  let order = 0;

  while ((match = cardRegex.exec(mdxContent)) !== null) {
    const tag = match[1];
    const attrs = match[2] || '';
    const innerContent = match[3] || '';
    const fullMatch = match[0];
    const startOffset = match.index;
    const endOffset = startOffset + fullMatch.length;

    const lineStart = getLineNumber(startOffset);
    const lineEnd = getLineNumber(endOffset);

    const titleMatch = attrs.match(/title\s*=\s*['"](.*?)['"]/);
    const title = titleMatch ? titleMatch[1] : undefined;

    let cardType: AcademicCardNode['type'] = 'card';
    const tagLower = tag.toLowerCase();
    if (tagLower.includes('theorem') || tagLower.includes('lemma') || tagLower.includes('corollary')) {
      cardType = 'theorem';
    } else if (tagLower.includes('definition')) {
      cardType = 'definition';
    } else if (tagLower.includes('example')) {
      cardType = 'example';
    } else if (tagLower.includes('solution') || tagLower.includes('proof')) {
      cardType = 'solution';
    } else if (tagLower.includes('remark') || tagLower.includes('note')) {
      cardType = 'remark';
    }

    order++;
    cards.push({
      id: `card-${order}-${lineStart}`,
      tag,
      type: cardType,
      title,
      content: innerContent.trim(),
      rawMdx: fullMatch,
      order,
      lineStart,
      lineEnd,
    });
  }

  return cards;
}

/**
 * 提取数学公式 (Math Formulas) - 保持向后兼容
 */
export function extractMathFormulas(mdxContent: string): MathFormulaNode[] {
  const formulas: MathFormulaNode[] = [];
  const lines = mdxContent.split(/\r?\n/);
  let idCounter = 0;

  let inBlockFormula = false;
  let blockFormulaBuffer: string[] = [];
  let blockStartLine = 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const currentLineNum = i + 1;

    if (line.trim().startsWith('$$')) {
      if (!inBlockFormula) {
        const singleLineMatch = line.trim().match(/^\$\$(.+?)\$\$$/);
        if (singleLineMatch) {
          idCounter++;
          formulas.push({
            id: `formula-block-${idCounter}`,
            latex: singleLineMatch[1].trim(),
            displayMode: 'block',
            line: currentLineNum,
          });
          continue;
        }

        inBlockFormula = true;
        blockStartLine = currentLineNum;
        const rest = line.trim().slice(2);
        blockFormulaBuffer = rest ? [rest] : [];
      } else {
        inBlockFormula = false;
        idCounter++;
        formulas.push({
          id: `formula-block-${idCounter}`,
          latex: blockFormulaBuffer.join('\n').trim(),
          displayMode: 'block',
          line: blockStartLine,
        });
        blockFormulaBuffer = [];
      }
      continue;
    }

    if (inBlockFormula) {
      blockFormulaBuffer.push(line);
      continue;
    }

    const inlineRegex = /(?<!\\)\$(?!\$)(.+?)(?<!\\)\$/g;
    let inlineMatch: RegExpExecArray | null;
    while ((inlineMatch = inlineRegex.exec(line)) !== null) {
      idCounter++;
      formulas.push({
        id: `formula-inline-${idCounter}`,
        latex: inlineMatch[1].trim(),
        displayMode: 'inline',
        line: currentLineNum,
      });
    }
  }

  return formulas;
}

/**
 * 提取段落节点列表 (Paragraphs) - 保持向后兼容
 */
export function extractParagraphs(mdxContent: string, cards: AcademicCardNode[]): ParagraphNode[] {
  const paragraphs: ParagraphNode[] = [];
  const lines = mdxContent.split(/\r?\n/);
  let currentBuffer: string[] = [];
  let pStart = 1;
  let pIndex = 0;

  function flush(endLine: number) {
    if (currentBuffer.length === 0) return;
    const text = currentBuffer.join('\n').trim();
    if (text) {
      pIndex++;
      const enclosingCard = cards.find((c) => pStart >= c.lineStart && endLine <= c.lineEnd);
      paragraphs.push({
        index: pIndex,
        text,
        lineStart: pStart,
        lineEnd: endLine,
        cardRefId: enclosingCard?.id,
      });
    }
    currentBuffer = [];
  }

  let inCode = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    if (line.trim().startsWith('```')) {
      inCode = !inCode;
    }

    if (!inCode && line.trim() === '') {
      flush(lineNum - 1);
      pStart = lineNum + 1;
    } else {
      if (currentBuffer.length === 0) pStart = lineNum;
      currentBuffer.push(line);
    }
  }
  flush(lines.length);

  return paragraphs;
}

/**
 * 主提取函数：综合提炼章节真实 AST 结构化响应数据
 */
export function extractChapterAst(params: {
  colSlug: string;
  bookSlug: string;
  chapterSlug: string;
  rawSlug: string;
  filePath: string;
  mdxContent: string;
  includeRawMdx?: boolean;
}): ChapterAstData {
  const { colSlug, bookSlug, chapterSlug, rawSlug, filePath, mdxContent, includeRawMdx } = params;
  const { frontmatter, frontmatterLines } = extractFrontmatter(mdxContent);

  const title = frontmatter.title || chapterSlug;
  const lines = mdxContent.split(/\r?\n/);

  // 1. 构建全新完整的层次化语法树 (True AST Tree)
  const flatNodes = parseLinesToNodes(lines, frontmatterLines, lines.length);
  const tree = assembleHeadingHierarchy(flatNodes);

  // 2. 提取传统扁平集合以保持完全向后兼容
  const headings = extractHeadings(mdxContent);
  const cards = extractAcademicCards(mdxContent);
  const formulas = extractMathFormulas(mdxContent);
  const paragraphs = extractParagraphs(mdxContent, cards);

  // 3. 计算字数与估算阅读时间
  const cleanText = mdxContent.replace(/<[^>]*>/g, '').replace(/\$\$[\s\S]*?\$\$/g, '').trim();
  const wordCount = cleanText.length;
  const readingTimeMinutes = Math.max(1, Math.round(wordCount / 350));
  const uri = `astrolib://${colSlug}/${bookSlug}/${chapterSlug}`;

  return {
    colSlug,
    bookSlug,
    chapterSlug,
    title,
    rawSlug,
    filePath,
    uri,
    tree,
    headings,
    cards,
    formulas,
    paragraphs,
    readingTimeMinutes,
    wordCount,
    rawMdx: includeRawMdx ? mdxContent : undefined,
  };
}
