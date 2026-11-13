# P1-B / P1-C 执行指导（Handoff for Executor Agent）

**签发日期**：2026-11-13
**基线**：`electron/main` @ `d4e09245`（P1-A 已闭环；Tag `v0.0.4` @ `df68e42c` 不变）
**依据**：[`PROJECT_ARCHITECTURE_AUDIT_2026-11-12.md`](./PROJECT_ARCHITECTURE_AUDIT_2026-11-12.md) §4（P0-08）、§5（P1-10）、`P0_FINAL_AUDIT §6.4`（P1-B / P1-C）、[`P1_A3_A4_AUDIT_2026-11-13.md`](./P1_A3_A4_AUDIT_2026-11-13.md) §2 F2
**效力**：本文件是执行指令。与旧文档冲突时，以「`P0_FINAL §6.3` 硬约束 + 本文件」为准。

---

## 0. 三句话纪律

1. **两个 Wave 都先写 ADR，再改代码。** ADR 未过审不得进入实现；禁止把 B 或 C 做成 Big Bang（`AGENTS.md` Rule 10）。
2. **B 只动“内容如何被编译成 HTML/标题/锚点”，C 只动“书如何被安装/校验/落盘”。** 两者不得互相侵入，也不得顺带重构阅读器（P1-A 刚冻结）。
3. **不新增三方依赖**（`package.json` 不改）。`github-slugger` / `marked` / `unified` 目前是**传递依赖**，B1 只允许复用既有实现，不允许 `import` 新的传递依赖。

---

## 1. 开工前必须核对的事实（我已实测，直接引用，不要重复推断）

### 1.1 内容管线（B 的对象）

| 事实 | 证据 |
|---|---|
| 五套 MDX/Markdown → HTML 通道并存 | `scripts/pack-book-abp.mjs`（990 行，regex + `marked`）、`scripts/epub/mdx-pipeline.mjs`（373）、`src/publishing/common/mdx-chapter-parser.ts`（753）、`src/server/plugins/doc-ingestion/ast-compiler.ts`（590）、Astro 自身 unified 管线 |
| **标题锚点算法被复制了两份** | `pack-book-abp.mjs:155`（`extractHeadings`）与 `pack-book-abp.mjs:427`（`marked` 的 `renderer.heading`），两处是**同一段正则的拷贝**：`plainText.toLowerCase().replace(/[^\w\u4e00-\u9fa5-]+/g,'-')` |
| 标题列表与正文 HTML 不同源 | `extractHeadings` 解析**原始 Markdown 的 `#` 行**；`renderer.heading` 解析**占位符保护后的 marked token**，因此卡片内标题、公式标题、HTML 标题会分叉 |
| 覆盖率现状（1,251 章） | `headings` 非空 **465** 章；HTML 的 `<h1-4>` 带 `id` 锚点 **983** 章（另有 1,164 章至少含一个 `id`，但多数是卡片 `.toc-chunk` 锚点）；`headings` 与 HTML 标题锚点**完全对齐 463 章**；至少 1 个 heading id 在 HTML 中缺失 **6 章**（其中 2 章完全无匹配）；两者皆无 **91** 章 |
| 覆盖率为何只有 465 | `extractHeadings` 只识别 Markdown 的 `#` 行；卡片内标题、HTML 内联标题、公式包裹标题都不产生 heading，但 `renderer.heading` 却为它们生成了 HTML 锚点 |
| 重复锚点缺陷 | **10 章**存在重复 `id`（合计 18 个重复），因无 `-1/-2` 碰撞后缀；如 `science-vectors_and_tensors/011_definitions-basic` |
| 无 IR 类型 | `grep` 全仓无 `ContentDocument` / `ContentBlock` 等中间表示；HTML 是唯一真实产物 |
| 声称“unified 管线”的 EPUB 脚本 | `scripts/epub/mdx-pipeline.mjs` 自带一套标题/图片/slug 规则，与 ABP 输出无对照测试 |
| 依赖现实 | `unified` / `remark-mdx` / `rehype-stringify` / `marked` / `github-slugger` 均**未**在 `package.json` 声明；`src/utils/slug.ts:1` 已在直接 import `github-slugger`（既有风险，本轮不动） |

### 1.2 书库/安装（C 的对象）

