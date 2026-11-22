import { describe, it, expect } from 'vitest';
import { ReaderWorkspaceStateMachine } from '../../src/features/reader-host/workspace-state';

function makeEntity(id: string) {
  return {
    entityId: `book:${id}`,
    kind: 'book' as const,
    title: `教材-${id}`,
    url: `/collections/math/${id}/chapter-01/`,
  };
}

describe('ReaderWorkspaceStateMachine', () => {
  it('1. 应返回所有在分屏中展示的标签 ID 集合，并准确区分当前焦点窗格', () => {
    const sm = new ReaderWorkspaceStateMachine('backfill');
    const a = sm.openEntity(makeEntity('a'), 100);
    const b = sm.openEntity(makeEntity('b'), 200);

    sm.setSplitMode('split-vertical');
    const visible = sm.getVisibleTabIds();
    expect(visible.has(a.tab.id)).toBe(true);
    expect(visible.has(b.tab.id)).toBe(true);
    expect(visible.size).toBe(2);

    sm.activateTab(a.tab.id, 300);
    expect(sm.getFocusedTabId()).toBe(a.tab.id);
    expect(sm.getVisibleTabIds().size).toBe(2);
  });

  it('2. 多屏模式下打开新书应优先填入空窗格，满屏后替换当前焦点窗格', () => {
    const sm = new ReaderWorkspaceStateMachine('backfill');
    const a = sm.openEntity(makeEntity('a'), 100);
    sm.setSplitMode('split-vertical');

    const b = sm.openEntity(makeEntity('b'), 200);
    expect(b.paneIndex).toBe(1);
    expect(sm.getPaneBindings().slice(0, 2)).toEqual([a.tab.id, b.tab.id]);

    sm.activateTab(a.tab.id, 300);
    expect(sm.getFocusedPaneIndex()).toBe(0);

    const c = sm.openEntity(makeEntity('c'), 400);
    expect(c.paneIndex).toBe(0);
    expect(sm.getPaneBindings().slice(0, 2)).toEqual([c.tab.id, b.tab.id]);
    expect(sm.getVisibleTabIds().has(c.tab.id)).toBe(true);
    expect(sm.getVisibleTabIds().has(b.tab.id)).toBe(true);
    expect(sm.getVisibleTabIds().has(a.tab.id)).toBe(false);
  });

  it('3. 彻底修复回归缺陷：多屏模式下所有标签全部关闭后，从书库重开新书不应陷入全屏空白', () => {
    const sm = new ReaderWorkspaceStateMachine('keep-empty');
    const a = sm.openEntity(makeEntity('a'), 100);
    const b = sm.openEntity(makeEntity('b'), 200);
    sm.setSplitMode('split-vertical');

    sm.closeTab(a.tab.id, 300);
    sm.closeTab(b.tab.id, 400);
    expect(sm.getTabs().length).toBe(0);
    expect(sm.getVisibleTabIds().size).toBe(0);

    const c = sm.openEntity(makeEntity('c'), 500);
    expect(c.paneIndex).toBe(0);
    expect(sm.getPaneBindings()[0]).toBe(c.tab.id);
    expect(sm.getVisibleTabIds().has(c.tab.id)).toBe(true);
  });

  it('4. backfill 关闭策略：后台有标签自动按最近使用补位，无后台标签保留空槽并聚焦该空槽', () => {
    const sm = new ReaderWorkspaceStateMachine('backfill');
    const a = sm.openEntity(makeEntity('a'), 100);
    const b = sm.openEntity(makeEntity('b'), 200);
    const c = sm.openEntity(makeEntity('c'), 300);
    sm.setSplitMode('split-vertical');

    sm.closeTab(b.tab.id, 400);
    expect(sm.getPaneBindings().slice(0, 2)).toEqual([c.tab.id, a.tab.id]);

    sm.closeTab(a.tab.id, 500);
    expect(sm.getPaneBindings().slice(0, 2)).toEqual([c.tab.id, null]);
    expect(sm.getFocusedPaneIndex()).toBe(1);

    const d = sm.openEntity(makeEntity('d'), 600);
    expect(d.paneIndex).toBe(1);
    expect(sm.getPaneBindings().slice(0, 2)).toEqual([c.tab.id, d.tab.id]);
  });

  it('5. collapse 关闭策略：无后台标签可补时，自动降级分屏模式', () => {
    const sm = new ReaderWorkspaceStateMachine('collapse');
    const a = sm.openEntity(makeEntity('a'), 100);
    const b = sm.openEntity(makeEntity('b'), 200);
    const c = sm.openEntity(makeEntity('c'), 300);
    sm.setSplitMode('grid-2x2');

    sm.closeTab(b.tab.id, 400);
    expect(sm.getSplitMode()).toBe('split-vertical');
    expect(sm.getVisibleTabIds().size).toBe(2);

    sm.closeTab(a.tab.id, 500);
    expect(sm.getSplitMode()).toBe('single');
    expect(sm.getPaneBindings()[0]).toBe(c.tab.id);
    expect(sm.getFocusedPaneIndex()).toBe(0);
  });

  it('6. keep-empty 关闭策略：即使后台有标签也不自动补位，保留空槽并聚焦该空槽', () => {
    const sm = new ReaderWorkspaceStateMachine('keep-empty');
    const a = sm.openEntity(makeEntity('a'), 100);
    const b = sm.openEntity(makeEntity('b'), 200);
    const c = sm.openEntity(makeEntity('c'), 300);
    sm.setSplitMode('split-vertical');

    sm.closeTab(b.tab.id, 400);
    expect(sm.getPaneBindings().slice(0, 2)).toEqual([c.tab.id, null]);
    expect(sm.getFocusedPaneIndex()).toBe(1);

    const pane = sm.activateTab(a.tab.id, 500);
    expect(pane).toBe(1);
    expect(sm.getPaneBindings().slice(0, 2)).toEqual([c.tab.id, a.tab.id]);
  });

  it('7. 拖拽标签到目标窗格支持内容互换，不丢失原窗格内容，并正确打开画布分屏', () => {
    const sm = new ReaderWorkspaceStateMachine('backfill');
    const a = sm.openEntity(
      {
        entityId: 'book:math-a',
        kind: 'book',
        title: '教材-a',
        url: '/collections/math/a/chapter-01/',
      },
      100
    );
    const b = sm.openEntity(makeEntity('b'), 200);
    sm.setSplitMode('split-vertical');
    const before = sm.getPaneBindings().slice(0, 2);

    sm.assignTabToPane(before[0]!, 1, 300);
    expect(sm.getPaneBindings().slice(0, 2)).toEqual([before[1], before[0]]);
    expect(sm.getFocusedPaneIndex()).toBe(1);

    sm.setSplitMode('single');
    const canvasTab = sm.openCanvasSplit(
      {
        colSlug: 'math',
        bookSlug: 'a',
        chapterSlug: 'chapter-01',
        url: '/workspace/canvas/?col=math&book=a&chapter=chapter-01',
      },
      400
    );
    expect(sm.getSplitMode()).toBe('split-vertical');
    expect(sm.getPaneBindings()[0]).toBe(a.tab.id);
    expect(sm.getPaneBindings()[1]).toBe(canvasTab.id);
  });
});
