/**
 * tests/unit/exercise-state.test.ts
 * ============================================================================
 * Unit Tests for ExerciseStateMachine (DOM-free State Verification)
 * ============================================================================
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ExerciseStateMachine } from '../../src/components/exercises/exercise-controller.state';
import { ExerciseCenterController, exerciseController } from '../../src/components/exercises/exercise-controller';
import type { SlimQuestionItem } from '../../src/types/exercises';

describe('ExerciseStateMachine', () => {
  let sm: ExerciseStateMachine;

  beforeEach(() => {
    sm = new ExerciseStateMachine();
  });

  it('1. Initial State: starts closed with practice mode on chapter 1', () => {
    const filters = sm.getFilters();
    expect(filters.isOpen).toBe(false);
    expect(filters.mode).toBe('practice');
    expect(filters.chapter).toBe(1);
    expect(filters.paperId).toBe(1);
    expect(filters.source).toBe('all');
    expect(filters.group).toBe('all');
    expect(filters.section).toBe('all');
    expect(sm.getDisplayedLimit()).toBe(15);
  });

  it('2. Mode & Filter Transitions: correctly switches mode and resets page limit', () => {
    sm.loadMore(30);
    expect(sm.getDisplayedLimit()).toBe(45);

    sm.setMode('paper');
    expect(sm.getFilters().mode).toBe('paper');
    expect(sm.getDisplayedLimit()).toBe(15); // reset on mode change

    sm.setSource('exam');
    sm.setGroup('A');
    sm.setSearchQuery('矩阵');
    expect(sm.getFilters().source).toBe('exam');
    expect(sm.getFilters().group).toBe('A');
    expect(sm.getFilters().searchQuery).toBe('矩阵');
  });

  it('3. Illegal Transitions: rejects invalid chapter and paper IDs', () => {
    expect(sm.setChapter(0)).toBe(false);
    expect(sm.setChapter(-5)).toBe(false);
    expect(sm.getFilters().chapter).toBe(1);

    expect(sm.setChapter(2)).toBe(true);
    expect(sm.getFilters().chapter).toBe(2);

    expect(sm.setPaperId(0)).toBe(false);
    expect(sm.getFilters().paperId).toBe(1);

    expect(sm.setPaperId(3)).toBe(true);
    expect(sm.getFilters().paperId).toBe(3);
  });

  it('4. Practice Recording & Accuracy Calculation: computes stats correctly', () => {
    const mockQuestions: SlimQuestionItem[] = [
      { id: 'q1', type: 'choice', answer: 'A', stem_raw: 'Question 1', stem_html: 'Question 1', sec: '1.1', sec_slug: '1-1', sec_title: 'Sec 1', chapter: 1, chapter_title: 'Ch 1', paper_id: 1, paper_title: 'P 1', paper_q_num: 1, order_in_paper: 1, section_type: 'exam', academic_year: '2024', paper_category: 'test', paper_type: 'normal', source: 'textbook', kps: [], score: 5, answer_html: 'A', search: 'q1' },
      { id: 'q2', type: 'choice', answer: 'B', stem_raw: 'Question 2', stem_html: 'Question 2', sec: '1.2', sec_slug: '1-2', sec_title: 'Sec 2', chapter: 1, chapter_title: 'Ch 1', paper_id: 1, paper_title: 'P 1', paper_q_num: 2, order_in_paper: 2, section_type: 'exam', academic_year: '2024', paper_category: 'test', paper_type: 'normal', source: 'textbook', kps: [], score: 5, answer_html: 'B', search: 'q2' },
      { id: 'q3', type: 'choice', answer: 'C', stem_raw: 'Question 3', stem_html: 'Question 3', sec: '1.3', sec_slug: '1-3', sec_title: 'Sec 3', chapter: 1, chapter_title: 'Ch 1', paper_id: 1, paper_title: 'P 1', paper_q_num: 3, order_in_paper: 3, section_type: 'exam', academic_year: '2024', paper_category: 'test', paper_type: 'normal', source: 'textbook', kps: [], score: 5, answer_html: 'C', search: 'q3' },
    ];

    let stats = sm.calculateStats(mockQuestions);
    expect(stats.total).toBe(3);
    expect(stats.done).toBe(0);
    expect(stats.accuracy).toBe(0);

    // Answer q1 correctly
    sm.recordChoice('q1', 'A', 'A');
    // Answer q2 incorrectly
    sm.recordChoice('q2', 'C', 'B');

    stats = sm.calculateStats(mockQuestions);
    expect(stats.total).toBe(3);
    expect(stats.done).toBe(2);
    expect(stats.correct).toBe(1);
    expect(stats.accuracy).toBe(0.5);
  });

  it('5. Mastery and Solution Revelation: manages idempotent toggles', () => {
    expect(sm.toggleMastered('q1')).toBe(true);
    expect(sm.getRecord('q1')?.mastered).toBe(true);

    expect(sm.toggleMastered('q1')).toBe(false);
    expect(sm.getRecord('q1')?.mastered).toBe(false);

    // Reveal solution once
    expect(sm.revealSolution('q1')).toBe(true);
    expect(sm.getRecord('q1')?.revealedSolution).toBe(true);
    // Duplicate reveal returns false (idempotent)
    expect(sm.revealSolution('q1')).toBe(false);
  });

  it('6. Serialization and Hydration: preserves full records and active versions', () => {
    sm.open();
    sm.setChapter(5);
    sm.recordChoice('q10', 'B', 'B');
    sm.toggleMastered('q10');
    sm.setActiveSolutionVersion('q10', 'v2-community');

    const snapshot = sm.serialize();
    expect(snapshot.filters.chapter).toBe(5);
    expect(snapshot.records['q10'].mastered).toBe(true);
    expect(snapshot.activeSolutionVersions['q10']).toBe('v2-community');

    const newSm = new ExerciseStateMachine(snapshot);
    expect(newSm.getFilters().chapter).toBe(5);
    expect(newSm.getRecord('q10')?.userChoice).toBe('B');
    expect(newSm.getRecord('q10')?.mastered).toBe(true);
    expect(newSm.getActiveSolutionVersion('q10')).toBe('v2-community');
  });

  it('7. Controller Integration: ExerciseCenterController instantiates and delegates state transitions to ExerciseStateMachine', () => {
    const controller = new ExerciseCenterController();
    const stateMachine = controller.getStateMachine();
    expect(stateMachine).toBeInstanceOf(ExerciseStateMachine);
    expect(stateMachine.getFilters().mode).toBe('practice');
    expect(stateMachine.getFilters().group).toBe('all');
    expect(stateMachine.getFilters().isOpen).toBe(false);

    // 真实状态转换与公开入口联动断言
    controller.open();
    expect(stateMachine.getFilters().isOpen).toBe(true);
    expect(controller.isOpen).toBe(true);

    controller.close();
    expect(stateMachine.getFilters().isOpen).toBe(false);
    expect(controller.isOpen).toBe(false);

    controller.openPaper(3);
    expect(stateMachine.getFilters().isOpen).toBe(true);
    expect(stateMachine.getFilters().mode).toBe('paper');
    expect(controller.currentMode).toBe('paper');

    controller.currentMode = 'practice';
    expect(stateMachine.getFilters().mode).toBe('practice');
    expect(controller.currentMode).toBe('practice');

    controller.currentGroup = 'A';
    expect(stateMachine.getFilters().group).toBe('A');
    expect(controller.currentGroup).toBe('A');

    controller.currentGroup = 'B';
    expect(stateMachine.getFilters().group).toBe('B');
    expect(controller.currentGroup).toBe('B');

    controller.close();
    expect(stateMachine.getFilters().isOpen).toBe(false);

    expect(exerciseController.getStateMachine()).toBeInstanceOf(ExerciseStateMachine);
  });
});
