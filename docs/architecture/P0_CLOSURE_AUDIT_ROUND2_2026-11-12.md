# AstroLib 第二轮 P0 关闭审计

**审计结论：`P0 NOT CLOSED`。不得将当前状态标记为发布候选，也不得进入 P1 的正式交接。**

| 项目 | 内容 |
|---|---|
| 审计对象 | 执行 Agent 第二轮 G0–G5 阶段报告及 `artifacts/audit/g1..g5-evidence.json` |
| 审计基线 | 分支 `electron/main`，HEAD `8c6508f9`，工作树审计开始时干净 |
| 审计日期 | 2026-11-12 |
| 审计类型 | 独立、只读证据审计；未修改源代码 |
| 审计方法 | 代码/配置核对、当前工作区构建测试、`git archive` 干净归档复现、产物解析、Release 配置链路核对 |
| 一句话结论 | 当前工作区的 63/357 通过依赖被忽略文件、生成类型、构建产物和本机缓存；干净归档的 `check:types` 与 `npm test` 均失败，G3 发行链路亦未闭合。 |

---

## 1. 执行摘要

执行 Agent 第二轮在门禁表中把 G1–G3 标为 `PASS`，并给出：

- `63 files / 357 tests passed`；
- `app.asar = 51.38 MB`、`win-unpacked = 490.83 MB`；
- 13 个 `.abp`、4 本支持题库、9 本 `unsupported`；
- 官方书库 UI、IPC 校验、本地 `.abp` 导入 smoke；
- `electron-release.yml` 已配置上传 `.abp` + `catalog.json`。

独立复核确认其中一部分事实成立：G2 的 13 包/1,251 章和 4 本题库是真实的，G1 的包体预算也基本达标。但 **“P0 可关闭”不成立**，原因不是单个数字偏差，而是四条 P0 级事实：

1. 干净归档执行 `npm run check:types` 失败，CI/Electron Release 的类型检查步骤会直接 red；
2. 干净归档执行 `npm test` 失败，当前 63/357 依赖 `backup/`、`artifacts/`、Electron 二进制和模型缓存；
3. `electron-release.yml` 的发布仓坐标与 App 默认拉取坐标不一致，且手动触发的 tag 解析有误；
4. `release/` 没有任何 NSIS/portable 安装包，G3 只有 `--dir` 证据。

因此本轮裁决为：

```text
P0: NOT CLOSED
P1: NOT ACCEPTED FOR FORMAL HANDOFF
```

---

## 2. 审计范围与边界

### 2.1 本轮覆盖

- G0：发行模式 ADR 是否足以作为后续边界；
- G1：包体预算、禁止路径、Electron `--dir` 产物；
- G2：13 个 `.abp` 的章节与 exercises 是否真实自包含；
- G3：官方 catalog、下载/哈希校验、发行仓、Release workflow、安装包；
- G4：`sourceCollections` 单源与 exact 13；
- G5：文档/死路由/PWA 清理与测试工具链同步；
- P0-4：干净 clone 的依赖安装、类型检查、构建、测试与发布复现。

### 2.2 不在本轮范围

- 不重新设计 Mode A/Mode B；
- 不修复业务功能；
- 不替代产品负责人做“接受条件性风险”的决策；
- 不对 P1/P2 的全部历史债务做穷尽审计。

### 2.3 证据等级

本报告只把以下结果视为“通过”：

- 命令退出码为 0；
- 在 **`git archive` 出的干净工作树**中执行，而不是只在已有 `.astro/`、`node_modules/`、`backup/`、`artifacts/` 的工作区执行；
- 产物路径、体积、HTTP 状态或哈希可被独立复核；
- 发布链路有真实 GitHub Release 资产或明确的本地等价证据，而不是仅检查 YAML 文本。

---

## 3. 干净归档复核（核心失败）

### 3.1 方法与结果

从 HEAD `8c6508f9` 生成 `git archive`，解压到空目录后执行：

```powershell
npm ci
npm run check:types
npm run build
npm run check:types   # build 后复测
npm test
```

结果：

