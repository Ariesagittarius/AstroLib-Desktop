# P1-D / P1-E 执行指导（Handoff for Executor Agent）

**签发日期**：2026-11-13
**基线**：`electron/main` @ `734c66af`（P1-A/B/C 已闭环；Tag `v0.0.4` @ `df68e42c` 不变）
**依据**：[`PROJECT_ARCHITECTURE_AUDIT_2026-11-12.md`](./PROJECT_ARCHITECTURE_AUDIT_2026-11-12.md) §5（P1-02~P1-08、P1-11~P1-13）、`P0_FINAL_AUDIT §6.4`（P1-D / P1-E）、[`P1_B_C_AUDIT_2026-11-13.md`](./P1_B_C_AUDIT_2026-11-13.md) §3
**效力**：执行指令。冲突时以「`P0_FINAL §6.3` 硬约束 + 本文件」为准。

---

## 0. 三句话纪律

1. **D 不动视觉语言，E 不动行为。** D 是“同一能力只留一个生产实现 + 状态可测”，E 是“依赖方向、类型、CI、文档”。两者都**不是**重设计。
2. **D 与 E 都要先写 ADR**；D 的每一步都要有“删除前零引用证据”，E 的每一步都要有“`rg` 计数下降证据”。
3. **不新增依赖、不新增 `!important`、不新增 `any` / `| string`、不用 skip 换绿灯**；`AGENTS.md` §8.2 的改写只允许在 P1-E 发生。

---

## 1. 开工前事实（本轮已实测，直接引用）

### 1.1 P1-D 的对象

| 事实 | 实测 |
|---|---|
| 设置三套实现仍在 | `FeatureToggles.astro` 899 行（经 `ThemeSelectOverride.astro:17` 进入文档页）、`SettingsHubContent.astro` 1,998 行（`desktop.astro:122`、`hub.astro:89`）、`feature-toggles.ts` 2,049 行；两者都调 `initFeatureToggles()` |
| Header | `HeaderOverride.astro` 685 行（Starlight 覆盖）、`M3TopNavBar.astro` 552 行（3 处引用）、`VpNav.astro` 30 行（**0 引用**，纯代理） |
| 已消失的死件 | `HeaderToolsMenu.astro`、`FontSelectOverride.astro` 已不存在（P0/P1 清理完成，勿重复处理） |
| Library UI | 仅 `FragmentLibrary.astro` 828 行；`library.astro` / `library-client.ts` 已随 P0 移除 |
| God controller | `chat-controller` 2,455、`exercise-controller` 2,532、`translation-dock-controller` 2,189；`ingest-controller` 已迁入 `src/features/doc-ingestion/`（1,650 行级别） |
| 控制器状态测试 | `tests/unit` 中只有 parser/service 级测试，**没有** chat/exercise/translation 的状态迁移单测 |
| CSS | 29 个文件 / **33,563 行 / 6,190 个 `!important`**（较 P0 采样 6,189 略增）；`theme.css` 6,623 行 |
| 组件体量 | `components/exercises` 10,490 行、`components/ai` 2,798、`components/sidebar` 2,668、`components/desktop` 3,653 |
| Sideload 宽度与 `AGENTS.md` §7.2 漂移 | 代码：`compact 16.5rem / medium 20rem / wide clamp(20rem,28vw,25.5rem) / full 28rem`；规范：`wide 24.5rem` |
| 页面 | `src/pages/`：`index`（302 式跳转 `/desktop/`）、`desktop`(601)、`hub`、`blank`、`reader`、`workspace/ingest`(+css) |

### 1.2 P1-E 的对象

| 事实 | 实测 |
|---|---|
| `services → components` 倒置 | **3 处**：`services/bilingual/in-page-compare-controller.ts:16,17`、`services/translation/client/translation-dock-controller.ts:15` |
| `utils → server` 倒置 | **1 处**：`src/utils/sidebar.ts:3`（`../server/adapters/starlight-sidebar.mjs`） |
| `electron → src/server` | **0 处**（已闭环，勿再改） |
| 类型收窄 | `src/types` 中 `\| string` **4 处**（`chapter-semantic.ts:141,147`、`collections.ts:55`、`exercises.ts:27`）；`content-package.ts` 的 `: any` **0 处**（已收敛） |
| `.mjs` 存量 | `src/**/*.mjs` **48 个**，其中一行 `export * from` 垫片 **10 个**（config×4、utils×6） |
| 旧路径引用 | `src` + `scripts` + `tests` 中 `src/content/docs/collections` / `public/abp-packs` 命中 **51 处** |
| 重复栈 | `api/translate.ts` 535 行自包含实现；`ai/ai-config.ts` 与 `features.config.ts` 各一份模型目录；`ai/retriever` 与 `features/search-rec` 两套检索 |
| CI 缺口 | `.github/workflows/ci.yml` 有 typecheck + `npm test`，**没有** `astro build`、没有路由 smoke、没有 ABP pack 前置；`.astro` 的 `<script>` 不在 `tsc` 覆盖内（P1-A 的 `#undefined` 因此逃逸） |
| 文档债 | `AGENTS.md` §8.2 仍规定“桌面阅读器基于 Starlight Master Shell 合成”，与 ADR §4.3 的 P1-E 解绑承诺待兑现 |

