# AstroLib 第三方独立评审报告

> 评审席位：外部独立评审者（非项目作者、非既往审计参与者）
> 评审日期：2026-11-15
> 评审基线：分支 `electron/main`，HEAD `586a118e`，**含未提交工作树**（39 个已修改文件、11 个未跟踪目录）
> 运行环境：Windows / Node v24.20.0 / Astro 7 / Vitest 5
> 报告性质：综合打分与风险裁决，不修改项目任何既有文件与逻辑

---

## 0. 评审方法与边界声明

### 0.1 取证方式

本报告不接受项目内既有审计结论作为事实，全部关键数字均在本机**重新实测**：

| 取证手段 | 具体动作 | 覆盖 |
| :--- | :--- | :--- |
| 静态度量 | 文件/行数统计、正则扫描（`any`、`!important`、emoji、`innerHTML`、密钥模式） | 全仓（排除 `node_modules`/`dist`/`release`） |
| 动态验证 | `tsc --noEmit`、`vitest run`（91 文件 / 577 用例）、`astro build` | 类型、测试、构建三层门禁 |
| 契约核验 | 路由可达性、ABP 安装原子性、标题锚点一致性、图片资产完整性（经测试套件实际执行） | 1,251 章 |
| 内容抽样 | 1,251 篇 MDX 的长度/图片/占位符/卡片分布统计 | 内容层全量 |
| 治理审查 | Git 历史、分支、忽略规则、CI 工作流、ADR 与证据文件 | 流程层 |

### 0.2 本报告的局限（必须先声明）

1. **未做人工视觉验收**：沙箱内未启动浏览器逐页目视，UI 结论基于代码、样式与构建产物推导，非截图比对。
2. **未做法务意见**：版权与许可部分为工程视角的风险提示，不构成法律结论。
3. **未做渗透测试**：安全结论来自代码路径审查，未实施真实攻击利用。
4. **评审对象是"工作树"而非"提交"**：这是项目当前的真实状态，但也意味着他人无法用 `git clone` 复现本次评审——此点本身计入扣分（见 §4.2）。

---

## 1. 总评分卡

| # | 维度 | 权重 | 得分（/100） | 加权 | 等级 |
| :-: | :--- | :-: | :-: | :-: | :-: |
| 1 | 产品定位与功能完成度 | 10% | 83 | 8.30 | B+ |
| 2 | 架构设计与模块边界治理 | 14% | 80 | 11.20 | B+ |
| 3 | 代码质量与类型安全 | 12% | 74 | 8.88 | B |
| 4 | 测试体系与质量门禁 | 12% | 86 | 10.32 | A- |
| 5 | 内容工程与学术质量 | 12% | 92 | 11.04 | A |
| 6 | UI 与设计系统一致性 | 8% | 66 | 5.28 | C+ |
| 7 | 性能与构建产物 | 8% | 60 | 4.80 | C |
| 8 | 安全、隐私与合规 | 12% | 48 | 5.76 | D+ |
| 9 | 文档与知识传承 | 7% | 62 | 4.34 | C+ |
| 10 | 工程流程与发布运维 | 5% | 38 | 1.90 | D |
| — | **加权总分** | **100%** | — | **71.8** | **B（有条件合格）** |

### 1.1 一句话结论

> **这是一个内容工程质量达到 A 级、测试与架构治理达到 B+ 级、但安全合规仅 D+ 级、提交纪律仅 D 级的"高完成度、低发布就绪度"项目。**
> 加权 71.8 分说明工程主体扎实、可继续演进；但三项阻断性问题（§4.1）意味着它**当前不具备公开发布/公开仓库条件**。

### 1.2 关键实测数据（全部本机复现）

| 指标 | 实测值 | 项目自述 | 判定 |
| :--- | :--- | :--- | :--- |
| TypeScript 严格检查 | **0 errors**（`tsc --noEmit` exit 0） | 0 errors | ✅ 一致 |
| 测试用例 | **577 passed / 5 skipped / 93 文件 / 37.16s** | 78/477（`P1_FINAL_SIGNOFF`） | ✅ 优于自述 |
| 生产构建 | **23 页 / 8.99s / 38.0 MB / 1,493 文件** | 23 页 | ✅ 一致 |
| 章节总数 | **1,251 篇 MDX / 4 合集 / 13 本书** | 1,251 / 13 本 | ✅ 一致 |
| 内容体量 | **13,218,502 字符 / 4,800 处插图 / 0 破图** | — | ✅ 实测 |
| `: any` 计数 | **327**（既有 270 + 新模块 57） | 310（基线 316） | ❌ 回退 +11 |
| `as any` 计数 | **194**（既有 173 + 新模块 21） | 176（基线 183） | ❌ 回退 +11 |
| CSS `!important` | **4,686** | 4,552 | ❌ 回退 +134 |
| 三大控制器行数 | **1,362 / 1,297 / 1,240**（均 < 1,500） | 1,492 / 1,488 / 1,417 | ✅ 达标（更低） |
| `@ts-ignore` / `eslint-disable` | **0 / 0** | 0 | ✅ 一致（但见 §3.3：无 ESLint） |
| Commit 规范符合率 | **39/40  Conventional、0 条非 ASCII** | 学术克制规范 | ✅ 优秀 |

