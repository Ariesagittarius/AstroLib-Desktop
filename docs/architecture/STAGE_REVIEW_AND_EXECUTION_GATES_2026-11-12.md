# AstroLib 阶段报告复核与下一阶段执行/审计门禁

**文档编号**：ARCH-STAGE-REVIEW-2026-11-12  
**文档状态**：`CONDITIONAL — NOT ACCEPTED AS COMPLETE`  
**复核对象**：执行 Agent 提交的 `electron/main` 阶段报告（对话版，无独立报告文件）  
**复核基线**：`electron/main` @ `cbb19a78`（`refactor(core): align electron desktop architecture with lean dynamic abp model`）  
**对照基线**：`checkpoint/electron-pre-audit` @ `c36f8dbe`  
**复核日期**：2026-11-12  
**复核环境**：Windows / PowerShell / Node.js / Electron / electron-builder；当前工作树 `git status --short` 为空  
**适用对象**：下一阶段执行 Agent、独立审计 Agent、发布负责人  
**规范优先级**：用户直接指令 > `AGENTS.md` > 本文 > 历史交接文档

---

## 0. 阅读方式与硬约束

### 0.1 本文的定位

本文同时承担三种角色：

1. **复核记录**：说明上一份阶段报告中哪些主张可复现，哪些属于过度声明。
2. **执行指令**：把下一阶段拆成有边界的 Gate；执行 Agent 不得跳步或合并 Gate。
3. **审计底稿**：给出可重复的命令、观测指标、通过标准和证据归档位置。

本文不是“建议列表”。标为 **P0** 的项未关闭前，项目不得对外宣称“桌面端重构完成”或“可发布”。

### 0.2 强制工程约束

执行 Agent 必须遵守 `AGENTS.md`，尤其是：

- **Rule 3 — Source of Truth**：生成数据不得成为 Source of Truth。
- **Rule 4 — Generated Data**：所有可再生产物必须显式标注生成脚本与输入源。
- **Rule 9 — Runtime must not mutate source**：运行态不得回写源数据。
- **Rule 10 — Small Migrations**：`one boundary → one migration → one verification`；禁止 Big Bang。

本阶段补充约束：

1. **一个 Gate 只处理一个边界**。Gate 内不得顺手做无关的 UI、内容、PWA 或文档重构。
2. **一个 Gate 一个原子 commit**。commit message 使用 `AGENTS.md` 规定的英文 Conventional 格式；不得把多个 Gate 混在一个 commit。
3. **没有证据就没有“完成”**。未执行的命令写 `NOT RUN`，不得写 `PASS`。
4. **不得把生成物提交入库**。`artifacts/`、`dist/`、`release/`、`node_modules/` 仍按 `.gitignore` 处理；证据放入忽略目录，结论写入本文件执行日志。
5. **不得以“网络问题”代替失败诊断**。外部下载失败必须记录 URL、错误、缓存状态、是否可复现；不能用一句“网络阻塞”关闭 P0。
6. **不得删除 `AGENTS.md` 或本文要求的验证步骤**。如果某步骤被证明不适用，必须在执行日志中写明理由，并由审计 Agent 确认。

### 0.3 严重度定义

| 级别 | 定义 | 处置要求 |
|---|---|---|
| **P0** | 导致产物不可发布、内容不完整、干净 clone 不可复现、用户无法获得内容 | 必须先修复；未关闭不得进入发布候选 |
| **P1** | 不直接阻断启动，但会造成 SSOT 腐化、测试失真、发布工具链失效 | P0 关闭后按边界处理 |
| **P2** | 死路由、残留功能、注释/文档漂移、可独立清理的问题 | 可独立小提交处理，不阻塞发布 |

---

## 1. 复核结论

### 1.1 一句话结论

> **上一份阶段报告不是伪造报告：其 Git 分离、路径迁移、ABP 基础数据、构建与测试数字大体可复现；但“阶段完成、只剩 `electron-builder --dir`”的验收结论不成立。**

更准确的定性是：

> **当前状态是“重构基线（refactor baseline）”，不是“发布候选（release candidate）”。**

### 1.2 已接受的部分

以下工作可以作为后续基础保留：

- 双仓分离与 `electron/main` 分支基线；
- 旧 `src/content/docs/collections/`、`public/abp-packs/` 从 Git 跟踪中移除；
- `content-sources/collections/` 下 4 个合集、13 本书的源内容；
- 13 个 ABP 包的 canonical slug、`legacySlug`、`sourcePath` 与 AI/图谱/交叉引用/巡检辅助数据；
- Electron 启动时不再全量复制 ABP、不再启动即清缓存；
- `DesktopBookManager` 的 staging/rename 安装主路径；
- `StaticHandler` 的 canonical/legacy 动态阅读路由；
- `npm run check:all`、`npm run build`、`node scripts/build-electron.mjs` 的当前可执行性。

### 1.3 不接受的部分

以下结论必须从“已完成”改回“未完成”：

1. **桌面包体不可发布**：`electron-builder --dir` 能完成，但产物为 **2,853.3 MB unpacked / 1,720.62 MB `app.asar`**，不属于 lean 构建。
2. **ABP 并不自包含 exercises**：13 个包全部没有 `bundle.exercises`；`artifacts/exercises` 不存在；题库生成器只覆盖 2 本书。
3. **发行契约未定义**：安装包不带任何书；release 流水线也不生成/上传 ABP。零内置书 Shell 的“首次内容获取”路径没有定义。
4. **干净 clone 不可复现**：`public/data/exercises/community_ai_solutions.json` 被 `.gitignore` 忽略，却被 `package.json:files` 引用。
5. **SSOT 仍是双轨**：`collections` / `sourceCollections` fallback 未删除；`content-sources/catalog.json` 没有运行时消费者。
6. **测试全绿不等于覆盖有效**：至少两个契约测试在旧路径不存在时直接 `return`，迁移后已成为空跑。
7. **治理与发布工具链未同步**：`AGENTS.md`、README、34 个脚本、8 个测试、35 篇文档仍含旧路径；桌面仓无 `origin`，但 push/release 脚本仍默认 `origin`。
8. **PWA/SEO 清理不彻底**：`features.pwa` 仍默认启用，`public/sw.js` 仍被注册/复制。
9. **构建仍有死路由**：`/workspace/ingest-controller` 被 Astro 当作页面路由生成，并产生构建警告。

