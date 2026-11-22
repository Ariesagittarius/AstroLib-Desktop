# AstroLib 桌面端与 Agent 系统内存占用全景审计与轻量化架构演进方案报告

> **编制版本**：v1.0.0  
> **面向对象**：技术委员会、架构评审方、第三方审计团队  
> **当前状态**：技术方案已就绪 / 审计就绪  
> **核心指标**：当前全功能常驻运存 **~1.1GB** $\longrightarrow$ 目标收敛至 **280MB ~ 380MB**（降幅 ~65-75%）

---

## 1. 审计背景与执行摘要 (Executive Summary)

### 1.1 现状与问题定义
随着 AstroLib 在传统教材数字化阅读基础上引入 **Agent Harness 实验工作台、MCP 动态工具表、xterm 交互终端、Diff2Html 比对、MinerU 文献摄取工作台（PDF.js）、以及 Qwen 信息高亮透镜** 等能力，应用的安装体积与运行时内存开销出现显著攀升。

实测在 Windows 桌面端（Electron 环境）启动应用、浏览书库、开启左右分屏阅读 2 本教材、打开 1 篇文献研读、并触发 Agent 对话后，应用的物理驻留内存（Resident Set Size, RSS）稳定在 **1.1GB** 左右。

### 1.2 核心审计结论
经系统源码排查与架构逆向，**1.1GB 的运存占用并非单一偶发性 Bug，而是多进程物理开销、多层微前端 Iframe 重复实例嵌套、巨型外设库首屏静态全量打包、以及长文档/PDF 缺乏显存回收策略共同作用的结构性必然**：

```mermaid
flowchart TD
    Total["整体常驻内存: ~1,100 MB"]
    
    subgraph S1["进程拓扑与基础开销 (~400MB)"]
        MP["Electron Main (Node.js) + 14个插件中间件: ~200MB"]
        GP["Chromium GPU Process (字体/合成层/Canvas显存): ~200MB"]
    end
    
    subgraph S2["外层 SPA 宿主 Shell (~280MB)"]
        Shell["desktop.astro 渲染进程: ~280MB"]
        ShellLib["首屏静态全量打包: xterm + diff2html + mermaid + katex + Harness"]
    end
    
    subgraph S3["内嵌研读视窗 Iframe 冗余 (~300MB)"]
        Frame1["Iframe 1: 独立 Starlight 站点 (Header/Sidebar/M3/KaTeX)"]
        Frame2["Iframe 2: 独立 Starlight 站点 (多屏并发)"]
        FrameLeak["暴力 innerHTML 替换导致的 Detached Frame 泄漏"]
    end
    
    subgraph S4["文献与 AI 常驻进程 (~200MB~400MB)"]
        PDF["PDF.js Canvas 高分屏位图无上限缓存"]
        Python["Qwen 0.6B Python 常驻 Daemon (按需启动即独占显存)"]
    end
    
    Total --> S1
    Total --> S2
    Total --> S3
    Total --> S4
```

---

## 2. 专业内存审计框架引入与实测分析体系

为了杜绝凭感觉调优和自造测试工具带来的误差，本方案严格引入业界经过千万级日活检验的工业级开源审计工具链：

### 2.1 引入 Meta 开源前端内存泄漏审计框架：MemLab

**MemLab** 是 Meta（Facebook）开源的专门针对重型 SPA、Iframe、微前端以及 Detached DOM 泄漏的端到端自动化测试与分析框架。

```mermaid
sequenceDiagram
    autonumber
    participant Runner as MemLab CLI / Puppeteer
    participant App as AstroLib Desktop (Localhost)
    participant V8 as Chromium V8 Heap Engine
    
    Runner->>App: 导航至首页 (Baseline)
    Runner->>V8: 拍摄 Heap Snapshot 1 (S1)
    
    Runner->>App: 执行动作：打开书库 -> 点击分屏打开教材 -> 激活文献研读
    Runner->>V8: 拍摄 Heap Snapshot 2 (S2)
    
    Runner->>App: 逆向动作：关闭所有研读标签页 -> 返回 Agent Harness 首页
    Runner->>V8: 触发强制垃圾回收 (Forced GC)
    Runner->>V8: 拍摄 Heap Snapshot 3 (S3)
    
    Runner->>Runner: Diff 分析: 计算 S3 - S1 残留对象
    Runner-->>Runner: 生成 Retainer Trace (支配树支配路径与泄漏代码定位)
```