| 步骤 | 结果 | 关键观测 |
|---|---|---|
| `npm ci` | **PASS** | 901 packages，约 40s，lockfile 可用 |
| `npm run check:types`（首次） | **FAIL** | `TS2305: Module '"astro:content"' has no exported member 'RenderResult'` |
| `npm run build` | **PASS** | 22 pages / 23 HTML；生成 `.astro/types.d.ts` |
| `npm run check:types`（build 后） | **PASS** | 证明首次失败是缺少 Astro 生成类型 |
| `npm test` | **FAIL** | 6 failed files / 3 failed tests / 327 passed / 3 skipped（333 tests） |

同一基线在当前工作区执行 `npm test` 为 **63 files / 357 tests PASS**。这不是“干净 clone 也通过”，而是当前工作区存在干净归档没有的本地状态。

### 3.2 类型检查失败：CI 顺序问题

事实链：

- `package.json:37` 的 `check:types` 只有 `tsc --noEmit`；
- `tsconfig.json:10` 的 `include` 包含 `.astro/types.d.ts`；
- `.gitignore` 忽略 `.astro/`；
- `.github/workflows/ci.yml:42-43` 在 `npm run build` 之前执行 `npm run check:types`；
- `.github/workflows/electron-release.yml:40-44` 同样先 typecheck、后 build。

结论：干净 clone 的 CI 静态分析 job 和 Electron Release 都会在类型检查处失败。当前工作区的“0 errors”是因为之前 session 已生成 `.astro/`。

**最低修复**：让 `check:types` 自身执行 `astro sync`，或在 CI 中把 build/sync 放到 typecheck 之前。不能要求开发者“先手动 build 一次”再 typecheck。

### 3.3 测试失败：隐藏依赖与隐式下载

干净归档 `npm test` 的失败分为四类：

1. **被 `.gitignore` 忽略的 `backup/` 样例**
   - `tests/acceptance/export-acceptance.test.ts:107,162,224,260` 在 `src/content/docs/collections/` 不存在时回退到 `backup/preset-books-source/...`；
   - `.gitignore:69` 忽略 `backup/`，该文件不在 `git archive` 中；
   - 干净归档实测 `ENOENT`，测试套件直接失败。

2. **缺少 `artifacts/abp-packs/` 时的现场打包超时**
   - `tests/acceptance/release-distribution.test.ts:19-31` 的 `beforeAll` 在 catalog/ABP 不存在时现场执行 `build-exercise-data` + `packBook`；
   - 该 hook 超时为 10s；干净归档实测 `Hook timed out in 10000ms`；
   - 该测试应依赖显式预构建产物，或提高 hook timeout，不能把完整编译塞进 10s hook。

3. **Electron 二进制隐式下载竞态**
   - `electron` 包的 `index.js` 在二进制缺失时惰性下载；Vitest 并行加载 `electron-services`、`zero-precompiled-books` 等套件时触发目录创建竞态；
   - 干净归档首跑报 `Electron failed to install correctly`；
   - 当前工作区已有 `node_modules/electron/dist`，因此看不到该失败。

4. **模型缓存/网络依赖**
   - `bilingual-aligner` 与 `bilingual-benchmark` 在干净归档中 30s 超时；
   - 当前工作区有模型缓存，测试因此通过；
   - 测试不应把“本机已下载模型”当作可复现前提。

**结论**：`npm test` 的 63/357 不是干净 clone 的稳定结果；P0-4 仍失败。

---

## 4. Gate 逐项裁决

| Gate | 本轮裁决 | 依据 |
|---|---|---|
| G0 | **PASS** | ADR 已明确 Mode A、零内置书、13 本清单、预算与 Release 目标；决策边界可审计 |
| G1 | **CONDITIONAL** | `--dir` 产物存在且包体在预算内（实测 `app.asar ≈ 51.27 MiB`，`win-unpacked ≈ 490.7 MiB`）；但干净构建、安装包与证据一致性未闭合 |
| G2 | **PASS** | 独立解析实测 13 个 `.abp` / 1,251 章；4 包含 exercises（101/41/22/16 个文件），9 包显式 `unsupported` |
| G3 | **FAIL** | 发布仓坐标错位、手动触发 tag 错误、真实 Release 资产未验证、无 NSIS/portable 安装包 |
| G4 | **CONDITIONAL** | `sourceCollections` 单源与 exact 13 的代码/契约成立；但 benchmark 在干净归档超时，不能作为干净 clone PASS |
| G5 | **CONDITIONAL** | 文档、死路由、PWA 清理有实质进展；隐藏 `backup/` 测试依赖与干净测试失败未解决 |
| P0-4 | **FAIL** | 干净归档 `check:types` 与 `npm test` 均失败 |