| 环境 / 入口 | 落盘位置 | 校验 | 原子性 | 现状判定 |
|---|---|---|---|---|
| Electron 桌面安装 | `userData/abp-packs/<col>-<book>`（`DesktopBookManager`，`electron/services/book-manager.ts:106-261`） | `validateAbpBundle` ✓ | **staging → backup → rename → 失败回滚** ✓（`writeFileAtomic` `:44-55`） | 已达 P1-C 目标，**不要重写** |
| Web 安装 | IndexedDB（`web-provider.ts:249-287`） | `validateAbpBundle` ✓ | ✗ 先写 manifest（`:269`）再逐章写入（`:274-282`），中途失败留下**半本书**且已出现在书库列表 | 需修（C2） |
| 开发态 HTTP 上传 | `.tmp/dev-abp-packs/<col>-<book>`（`dev-server-plugin.mjs:236-272`） | ✗ **只检查 `manifest.colSlug/slug`**，未调用 `validateAbpBundle`（无 schemaVersion、无章节一致性） | ✗ 原地覆盖写，无 staging；重装**不清除旧章节**（降级残留） | 需修（C1/C2/C3） |
| 开发态书库 registry | `.tmp/library-registry.json`（`dev-server-plugin.mjs:73`） | — | — | 与桌面 `userData/library-registry.json`（`library-manager.ts:62`）是两套环境适配器，**不要强行合并** |
| Electron provider 回退 | `electron-provider.ts:60-79` 已无 Web 回退，bridge 缺失直接抛错 | — | — | 已达 P1-C 目标，保持 |

**结论**：C 的真实缺口集中在 **Web 安装的半状态** 与 **开发态上传的校验/原子性/清理**，桌面安装已达标。禁止为了“统一”而重写 `book-manager.ts`。

---

## 2. P1-B：单一标题/锚点源与转换管线收口

### 2.0 B0 — 决策文档（先做，不改代码）

**交付物**：`docs/architecture/ADR-CONTENT-IR-2026-11-13.md`（新建）

必须回答：

1. **唯一真源**：标题 id 与标题列表以**编译后的 HTML** 为唯一真源（从产物反推 `headings`），还是以 Markdown AST 为真源（HTML 渲染器复用同一结果）？——**必须选前者**（反推 HTML），理由：ABP 的 `html` 已是运行态契约，反推可保证 `headings[].id ⊆ html ids` 恒成立；后者需重写 `marked` 渲染路径，风险更高。
2. **算法冻结**：保留现有 id 算法（`lower + 非字母数字中文转 '-' + 去首尾 '-'`），**不切换到 `cleanSlug`**。理由：983 章已有对外可用的深链锚点（含卡片锚点 1,164 章），切换会全量失效。
3. **碰撞规则**：同一章内重复 id 追加 `-1`、`-2`（`github-slugger` 同款语义），并明确这是**唯一允许的 id 变化**。
4. **IR 定位**：引入 `ContentDocument` 的最小形态（仅 `headings` + `slug` + `sourcePath` + `html` 引用），明确 B 阶段**不**改变 ABP schema、不改变 `payload.html` 结构。
5. **迁移顺序与删除条件**：共享模块 → ABP packer → EPUB → publishing/doc-ingestion 标记 legacy。
6. **受影响文件、禁止文件、回滚方案、验收命令、对 v0.0.4 的影响（预期：无；不触发发版）**。

### 2.1 B1 — 抽出唯一标题模块（收益最大、风险最小）

**允许文件**：
```text
src/core/content/headings.ts              (新增，唯一实现；不要放进 src/content/，那是 Astro 内容目录)
scripts/pack-book-abp.mjs                 (改为消费该模块)
tests/unit/heading-contract.test.ts       (新增)
```

**实现要求**：

1. 新增 `src/core/content/headings.ts`，导出且仅导出：
   - `slugifyHeading(plainText: string): string` — 逐字符复刻现有算法（**行为保持**）；
   - `collectHeadingsFromHtml(html: string): ChapterHeadingItem[]` — 用 `<h([1-4])[^>]*\sid="([^"]+)"[^>]*>(...)</h\1>` 提取，`text` 取 `<span>` 内文本（剥离 `anchor-link` 与标签），`depth` 转数字；
   - `dedupeHeadingIds(headings): ChapterHeadingItem[]` — 重复 id 追加 `-1/-2`，并**同步改写 HTML 中对应的 `id`**（否则标题列表与 HTML 再次分叉，必须提供 `rewriteHeadingIdsInHtml(html, renames)` 配套函数）。