---

## 2. P1-D：UI、控制器、CSS 与 Feature 边界

### 2.0 D0 — 决策文档

**交付物**：`docs/architecture/ADR-UI-SURFACE-CONTRACT-2026-11-13.md`（新建）

必须回答：

1. **设置唯一入口**：`SettingsHubContent` 作为唯一设置面（桌面/主壳），文档页的 `FeatureToggles` 降级为**同一套面板的薄壳**还是直接删除？给出删除条件（文档页是否需要设置入口）。
2. **Header 收敛**：保留 `HeaderOverride`（仅 Starlight 适配）+ `M3TopNavBar`（应用壳）；`VpNav` 直接删除；明确两套的断点与事件契约由谁定义。
3. **Library UI**：`FragmentLibrary` 迁入 `src/features/library/ui` 的边界与适配器注入方式。
4. **控制器拆分口径**：`state / effects / view` 三层切分，单文件上限 600 行（超限必须登记豁免理由）。
5. **CSS 分层**：`tokens → base → components → features → overrides`，`!important` 冻结与分阶段下降目标。
6. 受影响文件、禁止文件、回滚、验收命令、**对视觉零变更的证明方式**（截图/smoke 清单）。

### 2.1 D1 — 设置单一实现

**允许文件**：`src/components/FeatureToggles.astro`、`src/components/desktop/SettingsHubContent.astro`、`src/components/ThemeSelectOverride.astro`、`src/scripts/feature-toggles.ts`、`tests/unit/settings-registry.test.ts`（新增）

- 抽出 `src/features/settings/settings-registry.ts`（声明式开关/面板/默认值/localStorage key），`feature-toggles.ts` 只保留“应用与持久化”，面板 HTML 只保留一份；
- `initFeatureToggles()` 必须**幂等**（重复调用不重复绑定）；同一页面只允许一个 `<starlight-feature-toggles>` 宿主，用测试断言；
- 删除 `FeatureToggles.astro` 之前必须给出“文档页不再需要设置入口”或“已由新壳承接”的零引用证据；
- 验收：全站设置入口 1 个；`data-feature-id` 重复 0；原生 `input[type=checkbox]` 在设置面为 0（除兼容层）；单文件 < 900 行。

### 2.2 D2 — Header 收敛

- 删除 `VpNav.astro`（当前 0 引用），并清理残留 import；
- `HeaderOverride` 只做 Starlight 适配（转发到 `M3TopNavBar` 的 variant），不得再自带一套按钮逻辑；
- 验收：`rg "<VpNav|from '.*VpNav"` = 0；两套 Header 的搜索/主题/设置入口共用同一事件契约（测试断言事件名一致）。

### 2.3 D3 — Library UI 单实现

- `FragmentLibrary` 迁入 `src/features/library/ui/`，数据与安装操作走一个 `LibraryClient` 适配器（dev HTTP / Electron bridge 二选一，显式分支，不写双份 DOM）；
- 上传/ingest 入口归 `features/doc-ingestion`，不得留在 library；
- 验收：卡片/筛选/安装只有一份实现；`rg "FragmentLibrary"` 只剩页面引用。

### 2.4 D4 — 控制器拆分 + 状态单测

**允许文件**：`src/ai/client/chat-controller.ts`、`src/components/exercises/exercise-controller.ts`、`src/services/translation/client/translation-dock-controller.ts`（拆分为 `*.state.ts` / `*.effects.ts` / 原文件保留 view 层）、`tests/unit/*-state.test.ts`（新增）

- 先抽纯函数与状态机（无 DOM、无 `querySelector`），再让原 controller 消费；
- 每个拆分出的状态机至少 6 条单测：初始态、合法迁移、非法迁移被拒、持久化恢复、错误态、并发/重复触发幂等；
- 验收：三个 controller 主文件均 < 1,500 行且新增状态测试 ≥ 18 条；`rg "querySelector|addEventListener"` 不出现在新增的 state 文件中。

### 2.5 D5 — CSS 分层与 `!important` 冻结

