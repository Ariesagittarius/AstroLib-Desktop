import { buildCanvasStyles } from './canvas/styles.ts';
import { buildCanvasBodyMarkup } from './canvas/markup.ts';
import { buildCanvasThemeSyncScript } from './canvas/theme-sync-script.ts';
import { buildCanvasClientScript } from './canvas/client-script.ts';

function escapeHtml(str?: string | null): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderCanvasWorkspaceHtml(params: {
  colSlug: string;
  bookSlug: string;
  chapterSlug: string;
  bookTitle?: string;
  chapterTitle?: string;
  exportMode?: string;
}): string {
  const metaJson = JSON.stringify({
    colSlug: params.colSlug,
    bookSlug: params.bookSlug,
    chapterSlug: params.chapterSlug,
    bookTitle: params.bookTitle || params.bookSlug,
    chapterTitle: params.chapterTitle || params.chapterSlug,
    exportMode: params.exportMode || '',
  }).replace(/<\//g, '<\\/');

  const pageTitle = `${params.chapterTitle || params.chapterSlug} · 自由画布 · AstroLib`;

  return `<!DOCTYPE html>
<html lang="zh-CN" data-site-theme="material-you">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(pageTitle)}</title>
  <link rel="stylesheet" href="/api/v1/content/annotations/katex.css" />
  <style>
    @font-face {
      font-family: 'Material Symbols Outlined';
      font-style: normal;
      font-weight: 100 700;
      font-display: swap;
      src: url('/fonts/material-symbols-outlined.woff2') format('woff2');
    }
    ${buildCanvasStyles()}
  </style>
  <script>${buildCanvasThemeSyncScript(params.exportMode)}</script>
</head>
<body>
  ${buildCanvasBodyMarkup()}
  <script>${buildCanvasClientScript(metaJson)}</script>
</body>
</html>`;
}
