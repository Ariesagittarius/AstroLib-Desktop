import { parseAstrolibUri, buildAstrolibUri, isAstrolibUri } from '../../utils/astrolib-uri.ts';
import { renderAstroUiBlock } from '../../features/harness/astro-blocks.ts';

export function safeLink(url: string): string {
  let u = (url || '').replace(/["'<>`“”‘’]/g, '').trim();
  if (!u) return '';
  u = u.replace(/&amp;/g, '&');
  if (/^javascript:/i.test(u) || /^data:/i.test(u) || /^vbscript:/i.test(u)) return '';

  u = u.replace(/[),.，。；;!?！？、]+$/, '').trim();
  if (!u) return '';

  if (isAstrolibUri(u)) {
    const target = parseAstrolibUri(u);
    if (target) {
      return buildAstrolibUri(target.colSlug, target.bookSlug, target.chapterSlug, target.anchor);
    }
  }

  const origin = typeof location !== 'undefined' ? location.origin : '';
  const mCol = u.match(/(?:https?:)?\/\/[^\/]*collections\/(.+)$/i) || u.match(/^\/?collections\/(.+)$/i);
  let pathAndHash = '';

  if (mCol) {
    pathAndHash = '/collections/' + mCol[1];
  } else if (/^https?:\/\//i.test(u)) {
    try {
      const parsed = new URL(u);
      if (origin && parsed.origin === origin) {
        pathAndHash = parsed.pathname + parsed.search + parsed.hash;
      } else {
        try { u = decodeURI(u); } catch {}
        return encodeURI(u);
      }
    } catch {
      try { u = decodeURI(u); } catch {}
      return encodeURI(u);
    }
  } else {
    const cleanU = u.replace(/^(\.\/)+/, '').replace(/^\/+/, '');
    const loc = typeof location !== 'undefined' ? location.pathname : '';
    const m = loc.match(/^(\/collections\/[^/]+\/[^/]+\/)/);
    const bookRoot = m ? m[1] : '/';
    pathAndHash = (bookRoot + cleanU).replace(/\/+/g, '/');
  }

  try { pathAndHash = decodeURI(pathAndHash); } catch {}

  const hashIdx = pathAndHash.indexOf('#');
  let pathPart = pathAndHash;
  let hashPart = '';
  if (hashIdx >= 0) {
    pathPart = pathAndHash.slice(0, hashIdx);
    hashPart = pathAndHash.slice(hashIdx + 1);
  }

  const encodedPath = pathPart.split('/').map((seg) => encodeURIComponent(seg)).join('/');
  const encodedHash = hashPart ? '#' + encodeURIComponent(hashPart) : '';

  return (origin || '') + encodedPath + encodedHash;
}

function escapeHtmlAttr(str: string): string {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function safeImageUrl(rawUrl: string): string {
  let u = (rawUrl || '').replace(/["'<>`“”‘’]/g, '').trim();
  if (!u) return '';
  u = u.replace(/&amp;/g, '&');

  if (/^(?:javascript|vbscript):/i.test(u)) return '';

  if (/^data:/i.test(u)) {
    const cleanData = u.replace(/\s+/g, '');
    if (/^data:image\/(?:png|jpeg|jpg|webp|gif|svg\+xml);base64,[a-z0-9+/=]+$/i.test(cleanData)) {
      if (cleanData.length <= 8 * 1024 * 1024) {
        return cleanData;
      }
    }
    return '';
  }

  if (
    /^\/(?:api\/v1\/content\/agent-tools\/workspace-file|api\/ingest\/image|api\/v1\/pdf2abp\/|abp-packs\/|collections\/)/i.test(
      u
    )
  ) {
    return u;
  }

  if (/^https:\/\//i.test(u) || /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\//i.test(u)) {
    return u;
  }

  const cleanedRel = u.replace(/^(\.\/)+/, '').replace(/^\/+/, '');
  if (
    cleanedRel &&
    !cleanedRel.includes('..') &&
    !/^[a-zA-Z]+:/.test(cleanedRel) &&
    /\.(?:png|jpe?g|webp|gif|svg)$/i.test(cleanedRel)
  ) {
    return `/api/v1/content/agent-tools/workspace-file?path=${encodeURIComponent(cleanedRel)}`;
  }

  return '';
}

export function formatAstrolibLabel(href: string, userText?: string): string {
  const nodeTarget = parseAstrolibUri(href);
  if (!nodeTarget) {
    return userText && !userText.startsWith('astrolib://') ? userText : href;
  }

  if (nodeTarget.entityKind === 'paper') {
    const labelBase =
      userText && !userText.startsWith('astrolib://') && !userText.startsWith('paper://')
        ? userText
        : `文献 ${nodeTarget.taskId || nodeTarget.bookSlug}`;
    return nodeTarget.sectionId ? `${labelBase} · ${nodeTarget.sectionId}` : labelBase;
  }

  const bookTitle = nodeTarget.title || nodeTarget.bookSlug;
  let chapTitle = '';
  if (nodeTarget.chapterSlug) {
    let cleanChap = decodeURIComponent(nodeTarget.chapterSlug);

    cleanChap = cleanChap.replace(/^0*(\d)(\d)_+/, '$1.$2 ');
    cleanChap = cleanChap.replace(/^0*(\d)_+/, '第$1章 ');
    cleanChap = cleanChap.replace(/[-_]+/g, ' ').trim();
    chapTitle = cleanChap;
  }

  let anchorTitle = '';
  if (nodeTarget.anchor) {
    if (nodeTarget.anchor.includes('example')) anchorTitle = '例题';
    else if (nodeTarget.anchor.includes('def')) anchorTitle = '定义';
    else if (nodeTarget.anchor.includes('thm') || nodeTarget.anchor.includes('theorem')) anchorTitle = '定理';
    else if (nodeTarget.anchor.includes('knowledge')) anchorTitle = '知识点';
    else anchorTitle = `#${nodeTarget.anchor}`;
  }

  if (userText && !userText.startsWith('astrolib://') && !userText.startsWith('/collections/')) {
    return `${userText} · 《${bookTitle}》${chapTitle ? ` ${chapTitle}` : ''}`;
  }

  if (chapTitle) {
    return `《${bookTitle}》· ${chapTitle}${anchorTitle ? ` (${anchorTitle})` : ''}`;
  }
  return `《${bookTitle}》${anchorTitle ? ` (${anchorTitle})` : ''}`;
}

export function makeAiBadgeLink(href: string, text: string, target: string, rel: string): string {
  const icon = `<span class="block-icon"><svg class="badge-svg" viewBox="0 0 24 24" width="11" height="11" fill="currentColor" aria-hidden="true"><path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/></svg></span>`;
  const arrow = `<span class="block-arrow"><svg class="badge-svg badge-arrow-svg" viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17l9.2-9.2M17 17V8H8"></path></svg></span>`;

  if (isAstrolibUri(href)) {
    const nodeTarget = parseAstrolibUri(href);
    const canonical = nodeTarget ? nodeTarget.canonicalPath : href;
    const label = formatAstrolibLabel(href, text);
    const titleAttr = nodeTarget ? ` title="点击跳转研读视窗：${nodeTarget.title}"` : '';

    return `<a href="${canonical}" data-astrolib-uri="${href}" class="block-ref-badge interactive-badge ai-link-badge astrolib-node-link" target="_self"${titleAttr}>${icon}<span class="block-text m3-pill-label">${label}</span>${arrow}</a>`;
  }

  return `<a href="${href}" class="block-ref-badge interactive-badge ai-link-badge" target="${target}" ${rel}>${icon}<span class="block-text">${text}</span>${arrow}</a>`;
}

export function renderInline(s: string, openNew = true): string {
  const target = openNew ? '_blank' : '_self';
  const rel = openNew ? 'rel="noopener"' : '';
  const placeholders: string[] = [];

  s = s.replace(
    /(👉\s*)?(?:`|<code>)?\/read\s+(?:`|<code>)?(astrolib:\/\/[^\s`"'“”‘’<>（）()\[\]【】{}]+)(?:`|<\/code>)?(?:(?:\s*#|\s+)([a-zA-Z0-9_\u4e00-\u9fa5-]+))?(?:`|<\/code>)?/gi,
    (_fullMatch, pointer, rawUri, rawAnchor) => {
      let uri = rawUri.trim();
      const anchor = rawAnchor ? rawAnchor.trim().replace(/^#/, '') : '';
      if (anchor && !uri.includes('#')) {
        uri += `#${anchor}`;
      }
      const href = safeLink(uri);
      if (!href) return _fullMatch;
      const tag = makeAiBadgeLink(href, uri, target, rel);
      placeholders.push(tag);
      return `${pointer || ''}___LINK_PLACEHOLDER_${placeholders.length - 1}___`;
    }
  );

  s = s.replace(/!\[([^\]\n]*)\]\(\s*<?([^)\s>]+)>?(?:\s+["']([^"']*)["'])?\s*\)/g, (_m, alt, url, titleAttr) => {
    const imgUrl = safeImageUrl(url);
    if (!imgUrl) return `![${alt}](${url})`;
    const cleanAlt = escapeHtmlAttr((alt || '').trim());
    const cleanTitle = escapeHtmlAttr((titleAttr || alt || '').trim());
    const tag = `<span class="harness-md-img-wrap"><img class="harness-md-img" src="${escapeHtmlAttr(imgUrl)}" alt="${cleanAlt}" title="${cleanTitle}" loading="lazy" /></span>`;
    placeholders.push(tag);
    return `___LINK_PLACEHOLDER_${placeholders.length - 1}___`;
  });

  s = s.replace(/\[([^\]\n]+)\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g, (_m, text, url) => {
    const href = safeLink(url);
    if (!href) return `[${text}](${url})`;
    let innerText = text;
    innerText = innerText.replace(/`([^`]+)`/g, '<code>$1</code>');
    innerText = innerText.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    innerText = innerText.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
    innerText = innerText.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    const tag = makeAiBadgeLink(href, innerText, target, rel);
    placeholders.push(tag);
    return `___LINK_PLACEHOLDER_${placeholders.length - 1}___`;
  });

  s = s.replace(
    /(^|[^\w/=%])(?:[`"“‘(（\[【])?(astrolib:\/\/[^\s`"'“”‘’<>（）()\[\]【】{}]+)(?:[`"”’)）\]】])?/gi,
    (_fullMatch, prefix, rawUrl) => {
      let cleanUrl = rawUrl.replace(/[),.，。；;!?！？、`"”’）\]】]+$/, '');
      const trailing = rawUrl.slice(cleanUrl.length);
      const href = safeLink(cleanUrl);
      if (!href) return _fullMatch;
      const tag = makeAiBadgeLink(href, cleanUrl, target, rel);
      placeholders.push(tag);
      return `${prefix}___LINK_PLACEHOLDER_${placeholders.length - 1}___${trailing}`;
    }
  );

  s = s.replace(
    /(^|[^\w"'/=`“‘(（\[【])(?:[`"“‘])?((?:https?:)?\/\/[^\s<>"'`“”‘’]*collections\/[^\s<>"'`“”‘’]+|\/?collections\/[^\s<>"'`“”‘’]+)(?:[`"”’])?/gi,
    (_fullMatch, prefix, rawUrl) => {
      let cleanUrl = rawUrl.replace(/[),.，。；;!?！？、`"”’]+$/, '');
      const trailing = rawUrl.slice(cleanUrl.length);
      const href = safeLink(cleanUrl);
      if (!href) return _fullMatch;
      const tag = makeAiBadgeLink(href, cleanUrl, target, rel);
      placeholders.push(tag);
      return `${prefix}___LINK_PLACEHOLDER_${placeholders.length - 1}___${trailing}`;
    }
  );

  s = s.replace(/`([^`]+)`/g, (_m, codeText) => {
    const trimmed = codeText.trim();
    if (trimmed.startsWith('/') || /^\/(ast|read|toc|exercises|diff|terminal|clear)\b/.test(trimmed)) {
      const cmdOnly = trimmed.split(/\s+[-—–]\s+/)[0] || trimmed;
      return `<code class="m3-command-chip" data-cmd="${cmdOnly.replace(/"/g, '&quot;')}" title="快捷指令胶囊：点击直接填入对话框">${codeText}</code>`;
    }
    return `<code>${codeText}</code>`;
  });

  s = s.replace(
    /(^|[\s•·*+-])(\/(?:ast|read|toc|exercises|diff|terminal|clear)\b[^\n<`，。；！？]+)/g,
    (_m, prefix, cmdStr) => {
      const trimmed = cmdStr.trim();
      const cmdOnly = trimmed.split(/\s+[-—–]\s+/)[0] || trimmed;
      return `${prefix}<code class="m3-command-chip" data-cmd="${cmdOnly.replace(/"/g, '&quot;')}" title="快捷指令胶囊：点击直接填入对话框">${trimmed}</code>`;
    }
  );

  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');

  s = s.replace(/___LINK_PLACEHOLDER_(\d+)___/g, (_m, idx) => placeholders[Number(idx)]);

  return s;
}

export function splitTableRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  if (!s) return [];

  const cells: string[] = [];
  let current = '';
  let inCode = false;
  let inInlineMath = false;
  let inDisplayMath = false;

  for (let idx = 0; idx < s.length; idx++) {
    const ch = s[idx];

    if (ch === '\\' && idx + 1 < s.length) {
      current += ch + s[idx + 1];
      idx++;
      continue;
    }

    if (ch === '`') {
      inCode = !inCode;
      current += ch;
      continue;
    }

    if (inCode) {
      current += ch;
      continue;
    }

    if (ch === '$' && idx + 1 < s.length && s[idx + 1] === '$') {
      if (inDisplayMath) {
        inDisplayMath = false;
      } else if (!inInlineMath) {
        inDisplayMath = true;
      }
      current += '$$';
      idx++;
      continue;
    }

    if (ch === '$') {
      if (!inDisplayMath) {
        inInlineMath = !inInlineMath;
      }
      current += ch;
      continue;
    }

    if (ch === '|' && !inInlineMath && !inDisplayMath) {
      cells.push(current.trim());
      current = '';
      continue;
    }

    current += ch;
  }

  cells.push(current.trim());
  return cells;
}

export function isTableDelimiterRow(line: string): boolean {
  if (!line) return false;
  const trimmed = line.trim();
  if (!trimmed.includes('-') || !trimmed.includes('|')) return false;
  const cells = splitTableRow(trimmed);
  if (cells.length === 0) return false;
  return cells.every((c) => /^\s*:?-{1,}:?\s*$/.test(c));
}

export function isTableAt(lines: string[], idx: number): boolean {
  if (idx + 1 >= lines.length) return false;
  const header = lines[idx].trim();
  const delim = lines[idx + 1].trim();
  if (!header.includes('|') || !delim.includes('|')) return false;
  if (!isTableDelimiterRow(delim)) return false;
  const hCells = splitTableRow(header);
  const dCells = splitTableRow(delim);
  return hCells.length > 0 && dCells.length > 0;
}

export function parseBlocks(lines: string[], openNew = true): string {
  const out: string[] = [];
  let i = 0;
  const inline = (t: string) => renderInline(t, openNew);

  const BLOCK_START = /^(#{1,6})\s|^\s*!\[[^\]\n]*\]\([^)\n]+\)\s*$|^\s*(?:>|&gt;)(?:\s|$|>)|^\s*[-*+]\s|^\s*\d+[.)]\s|^\s*\$\$\s*$|^\s*\$\$.*|^\s*(?:```+|~~~+)/;

  while (i < lines.length) {
    const line = lines[i];

    const fence = line.match(/^\s*(```+|~~~+)\s*([\w-]*)?\s*$/);
    if (fence) {
      const marker = fence[1][0];
      const lang = (fence[2] || '').trim().toLowerCase();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !new RegExp(`^\\s*${marker}{3,}\\s*$`).test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      const isClosed = i < lines.length;
      if (isClosed) i++;

      if (lang === 'astro-ui' || lang === 'ui') {
        const uiRes = renderAstroUiBlock(buf.join('\n'), {
          isClosed,
          inlineFormatter: (rawText: string) =>
            renderInline(
              rawText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
              openNew
            ),
        });
        if (uiRes.ok) {
          out.push(uiRes.html);
          continue;
        }
      }

      const firstLineTrimmed = buf.find((l) => l.trim())?.trim() || '';
      const isMermaid = lang === 'mermaid' || lang === 'flowchart' ||
        /^(?:graph\s|flowchart\s|sequenceDiagram|stateDiagram|classDiagram|erDiagram|mindmap|timeline)/i.test(firstLineTrimmed);

      if (isMermaid) {

        const unescapedCode = buf.join('\n')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>');
        out.push(`
          <div class="mermaid-container" data-mermaid-code="${encodeURIComponent(unescapedCode)}">
            <div class="mermaid-header">
              <div class="mermaid-header__title">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
                <span>Mermaid 流程图</span>
              </div>
              <div class="mermaid-header__actions">
                <button type="button" class="mermaid-zoom-btn" title="全屏放大查看流程图">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line><line x1="11" y1="8" x2="11" y2="14"></line><line x1="8" y1="11" x2="14" y2="11"></line></svg>
                  <span>放大查看</span>
                </button>
                <button type="button" class="mermaid-copy-btn" title="复制 Mermaid 源码">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                  <span>复制</span>
                </button>
              </div>
            </div>
            <div class="mermaid-render"><pre class="mermaid">${unescapedCode}</pre></div>
          </div>
        `.trim());
      } else {
        out.push(`
          <div class="m3-code-block" data-lang="${lang || 'text'}">
            <div class="m3-code-block__header">
              <span class="m3-code-block__lang">${lang || 'code'}</span>
              <button type="button" class="m3-code-copy-btn" title="复制代码">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                <span>复制</span>
              </button>
            </div>
            <pre><code>${buf.join('\n')}</code></pre>
          </div>
        `.trim());
      }
      continue;
    }

    if (/^\s*\$\$/.test(line)) {
      const buf = [line.trim()];
      if (/^\s*\$\$.*\$\$\s*$/.test(line) && line.trim().length > 4) {
        out.push(`<p class="md-math">${buf[0]}</p>`);
        i++;
        continue;
      }
      i++;
      while (i < lines.length && !/\$\$\s*$/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      if (i < lines.length) {
        buf.push(lines[i].trim());
        i++;
      } else {
        if (!buf[buf.length - 1].endsWith('$$')) {
          buf[buf.length - 1] += ' $$';
        }
      }
      out.push(`<p class="md-math">${buf.join('\n')}</p>`);
      continue;
    }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
      i++;
      continue;
    }

    const standaloneImgMatch = line.match(
      /^\s*!\[([^\]\n]*)\]\(\s*<?([^)\s>]+)>?(?:\s+["']([^"']*)["'])?\s*\)\s*$/
    );
    if (standaloneImgMatch) {
      const imgUrl = safeImageUrl(standaloneImgMatch[2]);
      if (imgUrl) {
        const alt = escapeHtmlAttr((standaloneImgMatch[1] || '').trim());
        const caption = (standaloneImgMatch[3] || standaloneImgMatch[1] || '').trim();
        out.push(
          `<figure class="harness-md-figure"><img class="harness-md-img" src="${escapeHtmlAttr(imgUrl)}" alt="${alt}" loading="lazy" />${caption ? `<figcaption>${escapeHtmlAttr(caption)}</figcaption>` : ''}</figure>`
        );
        i++;
        continue;
      }
    }

    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push('<hr/>');
      i++;
      continue;
    }

    if (/^\s*(?:>|&gt;)\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*(?:>|&gt;)\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*(?:>|&gt;)\s?/, ''));
        i++;
      }
      const innerHtml = parseBlocks(buf, openNew);
      out.push(`<blockquote>${innerHtml}</blockquote>`);
      continue;
    }

    if (isTableAt(lines, i)) {
      const headerLine = lines[i];
      const delimLine = lines[i + 1];
      const headerCells = splitTableRow(headerLine);
      const delimCells = splitTableRow(delimLine);

      const alignments = delimCells.map((c) => {
        const t = c.trim();
        const left = t.startsWith(':');
        const right = t.endsWith(':');
        if (left && right) return 'center';
        if (right) return 'right';
        if (left) return 'left';
        return '';
      });

      const colCount = Math.max(headerCells.length, delimCells.length);
      const getAlignStyle = (colIdx: number) => {
        const a = alignments[colIdx];
        return a ? ` style="text-align: ${a};"` : '';
      };

      const thHtml = headerCells.map((cell, idx) => {
        const clean = cell.replace(/\\\|/g, '|');
        return `<th${getAlignStyle(idx)}>${inline(clean)}</th>`;
      }).join('');

      i += 2;
      const bodyRows: string[][] = [];
      while (i < lines.length) {
        const rowLine = lines[i];
        if (/^\s*$/.test(rowLine)) break;
        if (!rowLine.includes('|')) break;
        if (BLOCK_START.test(rowLine)) break;

        bodyRows.push(splitTableRow(rowLine));
        i++;
      }

      const tbodyHtml = bodyRows.map((row) => {
        let tr = '<tr>';
        for (let c = 0; c < colCount; c++) {
          const rawCell = row[c] ?? '';
          const clean = rawCell.replace(/\\\|/g, '|');
          tr += `<td${getAlignStyle(c)}>${inline(clean)}</td>`;
        }
        tr += '</tr>';
        return tr;
      }).join('');

      out.push(`<div class="ask-table-wrap"><table class="ask-table"><thead><tr>${thHtml}</tr></thead><tbody>${tbodyHtml}</tbody></table></div>`);
      continue;
    }

    const ulMatch = line.match(/^\s*[-*+]\s+(.*)$/);
    if (ulMatch) {
      const items: string[][] = [[ulMatch[1]]];
      i++;
      while (i < lines.length) {
        const cur = lines[i];
        const nextItemMatch = cur.match(/^\s*[-*+]\s+(.*)$/);
        if (nextItemMatch) {
          items.push([nextItemMatch[1]]);
          i++;
          continue;
        }
        if (/^\s*$/.test(cur)) {
          let k = i + 1;
          while (k < lines.length && /^\s*$/.test(lines[k])) k++;
          if (k < lines.length && /^\s*[-*+]\s+/.test(lines[k])) {
            i = k;
            continue;
          }
          break;
        }
        if (/^(#{1,6})\s|^\s*(?:>|&gt;)\s|^\s*\d+[.)]\s|^\s*(?:```+|~~~+)|^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(cur) || isTableAt(lines, i)) {
          break;
        }
        items[items.length - 1].push(cur.trim());
        i++;
      }
      out.push(`<ul>${items.map((itemLines) => `<li>${itemLines.map(inline).join('<br/>')}</li>`).join('')}</ul>`);
      continue;
    }

    const olMatch = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
    if (olMatch) {
      const startNum = parseInt(olMatch[1], 10) || 1;
      const items: string[][] = [[olMatch[2]]];
      i++;
      while (i < lines.length) {
        const cur = lines[i];
        const nextItemMatch = cur.match(/^\s*\d+[.)]\s+(.*)$/);
        if (nextItemMatch) {
          items.push([nextItemMatch[1]]);
          i++;
          continue;
        }
        if (/^\s*$/.test(cur)) {
          let k = i + 1;
          while (k < lines.length && /^\s*$/.test(lines[k])) k++;
          if (k < lines.length && /^\s*\d+[.)]\s+/.test(lines[k])) {
            i = k;
            continue;
          }
          break;
        }
        if (/^(#{1,6})\s|^\s*(?:>|&gt;)\s|^\s*[-*+]\s|^\s*(?:```+|~~~+)|^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(cur) || isTableAt(lines, i)) {
          break;
        }
        items[items.length - 1].push(cur.trim());
        i++;
      }
      const startAttr = startNum !== 1 ? ` start="${startNum}"` : '';
      out.push(`<ol${startAttr}>${items.map((itemLines) => `<li>${itemLines.map(inline).join('<br/>')}</li>`).join('')}</ol>`);
      continue;
    }

    if (!/^\s*$/.test(line)) {
      const buf = [line];
      i++;
      while (i < lines.length && !/^\s*$/.test(lines[i]) && !BLOCK_START.test(lines[i]) && !isTableAt(lines, i)) {
        buf.push(lines[i]);
        i++;
      }
      out.push(`<p>${buf.map(inline).join('<br/>')}</p>`);
      continue;
    }

    i++;
  }

  return out.join('\n');
}

export function mdToHtml(md: string, openNew = true): string {
  if (!md) return '';

  const normalized = md.replace(/^(\s*)&gt;/gm, '$1>');

  const src = normalized.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const lines = src.split(/\r?\n/);
  return parseBlocks(lines, openNew);
}
