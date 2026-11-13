# 架构决策记录 (ADR-CONTENT-IR-2026-11-13)

**标题**：AstroLib 单一标题/锚点真源、转换管线收口与最小 ContentDocument IR 架构决策  
**编号**：ADR-P1-B0-2026-11-13  
**状态**：`PROPOSED (待审核后执行 B1)`  
**对应任务**：P1-B0（P1-B 阶段架构决策，不修改业务源码）  
**基准分支**：`electron/main` @ `d4e09245`（Tag `v0.0.4` @ `df68e42c` 保持不变）  
**约束规范**：`AGENTS.md` Rule 1 (UI not domain model), Rule 2 (Publishing independent), Rule 8 (Scripts boundary), Rule 10 (One boundary -> One migration -> One verification)

---

## 1. 决策背景与现状问题剖析 (Context & Problem Analysis)

在基准审计报告 [`PROJECT_ARCHITECTURE_AUDIT_2026-11-12.md`](./PROJECT_ARCHITECTURE_AUDIT_2026-11-12.md) §4（P0-08）与 §5（P1-10）中，指出了 AstroLib 内容转换系统存在严重的管线割裂与锚点漂移：

1. **五套独立解析转换通道并存**：
   - `scripts/pack-book-abp.mjs`（990 行，Regex 占位符 + `marked` 渲染）；
   - `scripts/epub/mdx-pipeline.mjs`（373 行，独立标题/图片/slug 规则）；
   - `src/publishing/common/mdx-chapter-parser.ts`（753 行，独立发布解析器）；
   - `src/server/plugins/doc-ingestion/ast-compiler.ts`（590 行，MinerU 摄取 AST 编译器）；
   - Astro 自身的 Starlight / MDX Unified 处理管线。
2. **标题与锚点算法重复拷贝与严重分叉**：
   - `pack-book-abp.mjs:155`（`extractHeadings`）与 `pack-book-abp.mjs:427`（`renderer.heading`）存在同一段正则的硬编码拷贝：`plainText.toLowerCase().replace(/[^\w\u4e00-\u9fa5-]+/g, '-')`；
   - `extractHeadings` 解析的是原始 Markdown 的 `#` 文本行，无法识别卡片内标题、公式包裹标题与 HTML 原生标题；而 `renderer.heading` 则是在占位符保护后为它们生成了 `<h[1-4] id="...">` 标签；
   - 实测 1,251 章中：`headings` 数组非空仅 **465** 章，而 HTML 中包含 `<h1-4 id="...">` 的有 **983** 章；`headings` 与 HTML 标题完全对齐仅 463 章，出现 6 章锚点缺失与 91 章两者皆空；
3. **缺乏重复锚点碰撞解决机制**：
   - 现有算法未处理同一章内标题重名碰撞（无 `-1/-2` 后缀），导致 10 章存在重复 `id`（合计 18 个重复锚点，如 `science-vectors_and_tensors/011_definitions-basic`）。

---

## 2. 核心架构决策 (Decisions)

### 2.1 决策 1：唯一真源——以编译后 HTML 反推 Headings 列表 (HTML-First Heading Derivation)

**决策结论**：**以编译后的最终 HTML 产物为唯一真源，反推 `headings` 列表。**

**判定理由**：
1. **运行态绝对安全**：在 ABP 1.0.0 规范中，`payload.html` 是桌面端与 Universal Reader 的最终渲染契约。从最终 HTML 中提取 `<h1-4 id="...">`，可以从数学上 100% 保证：
   $$\text{headings}[].id \subseteq \text{HTML Element IDs}$$
2. **避免双轨解析器分叉**：若试图在 AST 阶段同步计算，必须同时修改 Markdown 预处理器、占位符管理器、MDX JSX 卡片展开器与 `marked` 渲染器，改动面大且极易产生隐蔽分歧；
3. **零运行开销**：反推过程在编译器端（`pack-book-abp.mjs`）静态完成，直接序列化进 `chapters/<slug>.json` 的 `headings` 字段中，客户端运行时完全零正则负担。

### 2.2 决策 2：算法冻结——保留现有 Slug 算法，不切换至 cleanSlug (Algorithm Freeze)

**决策结论**：**保留现有标题 Slug 算法（小写 + 非字母数字汉字转连字符 + 去首尾连字符），绝不切换为 `cleanSlug`。**

**判定理由**：
1. **保护存量资产与深链引用**：全网及本地 983 章已有对外可用的深链锚点（含卡片锚点 1,164 章），以及关联图谱、跨页引用和笔记锚点。若强行换为 `cleanSlug`，会导致全量深链失效；
2. **职责正交隔离**：`cleanSlug`（来自 `src/utils/slug.ts`）严格专用于**章节文件路径与 URL 路由 slug**（P1-A 已锁定）；而**标题锚点 slug**（Heading ID）属于页面内局部锚点定位，两者命名空间天然独立。

### 2.3 决策 3：碰撞规则——同章重复 ID 增加 -1 / -2 后缀且同步改写 HTML (Deduplication Contract)

**决策结论**：**同一章节内出现相同 Heading ID 时，按出现顺序依次追加 `-1`、`-2` 后缀（对齐 GitHub / markdown-it 语义），并同步改写 HTML 中的对应 `id` 属性。**

