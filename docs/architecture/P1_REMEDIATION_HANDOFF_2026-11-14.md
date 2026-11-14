# P1 整改执行指令 (P1 Remediation Handoff)

**签发日期**：2026-11-14  
**依据**：[`P1_FINAL_AUDIT_2026-11-14.md`](./P1_FINAL_AUDIT_2026-11-14.md)  
**基线**：`electron/main` @ `5498542a`，工作树 clean，Tag `v0.0.4` @ `df68e42c`  
**适用范围**：仅 P1-D / P1-E 的阻断项整改；不进入 v0.0.5 发布，不启动 P2 新功能。

---

## 1. 纪律

1. 只做整改，不做新功能、不做视觉重设计、不改内容/契约/发布资产。
2. 严格执行 **一个边界 → 一次迁移 → 一次验证**；每个任务一个原子 commit。
3. 禁止新增三方依赖；禁止新增 `any` / `| string` / `skip`；禁止删除既有断言来换绿。
4. 禁止重跑 `pack-book-abp --all`（CI 的 `pack:books` 属于测试物料生成，不在此限）；禁止改写 `content-sources/**`、`src/types/content-package.ts`、`v0.0.4` 资产。
5. 提交信息用英文、学术克制语气、合法 scope：`ci` / `core` / `ui` / `docs` / `test`。禁止 `reader`、`audit`。
6. 本地只提交，不 push；推送由用户另行决定。

---

## 2. 基线快照（整改期间不得回退）

| 指标 | 当前值 |
| :--- | :--- |
| HEAD | `5498542a` |
| `check:types` | exit 0，0 errors |
| `check:astro` | 0 errors / 0 warnings / 280 hints（496 files） |
| `npm test` | 77 files / 471 passed / 5 skipped / 0 failed |
| `npm run build` | exit 0，23 pages |
| `!important` | 4,552 |
| Canonical | 1,251 / 1,251 HTTP 200（全量 56.1s） |
| Legacy | 1,191 × 301 + 4 × 200（Windows 大小写折叠） |
| `api/translate.ts` | 142 |
| 三个 controller | 1,495 / 1,495 / 1,485 |
| `v0.0.4` Tag | `df68e42c` |

整改后的任何提交，上述指标只允许“变好或不变”；若某项变差，必须在提交说明中给出理由与复核方式。

---

## 3. 任务清单（按顺序）

### R1（F4）修复干净 clone 的 CI 必红

**文件**：`.github/workflows/ci.yml`、`tests/contract/reader-routability.test.ts`

**步骤**：

1. 在 `automated-tests` job 的 `npm run build` / `node scripts/build-electron.mjs` 之后、`npm test` 之前，加入：
   ```yaml
   - name: Pack ABP test artifacts
     run: npm run pack:books
   ```
   若担心时间，可只打包测试需要的 13 本；但不得跳过，也不得把 `artifacts/` 提交入库。
2. 在 `reader-routability.test.ts` 的 `beforeAll` 读取目录前，加显式前置检查：
   ```ts
   if (!fs.existsSync(abpBaseDir)) {
     throw new Error(
       `ABP artifacts missing at ${abpBaseDir}. Run "npm run pack:books" before tests.`
     );
   }
   ```
   保持“缺产物必须 fail，不得 skip”。
3. 在 `package.json` 中确认 `pack:books` 脚本存在且只写 `artifacts/abp-packs/`；不要新增 `pretest`（避免本地每次测试都重打包）。

**验收**：

- `git ls-files artifacts` 为空。
- 临时移走 `artifacts/` 后运行 `npx vitest run tests/contract/reader-routability.test.ts`，必须失败且错误信息包含 `npm run pack:books`；恢复后通过。
- CI 配置中 `pack:books` 位于 `npm test` 之前。
- 本地 `npm run check:all` 仍全绿。
- `git status --short` 不出现 `artifacts/`。

**停止条件**：若 `pack:books` 会改写任何 tracked 文件，立即停止并报告。

---

### R2（F5）修正 evidence 与终态报告的事实错误

**文件**：`docs/architecture/evidence/p1-e-evidence.json`、`docs/architecture/evidence/p1-d-evidence.json`、`docs/architecture/P1_FINAL_SIGNOFF_2026-11-14.md`

**步骤**：

