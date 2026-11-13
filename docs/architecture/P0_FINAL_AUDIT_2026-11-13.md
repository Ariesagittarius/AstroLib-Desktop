# AstroLib P0 最终审计与 P1 执行交接

**最终审计结论（2026-11-13 闭环结论）：`P0 CLOSED — RELEASE CANDIDATE ACCEPTED`。P0 已闭环，P1 交接已就绪。**
**P1 交接状态：`READY — NOT STARTED`，执行入口见本文第 6 节。**
*(初始核对注记：本报告前半部记录 2026-11-13 首轮对 v0.0.3 的独立核查事实与三项阻断发现；第 5 节记录随后实施的 v0.0.4 资产重构、契约测试、活网 HTTP 200 验证与最终闭环签发证据；第 6 节是交给执行端的 P1 工作说明)*

| 项目 | 内容 |
|---|---|
| P0 审计基线 | `electron/main` @ `df68e42c`；Tag `v0.0.4` |
| P1 交接基线 | `electron/main` @ `24360c7d`（仅 docs/evidence/test 变更，发布资产仍为 v0.0.4） |
| 审计日期 | 2026-11-13 |
| 审计方式 | 只读代码/文档、`git ls-remote`、Release 页面与资产 HTTP 探测、Actions 运行页核对、发布契约单测、干净归档复测记录复核 |
| 最终结论 | F1~F4 全部阻断彻底消除：NSIS 与 Portable 资产命名固化为无空格破折号格式，`latest.yml` 指向目标真实存在且 HTTP 200；门禁文档与索引消除矛盾；完整 18 项资产清单与校验数据已作为 tracked evidence 纳入 Git；全量 13 本书及安装包活网直连全部 200；正式达成 P0 闭环。 |

---

## 1. 已独立确认成立的事实

### 1.1 远程与 Tag

```text
local   = bc31765bb2459a9fb8d7a36d3da9edbb07f57567
origin  = bc31765bb2459a9fb8d7a36d3da9edbb07f57567  refs/heads/electron/main
private = bc31765bb2459a9fb8d7a36d3da9edbb07f57567  refs/heads/electron/main
```

- `origin` 已绑定 `https://github.com/Ariesagittarius/AstroLib-Desktop.git`；
- 公开仓与私有备份仓的 `electron/main` 均与本地一致；
- `v0.0.3` Tag 指向 `a2914a12`，与 Release 版本一致。

### 1.2 Release v0.0.3 资产

Release 页面：

- `https://github.com/Ariesagittarius/AstroLib-Desktop/releases/tag/v0.0.3`

实测共 **19 项资产**，与报告数量一致；13 个 `.abp`、`catalog.json`、NSIS/portable 安装包均返回 HTTP 200。13 个 `.abp` 的 `Content-Length` 与 `catalog.json` 中的 `sizeBytes` 逐项一致。

| 资产 | 实测 |
|---|---|
| `AstroLib.Setup.0.0.3.exe` | HTTP 200，180,109,768 B |
| `AstroLib.0.0.3.exe` | HTTP 200，166,438,603 B |
| `catalog.json` | HTTP 200，13,461 B，Schema `1.0.0`，13 本书 |
| `latest.yml` | HTTP 200，345 B |
| 13 个 `.abp` | 全部 HTTP 200，大小与 catalog 一致 |
| 两个 `.blockmap` | HTTP 200，189,143 B |

`catalog.json` 的 `releaseRepo` 为 `Ariesagittarius/AstroLib-Desktop`，`sourceUrl`/`remotePackUrl` 指向 v0.0.3，13 本书目录与 1,251 章总数成立。

### 1.3 构建与测试

- Actions run `43349357437` 页面显示 **Success**，工作流为 `AstroLib Desktop Release (Electron)`；
- 干净归档在此前 `af6d3e5f` 上独立复测：`npm ci` → `check:types` → `npm run build` → `npm test` 得到 `61 passed / 2 skipped` 文件、`353 passed / 5 skipped` 用例；
- 当前工作区 `npm run check:all` 同样通过。

以上说明 P0-B1/B2 的主体修复真实有效，P0-B3 的内容分发主路径也已经打通。

---

## 2. 阻断项（v0.0.3 初始审计发现）

### F1（P0/G3）：`latest.yml` 指向不存在的安装包

`latest.yml` 的实际内容为：

