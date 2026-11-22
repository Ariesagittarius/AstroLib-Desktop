/**
 * src/features/harness/astro-blocks.ts
 * ============================================================================
 * Track A: AstroBlocks 声明式学术富排版引擎 (```astro-ui 协议编译器)
 * ============================================================================
 * 职责：
 * 1. 解析并严格校验 AI 输出的 ```astro-ui 声明式 JSON 块；
 * 2. 将结构化语义原语 (card / metrics / steps / checklist / compare / tabs / callout / grid)
 *    渲染为严格遵循 Material Design 3 Expressive 与 AstroLib 学术克制规范的 DOM；
 * 3. 支持可控字体 (sans / serif / mono)、主题语义色 (neutral / primary / secondary / tertiary / success / warning)
 *    与排版密度 (comfortable / compact)，完全适配亮暗双色主题；
 * 4. 流式生成未闭合时输出优雅骨架占位，杜绝裸 JSON 闪烁与 XSS 注入。
 * ============================================================================
 */

export type AstroBlockFont = 'sans' | 'serif' | 'mono';
export type AstroBlockTone =
  | 'neutral'
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'success'
  | 'warning';
export type AstroBlockDensity = 'comfortable' | 'compact';

export interface AstroBlockStyle {
  font?: AstroBlockFont;
  tone?: AstroBlockTone;
  density?: AstroBlockDensity;
}

export type InlineFormatter = (text: string) => string;

function esc(str: unknown): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function defaultInlineFormatter(raw: string): string {
  let s = esc(raw);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  return s;
}

function unescapeInputFromMarkdown(raw: string): string {
  return (raw || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function normalizeStyleClasses(obj: AstroBlockStyle | undefined, extra = ''): string {
  const font =
    obj?.font === 'serif' || obj?.font === 'mono' || obj?.font === 'sans' ? obj.font : 'sans';
  const tone =
    obj?.tone === 'primary' ||
    obj?.tone === 'secondary' ||
    obj?.tone === 'tertiary' ||
    obj?.tone === 'success' ||
    obj?.tone === 'warning'
      ? obj.tone
      : 'neutral';
  const density = obj?.density === 'compact' ? 'compact' : 'comfortable';
  return `astro-ui-font-${font} astro-ui-tone-${tone} astro-ui-density-${density} ${extra}`.trim();
}

function repairControlCharsInJsonStrings(src: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (!inString) {
      if (ch === '"') inString = true;
      out += ch;
      continue;
    }
    if (escaped) {
      escaped = false;
      out += ch;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      out += ch;
      continue;
    }
    if (ch === '"') {
      inString = false;
      out += ch;
      continue;
    }
    if (ch === '\n') {
      out += '\\n';
      continue;
    }
    if (ch === '\r') {
      out += '\\r';
      continue;
    }
    if (ch === '\t') {
      out += '\\t';
      continue;
    }
    out += ch;
  }
  return out;
}

function tryParseAstroUiJson(rawJson: string): any | null {
  const clean = unescapeInputFromMarkdown(rawJson).replace(/^\uFEFF/, '').trim();
  if (!clean) return null;

  const candidates = [
    clean,
    clean.replace(/,\s*([}\]])/g, '$1'),
    repairControlCharsInJsonStrings(clean).replace(/,\s*([}\]])/g, '$1'),
  ];

  // 容错提取最外层 {...} 或 [...]，防止模型在 JSON 后附带多余说明字符
  const firstBrace = clean.search(/[{[]/);
  const lastBrace = Math.max(clean.lastIndexOf('}'), clean.lastIndexOf(']'));
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const sliced = clean.slice(firstBrace, lastBrace + 1);
    candidates.push(
      repairControlCharsInJsonStrings(sliced).replace(/,\s*([}\]])/g, '$1')
    );
  }

  for (const cand of candidates) {
    try {
      return JSON.parse(cand);
    } catch {}
  }
  return null;
}

