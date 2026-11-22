# AstroLib 当前架构审计与破坏性重构建议

**文档编号**：ARCH-AUDIT-2026-11-12  
**审计日期**：2026-11-12  
**审计基线**：`7657a57a`（工作树未提交）  
**审计范围**：`src/`、`scripts/`、`electron/`、`content-sources/`、`public/`、`tests/`、`.github/workflows/`、`docs/`  
**审计方式**：只读静态审计、导入图追踪、ABP manifest 解析、生成物体量盘点、构建脚本与 CI 配置核对  
**审计约束**：未执行 `npm run build`、未启动 Astro/Electron、未修改业务文件；`npm run check:types` 在本次采样中通过（0 输出），但这只证明类型，不证明构建、路由和运行态。

> 本文与既有文档的关系：
>
> - [`target-architecture.md`](./target-architecture.md) 仍然是一份有价值的“边界矩阵”，但它假设阅读器继续由 Starlight 承载、`src/services/` 继续作为基础设施层；本次审计认为这两个假设已经不成立，建议用本文第 6 节的“双壳 + 内容内核”目标替代。
> - [`migration-plan.md`](./migration-plan.md) 的 Phase 1–7 只执行了一部分，当前工作树正停在迁移中途；本文第 7 节给出的是**从当前中途态继续收口**的路线，不是从头再写一遍。
> - [`ARCHITECTURE_REVIEW.md`](./ARCHITECTURE_REVIEW.md) 只讨论 LaTeX/PDF 导出，不与本文冲突；本文把 publishing 放进全局内容流水线里重新定位。

---

## 0. 阅读指南

### 0.1 严重度定义

| 级别 | 定义 | 处置要求 |
|---|---|---|
| **P0** | 当前会导致“用户不可读、构建不可复现、发布不可用、数据写错位置”的问题 | 进入第一批修复，未修复不得宣称迁移完成 |
| **P1** | 不直接阻断运行，但会导致架构持续腐化、重复实现、无法维护的问题 | 在内容主干稳定后按边界处理 |
| **P2** | 零引用文件、备份、命名/注释漂移、可清理的生成物 | 可独立小 PR 清理，不阻塞主线 |

### 0.2 证据格式

- `path:start-end` 表示当前采样时的行号范围。
- `path#Lstart-Lend` 是可点击的编辑器/仓库链接。
- “采样值”表示本次只读盘点得到的数字；其他 agent 仍在写入，数字可能漂移，以代码为准。
- “推断”表示由静态代码路径推导、但未做运行时复现的结论；其余为可直接从代码/产物确认的事实。

### 0.3 本次审计不处理的内容

按你的要求，本文不展开安全审计。但以下问题同时属于架构问题，仍会在正文中出现：

- Web 端代码静态引入 `node:fs` / `process.cwd()`；
- 运行时写源码目录；
- 路径拼接、解包、资源解析没有统一边界；
- Electron 主进程与 dev-server 插件互相导入。

这些是“边界错误”，不是渗透测试项。

---

## 1. 结论摘要

### 1.1 一句话结论

**AstroLib 现在不是“有一些冗余”，而是“两套架构并行，外加一层迁移期临时结构”。**

- 一套是 **Astro/Starlight 静态内容站**：MDX → Astro 路由 → Starlight 壳。
- 一套是 **Electron/ABP 动态阅读器**：ABP 包 → 本地静态服务器 → `reader-shell-template` 合成 HTML。
- 迁移期又叠加了：第二套书库、第二套设置 UI、第二套 Header、第三套目录清单、第四套内容渲染器。

因此当前工作树既不是“零内置书籍”的完成态，也不是可发布态，而是**两套系统互相打补丁的叠加态**。

### 1.2 根因层级

当前问题不是同一层的并列 bug，而是有明确的因果链：

```text
根因 A：把 Starlight 文档框架当成阅读器
   → 13 个 componentOverrides、626 行 HeaderOverride、6,623 行 theme.css、1,414 行 reader-shell-template
   → Web 端没有真实阅读路由，只能靠 Electron 静态服务器合成 HTML

根因 B：内容没有唯一 IR，也没有唯一 slug
   → 5 套 MDX/Markdown 转换器、4 套 slug 算法
   → 1,195 / 1,251 章 slug 不一致
   → 静态服务器用 fuzzy match 擦屁股，Web 端没有对应逻辑

根因 C：书库/内容没有唯一 Repository
   → Web IndexedDB、Electron FS、HTTP 插件、DesktopBookManager、DesktopLibraryManager 五套生命周期
   → 一本“已安装”的书可能同时在两个存储里，也可能只写了一半

根因 D：构建/发布没有唯一入口
   → `npm run build` 不打包 ABP；多个 build-* 脚本遍历空集合后打印成功
   → 干净 clone 依赖未跟踪的 pack/fixture；release workflow 在 build 前跑测试
   → 产物体积失控、安装包不可复现
```

### 1.3 设计优点（必须保留）

| 设计 | 判断 | 备注 |
|---|---|---|
| `defineFeature` / `isEffective()` 的 Feature Registry | 正确 | 构建期门控是这类项目的好设计，问题在“两套配置各写一份” |
| `IContentProvider` 端口 + Web/Electron 适配器 | 方向正确 | 接口本身没问题，问题在实现层的 fallback 与双写 |
| ABP 1.0 版本化契约 | 项目最有价值的长期资产 | 应升级为 1.1，增加 `routeSlug` / `sourcePath` / provenance，而不是推倒 |
| `src/features/search-rec` | 全项目最接近“完整垂直切片”的模块 | 有 exact/fuzzy/dense/graph、RRF、MMR、ranker、UI |
| `src/components/m3/` | 方向正确 | 但被 `HeaderOverride` 与两套设置 UI 绕过 |
| `src/publishing` 的 headless 意图 | 方向正确 | 被 `.bak`、死 Typst 和 UI controller 污染 |
| 4 层测试金字塔 | 结构合理 | 但 acceptance 依赖未跟踪产物，CI 没有真正跑构建 |

引用自 [`src/features/search-rec/core/engine.ts`](../../src/features/search-rec/core/engine.ts)、[`src/services/content-provider/types.ts`](../../src/services/content-provider/types.ts)、[`src/types/content-package.ts`](../../src/types/content-package.ts)。

---

## 2. 当前系统拓扑

### 2.1 运行时路径

```text
[Web / Astro 静态站]
  src/pages/index.astro
      └─ 302/refresh → /desktop/
  src/pages/library.astro
      ├─ 读 content-sources/catalog-registry.json（12 本）
      ├─ 或 public/abp-packs/catalog.json（13 本）
      └─ 生成 /collections/:col/:book/:entry/ 链接
  src/pages/desktop.astro
      ├─ FragmentLibrary → /api/library/* 或 window.astrolib
      └─ FragmentReaderHost → iframe /collections/...
  ❌ 没有 /collections 路由；dist/collections 不存在

[Electron]
  electron/main.ts
      └─ LocalServer(:62960)
          └─ StaticHandler
              ├─ dist 静态文件
              ├─ userData/abp-packs（启动时从 dist/public 全量复制）
              ├─ fuzzy match 章节
              └─ synthesizeAbpHtml → renderReaderPageHtml → userData/.cache/*.html

[Web 安装]
  WebContentProvider
      ├─ IndexedDB: manifests/chapters
      ├─ import renderReaderPageHtml（含 node:fs / process.cwd）
      ├─ try { packCache.put(renderReaderPageHtml(...)) } catch {}
      └─ 仍报 100% 安装完成
```

### 2.2 内容流水线

```text
content-sources/collections/**/*.mdx
  ├─ Astro/Starlight unified 管线 ──→ 仅文档/开发页，不生成书
  ├─ scripts/pack-book-abp.mjs（regex + marked）──→ public/abp-packs 展开目录 + .abp
  ├─ scripts/epub/mdx-pipeline.mjs（unified + KaTeX）──→ EPUB
  ├─ src/publishing/common/mdx-chapter-parser.ts（semantic AST）──→ LaTeX/Typst
  └─ src/server/plugins/doc-ingestion/ast-compiler.ts（自定义 HTML/KaTeX）──→ 导入结果
```

### 2.3 基线指标（采样值）

| 指标 | 当前 |
|---|---:|
| HEAD | `7657a57a` |
| 工作树 | 5,646 D / 208 M / 98 ?? |
| `content-sources` 文件 | 8,133 |
| `src/content/docs/collections` | 0（目录已不存在） |
| 内容书数（`sourceCollections`） | 13 |
| ABP 章节总数 | 1,251 |
| `ch.slug` 与 `cleanSlug(ch.slug)` 不一致 | **1,195 / 1,251 = 95.5%** |
| `content-sources/catalog-registry.json` | 12 本，缺 `math-graph_theory`，未被 Git 跟踪 |
| `public/abp-packs/catalog.json` | 13 本 |
| `public/abp-packs` | 8,184 文件 / 603.1MB |
| `public/abp-packs/*.abp` | 13 个 / 147.3MB |
| Git 跟踪的 `public/abp-packs` 文件 | 612（其中 `.abp` 仅 1 个） |
| `dist` | 800.5MB |
| `dist/collections` | 不存在 |
| `src/**/*.css` | 33,248 行 / **6,189 个 `!important`** |
| 旧路径引用 `src/content/docs/collections` | 130 行 / 72 文件 |
| `.mjs` 引用 | 95 行 / 59 文件（83 处 import/export） |
| 零引用 `.mjs` 垫片 | 8 个 |
| 最大单文件 | `chat-controller.ts` 2,230 行 |
| 类型检查 | 本次采样通过（仅 `tsc`） |

> 旧路径统计含 `docs/` 与 `tests/`；不是所有引用都是运行时代码，但迁移文档与测试同样需要更新。

---

## 3. 问题总表

### 3.1 P0（阻断级）

| ID | 问题 | 关键定位 | 直接影响 |
|---|---|---|---|
| P0-01 | 内容 SSOT 四分五裂 | `collections.config.ts:13,20,700-721`、`library.astro:43-75`、`sitemap.astro:23-27` | 12/13 本书不一致、图论书隐藏、sitemap 0 章 |
| P0-02 | Web 端没有章节阅读路由 | `src/pages/`（无 collections 路由）、`FragmentReaderHost:210-223`、`library.astro:75` | Web 安装后无法阅读；首页指向死路 |
| P0-03 | ABP slug 与路由 slug 95.5% 不一致 | `pack-book-abp.mjs:556,603-604`、`static-handler.ts:211-235,337-357` | 1,195 章链接 404，靠 Electron fuzzy match 掩盖 |
| P0-04 | 构建链空转、发布链依赖未跟踪产物 | `package.json:10`、多个 `scripts/build-*.mjs`、`.github/workflows/electron-release.yml:40-54`、`tests/acceptance/...:13-14` | 干净 clone 不可构建/测试；安装包可能只有 1 本书 |
| P0-05 | 导入管线写回已废弃源码目录 | `src/server/plugins/doc-ingestion/task-manager.ts:499-548` | 导入“成功”但 Astro/ABP/书库都看不到 |
| P0-06 | 书库/存储五套实现，HTTP 安装写坏目录 | `web-provider.ts`、`electron-provider.ts`、`library-manager.ts`、`library/dev-server-plugin.mjs:246-251` | 双写/半安装/结构不合法 |
| P0-07 | Web 安装假成功，PWA 离线缓存为空 | `web-provider.ts:15,249-312,314-323,341-352`、`reader-shell-template.ts:21-26` | 安装进度 100%，但离线页/资源不存在 |
| P0-08 | 五套内容转换器，没有唯一 IR | `pack-book-abp.mjs`、`epub/mdx-pipeline.mjs`、`publishing/common/mdx-chapter-parser.ts`、`doc-ingestion/ast-compiler.ts` | 渲染/slug/资源规则持续漂移 |
| P0-09 | 发布包把源码与展开 packs 一起打包 | `package.json:79-98`、`electron/main.ts:397-433` | 安装包体积失控、启动复制 603MB、版本不可复现 |

### 3.2 P1（结构性）

| ID | 问题 | 关键定位 |
|---|---|---|
| P1-01 | Starlight 被当成阅读器，框架倒置 | `astro.config.mjs:168-206`、`HeaderOverride.astro`、`theme.css`、`reader-shell-template.ts` |
| P1-02 | 设置面板双实现 + God controller | `FeatureToggles.astro` 838 行、`SettingsHubContent.astro` 1,831 行、`feature-toggles.ts` 1,819 行 |
| P1-03 | Header 双实现 + 死组件 | `HeaderOverride.astro` 626 行、`M3TopNavBar.astro` 519 行、`HeaderToolsMenu.astro` 326 行零引用 |
| P1-04 | Library UI 双实现 | `library.astro` 330 行、`library-client.ts` 315 行、`FragmentLibrary.astro` 563 行 |
| P1-05 | God controller 密度过高 | `chat-controller` 2,230、`exercise-controller` 2,213、`translation-dock` 1,925、`ingest-controller` 1,650 |
| P1-06 | 依赖方向倒置 | services→components、utils→server、features→translation/bilingual、electron→dev plugin |
| P1-07 | CSS `!important` 军备竞赛与重复导入 | 33,248 行 / 6,189 个；`custom.css` 与 `astro.config.mjs` 双重导入 |
| P1-08 | Feature Isolation 只覆盖小模块 | `features/` 5 个模块；`components/exercises` 9,258 行仍在外面 |
| P1-09 | AI / 翻译 / 检索重复栈 | `ai-config.ts` + `features.config.ts`、`tools-client` + `mcp/tools`、`retriever` + `search-rec`、4 套翻译入口 |
| P1-10 | Publishing 遗留与边界污染 | 2 个 `.bak`、死 Typst、`publishing/client` UI controller、两套 renderer |
| P1-11 | 类型契约被 `\| string` / `any` 削弱 | `collections.ts:13-17`、`content-package.ts:65-69`、`library-entity.ts:37-56` |
| P1-12 | 生成物/测试/CI/文档治理失效 | 空转脚本、旧路径 130 行、untracked fixture、CI 无 build、AGENTS 与代码漂移 |
| P1-13 | 运行时小缺陷 | `sideload-manager` 重复注册、宽度漂移、`sitemap` 空、`index` 重定向死路 |