---

## 2. 各维度详评

### 2.1 产品定位与功能完成度 — 83/100（B+）

**事实**：4 大合集、13 本大学理工教材、1,251 章、1,322 万字、4,800 张图；Web 阅读器 + Electron 桌面端 + EPUB3 + LaTeX/Typst 导出 + 习题自测 + AI 问答 + 双语对齐 + 关系图谱。

**加分**
- 定位罕见且清晰：**"内容即界面"的大学数理教材阅读器**，不比拼 AI 功能数量，而是比拼排版与文献完整性。这在"AI 套壳阅读器"泛滥的当下是有辨识度的选择。
- 交付面完整：源码（MDX）→ 标准内容包（ABP 1.0.0）→ Web 动态渲染 → 桌面离线 → EPUB/LaTeX/Typst，一条内容源支撑五种出口，是真正的产品级闭环。
- 真实内容而非 Demo：13 本书均非占位文本，仅 3 章含"待补"字样、24 章低于 800 字符（占 1.9%）。

**扣分**
- **功能膨胀与定位漂移**：`features.config.ts` 注册了 **26 个功能**，其中包含终端模拟器（`@xterm/*`、`node-pty`）、Agent Harness（2,215 行控制器）、空白文档工作台、划词高亮、PWA、分析埋点。这与项目自订的"单一焦点、严禁功能堆砌"（`AGENTS.md` §5.4）直接冲突——一个"安静的学术阅读器"不该内置终端。
- **README 与产品脱节**：README 只列 6 本教材 + 1 个题库，实际 13 本；`<!-- TODO: Add screenshots -->` 至今无截图。作为开源门面，这是最廉价的失分项。

### 2.2 架构设计与模块边界治理 — 80/100（B+）

**加分（这是项目最强的工程面）**
- **7 份 ADR + 门禁文档 + evidence JSON** 构成可追溯的决策链，且罕见地包含**否决自己的审计**（`P1_REMEDIATION_AUDIT` 判定 `P1-D FAIL`，`P1_FINAL_AUDIT` 判定"暂不闭环"）。这种自我否证能力在个人项目中极稀有。
- **框架与内容彻底解耦**（Zero-Builtin Books）落地真实：`dist` 仅 23 页，正文由 `/reader/` 运行时合成；`public/abp-packs/`、`artifacts/` 均正确忽略，`git ls-files` 验证生成物 0 入库。
- **契约化基础设施**：`validateInstallPayload` 统一校验 + 目录逃逸封堵 + 三端原子安装（Web IndexedDB / Dev staging 重命名 / Electron 原生回滚），并有 34 项安装测试护住。
- **单一真源**：`collections.config.ts`（书库）、`features.config.ts`（功能，带运行时校验与 `requires` 依赖）、`release.config.ts`（发行坐标）职责清晰；`cleanSlug()` 唯一化路由。
- **边界有测试看守**：`architecture-boundaries.test.ts` 真的去扫 `services→components`、`utils→server` 的反向依赖。

**扣分**
- **边界测试偏浅**：仅 3 条规则、纯正则匹配 import 行，未覆盖 `components→services`、`features→components`、`core→*` 等真实高风险方向，属于"文档化承诺"而非"结构性约束"。
- **God Controller 复现**：刚完成 P1-D"三大控制器 < 1,500 行"的瘦身，新模块 `src/components/harness/harness-controller.ts` 已达 **2,215 行**；`feature-toggles.ts` 1,828 行、`editor-controller.ts` 1,699 行、`ingest-controller.ts` 1,650 行。同一反模式在新代码中重新长出来，说明**约束没有沉淀为可执行门禁**（只是一次性整改）。
- **浏览器构建混入 Node 模块**：`astro build` 实测告警——`node:fs` / `node:child_process` / `node:path` 被外部化，来源为 `src/core/content-api/content-api-service.ts`、`mineru-bridge.ts`、`src/core/catalog/book-catalog.mjs`。`core/` 被 `src/` 客户端图引用，属于运行时边界污染，**上线后一旦执行该分支即崩**。
- **路由冲突告警**：`Could not render '' from route /[...slug] as it conflicts with higher priority route /` —— 捕获型路由与首页竞争，是配置层未收敛的信号。
- **`astro.config.mjs` 承担过多**：303 行内直接装配 13 个 dev server 插件，其中 **9 个**（exercise / gemini / translation / ingest / bilingual / bupt / infoHighlight / library / content-api）未走 `isEffective()` 开关，与"功能关闭即零打包"的设计承诺不完全一致。
- **文档声明的路径已失效**：`AGENTS.md` §8.2 仍指向 `src/services/content-provider/reader-shell-template.ts`，实际已在 `electron/server/`。

