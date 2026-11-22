# AstroLib 桌面端多 Fragment SPA 架构与 Win11 任意分屏系统交接文档

> **文档版本**：v1.0.0  
> **编写日期**：2026-11-11  
> **核心归属**：AstroLib 桌面端工程团队（Electron / M3 UI / Universal Reader）  
> **适用范围**：桌面端架构师、前端工程师、学术排版设计与运维人员

---

## 1. 架构演进背景与设计目标

### 1.1 演进背景
在先前的版本中，AstroLib 桌面端主要采用单页 Reader Shell 承载教材阅读，存在以下痛点：
1. **单一内容形态局限**：原架构重度绑定已预编译的教材（ABP 内容包），未能将学术论文/PDF 文献（MinerU 提取成果）纳入第一公民体系；
2. **缺乏多任务对照能力**：学者研读理工科高阶教材或文献时，往往需要“两书对照”、“一书一文对照”或“多篇论文并列比对”；
3. **垂直阅读面积被挤压**：传统浏览器式顶栏占据了宝贵的屏幕垂直高度，在 16:9 或 16:10 笔记本屏幕上正文展示空间受促；
4. **无 CSS 裸露与性能浪费**：Astro 编译期 scoped CSS 无法作用于客户端 JavaScript 动态生成的 DOM 元素（产生“裸 CSS”现象）；且分屏时因缺乏状态管理产生了 4 份相同 iframe 的冗余加载。

### 1.2 核心设计目标
1. **统一实体抽象（Unified Reading Entity）**：将教材著作（ABP）与学术论文（PDF + MinerU Markdown）抽象为同级一等公民；
2. **三段式多 Fragment SPA 框架**：
   - **导航轨（Navigation Rail）**：左侧 76px M3 标准竖向导航轨；
   - **Fragment 1（纵览大厅）**：嵌入 Google 官方 `lottie-web` 矢量动画（`webservice.json`），呈现 Agent 体系；
   - **Fragment 2（研读书库）**：严格对齐 Google Play 图书 Web 端规范，包含二级分类抽屉、学科过滤 Chip、3:4 实体书封卡片与统一摄取上传管线；
   - **Fragment 3（研读视窗）**：Windows 11 风格任意分屏（1x1 / 1x2 / 2x1 / 2x2），底部 Chrome 风格多标签栏（支持一键折叠），实现零边距、零冗余阴影的沉浸式研读；
3. **极简主义与内容优先**：“The Content is the Interface”，剔除所有与内容无关的窗口边框与多余操作条，窗口间仅保留 1px 细线；分屏狭窄时自动收拢次级侧栏。

---

## 2. 核心架构与模块设计

### 2.1 整体分层架构

```
┌────────────────────────────────────────────────────────────────────────┐
│                        AstroLib Desktop Shell                          │
│ ┌───────────────┬────────────────────────────────────────────────────┐ │
│ │ Navigation    │ Fragment Viewport Stage                            │ │
│ │ Rail (76px)   │                                                    │ │
│ │               │  ┌──────────────────────────────────────────────┐  │ │
│ │ 1. 纵览大厅    │  │ Fragment 1: Agent Overview (Lottie Motion)   │  │ │
│ │               │  └──────────────────────────────────────────────┘  │ │
│ │ 2. 研读书库    │  ┌──────────────────────────────────────────────┐  │ │
│ │               │  │ Fragment 2: Academic Library (Google Play)   │  │ │
│ │ 3. 研读视窗    │  └──────────────────────────────────────────────┘  │ │
│ │    (角标)     │  ┌──────────────────────────────────────────────┐  │ │
│ │               │  │ Fragment 3: Any-Split Reader (Win11 Grid)    │  │ │
│ │ ⚙️ 系统设置    │  │  - Zero Margin 1px Split Grid (1/2/4 Panes)  │  │ │
│ │               │  │  - Bottom Collapsible Chrome Tabs Dock       │  │ │
│ │               │  └──────────────────────────────────────────────┘  │ │
│ └───────────────┴────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```

### 2.2 统一研读实体模型 (`UnifiedReadingEntity`)

