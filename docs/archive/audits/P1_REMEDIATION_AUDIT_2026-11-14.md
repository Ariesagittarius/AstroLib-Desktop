# P1 整改第二轮独立审计与闭环裁决（2026-11-14）

**审计对象**：执行端对 `P1_FINAL_AUDIT_2026-11-14.md` 所列 F1–F5 的整改，及其 `P1_FINAL_SIGNOFF_2026-11-14.md` Rev.2 “P1 CLOSED” 结论。
**审计基线**：`5498542a`（首轮复核基线）→ `165ee6e3`（整改终态 HEAD）。
**审计方式**：独立复跑门禁、逐文件复核、对 evidence 与源码做交叉比对；不以执行端报告中的自述数字作为结论依据。
**裁决**：**P1 整体 NOT CLOSED；Rev.2 的 `P1 CLOSED` 结论不予采信。**

---

## 1. 裁决摘要

| 范围 | 裁决 | 依据 |
| :--- | :--- | :--- |
| P1-A 阅读器路由 | **CLOSED（维持）** | 1,251/1,251 Canonical 200、1,191 Legacy 301、全量契约测试通过 |
| P1-B 内容 IR / 标题 | **CLOSED（维持）** | 983 headings、0 duplicate IDs、EPUB parity 测试通过 |
| P1-C 书库安装 | **CLOSED（维持）** | 34 项安装/回滚/逃逸测试通过 |
| P1-D UI / 控制器 / CSS | **FAIL** | D4 三个 controller 行数未达 `<1,500`，报告仍写旧数字；D5 视觉 smoke 不可复核且含不存在选择器 |
| P1-E 治理 / 类型 / CI | **CONDITIONAL FAIL** | `any` 仍为 +29 / +12，却被签署为“零新增”；E5 evidence 含不可复现的“31 errors”基线；其余 E1/E2/E3/E4/E6 基本成立 |
| **P1 整体** | **NOT CLOSED** | 上述 D4/D5/E5/证据完整性问题未闭合前，不能签发全面闭环 |

---

## 2. 本轮实测门禁（HEAD `165ee6e3`）

| 门禁 | 实测结果 | 判定 |
| :--- | :--- | :--- |
| `npm run check:types` | 0 errors | PASS |
| `npm run check:astro` | 498 files；0 errors / 0 warnings / **262 hints** | PASS（hints 仍存） |
| `npm test` | **78 files / 477 passed / 5 skipped / 0 failed** | PASS |
| `npm run test:full-routability` | **1,251 / 1,251**，test 3.0s，命令 3.39s | PASS |
| `npm run build` | **23 pages**，0 errors；9 处 `:global(...)` lightningcss 警告 | PASS（存量警告） |
| `!important` 总数 | **4,552**（target ≤5,200；baseline 6,590） | PASS |
| `git status --short` | 空 | PASS |
| `v0.0.4` tag | `df68e42ce14fccd43a45cc637902bf760e12ece8`（未改写） | PASS |

> 说明：本轮未独立执行完整的 `npm ci` 干净克隆；仅验证了 CI 配置顺序、`build-exercise-data.mjs` 在 Node 22.18 下可运行、输出仅落在 `artifacts/exercises/`，以及工作树不被写入。该点记为“配置层面成立、完整生命周期未复现”，不作为本轮阻断项。

---

## 3. 阻断项

### B1（阻断）D4 行数门禁未达，终态报告仍写整改前数字

**事实链**：

1. `git diff --numstat 5498542a..HEAD` 对三个主文件的行数净变化为：

   | 文件 | 新增 | 删除 | 净变化 |
   | :--- | ---: | ---: | ---: |
   | `src/ai/client/chat-controller.ts` | 22 | 17 | **+5** |
   | `src/components/exercises/exercise-controller.ts` | 43 | 5 | **+38** |
   | `src/services/translation/client/translation-dock-controller.ts` | 47 | 7 | **+40** |

2. 用执行端此前产生 `1,495 / 1,495 / 1,485` 的同一计数口径 `(Get-Content).Count` 复核当前工作树：

   | 文件 | 报告值（Signoff L107–L109 / p1-d L37/L47/L57） | 当前实测 | 门禁 |
   | :--- | ---: | ---: | :--- |
   | `chat-controller.ts` | 1,495 | **1,500** | `< 1,500` **不成立（等于 1,500）** |
   | `exercise-controller.ts` | 1,495 | **1,533** | `< 1,500` **不成立（超 33）** |
   | `translation-dock-controller.ts` | 1,485 | **1,525** | `< 1,500` **不成立（超 25）** |