### 2.3 代码质量与类型安全 — 74/100（B）

**加分**
- `tsc --noEmit` **0 错误**（strict + 覆盖 `src`/`scripts`/`tests`/`api`/`electron`），且 **0 个 `@ts-ignore`/`@ts-expect-error`**——没有靠压制错误换取绿灯。
- 关键模块注释质量高：`sideload-manager.ts`、`features.config.ts`、`install-validation.ts` 的头部契约说明清晰，能起到"读注释即懂边界"的作用。
- 拼音命名、魔法值收敛良好（`WIDTH_MAP`、`FEATURE_IDS`、`RELEASE_*`）。

**扣分**
- **`any` 密度偏高且正在回升**：`: any` 327、`as any` 194、`<any>` 76。相对已归档基线（316 / 183）**净回退 +11 / +11**，其中新模块贡献 57 处 `: any`。所谓"压降至基线以下"的结论仅对某一时刻成立，**缺少防回退机制**。
- **无 Lint 层**：仓库无 ESLint/Prettier 配置，`package.json` 无 lint 脚本。这意味着未使用变量、`==`、`catch {}` 空捕获、`(window as any)` 等只能靠人眼守。对 7.7 万行 TS 而言是显著缺口。
- **超长文件集中**：除上述控制器外，`exercise-sidebar-controller.ts` 1,271、`exercise-export-pipeline.ts` 1,144、`module-inspector/client/inspector.ts` 1,125。单文件过千行在客户端逻辑中意味着不可测。
- **空 `catch {}` 与 `as any` 出现在核心状态机**（`sideload-manager.ts:113`、`:93`），出错即静默降级，不利于线上定位。

### 2.4 测试体系与质量门禁 — 86/100（A-）

**加分（实测最强的质量证据）**
- **真实执行**：91 文件 / 577 用例 / 5 跳过，**37.16s 全绿**，且耗时集中在真实 IO 契约（路由 35.9s、ingest 14.1s、标题契约 17.5s）——不是空转的 mock 测试。
- **四层金字塔名副其实**：`unit`（60 文件）→ `contract`（24 文件）→ `acceptance`（8 文件）→ `system`（3 文件）。
- **契约测试打在真问题上**：1,251 个 Canonical Slug 物理完备 + 真实 HTTP 200；1,191 条 legacy 301；`headings[].id ⊆ HTML ids` 100%；ABP 安装原子性与路径逃逸；打包卫生（`packaging-hygiene`、`zero-precompiled-books`、`public-hygiene`）。
- **CI 真跑**：`.github/workflows/ci.yml` 三作业覆盖 `check:types` → `check:astro` → 构建 → `pack:books` → `npm test` → `test:system`，另有 latex/epub/electron 三条发布流水线。

**扣分**
- **默认门禁留了口子**：`npm test` 显式 `--exclude **/reader-full-routability.test.ts`，最重的全量可达性测试需单独触发；CI 是否跑全量取决于工作流参数（本次未验证）。
- **无覆盖率门槛**：无 `coverage` 配置、无阈值、无趋势看板。测试"有"但不保证"够"。
- **无浏览器级验证**：无 Playwright/Cypress，视觉回归被明确"延期至 P2"（`p1-d-visual-smoke.md` 自陈未做截图 Diff）。对一个以排版为卖点的项目，**排版无视觉回归是最反讽的缺口**。
- **断言深度不均**：`architecture-boundaries.test.ts` 之类属"配置检查"，与 `reader-routability` 的真 HTTP 契约不在同一量级。

### 2.5 内容工程与学术质量 — 92/100（A）

