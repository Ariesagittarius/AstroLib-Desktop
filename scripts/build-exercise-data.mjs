// scripts/build-exercise-data.mjs
// 构建期：从唯一题库源 src/data/exercises/ 编译全站支持书目的结构化题库（预渲染 KaTeX 公式并数据瘦身）
// 输出到唯一构建产物目录:
//   - artifacts/exercises/<bookSlug>/ch{1..N}.json
//   - artifacts/exercises/<bookSlug>/papers.json
//   - artifacts/exercises/<bookSlug>/papers/p{paper_id}.json
//   - artifacts/exercises/<bookSlug>/meta.json
//   - artifacts/exercises/support-status.json (显式记录 13 本官方书目的 supported / unsupported 状态)
//
// 用法：
//   node scripts/build-exercise-data.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import katex from 'katex';
import { features } from '../src/config/features.config.mjs';
import { getCatalogBooks } from '../src/config/collections.config.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC_EX_DIR = path.join(ROOT, 'src', 'data', 'exercises');
const ARTIFACTS_EX_ROOT = path.join(ROOT, 'artifacts', 'exercises');

export const SUPPORTED_EXERCISE_BOOKS = [
  {
    slug: 'engineering_analysis',
    title: '工科数学分析基础（第三版）',
    courseName: '工科数学分析基础',
    chaptersCount: 7,
    paperIdBase: 1000,
    examFile: 'engineering_analysis_exercises.json',
    textbookFile: 'engineering_analysis_textbook_exercises.json',
    defaultExamCategory: '期末真题',
    includeSubQuestionsOnExam: true,
  },
  {
    slug: 'linear_algebra_geometry',
    title: '线性代数与几何（第2版）',
    courseName: '线性代数与几何',
    chaptersCount: 9,
    paperIdBase: 2000,
    examFile: 'linear_algebra_geometry_exercises.json',
    textbookFile: 'linear_algebra_geometry_textbook_exercises.json',
    defaultExamCategory: '线代期末',
    includeSubQuestionsOnExam: false,
  },
  {
    slug: 'digital_circuit',
    title: '数字电路与逻辑设计（第2版）',
    courseName: '数字电路与逻辑设计',
    chaptersCount: 10,
    paperIdBase: 3000,
    examFile: null,
    textbookFile: 'digital_circuit_textbook_exercises.json',
    defaultExamCategory: '教材课后习题',
    includeSubQuestionsOnExam: false,
  },
  {
    slug: 'electronic_circuits',
    title: '电子电路基础（第2版）',
    courseName: '电子电路基础',
    chaptersCount: 7,
    paperIdBase: 4000,
    examFile: null,
    textbookFile: 'electronic_circuits_textbook_exercises.json',
    defaultExamCategory: '教材课后习题',
    includeSubQuestionsOnExam: false,
  },
];

/** HTML 实体安全转义 */
function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 分隔符拆分：$$...$$（display）优先，其次 $...$（inline/multiline） */
const MATH_SPLIT_RE = /(\$\$[\s\S]+?\$\$|\$[^\$]+?\$)/g;

/** 清理并修复 LaTeX 字符串中的控制字符与转义序列 */
function sanitizeMathLatex(val) {
  if (typeof val !== 'string') return '';
  let str = val;
  str = str.replace(/\x0c/g, '\\f');
  str = str.replace(/\x08/g, '\\b');
  str = str.replace(/\x0b/g, '\\v');
  str = str.replace(/\r(?!\n)/g, '\\r');
  str = str.replace(/\t([a-zA-Z])/g, '\\t$1');
  str = str.replace(/(\$\$[\s\S]+?\$\$|\$[^\$\n]+?\$)/g, (m) => m.replace(/\t/g, ' '));
  str = str.replace(/(\$\$[\s\S]+?\$\$|\$[^\$\n]+?\$)/g, (m) =>
    m.replace(/\n(u|eq|ne|not|nabla|notin|nrightarrow|natural|nearrow|nwarrow|neg|normalsize)\b/g, '\\n$1')
  );
  str = str.replace(/\\iiiint_{\\Omega}/g, '\\iiint_{\\Omega}');
  str = str.replace(/\\overparen\{([^}]+)\}/g, '\\stackrel{\\frown}{$1}');
  str = str.replace(/\\wideparen\{([^}]+)\}/g, '\\stackrel{\\frown}{$1}');
  return str;
}

