# 架构决策记录 (ADR-LIBRARY-CONTRACT-2026-11-13)

**标题**：AstroLib 书库管理、统一校验入口、原子安装与幂等清理契约决策
**编号**：ADR-P1-C0-2026-11-13
**状态**：`PROPOSED (待审核后执行 C1)`
**对应任务**：P1-C0（P1-C 阶段架构决策，不修改业务源码）
**基准分支**：`electron/main` @ `d4e09245`（Tag `v0.0.4` @ `df68e42c` 保持不变）
**约束规范**：`AGENTS.md` Rule 1 (UI not domain model), Rule 3 (Source of truth), Rule 6 (Feature isolation), Rule 7 (Utils purity), Rule 10 (One boundary -> One migration -> One verification)

---

## 1. 决策背景与现状问题盘点 (Context & Current Gaps)

在基准审计报告 [`PROJECT_ARCHITECTURE_AUDIT_2026-11-12.md`](./PROJECT_ARCHITECTURE_AUDIT_2026-11-12.md) §4（P0-08）与 [`P1_B_C_HANDOFF_2026-11-13.md`](./P1_B_C_HANDOFF_2026-11-13.md) §1.2 中，对 AstroLib 当前三套运行环境下的书库安装与落盘机制进行了严格核对：

1. **三套适配器现状对比**：
   - **Electron 桌面端**（`DesktopBookManager`）：已有 `validateAbpBundle` 校验，采用 `staging → backup → rename → 失败回滚` 机制，已达标；
   - **Web 浏览器端**（`WebContentProvider`）：虽调用 `validateAbpBundle`，但流程为“先写 manifest 再逐章写入 IndexedDB”。若中间某个章节由于配额超限或网络异常中断，会导致“书库已展示该书但内容缺章”的半残状态；
   - **开发态 HTTP 上传**（`dev-server-plugin.mjs`）：**严重漏洞**，仅检查 `manifest.colSlug` 与 `manifest.slug` 是否存在，完全未校验 `schemaVersion`、未校验章节完整性，且采用原地覆盖写入，重装时不清除旧章节（降级残留）。
2. **缺乏统一一致性校验引擎**：
   - 现有的 `validateAbpBundle`（`content-package.ts`）仅校验基本 JSON schema，未检查深度一致性（如：章节 map 的 key 是否与 chapterSlug 严格匹配、manifest 中的章节 slug 是否全部存在于 chapters 数据包中、entryPoint 是否有效存在、路径是否存在目录遍历逃逸风险）。

---

## 2. 核心架构决策 (Decisions)

### 2.1 决策 1：统一校验唯一入口 (Single Source of Install Validation)

**决策结论**：**在 `src/services/content-provider/install-validation.ts` 中封装唯一的 `validateInstallPayload(raw: unknown): AbpBundlePayload`，严禁各端手写松散校验。**