### 1.4 发布状态

| 项目 | 状态 |
|---|---|
| 代码可构建 | 是（有警告） |
| 单元/契约/验收测试 | 通过（存在空跑测试） |
| 桌面 unpacked 产物 | 可生成，但体量不可接受 |
| 桌面安装包（NSIS/portable） | **未验证** |
| 13 本 ABP 内容完整 | 章节/图片/辅助索引完整；**exercises 不完整** |
| 安装包自带内容 | **无**（按当前 `files` 配置） |
| ABP 发行渠道 | **未定义** |
| 可发布候选 | **否** |

---

## 2. 复核方法与基线

### 2.1 已执行的验证

以下命令在当前工作树执行，除生成忽略产物外未修改源码：

```powershell
git status --short
git log -1 --oneline
git remote -v
git diff --shortstat c36f8dbe..cbb19a78

npm run check:all
npm run build
node scripts/build-electron.mjs

# 直接验证报告所称“阻塞”的打包命令
& .\node_modules\.bin\electron-builder.cmd --dir --win
```

补充验证：

```powershell
# ABP 包解析（Gzip JSON）
node -e "const fs=require('fs'),zlib=require('zlib'),path=require('path'); ..."

# app.asar 条目与体积
node -e "const asar=require('@electron/asar'); ..."

# 干净 clone 跟踪状态
git ls-files public/data/exercises
git check-ignore -v public/data/exercises/community_ai_solutions.json
```

### 2.2 关键基线数字

| 指标 | 实测值 |
|---|---:|
| `electron/main` HEAD | `cbb19a78` |
| 相对 `c36f8dbe` 的 diff | 671 files changed, 939 insertions, 6,647 deletions |
| 源书库 | 4 collections / 13 books |
| ABP 包 | 13 `.abp` / 1,251 chapters |
| `legacySlug` 章节 | 1,195 / 1,251 |
| `sourcePath` 章节 | 1,251 / 1,251 |
| ABP 包中 `exercises` | **0 / 13** |
| 测试 | 61 files / 348 tests passed |
| Astro 构建 | 22 pages |
| `dist` 体积 | 37.7 MB |
| `app.asar` | 1,720.62 MB / 27,031 entries |
| `win-unpacked` | 2,853.3 MB |
| `node_modules` in asar | 25,485 entries / 2,445.8 MB |
| `@huggingface` in asar | 1,566.8 MB（含本地 `.cache` 模型） |
| ABP artifacts | 8,210 files / 614.8 MB；`.abp` 合计 144.3 MB |

> 说明：`npm run build` 本次耗时 11.48s，报告中为 18.90s；构建时间受机器负载影响，不作为“不实”证据。  
> `npm run check:all` 通过不等于测试有效；空跑测试问题见 §4.6。

### 2.3 证据限制

- 本文的 ABP 统计来自当前 `artifacts/abp-packs` 已有产物，不是重新执行 `pack --all` 后的全量生成结果；脚本逻辑与产物结构已交叉核对。
- `release/win-unpacked` 是当前工作树打包产物；其中的 `@huggingface/.cache` 模型来自本地运行缓存。清洁 CI 上的体积可能不同，但 `package.json` 没有任何排除规则，因此该风险是真实的。
- `--win` 的 NSIS/portable 安装包未在本次复核中生成；`--dir` 成功不能替代安装包验证。
-  Electron 应用启动、AI 推理、ONNX native 加载未做端到端 smoke test；只能声明“打包命令成功”，不能声明“应用功能通过”。

---

## 3. 报告主张逐项审计

| # | 报告主张 | 判定 | 复核结论 |
|---|---|---|---|
| 1 | Web/desktop 仓分离完成；桌面分支、基线、重构 commit 正确 | **真** | 桌面仓 `electron/main` @ `cbb19a78`，基线 tag 指向 `c36f8dbe`；`AstroLib-Web` 在 `main` @ `f48ca25b`，工作树干净。桌面 remote 为 `private` / `web-upstream`，无 `origin`。 |
| 2 | 零内置书籍；13 本源书；旧内容目录与旧 `public/abp-packs` 已移除 | **真** | `src/content/docs/collections`、`public/abp-packs` 均无 Git 跟踪；`content-sources` 有 4 合集 / 13 本；`dist/collections`、`dist/abp-packs` 不存在。 |
| 3 | ABP 13 包、1,251 章；canonical/legacy slug 与 sourcePath 收口 | **真** | 13/13 包可解析；1,251 章；canonical 不一致 0；1,195 章有 `legacySlug`；1,251 章有 `sourcePath`。 |
| 4 | AI 索引、关系图、交叉引用、巡检数据已内嵌 | **真** | 13/13 包存在 `aiIndex`、`relationGraph`、`crossRefs`、`inspectorData`。 |
| 5 | exercises 已内嵌，ABP 自包含 | **假** | 13/13 包的 `bundle.exercises` 为空/不存在；`artifacts/exercises` 不存在；`scripts/build-exercise-data.mjs` 只覆盖 2 本书；`build:all` 不执行题库生成。 |
| 6 | SSOT 已统一，`content-sources/catalog.json` 为权威目录 | **半真/不成立** | `collections` 仍为空数组，`getCatalogCollections()` 仍 fallback 到 `sourceCollections`；`getCatalogBooks()` 注释“始终 13 本”与实际实现不一致；`content-sources/catalog.json` 被忽略且无运行时读取。 |
| 7 | 测试与类型检查全部通过 | **真，但覆盖失真** | 61 files / 348 tests 通过；但 `katex-metrics`、`algorithm-block` 在旧目录不存在时直接 `return`，至少两项已空跑。 |
| 8 | Electron 动态阅读、无 Web fallback、staging 安装、静态辅助路由完成 | **基本真** | `book-manager` 有 staging/rename 与 `resolveSafeSubpath`；`static-handler` 有 canonical/legacy 路由与辅助数据路由；`main.ts` 删除启动复制/清缓存。仍有元数据写入非事务、校验浅等 P1 问题。 |
| 9 | 清理完成：旧 Web/PWA/离线/IndexNow/脚本/测试/文档已统一迁移 | **部分真** | 大量旧文件确实删除；但 PWA 仍启用、SW 仍注册、IndexNow key/SEO 仍存在；34 个脚本、8 个测试、35 篇文档仍含旧路径；push/release 脚本仍默认 `origin`。 |
| 10 | 唯一未解决项是 `electron-builder --dir` 在当前网络阻塞 | **不成立/不可复现** | 直接执行 `electron-builder --dir --win` 退出码 0，生成 `AstroLib.exe` 与 `app.asar`；真正的阻塞是包体 2.85GB、内容分发未定义、exercises 缺失，而不是命令不能完成。 |
| 11 | 桌面包 lean、`asar: true`、只打 `dist` | **窄口径真，整体假** | `app.asar` 确实不含 `src`、`content-sources`、`public/abp-packs`、`dist/collections`；但 electron-builder 自动带入生产依赖，`app.asar` 达 1.72GB，不能称 lean。 |
| 12 | Web/desktop 边界已在代码层收口 | **部分真** | Provider/reader-shell 主路径收口；但 `content-sources/catalog.json`、PWA、SEO、旧脚本、旧测试、旧文档仍是跨界残留。 |

