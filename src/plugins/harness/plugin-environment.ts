/**
 * src/plugins/harness/plugin-environment.ts
 * ============================================================================
 * AstroLib Harness 独立动态插件宿主运行环境 (Plugin Runtime Host Environment)
 * ============================================================================
 * 职责：
 * 1. 纯解耦与可插拔架构：管理所有 HarnessPlugin 实例的生命周期 (activate / deactivate)；
 * 2. 动态指令分发与启发式建议：输入框打字即时返回 suggest 建议，消除编译期写死；
 * 3. 动态内联指令提取与上下文注入：支持自然语言中嵌入指令并自动转化为学术上下文；
 * 4. 动态 Agent Tools 注入、权限仲裁（read-only / workspace / full）与元数据自省。
 * ============================================================================
 */

import type {
  AgentPermissionMode,
  AgentToolDefinition,
  CommandDefinition,
  HarnessPlugin,
  InlineCommandMatch,
  PluginContext,
  SuggestionItem,
  ToolExecutionContext,
  ToolExecutionResult,
  ToolIconSpec,
  ToolMetadata,
  ToolOverrideConfig,
  ToolPermissionDecision,
} from './types.ts';

import { BooksPlugin } from './builtin/books.plugin.ts';
import { TocPlugin } from './builtin/toc.plugin.ts';
import { AstPlugin } from './builtin/ast.plugin.ts';
import { ExercisesPlugin } from './builtin/exercises.plugin.ts';
import { DiffPlugin } from './builtin/diff.plugin.ts';
import { ReadPlugin } from './builtin/read.plugin.ts';
import { AnnotationsPlugin } from './builtin/annotations.plugin.ts';
import { RuntimeToolsPlugin } from './builtin/runtime-tools.plugin.ts';
import { CanvasPlugin } from './builtin/canvas.plugin.ts';
import { KnowledgePlugin } from './builtin/knowledge.plugin.ts';
import { WebSearchPlugin } from './builtin/web-search.plugin.ts';
import { InteractionPlugin } from './builtin/interaction.plugin.ts';
import { UniversalLocatorResolver } from '../../core/content-api/content-locator.ts';

const DEFAULT_TOOL_ICON: ToolIconSpec = { type: 'mdicon', value: 'build' };

const LOCAL_PATH_INSPECT_TOOLS = new Set([
  'list_local_files',
  'read_local_file',
  'inspect_pdf',
  'render_pdf_page',
]);

function isExplicitExternalPath(raw: string): boolean {
  const s = (raw || '').trim();
  if (!s || s === '.' || s === 'workspace' || s === 'sandbox') return false;
  if (s.startsWith('workspace/') || s.startsWith('workspace\\')) return false;
  if (/^[a-zA-Z]:[\\/]/.test(s) || s.startsWith('/') || s.startsWith('\\\\')) {
    return true;
  }
  if (s.includes('..')) return true;
  return false;
}

export class PluginEnvironment {
  private static instance: PluginEnvironment | null = null;

  private plugins = new Map<string, HarnessPlugin>();
  private commands = new Map<string, CommandDefinition>();
  private agentTools = new Map<string, AgentToolDefinition>();
  private toolOwnerMap = new Map<
    string,
    { pluginId: string; pluginName: string; sourceFile: string }
  >();
  private cleanupHooks = new Map<string, Array<() => void>>();

  public static getInstance(): PluginEnvironment {
    if (!PluginEnvironment.instance) {
      PluginEnvironment.instance = new PluginEnvironment();
      PluginEnvironment.instance.initDefaultPlugins();
    }
    return PluginEnvironment.instance;
  }

  private constructor() {}

