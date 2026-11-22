#!/usr/bin/env node

import readline from 'node:readline';
import { ContentApiService } from '../src/core/content-api/content-api-service.ts';
import * as diff from 'diff';

const service = ContentApiService.getInstance();

const TOOLS = [
  {
    name: 'locate_content',
    description: '【统一内容定位协议求解器】根据任意书名、学科、章节模糊名、序号或 URI 唯一反向定位教材与章节。返回规范 ContentLocator 与 canonical URI (如 astrolib://math/math_analysis/21_数列极限的基本概念)。',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '检索词，如 "06_第1章-三角函数", "数学分析 2.1", "极限", "线性代数"',
        },
      },
      required: ['query'],
    },
    run: async (args) => {
      return service.locateContent(args.query);
    },
  },
  {
    name: 'get_books_catalog',
    description: '获取 AstroLib 题库与教材的全部合集与图书目录列表（包含图书唯一标识 slug、学科分类、章节入口等）。',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    run: async () => {
      return service.listBooks();
    },
  },
  {
    name: 'get_book_toc',
    description: '获取指定图书的完整结构化大纲树 (TOC)，包含所有卷、章、节节点与对应 slug 及 canonical URI。',
    inputSchema: {
      type: 'object',
      properties: {
        colSlug: { type: 'string', description: '学科合集 slug，例如 "math", "science", "telecom", "cs"' },
        bookSlug: { type: 'string', description: '图书 slug，例如 "linear_algebra_geometry", "math_analysis"' },
        query: { type: 'string', description: '可选，图书名称关键词（如未提供 col/book 可自动定位）' },
      },
    },
    run: async (args) => {
      let col = args.colSlug;
      let book = args.bookSlug;
      if (!col || !book) {
        const loc = service.locateContent(args.query || '');
        col = col || loc.colSlug;
        book = book || loc.bookSlug;
      }
      return service.getBookToc(col, book);
    },
  },
  {
    name: 'get_chapter_ast',
    description: '提取指定章节的精细结构化 AST 树，包含大纲、学术卡片、全部数学公式、字数与段落切片。支持跨书自动反向定位。',
    inputSchema: {
      type: 'object',
      properties: {
        colSlug: { type: 'string', description: '学科合集 slug' },
        bookSlug: { type: 'string', description: '图书 slug' },
        chapterSlug: { type: 'string', description: '章节 slug' },
        locator: { type: 'string', description: '规范内容定位 URI（例如 "astrolib://math/math_analysis/21_数列极限"）' },
      },
    },
    run: async (args) => {
      let col = args.colSlug;
      let book = args.bookSlug;
      let slug = args.chapterSlug;
      if (args.locator || !col || !book || !slug) {
        const loc = service.locateContent(args.locator || slug || '');
        col = col || loc.colSlug;
        book = book || loc.bookSlug;
        slug = slug || loc.chapterSlug;
      }
      return service.getChapterAst(col, book, slug);
    },
  },
  {
    name: 'read_content_node',
    description: '根据 AST 树节点唯一 ID (如 card-28-example, p-18, math-20) 直接读取段落/公式/模块的完整 MDX 原文。',
    inputSchema: {
      type: 'object',
      properties: {
        colSlug: { type: 'string', description: '学科合集 slug' },
        bookSlug: { type: 'string', description: '图书 slug' },
        chapterSlug: { type: 'string', description: '章节 slug' },
        nodeId: { type: 'string', description: '目标 AST 节点 ID，例如 "card-28-example" 或 "p-18"' },
        locator: { type: 'string', description: '可选，目标章节 URI 或包含 #nodeId 的完整标识' },
      },
      required: ['nodeId'],
    },
    run: async (args) => {
      let col = args.colSlug;
      let book = args.bookSlug;
      let slug = args.chapterSlug;
      let nodeId = args.nodeId;

      if (args.locator && args.locator.includes('#')) {
        const parts = args.locator.split('#');
        const loc = service.locateContent(parts[0]);
        col = loc.colSlug;
        book = loc.bookSlug;
        slug = loc.chapterSlug;
        nodeId = parts[1];
      } else if (!col || !book || !slug) {
        const loc = service.locateContent(args.locator || '');
        col = col || loc.colSlug;
        book = book || loc.bookSlug;
        slug = slug || loc.chapterSlug;
      }

      return service.readChapterNode(col, book, slug, nodeId);
    },
  },
  {
    name: 'search_exercises',
    description: '在题库中根据关键词进行模糊搜索，返回匹配的习题题目、选项及官方题解。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '检索词，如 "行列式计算", "拉格朗日中值定理"' },
        limit: { type: 'number', description: '返回结果数量上限，默认 5' },
      },
      required: ['query'],
    },
    run: async (args) => {
      return service.searchExercises(args.query, args.limit || 5);
    },
  },
  {
    name: 'diff_chapters',
    description: '计算两个章节源码之间的 Unified Diff 比对补丁与变更加删统计。',
    inputSchema: {
      type: 'object',
      properties: {
        colSlug1: { type: 'string' },
        bookSlug1: { type: 'string' },
        slug1: { type: 'string' },
        colSlug2: { type: 'string' },
        bookSlug2: { type: 'string' },
        slug2: { type: 'string' },
      },
      required: ['colSlug1', 'bookSlug1', 'slug1', 'colSlug2', 'bookSlug2', 'slug2'],
    },
    run: async (args) => {
      const ast1 = service.getChapterAst(args.colSlug1, args.bookSlug1, args.slug1, { includeRawMdx: true });
      const ast2 = service.getChapterAst(args.colSlug2, args.bookSlug2, args.slug2, { includeRawMdx: true });
      const patch = diff.createTwoFilesPatch(
        `${args.bookSlug1}/${args.slug1}.mdx`,
        `${args.bookSlug2}/${args.slug2}.mdx`,
        ast1.rawMdx || '',
        ast2.rawMdx || ''
      );
      return { patch };
    },
  },
];