**加分**
- **规模与完整性双高**：1,251 章 / 1,322 万字 / 4,800 图；`image-assets` 契约测试保证引用图 100% 存在（实测 0 破图）。
- **语义卡片体系真实在用**：`<Example>` 2,285、`<Exercise>` 2,626、`<Solution>` 3,397、`<Knowledge>` 1,588、`<Figure>` 1,403、`<Block>` 393——不是装饰性组件，而是承载了教材结构的骨架。
- **编译期下沉做到了**：KaTeX `output:'html'`（去 MathML 冗余）、引用徽章 `rehype-cross-ref` 下沉、公式源码回填 `data-latex`、图片 LQIP 占位、CJK 标点自愈——这些是"性能与排版"主题下真正有价值的技术投入。
- **占位率极低**：仅 3 章含"待补/TODO"字样，1.9% 章节偏薄（多为刻意短小的导入章节）。

**扣分**
- **导入管线未收敛**：`scripts/` 下并存 **10 个一次性 `import_*.py`**（110–499 行/个），每本书一套私有转换逻辑。第 14 本书意味着第 14 份复制粘贴，与"Rule 10 小步迁移"精神相悖。
- **24 章偏薄**（< 800 字符），`math_analysis` 存在 429 字符章节，需确认是"节导语"还是"漏采"。
- **内容正确性无自动校验**：公式语义、OCR 错字、图表编号一致性无机器判据，只能靠人工抽检。这是 1,322 万字规模下的最大隐性风险。

### 2.6 UI 与设计系统一致性 — 66/100（C+）

**加分**
- 设计系统选择正确且执行有纪律：`@material/web` + `@m3e/web` 双栈、M3 语义 token、`layers.css` 分层、`#astro-overlay-root` 统一浮层、Sideload Dock 单宿主（`sideload-manager.ts` 343 行，状态机 + CSS 变量 + 事件派发，实现干净）。
- 关键交互规范被工程化：桌面 dock / 平板 side sheet / 移动 bottom sheet 三档、Esc 回退、`--sl-sideload-width` 联动防公式重排。

**扣分（自有规范被自己违反）**
- **Emoji 禁令形同虚设**：`src/` 内实测 **80 处** emoji，其中 `BookRelationGraph.astro:88-91` 直接把 🌐📦🎯🔗 写进 `<option>` 用户可见文案。`AGENTS.md` §5.2 明令"全站严禁 emoji"，而这条规则在 UI 层没有被执行。
- **`!important` 回退**：4,686 处（相对归档 4,552 **+134**），且新模块贡献 0——说明回退发生在既有文件里，即"冻结后又被改回去"，缺少 CI 阈值守卫。
- **CSS 体量失衡**：34,370 行 CSS 对 23 个静态页 + 1 个动态阅读器；`exercise-theme.css` 单文件 **2,937 行**，`library.css` 还存在 `styles/desktop/`（645）与 `styles/pages/`（509）两套并存。
- **视觉证据缺失**：README 无截图、无 GIF；`p1-d-visual-smoke.md` 自陈"未做自动化截图 Diff，D5 维持 CONDITIONAL"。**排版类产品的视觉质量目前只有主观声明，没有客观证据。**

### 2.7 性能与构建产物 — 60/100（C）

**加分**
- 构建快且轻：**23 页 / 8.99s / 38 MB**，Shell 架构让正文不进构建树，这是正确的取舍。
- 关键优化真实存在：`prefetch:false` 交由自研 SPA 引擎接管、KaTeX 纯 HTML、LQIP 占位、`optimizeDeps` 预打包 mermaid、pass-through 图片（不重复压缩）。

**扣分**
- **客户端 JS 头部过重**：`chunk-FOHPRMQF.js` **647 KB**、`HarnessStage.astro...js` **489 KB**、`cytoscape.esm` **425 KB**；按未压缩计，阅读页首屏可达 MB 级。而 `features.config` 里这些功能默认 `enabled: true`。
- **CSS 首屏负担**：`fonts.css` 210 KB + `common.css` 207 KB + `features.css` 198 KB。
- **无性能预算门禁**：无 Lighthouse CI、无 bundle size 阈值、无 `chunkSizeWarningLimit` 策略（构建日志已在警告 chunk 过大）。性能目前"靠感觉"，不"靠门禁"。
- **字体策略有隐患**：`@fontsource-variable` 全量 unicode-range 切片虽标称"零下载"，但 3 套中文字体 CSS 元数据本身即 210 KB。

### 2.8 安全、隐私与合规 — 48/100（D+）

> 本维度是项目**唯一低于 60 分**的维度，也是发布阻断项来源。以下每条均有可复现证据。

**P0-A 硬编码生产 API 密钥（凭据泄露）**

```
src/components/harness/harness-controller.ts:137
  apiKey: 'sk-xWxq...REDACTED'
```