---

## 4. 发现与处置

### 4.1 P0-1：桌面产物体量不可发布

#### 事实

`electron-builder --dir --win` 成功，产出：

| 指标 | 实测 |
|---|---:|
| `release/win-unpacked` | 2,853.3 MB |
| `resources/app.asar` | 1,720.62 MB |
| `app.asar` entries | 27,031 |
| `node_modules` entries | 25,485 |
| `node_modules` size | 2,445.8 MB |
| `@huggingface` size | 1,566.8 MB |
| `AstroLib.exe` | 237.95 MB |
| `app.asar.unpacked` | 776.3 MB |

`app.asar` 内确实没有 `src/`、`content-sources/`、`public/abp-packs/`、`dist/collections/`。问题不是“文件过滤完全失败”，而是：

1. `package.json:files` 只显式包含 `dist/**/*`、`dist-electron/**/*` 等，**没有排除生产依赖**；
2. Electron 自动带入 `dependencies`；`astro`、`vite`、`@astrojs/*`、`@pagefind`、`mermaid`、`esbuild`、`rolldown` 等构建期包仍在 `dependencies`；
3. `@huggingface/transformers/.cache` 的模型文件被打入 `app.asar`，其中包含一个 80.3MB 的 `.tmp` 文件；
4. 多平台/多架构 native 二进制未按 Windows x64 裁剪；
5. 没有体积预算，也没有 `app.asar` 禁止路径/大小契约测试。

#### 结论

“`asar: true`”是真的；  
“lean shell”是假的；  
“`electron-builder --dir` 阻塞”不可复现。

#### 不在本项处理

- 不改业务 UI；
- 不改 ABP schema；
- 不决定是否预置书库（该决策属于 G0）。

#### 验收标准

见 §5 G1。必须同时给出：

- `app.asar` 禁止路径检查结果；
- `app.asar` / `win-unpacked` 实际体积；
- `AstroLib.exe` 启动 smoke test 结果；
- 体积预算与偏差说明。

---

### 4.2 P0-2：ABP 的 exercises 并不存在

#### 事实

`pack-book-abp.mjs` 的习题来源只有：

```text
artifacts/exercises/<slug>
public/data/exercises/<slug>
```

但：

- `artifacts/exercises/` 不存在；
- `public/data/exercises/` 没有按书切片的题库；
- `scripts/build-exercise-data.mjs` 只处理 `engineering_analysis` 与 `linear_algebra_geometry` 两本书；
- `package.json:build:all` 不执行 `build:exercises`；
- `electron-release.yml` 不执行任何题库/ABP 打包步骤；
- 13 个 `.abp` 的 `bundle.exercises` 全部为空/不存在。

#### 结论

当前 ABP 对“章节、图片、AI 索引、关系图、交叉引用、巡检”是自包含的；  
对 **exercises 不是自包含的**。报告把 exercises 与其它辅助数据并列写成完成项，属于实质性过度声明。

#### 验收标准

见 §5 G2。必须用真实包（不是合成 fixture）证明：

- 至少一个真实 `.abp` 的 `bundle.exercises` 非空；
- 安装后 `exercises/` 落盘；
- `StaticHandler` 对 `/data/exercises/...` 返回 200；
- 支持书单与实际生成器输出一致；
- 若只支持部分书，测试必须按支持书单断言，不能写“13 本全量通过”。

---

### 4.3 P0-3：内容发行契约未定义

#### 事实

- `package.json:files` 不包含任何 `.abp` / `dist/abp-packs` / `artifacts/abp-packs`；
- `npm run build` 只构建 Astro，不生成 ABP；
- `build:all` 生成 ABP，但 `electron-release.yml` 不调用它；
- release workflow 只上传安装包/压缩包/blockmap/latest.yml，不上传 ABP；
- 安装包启动后用户目录中没有预置书；
- 代码中也没有“从发行通道下载书”的产品入口定义。

#### 结论

当前同时存在两种互斥假设：

- **零内置书 Shell**：安装包不带书，但必须有内容获取路径；
- **预置书库**：安装包带书，但当前 `files` 明确不带。

没有 ADR 选择其中一种，也没有对应的 release 流程。这是发布阻断项，不是“打包网络问题”。

#### 验收标准

见 §5 G0 + G3。必须在 ADR 中明确：

- 模式 A 还是模式 B；
- ABP 的来源、版本、校验方式；
- 首发书单；
- 用户首次获取内容的 UI/协议；
- release 产物清单。

---

### 4.4 P0-4：干净 clone 与发布不可复现

#### 事实

`package.json:files` 包含：

```json
"public/data/exercises/community_ai_solutions.json"
```

但 `.gitignore` 忽略整个 `public/data/exercises/`，`git ls-files` 对该路径返回 0。  
因此：

