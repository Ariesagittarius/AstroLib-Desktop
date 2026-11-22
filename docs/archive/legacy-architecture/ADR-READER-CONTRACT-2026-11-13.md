# 架构决策记录 (ADR-READER-CONTRACT-2026-11-13)

**标题**：AstroLib 阅读器契约、Canonical Slug 规范与多环境路由边界架构决策  
**编号**：ADR-P1-A0-2026-11-13 (Rev.2 审计修正版)  
**状态**：`ACCEPTED (已通过 P1-A0 审计裁决，进入 P1-A1 执行门禁)`  
**对应任务**：P1-A0（P1 第一阶段架构决策，不修改任何业务源码）  
**基准分支**：`electron/main` @ `24360c7d`（Tag `v0.0.4` @ `df68e42c` 保持不变）  
**约束规范**：`AGENTS.md` Rule 1 (UI not domain model), Rule 2 (Publishing independent), Rule 8 (Scripts boundary), Rule 10 (One boundary -> One migration -> One verification)  

---

## 1. 决策背景与现状代码盘点 (Context & Current Code Inventory)

在基准审计报告 [`PROJECT_ARCHITECTURE_AUDIT_2026-11-12.md`](./PROJECT_ARCHITECTURE_AUDIT_2026-11-12.md) 中，指出了 AstroLib 阅读体验与路由体系存在深层结构问题：
1. **架构 P0-02**：Web 端未提供物理章节阅读路由，首页重定向至 `/desktop/`，但在非 Electron 环境下点击书目阅读时无法定位真实内容；
2. **架构 P0-03**：原始文件名由于包含点号、LaTeX 宏与特殊分隔符，与 `cleanSlug()` 算法产生 95.5%（1,195 / 1,251 章）的不一致，早先版本依赖本地服务器的模糊匹配掩盖，导致链路脆弱；
3. **架构 P1-01**：Starlight 文档框架被错误地当成全功能阅读器底座，通过 13 个组件覆盖、6,623 行含大量 `!important` 的样式以及 1,414 行的 HTML 字符串拼接引擎（`reader-shell-template.ts`）勉强维持运行，形成了“框架倒置”。

在 P0 阶段闭环治理中（见 [`P0_FINAL_AUDIT_2026-11-13.md`](./P0_FINAL_AUDIT_2026-11-13.md)），虽然通过 Mode A 零内置书发行、官方 ABP 编译器对齐 `cleanSlug` 及 `legacySlug` 别名映射，成功打通了桌面端 v0.0.4 的闭环分发，但阅读器架构的双轨与临时状态仍未从根本上收敛。

### 1.1 现状核心代码盘点（核对至行号基准）

| 模块 / 路径 | 当前实现与行为 | 存在的问题与边界风险 |
|---|---|---|
| `src/pages/` | 仅存在 `desktop.astro`、`hub.astro`、`index.astro`、`blank.astro`、`workspace/ingest.astro` 及样式 `workspace/ingest.css`。物理上**完全不存在** `/collections/` 路由。 | Web 端（纯浏览器部署）无法直接响应 `/collections/:col/:book/:chapter/` 页面请求。 |
| `electron/server/static-handler.ts` (L320–378) | 拦截 `/collections/:col/:book/:rawChapterSlug/`，首先检查 `chapters/${rawChapterSlug}.json`；若未命中则检查 `chapters/${cleanSlug(rawChapterSlug)}.json`；若仍未命中则线性扫描 manifest 的 `sections[].chapters[]`，核对 `ch.slug`、`ch.legacySlug` 与 `cleanSlug(ch.slug) === canonicalQuerySlug`。最后调用 `synthesizeAbpHtml` 装配并缓存至 `.cache/`。 | 仍保留了多候选扫描与隐式回退机制；未找到章节时由 `local-server.ts:190-193` 输出 `404 text/plain`，缺乏学术规范错误页；桌面端专属逻辑，Web 端无法复用。 |
| `scripts/pack-book-abp.mjs` (L559–626) | 提取章节时计算 `rawChapterSlug = cFile.replace(/\.(mdx\|md)$/, '')`；计算规范化 slug `chapterSlug = cleanSlug(rawChapterSlug)`；若两者不同，记录 `legacySlug = rawChapterSlug`；章节物理落盘为 `chapters/${chapterSlug}.json`；清单记录 `entryPoint = cleanSlug(rawEntry)`。 | 编译器端已率先规范化为 Canonical Slug，并记录了 `legacySlug`（1,195 章覆盖）；需要固化为绝对契约，禁止后续代码篡改。 |
| `src/utils/slug.ts` (L11–26) | 剥离 `\mathbf` 等 LaTeX 宏与特殊标点，对路径段调用 `github-slugger`，去除点号 `.`、空格转短横线 `-`、保留下划线 `_`。 | 算法稳定纯净，与 Astro Content Collections 规范一致，但缺少与 ABP 运行时的强类型契约绑定。 |
| `electron/server/reader-shell-template.ts` (1,414 行) | 读取 `dist/reader-shell/index.html`（Starlight Master Shell），替换 `#reader-shell-mount-point`，生成左侧书目树（使用 `ch.slug`），生成右侧结构化大纲与卡片 Chip。 | 严重依赖预编译 Starlight 壳；存在 1,414 行 DOM 替换与脚本注入，维护成本高；与 Web 端完全割裂。 |
| `src/components/desktop/FragmentReaderHost.astro` (L210–217) | 桌面端分屏研读中心。根据选中的 `UnifiedReadingEntity` 计算 iframe URL：`/collections/${meta.colSlug}/${meta.bookSlug}/${meta.entryPoint}/`。 | 假定 `/collections/...` 恒可由本地 StaticHandler 提供，若处于 Web 模式则 iframe 会直接呈现 404。 |
| `src/services/content-provider/` | `IContentProvider` 端口提供 `getInstalledBooks`、`getBookManifest`、`getChapterPayload` 等。`web-provider.ts` 基于 IndexedDB，`electron-provider.ts` 基于 IPC。 | 接口完善，但之前缺少与顶层阅读路由的统一调度机制。 |

