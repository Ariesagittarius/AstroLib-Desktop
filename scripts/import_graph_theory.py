#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/import_graph_theory.py
=============================================================================
AstroLib 教材入库编译流水线: 《图论 (原书第五版)》
(J. Reinhard Diestel 著, 于青林 译, 科学出版社 / 现代数学译丛)
=============================================================================
输入:
  - Part 1: c7feb374-75cc-4aee-86dd-55158f19938d (前言、目录、第1~7章)
  - Part 2: 31c356c5-a6bc-4b2e-8621-0c27c1e1e07a (第8~12章、附录A/B、全书提示)
  - Part 3: b5c4a0df-968d-4360-9e2f-603a18eb66ce (全书索引、现代数学译丛已出书目)

输出:
  - content-sources/collections/math/graph_theory/*.mdx (100 篇高质量结构化篇章)
  - content-sources/collections/math/graph_theory/images/* (全部高清插图切片)
  - public/covers/graph_theory.jpg (高清书封)
=============================================================================
"""

import os
import re
import sys
import shutil

# 导入通用解析器基础构件
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib.book_converter import BookConverter
from lib.card_parser import CardParser
from lib.mdx_sanitizer import MdxSanitizer, TextCleaner

if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))

D0 = r"C:\Users\白羊欣存\MinerU\图论 (原书第五版) (J Reinhard Diestel 著, 于青林 译) (z-library.sk, 1lib.sk, z-lib.sk).pdf-c7feb374-75cc-4aee-86dd-55158f19938d"
D1 = r"C:\Users\白羊欣存\MinerU\图论 (原书第五版) (J Reinhard Diestel 著, 于青林 译) (z-library.sk, 1lib.sk, z-lib.sk).pdf-31c356c5-a6bc-4b2e-8621-0c27c1e1e07a"
D2 = r"C:\Users\白羊欣存\MinerU\图论 (原书第五版) (J Reinhard Diestel 著, 于青林 译) (z-library.sk, 1lib.sk, z-lib.sk).pdf-b5c4a0df-968d-4360-9e2f-603a18eb66ce"

OUT_DIR = os.path.join(PROJECT_ROOT, 'content-sources', 'collections', 'math', 'graph_theory')
OUT_IMAGES = os.path.join(OUT_DIR, 'images')
COVERS_DIR = os.path.join(PROJECT_ROOT, 'public', 'covers')

IMPORTS_HEADER = """import Guide from '@/components/Guide.astro';
import Knowledge from '@/components/Knowledge.astro';
import Example from '@/components/Example.astro';
import Analysis from '@/components/Analysis.astro';
import Solution from '@/components/Solution.astro';
import Variant from '@/components/Variant.astro';
import Note from '@/components/Note.astro';
import Block from '@/components/Block.astro';
import Method from '@/components/Method.astro';
import Exercise from '@/components/Exercise.astro';
"""

# OCR 通用修正表 (专为 Part 2 常见字体异构与错字优化)
OCR_REPLACEMENTS = [
    # 词汇级修复
    ('子阁', '子图'),
    ('可数阁', '可数图'),
    ('有限子阁', '有限子图'),
    ('无限阁', '无限图'),
    ('多重阁', '多重图'),
    ('同构拷贝', '同构拷贝'),
    ('弦母图', '弦图'),
    ('极太', '极大'),
    ('较太', '较大'),
    ('有越性质', '有趣性质'),
    ('重巢', '重要'),
    ('这垦', '这里'),
    ('走理', '定理'),
    ('良扭序', '良拟序'),
    ('良撒序', '良拟序'),
    ('禁用于式', '禁用子式'),
    ('阔函数', '阈函数'),
    ('髓机', '随机'),
    ('日京每个', '且每个'),
    ('通用的(皿versal)', '通用的 (universal)'),
    ('组合集合论(∞皿binatorialset theory)', '组合集合论 (combinatorial set theory)'),
    ('Ha阳宜盯ml', 'Hamilton'),
    ('随机变蠢', '随机变量'),
    ('一~致件‘', '一致性'),
    ('如呆', '如果'),
    ('相交的阁的圈', '相交的图的圈'),
    ('中心顶点肴', '中心顶点看'),
    ('围民', '围长'),
    ('王色定理', '五色定理'),
    ('周到。的邻点', '用到 v 的邻点'),
    ('超滤子 (ultra lter)', '超滤子 (ultrafilter)'),
    ('## .4连通度和匹配', '## 8.4 连通度和匹配'),
    ('命题 1.3.1 对每个常数', '命题 11.3.1 对每个常数'),
    ('引理 口1.3.2', '引理 11.3.2'),
    ('引理 1.3.2 对每个常数', '引理 11.3.2 对每个常数'),
    ('定理 8.1.3 对每个局部有限', '定理 8.7.3 对每个局部有限'),
    # 墓碑符标准化
    ('□', '∎'),
    ('☐', '∎'),
    ('■', '∎'),
]

def clean_ocr_text(text: str) -> str:
    s = text
    for old, new in OCR_REPLACEMENTS:
        s = s.replace(old, new)
    return s

def parse_exercises(lines: list[str]) -> list[tuple[str, str]]:
    """解析章节练习为列表 [(题目标题, 题目正文)]。
    识别形如:
      1. 完全图...
      4. $^{-}$ 命题...
      9. $^{+}$ 证明...
      10. 证明...
    """
    exercises = []
    cur_title = None
    cur_buf = []

    # 匹配数字题号，允许后跟 $^{-}$ 或 $^{+}$ 难度标记
    num_re = re.compile(r'^(?:#{1,6}\s*)?(\d+)\.\s*(?:\$([+\-－]))?\s*(.*)$')

    for raw in lines:
        s = raw.strip()
        m = num_re.match(s)
        if m:
            if cur_title is not None and cur_buf:
                exercises.append((cur_title, '\n'.join(cur_buf).strip()))
            num = m.group(1)
            sign = m.group(2)
            rest = m.group(3)
            diff_suffix = ''
            if sign in ('-', '－'):
                diff_suffix = '⁻'
            elif sign == '+':
                diff_suffix = '⁺'
            cur_title = f"练习 {num}{diff_suffix}"
            cur_buf = [rest] if rest else []
        else:
            if cur_title is not None:
                cur_buf.append(raw)
            else:
                # 练习前序说明段落（如有）
                if s:
                    cur_buf.append(raw)

    if cur_title is not None and cur_buf:
        exercises.append((cur_title, '\n'.join(cur_buf).strip()))

    return exercises

def parse_hints_by_chapter(hints_text: str) -> dict[int, dict[int, str]]:
    """解析所有练习提示为按章节、按题号组织的字典:
    { 1: { 1: "在每个顶点...", 2: "对于平均度..." }, ... }
    """
    cleaned = clean_ocr_text(hints_text)
    # 按 '## 章提示' 或 '## 10 章提示' 切割
    ch_blocks = re.split(r'##\s*(?:\d+\s*)?章提示', cleaned)
    chapter_hints = {}

    hint_re = re.compile(r'^(?:#{1,6}\s*)?(\d+)[\.、\s]\s*(.*)$')

    for ch_idx, block in enumerate(ch_blocks[1:], 1):
        cur_num = None
        cur_buf = []
        ch_dict = {}
        for line in block.split('\n'):
            s = line.strip()
            m = hint_re.match(s)
            if m:
                if cur_num is not None and cur_buf:
                    ch_dict[cur_num] = '\n'.join(cur_buf).strip()
                cur_num = int(m.group(1))
                cur_buf = [m.group(2)] if m.group(2) else []
            else:
                if cur_num is not None:
                    cur_buf.append(line)
        if cur_num is not None and cur_buf:
            ch_dict[cur_num] = '\n'.join(cur_buf).strip()
        chapter_hints[ch_idx] = ch_dict

    return chapter_hints

IMG_LINE_RE = re.compile(r'^\s*!\[(.*?)\]\(((?:\./)?images/[^)]+)\)\s*(?:\\|\s)*$')
CAP_LINE_RE = re.compile(r'^\s*(?:#{1,6}\s*)?(图|Figure)\s*(\d+(?:[\.\-－]\d+)*)\s*(.*?)(?:\\|\s)*$')

def clean_section_chunk(chunk: list[str]) -> list[str]:
    """清洗章节切片：剔除首部章节标题（frontmatter 已定义）与末尾泄漏的下一节/下一章标题。"""
    lines = list(chunk)
    # 1. 剔除首部重复标题与空行
    while lines:
        first = lines[0].strip()
        if not first:
            lines.pop(0)
            continue
        if re.match(r'^#{1,6}\s+', first):
            lines.pop(0)
            continue
        break
    # 2. 剔除末尾泄漏的下一节/下一章标题与空行
    while lines:
        last = lines[-1].strip()
        if not last:
            lines.pop()
            continue
        if re.match(r'^#{1,6}\s+', last):
            lines.pop()
            continue
        break
    return lines

def format_figures_in_text(text: str) -> str:
    """将正文中的图片及其下方图注标准化包装为语义化 <figure class="vp-figure"><figcaption>...</figcaption></figure>。"""
    lines = text.splitlines()
    out = []
    i = 0
    n = len(lines)

    while i < n:
        line = lines[i]
        m_img = IMG_LINE_RE.match(line)
        if m_img:
            alt = m_img.group(1).strip()
            src = m_img.group(2).strip()

            # 向下探测图注（允许空行间隔）
            caption_line = None
            cap_idx = -1
            for j in range(i + 1, min(n, i + 4)):
                next_raw = lines[j]
                if not next_raw.strip():
                    continue
                m_cap = CAP_LINE_RE.match(next_raw)
                if m_cap:
                    caption_line = next_raw.strip()
                    cap_idx = j
                break  # 仅检查紧随其后的首个非空行

            if caption_line:
                m_c = CAP_LINE_RE.match(caption_line)
                c_tag = m_c.group(1)
                c_num = m_c.group(2)
                c_rest = m_c.group(3).strip()
                norm_caption = f"{c_tag} {c_num} {c_rest}".strip()

                fig_block = (
                    f'<figure class="vp-figure">\n'
                    f'  ![{alt}]({src})\n'
                    f'  <figcaption>{norm_caption}</figcaption>\n'
                    f'</figure>'
                )
                out.append(fig_block)
                i = cap_idx + 1
                continue
            else:
                fig_block = (
                    f'<figure class="vp-figure">\n'
                    f'  ![{alt}]({src})\n'
                    f'</figure>'
                )
                out.append(fig_block)
                i += 1
                continue
        else:
            out.append(line)
            i += 1

    return '\n'.join(out)

def write_mdx_file(out_path: str, title: str, body_content: str):
    sanitizer = MdxSanitizer()
    safe_title = sanitizer.clean_yaml_title(title)
    formatted_body = format_figures_in_text(body_content)
    header = f"---\ntitle: '{safe_title}'\n---\n\n{IMPORTS_HEADER}\n"
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(header + formatted_body.strip() + '\n')

def main():
    print("=" * 70)
    print("🚀 开始执行 《图论 (原书第五版)》 端到端清洗与模块化入库...")
    print("=" * 70)

    # 1. 确保目录环境与封面
    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(OUT_IMAGES, exist_ok=True)
    os.makedirs(COVERS_DIR, exist_ok=True)

    # 复制封面图片
    cover_dst = os.path.join(COVERS_DIR, 'graph_theory.jpg')
    if not os.path.exists(cover_dst):
        # 尝试直接从 Part 1 origin.pdf 抽取高清第 0 页
        origin_pdf = os.path.join(D0, '49d3f16d-0681-4f21-b506-c6a0d83b41f7_origin.pdf')
        if os.path.exists(origin_pdf):
            try:
                import fitz
                doc = fitz.open(origin_pdf)
                pix = doc[0].get_pixmap(dpi=150)
                pix.save(cover_dst)
                print(f"✅ 从原书 PDF 提取封面: {cover_dst} ({pix.width}x{pix.height})")
            except Exception as e:
                print(f"⚠️ 提取封面失败: {e}")

    # 2. 批量聚合复制所有 509 张高清切片插图
    print("\n📦 正在收集并汇聚 3 个原书卷册中的全部高清插图...")
    copied_imgs = 0
    for d in [D0, D1, D2]:
        img_src_dir = os.path.join(d, 'images')
        if os.path.exists(img_src_dir):
            for img_name in os.listdir(img_src_dir):
                src_file = os.path.join(img_src_dir, img_name)
                dst_file = os.path.join(OUT_IMAGES, img_name)
                if os.path.isfile(src_file) and not os.path.exists(dst_file):
                    shutil.copy2(src_file, dst_file)
                    copied_imgs += 1
    print(f"✅ 插图汇聚完成，共聚合 {len(os.listdir(OUT_IMAGES))} 张插图（本次新复制 {copied_imgs} 张）")

    # 3. 读取原始 Markdown
    print("\n📖 正在读取 3 个 MinerU 原始 markdown 文本...")
    with open(os.path.join(D0, 'full.md'), 'r', encoding='utf-8') as f:
        text0 = f.read()
    with open(os.path.join(D1, 'full.md'), 'r', encoding='utf-8') as f:
        text1 = f.read()
    with open(os.path.join(D2, 'full.md'), 'r', encoding='utf-8') as f:
        text2 = f.read()

    lines0 = text0.splitlines()
    lines1 = clean_ocr_text(text1).splitlines()
    lines2 = text2.splitlines()

    print(f"  - Part 1 行数: {len(lines0)}")
    print(f"  - Part 2 行数: {len(lines1)}")
    print(f"  - Part 3 行数: {len(lines2)}")

    sanitizer = MdxSanitizer()
    parser = CardParser(sanitizer)

    # 4. 预解析全书所有练习提示
    print("\n🧠 正在结构化解析全书 12 章课后练习提示...")
    hints_raw_idx = -1
    for i, l in enumerate(lines1):
        if '所有练习的提示' in l:
            hints_raw_idx = i
            break
    all_hints_text = '\n'.join(lines1[hints_raw_idx:]) if hints_raw_idx >= 0 else ''
    chapter_hints = parse_hints_by_chapter(all_hints_text)
    total_hints_count = sum(len(h) for h in chapter_hints.values())
    print(f"✅ 成功解析 {len(chapter_hints)} 个章节共 {total_hints_count} 条题解提示！")

    # 5. 书前导言与目录 (00 ~ 02)
    print("\n📝 正在生成书前导读与结构篇章...")
    # 00 内容简介
    intro_lines = clean_section_chunk(lines0[20:68])
    intro_body = parser.render_body(intro_lines, is_notes=True)
    write_mdx_file(os.path.join(OUT_DIR, '00_内容简介.mdx'), '内容简介', intro_body)
    print("  [page] 生成 00_内容简介.mdx")

    # 01 译者序与前言 (汇集 译者序, 关于第五版, 第四版, 第三版, 第二版, 第一版前言)
    pref_lines = clean_section_chunk(lines0[68:208])
    pref_body = parser.render_body(pref_lines, is_notes=True)
    write_mdx_file(os.path.join(OUT_DIR, '01_译者序与前言.mdx'), '译者序与前言', pref_body)
    print("  [page] 生成 01_译者序与前言.mdx")

    # 02 目录
    toc_lines = clean_section_chunk(lines0[208:345])
    toc_body = parser.render_body(toc_lines, is_notes=True)
    write_mdx_file(os.path.join(OUT_DIR, '02_目录.mdx'), '目录', toc_body)
    print("  [page] 生成 02_目录.mdx")

    # 6. 章节结构元数据矩阵 (92 个章节与习题注解分节)
    # 每个元组定义: (文件名, 页面标题, 原书起始行号, 原书终止行号, 所属卷, 是否为习题, 章号)
    # 行号区间均为左闭右开 [start, end)
    SECTIONS_SPEC = [
        # --- 第1章 ---
        ('1.1_图.mdx', '1.1 图', 346, 404, 0, False, 1),
        ('1.2_顶点度.mdx', '1.2 顶点度', 404, 450, 0, False, 1),
        ('1.3_路和圈.mdx', '1.3 路和圈', 450, 562, 0, False, 1),
        ('1.4_连通性.mdx', '1.4 连通性', 562, 624, 0, False, 1),
        ('1.5_树和森林.mdx', '1.5 树和森林', 624, 706, 0, False, 1),
        ('1.6_二部图.mdx', '1.6 二部图', 706, 731, 0, False, 1),
        ('1.7_收缩运算和子式.mdx', '1.7 收缩运算和子式', 731, 781, 0, False, 1),
        ('1.8_欧拉环游.mdx', '1.8 欧拉环游', 781, 801, 0, False, 1),
        ('1.9_若干线性代数知识.mdx', '1.9 若干线性代数知识', 801, 920, 0, False, 1),
        ('1.10_图中的其他概念.mdx', '1.10 图中的其他概念', 920, 948, 0, False, 1),
        ('1.11_第1章习题.mdx', '第1章 习题', 948, 1085, 0, True, 1),
        ('1.12_第1章注解.mdx', '第1章 注解', 1085, 1101, 0, False, 1),

        # --- 第2章 ---
        ('2.1_二部图中的匹配.mdx', '2.1 二部图中的匹配', 1101, 1213, 0, False, 2),
        ('2.2_一般图中的匹配.mdx', '2.2 一般图中的匹配', 1213, 1325, 0, False, 2),
        ('2.3_Erdos-Posa定理.mdx', '2.3 Erdős-Pósa定理', 1325, 1377, 0, False, 2),
        ('2.4_树填装和荫度.mdx', '2.4 树填装和荫度', 1377, 1454, 0, False, 2),
        ('2.5_路覆盖.mdx', '2.5 路覆盖', 1454, 1479, 0, False, 2),
        ('2.6_第2章习题.mdx', '第2章 习题', 1479, 1568, 0, True, 2),
        ('2.7_第2章注解.mdx', '第2章 注解', 1568, 1596, 0, False, 2),

        # --- 第3章 ---
        ('3.1_2-连通图以及子图.mdx', '3.1 2-连通图以及子图', 1596, 1660, 0, False, 3),
        ('3.2_3-连通图的结构.mdx', '3.2 3-连通图的结构', 1660, 1756, 0, False, 3),
        ('3.3_Menger定理.mdx', '3.3 Menger 定理', 1756, 1901, 0, False, 3),
        ('3.4_Mader定理.mdx', '3.4 Mader 定理', 1901, 1946, 0, False, 3),
        ('3.5_顶点对之间的连接.mdx', '3.5 顶点对之间的连接', 1946, 2121, 0, False, 3),
        ('3.6_第3章习题.mdx', '第3章 习题', 2121, 2223, 0, True, 3),
        ('3.7_第3章注解.mdx', '第3章 注解', 2223, 2245, 0, False, 3),

        # --- 第4章 ---
        ('4.1_拓扑知识准备.mdx', '4.1 拓扑知识准备', 2245, 2291, 0, False, 4),
        ('4.2_平面图.mdx', '4.2 平面图', 2291, 2430, 0, False, 4),
        ('4.3_画法.mdx', '4.3 画法', 2430, 2491, 0, False, 4),
        ('4.4_可平面图：Kuratowski定理.mdx', '4.4 可平面图：Kuratowski 定理', 2491, 2583, 0, False, 4),
        ('4.5_可平面性判别的代数准则.mdx', '4.5 可平面性判别的代数准则', 2583, 2623, 0, False, 4),
        ('4.6_平面对偶性.mdx', '4.6 平面对偶性', 2623, 2702, 0, False, 4),
        ('4.7_第4章习题.mdx', '第4章 习题', 2702, 2830, 0, True, 4),
        ('4.8_第4章注解.mdx', '第4章 注解', 2830, 2852, 0, False, 4),

        # --- 第5章 ---
        ('5.1_地图和可平面图的着色.mdx', '5.1 地图和可平面图的着色', 2852, 2900, 0, False, 5),
        ('5.2_顶点着色.mdx', '5.2 顶点着色', 2900, 3034, 0, False, 5),
        ('5.3_边着色.mdx', '5.3 边着色', 3034, 3083, 0, False, 5),
        ('5.4_列表着色.mdx', '5.4 列表着色', 3083, 3178, 0, False, 5),
        ('5.5_完美图.mdx', '5.5 完美图', 3178, 3364, 0, False, 5),
        ('5.6_第5章习题.mdx', '第5章 习题', 3364, 3497, 0, True, 5),
        ('5.7_第5章注解.mdx', '第5章 注解', 3497, 3533, 0, False, 5),

        # --- 第6章 ---
        ('6.1_环流.mdx', '6.1 环流', 3533, 3615, 0, False, 6),
        ('6.2_网络中的流.mdx', '6.2 网络中的流', 3615, 3711, 0, False, 6),
        ('6.3_群上的流.mdx', '6.3 群上的流', 3711, 3888, 0, False, 6),
        ('6.4_具有较小k值的k-流.mdx', '6.4 具有较小 k 值的 k-流', 3888, 3942, 0, False, 6),
        ('6.5_流和着色的对偶性.mdx', '6.5 流和着色的对偶性', 3942, 4055, 0, False, 6),
        ('6.6_Tutte的流猜想.mdx', '6.6 Tutte 的流猜想', 4055, 4131, 0, False, 6),
        ('6.7_第6章习题.mdx', '第6章 习题', 4131, 4205, 0, True, 6),
        ('6.8_第6章注解.mdx', '第6章 注解', 4205, 4221, 0, False, 6),

        # --- 第7章 ---
        ('7.1_子图.mdx', '7.1 子图', 4221, 4362, 0, False, 7),
        ('7.2_子式.mdx', '7.2 子式', 4362, 4426, 0, False, 7),
        ('7.3_Hadwiger猜想.mdx', '7.3 Hadwiger 猜想', 4426, 4504, 0, False, 7),
        ('7.4_Szemeredi正则性引理.mdx', '7.4 Szemerédi 正则性引理', 4504, 4698, 0, False, 7),
        ('7.5_正则性引理的应用.mdx', '7.5 正则性引理的应用', 4698, 4854, 0, False, 7),
        ('7.6_第7章习题.mdx', '第7章 习题', 4854, 4959, 0, True, 7),
        ('7.7_第7章注解.mdx', '第7章 注解', 4959, len(lines0), 0, False, 7),

        # --- 第8章 (Part 2) ---
        ('8.1_基本的概念结论和技巧.mdx', '8.1 基本的概念、结论和技巧', 0, 172, 1, False, 8),
        ('8.2_路树和末端.mdx', '8.2 路、树和末端', 172, 324, 1, False, 8),
        ('8.3_齐次与通用图.mdx', '8.3 齐次与通用图', 324, 398, 1, False, 8),
        ('8.4_连通度和匹配.mdx', '8.4 连通度和匹配', 398, 568, 1, False, 8),
        ('8.5_递归结构.mdx', '8.5 递归结构', 568, 612, 1, False, 8),
        ('8.6_具有末端的图：全貌.mdx', '8.6 具有末端的图：全貌', 612, 798, 1, False, 8),
        ('8.7_拓扑圈空间.mdx', '8.7 拓扑圈空间', 798, 878, 1, False, 8),
        ('8.8_无限图作为有限图的极限.mdx', '8.8 无限图作为有限图的极限', 878, 948, 1, False, 8),
        ('8.9_第8章习题.mdx', '第8章 习题', 948, 1302, 1, True, 8),
        ('8.10_第8章注解.mdx', '第8章 注解', 1302, 1408, 1, False, 8),

        # --- 第9章 ---
        ('9.1_Ramsey的原始定理.mdx', '9.1 Ramsey 的原始定理', 1408, 1485, 1, False, 9),
        ('9.2_Ramsey数.mdx', '9.2 Ramsey 数', 1485, 1559, 1, False, 9),
        ('9.3_导出Ramsey定理.mdx', '9.3 导出 Ramsey 定理', 1559, 1828, 1, False, 9),
        ('9.4_Ramsey性质与连通性.mdx', '9.4 Ramsey 性质与连通性', 1828, 1875, 1, False, 9),
        ('9.5_第9章习题.mdx', '第9章 习题', 1875, 1923, 1, True, 9),
        ('9.6_第9章注解.mdx', '第9章 注解', 1923, 1939, 1, False, 9),

        # --- 第10章 ---
        ('10.1_充分条件.mdx', '10.1 充分条件', 1939, 2037, 1, False, 10),
        ('10.2_Hamilton圈与度序列.mdx', '10.2 Hamilton 圈与度序列', 2037, 2120, 1, False, 10),
        ('10.3_平方图的Hamilton圈.mdx', '10.3 平方图的 Hamilton 圈', 2120, 2238, 1, False, 10),
        ('10.4_第10章习题.mdx', '第10章 习题', 2238, 2280, 1, True, 10),
        ('10.5_第10章注解.mdx', '第10章 注解', 2280, 2302, 1, False, 10),

        # --- 第11章 ---
        ('11.1_随机图的概念.mdx', '11.1 随机图的概念', 2302, 2488, 1, False, 11),
        ('11.2_概率方法.mdx', '11.2 概率方法', 2488, 2556, 1, False, 11),
        ('11.3_几乎所有图的性质.mdx', '11.3 几乎所有图的性质', 2556, 2644, 1, False, 11),
        ('11.4_阈函数与第二矩量.mdx', '11.4 阈函数与第二矩量', 2644, 2884, 1, False, 11),
        ('11.5_第11章习题.mdx', '第11章 习题', 2884, 2934, 1, True, 11),
        ('11.6_第11章注解.mdx', '第11章 注解', 2934, 2952, 1, False, 11),

        # --- 第12章 ---
        ('12.1_良拟序.mdx', '12.1 良拟序', 2952, 2990, 1, False, 12),
        ('12.2_树的图子式定理.mdx', '12.2 树的图子式定理', 2990, 3027, 1, False, 12),
        ('12.3_树分解.mdx', '12.3 树分解', 3027, 3105, 1, False, 12),
        ('12.4_树宽.mdx', '12.4 树宽', 3105, 3228, 1, False, 12),
        ('12.5_纠缠.mdx', '12.5 纠缠', 3228, 3430, 1, False, 12),
        ('12.6_树分解和禁用子式.mdx', '12.6 树分解和禁用子式', 3430, 3542, 1, False, 12),
        ('12.7_图子式定理.mdx', '12.7 图子式定理', 3542, 3655, 1, False, 12),
        ('12.8_第12章习题.mdx', '第12章 习题', 3655, 3785, 1, True, 12),
        ('12.9_第12章注解.mdx', '第12章 注解', 3785, 3837, 1, False, 12),
    ]

    print(f"\n📚 正在编译生成全书 12 个核心章节（共 {len(SECTIONS_SPEC)} 篇）...")
    for filename, title, start_ln, end_ln, part_idx, is_ex, ch_idx in SECTIONS_SPEC:
        raw_part_lines = lines0 if part_idx == 0 else lines1
        chunk_lines = clean_section_chunk(raw_part_lines[start_ln:end_ln])

        if is_ex:
            # 练习页面: 解析每道习题为 <Exercise> 卡片，并智能内嵌对应的 <Solution title="提示">
            ex_items = parse_exercises(chunk_lines)
            ch_hint_map = chapter_hints.get(ch_idx, {})
            body_parts = []
            for ex_title, ex_content in ex_items:
                # 提取题号匹配提示
                m_num = re.search(r'\d+', ex_title)
                ex_num = int(m_num.group(0)) if m_num else None
                hint_str = ch_hint_map.get(ex_num, '') if ex_num else ''

                clean_ex_content = sanitizer.sanitize_body(ex_content.splitlines())
                if hint_str:
                    clean_hint = sanitizer.sanitize_body(hint_str.splitlines())
                    sol_block = f'\n\n<Solution title="提示">\n{clean_hint}\n</Solution>'
                else:
                    sol_block = ''
                body_parts.append(f'<Exercise title="{ex_title}">\n{clean_ex_content}{sol_block}\n</Exercise>')
            body = f"## {title}\n\n" + '\n\n'.join(body_parts)
        else:
            # 常规理论章节与注解页面 (若为注解页面则禁用定理卡片识别)
            is_notes = ('注解' in title)
            body = parser.render_body(chunk_lines, is_notes=is_notes)

        write_mdx_file(os.path.join(OUT_DIR, filename), title, body)
        print(f"  [page] 生成 {filename} ({title})")

    # 7. 附录与后记 (a1 ~ a5)
    print("\n📑 正在生成附录、全书练习提示、索引与出版书目...")
    # a1 附录A 无限集
    a1_lines = clean_section_chunk(lines1[3837:3913])
    a1_body = parser.render_body(a1_lines)
    write_mdx_file(os.path.join(OUT_DIR, 'a1_附录A_无限集.mdx'), '附录 A 无限集', a1_body)
    print("  [page] 生成 a1_附录A_无限集.mdx")

    # a2 附录B 曲面
    a2_lines = clean_section_chunk(lines1[3913:4024])
    a2_body = parser.render_body(a2_lines)
    write_mdx_file(os.path.join(OUT_DIR, 'a2_附录B_曲面.mdx'), '附录 B 曲面', a2_body)
    print("  [page] 生成 a2_附录B_曲面.mdx")

    # a3 所有练习的提示 (折叠呈现各章提示，整洁学术)
    a3_parts = ["## 所有练习的提示\n\n本书练习题旨在帮助读者深入掌握图论概念与前沿证明技巧。解题遇到困难时，可参考对应章节的提示。\n"]
    for ch_idx in range(1, 13):
        ch_dict = chapter_hints.get(ch_idx, {})
        if ch_dict:
            items_text = []
            for num, hint_text in sorted(ch_dict.items()):
                clean_h = sanitizer.sanitize_body(hint_text.splitlines())
                items_text.append(f"**{num}.** {clean_h}")
            sol_body = '\n\n'.join(items_text)
            a3_parts.append(f'<Solution title="第{ch_idx}章 练习提示">\n{sol_body}\n</Solution>')
    write_mdx_file(os.path.join(OUT_DIR, 'a3_所有练习的提示.mdx'), '所有练习的提示', '\n\n'.join(a3_parts))
    print("  [page] 生成 a3_所有练习的提示.mdx")

    # a4 索引 (Part 3)
    a4_lines = clean_section_chunk(lines2[0:1178])
    a4_body = parser.render_body(a4_lines, is_notes=True)
    write_mdx_file(os.path.join(OUT_DIR, 'a4_索引.mdx'), '索引', a4_body)
    print("  [page] 生成 a4_索引.mdx")

    # a5 现代数学译丛已出版书目 (Part 3)
    a5_lines = clean_section_chunk(lines2[1178:])
    a5_body = parser.render_body(a5_lines, is_notes=True)
    write_mdx_file(os.path.join(OUT_DIR, 'a5_现代数学译丛已出版书目.mdx'), '现代数学译丛已出版书目', a5_body)
    print("  [page] 生成 a5_现代数学译丛已出版书目.mdx")

    print("\n" + "=" * 70)
    print("🎉 《图论 (原书第五版)》 全书 100 篇高质量篇章转换完成！")
    print(f"   输出目录: {OUT_DIR}")
    print("=" * 70)

if __name__ == '__main__':
    main()