**校验规则集（在 `validateAbpBundle` 基础上扩展）**：
1. **Schema 校验**：必须通过 `validateAbpBundle(raw)`，确保 `schemaVersion === '1.0.0'`；
2. **章节键值对齐**：每个 `chapters[key]` 的 `chapter.chapterSlug` 必须严格等于 `key`，且 `chapter.path` 必须为规范相对路径 `chapters/${key}.json`；
3. **清单章节完备性**：`manifest.sections[].chapters[].slug` 所声明的每一个 slug，必须 100% 存在于 `chapters` 映射字典中；
4. **入口章节有效性**：`manifest.entryPoint` 必须存在于 `chapters` 集合中；
5. **路径安全防护 (Path Traversal Guard)**：所有 slug 与 path 严禁包含 `..`、`\`、冒号、非法协议头或绝对路径前缀，彻底封堵路径遍历逃逸隐患。

### 2.2 决策 2：三端原子安装语义唯一化 (Atomic Installation Semantics)

**统一标准流程**：
$$\text{install(abp)} \longrightarrow \text{validate} \longrightarrow \text{write staging} \longrightarrow \text{atomic commit} \longrightarrow \text{metadata register}$$

**各环境具体实施方案**：
1. **Web 端 (IndexedDB)**：
   - **逆序提交**：先并发/分批写入所有 `chapters` 记录；全部章节成功落盘后，最后一步写入 `manifest` 记录；
   - **异常自动回滚**：任何一章写入失败或抛错，立即触发 `deleteBook` 清理已写入的孤立章节；
   - **进度真实性**：在所有数据完全写入前，严禁提前通知 `onProgress(100)`；失败时必须向调用方抛出明确错误。
2. **开发态 HTTP 服务端 (`dev-server-plugin.mjs`)**：
   - 采用标准三段式重命名事务：
     - 写入临时隔离目录：`.tmp/dev-abp-packs/<bookKey>.__staging_<timestamp>`；
     - 写毕校验通过后，若已存在目标目录，先将其重命名为 `.__backup_<timestamp>`；
     - 将 staging 目录重命名为正式目标目录；
     - 删除 backup 目录；
     - 若中途发生任何异常，立即从 backup 目录恢复并清理 staging。
3. **Electron 桌面端**：
   - 保持现有高可靠 staging + rollback 机制，仅增补边界契约测试。

**通用不变量**：安装未最终成功前，外部书库列表（无论是 IndexedDB、目录扫描还是 `library-registry.json`）**绝对不可见**该书籍。

### 2.3 决策 3：重复安装幂等性与旧章节彻底清理 (Idempotency & Stale Cleanup)

**决策结论**：**重复安装同一书籍必须保证结果幂等，降级或精简安装时必须彻底物理删除旧章节。**

**规则**：
1. 若新安装包的章节集合小于旧包（降级安装/章节精简），旧包中存在而新包中不存在的物理文件/记录必须被完全清理，严禁滞留磁盘；
2. 卸载操作（`removeBook`）：必须物理删除内容解包目录、IndexedDB 章节记录、注册表条目与相关缓存，断言零残留。

### 2.4 决策 4：能力矩阵与显式错误规范 (Capability Matrix & Explicit Errors)

对于各端不支持的特性，禁止静默忽略或伪装成功，统一使用显式错误类型抛出：

| 操作 | Electron 桌面端 | Web 浏览器端 | 开发态 HTTP 上传 |
| :--- | :--- | :--- | :--- |
| `installBookFromAbp` | 支持（物理解包） | 支持（IndexedDB 离线存储） | 支持（开发态临时目录） |
| `getBookManifest` | 支持 | 支持 | 支持 |
| `getChapterPayload` | 支持 | 支持 | 支持 |
| `removeBook` | 支持（彻底删除） | 支持（清空 IndexedDB） | 支持（删除目录与 registry） |
| `installToDisk` | 支持 | **不支持**（显式抛错 `OPERATION_NOT_SUPPORTED`） | 支持 |

---

## 3. 门禁规范、受影响文件与红线 (Gate Specification)

### 3.1 允许修改与新增文件清单 (Allowed Files)

```text
src/services/content-provider/install-validation.ts (新增，统一一致性校验引擎)
src/server/plugins/library/dev-server-plugin.mjs     (重构上传校验与原子 staging)
src/services/content-provider/web-provider.ts       (Web 原子写入与失败回滚)
electron/services/book-manager.ts                  (仅允许抽取常量/注释，核心逻辑不动)
tests/unit/install-validation.test.ts              (新增，校验用例与路径逃逸测试)
tests/unit/content-provider.test.ts                (扩展现有 Web 安装原子性与回滚测试)
tests/unit/electron-services.test.ts               (扩展现有测试)
docs/architecture/ADR-LIBRARY-CONTRACT-2026-11-13.md (本决策文档)
docs/architecture/evidence/p1-c-evidence.json      (证据产物)
```

### 3.2 严格禁止文件清单 (Forbidden Files)

- `src/types/content-package.ts`（ABP Schema 1.0.0 不改动）；
- `content-sources/collections/**/*`（13 本书正文源码不改动）；
- `package.json`（不引入新依赖）；
- `electron/services/book-manager.ts`（禁止推倒重写已达标的桌面安装机制）；
- Release v0.0.4 资产与 `latest.yml`。

### 3.3 验收命令 (Verification Commands)

```powershell
npm run check:types
npx vitest run tests/unit/install-validation.test.ts tests/unit/content-provider.test.ts tests/unit/electron-services.test.ts
npm test
```
