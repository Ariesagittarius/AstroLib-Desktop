/**
 * src/features/reader-host/workspace-state.ts
 * ============================================================================
 * 研读视窗纯 TypeScript 状态机 (Zero-DOM Workspace & Split-Pane State Machine)
 * ============================================================================
 * 职责：
 * 1. 清晰分离「底栏全部已展示标签 (Visible Tabs)」与「当前焦点窗格 (Focused Pane)」；
 * 2. 规范多屏模式下的开书/切标签落位策略（优先填空窗格，满屏则替换焦点窗格）；
 * 3. 支持 3 种可配置的关闭标签行为：自动补位 (backfill)、自动降级 (collapse)、保留空槽 (keep-empty)；
 * 4. 彻底根治全部标签关闭后多屏死锁空白问题。
 * ============================================================================
 */

import type { ReadingEntityKind, SplitLayoutMode, TabItem } from '../../types/library-entity';

export type SplitClosePolicy = 'backfill' | 'collapse' | 'keep-empty';

export const SPLIT_CLOSE_POLICY_STORAGE_KEY = 'astrolib_split_close_policy';

export interface OpenTabPayload {
  entityId: string;
  kind: ReadingEntityKind;
  title: string;
  url: string;
}

export interface ReaderWorkspaceState {
  tabs: TabItem[];
  splitMode: SplitLayoutMode;
  paneBindings: [string | null, string | null, string | null, string | null];
  focusedPaneIndex: number;
  activeTabId: string | null;
  pendingSlotTarget: number | null;
  closePolicy: SplitClosePolicy;
}

export function normalizeClosePolicy(raw: string | null | undefined): SplitClosePolicy {
  if (raw === 'collapse' || raw === 'keep-empty' || raw === 'backfill') {
    return raw;
  }
  return 'backfill';
}

export function uiModeToSplitLayout(mode: string): SplitLayoutMode {
  if (mode === '1x2' || mode === 'split-vertical') return 'split-vertical';
  if (mode === '2x1' || mode === 'split-horizontal') return 'split-horizontal';
  if (mode === '2x2' || mode === 'grid-2x2') return 'grid-2x2';
  return 'single';
}

export function splitLayoutToUiMode(layout: SplitLayoutMode): '1x1' | '1x2' | '2x1' | '2x2' {
  if (layout === 'split-vertical') return '1x2';
  if (layout === 'split-horizontal') return '2x1';
  if (layout === 'grid-2x2') return '2x2';
  return '1x1';
}

export class ReaderWorkspaceStateMachine {
  private state: ReaderWorkspaceState;
  private tabIdCounter = 0;

  constructor(initialPolicy: SplitClosePolicy = 'backfill') {
    this.state = {
      tabs: [],
      splitMode: 'single',
      paneBindings: [null, null, null, null],
      focusedPaneIndex: 0,
      activeTabId: null,
      pendingSlotTarget: null,
      closePolicy: initialPolicy,
    };
  }

  public getState(): ReaderWorkspaceState {
    return {
      ...this.state,
      tabs: this.state.tabs.map((t) => ({ ...t })),
      paneBindings: [...this.state.paneBindings] as [string | null, string | null, string | null, string | null],
    };
  }

  public getTabs(): readonly TabItem[] {
    return this.state.tabs;
  }

  public getSplitMode(): SplitLayoutMode {
    return this.state.splitMode;
  }

  public getPaneBindings(): readonly [string | null, string | null, string | null, string | null] {
    return this.state.paneBindings;
  }

  public getFocusedPaneIndex(): number {
    return this.state.focusedPaneIndex;
  }

  public getActiveTabId(): string | null {
    return this.state.activeTabId;
  }

  public getClosePolicy(): SplitClosePolicy {
    return this.state.closePolicy;
  }

  public setClosePolicy(policy: SplitClosePolicy): void {
    this.state.closePolicy = policy;
  }