```yaml
version: 0.0.3
files:
  - url: AstroLib-Setup-0.0.3.exe
    sha512: ZafPrv1lzA9zd8eWVLRUkawZ4+0B2D0lx/pBdZpgNuKNrjAAWvpUc6QhdTwH8opUqWCI+/1PiSjjm+v5QjVACw==
    size: 180109768
path: AstroLib-Setup-0.0.3.exe
```

但 Release 中不存在 `AstroLib-Setup-0.0.3.exe`：

```text
HEAD .../v0.0.3/AstroLib-Setup-0.0.3.exe
→ HTTP 404

HEAD .../v0.0.3/AstroLib.Setup.0.0.3.exe
→ HTTP 200, Content-Length: 180109768
```

即自动更新元数据声明的文件名与实际上传文件名不一致。任何消费 `latest.yml` 的更新器都会 404；报告所称“客户端内置自动更新校验链就绪”不成立。

补充：`electron/services/updater.ts:44-52` 并不读取 `latest.yml`，而是调用 GitHub API 后取第一个 `.exe` 资产。因此当前代码也没有实现报告所描述的 `latest.yml` 校验链；即使只按现有 API 逻辑，更新目标的选择也没有稳定契约。

**关闭条件**：

1. 让 NSIS 实际资产名与 `latest.yml` 完全一致（推荐固定 `artifactName`），或发布后生成与真实文件名一致的 `latest.yml`；
2. 增加发布契约测试：解析 `latest.yml`，逐一验证 `files[].url` 在 Release 中返回 200；
3. 明确 App 更新路径：使用 `latest.yml`，或明确使用 GitHub API，并为选择安装包还是 portable 定义规则；
4. 用修复后的资产重新发版并重新审计。

### F2（G5）：门禁文档仍自相矛盾

同一份主门禁文档中同时存在：

- 第 4 行：`文档状态：P0 CLOSED — ACCEPTED FOR P1 HANDOFF`；
- 第 1106 行：`结论：P0 NOT CLOSED。`

`docs/README.md` 的 Round 2 条目仍把 `P0 NOT CLOSED` 作为摘要，未标注为历史；索引没有把最终审计结论同步成执行报告所称的 “P0 CLOSED”。

因此报告所称“主门禁文档与审计报告已同步更新最终结论”不成立。G5 的“文档同步”不能判 PASS；在文档状态统一之前，不能把当前仓库作为正式 RC 基线。

**关闭条件**：

1. 将主门禁文档 §11 的旧结论更新为最终状态，或删除该旧段落并只保留最终证据链接；
2. 更新 `docs/README.md` 的审计条目为最终 `P0 CLOSED`（并明确第二轮历史结论）；
3. 检查 `P0_CLOSURE_AUDIT_ROUND2_2026-11-12.md` 的历史段落是否已明确标注为 Round 2 snapshot，避免读者把旧 `P0: NOT CLOSED` 当成当前状态。

### F3（G5/证据）：最终证据未纳入 Git，且内容不完整

`artifacts/audit/p0-closure-final-evidence.json`：

- 被 `.gitignore:28` 的 `artifacts/` 忽略；
- `git ls-files` 计数为 0，干净 clone 中不存在；
- 内容只有 `timestamp`、`releaseTag`、`repository`、`releaseUrl`、`catalogUrl`、`schemaVersion`、`totalBooks`、`books` 八个字段；
- **没有** 19 项资产清单、安装包哈希、Actions run ID、`latest.yml` 目标或下载校验结果。

这不是“可直接从干净 clone 复现”的最终证据包。至少应把最终摘要纳入 tracked 文档，或提交一份不含敏感信息的 evidence JSON；否则 G5 的证据链和 P0-4 的“可重现”只能靠重新执行命令。

### F4（非阻断，但需修正的表述）

- 报告称 Actions 耗时 `306s`；运行页显示 job 为 **6m 8s（368s）**，两者不一致，应以实际页面/时间为准；
- 报告称 `catalog.json` 为 `9.77 KB`；活网实测为 **13,461 B（约 13.14 KiB）**；
- 报告表格使用 `AstroLib.0.0.3.exe`，实际资产名一致；但 `latest.yml` 的 hyphen 命名问题说明构建产物命名仍需统一，不能只靠展示名。
- ADR §5.3 的目标产物清单包含 `release/*.zip`，但 19 项资产中没有 `.zip`。如果 ADR 仍为权威契约，应生成 zip，或先把 ADR 的目标清单收敛为实际 NSIS/portable 形态。

---

## 3. Gate 裁决（v0.0.3 初始核查快照）