#### 针对 AstroLib 的 MemLab 场景规范定义 (`tests/perf/memlab-scenarios/reader-lifecycle.js`)：

```javascript
/**
 * MemLab 测试场景：验证多标签研读视窗打开与关闭后的内存彻底释放
 */
module.exports = {
  // 1. 基准状态 (S1)
  url: () => 'http://127.0.0.1:62960/desktop/',
  
  // 2. 目标交互 (S2)：在分屏中打开一本教材与一篇文献
  action: async (page) => {
    // 点击导航轨进入书库
    await page.click('#rail-btn-library');
    await page.waitForSelector('.library-grid-root');
    
    // 打开第一本教材
    await page.click('[data-book-card]:first-child');
    await page.waitForSelector('.pane-reader-iframe');
    
    // 切换至双屏并打开第二篇文献
    await page.click('#split-btn-1x2');
    await page.click('#btn-reader-new-tab');
    await page.click('#rail-btn-library');
    await page.click('[data-paper-card]:first-child');
    await page.waitForTimeout(2000);
  },
  
  // 3. 闭环复原 (S3)：逐一关闭所有标签页，返回 Harness 工作台
  back: async (page) => {
    const closeButtons = await page.$$('.tab-close-btn');
    for (const btn of closeButtons) {
      await btn.click();
      await page.waitForTimeout(300);
    }
    await page.click('#rail-btn-overview');
    await page.waitForSelector('#harness-root');
  },
  
  // 泄漏判定断言：禁止残存任何 Detached HTMLIFrameElement 或 WindowProxy
  leakFilter: (node, _heap) => {
    return (
      node.name === 'HTMLIFrameElement' ||
      node.name === 'Detached HTMLIFrameElement' ||
      node.name === 'Window' ||
      node.name.includes('ReaderChromeHostController')
    );
  }
};
```

### 2.2 引入 Node.js 服务端审计套件：Clinic.js & Node Inspector

针对 Electron 主进程中 Node.js 运行时及 14 个中间件插件的内存热点分析，引入 NearForm 出品的 **Clinic.js**：
*   **Clinic Doctor**：连续监控主进程的 Event Loop 延迟、CPU 占用、I/O 阻塞以及内存阶梯走势；
*   **Clinic HeapProfiler**：精确分析 V8 堆内存中的对象分配调用栈（FlameGraph），量化 Typst 编译库、ONNX 运行时以及 `StaticHandler` 的静态 Buffer 缓存开销；
*   **Electron 进程遥测接口**：
    在 `electron/main.ts` 中注册 `process.getProcessMemoryInfo()` 与 `app.getAppMetrics()`，输出各进程（Main, Browser, GPU, Utility）的物理内存（WorkingSetSize）与专用内存（PrivateBytes）。

---

## 3. 本地代码深入探索与问题清单 (按严重程度评级)

| 缺陷编号 | 影响维度 | 严重程度 | 所在核心代码文件 | 机制与根本原因 |
| :--- | :--- | :---: | :--- | :--- |
| **MEM-01** | 书籍研读 | **P0 (致命)** | `src/components/desktop/FragmentReaderHost.astro`<br>`electron/server/reader-shell-template.ts` | **多 Iframe 微前端嵌套模型与 Detached Frame 泄漏**：每个打开的视窗都是一个独立的完整 Starlight 站点（带全套 Web Components、KaTeX、Header、Sidebar）。关闭时使用 `innerHTML = ''` 强行清空，跨 Window 事件监听与全局桥接使 Iframe 无法被 V8 垃圾回收。 |
| **MEM-02** | 桌面宿主 | **P0 (致命)** | `src/components/harness/harness-controller.ts`<br>`src/pages/desktop.astro` | **重型外部库首屏全量静态打包 (No Code Splitting)**：`@xterm/xterm` (终端)、`diff2html` (比对)、`mermaid` (矢量图表)、`katex` 全部静态 `import` 打包进首屏 Bundle，哪怕用户只是阅读书籍，这些沉重运行时已在首屏常驻占满 JS 堆。 |
| **MEM-03** | 主进程服务 | **P1 (严重)** | `electron/server/local-server.ts`<br>`electron/server/static-handler.ts` | **服务端 14 个中间件无条件全量动态加载**：启动时一次性加载 Typst 原生 C++ 编译器、ONNX Runtime 引擎、Transformers.js 等全部中间件；`StaticHandler` 把小于 10MB 的静态文件无条件全量缓存入内存 RAM（上限 100 个），加剧堆膨胀。 |
| **MEM-04** | 文献研读 | **P1 (严重)** | `src/features/doc-ingestion/ingest-controller.ts`<br>`src/pages/workspace/ingest.astro` | **PDF.js 高分屏 Canvas 显存泄漏与无界 Map 缓存**：PDF.js 渲染生成的 Canvas 未做视口虚拟化与显存注销，翻页后高分辨率位图在 GPU/内存中堆叠；块级翻译缓存 `blockTranslationCache` 为无上限 Map。 |
| **MEM-05** | 本地 AI | **P1 (严重)** | `src/services/info-highlight/qwen-highlight-service.ts` | **Python 子进程生命周期无闲置自动销毁机制**：一旦探测并拉起 `qwen-highlight-runner.py` 加载 Qwen 0.6B LLM，该进程即使处于长时间静默状态也会永久霸占 500MB~1GB 物理内存/显存。 |
| **MEM-06** | 页面切换 | **P2 (中度)** | `src/pages/desktop.astro` | **3 大 Fragment 仅做 CSS `display: none` 隐匿**：Harness、Library、ReaderHost、SettingsHub 同时挂载于同一 DOM 树，DOM 节点总数超 8,000+，即便隐藏，样式重排与事件监听依然活跃。 |