### 4.1 G1 补充说明

包体预算本身不应被否定：

- 当前产物 `app.asar` 约 **51.27 MiB**，低于 200 MiB；
- `win-unpacked` 约 **490.7 MiB**，低于 600 MiB；
- `packaging-hygiene` 契约在当前工作区通过。

但 G1 的“可发布”不能只用 `--dir` 证明。执行日志中的 `app_asar_entries = 1986` 与当前实际约 2,125 不一致，`app.asar.unpacked` 也从 83.06 MB 漂移到约 87.09 MB；这说明证据 JSON 与最终产物已不同步。数值漂移不是 P0 根因，但审计证据不能当作最终快照。

### 4.2 G2 补充说明

G2 是本轮少数可确认的实质完成项：

- 13 个 `.abp` 均存在；
- 1,251 个章节总数可独立解析；
- `engineering_analysis` 101 个 exercise 文件；
- `linear_algebra_geometry` 41 个；
- `digital_circuit` 22 个；
- `electronic_circuits` 16 个；
- 其余 9 本在 `support-status.json` 显式 `unsupported`，不是静默空包。

G2 可以保留为 PASS，但这不改变 P0 的发行与可复现结论。

---

## 5. P0 阻断项

### P0-B1：干净 clone 类型检查失败

**等级**：P0（阻断 CI 与 Release）

**证据**：

```text
npm run check:types
node_modules/@astrojs/starlight/utils/routing/types.ts(2,32):
error TS2305: Module '"astro:content"' has no exported member 'RenderResult'
```

**根因**：`check:types` 不生成 Astro 类型，CI 却在 build 前调用它。

**关闭条件**：

- 干净归档执行 `npm ci && npm run check:types` 退出码 0；
- `ci.yml` 与 `electron-release.yml` 的实际顺序均通过，不依赖开发者预先生成 `.astro/`。

### P0-B2：干净 clone 测试失败

**等级**：P0（阻断 CI、Release 与“证据可复现”）

**证据**：干净归档 `npm test` 为 6 failed files / 3 failed tests / 327 passed / 3 skipped。

**根因**：

- `backup/` 被忽略但被测试引用；
- 现场打包放进 10s hook；
- Electron 二进制惰性下载竞态；
- 模型缓存缺失导致 30s 超时。

**关闭条件**：

- 测试只依赖 tracked fixture、明确预构建产物或显式 setup；
- 干净归档 `npm test` 退出码 0；
- 若某测试必须有网络/模型，必须用显式环境门禁标记，不能默默依赖本机缓存。

### P0-B3：G3 发行渠道不闭合

**等级**：P0（用户无法获得内容的主路径）

**证据**：

- `src/config/release.config.ts:11-12` 默认发布仓是公开 `Ariesagittarius/AstroLib`；
- `electron/services/remote-catalog-service.ts:36-37` 使用该默认值拉取 `catalog.json`；
- 当前桌面分支 remote 只有 `private` 与 `web-upstream`，无 `origin`；
- `scripts/release-desktop.mjs:52-59` 只选择 `private` 或 `origin`，dry-run 实际输出 `目标 remotes: private`；
- `.github/workflows/electron-release.yml:55` 用 `github.repository` 生成 catalog；
- 同一行 `github.ref_name || inputs.tag` 在 `workflow_dispatch` 时取分支名，不会回退到用户输入 tag；
- G3 测试使用本地 HTTP mock（`release-distribution.test.ts:36-42`），未访问真实 GitHub Release。

**结果**：如果 workflow 在私有备份仓运行，catalog 的 `remotePackUrl` 指向私有仓，而 App 从公开仓拉 catalog；主路径 404。若 workflow 在公开 Web 仓运行，`release-desktop` 又不会推送到该仓。两种路径都没有闭环。