  public setPendingSlotTarget(paneIndex: number | null): void {
    if (paneIndex === null || (Number.isInteger(paneIndex) && paneIndex >= 0 && paneIndex < 4)) {
      this.state.pendingSlotTarget = paneIndex;
    }
  }

  public getMaxPanes(mode: SplitLayoutMode = this.state.splitMode): number {
    if (mode === 'single') return 1;
    if (mode === 'grid-2x2') return 4;
    return 2;
  }

  public getVisibleTabIds(): Set<string> {
    const maxPanes = this.getMaxPanes();
    const validIds = new Set(this.state.tabs.map((t) => t.id));
    const visible = new Set<string>();
    for (let i = 0; i < maxPanes; i++) {
      const boundId = this.state.paneBindings[i];
      if (boundId && validIds.has(boundId)) {
        visible.add(boundId);
      }
    }
    return visible;
  }

  public getFocusedTabId(): string | null {
    const maxPanes = this.getMaxPanes();
    const idx = this.state.focusedPaneIndex;
    if (idx < 0 || idx >= maxPanes) return this.state.activeTabId;
    const bound = this.state.paneBindings[idx];
    if (bound && this.state.tabs.some((t) => t.id === bound)) {
      return bound;
    }
    return this.state.activeTabId;
  }

  private generateTabId(now: number): string {
    this.tabIdCounter += 1;
    return `tab-${now}-${this.tabIdCounter}-${Math.random().toString(36).slice(2, 6)}`;
  }

  private syncActiveFlags(): void {
    const activeId = this.state.activeTabId;
    for (const tab of this.state.tabs) {
      tab.active = tab.id === activeId;
    }
  }

  private isValidTabId(tabId: string | null | undefined): tabId is string {
    return Boolean(tabId && this.state.tabs.some((t) => t.id === tabId));
  }

  private findFirstVisiblePaneOfTab(tabId: string): number {
    const maxPanes = this.getMaxPanes();
    for (let i = 0; i < maxPanes; i++) {
      if (this.state.paneBindings[i] === tabId) return i;
    }
    return -1;
  }

  private findTargetPaneForNewTab(): number {
    const maxPanes = this.getMaxPanes();
    const focused = this.state.focusedPaneIndex;

    // 1. 优先确认当前焦点窗格本身是否为空槽
    if (focused >= 0 && focused < maxPanes && !this.isValidTabId(this.state.paneBindings[focused])) {
      return focused;
    }

    // 2. 否则查找第一个空窗格
    for (let i = 0; i < maxPanes; i++) {
      if (!this.isValidTabId(this.state.paneBindings[i])) {
        return i;
      }
    }

    // 3. 若全部已满，替换当前焦点窗格
    return focused >= 0 && focused < maxPanes ? focused : 0;
  }

  private pickMostRecentBackgroundTab(excludeIds: Set<string>): TabItem | undefined {
    return this.state.tabs
      .filter((t) => !excludeIds.has(t.id))
      .sort((a, b) => (b.lastVisited || 0) - (a.lastVisited || 0))[0];
  }

  private fallbackActiveTabId(): string | null {
    const maxPanes = this.getMaxPanes();
    const focusedBound = this.state.paneBindings[this.state.focusedPaneIndex];
    if (this.state.focusedPaneIndex < maxPanes && this.isValidTabId(focusedBound)) {
      return focusedBound;
    }
    for (let i = 0; i < maxPanes; i++) {
      const id = this.state.paneBindings[i];
      if (this.isValidTabId(id)) return id;
    }
    return null;
  }

