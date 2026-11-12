# AstroLib 开发与架构文档中心

本文档目录收录了 AstroLib（面向大学理工科教材与学术资料的数字化阅读与自测系统）的开发指南、贡献规程与核心架构设计交接文档。

---

## 1. 核心开发与贡献指南

### 1.1 概览
- [**项目概览**](./01-overview.md)：系统定位与 6 大核心优势（Material You 排版、印刷级 LaTeX 导出、离线 EPUB3 打包、配套习题册、跨页知识网络、Agent MCP 工具链融合 AI 问答）。

### 1.2 快速入门
- [**doc1: 本地部署与运行**](./quickstart/01-deployment-and-running.md)：运行环境要求、依赖安装、前台/后台守护开发服务启动与生产打包预览。
- [**doc2: 脚本列表与说明**](./quickstart/02-all-runnable-scripts.md)：全站 npm 命令速查与 `scripts/` 构建、校验、抽取工具分类说明。
- [**doc3: 添加新书**](./quickstart/03-add-new-book.md)：目录规范、MDX 章节结构、语义卡片使用准则、中央书库注册与语法校验。
- [**doc4: 加入习题册**](./quickstart/04-add-exercise-booklet.md)：题目数据 Schema 规范、KaTeX 预编译流水线、章节触发器挂载与验证。
- [**doc5: Electron 桌面端与 ABP 离线分发**](./Electron桌面端与ABP离线分发系统交接文档.md)：框架与内容解耦架构、ABP 标准内容包格式、Universal Reader 动态页面合成引擎、状态持久化与免安装桌面版编译。

### 1.3 贡献指南
- [**doc1: 贡献新书：AI 数据清洗**](./contributing/01-contribute-book-ai-cleaning.md)：以扫描原图为唯一真实源，利用 Gemma 4 26B 与 Gemini 3.5 Flash Lite 进行视觉重构；附生产级脚本与 Prompt 模版。
- [**doc2: 贡献勘误**](./contributing/02-contribute-errata.md)：使用内置工具进行教材正文一键选行勘误（`Alt+F`）与真题题库题目报错。
- [**doc3: 贡献 AI 题解**](./contributing/03-contribute-ai-solutions.md)：调用本地模型生成规范推导、审阅与多端对照，并将高质量题解共享至社区题库。

### 1.4 附加说明
- [**doc1: AI 模型 API Key 申请与配置**](./advanced/01-ai-api-keys-setup.md)：Google Gemini（含代理环境说明）、DeepSeek（国内直连）及自定义 OpenAI 兼容端点配置。
- [**doc2: MCP 工具链与 RAG 架构**](./advanced/02-mcp-and-rag-deep-dive.md)：基于 Model Context Protocol 的 8 个端侧工具规格与抗幻觉证据链工作原理。
- [**doc3: 环境配置与常见问题**](./advanced/03-local-env-setup-troubleshooting.md)：Windows 脚本策略、sharp 镜像源、Git 换行符与 Node 内存配额排坑。
- [**doc4: MDX 编辑模式与模块检查**](./advanced/04-developer-mode-and-inspection.md)：基于 Vite 的浏览器双向源码回写与全书模块结构健康度检查。
- [**doc5: Git 提交规范与代码同步**](./advanced/05-academic-git-and-dual-push.md)：学术级 Commit Specification 约束与双轨自动脱敏推送流水线。
- [**doc6: 自动化测试套件与类型守卫架构**](./自动化测试套件与类型守卫架构交接文档.md)：现代四层测试金字塔（Unit / Contract / Acceptance / System）、TypeScript 严格类型覆盖（0 错误门禁）与 CI/CD 自动化流水线。

---

## 2. 核心架构与专项技术交接

> [!NOTE]
> 下表中的早期专项交接文档（如 `src/content/docs/collections/`、`public/abp-packs/` 相关描述）保留作为**历史归档参考，不再作为当前桌面端（`electron/main`）的执行指令**；当前权威架构与门禁基线请以 `ADR-DISTRIBUTION-2026-11-12.md` 与 `STAGE_REVIEW_AND_EXECUTION_GATES_2026-11-12.md` 为准。

