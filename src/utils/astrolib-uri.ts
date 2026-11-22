export interface AstrolibNodeTarget {
  raw: string;
  entityKind?: 'book' | 'paper';
  colSlug: string;
  bookSlug: string;
  chapterSlug?: string;
  taskId?: string;
  sectionId?: string;
  anchor?: string;
  canonicalPath: string;
  title: string;
}

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

export function getBookTitle(
  colSlug: string,
  bookSlug: string,
  titleLookup?: Record<string, string>
): string {
  const key = `${colSlug}-${bookSlug}`;
  return titleLookup?.[key] || OFFICIAL_BOOK_TITLES[key] || bookSlug;
}

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

export function parseAstrolibUri(input: string): AstrolibNodeTarget | null {
  if (!input || typeof input !== 'string') return null;
  let s = input.trim();

  try {
    s = decodeURI(s);
  } catch {}

  s = s.replace(/^["'`“”‘’<(\[]+|[)"'`“”’\],.，。；;!?！？、]+$/g, '').trim();
  if (!s) return null;

  let pathPart = s;
  let hashPart = '';
  const hashIdx = s.indexOf('#');
  if (hashIdx >= 0) {
    pathPart = s.slice(0, hashIdx);
    hashPart = s.slice(hashIdx + 1).trim();
  } else {

    const m = s.match(/^(astrolib:\/\/[^\s]+)\s+(?:#?)([a-zA-Z0-9_\u4e00-\u9fa5-]+)$/i);
    if (m) {
      pathPart = m[1];
      hashPart = m[2].trim();
    }
  }

  if (hashPart) {
    hashPart = hashPart.replace(/["'`“”‘’]/g, '').trim();
  }

  let colSlug = '';
  let bookSlug = '';
  let chapterSlug: string | undefined = undefined;

  const paperProtoMatch = pathPart.match(/(?:https?:\/\/[^\/]+)?\/?paper:\/{1,3}([^\/]+)(?:\/(.+?))?\/?$/i);
  if (paperProtoMatch) {
    colSlug = 'paper';
    bookSlug = paperProtoMatch[1].trim();
    chapterSlug = paperProtoMatch[2]?.trim();
  }

  const schemeMatch = !colSlug
    ? pathPart.match(/(?:https?:\/\/[^\/]+)?\/?astrolib:\/{1,3}([^\/]+)\/([^\/]+)(?:\/(.+?))?\/?$/i)
    : null;
  if (schemeMatch) {
    colSlug = schemeMatch[1].trim();
    bookSlug = schemeMatch[2].trim();
    chapterSlug = schemeMatch[3]?.trim();
  } else if (!colSlug) {

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

  let canonicalPath = `/collections/${encodeURIComponent(colSlug)}/${encodeURIComponent(bookSlug)}/`;
  if (chapterSlug) {

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

export function buildPaperAstrolibUri(
  taskId: string,
  sectionId?: string,
  anchor?: string
): string {
  return buildAstrolibUri('paper', taskId, sectionId, anchor);
}
