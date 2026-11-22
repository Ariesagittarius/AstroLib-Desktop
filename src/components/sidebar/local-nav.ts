declare global {
  interface Window {
    __vpLocalNavClickHandler?: ((e: MouseEvent) => void) | null;
    __mobileTocKeyHandler?: ((e: KeyboardEvent) => void) | null;
    __mobileTocWheelLock?: ((e: WheelEvent) => void) | null;
    __mobileTocTouchLock?: ((e: TouchEvent) => void) | null;
  }
}

function attachBackdropScrollLock(): void {
  if (!window.__mobileTocWheelLock) {
    window.__mobileTocWheelLock = (e: WheelEvent) => {
      if (!document.body.classList.contains('mobile-toc-open')) return;
      const outline = (e.target as HTMLElement | null)?.closest('.vp-local-nav-outline') as HTMLElement | null;
      if (!outline) {
        e.preventDefault();
        return;
      }
      const atTop = outline.scrollTop <= 0 && e.deltaY < 0;
      const atBottom = outline.scrollTop + outline.clientHeight >= outline.scrollHeight - 1 && e.deltaY > 0;
      if (outline.scrollHeight <= outline.clientHeight || atTop || atBottom) {
        e.preventDefault();
      }
    };
    document.addEventListener('wheel', window.__mobileTocWheelLock, { passive: false });
  }
  if (!window.__mobileTocTouchLock) {
    window.__mobileTocTouchLock = (e: TouchEvent) => {
      if (!document.body.classList.contains('mobile-toc-open')) return;
      const outline = (e.target as HTMLElement | null)?.closest('.vp-local-nav-outline') as HTMLElement | null;
      if (!outline || outline.scrollHeight <= outline.clientHeight) {
        e.preventDefault();
      }
    };
    document.addEventListener('touchmove', window.__mobileTocTouchLock, { passive: false });
  }
}

function detachBackdropScrollLock(): void {
  if (window.__mobileTocWheelLock) {
    document.removeEventListener('wheel', window.__mobileTocWheelLock);
    window.__mobileTocWheelLock = null;
  }
  if (window.__mobileTocTouchLock) {
    document.removeEventListener('touchmove', window.__mobileTocTouchLock);
    window.__mobileTocTouchLock = null;
  }
}

/**
 * 移动端大纲 popup 开关（以 <body> 上的 .mobile-toc-open 类为唯一状态源）
 * 注意：绝不通过 body { overflow: hidden } 锁滚动，以免触发 scrollbar-gutter 重排；改用非侵入式事件拦截防穿透。
 */
export function setMobileTocOpen(open: boolean): void {
  document.body.classList.toggle('mobile-toc-open', open);
  if (open) {
    attachBackdropScrollLock();
  } else {
    detachBackdropScrollLock();
  }
  const nav = document.querySelector('.vp-local-nav');
  if (!nav) return;
  const btn = nav.querySelector('.vp-local-nav-btn');
  const items = nav.querySelector('.vp-local-nav-items');
  if (btn) btn.setAttribute('aria-expanded', String(open));
  if (items) items.setAttribute('aria-hidden', String(!open));
  if (open && items) {
    const outline = items.querySelector('.vp-local-nav-outline') as HTMLElement | null;
    const activeLink = items.querySelector('.toc-link.active') as HTMLElement | null;
    if (outline && activeLink) {
      const linkTop = activeLink.offsetTop;
      const linkBottom = linkTop + activeLink.offsetHeight;
      if (linkTop < outline.scrollTop) {
        outline.scrollTop = Math.max(0, linkTop - 8);
      } else if (linkBottom > outline.scrollTop + outline.clientHeight) {
        outline.scrollTop = Math.max(0, linkBottom - outline.clientHeight + 8);
      }
    }
  }
}

/**
 * 移动端本地导航 VPLocalNav 装配
 */
export function setupVPLocalNav(): void {
  const header = document.querySelector('.header');
  const rightGroup = header?.querySelector('.right-group');

  // 若页面主体重新渲染了未挂载的大纲节点，则清理旧的已挂载节点
  const freshNav = document.querySelector('.vp-local-nav:not(.vp-local-nav-teleported)') as HTMLElement | null;
  if (freshNav) {
    document.querySelectorAll('.vp-local-nav.vp-local-nav-teleported').forEach((n) => n.remove());
  }

  let nav = document.querySelector('.vp-local-nav') as HTMLElement | null;
  if (!nav) return;

  if (!nav.classList.contains('vp-local-nav-teleported')) {
    nav.classList.add('vp-local-nav-teleported');
    if (rightGroup) {
      if (rightGroup.firstElementChild !== nav) rightGroup.prepend(nav);
    } else if (header && header.lastElementChild !== nav) {
      header.append(nav);
    }
  }
  document.body.classList.add('vp-local-nav-active');

  const btn = nav.querySelector('.vp-local-nav-btn') as HTMLButtonElement | null;
  const items = nav.querySelector('.vp-local-nav-items') as HTMLElement | null;
  if (!btn || !items) return;

  if (btn.dataset.bound === 'true') return;
  btn.dataset.bound = 'true';

  const navHeight = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sl-nav-height')) || 40;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const vh = window.innerHeight + Math.min(window.scrollY - navHeight, 0);
    nav?.style.setProperty('--vp-vh', vh + 'px');
    setMobileTocOpen(!document.body.classList.contains('mobile-toc-open'));
  });

  items.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (!target.closest('a') && !target.closest('button')) {
      e.stopPropagation();
    }
  });

  if (!window.__vpLocalNavClickHandler) {
    window.__vpLocalNavClickHandler = (e: MouseEvent) => {
      if (!document.body.classList.contains('mobile-toc-open')) return;
      const currentNav = document.querySelector('.vp-local-nav');
      if (!currentNav || !currentNav.contains(e.target as Node)) {
        setMobileTocOpen(false);
      }
    };
    document.addEventListener('click', window.__vpLocalNavClickHandler);
  }

  if (!window.__mobileTocKeyHandler) {
    window.__mobileTocKeyHandler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !document.body.classList.contains('mobile-toc-open')) return;
      setMobileTocOpen(false);
      const navBtn = document.querySelector('.vp-local-nav-btn') as HTMLElement | null;
      navBtn?.focus();
    };
    document.addEventListener('keydown', window.__mobileTocKeyHandler);
  }

  nav.querySelector('.vp-local-nav-top-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    setMobileTocOpen(false);
    window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
  });

  nav.querySelector('[data-close-mobile-toc]')?.addEventListener('click', (e) => {
    e.preventDefault();
    setMobileTocOpen(false);
  });

  nav.querySelectorAll('[data-exercise-trigger], [data-chapter-export-trigger]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setMobileTocOpen(false);
    });
  });
}