1. `p1-e-evidence.json`：
   - `importantBaseline: 6590`、`importantCurrent: 4552`、`importantDelta: -2038`、`importantPercent: -30.9`；删除或明确标注旧的 6,190 采样口径，不得与终态混用。
   - 增加：
     - `anyColonBase: 316`、`anyColonHead: 345`、`anyAsBase: 183`、`anyAsHead: 195`；
     - `astroHints: 280`、`astroErrors: 0`、`astroWarnings: 0`；
     - `fullRoutability: { command: "npx vitest run tests/contract/reader-full-routability.test.ts", chapters: 1251, passed: 1251, durationMs: 56100 }`（若 R6 尚未加脚本，先写“独立复跑 56.1s”并注明命令）。
   - `status` 改为 `CONDITIONAL`，待 R1–R5 完成后再改 `PASSED`。
2. `p1-d-evidence.json`：
   - `primaryComponent` 改为 `src/components/desktop/SettingsHubContent.astro`；
   - `registry` 改为 `src/features/settings/settings-registry.ts`；
   - `importantCurrent: 4869` 标注为“阶段快照”，并新增 `importantFinal: 4552`；
   - `stateMachineConsumed` 按 R4 结果填 `true` / `partial`，不得留空或写假。
3. `P1_FINAL_SIGNOFF`：
   - DoD 8 改为：“`v0.0.4` Release 资产与 Tag 未改写；本地 `artifacts/abp-packs/` 于 P1-B 按授权重打包，哈希变化已登记，不与 Release 资产混同。”
   - DoD 5 中“`FeatureToggles.astro` 降级为转发代理”改为“已删除，设置入口仅保留 `SettingsHubContent`”。
   - 将“1,251 / 1,251”标注为“独立全量复跑（56.1s）”，不要暗示默认契约测试已全量请求。
   - 增加“280 hints”披露，并说明 hints 不作为 CI 失败条件。
4. 在 `p1-e-evidence.json` 追加 `remediation` 段：日期、commit、剩余风险。

**验收**：

- 两个 JSON 可被 `node -e "JSON.parse(require('fs').readFileSync(...,'utf8'))"` 解析。
- 所有 `src/...` 路径 `Test-Path` 为 true。
- `6,590 − 4,552 = 2,038`；`2,038 / 6,590 = 30.9%`。
- `git grep "6,190" docs/architecture` 只出现在历史/采样说明中，且不与终态冲突。

**停止条件**：不得改写 P1-A/B/C 的历史 evidence；只修正 P1-D/E 与终态签署。

---

### R3（F3）把 2 处“伪收窄”改成真实类型或明确例外

**文件**：`src/types/exercises.ts`、`src/types/collections.ts`、`tests/unit/type-narrowing.test.ts`、`docs/architecture/ADR-GOVERNANCE-2026-11-13.md`（例外登记）

**步骤**：

1. `src/types/exercises.ts:27`：
   ```ts
   group?: 'A' | 'B' | 'C';
   ```
   先确认数据中不存在 `D` 等其他值；若存在，停下来报告，不要用 `as` 掩盖。
2. `src/types/collections.ts:55`：
   ```ts
   tocMapping?: Record<string, string | string[]>;
   ```
   这是合法的“字符串或字符串数组”值联合，不是字面量扩宽。不要为了 grep 归零改成 `string[] | (string & {})`。
3. 修改类型门禁口径：不再盲扫 `| string`；新增一个契约测试（如 `tests/contract/type-widening.test.ts`），只禁止：
   - `'literal' | string` 形式；
   - `(string & {})` 形式；
   - `any` 新增（可用基线快照对比）。
   对 `string | string[]` 登记为允许例外。
4. `tests/unit/type-narrowing.test.ts` 增加：
   ```ts
   // @ts-expect-error group must be A/B/C
   const badGroup: SlimQuestionItem = { ...base, group: 'D' };
   ```
   以及 `tocMapping` 同时接受 `string` 与 `string[]` 的正向断言。
5. 在 ADR-GOVERNANCE 的“类型收窄策略”下补一段“合法值联合例外”，写明 `tocMapping` 的理由。

**验收**：

- `npm run check:types` exit 0。
- `npx tsc --noEmit` 对 `'D'` 报错（`@ts-expect-error` 通过）。
- `rg "'[^']*' \| string" src/types` = 0。
- `rg "string & \{\}" src/types` = 0。
- `tocMapping` 的两种值均能通过类型检查。
- evidence 记录“4 处中 2 处封闭 union、1 处合法值联合、1 处原为合法值联合”，不再宣称“4 处全部 branded”。

**停止条件**：若数据或调用方依赖 `group` 的开放字符串，停止并给出调用点清单；不得用 `string & {}` 兜底。

