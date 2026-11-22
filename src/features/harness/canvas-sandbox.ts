/**
 * src/features/harness/canvas-sandbox.ts
 * ============================================================================
 * Track B: AstroCanvas 独立交互画布沙箱引擎
 * ============================================================================
 * 职责：
 * 1. 构建严格隔离的 <iframe sandbox="allow-scripts allow-downloads"> 运行环境；
 * 2. 自动注入当前 AstroLib Material You 动态主题变量、亮暗模式与本地 KaTeX CSS；
 * 3. 提供正文内联卡片（「在成果物打开」+「内联展开」带版面提示）与成果物宽屏工作台
 *    （预览/源码切换、版本撤销/重做、导出单文件 HTML、全屏预览）。
 * ============================================================================
 */

import { ArtifactStore } from './artifact-store.ts';
import type { ArtifactItem, CanvasTelemetrySnapshot } from './types.ts';

function esc(str: unknown): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const CANVAS_THEME_VAR_NAMES = [
  '--md-sys-color-primary',
  '--md-sys-color-on-primary',
  '--md-sys-color-primary-container',
  '--md-sys-color-on-primary-container',
  '--md-sys-color-secondary',
  '--md-sys-color-on-secondary',
  '--md-sys-color-secondary-container',
  '--md-sys-color-on-secondary-container',
  '--md-sys-color-tertiary',
  '--md-sys-color-surface',
  '--md-sys-color-surface-container-lowest',
  '--md-sys-color-surface-container-low',
  '--md-sys-color-surface-container',
  '--md-sys-color-surface-container-high',
  '--md-sys-color-surface-container-highest',
  '--md-sys-color-on-surface',
  '--md-sys-color-on-surface-variant',
  '--md-sys-color-outline',
  '--md-sys-color-outline-variant',
  '--md-sys-color-error',
  '--md-sys-color-error-container',
  '--md-sys-color-on-error-container',
  '--harness-font-family',
  '--harness-font-mono',
  '--sl-font',
  '--sl-font-mono',
];

let telemetryListenerBound = false;

export function ensureCanvasTelemetryListener(): void {
  if (telemetryListenerBound || typeof window === 'undefined') return;
  telemetryListenerBound = true;
  window.addEventListener('message', (ev) => {
    const data = ev.data;
    if (!data || data.type !== 'ASTROLIB_CANVAS_TELEMETRY') return;
    const artifactId = typeof data.artifactId === 'string' ? data.artifactId.trim() : '';
    const t = data.telemetry;
    if (!artifactId || !t || typeof t !== 'object') return;

    const snapshot: CanvasTelemetrySnapshot = {
      updatedAt: Date.now(),
      consoleErrors: Array.isArray(t.consoleErrors) ? t.consoleErrors.slice(0, 20).map(String) : [],
      runtimeExceptions: Array.isArray(t.runtimeExceptions) ? t.runtimeExceptions.slice(0, 20).map(String) : [],
      overflowX: Boolean(t.overflowX),
      overflowY: Boolean(t.overflowY),
      katexLoaded: Boolean(t.katexLoaded),
      katexNodeCount: Number(t.katexNodeCount) || 0,
      katexErrorCount: Number(t.katexErrorCount) || 0,
      bodyTextLength: Number(t.bodyTextLength) || 0,
      cssVarCount: Number(t.cssVarCount) || 0,
      cspActive: true,
      viewportWidth: Number(t.viewportWidth) || 0,
      viewportHeight: Number(t.viewportHeight) || 0,
    };

    try {
      ArtifactStore.getInstance().updateCanvasTelemetry(artifactId, snapshot);
    } catch {}
  });
}

