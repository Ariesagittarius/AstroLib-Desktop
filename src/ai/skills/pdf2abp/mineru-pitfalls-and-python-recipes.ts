/**
 * src/ai/skills/pdf2abp/mineru-pitfalls-and-python-recipes.ts
 * ============================================================================
 * Skill 5: MinerU 常见 OCR 陷阱与沙箱 Python 预处理菜谱
 * ============================================================================
 */

import type { SkillDocument } from './types.ts';

export const mineruPitfallsSkill: SkillDocument = {
  id: 'mineru-pitfalls-and-python-recipes',
  title: 'MinerU OCR 常见缺陷清单与 Python 辅助脚本菜谱',
  summary: '归纳双层/扫描 PDF 经 MinerU 解析后的高频字符/公式/结构错漏，并提供直接在工作区 run_python 中使用的实用处理思路。',
  audience: 'both',
  tags: ['mineru', 'ocr', 'python', 'troubleshooting'],
  sections: [
    {
      id: 'ocr-pitfalls',
      title: '1. MinerU 高频缺陷清单',
      content: `1. **双层 PDF 坏字体映射**：部分影印 PDF 自带损坏文本层，MinerU 若未开启纯视觉覆盖，容易出现同音/形近错字（如“图 $G$”→“是因”、“围长”→“国长”、“连通”→“连涵/迹遍”、“圈”→“困”）。须看原页图识别并在 \`run_python\` 或子代理校对中全面修正。
2. **素数与导数上标畸变**：\`G^\\prime\\prime\` 或 \`f^\\prime(x)\` 在部分 KaTeX 版本或转义中报错，统一写成 \`G^{\\prime}\`、\`G^{\\prime\\prime}\` 或 \`f'(x)\`。
3. **跨分卷公式边界粘连**：前一卷结尾 \`$$\` 与后一卷开头 \`$$\` 紧邻可能导致块级状态反转；\`stitchMineruParts\` 已做初步防护，但跨页长公式仍需核对。
4. **纯数字/小数被误判为 Markdown 标题**：如数据表格里的 \`## 4.5 5.0 4.7\` 绝不可当成章节切分点。
5. **选择题选项粘连或错行**：高考试卷或习题册常出现 \`A. ... B. ...\` 挤在同一行或被识别进表格，建议规整为清晰的换行选项（\`A. ...\\n\\nB. ...\` 或标准排布）以提升阅读体验。
6. **习题答案分离**：教材习题在第 X 章末，而提示与答案集中在书末附录。切勿把答案丢掉！应由主 Agent 用 \`run_python\` 解析答案区并按章节/题号匹配分发到对应 \`<Exercise>\` 切片规则中。
7. **页脚注释被拆成草稿提示 \`MINERU_FOOTNOTE\`**：切片器已将 MinerU 识别到的 \`footnote\` 块转为 \`<!-- MINERU_FOOTNOTE pN: ... -->\`。校对时切忌将其原封不动变成普通正文或遗漏，须对照原页图寻找正文上标数字并改为 \`[^pN-K]\` 与文末 \`[^pN-K]: ...\`。
8. **灰底知识块与算法框扁平化**：MinerU 经常把带有灰底阴影框的小专栏（如 *Two's complement*）或算法伪代码框退化为普通段落、甚至丢失缩进与撇号。必须看原图识别其边界，分别用 \`<Block title="...">\` 与 \`<Algorithm title="...">\`（真实换行+2空格缩进）精密重建。`,
    },
    {
      id: 'python-recipes',
      title: '2. 沙箱 Python (run_python) 高效应用菜谱',
      content: `调用 \`run_python\` 时，进程默认工作目录即为本任务工作区，且已注入环境变量：
- \`ASTROLIB_WORKSPACE_DIR\`（工作区根目录）
- \`ASTROLIB_SOURCE_PDF\`（源 PDF 绝对路径）
- \`ASTROLIB_MINERU_DIR\`（\`mineru/stitched/\` 目录，内含 \`full.md\`、\`pages_blocks.json\`、\`images/\`）
- \`ASTROLIB_BOOK_DIR\`（\`book/\` 最终输出目录）
- \`ASTROLIB_CHUNKS_DIR\`（\`chunks/\` 目录）

典型高价值用途：
1. **全局统计与目录-页码映射探测**：读取 \`mineru/stitched/pages_blocks.json\`，过滤 \`type == 'title'\` 或正则匹配 \`第[一二三四五六七八九十0-9]+章\`，瞬间精确算出“书内印刷页码”与“PDF 物理页码”的真实偏移量 \`offset\`！
2. **题号与书末答案精准对齐**：对包含上百道习题的书籍，编写 Python 脚本从书末答案页抽取 \`{章号: {题号: 答案文本}}\`，直接写入 \`chunks/hints_map.json\` 或合并进各章 \`draft.md\`，省去子代理大量 token 且零漏题！
3. **批量符号/标点预清洗**：如批量把 MDX 非公式区裸 \`{\`/\`}\`、表格 \`~\`、破损 \`\\primeprime\` 在切片阶段预先清零。`,
    },
  ],
};
