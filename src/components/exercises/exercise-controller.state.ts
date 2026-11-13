/**
 * src/components/exercises/exercise-controller.state.ts
 * ============================================================================
 * Pure Headless State Machine for Exercise Center Controller
 * ============================================================================
 * 规范：
 * 1. 绝对无 DOM 依赖：严禁出现 window, document, querySelector, addEventListener；
 * 2. 状态转移确定性与幂等性：严格管理做题记录、筛选条件、分页和统计；
 * 3. 序列化与水合支持：支持作答快照恢复与统计重新计算。
 * ============================================================================
 */

import type { SlimQuestionItem } from '../../types/exercises';

export type ExerciseMode = 'practice' | 'paper';
export type ExerciseSource = 'all' | 'textbook' | 'exam';
export type ExerciseGroup = 'all' | 'A' | 'B';

export interface UserPracticeRecord {
  answered: boolean;
  userChoice?: string;
  userBlank?: string;
  isCorrect?: boolean;
  mastered?: boolean;
  revealedSolution?: boolean;
}

export interface ExerciseStats {
  total: number;
  done: number;
  correct: number;
  accuracy: number; // 0.0 ~ 1.0
}

export interface ExerciseFilterState {
  mode: ExerciseMode;
  chapter: number;
  paperId: number;
  source: ExerciseSource;
  group: ExerciseGroup;
  section: string;
  paperSection: string;
  type: string;
  searchQuery: string;
  isGlobalSearch: boolean;
  isFilterCollapsed: boolean;
  isFullscreen: boolean;
  isOpen: boolean;
}

export interface ExerciseStateSnapshot {
  filters: ExerciseFilterState;
  records: Record<string, UserPracticeRecord>;
  activeSolutionVersions: Record<string, string>;
  displayedLimit: number;
}

export const DEFAULT_PAGE_SIZE = 15;

export class ExerciseStateMachine {
  private filters: ExerciseFilterState = {
    mode: 'practice',
    chapter: 1,
    paperId: 1,
    source: 'all',
    group: 'all',
    section: 'all',
    paperSection: 'all',
    type: 'all',
    searchQuery: '',
    isGlobalSearch: false,
    isFilterCollapsed: false,
    isFullscreen: false,
    isOpen: false,
  };

  private records = new Map<string, UserPracticeRecord>();
  private activeSolutionVersions = new Map<string, string>();
  private displayedLimit = DEFAULT_PAGE_SIZE;

  constructor(initialSnapshot?: Partial<ExerciseStateSnapshot>) {
    if (initialSnapshot) {
      this.hydrate(initialSnapshot);
    }
  }

  // --- Getters ---

  public getFilters(): Readonly<ExerciseFilterState> {
    return { ...this.filters };
  }

  public getDisplayedLimit(): number {
    return this.displayedLimit;
  }

  public getRecord(questionId: string): UserPracticeRecord | undefined {
    return this.records.get(questionId);
  }

  public getAllRecords(): ReadonlyMap<string, UserPracticeRecord> {
    return new Map(this.records);
  }

  public getActiveSolutionVersion(questionId: string): string | undefined {
    return this.activeSolutionVersions.get(questionId);
  }

  // --- Modal Open/Close & View State ---

  public open(): boolean {
    if (this.filters.isOpen) return false;
    this.filters.isOpen = true;
    return true;
  }

  public close(): boolean {
    if (!this.filters.isOpen) return false;
    this.filters.isOpen = false;
    return true;
  }

  public toggleFullscreen(): boolean {
    this.filters.isFullscreen = !this.filters.isFullscreen;
    return this.filters.isFullscreen;
  }

  public toggleFilterCollapsed(): boolean {
    this.filters.isFilterCollapsed = !this.filters.isFilterCollapsed;
    return this.filters.isFilterCollapsed;
  }

  // --- Filter Actions ---

  public setMode(mode: ExerciseMode): void {
    this.filters.mode = mode;
    this.displayedLimit = DEFAULT_PAGE_SIZE;
  }

  public setChapter(chapter: number): boolean {
    if (chapter < 1) return false;
    this.filters.chapter = chapter;
    this.filters.section = 'all';
    this.displayedLimit = DEFAULT_PAGE_SIZE;
    return true;
  }

  public setPaperId(paperId: number): boolean {
    if (paperId < 1) return false;
    this.filters.paperId = paperId;
    this.filters.paperSection = 'all';
    this.displayedLimit = DEFAULT_PAGE_SIZE;
    return true;
  }

  public setSource(source: ExerciseSource): void {
    this.filters.source = source;
    this.displayedLimit = DEFAULT_PAGE_SIZE;
  }

  public setGroup(group: ExerciseGroup): void {
    this.filters.group = group;
    this.displayedLimit = DEFAULT_PAGE_SIZE;
  }

  public setSection(section: string): void {
    this.filters.section = section || 'all';
    this.displayedLimit = DEFAULT_PAGE_SIZE;
  }

  public setPaperSection(paperSection: string): void {
    this.filters.paperSection = paperSection || 'all';
    this.displayedLimit = DEFAULT_PAGE_SIZE;
  }