export function captureCurrentThemeSnapshot(): {
  theme: 'light' | 'dark';
  varsCss: string;
  varsMap: Record<string, string>;
  origin: string;
} {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return { theme: 'light', varsCss: '', varsMap: {}, origin: '' };
  }
  const theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  const cs = getComputedStyle(document.documentElement);
  const varsMap: Record<string, string> = {};
  const lines: string[] = [];
  for (const name of CANVAS_THEME_VAR_NAMES) {
    const val = cs.getPropertyValue(name).trim();
    if (val) {
      varsMap[name] = val;
      lines.push(`  ${name}: ${val};`);
    }
  }
  return {
    theme,
    varsCss: `:root {\n${lines.join('\n')}\n  color-scheme: ${theme};\n}`,
    varsMap,
    origin: window.location.origin || '',
  };
}

export interface BuildCanvasHtmlOptions {
  artifactId?: string;
  baseOrigin?: string;
  injectTelemetry?: boolean;
}

export function buildSandboxedCanvasHtml(
  rawCode: string,
  title = 'AstroCanvas',
  options: BuildCanvasHtmlOptions = {}
): string {
  const snap = captureCurrentThemeSnapshot();
  const origin = (options.baseOrigin ?? snap.origin ?? '').replace(/\/+$/, '');
  const artifactId = options.artifactId || '';
  const assetPrefix = origin ? `${origin}/api/v1/content/annotations` : '/api/v1/content/annotations';
  const katexCssHref = `${assetPrefix}/katex.css`;
  const katexJsHref = `${assetPrefix}/katex.min.js`;
  const katexMhchemHref = `${assetPrefix}/katex-mhchem.min.js`;
  const katexAutoRenderHref = `${assetPrefix}/katex-auto-render.min.js`;
  const cspOrigin = origin || "'self'";

  const cspContent = [
    "default-src 'none'",
    `script-src 'unsafe-inline' 'unsafe-eval' ${cspOrigin} blob:`,
    `style-src 'unsafe-inline' ${cspOrigin}`,
    `font-src ${cspOrigin} data:`,
    `img-src ${cspOrigin} data: blob:`,
    "connect-src 'none'",
    'worker-src blob:',
  ].join('; ');

  const defaultSans =
    "'Source Han Sans SC', 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', system-ui, -apple-system, sans-serif";
  const defaultMono =
    "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace";

  const baseHead = `
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="${cspContent.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}" />
    <title>${esc(title)}</title>
    <link rel="stylesheet" href="${esc(katexCssHref)}" />
    <style id="astrolib-canvas-theme-tokens">
      ${snap.varsCss}
      :root {
        --astrolib-canvas-sans: var(--harness-font-family, var(--sl-font, ${defaultSans}));
        --astrolib-canvas-mono: var(--harness-font-mono, var(--sl-font-mono, ${defaultMono}));
      }
      *, *::before, *::after { box-sizing: border-box; }
      html, body {
        margin: 0;
        padding: 0;
        min-height: 100%;
        background-color: var(--md-sys-color-surface, ${snap.theme === 'dark' ? '#131316' : '#ffffff'});
        color: var(--md-sys-color-on-surface, ${snap.theme === 'dark' ? '#e3e3e3' : '#1f1f1f'});
        font-family: var(--astrolib-canvas-sans);
        line-height: 1.55;
      }
      code, pre, kbd, samp {
        font-family: var(--astrolib-canvas-mono);
      }
      body { padding: 16px; }
    </style>
    <script src="${esc(katexJsHref)}"></script>
    <script src="${esc(katexMhchemHref)}"></script>
    <script src="${esc(katexAutoRenderHref)}"></script>
    <script>
      (function () {
        var __artId = ${JSON.stringify(artifactId)};
        var __consoleErrors = [];
        var __runtimeExceptions = [];
        var __origConsoleError = console.error;
        console.error = function () {
          try {
            var msg = Array.prototype.slice.call(arguments).map(function (a) {
              return typeof a === 'string' ? a : (a && a.message ? a.message : String(a));
            }).join(' ');
            if (__consoleErrors.length < 20) __consoleErrors.push(msg.slice(0, 300));
          } catch (_) {}
          return __origConsoleError.apply(console, arguments);
        };
        window.addEventListener('error', function (ev) {
          if (__runtimeExceptions.length < 20) {
            __runtimeExceptions.push(String(ev.message || ev.error || 'Script error').slice(0, 300));
          }
        });
        window.addEventListener('unhandledrejection', function (ev) {
          if (__runtimeExceptions.length < 20) {
            __runtimeExceptions.push(String(ev.reason || 'Unhandled promise rejection').slice(0, 300));
          }
        });

        window.__ASTROLIB_CANVAS__ = {
          artifactId: __artId,
          cspActive: true,
          katexExtensions: ['mhchem', 'auto-render']
        };

        window.renderCanvasMath = function (rootEl) {
          if (typeof window.renderMathInElement !== 'function') return;
          try {
            window.renderMathInElement(rootEl || document.body, {
              delimiters: [
                { left: '$$', right: '$$', display: true },
                { left: '$', right: '$', display: false },
                { left: '\\\\(', right: '\\\\)', display: false },
                { left: '\\\\[', right: '\\\\]', display: true }
              ],
              throwOnError: false,
              strict: false
            });
          } catch (e) {
            if (__runtimeExceptions.length < 20) {
              __runtimeExceptions.push('KaTeX auto-render: ' + String(e && e.message || e));
            }
          }
        };

        window.__collectAstrolibCanvasTelemetry = function () {
          var docEl = document.documentElement;
          var varCount = 0;
          try {
            var cs = getComputedStyle(docEl);
            for (var i = 0; i < cs.length; i++) {
              if (cs[i].indexOf('--md-sys-') === 0 || cs[i].indexOf('--harness-') === 0) varCount++;
            }
          } catch (_) {}
          return {
            consoleErrors: __consoleErrors.slice(),
            runtimeExceptions: __runtimeExceptions.slice(),
            overflowX: docEl.scrollWidth > window.innerWidth + 2,
            overflowY: docEl.scrollHeight > window.innerHeight + 2,
            katexLoaded: typeof window.katex !== 'undefined',
            katexNodeCount: document.querySelectorAll('.katex').length,
            katexErrorCount: document.querySelectorAll('.katex-error').length,
            bodyTextLength: document.body ? (document.body.innerText || '').trim().length : 0,
            cssVarCount: varCount,
            cspActive: true,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight
          };
        };

        function postTelemetry() {
          if (!__artId || window.parent === window) return;
          try {
            window.parent.postMessage({
              type: 'ASTROLIB_CANVAS_TELEMETRY',
              artifactId: __artId,
              telemetry: window.__collectAstrolibCanvasTelemetry()
            }, '*');
          } catch (_) {}
        }

        document.addEventListener('DOMContentLoaded', function () {
          window.renderCanvasMath(document.body);
          setTimeout(postTelemetry, 120);
        });
        window.addEventListener('load', function () {
          window.renderCanvasMath(document.body);
          setTimeout(postTelemetry, 250);
        });
        window.addEventListener('message', function (ev) {
          if (!ev.data) return;
          if (ev.data.type === 'ASTROLIB_CANVAS_THEME_SYNC') {
            document.documentElement.dataset.theme = ev.data.theme || 'light';
            document.documentElement.style.colorScheme = ev.data.theme || 'light';
            var vars = ev.data.varsMap || {};
            Object.keys(vars).forEach(function (k) {
              document.documentElement.style.setProperty(k, vars[k]);
            });
          } else if (ev.data.type === 'ASTROLIB_CANVAS_PING') {
            postTelemetry();
          }
        });
      })();
    </script>
  `;

  const trimmed = (rawCode || '').trim();
  if (/^<!doctype\s+html/i.test(trimmed) || /^<html[\s>]/i.test(trimmed)) {
    if (/<head[\s>]/i.test(trimmed)) {
      return trimmed.replace(/<head([\s>]*)>/i, `<head$1>${baseHead}`);
    }
    return trimmed.replace(/<html([^>]*)>/i, `<html$1><head>${baseHead}</head>`);
  }

  if (/^<svg[\s>]/i.test(trimmed)) {
    return `<!doctype html>
<html lang="zh-CN" data-theme="${snap.theme}">
  <head>${baseHead}
    <style>
      body { display: flex; align-items: center; justify-content: center; min-height: 100vh; }
      svg { max-width: 100%; height: auto; }
    </style>
  </head>
  <body>${trimmed}</body>
</html>`;
  }

  return `<!doctype html>
<html lang="zh-CN" data-theme="${snap.theme}">
  <head>${baseHead}</head>
  <body>${trimmed}</body>
</html>`;
}

