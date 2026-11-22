# P1 终态复核裁决与整改门禁 (P1 Final Audit)

**复核日期**：2026-11-14
**复核对象**：`P1_FINAL_SIGNOFF_2026-11-14.md`、`p1-e-evidence.json` 与 P1-D / P1-E 全部提交
**分支 / HEAD**：`electron/main` @ `5498542a`（工作树 clean）
**发布基线**：Tag `v0.0.4` @ `df68e42c`（未移动）
**复核方式**：逐提交 diff、独立命令复跑、全量 1,251 章逐章请求、类型/依赖/样式计数、干净产物缺失模拟（代码路径核验）

---

## 1. 裁决摘要

| 波次 | 裁决 | 说明 |
| :--- | :--- | :--- |
| P1-A | **CLOSED**（维持原判） | 路由、301、404、`/reader/`、1,251 章契约均未回退；本轮再次全量复跑通过。 |
| P1-B | **CLOSED**（维持原判） | 标题/锚点唯一真源、983 章覆盖、重复 ID 归零均成立。 |
| P1-C | **CLOSED**（维持原判） | 统一校验、原子安装、幂等清理与 34 项测试均成立。 |
| P1-D | **CONDITIONAL PASS** | D1/D2/D3/D6 成立；D4 的“状态机被控制器消费”未达成；D5 以机械剥离 `!important` 代替“删除无效覆盖/提升特异性”，且无视觉 smoke 证据。 |
| P1-E | **CONDITIONAL PASS** | E1/E2/E4/E6 成立；E3 仅 2/4 为真实收窄；E5 在干净 clone 上无法通过；E7 证据存在数字与路径错误。 |
| **P1 整体** | **NOT YET CLOSED** | 代码基线健康、本地门禁全绿，但上述 D4/D5/E3/E5/E7 未闭合前，不能签发“全面闭环”。 |

**一句话结论**：执行端交付了可运行的代码与真实的指标下降，但终态报告把“阶段成果”写成了“门禁全部通过”。本轮退回的是**证据与门禁口径**，不是推翻 P1 的工程价值。

---

## 2. 独立复核实测

### 2.1 与报告一致、确认成立的部分

| 项目 | 报告值 | 本轮实测 | 结论 |
| :--- | :--- | :--- | :--- |
| `npm run check:types` | 0 errors | exit 0，0 errors | 成立 |
| `npm run check:astro` | 0 errors / 0 warnings（496 files） | exit 0；**0 errors / 0 warnings / 280 hints** | 成立，但需披露 hints |
| `npm test` | 77 files / 471 tests | 77 passed（2 skipped）/ 471 passed（5 skipped）/ 0 failed | 成立 |
| `npm run build` | 未在终态报告复列 | exit 0，23 pages，6.89s | 成立 |
| 全站 `!important` | 4,552 | 4,552 | 成立 |
| `services → components` | 0 | 0 | 成立 |
| `utils → server` | 0 | 0 | 成立 |
| 一行 `.mjs` 垫片 | 0 | 0 | 成立 |
| `src/types` 字面 `\| string` | 0 | 0 | 字面成立，语义见 F3 |
| 三个 controller 行数 | 1,495 / 1,495 / 1,485 | 完全一致 | 成立 |
| `api/translate.ts` | 142 | 142 | 成立 |
| Canonical 1,251 章 | 1,251 / 1,251 HTTP 200 | 逐章 `StaticHandler.handle()` 全量复跑：**1,251 / 1,251，56.1s** | 成立，但默认测试只抽样（见 F5） |
| Legacy 别名 | 1,191 / 1,191 301 | 1,191 条 301 + 4 条 Windows 大小写折叠 200 | 成立 |
| 测试 skip | 无新增 | 5 skipped，与基线相同 | 成立 |
| v0.0.4 Tag | 未改写 | `df68e42c`，release workflow 无改动 | 成立 |

### 2.2 与报告不一致、必须修正的部分

