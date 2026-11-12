# Antigravity / Agent Workspace Rules for AstroLib (my-astro-site)

## 1. Development & Server Management

When starting the dev server, always use background mode:
```bash
astro dev --background
```

Manage the server using dedicated commands (or via `node node_modules/astro/bin/astro.mjs dev ...` if `astro` is not in PATH):
- `astro dev status` - Check server status and port
- `astro dev logs` - View real-time log outputs
- `astro dev stop` - Safely stop the server using PID lockfile (`.astro/dev.json`)

## 2. Core Architecture Rules & Constraints

### 2.1 Central Architecture Invariants (The 10 Tenets)

1. **Rule 1 — UI is not a domain model**:
   `components/` must NEVER serve as the source of domain data models or type definitions for other systems. Shared models/types belong in dedicated models/types layers.
2. **Rule 2 — Publishing is independent**:
   Publishing and export systems (LaTeX / Typst / EPUB / PDF) must NOT depend on UI components or client controllers. They must remain pure, headless compilers/formatters.
3. **Rule 3 — Source of Truth**:
   Any generated data must NEVER become a Source of Truth. `collections.config.mjs`, `features.config.mjs`, and raw input texts/databases are sources of truth.
4. **Rule 4 — Generated Data**:
   All regenerable data (indices, pre-rendered JSON, topology graphs) must explicitly indicate its generator script and source input.
5. **Rule 5 — Public Directory Hygiene**:
   `public/` is strictly reserved for static assets directly served to the browser.
   Strictly forbidden in `public/`:
   - Test outputs (`test_*.pdf`, `test_*.tex`, `test_*.typ`)
   - Compiler artifacts and intermediate build files (`*.aux`, `*.idx`, `*.mst`)
   - Logs (`*.log`)
   - Temporary files
6. **Rule 6 — Feature Isolation**:
   The primary logic of a business feature (UI, state, client logic, and feature configs) should reside within that feature's cohesive boundary.
7. **Rule 7 — Utils Purity**:
   Do NOT add new modules with explicit business semantics to `utils/`.
   Code belonging to AI, Exercise, Editor, Publishing, Inspector, Relation Graph, or Feedback must go to its corresponding Feature / Service. `utils/` is reserved strictly for pure, stateless, reusable helpers.
8. **Rule 8 — Scripts Boundary & Test Architecture**:
   `scripts/` is exclusively responsible for build, import, export, and maintenance automation. Business runtime logic must NOT depend on `scripts/`. Automated tests are strictly housed in `tests/` driven by Vitest across a 4-tier test pyramid.
9. **Rule 9 — Runtime must not mutate source**:
   Development servers, Vite plugins, and runtime endpoints must NEVER directly mutate Source Data on disk (e.g. overwriting tracked JSONs or executing synchronous shell scripts).
10. **Rule 10 — Small Migrations (No Big Bang Rewrite)**:
    Architectural refactoring must strictly follow:
    > **one boundary → one migration → one verification**
    Big Bang Rewrites are strictly prohibited.

### 2.2 Operational Constraints

- **Single Sources of Truth**: `src/config/collections.config.ts` (books/collections) and `src/config/features.config.ts` (Feature Registry). ⚠️ `src/config/books.config.mjs` is obsolete.
- **Routing & Clean Slugs**: Every generated link pointing to a book chapter MUST use `cleanSlug()` from `src/utils/sidebar.ts`. Never hardcode raw filenames into URL strings.
- **Testing & Quality Gates**: Prior to committing changes, always run `npm run check:types` (100% strict TypeScript 0 errors) and `npm test` (Unit, Contract & Acceptance test suites). Full verification: `npm run check:all`.
- **MDX Syntax Validation**: Run `node scripts/scan-mdx.mjs src/content/docs/collections/<collection>/<book>` before committing.
- **Sidebar & Performance**: Left sidebar renders only current book (`SidebarOverride.astro`). KaTeX uses `output: 'html'`.

## 3. Project Skills & Documentation