function renderCardBlock(block: any, fmt: InlineFormatter): string {
  const cls = normalizeStyleClasses(block, 'astro-ui-card');
  const badgeHtml = block.badge
    ? `<span class="astro-ui-badge">${esc(block.badge)}</span>`
    : '';
  const eyebrowHtml = block.eyebrow
    ? `<div class="astro-ui-eyebrow">${fmt(String(block.eyebrow))}</div>`
    : '';
  const titleHtml = block.title
    ? `<h4 class="astro-ui-card__title">${fmt(String(block.title))}</h4>`
    : '';
  const subtitleHtml = block.subtitle
    ? `<div class="astro-ui-card__subtitle">${fmt(String(block.subtitle))}</div>`
    : '';
  const bodyHtml = block.body
    ? `<div class="astro-ui-card__body">${fmt(String(block.body))}</div>`
    : '';
  const bulletsHtml =
    Array.isArray(block.bullets) && block.bullets.length > 0
      ? `<div class="astro-ui-card__bullets">
          ${block.bulletsLabel ? `<div class="astro-ui-sublabel">${fmt(String(block.bulletsLabel))}</div>` : ''}
          <ul>${block.bullets.map((b: any) => `<li>${fmt(String(b))}</li>`).join('')}</ul>
        </div>`
      : '';
  const actionsHtml =
    Array.isArray(block.actions) && block.actions.length > 0
      ? `<div class="astro-ui-card__actions">
          ${block.actions
            .map((act: any) => {
              if (act.command) {
                return `<button type="button" class="harness-action-chip" data-cmd="${esc(act.command)}">${esc(act.label || act.command)}</button>`;
              }
              if (act.uri) {
                return `<a href="${esc(act.uri)}" data-astrolib-uri="${esc(act.uri)}" class="astrolib-node-link harness-action-chip" target="_self">${esc(act.label || act.uri)}</a>`;
              }
              return '';
            })
            .join('')}
        </div>`
      : '';

  return `
    <section class="${cls}">
      ${badgeHtml}
      ${eyebrowHtml}
      ${titleHtml}
      ${subtitleHtml}
      ${bodyHtml || bulletsHtml ? `<div class="astro-ui-divider"></div>` : ''}
      ${bodyHtml}
      ${bulletsHtml}
      ${actionsHtml}
    </section>
  `.trim();
}

function renderMetricGroupSection(sec: any, fmt: InlineFormatter): string {
  const items = Array.isArray(sec.items) ? sec.items : [];
  const titleHtml = sec.title
    ? `<div class="astro-ui-metrics__heading">${fmt(String(sec.title))}</div>`
    : '';
  const subHtml = sec.subtitle
    ? `<div class="astro-ui-metrics__sub">${fmt(String(sec.subtitle))}</div>`
    : '';
  const gridHtml =
    items.length > 0
      ? `<div class="astro-ui-metrics__grid">
          ${items
            .map((it: any) => {
              const tone =
                it.tone === 'primary' ||
                it.tone === 'secondary' ||
                it.tone === 'tertiary' ||
                it.tone === 'success' ||
                it.tone === 'warning'
                  ? it.tone
                  : 'neutral';
              return `
                <div class="astro-ui-metric-cell astro-ui-tone-${tone}">
                  <div class="astro-ui-metric-val">${esc(it.value ?? '--')}</div>
                  <div class="astro-ui-metric-label">${fmt(String(it.label ?? ''))}</div>
                  ${it.note ? `<div class="astro-ui-metric-note">${fmt(String(it.note))}</div>` : ''}
                </div>
              `;
            })
            .join('')}
        </div>`
      : '';
  const sourceHtml = sec.source
    ? `<div class="astro-ui-meta-line"><span>来源：</span>${fmt(String(sec.source))}</div>`
    : '';
  const meaningHtml = sec.meaning
    ? `<div class="astro-ui-meta-line astro-ui-meta-line--strong"><span>意义：</span>${fmt(String(sec.meaning))}</div>`
    : '';
  const linksHtml =
    Array.isArray(sec.links) && sec.links.length > 0
      ? `<div class="astro-ui-links-row">
          ${sec.links
            .map((lk: any) => {
              const href = lk.uri || lk.url || '';
              if (!href) return '';
              const isUri = href.startsWith('astrolib://');
              return `<a href="${esc(href)}" ${isUri ? `data-astrolib-uri="${esc(href)}" class="astrolib-node-link astro-ui-ext-link" target="_self"` : `class="astro-ui-ext-link" target="_blank" rel="noopener"`}>${esc(lk.label || href)} ↗</a>`;
            })
            .join('')}
        </div>`
      : '';

  return `<div class="astro-ui-metrics-section">${titleHtml}${subHtml}${gridHtml}${sourceHtml}${meaningHtml}${linksHtml}</div>`;
}

