import { buildSandboxedCanvasHtml } from '../../../features/harness/canvas-sandbox.ts';
import type { ArtifactItem } from '../../../features/harness/types.ts';
import type { HarnessPlugin, PluginContext } from '../types.ts';

const SOURCE_FILE = 'src/plugins/harness/builtin/canvas.plugin.ts';

const CANVAS_SANDBOX_CONTRACT = `创建一个独立运行的沙箱 HTML/CSS/JS 交互画布（类似于 Gemini Canvas）。
【沙箱运行契约（真实保障，勿猜测 fallback）】：
1. Material You 主题：自动注入 --md-sys-color-primary / --md-sys-color-on-primary / --md-sys-color-surface / --md-sys-color-on-surface / --md-sys-color-surface-container(-low|-high|-highest) / --md-sys-color-outline-variant 等变量并支持亮暗实时同步。
2. 字体体系：统一继承 Electron 学术无衬线 --astrolib-canvas-sans (--harness-font-family) 与等宽 --astrolib-canvas-mono。
3. KaTeX 离线全栈：预加载本地 katex、mhchem（支持 \\ce{H2O}）与 auto-render；页面加载后自动渲染 $$...$$、$...$、\\(...\\)、\\[...\\]，动态 DOM 可调 window.renderCanvasMath(el)。
4. 严格离线 CSP：connect-src 'none'，禁止一切外部 CDN/fetch 出网（所有脚本/绘图需纯内联自包含）。
5. 沙箱边界：iframe 采用 sandbox="allow-scripts allow-downloads"（无 allow-same-origin），不可访问 parent.document / localStorage / cookie。
6. 运行时与判据：支持 Worker(blob:) / OffscreenCanvas / WebGL / ResizeObserver；仅当需要交互输入（滑块/拖拽/动态演化）时用本工具，静态卡片用 astro-ui。
创建后可调用 read_canvas_artifact / inspect_canvas_artifact 检查源码、控制台错误、溢出与截屏视觉效果。`;