| 项目 | 报告/证据 | 实测 | 性质 |
| :--- | :--- | :--- | :--- |
| 新增 `any` | “零新增 `any`” | `: any` 316 → **345**（+29）；`as any` 183 → **195**（+12） | 红线违反 |
| `!important` 基线 | `p1-e` 记 6,190、delta −1,638 | 终态报告用 6,590、delta −2,038；6,590 − 4,552 = 2,038 | 证据数字错误 |
| 本地 ABP 哈希 | DoD 8“既有打包产物哈希 100% 一致” | `math-math_senior.abp` 由 `1aa9b473…` 变为 `130bbe05…`；`catalog.json` 亦变 | 表述错误（Release 资产仍完好） |
| 设置唯一实现路径 | `p1-d` 指向 `src/features/settings/ui/SettingsSurface.astro` 与 `settings/model/settings-registry.ts` | 两个路径均不存在；实际为 `src/components/desktop/SettingsHubContent.astro` 与 `src/features/settings/settings-registry.ts` | 证据路径失效 |
| `FeatureToggles.astro` | 终态报告称“降级为转发代理” | 文件已物理删除 | 表述错误 |
| 1,251 章门禁 | 报告称由契约测试锁定 | `reader-routability.test.ts:108-149` 明确只对每本前 15 章 + entryPoint 发起请求（约 200 章）；全量 1,251 需 56s | 事实成立，但默认测试未守护 |

---

## 3. 阻断项

### F1（阻断）D4：两个状态机是死代码，控制器没有消费

- `src/components/exercises/exercise-controller.ts:93`：`private stateMachine = new ExerciseStateMachine();`，全文件仅此一处出现；`astro check` 直接报 `ts(6133)` 未使用。
- `src/services/translation/client/translation-dock-controller.ts:42`：同样只声明、不读取。
- 只有 `chat-controller.ts` 真正调用了 7 处（`addReferencedChapter` / `removeReferencedChapter` / `clearReferencedChapters` / `setActiveThreadId` / `setActiveModelId` / `enterStreaming` / `finishGenerating`），但其 `_busy`、`_threads`、`_indexCache` 等状态仍留在控制器内，状态机并非单一真源。
- 三个 `*.state.test.ts` 直接 import 状态机模块并通过 6×3=18 条断言；它们证明的是“模块自身可测”，不是“生产控制器使用该模块”。
- 对照 `P1_D_E_HANDOFF §2.4`：“先抽纯函数与状态机，**再让原 controller 消费**”。该条未达成。

**影响**：12/18 条新增状态测试对生产行为没有约束力；“God controller 状态机分离”目前是并行副本，不是重构完成。

### F2（阻断）D5：1,512 个 `!important` 被机械剥离，方法不符合门禁

- `a7854586` 对 `src/styles/components/exercise-m3.css` 的 diff：删除 1,512 行、新增 1,512 行，**删除行 100% 含 `!important`，新增行 0% 含 `!important`**；选择器与声明内容未变。
- 全仓 `@layer` 出现次数为 **0**；`src/styles/layers/` 五个文件各 4–6 行，仅做 `@import` 转发，不构成 CSS Cascade Layers。
- `P1_D_E_HANDOFF §2.5` 只允许两种下降方式：“删除无效覆盖”或“提升选择器特异性”。本轮既未删除规则，也未提升特异性，只是移除了优先级修饰符。
- ADR 与 evidence 中没有 `desktop / hub / reader / ingest` 的手工 smoke 记录或截图；`npm run build` 仍输出多处 `:global(...)` lightningcss 警告。
- 由于多数选择器带 `html[data-site-theme='material-you']` 前缀，实际视觉可能仍然正确；但**没有证据**证明 1,512 处全部不依赖 `!important`。

**影响**：`!important ≤ 5,200` 的数字目标达成，但 D5 的“视觉无意图性变化”门禁未验收。这是发布前必须补的最小证据。

### F3（阻断）E3：4 处中只有 2 处是真实收窄

| 文件 | 基线 | 现状 | 判定 |
| :--- | :--- | :--- | :--- |
| `chapter-semantic.ts:141` | `'scholarly' \| ... \| string` | 封闭 union | 真实收窄 |
| `chapter-semantic.ts:147` | `'default' \| ... \| string` | 封闭 union | 真实收窄 |
| `collections.ts:55` | `Record<string, string \| string[]>` | `Record<string, string[] \| (string & {})>` | **语义等价，属改写而非收窄**；原类型本就是合法值联合，不是“宽泛字面量” |
| `exercises.ts:27` | `'A' \| 'B' \| string` | `'A' \| 'B' \| 'C' \| (string & {})` | **仍接受任意字符串**；`string & {}` 不是 brand |