- 当前工作树打包时该文件存在；
- 干净 clone / CI 中没有该文件；
- 这不是“可选文件”，因为 `files` 明确声明它应进入安装包。

#### 结论

发布流水线没有做到“从干净 clone 可复现”。  
同时，`npm run build` 已从“全量构建”退化为“只构建 Astro”，但 README 仍宣称它包含习题与索引构建。

#### 验收标准

见 §5 G1/G3：

- 该文件要么纳入 Git，要么由明确的 build 步骤生成；
- `package.json:files` 不得引用未跟踪文件；
- 干净 clone 执行完整构建后，文件存在且可打包。

---

### 4.5 P1-1：SSOT 仍是双轨

#### 事实

`src/config/collections.config.ts`：

```ts
export const collections: Collection[] = []; // L13
export const sourceCollections: Collection[] = [ ... ]; // 4 collections / 13 books

export function getCatalogCollections(): Collection[] {
  return collections.length > 0 ? collections : sourceCollections; // L705-L707
}
```

- `getCatalogBooks()` 注释写“始终返回全部 13 本”，但实际走上述 fallback；如果未来 `collections` 非空，返回集合会改变。
- `getAllBooks()` 默认 `sourceMode = false`，仍返回空的 `collections`。
- `rehype-cross-ref.mjs` 仍使用 `[collections, sourceCollections]` 双候选。
- `content-sources/catalog.json` 被 `.gitignore` 忽略，由 pack 脚本投影生成，但没有运行时消费者；`CONTENT_CATALOG_REL` 只在打包脚本中使用。

#### 结论

“增加了一个 catalog helper”不等于“SSOT 收口”。  
当前仍是“一个空数组 + 一个 source 数组 + 一个可回退函数 + 一个无消费者的 JSON 投影”。

#### 验收标准

见 §5 G4。最低要求：

- `collections.length > 0 ? ... : ...` 从生产路径删除；
- `getCatalogBooks()` 在两种配置状态下都精确返回 13 本；
- `rehype-cross-ref` 只读一个目录源；
- `content-sources/catalog.json` 明确“生成物”或“源”，不能两者都声称；
- 增加 exact count/slug set 测试。

---

### 4.6 P1-2：测试全绿存在空跑

#### 事实

`tests/contract/katex-metrics.test.ts`：

```ts
const docsDir = path.resolve('src/content/docs/collections/math/engineering_analysis');
if (!fs.existsSync(docsDir)) return;
```

`tests/contract/algorithm-block.test.ts`：

```ts
const algosDir = path.join(rootDir, 'src/content/docs/collections/cs/algorithms');
...
if (!fs.existsSync(algosDir)) return;
```

迁移后这些旧目录已经不存在，因此相关测试直接返回，测试运行器仍记为通过。

#### 结论

61 files / 348 tests 的数字是真的；  
“测试覆盖了迁移后的内容与路径”是假的。

#### 验收标准

见 §5 G5：

- 旧路径测试迁移到 `content-sources/`；
- 目录不存在时必须 fail，而不是 return；
- 增加“至少一个真实 ABP exercises”“13 本 exact count”“app.asar 禁止路径”三类契约测试；
- 在测试名或注释中标注真实输入源。

---

### 4.7 P1-3：Electron 安装/校验仍有非事务边界

#### 事实

`electron/services/book-manager.ts`：

- 安装使用 staging + rename，主目录替换有 backup/rollback；
- 但元数据写入在目录替换之后（`book-manager.ts:223-242`），如果 `writeFileAtomic` 失败，会出现“书已落盘、索引未记录”的状态；
- `validateAbpBundle()` 只校验 manifest 的 `id/slug/colSlug/title/sections` 和 chapters 的 `title/html`，不校验 `schemaVersion`、`entryPoint`、section 引用、chapters 与 manifest 的一致性；
- Web provider 的 `installBookFromAbp` 不调用该校验，也不持久化 assets。

#### 结论

主路径比迁移前好，但“严格校验 + 事务安装”仍是过度声明。  
这属于 P1：不阻塞首次启动，但会在损坏包、重复安装、元数据写入失败时留下不一致状态。

#### 验收标准

见 §5 G5：

- 元数据写入失败时回滚目录或标记可恢复状态；
- 校验覆盖 schema version、entry point、section/chapter 引用；
- 增加损坏包/重复安装/元数据失败测试；
- Web provider 与 Electron 使用同一校验入口，或明确 Web 不支持安装。

---

### 4.8 P1-4：治理文档与发布工具链未同步

#### 事实

`AGENTS.md` 仍写：

- ABP 产物输出至 `public/abp-packs/` 与 `dist/abp-packs/`；
- reader shell 位于 `src/services/content-provider/reader-shell-template.ts`。

实际：

- 产物在 `artifacts/abp-packs/`；
- reader shell 在 `electron/server/reader-shell-template.ts`，且文件头注释仍是旧路径。

`README.md` 仍写：

- `npm run build` 是包含习题/索引的全量构建；
- 项目结构包含 `src/content/docs/collections/`；
- 配置是 `collections.config.mjs`。

工具链：

- 桌面仓 remote 只有 `private` 与 `web-upstream`，无 `origin`；
- `scripts/git-clean-push.mjs` 默认 `remote: 'origin'`；
- `scripts/release-desktop.mjs` 仍执行 `git push origin HEAD`；
- 因此 `npm run push:clean`、`npm run release:desktop` 在桌面仓当前配置下不可直接使用。

规模：

- 34 个脚本、8 个测试、35 篇文档仍含旧路径或旧产物路径；
- 不是所有引用都是运行时错误，但“全部迁移完成”的表述不成立。

#### 验收标准

见 §5 G5：

- 高价值文档/命令/测试先迁移；
- 历史文档明确标记“归档，不作为执行指令”；
- push/release 脚本使用显式 remote 或自动检测；
- 在桌面仓执行 remote 预检，失败时给出明确错误，而不是运行到 push 才失败。

---

### 4.9 P2-1：PWA/SEO 残留

#### 事实