function sendJsonRpc(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

async function handleMessage(msg) {
  const { id, method, params } = msg || {};

  if (method === 'initialize') {
    return sendJsonRpc({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: 'astrolib-mcp',
          version: '1.0.0',
        },
      },
    });
  }

  if (method === 'notifications/initialized') {

    return;
  }

  if (method === 'ping') {
    return sendJsonRpc({ jsonrpc: '2.0', id, result: {} });
  }

  if (method === 'tools/list') {
    const list = TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
    return sendJsonRpc({
      jsonrpc: '2.0',
      id,
      result: { tools: list },
    });
  }

  if (method === 'tools/call') {
    const { name, arguments: args = {} } = params || {};
    const t = TOOLS.find((x) => x.name === name);
    if (!t) {
      return sendJsonRpc({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Tool not found: ${name}` },
      });
    }

    try {
      const res = await t.run(args);
      const text = typeof res === 'string' ? res : JSON.stringify(res, null, 2);
      return sendJsonRpc({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text }],
        },
      });
    } catch (err) {
      return sendJsonRpc({
        jsonrpc: '2.0',
        id,
        error: { code: -32000, message: err?.message || String(err) },
      });
    }
  }

  if (id !== undefined && id !== null) {
    return sendJsonRpc({
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    });
  }
}

const rl = readline.createInterface({
  input: process.stdin,
});

let pendingCount = 0;
let isClosed = false;

rl.on('line', async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  pendingCount++;
  try {
    const msg = JSON.parse(trimmed);
    await handleMessage(msg);
  } catch (err) {
    console.error('[astrolib-mcp] Parse error:', err);
  } finally {
    pendingCount--;
    if (isClosed && pendingCount === 0) {
      process.exit(0);
    }
  }
});

rl.on('close', () => {
  isClosed = true;
  if (pendingCount === 0) {
    process.exit(0);
  }
});
