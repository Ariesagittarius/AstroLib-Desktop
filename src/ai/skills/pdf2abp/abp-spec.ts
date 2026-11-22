/**
 * src/ai/skills/pdf2abp/abp-spec.ts
 * ============================================================================
 * Skill 1: AstroBook Package (ABP 1.0.0) 完整能力与规范手册
 * ============================================================================
 */

import type { SkillDocument } from './types.ts';

export const abpSpecSkill: SkillDocument = {
  id: 'abp-spec',
  title: 'AstroBook Package (ABP 1.0.0) 完整能力、组件语法与编译规范手册',
  summary: '权威定义 ABP 包拥有的全套能力、book.json 配置契约、15 种学术卡片组件语法、图注与 Mermaid 规范、KaTeX/MDX 防坑规则与验收边界。',
  audience: 'both',
  tags: ['abp', 'schema', 'book.json', 'components', 'katex', 'mdx'],
  sections: [
    {
      id: 'capabilities',
      title: '1. ABP 内容包在 AstroLib 中拥有哪些核心能力',
      content: `ABP (AstroBook Package, Schema 1.0.0) 不是普通 Markdown 打包，而是自包含的学术语义数字教材包（Gzip 压缩 JSON 归档 \`.abp\`）。编译并导入 AstroLib 后，它将自动解锁以下全部内置功能：
1. **双栏学术阅读器与多视图排版**：支持连续滚动、单页翻阅、双栏对页，自动生成左栏可折叠分卷目录（\`sections\`）与右栏结构化大纲（提取 H2/H3 标题与带 \`[理]/[定]/[例]/[习]\` Chip 的学术卡片）。
2. **构建期 KaTeX 预渲染与源码复制**：正文与卡片标题中的 \`$...$\` 与 \`$$...$$\` 在打包时即预渲染为纯 HTML 并回填 \`data-latex\`，支持读者一键点击公式复制原始 TeX 源码。
3. **全局交叉引用悬浮徽章 (Cross-Refs)**：正文出现的“定理 1.1”、“例 2.3”、“图 1-2”等引用会自动匹配 \`cross-refs.json\` 变成可点击悬浮预览卡片。前提：卡片 \`title\` 必须严格按“类型 + 编号”规范命名（如 \`title="定理 1.1 柯西收敛准则"\`）。
4. **AI 书内语义检索与习题自测联动**：\`ai-index.json\` 将每个卡片与小节切片映射为 \`/collections/<col>/<book>/<slug>/#<anchor>\` 精准锚点，供书内 AI 问答与 Harness 检索跳转。
5. **多格式无缝导出**：规范封装的卡片与公式可无损用于全书 EPUB 导出与单章 LaTeX / Typst 出版级 PDF 排版。`,
    },
    {
      id: 'book-json',
      title: '2. 工作区 book.json 唯一元数据契约（强烈建议主 Agent 生成）',
      content: `编译器 \`pack_abp\` 会自动读取 \`book/book.json\`。主 Agent 应在策划阶段基于 PDF 封面、版权页与目录页真实信息生成准确的 \`book/book.json\`（严禁臆造 ISBN 或作者）：

\`\`\`json
{
  "colSlug": "math",
  "slug": "linear_algebra_5th",
  "title": "线性代数（第五版）",
  "author": "同济大学数学系 编",
  "publisher": "高等教育出版社",
  "edition": "第五版",
  "stage": "university",
  "stageLabel": "大学本科",
  "category": "textbook",
  "categoryLabel": "教材",
  "subject": "math",
  "subjectLabel": "数学",
  "readingProfile": "academic",
  "description": "一句话客观学术简介（50~120字，严禁营销套话）。",
  "tags": ["线性代数", "矩阵", "行列式"],
  "cover": "images/cover.jpg",
  "entryPoint": "00_前言与目录",
  "sections": [
    {
      "title": "卷首 Front Matter",
      "chapters": ["00_preface.mdx"]
    },
    {
      "title": "第1章 行列式",
      "intro": "01_ch1_intro.mdx",
      "chapters": ["02_1.1_二阶与三阶行列式.mdx", "03_1.2_全排列与逆序数.mdx"]
    }
  ],
  "modules": {
    "定理": { "short": "理", "aliases": ["定理", "Theorem"], "theme": "chip-conclusion" },
    "定义": { "short": "定", "aliases": ["定义", "Definition"], "theme": "chip-knowledge" },
    "性质": { "short": "性", "aliases": ["性质", "Property"], "theme": "chip-knowledge" },
    "推论": { "short": "推", "aliases": ["推论", "Corollary"], "theme": "chip-conclusion" },
    "引理": { "short": "引", "aliases": ["引理", "Lemma"], "theme": "chip-conclusion" },
    "命题": { "short": "命", "aliases": ["命题", "Proposition"], "theme": "chip-conclusion" },
    "例": { "short": "例", "aliases": ["例", "例题", "Example"], "theme": "chip-example" },
    "习题": { "short": "习", "aliases": ["习题", "练习", "练习题", "Exercise"], "theme": "chip-problem" },
    "注": { "short": "注", "aliases": ["注", "注意", "注解"], "theme": "chip-default" }
  }
}
\`\`\`

**硬性约束**：
- \`colSlug\` 推荐使用合法学科标识：\`math\`（数学）、\`cs\`（计算机/算法）、\`science\`（物理/科学）、\`telecom\`（电信/信号/电路）、\`general\`（通识/试卷/其他），只能含小写字母、数字、下划线或连字符。
- \`slug\` 只能含英文小写字母、数字与下划线（如 \`linear_algebra_5th\`），严禁中文、空格或斜杠。
- \`cover\`：务必通过 \`crop_pdf_region\` 从 PDF 第 1 页（或真实封面页）裁剪保存为 \`book/images/cover.jpg\`，编译器会自动将其内嵌至 ABP 并重写为 \`/abp-packs/<col>-<slug>/images/cover.jpg\`。
- \`sections\`：必须按原书“章”分组（\`title\` 为章标题）。若某章章名下直接附有**归属于章本身、不隶属于任何小节的章首导语（如 Chapter 0 Prologue / 章前导言）**，必须将其独立保存为 \`kind: "chapter-intro"\` 的 \`.mdx\` 文件并在该分组设置 \`"intro": "该导语文件名.mdx"\`——**严禁将 \`intro\` 同时列入 \`chapters[]\`，也严禁将其硬塞进第一节正文**；阅读器会自动把章首导语置于该章首节 \`<h1>\` 上方的克制学术导读区。
- **跳过纯目录/索引页**：全书目录（Contents / 目录）、框目表（List of Boxes / List of Figures）与书末名词索引（Index）已在侧栏目录树与全局检索中体现，且原书印刷页码在数字阅读器中无意义，**教材模式下禁止新建目录或索引章节**（保留 Preface / Foreword / Prologue / Acknowledgments 等前置正文）。
- \`entryPoint\`：对应某章可浏览正文的 \`cleanSlug\`（不含 \`.mdx\`，注意不要把仅作为 \`intro\` 的文件单独设成无归属孤立入口）。`,
    },
    {
      id: 'components',
      title: '3. 全量 AstroLib MDX 学术组件语法与适用边界',
      content: `在 \`book/*.mdx\` 中**无需撰写 \`import\` 语句**，直接使用以下标准组件标签（必须严格闭合且属性使用双引号 \`title="..."\`）：

1. **\`<Knowledge title="定理 1.1 名称">...</Knowledge>\`**
   - 用途：专门封装**首次正式声明**的定义、定理、引理、推论、命题、公理、性质、准则、定律、公式卡片。
   - \`title\` 前缀决定图标与右侧大纲 Chip，例如：\`定义 1.1 ...\`、\`定理 2.3 ...\`、\`引理 1 ...\`、\`推论 2 ...\`、\`性质 3 ...\`、\`命题 1 ...\`、\`公理 1 ...\`。
   - ⚠️ **严禁用途**：严禁把正文里“根据定理 1.1 可知……”这种**回顾/引用**包装成 \`<Knowledge>\`！

2. **\`<Example title="例 1.1 [可选简要说明]">...</Example>\`**
   - 用途：教材例题题干。可直接在内部底部嵌套 \`<Analysis>\` 与 \`<Solution>\`：
     \`\`\`mdx
     <Example title="例 1.2">
     计算极限 $\\lim_{x \\to 0} \\frac{\\sin x}{x}$。

     <Analysis title="分析">
     利用重要极限或夹逼准则。
     </Analysis>

     <Solution title="解">
     原式 $= 1$。
     </Solution>
     </Example>
     \`\`\`

3. **\`<Exercise title="练习 1⁺">...</Exercise>\`**
   - 用途：课后习题、试卷真题、思考题、自测题。**每道题必须独立一张 \`<Exercise>\` 卡片**，保留难度上标（如 \`⁺\` / \`⁻\`）。
   - 若原书题后或书末附有答案/提示/解析，在 \`<Exercise>\` 内部嵌套 \`<Solution title="提示">...</Solution>\` 或 \`<Solution title="解答">...</Solution>\`。

4. **\`<Solution title="解">...</Solution>\`**
   - 编译为可折叠学术手风琴 \`<details class="solution-details">\`，结尾自动渲染学术墓碑符 \`∎\`，**不会污染右侧 TOC 大纲**。常用 title：\`解\`、\`证明\`、\`提示\`、\`答案\`。

5. **\`<Analysis title="分析">...</Analysis>\`**、**\`<Method title="方法总结">...</Method>\`**、**\`<Variant title="变式 1">...</Variant>\`**、**\`<Summary title="本节小结">...</Summary>\`**、**\`<Note title="注 1">...</Note>\`**、**\`<Block title="专题底纹块标题">...</Block>\`**
   - \`<Block title="...">\`：**教材中的底纹知识栏、灰底补充专栏、技术插曲（如 *Two's complement*、背景专题框）务必主动识别并用 \`<Block>\` 封装**（渲染为温和克制的 M3 浅灰底纹块），区别于正式定理定义卡 \`<Knowledge>\`（白底硬边框）；双引号属性安全兼容英文撇号（如 \`title="Two's complement"\`）。
   - \`<Note>\` 用于独立成块的较长注记（含公式/推导）；\`<Analysis>\` / \`<Method>\` / \`<Summary>\` 分别用于思路剖析、方法提炼与章节总结。

6. **双轨代码与算法伪代码：\` \`\`\`lang ... \`\`\` \` vs \`<Algorithm title="Figure 1.1 名称">...</Algorithm>\`**
   - **真实编程语言源码**（Python / C++ / TypeScript / Bash 等）：使用标准 Markdown 围栏代码块 \` \`\`\`python ... \`\`\` \`，打包编译器会自动执行编译期 \`highlight.js\` 语法高亮并生成带语言标签与复制按钮的等宽代码块。
   - **教材算法伪代码**（如 \`Figure 1.1 Multiplication à la Française\`、\`function fib2(n)\`、\`procedure Dijkstra(G, l, s)\`）：使用 \`<Algorithm title="Figure 1.1 名称">...</Algorithm>\`（LaTeX \`ruled\` 顶底双线样式），内部规范：
     - **直接使用真实换行符与 2 空格缩进**，行内数学写 \`$...$\`；
     - ❌ **绝对禁止**在 \`<Algorithm>\` 内部使用 \`<br/>\`、\`&nbsp;\`（会触发 \`algorithm-syntax\` Error）或用大量空行把 \`function\`/\`Input:\`/\`Output:\` 拆成药丸标签！

7. **学术脚注（标准 Markdown 页码作用域脚注 \`[^p页码-序号]\`）**
   - 正文引用角标位置写 \`[^p14-1]\`（页码作用域前缀可避免多页重号冲突），文末集中定义 \`[^p14-1]: 脚注正文\`。
   - 阅读器会自动分配本节连续显示编号 \`1, 2, ...\`，支持悬浮气泡预览、平滑跳转与 \`↩\` 返回；**必须将 \`<!-- MINERU_FOOTNOTE pN: ... -->\` 提示与原书页底脚注全部转为标准 \`[^pN-K]\`**，严禁将其留在正文变成普通段落！

7. **\`<SideNote title="思考" type="think">...</SideNote>\`（或 \`<MarginNote>\`）**
   - 用途：教材边缘旁注、简短“想一想”、防错“注意”、几何直观提示。\`type\` 可选 \`note | think | caution | analysis | geom\`，\`side\` 可选 \`right | left\`，\`inline\` 布尔属性强制内联。

8. **\`<DigitalResource id="1.1" title="微课讲解" url="https://..." type="video" />\`**
   - 用途：仅当原书明确带有真实有效 URL 的二维码/数字化微课链接时使用（\`type\`: \`video | courseware | demo | resource\`）。严禁虚构 URL。

9. **Mermaid 图表（仅用于清晰的流程图/拓扑图/状态图）**
   - 使用标准 fenced code block：\`\`\` \`\`\`mermaid ... \`\`\` \`\`\`。支持的图类型：\`flowchart TD/LR\`、\`sequenceDiagram\`、\`stateDiagram-v2\`、\`classDiagram\`、\`erDiagram\`。含括号的节点标签必须加双引号 \`id["标签 (补充)"]\`。`,
    },
    {
      id: 'media-and-katex',
      title: '4. 图片图注与 KaTeX / MDX 硬性语法红线（零容忍门禁）',
      content: `1. **Frontmatter 铁律与正文禁重标题**：每个 \`.mdx\` 文件第 1 行必须是：
   \`\`\`yaml
   ---
   title: "章节显示标题"
   ---
   \`\`\`
   严禁缺少 \`title\`，也不要在标题里使用装饰性 Emoji。
   - ⚠️ **阅读器会自动将 Frontmatter \`title\` 渲染在页面最上方作为唯一 \`<h1>\`！因此正文绝对禁止再写一级标题 \`# ...\`，也严禁在正文开头第一行重复抄写 \`## Chapter 0\` 或 \`## 0.1 Books and algorithms\`**（\`validate_mdx\` 会判定为 \`duplicate-heading\` Error）。正文应直接以 \`chapter-intro\`、自然段或下属三级/次级标题（如 \`## More careful analysis\`、\`## 1.2.1 Modular addition\`）起始。

2. **图片与图注唯一合法写法**：
   - 所有被引用图片必须真实存在于 \`book/images/<filename>\`（如 \`images/p1_abc.jpg\`）。
   - 存在图注时**唯一合法结构**：
     \`\`\`html
     <figure class="vp-figure">![图 1.1 空间向量投影](images/p1_abc.jpg)<figcaption>图 1.1 空间向量投影</figcaption></figure>
     \`\`\`
   - 无图注的纯插图直接写 Markdown：\`![插图描述](images/p1_abc.jpg)\`。
   - ❌ **绝对禁止**在 MDX 中使用原生 \`<img src="images/...">\`（会被 \`validate_mdx\` 拦截为 Error）！
   - ❌ **绝对禁止**嵌套 \`<figure><figure>...</figure></figure>\`。

3. **KaTeX 与 MDX/JSX 避坑清单**：
   - 块级公式必须使用独立段落的 \`$$ ... $$\`（前后留空行），复杂矩阵/分段函数建议独占多行。
   - 行内公式 \`$...$\` 不可跨换行符，且**公式起始 \`$\` 后紧邻字符与结束 \`$\` 前紧邻字符尽量不留多余空格**。
   - **素数标记**：禁止 \`G^\\prime\\prime\` 或 \`G^\\primeprime\` 写法，必须规范为 \`G^{\\prime}\`、\`G^{\\prime\\prime}\` 或 \`G'\`。
   - **标号 \`\\tag\`**：若 \`\\tag\` 内含下标、星号等数学符号（如 \`(*_\\alpha)\`），必须用 \`$...$\` 包裹：\`\\tag{($*_\\alpha$)}\`。
   - **MDX 裸大括号与小于号陷阱**：在 JSX 解析环境下，**数学公式之外的普通中文文本或 Markdown 表格里出现裸 \`{\` / \`}\`** 会导致 MDX 编译直接报错！非公式正文中的花括号必须转义为 \`\\{\` / \`\\}\`（或用反引号包裹），正文里的数学不等号如 \`x < 0\` 必须放入公式 \`$x < 0$\`。
   - **表格波浪线陷阱**：Markdown 表格单元格里的数字范围 \`10~20\` 会被识别为删除线 \`~~\`，必须写为全角 \`10～20\`（或置于 \`$10 \\sim 20$\` 中）。
   - **化学式 / 物理量**：单位与下标使用规范 TeX，如 \`$\\mathrm{m/s^2}$\`、\`$\\Omega$\`。`,
    },
  ],
};
