import type { SkillDocument } from './types.ts';

export const academicTypesettingSkill: SkillDocument = {
  id: 'academic-typesetting-rules',
  title: '学术出版级排版与五大防御准则',
  summary: '定义“内容即界面”的极端减法哲学、章节拆分命名规范以及杜绝 OCR 常见结构污染的五大核心防御机制。',
  audience: 'both',
  tags: ['typesetting', 'subtraction', 'defenses', 'splitting'],
  sections: [
    {
      id: 'radical-subtraction',
      title: '1. 北极星准则：内容即界面 (The Content is the Interface)',
      content: `AstroLib 面向大学师生、科研工作者与严肃学习者，产出高精密理工科教材与学术文献包。必须严格践行**极端减法原则**：
- ❌ **严禁引入教学管理/SaaS 噪音**：禁止编造“学习目标”“重点星级”“预计用时”“打卡复选框”“得分统计”“加油提示语”等原文不存在的元素。
- ❌ **严禁堆砌装饰图标与 Emoji**：章节文件名、Frontmatter \`title\`、正文标题 \`## ...\`、卡片 \`title\` 中一律严禁插入 🚀✨📌📖💡 等 Emoji。
- ✅ **忠实于原书学术气质**：仅保留并结构化呈现原书真正的数学定义、定理、推导、例题、旁注、插图、表格、练习与题解。`,
    },
    {
      id: 'five-defenses',
      title: '2. 必须严格执行的五大质量防御机制',
      content: `1. **防御一：定理声明 vs 定理引用严格分流 (Theorem Reference Defense)**
   - 仅当某个定理、定义、引理、命题、推论在当前位置**首次给出完整陈述/定义**时，才用 \`<Knowledge title="定理 1.2 ...">\` 包装；
   - 若正文只是回顾或引用前文（如“由定理 1.2 立即得到…”、“正如定义 2.1 中所述…”），**绝对保持为普通段落文本**；
   - 凡“注解/历史考据/文献评注”性质的章节（文件名含“注解”），**全篇严禁包装任何 \`<Knowledge>\` 卡片**。

2. **防御二：小节边界 1:1 对齐与禁重标题防线 (Section Boundary & Heading Defense)**
   - **禁止合并或拆散小节**：教材必须严格按照原书层级拆分（如 \`0.1\`、\`0.2\`、\`0.3\` 各自独立文件；\`1.2.3\` 必须留在 \`1.2\` 内部作为 \`## 1.2.3\` 子标题，严禁把 \`1.2.3\` 与 \`1.2.4\` 拆出合并并列到章目录）；
   - **章首导语独立承载**：紧随章标题后、第一节 \`X.1\` 之前的导语（如 *Chapter 0 Prologue*）必须独立成文件并在 \`book.json\` 通过 \`sections[].intro\` 挂载，绝不混入 \`0.1\`；
   - **禁止正文顶部重复标题**：阅读器已在页首渲染 \`<h1>{title}</h1>\`，禁止正文写 \`# \` 或在开头重复 \`## <与 title 相同的小节名>\`；
   - 每篇 \`.mdx\` 结束处必须在下一小节前精准截断（同页起止可用 \`startAnchor\`/\`endAnchor\`），严禁末尾残留下一节标题。

3. **防御三：图注语义绑定与主动识别底纹块/算法/脚注 (Structure & Rich Block Defense)**
   - 把图片与紧随其后的“图 X.X / Figure X.X …”文字绑定为单一 \`<figure class="vp-figure">![图 X.X ...](images/...)<figcaption>图 X.X ...</figcaption></figure>\`；
   - **主动识别底纹块与算法块**：看到原书灰色背景知识专栏（如 *Two's complement*）立刻封装 \`<Block title="...">...</Block>\`；看到算法框立刻封装 \`<Algorithm title="...">...</Algorithm>\`（使用真实换行与 2 空格缩进，禁用 \`<br/>\` 与 \`&nbsp;\`）；看到页面底部脚注务必转换为文内 \`[^pN-K]\` 与文末 \`[^pN-K]: ...\`（清除全部 \`<!-- MINERU_FOOTNOTE\` 提示）。

4. **防御四：密集习题原子离散化 (Dense Exercise Segmentation)**
   - 试卷试题或教材课后题（哪怕每章 50~100 题）必须**逐题拆分为独立的 \`<Exercise title="练习 N[⁺/⁻]">\`（或 \`<Exercise title="第 N 题">\`）**，严禁把多道题揉成一团放在纯文本列表或单张卡片里；
   - 若书末附有全书统一的“习题答案与提示”，主 Agent 应当在策划或收口阶段使用 \`run_python\` 脚本将对应章/题号的答案精确提取并内嵌至对应 \`<Exercise>\` 内部的 \`<Solution title="提示">\` / \`<Solution title="答案">\` 中，同时可保留“附录：习题参考答案”章节以便通览。

5. **防御五：原书高清扫描页为唯一真理源 (Ground Truth Visual Override)**
   - MinerU OCR 文本层经常出现形近错字（如把 \`图 G\` 识别为 \`因 G\`、\`围长\` 识别为 \`国长\`、\`|G|\` 识别为 \`IGI\`、矩阵行列对齐错乱、上下标掉出公式、希腊字母 \`\\nu/v\`, \`\\xi/\\zeta\`, \`\\varphi/\\phi\` 混淆、漏掉整行小字或难度星号 \`⁺\`）。
   - **只要文本读起来有任何语义不通或符号可疑，必须对照对应物理页图片逐符号修正！**`,
    },
    {
      id: 'naming-and-splitting',
      title: '3. 章节文件命名与粒度规划规范',
      content: `为保证 \`naturalSort\` 自然排序准确（\`01\` 在 \`02\` 前，\`1.2\` 在 \`1.10\` 前）且 URL cleanSlug 稳定无冲突：
- **卷首与跳页规则**：跳过全书目录（Contents / List of Boxes / 目录）与书末索引（Index），仅保留 Preface / Foreword / Acknowledgments 等有实质正文的前置章节。
- **常规教材（严格按章分组 + 小节 1:1 拆分）**：在 \`book.json\` 的 \`sections[]\` 中按“第 N 章”分组；若有不隶属任何小节的章首导语（如 Prologue），设独立文件并用 \`sections[].intro\` 引用（勿写入 \`chapters[]\`）；各小节按 \`X.1\`、\`X.2\` 严格 1:1 对应独立 \`.mdx\`（将 \`X.Y.Z\` 作为小节内 \`##\` 子标题），每章末设 \`Exercises (Chapter N)\`。
- **论文 / 试卷 / 讲义**：可将 \`documentMode\` 设为 \`"paper"\`、\`"exam"\` 或 \`"monograph"\` 并按逻辑部分分组。
- **文件名安全字符**：文件名前缀使用两位或三位数字序号 \`00_\`、\`01_\`…，避免使用冒号 \`:\`、问号 \`?\`、星号 \`*\`、斜杠 \`/\` 等非法字符；文件名不要塞入复杂 LaTeX 命令。`,
    },
  ],
};