- 建立 `src/styles/layers/`（tokens/base/components/features/overrides），`custom.css` 与 `astro.config.mjs` 不得重复导入同一文件；
- **冻结**：本 Wave 新增 `!important` = 0（CI/脚本可查），总数为 6,190，本 Wave 目标 **≤ 5,200（−16%）**，只允许通过“删除无效覆盖 + 提升选择器特异性”达成；
- `theme.css` 中与正文阅读器相关的覆盖不得再增长（P1-A 已把阅读器主路径移出 Starlight，属可回收区）；
- 验收：`!important` 计数下降且 `npm run build` 无新增警告；关键页面（desktop/hub/reader/ingest）手工 smoke 通过，视觉无意图性变化。

### 2.6 D6 — P1-13 小缺陷

- `sideload-manager` 宽度阶梯与 `AGENTS.md` §7.2 对齐（`wide: 24.5rem`），或反向修订 AGENTS（二选一并写明）；
- 监听器重复注册：`addEventListener` 入口需幂等（当前 4 处）；
- `index.astro` 的 `/desktop/` 跳转保留，但必须同时保证 `/reader/` 可达（Web 端无书时不至于完全死路）。

**D 完成定义**：设置/Header/Library 各 1 个生产实现；删除项有零引用证据；三个 controller 有 DOM-free 状态测试；`!important` ≤ 5,200 且新增为 0；`npm test` 全绿；视觉基线不变。

---

## 3. P1-E：依赖方向、重复栈、类型与治理

### 3.0 E0 — 决策文档

**交付物**：`docs/architecture/ADR-GOVERNANCE-2026-11-13.md`（新建）

必须包含：依赖分层矩阵（`utils / kernel / content / services / features / electron / publishing` 各自允许依赖谁）、类型收窄策略（branded union 而非 `| string`）、CI 门禁清单、`AGENTS.md` §8.2 的替代表述（阅读器已解绑 Starlight）、旧路径清理口径（生产代码 0 引用，历史文档标“归档”）。

### 3.1 E1 — 修正依赖倒置（3 + 1 处）

- `services/bilingual/in-page-compare-controller.ts` 与 `services/translation/client/translation-dock-controller.ts` 对 `components/sideload`、`components/sidebar` 的依赖：把“侧载宿主状态”抽到 `src/features/sideload/contract.ts`（或 `src/core/ui-state/`），components 与其共同依赖契约，而不是 service 反向 import components；
- `src/utils/sidebar.ts:3` 的 server adapter：把 `generateStarlightBookSidebar` 移到 build-only 目录（`scripts/` 或 `src/build/`），`utils/sidebar` 只留纯函数；
- 验收：`rg "from '.*components/" src/services` = 0；`rg "from '.*server/" src/utils` = 0；并加一条 CI 脚本断言。

### 3.2 E2 — 删除 10 个一行垫片

- 10 个 `export * from './*.ts'`（`src/config/*.mjs` 4 个、`src/utils/*.mjs` 6 个）：先改消费者 import 到 `.ts`，再删垫片；
- 注意 `src/utils/sidebar.mjs` 依赖 E1 先拆掉 server 依赖；
- 验收：`src/**` 中一行 `export * from` 垫片 = 0；`rg "\.mjs'"` 命中数下降（当前 `.mjs` 文件 48 个，其中真实实现保留）。

### 3.3 E3 — 类型收窄（4 处）

- `chapter-semantic.ts:141,147`、`collections.ts:55`、`exercises.ts:27`：删除 `| string`，改为显式 union 或 `string & {}`（branded）；
- 验收：`rg "\\| string" src/types` = 0（有意兼容处需注释并登记）；`check:types` 0 错；为每个 union 补一条非法值类型测试（`@ts-expect-error`）。

### 3.4 E4 — 重复栈合并（按收益排序，逐个边界）

1. `api/translate.ts`（535 行自包含）→ 抽 `translation-core`，Vercel handler 与 Node 插件共用；目标 handler < 150 行；
2. AI 模型目录：`ai/ai-config.ts` 与 `features.config.ts` 各一份 → 保留一份；
3. 检索：`ai/retriever` 与 `features/search-rec` → 明确 chat/search 共用入口（或登记“两条检索路径”的理由与后续计划）；
- 每项独立提交、独立验收；**禁止**一次性合并三个栈。

### 3.5 E5 — CI 与测试真实性

- CI 增加：`npm run build`、路由 smoke（`/desktop/`、`/reader/`、`/collections/...` 抽样）、`npm run pack:books`（仅在测试需要 artifacts 时）、以及 `astro check`（覆盖 `.astro` 的 `<script>`，堵住 P1-A3 `#undefined` 那类逃逸）；
- 验收：故意制造一个 `.astro` 脚本类型错误 → CI 必须红（本地可先验证命令）；空目录/缺产物必须 fail 而非 skip。

