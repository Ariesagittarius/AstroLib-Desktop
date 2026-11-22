# P1-D Visual Smoke Spot-Check Report (CSS Important Stripping Audit)

> **审计核定与口径降级（2026-11-14 第二轮独立审计裁决）**：
> 本报告系开发态人工 Spot Check（抽样点检）记录，未配置基于 Headless 浏览器（Playwright / Puppeteer）的自动化截图捕获比对流水线，未在仓库内生成物理截图物料与像素哈希。
> 依据 `P1_REMEDIATION_AUDIT_2026-11-14.md` 裁决，**D5 样式削减门禁维持 CONDITIONAL**，不得宣称“0 regression”或“Formally Verified”。
> **本报告更正了此前版本中与源码不一致的选择器；2026-11-14 第三轮复核再次校正 3 处残留（`.ask-panel-container` → `.ask-panel`、`.hub-empty-state` → `.ex-empty-state`、`.loading-mask` → `.m3-loading-overlay-host`）。**

**Verification Date**: 2026-11-14
**Audit Baseline**: `5498542a` → HEAD (`f8651613`)
**Evaluator**: AstroLib Architectural Governance (Manual Spot Check)
**Target Scope**: Visual stability of Material Design 3 surfaces following mechanical stripping of 1,512 `!important` declarations from `src/styles/components/exercise-m3.css` and layer consolidation.
**Verdict**: **CONDITIONAL (Spot Checked, Formal Visual Regression Suite Deferred to P2)**

---

## 1. Architectural Specificity Analysis

In `src/styles/components/exercise-m3.css`, all visual components are encapsulated under the root theme attribute selector:
```css
html[data-site-theme='material-you'] .exercise-trigger-card { ... }
html[data-site-theme='material-you'] .ex-modal-dialog { ... }
html[data-site-theme='material-you'] .ex-nav-item { ... }
```
Because each selector carries specificity `[0, 2, 0]` (attribute + class) or higher (`[0, 3, 0]` with child combinators), it intrinsically overrules default resets (`[0, 1, 0]`) without requiring `!important`.

---

## 2. Multi-Viewport & Multi-Theme Spot-Check Matrix

| Index | Target Surface | Theme Mode | Viewport Resolution | Layout Tier | Spot-Check Status | Inspection Detail |
| :---: | :--- | :---: | :---: | :---: | :---: | :--- |
| **S01** | `/desktop/` (Main Workspace Hub) | Light | 1440 × 900 (Desktop) | Docked Grid | Spot-Checked | M3TopNavBar, Book Grid Cards, Safe Area padding-right 140px |
| **S02** | `/desktop/` (Main Workspace Hub) | Dark | 1440 × 900 (Desktop) | Docked Grid | Spot-Checked | Surface container dark tones, elevation elevation-level-1 |
| **S03** | `/desktop/` (Main Workspace Hub) | Light | 1024 × 768 (Tablet) | Responsive Grid | Spot-Checked | Grid wraps cleanly to 2 columns, drawer controls accessible |
| **S04** | `/desktop/` (Main Workspace Hub) | Dark | 390 × 844 (Mobile) | Single Column | Spot-Checked | Responsive stack, zero horizontal overflow |
| **S05** | `/reader/` (Universal Canonical Shell) | Light | 1440 × 900 (Desktop) | Split Triple Pane | Spot-Checked | Sidebar nav, markdown container, TOC sideload dock |
| **S06** | `/reader/` (Universal Canonical Shell) | Dark | 1440 × 900 (Desktop) | Split Triple Pane | Spot-Checked | Dark KaTeX rendering, formula negative space preserved |
| **S07** | `/reader/` (Universal Canonical Shell) | Light | 1024 × 768 (Tablet) | Side Sheet | Spot-Checked | Sideload transforms to modal side sheet with scrim |
| **S08** | `/reader/` (Universal Canonical Shell) | Dark | 390 × 844 (Mobile) | Bottom Sheet | Spot-Checked | Bottom sheet dock with drag handle, TOC collapsible |
| **S09** | Settings Hub (`SettingsHubContent`) | Light | 1440 × 900 (Desktop) | M3 Center Hub | Spot-Checked | Switch toggles, font selection chips, segmented buttons |
| **S10** | Settings Hub (`SettingsHubContent`) | Dark | 1024 × 768 (Tablet) | M3 Center Hub | Spot-Checked | Outlined text fields, contrast ratio >= 4.5:1 |
| **S11** | Exercise Center (`ExerciseModal`) | Light | 1440 × 900 (Desktop) | Modal Window | Spot-Checked | Practice/Paper mode tabs, A/B group filter pills, stem HTML |
| **S12** | Exercise Center (`ExerciseModal`) | Dark | 1440 × 900 (Desktop) | Modal Window | Spot-Checked | KaTeX formula contrast in dark mode, options hover states |
| **S13** | Exercise Center (`ExerciseModal`) | Light | 1024 × 768 (Tablet) | Modal Window | Spot-Checked | Filter bar auto-collapses cleanly, toolbar toggle responsive |
| **S14** | Exercise Center (`ExerciseModal`) | Dark | 390 × 844 (Mobile) | Fullscreen Sheet | Spot-Checked | Mobile fullscreen mode, sticky footer submit actions |
| **S15** | In-Page Trigger (`ExerciseTriggerCard`)| Light | 1440 × 900 (Desktop) | In-Flow Card | Spot-Checked | Rounded corners (16px), surface-container-low, icon tint |
| **S16** | In-Page Trigger (`ExerciseTriggerCard`)| Dark | 390 × 844 (Mobile) | In-Flow Card | Spot-Checked | Mobile compact badge layout, button tap targets >= 48px |
| **S17** | Workspace Ingest (`/workspace/ingest/`)| Light | 1440 × 900 (Desktop) | Split View | Spot-Checked | Dual-channel environment indicators, health monitor |
| **S18** | Workspace Ingest (`/workspace/ingest/`)| Dark | 1024 × 768 (Tablet) | Stack View | Spot-Checked | File dropper border contrast, status chip layout |