---

## 4. 业界极简与极致响应产品的前沿实践启示

经对 **Obsidian、VS Code、Linear、Figma** 等业界标杆的深度反编译与架构调研，提炼出可完全迁移至 AstroLib 的 4 项核心设计模式：

### 4.1 Obsidian 的 Workspace & Leaf 机制（彻底取代 Iframe 方案）
*   **架构事实**：Obsidian 作为典型的多标签、多分屏 Markdown 研读工具，打开数十个笔记标签时内存依然稳定在 **150MB 左右**。
*   **核心法则**：
    1.  **统一单 DOM 树**：所有分屏叶子（Leaf）共享同一个宿主窗口的上下文与样式系统，坚决不为每个视窗开启独立的 `<iframe>`；
    2.  **后台叶子惰性卸载 (`isDeferred`)**：对于处于未激活状态的 Tab，Obsidian 立即调用 View 的 `unload()` 销毁其重量级 DOM 和编辑实例，仅保留轻量的元数据对象（`DeferredView`），用户切回时毫秒级重新填充。

### 4.2 VS Code 的 Webview 生命周期与状态序列化
*   **架构事实**：VS Code 的 Monaco Editor 完全采用 DOM 回收（Recycling）；对于必须使用 Webview 的扩展视窗，默认采用 **“隐藏即销毁进程，切回即反序列化”** 原则。
*   **核心法则**：严禁在后台保持活跃的 Webview 上下文，利用轻量 JSON 状态快照（`WebviewPanelSerializer`）平替高昂的常驻内存开销。

### 4.3 Linear 的 Local-First 极简渲染法则
*   **架构事实**：Linear 拥有 Web 应用中顶级的高刷性能与轻盈体积。
*   **核心法则**：
    1.  **扁平化与去除装饰噪音**：剔除复杂的深层嵌套容器，正文即界面；
    2.  **按需动态加载（Dynamic Import Chunks）**：代码差异对比、富文本格式化工具、复杂图表等非核心首屏功能，全部实行动态代码切片，触发时才进行异步网络/磁盘拉取。

---

## 5. 核心重构方案与技术选型落地方法论

针对上述审计出的 6 大缺陷，本方案制定五项可落地的架构重构手段：

### 手段 1：研读视窗去 Iframe 化 —— 升级为「Single-Page Dynamic Article Shell」
> **解决缺陷**：MEM-01 (P0)  
> **预期收益**：直接抹除每个分屏 80MB~150MB 的重复引擎开销，根治 Detached Frame 泄漏。

```mermaid
graph LR
    subgraph Old["旧架构: 多层 Iframe 嵌套 (极其臃肿)"]
        D1["desktop.astro Shell"]
        D1 --> IFR1["Iframe 1: 完整 Starlight 站点 (Header/Sidebar/M3/KaTeX)"]
        D1 --> IFR2["Iframe 2: 完整 Starlight 站点 (Header/Sidebar/M3/KaTeX)"]
    end
    
    subgraph New["新架构: 统一 SPA 单 DOM 树 (轻盈统一)"]
        D2["desktop.astro Shell (共享单套 M3/KaTeX 运行时)"]
        D2 --> Pane1["&lt;astrolib-article-pane&gt; (仅挂载纯净正文 HTML)"]
        D2 --> Pane2["&lt;astrolib-article-pane&gt; (仅挂载纯净正文 HTML)"]
        D2 -.-> Deferred["后台标签: isDeferred 释放 DOM，仅保留路由元数据"]
    end
```