2. `scripts/pack-book-abp.mjs`：
   - 删除 `extractHeadings`（L145-160）与 `renderer.heading` 内的内联 slug 表达式（L427），改为调用共享模块；
   - 章节 `headings` 改为**从最终 `html` 调用 `collectHeadingsFromHtml` 得出**（在卡片还原、KaTeX 还原完成之后）；
   - 保持 `html` 结构、卡片、公式、图片路径**逐字节不变**（除重复 id 的 `-1/-2` 修正）。
3. `tests/unit/heading-contract.test.ts`：
   - 对 13 本书全部章节：`headings[].id` 必须 ⊆ HTML 中 `<h1-4>` 的 `id` 集合（100%）；
   - 每章 `headings` 的 `depth/text` 与 HTML 中同 id 标题一致；
   - 同一章 id 唯一；
   - `headings` 非空章数 ≥ 983（以 HTML 的 `<h1-4 id>` 锚点为下界）；
   - 源码断言：`pack-book-abp.mjs` 中 `toLowerCase().replace(/[^\w\u4e00-\u9fa5-]` 出现次数为 **1**（仅允许出现在 `headings.ts`）。

**必须重新打包并留证**：
```powershell
node scripts/pack-book-abp.mjs --all    # 本 Wave 唯一授权的一次重打包
```
打包前先记录基线（写入 evidence）：13 本书的 `totalChapters`、每本 `contentHash`、`headings` 非空章数（465）、重复 id 章数（10）。打包后记录同口径数字。

> 说明：`artifacts/abp-packs/**` 为 gitignored 生成物；重打包只影响本地开发与测试，**不得**上传 GitHub Release、**不得**改写 v0.0.4 的 18 项资产与 `catalog.json`。`contentHash`/`updatedAt` 变化属预期，evidence 中注明“本地重生成，不与 v0.0.4 比对”。

### 2.2 B2 — EPUB 消费同一模块

**允许文件**：`scripts/epub/mdx-pipeline.mjs`、`tests/contract/epub-heading-parity.test.ts`（新增）

- 把 EPUB 的标题/锚点生成替换为共享模块（或至少标题 id 与文本同源）；
- 对照测试：对 13 本书随机取 3 章，ABP 与 EPUB 的标题顺序、层级、文本必须一致（id 允许因 XHTML 转义差异做同构比较）；
- 若 EPUB 管线本身无人使用（`npm run epub` 是否在发布链路），先在 README 记录其定位，再决定“修”或“显式 legacy”。

### 2.3 B3 — 其余转换器显式定性（不重写）

**允许文件**：`src/publishing/common/mdx-chapter-parser.ts`（仅加注释/导出标记）、`src/server/plugins/doc-ingestion/ast-compiler.ts`（同）、`docs/architecture/ADR-CONTENT-IR-2026-11-13.md`

- 对 publishing 与 doc-ingestion：在文件头标注 `LEGACY-PENDING-IR`，并在 ADR 中写明“退出生产路径的条件与时间点”；
- **禁止**在本 Wave 重写这两个解析器（那是 P1-E 的事）；
- 验收：`docs` 中有一张“转换器 → 是否生产路径 → 后续处置”的表。

### 2.4 B4 — 证据与闭环

**交付物**：
- `docs/architecture/evidence/p1-b-evidence.json`：
  ```json
  {
    "gate": "P1-B",
    "baseCommit": "d4e09245",
    "packRegenerated": true,
    "before": { "books": 13, "chapters": 1251, "headingsCoverage": 465, "headingAnchorCoverage": 983, "anchorAlignMismatch": 6, "duplicateIdChapters": 10 },
    "after":  { "books": 13, "chapters": 1251, "headingsCoverage": "<实测，≥983>", "anchorAlignMismatch": 0, "duplicateIdChapters": 0 },
    "contentHashes": { "<bookId>": "<before → after>" },
    "tests": { "files": "<实测>", "passed": "<实测>", "skipped": "<实测>" }
  }
  ```
- 验收命令：
  ```powershell
  npm run check:types
  npx vitest run tests/unit/heading-contract.test.ts tests/contract/epub-heading-parity.test.ts
  npm test
  npm run build
  ```

**B 完成定义**：全仓标题 id 生成实现只有 1 处；`headings[].id ⊆ html ids` 100%；重复 id 为 0；`headings` 覆盖 ≥ 983 章（现为 465）；ABP schema 未变；未触碰 Release 资产；`/reader/` 大纲可用章数由 463 提升至 ≥ 983（P1-A 的 `buildOutlineItems` 无需再改）。