---

## 2. 官方书与上传书的统一路径契约 (Routing & URL Matrix)

为彻底消灭路径分歧，确立**官方教材（Official Canonical Books）**与**用户上传书/文献（User Uploaded Entities）**的唯一 URL 路由规范：

### 2.1 路由总表

| 实体分类 | 资源类型 | Canonical 路径 / URL 结构 | 服务提供方 | 说明 |
|---|---|---|---|---|
| **官方教材** (13 本) | 章节正文阅读 | `/collections/:colSlug/:bookSlug/:chapterSlug/` | 桌面：`StaticHandler` 动态合成<br>Web：P1-A 阶段 404/明确空态，静态路由由 P1-A3 运行时入口承接，SEO 静态化另行立项 | `:chapterSlug` 必须 100% 为 Canonical Slug。尾部斜杠由路由中间件自动标准化。**P1-A 阶段不包含 Web 静态 1,251 章路由生成**。 |
| **官方教材** (13 本) | 书籍根入口 | `/collections/:colSlug/:bookSlug/` | 301 / 302 临时或永久重定向 | 自动跳转至 manifest 中声明的 `entryPoint`。 |
| **官方教材** (13 本) | 章节配图 | `/collections/:colSlug/:bookSlug/images/:imgFile` | 桌面：`StaticHandler`<br>Web：CDN / Pack 解包资产 | 严禁拍平图片或使用绝对物理磁盘路径。 |
| **官方教材** (13 本) | 辅助索引端点 | `/ai-index/:bookId.json`<br>`/relation-graphs/:bookId.json`<br>`/data/cross-ref/:bookId.json`<br>`/inspector-data/:bookId.json` | 桌面：已安装包优先，回退 artifacts<br>Web：远端 catalog 对应存储 | 自包含辅助数据端点，为 AI 问答、图谱与巡检提供标准 JSON。 |
| **官方教材** (13 本) | 课后习题数据集 | `/data/exercises/:bookSlug/:relPath` | 静态数据分发 | 支持 4 本精修习题教材的标准题库。 |
| **用户上传 ABP** | 动态章节阅读 | `/reader/?book=:bookId&chapter=:chapterSlug` | 统一 Universal Reader 容器 | 运行时通过 `IContentProvider.getChapterPayload()` 直出，**构建期绝不为上传书生成静态路由**。 |
| **用户上传 PDF** | MinerU 研读任务 | `/workspace/ingest/?taskId=:taskId` | 工作台 Task Viewer | 针对扫描件与学术论文的 OCR / 双语研读工作台。 |

### 2.2 核心决策：上传书与官方书边界划分（消灭歧义）

