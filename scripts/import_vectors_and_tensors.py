#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
A Student's Guide to Vectors and Tensors (Daniel A. Fleisch)
《大学生理工专题导读：矢量与张量分析》
双语全量导入流水线 (MinerU -> MDX)

输入:
  - 英文原著 Part 1 (a6ac705b-4179-4b3a-a49d-76ee1c175876)
  - 英文原著 Part 2 (9d37d6e3-98f0-40af-ac7e-18180d4f068a)
  - 中文译本 Part 1 (409e75fd-e404-401a-81ea-28006961bb12)
  - 中文译本 Part 2 (c786c44e-89b8-4440-a8fc-da76e2014019)

输出:
  - src/content/docs/collections/science/vectors_and_tensors/*.mdx (50篇英文原著篇章，默认语言)
  - src/content/docs/collections/science/vectors_and_tensors/zh/*.mdx (50篇中文译本篇章)
  - src/content/docs/collections/science/vectors_and_tensors/images/* (全部插图高清切片)
  - public/covers/vectors_and_tensors.jpg (图书封面)
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

TASK_EN_MAIN = r"C:\Users\白羊欣存\MinerU\FleischVectorsAndTensors.pdf-a6ac705b-4179-4b3a-a49d-76ee1c175876"
TASK_EN_SMALL = r"C:\Users\白羊欣存\MinerU\FleischVectorsAndTensors.pdf-9d37d6e3-98f0-40af-ac7e-18180d4f068a"
TASK_ZH_MAIN = r"C:\Users\白羊欣存\MinerU\大学生理工专题导读 矢量与张量分析 (Daniel A. Fleisch) (z-library.sk, 1lib.sk, z-lib.sk).pdf-409e75fd-e404-401a-81ea-28006961bb12"
TASK_ZH_SMALL = r"C:\Users\白羊欣存\MinerU\大学生理工专题导读 矢量与张量分析 (Daniel A. Fleisch) (z-library.sk, 1lib.sk, z-lib.sk).pdf-c786c44e-89b8-4440-a8fc-da76e2014019"

OUT_ROOT = os.path.join(PROJECT_ROOT, 'src', 'content', 'docs', 'collections', 'science', 'vectors_and_tensors')
OUT_ZH = os.path.join(OUT_ROOT, 'zh')
OUT_IMAGES = os.path.join(OUT_ROOT, 'images')
COVER_DEST = os.path.join(PROJECT_ROOT, 'public', 'covers', 'vectors_and_tensors.jpg')

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

"""

LIGATURE_MAP = {
    '\ufb00': 'ff',
    '\ufb01': 'fi',
    '\ufb02': 'fl',
    '\ufb03': 'ffi',
    '\ufb04': 'ffl',
}

SECTIONS_SPECS = [
    ('00_preface.mdx', 'Preface', '前言与导读', r'^(?:#+\s*)?Preface\b', r'^(?:#+\s*)?(?:导读|译者序|前言)\b'),
    ('01.1_definitions-basic.mdx', '1.1 Definitions (basic)', '1.1 基本概念', r'^(?:#+\s*)?1\.1\s+Definitions\s*\(basic\)', r'^(?:#+\s*)?1\.1\s*基本概念\b'),
    ('01.2_cartesian-unit-vectors.mdx', '1.2 Cartesian unit vectors', '1.2 笛卡儿单位矢量', r'^(?:#+\s*)?1\.2\s+Cartesian unit vectors\b', r'^(?:#+\s*)?1\.2\s*笛卡儿单位矢量\b'),
    ('01.3_vector-components.mdx', '1.3 Vector components', '1.3 矢量分量', r'^(?:#+\s*)?1\.3\s+Vector components\b', r'^(?:#+\s*)?1\.3\s*矢量分量\b'),
    ('01.4_vector-addition-and-multiplication.mdx', '1.4 Vector addition and multiplication by a scalar', '1.4 矢量的加法与数乘运算', r'^(?:#+\s*)?1\.4\s+Vector addition and multiplication\b', r'^(?:#+\s*)?1\.4\s*矢量的加法与数乘运算\b'),
    ('01.5_non-cartesian-unit-vectors.mdx', '1.5 Non-Cartesian unit vectors', '1.5 非笛卡儿单位矢量', r'^(?:#+\s*)?1\.5\s+Non-Cartesian unit vectors\b', r'^(?:#+\s*)?1\.5\s*非笛卡儿单位矢量\b'),
    ('01.6_basis-vectors.mdx', '1.6 Basis vectors', '1.6 基矢量', r'^(?:#+\s*)?1\.6\s+Basis vectors\b', r'^(?:#+\s*)?1\.6\s*基矢量\b'),
    ('01.7_chapter-1-problems.mdx', '1.7 Chapter 1 problems', '1.7 习题', r'^(?:#+\s*)?1\.7\s+Chapter 1 problems\b', r'^(?:#+\s*)?1\.7\s*习题\b'),

    ('02.1_scalar-product.mdx', '2.1 Scalar product', '2.1 数量积', r'^(?:#+\s*)?2\.1\s+Scalar product\b', r'^(?:#+\s*)?2\.1\s*数量积\b'),
    ('02.2_cross-product.mdx', '2.2 Cross product', '2.2 叉积', r'^(?:#+\s*)?2\.2\s+Cross product\b', r'^(?:#+\s*)?2\.2\s*叉积\b'),
    ('02.3_triple-scalar-product.mdx', '2.3 Triple scalar product', '2.3 三重标积', r'^(?:#+\s*)?2\.3\s+Triple scalar product\b', r'^(?:#+\s*)?2\.3\s*三重标积\b'),
    ('02.4_triple-vector-product.mdx', '2.4 Triple vector product', '2.4 三重矢积', r'^(?:#+\s*)?2\.4\s+Triple vector product\b', r'^(?:#+\s*)?2\.4\s*三重矢积\b'),
    ('02.5_partial-derivatives.mdx', '2.5 Partial derivatives', '2.5 偏导数', r'^(?:#+\s*)?2\.5\s+Partial derivatives\b', r'^(?:#+\s*)?2\.5\s*偏导数\b'),
    ('02.6_vectors-as-derivatives.mdx', '2.6 Vectors as derivatives', '2.6 导数矢量', r'^(?:#+\s*)?2\.6\s+Vectors as derivatives\b', r'^(?:#+\s*)?2\.6\s*导数矢量\b'),
    ('02.7_nabla-del-operator.mdx', '2.7 Nabla – the del operator', '2.7 矢量微分算子', r'^(?:#+\s*)?2\.7\s+Nabla\b', r'^(?:#+\s*)?2\.7\s*矢量微分算子\b'),
    ('02.8_gradient.mdx', '2.8 Gradient', '2.8 梯度', r'^(?:#+\s*)?2\.8\s+Gradient\b', r'^(?:#+\s*)?2\.8\s*梯度\b'),
    ('02.9_divergence.mdx', '2.9 Divergence', '2.9 散度', r'^(?:#+\s*)?2\.9\s+Divergence\b', r'^(?:#+\s*)?2\.9\s*散度\b'),
    ('02.10_curl.mdx', '2.10 Curl', '2.10 旋度', r'^(?:#+\s*)?2\.10\s+Curl\b', r'^(?:#+\s*)?2\.10\s*旋度\b'),
    ('02.11_laplacian.mdx', '2.11 Laplacian', '2.11 拉普拉斯算子', r'^(?:#+\s*)?2\.11\s+Laplacian\b', r'^(?:#+\s*)?(?:2\.11|11)\s*拉普拉斯算子\b'),
    ('02.12_chapter-2-problems.mdx', '2.12 Chapter 2 problems', '2.12 习题', r'^(?:#+\s*)?2\.12\s+Chapter 2 problems\b', r'^(?:#+\s*)?2\.12\s*习题\b'),

    ('03.1_mass-on-inclined-plane.mdx', '3.1 Mass on an inclined plane', '3.1 斜面上的物体', r'^(?:#+\s*)?3\.1\s+Mass on an inclined plane\b', r'^(?:#+\s*)?3\.1\s*斜面上的物体\b'),
    ('03.2_curvilinear-motion.mdx', '3.2 Curvilinear motion', '3.2 曲线运动', r'^(?:#+\s*)?3\.2\s+Curvilinear motion\b', r'^(?:#+\s*)?3\.2\s*曲线运动\b'),
    ('03.3_electric-field.mdx', '3.3 The electric field', '3.3 电场', r'^(?:#+\s*)?3\.3\s+The electric field\b', r'^(?:#+\s*)?3\.3\s*电场\b'),
    ('03.4_magnetic-field.mdx', '3.4 The magnetic field', '3.4 磁场', r'^(?:#+\s*)?3\.4\s+The magnetic field\b', r'^(?:#+\s*)?3\.4\s*磁场\b'),
    ('03.5_chapter-3-problems.mdx', '3.5 Chapter 3 problems', '3.5 习题', r'^(?:#+\s*)?3\.5\s+Chapter 3 problems\b', r'^(?:#+\s*)?3\.5\s*习题\b'),

    ('04.1_coordinate-system-transformations.mdx', '4.1 Coordinate-system transformations', '4.1 坐标系变换', r'^(?:#+\s*)?4\.1\s+Coordinate-system transformations\b', r'^(?:#+\s*)?4\.1\s*坐标系变换\b'),
    ('04.2_basis-vector-transformations.mdx', '4.2 Basis-vector transformations', '4.2 基矢量变换', r'^(?:#+\s*)?4\.2\s+Basis-vector transformations\b', r'^(?:#+\s*)?4\.2\s*基矢量变换\b'),
    ('04.3_basis-vector-vs-component-transformations.mdx', '4.3 Basis-vector vs. component transformations', '4.3 分量变换与基矢量变换', r'^(?:#+\s*)?4\.3\s+Basis-vector vs\.\s*component transformations\b', r'^(?:#+\s*)?4\.3\s*分量变换与基矢量变换\b'),
    ('04.4_non-orthogonal-coordinate-systems.mdx', '4.4 Non-orthogonal coordinate systems', '4.4 非正交坐标系', r'^(?:#+\s*)?4\.4\s+Non-orthogonal coordinate systems\b', r'^(?:#+\s*)?4\.4\s*非正交坐标系\b'),
    ('04.5_dual-basis-vectors.mdx', '4.5 Dual basis vectors', '4.5 对偶基矢量', r'^(?:#+\s*)?4\.5\s+Dual basis vectors\b', r'^(?:#+\s*)?4\.5\s*对偶基矢量\b'),
    ('04.6_finding-covariant-and-contravariant-components.mdx', '4.6 Finding covariant and contravariant components', '4.6 协变分量与逆变分量的求法', r'^(?:#+\s*)?4\.6\s+Finding covariant and contravariant components\b', r'^(?:#+\s*)?4\.6\s*协变分量与逆变分量的求法\b'),
    ('04.7_index-notation.mdx', '4.7 Index notation', '4.7 指标表示法', r'^(?:#+\s*)?4\.7\s+Index notation\b', r'^(?:#+\s*)?4\.7\s*指标表示法\b'),
    ('04.8_quantities-transform-contravariantly.mdx', '4.8 Quantities that transform contravariantly', '4.8 逆变量', r'^(?:#+\s*)?4\.8\s+Quantities that transform contravariantly\b', r'^(?:#+\s*)?4\.8\s*逆变量\b'),
    ('04.9_quantities-transform-covariantly.mdx', '4.9 Quantities that transform covariantly', '4.9 协变量', r'^(?:#+\s*)?4\.9\s+Quantities that transform covariantly\b', r'^(?:#+\s*)?4\.9\s*协变量\b'),
    ('04.10_chapter-4-problems.mdx', '4.10 Chapter 4 problems', '4.10 习题', r'^(?:#+\s*)?4\.10\s+Chapter 4 problems\b', r'^(?:#+\s*)?4\.10\s*习题\b'),

    ('05.1_definitions-advanced.mdx', '5.1 Definitions (advanced)', '5.1 定义（高级）', r'^(?:#+\s*)?5\.1\s+Definitions\s*\(advanced\)', r'^(?:#+\s*)?5\.1\s*定义（高级）'),
    ('05.2_covariant-contravariant-mixed-tensors.mdx', '5.2 Covariant, contravariant, and mixed tensors', '5.2 协变、逆变和混变分量', r'^(?:#+\s*)?5\.2\s+Covariant,\s*contravariant,\s*and mixed tensors\b', r'^(?:#+\s*)?5\.2\s*协变、逆变和混变'),
    ('05.3_tensor-addition-subtraction.mdx', '5.3 Tensor addition and subtraction', '5.3 张量的加法和减法', r'^(?:#+\s*)?5\.3\s+Tensor addition and subtraction\b', r'^(?:#+\s*)?5\.3\s*张量的加法和减法\b'),
    ('05.4_tensor-multiplication.mdx', '5.4 Tensor multiplication', '5.4 张量的乘法', r'^(?:#+\s*)?5\.4\s+Tensor multiplication\b', r'^(?:#+\s*)?5\.4\s*张量的乘法\b'),
    ('05.5_metric-tensor.mdx', '5.5 Metric tensor', '5.5 度规张量', r'^(?:#+\s*)?5\.5\s+Metric tensor\b', r'^(?:#+\s*)?5\.5\s*度规张量\b'),
    ('05.6_index-raising-lowering.mdx', '5.6 Index raising and lowering', '5.6 指标的升降', r'^(?:#+\s*)?5\.6\s+Index raising and lowering\b', r'^(?:#+\s*)?5\.6\s*指标的升降\b'),
    ('05.7_tensor-derivatives-christoffel-symbols.mdx', '5.7 Tensor derivatives and Christoffel symbols', '5.7 张量的导数和克里斯托费尔符号', r'^(?:#+\s*)?5\.7\s+Tensor derivatives and Christoffel symbols\b', r'^(?:#+\s*)?5\.7\s*张量的导数和克里斯托费尔符号\b'),
    ('05.8_covariant-differentiation.mdx', '5.8 Covariant differentiation', '5.8 协变导数', r'^(?:#+\s*)?5\.8\s+Covariant differentiation\b', r'^(?:#+\s*)?5\.8\s*协变导数\b'),
    ('05.9_vectors-and-one-forms.mdx', '5.9 Vectors and one-forms', '5.9 矢量和 one - forms', r'^(?:#+\s*)?5\.9\s+Vectors and one-forms\b', r'^(?:#+\s*)?5\.9\s*矢量和\s*one\s*-\s*forms\b'),
    ('05.10_chapter-5-problems.mdx', '5.10 Chapter 5 problems', '5.10 习题', r'^(?:#+\s*)?5\.10\s+Chapter 5 problems\b', r'^(?:#+\s*)?5\.10\s*习题\b'),

    ('06.1_inertia-tensor.mdx', '6.1 The inertia tensor', '6.1 惯性张量', r'^(?:#+\s*)?6\.1\s+The inertia tensor\b', r'^(?:#+\s*)?6\.1\s*惯性张量\b'),
    ('06.2_electromagnetic-field-tensor.mdx', '6.2 The electromagnetic field tensor', '6.2 电磁场张量', r'^(?:#+\s*)?6\.2\s+The electromagnetic field tensor\b', r'^(?:#+\s*)?6\.2\s*电磁场张量\b'),
    ('06.3_riemann-curvature-tensor.mdx', '6.3 The Riemann curvature tensor', '6.3 黎曼曲率张量', r'^(?:#+\s*)?6\.3\s+The Riemann curvature tensor\b', r'^(?:#+\s*)?6\.3\s*黎曼曲率张量\b'),
    ('06.4_chapter-6-problems.mdx', '6.4 Chapter 6 problems', '6.4 习题', r'^(?:#+\s*)?6\.4\s+Chapter 6 problems\b', r'^(?:#+\s*)?6\.4\s*习题\b'),
    ('07_further-reading.mdx', 'Further reading', '进阶阅读', r'^Arfken,\s+G\.\s+and\s+Weber,\s+H\.', r'^(?:#+\s*)?进阶阅读\b')
]

def clean_ocr(text: str) -> str:
    """清洗连字、无效 HTML 标签、引号与注脚标号。"""
    for k, v in LIGATURE_MAP.items():
        text = text.replace(k, v)
    text = text.replace('\x92', "'").replace('\x91', "'")
    text = text.replace('’', "'").replace('‘', "'")
    text = text.replace('“', '"').replace('”', '"')
    
    # 转换 HTML <img> 为 Markdown 语法
    text = re.sub(r'<img\b[^>]*src=["\'](images/[^"\']+)["\'][^>]*>', r'![](\1)', text)
    text = re.sub(r'<img\b[^>]*src=["\']([^"\']+)["\'][^>]*>', r'![](\1)', text)
    
    # 规范化脚注：避免 KaTeX 解析带圈数字报错 (No character metrics for '①')
    text = re.sub(r'\$\^\{([①②③④⑤⑥⑦⑧⑨⑩\d]+)\}\$', r'<sup>\1</sup>', text)
    text = re.sub(r'\^\{([①②③④⑤⑥⑦⑧⑨⑩\d]+)\}', r'<sup>\1</sup>', text)
    text = re.sub(r'<sub>([a-zA-Z\s,.\(\)]+)</sub>', r'\1', text)
    return text

def clean_math(math_str: str) -> str:
    """清理 KaTeX 不支持的 HTML 实体与异常宏，修复多重 \tag。"""
    s = math_str
    s = s.replace('&lt;', '<').replace('&gt;', '>').replace('&amp;', '&')
    s = re.sub(r'\\nequiv\b', r'\\not\\equiv', s)
    
    # 修复同一公式中多重 \tag (KaTeX 报错: Multiple \tag)
    # 例如 \tag {4.1}\tag{4.12} 只保留最后一个真实式编号 \tag{4.12}
    tags = list(re.finditer(r'\\tag\s*(?:\{[^}]*\}|\([^)]*\))', s))
    if len(tags) > 1:
        for t in tags[:-1]:
            s = s[:t.start()] + ' ' * (t.end() - t.start()) + s[t.end():]
    return s

def sanitize_mdx(text: str) -> str:
    """数学感知 MDX 转义器：保留公式代码，转义正文裸 <, {, }, ~。"""
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

    # 3. 保护行内公式
    def protect_inline_math(m):
        math_s = clean_math(m.group(0))
        idx = len(protected)
        protected.append(math_s)
        return f"___PROTECTED_{idx}___"
    t = re.sub(r'(?<!\\)\$([^\$\n]+?)(?<!\\)\$', protect_inline_math, t)

    # 4. 保护合法的 AstroLib 标签与标准 HTML 标签
    t = re.sub(
        r'</?(?:Exercise|Knowledge|Example|Analysis|Solution|Variant|Note|Block|Method|Guide|sup|sub|table|thead|tbody|tfoot|tr|td|th|p|b|i|strong|em|code|pre|div|a|span|h1|h2|h3|h4|h5|h6)(?:\s+[^>\n]*)?/?>',
        protect,
        t
    )

    # 5. 转义正文中裸 < 为 &lt;
    t = t.replace('<', '&lt;')
    # 6. 转义正文中花括号
    t = t.replace('{', '&#123;').replace('}', '&#125;')
    # 7. 转义正文中波浪号
    t = t.replace('~', '～')

    # 8. 还原受保护内容
    for idx, orig in enumerate(protected):
        t = t.replace(f"___PROTECTED_{idx}___", orig)

    return t

def format_exercises(text: str, prefix: str = "Problem") -> str:
    """将课后习题各题转换为标准 <Exercise title="Problem X.Y"> 容器。"""
    lines = text.strip().split('\n')
    header_lines = []
    exercises = []
    cur_num = None
    cur_lines = []

    # 匹配题号开头，如 "1.1 " 或 "1.1 (a)" 或 "6.1 "
    num_pattern = re.compile(r'^(\d+\.\d+)\b\s*(.*)$')

    for line in lines:
        if line.startswith('#'):
            header_lines.append(line)
            continue
        m = num_pattern.match(line.strip())
        if m:
            if cur_num is not None:
                exercises.append((cur_num, '\n'.join(cur_lines).strip()))
            cur_num = m.group(1)
            rest = m.group(2)
            cur_lines = [rest] if rest else []
        else:
            if cur_num is not None:
                cur_lines.append(line)
            else:
                if line.strip():
                    header_lines.append(line)

    if cur_num is not None:
        exercises.append((cur_num, '\n'.join(cur_lines).strip()))

    out = []
    if header_lines:
        out.append('\n'.join(header_lines))
        out.append('')

    for num, body in exercises:
        out.append(f'<Exercise title="{prefix} {num}">\n{body}\n</Exercise>\n')

    return '\n'.join(out)

def load_en_lines():
    with open(os.path.join(TASK_EN_MAIN, 'full.md'), 'r', encoding='utf-8') as f:
        en_m = f.readlines()
    with open(os.path.join(TASK_EN_SMALL, 'full.md'), 'r', encoding='utf-8') as f:
        en_s = f.readlines()

    # 保证在两部分衔接处具有干净的换行隔离，防止 $$ 与后文粘连
    if en_m and not en_m[-1].endswith('\n'):
        en_m[-1] += '\n'
    en_m.append('\n')

    return en_m + en_s

def load_zh_lines():
    with open(os.path.join(TASK_ZH_MAIN, 'full.md'), 'r', encoding='utf-8') as f:
        zh_m = f.readlines()
    with open(os.path.join(TASK_ZH_SMALL, 'full.md'), 'r', encoding='utf-8') as f:
        zh_s = f.readlines()

    zh_s_clean = []
    for l in zh_s:
        if l.startswith('## 大学生理工专题导读'):
            continue
        # 修复 MinerU 识别异常的 6.8 与 6.10
        if l.strip().startswith('6 . 8'):
            l = l.replace('6 . 8', '6.8 证明：')
        elif '6. 1 0' in l:
            l = '6.10 求 6.3 节中二维球面的里奇张量和里奇标量。\n'
        zh_s_clean.append(l)

    if zh_m and not zh_m[-1].endswith('\n'):
        zh_m[-1] += '\n'
    zh_m.append('\n')

    return zh_m + zh_s_clean

def slice_en_sections(en_lines):
    cut_indices = []
    for fname, title_en, title_zh, pat_en, pat_zh in SECTIONS_SPECS:
        regex = re.compile(pat_en, re.I)
        matched = None
        for idx, l in enumerate(en_lines):
            if regex.search(l.strip()):
                if fname == '00_preface.mdx':
                    matched = idx
                    break
                elif idx > 120:
                    matched = idx
                    break
        if matched is None:
            raise ValueError(f"EN: could not find section cut for {fname} with {pat_en}")
        cut_indices.append(matched)

    # 寻找 Further reading 结束、Index 开始的位置
    index_idx = None
    for idx in range(cut_indices[-1], len(en_lines)):
        if en_lines[idx].strip().startswith('acceleration,'):
            index_idx = idx
            break

    sections = {}
    for i in range(len(cut_indices)):
        fname = SECTIONS_SPECS[i][0]
        start = cut_indices[i]
        end = cut_indices[i+1] if i + 1 < len(cut_indices) else (index_idx or len(en_lines))
        chunk = en_lines[start:end]
        sections[fname] = chunk

    return sections

def slice_zh_sections(zh_lines):
    cut_indices = []
    for fname, title_en, title_zh, pat_en, pat_zh in SECTIONS_SPECS:
        regex = re.compile(pat_zh)
        matched = None
        for idx, l in enumerate(zh_lines):
            if regex.search(l.strip()):
                if fname == '00_preface.mdx':
                    matched = idx
                    break
                elif idx > 268: # 跳过目录区
                    matched = idx
                    break
        if matched is None:
            raise ValueError(f"ZH: could not find section cut for {fname} with {pat_zh}")
        cut_indices.append(matched)

    # 寻找前言结束、目录开始的位置
    toc_idx = None
    for idx in range(cut_indices[0], cut_indices[1]):
        if '## 目录' in zh_lines[idx]:
            toc_idx = idx
            break

    sections = {}
    for i in range(len(cut_indices)):
        fname = SECTIONS_SPECS[i][0]
        start = cut_indices[i]
        if i == 0:
            end = toc_idx or cut_indices[1]
        else:
            end = cut_indices[i+1] if i + 1 < len(cut_indices) else len(zh_lines)
        chunk = zh_lines[start:end]
        sections[fname] = chunk

    return sections

def clean_en_chunk(fname: str, chunk: list[str]) -> str:
    text = ''.join(chunk)
    text = clean_ocr(text)

    # 移除章标题大标头干扰，如 "# Vectors"
    text = re.sub(r'^#\s+Vectors\s*\n+', '', text)
    text = re.sub(r'^#\s+Vector operations\s*\n+', '', text)
    text = re.sub(r'^#\s+Vector applications\s*\n+', '', text)
    text = re.sub(r'^#\s+Covariant and contravariant\b[^\n]*\n+', '', text)
    text = re.sub(r'^#\s+Higher-rank tensors\s*\n+', '', text)
    text = re.sub(r'^#\s+Tensor applications\s*\n+', '', text)

    # 移除正文中误识别的页眉重复节标题
    if fname == '01.1_definitions-basic.mdx':
        text = re.sub(r'(\n## 1\.1 Definitions \(basic\)\s*\n[\s\S]*?)\n## 1\.1 Definitions \(basic\)\s*\n', r'\1\n', text)
    elif fname == '02.12_chapter-2-problems.mdx':
        text = re.sub(r'(\n## 2\.12 Chapter 2 problems\s*\n[\s\S]*?)\n## 2\.12 Chapter 2 problems\s*\n', r'\1\n', text)
    elif fname == '03.2_curvilinear-motion.mdx':
        text = re.sub(r'(\n## 3\.2 Curvilinear motion\s*\n[\s\S]*?)\n## 3\.2 Curvilinear motion\s*\n', r'\1\n', text)
    elif fname == '00_preface.mdx':
        text = '# Preface\n\n' + text
    elif fname == '07_further-reading.mdx':
        text = '## Further reading\n\n' + text

    # 包装习题
    if 'problems' in fname:
        text = format_exercises(text, prefix="Problem")

    text = sanitize_mdx(text)
    return text.strip()

def clean_zh_chunk(fname: str, chunk: list[str]) -> str:
    text = ''.join(chunk)
    text = clean_ocr(text)

    # 过滤所有出现的中文页眉
    text = re.sub(r'^(?:##\s*)?大学生理工专题导读——[^\n]*\n+', '', text, flags=re.M)
    text = re.sub(r'^(?:##\s*)?A STUDENT\'S GUIDE TO VECTORS AND TENSORS\s*\n+', '', text, flags=re.M)

    # 过滤多余章节大标头
    text = re.sub(r'^#\s*第[1-6]章[^\n]*\n+', '', text, flags=re.M)
    text = re.sub(r'^##\s*第[1-6]章[^\n]*\n+', '', text, flags=re.M)
    text = re.sub(r'^#\s*(?:高阶张量|矢量的运算|矢量的应用|张量的应用)\s*\n+', '', text, flags=re.M)
    text = re.sub(r'^##\s*(?:高阶张量|矢量的运算|矢量的应用|张量的应用)\s*\n+', '', text, flags=re.M)

    # 修复 2.11 拉普拉斯算子小标号
    if fname == '02.11_laplacian.mdx':
        text = re.sub(r'##\s*11\s*拉普拉斯算子', '## 2.11 拉普拉斯算子', text)

    # 修复 06.3 节 MinerU OCR 异常幻觉大表格
    if fname == '06.3_riemann-curvature-tensor.mdx':
        hallucination_pattern = re.compile(
            r'\\begin\{array\}\{l\}\s*R _ \{\\theta \\theta \\theta\}[\s\S]*?M\.< nl>',
            re.M
        )
        clean_riemann = (
            "\\begin{array}{r} R _ {\\theta \\theta \\theta} ^ {\\theta} = \\frac {\\partial \\Gamma_ {\\theta \\theta} ^ {\\theta}}{\\partial \\theta} - \\frac {\\partial \\Gamma_ {\\theta \\theta} ^ {\\theta}}{\\partial \\theta} + \\Gamma_ {\\theta \\theta} ^ {\\theta} \\Gamma_ {\\theta \\theta} ^ {\\theta} + \\Gamma_ {\\theta \\theta} ^ {\\phi} \\Gamma_ {\\phi \\theta} ^ {\\theta} - \\Gamma_ {\\theta \\theta} ^ {\\theta} \\Gamma_ {\\theta \\theta} ^ {\\theta} - \\Gamma_ {\\theta \\theta} ^ {\\phi} \\Gamma_ {\\phi \\theta} ^ {\\theta}, \\\\ "
            "R _ {\\theta \\theta \\phi} ^ {\\theta} = \\frac {\\partial \\Gamma_ {\\theta \\phi} ^ {\\theta}}{\\partial \\theta} - \\frac {\\partial \\Gamma_ {\\theta \\theta} ^ {\\theta}}{\\partial \\phi} + \\Gamma_ {\\theta \\phi} ^ {\\theta} \\Gamma_ {\\theta \\theta} ^ {\\theta} + \\Gamma_ {\\theta \\phi} ^ {\\phi} \\Gamma_ {\\phi \\theta} ^ {\\theta} - \\Gamma_ {\\theta \\theta} ^ {\\theta} \\Gamma_ {\\theta \\phi} ^ {\\theta} - \\Gamma_ {\\theta \\theta} ^ {\\phi} \\Gamma_ {\\phi \\phi} ^ {\\theta}, \\end{array}\n"
            "$$\n\n$$\n"
            "R _ {\\theta \\phi \\theta} ^ {\\theta} = \\frac {\\partial \\Gamma_ {\\theta \\theta} ^ {\\theta}}{\\partial \\phi} - \\frac {\\partial \\Gamma_ {\\theta \\phi} ^ {\\theta}}{\\partial \\theta} + \\Gamma_ {\\theta \\theta} ^ {\\theta} \\Gamma_ {\\theta \\phi} ^ {\\theta} + \\Gamma_ {\\theta \\theta} ^ {\\phi} \\Gamma_ {\\phi \\phi} ^ {\\theta} - \\Gamma_ {\\theta \\phi} ^ {\\theta} \\Gamma_ {\\theta \\theta} ^ {\\theta} - \\Gamma_ {\\theta \\phi} ^ {\\phi} \\Gamma_ {\\phi \\theta} ^ {\\theta},\n"
            "$$\n\n$$\n"
            "R _ {\\phi \\theta \\theta} ^ {\\theta} = \\frac {\\partial \\Gamma_ {\\phi \\theta} ^ {\\theta}}{\\partial \\theta} - \\frac {\\partial \\Gamma_ {\\phi \\theta} ^ {\\theta}}{\\partial \\phi} + \\Gamma_ {\\phi \\theta} ^ {\\theta} \\Gamma_ {\\theta \\theta} ^ {\\theta} + \\Gamma_ {\\phi \\theta} ^ {\\phi} \\Gamma_ {\\phi \\theta} ^ {\\theta} - \\Gamma_ {\\phi \\theta} ^ {\\theta} \\Gamma_ {\\theta \\theta} ^ {\\theta} - \\Gamma_ {\\phi \\theta} ^ {\\phi} \\Gamma_ {\\phi \\theta} ^ {\\theta},\n"
            "$$\n\n$$\n"
            "R _ {\\theta \\phi \\phi} ^ {\\theta} = \\frac {\\partial \\Gamma_ {\\theta \\phi} ^ {\\theta}}{\\partial \\phi} - \\frac {\\partial \\Gamma_ {\\theta \\phi} ^ {\\theta}}{\\partial \\phi} + \\Gamma_ {\\theta \\phi} ^ {\\theta} \\Gamma_ {\\theta \\phi} ^ {\\theta} + \\Gamma_ {\\theta \\phi} ^ {\\phi} \\Gamma_ {\\phi \\phi} ^ {\\theta} - \\Gamma_ {\\theta \\phi} ^ {\\theta} \\Gamma_ {\\theta \\phi} ^ {\\theta} - \\Gamma_ {\\theta \\phi} ^ {\\phi} \\Gamma_ {\\phi \\phi} ^ {\\theta},\n"
            "$$\n\n$$\n"
            "R _ {\\phi \\theta \\phi} ^ {\\theta} = \\frac {\\partial \\Gamma_ {\\phi \\phi} ^ {\\theta}}{\\partial \\theta} - \\frac {\\partial \\Gamma_ {\\phi \\theta} ^ {\\theta}}{\\partial \\phi} + \\Gamma_ {\\phi \\phi} ^ {\\theta} \\Gamma_ {\\theta \\theta} ^ {\\theta} + \\Gamma_ {\\phi \\phi} ^ {\\phi} \\Gamma_ {\\phi \\theta} ^ {\\theta} - \\Gamma_ {\\phi \\theta} ^ {\\theta} \\Gamma_ {\\theta \\phi} ^ {\\theta} - \\Gamma_ {\\phi \\theta} ^ {\\phi} \\Gamma_ {\\phi \\phi} ^ {\\theta}"
        )
        text = hallucination_pattern.sub(lambda m: clean_riemann, text)

    # 包装习题
    if 'problems' in fname or '习题' in fname:
        text = format_exercises(text, prefix="习题")

    # 修正图片相对路径 (zh/ 子目录引向 ../images/)
    text = re.sub(r'!\[([^\]]*)\]\((images/[^)]+)\)', r'![\1](../\2)', text)

    text = sanitize_mdx(text)
    return text.strip()

def main():
    print("=" * 60)
    print("A Student's Guide to Vectors and Tensors 双语全量导入流水线")
    print("=" * 60)

    # 1. 确保目录环境
    os.makedirs(OUT_ROOT, exist_ok=True)
    os.makedirs(OUT_ZH, exist_ok=True)
    os.makedirs(OUT_IMAGES, exist_ok=True)
    os.makedirs(os.path.dirname(COVER_DEST), exist_ok=True)

    # 2. 读取并切分
    print("\n[1/5] 读取与切分双语文本...")
    en_lines = load_en_lines()
    zh_lines = load_zh_lines()

    en_chunks = slice_en_sections(en_lines)
    zh_chunks = slice_zh_sections(zh_lines)

    print(f"  EN 篇章总数: {len(en_chunks)}")
    print(f"  ZH 篇章总数: {len(zh_chunks)}")

    # 3. 生成 English MDX (Root)
    print("\n[2/5] 生成英文原著篇章 (默认语言)...")
    for fname, title_en, title_zh, _, _ in SECTIONS_SPECS:
        body = clean_en_chunk(fname, en_chunks[fname])
        safe_title = title_en.replace("'", "\\'")
        content = IMPORTS_HEADER.format(title=safe_title) + body + '\n'
        out_path = os.path.join(OUT_ROOT, fname)
        with open(out_path, 'w', encoding='utf-8') as f:
            f.write(content)
    print(f"  成功写入 {len(SECTIONS_SPECS)} 篇英文 MDX 到 {OUT_ROOT}")

    # 4. 生成 Chinese MDX (zh/)
    print("\n[3/5] 生成中文译本篇章 (zh/ 备选语言)...")
    for fname, title_en, title_zh, _, _ in SECTIONS_SPECS:
        body = clean_zh_chunk(fname, zh_chunks[fname])
        safe_title = title_zh.replace("'", "\\'")
        content = IMPORTS_HEADER.format(title=safe_title) + body + '\n'
        out_path = os.path.join(OUT_ZH, fname)
        with open(out_path, 'w', encoding='utf-8') as f:
            f.write(content)
    print(f"  成功写入 {len(SECTIONS_SPECS)} 篇中文 MDX 到 {OUT_ZH}")

    # 5. 复制全部插图
    print("\n[4/5] 同步高清图像资产...")
    copied_count = 0
    img_dirs = [
        os.path.join(TASK_EN_MAIN, 'images'),
        os.path.join(TASK_EN_SMALL, 'images'),
        os.path.join(TASK_ZH_MAIN, 'images'),
    ]
    for d in img_dirs:
        if not os.path.isdir(d):
            continue
        for img in os.listdir(d):
            src_fp = os.path.join(d, img)
            dst_fp = os.path.join(OUT_IMAGES, img)
            if not os.path.exists(dst_fp) or os.path.getsize(src_fp) != os.path.getsize(dst_fp):
                shutil.copy2(src_fp, dst_fp)
                copied_count += 1
    total_imgs = len(os.listdir(OUT_IMAGES))
    print(f"  新拷贝图像: {copied_count} 张，总图像数: {total_imgs} 张 -> {OUT_IMAGES}")

    # 6. 复制封面
    print("\n[5/5] 同步图书封面...")
    cover_src = os.path.join(TASK_EN_MAIN, 'images', '0e9d67cb90431cf6db51a1b135de9e799028b92d0c88a5afcda306720cca36b1.jpg')
    if os.path.exists(cover_src):
        shutil.copy2(cover_src, COVER_DEST)
        print(f"  封面已同步至: {COVER_DEST}")
    else:
        print(f"  警告: 封面源文件未找到: {cover_src}")

    print("\n" + "=" * 60)
    print("双语导入流程顺利执行完毕！")
    print("=" * 60)

if __name__ == '__main__':
    main()
