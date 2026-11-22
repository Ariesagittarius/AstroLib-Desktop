/**
 * src/plugins/harness/builtin/runtime-tools.plugin.ts
 * ============================================================================
 * AstroLib 首屏 Agent 扩展工具集插件：
 * Python 科学计算沙箱 / Ripgrep 全库搜索 / 本地文件与 PDF 研读 / MDX 质检
 * ============================================================================
 */

import type { HarnessPlugin, PluginContext } from '../types.ts';

function escapeHtml(str: string): string {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const SOURCE_FILE = 'src/plugins/harness/builtin/runtime-tools.plugin.ts';

export const RuntimeToolsPlugin: HarnessPlugin = {
  id: 'astrolib.builtin.runtime',
  name: '计算核验与本地文件系统插件',
  version: '1.0.0',
  description: '提供隔离 Python 计算与绘图、Ripgrep 全库检索、本地文件/PDF 阅读与 MDX 学术防线校验能力。',
  sourceFile: SOURCE_FILE,
  activate: (context: PluginContext) => {
    // 1. /search 全库全文检索指令 & search_library_text 工具
    context.registerCommand({
      command: '/search',
      aliases: ['/rg', '/grep'],
      displayName: '全库全文检索',
      description: '使用 Ripgrep 在全库教材 MDX 原文中检索关键词、定理名称或 LaTeX 片段。',
      usage: '<检索词>',
      icon: { type: 'mdicon', value: 'manage_search' },
      suggest: () => [
        {
          id: 'search-cauchy',
          title: '/search 柯西',
          subtitle: '检索全库中包含“柯西”的教材章节与定理',
          badge: 'RG',
          icon: { type: 'mdicon', value: 'manage_search' },
          fillCommand: '/search 柯西',
        },
        {
          id: 'search-fourier',
          title: '/search 傅里叶',
          subtitle: '检索通信原理与数学分析中的傅里叶相关章节',
          badge: 'RG',
          icon: { type: 'mdicon', value: 'manage_search' },
          fillCommand: '/search 傅里叶',
        },
      ],
      execute: async (args, ctx) => {
        const q = (args || '').trim();
        if (!q) {
          return {
            toolName: 'search_library_text',
            command: '/search',
            success: false,
            summary: '请输入检索关键词',
            cardHtml: `<div style="font-size:0.88rem;">请输入要检索的关键词，例如 <code>/search 柯西收敛</code></div>`,
            contextText: '检索词不能为空。',
          };
        }
        const fetcher = ctx.fetchFn || fetch;
        const res = await fetcher('/api/v1/content/agent-tools/search-library', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: q, limit: 15 }),
        });
        const json = await res.json();
        if (!json.success) {
          return {
            toolName: 'search_library_text',
            command: `/search ${q}`,
            success: false,
            summary: json.error || '检索失败',
            cardHtml: `<div style="color:var(--md-sys-color-error, #ef4444);">检索失败: ${escapeHtml(json.error || '')}</div>`,
            contextText: json.error || '检索失败',
          };
        }

        const hits = json.data?.hits || [];
        const listHtml =
          hits.length > 0
            ? `<ul class="harness-ast-tree" style="margin-top:8px;">${hits
                .map(
                  (h: any) =>
                    `<li style="margin:6px 0;"><a href="${escapeHtml(h.uri)}" class="astrolib-node-link" data-astrolib-uri="${escapeHtml(h.uri)}">${escapeHtml(h.bookSlug)} / ${escapeHtml(h.chapterSlug)}</a> <span style="color:var(--harness-text-tertiary);font-size:0.76rem;">L${h.lineNumber}</span><div style="font-size:0.82rem;color:var(--harness-text-secondary);margin-top:2px;">${escapeHtml(h.text)}</div></li>`
                )
                .join('')}</ul>`
            : `<div style="font-size:0.86rem;color:var(--harness-text-secondary);">未检索到包含 “${escapeHtml(q)}” 的教材原文。</div>`;

        return {
          toolName: 'search_library_text',
          command: `/search ${q}`,
          success: true,
          summary: `检索 “${q}” 命中 ${hits.length} 处 (${json.data?.engine || 'rg'})`,
          cardHtml: `<div style="font-size:0.9rem;">全文检索 <strong>“${escapeHtml(q)}”</strong> 命中 ${hits.length} 处：</div>${listHtml}`,
          contextText: hits
            .map((h: any, i: number) => `${i + 1}. ${h.uri} (L${h.lineNumber}): ${h.text}`)
            .join('\n') || '未命中结果',
          artifact: {
            id: `search:${q}`,
            kind: 'markdown',
            title: `全文检索 · "${q}"`,
            badge: `${hits.length} 处命中`,
            html: listHtml,
          },
        };
      },
    });

    context.registerTool({
      name: 'search_library_text',
      displayName: '全库全文检索（含书籍与文献）',
      category: '知识库检索',
      icon: { type: 'mdicon', value: 'manage_search' },
      sourceFile: SOURCE_FILE,
      riskLevel: 'read',
      exposeAsSlashCommand: '/search',
      formatActionLabel: (args) => {
        const q = String(args.query || '').trim();
        return q ? `检索全库原文 · "${q}"` : '检索全库原文';
      },
      description:
        '使用 Ripgrep 与统一知识库索引在全部教材 MDX、pdf2abp 入库书目、EPUB 电子书以及 MinerU 学术文献中联合检索关键词、概念或 LaTeX 片段，返回规范 astrolib:// URI、来源类型与命中片段。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '检索关键词或正则表达式' },
          kind: {
            type: 'string',
            enum: ['all', 'book', 'paper'],
            description: '可选：限定检索书籍 (book) 或文献 (paper)，默认 all',
          },
          format: {
            type: 'string',
            enum: ['all', 'mdx', 'abp', 'epub', 'paper'],
            description: '可选：限定来源格式',
          },
          colSlug: { type: 'string', description: '可选：限定学科合集 (math / cs / science / telecom / acg / literature / paper)' },
          bookSlug: { type: 'string', description: '可选：限定书籍 slug 或文献 taskId' },
          regex: { type: 'boolean', description: '是否启用正则表达式模式，默认 false' },
          limit: { type: 'number', description: '最多返回条数，默认 15' },
        },
        required: ['query'],
      },
      execute: async (args, ctx) => {
        const fetcher = ctx.fetchFn || fetch;
        const res = await fetcher('/api/v1/content/agent-tools/search-library', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(args || {}),
        });
        const json = await res.json();
        if (!json.success) {
          return {
            toolName: 'search_library_text',
            command: `/search ${args.query || ''}`,
            success: false,
            summary: json.error || '检索失败',
            cardHtml: '',
            contextText: `检索失败: ${json.error || '未知错误'}`,
          };
        }
        const hits = json.data?.hits || [];
        return {
          toolName: 'search_library_text',
          command: `/search ${args.query || ''}`,
          success: true,
          summary: `命中 ${hits.length} 处原文片段`,
          cardHtml: '',
          contextText:
            hits.length > 0
              ? `【全库检索命中 (${hits.length} 处)】:\n` +
                hits
                  .map((h: any, i: number) => {
                    const fmt = h.sourceFormat ? `[${h.kind || 'book'}/${h.sourceFormat}] ` : '';
                    const title = h.docTitle ? `《${h.docTitle}》 ` : '';
                    const loc = h.page ? `P${h.page}` : `L${h.lineNumber}`;
                    return `${i + 1}. ${fmt}${title}${h.uri} (${loc}): ${h.text}`;
                  })
                  .join('\n')
              : `未检索到包含 "${args.query}" 的教材或文献原文。`,
        };
      },
    });

    // 2. run_python (与 /python 指令)
    context.registerCommand({
      command: '/python',
      aliases: ['/py', '/calc'],
      displayName: 'Python 沙箱运算',
      description: '在隔离沙箱中执行 Python 代码，用于符号推导验算、矩阵计算或生成数据图表。',
      usage: '<Python 代码>',
      icon: { type: 'mdicon', value: 'terminal' },
      execute: async (args, ctx) => {
        const code = (args || '').trim();
        if (!code) {
          return {
            toolName: 'run_python',
            command: '/python',
            success: false,
            summary: '请提供要执行的 Python 代码',
            cardHtml: `<div style="font-size:0.88rem;">用法：<code>/python print(sum(range(1, 101)))</code></div>`,
            contextText: '未提供 Python 代码。',
          };
        }
        const fetcher = ctx.fetchFn || fetch;
        const res = await fetcher('/api/v1/content/agent-tools/python', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, pythonPath: ctx.customPythonPath }),
        });
        const json = await res.json();
        const data = json.data || {};
        if (!json.success && !data.stdout && json.error) {
          return {
            toolName: 'run_python',
            command: '/python',
            success: false,
            summary: json.error,
            cardHtml: `<div style="color:var(--md-sys-color-error);">${escapeHtml(json.error)}</div>`,
            contextText: json.error,
          };
        }
        const ok = data.exitCode === 0;
        const output = [data.stdout, data.stderr].filter(Boolean).join('\n').trim() || '(无标准输出)';
        return {
          toolName: 'run_python',
          command: '/python',
          success: ok,
          summary: ok ? `Python 执行完成 (${data.durationMs}ms)` : `Python 退出码 ${data.exitCode}`,
          cardHtml: `<pre style="background:var(--md-sys-color-surface-container-low);padding:10px 12px;border-radius:8px;font-size:0.82rem;overflow-x:auto;">${escapeHtml(output)}</pre>`,
          contextText: `exitCode=${data.exitCode}\n${output}`,
          artifact: {
            kind: 'python',
            title: `Python 运行 · ${data.scriptRelPath || 'script.py'}`,
            badge: ok ? `${data.durationMs}ms` : `Exit ${data.exitCode}`,
            code,
            pythonResult: {
              stdout: data.stdout || '',
              stderr: data.stderr || '',
              exitCode: data.exitCode ?? (ok ? 0 : 1),
              durationMs: data.durationMs ?? 0,
              scriptPath: data.scriptRelPath,
              images: data.images || [],
            },
          },
          sideEffectTab: 'artifacts',
        };
      },
    });

    context.registerTool({
      name: 'run_python',
      displayName: '运行 Python 科学计算与绘图',
      category: '计算与执行',
      icon: { type: 'mdicon', value: 'terminal' },
      sourceFile: SOURCE_FILE,
      riskLevel: 'workspace',
      exposeAsSlashCommand: '/python',
      formatActionLabel: () => '运行 Python 脚本进行计算或核验',
      description:
        '在独立隔离的 Agent Python 沙箱工作区内执行 Python 脚本（动态已装包清单见运行环境注入；支持 Matplotlib Agg 无头绘图）。保存至当前工作目录的 .png/.svg 会自动归档至「成果物」并返回可直接在 Markdown 回复中嵌入的 ![图题](url) 本地图片地址；若需缺失科学计算轮子包，可调用 install_python_package 自动安装。',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: '待执行的 Python 源码字符串' },
          title: { type: 'string', description: '可选：本次计算或绘图任务的简要中文标题' },
          timeoutMs: { type: 'number', description: '超时时间（毫秒，默认 30000，上限 60000）' },
        },
        required: ['code'],
      },
      execute: async (args, ctx) => {
        const fetcher = ctx.fetchFn || fetch;
        const code = String(args.code || '');
        const res = await fetcher('/api/v1/content/agent-tools/python', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code,
            timeoutMs: args.timeoutMs,
            pythonPath: ctx.customPythonPath,
          }),
        });
        const json = await res.json();
        const data = json.data || {};
        if (!json.success && json.error && data.exitCode === undefined) {
          return {
            toolName: 'run_python',
            command: 'run_python',
            success: false,
            summary: json.error,
            cardHtml: '',
            contextText: `Python 启动失败: ${json.error}`,
          };
        }
        const ok = data.exitCode === 0;
        const images = Array.isArray(data.images) ? data.images : [];
        const contextLines = [
          `Python 执行${ok ? '成功' : '失败'} (exitCode=${data.exitCode}, duration=${data.durationMs}ms)`,
          data.stdout ? `STDOUT:\n${data.stdout}` : '',
          data.stderr ? `STDERR:\n${data.stderr}` : '',
          images.length > 0
            ? `生成图像 (${images.length} 张，可直接用 Markdown ![说明](url) 嵌入正文或用 inspect_image 自检):\n` +
              images.map((im: any) => `- ${im.relPath || im.name}: ${im.url}`).join('\n')
            : '',
        ].filter(Boolean);

        return {
          toolName: 'run_python',
          command: 'run_python',
          success: ok,
          summary: ok
            ? `Python 计算完成 (${data.durationMs}ms${images.length > 0 ? ` · ${images.length} 图` : ''})`
            : `Python 错误 (exit ${data.exitCode})`,
          cardHtml: '',
          contextText: contextLines.join('\n\n'),
          artifact: {
            kind: 'python',
            title: String(args.title || `Python 计算 · ${data.scriptRelPath || 'run.py'}`),
            badge: ok ? `Python · ${data.durationMs}ms` : `Exit ${data.exitCode}`,
            code,
            pythonResult: {
              stdout: data.stdout || '',
              stderr: data.stderr || '',
              exitCode: data.exitCode ?? 0,
              durationMs: data.durationMs ?? 0,
              scriptPath: data.scriptRelPath,
              images,
            },
          },
        };
      },
    });

    // 2.5 install_python_package (自动为独立沙箱安装预编译科学计算 wheel)
    context.registerTool({
      name: 'install_python_package',
      displayName: '安装 Agent Python 科学计算包',
      category: '计算与执行',
      icon: { type: 'mdicon', value: 'download' },
      sourceFile: SOURCE_FILE,
      riskLevel: 'workspace',
      formatActionLabel: (args) => {
        const list = Array.isArray(args.packages) ? args.packages.join(', ') : '';
        return list ? `安装 Python 包 · ${list}` : '安装 Python 科学计算包';
      },
      description:
        '向独立隔离的 Agent Python 沙箱（.venv-agent）安装预编译二进制轮子包（仅 --only-binary=:all:，不污染项目主环境，无需本机编译器）。',
      parameters: {
        type: 'object',
        properties: {
          packages: {
            type: 'array',
            items: { type: 'string' },
            description: '合法 PyPI 包名列表（最多 8 个），例如 ["scikit-learn", "statsmodels"]',
          },
        },
        required: ['packages'],
      },
      execute: async (args, ctx) => {
        const fetcher = ctx.fetchFn || fetch;
        const packages = Array.isArray(args.packages) ? args.packages : [];
        const res = await fetcher('/api/v1/content/agent-tools/python/packages/install', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ packages, pythonPath: ctx.customPythonPath }),
        });
        const json = await res.json();
        if (!json.success) {
          return {
            toolName: 'install_python_package',
            command: 'install_python_package',
            success: false,
            summary: json.error || '安装失败',
            cardHtml: '',
            contextText: `Python 包安装失败: ${json.error || '未知错误'}`,
          };
        }
        const env = json.data?.env;
        if (env?.packages && ctx.onPythonPackagesChanged) {
          ctx.onPythonPackagesChanged(env.packages);
        }
        const pkgNames = (env?.packages || []).map((p: any) => `${p.name}==${p.version}`).join(', ');
        return {
          toolName: 'install_python_package',
          command: 'install_python_package',
          success: true,
          summary: `已安装 ${(json.data?.installed || []).join(', ')}`,
          cardHtml: '',
          contextText: `安装成功: ${(json.data?.installed || []).join(', ')}\n当前隔离沙箱 (${env?.pythonPath}) 已装包:\n${pkgNames}`,
        };
      },
    });

    // 3. list_local_files
    context.registerTool({
      name: 'list_local_files',
      displayName: '浏览目录文件列表',
      category: '文件与文档',
      icon: { type: 'mdicon', value: 'folder_open' },
      sourceFile: SOURCE_FILE,
      riskLevel: 'read',
      formatActionLabel: (args) => {
        const dir = String(args.dirPath || '').trim();
        return dir && dir !== '.' ? `列出目录文件 · ${dir}` : '列出工作区文件';
      },
      description: '列出工作区沙箱、项目目录或本地指定目录中的文件结构（支持限定递归深度）。',
      parameters: {
        type: 'object',
        properties: {
          dirPath: { type: 'string', description: '目录路径；留空或 "." 表示查看 Agent 隔离工作区' },
          maxDepth: { type: 'number', description: '最大遍历深度（1-4，默认 2）' },
        },
        required: [],
      },
      execute: async (args, ctx) => {
        const fetcher = ctx.fetchFn || fetch;
        const res = await fetcher('/api/v1/content/agent-tools/fs/list', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(args || {}),
        });
        const json = await res.json();
        if (!json.success) {
          return {
            toolName: 'list_local_files',
            command: 'list_local_files',
            success: false,
            summary: json.error || '读取目录失败',
            cardHtml: '',
            contextText: json.error || '读取目录失败',
          };
        }
        const entries = json.data?.entries || [];
        return {
          toolName: 'list_local_files',
          command: 'list_local_files',
          success: true,
          summary: `列出 ${entries.length} 个条目`,
          cardHtml: '',
          contextText:
            `目录 ${json.data?.resolvedPath} (scope=${json.data?.scope}):\n` +
            entries.map((e: any) => `- ${e.relPath}${e.isDirectory ? '' : ` (${e.sizeBytes}B)`}`).join('\n'),
        };
      },
    });

    // 4. read_local_file
    context.registerTool({
      name: 'read_local_file',
      displayName: '分页读取本地文件',
      category: '文件与文档',
      icon: { type: 'mdicon', value: 'description' },
      sourceFile: SOURCE_FILE,
      riskLevel: 'read',
      formatActionLabel: (args) => {
        const fp = String(args.filePath || '').trim();
        return fp ? `读取文件 · ${fp}` : '读取本地文件';
      },
      description: '按行分页读取工作区或本地文本/代码/Markdown/JSON 文件内容。',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: '文件路径（工作区相对路径、项目相对路径或本地绝对路径）' },
          startLine: { type: 'number', description: '起始行号（从 1 开始）' },
          endLine: { type: 'number', description: '结束行号' },
        },
        required: ['filePath'],
      },
      execute: async (args, ctx) => {
        const fetcher = ctx.fetchFn || fetch;
        const res = await fetcher('/api/v1/content/agent-tools/fs/read', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(args || {}),
        });
        const json = await res.json();
        if (!json.success) {
          return {
            toolName: 'read_local_file',
            command: 'read_local_file',
            success: false,
            summary: json.error || '读取失败',
            cardHtml: '',
            contextText: json.error || '读取失败',
          };
        }
        const d = json.data;
        return {
          toolName: 'read_local_file',
          command: 'read_local_file',
          success: true,
          summary: `已读取 ${d.relPath} (L${d.startLine}-${d.endLine}/${d.totalLines})`,
          cardHtml: '',
          contextText: `文件 ${d.resolvedPath} (行 ${d.startLine}-${d.endLine}/${d.totalLines}):\n\n${d.content}`,
        };
      },
    });

    // 5. write_workspace_file
    context.registerTool({
      name: 'write_workspace_file',
      displayName: '写入沙箱工作区文件',
      category: '文件与文档',
      icon: { type: 'mdicon', value: 'edit_document' },
      sourceFile: SOURCE_FILE,
      riskLevel: 'workspace',
      formatActionLabel: (args) => {
        const p = String(args.relPath || '').trim();
        return p ? `写入工作区文件 · ${p}` : '写入工作区文件';
      },
      description: '在 Agent 隔离沙箱工作区内创建或覆盖文本、脚本或数据文件（严禁写入沙箱外目录）。',
      parameters: {
        type: 'object',
        properties: {
          relPath: { type: 'string', description: '工作区相对路径，例如 "notes/summary.md" 或 "data/input.csv"' },
          content: { type: 'string', description: '完整文件内容' },
        },
        required: ['relPath', 'content'],
      },
      execute: async (args, ctx) => {
        const fetcher = ctx.fetchFn || fetch;
        const res = await fetcher('/api/v1/content/agent-tools/fs/write', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(args || {}),
        });
        const json = await res.json();
        if (!json.success) {
          return {
            toolName: 'write_workspace_file',
            command: 'write_workspace_file',
            success: false,
            summary: json.error || '写入失败',
            cardHtml: '',
            contextText: json.error || '写入失败',
          };
        }
        const d = json.data;
        return {
          toolName: 'write_workspace_file',
          command: 'write_workspace_file',
          success: true,
          summary: `已写入 ${d.relPath} (${d.bytesWritten} B)`,
          cardHtml: '',
          contextText: `已写入工作区文件: ${d.relPath} (${d.absPath}, ${d.bytesWritten} bytes)`,
        };
      },
    });

    // 6. inspect_pdf
    context.registerTool({
      name: 'inspect_pdf',
      displayName: '勘测本地 PDF 元信息与大纲',
      category: '文件与文档',
      icon: { type: 'mdicon', value: 'picture_as_pdf' },
      sourceFile: SOURCE_FILE,
      riskLevel: 'read',
      formatActionLabel: (args) => {
        const p = String(args.pdfPath || '').split(/[\\/]/).pop() || '';
        return p ? `勘测 PDF 结构 · ${p}` : '勘测 PDF 文件信息';
      },
      description: '使用内置 MuPDF 引擎检测指定本地 PDF 的总页数、书签目录大纲 (outline)、文件体积及是否为纯扫描件。',
      parameters: {
        type: 'object',
        properties: {
          pdfPath: { type: 'string', description: '本地 PDF 文件路径' },
        },
        required: ['pdfPath'],
      },
      execute: async (args, ctx) => {
        const fetcher = ctx.fetchFn || fetch;
        const res = await fetcher('/api/v1/content/agent-tools/pdf/inspect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(args || {}),
        });
        const json = await res.json();
        if (!json.success) {
          return {
            toolName: 'inspect_pdf',
            command: 'inspect_pdf',
            success: false,
            summary: json.error || 'PDF 探测失败',
            cardHtml: '',
            contextText: json.error || 'PDF 探测失败',
          };
        }
        const info = json.data;
        return {
          toolName: 'inspect_pdf',
          command: 'inspect_pdf',
          success: true,
          summary: `PDF 共 ${info.pageCount} 页 · ${info.outline?.length || 0} 条书签`,
          cardHtml: '',
          contextText: JSON.stringify(info, null, 2),
        };
      },
    });

    // 7. render_pdf_page
    context.registerTool({
      name: 'render_pdf_page',
      displayName: '渲染本地 PDF 页面图像',
      category: '文件与文档',
      icon: { type: 'mdicon', value: 'image' },
      sourceFile: SOURCE_FILE,
      riskLevel: 'read',
      formatActionLabel: (args) => {
        const pages = Array.isArray(args.pages) ? args.pages.join(', ') : '';
        return pages ? `渲染 PDF 第 ${pages} 页` : '渲染 PDF 页面图像';
      },
      description: '将本地 PDF 的指定 1-4 个物理页渲染为高清图像，归档至成果物便于对照查验。',
      parameters: {
        type: 'object',
        properties: {
          pdfPath: { type: 'string', description: '本地 PDF 文件路径' },
          pages: {
            type: 'array',
            items: { type: 'number' },
            description: '1-based 页码列表（最多 4 页）',
          },
          dpi: { type: 'number', description: '清晰度 DPI（默认 140）' },
        },
        required: ['pdfPath', 'pages'],
      },
      execute: async (args, ctx) => {
        const fetcher = ctx.fetchFn || fetch;
        const res = await fetcher('/api/v1/content/agent-tools/pdf/render', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(args || {}),
        });
        const json = await res.json();
        if (!json.success) {
          return {
            toolName: 'render_pdf_page',
            command: 'render_pdf_page',
            success: false,
            summary: json.error || '渲染失败',
            cardHtml: '',
            contextText: json.error || '渲染失败',
          };
        }
        const pages = json.data?.pages || [];
        const imgsHtml = pages
          .map(
            (p: any) =>
              `<div style="margin-bottom:14px;"><div style="font-size:0.78rem;color:var(--harness-text-secondary);margin-bottom:4px;">第 ${p.page} 页 (${p.width}×${p.height})</div><img src="${escapeHtml(p.url)}" alt="PDF Page ${p.page}" style="max-width:100%;border-radius:8px;border:1px solid var(--md-sys-color-outline-variant);" /></div>`
          )
          .join('');
        return {
          toolName: 'render_pdf_page',
          command: 'render_pdf_page',
          success: true,
          summary: `已渲染 ${pages.length} 页 PDF 图像`,
          cardHtml: '',
          contextText: `已渲染 PDF 页面:\n` + pages.map((p: any) => `- 第 ${p.page} 页: ${p.url}`).join('\n'),
          artifact: {
            kind: 'markdown',
            title: `PDF 页面预览 (${pages.map((p: any) => `P${p.page}`).join(', ')})`,
            badge: `${pages.length} 页`,
            html: imgsHtml,
          },
        };
      },
    });

    // 8. validate_mdx
    context.registerTool({
      name: 'validate_mdx',
      displayName: '校验 MDX 语法与学术防线',
      category: '开发与校验',
      icon: { type: 'mdicon', value: 'verified' },
      sourceFile: SOURCE_FILE,
      riskLevel: 'read',
      formatActionLabel: () => '校验 MDX 编译与数学公式',
      description: '调用 AstroLib 无头 MDX/KaTeX 编译器与五大学术排版防线校验指定 MDX 文件路径或片段内容。',
      parameters: {
        type: 'object',
        properties: {
          targetPath: { type: 'string', description: '可选：待校验的 MDX 文件或目录路径' },
          content: { type: 'string', description: '可选：直接校验的 MDX 源码字符串' },
        },
        required: [],
      },
      execute: async (args, ctx) => {
        const fetcher = ctx.fetchFn || fetch;
        const res = await fetcher('/api/v1/content/agent-tools/mdx/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(args || {}),
        });
        const json = await res.json();
        if (!json.success) {
          return {
            toolName: 'validate_mdx',
            command: 'validate_mdx',
            success: false,
            summary: json.error || '校验失败',
            cardHtml: '',
            contextText: json.error || '校验失败',
          };
        }
        const rep = json.data;
        return {
          toolName: 'validate_mdx',
          command: 'validate_mdx',
          success: Boolean(rep.passed),
          summary: `MDX 校验${rep.passed ? '通过' : '未通过'} (${rep.errorCount} 错误 / ${rep.warningCount} 警告)`,
          cardHtml: '',
          contextText: JSON.stringify(rep, null, 2),
        };
      },
    });

    // 9. inspect_image (读取本地或工作区生成图像并接入滚动视觉槽)
    context.registerTool({
      name: 'inspect_image',
      displayName: '查看与审核本地/产物图像',
      category: '多模态视觉',
      icon: { type: 'mdicon', value: 'image_search' },
      sourceFile: SOURCE_FILE,
      riskLevel: 'read',
      formatActionLabel: (args) => {
        const p = String(args.path || '').trim();
        return p ? `检视图像 · ${p}` : '检视图像';
      },
      description:
        '读取工作区、PDF 渲染页或本地安全作用域内的 PNG/JPG/WEBP/SVG 图像文件并送入视觉模态检视（自动受当前模型 maxImagesPerRequest 滚动槽或纯文本退化策略保护）。',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '工作区相对路径、本地路径，或 run_python/pdf 返回的 workspace-file URL',
          },
        },
        required: ['path'],
      },
      execute: async (args, ctx) => {
        const fetcher = ctx.fetchFn || fetch;
        const rawPath = String(args.path || '').trim();
        const res = await fetcher('/api/v1/content/agent-tools/image/read', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: rawPath }),
        });
        const json = await res.json();
        if (!json.success) {
          return {
            toolName: 'inspect_image',
            command: 'inspect_image',
            success: false,
            summary: json.error || '读取图像失败',
            cardHtml: '',
            contextText: json.error || '读取图像失败',
          };
        }
        const d = json.data || {};
        return {
          toolName: 'inspect_image',
          command: 'inspect_image',
          success: true,
          summary: `已加载图像 ${d.name} (${Math.max(1, Math.round((d.sizeBytes || 0) / 1024))} KB)`,
          cardHtml: '',
          contextText: `已加载图像: ${d.name} (${d.mimeType}, ${d.sizeBytes} bytes)${d.apiUrl ? `\nMarkdown 可嵌入 URL: ${d.apiUrl}` : ''}\n[视觉图像已随本轮消息挂载；若当前激活模型无视觉能力将自动退化为结构文本说明]`,
          visionImage: d.dataUrl
            ? {
                dataUrl: d.dataUrl,
                label: d.name || rawPath,
                relPath: d.path || rawPath,
              }
            : undefined,
        };
      },
    });
  },
};