export const CanvasPlugin: HarnessPlugin = {
  id: 'astrolib.builtin.canvas',
  name: '交互画布与可视化实验台插件',
  version: '1.0.0',
  description: '允许 Agent 创建与增量更新独立运行的沙箱 HTML/CSS/JS 交互画布应用。',
  sourceFile: SOURCE_FILE,
  activate: (context: PluginContext) => {
    context.registerTool({
      name: 'create_canvas_artifact',
      displayName: '创建独立交互画布',
      category: '富交互呈现',
      icon: { type: 'mdicon', value: 'deployed_code' },
      sourceFile: SOURCE_FILE,
      riskLevel: 'read',
      formatActionLabel: (args) => {
        const title = String(args.title || '').trim();
        return title ? `创建交互画布 · ${title}` : '创建独立交互画布';
      },
      description: CANVAS_SANDBOX_CONTRACT,
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '画布应用标题，如 "傅里叶级数合成交互演示"' },
          code: {
            type: 'string',
            description: '自包含 HTML 或 HTML片段（可内含 <style> 与 <script>；勿使用外部不可信 CDN）',
          },
          mode: {
            type: 'string',
            enum: ['interactive', 'html', 'svg'],
            description: '画布类型，默认 interactive',
          },
          summary: { type: 'string', description: '可选：版本说明摘要' },
        },
        required: ['title', 'code'],
      },
      execute: async (args, ctx) => {
        const title = String(args.title || '交互演示画布').trim();
        const code = String(args.code || '').trim();
        const mode = (args.mode === 'html' || args.mode === 'svg' ? args.mode : 'interactive') as
          | 'interactive'
          | 'html'
          | 'svg';
        if (!code) {
          return {
            toolName: 'create_canvas_artifact',
            command: 'create_canvas_artifact',
            success: false,
            summary: '画布代码内容不能为空',
            cardHtml: '',
            contextText: '创建画布失败：code 参数不能为空。',
          };
        }

        const artifactId = `canvas-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const payload = {
          id: artifactId,
          kind: 'canvas' as const,
          title,
          badge: 'Canvas · v1',
          code,
          canvasMode: mode,
        };

        const recordedId = ctx.recordArtifact?.(payload, true) || artifactId;

        return {
          toolName: 'create_canvas_artifact',
          command: 'create_canvas_artifact',
          success: true,
          summary: `已创建交互画布《${title}》`,
          cardHtml: '',
          contextText: `已成功创建交互画布 "${title}" (artifactId: "${recordedId}", mode: "${mode}")。用户可在对话卡片中直接内联展开或在右侧「成果物」宽屏预览；如需迭代修改，请调用 update_canvas_artifact 并传入该 artifactId。`,
          artifact: payload,
          inlineWidget: {
            type: 'canvas_card',
            artifactId: recordedId,
            title,
            mode,
          },
        };
      },
    });

    context.registerTool({
      name: 'update_canvas_artifact',
      displayName: '更新既有交互画布',
      category: '富交互呈现',
      icon: { type: 'mdicon', value: 'edit_square' },
      sourceFile: SOURCE_FILE,
      riskLevel: 'read',
      formatActionLabel: (args) => {
        const title = String(args.title || args.artifactId || '').trim();
        return title ? `更新交互画布 · ${title}` : '更新交互画布';
      },
      description: '向既有的交互画布成果物推送一个新版本，自动保留版本历史供用户回退对比。',
      parameters: {
        type: 'object',
        properties: {
          artifactId: { type: 'string', description: '目标画布成果物 ID' },
          code: { type: 'string', description: '更新后的完整 HTML/CSS/JS 代码' },
          title: { type: 'string', description: '可选：更新后的标题' },
          summary: { type: 'string', description: '可选：本次修改说明' },
        },
        required: ['artifactId', 'code'],
      },
      execute: async (args, ctx) => {
        const artifactId = String(args.artifactId || '').trim();
        const code = String(args.code || '').trim();
        const title = args.title ? String(args.title).trim() : undefined;
        if (!artifactId || !code) {
          return {
            toolName: 'update_canvas_artifact',
            command: 'update_canvas_artifact',
            success: false,
            summary: '缺少 artifactId 或 code',
            cardHtml: '',
            contextText: '更新画布失败：artifactId 与 code 为必填参数。',
          };
        }

        const payload = {
          id: artifactId,
          kind: 'canvas' as const,
          title: title || '更新后的交互画布',
          badge: 'Canvas · Updated',
          code,
          canvasMode: 'interactive' as const,
        };
        const recordedId = ctx.recordArtifact?.(payload, true) || artifactId;

        return {
          toolName: 'update_canvas_artifact',
          command: 'update_canvas_artifact',
          success: true,
          summary: `已推送交互画布新版本 (${args.summary || 'Updated'})`,
          cardHtml: '',
          contextText: `已将画布 "${recordedId}" 更新至新版本。如需自检渲染状态与控制台异常，可调用 inspect_canvas_artifact。`,
          artifact: payload,
          inlineWidget: {
            type: 'canvas_card',
            artifactId: recordedId,
            title: title || '交互画布',
            mode: 'interactive',
          },
        };
      },
    });

    context.registerTool({
      name: 'read_canvas_artifact',
      displayName: '回读交互画布源码与遥测',
      category: '富交互呈现',
      icon: { type: 'mdicon', value: 'code' },
      sourceFile: SOURCE_FILE,
      riskLevel: 'read',
      formatActionLabel: (args) => `读取画布源码 · ${String(args.artifactId || '')}`,
      description:
        '回读指定 Canvas 成果物的当前版本号、完整 HTML 源码及已采集的前端 iframe 运行遥测快照（consoleErrors / overflow / KaTeX 状态），用于精准增量修改。',
      parameters: {
        type: 'object',
        properties: {
          artifactId: { type: 'string', description: '目标 Canvas 成果物 ID' },
        },
        required: ['artifactId'],
      },
      execute: async (args, ctx) => {
        const artifactId = String(args.artifactId || '').trim();
        const art = ctx.getArtifact?.(artifactId) as ArtifactItem | undefined;
        if (!art) {
          return {
            toolName: 'read_canvas_artifact',
            command: 'read_canvas_artifact',
            success: false,
            summary: `未找到画布 ${artifactId}`,
            cardHtml: '',
            contextText: `未在当前成果物仓找到 artifactId="${artifactId}" 的画布记录。`,
          };
        }

        const versions = art.versions || [];
        const activeIdx = art.activeVersionIndex ?? Math.max(0, versions.length - 1);
        const telemetryStr = art.canvasTelemetry
          ? JSON.stringify(art.canvasTelemetry, null, 2)
          : '（画布尚未被用户展开渲染，尚无浏览器端实时遥测；可直接调用 inspect_canvas_artifact 进行离屏验证）';

        return {
          toolName: 'read_canvas_artifact',
          command: 'read_canvas_artifact',
          success: true,
          summary: `已回读《${art.title}》(${art.badge})`,
          cardHtml: '',
          contextText: [
            `Canvas Artifact: ${art.id}`,
            `标题: ${art.title}`,
            `版本: ${art.badge} (历史快照数 ${versions.length}, 当前索引 ${activeIdx})`,
            `已记录遥测:\n${telemetryStr}`,
            `当前源码:\n\`\`\`html\n${art.code || ''}\n\`\`\``,
          ].join('\n\n'),
        };
      },
    });

    context.registerTool({
      name: 'inspect_canvas_artifact',
      displayName: '视觉与控制台自检 Canvas 画布',
      category: '富交互呈现',
      icon: { type: 'mdicon', value: 'preview' },
      sourceFile: SOURCE_FILE,
      riskLevel: 'read',
      formatActionLabel: (args) => `自检画布渲染 · ${String(args.artifactId || '')}`,
      description:
        '在 Electron 离屏浏览器渲染并检查指定 Canvas 画布，返回真实 consoleErrors、横向/纵向溢出、KaTeX 公式节点/报错统计及高分辨率首屏截图（视觉模型可直接看图排版查错）。',
      parameters: {
        type: 'object',
        properties: {
          artifactId: { type: 'string', description: '目标 Canvas 成果物 ID' },
          width: { type: 'number', description: '可选：检测视口宽度，默认 900' },
          height: { type: 'number', description: '可选：检测视口高度，默认 620' },
        },
        required: ['artifactId'],
      },
      execute: async (args, ctx) => {
        const artifactId = String(args.artifactId || '').trim();
        const art = ctx.getArtifact?.(artifactId) as ArtifactItem | undefined;
        if (!art || !art.code) {
          return {
            toolName: 'inspect_canvas_artifact',
            command: 'inspect_canvas_artifact',
            success: false,
            summary: `未找到画布 ${artifactId}`,
            cardHtml: '',
            contextText: `未在成果物仓找到 artifactId="${artifactId}" 的可执行画布代码。`,
          };
        }

        const sandboxedHtml = buildSandboxedCanvasHtml(art.code, art.title, {
          artifactId: art.id,
        });

        const fetcher = ctx.fetchFn || fetch;
        let captureRes: any = null;
        try {
          const res = await fetcher('/api/v1/content/agent-tools/canvas/capture', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              html: sandboxedHtml,
              width: Number(args.width) || 900,
              height: Number(args.height) || 620,
              darkTheme:
                typeof document !== 'undefined' &&
                document.documentElement.dataset.theme === 'dark',
            }),
          });
          const json = await res.json();
          if (json.success) captureRes = json.data;
        } catch {}

        const storedTele = art.canvasTelemetry;
        if (captureRes && captureRes.available) {
          const lines = [
            `Canvas 离屏质检完成: "${art.title}" (${captureRes.width}×${captureRes.height})`,
            `- 控制台/运行异常 (${captureRes.consoleErrors?.length || 0} 条): ${
              captureRes.consoleErrors?.length
                ? captureRes.consoleErrors.join(' | ')
                : '无报错'
            }`,
            `- 视口溢出: overflowX=${captureRes.overflowX}, overflowY=${captureRes.overflowY}`,
            `- KaTeX 公式节点: ${captureRes.katexNodeCount} 个 (.katex-error 错误节点 ${captureRes.katexErrorCount} 个)`,
            captureRes.screenshotDataUrl
              ? '- 视觉截图已注入本轮视觉通道（无视觉模型会自动降级依赖上述 DOM 遥测自检）'
              : '',
          ].filter(Boolean);

          return {
            toolName: 'inspect_canvas_artifact',
            command: 'inspect_canvas_artifact',
            success: (captureRes.consoleErrors?.length || 0) === 0 && (captureRes.katexErrorCount || 0) === 0,
            summary:
              captureRes.consoleErrors?.length > 0
                ? `画布检出 ${captureRes.consoleErrors.length} 项异常`
                : `画布自检通过 (${captureRes.katexNodeCount} 公式节点)`,
            cardHtml: '',
            contextText: lines.join('\n'),
            visionImage: captureRes.screenshotDataUrl
              ? {
                  dataUrl: captureRes.screenshotDataUrl,
                  label: `Canvas ${art.id} (${art.title})`,
                }
              : undefined,
          };
        }

        const fallbackLines = [
          `Canvas 自检报告 (非 Electron 离屏模式降级): "${art.title}" (${art.id})`,
          captureRes?.note ? `说明: ${captureRes.note}` : '',
          storedTele
            ? [
                `- 已捕获用户展开态 iframe 遥测:`,
                `  - 控制台异常: ${storedTele.consoleErrors.length ? storedTele.consoleErrors.join(' | ') : '无'}`,
                `  - 运行异常: ${storedTele.runtimeExceptions.length ? storedTele.runtimeExceptions.join(' | ') : '无'}`,
                `  - 溢出: overflowX=${storedTele.overflowX}, overflowY=${storedTele.overflowY}`,
                `  - KaTeX: loaded=${storedTele.katexLoaded}, nodes=${storedTele.katexNodeCount}, errors=${storedTele.katexErrorCount}`,
                `  - 注入 CSS 变量数: ${storedTele.cssVarCount}`,
              ].join('\n')
            : '- 提示：当前用户尚未展开内联预览或成果物工作台，尚无运行期 iframe 遥测。可用 read_canvas_artifact 复查源码。',
        ].filter(Boolean);

        return {
          toolName: 'inspect_canvas_artifact',
          command: 'inspect_canvas_artifact',
          success: true,
          summary: storedTele
            ? `已获取画布运行遥测 (${storedTele.katexNodeCount} 公式)`
            : '已完成画布环境与源码状态审计',
          cardHtml: '',
          contextText: fallbackLines.join('\n'),
        };
      },
    });
  },
};
