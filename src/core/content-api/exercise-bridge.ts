import fs from 'node:fs';
import path from 'node:path';
import { findProjectRoot } from '../catalog/content-paths.ts';
import type { ExerciseItem } from './types.ts';

function resolveExercisesDir(): string {
  const root = findProjectRoot();
  const candidates = [
    path.join(root, 'src/data/exercises'),
    path.join(root, 'dist/data/exercises'),
    path.join(root, 'resources/app.asar.unpacked/src/data/exercises'),
    path.resolve(process.cwd(), 'src/data/exercises'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return path.join(root, 'src/data/exercises');
}

interface RawQuestion {
  id: string;
  source?: {
    clean_title?: string;
    raw_title?: string;
    source_desc?: string;
    course_name?: string;
  };
  meta?: {
    type?: string;
    difficulty?: number;
    score?: number;
  };
  mapping?: Record<
    string,
    {
      chapter?: number;
      chapter_title?: string;
      section?: string;
      section_title?: string;
      section_slug?: string;
      knowledge_points?: string[];
    }
  >;
  content?: {
    stem?: string;
    options?: string[];
    answer?: string;
    solution?: string;
    analysis?: string;
  };
  solution?: {
    answer?: string;
    hints?: string;
    steps?: string;
  } | string;
}

let cachedChapterIndex: Record<string, Record<string, string[]>> | null = null;
let cachedCommunitySolutions: Record<string, any[]> | null = null;
const cachedBookQuestions = new Map<string, RawQuestion[]>();

function getChapterIndex(): Record<string, Record<string, string[]>> {
  if (!cachedChapterIndex) {
    const dir = resolveExercisesDir();
    const indexPath = path.join(dir, 'chapter_index.json');
    if (fs.existsSync(indexPath)) {
      try {
        cachedChapterIndex = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
      } catch {
        cachedChapterIndex = {};
      }
    } else {
      cachedChapterIndex = {};
    }
  }
  return cachedChapterIndex || {};
}

function getCommunitySolutions(): Record<string, any[]> {
  if (!cachedCommunitySolutions) {
    const dir = resolveExercisesDir();
    const solPath = path.join(dir, 'community_ai_solutions.json');
    if (fs.existsSync(solPath)) {
      try {
        cachedCommunitySolutions = JSON.parse(fs.readFileSync(solPath, 'utf-8'));
      } catch {
        cachedCommunitySolutions = {};
      }
    } else {
      cachedCommunitySolutions = {};
    }
  }
  return cachedCommunitySolutions || {};
}

function loadBookQuestions(bookSlug: string): RawQuestion[] {
  if (cachedBookQuestions.has(bookSlug)) {
    return cachedBookQuestions.get(bookSlug)!;
  }

  const dir = resolveExercisesDir();
  const questions: RawQuestion[] = [];
  if (!fs.existsSync(dir)) return questions;

  const files = fs.readdirSync(dir);
  const matchedFiles = files.filter(
    (f) =>
      f.endsWith('.json') &&
      f !== 'chapter_index.json' &&
      f !== 'community_ai_solutions.json' &&
      f !== 'feedbacks.json'
  );

  for (const file of matchedFiles) {
    const filePath = path.join(dir, file);
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (data.book === bookSlug || file.includes(bookSlug)) {
        if (Array.isArray(data.questions)) {
          questions.push(...data.questions);
        } else if (data.chapters && typeof data.chapters === 'object') {
          for (const chKey of Object.keys(data.chapters)) {
            const list = data.chapters[chKey];
            if (Array.isArray(list)) questions.push(...list);
          }
        }
      }
    } catch {}
  }

  cachedBookQuestions.set(bookSlug, questions);
  return questions;
}

function mapToExerciseItem(q: RawQuestion, bookSlug: string): ExerciseItem {
  const communitySols = getCommunitySolutions();
  const rawCommunity = communitySols[q.id] || [];

  const communityAiSolutions = rawCommunity.map((item: any) => ({
    provider: item.provider || 'AI',
    model: item.model || 'Unknown',
    content: item.content || item.solution || '',
    rating: item.rating,
  }));

  const mappingInfo = q.mapping?.[bookSlug];

  let solText = q.content?.solution || q.content?.analysis || '';
  let ansText = q.content?.answer || '';

  if (typeof q.solution === 'string') {
    solText = solText || q.solution;
  } else if (q.solution && typeof q.solution === 'object') {
    ansText = ansText || q.solution.answer || '';
    const parts = [
      q.solution.answer ? `答案: ${q.solution.answer}` : '',
      q.solution.hints ? `提示: ${q.solution.hints}` : '',
      q.solution.steps ? `步骤: ${q.solution.steps}` : '',
    ].filter(Boolean);
    if (!solText && parts.length > 0) {
      solText = parts.join('\n');
    }
  }

  return {
    id: q.id,
    number: q.source?.source_desc || q.id,
    title: q.source?.clean_title || q.source?.raw_title,
    section: mappingInfo?.section_title || mappingInfo?.section,
    chapterSlug: mappingInfo?.section_slug,
    question: q.content?.stem || '',
    options: q.content?.options,
    answer: ansText || undefined,
    solution: solText || undefined,
    communityAiSolutions: communityAiSolutions.length > 0 ? communityAiSolutions : undefined,
    sourceBook: bookSlug,
  };
}

export function getExercisesForChapter(
  colSlug: string,
  bookSlug: string,
  chapterSlug: string
): ExerciseItem[] {
  const allQuestions = loadBookQuestions(bookSlug);
  const chapterIndex = getChapterIndex();

  const bookIndex = chapterIndex[bookSlug] || {};
  let targetIds: string[] | undefined;

  const normSlug = chapterSlug.toLowerCase();
  for (const [key, ids] of Object.entries(bookIndex)) {
    if (key.toLowerCase().includes(normSlug) || normSlug.includes(key.toLowerCase())) {
      targetIds = ids;
      break;
    }
  }

  if (targetIds && targetIds.length > 0) {
    const idSet = new Set(targetIds);
    return allQuestions.filter((q) => idSet.has(q.id)).map((q) => mapToExerciseItem(q, bookSlug));
  }

  const matched = allQuestions.filter((q) => {
    const m = q.mapping?.[bookSlug];
    if (!m) return false;
    const secSlug = m.section_slug || '';
    const secTitle = m.section_title || '';
    return (
      secSlug.toLowerCase().includes(normSlug) ||
      normSlug.includes(secSlug.toLowerCase()) ||
      secTitle.toLowerCase().includes(normSlug) ||
      normSlug.includes(secTitle.toLowerCase())
    );
  });

  return matched.map((q) => mapToExerciseItem(q, bookSlug));
}

export function searchExercises(query: string, limit: number = 20): ExerciseItem[] {
  if (!query || !query.trim()) return [];

  const tokens = query
    .toLowerCase()
    .split(/[,，\s+、|;；/]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  if (tokens.length === 0) return [];

  const dir = resolveExercisesDir();
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'feedbacks.json');
  const scoredItems: Array<{ item: RawQuestion; book: string; score: number }> = [];

  for (const file of files) {
    const filePath = path.join(dir, file);
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      const list: RawQuestion[] = [];
      if (Array.isArray(data.questions)) list.push(...data.questions);
      else if (data.chapters && typeof data.chapters === 'object') {
        for (const k of Object.keys(data.chapters)) {
          if (Array.isArray(data.chapters[k])) list.push(...data.chapters[k]);
        }
      }

      const bookSlug = data.book || (file.replace(/_exercises\.json$/, '').replace(/_textbook$/, ''));

      for (const item of list) {
        const id = (item.id || '').toLowerCase();
        const stem = (item.content?.stem || '').toLowerCase();
        const title = (item.source?.clean_title || item.source?.raw_title || '').toLowerCase();
        const course = (item.source?.course_name || '').toLowerCase();

        let kps = '';
        if (item.mapping) {
          for (const m of Object.values(item.mapping)) {
            if (m.chapter_title) kps += ' ' + m.chapter_title.toLowerCase();
            if (m.section_title) kps += ' ' + m.section_title.toLowerCase();
            if (Array.isArray(m.knowledge_points)) kps += ' ' + m.knowledge_points.join(' ').toLowerCase();
          }
        }

        const corpus = `${id} ${title} ${course} ${kps} ${stem}`;

        let matchCount = 0;
        for (const t of tokens) {
          if (corpus.includes(t)) matchCount++;
        }

        if (matchCount > 0) {
          scoredItems.push({
            item,
            book: bookSlug,
            score: matchCount,
          });
        }
      }
    } catch {}
  }

  scoredItems.sort((a, b) => b.score - a.score);

  return scoredItems.slice(0, limit).map(({ item, book }) => mapToExerciseItem(item, book));
}