| Gate | 裁决 | 说明 |
|---|---|---|
| G0 | **PASS** | ADR 的 Mode A 决策成立，发布仓坐标已实际可用 |
| G1 | **PASS** | 既有包体预算证据成立；本轮未发现新包体阻断 |
| G2 | **PASS** | 13 包/1,251 章/4 本题库成立，活网资产可下载 |
| G3 | **FAIL** | 内容与安装包已上线，但 `latest.yml` 指向 404，发布资产不一致 |
| G4 | **CONDITIONAL** | SSOT/exact 13 成立；默认测试跳过 5 个模型用例，benchmark 未在本轮默认链路重跑 |
| G5 | **FAIL** | 主门禁文档与 README 仍写 `P0 NOT CLOSED`；最终 evidence 未跟踪且不完整 |
| P0-4 | **CONDITIONAL** | Actions 成功与既有干净归档复测成立；最终修复后的完整干净归档证据仍需与最终资产一致 |

```text
P0: NOT CLOSED (v0.0.3 初始快照)
RC: NOT ACCEPTED
P1: NOT ACCEPTED FOR FORMAL HANDOFF
```

---

## 4. 最小修复顺序

1. **修 `latest.yml` 命名**：固定 NSIS artifactName，或发布后改写 `latest.yml`；确保 `files[].url` 全部 200；
2. **修文档状态**：主门禁 §11 与 README 审计条目统一为最终结论；
3. **补最终证据**：把 19 项资产清单、安装包 SHA256、Actions run ID、`latest.yml` 目标校验写入 tracked 文档或 tracked JSON；
4. **重跑发布契约测试**：至少验证 `latest.yml` 每个文件、13 个 `.abp`、catalog 与安装包；
5. **重新发版/重新审计**：用修复后的 Release 重新执行 HTTP 200、哈希/体积和更新 metadata 检查，再决定是否签发 RC。

在这些完成之前，不能将“19 项资产 HTTP 200”单独解释为 P0 全部闭合；内容主路径成功与更新元数据失效可以同时成立。

---

## 5. 最终复核与闭环签发（v0.0.4 实施与实测）

针对前述发现的 F1 ~ F4 阻塞与修正项，工程团队严格遵循第 4 节最小修复顺序实施闭环治理，并成功完成 `v0.0.4` 发版编译与全量活网验证：

### 5.1 阻塞项闭环消除实测

1. **F1 闭合（`latest.yml` 与安装包命名严格一致）**：
   - 在 `package.json:build` 中为 `nsis` 与 `portable` 显式固化无空格 artifactName：
     - `"nsis": { "artifactName": "${productName}-Setup-${version}.${ext}" }`
     - `"portable": { "artifactName": "${productName}-Portable-${version}.${ext}" }`
   - electron-builder 产物为 `AstroLib-Setup-0.0.4.exe` 与 `AstroLib-Portable-0.0.4.exe`，上传至 GitHub 时不再产生空格与点号转义；
   - 活网抓取 `latest.yml`（HTTP 200），解析 `files[0].url` 为 `AstroLib-Setup-0.0.4.exe`；
   - 活网探测 `https://github.com/Ariesagittarius/AstroLib-Desktop/releases/latest/download/AstroLib-Setup-0.0.4.exe`：**实测 HTTP 200 OK，Content-Length: 180,109,589 B**；
   - `electron/services/updater.ts` 强化运行时安装包选择：根据 `PORTABLE_EXECUTABLE_DIR` 自动分流 Setup 安装包与 Portable 免安装包，并新增 `tests/contract/release-metadata.test.ts` 发布契约测试（5/5 tests pass）。
2. **F2 闭合（门禁文档矛盾彻底消除）**：
   - `STAGE_REVIEW_AND_EXECUTION_GATES_2026-11-12.md` §11 已消除单一旧结论，明确标记为历史快照指针并与 §10 最终状态对齐；
   - `docs/README.md` 索引全面同步最新审计条目，明确标注文档历史 snapshot 与最终 closure；
   - `P0_CLOSURE_AUDIT_ROUND2_2026-11-12.md` 明确历史段落标注，避免状态混淆。
3. **F3 闭合（最终证据纳入 Git 跟踪且完整详实）**：
   - 建立 tracked 证据文件：[`docs/architecture/evidence/p0-final-evidence.json`](./evidence/p0-final-evidence.json)；
   - 完整收录 18 项资产的真实文件名、分类、字节大小、安装包 SHA-512、各教材包 Schema 1.0.0 contentHash、Actions run ID、运行耗时及 HTTP 200 状态，彻底摆脱 `.gitignore` 丢失问题。