**关闭条件**：

- 唯一公开 Release 仓被确定并写入配置；
- App 的默认 URL、workflow 的 `--release-repo`、catalog 中的 `releaseRepo/remotePackUrl` 三者一致；
- `workflow_dispatch` 使用显式 tag，而不是分支名；
- 真实 Release 的 `catalog.json` 与至少一个 `.abp` 可 HTTP 200 下载，并通过 `sizeBytes/contentHash` 校验。

### P0-B4：安装包未生成/未验证

**等级**：P0（“可发布”结论无产物证据）

**证据**：

- `release/` 当前只有 `win-unpacked/`；
- `release/*.exe`、portable `.exe`、`*.zip`、`latest.yml` 数量均为 0；
- `artifacts/audit/g3-evidence.json` 的打包命令只有 `electron-builder --dir --win`。

**关闭条件**：

- 从干净归档执行 `npx electron-builder --win` 退出码 0；
- 产出 NSIS 安装包与 portable `.exe`；
- 两者分别完成启动、`/desktop/` 加载、官方 catalog 拉取、至少一个 `.abp` 安装、本地 `.abp` 导入 smoke；
- 记录产物路径、大小、哈希与启动日志。

---

## 6. 需要特别记录的审计事实

1. **当前工作区通过不等于干净 clone 通过**。本轮所有 63/357 结论都来自已有 `.astro/`、`backup/`、`artifacts/`、Electron 二进制和模型缓存的工作区。
2. **G3 的“UI smoke”只证明按钮/弹窗存在**。`FragmentLibrary` 调用 `bridge.fetchOfficialCatalog()` 时不传自定义 URL，默认坐标错位时主路径仍失败。
3. **Release workflow 的 YAML 存在不等于 Release 资产存在**。没有真实下载验证，G3 不能 PASS。
4. **`--dir` 不等于安装包**。NSIS/portable 有独立的安装、升级、快捷方式和卸载行为，必须实测。
5. **审计证据 JSON 未跟踪**。`artifacts/` 被 `.gitignore` 忽略；干净 clone 里没有 `artifacts/audit/g1..g5-evidence.json`，只能靠日志重跑。若要“证据可复现”，应把关键摘要纳入 tracked 文档或生成带哈希的归档。

### 6.1 非 P0 但应进入 P1 的问题

- 打包后的 chapter-export 插件仍读取 `src/content/docs/collections/` 并调用 `scripts/export-chapter-latex.mjs`；这些路径不在 `app.asar` 的 `files` 中，桌面端导出功能需要单独验证。
- `model-manager.ts` 仍保留一个硬编码的 Windows 用户缓存路径，属于可移植性问题。
- `docs/README.md` 中仍有历史路径条目；目前已标注“历史归档”，但应在 P1 继续收敛。
- G1 证据中的 asar 条目数/unpacked 体积与当前产物不一致，应重新生成证据而不是复用旧 JSON。

---

## 7. 关闭 P0 的最小执行顺序

| 顺序 | 动作 | 负责角色 | 必须留下的证据 |
|---:|---|---|---|
| 1 | 让 `check:types` 先执行 `astro sync`，或调整 CI/Release 顺序 | 执行 Agent | 干净归档 `npm ci && npm run check:types` 退出码 0 |
| 2 | 用 tracked fixture/content-sources 替换 `backup/` 测试依赖；给现场打包增加前置步骤或提高 hook timeout | 执行 Agent | 干净归档 `npm test` 退出码 0，失败数为 0 |
| 3 | 固定 Electron 二进制与模型测试环境；网络测试显式门禁 | 执行 Agent | 干净归档首跑无隐式下载失败/超时 |
| 4 | 统一公开 Release 仓；修正 `release-desktop` 目标 remote 与 workflow tag | 执行 Agent + 发布负责人 | dry-run 输出正确 public remote；`workflow_dispatch` tag 正确 |
| 5 | 从干净归档执行 `npx electron-builder --win` | 执行 Agent | NSIS/portable 路径、大小、哈希、启动 smoke |
| 6 | 上传真实 Release 并验证 catalog + 至少一个 `.abp` | 发布负责人 | HTTP 200、`sizeBytes`/`contentHash` 匹配 |
| 7 | 重新提交独立审计 | 审计 Agent | 新证据、命令输出、Gate 重判 |