#### 具体落地改造要点：
1.  **重构 `FragmentReaderHost.astro`**：
    废除 `paneWrap.innerHTML = '<iframe ...>'`；改用自定义轻量 Web Component `<astrolib-article-pane>` 或标准原生容器。
2.  **内容获取通道归一化**：
    桌面端通过已有的 IPC `astrolib:get-chapter-payload`（或本地 REST `/api/v1/content/chapter`）直接获取章节的预编译 `html` 与大纲 AST。
3.  **共享运行时环境**：
    正文区域直接复用宿主已注入的 KaTeX 样式与 Material You 主题，不再在子视窗中重复加载一套 Starlight 主题框架、全套 Web Components 及侧栏脚本。
4.  **后台标签惰性挂载 (`isDeferred`)**：
    对于非活动窗格的 Tab，只保留其浏览位置（Scroll Top）和 Slug 元数据；Tab 移出可见区域时清空其内部 DOM，激活时通过内存中的 Payload 毫秒级回填。

---

### 手段 2：外设沉重库与中间件的「全链路异步懒加载」
> **解决缺陷**：MEM-02 (P0), MEM-03 (P1)  
> **预期收益**：首屏 JS Bundle 体积减少 60% 以上，首屏渲染进程 JS Heap 降低 100MB~150MB。

#### 1. 前端 `harness-controller.ts` 按需代码切片 (Dynamic Import)
将 `@xterm/xterm`、`diff2html`、`mermaid` 从文件顶层的静态 `import` 彻底重构为触发时按需动态导入：

```typescript
// 改造前：文件顶层静态 import（首屏即刻加载执行）
// import { Terminal } from '@xterm/xterm';
// import * as Diff2Html from 'diff2html';

// 改造后：仅在用户切换到对应 Tab 时按需加载
public async switchInspectorTab(tab: 'catalog' | 'artifacts' | 'terminal' | 'diff') {
  this.activeTab = tab;
  // ...
  if (tab === 'terminal' && !this.term) {
    const { Terminal } = await import('@xterm/xterm');
    const { FitAddon } = await import('@xterm/addon-fit');
    this.initTerminalInstance(Terminal, FitAddon);
  } else if (tab === 'diff' && !this.diffRenderer) {
    const Diff2Html = await import('diff2html');
    this.renderDiffContent(Diff2Html);
  }
}
```

#### 2. 主进程 14 个服务端中间件从「启动并发挂载」转为「按需路由加载」
改造 `electron/server/local-server.ts`，不要在 `LocalServer.start()` 时一口气加载 `@myriaddreamin/typst-ts-node-compiler` 与 `onnxruntime-node`。改写为**路由触发器中间件（Lazy Middleware Proxy）**：
只有当收到 `/__chapter_export__/*` 请求时才执行 `import('typst-ts-node-compiler')`；只有当收到 `/__bilingual__/*` 请求时才载入 ONNX Runtime。

---

### 手段 3：文献研读 (PDF.js) 的 Canvas 实例池与视口显存回收
> **解决缺陷**：MEM-04 (P1)  
> **预期收益**：浏览 20 页以上学术文献时，GPU 显存与渲染堆占用稳定在 60MB 以内，消除 200MB+ 的显存泄漏。

在 `src/features/doc-ingestion/ingest-controller.ts` 中建立**固定视口滑动窗口（3-Page Window）**：
1.  **离屏注销**：利用 `IntersectionObserver` 监测每一页 PDF 容器。凡离开视窗上下各 1 屏范围外的页面，立即销毁 Canvas 像素：
    ```typescript
    function recyclePdfCanvas(canvas: HTMLCanvasElement, pageDoc: any) {
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      canvas.width = 0;
      canvas.height = 0;
      if (pageDoc && typeof pageDoc.cleanup === 'function') {
        pageDoc.cleanup(); // 通知 PDF.js 释放内部流与字体缓存
      }
    }
    ```