const KATEX_BUILD_OPTIONS = {
  output: 'html',
  displayMode: false,
  throwOnError: false,
  strict: false,
  macros: {
    '\\overparen': '\\stackrel{\\frown}{#1}',
    '\\wideparen': '\\stackrel{\\frown}{#1}',
    '\\iiiint': '\\int\\!\\!\\int\\!\\!\\int\\!\\!\\int',
    '\\iddots': '{\\mathinner{\\mkern1mu\\raisebox{1pt}{.}\\mkern2mu\\raisebox{4pt}{.}\\mkern2mu\\raisebox{7pt}{.}\\mkern1mu}}',
    '\\adots': '{\\mathinner{\\mkern1mu\\raisebox{1pt}{.}\\mkern2mu\\raisebox{4pt}{.}\\mkern2mu\\raisebox{7pt}{.}\\mkern1mu}}',
  },
};

function renderMathText(text) {
  if (!text) return '';
  const str = sanitizeMathLatex(String(text)).trim();
  if (!str) return '';

  const images = [];
  const textWithImagePlaceholders = str.replace(/!\[(.*?)\]\((.*?)\)/g, (_match, alt, url) => {
    const idx = images.length;
    images.push({ alt, url });
    return `___EX_IMAGE_TOKEN_${idx}___`;
  });

  let htmlOut = '';
  if (!textWithImagePlaceholders.includes('$')) {
    htmlOut = escapeHtml(textWithImagePlaceholders).replace(/\n/g, '<br/>');
  } else {
    const parts = textWithImagePlaceholders.split(MATH_SPLIT_RE);
    const out = [];
    for (const part of parts) {
      if (!part) continue;
      if (part.startsWith('$$') && part.endsWith('$$') && part.length >= 4) {
        try {
          const math = part.slice(2, -2).trim();
          out.push(katex.renderToString(math, { ...KATEX_BUILD_OPTIONS, displayMode: true }));
        } catch {
          out.push(escapeHtml(part));
        }
      } else if (part.startsWith('$') && part.endsWith('$') && part.length >= 2) {
        try {
          const math = part.slice(1, -1).trim();
          out.push(katex.renderToString(math, { ...KATEX_BUILD_OPTIONS, displayMode: false }));
        } catch {
          out.push(escapeHtml(part));
        }
      } else {
        out.push(escapeHtml(part).replace(/\n/g, '<br/>'));
      }
    }
    htmlOut = out.join('');
  }

  if (images.length > 0) {
    htmlOut = htmlOut.replace(/___EX_IMAGE_TOKEN_(\d+)___/g, (_m, idxStr) => {
      const img = images[parseInt(idxStr, 10)];
      if (!img) return '';
      const altAttr = escapeHtml(img.alt || '题图');
      const figCaption = img.alt ? `<span class="ex-img-caption">${escapeHtml(img.alt)}</span>` : '';
      return `<div class="ex-figure"><img src="${escapeHtml(img.url)}" alt="${altAttr}" class="ex-img" loading="lazy" />${figCaption}</div>`;
    });
  }

  return htmlOut;
}

function cleanPaperTitle(rawTitle) {
  if (!rawTitle) return '';
  return String(rawTitle)
    .replace(/^\d+\s*\[[^\]]+\]\s*/, '')
    .replace(/试题$/, '试卷')
    .trim();
}

