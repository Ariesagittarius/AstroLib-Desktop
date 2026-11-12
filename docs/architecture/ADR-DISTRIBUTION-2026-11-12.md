# ADR-DISTRIBUTION-2026-11-12：AstroLib 桌面端书籍内容发行契约决策

**文档编号**：ADR-DISTRIBUTION-2026-11-12  
**状态**：`ACCEPTED`（Gate G0 负责人决策拍板，2026-11-12）  
**适用范围**：`AstroLib` Electron 桌面端仓库（分支 `electron/main`）  
**关联文档**：
- [STAGE_REVIEW_AND_EXECUTION_GATES_2026-11-12.md](./STAGE_REVIEW_AND_EXECUTION_GATES_2026-11-12.md)（Gate G0 / G1 / G2 / G3 / G4 / G5 门禁规范）
- [PROJECT_ARCHITECTURE_AUDIT_2026-11-12.md](./PROJECT_ARCHITECTURE_AUDIT_2026-11-12.md)

---

## 1. 背景与决策问题

截至基线 `cbb19a78`（`refactor(core): align electron desktop architecture with lean dynamic abp model`），桌面端在代码层面已经移除内置静态章节路由（`src/content/docs/collections` 与 `dist/collections`），但内容分发契约仍处于未定义状态：

1. `package.json:build.files` 不包含任何 `.abp` 或目录清单，安装后用户本地 `userData/abp-packs/` 为空；
2. `.github/workflows/electron-release.yml` 仅打包并上传桌面端安装程序（`.exe` / `.zip` / `.blockmap` / `latest.yml`），既不编译 `.abp`，也不上传 `catalog.json` 或 `.abp` 资产；
3. 客户端内虽存在 `ElectronContentProvider.fetchRemoteCatalog()` 与本地 `.abp` 文件上传入口，但尚未绑定官方发行通道与首次启动引导路径；
4. `win-unpacked` 实测体量达 **2,853.3 MB**（其中 `app.asar` **1,720.62 MB**），尚未建立严格的体积预算与排除规则（注意 Electron 45 纯运行时底座不含 `resources/` 已占约 **307.57 MB**）。

按照 Gate G0 硬约束，必须在“**模式 A：零内置书 Shell**”与“**模式 B：预置书库**”之间做出唯一、不可并存的排他选择，以作为 Gate G1（瘦身边界）与 Gate G3（发行流水线）的唯一契约依据。

---

## 2. 最终决策（Decision）

### 2.1 选定模式：**模式 A —— 零内置书 Shell（Zero-Builtin-Book Shell）**

- **桌面端安装包形态**：桌面端 NSIS 安装包与 Portable 便携版**仅分发精简应用壳体（Shell）**，内部**严禁打包任何 `.abp` 书籍包或展开的书籍目录/图片资产**。
- **官方获取通道**：官方教材合集以 **GitHub Releases 资产** 形式与桌面端版本同步发布（单次 Release 同时产出发版应用壳体 + 官方 `catalog.json` + 全量 13 本 `.abp` 单文件包）。
- **离线兜底通道**：完整保留并强化客户端内本地 `.abp` 单文件导入路径，供无网/受限网络用户离线安装。

### 2.2 互斥模式声明（Rejected / Disabled Alternative）

- **模式 B（预置书库 / Pre-bundled Books in Installer）**：**`NOT ACTIVE`**。
  - 在本决策有效期内，禁止将 `artifacts/abp-packs/*.abp`、`artifacts/abp-packs/*/**`、`public/abp-packs/**` 或 `content-sources/**` 纳入 `package.json:build.files`；
  - 禁止在构建、打包脚本或用户文档中保留“安装包自带预置书库”的并发逻辑或说明（仅 `InstalledBookMeta.sourceType` 历史类型字面量待 G4/G5 按契约清理或显式标为 deprecated）。

---

## 3. 模式 A 发行契约细则

### 3.1 官方 ABP 获取通道（Release Channel）

1. **发布载体**：GitHub Releases（随 `electron-release.yml` Tag 触发或 `workflow_dispatch` 同步发布）。
   - 说明：已通过 `src/config/release.config.ts` 收口唯一公开桌面端发布仓坐标 `DEFAULT_DESKTOP_RELEASE_REPO = 'Ariesagittarius/AstroLib-Desktop'`（与 `AppUpdater`、`RemoteCatalogService`、`pack-book-abp.mjs`、`electron-release.yml` 及 `release-desktop.mjs` 保持完全一致；`web-upstream` 保留为网页端 `Ariesagittarius/AstroLib`，`private` 为备份仓 `Ariesagittarius/AstroLib_Backup`）。