Refer to workspace skills located in `.agents/skills/` for detailed multi-step guides:
- `astro-project-guide` (`.agents/skills/astro-project-guide/SKILL.md`): Architecture, card components & MDX authoring.
- `import-book` (`.agents/skills/import-book/SKILL.md`): End-to-end MinerU OCR to MDX conversion procedure.
- `academic-content-pipeline` (`.agents/skills/academic-content-pipeline/SKILL.md`): Six-stage multi-agent pipeline for textbook typesetting, worksheet generation, and publishing QA.
Technical design and handover docs are indexed in [docs/README.md](file:///E:/0000work/prep_project/my-astro-site/docs/README.md).

## 4. Git Commit & Distribution Standards

### 4.1 Academic & Restrained Commit Specification (Mandatory)

All Git commits must strictly follow the **Academic Restrained Conventional Specification**:
- **English Only**: Commit summaries and bodies MUST be written in academic, concise English (ASCII only). No Chinese commit messages.
- **No Emojis**: Emojis (e.g. 🚀, ✨, 🔥, 🎉) are strictly forbidden.
- **Restrained & Objective Tone**: Strictly avoid AI hype or marketing buzzwords (`revolutionary`, `super powerful`, `blazing fast`, `seamlessly`, `all-in-one`). Describe *what* was changed and *why* in imperative mood.
- **Format**: `<type>(<scope>): <imperative summary>`
  - Allowed types: `feat`, `fix`, `perf`, `refactor`, `docs`, `style`, `chore`, `test`, `release`, `ci`, `build`
  - Valid scopes: `(content)`, `(katex)`, `(ui)`, `(ai)`, `(epub)`, `(sidebar)`, `(header)`, `(render)`, `(editor)`, `(ci)`, `(core)`
  - Examples:
    - `feat(content): import linear algebra textbook and chapter exercises`
    - `fix(layout): prevent math formula overflow on mobile viewport`
    - `perf(render): pre-render heading formulas during build time`
    - `refactor(sidebar): decouple book traversal from state manager`
    - `chore(ci): configure automated EPUB release pipeline`

### 4.2 Dual-Repository Distribution Rules

1. **Local & Private Commits Keep Full Comments**:
   - ⚠️ Local working tree and private commits retain all explanatory code comments.
2. **Public Repository Strips Comments Automatically**:
   - To prevent outdated comments from confusing external agents, public distributions (`origin`) must have code annotations stripped.
   - Always push via the sandbox stripping pipeline, never run bare `git push origin`:
     ```bash
     npm run push:clean
     ```
3. **Zero Agent / Skill Leakage**:
   - `.agents/`, `.dsh/`, `.codex/`, `.cmd`, `CLAUDE.md`, and IDE assistant skills are strictly local development assets, ignored by Git, and automatically stripped from public distributions.
4. **Private Repository (Full Annotations Backup)**:
   ```bash
   npm run push:private
   ```
5. **Dual Remote Synchronization (Granular)**:
   ```bash
   npm run push:all
   ```
6. **One-Click Autonomous Sync & Push (Recommended)**:
   ```bash
   npm run push      # or npm run update, or ./update.cmd
   ```

## 5. Academic Publishing & Radical Subtraction Principles (Mandatory)

### 5.1 The North Star: "The Content is the Interface"
AstroLib produces **university-level mathematical and scientific textbooks, academic lecture notes, and formal exercise materials**.
- **Audience**: University students, researchers, and serious learners.
- **Philosophy**: Minimal. Academic. Quiet. Precise. Timeless.
- **Role**: Present pristine mathematical and scientific knowledge. Do NOT evaluate, manage, or infantilize the reader.

### 5.2 Explicit Anti-Patterns & Prohibited Elements
Strictly forbidden across all outputs (MDX authoring, UI components, worksheet generation, EPUB / PDF export):
- **No Learning Management Elements**: No scores, target scores, accuracy rates, time trackers, mastery check-boxes, self-evaluation matrices, motivational slogans, or study tips.
- **No SaaS / App UI Tropes**: No capsule badges, pill tags, gray answer boxes, nested card borders, dashboard widgets, or progress bars.
- **No Decorative Noise**: No unneeded icons, decorative borders, or arbitrary accent colors.

### 5.3 Typographic Rigor & Negative Space
- Sophistication MUST emerge solely from **typography, mathematical typesetting, alignment, hierarchy, proportion, and deliberate negative space**.
- **Negative Space is an Active Element**: A blank area is allowed to remain blank. Never fill whitespace with decorative fluff.
- **Subtractive Heuristic**: *“If removed, does the reader lose necessary academic/mathematical information? If not, remove it.”* When choosing between decoration and whitespace, choose whitespace.

### 5.4 Multi-Agent Pipeline Governance
When undertaking content restructuring, worksheet generation, or publishing redesigns:
1. **Rule Makers vs. Executors**: Agents defining design briefs/systems MUST NOT write implementation code in the same step.
2. **Strict Executor Constraint**: Implementation agents MUST strictly adhere to the established `DESIGN_SYSTEM.md` without inventing new visual abstractions.
3. **Mandatory Minimalism Audit**: Include a dedicated subtractive review step to identify and eliminate superfluous visual weight.
4. **Resolution Precedence**: `Academic Rigor > Minimalism > Readability > Decoration`.

## 6. Material You (Material 3 & Expressive) UI Architecture & Component Standards (Mandatory)

### 6.1 Sole Unified Design System: Material Design 3 (M3 / M3E)
- **Sole System-Wide Standard**: All UI/UX development across all pages and shells is strictly unified under **Material Design 3 (Material You / Expressive)**.
- **Legacy Themes Completely Deleted**: Legacy `vitepress` and `starlight` themes and their respective stylesheets/configs have been permanently removed. All components have been renamed from legacy prefixes (`Vp*`) to declarative M3 components (`M3*`, e.g. `M3TopNavBar`).
- **Default Theme**: The system-wide theme is `material-you`.

### 6.2 Standardized Component Libraries & No Reinvented Wheels
- **Dual Component Stack**:
  1. **Primary (Official Google MD3)**: `@material/web` (`material-components/material-components-web`):
     - Switches: `<md-switch>`
     - Chips & Segment Controls: `<md-chip-set>`, `<md-filter-chip>`, `<md-assist-chip>`, `<md-input-chip>`
     - Text Inputs & Search: `<md-outlined-text-field>`
     - Buttons & Action Triggers: `<md-filled-button>`, `<md-outlined-button>`, `<md-tonal-button>`, `<md-text-button>`, `<md-icon-button>`
     - Modals & Dialogs: `<md-dialog>`
     - Sliders & Metrics: `<md-slider>`
     - Checkboxes & Radios: `<md-checkbox>`, `<md-radio>`
     - Dividers & Lists: `<md-divider>`, `<md-list>`, `<md-list-item>`
     - Elevation & Progress: `<md-elevation>`, `<md-linear-progress>`, `<md-circular-progress>`, `<md-ripple>`
  2. **Supplementary (Material 3 Expressive)**: `@m3e/web` (`matraic/m3e`) for Expressive components (App bars, bottom sheets, callouts, cards, badges, skeletons, and expressive motion).
- **Declarative Layout Suite (`src/components/m3/`)**:
  - Declarative layout primitives (`M3TopNavBar`, `M3Button`, `M3IconButton`, `M3Card`, `M3Dialog`, `M3Switch`, `M3Chip`, `M3ChipSet`, `M3Divider`, `M3TextField`, `M3Icon`) decouple visual layout and state controllers, providing single-point modification similar to Jetpack Compose.
- **Strict Prohibition Against Bespoke Custom Components**:
  - Do NOT invent ad-hoc, hand-crafted toggles, fake segmented tabs, or multi-nested container cards when standard `@material/web` or `@m3e/web` components exist.
  - Discrete options MUST use M3 Filter Chip sets; textual/value inputs MUST use M3 Outlined Text Fields.

### 6.3 Design Archetypes & Learning Blueprints
When designing or refining UI layouts, flows, and interactive components, agents must study and adhere to patterns established in existing modern Google web products:
1. **Google Play** (`play.google.com`): Chip-based filtering, clean section hierarchy, soft tonal surfaces, elevation-free cards.
2. **Gmail Web** (`mail.google.com`): Floating action buttons, compact toolbar actions, quick settings panel layout, clean pill action triggers (`.ft-m3-see-all-btn`).
3. **Android Studio Developer Documentation** (`developer.android.com`): Scholarly technical reading layouts, clean code and card framing, restrained navigation sidebars.
4. **Google Drive** (`drive.google.com`): Restrained dialogs, search bar integrations, subtle selection states, minimal cognitive load.

### 6.4 Harmonization with Academic Principles
- The adoption of Material 3 serves only to elevate clarity, accessibility, and visual elegance.
- **The Content is the Interface**: Mathematical formulas, KaTeX rendering, academic chapter structure, and the radical subtraction rules in Section 5 remain the absolute highest priority. Material 3 styling must never compromise mathematical rigor or add decorative clutter.

### 6.5 Top App Bar & Icon Design Guidelines (空心/半空心优先与视效审慎判断)
- **优先选用空心或半空心设计，结合视效审慎裁量（Outlined Priority with Contextual Discernment）**：
  顶栏是读者视觉停留频率最高的导航交互区，应避免大面积粗厚笨重的实心大色块（如实心黑太阳、实心齿轮大盘、外带黑圆底盘的贴片等），优先选用 **空心轮廓（Outlined）** 或 **负空间通透的半空心（Semi-Outlined）** 设计以保持轻盈学术呼吸感。
  ⚠️ **非教条铁律**：图标选型切忌机械一刀切，必须经过实际视觉判断。对于特定点阵或微型结构（如 9 点工具箱 `apps`），过细的空心圆环易在小尺寸下产生视觉噪点与模糊，此时采用精细克制的微实心填充（如半径 1.5px 的精细圆点）反而在清晰度与质感上更为优越，应予灵活采用。
- **全部采用官方正版矢量（Official Standard Vectors Only）**：
  - 功能图标：以 **Google Material Symbols** 官方标准矢量为准（如 `toc` 大纲、`light_mode` 空心太阳、`dark_mode` 空心月牙、`settings` 空心齿轮、精细 `apps` 工具箱等）；
  - 社交与品牌图标：必须使用对应官方标准净标（如 GitHub Primer Octicons `mark-github`），**严禁使用带纯黑实心外圆底盘的“黑硬币”式贴片**。
- **光学度量与尺寸严格统一**：
  所有顶栏动作图标统一对齐 20px 物理光学尺寸（`width: 20px; height: 20px; viewBox="0 0 24 24"`），居中对齐于 34px/40px 圆形 hover 底座，严禁忽大忽小或偏移失真。

## 7. Sideload Dock (侧载底座) Architecture & Invariants (Mandatory)

### 7.1 Single Host, Multi-Views (同宿主多视图底座)
- **唯一宿主原则**：页面右侧辅助功能区域严格统一由 `.astrolib-sideload-dock`（位于 `PageSidebarOverride.astro`）承载。
- **严禁并发独立外挂**：全站所有右侧辅助阅读功能（课后习题、AI 学术问答、知识图谱速查、随堂笔记等），必须作为 `.sideload-panel-view` 挂载于该宿主内。**严禁任何功能模块在宿主外另起炉灶、自造并列的右侧抽屉或悬浮全高栏**。

### 7.2 SideloadManager as the Sole Arbiter (单例状态机唯一裁决)
- **状态集中管控**：所有右侧面板的激活状态（`activePanelId`）、宽度阶梯（`compact: 16.5rem` / `medium: 20rem` / `wide: 24.5rem` / `full: 28rem`）以及 CSS 变量（`--sl-sideload-width`），必须统一通过 `src/components/sideload/sideload-manager.ts` 的 `sideloadManager` 单例驱动。
- **禁止私自侵入 DOM**：业务 Controller 严禁直接向 `<body>` 或 `<html>` 注入破坏布局的 ad-hoc 类名，严禁直接手写 JS 修改 DOM 宽度。所有正文联动与右栏收缩必须通过 `--sl-sideload-width` 平滑过渡。

### 7.3 TOC Fallback & Interaction Loop (大纲闭环与无条件退回)
- **大纲常驻与随时回退**：大纲（`toc`）是右侧的基准默认视图。
- **标准三退出通道**：任何非大纲侧载面板必须支持：
  1. 面板顶部提供 Google M3 标准 28px 圆形返回按钮（`#sideload-back-to-toc` 或绑定 `sideloadManager.switchToDefault()`）；
  2. 响应键盘 `Escape` 键一键切回大纲；
  3. 平板/移动端点击背景遮罩（`.astrolib-sideload-scrim`）一键关闭并复原大纲。

### 7.4 Viewport Sheet Transformation (多视口自适应分流)
- **桌面端 (≥ 72rem)**：Docked 常驻分栏。正文 `.main-pane` 与右栏由 `--sl-sideload-width` 动态协调，禁止产生公式重排跳跃。
- **平板端 (50rem - 72rem)**：激活非大纲面板时转为标准 M3 Side Sheet 浮层（`position: fixed; width: min(25rem, 85vw); z-index: 400;`），伴随半透明 Scrim 遮罩，正文不被挤压。
- **移动端 (< 50rem)**：激活非大纲面板时转为标准 M3 Bottom Sheet 底部抽屉（`position: fixed; width: 100vw; max-height: 85vh; border-radius: 16px 16px 0 0;`），**严禁出现设置固定像素宽度（如 24rem / 384px）撑爆移动端视口**。

## 8. Desktop Architecture & Electron Decoupling Standards (ABP + Reader Shell) (Mandatory)

### 8.1 Zero-Builtin Books & Framework-Content Decoupling (框架与内容彻底解耦)
- **绝对解耦原则**：底座工程与书籍数据彻底解耦。严禁将大批量教材 MDX 重新放入 `src/content/docs/collections/` 迫使 Astro 静态构建树膨胀。所有源书籍内容统一维护于 `content-sources/collections/`。
- **ABP 标准契约**：书籍章节必须使用官方编译器打包为符合 ABP Schema 1.0.0 的标准内容包：
  ```bash
  node scripts/pack-book-abp.mjs --all
  ```
  产物自动生成至 `artifacts/abp-packs/`（含 `.abp` 单文件包、展开目录与 `catalog.json`），严禁将生成物放回 `public/` 或提交入库。严禁修改或破坏 `src/types/content-package.ts` 中的主清单与章节有效负载核心契约。

### 8.2 Universal Reader Shell Synthesis Invariant (Master Shell 页面合成铁律)
- **无损合成原则**：桌面端章节阅读基于 `dist/reader-shell/index.html`（预编译 Starlight Master Shell），在 `electron/server/reader-shell-template.ts` 中动态装配 HTML。
- **严禁 UI 降级**：
  1. **左侧导航**：必须渲染支持全学科合集（`cs`, `math`, `science`, `telecom`）、全书目展开/折叠、章节精确高亮的树状目录，与 Web 版体验保持绝对一致；
  2. **右侧大纲**：必须调用 `buildStructuredTocHtml()` 深度提取 `h2/h3` 标题与 `.toc-chunk` 学术卡片，带上模块 Chip（`[引]`, `[习]`, `[定]`, `[理]`, `[例]`）与 M3 折叠按钮（`.toc-collapse-btn`）；
  3. **学术折叠与数字资源**：`<Solution>` 必须编译为标准 `<details class="solution-details">` 并保留学术墓碑符 `∎`；数字资源必须渲染为标准 `.academic-digital-resource` 流式卡片；
  4. **标题 Slug 净化**：生成标题与锚点时必须剔除 TeX 占位符，严禁生成含引号转义错位的坏 ID。

### 8.3 Desktop State Persistence & Window Safe Area (状态持久化与窗口安全区)
- **同步防闪烁配置恢复**：桌面端在 Preload 首帧通过 `ipcRenderer.sendSync('astrolib:get-settings-sync')` 注入配置并代理 `localStorage`，所有偏好设置（字体、缩进、主题）通过 IPC 自动持久化写入用户目录下的 `settings.json`。
- **默认排版基准**：默认中文字体设为思源黑体（`Source Han Sans`）；默认开启中文段落首行缩进两字（`text-indent: 2em`），并对卡片标题、折叠摘要、独立公式实施负空间保护。
- **窗口三键避让安全间距**：无边框窗口右上角系统三键占用固定区域，顶栏右侧动作区（`.m3-app-bar__actions`, `.m3-right-group`, `.vp-nav-actions`, `.vp-right-group`）必须保持 `padding-right: 140px !important;`，严禁擅自压缩或删除该属性。
- **透镜与侧载单例**：必须确保全局同时暴露 `window.__sideloadManager` 与 `window.sideloadManager`，确保顶栏关注点透镜（`Alt+I`）按钮即开即用。

### 8.4 Desktop Verification & Release Pipeline (桌面端构建与验证流水线)
任何修改桌面端或内容编译器逻辑后，必须依序执行以下验证与构建步骤：
1. **类型守卫**：`npm run check:types`（必须保持 0 错误）；
2. **自动化测试**：`npx vitest run tests/unit/content-provider.test.ts tests/acceptance/abp-dynamic-serving.test.ts`；
3. **重新打包图书（如改动了编译器）**：`node scripts/pack-book-abp.mjs --all`；
4. **编译桌面端绿色免安装版**：`npm run electron:pack`（直接产出 `release/win-unpacked/AstroLib.exe`）；
5. **打包安装包与便携版**：`npm run electron:build`（产出 `release/*.exe`）。