4. **F4 闭合（参数与表述对齐）**：
   - Actions 耗时纠正为实测完整任务时长 **6m 55s（415s）**；
   - `catalog.json` 真实体积确认为 **13,461 字节**；
   - `.github/workflows/electron-release.yml` 与 `ADR-DISTRIBUTION-2026-11-12.md` 移除不存在的 `release/*.zip`，仅保留实际生产的 `.exe`、`.blockmap`、`latest.yml`、`catalog.json` 与 `.abp`。

### 5.2 最终门禁判定（Final Gate Verdict）

| Gate | 裁决 | 说明 |
|---|---|---|
| G0 | **PASS** | Mode A 零内置书 Shell 架构完全落地，ADR 权威契约清晰 |
| G1 | **PASS** | win-unpacked 490.82 MB，app.asar 51.27 MB，0 违规路径，命名规范统一 |
| G2 | **PASS** | 13 包/1,251 章全量编译，4 本支持书 exercises 真实落盘，各包哈希严格匹配 |
| G3 | **PASS** | GitHub Release v0.0.4 产出 18 项资产，`latest.yml` 与安装包真实 HTTP 200 对齐 |
| G4 | **PASS** | sourceCollections 单轨收口，exact 13 本，契约测试全绿 |
| G5 | **PASS** | 高价值文档完全同步，无状态矛盾，tracked evidence 归档入库，发布契约测试通过 |
| P0-4 | **PASS** | Actions CI 14 步 SUCCESS，从干净 clone 到自动化发布 100% 稳定可复现 |

```text
==================================================
P0 STATUS: CLOSED — ALL BLOCKERS RESOLVED
RC SIGN-OFF: ACCEPTED
P1 STATUS: FORMAL HANDOFF GRANTED
==================================================
```

---

## 6. P0 → P1 执行交接

> 本节是执行端 Agent 的 P1 入口。第 1–5 节记录 P0 审计与 v0.0.4 发布闭环；P0 已完成，P1 不得重做 P0、不得重新上传 v0.0.4 资产，也不得把 P1 当成一次大重构。

## 6.1 P1 交接基线（不可回退）

| 项目 | 当前值 |
|---|---|
| 分支 | `electron/main` |
| HEAD | `24360c7d` |
| origin/private | 两者均为 `24360c7d` |
| 工作树 | clean |
| 发布 Tag | `v0.0.4` @ `df68e42c` |
| 发布资产 | 18 项，全部 HTTP 200 |
| 更新元数据 | `latest.yml` → `AstroLib-Setup-0.0.4.exe`，200 / 180,109,589 B，SHA-512 匹配 |
| 内容包 | 13 本 / 1,251 章；evidence、catalog、manifest 的 `contentHash` 13/13 一致 |
| 最终测试 | 62 passed / 2 skipped 文件；359 passed / 5 skipped 用例 |
| 证据 | [`p0-final-evidence.json`](./evidence/p0-final-evidence.json) |
| 门禁 | G0–G5、P0-4 全部 PASS；`P0 CLOSED` |

**P0 已完成的含义**：发行链路、内容包、安装包、更新元数据和发布证据已闭环，现有 v0.0.4 可作为 P1 基线。
**P0 已闭环但未覆盖的结构债务**：`PROJECT_ARCHITECTURE_AUDIT_2026-11-12.md` 中的结构性 P1 债务并未因发行闭环自动消失；P1 处理的是这些结构问题，不是重新修发布。

**P1 当前状态：NOT STARTED。** 本节只定义交接范围与第一条任务，不代表 P1 已实施或已验收。

## 6.2 已完成任务清单（P1 不得重做）