为了破除教材与文献的系统壁垒，定义了全系统通用的研读实体数据契约（[`src/types/library-entity.ts`](file:///d:/Antigravity/project/AstroLib/src/types/library-entity.ts)）：

```typescript
export type ReadingEntityKind = 'book' | 'paper' | 'slide' | 'video';

export interface UnifiedReadingEntity {
  id: string;                      // 唯一实体标识 (例如 book:math-graph_theory 或 paper:task_xxx)
  kind: ReadingEntityKind;         // 实体种类：book (教材) / paper (文献) / slide (课件) / video (视频)
  title: string;                   // 标题 (自动去除 .pdf 等后缀)
  subtitle?: string;               // 副标题/所属类别
  author?: string;                 // 著者/解析归属
  publisher?: string;              // 出版社/文献库
  cover: string;                   // 封面地址
  category: string;                // 学科分类 (math, physics, cs, telecom, paper)
  shelfId?: string;                // 自定义书架 ID
  createdAt: number;               // 创建/摄取时间戳
  lastReadAt?: number;             // 最近研读时间戳
  readProgress?: number;           // 研读进度 (0 - 100)
  status: 'ready' | 'processing' | 'error';
  statusMessage?: string;          // 状态提示 (如 "MinerU 解析中 45%")
  metadata: {
    // 教材专属属性
    colSlug?: string;
    bookSlug?: string;
    entryPoint?: string;
    abpPackPath?: string;
    // 文献专属属性
    taskId?: string;
    originPdfUrl?: string;
    markdownUrl?: string;
    totalPages?: number;
    fileSizeBytes?: number;
  };
}
```

---

## 3. 三大 Fragment 核心实现规范

### 3.1 Fragment 1: Agent 纵览大厅 (`FragmentOverview.astro`)
- **Lottie 动效组件**：基于官方 `lottie-web` 构建轻量声明式组件 [`src/components/m3/M3Lottie.astro`](file:///d:/Antigravity/project/AstroLib/src/components/m3/M3Lottie.astro)；
- **资源托管**：动效资产置于 `public/assets/lottie/webservice.json`；
- **低碳渲染**：离开该 Fragment 时自动暂停动画渲染循环，切回时恢复，杜绝后台 CPU 浪费。

### 3.2 Fragment 2: 学术研读书库 (`FragmentLibrary.astro`)
- **Google Play 图书排版范式**：
  - **左侧书架抽屉**：内置“全部资源”、“教材著作”、“文献论文”及预留的“幻灯片”、“研讨视频”；支持用户一键新建自定义书架；
  - **顶栏交互**：Filter Chips 学科筛选、实时关键字搜索框、视图模式切换（网格 / 列表）、最新/进度排序；
  - **3:4 实体书封卡片**：实体书封采用标准 3:4 纵横比，配合轻量 Elevation 与悬浮动效；论文采用带有学术徽标的专属自适应封面；
  - **全局样式解耦**：所有样式收敛至 [`src/styles/desktop/library.css`](file:///d:/Antigravity/project/AstroLib/src/styles/desktop/library.css)，解决 Astro 动态 DOM 注入导致的“裸 CSS”缺陷；
- **全自动摄取与解析管线**：
  - 支持直接拖入/上传 `.abp` 离线教材包，自动解压入库；
  - 支持上传 `.pdf` 学术文献，自动派发至 MinerU API，且支持无 Token 时降级至 Agent 免密解析；
  - 具备 5 分钟超时保护、失败状态拦截（红色横幅）与任务轮询。

### 3.3 Fragment 3: 研读视窗与 Win11 任意分屏 (`FragmentReaderHost.astro`)
- **底部标签页栏（Bottom Chrome-Style Dock）**：
  - 标签页栏置于视口最底部，支持 Chrome 风格标签切换与关闭；
  - 具备折叠把手与折叠按钮，折叠后仅保留底部中央微型把手，将整个视口垂直高度全额交还正文；
- **极简分屏网格（Win11 Any-Split Grid）**：
  - 支持 **1x1（单屏沉浸）**、**1x2（左右双屏对照）**、**2x1（上下双屏对照）**、**2x2（四象限分屏矩阵）**；
  - **零边距、零冗余阴影**：彻底删除了每个窗格内部的“视窗 1/2/3/4”栏头、下拉选择器与内框阴影，窗口之间仅以 1px 细线分隔；
  - **防重复性能优化**：分屏时严禁把同一本书重复加载 4 份；若无额外打开的标签页，辅助窗格展示轻量的 `.pane-empty-slot`（“选择对照研读内容”），点击后可跳转书库定向挑选并挂载，杜绝多重 iframe 性能损耗；
  - **Win11 风格拖拽分屏**：标签页自带 `draggable`，可直接拖入任意分屏窗格以独立呈现；
  - **分屏狭窄空间自适应**：双栏研读器在分屏宽度受限时（`< 1080px`），自动隐藏左侧书签与右侧批注抽屉，优先保证原文与公式阅读。

---

## 4. 各文件职责与系统边界对照表

| 文件路径 | 模块归属 | 核心职责与边界说明 |
| :--- | :--- | :--- |
| [`src/pages/desktop.astro`](file:///d:/Antigravity/project/AstroLib/src/pages/desktop.astro) | Desktop Shell | 桌面端主入口 SPA 页面，调度 3 大 Fragment；包含 Google Sans 400 顶栏拖拽安全区（避让 Windows 原生三键 140px）。 |
| [`src/components/desktop/NavigationRail.astro`](file:///d:/Antigravity/project/AstroLib/src/components/desktop/NavigationRail.astro) | UI Shell | M3 标准 76px 竖向导航轨，提供纵览、书库、研读视窗（带活跃标签计数角标）与设置入口。 |
| [`src/components/desktop/FragmentOverview.astro`](file:///d:/Antigravity/project/AstroLib/src/components/desktop/FragmentOverview.astro) | Fragment 1 | Agent 纵览大厅，挂载 `M3Lottie` 动画，低碳暂停/恢复机制。 |
| [`src/components/desktop/FragmentLibrary.astro`](file:///d:/Antigravity/project/AstroLib/src/components/desktop/FragmentLibrary.astro) | Fragment 2 | 学术研读书库，对齐 Google Play 图书规范；管理教材/文献数据流，处理文件上传与 MinerU 解析。 |
| [`src/components/desktop/FragmentReaderHost.astro`](file:///d:/Antigravity/project/AstroLib/src/components/desktop/FragmentReaderHost.astro) | Fragment 3 | Chrome 风格底部标签栏与 Win11 任意分屏宿主；管理 iframe 挂载、拖拽分屏与空插槽调度。 |
| [`src/styles/desktop/library.css`](file:///d:/Antigravity/project/AstroLib/src/styles/desktop/library.css) | Global Style | 书库全局样式表（分类抽屉、3:4 书封网格、上传通知条等），杜绝动态 DOM 样式脱轨。 |
| [`src/styles/desktop/reader-host.css`](file:///d:/Antigravity/project/AstroLib/src/styles/desktop/reader-host.css) | Global Style | 研读视窗与分屏全局样式表（底部标签 Dock、1px 细线 Grid、空插槽占位、折叠动画等）。 |
| [`src/components/m3/M3Lottie.astro`](file:///d:/Antigravity/project/AstroLib/src/components/m3/M3Lottie.astro) | M3 Core | 声明式 Lottie Web 播放器组件，支持通过 props 传入 JSON 路径、循环与自动播放配置。 |
| [`src/types/library-entity.ts`](file:///d:/Antigravity/project/AstroLib/src/types/library-entity.ts) | Domain Model | 统一研读实体（`UnifiedReadingEntity`）、书架（`LibraryShelf`）、标签项（`TabItem`）及分屏枚举类型契约。 |
| [`src/pages/workspace/literature-reader.astro`](file:///d:/Antigravity/project/AstroLib/src/pages/workspace/literature-reader.astro) | Reader View | 学术文献双栏研读器页面（左 PDF 原文，右结构化 Markdown + KaTeX 公式），供 iframe 嵌入。 |
| [`src/pages/workspace/literature-reader.css`](file:///d:/Antigravity/project/AstroLib/src/pages/workspace/literature-reader.css) | Reader Style | 文献研读器样式规范，包含分屏狭窄视口自适应规则（自动隐藏次级抽屉）。 |
| [`electron/services/library-manager.ts`](file:///d:/Antigravity/project/AstroLib/electron/services/library-manager.ts) | Electron Core | 桌面端统一书库服务单例，聚合已安装 ABP 书籍与 MinerU 文献任务，提供 IPC 桥接。 |
| [`src/server/plugins/library/dev-server-plugin.mjs`](file:///d:/Antigravity/project/AstroLib/src/server/plugins/library/dev-server-plugin.mjs) | Local Server | 本地 HTTP API 中间件（`/api/library/*`），同时服务于 Web 模式与 Electron 嵌入式服务。 |
| [`electron/server/local-server.ts`](file:///d:/Antigravity/project/AstroLib/electron/server/local-server.ts) | Electron Core | 本地嵌入式 Node HTTP 引擎（端口 62960），挂载所有 API 插件与静态资源分发。 |

---

## 5. 关键问题与修复记录 (Post-Mortem & Fixes)

### 5.1 顶栏 Google Sans 字体与字重治理
- **现象**：原顶栏字重过大、有粗厚感，且带有调试性的 `[DESKTOP PRO]` 标签。
- **修复**：
  1. 在 `desktop.astro` 的 `<head>` 中引入 Google Sans 官方字体源；
  2. 样式调整为 `font-family: 'Google Sans', ...; font-weight: 400; letter-spacing: -0.01em;`；
  3. 彻底删除 `[DESKTOP PRO]` 徽章及标题后缀。

### 5.2 动态注入 DOM 导致的“裸 CSS”问题
- **现象**：在客户端 JavaScript 执行 `innerHTML` 插入书架分类和书卡时，所有样式失效。
- **修复**：
  1. 查明原因：Astro 编译 scoped CSS 时，css 选择器被转译为 `.subnav-item[data-astro-cid-xxxx]`，而 JS 动态创建的节点缺少该属性；
  2. 彻底将组件局部 scoped style 迁移为独立全局样式表 `library.css` 与 `reader-host.css`；通过 Astro 构建时打包入产物，DOM 节点直接匹配 class 类名，样式表现规整。

### 5.3 文献上传陷入“永久解析中无报错”问题
- **现象**：上传 PDF 后横幅永久显示“PDF 上传成功，MinerU 正在解析中...”，既无进度更新亦无错误提示。
- **修复**：
  1. 字段对齐：上传服务端返回 `task.taskId`，而前端读取了 `task.id` 导致传入解析与轮询的 `taskId` 为 `undefined`；代码已全量更正为 `(task.taskId || task.id)`；
  2. 轮询异常拦截：在 `fetch('/api/ingest/status')` 中加入 `res.ok` 与错误码判断，解析失败时提取 `task.error` 并以标红横幅提示用户 8 秒；
  3. 超时保护：轮询超过 5 分钟自动终止定时器并提示超时，避免内存泄漏；
  4. 免密降级：未检测到 Token 时，自动降级至 MinerU Agent 免密通道。

### 5.4 切换分屏导致同一本书复制 4 份的性能浪费
- **现象**：在只有 1 本书被打开的情况下切换至 2x2 分屏，4 个窗格全部加载相同的书本，CPU 与内存开销翻倍。
- **修复**：
  1. 重写 `autoAssignPanes`：主窗格保持当前书目，辅助窗格通过 Set 集合排重分配未绑定的不同标签；
  2. 若已打开的标签数不足，辅助窗格显式赋值为 `null`；
  3. 渲染期对 `null` 窗格挂载 `.pane-empty-slot` 占位引导，不渲染任何 iframe；用户可随时点击引导挑选其他文献/教材填补对照空间。

---

## 6. 验证流程与打包流水线

### 6.1 质量门禁验证

```bash
# 1. 严格 TypeScript 类型检查 (必须 0 errors)
npm run check:types

# 2. 核心单元测试、契约测试与层级规范测试
npx vitest run tests/unit/library-entity.test.ts tests/contract/window-layers.test.ts

# 3. 动态内容分发验收测试
npx vitest run tests/acceptance/abp-dynamic-serving.test.ts
```

### 6.2 桌面端构建与免安装包发布

```bash
# 1. 编译 Astro 静态路由与前端资产 (输出至 dist/)
node node_modules/astro/bin/astro.mjs build

# 2. 编译 Electron 主进程与 Preload 脚本 (输出至 dist-electron/)
node scripts/build-electron.mjs

# 3. 生成 Windows 绿色免安装版 (无需管理员权限，即解即用)
powershell -Command "Get-Process -Name '*AstroLib*' -ErrorAction SilentlyContinue | Stop-Process -Force; npx electron-builder --dir"
```

打包产物位于：
`release/win-unpacked/AstroLib.exe`（大小约 249 MB，内置 Chromium 132、Node 20 与嵌入式 HTTP 引擎）。

---

## 7. 后续演进建议与注意事项

1. **幻灯片（Slides）与研讨视频（Videos）**：
   `UnifiedReadingEntity` 已预留 `'slide'` 与 `'video'` 类型枚举，在后续版本中可在 `FragmentLibrary.astro` 中解除 `subnav-item--disabled` 禁用状态，挂载相应的多模态播放组件；
2. **标签状态持久化**：
   目前 `TabItem[]` 存储于页面内存中，若需要应用重启后恢复标签页状态，可通过 `ipcRenderer.send('astrolib:save-tabs')` 将标签序列化写入用户目录下的 `settings.json`；
3. **分屏比例拖拽调节**：
   当前网格为等分网格（`1fr 1fr`）。未来可结合 Split.js 或 CSS 拖拽把手（Gutter）实现两栏比例自定义调节（如 60%/40%）。