1. **运行时同构 ≠ 构建期静态路由**：
   - 构建期静态路由：仅由官方固定合集与工程文档拥有，绝不为用户上传书在构建期生成静态页面（遵循 Rule 9，严禁运行时写源码目录）。
   - 运行时服务：官方 13 本书的 `/collections/:col/:book/:chapter/` 路径仅由官方 artifacts 目录（`resolveAbpArtifactsDir`）及已安装官方包服务。
2. **桌面端 `userAbpDir` 与第三方上传包判定矩阵**：
   - 若请求 `/collections/:col/:book/:chapter/`：
     - 若属于官方 13 本书（ID 在官方 catalog 范围内）：命中已安装或 artifacts 目录，返回 200；
     - 若属于用户自定义导入的非官方图书：桌面端在内部可提供运行时动态直读，但外部通用入口与跨端规范入口一律为 `/reader/?book=:bookId&chapter=:chapterSlug`；
     - 若未安装且不存在：严格返回 **404 学术视窗**，不进行模糊重定向。

---

## 3. Canonical Slug 与 Legacy Alias 规约 (Slug Specification & Lifecycle)

### 3.1 Canonical Slug 算法定义

全系统唯一判定算法：
```typescript
import { slug as githubSlug } from 'github-slugger';

export function cleanSlug(rawSlug: string): string {
  return rawSlug
    .split('/')
    .map((segment) => {
      // 1. 剥离 LaTeX 数学宏与转义代码，杜绝数学公式污染 URL
      const sanitized = segment
        .replace(/\\(?:mathbf|boldsymbol|pmb|text|mathbb|mathrm)\{([^}]+)\}/g, '$1')
        .replace(/mathbf([A-Za-z])/g, '$1')
        .replace(/\\[a-zA-Z]+/g, '')
        .replace(/[\$\{\}\^\\]/g, '')
        .trim();
      // 2. 使用 github-slugger 处理小写化、连字符替换与标点剔除
      return githubSlug(sanitized);
    })
    .join('/')
    .normalize();
}
```

**契约铁律**：
- **幂等性**：对任意输入 $s$，必须严格满足 `cleanSlug(cleanSlug(s)) === cleanSlug(s)`。
- **唯一存储**：在 ABP 规范包中，章节物理 JSON 文件名必须且仅能为 `chapters/${canonicalSlug}.json`。
- **唯一生成**：`manifest.sections[].chapters[].slug` 必须且仅能存储 `canonicalSlug`。所有页面侧边栏、大纲跳转、面包屑生成的超链接必须且仅能使用 `canonicalSlug`。

### 3.2 Legacy Alias 的定义、范围与 301 重定向规则

在历史版本或原书扫描文件名中，存在包含点号的文件名（如 `07_1.1_基本公式.mdx`）：
- 原始名称（rawSlug）：`07_1.1_基本公式`
- Canonical Slug：`07_11_基本公式`（点号被合法剥离）

**范围与别名查表契约（定死口径）**：
1. **显式覆盖范围**：
   - 经实测普查，全量 1,251 章中，`legacySlug` **精确覆盖 raw !== canonical 的 1,195 章**；
   - 其余 56 章（如 `00_preface`、`01_内容简介` 等）由于 `raw === canonical`，`legacySlug` 为 `undefined`，**以 Canonical Slug 自身为唯一合法路径**。
2. **精确查找与 301 规范化**：
   服务端或路由网关在接收到请求时按两级精确判定：
   - **第一级（Canonical 直接命中）**：请求 slug 直接匹配 `chapters/${slug}.json`，状态码 200，纳秒级直接输出；
   - **第二级（显式单项查表别名命中）**：若第一级未命中，在对应图书 manifest 中检索是否存在 `ch.legacySlug === requestSlug`（单项显式查表，禁止正则/模糊包含）：
     - 若命中：桌面端设置 `301 Moved Permanently` 响应头，`Location: /collections/:col/:book/:canonicalSlug/`，并以 `resolvedSlug = matched.slug` 即时装配该章数据，同时在 `synthesizeAbpHtml` 缓存键中使用 `resolvedSlug`（杜绝多份冗余缓存）；Web 端由路由层执行 `history.replaceState` 规范化 URL；
   - **两级均未命中**：立即返回 **404 学术视窗**，**严禁进行任何模糊子串匹配或正则猜测**。
3. **Legacy Alias 消亡生命周期**：
   - **当前状态（P1 阶段）**：Manifest 保持保留 1,195 章 `legacySlug`，保障老用户书签与 v0.0.4 资产平滑过渡；
   - **P2 / 1.0 阶段**：外部引用全部对齐后，正式将 `legacySlug` 标记为已弃用（Deprecated），仅供只读归档使用。

