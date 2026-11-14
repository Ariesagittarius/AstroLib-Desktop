/**
 * tests/unit/translation-dock-state.test.ts
 * ============================================================================
 * Unit Tests for TranslationDockStateMachine (DOM-free State Verification)
 * ============================================================================
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TranslationDockStateMachine } from '../../src/services/translation/client/translation-dock-controller.state';
import { TranslationDockController } from '../../src/services/translation/client/translation-dock-controller';
import type { ParagraphUnit } from '../../src/services/translation/types';

describe('TranslationDockStateMachine', () => {
  let sm: TranslationDockStateMachine;

  beforeEach(() => {
    sm = new TranslationDockStateMachine();
  });

  it('1. Initial State: defaults to idle, google provider and sidebar mode', () => {
    expect(sm.getStatus()).toBe('idle');
    expect(sm.getProvider()).toBe('google');
    expect(sm.getDisplayMode()).toBe('sidebar');
    expect(sm.getIsInlineActive()).toBe(false);
    expect(sm.getIsSettingsOpen()).toBe(false);
    expect(sm.getIsExportOpen()).toBe(false);
    expect(sm.getParagraphs()).toEqual([]);
    expect(sm.getErrorMessage()).toBeNull();
  });

  it('2. Legal Transitions: traverses through translating and finishes', () => {
    expect(sm.startTranslation()).toBe(true);
    expect(sm.getStatus()).toBe('translating');

    expect(sm.finishTranslation()).toBe(true);
    expect(sm.getStatus()).toBe('idle');
  });

  it('3. Illegal Transitions: blocks duplicate start and finish when idle', () => {
    // Cannot finish when already idle
    expect(sm.finishTranslation()).toBe(false);
    expect(sm.getStatus()).toBe('idle');

    // Start translation
    expect(sm.startTranslation()).toBe(true);
    // Duplicate start rejected
    expect(sm.startTranslation()).toBe(false);
    expect(sm.getStatus()).toBe('translating');
  });

  it('4. Progress Calculation: accurately computes completed, failed and percentage', () => {
    const units: ParagraphUnit[] = [
      { id: 'p1', index: 0, type: 'paragraph', sourceText: 'Hello', translatedText: '你好', status: 'done' },
      { id: 'p2', index: 1, type: 'paragraph', sourceText: 'World', status: 'idle' },
      { id: 'p3', index: 2, type: 'paragraph', sourceText: 'Test', error: 'API timeout', status: 'error' },
      { id: 'p4', index: 3, type: 'paragraph', sourceText: 'Math', status: 'idle' },
    ];
    sm.setParagraphs(units);

    const progress = sm.calculateProgress();
    expect(progress.total).toBe(4);
    expect(progress.completed).toBe(1);
    expect(progress.failed).toBe(1);
    expect(progress.percent).toBe(50); // (1 + 1) / 4 = 50%
  });

  it('5. Paragraph Updates & Error State: updates individual paragraphs and error state', () => {
    sm.setParagraphs([{ id: 'p1', index: 0, type: 'paragraph', sourceText: 'Sample', status: 'idle' }]);
    expect(sm.updateParagraph('p1', { translatedText: '示例', status: 'done' })).toBe(true);
    expect(sm.getParagraphs()[0].translatedText).toBe('示例');

    expect(sm.updateParagraph('non-existent', { translatedText: 'xx' })).toBe(false);

    sm.setError('Network failure');
    expect(sm.getStatus()).toBe('error');
    expect(sm.getErrorMessage()).toBe('Network failure');

    expect(sm.resetError()).toBe(true);
    expect(sm.getStatus()).toBe('idle');
    expect(sm.getErrorMessage()).toBeNull();
  });

  it('6. Serialization and Hydration: preserves full configuration snapshot', () => {
    sm.setProvider('gemini');
    sm.setDisplayMode('inline');
    sm.setInlineActive(true);
    sm.setExportFormat('chinese-markdown');
    sm.setExportScope('satisfied');
    sm.setChapterKey('math-ch1');

    const snapshot = sm.serialize();
    expect(snapshot.currentProvider).toBe('gemini');
    expect(snapshot.displayMode).toBe('inline');
    expect(snapshot.isInlineActive).toBe(true);
    expect(snapshot.selectedExportFormat).toBe('chinese-markdown');
    expect(snapshot.currentChapterKey).toBe('math-ch1');

    const newSm = new TranslationDockStateMachine(snapshot);
    expect(newSm.getProvider()).toBe('gemini');
    expect(newSm.getDisplayMode()).toBe('inline');
    expect(newSm.getIsInlineActive()).toBe(true);
    expect(newSm.getSelectedExportFormat()).toBe('chinese-markdown');
    expect(newSm.getCurrentChapterKey()).toBe('math-ch1');
  });

  it('7. Controller Integration: TranslationDockController delegates state to TranslationDockStateMachine', () => {
    const instance = TranslationDockController.getInstance();
    const stateMachine = instance.getStateMachine();
    expect(stateMachine).toBeInstanceOf(TranslationDockStateMachine);
    expect(instance.currentProvider).toBe('google');
    expect(instance.displayMode).toBe('sidebar');

    instance.currentProvider = 'zhipu';
    expect(stateMachine.getProvider()).toBe('zhipu');

    instance.displayMode = 'inline';
    expect(stateMachine.getDisplayMode()).toBe('inline');
  });
});