---

### R4（F1）让状态机真正被控制器消费，或明确降级

**文件**：`src/components/exercises/exercise-controller.ts`、`src/services/translation/client/translation-dock-controller.ts`、`src/ai/client/chat-controller.ts`、三个 `*.state.ts`、对应测试与 evidence

**方案 A（推荐，时间盒 4 小时/控制器）**：

1. 每个控制器只选 **一个真实边界** 接入，避免 Big Bang：
   - Exercise：筛选状态（`currentGroup` / `currentMode` / `filterCollapsed`）迁入 `ExerciseStateMachine`，控制器只保留 getter 与渲染调用；
   - Translation：激活面板/宽度档位（`activeTab` / `widthTier`）迁入 `TranslationDockStateMachine`；
   - Chat：把仍在控制器里的 `_busy` / `_activeThreadId` 收敛到 `ChatStateMachine`，删除重复字段。
2. 删除控制器内的重复字段与 `private stateMachine` 的“只声明不读取”状态；所有状态读写走状态机方法。
3. 每个控制器补 1–2 条集成断言：构造控制器（jsdom/happy-dom 可用）→ 调用公开方法 → 断言 `stateMachine.getState()` 与 DOM 结果一致。
4. 保持现有 DOM 结构、事件名、CSS 类名不变。

**方案 B（若 A 超过时间盒）**：

- 删除控制器里的未使用 `stateMachine` 字段（消除 `ts(6133)`），状态模块保留为 `@experimental` 的 P2 内核；
- 在 evidence 与终态报告中把 D4 改为：“状态内核已抽出并有 18 条单测；生产控制器尚未消费，集成延期至 P2”，并开 P2 条目；
- 不得继续写“状态机分离已完成”。

**验收（A/B 共同）**：

- `rg "private stateMachine"` 的每个字段至少在 2 处被读写，或已被删除。
- `astro check` 不再对这三个文件报 `ts(6133)`。
- 18 条状态测试仍通过；A 方案另加 ≥2 条集成测试。
- `npm test` 77 files / ≥471 passed / 0 failed。
- evidence 的 `stateMachineConsumed` 与代码一致。

**停止条件**：若接入导致任何既有行为测试变红，先回退该控制器，改用方案 B；不得改测试期望来迁就实现。

---

### R5（F2）为 `!important` 剥离补视觉 smoke，必要时选择性回补

**文件**：`src/styles/components/exercise-m3.css`、`src/styles/layers/**`、新增 `docs/architecture/evidence/p1-d-visual-smoke.md`

**步骤**：

1. 建立 smoke 矩阵（至少）：
   - 页面：`/desktop/`、`/collections/...` 阅读页、`/reader/`、设置 Hub、习题中心/习题触发卡；
   - 主题：light / dark；
   - 视口：1440×900、1024×768、390×844。
2. 逐项检查 12 个高风险组件：习题触发卡、习题弹窗、筛选 chip、导出对话框、AI 面板、侧载 dock、设置开关、公式工具栏、目录折叠、空态、错误态、加载态。
3. 在 `p1-d-visual-smoke.md` 记录：构建 commit、浏览器、页面、主题、视口、通过/失败、截图路径（放 `docs/architecture/evidence/screenshots/`，若体积过大则只记录本地路径与哈希）。
4. 若发现回退：只对具体规则恢复 `!important`，并加注释：
   ```css
   /* cascade: must override Starlight .sl-markdown-content ... */
   ```
   禁止整文件回滚 1,512 处后再一次性剥离。
5. 若回归超过 3 处：`git revert a7854586` 恢复基线，再按“组件批次”逐批剥离，每批附 smoke 记录。
6. 在 ADR-UI-SURFACE 补一句：当前 `src/styles/layers/` 是 import 组织，不是 `@layer`；真正 cascade layers 列入 P2，不得宣称已实现。

**验收**：

- `p1-d-visual-smoke.md` 存在且签字（执行人/日期/commit）。
- 无 P0/P1 视觉回归；有回归则已修复并复测。
- `!important` 总数 ≤5,200。
- `npm run build` exit 0，无新增 error。
- `rg "@layer" src/styles` 仍为 0 时，文档不得写“已分层”。

**停止条件**：习题中心出现布局错位/颜色反转/按钮不可点，立即回退该文件并改用逐批剥离。

---

### R6（非阻断，可并入 P2）清理与可复现全量测试