function renderMetricsBlock(block: any, fmt: InlineFormatter): string {
  const cls = normalizeStyleClasses(block, 'astro-ui-metrics-card');
  const sections = Array.isArray(block.sections) ? block.sections : [block];
  const inner = sections.map((sec: any) => renderMetricGroupSection(sec, fmt)).join('');
  return `<section class="${cls}">${inner}</section>`;
}

function renderStepsBlock(block: any, fmt: InlineFormatter): string {
  const cls = normalizeStyleClasses(block, 'astro-ui-steps');
  const items = Array.isArray(block.items) ? block.items : [];
  const titleHtml = block.title
    ? `<div class="astro-ui-block-title">${fmt(String(block.title))}</div>`
    : '';
  const rows = items
    .map((it: any, idx: number) => {
      const num = it.step ?? idx + 1;
      return `
        <li class="astro-ui-step-item">
          <div class="astro-ui-step-rail">
            <span class="astro-ui-step-badge">${esc(num)}</span>
            <span class="astro-ui-step-line" aria-hidden="true"></span>
          </div>
          <div class="astro-ui-step-content">
            <div class="astro-ui-step-title">${fmt(String(it.title ?? `步骤 ${num}`))}</div>
            ${it.caption ? `<div class="astro-ui-step-caption">${fmt(String(it.caption))}</div>` : ''}
            ${it.body ? `<div class="astro-ui-step-body">${fmt(String(it.body))}</div>` : ''}
          </div>
        </li>
      `;
    })
    .join('');

  return `<section class="${cls}">${titleHtml}<ol class="astro-ui-step-list">${rows}</ol></section>`;
}

function renderChecklistBlock(block: any, fmt: InlineFormatter, uid: string): string {
  const cls = normalizeStyleClasses(block, 'astro-ui-checklist');
  const groups = Array.isArray(block.groups)
    ? block.groups
    : Array.isArray(block.items)
      ? [{ id: 'default', label: block.groupLabel || '清单', items: block.items }]
      : [];

  const titleHtml = block.title
    ? `<div class="astro-ui-block-title">${fmt(String(block.title))}</div>`
    : '';

  const tabsHtml =
    groups.length > 1
      ? `<div class="astro-ui-chip-tabs" role="tablist">
          ${groups
            .map(
              (g: any, idx: number) =>
                `<button type="button" role="tab" class="astro-ui-chip-tab ${idx === 0 ? 'is-active' : ''}" data-astro-tab-target="${esc(uid)}-${idx}" aria-selected="${idx === 0 ? 'true' : 'false'}">${esc(g.label || `分组 ${idx + 1}`)}</button>`
            )
            .join('')}
        </div>`
      : '';

  const panelsHtml = groups
    .map((g: any, gIdx: number) => {
      const items = Array.isArray(g.items) ? g.items : [];
      const rows = items
        .map((it: any, iIdx: number) => {
          const itemId = String(it.id || `${uid}-g${gIdx}-i${iIdx}`);
          const checked = Boolean(it.checked);
          return `
            <button type="button" class="astro-ui-check-item ${checked ? 'is-checked' : ''}" data-check-id="${esc(itemId)}" role="checkbox" aria-checked="${checked ? 'true' : 'false'}">
              <span class="material-symbols-outlined astro-ui-check-icon" aria-hidden="true">${checked ? 'check_box' : 'check_box_outline_blank'}</span>
              <span class="astro-ui-check-text">${fmt(String(it.text || it.label || ''))}</span>
            </button>
          `;
        })
        .join('');
      return `<div class="astro-ui-check-group ${gIdx === 0 ? 'is-active' : ''}" data-astro-tab-panel="${esc(uid)}-${gIdx}" ${gIdx === 0 ? '' : 'hidden'}>${rows}</div>`;
    })
    .join('');

  return `<section class="${cls}" data-astro-checklist="${esc(uid)}">${titleHtml}${tabsHtml}${panelsHtml}</section>`;
}

