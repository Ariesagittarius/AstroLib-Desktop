/**
 * src/utils/astrolib-uri.ts
 * ============================================================================
 * AstroLib 统一节点定位协议 (Astrolib Scheme URI & Target Specification)
 * ============================================================================
 * 规范：
 * 1. 协议标准：astrolib://<colSlug>/<bookSlug>[/<chapterSlug>][#<anchor>]
 * 2. 纯函数设计：遵循 Rule 7 (Utils Purity)，无状态、可移植、双向映射；
 * 3. 容错转换：兼容历史 URL、反向代理、Markdown 相对路径及残损输入；
 * 4. 深度定位：支持卡片 ID (card-*)、章节 Slug、小节锚点与阅读器聚光灯联动。
 * ============================================================================
 */

export interface AstrolibNodeTarget {
  raw: string;
  entityKind?: 'book' | 'paper';
  colSlug: string;
  bookSlug: string;
  chapterSlug?: string;
  taskId?: string;
  sectionId?: string;
  anchor?: string;
  canonicalPath: string; // e.g. "/collections/cs/algorithms/031_why-graphs/#card-1-23" or "/workspace/ingest/?taskId=..."
  title: string;         // 书籍或文献标题
}

/**
 * 官方 13 本核心教材书名映射表 (与 collections.config.ts 权威对齐)
 */
export const OFFICIAL_BOOK_TITLES: Record<string, string> = {
  'math-math_senior': '新高考数学你真的掌握了吗',
  'math-math_analysis': '数学分析',
  'math-engineering_analysis': '工科数学分析基础',
  'math-linear_algebra': '线性代数',
  'math-linear_algebra_geometry': '线性代数与解析几何',
  'math-probability_statistics': '概率论与数理统计',
  'math-graph_theory': '图论',
  'science-university_physics': '大学物理学',
  'science-vectors_and_tensors': '从向量到张量',
  'cs-algorithms': 'Algorithms',
  'telecom-communication_principles': '通信原理',
  'telecom-digital_circuit': '数字电路与逻辑设计',
  'telecom-electronic_circuits': '电子电路与系统',
};

/**
 * 根据学科合集标识与书目标识获取官方书籍名称
 */
export function getBookTitle(
  colSlug: string,
  bookSlug: string,
  titleLookup?: Record<string, string>
): string {
  const key = `${colSlug}-${bookSlug}`;
  return titleLookup?.[key] || OFFICIAL_BOOK_TITLES[key] || bookSlug;
}

/**
 * 严格判断字符串是否为 astrolib / paper 协议或书籍集合阅读链接
 */