- `src/config/features.config.ts` 的 `pwa.enabled` 仍为 `true`；
- `src/components/HeadOverride.astro` 仍在 localhost/127.0.0.1 注册 `/sw.js`；
- `public/sw.js` 仍存在；
- `features.config.ts` 仍保留 IndexNow key，SEO 功能仍默认启用；
- `public/offline.html`、`public/manifest.webmanifest` 仍在。

#### 结论

如果目标是纯桌面应用，这些是 Web 运行时残留；  
如果 Web 仓仍需要，它们应归 `AstroLib-Web`，不应在桌面仓默认启用。  
不能一边宣称“PWA 清理完成”，一边保留注册与构建复制。

#### 验收标准

见 §5 G5：明确二选一，并用 feature flag 或仓归属落地。

---

### 4.10 P2-2：构建死路由

#### 事实

`npm run build` 成功，但输出：

```text
No API Route handler exists for method GET for route /workspace/ingest-controller
```

`src/pages/workspace/ingest-controller.ts` 是客户端控制器，却被 `src/pages/workspace/ingest.astro` 以模块方式导入；Astro 将其视为页面路由，生成 `dist/workspace/ingest-controller/index.html`。

#### 结论

不是发布阻断项，但说明“死页面清理”未完成；构建成功不应掩盖路由警告。

#### 验收标准

见 §5 G5：把 controller 移出 `src/pages/`，更新 import，确认警告消失且不再生成多余 HTML。

---

## 5. 下一阶段执行 Gate

> **总原则：G0 决策未完成，不得开始 G1；G1 未通过，不得开始 G2/G3；每个 Gate 结束必须提交一个原子 commit，并在本文 §7 追加执行日志。**
>
> Gate 顺序按依赖关系排列，不按“容易程度”排列。

### G0：发行契约决策（无代码）

**Owner**：产品/技术负责人；执行 Agent 只负责起草 ADR 与收集证据。

**边界**：只决定“书如何到达用户”，不改代码、不改构建、不改 UI。

**必须回答**：

1. 采用 **模式 A：零内置书 Shell**，还是 **模式 B：预置书库**？
2. 若模式 A：
   - ABP 从哪个 release/通道获取？
   - 首次启动如何导入/下载？
   - 书目版本与更新如何校验？
   - 离线用户如何获得书？
3. 若模式 B：
   - 首发书单是 13 本还是子集？
   - 安装包体积预算是多少？
   - `.abp` 还是展开目录进入安装包？
   - 更新包如何增量替换？
4. 两种模式都不能同时保留；未选定的路径必须从构建/文档中移除或标记为 `NOT ACTIVE`。

**产出**：

- `docs/architecture/ADR-DISTRIBUTION-2026-11-12.md`（或等价 ADR）；
- 首发书单与 ABP 版本号；
- 发布产物清单；
- 对 `electron-release.yml` 的目标状态描述。

**通过标准**：

- ADR 明确选择一种模式；
- 不存在“安装包不带书，但也没有获取路径”的状态；
- 审计 Agent 确认 ADR 与 `package.json:files`、release workflow 的目标一致。

**停止条件**：

- 负责人未选择模式；
- 执行 Agent 自行替用户选择；
- ADR 同时保留两种互斥模式。

---

### G1：打包与依赖边界（P0）

**边界**：只处理 Electron 产物体积、依赖分层、native 资源裁剪；不改业务逻辑、不改 ABP schema、不改 UI。

**输入**：

- 当前 `package.json` / `package-lock.json`；
- `scripts/build-electron.mjs` 的 external 列表；
- `electron/main.ts` 的 import graph；
- G0 ADR 中关于安装包内容的决定。

**任务**：

1. **依赖分层**
   - 审计 `dependencies` 与 `devDependencies`；
   - 构建期包（`astro`、`vite`、`@astrojs/*`、`@pagefind`、`mermaid`、`esbuild`、`rolldown`、构建期 `sharp` 等）迁至 `devDependencies`，前提是 Electron 运行时没有 import；
   - 对 `@huggingface/transformers`、`onnxruntime-node`、`typst`、`sharp` 等运行时包保留必要性证据（import graph 或启动路径）。
2. **排除非运行时资源**
   - `**/.cache/**`、`**/*.tmp*`；
   - 非 Windows x64 的 `onnxruntime` native 文件；
   - 未使用的 source map、测试 fixtures、文档、示例；
   - 模型缓存迁移到 `userData` / `HF_HOME`，不进入 `app.asar`。
3. **重新评估 asar / asarUnpack**
   - 只解包实际需要的 `.node` / DLL / Python runner；
   - 明确只支持 Windows x64 时，删除其它平台二进制。
4. **建立体积预算**
   - 由 G0 决定预算；至少给出 `app.asar` 与 `win-unpacked` 上限；
   - 在 CI 或本地验收脚本中记录实际值。
5. **修复干净 clone 文件**
   - `community_ai_solutions.json` 纳入 Git 或由构建生成；
   - 不得让 `package.json:files` 指向未跟踪文件。

**非目标**：

- 不添加 ABP 到安装包（由 G3 决定/执行）；
- 不删除 PWA/SEO；
- 不改 `book-manager` 业务逻辑；
- 不改 reader-shell HTML。

**验收命令**：

```powershell
# 干净 clone 或 git archive 出的工作树
npm ci
npm run check:types
npm test
npm run build
node scripts/build-electron.mjs
& .\node_modules\.bin\electron-builder.cmd --dir --win
```

**必须附带的证据**：

- `app.asar` 条目数与体积；
- `win-unpacked` 体积；
- `app.asar` 禁止路径检查（`src/`、`content-sources/`、`public/abp-packs/`、`dist/collections/`）；
- `.cache`、`*.tmp*`、非 Windows native 检查；
- `AstroLib.exe` 启动 smoke test 结果；
- 依赖分层 diff 与 import graph 说明。

**通过标准**：

- `electron-builder --dir --win` 退出码 0；
- `app.asar` 不含禁止路径与非运行时缓存；
- 体积达到预算；
- 应用可启动到可交互界面（至少窗口加载，不要求全功能）；
- `npm run check:all` 仍通过。

**停止条件**：