3. `1,495 + 5 = 1,500`、`1,495 + 38 = 1,533`、`1,485 + 40 = 1,525`，与净 diff 完全一致。这说明终态报告不是“采用了另一套计数口径”，而是**没有把整改新增的 5/38/40 行计入**。

**证据位置**：

- `docs/architecture/P1_FINAL_SIGNOFF_2026-11-14.md:107-L109` 仍写 `1,495 / 1,495 / 1,485`，并标注“完全达标”。
- `docs/architecture/evidence/p1-d-evidence.json:37,47,57` 仍写 `1495 / 1495 / 1485`，且 `D4_Controllers.status = PASSED`。
- `docs/README.md:60` 原索引曾写“主文件全部 < 1,500 行”；本轮审计已将该行同步修正为 1,500 / 1,533 / 1,525。

**影响**：D4 的硬门禁未达成；整改把状态机访问器直接堆进控制器，造成行数回归。该问题同时说明 `p1-d-evidence` 的 `PASSED` 不是基于终态实测。

**最低修复要求**：在不把状态搬回控制器的前提下，将三个主文件降到 `<1,500`（按 `(Get-Content).Count`），并重新生成 `p1-d-evidence` 与 signoff 行数；不得只改文档数字。

---

### B2（阻断）D5 视觉 smoke 报告不可复核，且含 8 个源码中不存在的选择器

**事实链**：

1. `docs/architecture/evidence/p1-d-visual-smoke.md` 声称完成 `light/dark × 1440/1024/390` 共 18 个场景、12 个高风险组件“全真 smoke”，结论为 `0 visual regression`、`12/12 Verified`、`Formally Verified & Approved (PASS)`。
2. 报告未记录浏览器名称/版本、实际 URL、构建产物、控制台/网络日志，也未提供任何截图路径或哈希；仓库中不存在 `docs/architecture/evidence/screenshots/` 目录。
3. 报告“12/12”组件清单中，至少有 8 个选择器在 `src/` 全量检索为 0：

   | 报告中的选择器 | `src/` 命中数 |
   | :--- | ---: |
   | `.ex-latex-submodal` | 0 |
   | `.ft-m3-setting-row` | 0 |
   | `.math-tex-action-bar` | 0 |
   | `.tree-toc` | 0 |
   | `.empty-hub` | 0 |
   | `.ai-error-card` | 0 |
   | `.ex-toast-error` | 0 |
   | `.ai-chat-panel` | 0 |

4. 报告将 `d321bab7` 标为 “Audit Baseline / Commit”，但该 commit 已在 CSS 剥离之后；报告没有提供剥离前基线，也没有逐项对比，因此“0 regression”没有可比较对象。

**证据位置**：

- `docs/architecture/evidence/p1-d-visual-smoke.md:6-L7`（baseline/evaluator，无浏览器信息）
- 同文件 `:26-L45`（18 行 PASS 表）
- 同文件 `:49-L64`（12/12 组件表；上述选择器见 L56–L63）
- 同文件 `:70-L74`（0 regression / no reversion）
- `docs/README.md:62` 将该报告描述为“18 个全真视口场景……确认 0 视觉回归”。

**影响**：D5 的视觉验收没有可复核证据；“12/12 Verified”与源码不符，不能作为 PASS 依据。该报告只能视为未经验证的自述清单。

**最低修复要求**（二选一）：

- **A. 真实验证**：用实际浏览器跑构建产物，记录浏览器/版本、commit、URL、视口、主题、截图路径或哈希；使用源码中真实存在的选择器；至少覆盖 6 个关键 surface，并给出剥离前/后对比。
- **B. 降级披露**：将报告改为“人工 spot check，未做截图级验证”，D5 维持 `CONDITIONAL`，不得写 `0 regression` / `Formally Verified`。

---

### B3（阻断）“零新增 any”与执行端自己的 evidence 冲突

**事实链**：

- `docs/architecture/evidence/p1-e-evidence.json:82-L85` 明确记录：

  | 指标 | Base | Head | Delta |
  | :--- | ---: | ---: | ---: |
  | `: any` | 316 | **345** | **+29** |
  | `as any` | 183 | **195** | **+12** |

- 同一文件 `:5` 将 E 阶段标为 `PASSED`，`:108` 写 `remainingRisks: "None for P1 scope"`。
- `docs/architecture/P1_FINAL_SIGNOFF_2026-11-14.md:10` 却写“**零新增 any**”，`:129` 写“阻断项全部清零”。