| 文档名称 | 核心主题与说明 | 关联代码模块 |
| :--- | :--- | :--- |
| [ADR-DISTRIBUTION-2026-11-12.md](./architecture/ADR-DISTRIBUTION-2026-11-12.md) | **桌面端书籍内容发行契约决策（Gate G0，2026-11-12）**：正式拍板采用**模式 A（零内置书 Shell + GitHub Releases 同步发布 `.abp` 与 `catalog.json` + 本地导入兜底）**，明确模式 B 为 `NOT ACTIVE`，固化 13 本首发书单、体积预算（`win-unpacked ≤ 600 MB` / `app.asar ≤ 200 MB`）与 `electron-release.yml` 目标产物清单。 | `package.json`<br>`.github/workflows/electron-release.yml`<br>`electron/services/` |
| [STAGE_REVIEW_AND_EXECUTION_GATES_2026-11-12.md](./architecture/STAGE_REVIEW_AND_EXECUTION_GATES_2026-11-12.md) | **阶段报告复核与下一阶段执行/审计门禁（2026-11-12）**：逐项核对执行 Agent 阶段报告；确认桌面包体、ABP exercises、发行契约、干净 clone、SSOT、测试空跑、PWA/文档/工具链等未完成项；给出 G0–G5 边界、验收命令、证据要求与执行日志模板。 | `package.json`<br>`electron/`<br>`scripts/pack-book-abp.mjs`<br>`src/config/collections.config.ts` |
| [PROJECT_ARCHITECTURE_AUDIT_2026-11-12.md](./architecture/PROJECT_ARCHITECTURE_AUDIT_2026-11-12.md) | **当前架构全面审计与破坏性重构建议（2026-11-12）**：双轨运行态、内容 SSOT 四分五裂、Web 阅读路由缺失、ABP slug 95.5% 不一致、书库五套实现、五套内容转换器、构建链空转、发布包依赖未跟踪产物；附逐文件冗余总账、目标架构、分阶段迁移路线与验收指标。 | `src/config/`<br>`src/pages/`<br>`src/services/content-provider/`<br>`electron/`<br>`scripts/` |
| [Electron多Fragment研读架构与Win11任意分屏系统交接文档.md](./Electron多Fragment研读架构与Win11任意分屏系统交接文档.md) | **桌面端多 Fragment SPA 架构与 Win11 任意分屏**：统一研读实体模型（教材与文献同级第一公民）、三段式 Fragment 调度器、Lottie 动效大厅、Google Play 规范研读书库与自动解析摄取管线、底部可折叠 Chrome 标签栏、Windows 11 风格 1px 细线 0 边距分屏网格、拖拽分屏交互与防重复 iframe 性能优化。 | `src/pages/desktop.astro`<br>`src/components/desktop/`<br>`src/styles/desktop/`<br>`src/types/library-entity.ts`<br>`electron/services/library-manager.ts` |
| [Electron桌面端与ABP离线分发系统交接文档.md](./Electron桌面端与ABP离线分发系统交接文档.md) | **Electron 桌面端与 ABP 离线分发**：零硬编码图书解耦架构、ABP Schema 1.0.0 规范、Universal Reader 动态页面合成引擎（多书导航树、M3 模块折叠大纲、KaTeX/GFM 预渲染、折叠解题与数字资源）、防闪烁设置持久化同步、无边框三键避让与免安装便携版打包。 | `electron/`<br>`src/services/content-provider/`<br>`scripts/pack-book-abp.mjs`<br>`public/abp-packs/` |
| [双语段落语义对齐系统与真实教材教学逻辑重构交接文档.md](./双语段落语义对齐系统与真实教材教学逻辑重构交接文档.md) | **双语段落语义对齐与教材逻辑重构**：本页内联 50%-50% 学术等宽排版对照、ONNX Runtime Node CPU/AVX2 轻量量化嵌入推理服务、二分图最优双向匹配、中缝贝塞尔曲线连线、高保真学术相关矩阵（Heatmap）、侧栏状态记忆与无损复原、Material You 动态主题色适配，以及真实教材（DPV 2.6 FFT 等）教学逻辑错位重构范式。 | `src/services/bilingual/`<br>`src/server/plugins/bilingual-aligner/`<br>`src/components/bilingual/`<br>`src/content/docs/collections/cs/algorithms/` |
| [自动化测试套件与类型守卫架构交接文档.md](./自动化测试套件与类型守卫架构交接文档.md) | **自动化测试套件与类型守卫**：四层测试金字塔（Vitest 20套测试/72用例全部绿灯）、TypeScript 严格类型覆盖（100% 0 errors）、彻底清理 14 个历史碎片脚本与 GitHub Actions CI 质量门禁。 | `tests/`<br>`.github/workflows/ci.yml`<br>`src/types/` |
| [Material-You主题改造交接文档.md](./Material-You主题改造交接文档.md) | **UI/UX 核心设计规范**：优先官方 `@material/web` 组件、Filter Chips、Outlined Text Field、无边框 Filled Tonal 卡片与学术排版准则。 | `src/themes/material-you/`<br>`src/components/FeatureToggles.astro` |
| [AI问答Material-You重构与设置收敛交接文档.md](./AI问答Material-You重构与设置收敛交接文档.md) | **AI 问答交互架构**：Harness 调用树收敛、公式原生排版、三向自由缩放、设置项收拢与 M3 胶囊输入。 | `src/ai/client/chat-controller.ts`<br>`src/ai/ai-config.ts` |
| [侧载系统架构与扩展交接文档.md](./侧载系统架构与扩展交接文档.md) | **Sideload Dock 侧载底座**：大纲、习题、AI 统一宿主、SideloadManager 单例状态机与多视口自适应联动。 | `src/components/sideload/`<br>`src/components/PageSidebarOverride.astro` |
| [特性模块与插件系统.md](./特性模块与插件系统.md) | **Feature Registry 架构**：功能统一声明、构建期动态装配与零打包开销控制。 | `src/config/features.config.mjs`<br>`astro.config.mjs` |
| [AI 赋能模块设计.md](./AI%20赋能模块设计.md) | **AI 工具链与 RAG 规范**：全量 8 个端侧 MCP 工具定义、Prompt 串联链条与请求处理流。 | `src/ai/mcp/`<br>`src/ai/tools-client.mjs` |
| [文章切换性能优化交接文档.md](./文章切换性能优化交接文档.md) | **跨页引用与 SPA 性能**：正文引用徽章从客户端识别下沉至编译期 Rehype 插件的技术细节。 | `src/utils/rehype-cross-ref.mjs` |
| [精修工具交接.md](./精修工具交接.md) | **在线 MDX 可视化精修**：源码位置 AST 标记注入与 Vite 开发服务器写回端点设计。 | `src/utils/mdx-editor/` |
| [模块查重与巡检工具.md](./模块查重与巡检工具.md) | **全书模块巡检与查重**：模块集中索引、同章查重与异常拆分定位。 | `src/utils/module-inspector/` |
| [大邮数学集题库结构化与分章习题交接文档.md](./大邮数学集题库结构化与分章习题交接文档.md) | **真题题库抽取与分章习题**：173 套试卷结构化解析、LaTeX 公式平衡与分章自测页集成。 | `scripts/lib/math_archive/`<br>`src/data/exercises/` |
| [Gemma4原书扫描全视觉推倒重建与全书构建流水线交接文档.md](./Gemma4原书扫描全视觉推倒重建与全书构建流水线交接文档.md) | **原书全视觉推倒重建流水线**：以原书 PDF 物理扫描页为 Ground Truth，采用 `gemma-4-26b-a4b-it` 进行流式端到端视觉重构与验证体系。 | `scripts/vision_reconstruct/`<br>`src/content/docs/collections/math/` |
| [工科数学分析基础原书逐页精修改正与对齐交接文档.md](./工科数学分析基础原书逐页精修改正与对齐交接文档.md) | **《工科数学分析基础》原书逐页精修改正与对齐交接**：马知恩、王绵森经典教材全书逐页高保真重构规范。第一章（1.1~1.5）100% 验收战果、上册物理页码映射公式（$P_{\text{phys}} = P_{\text{book}} + 17$）、7 种常见 OCR 缺陷排坑宝典、后续章节任务矩阵与六步闭环 SOP。 | `src/content/docs/collections/math/engineering_analysis/`<br>`test/data/ch1_pages/` ~ `test/data/ch7_pages/` |
| [线性代数与几何原书视觉数字化重构与导入交接文档.md](./线性代数与几何原书视觉数字化重构与导入交接文档.md) | **《线性代数与几何（第2版）》视觉重构与导入交接**：北京邮电大学精品教材全书 239 页物理映射、已完成章节（前言、第1章全章、第2章前2节、第3章全章、第4章全章）、未竟小节断点与出版级规范。 | `src/content/docs/collections/math/linear_algebra_geometry/`<br>`scripts/vision_reconstruct/` |
| [线性代数与几何题库结构化与分章习题交接文档.md](./线性代数与几何题库结构化与分章习题交接文档.md) | **《线性代数与几何（第2版）》课后习题与参考答案题库交接**：全书 9 章 253 道课后习题与书末参考答案的物理页码映射矩阵、标准 JSON 题库 Schema 规范、全站题库注册与分步实施 SOP。 | `src/data/exercises/`<br>`src/config/exercise-banks.config.ts` |
| [图论原书第五版剩余章节校对与子代理分派交接文档.md](./图论原书第五版剩余章节校对与子代理分派交接文档.md) | **《图论（原书第五版）》剩余章节校对与子代理分派交接**：第 8 章与附录 B 黄金标杆示范、Part 2 物理原页切片资产矩阵（第 9~12 章及附录 A）、轻量级子代理极简分派协议（纯净双动词、禁用命令、单节定额）、五大核心质量防御红线及全真编译验收 SOP。 | `content-sources/collections/math/graph_theory/`<br>`scripts/pack-book-abp.mjs`<br>`public/abp-packs/math-graph_theory.abp` |

---

## 3. 历史归档说明 (Archive)

- **主题体系优化**：早期冗余主题体系（VitePress / Starlight）相关历史文件已彻底移除。当前全站统一以 Google Material Design 3 (Material You / Expressive) 为唯一 UI/UX 标准，组件库统一基于 `@material/web` 与 `@m3e/web`，图标统一遵循 Google Material Symbols 官方标准。详见 `AGENTS.md` 第 6 节。