  public setType(type: string): void {
    this.filters.type = type || 'all';
    this.displayedLimit = DEFAULT_PAGE_SIZE;
  }

  public setSearchQuery(query: string): void {
    this.filters.searchQuery = (query || '').trim().toLowerCase();
    this.displayedLimit = DEFAULT_PAGE_SIZE;
  }

  public setGlobalSearch(enabled: boolean): void {
    this.filters.isGlobalSearch = Boolean(enabled);
    this.displayedLimit = DEFAULT_PAGE_SIZE;
  }

  public loadMore(increment: number = DEFAULT_PAGE_SIZE): number {
    this.displayedLimit += increment;
    return this.displayedLimit;
  }

  // --- Practice & Answering ---

  public recordChoice(questionId: string, choice: string, correctChoice?: string): UserPracticeRecord {
    const existing = this.records.get(questionId) || { answered: false };
    const isCorrect = correctChoice !== undefined ? choice.trim() === correctChoice.trim() : undefined;
    const updated: UserPracticeRecord = {
      ...existing,
      answered: true,
      userChoice: choice,
      isCorrect,
    };
    this.records.set(questionId, updated);
    return updated;
  }

  public toggleMastered(questionId: string): boolean {
    const existing = this.records.get(questionId) || { answered: false };
    const nextMastered = !existing.mastered;
    this.records.set(questionId, {
      ...existing,
      mastered: nextMastered,
    });
    return nextMastered;
  }

  public revealSolution(questionId: string): boolean {
    const existing = this.records.get(questionId) || { answered: false };
    if (existing.revealedSolution) return false;
    this.records.set(questionId, {
      ...existing,
      revealedSolution: true,
    });
    return true;
  }

  public setActiveSolutionVersion(questionId: string, versionId: string): void {
    this.activeSolutionVersions.set(questionId, versionId);
  }

  // --- Filtering & Stats Calculation (Pure Functions) ---

  public filterQuestions(questions: SlimQuestionItem[]): SlimQuestionItem[] {
    if (!Array.isArray(questions)) return [];

    return questions.filter((q) => {
      // 1. Source filter
      if (this.filters.source !== 'all') {
        const isExam = Boolean(q.source && (q.source.includes('考研') || q.source.includes('真题')));
        if (this.filters.source === 'exam' && !isExam) return false;
        if (this.filters.source === 'textbook' && isExam) return false;
      }

      // 2. Group filter
      if (this.filters.group !== 'all') {
        if (q.group !== this.filters.group) return false;
      }

      // 3. Section filter
      if (this.filters.mode === 'practice') {
        if (this.filters.section !== 'all' && q.sec !== this.filters.section) {
          return false;
        }
      } else {
        if (this.filters.paperSection !== 'all' && q.sec !== this.filters.paperSection) {
          return false;
        }
      }

      // 4. Type filter
      if (this.filters.type !== 'all' && q.type !== this.filters.type) {
        return false;
      }

      // 5. Search query
      if (this.filters.searchQuery) {
        const sq = this.filters.searchQuery;
        const matchStem = (q.stem_raw || q.stem_html || '').toLowerCase().includes(sq);
        const matchNumber = (q.paper_q_num ? String(q.paper_q_num) : '').toLowerCase().includes(sq);
        const matchSearch = (q.search || '').toLowerCase().includes(sq);
        if (!matchStem && !matchNumber && !matchSearch) return false;
      }

      return true;
    });
  }

  public calculateStats(currentQuestions: SlimQuestionItem[]): ExerciseStats {
    const total = currentQuestions.length;
    let done = 0;
    let correct = 0;

    for (const q of currentQuestions) {
      const rec = this.records.get(q.id);
      if (rec && rec.answered) {
        done++;
        if (rec.isCorrect) {
          correct++;
        }
      }
    }

    const accuracy = done > 0 ? Number((correct / done).toFixed(2)) : 0;
    return { total, done, correct, accuracy };
  }

  // --- Snapshot Serialization & Hydration ---

  public serialize(): ExerciseStateSnapshot {
    const recordsObj: Record<string, UserPracticeRecord> = {};
    for (const [k, v] of this.records.entries()) {
      recordsObj[k] = { ...v };
    }
    const versionsObj: Record<string, string> = {};
    for (const [k, v] of this.activeSolutionVersions.entries()) {
      versionsObj[k] = v;
    }

    return {
      filters: { ...this.filters },
      records: recordsObj,
      activeSolutionVersions: versionsObj,
      displayedLimit: this.displayedLimit,
    };
  }

  public hydrate(snapshot: Partial<ExerciseStateSnapshot>): void {
    if (snapshot.filters) {
      this.filters = { ...this.filters, ...snapshot.filters };
    }
    if (snapshot.records) {
      this.records.clear();
      for (const [k, v] of Object.entries(snapshot.records)) {
        this.records.set(k, { ...v });
      }
    }
    if (snapshot.activeSolutionVersions) {
      this.activeSolutionVersions.clear();
      for (const [k, v] of Object.entries(snapshot.activeSolutionVersions)) {
        this.activeSolutionVersions.set(k, v);
      }
    }
    if (typeof snapshot.displayedLimit === 'number') {
      this.displayedLimit = snapshot.displayedLimit;
    }
  }
}
