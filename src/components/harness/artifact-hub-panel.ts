/**
 * src/components/harness/artifact-hub-panel.ts
 * ============================================================================
 * 多态成果物历史仓面板 (Polymorphic Artifact Hub Panel)
 * ============================================================================
 * 职责：
 * 1. 在右侧分屏「成果物」视图统一托管所有类型的成果历史：
 *    PDF2ABP 任务、AstroCanvas 交互画布、章节 AST、Python 运算与图像、Diff 比对；
 * 2. 提供「历史清单 <-> 单项详览」自由导航与类型过滤，彻底根治 AST 覆盖锁死 PDF2ABP 问题；
 * 3. 在呈现 AST / Markdown 成果时自动触发 KaTeX 公式渲染与交互按钮绑定。
 * ============================================================================
 */

import type { ArtifactItem, ArtifactKind } from '../../features/harness/types.ts';
import {
  ArtifactStore,
  type ArtifactFilterKind,
  type ArtifactStoreState,
} from '../../features/harness/artifact-store.ts';
import { mountCanvasWorkspace } from '../../features/harness/canvas-sandbox.ts';
import type { Pdf2AbpStore } from './pdf2abp/pdf2abp-store.ts';
import { Pdf2AbpArtifactsPanel } from './pdf2abp/pdf2abp-artifacts-panel.ts';

function esc(str: unknown): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

const KIND_META: Record<ArtifactKind, { label: string; icon: string }> = {
  pdf2abp: { label: 'PDF2ABP', icon: 'menu_book' },
  canvas: { label: '画布', icon: 'code_blocks' },
  ast: { label: 'AST', icon: 'account_tree' },
  python: { label: 'Python', icon: 'terminal' },
  diff: { label: 'Diff', icon: 'difference' },
  markdown: { label: '文档', icon: 'description' },
};

const FILTER_TABS: Array<{ key: ArtifactFilterKind; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'pdf2abp', label: 'PDF2ABP' },
  { key: 'canvas', label: '画布' },
  { key: 'ast', label: 'AST' },
  { key: 'python', label: 'Python' },
  { key: 'diff', label: 'Diff' },
];

export class ArtifactHubPanel {
  private readonly artifactStore: ArtifactStore;
  private readonly pdf2abpStore: Pdf2AbpStore;
  private readonly pdf2abpPanel: Pdf2AbpArtifactsPanel;
  private readonly renderMath: (el: HTMLElement) => void | Promise<void>;
  private readonly onExecuteCommand: (cmd: string) => void | Promise<void>;

  private container: HTMLElement | null = null;
  private unsub: (() => void) | null = null;
  private lastRenderedKey = '';

  constructor(deps: {
    artifactStore: ArtifactStore;
    pdf2abpStore: Pdf2AbpStore;
    renderMath: (el: HTMLElement) => void | Promise<void>;
    onExecuteCommand: (cmd: string) => void | Promise<void>;
  }) {
    this.artifactStore = deps.artifactStore;
    this.pdf2abpStore = deps.pdf2abpStore;
    this.pdf2abpPanel = new Pdf2AbpArtifactsPanel(this.pdf2abpStore);
    this.renderMath = deps.renderMath;
    this.onExecuteCommand = deps.onExecuteCommand;
  }

  public mount(container: HTMLElement): void {
    if (this.container === container && this.unsub) return;
    this.unmount();
    this.container = container;
    this.unsub = this.artifactStore.subscribe((state) => {
      this.render(state);
    });
  }

  public unmount(): void {
    this.pdf2abpPanel.unmount();
    this.unsub?.();
    this.unsub = null;
    this.container = null;
    this.lastRenderedKey = '';
  }

  private render(state: ArtifactStoreState): void {
    if (!this.container) return;

    const active =
      state.viewMode === 'detail' && state.activeArtifactId
        ? state.items.find((i) => i.id === state.activeArtifactId)
        : undefined;

    if (active) {
      this.renderDetailView(active);
    } else {
      this.pdf2abpPanel.unmount();
      this.renderListView(state);
    }
  }