同一密钥还出现在 `tests/contract/harness-chat-endpoint.test.ts:13`、`tests/unit/harness-provider-switching.test.ts:20`、`src/server/plugins/content-api/dev-server-plugin.mjs:494`、构建产物 `dist-electron/main.mjs:69527`。
`git log --all -S` 确认**尚未进入提交历史**（当前仍是 untracked），但 `git status` 显示 `src/components/harness/` 为 `??`——**一次 `git add -A` + 公开推送即全网泄露**。该网关为校内免费算力平台，密钥外泄直接对应学校资源被滥用。

**P0-B 不可信内容 → HTML 直注 → Electron 能力滥用链**

- `electron/server/reader-shell-template.ts:633`、`:1417` 将 `payload.html`（来自**用户可安装的 `.abp` 包**）**原样拼进 DOM**，该路径上无任何 sanitizer（全仓 sanitizer 仅用于 LaTeX 与错误提示）。
- Electron `main.ts:131-133`：`contextIsolation: true`、`nodeIntegration: false` ✅，但 **`sandbox: false`** ❌；`preload.ts` 通过 `contextBridge` 暴露 **40+ IPC 通道**，含 `install-book-from-abp`、`remove-book`、`clear-all-userdata`、`start-model-download`、`fetch-official-catalog`。
- 全仓 `innerHTML` 类写入 **276 处**，无 CSP（`Content-Security-Policy` 命中 0）。
- 组合后果：一个恶意 `.abp`（社区分享/第三方 catalog）→ 注入脚本 → 调用 `window.astrolib.*` → 清空用户数据/安装任意包。这是**架构级**问题，不是单点 bug。

**扣分（其余）**
- **隐私表述与实现不符**：`features.config.ts` 中 `analytics` **默认 `enabled: true`**，接入 Microsoft Clarity（会话录屏 + 热力图，`clarityProjectId: 'y9on8roaw3'`）。而 README 与设计文档反复强调"端侧隐私优先""无需配置任何环境变量"。录屏级分析必须显式 opt-in，不能默认开。
- **本地代理 CORS 全开**：`gemini-proxy/dev-server-plugin.mjs:154` 返回 `Access-Control-Allow-Origin: *`，dev server 运行期间任意网页可借用用户 Key 调用中继。
- **dev server 暴露公网隧道**：`astro.config.mjs:296-300` 的 `allowedHosts` 含 `trycloudflare.com` / `localtunnel.me` / `vaiwan.com`，配合 13 个本地写文件/执行命令插件，隧道分享期间等于把写盘与命令执行能力挂到公网（当前默认配置下风险可控，但缺少显式告警）。
- **终端与命令执行进入阅读器**：`node-pty` + `xterm` + 11 处 `child_process`，`dev-server-plugin` 里 `execFileAsync(node, ['bin/astrolib-cli.mjs', ...])`。功能上可行，安全上是把"阅读器"变成了"IDE 宿主"。
- **内容许可存在法务瑕疵**：13 本教材（高教社/机械工业/北邮社等）全量正文被置于公开仓库，并以 **CC BY-NC-SA 4.0 再许可**。项目方并非权利人，无权对该内容授予 CC 许可；GPL-3.0 覆盖代码尚可，但"内容随仓库分发"是明确的侵权暴露面。

**公允之处**：`contextIsolation` 正确开启、`will-navigate` 有拦截、安装路径逃逸有统一校验且有 4 类测试、`.env` 已忽略且仓库内无其它真实密钥、`validateInstallPayload` 设计良好。安全不是"完全没做"，而是"做了边界校验，缺了执行环境隔离与内容净化"。

### 2.9 文档与知识传承 — 62/100（C+）

**加分**
- `docs/README.md` 是一份真正的索引：92 行内完成"指南 / 架构 / 归档"三分，每个条目都标注了关联代码模块，可直接跳转。
- 文档总量惊人：**91 篇 Markdown / 19,310 行**，其中 `docs/architecture/` **54 篇**（ADR 7 篇 + 阶段审计 + evidence JSON + 交接指令）。
- `tests/TESTING.md`、quickstart 4 篇、contributing 3 篇，新人路径完整。
- **审计文化罕见**：`P1_REMEDIATION_AUDIT` 敢于写出"D4 行数增至 1,500/1,533/1,525，报告仍写 1,495"并判定 FAIL。这种自我打脸是文档体系最大的信用资产。

