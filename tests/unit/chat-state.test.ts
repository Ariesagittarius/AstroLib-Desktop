/**
 * tests/unit/chat-state.test.ts
 * ============================================================================
 * Unit Tests for ChatControllerStateMachine (DOM-free State Verification)
 * ============================================================================
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ChatControllerStateMachine } from '../../src/ai/client/chat-controller.state';
import { AIAskElement } from '../../src/ai/client/chat-controller';

describe('ChatControllerStateMachine', () => {
  let sm: ChatControllerStateMachine;

  beforeEach(() => {
    sm = new ChatControllerStateMachine();
  });

  it('1. Initial State: starts in idle with sane defaults', () => {
    expect(sm.getStatus()).toBe('idle');
    expect(sm.getActiveModelId()).toBe('gemini-1.5-flash');
    expect(sm.isExtendedThinkingEnabled()).toBe(false);
    expect(sm.isCollapseToolsSummaryEnabled()).toBe(true);
    expect(sm.getIsDocked()).toBe(false);
    expect(sm.getReferencedChapters()).toEqual([]);
    expect(sm.getActiveThreadId()).toBeNull();
    expect(sm.getErrorMessage()).toBeNull();
  });

  it('2. Legal Transitions: traverses through busy, streaming, and returns to idle', () => {
    expect(sm.startGenerating()).toBe(true);
    expect(sm.getStatus()).toBe('busy');

    expect(sm.enterStreaming()).toBe(true);
    expect(sm.getStatus()).toBe('streaming');

    expect(sm.finishGenerating()).toBe(true);
    expect(sm.getStatus()).toBe('idle');
  });

  it('3. Illegal Transitions: blocks invalid status changes', () => {
    // Cannot enter streaming from idle directly
    expect(sm.enterStreaming()).toBe(false);
    expect(sm.getStatus()).toBe('idle');

    // Cannot finish generating from idle
    expect(sm.finishGenerating()).toBe(false);
    expect(sm.getStatus()).toBe('idle');

    // Cannot start generating if already busy
    expect(sm.startGenerating()).toBe(true);
    expect(sm.startGenerating()).toBe(false);
    expect(sm.getStatus()).toBe('busy');
  });

  it('4. Hydration and Serialization: serializes state and rehydrates accurately', () => {
    sm.setActiveModelId('gemini-1.5-pro');
    sm.setExtendedThinking(true);
    sm.setIsDocked(true);
    sm.addReferencedChapter({ title: 'Chapter 1', url: '/ch1', isCurrent: true });
    sm.setActiveThreadId('thread-123');

    const snapshot = sm.serialize();
    expect(snapshot.activeModelId).toBe('gemini-1.5-pro');
    expect(snapshot.extendedThinking).toBe(true);
    expect(snapshot.isDocked).toBe(true);
    expect(snapshot.referencedChapters.length).toBe(1);

    const newSm = new ChatControllerStateMachine(snapshot);
    expect(newSm.getActiveModelId()).toBe('gemini-1.5-pro');
    expect(newSm.isExtendedThinkingEnabled()).toBe(true);
    expect(newSm.getIsDocked()).toBe(true);
    expect(newSm.getActiveThreadId()).toBe('thread-123');
    expect(newSm.getReferencedChapters()[0].title).toBe('Chapter 1');
  });

  it('5. Error State: handles error transition and error reset', () => {
    sm.startGenerating();
    sm.setError('Rate limit exceeded');

    expect(sm.getStatus()).toBe('error');
    expect(sm.getErrorMessage()).toBe('Rate limit exceeded');

    // Resetting error brings state back to idle
    expect(sm.resetError()).toBe(true);
    expect(sm.getStatus()).toBe('idle');
    expect(sm.getErrorMessage()).toBeNull();

    // Resetting when not in error returns false
    expect(sm.resetError()).toBe(false);
  });

  it('6. Idempotency & Duplicate Guards: prevents duplicate chapter references and duplicate aborts', () => {
    const ch = { title: 'Chapter 2', url: '/ch2' };
    expect(sm.addReferencedChapter(ch)).toBe(true);
    expect(sm.addReferencedChapter(ch)).toBe(false); // Duplicate rejected
    expect(sm.getReferencedChapters().length).toBe(1);

    expect(sm.removeReferencedChapter('/ch2')).toBe(true);
    expect(sm.removeReferencedChapter('/ch2')).toBe(false); // Already removed

    // Duplicate aborts in idle
    expect(sm.abortGenerating()).toBe(false);
    sm.startGenerating();
    expect(sm.abortGenerating()).toBe(true);
    expect(sm.abortGenerating()).toBe(false); // Already idle
  });

  it('7. Controller Integration: AIAskElement delegates state to ChatControllerStateMachine', () => {
    const el = Object.create(AIAskElement.prototype) as AIAskElement;
    el._stateMachine = new ChatControllerStateMachine();
    expect(el.getStateMachine().getStatus()).toBe('idle');
    expect(el._busy).toBe(false);

    el._busy = true;
    expect(el.getStateMachine().getStatus()).toBe('busy');
    expect(el._busy).toBe(true);

    el._busy = false;
    expect(el.getStateMachine().getStatus()).toBe('idle');
    expect(el._busy).toBe(false);

    // 状态机流式生成、错误处理与终止断言
    el._busy = true;
    el.getStateMachine().enterStreaming();
    expect(el.getStateMachine().getStatus()).toBe('streaming');
    expect(el._busy).toBe(true);

    el.getStateMachine().setError('Model quota exceeded');
    expect(el.getStateMachine().getStatus()).toBe('error');
    expect(el.getStateMachine().getErrorMessage()).toBe('Model quota exceeded');

    el.getStateMachine().resetError();
    expect(el.getStateMachine().getStatus()).toBe('idle');
    expect(el._busy).toBe(false);

    el._busy = true;
    el.getStateMachine().abortGenerating();
    expect(el.getStateMachine().getStatus()).toBe('idle');
    expect(el._busy).toBe(false);
  });
});