2. **远程目录清单 URL 契约**：
   - 每个 Release 资产中必须包含唯一权威索引 `catalog.json`；
   - `catalog.json` 中的每个 `CatalogBookEntry` 必须提供 `packFileName`、`sizeBytes`、`contentHash`、`updatedAt` 以及可直连的 `remotePackUrl`（或由发行基址 + `packFileName` 确定性拼接，例如 `https://github.com/<owner>/<repo>/releases/latest/download/<packFileName>`）。
3. **版本与契约号**：
   - 协议版本：`ABP Schema 1.0.0`（与 `src/types/content-package.ts` 中 `ABP_SCHEMA_VERSION = '1.0.0'` 保持一致）。
   - 索引元数据：`catalog.json` 必须携带 `schemaVersion`、`generatedBy`、`generatedAt` 与 `books[]`。

### 3.2 首次启动与内容获取路径

首次安装并启动应用时，`userData/abp-packs/` 为空，用户可通过以下两条**可操作路径**获得内容（禁止出现“空列表且无明显获取入口”的状态）：

1. **在线通道（推荐主路径）**：
   - 书库界面（`FragmentLibrary`）提供“官方书库 / 获取教材”入口，调用 `ElectronContentProvider.fetchRemoteCatalog()` 拉取当前 Release 的 `catalog.json`；
   - 展示全量 13 本官方教材的书名、学科、章节数、`.abp` 体积与本地安装状态（未安装 / 已安装 / 有更新）；
   - 用户点击下载后流式获取 `.abp` 字节流，经完整性校验后交由 `DesktopBookManager.installBookFromAbp()` 原子解包落盘至 `userData/abp-packs/<bookId>/`；
   - 若请求 GitHub Releases 失败，界面必须给出明确的可诊断错误信息（请求 URL、HTTP 状态或网络异常原因）并提示使用离线导入路径，禁止静默失败或用模糊文案掩盖。
2. **离线通道（强制兜底路径）**：
   - 离线用户可通过其他终端从 GitHub Releases 下载独立 `.abp` 文件（或全套 `.abp` 资产），拷贝至本机后在书库点击“上传文件（`.abp`）”导入；
   - `FragmentReaderHost` 在对应教材未安装时，提示前往书库在线获取或导入对应 `.abp`，不得呈现静默空白 iframe。

### 3.3 版本校验、完整性与增量更新

1. **结构与引用校验**：安装前通过统一的 `validateAbpBundle()` 校验 `schemaVersion` 兼容性、`manifest` 核心字段、`entryPoint` 存在性及 `sections -> chapters` 引用完整性（在 G5 补齐严格校验规则）。
2. **哈希校验**：在线下载 `.abp` 时必须比对 `catalog.json` 声明的 `contentHash` / `sizeBytes` 与解压载荷校验值，不匹配则拒绝落盘并清除 staging 临时目录。
3. **原子安装与更新**：沿用 `staging -> atomic rename` 机制（并在 G5 将元数据写入纳入可回滚事务边界）。当远程 `catalog.json` 中某本书的 `contentHash` 不同于本地已安装 `manifest.contentHash` 时，标记为“可更新”，升级替换章节内容的同时保留用户的书架分类与阅读进度。

---

## 4. 首发书单与 ABP 基线清单

全量官方首发书单共 **4 个合集、13 本教材、1,251 个章节**（当前 `artifacts/abp-packs/` 实测 `.abp` 总压缩体积 **144.27 MB**；单本最大为 `telecom-communication_principles.abp` 48.03 MB）：

| # | Book ID | 合集 (`colSlug`) | 书名 | 章节数 | `.abp` 体积 | `packFileName` |
|---:|---|---|---|---:|---:|---|
| 1 | `math-math_senior` | `math` | 新高考数学你真的掌握了吗（第二版） | 90 | 2.64 MB | `math-math_senior.abp` |
| 2 | `math-math_analysis` | `math` | 数学分析（第五版） | 130 | 4.22 MB | `math-math_analysis.abp` |
| 3 | `math-engineering_analysis` | `math` | 工科数学分析基础（第三版） | 45 | 6.52 MB | `math-engineering_analysis.abp` |
| 4 | `math-linear_algebra` | `math` | 线性代数及其应用（原书第5版） | 87 | 7.15 MB | `math-linear_algebra.abp` |
| 5 | `math-probability_statistics` | `math` | 概率论与数理统计教程（第三版） | 56 | 3.57 MB | `math-probability_statistics.abp` |
| 6 | `math-linear_algebra_geometry` | `math` | 线性代数与几何（第2版） | 42 | 1.51 MB | `math-linear_algebra_geometry.abp` |
| 7 | `math-graph_theory` | `math` | 图论（原书第五版） | 100 | 5.20 MB | `math-graph_theory.abp` |
| 8 | `science-university_physics` | `science` | 大学物理学（第七版） | 169 | 10.18 MB | `science-university_physics.abp` |
| 9 | `science-vectors_and_tensors` | `science` | A Student's Guide to Vectors and Tensors | 100 | 9.56 MB | `science-vectors_and_tensors.abp` |
| 10 | `telecom-communication_principles` | `telecom` | 通信原理（第5版） | 91 | 48.03 MB | `telecom-communication_principles.abp` |
| 11 | `telecom-digital_circuit` | `telecom` | 数字电路与逻辑设计（第2版） | 65 | 14.56 MB | `telecom-digital_circuit.abp` |
| 12 | `telecom-electronic_circuits` | `telecom` | 电子电路基础（第2版） | 69 | 13.84 MB | `telecom-electronic_circuits.abp` |
| 13 | `cs-algorithms` | `cs` | Algorithms (DPV) | 207 | 17.30 MB | `cs-algorithms.abp` |