---

## 3. High-Risk Component Selector Audit (Aligned with Source)

| # | High-Risk Component | Verified CSS Class / Selector in `src/` | Cascade Specificity | Audit Status |
| :-: | :--- | :--- | :--- | :---: |
| 1 | **习题触发卡** | `.exercise-trigger-card` | Container surface tone overrides Starlight content block | Spot-Checked |
| 2 | **习题弹窗主体** | `.ex-modal-dialog`, `.ex-modal-window` | Standard HTML dialog backdrop and elevation | Spot-Checked |
| 3 | **组别筛选 Chip** | `.ex-group-pills .ex-nav-item` | Active state `.active` pill highlight and ripple | Spot-Checked |
| 4 | **导出对话框** | `#ex-latex-modal`, `.ex-submodal-box` | Form input alignments and font selector dropdowns | Spot-Checked |
| 5 | **AI 问答面板** | `ai-ask`, `.ask-panel` | Docked tier clamp `clamp(20rem, 28vw, 25.5rem)` | Spot-Checked |
| 6 | **侧载底座** | `.astrolib-sideload-dock`, `.sideload-panel-view` | CSS variable `--sl-sideload-width` smooth transitions | Spot-Checked |
| 7 | **设置行组件** | `.hub-ft-host`, `.ft-item-row`, `md-switch` | Material You ripple and primary color mapping | Spot-Checked |
| 8 | **习题操作栏** | `.ex-card-actions`, `.ex-toggle-steps-btn` | Compact button alignment and tooltips | Spot-Checked |
| 9 | **目录大纲树** | `.toc-heading-row`, `.toc-collapse-btn`, `.toc-list` | Expand/collapse arrow animation, indentation | Spot-Checked |
| 10 | **空状态占位** | `.ex-empty-state` | M3 expressive illustration centering and muted text | Spot-Checked |
| 11 | **错误反馈** | `.ask-error-container`, `.ex-toast` | Error container container-color and contrast | Spot-Checked |
| 12 | **骨架与加载态** | `m3-loading-indicator`, `.m3-loading-overlay-host` | M3 circular progress centering and backdrop blur | Spot-Checked |

---

## 4. Quantitative Metrics Audit

- **Baseline `!important` Count (2026-11-12 Audit)**: `6,590`
- **Current `!important` Count across all `.css`**: `4,552` (-2,038 declarations, -30.9%)
- **Target Ceiling**: `<= 5,200` (Satisfied)
- **Visual Smoke Evidence Level**: Spot Check (Level 1); Automated Pixel-Diff Regression Pipeline (Level 3) deferred to P2.

---

## 5. Architectural Disclosure & Signoff

1. **Native Cascade Layers (`@layer`) Status**:
   `src/styles/layers/` currently operates as an ordered `@import` modularization system without native `@layer` block declarations (`git grep "@layer" src/styles` = 0). Native `@layer` adoption is deferred to P2.
2. **Visual Smoke Signoff**:
   - Status: **CONDITIONAL** (Manual spot check completed; no screenshot-level automated diff pipeline).
   - Signoff: AstroLib Core Architecture.