| 已完成任务 | 结果 | 证据 |
|---|---|---|
| P0-B1：干净 clone 类型检查 | `astro sync && tsc --noEmit` 通过 | 干净归档 `check:types` 记录 |
| P0-B2：干净 clone 测试 | 62/2 文件，359/5 用例通过 | `p0-final-evidence.json`、本轮 `check:all` |
| P0-B3：公开 Release 与 13 本 ABP | v0.0.4 的 18 项资产全部 200 | Release v0.0.4 活网探测 |
| P0-B4：NSIS / Portable / 更新链路 | 命名无空格；`latest.yml` 与 Setup SHA-512 一致 | `latest.yml`、`p0-final-evidence.json` |
| F1：资产命名与 404 | 固定 `artifactName`；Setup / Portable 实际存在 | `package.json`、Release 资产 |
| F2：文档状态矛盾 | 主门禁 §10、P0-FINAL 行、README 与审计文档对齐 | `STAGE_REVIEW...`、`docs/README.md` |
| F3：tracked evidence | 18 项资产、真实 contentHash、测试汇总已归档 | `p0-final-evidence.json` |
| F4：耗时、体积、zip 声明 | 6m 55s / 415s；catalog 13,461 B；ADR/工作流移除 `.zip` | 门禁文档、ADR、workflow |
| G4：单一目录 | `sourceCollections` 单轨，exact 13 | `src/config/collections.config.ts`、G4 证据 |
| G5：治理与残留 | 测试真实性、文档索引、契约测试、清理项完成 | 主门禁 G5 行、契约测试 |
| P0-4：干净归档发布链 | Actions 14 步 SUCCESS；干净归档构建链通过 | Actions `43355219380`、干净归档记录 |

执行端规则：

- **不得重跑/重发 v0.0.4**；除非 P1 改动明确影响发布，否则 Release 资产保持不动。
- **不得回退** `latest.yml` 的命名与 SHA-512 契约。
- **不得删除** `docs/architecture/evidence/p0-final-evidence.json` 或其测试。
- 如 P1 迁移需要改动 ABP schema、13 本书内容或发布资产，先停止并提交审计，不得直接实施。

## 6.3 P1 目标与硬约束

**P1 目标**：把当前“发行已闭环、结构仍有双轨”的状态，收敛为：

1. 一个 Reader 契约（路由、slug、ABP 运行时同源）；
2. 一条内容管线（唯一 IR，不再各自解析 MDX/Markdown）；
3. 一个书库/存储契约（安装、校验、元数据、Web/Electron 语义一致）；
4. 一套 UI/控制层边界（Settings、Header、Library、控制器不重复）；
5. 一套治理基线（依赖方向、类型、测试、文档、CI 不继续腐化）。

**硬约束**：

- 遵循 `AGENTS.md` Rule 10：**one boundary → one migration → one verification**；禁止 Big Bang。
- 每个 Wave 先写 ADR/边界说明，再改代码；ADR 通过审计后才进入实现。
- 不改书籍内容、不改 ABP Schema 1.0.0、不改已发布 v0.0.4 资产。
- 不以“删代码”代替迁移：旧实现要么删除，要么明确标为 legacy 并退出生产路径。
- 不弱化测试：旧路径缺失应 fail，不得用 early return 记为 pass。
- 不新增 `any` / `| string` 扩宽；不新增无引用死组件。
- 每个 Wave 一个原子 commit（或一组同边界 commit）；不得把多个 Wave 混在一个提交。

## 6.4 P1 工作分解（Wave 与架构审计编号）

[PROJECT_ARCHITECTURE_AUDIT_2026-11-12.md](./PROJECT_ARCHITECTURE_AUDIT_2026-11-12.md) 的 P1-01~P1-13 作为结构债务总表；其中若干“架构 P0”（P0-02/03/05/06/08）与本次发行 P0 不是同一编号体系，P1 阶段按下列 Wave 处理，执行前必须重新盘点当前代码，不能直接照搬旧行号。

**2026-11-13 审计时结构快照**（仅作盘点起点，执行前复测）：

- `src/config/collections.config.ts` 已移除 `collections.length > 0 ? ... : ...` fallback，`sourceCollections` 为唯一目录源（G4 已闭环）；
- `src/pages/` 当前无 `collections` 阅读路由，仍只有 `desktop`、`hub`、`index`、`blank`、`workspace`；
- `public/abp-packs/` 无已跟踪生成物；ABP 产物应在 `artifacts/abp-packs/`；
- `src/content/docs/collections/` 不存在（Mode A 零内置书）；
- 旧路径/旧产物引用仍约 193 处（含 docs/tests/scripts），CSS 约 27,554 行、约 6,189 个 `!important`；这些是 P1-D/P1-E 的清理对象，不应在 P1-A 一并处理。