### 7.1 重审时必须提供的命令

```powershell
# 1. 干净归档
git archive --format=zip --output=audit.zip HEAD
# 解压到空目录后
npm ci
npm run check:types
npm run build
npm run build:exercises
node scripts/pack-book-abp.mjs --all --no-vectors
npm test
npx electron-builder --win
```

以及：

```powershell
Get-ChildItem release -File | Select-Object Name,Length
Get-ChildItem artifacts/abp-packs -Filter *.abp | Measure-Object
```

要求：

- 所有命令退出码为 0；
- `npm test` 不得依赖 `backup/`、本机模型缓存或隐式 Electron 下载；
- `release/` 中同时存在 NSIS 与 portable 产物；
- 至少一个真实 Release URL 可下载并通过哈希校验。

---

## 8. P1 进入判断

**当前不允许进入 P1 的正式交接。**

理由：

- P0 的定义包含“干净 clone 不可复现”和“用户无法获得内容”；
- 当前同时存在 P0-B1（类型检查）、P0-B2（测试）、P0-B3（发行）、P0-B4（安装包）；
- 在这种情况下进入 P1，会把“未验证的发布链”带入后续阶段，后续所有 P1 验收都缺少可信基线。

允许的例外：

- 可以继续做**不依赖发布结论**的 P1 文档/清理/SSOT 工作；
- 但必须在任务记录中写明 `P0 NOT CLOSED`，不得以“P0 已关闭”为前提；
- 若产品负责人要以书面方式接受条件性风险并允许并行 P1，应单独记录接受范围、剩余风险和回滚条件，不能把本轮报告改写成 PASS。

---

## 9. 最终裁决

```text
G0: PASS
G1: CONDITIONAL
G2: PASS
G3: FAIL
G4: CONDITIONAL
G5: CONDITIONAL
P0-4: FAIL

P0: NOT CLOSED
P1: NOT ACCEPTED FOR FORMAL HANDOFF
```

**一句话**：第二轮完成了 G2 和包体层面的实质工作，但“干净 clone 可复现”和“真实 Release + 安装包”两条 P0 主线仍未闭合；当前只能继续修复和重审，不能关闭 P0，也不能进入 P1 正式阶段。

---

## 附录 A：关键文件与行号

- `package.json:37` — `check:types` 仅执行 `tsc`
- `tsconfig.json:10` — 引用 `.astro/types.d.ts`
- `.github/workflows/ci.yml:42-43` — typecheck 在 build 前
- `.github/workflows/electron-release.yml:40-44` — typecheck 在 build 前
- `tests/acceptance/export-acceptance.test.ts:107,162,224,260` — `backup/` 回退
- `.gitignore:69` — 忽略 `backup/`
- `tests/acceptance/release-distribution.test.ts:19-31` — 10s hook 内现场打包
- `tests/acceptance/release-distribution.test.ts:36-42` — 本地 HTTP mock
- `src/config/release.config.ts:11-12` — 默认公开 Release 仓
- `electron/services/remote-catalog-service.ts:36-37` — 使用默认仓拉 catalog
- `scripts/release-desktop.mjs:52-59` — 只支持 private/origin
- `scripts/release-desktop.mjs:125` — 硬编码公开仓链接
- `.github/workflows/electron-release.yml:55` — `github.repository` 与 `github.ref_name || inputs.tag`
- `release/` — 仅有 `win-unpacked/`，无 NSIS/portable
- `docs/architecture/STAGE_REVIEW_AND_EXECUTION_GATES_2026-11-12.md` — 主门禁文档；本报告是其第二轮复核的独立版本

## 附录 B：本轮未修改的源代码

本轮审计未修改 `src/`、`electron/`、`scripts/`、`tests/` 或 workflow 文件；只新增本审计文档，并在主门禁文档中保留指针。所有结论均来自只读检查、独立构建/测试和产物解析。