  /**
   * 聚焦某个可见窗格（例如用户点击空槽或切换到某窗格中的 iframe）
   */
  public focusPane(paneIndex: number, now = Date.now()): void {
    const maxPanes = this.getMaxPanes();
    if (!Number.isInteger(paneIndex) || paneIndex < 0 || paneIndex >= maxPanes) return;

    this.state.focusedPaneIndex = paneIndex;
    const boundId = this.state.paneBindings[paneIndex];
    if (this.isValidTabId(boundId)) {
      this.state.activeTabId = boundId;
      const tab = this.state.tabs.find((t) => t.id === boundId);
      if (tab) tab.lastVisited = now;
    } else {
      this.state.activeTabId = null;
    }
    this.syncActiveFlags();
  }

  /**
   * 打开已有或新建标签页，并按多屏策略落位
   */
  public openEntity(payload: OpenTabPayload, now = Date.now()): { tab: TabItem; isNew: boolean; paneIndex: number } {
    const existing = this.state.tabs.find((t) => t.entityId === payload.entityId);
    if (existing) {
      existing.url = payload.url;
      if (payload.title) existing.title = payload.title;
      const paneIndex = this.activateTab(existing.id, now);
      return { tab: { ...existing }, isNew: false, paneIndex };
    }

    const newTab: TabItem = {
      id: this.generateTabId(now),
      entityId: payload.entityId,
      kind: payload.kind,
      title: payload.title,
      url: payload.url,
      active: true,
      lastVisited: now,
    };
    this.state.tabs.push(newTab);
    const paneIndex = this.activateTab(newTab.id, now);
    return { tab: { ...newTab }, isNew: true, paneIndex };
  }

  /**
   * 激活指定标签页（点击底栏标签或书库重复选中）
   * - 若已在分屏中展示：仅切换焦点，绝不重复打开；
   * - 若未展示（或有 pendingSlotTarget）：优先填入空窗格，满屏替换焦点窗格。
   */
  public activateTab(tabId: string, now = Date.now()): number {
    const tab = this.state.tabs.find((t) => t.id === tabId);
    if (!tab) return -1;

    const maxPanes = this.getMaxPanes();
    let assignedPane = -1;

    if (
      this.state.pendingSlotTarget !== null &&
      this.state.pendingSlotTarget >= 0 &&
      this.state.pendingSlotTarget < maxPanes
    ) {
      const targetPane = this.state.pendingSlotTarget;
      this.state.pendingSlotTarget = null;
      const existingPane = this.findFirstVisiblePaneOfTab(tabId);
      if (existingPane !== -1 && existingPane !== targetPane) {
        this.state.paneBindings[existingPane] = null;
      }
      this.state.paneBindings[targetPane] = tabId;
      assignedPane = targetPane;
    } else {
      const visibleIdx = this.findFirstVisiblePaneOfTab(tabId);
      if (visibleIdx !== -1) {
        assignedPane = visibleIdx;
      } else {
        assignedPane = this.findTargetPaneForNewTab();
        this.state.paneBindings[assignedPane] = tabId;
      }
    }

    this.state.focusedPaneIndex = assignedPane;
    this.state.activeTabId = tabId;
    tab.lastVisited = now;
    this.syncActiveFlags();
    return assignedPane;
  }

  /**
   * 拖拽底栏标签到指定窗格（支持与目标窗格内容互换，不丢失原窗格内容）
   */
  public assignTabToPane(tabId: string, targetPaneIndex: number, now = Date.now()): boolean {
    const maxPanes = this.getMaxPanes();
    if (!this.isValidTabId(tabId)) return false;
    if (!Number.isInteger(targetPaneIndex) || targetPaneIndex < 0 || targetPaneIndex >= maxPanes) return false;

    const existingPane = this.findFirstVisiblePaneOfTab(tabId);
    const previousTargetTab = this.state.paneBindings[targetPaneIndex];

    if (existingPane !== -1 && existingPane !== targetPaneIndex) {
      this.state.paneBindings[existingPane] = this.isValidTabId(previousTargetTab) ? previousTargetTab : null;
    }

    this.state.paneBindings[targetPaneIndex] = tabId;
    this.state.focusedPaneIndex = targetPaneIndex;
    this.state.activeTabId = tabId;
    const tab = this.state.tabs.find((t) => t.id === tabId);
    if (tab) tab.lastVisited = now;
    this.syncActiveFlags();
    return true;
  }

