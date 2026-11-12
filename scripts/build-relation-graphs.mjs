// scripts/build-relation-graphs.mjs
// 构建期：为所有图书生成“全书各章节内联关系与知识图谱数据”，输出到 public/relation-graphs/<col>-<book>.json
// （astro build 会把 public/ 原样拷到 dist/，供客户端零运行时开销懒加载）。
//
// 开关：src/config/features.config.mjs 里 features.relationGraph.enabled —— 关闭则跳过生成。
// 用法：
//   node scripts/build-relation-graphs.mjs                  # 生成全部图书
//   node scripts/build-relation-graphs.mjs --only engineering_analysis   # 只生成指定 slug

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { features } from '../src/config/features.config.mjs';
import { getCatalogCollections } from '../src/config/collections.config.ts';
import { generateBookRelationGraph } from '../src/features/relation-graph/core/generator.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'artifacts', 'relation-graphs');

const args = process.argv.slice(2);
const onlySlug = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const allowEmpty = args.includes('--allow-empty');

function main() {
  if (!features.relationGraph.enabled) {
    console.log('[relation-graph] 已跳过：章节关系图谱功能关闭（features.config.ts 中 relationGraph.enabled=false）。');
    return;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  let totalLinks = 0;
  let totalCrossRefs = 0;
  let bookCount = 0;

  for (const col of getCatalogCollections()) {
    for (const book of col.books || []) {
      if (onlySlug && book.slug !== onlySlug) continue;

      const graphData = generateBookRelationGraph(col.slug, book.slug);
      if (!graphData) continue;

      const outFile = path.join(OUT_DIR, `${col.slug}-${book.slug}.json`);
      fs.writeFileSync(outFile, JSON.stringify(graphData));

      totalLinks += graphData.links.length;
      totalCrossRefs += graphData.stats.totalCrossReferences;
      bookCount++;

      console.log(`  ✔ [${col.slug}/${book.slug}] ${book.title} → ${path.relative(ROOT, outFile)} (${graphData.nodes.length} 章 / ${graphData.stats.totalCrossReferences} 跨章引用 / ${graphData.links.length} 关联边)`);
    }
  }

  if (bookCount === 0 && !allowEmpty) {
    console.error('❌ [relation-graph] 未生成任何关系图谱（输入为空）。若确需空跑请传 --allow-empty。');
    process.exit(1);
  }

  console.log(`\n✅ 章节内联关系图谱数据构建完成：${bookCount} 本书、共 ${totalLinks} 条引用关联边、${totalCrossRefs} 次跨章引用 → ${path.relative(ROOT, OUT_DIR)}/`);
}

main();