1. 只清理 P1-D 新增文件中的未使用导入/字段（`chat-controller.ts`、`model-manager.ts`、`exercise-controller.ts` 等），不要全仓 180 条一起动。
2. 新增 opt-in 全量路由脚本：
   - `tests/contract/reader-full-routability.test.ts`，`testTimeout: 120000`；
   - `package.json` 加 `"test:full-routability": "vitest run tests/contract/reader-full-routability.test.ts"`；
   - 不加入默认 `npm test`（56s 会拖慢日常）。
3. 在 ADR-GOVERNANCE 登记 `services → features/sideload/contract` 为“过渡依赖，P2 迁 `src/core/ui-state/`”。
4. `settings-hub.css` 的 83 个 `!important` 逐条注明来源；无法注明的按新增处理并在 P2 清理。

**验收**：`npm run test:full-routability` 通过 1,251/1,251；`astro check` hints 数下降并记录；无行为变更。

---

## 4. 提交计划

| 顺序 | 提交信息（英文） | Scope |
| :--- | :--- | :--- |
| 1 | `ci: pack abp artifacts before contract tests` | `ci` |
| 2 | `docs(core): correct p1 evidence baselines and paths` | `core` |
| 3 | `refactor(core): narrow exercise group and restore toc mapping union` | `core` |
| 4 | `refactor(ui): consume exercise state machine in controller` | `ui` |
| 5 | `refactor(ui): consume translation dock state machine` | `ui` |
| 6 | `docs(ui): record css important strip visual smoke` | `ui` |
| 7 | `docs(core): close p1 after remediation` | `core` |

每个提交前跑对应最小验证；第 7 个提交前跑完整门禁（§5）。

---

## 5. 完整验收门禁（整改后）

```powershell
npm run check:types
npm run check:astro          # 必须 0 errors；记录 hints
npm test                     # 77 files / >=471 passed / 0 failed
npm run build                # 23 pages
npm run test:full-routability # 1,251 / 1,251
git status --short           # 必须为空
git rev-parse v0.0.4         # 必须 df68e42c
```

干净 clone 验证（CI 等价）：

```powershell
git clone --branch electron/main . ..\AstroLib-clean
cd ..\AstroLib-clean
npm ci
npm run check:all
```

`Artifacts/` 不在 clone 中；R1 生效后，`pack:books` 必须由 CI 或显式命令生成，测试不得 skip。

---

## 6. P1 重新签署条件

| DoD | 重新签署证据 |
| :--- | :--- |
| 1 证据文件 | `p1-e` / `p1-d` JSON 数字、路径、状态全部与代码一致 |
| 2 阅读路径唯一 | 1,251 全量 + 1,191 legacy 复跑通过 |
| 3 唯一生产 IR | 不变 |
| 4 唯一 provider contract | 不变 |
| 5 设置/Header/Library 单实现 | `SettingsHubContent` + `M3TopNavBar` + `features/library` 路径可核 |
| 6 依赖/重复栈/类型/文档/测试/CI | 依赖 0、垫片 0、类型例外登记、CI 干净 clone 绿 |
| 7 `check:all` + 干净归档 | 本地与 CI 均绿；`npm run build` 23 pages |
| 8 v0.0.4 资产 | Tag `df68e42c` 未动；本地 artifacts 变化已登记 |

全部满足后，将 `P1_FINAL_SIGNOFF_2026-11-14.md` 升版为 **Rev.2**，写明“P1 CLOSED”，并把 `p1-e-evidence.status` 改为 `PASSED`。

---

## 7. 停止与升级

出现以下任一情况，停止整改并回报，不得自行扩大范围：

1. 需要改 `content-sources/**`、`src/types/content-package.ts`、`.abp` 产物或 Release 资产；
2. 需要新增依赖或改构建链；
3. 状态机接入导致既有行为测试变红且无法在 1 小时内解释；
4. 视觉 smoke 发现习题中心不可用；
5. CI `pack:books` 改动 tracked 文件或超过 10 分钟。

---

## 8. 整改之后（不在本指令范围）

1. **v0.0.5 发布门禁**：版本号、ABP 重打包（授权一次）、安装包、GitHub Release、下载 smoke、983 章 headings 验证；单独文档、单独窗口。
2. **P2**：P0-09 包体、P0-04 构建链、残余 `any`、真正的 `@layer`、280 hints、全量路由门禁、`release/` 与 `.tmp` 治理。
3. 两件事不得与 P1-R 混在一个提交或一个发布窗口。