---

## 3. P1-C：书库/安装/校验契约

### 3.0 C0 — 决策文档（先做，不改代码）

**交付物**：`docs/architecture/ADR-LIBRARY-CONTRACT-2026-11-13.md`（新建）

必须回答：

1. **安装语义唯一化**：`install(abp) → validate → 写入 staging → 原子替换 → 元数据`；三个适配器（Electron FS / Web IndexedDB / Dev HTTP）各自如何满足“失败不留下半本书”；
2. **校验唯一入口**：以 `validateAbpBundle` 为唯一 schema 入口，并在其外增加**一致性校验**（章节键 ⊆ manifest、`path === chapters/<slug>.json`、`entryPoint` 存在），放在新模块而非 `src/types/content-package.ts`；
3. **能力矩阵**：Web / Electron / Dev 三端对 install、read、remove、storageStats 的支持与**失败时的显式错误文案**；
4. **重复安装幂等**与**旧章节清理**规则；
5. **不受支持的操作**（如 Web 端“安装到磁盘”）必须返回显式错误，禁止假成功；
6. 受影响文件、禁止文件、回滚方案、验收命令、对 v0.0.4 的影响（预期：无）。

### 3.1 C1 — 单一校验入口

**允许文件**：`src/services/content-provider/install-validation.ts`（新增）、`src/server/plugins/library/dev-server-plugin.mjs`、`tests/unit/install-validation.test.ts`（新增）