  private renderListView(state: ArtifactStoreState): void {
    if (!this.container) return;
    this.lastRenderedKey = '';

    const filtered = state.items.filter(
      (i) => state.filterKind === 'all' || i.kind === state.filterKind
    );

    const filterPillsHtml = FILTER_TABS.map((t) => {
      const count =
        t.key === 'all'
          ? state.items.length
          : state.items.filter((i) => i.kind === t.key).length;
      const activeCls = state.filterKind === t.key ? 'is-active' : '';
      return `<button type="button" class="artifact-filter-chip ${activeCls}" data-art-filter="${t.key}">${esc(t.label)} <span class="artifact-filter-count">${count}</span></button>`;
    }).join('');

    const cardsHtml =
      filtered.length > 0
        ? filtered
            .map((item) => {
              const meta = KIND_META[item.kind] || KIND_META.markdown;
              return `
                <div class="artifact-history-card" data-art-id="${esc(item.id)}">
                  <div class="artifact-history-card__icon">
                    <span class="material-symbols-outlined" aria-hidden="true">${meta.icon}</span>
                  </div>
                  <div class="artifact-history-card__main">
                    <div class="artifact-history-card__top">
                      <span class="artifact-history-card__title" title="${esc(item.title)}">${esc(item.title)}</span>
                      <span class="artifact-history-card__time">${formatTime(item.updatedAt)}</span>
                    </div>
                    <div class="artifact-history-card__meta">
                      <span class="artifact-kind-tag">${esc(meta.label)}</span>
                      ${item.badge ? `<span class="artifact-badge-text">${esc(item.badge)}</span>` : ''}
                    </div>
                  </div>
                  ${
                    item.kind !== 'pdf2abp'
                      ? `<button type="button" class="artifact-card-del" data-art-del="${esc(item.id)}" title="移除此成果记录" aria-label="移除">
                          <span class="material-symbols-outlined" aria-hidden="true">close</span>
                        </button>`
                      : ''
                  }
                </div>
              `;
            })
            .join('')
        : `
          <div class="harness-empty-state">
            <span class="material-symbols-outlined" style="font-size:34px;opacity:0.45;" aria-hidden="true">inventory_2</span>
            <p>暂无${state.filterKind === 'all' ? '' : KIND_META[state.filterKind].label}成果物记录</p>
            <span>Agent 生成的交互画布、章节 AST、Python 图像、Diff 比对或 /pdf2abp 任务将集中收纳于此</span>
          </div>
        `;

    this.container.innerHTML = `
      <div class="artifact-hub">
        <div class="artifact-hub__header">
          <div class="artifact-hub__title-row">
            <span class="artifact-hub__title">成果物历史仓</span>
            ${
              state.items.some((i) => i.kind !== 'pdf2abp')
                ? `<button type="button" class="artifact-clear-btn" id="artifact-clear-non-pdf">清空临时记录</button>`
                : ''
            }
          </div>
          <div class="artifact-hub__filters">${filterPillsHtml}</div>
        </div>
        <div class="artifact-hub__list">${cardsHtml}</div>
      </div>
    `;

    this.container.querySelectorAll<HTMLElement>('[data-art-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.artFilter as ArtifactFilterKind;
        if (key) this.artifactStore.setFilterKind(key);
      });
    });

    this.container.querySelector('#artifact-clear-non-pdf')?.addEventListener('click', () => {
      this.artifactStore.clearNonRunning();
    });

    this.container.querySelectorAll<HTMLElement>('.artifact-history-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        const delBtn = target.closest<HTMLElement>('[data-art-del]');
        if (delBtn) {
          e.stopPropagation();
          const delId = delBtn.dataset.artDel;
          if (delId) this.artifactStore.removeArtifact(delId);
          return;
        }
        const id = card.dataset.artId;
        if (id) {
          this.artifactStore.selectArtifact(id, true);
        }
      });
    });
  }

  private renderDetailView(item: ArtifactItem): void {
    if (!this.container) return;

    const renderKey = `${item.id}:${item.updatedAt}:${item.activeVersionIndex ?? 0}`;
    if (this.lastRenderedKey === renderKey && item.kind === 'pdf2abp') {
      return;
    }
    this.lastRenderedKey = renderKey;

    if (item.kind !== 'pdf2abp') {
      this.pdf2abpPanel.unmount();
    }

    const meta = KIND_META[item.kind] || KIND_META.markdown;
    this.container.innerHTML = `
      <div class="artifact-hub artifact-hub--detail">
        <div class="artifact-detail__topbar">
          <button type="button" class="artifact-back-btn" id="artifact-back-to-list" title="返回成果物列表">
            <span class="material-symbols-outlined" aria-hidden="true">arrow_back</span>
            <span>全部成果</span>
          </button>
          <div class="artifact-detail__meta">
            <span class="artifact-kind-tag">${esc(meta.label)}</span>
            <span class="artifact-detail__title" title="${esc(item.title)}">${esc(item.title)}</span>
          </div>
          <div class="artifact-detail__actions" id="artifact-detail-actions"></div>
        </div>
        <div class="artifact-detail__body" id="artifact-detail-body"></div>
      </div>
    `;

    this.container.querySelector('#artifact-back-to-list')?.addEventListener('click', () => {
      this.pdf2abpPanel.unmount();
      this.lastRenderedKey = '';
      this.artifactStore.showList();
    });

    const bodyEl = this.container.querySelector<HTMLElement>('#artifact-detail-body');
    const actionsEl = this.container.querySelector<HTMLElement>('#artifact-detail-actions');
    if (!bodyEl) return;

    if (item.kind === 'pdf2abp' && item.pdf2abpJobId) {
      bodyEl.classList.add('is-flush');
      void this.pdf2abpStore.selectJob(item.pdf2abpJobId);
      this.pdf2abpPanel.mount(bodyEl);
      return;
    }

    if (item.kind === 'canvas') {
      bodyEl.classList.add('is-flush');
      mountCanvasWorkspace(bodyEl, item, {
        onStepVersion: (id, delta) => this.artifactStore.stepCanvasVersion(id, delta),
      });
      return;
    }

    if (item.kind === 'diff') {
      void this.renderDiffBody(bodyEl, item.patch || '');
      return;
    }

    if (item.kind === 'python' && item.pythonResult) {
      this.renderPythonBody(bodyEl, item);
      return;
    }

    // AST / Markdown / General HTML
    if (actionsEl && item.html) {
      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'harness-card-btn';
      copyBtn.textContent = '复制内容';
      copyBtn.addEventListener('click', () => {
        navigator.clipboard?.writeText(bodyEl.innerText || '');
        copyBtn.textContent = '已复制';
        setTimeout(() => {
          copyBtn.textContent = '复制内容';
        }, 1400);
      });
      actionsEl.appendChild(copyBtn);
    }

    bodyEl.innerHTML = `<div class="artifact-html-content">${item.html || ''}</div>`;
    void this.renderMath(bodyEl);

    bodyEl.querySelectorAll<HTMLElement>('[data-cmd]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const cmd = el.dataset.cmd;
        if (cmd) void this.onExecuteCommand(cmd);
      });
    });

    bodyEl.querySelectorAll<HTMLElement>('.harness-toc-link').forEach((link) => {
      link.addEventListener('click', () => {
        const uri = link.dataset.uri;
        const slug = link.dataset.slug;
        const book = link.dataset.book;
        if (uri) void this.onExecuteCommand(`/ast ${uri}`);
        else if (slug) void this.onExecuteCommand(book ? `/ast ${book} ${slug}` : `/ast ${slug}`);
      });
    });
  }

  private async renderDiffBody(bodyEl: HTMLElement, patch: string): Promise<void> {
    if (!patch.trim()) {
      bodyEl.innerHTML = `<div class="harness-empty-state"><p>两章节内容完全一致或无差异</p></div>`;
      return;
    }
    try {
      const Diff2Html = await import('diff2html');
      const diffHtml = Diff2Html.html(patch, {
        outputFormat: 'line-by-line',
        drawFileList: true,
        matching: 'lines',
      });
      bodyEl.innerHTML = `<div class="harness-diff-container" style="padding:12px;">${diffHtml}</div>`;
    } catch {
      bodyEl.innerHTML = `<pre style="font-family:var(--harness-font-mono);font-size:0.78rem;padding:12px;overflow-x:auto;">${esc(patch)}</pre>`;
    }
  }

  private renderPythonBody(bodyEl: HTMLElement, item: ArtifactItem): void {
    const py = item.pythonResult!;
    const imagesHtml =
      py.images && py.images.length > 0
        ? `
          <div class="artifact-py-section">
            <div class="artifact-py-label">生成图像 (${py.images.length})</div>
            <div class="artifact-py-images">
              ${py.images
                .map(
                  (im) => `
                <figure class="artifact-py-figure">
                  <img src="${esc(im.url)}" alt="${esc(im.name)}" loading="lazy" />
                  <figcaption>${esc(im.name)}</figcaption>
                </figure>
              `
                )
                .join('')}
            </div>
          </div>
        `
        : '';

    bodyEl.innerHTML = `
      <div class="artifact-py-view">
        <div class="artifact-py-meta">
          <span>退出码: <strong>${py.exitCode}</strong></span>
          <span>耗时: <strong>${py.durationMs} ms</strong></span>
          ${py.scriptPath ? `<span>脚本: <code>${esc(py.scriptPath)}</code></span>` : ''}
        </div>
        ${imagesHtml}
        ${
          py.stdout
            ? `<div class="artifact-py-section"><div class="artifact-py-label">标准输出 (STDOUT)</div><pre class="artifact-py-pre">${esc(py.stdout)}</pre></div>`
            : ''
        }
        ${
          py.stderr
            ? `<div class="artifact-py-section"><div class="artifact-py-label is-err">标准错误 (STDERR)</div><pre class="artifact-py-pre is-err">${esc(py.stderr)}</pre></div>`
            : ''
        }
        ${
          item.code
            ? `<details class="artifact-py-code-details"><summary>查看执行源码</summary><pre class="artifact-py-pre">${esc(item.code)}</pre></details>`
            : ''
        }
      </div>
    `;
  }
}