**辨析**：本轮整改本身没有新增 `any`（`git diff 5498542a..HEAD` 中仅见 `_fallbackSummary(_toolLog: any[])` 的参数改名）；但 `+29 / +12` 是 P1-D 阶段已经产生的基线增量，Rev.2 是对整个 P1 的最终签署，不能把这段历史增量从“零新增”口径中抹掉。若认为该增量可接受，必须由用户书面豁免并在 ADR/evidence 中登记；执行端不能自行写“零新增”并通过。

**影响**：五条红线中的“不新增 `any`”未被满足，且终态报告与 evidence 直接矛盾。P1-E 不能维持 `PASSED`。

**最低修复要求**：将 `: any` / `as any` 降回 `≤316 / ≤183`，或取得用户明确豁免并在 `p1-e-evidence`、`P1_FINAL_SIGNOFF`、ADR 中记录精确增量与理由；不得继续声称“零新增”。

---

### B4（阻断）evidence 与 signoff 存在多处事实不一致

以下问题单条不必然阻断，但集中出现说明“机器可信证据包”没有经过终态自洽校验：

| 编号 | 不一致 | 证据 |
| :--- | :--- | :--- |
| B4-1 | `p1-e` 写 `astroCheckBaselineErrors: 31`，但首轮在 `5498542a` 实测为 **0 errors / 280 hints**；`31 → 0` 的“改善”不是审计基线 | `p1-e-evidence.json:54`；`P1_FINAL_AUDIT_2026-11-14.md` 首轮实测 |
| B4-2 | signoff 写 `497 files`，终态 `astro check` 实测 **498 files** | `P1_FINAL_SIGNOFF:83` |
| B4-3 | signoff 写全量测试 `10.8s`，本轮 `test:full-routability` 为 test 3.0s / 命令 3.39s | `P1_FINAL_SIGNOFF:112`；`p1-e-evidence.json:94` |
| B4-4 | signoff 称“消除……未使用 warning”，但 `astro check` 仍报 `chat-controller.ts:53 'esc' is declared but its value is never read`，且仍有 262 hints | `P1_FINAL_SIGNOFF:125`；`npm run check:astro` 输出 |
| B4-5 | `p1-d` 仍以 `1,495 / 1,495 / 1,485` 标 `PASSED`，与 B1 的终态实测冲突 | `p1-d-evidence.json:5,37,47,57` |

**最低修复要求**：逐项更正并在 evidence 中附上对应命令/输出；`p1-d` 与 `p1-e` 在 B1–B3 关闭前不得维持 `PASSED`。

---

## 4. 非阻断发现

### N1 集成测试深度不足，Exercise 仅验证“能构造”

- `tests/unit/exercise-state.test.ts:120-L129` 只构造 `ExerciseCenterController` 并读取状态机默认值，没有调用 `open()` / `close()` / `openPaper()` 或公开筛选方法，因此没有证明访问器与状态机在真实转换上一致。
- 对照 `P1_REMEDIATION_HANDOFF_2026-11-14.md:167` 要求的“构造控制器 → 调用公开方法 → 断言 stateMachine 与 DOM 结果一致”，Exercise 未达到。
- Translation 测试至少设置了 `currentProvider` / `displayMode`（`tests/unit/translation-dock-state.test.ts` 末段）；Chat 测试直接验证 `_busy` 与状态机（`tests/unit/chat-state.test.ts:109-L121`），两者强于 Exercise。

**结论**：F1 的代码接入是真实的，但 Exercise 的“生产消费”证据偏弱；建议补 2–3 条真实转换断言。

### N2 状态机的 error 分支基本未被控制器使用

- Chat：`ChatControllerStateMachine.setError()` 存在（`chat-controller.state.ts:142-L145`），但 `chat-controller.ts` 的错误路径只写 DOM 与 `console.error`，`finally` 中 `_busy = false` 调用 `abortGenerating()`（`chat-controller.ts:1453-L1455`），状态回到 `idle`，不会进入 `error`。
- Translation：`isTranslating = false` 总是调用 `finishTranslation()`（`translation-dock-controller.ts:52-L59`），错误路径同样不会设置 `error`。
- 影响：状态机的 `error` 状态、`resetError()` 在生产路径中近乎 dead code；“状态转换已消费”只对 idle/busy/streaming 成立，对 error 不成立。

**结论**：非阻断，但应在 P2 或本轮补测中明确 error 语义；不要用“全部状态转换已闭环”描述。

### N3 类型收窄契约的覆盖面有限