export function renderInlineCanvasCardHtml(opts: {
  artifactId: string;
  title: string;
  mode?: string;
  timestamp?: number;
}): string {
  const timeText = opts.timestamp
    ? new Date(opts.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : '刚刚';
  const modeLabel = opts.mode === 'svg' ? '矢量绘图' : opts.mode === 'html' ? '排版视图' : '交互画布';

  return `
    <div class="astro-canvas-card" data-canvas-card="${esc(opts.artifactId)}">
      <div class="astro-canvas-card__header">
        <div class="astro-canvas-card__meta">
          <div class="astro-canvas-card__icon" aria-hidden="true">
            <span class="material-symbols-outlined">code_blocks</span>
          </div>
          <div class="astro-canvas-card__titles">
            <div class="astro-canvas-card__title">${esc(opts.title)}</div>
            <div class="astro-canvas-card__sub">${esc(modeLabel)} · ${esc(timeText)}</div>
          </div>
        </div>
        <div class="astro-canvas-card__actions">
          <button type="button" class="astro-canvas-btn astro-canvas-btn--tonal" data-canvas-action="toggle-inline" data-artifact-id="${esc(opts.artifactId)}">
            <span class="material-symbols-outlined" aria-hidden="true">unfold_more</span>
            <span>内联展开</span>
          </button>
          <button type="button" class="astro-canvas-btn astro-canvas-btn--filled" data-canvas-action="open-hub" data-artifact-id="${esc(opts.artifactId)}">
            <span>在成果物打开</span>
          </button>
        </div>
      </div>
      <div class="astro-canvas-inline-drawer" hidden>
        <div class="astro-canvas-inline-notice">
          <span class="material-symbols-outlined" aria-hidden="true">info</span>
          <span>正文内联沙箱预览 · 受对话流宽度限制，部分复杂布局可能产生横向滚动；推荐在右侧「成果物」宽屏视图中体验完整交互。</span>
          <button type="button" class="astro-canvas-inline-collapse" data-canvas-action="collapse-inline">收起</button>
        </div>
        <div class="astro-canvas-iframe-stage"></div>
      </div>
    </div>
  `.trim();
}

export function createSandboxedCanvasIframe(
  code: string,
  title: string,
  artifactId?: string
): HTMLIFrameElement {
  ensureCanvasTelemetryListener();
  const iframe = document.createElement('iframe');
  iframe.className = 'astro-canvas-iframe';
  iframe.setAttribute('sandbox', 'allow-scripts allow-downloads');
  iframe.setAttribute('referrerpolicy', 'no-referrer');
  iframe.setAttribute('title', title);
  iframe.srcdoc = buildSandboxedCanvasHtml(code, title, { artifactId });
  return iframe;
}

export function syncAllCanvasIframeThemes(root: Document | HTMLElement = document): void {
  const snap = captureCurrentThemeSnapshot();
  root.querySelectorAll<HTMLIFrameElement>('iframe.astro-canvas-iframe').forEach((ifr) => {
    try {
      ifr.contentWindow?.postMessage(
        {
          type: 'ASTROLIB_CANVAS_THEME_SYNC',
          theme: snap.theme,
          varsMap: snap.varsMap,
        },
        '*'
      );
    } catch {}
  });
}

export function bindInlineCanvasCards(
  root: HTMLElement,
  deps: {
    getArtifact: (id: string) => ArtifactItem | undefined;
    onOpenInArtifacts: (id: string) => void;
  }
): void {
  if (!root) return;

  root.querySelectorAll<HTMLElement>('.astro-canvas-card').forEach((card) => {
    if (card.dataset.boundCanvas === 'true') return;
    card.dataset.boundCanvas = 'true';

    const artifactId = card.dataset.canvasCard || '';
    const openBtn = card.querySelector<HTMLElement>('[data-canvas-action="open-hub"]');
    const toggleBtn = card.querySelector<HTMLElement>('[data-canvas-action="toggle-inline"]');
    const collapseBtn = card.querySelector<HTMLElement>('[data-canvas-action="collapse-inline"]');
    const drawer = card.querySelector<HTMLElement>('.astro-canvas-inline-drawer');
    const stage = card.querySelector<HTMLElement>('.astro-canvas-iframe-stage');

    openBtn?.addEventListener('click', () => {
      deps.onOpenInArtifacts(artifactId);
    });

    const setExpanded = (expand: boolean) => {
      if (!drawer || !stage) return;
      if (expand) {
        const art = deps.getArtifact(artifactId);
        if (!art || !art.code) {
          stage.innerHTML = `<div class="astro-canvas-missing">未在当前本地历史仓中找到该画布内容（可能已被清理），请重新生成。</div>`;
        } else {
          stage.innerHTML = '';
          stage.appendChild(createSandboxedCanvasIframe(art.code, art.title, art.id));
        }
        drawer.removeAttribute('hidden');
        card.classList.add('is-inline-expanded');
        if (toggleBtn) {
          const span = toggleBtn.querySelector('span:last-child');
          const ic = toggleBtn.querySelector('.material-symbols-outlined');
          if (span) span.textContent = '收起内联';
          if (ic) ic.textContent = 'unfold_less';
        }
      } else {
        drawer.setAttribute('hidden', '');
        stage.innerHTML = '';
        card.classList.remove('is-inline-expanded');
        if (toggleBtn) {
          const span = toggleBtn.querySelector('span:last-child');
          const ic = toggleBtn.querySelector('.material-symbols-outlined');
          if (span) span.textContent = '内联展开';
          if (ic) ic.textContent = 'unfold_more';
        }
      }
    };

    toggleBtn?.addEventListener('click', () => {
      const isOpen = card.classList.contains('is-inline-expanded');
      setExpanded(!isOpen);
    });

    collapseBtn?.addEventListener('click', () => setExpanded(false));
  });
}

export function mountCanvasWorkspace(
  container: HTMLElement,
  artifact: ArtifactItem,
  deps: {
    onStepVersion: (artifactId: string, delta: -1 | 1) => ArtifactItem | undefined;
  }
): void {
  const versions = artifact.versions || [];
  const activeIdx = artifact.activeVersionIndex ?? Math.max(0, versions.length - 1);
  const canUndo = versions.length > 1 && activeIdx > 0;
  const canRedo = versions.length > 1 && activeIdx < versions.length - 1;
  let currentMode: 'preview' | 'source' = 'preview';

  container.innerHTML = `
    <div class="astro-canvas-workspace">
      <div class="astro-canvas-workspace__bar">
        <div class="astro-canvas-workspace__info">
          <span class="astro-canvas-workspace__title">${esc(artifact.title)}</span>
          <span class="astro-canvas-workspace__ver">${esc(artifact.badge || 'Canvas')}</span>
        </div>
        <div class="astro-canvas-workspace__controls">
          ${
            versions.length > 1
              ? `
            <button type="button" class="astro-canvas-tool-btn" data-ws-action="undo" ${canUndo ? '' : 'disabled'} title="上一版本">
              <span class="material-symbols-outlined">undo</span>
            </button>
            <button type="button" class="astro-canvas-tool-btn" data-ws-action="redo" ${canRedo ? '' : 'disabled'} title="下一版本">
              <span class="material-symbols-outlined">redo</span>
            </button>
          `
              : ''
          }
          <div class="astro-canvas-seg" role="tablist">
            <button type="button" class="astro-canvas-seg__btn is-active" data-ws-mode="preview">预览</button>
            <button type="button" class="astro-canvas-seg__btn" data-ws-mode="source">源码</button>
          </div>
          <button type="button" class="astro-canvas-tool-btn" data-ws-action="export" title="导出为独立 HTML 文件">
            <span class="material-symbols-outlined">download</span>
          </button>
          <button type="button" class="astro-canvas-tool-btn" data-ws-action="fullscreen" title="宽屏预览">
            <span class="material-symbols-outlined">open_in_full</span>
          </button>
        </div>
      </div>
      <div class="astro-canvas-workspace__stage" id="astro-canvas-ws-stage"></div>
    </div>
  `;

  const stage = container.querySelector<HTMLElement>('#astro-canvas-ws-stage');
  const renderStage = () => {
    if (!stage) return;
    if (currentMode === 'preview') {
      stage.innerHTML = '';
      stage.appendChild(createSandboxedCanvasIframe(artifact.code || '', artifact.title, artifact.id));
    } else {
      stage.innerHTML = `<pre class="astro-canvas-source-view"><code>${esc(artifact.code || '')}</code></pre>`;
    }
  };
  renderStage();

  container.querySelectorAll<HTMLElement>('[data-ws-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const m = btn.dataset.wsMode as 'preview' | 'source';
      if (!m || m === currentMode) return;
      currentMode = m;
      container.querySelectorAll('[data-ws-mode]').forEach((b) => {
        b.classList.toggle('is-active', b === btn);
      });
      renderStage();
    });
  });

  container.querySelector('[data-ws-action="undo"]')?.addEventListener('click', () => {
    const next = deps.onStepVersion(artifact.id, -1);
    if (next) mountCanvasWorkspace(container, next, deps);
  });

  container.querySelector('[data-ws-action="redo"]')?.addEventListener('click', () => {
    const next = deps.onStepVersion(artifact.id, 1);
    if (next) mountCanvasWorkspace(container, next, deps);
  });

  container.querySelector('[data-ws-action="export"]')?.addEventListener('click', () => {
    const fullHtml = buildSandboxedCanvasHtml(artifact.code || '', artifact.title);
    const blob = new Blob([fullHtml], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(artifact.title || 'canvas').replace(/[\\/:*?"<>|]/g, '_')}.html`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  container.querySelector('[data-ws-action="fullscreen"]')?.addEventListener('click', () => {
    let modal = document.getElementById('astro-canvas-fullscreen-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'astro-canvas-fullscreen-modal';
      modal.className = 'astro-canvas-fullscreen-modal';
      document.body.appendChild(modal);
    }
    modal.innerHTML = `
      <div class="astro-canvas-fullscreen-dialog">
        <div class="astro-canvas-workspace__bar">
          <div class="astro-canvas-workspace__info">
            <span class="astro-canvas-workspace__title">${esc(artifact.title)}</span>
            <span class="astro-canvas-workspace__ver">${esc(artifact.badge || 'Canvas')}</span>
          </div>
          <button type="button" class="astro-canvas-tool-btn" id="astro-canvas-fs-close" title="关闭 (Esc)">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
        <div class="astro-canvas-fullscreen-body"></div>
      </div>
    `;
    const body = modal.querySelector('.astro-canvas-fullscreen-body') as HTMLElement;
    body.appendChild(createSandboxedCanvasIframe(artifact.code || '', artifact.title));
    modal.style.display = 'flex';

    const close = () => {
      if (modal) modal.style.display = 'none';
      window.removeEventListener('keydown', onEsc);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onEsc);
    modal.querySelector('#astro-canvas-fs-close')?.addEventListener('click', close);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) close();
    });
  });
}