- `tests/unit/type-narrowing.test.ts` 只对 `typography`、`cjkFont` 做了 `@ts-expect-error`；`group` 与 `tocMapping` 没有负向类型测试。
- 因此“`src/types` 中 `| string` 宽泛联合彻底归零（Branded Literal 收窄）”只能算字面归零，不能算类型债清零。

### F4（阻断）E5：干净 clone 上 CI 必红

- `artifacts/` 被 `.gitignore` 排除，`git ls-files artifacts` 为空。
- `.github/workflows/ci.yml` 的 `automated-tests` 只执行 `npm run build` 与 `node scripts/build-electron.mjs`，**没有** `npm run pack:books`。
- `tests/contract/reader-routability.test.ts:73` 在 `beforeAll` 直接 `fs.readdirSync(artifacts/abp-packs)`；目录不存在即抛错。
- `npm test` 默认包含该契约测试，因此新 CI 在任何干净 runner 上都会失败；`P1_D_E_HANDOFF §3.5` 已明确要求“仅在测试需要 artifacts 时执行 `npm run pack:books`”，本轮遗漏。

**影响**：E5 的“CI 能对 build/route/类型失败报警”没有可用的绿色基线；一个永久红的门禁等同于没有门禁。

### F5（阻断，签署层面）E7：证据与报告存在事实错误

1. `p1-e-evidence.json` 的 `importantBaseline: 6190`、`importantDelta: -1638` 与终态报告 6,590 / −2,038 冲突；按 4,552 实测，正确值为 6,590 / −2,038（若以 6,190 为基线，则 delta 应为 −1,638，二者只能取一个口径）。
2. `p1-d-evidence.json` 的 `SettingsSurface.astro`、`settings/model/settings-registry.ts` 两个路径不存在。
3. `P1_FINAL_SIGNOFF §DoD 8` 称“`artifacts/abp-packs/` 既有打包产物哈希 100% 保持一致”，但 P1-B 已授权重打包，当前哈希与 `p1-a-evidence` 不同；应改为“v0.0.4 Release 资产未改写；本地 artifacts 于 P1-B 按授权重生”。
4. `P1_FINAL_SIGNOFF §DoD 5` 称 `FeatureToggles.astro` 降级为转发代理，实际已删除。
5. “1,251/1,251” 在默认测试中并未全量请求；应把它写成“独立全量复跑 56.1s 通过”，或新增 opt-in 全量脚本，而不是暗示默认契约测试已覆盖。

---

## 4. 非阻断发现

| 编号 | 发现 | 建议 |
| :--- | :--- | :--- |
| N1 | `astro check` 280 hints，其中 `ts(6133)` 未使用声明 180 条、`ts(6385)` 弃用 36 条、`ts(6196)` 未使用导入 10 条；`chat-controller.ts` 残留多个未使用导入，`model-manager.ts` 残留 `http`/`https` | P2 清理；本轮至少清掉 P1-D 新增文件的未使用导入 |
| N2 | `services` 仍 import `features/sideload/contract`（3 处） | Handoff E1 明确允许；在 ADR 中登记为过渡依赖，P2 再迁 `src/core/ui-state/` |
| N3 | `settings-hub.css` 新增 83 个 `!important` | 若为旧 scoped 样式搬迁，逐条注明来源；否则按新增处理 |
| N4 | `.mjs` 删除 10 个、`.ts` 垫片删除 2 个 | 与报告一致，无需动作 |
| N5 | `npm run build` 有 `:global(...)` CSS 警告 | 确认是否为存量；若是本轮引入，P2 修复 |
| N6 | 控制器总代码量比拆分前增加约 20%（新模块 2,000+ 行） | 属于可接受的接口/装配成本，但“God controller”只是被分散，未真正状态化；P2 继续 |

---

## 5. 下一步

阻断项按 **F4 → F5 → F3 → F1 → F2** 顺序整改；F4/F5 是门禁与证据，先做；F3 是小范围类型修正；F1 与 F2 涉及行为/视觉，必须单独提交、单独验证。

具体文件白名单、实现步骤、验收命令、停止条件与提交规范见：

> [`P1_REMEDIATION_HANDOFF_2026-11-14.md`](./P1_REMEDIATION_HANDOFF_2026-11-14.md)

整改完成并复核通过后，再将 `P1_FINAL_SIGNOFF_2026-11-14.md` 升版为 Rev.2，签发 `P1 CLOSED`；此前不得进入 v0.0.5 发布或 P2。