---

## 4. 桌面 StaticHandler、Web 路由、ABP 打包三者责任边界

必须严格切分三者的系统职责，严禁职责跨界：

```
                    ┌──────────────────────────────────────────────┐
                    │          ABP 打包编译器 (Offline)            │
                    │         scripts/pack-book-abp.mjs            │
                    └──────────────────────┬───────────────────────┘
                                           │ 输出标准 ABP 1.0.0
                                           ▼
┌──────────────────────────────────────────────────┬──────────────────────────────────────────────────┐
│             桌面环境 (Electron Shell)            │               Web 环境 (Browser Shell)           │
├──────────────────────────────────────────────────┼──────────────────────────────────────────────────┤
│ 1. LocalServer / StaticHandler 网关              │ 1. Astro 静态站点 / SPA 路由                     │
│    - 监听本地端口，拦截 /collections/...         │    - 承载 /desktop/、/hub/、/workspace/          │
│    - 内存 LRU 缓存 (500 条)                     │ 2. Universal Reader SPA 页面 (/reader/)          │
│    - 用户已解压目录优先，回退 artifacts         │    - 客户端读取 IndexedDB / PWA 离线包           │
│    - 精确命中 Canonical Slug / 显式 Legacy       │    - 调用 getContentProvider().getChapterPayload │
│    - 调用 Reader Shell 模板装配 HTML            │    - Material 3 纯前端渲染正文与侧载             │
│    - 错误时输出学术风格 404 错误视窗             │ 3. 杜绝运行时写源码目录                          │
└──────────────────────────────────────────────────┴──────────────────────────────────────────────────┘
```

### 4.1 ABP 打包器 (`pack-book-abp.mjs`) 责任边界
- **属性**：离线内容编译管线，不参与运行时。
- **输入**：`content-sources/collections/` 下的原始 MDX 与图片。
- **职责**：
  1. 编译纯 KaTeX HTML，生成带 `data-latex` 的公式；
  2. 提取大纲标题树与卡片语义切片；
  3. 执行 `cleanSlug` 转换，生成 `chapters/${canonicalSlug}.json`；
  4. 产出 `manifest.json` 与 `.abp` 压缩单文件包；
  5. 严禁侵入运行时，严禁包含任何浏览器 DOM 或 HTTP 响应逻辑。

### 4.2 桌面服务引擎 (`static-handler.ts`) 责任边界
- **属性**：Electron 内置本地 HTTP 服务器静态分发器与无状态合成网关。
- **职责**：
  1. 负责响应桌面 iframe 的 `/collections/:col/:book/:chapter/` 请求；
  2. 实现 ETag、304 缓存协商与小文件内存常驻；
  3. 彻底删除模糊匹配分支（删除 L360 `cleanSlug(ch.slug) === canonicalQuerySlug` 扫描），仅允许精确 Canonical Slug 匹配与显式单项 `legacySlug` 检索；
  4. 当章节不存在或书籍未安装时，**必须返回友好的学术风格 404 视窗**，严禁留白或进程崩溃；
  5. 负责自包含辅助 JSON（AI 索引、图谱、跨引）的本地静态分发。

### 4.3 规则冲突与生效顺序声明（与 `AGENTS.md` §8.2 的对齐契约）

> [!IMPORTANT]
> **规则冲突消除与分阶段生效说明**：
> `AGENTS.md` §8.2 将“桌面端章节阅读基于 `dist/reader-shell/index.html`（预编译 Starlight Master Shell），在 `electron/server/reader-shell-template.ts` 中动态装配 HTML”列为当前架构铁律。  
> **生效顺序严格裁定如下**：
> 1. **P1-A ~ P1-D 迁移过渡期**：`AGENTS.md` §8.2 **继续保持完全有效**。`reader-shell-template.ts` 的装配机制在 P1-A1 ~ P1-A4 中保持运作，P1-A 仅负责净化其生成的 URL 链接为 100% Canonical Slug，严禁在 P1-A 中顺手推倒该模板引入 Big Bang 重构（违背 Rule 10）；
> 2. **P1-E 文档与架构治理期**：在 Universal Reader 纯 M3 组件方案完全具备生产替换能力并通过全量测试后，在 P1-E 阶段统一修订 `AGENTS.md` §8.2 与相关文档，完成框架倒置的历史解绑。

---

## 5. 受影响文件清单与禁止修改清单 (Boundary Invariants)