  /**
   * 关闭标签页，按当前关闭策略处理多屏空槽
   */
  public closeTab(tabId: string, now = Date.now()): boolean {
    const idx = this.state.tabs.findIndex((t) => t.id === tabId);
    if (idx === -1) return false;

    const maxPanes = this.getMaxPanes();
    let freedPaneIdx = -1;
    for (let i = 0; i < maxPanes; i++) {
      if (this.state.paneBindings[i] === tabId) {
        freedPaneIdx = i;
        break;
      }
    }

    this.state.tabs.splice(idx, 1);
    for (let i = 0; i < 4; i++) {
      if (this.state.paneBindings[i] === tabId) {
        this.state.paneBindings[i] = null;
      }
    }

    if (this.state.tabs.length === 0) {
      this.state.paneBindings = [null, null, null, null];
      this.state.activeTabId = null;
      this.state.focusedPaneIndex = 0;
      this.state.pendingSlotTarget = null;
      if (this.state.closePolicy === 'collapse') {
        this.state.splitMode = 'single';
      }
      return true;
    }

    if (freedPaneIdx !== -1) {
      const visibleNow = this.getVisibleTabIds();
      const candidate =
        this.state.closePolicy === 'keep-empty' ? undefined : this.pickMostRecentBackgroundTab(visibleNow);

      if (candidate) {
        this.state.paneBindings[freedPaneIdx] = candidate.id;
        this.state.focusedPaneIndex = freedPaneIdx;
        this.state.activeTabId = candidate.id;
        candidate.lastVisited = now;
      } else if (this.state.closePolicy === 'collapse') {
        // 无后台标签可补入，执行自动降级并紧凑重排可见窗格
        const survivingVisible: string[] = [];
        for (let i = 0; i < maxPanes; i++) {
          const id = this.state.paneBindings[i];
          if (this.isValidTabId(id) && !survivingVisible.includes(id)) {
            survivingVisible.push(id);
          }
        }
        for (const t of this.state.tabs) {
          if (!survivingVisible.includes(t.id)) {
            survivingVisible.push(t.id);
          }
        }

        this.state.paneBindings = [null, null, null, null];
        for (let i = 0; i < Math.min(4, survivingVisible.length); i++) {
          this.state.paneBindings[i] = survivingVisible[i];
        }

        if (this.state.tabs.length <= 1) {
          this.state.splitMode = 'single';
          this.state.focusedPaneIndex = 0;
        } else if (this.state.tabs.length === 2 && this.state.splitMode === 'grid-2x2') {
          this.state.splitMode = 'split-vertical';
          this.state.focusedPaneIndex = Math.min(this.state.focusedPaneIndex, 1);
        } else {
          this.state.focusedPaneIndex = Math.min(this.state.focusedPaneIndex, survivingVisible.length - 1);
        }

        this.state.activeTabId = this.fallbackActiveTabId() || this.state.tabs[0]?.id || null;
      } else {
        // backfill 无后台候选，或 keep-empty：保留该空槽并将焦点定位于此，方便下次直接补入
        this.state.focusedPaneIndex = freedPaneIdx;
        if (this.state.activeTabId === tabId) {
          this.state.activeTabId = this.fallbackActiveTabId();
        }
      }
    } else {
      // 关闭的是未展示的后台标签
      if (this.state.activeTabId === tabId) {
        this.state.activeTabId = this.fallbackActiveTabId();
      }
    }

    this.syncActiveFlags();
    return true;
  }