function renderCompareBlock(block: any, fmt: InlineFormatter): string {
  const cls = normalizeStyleClasses(block, 'astro-ui-compare');
  const cols = Array.isArray(block.columns) ? block.columns : [];
  const titleHtml = block.title
    ? `<div class="astro-ui-block-title">${fmt(String(block.title))}</div>`
    : '';
  const colHtml = cols
    .map((col: any) => {
      const colCls = normalizeStyleClasses(col, 'astro-ui-compare-col');
      const itemsHtml =
        Array.isArray(col.items) && col.items.length > 0
          ? `<ul class="astro-ui-compare-list">${col.items.map((x: any) => `<li>${fmt(String(x))}</li>`).join('')}</ul>`
          : '';
      return `
        <div class="${colCls}">
          <div class="astro-ui-compare-col__head">
            <span class="astro-ui-compare-col__title">${fmt(String(col.title || ''))}</span>
            ${col.badge ? `<span class="astro-ui-badge">${esc(col.badge)}</span>` : ''}
          </div>
          ${col.body ? `<div class="astro-ui-compare-col__body">${fmt(String(col.body))}</div>` : ''}
          ${itemsHtml}
        </div>
      `;
    })
    .join('');
  return `<section class="${cls}">${titleHtml}<div class="astro-ui-compare-grid" style="--astro-cols:${Math.min(3, Math.max(1, cols.length))};">${colHtml}</div></section>`;
}

function renderTabsBlock(block: any, fmt: InlineFormatter, uid: string, depth: number): string {
  const cls = normalizeStyleClasses(block, 'astro-ui-tabs');
  const items = Array.isArray(block.items) ? block.items : [];
  if (items.length === 0) return '';

  const tabsHtml = `<div class="astro-ui-chip-tabs" role="tablist">
    ${items
      .map(
        (it: any, idx: number) =>
          `<button type="button" role="tab" class="astro-ui-chip-tab ${idx === 0 ? 'is-active' : ''}" data-astro-tab-target="${esc(uid)}-t-${idx}" aria-selected="${idx === 0 ? 'true' : 'false'}">${esc(it.label || `视图 ${idx + 1}`)}</button>`
      )
      .join('')}
  </div>`;

  const panelsHtml = items
    .map((it: any, idx: number) => {
      const childBlocks = Array.isArray(it.blocks)
        ? it.blocks.map((b: any, bi: number) => renderSingleBlock(b, fmt, `${uid}-t${idx}-${bi}`, depth + 1)).join('')
        : '';
      const body = it.body ? `<div class="astro-ui-tabs-body">${fmt(String(it.body))}</div>` : '';
      const title = it.title ? `<div class="astro-ui-block-title">${fmt(String(it.title))}</div>` : '';
      return `<div class="astro-ui-tab-panel ${idx === 0 ? 'is-active' : ''}" data-astro-tab-panel="${esc(uid)}-t-${idx}" ${idx === 0 ? '' : 'hidden'}>${title}${body}${childBlocks}</div>`;
    })
    .join('');

  return `<section class="${cls}">${tabsHtml}${panelsHtml}</section>`;
}

function renderCalloutBlock(block: any, fmt: InlineFormatter): string {
  const cls = normalizeStyleClasses(block, 'astro-ui-callout');
  return `
    <aside class="${cls}">
      ${block.title ? `<div class="astro-ui-callout__title">${fmt(String(block.title))}</div>` : ''}
      ${block.body ? `<div class="astro-ui-callout__body">${fmt(String(block.body))}</div>` : ''}
    </aside>
  `.trim();
}

function renderSingleBlock(
  block: any,
  fmt: InlineFormatter,
  uid: string,
  depth = 0
): string {
  if (!block || typeof block !== 'object' || depth > 4) return '';

  if (Array.isArray(block.blocks) && block.type !== 'grid' && block.type !== 'tabs') {
    const cls = normalizeStyleClasses(block, 'astro-ui-stack');
    const titleHtml = block.title
      ? `<div class="astro-ui-block-title">${fmt(String(block.title))}</div>`
      : '';
    return `<div class="${cls}">${titleHtml}${block.blocks
      .map((b: any, i: number) => renderSingleBlock({ font: block.font, tone: block.tone, density: block.density, ...b }, fmt, `${uid}-${i}`, depth + 1))
      .join('')}</div>`;
  }

  switch (block.type) {
    case 'card':
      return renderCardBlock(block, fmt);
    case 'metrics':
      return renderMetricsBlock(block, fmt);
    case 'steps':
      return renderStepsBlock(block, fmt);
    case 'checklist':
      return renderChecklistBlock(block, fmt, uid);
    case 'compare':
      return renderCompareBlock(block, fmt);
    case 'tabs':
      return renderTabsBlock(block, fmt, uid, depth);
    case 'callout':
      return renderCalloutBlock(block, fmt);
    case 'grid': {
      const cols = Math.min(3, Math.max(1, Number(block.columns) || 2));
      const items = Array.isArray(block.blocks) ? block.blocks : [];
      const cls = normalizeStyleClasses(block, 'astro-ui-grid');
      return `<div class="${cls}" style="--astro-cols:${cols};">${items
        .map((b: any, i: number) => renderSingleBlock(b, fmt, `${uid}-g-${i}`, depth + 1))
        .join('')}</div>`;
    }
    default:
      if (block.title || block.body) {
        return renderCardBlock(block, fmt);
      }
      return '';
  }
}

