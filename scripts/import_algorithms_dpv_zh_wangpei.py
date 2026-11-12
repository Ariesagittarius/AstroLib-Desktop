#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Algorithms (Sanjoy Dasgupta, Christos Papadimitriou, Umesh Vazirani - DPV)
中文版（王沛、唐扬斌、刘齐军 译，清华大学出版社）导入流水线

输入:
  - MinerU 提取产物 Part 1 (edce13c1-bc50-4b57-a097-8095e6de272b)
  - MinerU 提取产物 Part 2 (0e6704e7-d08e-41f1-a710-c45c766e1a48)

输出:
  - src/content/docs/collections/cs/algorithms/zh-wp/*.mdx (69篇标准学术篇章)
  - 复制所有新切片图片到 src/content/docs/collections/cs/algorithms/images/*
"""

import os
import re
import sys
import shutil

if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
MINERU_P1 = r"C:\Users\白羊欣存\MinerU\算法概论 (（美）达斯格普特，（美）帕帕迪米特，（美）沃兹内尼著，王沛，唐扬斌，刘齐军译) (z-library.sk, 1lib.sk, z-lib.sk).pdf-edce13c1-bc50-4b57-a097-8095e6de272b"
MINERU_P2 = r"C:\Users\白羊欣存\MinerU\算法概论 (（美）达斯格普特，（美）帕帕迪米特，（美）沃兹内尼著，王沛，唐扬斌，刘齐军译) (z-library.sk, 1lib.sk, z-lib.sk).pdf-0e6704e7-d08e-41f1-a710-c45c766e1a48"

OUT_DIR = os.path.join(PROJECT_ROOT, 'src', 'content', 'docs', 'collections', 'cs', 'algorithms', 'zh-wp')
IMAGES_DEST = os.path.join(PROJECT_ROOT, 'src', 'content', 'docs', 'collections', 'cs', 'algorithms', 'images')

IMPORTS_HEADER = """---
title: '{title}'
---

import Guide from '@/components/Guide.astro';
import Knowledge from '@/components/Knowledge.astro';
import Example from '@/components/Example.astro';
import Analysis from '@/components/Analysis.astro';
import Solution from '@/components/Solution.astro';
import Variant from '@/components/Variant.astro';
import Note from '@/components/Note.astro';
import Block from '@/components/Block.astro';
import Method from '@/components/Method.astro';
import Exercise from '@/components/Exercise.astro';
import Algorithm from '@/components/Algorithm.astro';

"""

BOX_TITLES = [
    '基数和对数', '二进制补码', '您的社会保险号码是素数吗？',
    '多么奇妙的群理论！', 'Carmichael 数', '素数的随机生成',
    '随机算法：一个虚拟的章节', '二分搜索', '排序算法的 nlogn 时间下界',
    'Unix 的 Sort 命令', '为什么是多项式相乘？', '快速算法的缓慢传播',
    '您的图的规模有多大？', '搜索得更快', '哪种堆最好？', '树',
    '最小分割的一个随机算法', '递归？不！', '规划？',
    '公共子问题', '人与鼠', '记忆',
    '时间和空间', '对偶性，一个魔术', '归约',
    '矩阵-向量表示法', '对偶的图形化', '高斯消去法',
    '多项式时间的线性规划', 'Sissa 与 Moore 的故事',
    '为什么是P和NP?', '使用归约的两种途径', '不可解的问题',
    '纠缠', '周期向量的傅立叶变换',
    '构建一个周期性叠加状态', '计算机科学和量子物理的交叉'
]

SECTIONS_SPECS = [
    ('00_preface.mdx', '前言与出版说明', r'^##\s*出版说明'),
    ('00.1_books-and-algorithms.mdx', '0.1 书籍和算法', r'^#\s*chapter0\s*序言'),
    ('00.2_enter-fibonacci.mdx', '0.2 从 Fibonacci 数列开始', r'^##\s*0\.2\s*从\s*Fibonacci\s*数列开始'),
    ('00.3_big-o-notation.mdx', '0.3 大 O 符号', r'^##\s*0\.3\s*大\s*O\s*符号'),
    ('00.4_exercises.mdx', '第0章 习题', r'^##\s*习题'),

    ('01.1_basic-arithmetic.mdx', '1.1 基本算术', r'^#\s*chapter 1\b'),
    ('01.2_modular-arithmetic.mdx', '1.2 模运算', r'^##\s*1\.2\s*模运算'),
    ('01.3_primality-testing.mdx', '1.3 素性测试', r'^##\s*1\.3\s*素性测试'),
    ('01.4_cryptography.mdx', '1.4 密码学', r'^##\s*1\.4\s*密码学'),
    ('01.5_universal-hashing.mdx', '1.5 通用散列表', r'^##\s*1\.5\s*通用散列表'),
    ('01.6_exercises.mdx', '第1章 习题', r'^##\s*习题'),

    ('02.1_multiplication.mdx', '2.1 乘法', r'^#\s*chapter 2\b'),
    ('02.2_recurrence-relations.mdx', '2.2 递推式', r'^##\s*2\.2\s*递推式'),
    ('02.3_mergesort.mdx', '2.3 合并排序', r'^##\s*2\.3\s*合并排序'),
    ('02.4_medians.mdx', '2.4 寻找中项', r'^##\s*2\.4\s*寻找中项'),
    ('02.5_matrix-multiplication.mdx', '2.5 矩阵乘法', r'^##\s*2\.5\s*矩阵乘法'),
    ('02.6_the-fast-fourier-transform.mdx', '2.6 快速Fourier变换', r'^##\s*2\.6\s*快速\s*Fourier\s*变换'),
    ('02.7_exercises.mdx', '第2章 习题', r'^##\s*习题'),

    ('03.1_why-graphs.mdx', '3.1 为什么是图', r'^#\s*chapter 3\b'),
    ('03.2_depth-first-search-in-undirected-graphs.mdx', '3.2 无向图的深度优先搜索', r'^##\s*3\.2\s*无向图的深度优先搜索'),
    ('03.3_depth-first-search-in-directed-graphs.mdx', '3.3 有向图的深度优先搜索', r'^##\s*3\.3\s*有向图的深度优先搜索'),
    ('03.4_strongly-connected-components.mdx', '3.4 强连通部件', r'^##\s*3\.4\s*强连通部件'),
    ('03.5_exercises.mdx', '第3章 习题', r'^##\s*习题'),

    ('04.1_distances.mdx', '4.1 距离', r'^#\s*chapter 4\b'),
    ('04.2_breadth-first-search.mdx', '4.2 广度优先搜索', r'^##\s*4\.2\s*广度优先搜索'),
    ('04.3_lengths-on-edges.mdx', '4.3 边的长度', r'^##\s*4\.3\s*边的长度'),
    ('04.4_dijkstras-algorithm.mdx', '4.4 Dijkstra 算法', r'^##\s*4\.4\s*Dijkstra\s*算法'),
    ('04.5_priority-queue-implementations.mdx', '4.5 优先队列的实现', r'^##\s*4\.5\s*优先队列的实现'),
    ('04.6_shortest-paths-in-the-presence-of-negative-edges.mdx', '4.6 含有负边的图的最短路径', r'^##\s*4\.6\s*含有负边的图的最短路径'),
    ('04.7_shortest-paths-in-dags.mdx', '4.7 有向无环图中的最短路径', r'^##\s*4\.7\s*有向无环图中的最短路径'),
    ('04.8_exercises.mdx', '第4章 习题', r'^##\s*习题'),

    ('05.1_minimum-spanning-trees.mdx', '5.1 最小生成树', r'^#\s*chapter 5\b'),
    ('05.2_huffman-encoding.mdx', '5.2 Huffman 编码', r'^##\s*5\.2\s*Huffman\s*编码'),
    ('05.3_horn-formulas.mdx', '5.3 Horn 公式', r'^##\s*5\.3\s*Horn\s*公式'),
    ('05.4_set-cover.mdx', '5.4 集合覆盖', r'^##\s*5\.4\s*集合覆盖'),
    ('05.5_exercises.mdx', '第5章 习题', r'^##\s*习题'),

    ('06.1_shortest-paths-in-dags-revisited.mdx', '6.1 重新审视有向无环图的最短路径问题', r'^#\s*chapter 6\b'),
    ('06.2_longest-increasing-subsequences.mdx', '6.2 最长递增子序列', r'^##\s*6\.2\s*最长递增子序列'),
    ('06.3_edit-distance.mdx', '6.3 编辑距离', r'^##\s*6\.3\s*编辑距离'),
    ('06.4_knapsack.mdx', '6.4 背包问题', r'^##\s*6\.4\s*背包问题'),
    ('06.5_chain-matrix-multiplication.mdx', '6.5 矩阵链式相乘', r'^##\s*6\.5\s*矩阵链式相乘'),
    ('06.6_shortest-paths.mdx', '6.6 最短路径问题', r'^##\s*6\.6\s*最短路径问题'),
    ('06.7_independent-sets-in-trees.mdx', '6.7 树中的独立集', r'^##\s*6\.7\s*树中的独立集'),
    ('06.8_exercises.mdx', '第6章 习题', r'(?:^##\s*习题|^\s*习\s*题\s*$)'),

    ('07.1_an-introduction-to-linear-programming.mdx', '7.1 线性规划简介', r'^##\s*chapter 7\b'),
    ('07.2_flows-in-networks.mdx', '7.2 网络流', r'^##\s*7\.2\s*网络流'),
    ('07.3_bipartite-matching.mdx', '7.3 二部图的匹配', r'^##\s*7\.3\s*二部图的匹配'),
    ('07.4_duality.mdx', '7.4 对偶', r'^##\s*7\.4\s*对偶'),
    ('07.5_zero-sum-games.mdx', '7.5 零和博弈', r'^##\s*7\.5\s*零和博弈'),
    ('07.6_the-simplex-algorithm.mdx', '7.6 单纯形算法', r'^##\s*7\.6\s*单纯形算法'),
    ('07.7_postscript-circuit-evaluation.mdx', '7.7 后记：电路值', r'^##\s*7\.7\s*后记[：:]\s*电路值'),
    ('07.8_exercises.mdx', '第7章 习题', r'^##\s*习题'),

    ('08.1_search-problems.mdx', '8.1 搜索问题', r'^#\s*chapter 8\b'),
    ('08.2_np-complete-problems.mdx', '8.2 NP-完全问题', r'^##\s*8\.2\s*NP-完全问题'),
    ('08.3_the-reductions.mdx', '8.3 所有的归约', r'^##\s*8\.3\s*所有的归约'),
    ('08.4_exercises.mdx', '第8章 习题', r'^##\s*习题'),

    ('09.1_intelligent-exhaustive-search.mdx', '9.1 智能穷举搜索', r'^#\s*chapter 9\b'),
    ('09.2_approximation-algorithms.mdx', '9.2 近似算法', r'^##\s*9\.2\s*近似算法'),
    ('09.3_local-search-heuristics.mdx', '9.3 局部搜索中的启发方法', r'^##\s*9\.3\s*局部搜索中的启发方法'),
    ('09.4_exercises.mdx', '第9章 习题', r'^##\s*习题'),

    ('10.1_qubits-superposition-and-measurement.mdx', '10.1 量子位元、叠加状态和度量', r'^#\s*chapter 10\b'),
    ('10.2_the-plan.mdx', '10.2 算法设计', r'^##\s*10\.2\s*算法设计'),
    ('10.3_the-quantum-fourier-transform.mdx', '10.3 量子傅立叶变换', r'^##\s*10\.3\s*量子傅立叶变换'),
    ('10.4_periodicity.mdx', '10.4 周期性', r'^##\s*10\.4\s*周期性'),
    ('10.5_quantum-circuits.mdx', '10.5 量子电路', r'^##\s*10\.5\s*量子电路'),
    ('10.6_factoring-as-periodicity.mdx', '10.6 将因子分解问题转化为周期求解问题', r'^##\s*10\.6\s*将因子分解问题转化为周期求解问题'),
    ('10.7_the-quantum-algorithm-for-factoring.mdx', '10.7 因子分解的量子算法', r'^##\s*10\.7\s*因子分解的量子算法'),
    ('10.8_exercises.mdx', '第10章 习题', r'^##\s*习题'),

    ('11.1_historical-notes-and-further-reading.mdx', '历史背景及深入阅读的资料', r'^#\s*历史背景及深入阅读的资料')
]

def clean_math(math_str: str) -> str:
    """清理 KaTeX 不支持的 HTML 实体与异常宏。"""
    s = math_str
    s = s.replace('&lt;', '<').replace('&gt;', '>').replace('&amp;', '&')
    s = re.sub(r'\\nequiv\b', r'\\not\\equiv', s)
    s = s.replace(
        r"\text {there is a setting of the y_{i} 's for which}",
        r"\text {there is a setting of the } y_i \text{ 's for which}"
    )
    return s

def clean_ocr_artifacts(text: str) -> str:
    """清理 MinerU 文本中的 OCR 杂音行与非正文字符。"""
    noise_patterns = [
        r'##\s*39大震图味[^\n]*',
        r'##\s*望类的成[^\n]*',
        r'##\s*图冠天向东[^\n]*',
        r'##\s*\[Unreadable\]',
        r'\[Unreadable\]',
        r'鞍合卧杂签[^\n]*',
        r'do8\s*间意非听[^\n]*',
        r'noztskllu[^\n]*',
        r'1星面0001星不牢[^\n]*',
        r'韵源等，所以援外并发[^\n]*',
        r'封顶千处新几处外多的云翼[^\n]*',
        r'星圆同批药[^\n]*',
        r'同切分总总和前中其虽外数[^\n]*',
        r'各盗许按辛[^\n]*',
        r'登译报自前向本文则提[^\n]*',
        r'箍筋中梁圆余缘处长索[^\n]*',
        r'b×b\s*意开的上面平[^\n]*',
        r'示異的投達平靜機系[^\n]*',
        r'（1）以“去”为基，由各组和合组[^\n]*',
        r'合秉个 n gol 出盛会力量[^\n]*',
        r'。暗长小蟲的同不个[^\n]*',
        r'天个一县入廊，中愿向[^\n]*',
        r'暗字文个题中句子第题出于执[^\n]*',
        r'\(以愿出中间子\)量变差升[^\n]*',
        r'\?即点针些脚针叠隔叠隔守其整余度[^\n]*',
    ]
    for np in noise_patterns:
        text = re.sub(np, '', text)

    # 规范化引号
    text = text.replace('\x92', "'").replace('\x91', "'")
    text = text.replace('’', "'").replace('‘', "'")

    # 转换原生 HTML <img> 标签为 Markdown 格式
    text = re.sub(r'<img\b[^>]*src=["\'](?:images/|\.\./images/)?([^"\']+)["\'][^>]*>', r'![](../images/\1)', text)
    # 转换 Markdown 内部相对图片路径为 ../images/
    text = re.sub(r'!\[(.*?)\]\((?:images/|\.\./images/)?([^)]+)\)', r'![\1](../images/\2)', text)

    # 移除 mineru-algorithm 上的 inline style（防止 JSX 报错）
    text = re.sub(
        r'<div class="mineru-algorithm"[^>]*>',
        r'<div class="mineru-algorithm">',
        text
    )

    return text

def sanitize_mdx(text: str) -> str:
    """保证文本不会破坏 MDX / JSX 编译。精确保护公式与代码块。"""
    protected = []
    def protect(m):
        idx = len(protected)
        protected.append(m.group(0))
        return f"___PROTECTED_{idx}___"

    # 1. 保护代码块
    t = re.sub(r'```[\s\S]*?```', protect, text)

    # 2. 保护行间公式
    def protect_display_math(m):
        math_s = clean_math(m.group(0))
        idx = len(protected)
        protected.append(math_s)
        return f"___PROTECTED_{idx}___"
    t = re.sub(r'\$\$[\s\S]*?\$\$', protect_display_math, t)

    # 3. 保护行内公式 (使用负向后顾保证不匹配 \$ 货币符号)
    def protect_inline_math(m):
        math_s = clean_math(m.group(0))
        idx = len(protected)
        protected.append(math_s)
        return f"___PROTECTED_{idx}___"
    t = re.sub(r'(?<!\\)\$([^\$\n]+?)(?<!\\)\$', protect_inline_math, t)

    # 4. 保护合法的 AstroLib 标签与标准 HTML 标签
    t = re.sub(
        r'</?(?:Exercise|Knowledge|Example|Analysis|Solution|Variant|Note|Block|Method|Guide|Algorithm|img|sup|sub|table|thead|tbody|tfoot|tr|td|th|p|b|i|strong|em|code|pre|div|a|span|h1|h2|h3|h4|h5|h6)(?:\s+[^>\n]*)?/?>',
        protect,
        t
    )

    # 5. 转义正文中裸 < 为 &lt;
    t = t.replace('<', '&lt;')
    # 6. 转义正文中花括号（防止被当作 JSX 表达式）
    t = t.replace('{', '&#123;').replace('}', '&#125;')
    # 7. 转义正文中波浪号（表格内防止被误判删除线）
    t = t.replace('~', '～')

    # 8. 还原受保护内容
    for idx, orig in enumerate(protected):
        t = t.replace(f"___PROTECTED_{idx}___", orig)

    return t

def process_exercise_section(sec_content: str, ch_title: str) -> str:
    """将课后习题切分并完整封装入 <Exercise title="习题 X.Y"> 卡片。"""
    m_head = re.search(r'^(?:##\s*习题|\s*习\s*题\s*)$', sec_content, re.MULTILINE)
    preamble = ""
    rest = sec_content
    if m_head:
        preamble = f"## {ch_title}\n\n"
        rest = sec_content[m_head.end():].strip()

    # 切分习题条目: 匹配行首数字编号如 0.1 或 ## 7.12 或 1.46
    ex_pattern = re.compile(r'^(?:#{0,6}\s*)?(\d+\.\d+)\.?\s+(.*)$', re.MULTILINE)
    matches = list(ex_pattern.finditer(rest))
    if not matches:
        return preamble + rest

    out_chunks = []
    first_start = matches[0].start()
    if first_start > 0:
        intro_text = rest[:first_start].strip()
        if intro_text:
            out_chunks.append(intro_text + "\n\n")

    for i, m in enumerate(matches):
        ex_num = m.group(1)
        start_pos = m.start()
        end_pos = matches[i + 1].start() if i + 1 < len(matches) else len(rest)
        chunk = rest[start_pos:end_pos].strip()

        first_line_end = chunk.find('\n')
        if first_line_end != -1:
            first_line = chunk[:first_line_end]
            remaining = chunk[first_line_end+1:].strip()
            m_first = ex_pattern.match(first_line)
            first_body = m_first.group(2) if m_first else first_line
            body = (first_body + "\n\n" + remaining).strip() if remaining else first_body.strip()
        else:
            m_first = ex_pattern.match(chunk)
            body = m_first.group(2).strip() if m_first else chunk

        card = f'<Exercise title="习题 {ex_num}">\n\n{body}\n\n</Exercise>\n'
        out_chunks.append(card)

    return preamble + "\n".join(out_chunks)

def process_regular_section(sec_content: str, sec_num_title: str) -> str:
    """处理常规小节：章节引言格式化、Box 卡片化。"""
    c = sec_content

    # 规范化各章标题
    c = re.sub(r'^#\s*chapter0\s*序言', '## 序言', c, flags=re.MULTILINE)
    c = re.sub(r'^#\s*chapter 1\s*\n+#\s*数字的算法', '## 第1章 数字的算法', c, flags=re.MULTILINE)
    c = re.sub(r'^#\s*chapter 2\s*\n+#\s*分治算法', '## 第2章 分治算法', c, flags=re.MULTILINE)
    c = re.sub(r'^#\s*chapter 3\s*\n+##\s*图的分解', '## 第3章 图的分解', c, flags=re.MULTILINE)
    c = re.sub(r'^#\s*chapter 4\s*图中的路径', '## 第4章 图中的路径', c, flags=re.MULTILINE)
    c = re.sub(r'^#\s*chapter 5\s*\n+#\s*贪心算法', '## 第5章 贪心算法', c, flags=re.MULTILINE)
    c = re.sub(r'^#\s*chapter 6\s*\n+##\s*动态规划', '## 第6章 动态规划', c, flags=re.MULTILINE)
    c = re.sub(r'^##\s*chapter 7\s*\n+##\s*线性规划与归约', '## 第7章 线性规划与归约', c, flags=re.MULTILINE)
    c = re.sub(r'^#\s*chapter 8\s*NP-完全问题', '## 第8章 NP-完全问题', c, flags=re.MULTILINE)
    c = re.sub(r'^#\s*chapter 9\s*\n+#\s*NP-完全问题的处理', '## 第9章 NP-完全问题的处理', c, flags=re.MULTILINE)
    c = re.sub(r'^#\s*chapter 10\s*[\s\S]*?##\s*量子算法', '## 第10章 量子算法', c, flags=re.MULTILINE)

    # 包装 Box 专栏
    for box in BOX_TITLES:
        pat = rf'^(##\s+{re.escape(box)}\b[^\n]*)'
        m = re.search(pat, c, re.MULTILINE)
        if m:
            start_idx = m.start()
            next_h = re.search(r'\n(?=##\s+)', c[m.end():])
            if next_h:
                end_idx = m.end() + next_h.start()
            else:
                end_idx = len(c)
            box_body = c[m.end():end_idx].strip()
            clean_box = f'<Knowledge title="专栏: {box}">\n\n{box_body}\n\n</Knowledge>'
            c = c[:start_idx] + clean_box + c[end_idx:]

    return c

def main():
    print("=== DPV 算法概论中文版（王沛等译）导入流水线 ===")
    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(IMAGES_DEST, exist_ok=True)

    with open(os.path.join(MINERU_P1, "full.md"), encoding="utf-8") as f:
        t1 = f.read()
    with open(os.path.join(MINERU_P2, "full.md"), encoding="utf-8") as f:
        t2 = f.read()

    full_text = t1 + "\n" + t2
    print(f"合并后总字符数: {len(full_text):,}")

    cuts = []
    cur = 0
    for filename, title, pat in SECTIONS_SPECS:
        m = re.search(pat, full_text[cur:], re.MULTILINE)
        if not m:
            print(f"❌ 错误: 未能在位置 {cur} 之后匹配到 {filename} ({title})")
            sys.exit(1)
        pos = cur + m.start()
        cuts.append((filename, title, pos))
        cur = pos + len(m.group(0))

    cuts.append(("END", "END", len(full_text)))

    for i in range(len(cuts) - 1):
        filename, title, start_pos = cuts[i]
        _, _, end_pos = cuts[i + 1]

        raw_chunk = full_text[start_pos:end_pos].strip()

        # 清理 OCR 杂音
        cleaned = clean_ocr_artifacts(raw_chunk)

        # 习题章与常规章分流
        if 'exercises' in filename or '习题' in title:
            processed = process_exercise_section(cleaned, title)
        else:
            processed = process_regular_section(cleaned, title)

        # MDX 转义防御
        final_body = sanitize_mdx(processed)

        # 组装输出
        out_content = IMPORTS_HEADER.format(title=title) + final_body + "\n"
        out_path = os.path.join(OUT_DIR, filename)

        with open(out_path, 'w', encoding='utf-8') as f_out:
            f_out.write(out_content)

        print(f"[{i+1:02d}/69] 已生成: {filename:45} ({len(out_content):6d} 字符)")

    print("\n=== 正在同步图片切片 ===")
    p1_imgs = os.path.join(MINERU_P1, "images")
    p2_imgs = os.path.join(MINERU_P2, "images")

    copied_count = 0
    for src_dir in [p1_imgs, p2_imgs]:
        if os.path.exists(src_dir):
            for img in os.listdir(src_dir):
                s_path = os.path.join(src_dir, img)
                d_path = os.path.join(IMAGES_DEST, img)
                if not os.path.exists(d_path):
                    shutil.copy2(s_path, d_path)
                    copied_count += 1

    print(f"已同步新增图片: {copied_count} 张 (目标目录现有总数: {len(os.listdir(IMAGES_DEST))} 张)")
    print("\n✅ 导入完成！")

if __name__ == '__main__':
    main()