export function isAstrolibUri(input: string): boolean {
  if (!input || typeof input !== 'string') return false;
  let s = input.trim();
  s = s.replace(/^["'`“”‘’<(\[]+|[)"'`“”’\],.，。；;!?！？、]+$/g, '').trim();
  return (
    /^astrolib:\/\//i.test(s) ||
    /^astrolib:\//i.test(s) ||
    /^paper:\/\//i.test(s) ||
    /^paper:\//i.test(s) ||
    /\/astrolib:\//i.test(s) ||
    /\/collections\/[^\s<>"']+/i.test(s)
  );
}

/**
 * 解析任意形态的定位链接为规范的 AstrolibNodeTarget
 *
 * 支持形态：
 * - astrolib://cs/algorithms/031_why-graphs
 * - astrolib://math/graph_theory/15_树和森林#card-1-23
 * - astrolib://science/vectors_and_tensors/zh/063_riemann-curvature-tensor math-128 (空格锚点容错)
 * - astrolib://math/graph_theory
 * - astrolib:/cs/algorithms/031_why-graphs (容错)
 * - /collections/cs/algorithms/031_why-graphs/
 * - http://127.0.0.1:62960/collections/cs/algorithms/031_why-graphs/#card-1-23
 * - http://127.0.0.1:62960/astrolib:/cs/algorithms/031_why-graphs (容错历史残留)
 */
export function parseAstrolibUri(input: string): AstrolibNodeTarget | null {
  if (!input || typeof input !== 'string') return null;
  let s = input.trim();

  // 1. 尝试 URL 解码以支持含中文字符的 Slug（如 11_图、15_树和森林）
  try {
    s = decodeURI(s);
  } catch {}

  // 2. 清除外层包裹的多余标点、反引号与各类单双全半角引号
  s = s.replace(/^["'`“”‘’<(\[]+|[)"'`“”’\],.，。；;!?！？、]+$/g, '').trim();
  if (!s) return null;

  // 3. 分离 Hash / 锚点部分
  let pathPart = s;
  let hashPart = '';
  const hashIdx = s.indexOf('#');
  if (hashIdx >= 0) {
    pathPart = s.slice(0, hashIdx);
    hashPart = s.slice(hashIdx + 1).trim();
  } else {
    // 容错：支持尾部以空格分隔的锚点（如 astrolib://.../063_riemann-curvature-tensor math-128）
    const m = s.match(/^(astrolib:\/\/[^\s]+)\s+(?:#?)([a-zA-Z0-9_\u4e00-\u9fa5-]+)$/i);
    if (m) {
      pathPart = m[1];
      hashPart = m[2].trim();
    }
  }

  // 清洗 hashPart 内部可能残留的引号/反引号
  if (hashPart) {
    hashPart = hashPart.replace(/["'`“”‘’]/g, '').trim();
  }

  let colSlug = '';
  let bookSlug = '';
  let chapterSlug: string | undefined = undefined;

  // 4.0 优先识别 paper://<taskId>[/<sectionId>] 文献协议（自动归一化为 astrolib://paper/<taskId>）
  const paperProtoMatch = pathPart.match(/(?:https?:\/\/[^\/]+)?\/?paper:\/{1,3}([^\/]+)(?:\/(.+?))?\/?$/i);
  if (paperProtoMatch) {
    colSlug = 'paper';
    bookSlug = paperProtoMatch[1].trim();
    chapterSlug = paperProtoMatch[2]?.trim();
  }

  // 4.1 匹配 astrolib:// 或 astrolib:/ 或包含 astrolib: 的路径
  const schemeMatch = !colSlug
    ? pathPart.match(/(?:https?:\/\/[^\/]+)?\/?astrolib:\/{1,3}([^\/]+)\/([^\/]+)(?:\/(.+?))?\/?$/i)
    : null;
  if (schemeMatch) {
    colSlug = schemeMatch[1].trim();
    bookSlug = schemeMatch[2].trim();
    chapterSlug = schemeMatch[3]?.trim();
  } else if (!colSlug) {
    // 4.2 匹配 /collections/:col/:book(/:chapter)?
    const colMatch = pathPart.match(/(?:https?:\/\/[^\/]+)?\/?collections\/([^\/]+)\/([^\/]+)(?:\/(.+?))?\/?$/i);
    if (colMatch) {
      colSlug = colMatch[1].trim();
      bookSlug = colMatch[2].trim();
      chapterSlug = colMatch[3]?.trim();
    }
  }

  if (!colSlug || !bookSlug) {
    return null;
  }

  // 5. 净化 colSlug, bookSlug, chapterSlug，剥除残留的引号或反引号
  colSlug = colSlug.replace(/["'`“”‘’]/g, '').trim();
  bookSlug = bookSlug.replace(/["'`“”‘’]/g, '').trim();
  if (chapterSlug) {
    chapterSlug = chapterSlug
      .replace(/["'`“”‘’]/g, '')
      .replace(/\/+$/, '')
      .trim();
  }

  if (colSlug.toLowerCase() === 'paper') {
    const taskId = bookSlug;
    const sectionId = chapterSlug || undefined;
    let canonicalPath = `/workspace/ingest/?taskId=${encodeURIComponent(taskId)}`;
    if (sectionId) {
      canonicalPath += `&section=${encodeURIComponent(sectionId)}`;
    }
    if (hashPart) {
      canonicalPath += `#${encodeURIComponent(hashPart)}`;
    }
    return {
      raw: input,
      entityKind: 'paper',
      colSlug: 'paper',
      bookSlug: taskId,
      chapterSlug: sectionId,
      taskId,
      sectionId,
      anchor: hashPart || undefined,
      canonicalPath,
      title: taskId,
    };
  }

  // 6. 构造规范化 Canonical 相对路径 (以 /collections/ 开头)
  let canonicalPath = `/collections/${encodeURIComponent(colSlug)}/${encodeURIComponent(bookSlug)}/`;
  if (chapterSlug) {
    // 保持章节目录多级安全编码
    const encodedChap = chapterSlug
      .split('/')
      .map((seg) => encodeURIComponent(seg))
      .join('/');
    canonicalPath += `${encodedChap}/`;
  }
  if (hashPart) {
    canonicalPath += `#${encodeURIComponent(hashPart)}`;
  }

  return {
    raw: input,
    entityKind: 'book',
    colSlug,
    bookSlug,
    chapterSlug: chapterSlug || undefined,
    anchor: hashPart || undefined,
    canonicalPath,
    title: getBookTitle(colSlug, bookSlug),
  };
}

/**
 * 构造标准 astrolib 节点定位协议 URI
 */
export function buildAstrolibUri(
  colSlug: string,
  bookSlug: string,
  chapterSlug?: string,
  anchor?: string
): string {
  let uri = `astrolib://${colSlug}/${bookSlug}`;
  if (chapterSlug) {
    uri += `/${chapterSlug}`;
  }
  if (anchor) {
    uri += `#${anchor}`;
  }
  return uri;
}

/**
 * 构造标准文献定位 URI: astrolib://paper/<taskId>[/<sectionId>][#<blockId>]
 */
export function buildPaperAstrolibUri(
  taskId: string,
  sectionId?: string,
  anchor?: string
): string {
  return buildAstrolibUri('paper', taskId, sectionId, anchor);
}