- 通过删除运行时依赖来“减重”，导致 AI/阅读功能启动失败；
- 只修改 `files` 但不验证实际 `app.asar`；
- 把“命令成功”当成“体积可接受”。

---

### G2：ABP 内容完整性——exercises（P0）

**边界**：只处理题库源 → `artifacts/exercises` → ABP `exercises` 的链路；不改 UI 结构，不改 schema 版本。

**输入**：

- `src/data/exercises/` 的结构化题库；
- `scripts/build-exercise-data.mjs`；
- `scripts/pack-book-abp.mjs`；
- 真实书单（13 本或 G0/内容负责人确认的子集）。

**任务**：

1. 明确唯一题库源为 `src/data/exercises/`；禁止把生成后的 `artifacts/exercises` 当源。
2. 扩展 `build-exercise-data.mjs` 覆盖确认的支持书单；输出必须可由脚本重建。
3. 统一路径：`build:exercises` → `artifacts/exercises/<slug>/`；`pack-book-abp` 只读该路径（可保留临时兼容路径，但必须有弃用说明）。
4. 若某书没有题库，明确标记 `unsupported`，不得静默生成空 `exercises` 后宣称自包含。
5. 增加真实包集成测试：
   - 至少一个真实 `.abp` 的 `exercises` 非空；
   - `DesktopBookManager` 安装后 `exercises/` 落盘；
   - `StaticHandler` 请求 `/data/exercises/<book>/<file>.json` 返回 200；
   - 书单断言与支持列表一致。

**非目标**：

- 不新增题库内容；
- 不改习题 UI；
- 不修改 ABP 主 schema（如确需扩展，另开 Gate 并单独评审）。

**验收命令**：

```powershell
node scripts/build-exercise-data.mjs
node scripts/pack-book-abp.mjs --all --no-vectors
# 解析真实包
node -e "const fs=require('fs'),zlib=require('zlib');..."
# 运行相关测试
npx vitest run tests/unit/content-provider.test.ts tests/acceptance/abp-dynamic-serving.test.ts
```

**通过标准**：

- 支持书单内每本真实 `.abp` 的 `bundle.exercises` 非空；
- 至少一个端到端 HTTP 200 证据；
- 不支持的书写明 `unsupported`，测试按支持列表运行；
- `build:all` 或 release 流程确实调用题库构建。

**停止条件**：

- 用合成 fixture 代替真实包；
- 只验证 `exercises` 字段存在，不验证文件落盘/HTTP；
- 把 2 本书的结果写成 13 本全量完成。

---

### G3：内容发行与 release 流水线（P0）

**边界**：只处理 ABP 产物如何进入发行渠道；不重新设计应用内阅读器，不改题库生成。

**依赖**：G0 决策 + G2 内容完整性。

**任务**：

1. 按 G0 模式实现：
   - **模式 A**：release 单独上传 G0 书单内的 `.abp` + `catalog.json`；应用提供导入/下载入口；文档写明版本与校验。
   - **模式 B**：`electron-builder` 前执行 `pack-book-abp --all`；只复制 `.abp`/manifest/必要索引；禁止展开目录、图片、`.cache`。
2. 更新 `electron-release.yml`：
   - 增加 pack 步骤（模式 B）或 ABP 资产上传步骤（模式 A）；
   - 在 build 前完成内容生成；
   - 产物清单与 ADR 一致。
3. 内容版本化：
   - `catalog.json` 带 schema/内容版本；
   - 安装/导入时校验版本与必要 hash；
   - 不把生成后的 catalog 当唯一源。
4. 增加发布 smoke test：
   - 安装包启动后能看到预期书单（模式 B）或明确的导入入口（模式 A）；
   - 至少安装/打开 1 本真实书。

**非目标**：

- 不实现新的 CDN/后端服务（除非 ADR 明确要求）；
- 不改 ABP 内部章节格式；
- 不在本 Gate 处理安装包瘦身（G1 已完成）。

**验收命令**：

```powershell
# 模式 B
node scripts/pack-book-abp.mjs --all
& .\node_modules\.bin\electron-builder.cmd --dir --win

# 模式 A
node scripts/pack-book-abp.mjs --all
# 检查 release 资产目录/工作流 YAML
```

**通过标准**：

- release 产物与 ADR 一致；
- 模式 B 的安装包包含预期 `.abp`，且不含展开目录/缓存；
- 模式 A 的 release 含 ABP 资产，应用有可用导入路径；
- 首次启动内容获取路径可操作，不是只有文档说明。

**停止条件**：

- 安装包仍为零书且无导入入口；
- release 只上传安装包，不上传 ABP；
- 把 `catalog.json` 复制进 `dist` 但没有消费者。

---

### G4：真正的单目录（P1）

**边界**：只处理书库/目录的 Source of Truth；不改 UI，不改 ABP 打包格式。

**任务**：

1. 选择唯一人工维护源：
   - `sourceCollections` 为唯一源；或
   - `collections` 改为 `sourceCollections` 的派生视图。
2. 删除 `collections.length > 0 ? collections : sourceCollections` fallback。
3. `getCatalogBooks()` 必须在任何配置状态下精确返回 13 本（或 G0 确定的首发书单）；增加 exact count 与 slug set 断言。
4. `getAllBooks()` 语义明确：静态构建专用、废弃、或改为显式参数；不能默认返回空数组却作为公共 API。
5. `content-sources/catalog.json` 二选一：
   - **生成物**：只作为发布投影，标注生成脚本/输入，不参与运行时读取；或
   - **源**：由 `getCatalogCollections` 读取，并停止从 `collections.config.ts` 复制。
6. `rehype-cross-ref` 删除 `[collections, sourceCollections]` 双候选。

**非目标**：

- 不改书籍元数据内容；
- 不新增合集；
- 不改路由/阅读器。

**验收命令**：

```powershell
npm run check:types
npm test
rg "collections\.length > 0|\[collections, sourceCollections\]" src
```

> 若环境无 `rg`，使用项目既有搜索工具或 PowerShell `Select-String`；结果必须附在证据中。

**通过标准**：

- 生产路径无 fallback；
- `getCatalogBooks()` exact 13（或 ADR 书单）；
- `content-sources/catalog.json` 的定位在文档与代码中一致；
- `rehype-cross-ref` 单源；
- 测试覆盖 `collections` 为空/非空两种状态。