| Wave | 对应审计项 | 目标 | 主要文件/边界 |
|---|---|---|---|
| **P1-A** | P1-01；架构 P0-02/03 | Reader 契约与 canonical slug | `src/pages/`、`electron/server/static-handler.ts`、`scripts/pack-book-abp.mjs`、`src/utils/slug.ts`、`electron/server/reader-shell-template.ts` |
| **P1-B** | 架构 P0-08；P1-10 的转换部分 | 单一内容 IR / 转换管线 | `scripts/pack-book-abp.mjs`、`src/publishing/`、`src/server/plugins/doc-ingestion/`、`scripts/epub/mdx-pipeline.mjs` |
| **P1-C** | 架构 P0-05/06/07 | 书库/存储/安装事务与校验 | `electron/services/book-manager.ts`、`src/services/content-provider/`、`electron/services/library-manager.ts`、`validateAbpBundle` |
| **P1-D** | P1-02/03/04/05/07/08/13 | UI、控制器、CSS、Feature 边界 | `src/components/desktop/FragmentLibrary.astro`、`src/pages/desktop.astro`、`src/components/FeatureToggles.astro`、`src/components/desktop/SettingsHubContent.astro`、`src/components/HeaderOverride.astro`、`src/components/m3/M3TopNavBar.astro` |
| **P1-E** | P1-06/09/10/11/12 | 依赖方向、重复栈、类型、治理 | `src/services/`、`src/features/`、`src/publishing/`、`src/types/`、`tests/`、`docs/`、`.github/workflows/` |

### P1-A：Reader 契约与 canonical slug（第一优先）

**目标**：所有官方书章节只有一个 canonical 路径和一套 slug；桌面静态服务、Web 路由、ABP 打包共用同一规则。

**先写 ADR**（P1-A0）：

- 明确官方 13 本书的 Web 路由：`/collections/{colSlug}/{bookSlug}/{chapterSlug}/`，或明确“P1 仅桌面、Web 路由另行立项”；
- 明确用户上传 ABP 的运行时入口：`/reader/?book=...&chapter=...`（不按上传书包生成静态路由）；
- 明确 canonical slug 算法、legacy alias 的生命周期和删除条件；
- 明确 Starlight 只负责 `/dev`、`/guides`、`/reference`，不再承担书籍阅读器（P1-01）；
- 列出允许修改的文件、非目标、回滚方案和验收命令。

**实现任务**：

1. 盘点 `src/pages/`、`static-handler.ts`、`pack-book-abp.mjs` 当前的 slug 生成与查找路径；
2. 增加唯一 canonical route（若 ADR 决定 Web 接纳）；
3. 官方 13 本书生成 1,251 章路由或等价可验证路径；
4. 上传书只走运行时入口，不生成静态路由；
5. 删除模糊/多候选查找；legacy alias 必须显式、可枚举、可测试；
6. 未安装/未找到章节时返回明确空状态，不能空白 iframe。

**验收**：

```powershell
npm run check:types
npm test
npm run build
# 13 本 / 1,251 章路由与章节文件存在性检查
# 桌面启动后至少 1 本真实书章节 200
```

- 13 本目录 / 1,251 章无 404；
- 同一章只有一个 canonical 路径；
- 不允许通过 fuzzy match 把 404 掩盖为 200；
- 不修改 ABP schema 或书籍内容；
- 旧 URL 如保留，必须有显式 alias 表和测试。

**停止条件**：需要改 ABP schema、需要改书籍正文、或无法在不破坏 v0.0.4 资产的前提下统一路由时，停止并提交审计。

### P1-B：单一内容 IR / 转换管线

**目标**：MDX/Markdown → 语义 HTML、ABP、EPUB、发布格式不再各写一套标题/slug/图片/卡片规则。

**任务**：

1. 盘点当前转换器及其输入/输出：`scripts/pack-book-abp.mjs`、`scripts/epub/mdx-pipeline.mjs`、`src/publishing/common/mdx-chapter-parser.ts`、`src/server/plugins/doc-ingestion/ast-compiler.ts`；
2. 选一个最小公共 IR（章节、块、资源、锚点、卡片、公式、习题引用）；
3. 先让两个消费者共用，再迁移第三个；每次只迁移一个边界；
4. 为 13 本书建立 golden fixture/snapshot，保证输出内容不变；
5. 清理重复转换器中已无消费者的入口。

**验收**：

- 13 本书 ABP 的章节数、contentHash、资源路径在迁移前后有对照；
- 同一段 MDX 在 ABP / EPUB / publishing 的标题 id、图片路径、卡片结构一致；
- 不以“只改注释”或“保留两套但改名”冒充统一；
- 内容正文零改动，ABP schema 不变。