**契约保证**：
1. `dedupeHeadingIds` 负责维护单章计数器；
2. 配套提供 `rewriteHeadingIdsInHtml(html, renames)`，确保 HTML 标签内的 `id` 与 `headings` 数组内的 `id` 保持完全一致，永不产生悬空指针。

### 2.4 决策 4：最小 ContentDocument IR 定位 (Minimal Intermediate Representation)

在 P1-B 阶段，定义最小化中间表示（Minimal Content Document IR）：

```typescript
export interface MinimalContentDocument {
  /** 规范化章节标识符 (Canonical Slug) */
  slug: string;
  /** 源码物理路径 */
  sourcePath: string;
  /** 章节显示标题 */
  title: string;
  /** 章节预编译 HTML (唯一渲染实体) */
  html: string;
  /** 结构化标题大纲 (由 html 反推并去重) */
  headings: ChapterHeadingItem[];
}
```

**明确边界**：
- P1-B 阶段**不修改** ABP Schema 1.0.0（`src/types/content-package.ts` 零改动）；
- 章节 JSON 结构与字段类型完全保持向后兼容；
- 不引入重型 AST 节点树，HTML 依然是当前阶段唯一的运行时契约。

---

## 3. 转换管线迁移与收敛路线 (Pipeline Consolidation & Legacy Roadmap)

| 转换模块 | 当前定位 | 生产路径归属 | P1-B 处置与未来退出条件 |
| :--- | :--- | :--- | :--- |
| `src/core/content/headings.ts` | **新建唯一标题与锚点共享模块** | **生产主干 (Active)** | 承载 `slugifyHeading`、`collectHeadingsFromHtml` 与 `rewriteHeadingIdsInHtml` |
| `scripts/pack-book-abp.mjs` | 官方 ABP 内容包编译器 | **生产主干 (Active)** | 移除内联拷贝，全面消费共享模块，以 HTML 产物反推 headings |
| `scripts/epub/mdx-pipeline.mjs` | EPUB3 电子书打包流水线 | **辅助发布 (Active)** | 改为消费共享模块；建立与 ABP 标题层级同构的对照契约测试 |
| `src/publishing/common/mdx-chapter-parser.ts` | 历史独立发布解析器 | **非生产/历史残留 (Legacy)** | 文件头标记 `LEGACY-PENDING-IR`；P1-E 治理阶段统一解绑并由 unified 编译器替代 |
| `src/server/plugins/doc-ingestion/ast-compiler.ts` | MinerU 摄取端 AST 编译器 | **摄取实验管线 (Legacy)** | 文件头标记 `LEGACY-PENDING-IR`；作为实验特性隔离，不进入阅读生产主路径 |

---

## 4. 门禁规范、受影响文件与红线 (Gate Specification & Guardrails)

### 4.1 允许修改与新增文件清单 (Allowed Files)

```text
src/core/content/headings.ts                    (新增，唯一实现，严禁放在 src/content/)
scripts/pack-book-abp.mjs                       (消费共享模块，移除内联拷贝)
scripts/epub/mdx-pipeline.mjs                   (B2 消费共享模块)
tests/unit/heading-contract.test.ts             (新增，守护 1,251 章标题契约)
tests/contract/epub-heading-parity.test.ts      (B2 新增)
src/publishing/common/mdx-chapter-parser.ts     (仅加 LEGACY-PENDING-IR 标记)
src/server/plugins/doc-ingestion/ast-compiler.ts (仅加 LEGACY-PENDING-IR 标记)
docs/architecture/ADR-CONTENT-IR-2026-11-13.md  (本决策文档)
docs/architecture/evidence/p1-b-evidence.json   (证据产物)
```

### 4.2 严格禁止修改清单 (Forbidden Files)

- `content-sources/collections/**/*`（13 本书正文源码绝对禁止改动）；
- `src/types/content-package.ts`（ABP Schema 1.0.0 核心契约绝对禁止改动）；
- `package.json`（禁止引入新依赖，复用既有依赖）；
- `electron/server/static-handler.ts` 与 `src/pages/reader.astro`（P1-A 冻结资产）；
- Release v0.0.4 的 18 项发布资产、`latest.yml`、`catalog.json`。

### 4.3 重打包授权与基线留证 (Repack Authorization)

- 本 Wave **唯一授权一次**重打包命令：`node scripts/pack-book-abp.mjs --all`；
- 执行前必须捕获 13 本书基线状态（非空章数 465、重复 ID 章数 10、各书 contentHash）；
- 重打包后必须验证：`headings` 覆盖率提升至 ≥ 983 章，重复 ID 章数降为 0，`headings[].id ⊆ html ids` 达到 100%；
- 重新生成的 `artifacts/abp-packs/` 仅为本地 gitignored 验证产物，不得提交入库，不影响线上 Release。

### 4.4 验收命令 (Verification Commands)

```powershell
npm run check:types
npx vitest run tests/unit/heading-contract.test.ts tests/contract/epub-heading-parity.test.ts
npm test
npm run build
```

---

## 5. 回滚策略 (Rollback Plan)

若 B1~B3 出现未预期的构建失败或回归：
1. `git revert` 对应原子提交；
2. 共享模块纯属新增，不改变既有数据存储结构；
3. 本地 `artifacts/abp-packs/` 可直接通过回滚前的脚本重新编译复原。
