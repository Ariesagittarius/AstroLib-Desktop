# AstroLib P0 最后一轮独立审计

**审计结论：`P0 NOT CLOSED — RELEASE CANDIDATE SIGN-OFF BLOCKED`。**

本轮已确认公开发布仓、Tag、GitHub Actions 与 13 本 `.abp` 的活网分发基本成立；但发现发布元数据、门禁文档与最终证据归档三个阻塞项。它们不影响“内容已上传”的事实，但足以否定“全部阻断项闭合、可正式进入 P1”的结论。

| 项目 | 内容 |
|---|---|
| 审计基线 | `electron/main` @ `bc31765b`；Tag `v0.0.3` @ `a2914a12` |
| 审计日期 | 2026-11-13 |
| 审计方式 | 只读代码/文档、`git ls-remote`、Release 页面与资产 HTTP 探测、Actions 运行页核对、干净归档复测记录复核 |
| 源码修改 | 无；本文件为新增审计记录 |
| 一句话结论 | 内容资产真实可用，但 `latest.yml` 指向不存在的安装包，且门禁文档仍写着 `P0 NOT CLOSED`；不能签发 RC，也不能进入 P1 正式交接。 |

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

## 2. 阻断项

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

## 3. Gate 裁决

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
P0: NOT CLOSED
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

## 附录：本轮实测入口

- Release：`https://github.com/Ariesagittarius/AstroLib-Desktop/releases/tag/v0.0.3`
- Catalog：`https://github.com/Ariesagittarius/AstroLib-Desktop/releases/download/v0.0.3/catalog.json`
- 失效的更新目标：`https://github.com/Ariesagittarius/AstroLib-Desktop/releases/download/v0.0.3/AstroLib-Setup-0.0.3.exe`（404）
- 实际 NSIS：`https://github.com/Ariesagittarius/AstroLib-Desktop/releases/download/v0.0.3/AstroLib.Setup.0.0.3.exe`（200）
- Actions：`https://github.com/Ariesagittarius/AstroLib-Desktop/actions/runs/43349357437`
- 主门禁文档：[STAGE_REVIEW_AND_EXECUTION_GATES_2026-11-12.md](./STAGE_REVIEW_AND_EXECUTION_GATES_2026-11-12.md)
- 既有审计：[P0_CLOSURE_AUDIT_ROUND2_2026-11-12.md](./P0_CLOSURE_AUDIT_ROUND2_2026-11-12.md)