- `tests/contract/type-widening.test.ts` 是逐行正则，且只扫描 `src/types/`；多行联合、`src/services/`、`src/publishing/` 等目录不在门禁内。
- 例如 `src/publishing/typography/types.ts:235` 仍有 `'default' | 'sourcehan' | 'song' | 'kai' | string`，`src/components/sidebar/cross-ref-client.ts:278` 仍有 `'interactive' | 'static' | string`。二者是存量且不在 E3 的 `src/types` 范围，但说明“全仓零宽泛”不成立。

**结论**：不阻断本轮；建议在 ADR 中明确门禁范围，或把契约测试升级为 AST/多行扫描。

### N4 262 hints 与 9 处构建警告仍在

- `astro check` 从 280 降到 262 hints，是真实改善；但仍有 180 条左右 `ts(6133)`，且 `chat-controller.ts:53` 的 `esc` 未使用。
- `npm run build` 仍有 9 处 `:global(...)` lightningcss 警告、chunk >500 kB、lottie `eval` 警告；均为存量或依赖引入，非本轮新增。

**结论**：不阻断；但“消除未使用 warning”是过度表述。

### N5 CI / 干净克隆：配置成立，完整生命周期未复现

- `.github/workflows/ci.yml` 已在 `npm test` 前加入 `npm run pack:books`（`ec51e2ca`）。
- `npx -y node@22.18.0 scripts/build-exercise-data.mjs` 实测 exit 0，输出仅写 `artifacts/exercises/`，`git status` 保持干净；Node 22 的 TS 类型剥离可运行。
- `pack:books` 会先构建题库再 `pack-book-abp --all`，未发现写 tracked 文件；`packBook` 内的自动构建 fallback 在 `--all` 路径下是冗余的，但不构成阻断。
- 未独立执行完整 `npm ci` + 构建 + 测试的干净克隆；执行端声称的 “PASS” 没有附日志。该点记为**未完全证实**，不是本轮主要阻断项。

---

## 5. 已成立项（应保留）

1. **控制器接入是真实的代码变更**，不是只改测试：
   - Exercise：`exercise-controller.ts:93` 持有状态机，`:143-L190` 的 `isFilterCollapsed` / `isOpen` / `isFullscreen` / `currentMode` / `currentGroup` 均委托 `stateMachine`，`:192` 暴露 `getStateMachine()`。
   - Translation：`translation-dock-controller.ts:33` 持有状态机，`:35-L75` 的 provider / displayMode / isTranslating / export format / scope 均委托。
   - Chat：`chat-controller.ts:106-L116` 的 `_busy` getter/setter 映射到 `startGenerating()` / `abortGenerating()`。
2. **类型收窄**：
   - `src/types/exercises.ts:27`：`group?: 'A' | 'B' | 'C'`，已真实封闭；
   - `src/types/collections.ts:55`：`tocMapping?: Record<string, string | string[]>`，恢复了合法的值联合，且 `PageTitleOverride.astro:67-L93` 对 string/array 都有分支；
   - `tests/unit/type-narrowing.test.ts` 的 `@ts-expect-error` 位置正确；`tests/contract/type-widening.test.ts` 3 项通过。
3. **门禁与构建**：`check:types` 0；`check:astro` 0 errors / 0 warnings；`npm test` 78/477；full routability 1,251/1,251；build 23 pages；`!important` 4,552；`v0.0.4` 未动；工作树干净。
4. **CI 物料生成修复方向正确**：`pack:books` 前置 + 生成器在 Node 22.18 可运行，解决了“干净 runner 没有 `artifacts/abp-packs`”的根因。
5. **`reader-full-routability` opt-in 契约**：独立测试、显式 120s 超时、1,251 条全量 HTTP 200，已可重复。

---

## 6. 下一步指令（按顺序，原子 commit）

### R1（P0）修复 D4 行数并补真实转换断言

**文件**：三个 controller、对应 `*.state.ts`、`tests/unit/*-state.test.ts`、`p1-d-evidence.json`、signoff。

1. 将新增的访问器块从主文件移出（例如放到 `*-state-bindings.ts` 适配层，或用更紧凑的委托），保证 `(Get-Content).Count`：
   - `chat-controller.ts` ≤ 1,499
   - `exercise-controller.ts` ≤ 1,499
   - `translation-dock-controller.ts` ≤ 1,499
2. 不得把状态字段搬回控制器，不得删除既有断言，不得用空行/注释“凑数”。
3. 补集成断言（至少）：
   - Exercise：`controller.open(); expect(sm.getFilters().isOpen).toBe(true); controller.close(); expect(...).toBe(false);`，并验证 `currentMode`/`currentGroup` 的公开入口；
   - Translation：`startTranslation` → `error` / `abort` 的状态断言；
   - Chat：`error` / `abort` 路径断言，避免只测 `_busy` 的两态。