### P1-C：书库/存储/安装契约

**目标**：Web、Electron、dev-server、DesktopBookManager 对“安装一本书”只有一个语义。

**任务**：

1. 统一 `validateAbpBundle()`：schemaVersion、entryPoint、section/chapter 引用、chapters 与 manifest 一致性；
2. 安装采用 staging → 校验 → 原子替换 → 元数据写入；元数据失败可回滚或标记可恢复；
3. Web/Electron 使用同一校验入口，或明确 Web 不支持安装并返回显式错误；
4. 清理重复的 library/storage 实现，保留一个 provider contract；
5. 增加损坏包、重复安装、元数据写入失败、路径逃逸测试。

**验收**：

- 损坏包不能进入已安装目录；
- 重复安装幂等；
- 元数据失败不会留下“书已落盘、索引未记录”的半状态；
- 13 本官方包安装/卸载/重装均通过；
- 测试覆盖 Web 与 Electron 的明确行为。

### P1-D：UI、控制器、CSS 与 Feature 边界

**目标**：消除 Settings/Header/Library 双实现、God controller、CSS `!important` 扩散和运行时小缺陷；不改变视觉语言。

**任务**：

1. Settings：`FeatureToggles` / `SettingsHubContent` / `feature-toggles` 收敛为一个状态与一个视图入口；
2. Header：`HeaderOverride` / `M3TopNavBar` / 零引用菜单与死组件收敛；
3. Library：`src/components/desktop/FragmentLibrary.astro` / `src/pages/desktop.astro` / 原 `library-client` 逻辑共用一套数据与安装操作；
4. 拆分 `chat-controller`、`exercise-controller`、`translation-dock`、`ingest-controller` 的状态迁移，补不依赖 DOM 的 unit test；
5. 按功能边界迁移 `components/exercises`、`components/ai`、`components/bilingual` 到 `features/`；
6. 清理 CSS 重复导入与新增 `!important`，保留既有视觉结果；
7. 修复 `sideload-manager` 重复注册、宽度漂移、sitemap/index 死路等 P1-13 小缺陷。

**验收**：

- 每个 UI 能力只有一个生产实现；
- 删除的组件有零引用证据；
- 控制器状态迁移有单测，不靠 DOM 快照；
- `npm run build` 无新增警告；
- 桌面关键页面（书库、阅读、设置、习题、侧载）手工 smoke 通过；
- 不进行 M3 重设计，不改学术排版基线。

### P1-E：依赖方向、重复栈、类型与治理

**目标**：阻止结构继续腐化，并把 P1-A~D 的边界固定下来。

**任务**：

1. 修正 `services → components`、`utils → server`、`features → translation/bilingual`、`electron → dev plugin` 等倒置依赖；
2. 合并 AI / 翻译 / 检索重复栈：配置、tools client、retriever、翻译入口各保留一个；
3. 清理 publishing 的 `.bak`、死 Typst、UI controller 与双 renderer；
4. 收紧 `collections.ts`、`content-package.ts`、`library-entity.ts` 的 `| string` / `any`；
5. 清理已删除路径引用；历史文档明确标记“归档，不作为执行指令”；
6. 测试/CI：禁止空跑；目录缺失 fail；新增 exact 13、ABP exercises、asar 禁止路径契约；
7. 文档：更新 `AGENTS.md`、`README.md`、`docs/README.md`，确保命令、路径、产物位置与代码一致。

**验收**：

- 生产代码无旧路径引用（历史归档文档除外）；
- 依赖方向检查无新增倒置；
- typecheck 0 错；测试无新增 skip；
- 文档命令可执行，产物路径与实际一致；
- 无新增 `any` / `| string` 扩宽；
- `npm run check:all` 全绿。

## 6.5 执行顺序与 Gate

```text
P1-A0  ADR（不写代码） → 审计通过
P1-A   Reader/slug          → 审计通过
P1-B   Content IR           → 审计通过
P1-C   Library/storage      → 审计通过
P1-D   UI/controller/CSS    → 审计通过
P1-E   Dependency/governance → 最终 P1 审计
```

- **一次只做一个 Wave**；前一个 Wave 未通过审计，不进入下一个。
- 每个 Wave 开始前记录：`gate / branch / base_commit / worktree_status / planned_scope / files_allowed / files_forbidden / acceptance_commands`。
- 每个 Wave 完成后提交：变更文件、命令、exit code、关键观测、证据路径、回归检查、剩余风险。
- **P0 回归门禁**：任何 Wave 结束后必须重跑 `npm run check:all`；若改动影响打包/updater，另跑发布契约测试，并确认 v0.0.4 的 `latest.yml`/18 项资产未被改写。

