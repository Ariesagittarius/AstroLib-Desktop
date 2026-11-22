# AstroLib 自动化 PDF2ABP 多智能体管线与二期 Harness UI 接入交接文档

**版本**: Phase 1 Closed · Phase 2 UI Handoff
**日期**: 2026-11-21
**前置依赖基线**: `ADR-UI-SURFACE-CONTRACT-2026-11-13.md`、`P1_FINAL_SIGNOFF_2026-11-14.md`、`AGENTS.md` §5–§8

---

## 1. 一期交付基线与已就绪后端能力

一期已完整建成应用内端到端 **PDF2ABP** 自动化多智能体流水线，所有核心模块均通过严格类型检查（`npm run check:types` 0 errors）、Electron 主进程打包（`node scripts/build-electron.mjs`）以及 3 组真实 PDF（4 页高考数学卷、20 页学术论文、318 页 *Algorithms* 经典教材）的 **Youlabber + MinerU** 实测验证。

### 1.1 已落盘模块清单一览

| 分层 | 模块路径 | 核心职责与导出符号 |
| :--- | :--- | :--- |
| **上下文与推理执行器** | `src/ai/agent/context-manager.ts`<br>`src/ai/agent/harness-runner.ts` | `AgentContextManager`（单图滚动视觉槽 `maxImagesPerRequest=1`、原子 Turn-Group 压缩）；`runAgentLoop`（Zod v4 schema、SSE/JSON 解析、429/5xx 重试、视觉合成注入、步数预算提示） |
| **主从编排与工具集** | `src/ai/agent/pdf2abp-agent.ts`<br>`src/ai/agent/subagent-orchestrator.ts`<br>`src/ai/agent/pdf2abp-tools.ts`<br>`src/ai/agent/pdf2abp-base-tools.ts` | `Pdf2AbpJobManager` 单例（`startJob`/`resumeJob`/`cancelJob`/`waitForJob`/`subscribe`）、`DEFAULT_YOULABBER_CONFIG`；有界并发子代理（`1..6`）、`subagents/*.result.json` 检查点、独立二次验收 |
| **无头 ABP 出版引擎** | `src/publishing/abp/compiler.ts`<br>`src/publishing/abp/validator.ts`<br>`src/publishing/abp/types.ts` | `compileBookToAbp`（支持 15 类学术卡片、KaTeX、Mermaid、多级目录、封面、`ai-index`/`cross-refs`/`relation-graph`/`inspector-data`）；`validateBookDirectory` / `verifyAbpArchive`（全真 MDX + KaTeX + 资产闭环门禁） |
| **PDF/MinerU/Python/导入** | `src/services/pdf2abp/workspace-manager.ts`<br>`src/services/pdf2abp/pdf-processor.ts`<br>`src/services/pdf2abp/mineru-pipeline.ts`<br>`src/services/pdf2abp/chunk-slicer.ts`<br>`src/services/pdf2abp/python-runner.ts`<br>`src/services/pdf2abp/abp-importer.ts` | 沙箱工作区与路径防逃逸；`mupdf` WASM + `sharp`（200 页自动分卷、高 DPI 渲染、2×2 / 2-up 拼图、区域裁剪）；MinerU 确定性多卷缝合；工作区 `run_python`；`importAbpToAppLibrary`（Rule 9 合规原子安装） |
| **内置可探索 Skill** | `src/ai/skills/pdf2abp/index.ts` | `listPdf2AbpSkills()` / `readPdf2AbpSkill(id, sectionId)`，覆盖 `abp-spec`、`academic-typesetting-rules`、`pdf2abp-orchestrator-sop`、`subagent-proofreader-protocol`、`mineru-pitfalls-and-python-recipes` |
| **HTTP / SSE 服务端点** | `src/server/plugins/pdf2abp/dev-server-plugin.mjs` | 已挂载至 `astro.config.mjs`、`electron/server/local-server.ts`；`electron/main.ts` 已注册 `registerElectronAbpInstaller` 与 `ASTROLIB_PDF2ABP_DIR` |
| **命令行工具** | `bin/astrolib-pdf2abp.mjs` | `check` / `run` / `resume` / `inspect` / `list` |

---