**停止条件**：

- 只改注释不改实现；
- 保留 fallback 但宣称“已统一”；
- 把生成物 `catalog.json` 当人工维护源。

---

### G5：治理、测试与残留清理（P1/P2）

**边界**：文档、测试、发布脚本、PWA/SEO 归属、构建警告；不再改桌面包体与题库链路。

**任务（按优先级）**：

1. **高价值文档同步**
   - `AGENTS.md` 的 ABP 输出路径与 reader-shell 路径；
   - `README.md` 的 build 说明与项目结构；
   - `docs/README.md` 的架构索引与旧路径引用；
   - 明确“历史交接文档可保留，但不得作为执行指令”。
2. **发布工具链**
   - `git-clean-push.mjs` 默认 remote 改为 `web-upstream`，或强制显式 `--remote`；
   - `release-desktop.mjs` 不再硬编码 `origin`；
   - 增加 remote 预检。
3. **测试真实性**
   - `katex-metrics`、`algorithm-block` 迁移到 `content-sources/`；
   - 目录不存在时 fail；
   - 增加 app.asar 禁止路径、ABP exercises、exact catalog count 契约测试。
4. **死路由**
   - 将 `src/pages/workspace/ingest-controller.ts` 移出 `pages`；
   - 更新 `ingest.astro` import；
   - 重新构建确认无 `/workspace/ingest-controller` 警告。
5. **PWA/SEO 归属**
   - 纯桌面：关闭 `features.pwa`，移除 `sw.js` 注册与构建复制；
   - 保留 Web：明确归属 `AstroLib-Web`，桌面仓不默认启用；
   - IndexNow/sitemap/robots 同样二选一。
6. **Electron 健壮性（可与测试项同 Gate，但单独 commit）**
   - 元数据写入失败回滚/可恢复标记；
   - `validateAbpBundle` 增加 schema/entryPoint/section/chapter 一致性；
   - Web provider 使用同一校验入口或明确禁用安装。

**验收命令**：

```powershell
npm run check:all
npm run build
# 检查构建输出无新增路由警告
# 在桌面仓执行 push/release remote 预检（不实际 push）
```

**通过标准**：

- 高价值文档不再指向已删除路径；
- `npm run build` 无 `/workspace/ingest-controller` 警告；
- 旧路径测试不再空跑；
- push/release 脚本在 `web-upstream`/`private` 配置下可预检；
- PWA/SEO 有明确归属，不再“两边都留一半”。

---

## 6. 审计协议

### 6.1 Gate 开始前

执行 Agent 必须记录：

```text
gate:
branch:
base_commit:
worktree_status:
planned_scope:
files_allowed:
files_forbidden:
acceptance_commands:
```

要求：

- 工作树干净，或明确列出未提交变更；
- 只允许修改 Gate 范围内的文件；
- 记录基线 commit；
- 不接受“先做再说，最后补记录”。

### 6.2 Gate 执行中

- 每个 Gate 一个原子 commit；
- commit message 按 `AGENTS.md` §4.1；
- 不把生成物提交入库；
- 不把多个 Gate 混在一起；
- 不修改 `AGENTS.md` 的强制规则来绕过验证；
- 不删除失败日志。

### 6.3 Gate 完成后

必须在本文 §7 追加一行，包含：

- Gate 编号；
- commit hash；
- 执行命令；
- 退出码；
- 关键观测值；
- 证据路径；
- 结论 `PASS` / `CONDITIONAL` / `FAIL`；
- 审计 Agent 复核结果。

审计 Agent 的职责不是“看执行 Agent 的总结”，而是：

1. 从干净 clone 重跑验收命令；
2. 对照本文的通过标准；
3. 检查 commit 是否越界；
4. 检查证据是否是当前 commit 的产物；
5. 对 `CONDITIONAL` 明确剩余条件与负责人。

### 6.4 结果判定

| 判定 | 含义 |
|---|---|
| `PASS` | 所有验收命令通过，证据完整，scope 未越界 |
| `CONDITIONAL` | 主目标达到，但存在已记录的次要缺口；不得进入下一 P0 Gate，除非负责人书面接受 |
| `FAIL` | 任一 P0 验收项失败；必须修复后重跑 |

### 6.5 禁止的“完成”表述

在 G0–G3 全部 PASS 前，禁止使用：

- “阶段完成”
- “桌面端重构完成”
- “可发布”
- “唯一剩余项”
- “lean 构建”
- “ABP 自包含”
- “SSOT 已统一”
- “测试全部覆盖”

允许的表述：

- “G1 PASS，G2 未开始”
- “打包命令成功，但体积超预算”
- “13 包章节完整，exercises 未支持”
- “测试通过，存在已记录的空跑测试”

---

## 7. 执行日志（由执行 Agent 追加）

> 只追加，不修改历史行。每一行必须可由审计 Agent 从 commit/命令复现。