---

## 4. P0 问题详述

### P0-01 内容 SSOT 四分五裂，且已经产生可见故障

**严重度**：P0  
**影响面**：书库、sitemap、AI 索引、关系图、巡检数据、ABP 打包、所有默认消费者

#### 定位

- [`src/config/collections.config.ts`](../../src/config/collections.config.ts#L13)：`export const collections: Collection[] = [];`
- 同文件 `:20`：`export const sourceCollections: Collection[] = [...];`
- 同文件 `:700-721`：`getAllBooks(sourceMode = false)` / `findBookBySlug(bookSlug, sourceMode = false)`
- [`src/pages/library.astro`](../../src/pages/library.astro#L43-L75)：优先 `content-sources/catalog-registry.json`，否则 `public/abp-packs/catalog.json`
- [`src/pages/sitemap.astro`](../../src/pages/sitemap.astro#L12-L27)：导入空 `collections`，扫描 `src/content/docs/collections`
- `content-sources/catalog-registry.json`：12 本，缺 `math-graph_theory`
- `public/abp-packs/catalog.json`：13 本，含 `math-graph_theory`
- `sourceCollections` 注释写“12 本教材”，实际 13 本（`:15-19`）

#### 具体逻辑

1. `collections` 被硬编码为空数组。注释说这是“Zero-Built-in Books”，确保 Astro 静态构建不固化预编译书籍。这个目的本身合理，但实现方式把**所有默认消费者**也一起清空了。
2. `getAllBooks()` 默认 `sourceMode=false`，因此默认返回 `collections`，即空数组；`findBookBySlug()` 同理。
3. `library.astro` 在构建期先看 `content-sources/catalog-registry.json`。该文件存在，但只有 12 本，且没有被 Git 跟踪；因此**本地有文件时书库显示 12 本，干净 clone 时才回退到 13 本的 public catalog**。
4. `sitemap.astro` 直接 `collections.map(...)`，所以 `sitemapData` 为空；页面仍渲染“0 个核心章节”的文案。
5. `pack-book-abp.mjs` 用 `collections.length ? collections : sourceCollections` 兜底，所以 ABP 仍能打 13 本；但其他脚本没有这层兜底。

#### 影响链

```text
collections = []
  ├─ getAllBooks() = []
  ├─ findBookBySlug() = null
  ├─ sitemapData = [] → 0 章
  ├─ build-ai-index / relation / cross-ref / inspector = 0 本（仍打印成功）
  ├─ build-offline-pack = 跳过
  └─ library.astro 另行读 registry（12 本）→ graph_theory 隐藏
```

#### 证据

- catalog ID 差异（Node 解析）：
  - registry 12：`math-math_senior` … `cs-algorithms`
  - public 13：同上 + `math-graph_theory`
- `library.astro:45` 明确 `fs.existsSync(catPath) ? catPath : pubPath`；只要本地存在 12 本 registry，就不会读 13 本 public catalog。
- `sitemap.astro:48` 的 `totalChapters` 来自空数组，最终为 0；`:211-213` 仍输出这段统计。

#### 修复方向

- 建立**唯一人工目录** `content-sources/catalog.json`（13 本书），`book.json` 承接原 `sourceCollections` 的 modules/trackClasses。
- `collections` 空数组改为构建开关：`build.includeBooks=false` 只控制“是否把书编译进静态站”，不改变运行时 catalog。
- `getAllBooks()` 默认读唯一 catalog；需要“仅内置书”时显式传 `{ builtinOnly: true }`。
- `library.astro` / `sitemap.astro` 只读一个 catalog；禁止页面自行选择第二份 JSON。
- `catalog-registry.json` 删除，或作为 catalog 的生成 projection，不能手写两份。

#### 验收

- 13/13 本书在 library、sitemap、AI 索引、relation graph、inspector 中一致。
- `graph_theory` 不再被隐藏。
- 干净 clone 与本地工作树读同一份 catalog。
- `rg "content/docs/collections" src scripts tests` 为 0（或在迁移期只剩明确标注的 legacy 代码）。

---

### P0-02 Web 端没有章节阅读路由，首页却导向桌面壳

**严重度**：P0  
**影响面**：Web 产品可用性、SEO、PWA、所有 `/collections/...` 链接

#### 定位

- `src/pages/` 下没有 `collections/[...].astro` 或等价章节路由；`dist/collections` 目录不存在。
- [`src/components/desktop/FragmentReaderHost.astro`](../../src/components/desktop/FragmentReaderHost.astro#L210-L223)：`targetUrl = /collections/${meta.colSlug}/${meta.bookSlug}/${meta.entryPoint}/`
- 同文件 `:433-447`：创建 `iframe`，`src` 指向该 URL。
- [`src/pages/library.astro`](../../src/pages/library.astro#L54-L75)：`cleanEp` + `readUrl = /collections/.../`
- 同文件 `:228,252,256`：卡片 `data-entry`、`href` 都使用该 URL。
- [`src/pages/index.astro`](../../src/pages/index.astro#L16-L20)：`meta refresh` + `location.replace('/desktop/')`
- [`src/pages/desktop.astro`](../../src/pages/desktop.astro#L21-L29)：桌面壳由 `FragmentLibrary` + `FragmentReaderHost` 组成。

#### 具体逻辑

1. 书库和桌面壳都假定 `/collections/:col/:book/:chapter/` 存在。
2. 该路由只在 Electron 的 `StaticHandler` 中由 ABP 动态合成；Astro 侧没有对应的 `getStaticPaths` 或 SSR 路由。
3. 因此 Web 端点击“进入阅读”时，浏览器请求一个不存在的路径；Vercel 没有 rewrite，`vercel.json` 只有 `/api/translate/*`。
4. `FragmentReaderHost` 只创建 iframe，没有“路由不存在/未安装”的 fallback；失败表现为空白 iframe。
5. 首页直接跳到 `/desktop/`，所以新用户的第一条路径就是“桌面壳 → 点书 → 空白”。

#### 影响

- Web 端“安装 ABP”后无法阅读；安装按钮的语义是假的。
- 所有 `readUrl` 在 Web 上 404。
- SEO 没有章节页；`sitemap` 也是空的（见 P0-01）。
- PWA 的导航缓存无法命中真实章节。

#### 修复方向

- 增加唯一阅读路由：`src/pages/collections/[...path].astro`，官方 13 本书用 `getStaticPaths` 生成 1,251 章。
- 用户上传的 ABP 用单一运行时入口 `/reader/?book=...&chapter=...`，挂载同一个 `ReaderLayout`；不要为每本上传书包生成静态路由。
- 保持 `/collections/:col/:book/:chapter/` URL 契约，避免破坏现有外链；旧 raw slug 用 `legacySlug` 过渡。
- `FragmentReaderHost` 增加 `iframe.onerror` / 超时 / 空状态，不再静默空白。

#### 验收

- 13 个 entryPoint + 1,251 个官方章节在 Web 上全部 200。
- `dist/collections` 在构建后存在。
- Web 首页可以完整走通“打开书 → 切章 → 侧栏大纲”。
- `FragmentReaderHost` 在未安装/无路由时显示明确空状态。

---

### P0-03 ABP 章节 slug 与路由 slug 95.5% 不一致，靠运行时模糊匹配掩盖

**严重度**：P0  
**影响面**：所有章节链接、目录高亮、静态服务器、离线包、Web/Electron 一致性

#### 定位

- [`scripts/pack-book-abp.mjs`](../../scripts/pack-book-abp.mjs#L556-L604)：
  - `const chapterSlug = cFile.replace(/\.(mdx|md)$/, '');`
  - `slug: chapterSlug`
  - `path: chapters/${chapterSlug}.json`
- [`src/services/content-provider/reader-shell-template.ts`](../../src/services/content-provider/reader-shell-template.ts#L128-L129)：`const url = /collections/${colSlug}/${bookSlug}/${ch.slug}/`
- 同文件 `:447`：sidebar `url` 同样用 `ch.slug`。
- 同文件 `:1365-1366`：另一处目录链接也使用 `ch.slug`。
- [`electron/server/static-handler.ts`](../../electron/server/static-handler.ts#L211-L235)：`normalizedTarget = rawChapterSlug.replace(/\./g, '').replace(/[-_ ]/g, '').toLowerCase()`，然后遍历目录做归一化比较。
- 同文件 `:337-357`：章节 JSON 文件也做同样的归一化查找。
- [`src/pages/library.astro`](../../src/pages/library.astro#L54)：`cleanSlug(b.entryPoint || '')`，入口点走的是净化后的 slug。

#### 具体逻辑

1. `pack-book-abp` 直接把 MDX 文件名（去掉 `.mdx`）当 `chapterSlug`，例如 `00.1_books-and-algorithms`。
2. `cleanSlug` 用 `github-slugger` 处理：点号被删除、空格转连字符、下划线保留，例如 `00.1_books-and-algorithms` → `001_books-and-algorithms`。
3. ABP manifest 的 `slug` 是原始文件名；`reader-shell-template` 用原始 `slug` 生成 URL；`library.astro` 却用 `cleanSlug(entryPoint)`。
4. Electron 的 `StaticHandler` 发现直接路径不存在后，去掉点号/连字符/下划线做 fuzzy 比较，所以 Electron 看起来能打开。
5. Web 端没有 `StaticHandler`，也没有 Astro 路由，于是 1,195 个章节链接必然失败。

#### 量化

- 13 个 manifest，1,251 章。
- `cleanSlug(ch.slug) !== ch.slug`：**1,195 章，95.5%**。
- 示例：
  - `00.1_books-and-algorithms` → `001_books-and-algorithms`
  - `00.2_enter-fibonacci` → `002_enter-fibonacci`
  - `01.1_basic-arithmetic` → `011_basic-arithmetic`

#### 为什么测试没有发现

- acceptance 测试只验证 `/collections/math/math_senior/07_1.1_%E5%9F%BA%E6%9C%AC%E5%85%AC%E5%BC%8F/` 这种入口级路径；入口点大多已经是干净形式。
- 测试依赖 `math-math_senior.abp`，但该文件未被 Git 跟踪（见 P0-04），所以干净 clone 的测试直接失败，而不是暴露 1,195 章的问题。

#### 修复方向

- 在编译器里算一次 `routeSlug = cleanSlug(sourceSlug)`，写入 manifest 的 `slug`；原始文件名写 `sourcePath` / `legacySlug`。
- `reader-shell-template`、`library.astro`、`static-handler` 全部只使用 `slug`，不再调用 `cleanSlug`。
- 删除 `StaticHandler` 的 fuzzy 分支；用精确路径 + 一个显式 `legacySlug` 映射处理旧链接。
- 增加全量契约测试：遍历 13 个 manifest，断言 `slug === cleanSlug(slug)` 且 `path === chapters/${slug}.json`。

#### 验收

- 0 / 1,251 mismatch。
- 1,251 个章节在 Web/Electron 都能精确命中。
- `rg "normalizedTarget|targetNorm|replace\\(/\\./g" electron/server/static-handler.ts` 为 0。

---

### P0-04 构建链“绿色空转”，发布链依赖未跟踪产物

**严重度**：P0  
**影响面**：干净 clone、CI、Electron 发布、所有生成数据

#### 定位

- [`package.json`](../../package.json#L10)：`build` 只运行 `build-exercise-data`、`build-ai-index`、`build-relation-graphs`、`build-cross-ref-data`、`build-inspector-data`、`astro build`、`build-offline-pack`、`submit-indexnow`；**没有 `pack-book-abp`**。
- [`scripts/build-ai-index.mjs`](../../scripts/build-ai-index.mjs#L13-L56)：`COLLECTION_ROOT = src/content/docs/collections`，循环空 `collections`，最后打印成功。
- [`scripts/build-relation-graphs.mjs`](../../scripts/build-relation-graphs.mjs#L14-L53)：同样遍历空集合。
- [`scripts/build-cross-ref-data.mjs`](../../scripts/build-cross-ref-data.mjs#L8-L37)：同样遍历空集合。
- [`scripts/build-inspector-data.mjs`](../../scripts/build-inspector-data.mjs#L14-L59)：同样遍历空集合。
- [`scripts/build-offline-pack.mjs`](../../scripts/build-offline-pack.mjs#L41-L50)：`collections.length === 0` 时打印“跳过”并退出 0；期望 `dist/collections`，但该目录不存在。
- [`scripts/generate-epub.mjs`](../../scripts/generate-epub.mjs#L18-L57)：`CONTENT_ROOT = src/content/docs/collections`；`:54` `fs.readdirSync(CONTENT_ROOT)` 会 ENOENT。
- [`.github/workflows/electron-release.yml`](../../.github/workflows/electron-release.yml#L40-L54)：先 `npm test`，再 `npm run build`，再 `build-electron`，再 `electron-builder --win`；**无 pack 步骤**。
- [`tests/acceptance/abp-dynamic-serving.test.ts`](../../tests/acceptance/abp-dynamic-serving.test.ts#L13-L14)：硬编码 `public/abp-packs/math-math_senior.abp`，并断言存在。
- Git 跟踪的 `public/abp-packs/*.abp` 只有 `math-graph_theory.abp` 一个；其余 12 个未跟踪。

#### 具体逻辑

```text
npm run build
  ├─ build-exercise-data（可用，但硬编码两本书）
  ├─ build-ai-index（0 本，成功）
  ├─ build-relation-graphs（0 本，成功）
  ├─ build-cross-ref-data（0 本，成功）
  ├─ build-inspector-data（0 本，成功）
  ├─ astro build（collections=[]，不生成 dist/collections）
  ├─ build-offline-pack（看到空集合，跳过，成功）
  └─ submit-indexnow（提交空 sitemap）
```

发布时：

```text
electron-release.yml
  ├─ npm test
  │    └─ acceptance 检查 public/abp-packs/math-math_senior.abp
  │         └─ 该文件不存在于干净 clone → FAIL
  ├─ npm run build（即使通过，也不会 pack ABP）
  └─ electron-builder
       └─ files 包含 public/abp-packs/**/*
            └─ 干净 clone 只有 graph_theory.abp → 安装包只有 1 本书
```

#### 影响

- “构建成功”不代表产物正确；0 本索引、0 章 sitemap、空离线包都返回 0。
- 发布工作流在测试阶段失败；即便绕过，安装包内容也不完整。
- 本地开发依赖本机手工生成的 603MB packs；换机器/CI 不可复现。
- 旧的生成物（12 本）在空转后不会被清理，继续被页面读取，形成“陈旧成功”。

#### 修复方向

- 让构建成为唯一入口：`clean → validate catalog → compile → astro build → pack ABP → verify 13/1,251 → package`。
- `build-*` 空输入必须失败，除非显式 `--allow-empty`；禁止打印“成功 0 本”。
- 生成物带 `sourceHash` / `catalogHash` / `generatedBy`；构建前清理旧输出。
- CI 增加干净 clone 的 `npm ci && npm run build && npm test`；release 先 build 再 test。
- acceptance fixture 不再依赖仓库内未跟踪 pack；在 test setup 中从 fixture 源生成。

#### 验收

- 干净 clone 一条命令通过：`npm ci && npm run build && npm test`。
- `npm run build` 后 13 个 `.abp`、1,251 个章节路由、13 本索引、13 本 relation graph 全部存在。
- 任意 `build-*` 在输入为空时退出非 0。
- release workflow 不含“先测试后构建”的顺序错误。

---

### P0-05 导入管线写回已废弃源码目录，导入结果对构建不可见

**严重度**：P0  
**影响面**：PDF/MinerU 导入、桌面书库、内容源、Rule 9

#### 定位

- [`src/server/plugins/doc-ingestion/task-manager.ts`](../../src/server/plugins/doc-ingestion/task-manager.ts#L488-L554)，核心写入在 `:499` 与 `:548`：
  - `const colDir = path.resolve(process.cwd(), 'src/content/docs/collections/${collectionSlug}')`
  - `fs.writeFileSync(mainChapterPath, mdxHeader + safeMdx, 'utf-8')`
- 当前内容源已迁到 `content-sources/collections/`，`src/content/docs/collections` 目录不存在。
- `src/pages/workspace/ingest-controller.ts` 与 `FragmentLibrary` 都有导入/上传入口。

#### 具体逻辑

1. 用户在 `/workspace/ingest/` 或桌面书库上传 PDF。
2. `TaskManager` 解析、切图、转 MDX，然后写到 `src/content/docs/collections/<col>/<book>/01_全文研判.mdx`。
3. Astro 的 content collection 不再扫描这个路径；`pack-book-abp` 也不扫描；书库 registry 也不读它。
4. UI 返回 `success: true`，但构建、ABP、书库都没有这本书。
5. 该写入发生在运行时，直接修改源码树，违反 AGENTS Rule 9。

#### 影响

- 导入功能是“写入一个没人读的目录”。
- Electron 打包后 `process.cwd()` 可能位于只读 `resources/app`，写入直接失败或污染安装目录。
- 用户以为书已入库，实际只能看到任务记录。

#### 修复方向

- 导入只写 `content-sources/imports/<taskId>/` 或 `staging/<taskId>/`，由显式“晋升”命令写入 `content-sources/collections/`。
- 运行时永远不直接写 `content-sources/collections`；通过 `ContentRepository` / 编译队列落盘。
- 导入完成后触发 `compileBook`，生成 ABP 并注册 catalog；或者只在下次构建时晋升。
- UI 明确显示“已暂存，待构建/发布”，不要显示“已导入书库”。

#### 验收

- 导入后 `content-sources/imports/<taskId>/` 有完整 MDX + images。
- 运行 `npm run pack:book -- <taskId>` 能生成 ABP 并在书库出现。
- `rg "src/content/docs/collections" src/server` 为 0。
- 运行时不再写 `content-sources/collections`。

---

### P0-06 书库/存储五套实现，HTTP 安装写坏目录结构

**严重度**：P0  
**影响面**：安装、删除、离线、Web/Electron 一致性

#### 定位

| 实现 | 位置 | 作用 |
|---|---|---|
| `WebContentProvider` | [`src/services/content-provider/web-provider.ts`](../../src/services/content-provider/web-provider.ts) | IndexedDB |
| `ElectronContentProvider` | [`src/services/content-provider/electron-provider.ts`](../../src/services/content-provider/electron-provider.ts) | IPC + Web fallback |
| `DesktopBookManager` | [`electron/services/book-manager.ts`](../../electron/services/book-manager.ts) | userData 文件系统 |
| `DesktopLibraryManager` | [`electron/services/library-manager.ts`](../../electron/services/library-manager.ts) | `library-registry.json` |
| Library HTTP 插件 | [`src/server/plugins/library/dev-server-plugin.mjs`](../../src/server/plugins/library/dev-server-plugin.mjs) | `.tmp/library-registry.json` + 写 `public/abp-packs` |

关键行：

- `electron-provider.ts:19-22` 创建 Web fallback；`:44-54` 合并 desktop + IndexedDB；`:83-102` 安装失败回退 Web；`:104-117` 删除两边。
- `library/dev-server-plugin.mjs:246-251`：
  - `targetDir = path.resolve(projectRoot, 'public/abp-packs', bookKey)`
  - `fs.writeFileSync(path.join(targetDir, `${cSlug}.json`), ...)`
  - 这里写的是**平铺章节 JSON**，不是 `chapters/${cSlug}.json`。
- `DesktopBookManager` 写的是 `chapters/${chapKey}.json`（`book-manager.ts:101-116`）。
- `StaticHandler` 找的是 `chapters/${chapterSlug}.json`（`static-handler.ts:337`）。
- `DesktopLibraryManager:74-76` 与 `library/dev-server-plugin` 各自维护默认书架。
- `DesktopLibraryManager:22` 从 `src/server/plugins/doc-ingestion/task-manager.ts` 导入 `TaskManager`。

#### 具体逻辑

1. Web 走 `WebContentProvider`；Electron 走 `ElectronContentProvider`；HTTP 上传走 dev-server 插件；桌面安装走 `DesktopBookManager`；书库元数据走 `DesktopLibraryManager`。五套代码各自解释“安装”的含义。
2. `ElectronContentProvider` 在任何失败时回退 Web，导致同一本书可能在 userData 和 IndexedDB 各有一份。
3. `removeBook` 同时删两边，任意一边失败仍返回 `true`（`electron-provider.ts:104-117`）。
4. HTTP 插件把章节写到 `targetDir/<slug>.json`，但 manifest 的 `path` 是 `chapters/<slug>.json`；`StaticHandler` 找不到。
5. HTTP 插件还直接写 `public/abp-packs`，把运行时安装变成源码修改；Electron 侧却写 userData。
6. Electron 启动时又把 `dist/abp-packs` 和 `public/abp-packs` 全量复制到 userData（`main.ts:397-433`），造成第三份展开目录。

#### 影响

- “已安装”状态不可信；换入口可能看不到书。
- HTTP 安装出来的书结构不合法，Electron 打不开。
- 删除可能只删一边；缓存/registry 留残。
- 安装包/用户目录体积翻倍。

#### 修复方向

- 定义唯一 `LibraryRepository` + `ContentRepository`；Web IndexedDB / Electron FS / HTTP 只是 adapter。
- 安装只走一个 application service，输出固定目录结构：`manifest.json` + `chapters/<slug>.json` + `images/`。
- 禁止 fallback；失败抛出可显示错误。
- HTTP 适配器调用同一个 service，不再自写 `public`。
- 默认书架常量只保留一份。

#### 验收

- Web/Electron 安装、删除、阅读各一次；一本书只在一个位置。
- HTTP 安装后的 manifest 与文件结构通过 schema 校验。
- `rg "getWebFallback|public/abp-packs" electron/services src/server/plugins/library` 只剩 adapter 的显式引用。
- `removeBook` 后 IndexedDB、FS、CacheStorage、registry 全部清理。

---

### P0-07 Web 安装假成功，PWA 离线缓存为空

**严重度**：P0  
**影响面**：Web 安装、PWA、离线阅读、存储统计

#### 定位

- [`web-provider.ts`](../../src/services/content-provider/web-provider.ts#L15)：`import { renderReaderPageHtml } from './reader-shell-template.ts';`
- [`reader-shell-template.ts`](../../src/services/content-provider/reader-shell-template.ts#L21-L26)：静态 `import fs from 'node:fs'`、`import path from 'node:path'`、`import { sourceCollections }`、`import { cleanSlug }`。
- 同文件 `:59-61`：`path.resolve(process.cwd(), 'dist', ...)`。
- `web-provider.ts:249-312`：安装流程；`:289` 调 `renderReaderPageHtml`；`:299` 空 `catch`；`:310` 仍 `onProgress(100)`。
- 同文件 `:314-323`：`removeBook` 只删 IndexedDB，不删 `astrolib-pwa-v1-pack`。
- 同文件 `:341-352`：`getStorageStats` 用 `totalChapters * 350KB` 估算。
- 同文件 `:19-21`：声明 `STORE_ASSETS`，但安装流程没有写入 asset。

#### 具体逻辑

1. `web-provider` 是浏览器模块，却静态导入一个使用 `node:fs` / `process.cwd()` 的模板模块。浏览器环境没有这些 Node API，执行到 `renderReaderPageHtml` 时必然失败（或被 Vite 处理成不可用模块）。
2. `installBookFromAbp` 在 `try` 中调用 render；异常被 `catch {}` 吞掉；循环继续，最终 `onProgress(100)`。
3. 因此 `CacheStorage` 的 `astrolib-pwa-v1-pack` 没有章节 HTML；Service Worker 的导航缓存无法命中。
4. `STORE_ASSETS` 从未写入；payload HTML 中的 `/collections/.../images/...` 在 Web 上没有资源。
5. `removeBook` 不清理 pack cache，旧章节可能继续被 SW 返回。
6. 存储统计是编造的近似值；UI 显示的不是实际占用。

#### 影响

- “安装到书架”在 Web 上是假成功。
- PWA 离线打开是空白或旧内容。
- 存储统计误导用户/开发者。
- 卸载不彻底，缓存泄漏。

#### 修复方向

- 删除 `web-provider` 对 `reader-shell-template` 的静态导入；Web 安装只存 ABP manifest/chapters/assets。
- 阅读由真实 `/collections` 路由 + `ReaderLayout` 完成，不再在安装时合成 HTML。
- `removeBook` 清 `caches.delete('astrolib-pwa-v1-pack')`（或按 bookId 删条目）。
- `getStorageStats` 用 `navigator.storage.estimate()` + IndexedDB 实际计数。
- 安装进度只在真正写入成功后推进；失败要回滚已写记录。

#### 验收

- 浏览器 bundle 中 `node:fs` / `node:path` / `process.cwd` 为 0。
- Web 安装后刷新页面可离线打开章节；DevTools CacheStorage 有对应条目。
- 卸载后 cache/IndexedDB 都为空。
- 存储统计与 DevTools 实际值同量级。

---

### P0-08 五套内容转换器，没有唯一 IR

**严重度**：P0（架构根因）  
**影响面**：HTML/ABP/EPUB/LaTeX/Typst/导入

#### 定位

1. Astro/Starlight：`astro.config.mjs` 的 remark/rehype 管线（`@astrojs/mdx` / Starlight）。
2. [`scripts/pack-book-abp.mjs`](../../scripts/pack-book-abp.mjs)：正则 + `marked`，`:150-419` 的 `compileMarkdownToSemanticHtml`；`:250,363,395,419` 多处 `marked.parse`。
3. [`scripts/epub/mdx-pipeline.mjs`](../../scripts/epub/mdx-pipeline.mjs)：`unified` + `remark-mdx` + `rehype-katex`。
4. [`src/publishing/common/mdx-chapter-parser.ts`](../../src/publishing/common/mdx-chapter-parser.ts)：给 LaTeX/Typst 的 semantic AST。
5. [`src/server/plugins/doc-ingestion/ast-compiler.ts`](../../src/server/plugins/doc-ingestion/ast-compiler.ts)：给 MinerU 导入的自定义 HTML/KaTeX。

slug 算法至少四套：

- `src/utils/slug.ts` 的 `github-slugger`；
- `pack-book-abp.mjs:140,245,390,412` 的手写小写/正则；
- `epub/mdx-pipeline.mjs` 的 `encodeURIComponent` + `replace(/\s+/g, '-')`；
- `static-handler.ts:222,343` 的去点号/连字符/下划线比较。

#### 具体逻辑

- 每套转换器都自己处理：标题锚点、卡片组件、公式、图片路径、代码块、表格、脚注。
- `pack-book-abp` 用正则匹配 `<Solution>` / `<Example>` 等 JSX，再用 `marked` 渲染内部 Markdown；嵌套卡片靠占位符递归还原（`:421-424`）。
- `publishing` 用 AST parser 保留语义块；`epub` 用 unified；`doc-ingestion` 用自定义 compiler。
- 结果是同一段 MDX 在五个出口得到五种 HTML/锚点/资源路径。95.5% 的 slug 不一致只是最明显的症状。

#### 影响

- 每新增一种卡片/语法，要改 5 处；漏一处就有一个出口渲染错误。
- 公式、图片、脚注、表格在不同出口行为不同。
- 无法做“一次编译，多端一致”的验收。
- 测试只能覆盖单条管线，无法保证跨端一致。

#### 修复方向

- 建立 `ContentCompiler`：`MDX → ContentDocument`（版本化 IR）。
- IR 只保留语义块：Heading/Paragraph/Math/Card/Figure/Table/List/Exercise/Notice/RawHtml。
- 各出口只做 emitter：`HtmlEmitter`、`AbpEmitter`、`EpubEmitter`、`LatexEmitter`。
- slug、资源解析、标题锚点在 IR 构建时算一次；emitter 不得再算。
- 删除 `pack-book-abp` 的正则 + `marked` 主路径；它只保留 CLI 参数解析。

#### 验收

- 同一章节在 HTML/ABP/EPUB 的标题锚点、图片 URL、公式文本完全一致。
- `rg "marked.parse|githubSlug|cleanSlug" scripts src/publishing src/server/plugins/doc-ingestion` 只出现在 compiler/emitter 的明确位置。
- 新增一个卡片组件只需改 compiler + 对应 emitter，不需要改五套解析器。

---

### P0-09 发布包把源码与展开 packs 一起打包

**严重度**：P0（发布）  
**影响面**：安装包体积、启动复制、首次启动、更新

#### 定位

- [`package.json`](../../package.json#L79-L98)：
  - `"asar": false`
  - `files` 包含 `dist/**/*`、`dist-electron/**/*`、`src/**/*`、`public/abp-packs/**/*`
  - 排除 `dist/collections/**`、`dist/abp-packs/*.abp`、`dist/abp-packs/*/**`
- [`electron/main.ts`](../../electron/main.ts#L397-L433)：启动 1 秒后把 `dist/abp-packs` 与 `public/abp-packs` 全量 `cpSync` 到 userData。
- `public/abp-packs` 603.1MB / 8,184 文件；`src` 仍被完整打包。

#### 具体逻辑

1. electron-builder 把 `public/abp-packs/**/*` 全部放进安装包（展开目录 + 图片 + `.abp` + 可能 `.cache`）。
2. 同时 `src/**/*` 也被打包，尽管运行时只需要 `dist` / `dist-electron`。
3. 首次启动时，主进程又把 bundles 复制到 userData，等于磁盘上再放一份。
4. `.abp` 在 `dist/abp-packs` 被排除，但在 `public/abp-packs` 被包含；两处规则不一致。
5. `asar:false` 让源码/资源直接暴露在安装目录，更新时文件锁/覆盖问题更多。

#### 影响

- 安装包远超必要体积；用户磁盘占用翻倍。
- 首次启动复制 603MB，I/O 抖动，低配机器明显卡顿。
- 安装包内容随本机生成物变化，不可复现。
- 更新时旧展开目录/缓存残留。

#### 修复方向

- 发布包只带 `dist` + `dist-electron` + 一个 `packs/*.abp` 目录（或按需下载）。
- 首次启动只解包当前书，不复制全部；或直接读 `.abp`，不展开。
- 移除 `src/**/*`；源码不进安装包。
- `asar:true`（若原生模块允许）；至少把可读源码排除。
- 用 `electron-builder` 的 `extraResources` 明确列出 packs。

#### 验收

- 安装包 < 250MB（目标；当前远大于 1GB）。
- 首次启动不复制 603MB；只解包用户打开的书。
- 安装目录不含 `src/`。
- 干净构建产物哈希可复现。

---

## 5. P1 问题详述

### P1-01 Starlight 被当成阅读器，框架倒置是复杂度总根源

**定位**

- [`astro.config.mjs`](../../astro.config.mjs#L168-L206)：`customCss` 顺序 + 13 个 `componentOverrides`。
- [`HeaderOverride.astro`](../../src/components/HeaderOverride.astro)：626 行，`:70-185` 大量 `vp-*` 类名。
- [`theme.css`](../../src/themes/material-you/theme.css)：6,623 行 / 3,511 个 `!important`。
- [`reader-shell-template.ts`](../../src/services/content-provider/reader-shell-template.ts)：1,414 行，复制 Starlight 壳。
- [`PageSidebarOverride.astro`](../../src/components/PageSidebarOverride.astro#L511-L512)：静态导入 `sideloadManager` 与 `translation-dock-controller`。

**具体逻辑**

1. 项目用 Starlight 做文档站，但把 Header、Sidebar、PageSidebar、Pagination、Footer、PageFrame、PageTitle、SocialIcons、TwoColumnContent、Head、MarkdownContent、Search、ThemeSelect 全部替换。
2. 阅读器需要多标签、分屏、ABP、侧载、双语、AI；这些不是 Starlight 的领域模型，于是只能用 1,414 行模板“合成”整页。
3. `theme.css` 用 3,511 个 `!important` 覆盖 Starlight 默认样式；`HeaderOverride` 还保留 `vp-*` 旧类名。
4. 结果是任何 Starlight 升级、Astro 升级、路由变化都会同时影响阅读器；Web/Electron 两套壳更难收敛。

**判断**

这不是“深度定制”，是“框架倒置”。继续在 Starlight 上打补丁，复杂度只会更高。

**建议**

- Starlight 只保留 `/dev`、`/guides`、`/reference` 文档路由，不再承担阅读器。
- 阅读器用独立 `ReaderLayout.astro` + `src/components/m3`；删除 reader 相关 overrides 与 `reader-shell-template`。
- 这是本文最重要的破坏性决策；不做这一条，后面的路由/壳收敛会反复。

**验收**

- 阅读器不依赖任何 Starlight 组件/类名。
- `rg "vp-" src/components` 为 0（或只在归档）。
- `theme.css` 不再包含阅读器布局覆盖。
- 文档站与阅读器可独立构建、独立升级。

---

### P1-02 设置面板双实现 + God controller

**定位**

- [`FeatureToggles.astro`](../../src/components/FeatureToggles.astro)：838 行；`:41` `<starlight-feature-toggles>`；`:441-847` 大量 `data-feature-id`；`:102,236,409,441...` 原生 `<input type="checkbox">`。
- [`SettingsHubContent.astro`](../../src/components/desktop/SettingsHubContent.astro)：1,831 行；`:148-394`、`:409-888` 两段 `<starlight-feature-toggles>`；`:507-879` 重复的开关；`:1145-1152` 调 `initFeatureToggles()`。
- [`feature-toggles.ts`](../../src/scripts/feature-toggles.ts)：1,819 行；`:363`、`:434` 选择 `.ft-panel, starlight-feature-toggles`；`:604-620` 应用 `[data-feature]`。

**具体逻辑**

1. 两套面板各自输出一份 `<starlight-feature-toggles>`，内部开关 ID/面板结构大量重复。
2. `FeatureToggles` 用原生 checkbox；`SettingsHubContent` 也大量原生 checkbox，违反 AGENTS 的 M3 `md-switch` 规范。
3. 两套都调用 `initFeatureToggles()`；后者用全局 selector 遍历 `.ft-panel, starlight-feature-toggles`，同一页面有多个宿主时会重复绑定/互相覆盖。
4. `feature-toggles.ts` 同时负责：localStorage、主题、字体、AI provider、翻译 provider、引用联动、低性能模式、编辑器开关。它是全站设置的单点 God controller。

**影响**

- 同一开关在两处显示不同状态/不同默认值。
- M3 设计系统被绕过；可访问性/键盘行为不一致。
- 新增一个设置要改 3 个文件，且容易漏掉一处。

**建议**

- 一个 `features/settings`：`settings-registry.ts`（声明式面板/开关）+ `SettingsSurface.astro`（唯一 UI）。
- `FeatureToggles` / `SettingsHubContent` 变成 thin wrapper，最终删除。
- 开关统一用 `md-switch`；设置持久化走 `SettingsStore`，不再散落 localStorage key。
- `feature-toggles.ts` 拆成 `settings-store` / `settings-apply` / `settings-panel`。

**验收**

- 全站只有一个设置入口、一份面板 HTML。
- 重复 `data-feature-id` 为 0。
- 原生 `input[type=checkbox]` 在设置面板为 0（除兼容层）。
- 单文件 < 600 行。

---

### P1-03 Header 双实现 + 死组件

**定位**

- [`HeaderOverride.astro`](../../src/components/HeaderOverride.astro)：626 行，`:70-185` 使用 `vp-header-inner`、`vp-brand-wrapper`、`vp-sidebar-toggle-btn`、`vp-right-group` 等。
- [`M3TopNavBar.astro`](../../src/components/m3/M3TopNavBar.astro)：519 行；只被 `library.astro:4,125` 与 `sitemap.astro:15,205` 使用。
- [`HeaderToolsMenu.astro`](../../src/components/HeaderToolsMenu.astro)：326 行；全项目只有自身引用（`:265,320,322,324`），零 import。
- [`FontSelectOverride.astro`](../../src/components/FontSelectOverride.astro)：381 行；只有自身与注释提到，零 import；`ThemeSelectOverride.astro:10` 的注释还声称它“作为兄弟组件一并输出”，与事实不符。
- [`VpNav.astro`](../../src/components/VpNav.astro)：向后兼容代理，仍转发到 `M3TopNavBar`。

**具体逻辑**

1. Starlight 页面用 `HeaderOverride`；library/sitemap 用 `M3TopNavBar`；`VpNav` 又是第三层代理。
2. 两套 Header 的按钮、断点、主题切换、搜索入口各自实现。
3. `HeaderToolsMenu` / `FontSelectOverride` 是早期设计的残留，已经没有任何渲染入口，但仍占用维护注意力。
4. `HeaderOverride` 同时承担全局设置、侧栏、翻译、透镜、搜索等入口，是 UI 层的 God component。

**建议**

- 一个 `ui/AppHeader`（桌面/移动/阅读器三种 variant），内部组合 M3 原语。
- `HeaderOverride` 最终只作为 Starlight 文档页的薄适配器，或删除。
- `HeaderToolsMenu` / `FontSelectOverride` 直接删除；字体选择并入 settings。
- `VpNav` 删除；所有页面直接 import `M3TopNavBar` 或 `AppHeader`。

**验收**

- 全站只有一个 Header 实现。
- `HeaderToolsMenu` / `FontSelectOverride` / `VpNav` 零引用后删除。
- Header 的交互（搜索、主题、设置、侧栏）有统一事件契约。

---

### P1-04 Library UI 双实现

**定位**

- [`src/pages/library.astro`](../../src/pages/library.astro)：330 行；`:43-75` 读 catalog；`:228-256` 卡片/动作；`:317` 详情对话框。
- [`src/scripts/pages/library-client.ts`](../../src/scripts/pages/library-client.ts)：315 行；`:217-220` 只设置 `href`；`:234-281` 安装状态；`:269-273` 下载 `.abp` 并安装。
- [`src/components/desktop/FragmentLibrary.astro`](../../src/components/desktop/FragmentLibrary.astro)：563 行；`:306-315` bridge/API 双分支；`:390-395` 安装；`:407-447` ingest upload/parse。

**具体逻辑**

1. Web 书库和桌面书库各自实现筛选、卡片、安装、详情、上传。
2. `FragmentLibrary` 同时处理 `/api/library/*`、`/api/ingest/*`、`window.astrolib` 三条路径；Web/Electron 行为分叉。
3. `library-client` 只负责 Web 页面的安装状态；桌面壳不共用。
4. 两套 UI 都依赖同一个“未统一”的书库后端（P0-06），所以任何后端改动要改多处。

**建议**

- 一个 `features/library/ui`：`BookGrid`、`BookCard`、`FilterBar`、`InstallButton`、`BookDetail`。
- Web/Electron 只注入 `LibraryClient` 适配器（IndexedDB/FS/HTTP）。
- 删除 `library-client` 与 `FragmentLibrary` 的重复 DOM/事件；保留一个壳。
- 上传/ ingest 入口归 `features/ingest`，不要塞进 library。

**验收**

- 书库卡片/筛选/安装只有一份实现。
- Web/Electron 的安装状态由同一个 repository 事件驱动。
- 删除任一端时不需要复制另一份 UI。

---

### P1-05 God controller 密度过高，且缺少单元测试保护

**定位**

| 文件 | 行数 | 主要职责 |
|---|---:|---|
| [`chat-controller.ts`](../../src/ai/client/chat-controller.ts) | 2,230 | DOM、会话、工具调用、检索、渲染、设置 |
| [`exercise-controller.ts`](../../src/components/exercises/exercise-controller.ts) | 2,213 | 题库、判题、渲染、导出、事件 |
| [`translation-dock-controller.ts`](../../src/services/translation/client/translation-dock-controller.ts) | 1,925 | 翻译、对齐、缓存、导出、侧栏 |
| [`SettingsHubContent.astro`](../../src/components/desktop/SettingsHubContent.astro) | 1,831 | 所有设置面板 + 样式 + 初始化 |
| [`feature-toggles.ts`](../../src/scripts/feature-toggles.ts) | 1,819 | 所有设置状态 + 应用 |
| [`editor-controller.ts`](../../src/features/mdx-editor/client/editor-controller.ts) | 1,699 | 编辑器、AST、保存、预览 |
| [`ingest-controller.ts`](../../src/pages/workspace/ingest-controller.ts) | 1,650 | 上传、轮询、解析、渲染 |
| [`reader-shell-template.ts`](../../src/services/content-provider/reader-shell-template.ts) | 1,414 | 整页 HTML 合成 |
| [`exercise-sidebar-controller.ts`](../../src/components/exercises/exercise-sidebar-controller.ts) | 1,271 | 习题侧栏 |
| [`exercise-export-pipeline.ts`](../../src/components/exercises/exercise-export-pipeline.ts) | 1,144 | 导出 |

**具体逻辑**

- 这些文件普遍同时做：`querySelector` / 事件绑定 / fetch / 状态机 / 渲染 / localStorage / 错误处理。
- 大多数没有被单元测试直接覆盖；测试更偏向 contract/acceptance，无法定位控制器内部状态错误。
- 任何小改动都可能影响多个功能；review 成本极高。

**建议**

- 每个 controller 按 `state` / `view` / `effects` 切开；先抽纯函数，再抽 store，再抽 renderer。
- 为状态迁移写 unit test（不依赖 DOM）。
- 把“设置应用”从 UI controller 中移出，改为订阅 store。
- 设定单文件 600 行预算；超过必须拆分。

**验收**

- Top 10 controller 每个 < 600 行（或明确豁免并记录原因）。
- 状态机有 unit test；DOM 渲染有至少一个 smoke test。
- `rg "querySelector|addEventListener"` 不再出现在业务 service 中。

---

### P1-06 依赖方向倒置：services→components、utils→server、features→translation/bilingual、electron→dev plugin

**定位**

- [`src/utils/sidebar.ts`](../../src/utils/sidebar.ts#L1-L3)：`import { generateStarlightBookSidebar } from '../server/adapters/starlight-sidebar.mjs';`
- [`src/utils/sidebar/sidebar-tree.ts`](../../src/utils/sidebar/sidebar-tree.ts#L1)：`import { cleanSlug } from '../sidebar.mjs';`
- [`src/services/bilingual/in-page-compare-controller.ts`](../../src/services/bilingual/in-page-compare-controller.ts#L15-L17)：导入 `components/sidebar`、`components/sideload`。
- [`src/services/translation/client/translation-dock-controller.ts`](../../src/services/translation/client/translation-dock-controller.ts#L15)：导入 `components/sideload/sideload-manager`。
- [`src/features/scratchpad/client/scratchpad-controller.ts`](../../src/features/scratchpad/client/scratchpad-controller.ts#L18-L31)：导入 sideload、translation、mermaid、font presets、bilingual。
- [`electron/services/library-manager.ts`](../../electron/services/library-manager.ts#L22)：从 `src/server/plugins/doc-ingestion/task-manager.ts` 导入 `TaskManager`。

**具体逻辑**

1. `utils` 应该是纯函数，但 `sidebar.ts` 把 `book-catalog` 和 `node:fs` 拉进依赖图。
2. `services` 应该是无 UI 的基础设施，却依赖 `components` 的 DOM 状态。
3. `features/scratchpad` 直接依赖另外两个 feature/service 的内部实现，而不是公共契约。
4. Electron 主进程依赖 dev-server 插件，导致 `TaskManager` 的 Node/HTTP 逻辑被打进桌面端。

**建议**

- 用 dependency-cruiser / ESLint `no-restricted-imports` 固化方向：
  - `utils` 不得 import `server` / `components` / `features`；
  - `services` 不得 import `components`；
  - `publishing` 不得 import `components` / `features` / `app`；
  - `electron` 不得 import `src/server/plugins`；
  - feature 之间只通过 `index.ts` 公共 API。
- `cleanSlug` 留在 `utils/slug.ts`；客户端直接 import，不再经过 `sidebar.ts`。
- `starlight-sidebar` 移到 build-only 目录，或删除。

**验收**

- 依赖检查进 CI。
- `rg "from ['\"].*components" src/services` 为 0。
- `rg "from ['\"].*server" src/utils` 为 0。
- Electron 构建不再包含 `src/server/plugins`。

---

### P1-07 CSS `!important` 军备竞赛与重复导入

**定位**

- `src/**/*.css`：33,248 行，6,189 个 `!important`（采样）。
- [`theme.css`](../../src/themes/material-you/theme.css)：6,623 行，3,511 个。
- [`exercise-m3.css`](../../src/styles/components/exercise-m3.css)：2,688 行，1,517 个；只被 `blank.astro` 导入。
- [`exercise-theme.css`](../../src/components/exercises/exercise-theme.css)：3,362 行，113 个；被 `ExerciseModal` 导入。
- [`custom.css`](../../src/styles/custom.css#L1-L9)：`@import './tokens/layers.css'`、`@import './components/bilingual-reader.css'`。
- [`astro.config.mjs`](../../astro.config.mjs#L174-L179)：又 push `layers.css`、`custom.css`、`bilingual-reader.css`。
- [`theme.css`](../../src/themes/material-you/theme.css#L1)：`@import './tokens.css'`；`desktop.astro:21-22`、`hub.astro:15-16` 又各自 import `tokens.css` + `theme.css`。

**具体逻辑**

1. 同一个 `layers.css` / `bilingual-reader.css` 被 `custom.css` 和 Astro 配置各引入一次。
2. `theme.css` / `tokens.css` 在多个 shell 重复 import。
3. 两套习题主题（`exercise-m3.css` / `exercise-theme.css`）覆盖范围不同，加载页面不同。
4. 每加一个组件样式，为了压过旧规则就再加 `!important`；6,189 个之后已经无法推断层叠结果。

**建议**

- 按 `tokens → base → components → features → overrides` 分层；每个 feature 只 import 自己的 CSS。
- `custom.css` 只保留真正的全局规则；删除与 Astro 配置重复的 `@import`。
- 合并习题主题；`exercise-m3.css` 只在明确需要时加载，或删除。
- 目标 `!important` < 300；新增 `!important` 需要 lint 豁免/注释。

**验收**

- `!important` 总数 < 300。
- `custom.css` 与 `astro.config.mjs` 不再重复导入同一文件。
- 习题/双语/AI 样式各自只有一份入口。
- 视觉回归通过。

---

### P1-08 Feature Isolation 只覆盖小模块，最大的业务仍在 `components/`

**定位**

`src/features` 只有 5 个模块（约 12,659 行）：

- `mdx-editor` 3,582
- `module-inspector` 2,697
- `relation-graph` 2,161
- `scratchpad` 2,182
- `search-rec` 2,037

而 `src/components` 下：

- `exercises` 9,258 行
- `ai` 2,490
- `sidebar` 2,336
- `desktop` 3,088
- `bilingual` 456
- `publishing` 205

**具体逻辑**

- AGENTS Rule 6 要求业务 feature 的高内聚边界；实际最大的 exercises/AI 仍在 `components/`。
- `features` 里的 `scratchpad` 又反向依赖 `services/translation` 与 `services/bilingual`，边界并不干净。
- `features/search-rec/index.ts` 存在但零引用；实际消费者直接 import `core/engine` 等内部路径，barrel 形同虚设。

**建议**

- 把所有业务 UI 从 `components/` 迁到 `features/<name>/{ui,application,domain,adapters,index.ts}`。
- `src/components` 只保留 `ui/m3` 与 Starlight 适配器。
- 每个 feature 只暴露 `index.ts`；禁止跨 feature 直接 import `client/` / `core/` 内部文件。

**验收**

- `components/exercises`、`components/ai`、`components/bilingual` 迁移完成。
- 跨 feature 深层 import 为 0。
- 每个 feature 有独立测试与入口。

---

### P1-09 AI / 翻译 / 检索存在完整重复栈

**定位**

| 子域 | 重复实现 |
|---|---|
| AI 模型目录 | [`ai-config.ts`](../../src/ai/ai-config.ts#L115-L266) 的 `DEFAULT_AI_PROVIDERS`；[`features.config.ts`](../../src/config/features.config.ts#L224-L244) 的 `aiAsk.config.models` |
| 工具定义 | [`tools-client.mjs`](../../src/ai/tools-client.mjs#L64-L171) 7 个客户端工具；[`mcp/tools.mjs`](../../src/ai/mcp/tools.mjs#L94-L271) 8 个 Node 工具（含 `python_exec`） |
| 检索 | [`ai/retriever.mjs`](../../src/ai/retriever.mjs#L29-L154) BM25/关键词；[`search-rec/core/engine.ts`](../../src/features/search-rec/core/engine.ts#L9-L119) exact/fuzzy/dense/graph + RRF + MMR + ranker |
| 翻译 | [`api/translate.ts`](../../api/translate.ts#L9-L23) 540 行自包含实现；[`src/services/translation/providers`](../../src/services/translation/providers) 4 个 provider；[`src/server/plugins/translation`](../../src/server/plugins/translation) `/api/translate`；`gemini-proxy` / `bupt-proxy` 两个独立 SSE 代理 |
| 词典 | [`dictionary-service.ts`](../../src/services/dictionary/dictionary-service.ts) 566 行；`api/translate.ts:327` 又有 `fetchGoogleDictForWord` |
| 双语对齐 | `src/services/bilingual` + `src/server/plugins/bilingual-aligner` 的 ONNX/Qwen 两套引擎 + Python runner |

`api/translate.ts:9` 的注释明确说“独立自包含，零外部相对导入，杜绝 Vercel 打包崩溃”。这是用**复制 540 行**来规避打包问题；正确做法是抽一个可被打包的 `translation-core`。

**具体逻辑**

1. 模型 ID 在两处各写一份，且包含 `gemini-3.8-flash`、`deepseek-v4-pro` 等未验证/虚构条目。
2. 客户端工具与 MCP 工具同名但 schema/实现不同；`mcp/tools.mjs:27` 仍指向已删除的 `src/content/docs/collections`，无运行入口。
3. chat 用 `ai/retriever`，搜索 UI 用 `search-rec`；同一 query 两个打分体系。
4. 翻译 API/Node 插件/客户端 provider 各自决定 provider 列表、超时、批处理；词典又重复抓取。
5. 双语 ONNX/Qwen 两套引擎各自处理对齐，UI 与 service 交叉依赖。

**建议**

- 一个 `features/ai/models.ts`；删除 `features.config.ts` 的重复 models。
- 一个 `tool-registry`；客户端/MCP 只是 transport。
- 一个 `RetrievalService`；chat/search 共用。
- 一个 `translation-core`；Vercel handler 与 Node 插件都 import 它。
- 一个 dictionary adapter；一个 `AlignmentService`，ONNX/Qwen 只是 engine adapter。

**验收**

- 模型目录只有一份；所有 ID 有真实 endpoint/可用性说明。
- 工具 schema 单测通过；客户端/MCP 行为一致。
- 同一 query 在 chat/search 的 topK 结果一致。
- `api/translate.ts` < 150 行（薄 handler）。

---

### P1-10 Publishing 遗留与边界污染

**定位**

- [`src/publishing/latex/latex-generator.ts.bak`](../../src/publishing/latex/latex-generator.ts.bak)：1,508 行。
- [`src/publishing/latex/templates/astrolib-chapter.sty.bak`](../../src/publishing/latex/templates/astrolib-chapter.sty.bak)：379 行。
- [`src/publishing/typst/typst-generator.ts`](../../src/publishing/typst/typst-generator.ts)：343 行；只有 Typst 测试引用，无运行入口。
- [`src/publishing/client/chapter-export-controller.ts`](../../src/publishing/client/chapter-export-controller.ts)：474 行；UI controller 位于 headless publishing 内。
- [`src/publishing/common/mdx-chapter-parser.ts`](../../src/publishing/common/mdx-chapter-parser.ts)：695 行；与 `pack-book-abp`/EPUB 的 parser 并存。
- [`scripts/export-chapter-latex.mjs`](../../scripts/export-chapter-latex.mjs)：CLI 与 `src/publishing/latex` 重复。

**具体逻辑**

1. `.bak` 是历史备份，不是源码；会误导 grep/agent/新人。
2. `typst-generator.ts` 没有 runtime 入口；如果 Typst 不是产品能力，测试是在维护死代码。
3. `publishing/client` 把 DOM/UI 带进 headless 层，违反 Rule 2。
4. `mdx-chapter-parser` 是第三套语义解析器，与 compiler 目标冲突。
5. CLI 与库内 generator 各自处理参数/资源，容易漂移。

**建议**

- 删除 `.bak`。
- 若 Typst 保留：补 CLI/运行入口与验收；否则删除 generator + tests。
- `publishing/client` 移到 `features/publishing`；`src/publishing` 只保留纯编译器。
- `mdx-chapter-parser` 合并进 `ContentCompiler`；LaTeX emitter 只消费 IR。
- CLI 变薄，调用库内 API。

**验收**

- `find src -name '*.bak'` 为 0。
- `publishing` 不 import `components` / `features` / DOM。
- Typst 有明确 runtime 入口，或完全删除。
- LaTeX/EPUB 使用同一 IR。

---

### P1-11 类型契约被 `| string` / `any` 削弱

**定位**

- [`src/types/collections.ts`](../../src/types/collections.ts#L13-L17)：
  - `BookStage = 'high-school' | ... | string`
  - `BookCategory = 'textbook' | ... | string`
  - `emoji?: string`
- [`src/types/content-package.ts`](../../src/types/content-package.ts#L65-L69)：
  - `crossRefs?: Record<string, any>`
  - `exercises?: any[]`
  - `aiChunks?: any[]`
- [`src/types/library-entity.ts`](../../src/types/library-entity.ts#L37-L56)：`metadata` 是可选字段大杂烩（book/paper 字段混在一起）。
- `content-package.ts` 没有运行时 schema validator。

**具体逻辑**

1. `| string` 让联合类型坍缩为 `string`，IDE 不再提示合法值，拼写错误不会被类型检查发现。
2. `any` 让 ABP 最关键的 crossRefs/exercises/aiChunks 失去约束；编译器/reader 各自假设字段。
3. `metadata` 可选包允许 `kind: 'book'` 同时带 `taskId`、`doi`，非法状态可表示。
4. 没有 runtime validator，外部 `.abp` 可以带任意结构；错误延迟到渲染时。

**建议**

- 删除 `| string`；需要扩展时用显式 union 或 `string & {}` 的 branded 方案。
- 为 crossRefs/exercises/aiChunks 定义具体接口；至少 `unknown` + zod parse。
- `UnifiedReadingEntity` 改为 discriminated union：`BookEntity | PaperEntity | SlideEntity | VideoEntity`。
- ABP manifest/payload 用 zod/valibot 在安装/编译入口校验。

**验收**

- `rg "\\| string" src/types` 为 0（除有意兼容）。
- `rg ": any" src/types/content-package.ts` 为 0。
- 非法 ABP 在安装时被拒绝，而不是渲染时崩。
- 类型测试覆盖 book/paper 的非法组合。

---

### P1-12 生成物/测试/CI/文档治理失效

**定位**

- 旧路径引用：130 行 / 72 文件（含 docs/tests/scripts）。
- `.mjs` 引用：95 行 / 59 文件；8 个一行 `export * from './*.ts'` 垫片。
- CI：[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml#L24-L80) 只有 typecheck、`npm test`、`test:system`；**没有 `astro build` / 路由 smoke / 干净 clone build**。
- Release：[`.github/workflows/electron-release.yml`](../../.github/workflows/electron-release.yml#L40-L54) 先测试后构建，无 pack。
- Acceptance：`tests/acceptance/abp-dynamic-serving.test.ts:13-14` 依赖未跟踪 `.abp`；`tests/fixtures/runtime-abp-serving` 17.7MB 未跟踪，含 `.cache`。
- AGENTS：声称 `.mjs` obsolete、legacy themes 删除、0 TS errors、Rule 10 禁止 big-bang；实际代码仍大量 `.mjs`、`vp-*`、当前工作树 5,646 删除。

**具体逻辑**

1. 规则只写在 AGENTS，没有 lint/CI 强制；代码自然漂移。
2. 测试依赖本机生成物，干净 clone 无法复现；CI 不跑构建，路由/渲染回归无法被发现。
3. 生成物没有 provenance，旧文件不会被清理；空转脚本继续“成功”。
4. 文档引用已删除路径，新 agent 会按旧路径修改，制造更多漂移。

**建议**

- CI 增加：`npm run build`、`node tooling/check-routes.mjs`、干净 clone acceptance、依赖边界检查。
- 生成物统一到 `generated/` 或 `artifacts/`，带 `generatedBy/sourceHash`；旧输出构建前清理。
- 测试 fixture 在 setup 中生成；不提交 17.7MB 运行时状态。
- AGENTS 每条规则配一个可执行检查；没有检查的规则不算规则。
- 旧路径引用清零后再删除迁移文档中的旧段落。

**验收**

- 干净 clone `npm ci && npm run build && npm test` 通过。
- CI 能在路由 404 时失败。
- `rg "src/content/docs/collections" src scripts tests` 为 0。
- 8 个 `.mjs` 垫片删除，import 改为 `.ts` 或统一 facade。

---

### P1-13 运行时小缺陷

| 问题 | 定位 | 说明 |
|---|---|---|
| Sideload `focus` 重复注册 | [`sideload-manager.ts`](../../src/components/sideload/sideload-manager.ts#L77-L88) | 先 `wide` 再 `medium`，后者覆盖前者；实际宽度与 AGENTS 的 `wide:24.5rem` 不符 |
| 宽度阶梯漂移 | 同文件 `:34-39` | `medium:22rem`、`wide:clamp(...)`，没有 `full:28rem`；与 AGENTS 第 7.2 节不一致 |
| `sitemap` 空 | [`sitemap.astro`](../../src/pages/sitemap.astro#L23-L27) | 空 collections + 已删除路径；0 章 |
| 首页重定向死路 | [`index.astro`](../../src/pages/index.astro#L16-L20) | 直接跳 `/desktop/`；Web 无阅读路由 |
| `library.astro` 构建期 `fs.existsSync` | [`library.astro`](../../src/pages/library.astro#L43-L45) | 静态构建可用；未来 SSR/Edge 会崩 |
| `PageSidebar` 静态导入翻译控制器 | [`PageSidebarOverride.astro`](../../src/components/PageSidebarOverride.astro#L511-L512) | 侧栏组件拉入翻译/侧载重模块，首屏成本高 |
| `getStorageStats` 假数据 | [`web-provider.ts`](../../src/services/content-provider/web-provider.ts#L341-L352) | 见 P0-07 |
| `DesktopBookManager` 非原子写 | [`book-manager.ts`](../../electron/services/book-manager.ts#L101-L143) | 先写 manifest 再写章节；中途失败留下半本书 |
| `DesktopBookManager` 无路径校验 | 同文件 `:120-125` | `relPath` 直接拼到 bookDir；架构上应统一 asset resolver（安全另议） |
| `DesktopLibraryManager` 默认书架重复 | [`library-manager.ts`](../../electron/services/library-manager.ts#L74-L76) | 与 HTTP 插件各一份 |
| `main.ts` 清空 `.cache` | [`main.ts`](../../electron/main.ts#L367-L376) | 每次启动删全部合成缓存，首次阅读变慢；应由版本/provenance 失效 |
| `main.ts` 全量复制 packs | 同文件 `:397-433` | 见 P0-09 |

---

## 6. 冗余资产总账

### 6.1 零引用 / 纯备份文件（可直接进入删除清单）

| 文件 | 规模 | 证据 | 处置 |
|---|---:|---|---|
| [`HeaderToolsMenu.astro`](../../src/components/HeaderToolsMenu.astro) | 326 行 | 全项目只有自身引用；无 import | 删除；功能并入统一 Header |
| [`FontSelectOverride.astro`](../../src/components/FontSelectOverride.astro) | 381 行 | 只有自身与注释；`ThemeSelectOverride:10` 注释与事实不符 | 删除；字体选择并入 settings |
| [`BilingualSplitReader.astro`](../../src/components/bilingual/BilingualSplitReader.astro) | 114 行 | 只有自身引用 | 删除；双语阅读由 controller + 统一布局承担 |
| [`src/scripts/pages/index-client.ts`](../../src/scripts/pages/index-client.ts) | 121 行 | 首页改写后零引用 | 删除 |
| [`typst-generator.ts`](../../src/publishing/typst/typst-generator.ts) | 343 行 | 只有 Typst 测试引用，无运行入口 | 若 Typst 不是产品能力：连测试一起删；若是：补 CLI/入口 |
| [`latex-generator.ts.bak`](../../src/publishing/latex/latex-generator.ts.bak) | 1,508 行 | `.bak`，无引用 | 删除 |
| [`astrolib-chapter.sty.bak`](../../src/publishing/latex/templates/astrolib-chapter.sty.bak) | 379 行 | `.bak`，无引用 | 删除 |
| [`src/ai/mcp`](../../src/ai/mcp) | 约 300 行 | 无 package script/运行入口；`tools.mjs:27` 指向已删除路径 | 若不发布 MCP：删除；若发布：改为统一 tool registry 适配器 |
| `src/features/search-rec/index.ts` | 2 行 barrel | 零引用 | 删除或强制统一从 barrel 导入 |
| `src/components/m3/index.ts` | 2 行 barrel | 零引用 | 同上 |

仅这些约 **3,100 行**死代码/备份，不含重复实现。

### 6.2 同一职责多实现

| 职责 | 现有实现 | 冲突点 | 目标 |
|---|---|---|---|
| 设置面板 | `FeatureToggles` + `SettingsHubContent` + `feature-toggles.ts` | 两套面板 HTML、两套初始化、原生 checkbox vs md-switch | 一个 `features/settings` |
| Header | `HeaderOverride` + `M3TopNavBar` + `VpNav` + `HeaderToolsMenu` | `vp-*` vs M3；一层代理；一套死代码 | 一个 `ui/AppHeader` |
| Library UI | `library.astro` + `library-client` + `FragmentLibrary` | 两套筛选/书架/上传逻辑 | 一个 `features/library/ui` |
| Reader shell | `reader-shell-template` + `StaticHandler.synthesizeAbpHtml` + Astro reader | 三套 HTML 生成/服务路径 | 一个 `ReaderLayout` + ABP runtime |
| 内容编译 | Astro unified + `pack-book-abp` marked + EPUB unified + publishing parser + doc-ingestion compiler | 五套解析/渲染；slug 四套 | 一个 `ContentCompiler` + IR + emitters |
| 目录 | `sourceCollections` + `catalog-registry` + `public/catalog` + `book-catalog` FS 扫描 | 12 vs 13；空数组；旧路径 | 一个人工 catalog + 一个生成 projection |
| 平台存储 | Web Provider + Electron Provider + DesktopBookManager + DesktopLibraryManager + library plugin | 双写、回退、HTTP 结构错误 | 一个 `LibraryRepository` + adapters |
| 翻译 | providers + `api/translate.ts` + `server/plugins/translation` + proxies | 540 行复制；CORS/凭据/模型逻辑漂移 | 一个 `translation-core` + 薄 handler |
| 词典 | `dictionary-service` + `api/translate` 的 Google dict | 同一种抓取两份 | 一个 dictionary adapter |
| 检索 | `ai/retriever.mjs` + `search-rec` | 两套打分/索引 | 一个 `RetrievalService` |
| 工具 | `tools-client.mjs` + `mcp/tools.mjs` | 同名工具两套 schema | 一个 tool registry + 两个 transport |
| 双语对齐 | services/bilingual + server plugin + components/bilingual | ONNX/Qwen 两套引擎、UI 与 service 交叉 | 一个 `AlignmentService` + engines |
| 习题 CSS | `exercise-theme.css` + `exercise-m3.css` | 两套主题，1,517 个 `!important` 只在 blank 页加载 | 一个 feature 样式 |
| Library CSS | `desktop/library.css` + `reader-host.css` + `pages/library.css` | 三套布局/卡片样式重叠 | 一个 library feature 样式 |

### 6.3 生成物与构建残留

| 路径 | 体量 | 现状 | 处置 |
|---|---:|---|---|
| `public/abp-packs` | 603.1MB / 8,184 文件 | 仅 612 个被 Git 跟踪；展开目录 + `.abp` + 图片 + 缓存混在一起 | 生成到 `artifacts/abp/` 或 `dist/abp/`，构建时生成，gitignore |
| `public/data` | 97.2MB / 930 文件 | 生成物，0 tracked | 移到 `artifacts/` |
| `public/ai-index` | 13.6MB / 12 文件 | 生成物，缺 graph theory | 由编译器生成 |
| `public/inspector-data` | 10.9MB / 13 文件 | 生成物，与当前 13 本不同步 | 同上 |
| `public/relation-graphs` | 3.8MB / 12 文件 | 生成物，缺 graph theory | 同上 |
| `public/epub` | 33.8MB / 6 文件 | 生成物，旧书 | 同上 |
| `dist` | 800.5MB | Astro + public 拷贝 + ABP 展开 | 构建产物；不参与源结构 |
| `release` | 3.6GB | Electron 打包产物 | 清理/保留最近一个 |
| `test` | 517MB | 测试数据/输出 | 只保留 `tests/`；旧 `test/` 清理 |
| `task` | 419.7MB | MinerU 任务残留 | 清理；gitignore |
| `.tmp` | 318.6MB / 3,928 文件 | LaTeX/编译/ingest 临时文件 | 清理；运行时用 `os.tmpdir()` |
| `backup` / `.backups` | 143MB / 57MB | 手工备份 | 清理，改为 Git/对象存储 |
| `tests/fixtures/runtime-abp-serving` | 17.7MB / 274 文件 | 未跟踪运行时 fixture，含 `.cache` | 测试 setup 临时生成 |

### 6.4 构建脚本处置表

| 脚本 | 现状 | 处置 |
|---|---|---|
| [`build-ai-index.mjs`](../../scripts/build-ai-index.mjs) | 空 `collections`，打印 0 本后成功 | 重写为 catalog 驱动；空输入失败，除非 `--allow-empty` |
| [`build-relation-graphs.mjs`](../../scripts/build-relation-graphs.mjs) | 空转，旧数据 12 本 | 重写；或作为编译器 emitter |
| [`build-cross-ref-data.mjs`](../../scripts/build-cross-ref-data.mjs) | 空转，旧数据 12 本 | 同上 |
| [`build-inspector-data.mjs`](../../scripts/build-inspector-data.mjs) | 空转，旧数据缺 graph theory | 同上 |
| [`build-offline-pack.mjs`](../../scripts/build-offline-pack.mjs) | 空集合直接跳过，`dist/collections` 不存在 | 由 reader 路由生成离线页；没有输入就失败 |
| [`generate-epub.mjs`](../../scripts/generate-epub.mjs) | `readdirSync` 已删除目录，ENOENT | 改为调用 `EpubEmitter`；从 IR/ABP 生成 |
| [`build-exercise-data.mjs`](../../scripts/build-exercise-data.mjs) | 可用，但硬编码两本书 | 改为 catalog 驱动；否则明确它是“两本特例” |
| [`pack-book-abp.mjs`](../../scripts/pack-book-abp.mjs) | 可用，但正则 + marked + 非原子写 + 每次 `updatedAt` 变化 | 替换为编译器 CLI；输出原子化、可复现 |

### 6.5 逻辑冗余（同一规则多个版本）

1. **slug 规则**：`slug.ts`、pack 脚本、EPUB 脚本、static-handler 各一套。
2. **目录规则**：`sourceCollections`、catalog-registry、public catalog、`book-catalog.mjs` 各一套。
3. **安装规则**：Web Provider、Electron BookManager、library plugin 各一套；HTTP 版还写错 `chapters/`。
4. **书库规则**：DesktopLibraryManager 与 library plugin 各自维护默认书架、registry 路径、entity 形状。
5. **设置规则**：FeatureToggles 与 SettingsHub 各自决定哪些开关可见、如何持久化。
6. **Header 规则**：两套按钮、两套响应式断点、两套主题切换。
7. **检索规则**：chat 与 search UI 各自决定 topK、分词、打分。
8. **翻译规则**：API、Node 插件、客户端 provider 各自决定 provider 列表、超时、批处理。
9. **工具 schema**：客户端与 MCP 各一份。
10. **构建真值**：空数组、catalog、ABP manifest 三者没有校验关系。

### 6.6 一行 `.mjs` 垫片清单（8 个）

这些文件只有一行 `export * from './*.ts'`，本身不含逻辑；它们的作用是让旧 `.mjs` import 继续工作，但也让“已经 TypeScript 化”的迁移看起来没完成。

| 垫片 | 转出目标 | 处置 |
|---|---|---|
| `src/config/collections.config.mjs` | `./collections.config.ts` | 消费者改 import `.ts` 后删除 |
| `src/config/features.config.mjs` | `./features.config.ts` | 同上 |
| `src/config/notices.config.mjs` | `./notices.config.ts` | 同上 |
| `src/config/themes.config.mjs` | `./themes.config.ts` | 同上 |
| `src/utils/natural-sort.mjs` | `./natural-sort.ts` | 同上 |
| `src/utils/render-title.mjs` | `./render-title.ts` | 同上 |
| `src/utils/sidebar.mjs` | `./sidebar.ts` | 先拆掉 `sidebar.ts` 的 server 依赖，再删除 |
| `src/utils/slug.mjs` | `./slug.ts` | 客户端直接 import `slug.ts` 后删除 |

处置原则：先改 import，再删垫片；不要先删垫片再补 59 个文件的 import。

---

## 7. 目标架构：双壳 + 内容内核

### 7.1 六个不可逆决策

**决策 A：Starlight 只做文档站，不再做阅读器。**
`/dev`、`/guides`、`/reference` 保留 Starlight；阅读器用独立 `ReaderLayout` + M3。删除 reader 相关 Starlight overrides 和 `reader-shell-template`。

**决策 B：MDX 只是 authoring 格式，ABP 是运行态契约。**
作者写 MDX；编译器产出 `ContentDocument` IR；Web、Electron、EPUB、LaTeX 都消费 IR 或 IR 的 emitter，不再各自解析 MDX。

**决策 C：一个编译器，多个 emitter。**

```text
MDX + book.json
   → ContentCompiler (unified)
   → ContentDocument IR (versioned JSON)
       ├── HtmlEmitter   → ReaderLayout / static HTML
       ├── AbpEmitter    → ABP 1.1 + catalog
       ├── EpubEmitter   → XHTML
       └── LatexEmitter  → semantic LaTeX/Typst
```

HTML 是输出，不是源；禁止再用 regex + `marked` 生成正文。

**决策 D：一个 slug 函数，一个 asset resolver。**
`routeSlug = cleanSlug(sourceSlug)`，在编译器里算一次，写进 manifest 和 payload；运行时不再 fuzzy match。资源路径由编译器统一重写，不再用 `path.basename` 拍平。

**决策 E：一个 LibraryRepository，平台只做适配器。**
Web IndexedDB、Electron FS、HTTP 都是适配器；不允许 fallback 到另一套存储；安装/删除/读取只有一个 application service。

**决策 F：生成物不进 `public`，不进 Git。**
`public` 只放人手维护的静态资源；ABP、索引、图谱、EPUB 生成到 `artifacts/` 或 `dist/`，由构建产生，带 `generatedBy` / `sourceHash`。

### 7.2 目标目录树

```text
content-sources/
  catalog.json                    # 唯一人工目录：13 本书的 id/slug/order
  collections/
    <col>/<book>/
      book.json                   # 元数据、modules、entryPoint、trackClasses
      chapters/*.mdx
      images/
  schemas/                        # catalog/book/abp 的 JSON Schema

src/
  pages/                          # 只放路由，不放业务逻辑
    collections/[...path].astro   # 阅读器路由（官方书静态生成）
    reader.astro                  # 可选：用户安装包的运行时入口
    library.astro
    desktop.astro
    dev/...                       # Starlight 文档
  layouts/
    DocsLayout.astro              # 仅 Starlight
    ReaderLayout.astro            # 独立 M3 阅读器
    AppShell.astro                # 桌面/库/设置共用
  kernel/                         # 纯契约，无 UI、无 Node
    abp/{schema.ts,validate.ts,slug.ts}
    content/{types.ts,errors.ts}
    library/{types.ts}
  content/
    compiler/{parse.ts,transform.ts,ir.ts}
    emitters/{html.ts,abp.ts,epub.ts,latex.ts}
    registry/{catalog.ts,source.ts}
  reader/
    runtime/{load-chapter.ts,reader-controller.ts}
    ui/{ReaderShell.astro,ChapterNav.astro,Toc.astro}
  library/
    application/{library-service.ts}
    adapters/{web-indexeddb.ts,electron-fs.ts,http.ts}
  features/
    <feature>/                    # ai / exercises / translation / bilingual / search
                                  # graph / inspector / ingest / settings / scratchpad / editor
      ui/                         # 组件 / 页面 / 样式
      application/                # 用例编排
      domain/                     # 纯业务规则
      adapters/                   # 平台/网络适配
      index.ts                    # 唯一公共入口
  ui/
    m3/                           # 只放通用 M3 原语
    styles/{tokens.css,base.css,components.css}
  platform/
    web/                          # localStorage、fetch、CacheStorage
    electron/                     # IPC bridge、FS、settings
  publishing/                     # headless：LaTeX/EPUB/Typst
  utils/                          # 纯函数，禁止 server/UI 依赖

electron/                         # 只放 main/preload/window 生命周期
tooling/
  build/                          # 构建编排、provenance、clean
  pack/                           # ABP CLI
  release/                        # electron-builder 配置/脚本
tests/
  unit/ contract/ acceptance/ system/
```

注意：这里没有 `src/services` 这个“什么都往里装”的目录。内容服务归 `content/`，书库归 `library/`，平台归 `platform/`，业务归 `features/`。`src/components` 只保留 `ui/m3` 和 Starlight 适配器。

### 7.3 核心契约

**ContentDocument IR**

```ts
interface ContentDocument {
  schemaVersion: '1.0.0';
  bookId: string;
  sourcePath: string;        // 源 MDX 相对路径，仅 provenance
  routeSlug: string;         // 唯一路由 slug
  title: string;
  blocks: ContentBlock[];
  headings: Heading[];
  assets: AssetRef[];
}
```

**ABP manifest 扩展（保持 1.0 兼容，新增字段可选）**

```ts
interface AstroBookChapterSummary {
  id: string;
  title: string;
  slug: string;              // 必须等于 routeSlug
  sourcePath: string;        // 原始章节路径
  legacySlug?: string;       // 仅迁移期兼容旧链接
  path: string;
  hash: string;
  sizeBytes: number;
}
```

**LibraryRepository**

```ts
interface LibraryRepository {
  list(): Promise<LibraryItem[]>;
  get(id: string): Promise<LibraryItem | null>;
  install(pack: AbpPack): Promise<LibraryItem>;
  remove(id: string): Promise<void>;
}
```

**ReaderRuntime**

```ts
interface ReaderRuntime {
  getToc(bookId: string): Promise<TocNode[]>;
  getChapter(bookId: string, chapterId: string): Promise<ReaderDocument | null>;
}
```

**构建 provenance**

每个生成文件带：

```json
{
  "generatedBy": "tooling/pack/abp.ts",
  "sourceHash": "...",
  "catalogHash": "...",
  "generatedAt": "..."
}
```

没有 provenance 的生成物，构建直接拒绝。

### 7.4 阅读器路由策略

不要再用“一个 iframe + 一个静态服务器模糊匹配”的方式。建议：

- 官方 13 本书：构建期 `getStaticPaths` 生成 `/collections/:col/:book/:chapter/`，SEO 可用，Web/Electron 都能直接服务。
- 用户上传的 ABP：只提供**一个** `/reader/?book=...&chapter=...` 客户端入口，挂载同一个 `ReaderLayout`；不要为每本上传书包生成静态路由。
- 旧 raw slug URL：保留一个 release 的 `legacySlug` 301/alias 映射，之后删除。
- Electron 本地服务器直接服务 `dist` 和 userData 的 ABP；不再合成整页 HTML。

### 7.5 依赖边界

| 层 | 可以依赖 | 禁止依赖 |
|---|---|---|
| `kernel` | 第三方纯类型/schema | 任何 `src` 上层、Node/UI |
| `content` | `kernel`、纯 Node 工具 | `components`、`features`、`electron` |
| `reader` | `kernel`、`content`、`ui` | `electron`、`server/plugins` |
| `library` | `kernel`、平台 adapter | `components`、`features` 内部 |
| `features` | `kernel`、`ui`、`library` 公共 API | 其他 feature 内部、`electron` |
| `publishing` | `kernel`、`content` | `components`、`features`、DOM |
| `electron` | `kernel`、`library` adapter | `src/server/plugins`、`features` UI |
| `utils` | 纯第三方 | `server`、`components`、`features` |

---

## 8. 破坏性重构路线

> **目标可以彻底换血，提交必须按边界替换。**  
> 一次只改一个边界，先加新路径，再切消费者，最后删旧路径。当前工作树已有 5,952 个未提交改动，不要在这个状态上继续叠加重构。

### Phase 0：冻结与 checkpoint

**动作**

- 与另一个 agent 协调，冻结写入，或让对方切到独立分支。
- 把当前迁移态提交/打 tag（哪怕 broken），命名如 `checkpoint/zero-builtin-wip`。
- 记录基线：`tsc`、测试通过/失败清单、13 本书、1,251 章、95.5% slug 差异、603MB packs。
- 写 6 个 ADR（上面的 A–F），放到 `docs/architecture/adr/`。

**验收**

- 工作树干净或明确 checkpoint；没有并发写入。
- 基线数字可复现。

**回滚**

- 回到 checkpoint tag；保留当前工作树副本。

---

### Phase 1：目录 SSOT 收敛

**动作**

- 新建 `content-sources/catalog.json`（13 本书）。
- 每本书增加 `book.json`，承接 `sourceCollections` 的元数据、modules、entryPoint、trackClasses。
- `src/content/registry` 读取并校验 catalog；`sourceCollections` 删除或变成生成 projection。
- 删除 `collections=[]` 这个全局开关；改用 `build.includeBooks` 显式配置。
- 修复 `library.astro` / `sitemap.astro` / `getAllBooks()`，只读一个 catalog。
- 决定 `content-sources/catalog-registry.json` 去留：删除，或由 catalog 生成，不能手写两份。

**删除**

- 空 `collections` 数组及其默认消费者。
- `catalog-registry.json`（若不是生成物）。

**验收**

- 13/13 本书；`graph_theory` 在 library/sitemap 可见。
- `rg "content/docs/collections" src scripts` 为 0。
- catalog 与 `book.json` schema 校验通过。

---

### Phase 2：编译器与 canonical slug

**动作**

- 用 unified/remark-mdx/remark-math 实现 `ContentCompiler`，产出 `ContentDocument`。
- 在编译器里统一调用 `cleanSlug`，写 `routeSlug`、`sourcePath`、`legacySlug`。
- 用 `AbpEmitter` 替换 `pack-book-abp.mjs` 的正则 + `marked`；保留一个薄 CLI。
- 用同一 IR 重写 EPUB emitter；LaTeX/Typst 只消费 semantic blocks。
- 重新生成 13 个 ABP 包，跑全量对比。

**删除**

- `pack-book-abp` 的正则/`marked` 主路径。
- `epub/mdx-pipeline` 的独立解析（改为 emitter）。
- `mdx-chapter-parser` 的重复解析（合并进 compiler）。
- `static-handler` 的 fuzzy 分支。

**验收**

- 1,251 章；`routeSlug === cleanSlug(sourceSlug)` 100%。
- 0 个 fuzzy 匹配。
- golden 章节 HTML/公式/卡片/图片路径通过。

---

### Phase 3：Web 阅读器路由

**动作**

- 新增 `/collections/[...path].astro`，用 `getStaticPaths` 从 catalog/ABP 生成官方章节页。
- 用 `ReaderLayout` + M3 重写壳；不再用 `reader-shell-template` 合成整页。
- `library.astro` / `FragmentReaderHost` 改用 canonical route。
- Web Provider 只负责“取 ABP / 存 ABP”，不再 import 任何 `node:fs` 模板。
- 给 `FragmentReaderHost` 加“未安装/章节不存在”的空状态。

**删除**

- `web-provider` 对 `reader-shell-template` 的 import。
- `reader-shell-template`（在 Electron 切到新路由后）。
- `dist/collections` 的缺失状态。

**验收**

- 13 个 entryPoint + 1,251 章全部 200。
- 浏览器 bundle 中 `node:fs` / `node:path` 为 0。
- Web 首页可以真正打开一本书。

---

### Phase 4：平台与书库统一

**动作**

- 定义 `LibraryRepository` / `ContentRepository`；实现 `IndexedDbAdapter`、`ElectronFsAdapter`、`HttpAdapter`。
- 删除 `ElectronContentProvider` 的“失败回退 Web”逻辑；失败就报错，不双写。
- `DesktopBookManager` 变成 Electron adapter；`DesktopLibraryManager` 只负责 registry；两者不再各自实现安装协议。
- HTTP `/api/library/*` 调用同一个 application service；修复 `chapters/` 目录结构。
- 删除 `src/server/plugins/library` 的重复实现，保留一个薄 HTTP 适配器。
- Electron 不再全量复制 packs 到 userData；按需安装/解包。
- 删除 `StaticHandler` 的 `synthesizeAbpHtml` 和 fuzzy 匹配；静态服务器只服务文件。

**验收**

- Web/Electron 安装、删除、阅读各一次；一本书只在一个位置。
- remove 后缓存/索引/registry 全部清理。
- 离线阅读可用。

---

### Phase 5：UI 收敛

**动作**

- 新建 `ui/AppHeader`，统一 `HeaderOverride` / `M3TopNavBar` / `VpNav` / `HeaderToolsMenu`。
- 新建 `features/settings`，一个 `SettingsSurface` + 面板注册表；删除 `FeatureToggles` / `SettingsHubContent` 重复 HTML；开关统一用 `md-switch`。
- 新建 `features/library/ui`，Web/Electron 共用 `BookGrid`、`BookCard`、筛选器；删除 `library-client` 和 `FragmentLibrary` 的重复 UI。
- 新建 `AppShell`，统一 `hub.astro` / `desktop.astro` 的主题 bootstrap、字体、Token 导入。
- 删除 `FontSelectOverride`、`HeaderToolsMenu`、`BilingualSplitReader`、`index-client`。

**验收**

- 全站只有一个 Header、一个设置入口、一个书库卡片实现。
- 重复 DOM id 为 0；视觉回归通过。
- `!important` 开始下降（目标 < 300）。

---

### Phase 6：Feature 提取与 God controller 拆分

**动作**

- `components/exercises` → `features/exercises`。
- `components/ai` + `src/ai` → `features/ai`。
- `services/translation` + 翻译 UI → `features/translation`。
- `services/bilingual` + server plugin + `components/bilingual` → `features/bilingual`。
- `features/search-rec` + `ai/retriever` → `features/search`。
- `components/desktop/FragmentLibrary` + `library-client` → `features/library/ui`。
- `publishing/client` → `features/publishing`（如果保留导出 UI）。
- 拆分 `chat-controller`、`exercise-controller`、`translation-dock-controller`、`feature-toggles`、`ingest-controller`、`desktop.astro` inline script。

**删除**

- `src/utils/sidebar.ts`；客户端直接 import `slug.ts`。
- `starlight-sidebar`（或移到 build-only）。

**验收**

- 单文件行数上限 600（生成物除外）。
- 依赖检查通过：`content` 不依赖 `ui`，`publishing` 不依赖 `components`，`utils` 不依赖 `server`，`electron` 不依赖 dev plugin。

---

### Phase 7：AI / 翻译 / 检索收敛

**动作**

- 一个模型 registry（`features/ai/models.ts`），删除 `features.config.ts` 的重复 models。
- 一个 tool registry，客户端和 MCP 都从它生成 schema；删除 `mcp/tools.mjs` 的重复定义。
- 一个 `RetrievalService`，chat 和 search UI 共用；删除 `ai/retriever.mjs` 或把它变成 adapter。
- 一个 `translation-core`，`api/translate.ts` 变薄 handler；删除 540 行复制。
- 一个 dictionary adapter；一个 `AlignmentService`，ONNX/Qwen 只是 engine 适配器。

**验收**

- 工具 schema 单测；翻译 provider parity；检索 topK/分词行为一致。
- 无重复 provider 列表。

---

### Phase 8：构建与发布硬切

**动作**

1. clean；
2. validate catalog；
3. compile content → ABP/EPUB/索引；
4. `astro build`；
5. verify 1,251 routes + 13 packs；
6. package desktop（可选）。

- 删除空转脚本；空输入必须失败，除非显式 `--allow-empty`。
- 生成物全部移出 `public`/Git；发布只带 `.abp`，首次启动解包到 userData。
- CI 加 `npm run build` + clean-clone acceptance；release workflow 不再假设“仓库里已有 packs”。
- `electron-builder` 的 `files` 只保留运行时 `dist`/`dist-electron`，不再带 `src/**/*` 和展开的 `public/abp-packs`。

**验收**

- 干净 clone 执行 `npm ci && npm run build && npm test` 通过。
- 安装包 < 250MB；13 本书完整；安装后首次启动可读。

---

### Phase 9：清理与固化

**动作**

- 删除 `.bak`、死文件、旧 `test/`/`task/`/`.tmp/` 残留。
- 删除 `src/core/catalog/book-catalog.mjs`、`starlight-sidebar`、旧 `sitemap` 扫描逻辑。
- 更新 AGENTS.md，把“愿望”改成“可执行规则”；加 dependency-cruiser/ESLint 边界检查。
- 清理 130 处旧路径引用；docs 只保留当前目录树。

**验收**

- `knip`/`ts-prune` 零未引用。
- `rg "src/content/docs/collections"` 为 0。
- 架构检查进 CI；文档与目录树一致。

---

## 9. 验收指标

| 指标 | 当前 | 目标 |
|---|---:|---:|
| 人工内容目录（SSOT） | 4 份，12/13 不一致 | 1 份，13/13 |
| ABP 章节 slug 不一致 | 1,195 / 1,251（95.5%） | 0 / 1,251 |
| Web 官方章节路由 | 0 | 1,251，全部 200 |
| 干净 clone 可构建 | 否（依赖未跟踪 packs/fixtures） | 是 |
| `npm run build` 含 ABP 打包 | 否 | 是，且失败即失败 |
| 浏览器 bundle 含 `node:fs` | 是（reader-shell-template） | 0 |
| 生成物在 `public/` | 约 780MB | 0（只留人手资源） |
| 安装包体积 | 603MB packs + src + dist，远大于 1GB | < 250MB |
| `!important` 总数 | 6,189 | < 300 |
| 最大 controller 行数 | 2,230 | < 600 |
| 零引用文件 | 至少 10 个 | 0 |
| 重复设置/Header/Library | 各 2–3 套 | 各 1 套 |
| 测试门禁 | typecheck + 单测；无 build/route | typecheck + build + route crawl + clean clone |

---

## 10. 风险登记

| 风险 | 触发条件 | 缓解 |
|---|---|---|
| 删除 packs 后无法恢复 | 先删 `public/abp-packs` 再重生成 | 先备份/生成到 `artifacts/`，校验 13/1,251 后再删 |
| ABP 1.0 已安装用户失效 | 直接改 `slug` 语义 | 新字段可选 + `legacySlug` 一版 + 301/alias |
| 并行 agent 冲突 | 同一工作树继续重构 | Phase 0 冻结/分支；每阶段独立 PR |
| 路由改造导致 SEO 404 | 没有 legacy redirect | 先统计外链/旧 manifest，保留 alias 一版 |
| CSS/布局同时改导致视觉回归 | Phase 5 同时动 Header/Settings/Library | 先结构后视觉；每步截图对比 |
| 构建改造掩盖运行时错误 | 只跑 `tsc` | 加 build + route smoke + clean clone |
| 数据丢失 | 运行时写源码目录/覆盖 catalog | 运行时只写 staging/userData；catalog 只读 |
| 迁移范围失控 | 试图一次改完 5,952 个文件 | 按 Phase 拆 PR；每阶段可回滚 |

---

## 11. 如果只做三件事

1. **把目录和 slug 收敛到编译器**：一个 catalog、一个 `cleanSlug`、一个 ABP emitter；先把 95.5% 的 slug 不一致降到 0。
2. **补上 Web 阅读路由**：`/collections/[...path]` + 独立 `ReaderLayout`；让 `library.astro` / `FragmentReaderHost` 的链接真正可达。
3. **把构建链改成“构建即打包”**：`npm run build` 必须生成 13 个 ABP、1,251 个路由、所有索引；干净 clone 必须通过。

这三件完成后，再动 UI/设置/Feature 边界，才不会在流沙上盖房子。

---

## 12. 附录：审计命令与口径

本次审计使用的主要只读检查：

```powershell
# 工作树规模
git status --porcelain
git rev-parse --short HEAD

# 内容/产物
(Get-ChildItem content-sources -Recurse -File | Measure-Object).Count
(Get-ChildItem public/abp-packs -Recurse -File | Measure-Object).Count
(Get-ChildItem public/abp-packs -Recurse -File | Measure-Object Length -Sum).Sum / 1MB

# catalog 差异
node -e "const fs=require('fs');for(const f of ['content-sources/catalog-registry.json','public/abp-packs/catalog.json']){const j=JSON.parse(fs.readFileSync(f,'utf8'));console.log(f,j.books.length,j.books.map(b=>b.id).join(','))}"

# slug mismatch（使用 github-slugger，与 cleanSlug 一致）
# 结果：1,251 章 / 1,195 不一致 / 95.5%

# 旧路径引用
Get-ChildItem src,scripts,tests,docs -Recurse -File -Include *.ts,*.mjs,*.astro,*.md,*.json |
  Select-String -Pattern 'src/content/docs/collections'

# CSS 体量
Get-ChildItem src -Recurse -File -Include *.css |
  ForEach-Object { Get-Content $_.FullName } |
  Select-String -SimpleMatch '!important'
```

**口径说明**

- `content-sources` 文件数含图片；不是“书数”。
- ABP 章节数来自 13 个 `manifest.json` 的 `sections[].chapters[]` 展开。
- `cleanSlug` 采用 `github-slugger`，与 `src/utils/slug.ts` 一致；不要用“把点号替换成连字符”的近似算法，会得到 95.8% 的错误数字。
- `!important` 统计包含所有 `src/**/*.css`，不包含 `dist`/`public` 生成 CSS。
- 行号以 2026-11-12 采样为准；如果其他 agent 继续写入，以当前代码为准重新定位。

---

**审计结论**：AstroLib 的“理念层”仍然优秀，但“运行层”已经形成两套互不兼容的系统。当前最需要的不是再加一层抽象，而是**选定 ABP 为运行态主干，删除另一条运行路径**。目标可以彻底换血，执行必须按边界替换；否则 5,952 个未提交改动会吞掉任何大爆炸式重构。