let blockCounter = 0;

export function renderAstroUiBlock(
  rawJson: string,
  options: { isClosed?: boolean; inlineFormatter?: InlineFormatter } = {}
): { ok: boolean; html: string } {
  const isClosed = options.isClosed !== false;
  if (!isClosed) {
    return {
      ok: true,
      html: `
        <div class="astro-ui-skeleton" aria-busy="true">
          <span class="material-symbols-outlined astro-ui-spin" aria-hidden="true">progress_activity</span>
          <span>正在编排结构化视图...</span>
        </div>
      `.trim(),
    };
  }

  const parsed = tryParseAstroUiJson(rawJson);
  if (!parsed) {
    return { ok: false, html: '' };
  }

  const fmt = options.inlineFormatter || defaultInlineFormatter;
  const uid = `ab-${++blockCounter}-${Math.random().toString(36).slice(2, 6)}`;

  let html = '';
  if (Array.isArray(parsed)) {
    html = parsed.map((b, i) => renderSingleBlock(b, fmt, `${uid}-${i}`, 0)).join('');
  } else {
    html = renderSingleBlock(parsed, fmt, uid, 0);
  }

  if (!html.trim()) {
    return { ok: false, html: '' };
  }
  return { ok: true, html: `<div class="astro-ui-root">${html}</div>` };
}

/**
 * 绑定 AstroBlocks 内部的交互行为（分组切换、标签页切换、清单勾选持久化）
 */
export function bindAstroBlockInteractions(root: HTMLElement): void {
  if (!root) return;

  // 1. 恢复已存储的 checklist 勾选状态
  root.querySelectorAll<HTMLElement>('.astro-ui-check-item').forEach((btn) => {
    if (btn.dataset.boundCheck === 'true') return;
    btn.dataset.boundCheck = 'true';

    const checkId = btn.dataset.checkId;
    if (checkId) {
      try {
        const saved = localStorage.getItem(`astrolib_checklist_${checkId}`);
        if (saved === 'true' || saved === 'false') {
          const isChecked = saved === 'true';
          btn.classList.toggle('is-checked', isChecked);
          btn.setAttribute('aria-checked', String(isChecked));
          const ic = btn.querySelector('.astro-ui-check-icon');
          if (ic) ic.textContent = isChecked ? 'check_box' : 'check_box_outline_blank';
        }
      } catch {}
    }

    btn.addEventListener('click', () => {
      const nextChecked = !btn.classList.contains('is-checked');
      btn.classList.toggle('is-checked', nextChecked);
      btn.setAttribute('aria-checked', String(nextChecked));
      const ic = btn.querySelector('.astro-ui-check-icon');
      if (ic) ic.textContent = nextChecked ? 'check_box' : 'check_box_outline_blank';
      if (checkId) {
        try {
          localStorage.setItem(`astrolib_checklist_${checkId}`, String(nextChecked));
        } catch {}
      }
    });
  });

  // 2. 分组标签页 / Tabs 切换
  root.querySelectorAll<HTMLElement>('.astro-ui-chip-tab').forEach((tabBtn) => {
    if (tabBtn.dataset.boundTab === 'true') return;
    tabBtn.dataset.boundTab = 'true';

    tabBtn.addEventListener('click', () => {
      const targetId = tabBtn.dataset.astroTabTarget;
      const host = tabBtn.closest('section, .astro-ui-tabs, .astro-ui-checklist');
      if (!targetId || !host) return;

      const tabList = tabBtn.closest('.astro-ui-chip-tabs');
      tabList?.querySelectorAll<HTMLElement>('.astro-ui-chip-tab').forEach((b) => {
        const active = b === tabBtn;
        b.classList.toggle('is-active', active);
        b.setAttribute('aria-selected', String(active));
      });

      host.querySelectorAll<HTMLElement>('[data-astro-tab-panel]').forEach((panel) => {
        const match = panel.getAttribute('data-astro-tab-panel') === targetId;
        panel.classList.toggle('is-active', match);
        if (match) {
          panel.removeAttribute('hidden');
        } else {
          panel.setAttribute('hidden', '');
        }
      });
    });
  });
}