**扣分**
- **审计文档压倒产品文档**：54 篇架构文档里绝大多数是"复核裁决 / 整改指令 / 门禁回执"，同一阶段（P1）在两天内产出 7 份互相否定的快照。对后来者，**信息密度被过程噪声稀释**——想知道"这个项目怎么跑起来、架构长什么样"，要在 54 篇里淘。
- **可验证的漂移**：README 书目 6 vs 实际 13；`AGENTS.md` §8.2 路径已迁移；`books.config.mjs` 仍在多处被引用为"现行配置"（实际废弃）；文档中 98 处 `src/content/docs`、53 处 `public/abp-packs` 与当前架构不符（虽标"归档"，但无统一失效标记）。
- **归档与现行未物理隔离**：`docs/archive/` 仅 4 篇，其余历史快照仍混在 `architecture/` 主目录。
- **无架构图**：一份 9.4 万行（src）、7 层目录的项目，没有一张可渲染的模块/数据流图（mermaid 都没用上，尽管站内支持）。

### 2.10 工程流程与发布运维 — 38/100（D）

**加分**
- **Commit 纪律近乎满分**：最近 40 条提交 **39 条**符合 `type(scope): imperative`，**0 条非 ASCII**，无 emoji——`AGENTS.md` §4.1 的"学术克制提交规范"被真实执行。
- **双轨发行有实现**：`git-clean-push.mjs`（脱敏公开推送）、`one-click-push.mjs`、electron-builder（NSIS + portable）、`release.config.ts`、`electron-release.yml` / `epub-release.yml` / `compile-latex.yml`。
- **门禁有实证**：`P0_FINAL_AUDIT` 记录了 `latest.yml` 404 这类真实线上故障的定位与修复，说明发布链路被真实演练过。

**扣分（本维度失分最重）**
- **评审对象不可复现**：`git status` 显示 **39 个已修改文件 + 11 个未跟踪目录**（`src/components/harness/`、`src/ai/mcp/`、`src/ai/terminal/`、`src/core/content-api/`、`src/services/antigravity-cli/`、`src/plugins/harness/`、`src/server/plugins/content-api/` 等）。这意味着**最危险的新代码（含硬编码密钥、2,215 行 God Controller）全部游离于版本控制之外**。任何"门禁全绿"的结论都只对工作树成立，对仓库不成立。
- **分支与远端 sprawl**：本地 `electron/main`、`main`、`agents/project-deep-analysis-multi-evaluation`、`agents/update-development-documentation`、`backup/math-enhancement-20260903` 五分支 + `origin` / `private` / `web-upstream` 三远端。当前 HEAD 停在 `electron/main` 而非 `main`，**主干与工作分支的关系不清晰**。
- **`.gitignore` 中文注释乱码**：文件以错误编码写入，出现 `# MinerU 鍘熷杞崲浜х墿...` 并导致注释与规则同行（如 `...锛?artifacts/`）。规则本身仍生效（`git check-ignore` 逐条验证通过），但**可维护性已受损**——下一个人无法判断某行是注释还是规则。
- **工作区垃圾体量**：`backup/` 7,523 文件、`.backups/` 6,642、`artifacts/` 9,920、`test/` 2,397、`task/` 937、`.tmp/` 3,928。虽多数已忽略，但磁盘上 **3 万+ 临时文件**包围仓库，与"公共目录卫生"的洁癖主张形成反差。
- **两次构建残留物入 `public/`**：`public/exact_logo_preview.html` 是设计预览件；`dist/` 仍产出 `/guides/example`、`/reference/example`（Starlight 脚手架示例页）——示例页进入生产产物。
- **CI 命名含 emoji**（🛡️🧪⚙️），违反自有 emoji 禁令；`scripts/__pycache__/` 未忽略。

---

## 3. 交叉验证：项目自我声明 vs 独立实测

| 自我声明（出处） | 实测 | 结论 |
| :--- | :--- | :--- |
| "`!important` 从 6,590 压降至 4,552"（`p1-d-evidence.json`） | 4,686 | **已回退 134**，证据过期 |
| "`any` 压降至基线以下（310 ≤ 316 / 176 ≤ 183）"（`p1-e-evidence.json`） | 327 / 194 | **已回退 +11/+11**，且新模块再添 57 |
| "三大控制器 1,492/1,488/1,417 < 1,500"（`P1_FINAL_SIGNOFF`） | 1,362/1,297/1,240 | ✅ 成立且更优 |
| "测试 78/477"（`P1_FINAL_SIGNOFF`） | 577 passed | ✅ 实测更好（自述偏保守） |
| "23 页构建成立" | 23 页 / 8.99s | ✅ 成立 |
| "1,251/1,251 路由 200"（`p1-a-evidence.json`） | 契约测试实际跑通 | ✅ 成立 |
| "零内置书、生成物不入库" | `git ls-files` 生成物 0 命中 | ✅ 成立 |
| "端侧隐私优先"（README/设计文档） | Clarity 录屏默认开启 | ❌ 不符 |
| "全站严禁 Emoji"（`AGENTS.md` §5.2） | `src/` 80 处，含用户可见 `<option>` | ❌ 未执行 |
| "`npm test` 即全量门禁" | 默认排除 full-routability | ⚠️ 部分成立 |

