/**
 * electron/server/canvas-workspace-template.ts
 * ============================================================================
 * AstroLib 章节无限自由画布工作台动态合成入口 (模块化拼装)
 * ============================================================================
 * 职责拆分为 electron/server/canvas/ 下的独立子模块：
 * - styles.ts: Material You 主题色桥接、统一字体栈与极简微点光标样式
 * - markup.ts: 紧凑工具栏、双层画布、弹窗结构
 * - theme-sync-script.ts: 首屏及运行时主题色/日夜模式/字体热同步
 * - client-script.ts: 无限画布笔迹、卡片编辑、AST 引用与导入导出逻辑
 * ============================================================================
 */

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
