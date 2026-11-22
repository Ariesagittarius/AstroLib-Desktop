#!/usr/bin/env node
/**
 * bin/astrolib-cli.mjs
 * ============================================================================
 * AstroLib 统一内部数据与管线命令行工具 (Unified Content CLI Runner)
 * ============================================================================
 * 职责：
 * 1. 为外部脚本 (Python, Bash, Node.js) 和 CI 自动化测试提供零延迟 CLI 调度；
 * 2. 覆盖图书大纲 (TOC)、章节 AST 树、学术卡片、数学公式、习题集与 MinerU 提取；
 * 3. 支持 --json 格式化输出与管道传递。
 * ============================================================================
 * 用法示例：
 *   node bin/astrolib-cli.mjs books
 *   node bin/astrolib-cli.mjs toc math linear_algebra_geometry
 *   node bin/astrolib-cli.mjs chapter math linear_algebra_geometry 01_ch01 --format=ast
 *   node bin/astrolib-cli.mjs chapter math linear_algebra_geometry 01_ch01 --format=cards
 *   node bin/astrolib-cli.mjs chapter math linear_algebra_geometry 01_ch01 --format=formulas
 *   node bin/astrolib-cli.mjs exercises math linear_algebra_geometry 01_ch01
 *   node bin/astrolib-cli.mjs search-exercises "行列式" --limit=5
 *   node bin/astrolib-cli.mjs mineru
 *   node bin/astrolib-cli.mjs mineru --hash=71c8de5e --layout
 * ============================================================================
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h' || command === 'help') {
    printHelp();
    process.exit(0);
  }

  // 动态导入 ContentApiService
  const { ContentApiService } = await import('../src/core/content-api/content-api-service.ts');
  const service = ContentApiService.getInstance();

  try {
    switch (command) {
      case 'books': {
        const books = service.listBooks();
        outputJson({ success: true, count: books.length, data: books });
        break;
      }

      case 'toc': {
        const col = args[1];
        const book = args[2];
        if (!col || !book) {
          throw new Error('用法: astrolib-cli toc <colSlug> <bookSlug>');
        }
        const toc = service.getBookToc(col, book);
        outputJson({ success: true, data: toc });
        break;
      }

      case 'chapter': {
        const col = args[1];
        const book = args[2];
        const slug = args[3];
        if (!col || !book || !slug) {
          throw new Error('用法: astrolib-cli chapter <colSlug> <bookSlug> <chapterSlug> [--format=ast|cards|formulas|paragraphs|raw]');
        }

        const formatArg = args.find((a) => a.startsWith('--format='));
        const format = formatArg ? formatArg.split('=')[1] : 'ast';
        const includeRaw = format === 'raw' || args.includes('--raw');

        const ast = service.getChapterAst(col, book, slug, { includeRawMdx: includeRaw });

        if (format === 'cards') {
          outputJson({ success: true, count: ast.cards.length, data: ast.cards });
        } else if (format === 'formulas') {
          outputJson({ success: true, count: ast.formulas.length, data: ast.formulas });
        } else if (format === 'paragraphs') {
          outputJson({ success: true, count: ast.paragraphs.length, data: ast.paragraphs });
        } else if (format === 'raw') {
          process.stdout.write(ast.rawMdx || '');
        } else {
          outputJson({ success: true, data: ast });
        }
        break;
      }

      case 'exercises': {
        const col = args[1];
        const book = args[2];
        const slug = args[3];
        if (!col || !book || !slug) {
          throw new Error('用法: astrolib-cli exercises <colSlug> <bookSlug> <chapterSlug>');
        }
        const exercises = service.getChapterExercises(col, book, slug);
        outputJson({ success: true, count: exercises.length, data: exercises });
        break;
      }

      case 'search-exercises': {
        const query = args[1];
        if (!query) {
          throw new Error('用法: astrolib-cli search-exercises <query> [--limit=N]');
        }
        const limitArg = args.find((a) => a.startsWith('--limit='));
        const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : 20;
        const results = service.searchExercises(query, limit);
        outputJson({ success: true, count: results.length, data: results });
        break;
      }

      case 'mineru': {
        const hashArg = args.find((a) => a.startsWith('--hash='));
        const isLayout = args.includes('--layout');

        if (!hashArg) {
          const tasks = service.listMineruTasks();
          outputJson({ success: true, count: tasks.length, data: tasks });
        } else {
          const hash = hashArg.split('=')[1];
          if (isLayout) {
            const limitArg = args.find((a) => a.startsWith('--limit='));
            const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : 50;
            const layout = service.getMineruLayout(hash, limit);
            outputJson(layout);
          } else {
            const task = service.getMineruTask(hash);
            if (!task) throw new Error(`未找到 MinerU 任务: ${hash}`);
            outputJson({ success: true, data: task });
          }
        }
        break;
      }

      case 'pack': {
        const col = args[1];
        const book = args[2];
        if (!col || !book) {
          throw new Error('用法: astrolib-cli pack <colSlug> <bookSlug>');
        }
        console.error(`[astrolib-cli] 开始编译打包 ABP: ${col}/${book} ...`);
        const packRes = await service.packBookAbp(col, book);
        outputJson(packRes);
        break;
      }

      case 'locate': {
        const query = args.slice(1).join(' ').trim();
        if (!query) {
          throw new Error('用法: astrolib-cli locate <query/URI>');
        }
        const locator = service.locateContent(query);
        outputJson({ success: true, data: locator });
        break;
      }

      case 'read': {
        const rawArg = args.slice(1).join(' ').trim();
        if (!rawArg) {
          throw new Error('用法: astrolib-cli read <col> <book> <slug> <nodeId> 或 astrolib-cli read "<URI>#<nodeId>"');
        }

        let col = args[1];
        let book = args[2];
        let slug = args[3];
        let nodeId = args[4];

        if (rawArg.includes('#') || args.length <= 3) {
          let uriPart = rawArg;
          let nodePart = '';
          if (rawArg.includes('#')) {
            const split = rawArg.split('#');
            uriPart = split[0];
            nodePart = split[1];
          } else {
            const parts = rawArg.split(/\s+/);
            nodePart = parts.pop() || '';
            uriPart = parts.join(' ');
          }

          const loc = service.locateContent(uriPart);
          col = loc.colSlug;
          book = loc.bookSlug;
          slug = loc.chapterSlug || '';
          nodeId = nodePart;
        }

        if (!col || !book || !slug || !nodeId) {
          throw new Error('用法: astrolib-cli read <colSlug> <bookSlug> <chapterSlug> <nodeId>');
        }

        const nodeRes = service.readChapterNode(col, book, slug, nodeId);
        outputJson({ success: true, data: nodeRes });
        break;
      }

      default:
        console.error(`未知命令: ${command}`);
        printHelp();
        process.exit(1);
    }
  } catch (err) {
    outputJson({
      success: false,
      error: err?.message || String(err),
      timestamp: Date.now(),
    });
    process.exit(1);
  }
}

function outputJson(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
}

function printHelp() {
  console.log(`
AstroLib Unified Content CLI Runner

可用命令:
  books                                              列出所有合集与图书目录
  toc <colSlug> <bookSlug>                           获取指定图书的完整大纲树 (TOC)
  chapter <col> <book> <slug> [--format=ast|cards]   获取指定章节的 AST 结构、卡片或公式
  exercises <col> <book> <slug>                      获取指定章节关联的习题与题解
  search-exercises <query> [--limit=N]               全局模糊搜索习题
  mineru [--hash=ID] [--layout]                      查看 MinerU 产物元数据或布局切片
  pack <colSlug> <bookSlug>                          触发编译目标图书的 ABP 标准内容包
  locate <query/URI>                                 统一内容定位协议求解 (AURP)
  read <col> <book> <slug> <nodeId>                  根据 AST 节点 ID 精准读取段落/公式/模块原文

选项:
  --help, -h                                         显示此帮助信息
  --format=ast|cards|formulas|paragraphs|raw         指定章节输出粒度
`);
}

main();