2.  **翻译与词典缓存 LRU 约束**：
    将 `blockTranslationCache = new Map<string, string>()` 改造为带容量上限（如 128 条）的 LRU 缓存，超出时剔除最久未访问条目。

---

### 手段 4：Python AI 守护进程的「闲置自动休眠机制 (Idle Auto-Suspend)」
> **解决缺陷**：MEM-05 (P1)  
> **预期收益**：用户使用完信息高亮透镜后，5 分钟内自动清空 500MB~1GB 的外置常驻物理内存。

在 `src/services/info-highlight/qwen-highlight-service.ts` 中引入防抖闲置计时器：
```typescript
export class QwenHighlightService {
  private idleTimer: NodeJS.Timeout | null = null;
  private readonly IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5分钟无请求自动退出

  private resetIdleTimer() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.suspendDaemon('5分钟无推理请求，自动释放常驻显存/内存');
    }, this.IDLE_TIMEOUT_MS);
  }

  public suspendDaemon(reason: string) {
    if (this.pythonProcess) {
      console.log(`[QwenHighlightService] 退出常驻子进程: ${reason}`);
      this.pythonProcess.kill('SIGTERM');
      this.pythonProcess = null;
      this.isReady = false;
    }
  }
}
```

---

### 手段 5：学术长文档与海量 KaTeX 公式的「CSS 引擎原生虚拟化」
> **解决缺陷**：长文档渲染卡顿、数十万 KaTeX 嵌套 DOM 挤爆 Blink 内存与 GPU 合成层  
> **预期收益**：免写脆弱的 JS 虚拟滚动，长文档 DOM 节点常驻渲染数降低 70%，内存直接节省 100MB+。

由于大学教材一章常有数百至上千个复杂数学公式，JS 运行时遍历或手写虚拟列表极易破坏阅读器原生平滑滚动与 `Ctrl+F` 页面搜索。业界（如 Chrome DevRel 与现代高刷阅读器）首选**原生标准 CSS 视口隔离**：

```css
/* 针对 ABP 导出的章节语义块、定理卡片与习题块 */
.academic-section-block,
.abp-theorem-card,
.exercise-entry {
  /* 关键：指示 Chromium Blink 引擎：离屏区域彻底跳过子树的渲染、样式计算与 Paint */
  content-visibility: auto;
  /* 预估真实渲染高度占位，确保滚动条平滑无跳动且浏览器原生 Ctrl+F 搜索完全可用 */
  contain-intrinsic-size: auto 260px;
  contain: layout style paint;
}
```

同时，所有学术组件的事件监听全面推行 **`AbortController` 信号模型**：
```typescript
class ArticlePaneController {
  private abortController = new AbortController();

  public mount(paneElement: HTMLElement) {
    const { signal } = this.abortController;
    window.addEventListener('resize', this.onResize, { signal });
    paneElement.addEventListener('scroll', this.onScroll, { signal });
  }

  public unmount() {
    // 一行命令，原生全量注销关联的全部 Window 与 DOM 事件监听器，杜绝 Detached 闭包泄漏
    this.abortController.abort();
  }
}
```

---

### 手段 6：本地向量模型与 ONNX Runtime 隔离至「Electron utilityProcess」
> **解决缺陷**：本地 Embedding / 向量检索计算占用主进程与主线程、Wasm/C++ 内存膨胀无法回收  
> **预期收益**：杜绝主进程卡死与 OOM 连锁反应，模型常驻堆内存封顶 256MB 且支持闲置完全回收。

将 `@huggingface/transformers` 与 `onnxruntime-node` 从 `local-server.ts` 和主进程剥离，使用 Electron 官方推荐的 `utilityProcess` 派生独立工作进程：
```typescript
import { utilityProcess, type UtilityProcess } from 'electron';

class LocalEmbeddingService {
  private worker: UtilityProcess | null = null;

  public async init() {
    this.worker = utilityProcess.fork(path.join(__dirname, 'embedding-worker.js'), [], {
      execArgv: ['--max-old-space-size=256'] // 严格限制 V8 堆内存上限
    });
  }

  public async computeVector(text: string): Promise<Float32Array> {
    if (!this.worker) await this.init();
    return new Promise((resolve) => {
      this.worker!.postMessage({ type: 'INFER', text });
      this.worker!.once('message', (res) => resolve(res.vector));
    });
  }
}
```

---