- 新模块导出 `validateInstallPayload(raw: unknown): AbpBundlePayload`：内部调用 `validateAbpBundle`，再做一致性校验：
  - 每个 `chapters[slug]` 的 `chapterSlug` 必须等于 key，且 `path` 为 `chapters/<slug>.json`；
  - `manifest.sections[].chapters[].slug` 必须全部存在于 `chapters`（缺章 → 拒绝）；
  - `manifest.entryPoint` ∈ 章节集合；
  - 章节 slug 不得含 `..`、`\`、绝对路径前缀。
- `dev-server-plugin.mjs` 的上传分支改为调用 `validateInstallPayload`，删除手写的 `manifest.colSlug/slug` 判断；
- **禁止**修改 `src/types/content-package.ts`（ABP Schema 1.0.0 不动）。

### 3.2 C2 — 原子安装

**允许文件**：`src/services/content-provider/web-provider.ts`、`src/server/plugins/library/dev-server-plugin.mjs`、`electron/services/book-manager.ts`（**仅**允许抽取公共常量/注释，逻辑不改）

1. **Web**：改为“先写章节 → 再写 manifest → 失败则 `deleteBook` 回滚”；任何异常必须向上抛（禁止 `onProgress(100)` 后再失败）；`installBookFromAbp` 结束前不得提前报告 100%。
2. **Dev HTTP**：写入 `.tmp/dev-abp-packs/<bookKey>.__staging_<ts>` → 全部写完 → 旧目录 rename 为 `.__backup_<ts>` → staging rename 为正式目录 → 删除 backup；失败回滚 backup。
3. **Electron**：已有 staging+rollback，**只允许补测试**，不得重写。
4. 三端统一：安装失败后目标目录/存储中不得出现该书的 `manifest`（即“书库列表看不到半本书”）。

### 3.3 C3 — 幂等与残留清理

- 重复安装同一 `.abp`：结果一致、无重复条目、旧章节不残留（用“新旧章节集合差集”断言）；
- 降级安装（新包章节更少）：旧章节必须被清除，不能出现 manifest 未声明但文件仍存在；
- `removeBook` 后：目录/IndexedDB/Cache/registry 四处均无残留（按端分别断言）。

### 3.4 C4 — 能力矩阵与错误显式化

- 在 `web-provider.ts` / `dev-server-plugin.mjs` 中把“不支持/失败”转换为明确错误（如 `AbpInstallError` 常量表），禁止空 `catch`；
- 为三端各写一条“失败可见”测试：非法包、磁盘/配额失败（用 mock）、bridge 缺失。

### 3.5 C5 — 测试与证据

**允许文件**：`tests/unit/install-validation.test.ts`、`tests/unit/content-provider.test.ts`（扩展现有）、`tests/unit/electron-services.test.ts`（已有回滚用例，扩展）、`docs/architecture/evidence/p1-c-evidence.json`

必须覆盖的四类场景（每类至少 1 条，且对适用的适配器逐一覆盖）：

1. **损坏包**：`schemaVersion` 错、缺 `chapters` 条目、`entryPoint` 不存在、章节 `path` 不匹配 → 显式拒绝，且落盘零残留；
2. **重复安装**：两次安装后条目唯一、章节集合一致；
3. **元数据失败回滚**：mock 写元数据抛错 → 目录回滚（Electron 已有，补 Web/Dev）；
4. **路径逃逸**：`../x`、`C:\x`、`a/../../b` → 拒绝且不写出任何文件。

```powershell
npm run check:types
npx vitest run tests/unit/install-validation.test.ts tests/unit/content-provider.test.ts tests/unit/electron-services.test.ts
npm test
```

**C 完成定义**：三个安装入口都经同一校验；三端安装失败均零残留；重复安装幂等且无旧章残留；四类测试全绿；`content-package.ts` 未改；Release 资产未动；`p1-c-evidence.json` 入库。

---

## 4. 顺序、并行与提交

```text
B0(ADR) ──→ B1 ──→ B2 ──→ B3 ──→ B4
C0(ADR) ──→ C1 ──→ C2 ──→ C3 ──→ C4 ──→ C5
```

- **B0 与 C0 可同时起草**（纯文档）；两份 ADR 都过审后，B1 与 C1 **可并行**（不同边界、无共享文件）；
- 一旦涉及 `src/services/content-provider/**`，C 的提交必须独立，不得与 B 混提；
- **B1 的 `pack:books` 只允许执行一次**，且必须在 B1 提交前完成并记录 before/after；
- 每个子步一个原子 commit，scope 只用合法值（`content` / `core` / `render` / `ui` / `ci`）。建议：
  - `docs(content): record p1-b content ir decision`
  - `refactor(content): unify heading anchor derivation across abp pipeline`
  - `refactor(content): make epub headings consume the shared extractor`
  - `docs(content): mark legacy parsers and record p1-b evidence`
  - `docs(core): record p1-c library and install contract`
  - `fix(core): validate dev abp uploads with the shared install validator`
  - `fix(core): make web and dev installs atomic and idempotent`
  - `test(core): cover corrupt, duplicate, rollback, and path escape installs`

---

## 5. 红线（违反即停止并回退）

1. 改 ABP `schemaVersion` / `content-package.ts` 的字段结构；改 13 本书正文；
2. 重传 / 改写 v0.0.4 的 18 项资产、`latest.yml`、`catalog.json`；
3. 在 B1 之外再次执行 `pack:books`（会导致 `contentHash` 不可解释的漂移）；
4. 把标题 id 算法切换为 `cleanSlug`（会全量失效既有锚点）；
5. 重写 `electron/services/book-manager.ts` 的安装流程（已达标，重写=引入回归）；
6. 用 `skip` / 空断言 / `early return` 换绿灯；删除既有断言；
7. 新增三方依赖、新增 `any` / `| string` 扩宽、新增 `!important`；
8. 跨 Wave 合并提交，或把 B/C 做成一次 Big Bang。

---

## 6. 附录：验证与取证脚本口径

```powershell
npm run check:types
npm test
npm run build

# B：标题与锚点契约（打包前后各跑一次，记录数字）
# 遍历 artifacts/abp-packs/*/chapters/**/*.json：
#  - headings 非空章数
#  - headings[].id ⊆ html <h1-4> id 集合的比例
#  - 每章重复 id 数
#  - 每本 contentHash（manifest.contentHash）

# C：安装矩阵
#  - 合法包：install → 读回 → remove → 断言零残留
#  - 非法包：schemaVersion/缺章/entryPoint 不存在/path 不匹配 → 断言拒绝且零残留
#  - 重复安装：两次 install → 断言条目唯一、章节集合一致
#  - 降级安装：章节更少的包 → 断言旧章节被清除
```

**报告**：每个 Wave 结束后按 `P0_FINAL_AUDIT §6.8` 模板提交；必须写出**实测数字**（不是“全部通过”），并附 `p1-b-evidence.json` / `p1-c-evidence.json`。

**签发结论**：B 与 C 的缺口已被收窄到可一次边界内解决的范围（B：标题/锚点唯一源 + EPUB 对齐 + 两个 legacy 标记；C：校验入口统一 + Web/Dev 安装原子化 + 四类安装测试）。桌面安装与阅读链路已稳定，**不得回炉**。