**结论**：项目的**验证类声明（测试/路由/构建）高度可信**，**治理类指标（any/!important）存在系统性过期**，**规范类声明（emoji/隐私）存在执行落差**。前审计把"某一时刻达标"当成"持续达标"，缺少防回退门禁——这是评审最应指出的方法论缺陷。

---

## 4. 问题清单（按处置优先级）

### 4.1 阻断项（P0 — 公开发布前必须清零）

| ID | 问题 | 证据 | 建议动作 |
| :-- | :--- | :--- | :--- |
| P0-1 | 生产 API Key 硬编码于 5 处源码/测试 | `harness-controller.ts:137` 等 | **立即轮换密钥**；改读 `process.env`/用户设置；加 `gitleaks` pre-commit 与 CI secret scan |
| P0-2 | 用户可安装内容包 HTML 未净化 + `sandbox:false` + 40 IPC | `reader-shell-template.ts:633,1417`；`main.ts:133` | 引入 DOMPurify 白名单净化；开启 `sandbox:true`；IPC 侧做来源与参数校验；加 CSP |
| P0-3 | 出版社教材全文以 CC BY-NC-SA 公开再许可 | `README.md:188-204`、`LICENSE-CONTENT` | 内容包不随公开仓库分发（仅代码 + 用户本地导入）；或取得授权；补侵权响应预案 |

### 4.2 高优（P1 — 1–2 周）

1. **收敛工作树**：提交或丢弃 39 个修改与 11 个未跟踪目录；把 `electron/main` 合回 `main`；为 harness/agent 代码建立独立分支与评审。
2. **补 Lint 与防回退门禁**：ESLint + Prettier；CI 增加 `any` 计数、`!important` 计数、文件行数上限的**阈值断言**（当前只是文档里的数字）。
3. **修复运行时边界**：拆出 `core/content-api` 的 Node-only 部分，消除 `node:fs/child_process` 进入浏览器图；解决 `[...slug]` 路由冲突告警。
4. **Emoji 与设计规范落地**：清除 80 处 emoji（尤以 `<option>` 为甚）；对 `AGENTS.md` 禁令加自动化检查。
5. **隐私合规**：Clarity 默认关闭并显式征询；代理 CORS 收敛为同源。
6. **文档去漂移**：README 书目更新为 13 本 + 补 2 张实景图；修 `AGENTS.md` 失效路径；`.gitignore` 以 UTF-8 重写；历史审计移入 `docs/archive/`。

### 4.3 中优（P2 — 1–2 月）

1. **统一导入管线**：13 个 `import_*.py` 合并为「解析器 + 每书 manifest」，用配置描述差异。
2. **视觉回归**：Playwright + 截图 Diff，覆盖 desktop/reader/hub/exercise 四类页面——这是排版产品的必修课。
3. **性能预算**：Lighthouse CI + chunk 阈值；把 HarnessStage(489 KB)/cytoscape(425 KB) 改为按需动态加载。
4. **覆盖率门槛**：`vitest --coverage` + 行/分支阈值 + 趋势记录。
5. **拆分千行客户端文件**：`exercise-*`、`module-inspector`、`feature-toggles` 按状态机/渲染/IO 三分。
6. **内容正确性巡检**：对 1,322 万字建立公式平衡、图表编号、交叉引用悬空的自动审计。

### 4.4 低优（P3 — 季度）

补 i18n（当前仅 `zh-CN`）、清理 `public/exact_logo_preview.html` 与 Starlight 示例页、忽略 `__pycache__`、为 `docs` 补一张 mermaid 架构总图、统一 `library.css` 双份实现。

---

## 5. 独立评审的补充判断

### 5.1 这个项目最值得肯定的三件事

1. **它真的把"教材数字化"当工程做，而不是当 Demo 做。** 1,251 章、4,800 图、零破图、编译期下沉、ABP 契约、原子安装——这些不是靠 prompt 生成能糊出来的。
2. **它有罕见的"自我否证"能力。** 审计文档敢写 FAIL、敢承认"未做截图 Diff"、敢把 CONDITIONAL 而非 CLOSED 写进签署报告。这在 AI 辅助开发时代是极其稀缺的工程品格。
3. **它的测试打在了真实风险上。** 1,251 条路由的真实 HTTP 200、1,191 条 legacy 301、`headings[].id ⊆ html ids`——这些契约直指重构最容易崩的地方，而非"测个加法函数"。

### 5.2 最值得警惕的三件事