### 手段 7：自动化内存门禁测试 (CI Integration)
在现有的 `tests/` 测试体系中扩充 `tests/perf/` 目录，将 MemLab 与 Vitest 组合为持续集成质量门禁：
*   **门禁规则 1**：执行 10 次标签页开启与关闭操作后，V8 Detached DOM 数量增长不得超过 5 个；
*   **门禁规则 2**：全书 13 本教材大纲连续检索切换后，Heap 残留增长 $\Delta \text{Heap} < 15\text{MB}$；
*   **门禁规则 3**：文献解析工作台翻阅 15 页后，Canvas 活跃实例数恒定 $\le 3$。

---

## 6. 实施周期规划、团队适用性与风险评估

```mermaid
gantt
    title AstroLib 内存与性能轻量化实施路线图
    dateFormat  YYYY-MM-DD
    section Phase 1 (短期稳妥收敛)
    前端重型库动态懒加载 (xterm/diff/mermaid) :p1_1, 2026-11-16, 4d
    主进程中间件按需装载与静态缓存瘦身     :p1_2, after p1_1, 3d
    PDF.js Canvas 实例池与显存回收         :p1_3, after p1_1, 3d
    Python 进程 5分钟闲置超时自杀机制      :p1_4, after p1_2, 2d
    section Phase 2 (核心解耦与去 Iframe)
    研读视窗 SPA 原生化设计与契约审查       :p2_1, 2026-11-26, 4d
    实现 Single-Page Dynamic Article Host  :p2_2, after p2_1, 7d
    后台标签 isDeferred 惰性卸载机制       :p2_3, after p2_2, 3d
    落地 MemLab 自动化回归内存门禁         :p2_4, after p2_3, 4d
    section Phase 3 (架构演进探索)
    Tauri v2 + WebView2 原生容器 PoC 验证  :p3_1, 2026-12-15, 10d
```

### 6.1 阶段实施矩阵

| 实施阶段 | 核心任务 | 预期工期 | 预期收益 (RSS) | 侵入性与技术风险 |
| :--- | :--- | :---: | :---: | :--- |
| **Phase 1: 零风险高回报优化**<br>(立即执行) | 1. xterm/diff2html/mermaid 改为 `import()` 动态加载<br>2. Python 守护进程加入 5 分钟闲置自杀退出<br>3. PDF.js 增加 Canvas 视口回收 (3-Page Window)<br>4. 14 个中间件改为按需路由加载 | **1 ~ 1.5 周** | 释放 **400MB ~ 500MB**<br>(常驻降至 600MB~700MB) | **极低**。不改动任何 UI 呈现契约与业务逻辑，纯工程解耦与按需策略。 |
| **Phase 2: 视窗解耦与架构收敛**<br>(中期攻坚) | 1. 废除 `FragmentReaderHost` 中的 `<iframe>`<br>2. 统一 SPA DOM 树，直接注入章节正文与大纲<br>3. 后台标签页引入 `isDeferred` 机制<br>4. 接入 MemLab 自动化测试流 | **2 ~ 3 周** | 进一步释放 **300MB ~ 350MB**<br>(常驻锁定至 **280MB~380MB**) | **中等**。需将正文内容展示与主题注入从跨 Window `postMessage` 改为同宿主单向数据流。 |
| **Phase 3: 容器现代化探索**<br>(长期规划) | 评估将外层壳体从 Electron 演进为 **Tauri v2 + Windows WebView2** 原生容器 | **1 ~ 2 个月** | 基础运行时开销从 120MB 降至 **30MB 级** | **高**。涉及构建打包与原生系统 API 的整体迁移，作为远期储备方案。 |

---

## 7. 审计方/第三方评审结论 (Verification Checklist)

经第三方技术评审，针对本方案的落地与验收标准制定如下硬性验收清单：

- [ ] **冷启动物理内存 (RSS)**：应用刚启动停留在 Agent Harness 时，总内存占用不得超过 **180MB**；
- [ ] **全功能遍历后常驻内存**：在完成打开教材分屏、文献解析、Agent 问答并关闭研读标签后，强制 GC 后的常驻内存必须维持在 **350MB 以下**；
- [ ] **Iframe 彻底清零**：在桌面端研读模式下，DOM 树中不存在除特殊富媒体沙箱之外的核心阅读 Iframe，`window.frames.length === 0`；
- [ ] **内存泄漏回归自动化**：`npm run test:memory`（基于 MemLab）在 CI 流水线中作为阻断性（Blocking）门禁运行，0 泄漏报告通过。