  private initDefaultPlugins(): void {
    this.registerPlugin(BooksPlugin);
    this.registerPlugin(TocPlugin);
    this.registerPlugin(AstPlugin);
    this.registerPlugin(ExercisesPlugin);
    this.registerPlugin(DiffPlugin);
    this.registerPlugin(ReadPlugin);
    this.registerPlugin(AnnotationsPlugin);
    this.registerPlugin(RuntimeToolsPlugin);
    this.registerPlugin(CanvasPlugin);
    this.registerPlugin(KnowledgePlugin);
    this.registerPlugin(WebSearchPlugin);
    this.registerPlugin(InteractionPlugin);

    // 注册全局定位协议工具与指令
    this.agentTools.set('locate_content', {
      name: 'locate_content',
      displayName: '统一内容协议寻址',
      category: '知识库检索',
      icon: { type: 'mdicon', value: 'my_location' },
      sourceFile: 'src/plugins/harness/plugin-environment.ts',
      riskLevel: 'read',
      exposeAsSlashCommand: '/locate',
      formatActionLabel: (args) => {
        const q = String(args.query || '').trim();
        return q ? `定位教材节点 · "${q}"` : '求解内容定位 URI';
      },
      description:
        '【统一内容定位协议求解器】根据任意自然语言书名、学科、章节模糊名、序号或 URI 唯一反向定位目标教材与章节。返回规范 ContentLocator 与 canonical URI。',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '检索词，如 "06_第1章-三角函数", "数学分析 2.1", "极限", "线性代数"',
          },
        },
        required: ['query'],
      },
      execute: async (args, ctx) => {
        const query = String(args.query || '');
        const locator = UniversalLocatorResolver.resolve(query, ctx.books, ctx.chapters as any);
        return {
          toolName: 'locate_content',
          command: `/locate ${query}`,
          success: locator.confidence !== 'none',
          summary: locator.isBookLevel
            ? `已定位教材《${locator.bookTitle}》(${locator.uri})`
            : `已定位章节《${locator.chapterTitle || locator.chapterSlug}》(${locator.uri})`,
          cardHtml: `<div class="harness-tool-card"><div class="harness-tool-card__body">定位目标: <code>${locator.uri}</code> (置信度: ${locator.confidence})</div></div>`,
          contextText: `【内容定位协议结果 (AURP)】:\nURI: ${locator.uri}\n所属合集: ${locator.colSlug}\n所属书籍: ${locator.bookTitle} (${locator.bookSlug})\n章节 Slug: ${locator.chapterSlug || '整书'}\n置信度: ${locator.confidence}`,
        };
      },
    });
    this.toolOwnerMap.set('locate_content', {
      pluginId: 'astrolib.core.locator',
      pluginName: 'AstroLib 统一资源定位内核',
      sourceFile: 'src/plugins/harness/plugin-environment.ts',
    });

    this.commands.set('/locate', {
      command: '/locate',
      displayName: '统一内容定位',
      description: '通过统一协议 (astrolib://) 或模糊名称反向定位教材与章节。',
      usage: '<书名/章节/URI>',
      icon: { type: 'mdicon', value: 'my_location' },
      execute: async (args, ctx) => {
        const query = (args || '').trim();
        const locator = UniversalLocatorResolver.resolve(query, ctx.books, ctx.chapters as any);
        return {
          toolName: 'locate_content',
          command: `/locate ${query}`,
          success: locator.confidence !== 'none',
          summary: locator.isBookLevel
            ? `定位到教材: 《${locator.bookTitle}》`
            : `定位到章节: 《${locator.chapterTitle || locator.chapterSlug}》`,
          cardHtml: `<div style="font-size:0.9rem;line-height:1.6;">唯一指向源：<code>${locator.uri}</code> · 《${locator.bookTitle}》 (${locator.confidence})</div>`,
          contextText: `【定位结果】: ${locator.uri}`,
        };
      },
    });
  }

  public async registerPlugin(plugin: HarnessPlugin, initialBooks: any[] = []): Promise<void> {
    if (this.plugins.has(plugin.id)) {
      await this.unregisterPlugin(plugin.id);
    }

    this.plugins.set(plugin.id, plugin);
    const disposables: Array<() => void> = [];

    const context: PluginContext = {
      registerCommand: (cmd: CommandDefinition) => {
        const mainKey = cmd.command.toLowerCase();
        this.commands.set(mainKey, cmd);
        disposables.push(() => this.commands.delete(mainKey));

        if (cmd.aliases) {
          for (const a of cmd.aliases) {
            const aliasKey = a.toLowerCase();
            this.commands.set(aliasKey, cmd);
            disposables.push(() => this.commands.delete(aliasKey));
          }
        }
      },
      registerTool: (tool: AgentToolDefinition) => {
        this.agentTools.set(tool.name, tool);
        this.toolOwnerMap.set(tool.name, {
          pluginId: plugin.id,
          pluginName: plugin.name,
          sourceFile: tool.sourceFile || plugin.sourceFile || 'src/plugins/harness/plugin-environment.ts',
        });
        disposables.push(() => {
          this.agentTools.delete(tool.name);
          this.toolOwnerMap.delete(tool.name);
        });
      },
      getBooks: () => initialBooks,
      subscriptions: {
        push: (d) => disposables.push(d.dispose),
      },
    };

    await plugin.activate(context);
    this.cleanupHooks.set(plugin.id, disposables);
  }

  public async unregisterPlugin(pluginId: string): Promise<boolean> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return false;

    if (plugin.deactivate) {
      try {
        await plugin.deactivate();
      } catch {}
    }

    const cleanups = this.cleanupHooks.get(pluginId);
    if (cleanups) {
      for (const fn of cleanups) fn();
      this.cleanupHooks.delete(pluginId);
    }

    this.plugins.delete(pluginId);
    return true;
  }

  public getAllCommands(): CommandDefinition[] {
    return Array.from(new Set(this.commands.values()));
  }

  public getToolDefinition(toolName: string): AgentToolDefinition | undefined {
    return this.agentTools.get(toolName);
  }

  public getToolIcon(
    toolName: string,
    overrides?: Record<string, ToolOverrideConfig>
  ): ToolIconSpec {
    const customIcon = overrides?.[toolName]?.icon;
    if (customIcon && customIcon.value) return customIcon;
    return this.agentTools.get(toolName)?.icon || DEFAULT_TOOL_ICON;
  }

  public getToolActionLabel(toolName: string, args: Record<string, any> = {}): string {
    const def = this.agentTools.get(toolName);
    if (def?.formatActionLabel) {
      try {
        return def.formatActionLabel(args);
      } catch {}
    }
    return def?.displayName || `调用工具 ${toolName}`;
  }

  /**
   * 评估指定工具在当前权限模式与参数下的执行策略
   */
  public evaluateToolPermission(
    toolName: string,
    mode: AgentPermissionMode = 'workspace',
    args: Record<string, any> = {}
  ): { decision: ToolPermissionDecision; reason?: string; targetPath?: string } {
    const tool = this.agentTools.get(toolName);
    if (!tool) return { decision: 'deny', reason: `未注册工具 ${toolName}` };

    const risk = tool.riskLevel || 'read';

    if (mode === 'full') {
      return { decision: 'allow' };
    }

    if (mode === 'read-only') {
      if (risk !== 'read') {
        return {
          decision: 'deny',
          reason: `当前处于「仅查看」只读模式，禁止执行写入或脚本运行工具 (${toolName})`,
        };
      }
      if (LOCAL_PATH_INSPECT_TOOLS.has(toolName)) {
        const candidatePath = String(args.filePath || args.dirPath || args.pdfPath || '');
        if (isExplicitExternalPath(candidatePath)) {
          return {
            decision: 'prompt',
            reason: `只读模式下访问本地路径 "${candidatePath}" 需要您的授权确认`,
            targetPath: candidatePath,
          };
        }
      }
      return { decision: 'allow' };
    }

    // mode === 'workspace'
    if (risk === 'system') {
      return {
        decision: 'prompt',
        reason: `工具 ${toolName} 涉及系统级操作，需要确认放行`,
      };
    }

    if (LOCAL_PATH_INSPECT_TOOLS.has(toolName)) {
      const candidatePath = String(args.filePath || args.dirPath || args.pdfPath || '');
      if (isExplicitExternalPath(candidatePath)) {
        return {
          decision: 'prompt',
          reason: `工作区模式下读取外部本机路径 "${candidatePath}" 需要您的授权确认`,
          targetPath: candidatePath,
        };
      }
    }

    return { decision: 'allow' };
  }

  /**
   * 生成全部注册工具的完整元数据快照（供全局设置中心「Agent 与工具」检查器使用）
   */
  public getToolRegistrySnapshot(
    mode: AgentPermissionMode = 'workspace',
    overrides: Record<string, ToolOverrideConfig> = {}
  ): ToolMetadata[] {
    const list: ToolMetadata[] = [];
    for (const tool of this.agentTools.values()) {
      const owner = this.toolOwnerMap.get(tool.name);
      const ov = overrides[tool.name];
      const defaultIcon = tool.icon || DEFAULT_TOOL_ICON;
      const perm = this.evaluateToolPermission(tool.name, mode, {});
      list.push({
        name: tool.name,
        displayName: ov?.displayName || tool.displayName || tool.name,
        description: ov?.description ?? tool.description,
        defaultDescription: tool.description,
        category: tool.category || '扩展工具',
        pluginId: owner?.pluginId || 'custom',
        pluginName: owner?.pluginName || '动态插件',
        sourceFile: tool.sourceFile || owner?.sourceFile || 'src/plugins/harness/plugin-environment.ts',
        riskLevel: tool.riskLevel || 'read',
        icon: ov?.icon && ov.icon.value ? ov.icon : defaultIcon,
        defaultIcon,
        parameters: tool.parameters,
        slashCommand: tool.exposeAsSlashCommand,
        enabled: ov?.enabled !== false,
        allowedInCurrentMode: perm.decision,
      });
    }
    return list;
  }

  public async getSuggestions(
    rawInput: string,
    ctx: ToolExecutionContext
  ): Promise<SuggestionItem[]> {
    const text = (rawInput || '').trim();
    if (!text.startsWith('/')) return [];

    const parts = text.split(/\s+/);
    const cmdTrigger = parts[0].toLowerCase();
    const argsQuery = parts.slice(1).join(' ').trim();

    if (cmdTrigger === '/') {
      return this.getAllCommands().map((c) => ({
        id: c.command,
        title: `${c.command} ${c.usage || ''}`.trim(),
        subtitle: `${c.displayName} · ${c.description}`,
        badge: '指令',
        icon: c.icon,
        fillCommand: `${c.command} `,
      }));
    }

    const matchedCmd = this.commands.get(cmdTrigger);
    if (matchedCmd) {
      if (matchedCmd.suggest) {
        return await matchedCmd.suggest(argsQuery, ctx);
      }
      return [
        {
          id: matchedCmd.command,
          title: `${matchedCmd.command} ${matchedCmd.usage || ''}`.trim(),
          subtitle: matchedCmd.description,
          badge: '指令',
          icon: matchedCmd.icon,
          fillCommand: `${matchedCmd.command} `,
        },
      ];
    }

    const candidates = this.getAllCommands().filter(
      (c) =>
        c.command.startsWith(cmdTrigger) ||
        (c.aliases && c.aliases.some((a) => a.startsWith(cmdTrigger)))
    );

    return candidates.map((c) => ({
      id: c.command,
      title: `${c.command} ${c.usage || ''}`.trim(),
      subtitle: `${c.displayName} · ${c.description}`,
      badge: '建议',
      icon: c.icon,
      fillCommand: `${c.command} `,
    }));
  }

  public extractInlineCommands(text: string): InlineCommandMatch[] {
    if (!text || !text.includes('/')) return [];

    const allCmds = this.getAllCommands();
    if (allCmds.length === 0) return [];

    const keywords: string[] = [];
    for (const c of allCmds) {
      keywords.push(c.command.replace(/^\//, ''));
      if (c.aliases) {
        for (const a of c.aliases) {
          keywords.push(a.replace(/^\//, ''));
        }
      }
    }

    keywords.sort((a, b) => b.length - a.length);

    const pattern = keywords.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    const cmdRegex = new RegExp(
      `(?:^|[\\s，。！？,.!?;；])(\\/(${pattern}))(?=[\\s，。！？,.!?;；]|$)`,
      'gi'
    );

    const results: InlineCommandMatch[] = [];
    let match: RegExpExecArray | null;

    while ((match = cmdRegex.exec(text)) !== null) {
      const matchedCmdWithSlash = match[1];
      const cmdLower = matchedCmdWithSlash.toLowerCase();
      const cmdDef = this.commands.get(cmdLower);
      if (!cmdDef) continue;

      const matchIndexInFull = match.index + match[0].indexOf(matchedCmdWithSlash);
      const afterCmdIndex = matchIndexInFull + matchedCmdWithSlash.length;

      let maxArgs = 1;
      if (cmdDef.usage !== undefined) {
        const paramMatches = cmdDef.usage.match(/[<[][^>\]]+[>\]]/g);
        if (paramMatches) {
          maxArgs = paramMatches.length;
        } else if (cmdDef.usage.trim() === '') {
          maxArgs = 0;
        }
      }

      const remainingText = text.slice(afterCmdIndex);
      const tokens: string[] = [];
      let consumedLength = 0;

      if (maxArgs > 0) {
        const leadingSpaceMatch = remainingText.match(/^(\s+)/);
        if (leadingSpaceMatch) {
          let pos = leadingSpaceMatch[1].length;
          while (tokens.length < maxArgs && pos < remainingText.length) {
            const rest = remainingText.slice(pos);
            if (/^[，。！？,.!?;；\r\n]/.test(rest) || rest.startsWith('/')) {
              break;
            }

            const tokenMatch = rest.match(/^([^\s，。！？,.!?;；\r\n\/]+)/);
            if (!tokenMatch) break;

            const token = tokenMatch[1];
            tokens.push(token);
            pos += token.length;
            consumedLength = pos;

            const betweenSpace = remainingText.slice(pos).match(/^(\s+)/);
            if (betweenSpace) {
              pos += betweenSpace[1].length;
            } else {
              break;
            }
          }
        }
      }

      const args = tokens.join(' ').trim();
      const raw = args ? `${matchedCmdWithSlash} ${args}` : matchedCmdWithSlash;
      const endIndex = matchIndexInFull + matchedCmdWithSlash.length + consumedLength;

      results.push({
        raw,
        cmd: cmdLower,
        args,
        startIndex: matchIndexInFull,
        endIndex,
        pluginId: cmdDef.command,
      });
    }

    return results;
  }

  public async executeCommand(
    rawInput: string,
    ctx: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    const trimmed = (rawInput || '').trim();
    if (!trimmed.startsWith('/')) {
      return {
        toolName: 'unknown',
        command: trimmed,
        success: false,
        summary: '非斜杠指令',
        cardHtml: `<div class="harness-tool-card"><div class="harness-tool-card__body">指令必须以 / 开头</div></div>`,
        contextText: '',
      };
    }

    const parts = trimmed.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ').trim();

    const cmdDef = this.commands.get(cmd);
    if (!cmdDef) {
      const validCmds = this.getAllCommands()
        .map((c) => c.command)
        .join(', ');
      return {
        toolName: 'unknown_command',
        command: trimmed,
        success: false,
        summary: `未知指令: ${cmd}`,
        cardHtml: `
          <div class="harness-tool-card">
            <div class="harness-tool-card__body">
              未知工具指令: <code>${cmd}</code>。<br>
              当前系统可用指令包括: <strong>${validCmds}</strong>
            </div>
          </div>
        `,
        contextText: '',
      };
    }

    return await cmdDef.execute(args, ctx);
  }

  public async executeAgentTool(
    toolName: string,
    args: Record<string, any>,
    ctx: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    const toolDef = this.agentTools.get(toolName);
    if (!toolDef) {
      return {
        toolName,
        command: toolName,
        success: false,
        summary: `未找到工具函数: ${toolName}`,
        cardHtml: `<div class="harness-tool-card"><div class="harness-tool-card__body">未知工具函数: ${toolName}</div></div>`,
        contextText: `工具函数 ${toolName} 未注册`,
      };
    }

    return await toolDef.execute(args, ctx);
  }

  public toOpenAITools(options?: {
    permissionMode?: AgentPermissionMode;
    overrides?: Record<string, ToolOverrideConfig>;
    webSearchEnabled?: boolean;
    dynamicToolDescriptions?: Record<string, string>;
  }): any[] {
    const tools: any[] = [];
    const mode = options?.permissionMode;
    const overrides = options?.overrides || {};
    const dynamicDescs = options?.dynamicToolDescriptions || {};

    for (const tool of this.agentTools.values()) {
      if (tool.name === 'web_search' && !options?.webSearchEnabled) {
        continue;
      }
      const ov = overrides[tool.name];
      if (ov && ov.enabled === false) continue;
      if (mode) {
        const perm = this.evaluateToolPermission(tool.name, mode, {});
        if (perm.decision === 'deny') continue;
      }

      tools.push({
        type: 'function',
        function: {
          name: tool.name,
          description: ov?.description ?? dynamicDescs[tool.name] ?? tool.description,
          parameters: tool.parameters,
        },
      });
    }
    return tools;
  }

  public generateSystemPromptHelp(options?: {
    permissionMode?: AgentPermissionMode;
    overrides?: Record<string, ToolOverrideConfig>;
    webSearchEnabled?: boolean;
    dynamicToolDescriptions?: Record<string, string>;
  }): string {
    const mode = options?.permissionMode || 'workspace';
    const overrides = options?.overrides || {};
    const dynamicDescs = options?.dynamicToolDescriptions || {};
    const tools = Array.from(this.agentTools.values()).filter((t) => {
      if (t.name === 'web_search' && !options?.webSearchEnabled) return false;
      if (overrides[t.name]?.enabled === false) return false;
      return this.evaluateToolPermission(t.name, mode, {}).decision !== 'deny';
    });
    const commands = this.getAllCommands();

    const modeLabel =
      mode === 'read-only' ? '仅查看 (只读)' : mode === 'full' ? '完全权限' : '工作区内修改 (默认)';

    let help = `## AstroLib 学术知识库与自主工具调用系统 (AstroLib Content Locator Protocol & Tools):
【当前安全权限档位】: ${modeLabel}
【核心定位协议规范 (AstroLib Universal Resource Protocol - AURP)】:
全站教材、导入电子书与 MinerU 学术文献遵循统一资源定位协议（唯一指向源）：
- 格式规范: \`astrolib://<colSlug>/<bookSlug>[/<chapterSlug>][#<cardId>]\` 与 \`astrolib://paper/<taskId>[/<sectionId>]\`
  - 示例1 (书籍): \`astrolib://math/math_analysis\` (《数学分析》)
  - 示例2 (章节): \`astrolib://math/math_senior/06_第1章-三角函数\` (《新高考数学》第1章)
  - 示例3 (文献): \`astrolib://paper/task_1794805910540_rc0r2r/sec-1\` (MinerU 解析论文)

【可用自主调用工具 (Agent Tools)】:\n`;

    tools.forEach((t, idx) => {
      const desc = overrides[t.name]?.description ?? dynamicDescs[t.name] ?? t.description;
      help += `${idx + 1}. **\`${t.name}\`**: ${desc}\n`;
    });

    help += `\n【对应用户快捷指令 (Slash Commands)】:\n`;
    commands.forEach((c) => {
      help += `- **\`${c.command}${c.usage ? ' ' + c.usage : ''}\`** (${c.displayName}): ${c.description}\n`;
    });

    help += `
【工具调用与协同规范 (Tool Use Rules)】:
1. **优先调用工具获取真实数据**: 当用户询问教材结构、定理公式、习题题解或章节差异时，必须优先调用上述 Agent Tools 获取权威数据，严禁虚构或臆测。
2. **正面确认工具能力**: 当用户询问是否具备某些能力或工具时，必须正面、自信地列出当前已挂载的核心工具与快捷指令。
3. **计算核验与科学绘图**: 涉及复杂符号推导、微积分求值、线性代数特征值、统计分布验证时，可主动调用 \`run_python\` 进行精确数值或符号验算，确保结论零失误。
4. **精准步骤链与协议执行纪律**:
   - 探查书目: \`get_books_catalog\` 获取全库教材元数据与 slug；
   - 全文检索: \`search_library_text\` 通过 Ripgrep 跨全库检索关键词与 LaTeX；
   - 提取目录: \`get_book_toc\` 获取大纲树与各章节精确 URI；
   - 提取知识卡片/公式: \`get_chapter_ast\` 获取结构骨架，再用 \`read_content_node\` 精读具体节点原文；
   - 感知批注: \`get_book_annotations_overview\` / \`get_chapter_annotations\` / \`search_user_annotations\`；
   - 检索习题: \`search_exercises\`；
   - 求解定位: \`locate_content\`。

## 双轨富呈现与声明式学术排版协议 (Rich Presentation System)
为了清晰、克制地呈现复杂学术讲解与交互内容，你可以自由组合以下两种互补机制：

### 轨道 A（内联声明式排版 — \`\`\`astro-ui 代码块，直接混排在正文中）
当需要卡片化推荐、关键数据对比、多步推导导览、可勾选清单或分栏展示时，**直接输出 \`\`\`astro-ui fenced JSON 块**（严禁堆砌无意义 SaaS 装饰徽章或分数统计）。
支持根对象 \`{ "type": "...", ... }\` 或 \`{ "blocks": [ ... ] }\`，以及全局风格参数：
- \`font\`: \`"sans"\`（默认黑体） | \`"serif"\`（学术衬线，适合定理与文献） | \`"mono"\`（等宽代码数据）
- \`tone\`: \`"neutral"\` | \`"primary"\` | \`"secondary"\` | \`"tertiary"\` | \`"success"\` | \`"warning"\`（全数动态对齐当前 Material You 主题色）
- \`density\`: \`"comfortable"\` | \`"compact"\`

可用原语 type：
1. \`card\`: \`{ type: "card", badge?, eyebrow?, title, subtitle?, bullets?: string[], body?, actions?: [{ label, command?, uri? }], font?, tone? }\`
2. \`metrics\`: \`{ type: "metrics", title?, subtitle?, items: [{ value, label, tone?, note? }], source?, meaning?, links?: [{ label, uri?, url? }] }\`
3. \`steps\`: \`{ type: "steps", title?, items: [{ step?: number, title, caption?, body }], tone? }\`
4. \`checklist\`: \`{ type: "checklist", title?, groups: [{ id, label, items: [{ id, text, checked? }] }] }\`
5. \`compare\`: \`{ type: "compare", title?, columns: [{ title, badge?, tone?, items: string[], body? }] }\`
6. \`tabs\`: \`{ type: "tabs", items: [{ label, title?, body?, blocks?: [...] }] }\`
7. \`callout\`: \`{ type: "callout", title?, tone?, body }\`
8. \`grid\`: \`{ type: "grid", columns?: 2|3, blocks: [...] }\`
所有文本字段均原生支持 LaTeX 数学公式（\`$...$\`）和 \`astrolib://\` 链接。

### 轨道 B（独立交互画布 — \`create_canvas_artifact\` / \`update_canvas_artifact\` / \`read_canvas_artifact\` / \`inspect_canvas_artifact\`）
当用户需要**可交互的物理/信号/算法实时仿真器、函数动态绘图、参数滑块实验室或独立完整网页工具**时，调用 \`create_canvas_artifact\`，不要在对话正文中直接倾倒数百行 HTML。

### 轨道 C（正文中直接内联图像 — Markdown \`![图题](url)\`）
当使用 \`run_python\`（matplotlib 绘图等）或阅读含插图的论文/电子书后获得图片 URL（如 \`/api/v1/content/agent-tools/workspace-file?path=...\` 或 \`/api/ingest/image?taskId=...\`）时，可直接在回复正文中书写 \`![图题](url)\`，前端将自动安全渲染并支持点击放大审阅。
`;
    return help;
  }

  public buildAugmentedPrompt(
    rawText: string,
    toolResults: ToolExecutionResult[]
  ): string {
    if (!toolResults || toolResults.length === 0) return rawText;

    const contextSections = toolResults
      .filter((r) => r.success && r.contextText)
      .map((r) => `--- 【上下文信息 (由工具指令 ${r.command} 提取)】 ---\n${r.contextText}\n---`)
      .join('\n\n');

    if (!contextSections) return rawText;

    return `${contextSections}\n\n【用户问题】:\n${rawText}`;
  }
}