遵循 `AGENTS.md` 架构纪律，明确划定本 Wave 及后续实现的权限边界：

### 5.1 允许修改的文件清单 (Files Allowed for P1-A)

```text
docs/architecture/ADR-READER-CONTRACT-2026-11-13.md (本决策文档)
docs/architecture/P1_A0_AUDIT_2026-11-13.md (复核裁决文档)
docs/README.md (架构决策索引注册)
electron/server/static-handler.ts (P1-A1: 移除模糊匹配，落实精确别名查表与 404 视窗)
tests/acceptance/abp-dynamic-serving.test.ts (P1-A1: 适配精确别名与 404 契约)
tests/unit/static-handler.test.ts (P1-A1: 新增静态服务单元测试)
docs/architecture/evidence/p1-a1-evidence.json (P1-A1: 新增证据落盘)
electron/server/reader-shell-template.ts (P1-A2: 净化 Slug 引用，注入优雅 404 状态)
src/components/desktop/FragmentReaderHost.astro (P1-A2: iframe URL 生成对齐 Canonical)
```

### 5.2 严禁修改的文件清单 (Files Strictly Forbidden)

```text
content-sources/collections/**/* (严禁修改 13 本官方教材任何正文内容)
src/types/content-package.ts (严禁改动已发布的 ABP Schema 1.0.0 核心契约)
docs/architecture/evidence/p0-final-evidence.json (P0 终审归档证据，绝对只读)
.github/workflows/electron-release.yml (发布工作流已验证稳定，禁止破坏)
package.json (保持 0.0.4 版本与依赖基线不动)
scripts/pack-book-abp.mjs (不得重跑打包，避免 contentHash 与 updatedAt 漂移)
artifacts/abp-packs/** (保持 13 个官方 .abp 实体与 catalog.json 稳定)
```

---

## 6. 分阶段迁移步骤 (Step-by-Step Implementation Plan)

遵循 `AGENTS.md` Rule 10（**one boundary → one migration → one verification**），严禁 Big Bang 重构：

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ Step 0 (P1-A0, 当前完成): 编写并审定本 ADR 决策文档与代码盘点 (0 源码修改) │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ 审计通过 (Gate P1-A0 PASS)
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Step 1 (P1-A1): StaticHandler 精准化重构                                │
│ - 彻底移除 targetNorm、模糊扫描与正则降级代码                            │
│ - 落实 Canonical Slug 直接命中 + manifest.legacySlug 显式别名定向         │
│ - 新增 404 学术错误视窗渲染，消除 iframe 静默白屏                        │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ 验证: 契约测试与 0 模糊匹配
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Step 2 (P1-A2): Reader Shell 模板与 iframe 容器契约对齐                 │
│ - 检查 reader-shell-template.ts 生成的所有侧边栏与上一章/下一章链接      │
│ - 确保 FragmentReaderHost 传递的 URL 100% 走 Canonical Slug             │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ 验证: UI smoke 与全学科树状目录跳转
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Step 3 (P1-A3): Web 端 Universal Reader 路由接入方案规划                │
│ - 建立 /reader/ 基础客户端页面与轻量 ReaderLayout 骨架                   │
│ - 打通 WebContentProvider 在浏览器端的内容渲染通道                      │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ 验证: Web 模式下打开书籍不依赖本地 Node
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Step 4 (P1-A4): 全量契约回归与 P1-A 闭环验收                            │
│ - 执行 13 本书 1,251 章 Canonical Slug 匹配度自动化普查 (100%)          │
│ - 运行全量测试套件 (npm run check:all) 并提交 p1-a-evidence.json 归档    │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 7. 验收命令、证据格式与 404 视窗规范 (Acceptance Gates & Evidence Criteria)

### 7.1 验证命令集

```powershell
# 1. 严格 TypeScript 类型守卫 (0 报错)
npm run check:types

# 2. 核心单元与契约测试
npx vitest run tests/acceptance/abp-dynamic-serving.test.ts tests/contract/release-metadata.test.ts

# 3. 全局测试金字塔全绿验证
npm test
```

### 7.2 404 学术视窗最小规范 (Academic 404 Viewport Specification)

当请求不存在的书籍或章节时，`StaticHandler` 必须返回符合极简学术风格的 HTML 视窗（替代现有的 `404 text/plain`）：
1. **HTTP 状态与头部**：
   - HTTP Status: `404 Not Found`
   - Header: `Content-Type: text/html; charset=utf-8`
