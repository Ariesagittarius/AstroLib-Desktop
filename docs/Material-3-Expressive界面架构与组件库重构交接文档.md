# Material 3 & Expressive 界面架构与组件库重构交接文档

## 1. 重构背景与核心目的

本项目（AstroLib）正迎来底层能力的大幅升级（包括端侧多模态模型、ABP 预编译离线内容包分发、多视窗 Electron 架构等）。为了保证界面具备高度的可扩展性、一致性、声明式布局能力以及视觉纯度，本次优化对项目的界面框架与组件架构完成了深度重构：

1. **清除冗余主题体系**：彻底删除了早期标记为【封存】的 `vitepress` 与 `starlight` 主题相关残留文件（包括 `src/styles/vitepress-theme.css`、`docs/archive/legacy-vitepress/` 目录以及 `SiteThemeSelect` 无用组件），将系统 UI 唯一标准牢牢确立为 **Material Design 3 (Material You / Expressive)**。
2. **重命名并改造遗留组件**：对历史广泛使用的以 `Vp*` 开头的组件进行了完整重构与重命名（如 `VpNav.astro` 升级为声明式 `M3TopNavBar.astro`），消除了历史技术债务。
3. **确立组件库唯一来源准则**：
   - **核心主力库**：Google 官方 `@material/web`（Material Design 3 Web Components，基于 Lit 与 Web Standards）；
   - **功能候补与 Expressive 补全库**：`@m3e/web`（Material 3 Expressive Web Components，支持卡片、应用栏、抽屉容器、底栏浮层与动态微动效）；
   - **唯一官方矢量图标源**：Google 官方 [Material Design Icons / Material Symbols](https://github.com/google/material-design-icons)。
4. **声明式布局体系与逻辑解耦**：构建了类似 Android Jetpack Compose 风格的声明式 UI 原语套件（位于 `src/components/m3/`），实现“界面布局规范统一、易于溯源与一次性修改、状态控制器与展示结构清晰解耦”。

---

## 2. 彻底删除与清理的资产清单

| 资产路径 | 状态 | 说明 |
| :--- | :--- | :--- |
| `src/styles/vitepress-theme.css` | **已物理删除** | 彻底移除 1380+ 行旧版 VitePress 样式覆盖层；关键间距变量与入场动画平滑迁移至 M3 tokens |
| `docs/archive/legacy-vitepress/` | **已物理删除** | 清理历史交接与说明文档，避免干扰后续 Agent 与开发者 |
| `src/components/SiteThemeSelect.astro` | **已物理删除** | 移除多主题下拉选择器，全站无需也不再支持回退到 VitePress / Starlight |
| `src/config/themes.config.ts` | **更新精简** | `siteThemes` 仅保留 `material-you`，移除全部已封存的 disabled 配置 |
| `src/components/FeatureToggles.astro` | **移除废弃线框** | 移除 70+ 行已封存主题的线框示意图与切换项，聚焦 M3 动态配色与排版 |
| `scripts/verify-*.mjs`, `scripts/capture-*.mjs` 等 | **已清除** | 清理此前产生的临时调试与排障中间脚本 |

---

## 3. 标准化 M3 / M3E 声明式组件库体系 (`src/components/m3/`)

为了使全站各页面的布局清晰、规范、易于溯源且一键定制，在 `src/components/m3/` 下构建了声明式组件库：

```text
src/components/m3/
├── M3Icon.astro          # Google Material Symbols 官方标准矢量组件 (支持 size, fill, weight, opticalSize)
├── M3Button.astro        # 声明式按钮 (支持 filled, outlined, tonal, text, elevated，包裹 @material/web)
├── M3IconButton.astro    # 声明式图标按钮 (34px/40px 物理光学底座，包裹 @material/web)
├── M3Card.astro          # 声明式 M3E 卡片 (支持 elevated, filled, outlined，带 header, leading, actions 槽位)
├── M3Chip.astro          # 声明式标签 Chip (支持 filter, assist，包裹 @material/web)
├── M3ChipSet.astro       # 声明式标签集容器 (包裹 @material/web)
├── M3Switch.astro        # 声明式开关 (包裹 @material/web md-switch)
├── M3Divider.astro       # 声明式分割线 (包裹 @material/web md-divider)
├── M3Dialog.astro        # 声明式模态对话框 (包裹 @material/web md-dialog，带 headline, content, actions 槽位)
├── M3TextField.astro     # 声明式文本输入框 (包裹 @material/web md-outlined-text-field)
├── M3TopNavBar.astro     # 全功能 M3 Expressive 顶栏 (替换旧版 VpNav，支持响应式抽屉与快捷键)
└── index.ts              # 组件库聚合导出入口
```

### 3.1 声明式 API 示例 (类似 Compose)

#### 1) 声明式 App Bar
```astro
---
import { M3TopNavBar } from '@/components/m3';
---
<M3TopNavBar currentPath="/library/" siteTitle="AstroLib" showSearch={true}>
  <!-- 自定义动作槽位 -->
  <div slot="actions">
    <M3Button variant="tonal" icon="cloud_download">同步</M3Button>
  </div>
</M3TopNavBar>
```

#### 2) 声明式 Tonal Surface 卡片
```astro
---
import { M3Card, M3Button, M3Icon } from '@/components/m3';
---
<M3Card variant="filled" title="工科数学分析" subtitle="马知恩 · 高等教育出版社">
  <M3Icon name="menu_book" slot="leading" size={24} />
  <p>全书共收录 12 个核心教学章节与配套自测题解。</p>
  <div slot="actions">
    <M3Button variant="text">查看目录</M3Button>
    <M3Button variant="filled" icon="arrow_forward">开始研读</M3Button>
  </div>
</M3Card>
```

#### 3) 声明式交互控件
```astro
---
import { M3ChipSet, M3Chip, M3Switch, M3Divider } from '@/components/m3';
---
<M3ChipSet ariaLabel="学科分类">
  <M3Chip label="全部学科" selected />
  <M3Chip label="数学科学" icon="functions" />
  <M3Chip label="计算机与通信" icon="memory" />
</M3ChipSet>

<M3Divider />

<label>
  <span>开启双语对照</span>
  <M3Switch selected={true} id="switch-bilingual" />
</label>
```

---

## 4. 全站各主要界面风格与主题色统一治理

本次排查并治理了全站所有核心界面，确保 100% 消费统一的设计令牌（Design Tokens）与 Google Material Symbols：

### 4.1 正文阅读器界面 (`HeaderOverride`, `SidebarOverride`, `PageSidebarOverride`, `reader-shell-template.ts`)
- 顶栏全面对齐 Android Studio / Google Drive 学术紧凑风格（48px 高度、Tonal Surface）；
- 动作按钮统一为 34px/40px 光学圆形触摸区，图标严格采用 20px Material Symbols Outlined；
- 大纲（TOC）与侧载底座（Sideload Dock）通过 `--sl-sideload-width` 与 `--layer-*` 单例平滑协同，杜绝破坏正文与公式跳动。

### 4.2 首页与书架管理界面 (`src/pages/index.astro`, `AbpShelfManager`, `IngestUploadCard`)
- 顶栏全面接入 `M3TopNavBar`；
- 书架管理卡片全面采用 M3 Tonal Surface (`surface-container-low`) 与全圆角药丸操作按钮；
- 拖拽导入与云端同步面板采用 `@material/web` 进度指示与反馈体系。

### 4.3 云端书库与检索中心 (`src/pages/library.astro`, `library.css`)
- 顶栏全面接入 `M3TopNavBar`；
- 彻底重构了 `library.css` 中的全局变量映射，将旧版 `--vp-*` 色彩全部绑定至 `--md-sys-color-*` 系统令牌；
- 检索框、维度筛选按钮（Filter Chips）、图书卡片（Book Rows）与详情模态对话框均满足 M3 规范（`shape-corner-large: 16px`, `shape-corner-full: 9999px`）。

### 4.4 MinerU 学术文献与切片解析全屏工作台 (`src/pages/workspace/ingest.astro`, `ingest.css`)
- 建立了 `--md3-*` 样式变量与全站统一 `--md-sys-color-*` 令牌之间的无缝映射桥接，工作台色彩自动跟随全局动态主题色实时生效；
- 顶部双栏对照模式切换器采用标准 M3 Segmented Button 结构；
- 所有交互图标采用 Google 官方 Material Symbols Outlined。

### 4.5 控制中心与扩展仓库 (`src/pages/hub.astro`)
- 硬件自省卡片、服务探活指标卡、环境配置均遵循 M3 Tonal Surface，支持暗色护眼模式；
- 与 Electron 无边框窗口三键安全边距保持严格的 `padding-right: 140px`。

---

## 5. 质量门禁与工程验收

重构完成后依序执行了严格的双重质量门禁检验：

1. **严苛 TypeScript 类型守卫**：
   ```bash
   npm run check:types
   # 结果：0 errors, 100% strict check 通过
   ```
2. **多层级自动化测试套件**：
   ```bash
   npm test
   # 覆盖 tests/unit, tests/contract, tests/acceptance
   # 结果：61 passed (61 test files), 347 passed (347 tests), 100% 通过
   ```
3. **向后兼容机制**：保留了 `VpNav.astro` 代理导出层以及关键 CSS 兼容类名，确保历史外部扩展脚本与自动化构建流水线平稳过渡。
