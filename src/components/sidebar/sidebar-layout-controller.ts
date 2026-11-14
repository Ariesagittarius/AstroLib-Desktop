/**
 * src/components/sidebar/sidebar-layout-controller.ts
 * ============================================================================
 * AstroLib 左侧栏布局与收纳控制器 (Left Sidebar Layout Controller)
 * ============================================================================
 * 核心职责：
 * 1. 作为左侧全书章节目录（Left Sidebar）展开/折叠状态的单一可信源；
 * 2. 负责桌面端 (>= 50rem) 与移动端 (< 50rem) 两种模式下的平滑切换与协同；
 * 3. 驱动 <html> 上的 dataset.sidebarLeftCollapsed 属性，与 CSS 变量协同；
 * 4. 管理 localStorage 持久化（键：astrolib_sidebar_left_collapsed）；
 * 5. 注册全局快捷键 Ctrl+B (或 macOS Cmd+B)，并派发标准事件 astrolib:sidebar-left-change。
 * ============================================================================
 */

import { registerSidebarLayoutController } from '../../features/sideload/contract';

export const SIDEBAR_LEFT_STORAGE_KEY = 'astrolib_sidebar_left_collapsed';

export interface SidebarLeftState {
  collapsed: boolean;
  isMobile: boolean;
  mobileExpanded: boolean;
}

class SidebarLayoutController {
  private collapsed = false;
  private isInitialized = false;
  private listeners = new Set<(state: SidebarLeftState) => void>();

  /**
   * 判断当前视口是否属于移动端 (< 50rem 即 800px)
   */
  public isMobileViewport(): boolean {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(max-width: 49.999rem)').matches;
  }

  /**
   * 初始化控制器并挂载事件监听
   */
  public init(): void {
    if (typeof window === 'undefined') return;

    // 1. 读取持久化偏好（桌面端生效）
    try {
      const stored = localStorage.getItem(SIDEBAR_LEFT_STORAGE_KEY);
      if (stored === 'true' && !this.isMobileViewport()) {
        this.collapsed = true;
      }
    } catch {}

    // 2. 同步状态至 DOM
    this.syncDom();

    if (this.isInitialized) return;
    this.isInitialized = true;

    // 3. 全局快捷键绑定：Ctrl+B / Cmd+B
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      // 避免在文本输入控件中误触
      const target = e.target as HTMLElement | null;
      if (target && (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'MD-OUTLINED-TEXT-FIELD' ||
        target.isContentEditable
      )) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        this.toggleLeftSidebar();
      }
    });

    // 4. 监听视口大小切换（如桌面拉到移动端，或移动端拉到桌面端）
    const mql = window.matchMedia('(max-width: 49.999rem)');
    mql.addEventListener('change', () => {
      this.syncDom();
    });

    // 5. 监听 body[data-mobile-menu-expanded] 属性变化（移动端互通）
    if (typeof MutationObserver !== 'undefined') {
      const observer = new MutationObserver(() => {
        this.notifyListeners();
      });
      observer.observe(document.body, {
        attributes: true,
        attributeFilter: ['data-mobile-menu-expanded'],
      });
    }
  }

  /**
   * 获取当前左侧栏是否在桌面端处于折叠收起状态
   */
  public isCollapsed(): boolean {
    return this.collapsed;
  }

  /**
   * 获取当前完整状态
   */
  public getState(): SidebarLeftState {
    const isMobile = this.isMobileViewport();
    const mobileExpanded = typeof document !== 'undefined'
      ? document.body.hasAttribute('data-mobile-menu-expanded')
      : false;

    return {
      collapsed: this.collapsed,
      isMobile,
      mobileExpanded,
    };
  }

  /**
   * 显式设置桌面端左侧栏收起状态
   */
  public setCollapsed(collapsed: boolean): void {
    this.collapsed = collapsed;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(SIDEBAR_LEFT_STORAGE_KEY, String(collapsed));
      }
    } catch {}
    this.syncDom();
  }

  /**
   * 切换左侧栏收起/展开：
   * - 桌面/平板端 (>= 50rem)：切换 collapsed 并在 localStorage 保存偏好
   * - 移动端 (< 50rem)：切换移动端侧滑抽屉 (data-mobile-menu-expanded)
   */
  public toggleLeftSidebar(): void {
    if (this.isMobileViewport()) {
      const starlightBtn = document.querySelector('starlight-menu-button button') as HTMLButtonElement | null;
      if (starlightBtn) {
        starlightBtn.click();
      } else {
        const isExpanded = document.body.hasAttribute('data-mobile-menu-expanded');
        document.body.toggleAttribute('data-mobile-menu-expanded', !isExpanded);
      }
      this.notifyListeners();
      return;
    }

    this.setCollapsed(!this.collapsed);
  }

  /**
   * 订阅状态变更
   */
  public subscribe(listener: (state: SidebarLeftState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * 同步状态至 DOM 与触发自定义事件
   */
  private syncDom(): void {
    if (typeof document === 'undefined') return;

    const root = document.documentElement;
    const isMobile = this.isMobileViewport();

    if (isMobile) {
      // 移动端重置桌面折叠标记，交给 mobile-menu-expanded 处理
      root.dataset.sidebarLeftCollapsed = 'false';
    } else {
      root.dataset.sidebarLeftCollapsed = this.collapsed ? 'true' : 'false';
    }

    this.notifyListeners();
  }

  private notifyListeners(): void {
    const state = this.getState();

    // 派发系统标准事件
    if (typeof window !== 'undefined') {
      const event = new CustomEvent('astrolib:sidebar-left-change', {
        detail: state,
      });
      window.dispatchEvent(event);
    }

    this.listeners.forEach((listener) => {
      try {
        listener(state);
      } catch (err) {
        console.error('[SidebarLayoutController] 监听器执行异常:', err);
      }
    });
  }
}

export const sidebarLayoutController = new SidebarLayoutController();
registerSidebarLayoutController(sidebarLayoutController);

if (typeof window !== 'undefined') {
  (window as any).__sidebarLayoutController = sidebarLayoutController;
}