### 3.6 E6 — 文档与旧路径收口

- 生产代码中旧路径引用清零（当前 51 处含 docs/tests；允许 docs 历史归档保留并标注）；
- 改写 `AGENTS.md` §8.2：阅读器已由 `/reader/` + canonical `/collections/` 承载，`reader-shell-template` 退出正文主路径的时间点与替代方案；
- `docs/README.md` 索引与 ADR 交叉引用一致；所有“历史快照”文档标注归档。

### 3.7 E7 — P1 最终闭环

- `docs/architecture/evidence/p1-e-evidence.json`：依赖倒置计数（3→0、1→0）、垫片（10→0）、`| string`（4→0）、`!important`（6,190→实测）、旧路径（51→实测）、CI 新门禁跑通记录；
- 按 `P0_FINAL §6.6` 八条 DoD 逐条对账并签署 P1 闭环。

**E 完成定义**：依赖倒置 0；一行垫片 0；`| string` 0（或全部登记）；重复栈各有唯一入口或书面延期；CI 能对 build/route/`.astro` 类型失败报警；旧路径生产引用 0；`AGENTS.md` 与代码一致；`npm run check:all` 全绿；v0.0.4 资产未被改写。

---

## 4. 顺序、并行与提交

```text
D0(ADR) → D1 → D2 → D3 → D4 → D5 → D6
E0(ADR) → E1 → E2 → E3 → E4 → E5 → E6 → E7
```

- **D0 与 E0 可同时起草**；
- **D1~D3 与 E1~E3 可并行**（不同文件集）；**D4 与 E4 不得并行**（都碰 controller/service 状态边界，容易互相污染）；
- 每一步一个原子 commit，scope 只用合法值（`ui` / `core` / `content` / `render` / `ci`）。建议：
  - `docs(ui): record single settings and header surface decision`
  - `refactor(ui): collapse settings panels into one registry and surface`
  - `refactor(ui): extract controller state machines and cover them with unit tests`
  - `style(ui): layer stylesheets and stop adding important`（**注意**：`style` 是合法 type）
  - `refactor(core): remove service to component and utils to server imports`
  - `chore(core): delete one-line mjs shims after import migration`
  - `refactor(core): narrow string widened unions in src types`
  - `ci: gate astro scripts with astro check and route smoke`
  - `docs(audit): record p1-e evidence and close p1`

---

## 5. 红线（违反即停止并回退）

1. M3 重设计 / 改动学术排版基线 / 新增图标库或三方依赖；
2. 新增 `!important`、新增 `any` / `| string`、新增 `skip` 或删除既有断言；
3. 触碰 `content-sources/**`、`src/types/content-package.ts`、v0.0.4 资产、`latest.yml`、`catalog.json`；
4. 重跑 `pack-book-abp`（B 已完成唯一一次；D/E 不需要）；
5. 把 D 或 E 做成一次 Big Bang（如“一次性删掉 FeatureToggles 和三套 controller”）；
6. 在 E 中顺带改阅读器/书库运行时行为（那是 A/B/C 的既有边界）。

---

## 6. 附录：验证命令

```powershell
npm run check:types
npm test
npm run build

# D
# - 设置面板宿主数、data-feature-id 重复数、原生 checkbox 数（页面级断言）
# - 三个 controller 行数与新增 state 测试数
# - !important 总数：Get-ChildItem src -Recurse -Include *.css | Select-String '!important' | Measure-Object

# E
# - 依赖倒置：rg "from '.*components/" src/services ; rg "from '.*server/" src/utils
# - 垫片：Get-ChildItem src -Recurse -Include *.mjs | 内容匹配 '^export \* from'
# - 类型：rg "\| string" src/types
# - 旧路径：rg "src/content/docs/collections|public/abp-packs" src scripts tests
# - CI：故意注入一个 .astro script 类型错误，确认 astro check 使流水线失败
```

**报告**：每个 Wave 结束按 `P0_FINAL_AUDIT §6.8` 模板提交，必须带实测数字（不是“全部通过”），并附 `p1-d-evidence.json` / `p1-e-evidence.json`。

**签发结论**：D 的缺口集中在“设置/Header/Library 各留一个实现 + 三个 controller 可测 + `!important` 冻结下降”；E 的缺口集中在“4 处依赖倒置 + 10 个垫片 + 4 处类型扩宽 + CI 不覆盖 `.astro`/构建”。两者都无需新依赖、无需改内容、无需重打包。
