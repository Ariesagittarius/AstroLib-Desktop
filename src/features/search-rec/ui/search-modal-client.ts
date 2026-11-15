/**
 * src/features/search-rec/ui/search-modal-client.ts
 * AstroLib 跨书知识整合、多模态搜索与推荐模态框客户端状态机
 * 严格遵循学术克制规约，消除一切 Emoji 与视效噪点，对齐工业级前沿检索推荐标准
 */

import { SearchRecEngine } from '../core/engine.ts';
import type { AcademicChunk, CandidateItem } from '../types/candidate.ts';
import type { SearchMode } from '../types/search.ts';
import type { UserLearningContext } from '../types/recommendation.ts';

declare global {
  interface Window {
    __currentBookSlug?: string;
    __currentColSlug?: string;
    __currentChapterSlug?: string;
    __currentBookTitle?: string;
    __astrolibSearchEngine?: SearchRecEngine;
    __astrolibSearchLoaded?: boolean;
    __allBooksCatalog?: Array<{
      col: string;
      book: string;
      bookTitle: string;
      chapterSlug: string;
      chapterTitle: string;
      url: string;
    }>;
  }
}

export function initSearchModalClient(): void {
  if (typeof window === 'undefined') return;

  const dialog = document.getElementById('astrolib-search-dialog') as (HTMLDialogElement & { __astrolibSearchBound?: boolean }) | null;
  if (!dialog) return;

  // 防抖与重复绑定守卫 (兼容 Astro 页面切换与 SPA 路由)
  if (dialog.__astrolibSearchBound) return;
  dialog.__astrolibSearchBound = true;

  const dlg = dialog;
  const triggerBtn = document.getElementById('astrolib-search-trigger');
  const input = dlg.querySelector('#astrolib-search-input') as HTMLInputElement | null;
  const clearBtn = dlg.querySelector('#astrolib-search-clear') as HTMLElement | null;
  const closeBtn = dlg.querySelector('#astrolib-search-close') as HTMLElement | null;
  const resultsContainer = dlg.querySelector('#astrolib-search-results') as HTMLElement | null;
  const modeChipsContainer = dlg.querySelector('#astrolib-mode-chips') as HTMLElement | null;
  const modeHintEl = dlg.querySelector('#astrolib-match-mode-hint') as HTMLElement | null;
  const scopeChipsContainer = dlg.querySelector('#astrolib-scope-chips') as HTMLElement | null;
  const currentBookBtn = dlg.querySelector('#astrolib-scope-current-btn') as HTMLElement | null;
  const bookSelect = dlg.querySelector('#astrolib-book-select') as HTMLSelectElement | null;
  const matchCountEl = dlg.querySelector('#astrolib-match-count') as HTMLElement | null;

  if (!input || !resultsContainer) return;
  const inp = input;
  const resBox = resultsContainer;

  // 单例初始化核心引擎
  const engine = window.__astrolibSearchEngine || new SearchRecEngine();
  window.__astrolibSearchEngine = engine;

  let currentMode: SearchMode = 'neural';
  let currentScope: 'all' | 'current' | 'specific' = 'all';
  let specificBookSlug = '';
  let selectedIdx = -1;
  let currentResults: CandidateItem[] = [];

  // 获取当前阅读上下文
  function getCurrentContext(): UserLearningContext {
    const pathParts = window.location.pathname.replace(/^\/|\/$/g, '').split('/');
    let colSlug = window.__currentColSlug || '';
    let bookSlug = window.__currentBookSlug || '';
    let chapterSlug = window.__currentChapterSlug || '';

    if (!bookSlug && pathParts[0] === 'collections' && pathParts.length >= 3) {
      colSlug = pathParts[1];
      bookSlug = pathParts[2];
      chapterSlug = pathParts[3] || '';
    }

    return {
      currentColSlug: colSlug,
      currentBookSlug: bookSlug,
      currentChapterSlug: chapterSlug,
    };
  }

  // 更新当前图书按钮文案
  function syncCurrentBookBadge() {
    const ctx = getCurrentContext();
    if (currentBookBtn) {
      if (ctx.currentBookSlug) {
        const title = window.__currentBookTitle || ctx.currentBookSlug;
        currentBookBtn.textContent = `当前图书: 《${title}》`;
        currentBookBtn.style.display = 'inline-flex';
      } else {
        currentBookBtn.textContent = '当前图书';
      }
    }
  }

  let packsPromise: Promise<void> | null = null;
  let isPacksLoaded = false;

  // 动态填充图书下拉选择框
  function fillBookSelect(books: any[]) {
    if (bookSelect && bookSelect.options.length <= 1) {
      for (const b of books || []) {
        const opt = document.createElement('option');
        opt.value = b.slug;
        opt.textContent = b.title || b.slug;
        bookSelect.appendChild(opt);
      }
    }
  }

  // 渲染首次搜索索引准备骨架态 (严格学术极简，无装饰动效)
  function renderLoadingState() {
    resBox.innerHTML = `
      <div class="astrolib-search-loading-hint" style="padding: 2.5rem 1rem; text-align: center; color: var(--sl-color-gray-3, #888); font-size: 0.875rem;">
        <div style="font-weight: 500; color: var(--sl-color-text, #222); margin-bottom: 0.5rem;">正在准备全库索引</div>
        <div style="font-size: 0.75rem; opacity: 0.8;">首次加载约需数秒，完成后将自动呈现结果</div>
      </div>
    `;
    if (matchCountEl) {
      matchCountEl.textContent = '索引准备中...';
    }
  }

  // 渲染索引加载异常态并提供重试交互
  function renderErrorState() {
    resBox.innerHTML = `
      <div class="astrolib-search-error-hint" style="padding: 2.5rem 1rem; text-align: center; color: var(--sl-color-gray-3, #888); font-size: 0.875rem;">
        <div style="font-weight: 500; color: var(--sl-color-text, #222); margin-bottom: 0.5rem;">索引加载失败</div>
        <div style="font-size: 0.75rem; opacity: 0.8; margin-bottom: 1rem;">请检查本地数据包或网络服务完整性</div>
        <button type="button" id="astrolib-search-retry-btn" class="astrolib-scope-chip is-active" style="cursor: pointer; padding: 0.35rem 1rem; border-radius: 9999px;">重试加载</button>
      </div>
    `;
    if (matchCountEl) {
      matchCountEl.textContent = '加载失败';
    }
    const retryBtn = resBox.querySelector('#astrolib-search-retry-btn');
    retryBtn?.addEventListener('click', async (e) => {
      e.preventDefault();
      packsPromise = null;
      renderLoadingState();
      try {
        await ensurePacksLoaded();
        if (!inp.value.trim()) {
          renderContextStream();
        } else {
          executeSearch();
        }
      } catch {
        renderErrorState();
      }
    });
  }

  // 异步按需加载全书库切片索引与向量 (Promise 单例管理)
  function ensurePacksLoaded(): Promise<void> {
    if (window.__astrolibSearchLoaded) {
      isPacksLoaded = true;
      return Promise.resolve();
    }
    if (isPacksLoaded) {
      return Promise.resolve();
    }
    if (!packsPromise) {
      packsPromise = loadAllPacks().catch((e) => {
        console.warn('[search-rec] 索引加载失败，允许重试:', e);
        packsPromise = null;
        throw e;
      });
    }
    return packsPromise;
  }

  interface BookPackPayload {
    chunks: AcademicChunk[];
    binBuffer?: ArrayBuffer;
  }

  async function runWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    fn: (item: T, index: number) => Promise<R>,
  ): Promise<R[]> {
    const results = new Array<R>(items.length);
    let cur = 0;
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (cur < items.length) {
        const idx = cur++;
        results[idx] = await fn(items[idx], idx);
      }
    });
    await Promise.all(workers);
    return results;
  }

  async function loadAllPacks() {
    try {
      const catRes = await fetch('/abp-packs/catalog.json');
      if (!catRes.ok) {
        throw new Error(`catalog response: ${catRes.status}`);
      }

      const cat = await catRes.json();
      const books: Array<{ colSlug: string; slug: string; title?: string }> = cat.books || [];
      fillBookSelect(books);

      const slots = new Array<BookPackPayload | null>(books.length);
      let next = 0;

      function flush() {
        while (next < books.length && slots[next] !== undefined) {
          const pack = slots[next];
          if (pack && pack.chunks.length > 0) {
            engine.registerBook(pack.chunks, pack.binBuffer);
          }
          slots[next] = null; // 及时释放已注册包引用，避免常驻推高加载期峰值
          next++;
        }
      }

      // 抓取并行度 4，完成后写入 slots[i] 并按 catalog 顺序流式注册
      await runWithConcurrency(books, 4, async (b, i) => {
        slots[i] = await fetchBookPack(b.colSlug, b.slug, b.title);
        flush();
      });

      engine.finalize();
      isPacksLoaded = true;
    } catch (err) {
      loadFallbackChunksFromCatalog();
      // 不在此处置位 isPacksLoaded，保留错误重试入口与正确错误态
      throw err;
    }
  }

  async function fetchBookPack(
    colSlug: string,
    bookSlug: string,
    bookTitle?: string,
  ): Promise<BookPackPayload | null> {
    try {
      const metaRes = await fetch(`/abp-packs/${colSlug}-${bookSlug}/embeddings.meta.json`);
      if (metaRes.ok) {
        const meta = await metaRes.json();
        const binRes = await fetch(`/abp-packs/${colSlug}-${bookSlug}/embeddings.bin`);
        const binBuffer = binRes.ok ? await binRes.arrayBuffer() : undefined;

        const chunks: AcademicChunk[] = (meta.chunks || []).map((c: any) => ({
          id: c.id,
          bookId: `${colSlug}-${bookSlug}`,
          colSlug,
          bookSlug,
          bookTitle: meta.title || bookTitle || bookSlug,
          chapterSlug: c.chapterSlug,
          chapterTitle: c.chapterTitle || c.chapterSlug,
          kind: 'card',
          type: c.type || '正文',
          title: c.title || c.cleanTitle || c.chapterTitle || '学术知识点',
          number: c.number || '',
          text: c.text || '',
          anchor: c.anchor || '',
          url: `/collections/${colSlug}/${bookSlug}/${c.chapterSlug}/#${encodeURIComponent(c.anchor || '')}`,
        }));

        return { chunks, binBuffer };
      }
    } catch {}

    // 兜底回退：若该书未打包预编译向量或离线，从书籍 manifest.json 中读取完整章节目录
    try {
      const manifestRes = await fetch(`/abp-packs/${colSlug}-${bookSlug}/manifest.json`);
      if (manifestRes.ok) {
        const manifest = await manifestRes.json();
        const fallbackChunks: AcademicChunk[] = [];
        for (const sec of manifest.sections || []) {
          for (const ch of sec.chapters || []) {
            fallbackChunks.push({
              id: `${bookSlug}-${ch.slug}`,
              bookId: `${colSlug}-${bookSlug}`,
              colSlug,
              bookSlug,
              bookTitle: manifest.title || bookTitle || bookSlug,
              chapterSlug: ch.slug,
              chapterTitle: ch.title || ch.slug,
              kind: 'heading',
              type: '章节',
              title: ch.title || ch.slug,
              number: '',
              text: `${manifest.title || bookSlug} ${sec.title || ''} ${ch.title || ''}`,
              anchor: '',
              url: `/collections/${colSlug}/${bookSlug}/${ch.slug}/`,
            });
          }
        }
        if (fallbackChunks.length > 0) {
          return { chunks: fallbackChunks };
        }
      }
    } catch {}

    return null;
  }

  // 兜底：若网络受限或离线，从全局章节目录构建基础知识单元
  function loadFallbackChunksFromCatalog() {
    const catalog = window.__allBooksCatalog || [];
    if (catalog.length === 0) return;

    const fallbackChunks: AcademicChunk[] = catalog.map((item) => ({
      id: `${item.book}-${item.chapterSlug}`,
      bookId: `${item.col}-${item.book}`,
      colSlug: item.col,
      bookSlug: item.book,
      bookTitle: item.bookTitle,
      chapterSlug: item.chapterSlug,
      chapterTitle: item.chapterTitle,
      kind: 'heading',
      type: '章节',
      title: item.chapterTitle,
      text: `${item.bookTitle} · ${item.chapterTitle}`,
      url: item.url,
    }));

    engine.registerBook(fallbackChunks);
    if (!inp.value.trim() && dlg.open) {
      renderContextStream();
    }
  }

  // 渲染首屏：即时上下文探索流 (Context-Aware Discovery Stream)
  function renderContextStream() {
    const ctx = getCurrentContext();
    const rawItems = engine.getContextDiscoveryStream(ctx, 12);

    // 根据当前范围过滤
    let items = rawItems;
    if (currentScope === 'current' && ctx.currentBookSlug) {
      items = items.filter((it) => it.chunk.bookSlug === ctx.currentBookSlug);
    } else if (currentScope === 'specific' && specificBookSlug) {
      items = items.filter((it) => it.chunk.bookSlug === specificBookSlug);
    }

    currentResults = items;
    selectedIdx = -1;

    let sectionTitle = '全书库知识发现与推荐';
    if (ctx.currentBookSlug) {
      const bTitle = window.__currentBookTitle || ctx.currentBookSlug;
      sectionTitle = `当前图书《${bTitle}》阅读上下文延伸`;
    }

    renderCards(items, sectionTitle, '');
    if (matchCountEl) {
      matchCountEl.textContent = `推荐 ${items.length} 个核心知识节点`;
    }
  }

  // 高亮检索词辅助函数 (转义正则特殊字符，避免异常)
  function highlightKeywords(text: string, queryStr: string): string {
    if (!queryStr || !text) return text;
    const terms = queryStr.toLowerCase().split(/\s+/).filter(Boolean);
    let result = text;
    for (const term of terms) {
      const escaped = term.split('').map((c) => ('-[]{}()*+?.,\\^$|#'.indexOf(c) >= 0 ? `\\${c}` : c)).join('');
      try {
        result = result.replace(new RegExp(`(${escaped})`, 'gi'), '<mark>$1</mark>');
      } catch {}
    }
    return result;
  }

  // 渲染卡片流 (严格遵循极端减法原则：纯净学术片段)
  function renderCards(items: CandidateItem[], headerTitle: string, queryHighlight: string) {
    if (items.length === 0) {
      resBox.innerHTML = `
        <div class="astrolib-search-empty-hint">
          <div>未检索到符合条件的知识切片</div>
          <div style="font-size: 0.75rem; opacity: 0.75;">建议切换为 [模糊检索] 或精简公式与关键词</div>
        </div>
      `;
      return;
    }

    const html = `
      <div class="astrolib-search-section-title">
        <span>${headerTitle}</span>
        <span style="font-size: 0.6875rem; font-weight: normal; opacity: 0.75;">共 ${items.length} 条</span>
      </div>
      ${items
        .map((item, idx) => {
          const c = item.chunk;
          const typeBadge = c.type ? `<span class="astrolib-card-type-chip">${c.type}</span>` : '';
          const reasonBadge = item.recommendReason ? `<span class="astrolib-card-reason">${item.recommendReason}</span>` : '';
          const highlightedTitle = highlightKeywords(c.title || c.chapterTitle, queryHighlight);
          const snippetText = c.text && c.text !== c.title ? highlightKeywords(c.text, queryHighlight) : '';

          return `
            <a href="${c.url}" class="astrolib-search-card ${idx === selectedIdx ? 'is-selected' : ''}" data-index="${idx}">
              <div class="astrolib-card-meta">
                <span class="astrolib-card-book">《${c.bookTitle}》</span>
                <span>/</span>
                <span>${c.chapterTitle}</span>
                ${typeBadge}
                ${reasonBadge}
              </div>
              <div class="astrolib-card-title">${highlightedTitle}</div>
              ${snippetText ? `<div class="astrolib-card-snippet">${snippetText}</div>` : ''}
            </a>
          `;
        })
        .join('')}
    `;

    resBox.innerHTML = html;
  }

  // 执行搜索
  async function executeSearch() {
    const q = inp.value.trim();
    if (clearBtn) {
      clearBtn.style.display = q ? 'flex' : 'none';
    }

    if (!isPacksLoaded && !window.__astrolibSearchLoaded) {
      // 索引包仍在后台按需加载中，不执行空检索，避免覆盖骨架加载态
      return;
    }

    if (!q) {
      renderContextStream();
      return;
    }

    const ctx = getCurrentContext();
    const searchRes = await engine.search({
      raw: q,
      mode: currentMode,
      contextBookSlug: ctx.currentBookSlug,
      contextChapterSlug: ctx.currentChapterSlug,
      contextColSlug: ctx.currentColSlug,
      topK: 30,
    });

    // 根据当前范围过滤
    let filteredItems = searchRes.items;
    if (currentScope === 'current' && ctx.currentBookSlug) {
      filteredItems = filteredItems.filter((it) => it.chunk.bookSlug === ctx.currentBookSlug);
    } else if (currentScope === 'specific' && specificBookSlug) {
      filteredItems = filteredItems.filter((it) => it.chunk.bookSlug === specificBookSlug);
    }

    currentResults = filteredItems;
    selectedIdx = filteredItems.length > 0 ? 0 : -1;

    renderCards(filteredItems, `检索结果 (耗时 ${searchRes.timeMs}ms)`, q);
    if (matchCountEl) {
      matchCountEl.textContent = `找到 ${filteredItems.length} 条切片`;
    }
  }

  async function openModal() {
    syncCurrentBookBadge();
    try {
      dlg.showModal();
    } catch {
      dlg.setAttribute('open', '');
    }
    inp.focus();
    inp.select();

    if (!isPacksLoaded && !window.__astrolibSearchLoaded) {
      renderLoadingState();
      try {
        await ensurePacksLoaded();
      } catch {
        renderErrorState();
        return;
      }
    }

    if (!inp.value.trim()) {
      renderContextStream();
    } else {
      executeSearch();
    }
  }

  function closeModal() {
    try {
      dlg.close();
    } catch {
      dlg.removeAttribute('open');
    }
  }

  // 1. 触发与关闭事件绑定
  triggerBtn?.removeAttribute('disabled');
  triggerBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    openModal();
  });

  closeBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    closeModal();
  });

  clearBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    inp.value = '';
    inp.focus();
    executeSearch();
  });

  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) closeModal();
  });

  // 2. 搜索输入即时响应
  inp.addEventListener('input', () => {
    executeSearch();
  });

  // 3. 范围选择 Filter Chips 交互
  if (scopeChipsContainer) {
    const scopeButtons = Array.from(scopeChipsContainer.querySelectorAll('.astrolib-scope-chip'));
    scopeButtons.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        scopeButtons.forEach((b) => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        currentScope = (btn.getAttribute('data-scope') as any) || 'all';
        if (bookSelect) bookSelect.value = '';
        executeSearch();
      });
    });
  }

  if (bookSelect) {
    bookSelect.addEventListener('change', () => {
      if (bookSelect.value) {
        if (scopeChipsContainer) {
          scopeChipsContainer.querySelectorAll('.astrolib-scope-chip').forEach((b) => b.classList.remove('is-active'));
        }
        currentScope = 'specific';
        specificBookSlug = bookSelect.value;
      } else {
        currentScope = 'all';
        const allBtn = scopeChipsContainer?.querySelector('[data-scope="all"]');
        allBtn?.classList.add('is-active');
      }
      executeSearch();
    });
  }

  // 4. 三模态切换 Filter Chips 交互 (纯文本，严禁 Emoji)
  if (modeChipsContainer) {
    const modeButtons = Array.from(modeChipsContainer.querySelectorAll('.astrolib-mode-chip'));
    modeButtons.forEach((chip) => {
      chip.addEventListener('click', (e) => {
        e.preventDefault();
        modeButtons.forEach((c) => c.classList.remove('is-active'));
        chip.classList.add('is-active');
        currentMode = (chip.getAttribute('data-mode') as SearchMode) || 'neural';

        if (modeHintEl) {
          if (currentMode === 'neural') modeHintEl.textContent = '语义向量与多任务召回';
          else if (currentMode === 'exact') modeHintEl.textContent = 'LaTeX 与编号精准匹配';
          else if (currentMode === 'fuzzy') modeHintEl.textContent = 'BM25 词法检索';
        }

        executeSearch();
      });
    });
  }

  // 5. 全局键盘快捷键: Ctrl+K / Cmd+K / Slash / Escape / Arrow navigation
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      if (dlg.open) closeModal();
      else openModal();
    } else if (e.key === 'Escape' && dlg.open) {
      closeModal();
    } else if (e.key === '/' && !dlg.open && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
      e.preventDefault();
      openModal();
    } else if (dlg.open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      if (currentResults.length === 0) return;
      if (e.key === 'ArrowDown') {
        selectedIdx = (selectedIdx + 1) % currentResults.length;
      } else {
        selectedIdx = (selectedIdx - 1 + currentResults.length) % currentResults.length;
      }
      const cards = Array.from(resBox.querySelectorAll('.astrolib-search-card'));
      cards.forEach((c, idx) => {
        if (idx === selectedIdx) {
          c.classList.add('is-selected');
          c.scrollIntoView({ block: 'nearest' });
        } else {
          c.classList.remove('is-selected');
        }
      });
    } else if (dlg.open && e.key === 'Enter' && selectedIdx >= 0 && currentResults[selectedIdx]) {
      e.preventDefault();
      const targetCard = resBox.querySelector(`.astrolib-search-card[data-index="${selectedIdx}"]`) as HTMLAnchorElement | null;
      if (targetCard) {
        targetCard.click();
      } else {
        window.location.href = currentResults[selectedIdx].chunk.url;
      }
    }
  });

  // 6. 兜底捕获页面所有其他搜索触发器
  document.querySelectorAll('button[data-open-modal], .vp-search-wrapper button, [data-open-search]').forEach((btn) => {
    btn.removeAttribute('disabled');
    if (btn !== triggerBtn) {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        openModal();
      });
    }
  });

  // 运行模式灰度开关：'lazy' (默认，按需打开模态框时加载) | 'eager' (回滚用：初始化即预载全站索引)
  const searchIndexMode = (typeof window !== 'undefined' && (window as any).__astrolibSearchIndexMode) || 'lazy';
  if (searchIndexMode === 'eager') {
    ensurePacksLoaded().catch(() => {});
  }
}