| Gate | Commit | 命令 | Exit | 关键观测 | 证据路径 | 判定 | 审计 |
|---|---|---|---|---|---|---|---|
| G0 | — | — | — | ADR 待定 | — | NOT STARTED | — |
| G1 | — | — | — | — | — | NOT STARTED | — |
| G2 | — | — | — | — | — | NOT STARTED | — |
| G3 | — | — | — | — | — | NOT STARTED | — |
| G4 | — | — | — | — | — | NOT STARTED | — |
| G5 | — | — | — | — | — | NOT STARTED | — |
| G0 | `b5d781b8` | Owner 决策 + ADR 核对（无代码变更） | 0 | 选定模式 A（零内置书 Shell + GitHub Releases 13 本 .abp/catalog + 本地导入）；模式 B `NOT ACTIVE`；预算 `win-unpacked <= 600 MB` / `app.asar <= 200 MB` | `docs/architecture/ADR-DISTRIBUTION-2026-11-12.md` | PASS | 待审计 |
| G1 | `d9fc23c3` | `npm run check:all` + `npm run build` + `build-electron.mjs` + `electron-builder --dir --win` + asar/launch smoke | 0 | `win-unpacked=490.83 MB` (`<=600`), `app.asar=51.38 MB` (`<=200`), `app.asar.unpacked=83.06 MB`, entries=1,986, 禁止路径 0 违例, `AstroLib.exe` 启动 `/desktop/` 与 `/data/exercises/community_ai_solutions.json` 均 200, 61/348 tests pass | `artifacts/audit/g1-evidence.json` | PASS | 待审计 |
| G2 | `0dec5036` | `build-exercise-data.mjs` + `pack-book-abp --all --no-vectors` + `vitest` + `npm run check:all` | 0 | 13 包/1,251 章；4 本支持书单（`engineering_analysis` 101、`linear_algebra_geometry` 41、`digital_circuit` 22、`electronic_circuits` 16 文件）`bundle.exercises` 非空且真实落盘/HTTP 200；其余 9 本显式标记 `unsupported`；61/349 tests pass | `artifacts/audit/g2-evidence.json` | PASS | 待审计 |
| G3 | `d33633c1` | `pack-book-abp --all --no-vectors` + `npm run check:all` + `build` + `build-electron` + `electron-builder --dir --win` + Mode A smoke | 0 | `electron-release.yml` 同步打包并上传 13 `.abp`+`catalog.json`；IPC 拉取+size/hash 校验+首次启动“官方书库”与本地导入 UI 就绪；`AstroLib.exe` 章节/习题均 200；62/352 tests pass | `artifacts/audit/g3-evidence.json` | PASS | 待审计 |

---

## 8. 附录 A：关键代码位置（快照 `cbb19a78`）

> 行号可能随提交漂移；审计时以函数名/路径为准。

| 主题 | 位置 |
|---|---|
| 空 `collections` 与 fallback | `src/config/collections.config.ts:13`、`:705-707` |
| `getAllBooks` / `getCatalogBooks` | `src/config/collections.config.ts:709-741` |
| `rehype-cross-ref` 双候选 | `src/plugins/rehype/rehype-cross-ref.mjs:91-103` |
| content paths | `src/core/catalog/content-paths.ts:10-13` |
| exercises 可选读取 | `scripts/pack-book-abp.mjs:767-793` |
| `.abp` 原子写入 | `scripts/pack-book-abp.mjs:796-813` |
| 题库生成器仅两本 | `scripts/build-exercise-data.mjs:21-29` |
| build/build:all/electron 脚本 | `package.json:10-20` |
| electron-builder files | `package.json:89-99` |
| ignored exercise data | `.gitignore:46` |
| ABP 安装 staging/元数据 | `electron/services/book-manager.ts:195-242` |
| ABP 浅校验 | `src/types/content-package.ts:205-235` |
| 静态辅助路由 | `electron/server/static-handler.ts:201-255` |
| canonical/legacy 路由 | `electron/server/static-handler.ts:319-377` |
| 旧 AGENTS 路径 | `AGENTS.md:206-213` |
| 旧 README build/结构 | `README.md:108-129`、`:159-171` |
| push 默认 origin | `scripts/git-clean-push.mjs:45` |
| release 硬编码 origin | `scripts/release-desktop.mjs:88-96` |
| PWA enabled | `src/config/features.config.ts:395-401` |
| SW 注册 | `src/components/HeadOverride.astro:226-228` |
| 死路由 controller | `src/pages/workspace/ingest-controller.ts:27` |
| 空跑测试 | `tests/contract/katex-metrics.test.ts:8-9`；`tests/contract/algorithm-block.test.ts:9`、`:39` |

---

## 9. 附录 B：复现命令与观测模板

### 9.1 Git 基线

```powershell
git status --short
git log -1 --oneline
git remote -v
git diff --shortstat c36f8dbe..cbb19a78
git diff --name-status c36f8dbe..cbb19a78
```

### 9.2 构建与测试

```powershell
npm run check:all
npm run build
node scripts/build-electron.mjs
```

记录：

```text
check:all: <files>/<tests> passed/failed, duration
build: pages, warnings, dist size
build-electron: exit, dist-electron files
```

### 9.3 打包

```powershell
& .\node_modules\.bin\electron-builder.cmd --dir --win
```

记录：

```text
exit:
win-unpacked size:
app.asar size:
app.asar entries:
node_modules entries/size:
forbidden paths present:
AstroLib.exe launch:
```

### 9.4 ABP 内容检查

```powershell
node -e "const fs=require('fs'),zlib=require('zlib'),path=require('path'); const d='artifacts/abp-packs'; let n=0,ex=0,ch=0; for(const f of fs.readdirSync(d).filter(x=>x.endsWith('.abp'))){const b=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(d,f)))); n++; if(b.exercises) ex++; for(const s of b.manifest.sections) ch+=s.chapters.length;} console.log({packs:n,withExercises:ex,chapters:ch});"
```

### 9.5 干净 clone 检查

```powershell
git ls-files public/data/exercises
git check-ignore -v public/data/exercises/community_ai_solutions.json
```

要求：`package.json:files` 中的每个路径都能在干净 clone 中存在，或由构建生成。

---

## 10. 最终验收定义

项目可以进入“发布候选”当且仅当：

- **G0 PASS**：发行模式已选定，ADR 可审计；
- **G1 PASS**：桌面包体达到预算，且无禁止路径/缓存；
- **G2 PASS**：支持书单的 exercises 真实自包含；
- **G3 PASS**：发行渠道与安装包/ABP 资产一致，首次内容获取路径可操作；
- **G4 PASS**：SSOT 单轨，exact 13（或 ADR 书单）可验证；
- **G5 PASS**：高价值文档/测试/工具链同步，无 P0/P1 未记录例外；
- 所有 Gate 的执行日志和证据可由审计 Agent 从干净 clone 复现。

在此之前，项目状态保持：

```text
REFACTOR BASELINE — NOT RELEASE CANDIDATE
```

---

**复核人**：独立审计 Agent（本次会话）  
**复核方式**：只读代码 + 实际构建/测试/打包 + 产物解析  
**源码修改**：无（本文件为新增审计文档）  
**下一次更新条件**：任一 Gate 完成、或被审计发现新 P0/P1 事实