## 2. 二期前端对接契约（REST + SSE + 事件与状态模型）

二期 UI **无需重新设计后端状态或直接读写文件系统**，所有实时进度、子代理状态、工作区本地产物预览及断点控制均严格通过 `/api/v1/pdf2abp/*` 驱动。

### 2.1 接口矩阵（`src/server/plugins/pdf2abp/dev-server-plugin.mjs`）

| 方法与路径 | 入参 / 查询参数 | 响应结构与状态码 | 二期 UI 用途 |
| :--- | :--- | :--- | :--- |
| `GET /api/v1/pdf2abp/health` | — | `200`: `{ ok, mineru, python, defaultGateway: { providerId, modelId, baseURL, capabilities } }` | 启动前诊断：展示 MinerU Token/本地引擎与 Python 状态；无 MinerU 时阻止盲目启动并展示引导 |
| `GET /api/v1/pdf2abp/skills` | — | `200`: `{ skills: SkillSummary[] }` | 在设置/文档抽屉中列出内置规范列表 |
| `GET /api/v1/pdf2abp/skills/:id` | `?section=<sectionId>` | `200`: `{ skill }` / `404` | 支持用户在 UI 内按需查阅 ABP 规范 |
| `POST /api/v1/pdf2abp/jobs` | JSON: `{ pdfPath, concurrency?, autoImport?, instructions?, providerId?, modelId?, baseURL?, apiKey?, maxSteps? }` | `202`: `{ job: Pdf2AbpJobState }`；路径非法返回 `400` (`INVALID_PDF_PATH` / `PDF_NOT_FOUND`) | 启动新的全自动 PDF2ABP 任务 |
| `GET /api/v1/pdf2abp/jobs` | — | `200`: `{ jobs: Pdf2AbpJobState[] }` | 任务列表侧边栏 / 历史任务恢复与多任务切换 |
| `GET /api/v1/pdf2abp/jobs/:id` | — | `200`: `{ job: Pdf2AbpJobState }` / `404` | 获取当前完整任务快照（含阶段、子代理表、验证与导入结果） |
| `GET /api/v1/pdf2abp/jobs/:id/stream` | — | **SSE (`text/event-stream`)**：先自动回放 `events.jsonl` 历史事件，再实时推送增量事件；结束时发送 `event: done` | **实时监控主通道**：驱动Thinking、工具调用、视觉槽附图预览、子代理进度与错误告警；支持断线重连 |
| `POST /api/v1/pdf2abp/jobs/:id/cancel` | — | `200`: `{ job }` / `404` | 优雅中止运行中的主代理与所有子代理 |
| `POST /api/v1/pdf2abp/jobs/:id/resume` | 可选 JSON `{ concurrency?, autoImport?, instructions?, modelId?, ... }` | `202`: `{ job }` / `409`（运行中） / `404` | 从中断或失败点恢复（自动复用 MinerU 缓存与已达标子代理检查点） |
| `GET /api/v1/pdf2abp/jobs/:id/files` | `?dir=&maxDepth=3` | `200`: `{ jobId, dir, entries: WorkspaceFileEntry[] }` | 展示工作区实时落盘目录树（`mineru/`、`pages/`、`chunks/`、`subagents/`、`book/`、`dist/`） |
| `GET /api/v1/pdf2abp/jobs/:id/file` | `?path=<relPath>` | `200`: 文本/JSON/图片二进制流；越权访问返回 `403` (`PATH_TRAVERSAL_BLOCKED`) | 在【成果物】面板即时预览 `.mdx`、`book.json`、拼图/封面 `.jpg`、Python 脚本与日志 |

### 2.2 状态阶段与实时事件字典（`src/services/pdf2abp/types.ts`）

- **`Pdf2AbpPhase`（共 10 个有序阶段）**：
  `init` → `skills_and_inspect` → `mineru` → `overview_vision` → `planning_and_slicing` → `subagent_proofreading` → `merge_and_validate` → `pack_and_verify` → `import` → `done`