2. **DOM 结构与视觉规范**：
   - 复用 AstroLib 现有 Material 3 Design Tokens（`--md-sys-color-surface`, `--md-sys-color-on-surface`, `--md-sys-color-outline` 等），**严禁引入任何未授权样式或三方库**；
   - 纯净居中卡片布局，包含：
     - 图标：Material Symbol `menu_book` 或 `error_outline`；
     - 主标题：`404 - 章节或资源未找到 (Chapter Not Found)`；
     - 诊断明细：指出请求的学科、书名与章节 Slug（安全字符转义）；
     - 动作通道：提供“返回研读书库”、“返回默认章节”两个标准 M3 按钮（触发 `window.parent.postMessage` 或标准跳转）。

### 7.3 证据文件规格 (`docs/architecture/evidence/p1-a-evidence.json`)

在 P1-A4 闭环时，必须落盘符合以下强类型 JSON Schema 的证据文件：

```json
{
  "gate": "P1-A",
  "baseCommit": "24360c7d",
  "closureCommit": "<P1-A4_COMMIT_HASH>",
  "timestamp": "2026-11-13T...",
  "commands": [
    "npm run check:types",
    "npm test",
    "npx vitest run tests/acceptance/abp-dynamic-serving.test.ts"
  ],
  "exitCodes": {
    "checkTypes": 0,
    "npmTest": 0,
    "abpDynamicServing": 0
  },
  "metrics": {
    "totalBooks": 13,
    "totalChapters": 1251,
    "slugMismatchCount": 0,
    "legacySlugCoveredCount": 1195,
    "fuzzyMatchLinesInStaticHandler": 0
  },
  "notFoundProbe": {
    "testUrl": "/collections/math/math_senior/non_existent_chapter/",
    "httpStatus": 404,
    "contentType": "text/html; charset=utf-8",
    "containsDiagnosticText": true
  },
  "artifactSha256": {
    "math-math_senior.abp": "...",
    "catalog.json": "..."
  }
}
```

---

## 8. 回滚方案 (Rollback Strategy)

若在后续 P1-A1 ~ P1-A4 实施过程中出现非预期阻断或回归缺陷：
1. **原子化 Git 提交**：每个 Step 拥有独立、清晰的 Git commit，严格按照 `fix(reader): ...` 或 `refactor(slug): ...` 提交；
2. **安全回滚**：如遇未解阻断，直接执行 `git revert <COMMIT_HASH>` 干净回滚至基线 `24360c7d`；
3. **隔离性保护**：所有改动限定在 Shell 与服务网关层，不触碰编译好的 `artifacts/abp-packs/` 与云端 v0.0.4 资产，回滚零数据丢失风险。

---

## 9. 对 v0.0.4 Release 资产的影响评估 (Impact on v0.0.4 Release Assets)

| 资产类别 | 数量 | 评估结论 | 详细原因 |
|---|---|---|---|
| **官方 `.abp` 数据包** | 13 个 | **0 影响（完全兼容）** | 在 P0-v0.0.4 编译中，已统一写入 `slug: cleanSlug(...)` 与 `legacySlug`，包内物理文件名已为规范 Slug，无需重新发版或重传。 |
| **官方 `catalog.json`** | 1 个 | **0 影响（完全兼容）** | Catalog 记载的书单 `entryPoint` 与 `contentHash` 均已在 v0.0.4 校验通过，保持不变。 |
| **自动更新 `latest.yml`** | 1 个 | **0 影响（完全兼容）** | 更新目标与 Setup 包 SHA-512 完全固化，P1 不修改版本号与安装包。 |
| **NSIS / 便携版安装包** | 2 个 | **0 影响（完全兼容）** | 现有客户端具备解析能力，P1-A 属于内部架构规范收敛，不强制立即打包新二进制。 |

---

## 10. 结论与执行交接建议 (Summary & Handoff)

本决策记录明确了 AstroLib Reader 契约的最高准则：
- **规范 Slug 唯一性**：正文路径唯一，消灭 95.5% 历史分歧；
- **别名映射显式化**：彻底剔除隐蔽模糊匹配，确立透明生命周期；
- **双壳同构与框架解耦**：确立过渡期 Starlight 机制继续有效，并规划 Universal Reader 长期方向；
- **零破坏发布资产**：100% 继承并保护 P0 v0.0.4 胜利果实。

本修订版决策文档已完全补齐 F1~F6 六项阻断与口径要求，正式生效并开启 **Wave P1-A1（StaticHandler 精准化重构）** 实施门禁。