function extractPaperQuestionNum(qid, orderInPaper) {
  const match = String(qid || '').match(/-Q(\d+)$/i);
  if (match) {
    return parseInt(match[1], 10);
  }
  return orderInPaper || 1;
}

function comparePaperQuestions(a, b) {
  const na = Number(a.paper_q_num);
  const nb = Number(b.paper_q_num);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) {
    return na - nb;
  }
  const sa = String(a.paper_q_num ?? '');
  const sb = String(b.paper_q_num ?? '');
  if (sa !== sb) {
    return sa.localeCompare(sb, undefined, { numeric: true });
  }
  return (a.order_in_paper || 0) - (b.order_in_paper || 0);
}

function buildBookExercises(cfg) {
  const examPath = cfg.examFile ? path.join(SRC_EX_DIR, cfg.examFile) : null;
  const tbPath = cfg.textbookFile ? path.join(SRC_EX_DIR, cfg.textbookFile) : null;

  if (examPath && !fs.existsSync(examPath)) {
    throw new Error(`[exercise-data] 找不到真题库源文件: ${examPath}`);
  }
  if (tbPath && !fs.existsSync(tbPath)) {
    throw new Error(`[exercise-data] 找不到教材题库源文件: ${tbPath}`);
  }

  const outDir = path.join(ARTIFACTS_EX_ROOT, cfg.slug);
  const papersOutDir = path.join(outDir, 'papers');
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(papersOutDir, { recursive: true });

  const startTime = Date.now();
  console.log(`\n[exercise-data] 编译《${cfg.title}》(${cfg.slug}) -> ${path.relative(ROOT, outDir)}/`);

  const rawExamData = examPath ? JSON.parse(fs.readFileSync(examPath, 'utf-8')) : { chapters: {} };
  const examChapters = rawExamData.chapters || {};
  const rawTbData = tbPath ? JSON.parse(fs.readFileSync(tbPath, 'utf-8')) : { chapters: {} };
  const tbChapters = rawTbData.chapters || {};

  const metaData = {
    book: cfg.slug,
    title: cfg.title,
    total_questions: 0,
    total_papers: 0,
    total_exam_questions: 0,
    total_textbook_questions: 0,
    total_exam_papers: 0,
    total_textbook_papers: 0,
    chapters: {},
    papers: {},
  };

  let totalQuestionsCount = 0;
  let examQuestionsCount = 0;
  let tbQuestionsCount = 0;
  const papersMap = new Map();

  for (let chId = 1; chId <= cfg.chaptersCount; chId++) {
    const chKey = String(chId);
    const tbList = tbChapters[chKey] || [];
    const examList = examChapters[chKey] || [];
    const qList = [...tbList, ...examList];

    const slimQuestions = [];
    const sectionCounts = {};
    const sectionSlugs = {};
    const sectionTitles = {};
    const typeCounts = { choice: 0, blank: 0, calc: 0, proof: 0 };
    const sourceCounts = {};
    let chapterTitle = `第${chId}章`;

    for (const q of qList) {
      totalQuestionsCount++;
      const isTb = q.source_type === 'textbook' || (!cfg.examFile && !String(q.id || '').startsWith('BUPT-MATH'));
      if (isTb) {
        tbQuestionsCount++;
      } else {
        examQuestionsCount++;
      }

      const qType = q.meta?.type || 'calc';
      typeCounts[qType] = (typeCounts[qType] || 0) + 1;

      const category = q.source?.category || (isTb ? '教材课后习题' : cfg.defaultExamCategory);
      sourceCounts[category] = (sourceCounts[category] || 0) + 1;

      const mapping = q.mapping?.[cfg.slug] || {};
      if (mapping.chapter_title) {
        chapterTitle = mapping.chapter_title;
      }
      const sec = mapping.section || '综合';
      const secSlug = mapping.section_slug || sec;
      const secTitle = mapping.section_title || '';
      const kps = mapping.knowledge_points || [];

      sectionCounts[sec] = (sectionCounts[sec] || 0) + 1;
      sectionSlugs[sec] = secSlug;
      if (secTitle) sectionTitles[sec] = secTitle;

      const paperId = q.source?.paper_id ?? (isTb ? cfg.paperIdBase + chId : 1);
      const rawTitle = q.source?.raw_title || (isTb ? `《${cfg.courseName}》第${chId}章 课后习题` : `${cfg.courseName}期末试题`);
      const cleanTitle = cleanPaperTitle(rawTitle) || (isTb ? rawTitle : `${q.source?.academic_year || ''} ${category}`);
      const orderInPaper = q.meta?.order_in_paper || 1;
      const paperQNum = q.meta?.paper_q_num || extractPaperQuestionNum(q.id, orderInPaper);
      const sectionType = q.meta?.section_type || (isTb ? '课后习题' : '');
      const score = q.meta?.score ?? 5;
      const group = q.meta?.group || (isTb ? 'A' : '');

      const stemRawClean = sanitizeMathLatex(q.content?.stem || '');
      const stemHtml = renderMathText(stemRawClean);
      const options = (q.content?.options || []).map((opt) => ({
        key: opt.key,
        text_html: renderMathText(opt.text),
        text_raw: sanitizeMathLatex(opt.text || ''),
      }));
      const answerRaw = sanitizeMathLatex(q.solution?.answer || q.content?.solution || '');
      const answerHtml = renderMathText(answerRaw);
      const hintsRaw = q.solution?.hints ? sanitizeMathLatex(q.solution.hints) : '';
      const stepsRaw = q.solution?.steps ? sanitizeMathLatex(q.solution.steps) : '';
      const hintsHtml = hintsRaw ? renderMathText(hintsRaw) : '';
      const stepsHtml = stepsRaw ? renderMathText(stepsRaw) : '';

      const sourceStr = isTb
        ? (q.source?.source_desc || `${cleanTitle} · ${sectionType ? sectionType + ' ' : ''}第 ${paperQNum} 题`)
        : `${cleanTitle} · 原卷第 ${paperQNum} 题`.trim();

      const searchRaw = [
        q.id,
        isTb ? 'textbook' : 'exam',
        group ? `${group}组` : '',
        stemRawClean,
        ...((q.content?.options || []).map((o) => `${o.key} ${o.text}`)),
        answerRaw,
        kps.join(' '),
        sourceStr,
        cleanTitle,
        category,
        sec,
        secSlug,
        secTitle,
        sectionType,
      ]
        .join(' ')
        .toLowerCase();

      const slimItem = {
        id: q.id,
        source_type: q.source_type || (isTb ? 'textbook' : 'exam'),
        group,
        type: qType,
        score,
        sec,
        sec_slug: secSlug,
        sec_title: secTitle,
        chapter: chId,
        chapter_title: chapterTitle,
        paper_id: paperId,
        paper_title: cleanTitle,
        paper_raw_title: rawTitle,
        paper_q_num: paperQNum,
        order_in_paper: orderInPaper,
        section_type: sectionType,
        academic_year: q.source?.academic_year || (isTb ? '教材配套' : ''),
        paper_category: category,
        paper_type: q.source?.paper_type || (isTb ? '教材原题' : '综合'),
        source: sourceStr,
        kps,
        stem_html: stemHtml,
        stem_raw: q.content?.stem || '',
        answer: answerRaw,
        answer_html: answerHtml,
        search: searchRaw,
      };

      if (options.length > 0) slimItem.options = options;
      if (hintsHtml) slimItem.hints_html = hintsHtml;
      if (hintsRaw) slimItem.hints_raw = hintsRaw;
      if (stepsHtml) slimItem.steps_html = stepsHtml;
      if (stepsRaw) slimItem.steps_raw = stepsRaw;
      if (cfg.includeSubQuestionsOnExam && !isTb && q.content?.sub_questions && q.content.sub_questions.length > 0) {
        slimItem.sub_questions = q.content.sub_questions.map((sub) => ({
          sub_id: sub.sub_id,
          stem_raw: sub.stem,
          stem_html: renderMathText(sub.stem),
        }));
      }

      slimQuestions.push(slimItem);

      if (!papersMap.has(paperId)) {
        papersMap.set(paperId, {
          paper_id: paperId,
          raw_title: rawTitle,
          clean_title: cleanTitle,
          category,
          course_name: q.source?.course_name || cfg.courseName,
          academic_year: q.source?.academic_year || (isTb ? '教材配套' : ''),
          term: q.source?.term || (chId <= Math.ceil(cfg.chaptersCount / 2) ? 1 : 2),
          exam_type: isTb ? 'textbook' : (q.source?.exam_type || 'exam'),
          paper_type: q.source?.paper_type || (isTb ? '教材原题' : '综合'),
          page_start: q.source?.page_start,
          page_end: q.source?.page_end,
          total_questions: 0,
          total_score: 0,
          sections_order: [],
          questions: [],
        });
      }

      const paperObj = papersMap.get(paperId);
      paperObj.total_questions++;
      paperObj.total_score += score;
      if (sectionType && !paperObj.sections_order.includes(sectionType)) {
        paperObj.sections_order.push(sectionType);
      }
      paperObj.questions.push(slimItem);
    }

    const sections = Object.keys(sectionCounts)
      .sort((a, b) => (parseFloat(a) || 999) - (parseFloat(b) || 999))
      .map((secKey) => ({
        section: secKey,
        section_title: sectionTitles[secKey] || `第 ${secKey} 节`,
        section_slug: sectionSlugs[secKey] || secKey,
        count: sectionCounts[secKey],
      }));

    const chapterPayload = {
      chapter: chId,
      chapter_title: chapterTitle,
      total: slimQuestions.length,
      sections,
      type_counts: typeCounts,
      source_counts: sourceCounts,
      questions: slimQuestions,
    };

    const outFile = path.join(outDir, `ch${chId}.json`);
    fs.writeFileSync(outFile, JSON.stringify(chapterPayload), 'utf-8');

    metaData.chapters[String(chId)] = {
      chapter: chId,
      chapter_title: chapterTitle,
      total: slimQuestions.length,
      sections,
      type_counts: typeCounts,
      source_counts: sourceCounts,
    };
  }

  const papersSummaryList = [];
  for (const [paperId, paperObj] of papersMap.entries()) {
    paperObj.questions.sort(comparePaperQuestions);
    const paperTypeCounts = { choice: 0, blank: 0, calc: 0, proof: 0 };
    paperObj.questions.forEach((q) => {
      paperTypeCounts[q.type] = (paperTypeCounts[q.type] || 0) + 1;
    });

    const singlePaperPayload = {
      paper_id: paperObj.paper_id,
      clean_title: paperObj.clean_title,
      raw_title: paperObj.raw_title,
      category: paperObj.category,
      course_name: paperObj.course_name,
      academic_year: paperObj.academic_year,
      term: paperObj.term,
      exam_type: paperObj.exam_type,
      paper_type: paperObj.paper_type,
      total_questions: paperObj.total_questions,
      total_score: paperObj.total_score,
      type_counts: paperTypeCounts,
      sections_order: paperObj.sections_order,
      questions: paperObj.questions,
    };

    fs.writeFileSync(path.join(papersOutDir, `p${paperId}.json`), JSON.stringify(singlePaperPayload), 'utf-8');

    papersSummaryList.push({
      paper_id: paperObj.paper_id,
      clean_title: paperObj.clean_title,
      category: paperObj.category,
      course_name: paperObj.course_name,
      academic_year: paperObj.academic_year,
      term: paperObj.term,
      exam_type: paperObj.exam_type,
      total_questions: paperObj.total_questions,
      total_score: paperObj.total_score,
      type_counts: paperTypeCounts,
      sections_count: paperObj.sections_order.length,
    });
  }

  papersSummaryList.sort((a, b) => a.paper_id - b.paper_id);
  fs.writeFileSync(
    path.join(outDir, 'papers.json'),
    JSON.stringify({ total: papersSummaryList.length, papers: papersSummaryList }, null, 2),
    'utf-8'
  );

  let examPapersCount = 0;
  let tbPapersCount = 0;
  for (const p of papersSummaryList) {
    if (p.exam_type === 'textbook') tbPapersCount++;
    else examPapersCount++;
  }

  metaData.total_questions = totalQuestionsCount;
  metaData.total_papers = papersSummaryList.length;
  metaData.total_exam_questions = examQuestionsCount;
  metaData.total_textbook_questions = tbQuestionsCount;
  metaData.total_exam_papers = examPapersCount;
  metaData.total_textbook_papers = tbPapersCount;
  fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify(metaData, null, 2), 'utf-8');

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(
    `[exercise-data] 完成 ${cfg.slug}: ${cfg.chaptersCount} 章 / ${papersSummaryList.length} 套卷 / ${totalQuestionsCount} 题 (教材:${tbQuestionsCount}, 真题:${examQuestionsCount}) (${elapsed}s)`
  );

  return {
    slug: cfg.slug,
    chaptersCount: cfg.chaptersCount,
    totalPapers: papersSummaryList.length,
    totalQuestions: totalQuestionsCount,
    tbQuestions: tbQuestionsCount,
    examQuestions: examQuestionsCount,
  };
}