1. **规范与执行脱节，正在变成系统性风险。** emoji 禁令（80 处违反）、隐私声明（录屏默认开）、`any`/`!important` 基线（签完字就回退）、"单一焦点"（26 个功能）。**当规则只写在 AGENTS.md 里而不在 CI 里，它就只是愿望。**
2. **能力边界正在失控。** 一个教材阅读器内置了终端、MCP 工具链、Agent Harness、划词高亮、空白文档编辑器。每增加一项，安全面、测试面、文档面都线性膨胀，而**维护者只有一个人**（提交与审计均呈单点特征）。
3. **最危险的代码不在版本控制里。** 硬编码密钥、2,215 行 Harness 控制器、未净化的内容注入链，全部躺在 untracked 目录。**"工作树全绿"是一种幻觉**——它无法被 clone、无法被 CI 复现、无法被他人审计。

### 5.3 评分调整的敏感度分析

| 情景 | 变化 | 总分 |
| :--- | :--- | :--- |
| 现状 | — | **71.8** |
| 仅修 P0-1/2/3（安全合规 48→78） | +3.6 | **75.4** |
| 再收敛工作树 + 补 Lint/防回退门禁（流程 38→72，代码 74→82） | +2.6 | **78.0** |
| 再补视觉回归 + 性能预算（UI 66→82，性能 60→78） | +3.5 | **81.5** |
| 再统一导入管线 + 文档去漂移（内容 92→95，文档 62→80） | +2.3 | **83.8** |

> 即：**在不新增任何功能的前提下，仅靠"修正现有债务"，这个项目可以从 71.8 提升到 84 左右**。它缺的不是能力，是收口。

---

## 6. 裁决

| 裁决项 | 结论 |
| :--- | :--- |
| 工程质量总体 | **合格偏上（B，71.8/100）** |
| 内容与测试可信度 | **高（可采信其路由/构建/测试类声明）** |
| 治理指标可信度 | **中（数字真实但已过期，缺防回退）** |
| 公开发布就绪度 | **不具备（NOT READY）**，阻断于 P0-1/2/3 |
| 建议路径 | 先做"减法与收口"（P0 + P1），再谈新功能；**冻结新特性 2 周** |

**给维护者的一句话**：这个项目已经越过了"能不能做出来"的阶段，卡在"敢不敢让别人用/让别人看"的阶段。把密钥换掉、把内容包移出公开仓库、把沙箱打开——这三件事做完，它的分数和它的名声会一起上一个台阶。

---

## 附录 A：可复现命令

```powershell
# 类型门禁（实测 0 error）
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json

# 测试金字塔（实测 577 passed / 5 skipped / 37.16s）
node node_modules/vitest/vitest.mjs run tests/unit tests/contract tests/acceptance `
  --exclude "**/reader-full-routability.test.ts"

# 生产构建（实测 23 页 / 8.99s / 38 MB）
node --max-old-space-size=4096 node_modules/astro/bin/astro.mjs build

# 治理指标复算
#   : any      -> Select-String -Pattern ':\s*any\b'
#   as any     -> Select-String -Pattern '\bas any\b'
#   !important -> Select-String -Pattern '!important'
#   emoji      -> Select-String -Pattern '[\uD800-\uDBFF][\uDC00-\uDFFF]|[\u2600-\u27BF]'
```

## 附录 B：实测样本（节选）

```
src code           250 files /  77,354 lines
src astro           88 files /  16,416 lines   （src 合计 338 files / 93,770 lines）
src css             37 files /  34,370 lines
scripts            182 files /  25,784 lines
tests              101 files /  14,080 lines
docs                91 files /  19,310 lines
content mdx      1,251 files / 286,619 lines (13,218,502 chars)
tracked files    9,953（content-sources 7,193 / public 989 / src 381）
```

> 口径说明：以上为**含空行**的总行数（按换行符计数）。初版报告误用 `Measure-Object -Line`（该参数会跳过空行），导致 MDX / 测试 / 文档行数偏低约 30–45%，已于 2026-11-15 修订。非空行口径下：src TS 66,834、src Astro 14,663、CSS 30,497、tests 11,927。

```
最大源文件：harness-controller.ts 2,215 | feature-toggles.ts 1,828
          editor-controller.ts 1,699 | ingest-controller.ts 1,650
          chat-controller.ts 1,362  | exercise-controller.ts 1,297
最大产物：  chunk 647 KB | HarnessStage 489 KB | cytoscape 425 KB | katex 253 KB
```

---

*本报告由外部评审者独立完成，全部数据来自 2026-11-15 本机实测。报告只新增文件，未修改项目任何既有源码、配置或文档。*