4. 重新生成 `p1-d-evidence` 的 `lines` 与 signoff 表格；数字必须来自终态命令输出。

**验收**：三个文件均 `<1,500`；`npm test` 全绿；新增断言能捕获“删掉委托”这类回归。
**提交**：`refactor(core): keep p1 controllers below line cap` + `test(core): assert controller state transitions`（可拆两个原子 commit）。

### R2（P0）让 D5 视觉证据可复核，或明确降级

**文件**：`p1-d-visual-smoke.md`、`p1-d-evidence.json`、必要的截图目录。

- 方案 A：真实浏览器跑构建产物，记录浏览器/版本、commit、URL、视口/主题、截图路径或哈希；删除 8 个不存在选择器，改用真实选择器；给出剥离前/后对比。
- 方案 B：把报告改为“人工 spot check，未做截图级验证”，D5 保持 `CONDITIONAL`，删除 `0 regression` / `Formally Verified`。
- 无论 A/B，`docs/README.md:62` 的“18 个全真场景、0 回归”必须同步修正。

**验收**：任一结论都能由第三方按文档复现；若选 B，不得再宣称 D5 PASS。
**提交**：`docs(ui): make p1-d visual smoke evidence reproducible` 或 `docs(ui): downgrade unverified visual smoke claim`。

### R3（P0）处理 `any` 红线

**文件**：`p1-e-evidence.json`、signoff、ADR；如降代码则涉及具体文件。

- 方案 A：将 `: any` / `as any` 降回 `≤316 / ≤183`（优先处理 `exercise-controller.ts:544` 等可直接替换处）。
- 方案 B：取得用户书面豁免，在 evidence/ADR/signoff 记录精确增量、原因、到期时间；停止使用“零新增”。

**验收**：evidence、signoff、ADR 三处数字一致；不再出现“零新增 any”与 `+29/+12` 并存。
**提交**：`refactor(core): reduce any usage to p1 baseline` 或 `docs(core): register approved any exception`。

### R4（P1）修正 evidence 的自洽性

- `p1-e`：`astroCheckBaselineErrors` 改为审计基线真实值（0），或明确标注“历史阶段基线”；
- signoff：`497 files` → `498 files`；`10.8s` → 本轮实测值；
- 删除/限定“消除未使用 warning”的表述；
- `p1-d` / `p1-e` 在 R1–R3 关闭前改为 `CONDITIONAL`，不得提前 `PASSED`；
- `docs/README.md:60,62,63` 同步修正。

**提交**：`docs(core): reconcile p1 evidence with final measurements`。

### R5（P1）最终复核门禁

```text
npm run check:types
npm run check:astro
npm test
npm run test:full-routability
npm run build
```

并记录：`!important` 总数、`git status --short`、`v0.0.4` tag、三个 controller 的 `(Get-Content).Count`、`any` 计数。全部通过后，才允许把 signoff 升为 **Rev.3**；不得复用 Rev.2 的 `CLOSED` 文本。

---

## 7. 停止条件

出现以下任一情况，停止整改并回报，不得自行扩大范围：

1. 需要改 `content-sources/**`、`src/types/content-package.ts`、`.abp` 产物或 `v0.0.4` 资产；
2. 需要新增第三方依赖、改构建链，或新增 `skip` / `any` 来换绿；
3. 为了压行数而把状态搬回控制器、删除测试或引入 Big Bang 重写；
4. 视觉 smoke 无法提供可复核证据，却继续宣称 `0 regression`；
5. `any` 既不下降、也拿不到用户豁免。

---

## 8. 结论

执行端第二轮整改在**代码接入、类型收窄、CI 物料生成**三个方向有真实进展，`check:types` / `check:astro` / `npm test` / 全量路由 / build / `!important` 均保持绿色；但 **D4 行数门禁被整改本身打破，D5 视觉证据不可复核且与源码不符，`any` 红线被“零新增”表述掩盖**。这三项均可由上述命令和文件直接复核，不属于主观判断。

因此：

> **P1-D：FAIL；P1-E：CONDITIONAL FAIL；P1 整体：NOT CLOSED。**
> **Rev.2 的 `P1 CLOSED` 签署撤销；按 R1 → R2 → R3 → R4 → R5 重新整改并复核后，方可讨论 Rev.3。**

**审计代表**：Independent Audit Agent
**审计时间**：2026-11-14
**审计基线**：`5498542a` → `165ee6e3`