function writeSupportStatusReport(builtSummaries) {
  const summaryBySlug = new Map(builtSummaries.map((s) => [s.slug, s]));
  const configBySlug = new Map(SUPPORTED_EXERCISE_BOOKS.map((c) => [c.slug, c]));
  const allBooks = getCatalogBooks();

  const report = {
    generatedBy: 'scripts/build-exercise-data.mjs',
    sourceRoot: 'src/data/exercises/',
    outputRoot: 'artifacts/exercises/',
    generatedAt: new Date().toISOString(),
    supportedCount: 0,
    unsupportedCount: 0,
    books: allBooks.map((b) => {
      const cfg = configBySlug.get(b.slug);
      const summary = summaryBySlug.get(b.slug);
      if (cfg && summary) {
        return {
          id: b.id,
          slug: b.slug,
          title: b.title,
          status: 'supported',
          sourceFiles: [cfg.textbookFile, cfg.examFile].filter(Boolean),
          ...summary,
        };
      }
      return {
        id: b.id,
        slug: b.slug,
        title: b.title,
        status: 'unsupported',
        reason: 'No structured exercise dataset in src/data/exercises/',
      };
    }),
  };

  report.supportedCount = report.books.filter((b) => b.status === 'supported').length;
  report.unsupportedCount = report.books.filter((b) => b.status === 'unsupported').length;

  fs.mkdirSync(ARTIFACTS_EX_ROOT, { recursive: true });
  fs.writeFileSync(path.join(ARTIFACTS_EX_ROOT, 'support-status.json'), JSON.stringify(report, null, 2), 'utf-8');
  console.log(
    `\n[exercise-data] 支持状态清单已生成 -> artifacts/exercises/support-status.json (supported=${report.supportedCount}, unsupported=${report.unsupportedCount})`
  );
}

function main() {
  if (features.exercises && features.exercises.enabled === false) {
    console.log('[exercise-data] 已跳过：features.config.ts 中 exercises.enabled=false');
    return;
  }

  fs.mkdirSync(ARTIFACTS_EX_ROOT, { recursive: true });
  const builtSummaries = SUPPORTED_EXERCISE_BOOKS.map((cfg) => buildBookExercises(cfg));
  writeSupportStatusReport(builtSummaries);
}

const isDirectEntry =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectEntry) {
  main();
}