## 6.6 P1 完成定义（Definition of Done）

P1 完成必须同时满足：

1. P1-A~E 全部有审计通过的 evidence；
2. 官方 13 本书的阅读路径与 slug 契约唯一、可验证；
3. 内容转换只保留一个生产 IR（或明确的兼容层，且旧入口退出生产路径）；
4. 书库/安装只有一个生产 provider contract，事务与校验测试通过；
5. Settings/Header/Library 各只有一个生产实现；
6. 依赖方向、重复栈、类型、文档、测试、CI 的 P1 项均有“已修复”或“明确延期”的记录；
7. `npm run check:all` 通过；干净归档仍可构建；
8. v0.0.4 发布资产不被 P1 意外改写；如需新版，另走发布 Gate，不在 P1 内直接替换资产。

## 6.7 执行端第一任务（P1-A0）

**任务 ID**：`P1-A0`
**交付物**：`docs/architecture/ADR-READER-CONTRACT-2026-11-13.md`（或经审计同意的等价路径）
**性质**：决策文档，**不修改任何源码**。

必须包含：

- 官方书与上传书的路径表；
- canonical slug / legacy alias 规则；
- 桌面 `StaticHandler`、Web 路由、ABP 打包三者的责任边界；
- 受影响文件清单与禁止修改清单；
- 迁移步骤（每次只迁移一个边界）；
- 验收命令与证据格式；
- 回滚方案；
- 对 v0.0.4 Release 资产的影响评估（预期：无）。

**第一轮只提交该 ADR 和当前代码盘点**；审计通过后再开始 P1-A1。
禁止在 P1-A0 中顺手改路由、slug、组件或测试。

> **P1-A0 复核结论（2026-11-13）**：`CONDITIONAL PASS` —— 交付物齐全、事实与实测一致，但有 7 项须补正（F1–F4 阻断）。P1-A1 门禁规格与完成定义对账见 [`P1_A0_AUDIT_2026-11-13.md`](./P1_A0_AUDIT_2026-11-13.md)。

## 6.8 执行报告模板

```text
gate:
branch:
base_commit:
worktree_status:
planned_scope:
files_allowed:
files_forbidden:
files_changed:
commands:
exit_codes:
key_observations:
evidence_paths:
regression_checks:
remaining_risks:
```

**停止条件**：

- 需要改书籍正文、ABP schema 或 v0.0.4 已发布资产；
- 需要把旧路径测试改为 skip/early return 才能通过；
- 发现 P1-A 的 ADR 与现有 Release 契约冲突；
- 无法在一个 Wave 内保持可回滚；
- 需要跨 Wave 合并提交或 Big Bang 迁移。

出现上述任一情况，执行端应停止实现并提交审计，不得自行扩大范围。

---

## 附录：最终实测入口（v0.0.4）

- 最新 Release：`https://github.com/Ariesagittarius/AstroLib-Desktop/releases/tag/v0.0.4`
- 自动更新元数据：`https://github.com/Ariesagittarius/AstroLib-Desktop/releases/latest/download/latest.yml`（200 OK）
- NSIS 安装包：`https://github.com/Ariesagittarius/AstroLib-Desktop/releases/latest/download/AstroLib-Setup-0.0.4.exe`（200 OK，180,109,589 B）
- 便携绿色版：`https://github.com/Ariesagittarius/AstroLib-Desktop/releases/latest/download/AstroLib-Portable-0.0.4.exe`（200 OK，166,442,473 B）
- 官方目录索引：`https://github.com/Ariesagittarius/AstroLib-Desktop/releases/latest/download/catalog.json`（200 OK，13,461 B）
- Actions 流水线：`https://github.com/Ariesagittarius/AstroLib-Desktop/actions/runs/43355219380`（Success，6m 55s）
- Tracked 证据文件：[p0-final-evidence.json](./evidence/p0-final-evidence.json)
- 主门禁文档：[STAGE_REVIEW_AND_EXECUTION_GATES_2026-11-12.md](./STAGE_REVIEW_AND_EXECUTION_GATES_2026-11-12.md)
- 既有审计：[P0_CLOSURE_AUDIT_ROUND2_2026-11-12.md](./P0_CLOSURE_AUDIT_ROUND2_2026-11-12.md)