> **注**：上述体积为基线采样值（`--no-vectors` 下 13 个 `.abp` 实测合计 `144.27 MB`）。在 Gate G2 补齐支持书单的 `exercises` 数据及确定向量配置后，以 CI 当次全量编译产物为准。

---

## 5. 发布产物清单与体积预算（G1 / G3 目标状态）

### 5.1 桌面端体积预算（Gate G1 门禁基准）

基于模式 A（零内置书 Shell）及 Electron 45 Windows x64 运行时底座（非 `resources/` 根二进制约 `307.57 MB`、`dist/` 约 `37.7 MB`）：

| 指标 | 当前基线 (`cbb19a78`) | G1 预算上限（模式 A） | 关键裁剪手段（由 G1 实施） |
|---|---:|---:|---|
| `release/win-unpacked` 总体积 | 2,853.3 MB | **≤ 600 MB** | 剥离构建期包、`node_modules` 裁剪、非 Win-x64 二进制剔除 |
| `resources/app.asar` | 1,720.62 MB | **≤ 200 MB** | 彻底排除 `**/.cache/**`（含 `@huggingface` 1.57 GB 缓存）、`**/*.tmp*`、文档/fixture |
| `app.asar` 禁止路径 | 0 违例（未审计 `node_modules` 缓存） | **0 违例** | 禁止 `src/`、`content-sources/`、`public/abp-packs/`、`dist/collections/`、`**/.cache/**` |

### 5.2 `package.json:build.files` 目标状态

- 仅包含应用壳体运行时必需文件：`dist/**/*`（排除 `dist/collections/**` 与 `dist/abp-packs/**`）、`dist-electron/**/*`、`public/favicon.png`、`package.json` 及经 G1 验证可从干净 clone 复现的必要数据；
- **严禁**引用任何 `.gitignore` 忽略的未跟踪文件（如未入库且未在 build 期生成的本地 JSON）；
- **严禁**包含 `*.abp` 或 `artifacts/abp-packs/**`（模式 B 为 `NOT ACTIVE`）。

### 5.3 `.github/workflows/electron-release.yml` 目标状态（由 G3 实施）

在 GitHub Actions `windows-latest` 流水线中按以下顺序执行：

1. `npm ci`
2. `npm run check:types`
3. `npm run build`（生成纯净桌面壳 `dist/`）
4. `node scripts/build-electron.mjs`（编译 `dist-electron/`）
5. `node scripts/build-exercise-data.mjs` + `node scripts/pack-book-abp.mjs --all`（将 13 本书编译至 `artifacts/abp-packs/`，含 `catalog.json` 与 13 个 `.abp`；**不打包进 `app.asar`**）
6. `npm test`（含 G1/G2 新增真实包与打包边界测试）
7. `npx electron-builder --win`（仅打包精简壳体安装程序）
8. `softprops/action-gh-release@v2` 同步上传两类 Release 资产：
   - **应用壳体**：`release/*.exe`、`release/*.zip`、`release/*.blockmap`、`release/latest.yml`
   - **内容资产**：`artifacts/abp-packs/catalog.json`、`artifacts/abp-packs/*.abp`

---

## 6. 合规与 Gate 衔接

- **Gate G1**：严格按 §5.1 预算与排除清单裁剪依赖与 `app.asar`，不得顺手往安装包内添加任何 `.abp`。
- **Gate G2**：打通 `src/data/exercises/` → `artifacts/exercises/` → `.abp` 内嵌 `exercises` 链路，并标明支持书单与 `unsupported` 书目。
- **Gate G3**：按本 ADR 实现模式 A 的 `electron-release.yml` 资产发布与桌面端在线获取/校验/离线导入闭环，禁止退回无获取路径的空壳状态。
