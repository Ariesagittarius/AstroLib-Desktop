/**
 * src/ai/skills/pdf2abp/orchestrator-sop.ts
 * ============================================================================
 * Skill 3: 主 Agent PDF2ABP 全流程端到端编排 SOP
 * ============================================================================
 */

import type { SkillDocument } from './types.ts';

export const orchestratorSopSkill: SkillDocument = {
  id: 'pdf2abp-orchestrator-sop',
  title: '主 Agent PDF2ABP 端到端全自动转换 SOP',
  summary: '指导主 Agent 如何调用工具、管理单图视觉窗口与上下文预算、策划章节拆分、调度子代理并发校对、自愈修复并打包导入 ABP。',
  audience: 'main',
  tags: ['orchestrator', 'sop', 'workflow', 'mineru', 'subagents'],
  sections: [
    {
      id: 'pipeline-steps',
      title: '1. 标准八步全自动执行流水线',
      content: `收到 PDF 绝对路径后，主 Agent 必须按以下严谨闭环自主完成全链路，不中途停下来空谈：

**Step 1: 规范自省与环境/PDF 体检**
1. 若尚未详读 \`abp-spec\` 与 \`academic-typesetting-rules\`，先调用 \`read_skill\` 掌握 ABP 完整契约与排版防线。
2. 并行或依次调用 \`check_mineru_status\` 与 \`inspect_pdf\`：
   - 获取总页数、文件大小、PDF 原生书签大纲（\`outline\`）、是否为扫描件；
   - 若 \`check_mineru_status\` 返回不可用（无 Token 且无本地引擎），直接向用户报告明确配置指引并终止，不盲目继续。

**Step 2: 执行 MinerU 自动分卷解析与多卷缝合**
- 调用 \`run_mineru_pipeline\`（内部自动按 **最大 200 页且 ≤180 MB** 拆分大 PDF，云端支持多卷并发解析并确定性缝合为全局对齐的 \`pages_blocks.json\` 与 \`mineru-summary.json\`）。
- 若用户明确只要某几个章节且你已通过 \`inspect_pdf\`（书签）或目录页确定精确起止物理页，可传 \`pageRange: [startPage, endPage]\` 进一步提速；输出仍严格保留 1-based 全局物理页码。

**Step 3: 确定性全书结构剖析 & 智能总览读图**
- **第一步先调用 \`analyze_book_structure\`**：该工具确定性读取 \`pages_blocks.json\` 与 PDF 书签，自动识别**应跳过的目录/框目表/索引页**、**章首导语 (\`chapter-intro\`) 候选**、**按原书严格 1:1 的二级小节清单与同页起止 \`startAnchor\`/\`endAnchor\`**，以及含脚注/代码/插图的页面索引！
- 随后调用 \`read_workspace_file\` 核查 \`mineru/structure-analysis.json\`，配合 \`render_contact_sheet\`（2×2 拼图）与 \`inspect_image\` 抽样审阅封面、章首、公式、底纹块与算法伪代码样张，校准书名作者与语义规范。

**Step 4: 提取封面 & 编写严格 1:1 蓝图**
1. 调用 \`crop_pdf_region\` 裁剪封面图至 \`book/images/cover.jpg\`。
2. 如遇跨章答案映射等复杂任务，主动使用 \`run_python\` 预处理。
3. 编写完整的 \`book-plan.json\`（设置 \`documentMode: "textbook"\`、在 \`bookConfig.sections[]\` 按章分组并将章首导语挂载于 \`sections[].intro\`、**严禁收录纯目录/索引页**、**严禁合并平级小节或把 \`1.2.3\` 拆成平级文件**，共享同一页时填写精确 \`startAnchor\`/\`endAnchor\`）。
4. 调用 \`prepare_chapter_chunks\`（**默认 \`maxPagesPerChunk: 0\`，即严格按完整小节派发给子代理，不按僵化页数拆分完整小节，仅当单节超 28 页时自动切分**），确定性执行护栏校验并生成切片与图像。

**Step 5: 高并发整节派发子代理视觉校对**
- 调用 \`dispatch_subagents\`，按完整小节派发给隔离上下文的子代理并行校对：
  - 默认并发度为 \`12\`（最高支持 \`24\`，遇 HTTP 429 自动降速自愈）；如用户在自然语言指令中指定并发数，可按需覆盖 \`concurrency\` 参数；
  - 提示子代理主动识别底纹 \`<Block>\`、真实换行 \`<Algorithm>\`、页码作用域脚注 \`[^pN-K]\`，且正文禁止重复小节标题。

**Step 6: 合并、覆盖度审计与全书质检自愈**
1. 若某超长章(>28p)被拆为多段，调用 \`merge_chapter_parts\` 无损拼接。
2. 若有失败分片，可针对 \`taskIds\` 重派或直接修补。
3. 调用 **\`audit_book_coverage\`** 核查全书字符覆盖率、插图断链、\`sections[].intro\` 互斥配置、脚注留存与 \`MINERU_FOOTNOTE\` 提示清零情况。
4. 运行 \`validate_mdx\` 检查 \`"book"\` 直到 \`passed === true\`（\`errorCount === 0\`）。

**Step 7: 打包与归档验收**
1. 调用 \`pack_abp\` 编译生成 \`.abp\` 归档包；
2. 调用 \`verify_abp\` 对 \`.abp\` 执行真实解包、Schema、HTML 内 KaTeX 零错误、资产闭环校验；若发现缺失图片或错误，回 \`book/\` 修正后重跑 \`pack_abp\` -> \`verify_abp\`。

**Step 8: 导入项目书库并汇报成果**
1. 若未禁止自动导入，调用 \`import_abp\` 将通过验收的 \`.abp\` 包原子安装至 AstroLib 应用书库；
2. 向用户输出结构化交付报告：书名、合集/slug、章节数与分卷结构、图片数、质量门禁结果、子代理执行统计、生成的 \`.abp\` 路径与可点击阅读链接（\`readerUrl\` / \`canonicalUrl\`）。`,
    },
    {
      id: 'vision-and-context-budget',
      title: '2. 网关单图限制与上下文窗口管控守则',
      content: `- **单图滚动槽 (Rolling Vision Slot)**：内置推理网关每次请求最多携带 **1 张** 图像，运行引擎会自动淘汰历史轮次里的旧图片。因此：
  - 总览大量页面时优先用 \`render_contact_sheet\`（每张图同时看 4 页，\`cols: 2, rows: 2\`）或 2-up 对页（\`cols: 2, rows: 1\`）；
  - 每看一张图后，**切换下一张图时务必通过工具参数 \`notesForPreviousImage\` 或当前回复文本记下关键视觉结论（页码、标题、底纹块、公式/脚注细节）**，防止图像被滚动槽换出后发生“视觉失忆”而反复翻看同一页！
- **禁止一次性读取整本 \`full.md\`**：长书 \`full.md\` 动辄上万行，直接读取会瞬间挤爆上下文。请始终读取 \`mineru/mineru-summary.json\`，或使用 \`read_workspace_file\` 的 \`startLine\` / \`endLine\` 分页读取，或用 \`run_python\` 进行统计与检索。
- **使用 \`run_python\` 处理大批量正则/匹配**：诸如跨 400 页检索目录页码、匹配 100 道题的答案提示、批量清理页眉水印，一律交由 \`run_python\` 确定性完成，不要让大模型逐字复制长文本。`,
    },
  ],
};