- **`Pdf2AbpEvent.type`（SSE `event:` 字段）**：
  - 任务级：`job_started`、`phase_changed`、`job_completed`、`job_cancelled`、`error`
  - 智能体动作：`thinking`、`tool_start`、`tool_result`、`warning`
  - 关键可观测资产：`vision_attached`（`data: { label, relPath }` — 可直接用 `/file?path=${relPath}` 展示当前智能体正在观察的原书拼图或高清页！）、`artifact_written`（`data: { path, toolName }` — 触发文件树高亮与热预览）
  - 子代理泳道：`subagent_started`、`subagent_finished`（实时更新 `subagentTasks[taskId]`）

---

## 3. 二期前端 Harness UI 架构设计规范

### 3.1 现有界面底座与模块边界约束

当前 Harness UI 位于：
- 页面挂载点：[desktop.astro](file:///d:/Antigravity/project/AstroLib/src/pages/desktop.astro)（嵌入 `<HarnessStage />`）
- 舞台骨架：[HarnessStage.astro](file:///d:/Antigravity/project/AstroLib/src/components/harness/HarnessStage.astro)（右侧 `#harness-inspector-stage` 已预留四个 Tab：`catalog` 书目导览、`artifacts` **成果物 `#harness-pane-artifacts`**、`terminal`、`diff`）
- 现有客户端控制器：[harness-controller.ts](file:///d:/Antigravity/project/AstroLib/src/components/harness/harness-controller.ts)

> [!IMPORTANT]
> **强制工程约束（防止 God Controller 膨胀反弹）**：
> `harness-controller.ts` 当前已达 **2,596 行**。二期 **严禁** 将 PDF2ABP 面板的 DOM 渲染、SSE 订阅状态机、工作区文件浏览器逻辑继续堆入 `harness-controller.ts`！
> 必须遵循“单边界高内聚模块”原则，新增独立前端组件/控制器目录：
> - `src/components/harness/pdf2abp/pdf2abp-store.ts`（纯 TypeScript 状态机，无 DOM 依赖，可独立单测）
> - `src/components/harness/pdf2abp/pdf2abp-artifacts-panel.ts`（管理 `#harness-pane-artifacts` 内的实时面板渲染、SSE 连接与文件预览）
> - `src/components/harness/pdf2abp/pdf2abp-launcher-dialog.ts`（新任务配置与 `/health` 检测交互）
> - `harness-controller.ts` 仅保留 `<50` 行的轻量桥接：点击启动或识别任务触发时切换至 `artifacts` Tab（`this.switchInspectorTab('artifacts')`）并将任务 ID 交给新面板接管。

### 3.2 四大核心 UI 区域设计方案

遵循 `AGENTS.md` §5（极简学术出版准则：严禁分数、准确度徽章、励志标语、多余胶囊装饰）与 §6（Material Design 3 / `@material/web` 优先，拒绝自造伪开关）：

1. **任务发起与路径拾取入口**
   - 在 `HarnessStage.astro` 对话输入栏工具条“附加上下文 (`+`)”或快捷 `/` 指令中支持 `/pdf2abp`；
   - **Electron 桌面端**：通过 IPC 暴露文件选择框获取本地 PDF 真实绝对路径（Web 浏览器安全沙箱无法读取任意本地绝对路径，Web 开发态提供路径输入框并调用 `/health` 提示）；
   - 启动前自动请求 `/api/v1/pdf2abp/health`：若 `mineru.ready === false`，使用克制的 Material Error Callout 直接展示 `mineru.guidance` 并允许一键前往设置配置 Token。
2. **主控台与阶段步进栏（位于 `#harness-pane-artifacts` 顶部）**
   - **紧凑任务头**：显示源文件名、工作区目录状态、`status`（仅使用克制状态文案：`Running` / `Completed` / `Failed` / `Cancelled`）、已用时间、以及对应操作按钮（运行中展示 `<md-outlined-button>` **终止**；失败或中断展示 `<md-filled-button>` **断点续传 Resume**；完成后展示 **打开阅读器** `readerUrl` 与 **导出 .abp 目录**）。
   - **10 阶段学术步进条**：将 `init..done` 映射为线性有序节点列表，高亮当前阶段名称与最近一条阶段摘要，避免无意义的伪百分比平滑动画。
3. **主从活动流与并发子代理泳道矩阵**
   - **主代理焦点视窗（Rolling Vision Live Card）**：监听 SSE `vision_attached` 事件，在面板上方可选折叠区直接通过 `<img src="/api/v1/pdf2abp/jobs/${jobId}/file?path=${encodeURIComponent(relPath)}">` 展示主/子代理当前单图视觉槽正在审阅的原书 2×2 拼图或高清页截图，用户可直观看到模型“正在看哪一页”。
   - **子代理并发泳道（Subagent Matrix）**：渲染 `job.subagentTasks` 表格/列表：
     - 列字段：`taskId` · 页段 (`p.start-end`) · 状态（运行中 / 已完成 / 检查点跳过 / 失败） · 步数 (`stepsUsed`) · `validate_mdx` 结果 · 输出目标文件；
     - 点击任意子代理行可展开其 `anomalies`、`validationErrors`、`notes`，或直接跳转预览其产出的 `.mdx` 源码。
   - **事件流筛选器**：使用 `@material/web` `<md-chip-set>` + `<md-filter-chip>` 按 `agentId`（`全部` / `main` / `subagent:*`）或事件等级（`关键阶段与产出` / `工具调用` / `思维链` / `警告与错误`）实时过滤 `events.jsonl`。
4. **工作区本地文件树与多模态【成果物】预览器（Workspace Artifacts Explorer）**
   - 定时或随 `artifact_written` / `phase_changed` 防抖刷新 `GET /api/v1/pdf2abp/jobs/:id/files`；
   - 按语义分组折叠呈现目录（重点置顶 `book/` 校对终稿、`dist/` 已验收 `.abp`、`pages/` 拼图原页、`chunks/` 切片清单、`scripts/` Python 脚本）；
   - 点击文件调用 `GET /api/v1/pdf2abp/jobs/:id/file?path=...`：
     - `.mdx` / `.md`：提供 **源码视图** 与 **KaTeX/学术卡片预览**（复刻现有预览或调用轻量渲染）双栏/切换；
     - `.jpg` / `.png` / `.webp`：内嵌缩放看图（特别适合对比原页图与切出插图 `book/images/*`）；
     - `.json` / `.py` / `.log`：等宽语法文本展示与一键复制。

### 3.3 Electron 与 Web 书库实时联动

- Electron 主进程在 [electron/main.ts](file:///d:/Antigravity/project/AstroLib/electron/main.ts#L717-L727) 已接入 `registerElectronAbpInstaller`，当 `import_abp` 成功后会自动刷新 `DesktopLibraryManager` 缓存并向渲染进程发送 `astrolib:library-updated` IPC 消息。
- 二期前端只需：
  1. 在接收到 SSE `job_completed` 或 Electron `astrolib:library-updated` 时，刷新左侧书库列表（`desktop` 书库与 Harness 目录树 `preloadBooksCatalog()`）；
  2. 提供“在 AstroLib 阅读器中打开”按钮，直接导航至 `job.importResult.readerUrl`（如 `/reader/?book=cs-algorithms_dasgupta&chapter=01_%E5%89%8D%E8%A8%80`）。

---

## 4. 二期实施顺序与验收门禁建议

1. **Step 1（纯逻辑状态层与单测）**：实现 `pdf2abp-store.ts`（SSE 事件归并、断线重连去重 `seq`、阶段追踪、多任务切换与过滤），在 `tests/unit/` 中实现完全脱离 DOM 的状态机单元测试（校验事件乱序、重连幂等、子代理状态聚合）。
2. **Step 2（UI 组件与控制器解耦接入）**：创建 `pdf2abp-artifacts-panel.ts`、`pdf2abp-launcher-dialog.ts` 与样式文件（使用 `src/styles/harness/` 变量），最小化修改 `HarnessStage.astro` 与 `harness-controller.ts`（`harness-controller.ts` 行数不得明显膨胀）。
3. **Step 3（多端联调与契约验收）**：
   - Web Dev 端（`astro dev --background`）启动并完成 UI 交互、SSE 断点续传、工作区 MDX/图片预览、导入后即时跳转阅读器；
   - Electron 端完成 `npm run check:types`、`node scripts/build-electron.mjs`、`npm test` 全绿后验证原生文件选择器、重启恢复历史任务与 `astrolib:library-updated` 书库自动刷新。