  /**
   * 切换分屏布局模式并智能去重补全
   */
  public setSplitMode(mode: SplitLayoutMode): void {
    this.state.splitMode = mode;
    const maxPanes = this.getMaxPanes(mode);

    if (mode === 'single') {
      const keepId =
        (this.isValidTabId(this.state.paneBindings[this.state.focusedPaneIndex])
          ? this.state.paneBindings[this.state.focusedPaneIndex]
          : null) ||
        (this.isValidTabId(this.state.activeTabId) ? this.state.activeTabId : null) ||
        this.fallbackActiveTabId() ||
        this.state.tabs[0]?.id ||
        null;

      this.state.paneBindings[0] = keepId;
      this.state.focusedPaneIndex = 0;
      this.state.activeTabId = keepId;
      this.syncActiveFlags();
      return;
    }

    const assigned = new Set<string>();
    for (let i = 0; i < maxPanes; i++) {
      const curr = this.state.paneBindings[i];
      if (this.isValidTabId(curr) && !assigned.has(curr)) {
        assigned.add(curr);
      } else {
        this.state.paneBindings[i] = null;
      }
    }

    // 确保 activeTabId 至少出现在某可见窗格内
    if (this.isValidTabId(this.state.activeTabId) && !assigned.has(this.state.activeTabId)) {
      const targetSlot = this.state.paneBindings[0] === null ? 0 : Math.min(this.state.focusedPaneIndex, maxPanes - 1);
      if (this.state.paneBindings[targetSlot]) {
        assigned.delete(this.state.paneBindings[targetSlot]!);
      }
      this.state.paneBindings[targetSlot] = this.state.activeTabId;
      assigned.add(this.state.activeTabId);
    }

    // 其余空位用后台最近标签补齐，绝不重复绑定同一实体
    for (let i = 0; i < maxPanes; i++) {
      if (this.state.paneBindings[i] === null) {
        const available = this.pickMostRecentBackgroundTab(assigned);
        if (available) {
          this.state.paneBindings[i] = available.id;
          assigned.add(available.id);
        }
      }
    }

    if (this.state.focusedPaneIndex >= maxPanes) {
      this.state.focusedPaneIndex = 0;
    }
    this.state.activeTabId = this.fallbackActiveTabId();
    this.syncActiveFlags();
  }

  /**
   * 以对照分屏模式打开草稿自由画布
   */
  public openCanvasSplit(
    data: {
      colSlug: string;
      bookSlug: string;
      chapterSlug: string;
      title?: string;
      url: string;
    },
    now = Date.now()
  ): TabItem {
    const entityId = `canvas:${data.colSlug}-${data.bookSlug}-${data.chapterSlug}`;
    let tab = this.state.tabs.find((t) => t.entityId === entityId);
    if (!tab) {
      tab = {
        id: this.generateTabId(now),
        entityId,
        kind: 'canvas',
        title: data.title || `${data.chapterSlug} · 画布`,
        url: data.url,
        active: false,
        lastVisited: now,
      };
      this.state.tabs.push(tab);
    } else {
      tab.url = data.url;
      tab.lastVisited = now;
    }

    if (this.state.splitMode === 'single') {
      this.state.splitMode = 'split-vertical';
    }

    const bookEntityId = `book:${data.colSlug}-${data.bookSlug}`;
    const bookTab = this.state.tabs.find((t) => t.entityId === bookEntityId);
    if (bookTab && this.findFirstVisiblePaneOfTab(bookTab.id) === -1) {
      this.state.paneBindings[0] = bookTab.id;
    }

    const existingCanvasPane = this.findFirstVisiblePaneOfTab(tab.id);
    if (existingCanvasPane !== -1) {
      this.state.focusedPaneIndex = existingCanvasPane;
    } else {
      const targetPane = this.state.paneBindings[0] === tab.id ? 0 : 1;
      this.state.paneBindings[targetPane] = tab.id;
      this.state.focusedPaneIndex = targetPane;
    }

    this.state.activeTabId = tab.id;
    this.syncActiveFlags();
    return { ...tab };
  }
}
