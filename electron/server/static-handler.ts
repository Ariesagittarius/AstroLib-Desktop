/**
 * electron/server/static-handler.ts
 * ============================================================================
 * AstroLib 静态资源服务引擎 (Zero-Dependency High-Performance Static Handler)
 * ============================================================================
 * 遵循 P1-A1 架构规范与 ADR-READER-CONTRACT-2026-11-13：
 * 1. 严格 0 模糊匹配：彻底删除 cleanSlug 扫描与正则降级逻辑；
 * 2. 章节两级精确匹配：第一级物理命中 Canonical Slug，第二级显式查表 legacySlug；
 * 3. 规范重定向与 404：legacySlug 返回 301 永久重定向；未命中返回标准学术 404 视窗；
 * 4. 高性能缓存：内存 LRU 缓存与 ETag 304 协商，零磁盘 I/O 延迟。
 * ============================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { renderReaderPageHtml } from './reader-shell-template.ts';
import { resolveAbpArtifactsDir } from '../../src/core/catalog/content-paths.ts';
import type { AstroBookManifest, AstroBookSection } from '../../src/types/content-package.ts';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.pdf': 'application/pdf',
  '.epub': 'application/epub+zip',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.txt': 'text/plain; charset=utf-8',
};

interface MemoryCacheEntry {
  buffer: Buffer;
  contentType: string;
  etag: string;
  mtimeMs: number;
  size: number;
}

function escapeHtml(str?: string | null): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 极简学术规范 404 视窗渲染器
 * 复用 AstroLib M3 设计 tokens，无额外第三方依赖
 */
function renderAcademic404Html(
  colSlug: string,
  bookSlug: string,
  chapterSlug: string,
  reason = '章节不存在或尚未安装',
  defaultChapterUrl?: string
): string {
  const safeCol = escapeHtml(colSlug);
  const safeBook = escapeHtml(bookSlug);
  const safeChap = escapeHtml(chapterSlug);
  const safeReason = escapeHtml(reason);
  const safeDefaultUrl = escapeHtml(defaultChapterUrl || '/desktop/');

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>404 - 章节未找到 | AstroLib</title>
  <script>
    (function() {
      try {
        var p = new URLSearchParams(window.location.search);
        var t = p.get('theme') || localStorage.getItem('astrolib-theme');
        if (t === 'dark' || t === 'light') {
          document.documentElement.setAttribute('data-theme', t);
        }
      } catch (_) {}
    })();
  </script>
  <style>
    :root,
    :root[data-theme='light'] {
      --md-sys-color-surface: #fbf8fd;
      --md-sys-color-on-surface: #1b1b1f;
      --md-sys-color-surface-container: #f0edf1;
      --md-sys-color-outline: #74777f;
      --md-sys-color-outline-variant: #c4c6d0;
      --md-sys-color-primary: #0061a4;
      --md-sys-color-on-primary: #ffffff;
      --md-sys-color-error: #ba1a1a;
      --md-sys-color-on-error: #ffffff;
    }
    @media (prefers-color-scheme: dark) {
      :root:not([data-theme='light']) {
        --md-sys-color-surface: #121316;
        --md-sys-color-on-surface: #e2e2e6;
        --md-sys-color-surface-container: #1e1f23;
        --md-sys-color-outline: #8e9099;
        --md-sys-color-outline-variant: #44474f;
        --md-sys-color-primary: #9ecaff;
        --md-sys-color-on-primary: #003258;
        --md-sys-color-error: #ffb4ab;
        --md-sys-color-on-error: #690005;
      }
    }
    :root[data-theme='dark'] {
      --md-sys-color-surface: #121316;
      --md-sys-color-on-surface: #e2e2e6;
      --md-sys-color-surface-container: #1e1f23;
      --md-sys-color-outline: #8e9099;
      --md-sys-color-outline-variant: #44474f;
      --md-sys-color-primary: #9ecaff;
      --md-sys-color-on-primary: #003258;
      --md-sys-color-error: #ffb4ab;
      --md-sys-color-on-error: #690005;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background-color: var(--md-sys-color-surface);
      color: var(--md-sys-color-on-surface);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
    }
    .academic-404-card {
      background-color: var(--md-sys-color-surface-container);
      border: 1px solid var(--md-sys-color-outline-variant);
      border-radius: 16px;
      padding: 2.5rem 2rem;
      max-width: 520px;
      width: 100%;
      text-align: center;
      box-shadow: 0 4px 20px rgba(0,0,0,0.06);
    }
    .academic-404-icon {
      width: 48px;
      height: 48px;
      margin-bottom: 1rem;
      display: inline-block;
      color: var(--md-sys-color-error);
    }
    .academic-404-title {
      font-size: 1.35rem;
      font-weight: 600;
      letter-spacing: -0.01em;
      margin-bottom: 0.75rem;
    }
    .academic-404-reason {
      font-size: 0.92rem;
      color: var(--md-sys-color-outline);
      margin-bottom: 1.5rem;
      line-height: 1.5;
    }
    .academic-404-details {
      background-color: var(--md-sys-color-surface);
      border: 1px solid var(--md-sys-color-outline-variant);
      border-radius: 8px;
      padding: 0.75rem 1rem;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.8rem;
      text-align: left;
      margin-bottom: 1.5rem;
      word-break: break-all;
    }
    .academic-404-details div {
      margin: 0.25rem 0;
    }
    .academic-404-actions {
      display: flex;
      gap: 0.75rem;
      justify-content: center;
      flex-wrap: wrap;
    }
    .btn-action {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0.5rem 1.25rem;
      border-radius: 20px;
      font-size: 0.88rem;
      font-weight: 500;
      text-decoration: none;
      cursor: pointer;
      border: 1px solid transparent;
      transition: all 0.2s ease;
    }
    .btn-primary {
      background-color: var(--md-sys-color-primary);
      color: var(--md-sys-color-on-primary);
    }
    .btn-primary:hover {
      opacity: 0.9;
    }
    .btn-outlined {
      border-color: var(--md-sys-color-outline);
      color: var(--md-sys-color-primary);
      background: transparent;
    }
    .btn-outlined:hover {
      background-color: rgba(0, 97, 164, 0.08);
    }
  </style>
</head>
<body>
  <div class="academic-404-card">
    <svg class="academic-404-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10"></circle>
      <line x1="12" y1="8" x2="12" y2="12"></line>
      <line x1="12" y1="16" x2="12.01" y2="16"></line>
    </svg>
    <h1 class="academic-404-title">404 - 章节或资源未找到</h1>
    <p class="academic-404-reason">${safeReason}</p>
    <div class="academic-404-details">
      <div><strong>学科合集:</strong> ${safeCol}</div>
      <div><strong>书籍标识:</strong> ${safeBook}</div>
      <div><strong>章节标识:</strong> ${safeChap}</div>
    </div>
    <div class="academic-404-actions">
      <a href="/desktop/" data-action="return-library" class="btn-action btn-primary" onclick="if (window.parent && window.parent !== window) { window.parent.postMessage({ type: 'astrolib:switch-fragment', fragment: 'library' }, '*'); return false; }">
        返回研读书库
      </a>
      <a href="${safeDefaultUrl}" data-action="return-default-chapter" class="btn-action btn-outlined">
        返回默认章节
      </a>
    </div>
  </div>
</body>
</html>`;
}

export class StaticHandler {
  private distDir: string;
  private userAbpDir?: string;
  private projectRoot?: string;
  private memoryCache = new Map<string, MemoryCacheEntry>();
  private readonly MAX_CACHE_FILE_SIZE = 5 * 1024 * 1024; // 5 MB 以内的资源全部驻留内存
  private readonly MAX_CACHE_ENTRIES = 500; // 最多缓存 500 个静态页面与样式资源

  constructor(distDir: string, userAbpDir?: string, projectRoot?: string) {
    this.distDir = distDir;
    this.userAbpDir = userAbpDir;
    this.projectRoot = projectRoot;
  }

  /**
   * 处理静态文件请求 (RAM 高速缓存优先，零磁盘 I/O 延迟)
   */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return false;
    }

    const rawUrl = req.url || '/';
    const pathname = rawUrl.split('?')[0].split('#')[0];

    // 防止目录穿越
    let safePath: string;
    try {
      safePath = decodeURIComponent(pathname);
    } catch {
      return false;
    }

    if (safePath.includes('..')) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return true;
    }

    // 0. 特别处理 /collections/ 章节与书本根路由（排除静态配图资产）
    // 章节 slug 允许包含多级路径（如 zh-wp/001_books-and-algorithms），以支持官方多卷本目录结构
    const isImageRequest = safePath.includes('/images/') || /\.(png|jpe?g|gif|svg|webp|ico|woff2?|ttf|otf)$/i.test(safePath);
    const collectionsMatch = isImageRequest
      ? null
      : safePath.match(/^\/?collections\/([^/]+)\/([^/]+)(?:\/(.+?))?\/?$/);
    if (collectionsMatch) {
      const rawChapterSlug = collectionsMatch[3];
      if (rawChapterSlug && (rawChapterSlug.includes('\\') || rawChapterSlug.startsWith('/'))) {
        this.sendAcademic404(req, res, collectionsMatch[1], collectionsMatch[2], rawChapterSlug, '章节标识不合法');
        return true;
      }
      return await this.handleCollectionsRoute(req, res, collectionsMatch[1], collectionsMatch[2], rawChapterSlug, pathname);
    }

    const filePath = this.resolveFilePath(safePath);
    if (!filePath || !fs.existsSync(filePath)) {
      return false;
    }

    return await this.serveFile(req, res, filePath, pathname);
  }

  /**
   * 获取某本书籍的候选存储根目录 (用户安装目录优先，回退开发期构建目录)
   */
  private getBookCandidateDirs(colSlug: string, bookSlug: string): string[] {
    const candidateDirs: string[] = [];
    if (this.userAbpDir) {
      candidateDirs.push(path.join(this.userAbpDir, `${colSlug}-${bookSlug}`));
    }
    if (this.projectRoot) {
      const artifactsBookDir = path.join(resolveAbpArtifactsDir(this.projectRoot), `${colSlug}-${bookSlug}`);
      if (!candidateDirs.includes(artifactsBookDir)) {
        candidateDirs.push(artifactsBookDir);
      }
    }
    return candidateDirs;
  }

  /**
   * 精确处理 /collections/:col/:book/:chapter/ 动态章节阅读与 301 重定向
   */
  private async handleCollectionsRoute(
    req: IncomingMessage,
    res: ServerResponse,
    colSlug: string,
    bookSlug: string,
    rawChapterSlug: string | undefined,
    pathname: string
  ): Promise<boolean> {
    const candidateDirs = this.getBookCandidateDirs(colSlug, bookSlug);
    let abpDir: string | null = null;
    let manifestFile: string | null = null;

    for (const dir of candidateDirs) {
      const mf = path.join(dir, 'manifest.json');
      if (fs.existsSync(mf)) {
        abpDir = dir;
        manifestFile = mf;
        break;
      }
    }

    if (!abpDir || !manifestFile) {
      this.sendAcademic404(req, res, colSlug, bookSlug, rawChapterSlug || '', '书籍未安装或不存在');
      return true;
    }

    let manifest: AstroBookManifest;
    try {
      manifest = JSON.parse(await fs.promises.readFile(manifestFile, 'utf8')) as AstroBookManifest;
    } catch {
      this.sendAcademic404(req, res, colSlug, bookSlug, rawChapterSlug || '', '书籍清单数据损坏');
      return true;
    }

    // 1. 若请求未指定章节 (形如 /collections/:col/:book/ 或 /collections/:col/:book)
    // 302 临时重定向至书籍默认入口章节
    if (!rawChapterSlug) {
      const entryPoint = manifest.entryPoint || 'chapter-01';
      const redirectUrl = `/collections/${colSlug}/${bookSlug}/${entryPoint}/`;
      res.writeHead(302, {
        Location: encodeURI(redirectUrl),
        'Content-Type': 'text/html; charset=utf-8',
      });
      if (req.method === 'HEAD') {
        res.end();
        return true;
      }
      res.end(`<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=${encodeURI(redirectUrl)}"><title>302 Redirect</title></head><body>Redirecting to <a href="${encodeURI(redirectUrl)}">${entryPoint}</a></body></html>`);
      return true;
    }

    // 2. 第一级检查：Canonical Slug 直接物理命中
    const defaultChapterUrl = manifest && manifest.entryPoint
      ? `/collections/${colSlug}/${bookSlug}/${manifest.entryPoint}/`
      : '/desktop/';

    const directChapJson = path.join(abpDir, 'chapters', `${rawChapterSlug}.json`);
    if (fs.existsSync(directChapJson)) {
      const cachedHtmlFile = this.synthesizeAbpHtml(abpDir, manifestFile, directChapJson, rawChapterSlug);
      if (!cachedHtmlFile || !fs.existsSync(cachedHtmlFile)) {
        this.sendAcademic404(req, res, colSlug, bookSlug, rawChapterSlug, '章节合成失败', defaultChapterUrl);
        return true;
      }
      return await this.serveFile(req, res, cachedHtmlFile, pathname);
    }

    // 3. 第二级检查：显式单项查表检索 legacySlug 别名映射
    const sections: AstroBookSection[] = Array.isArray(manifest.sections) ? manifest.sections : [];
    let matchedCanonicalSlug: string | null = null;
    for (const sec of sections) {
      for (const ch of (sec.chapters || [])) {
        if (ch.legacySlug === rawChapterSlug) {
          matchedCanonicalSlug = ch.slug;
          break;
        }
      }
      if (matchedCanonicalSlug) break;
    }

    if (matchedCanonicalSlug) {
      // 命中历史别名：301 永久重定向至规范化 Canonical URL
      const canonicalUrl = `/collections/${colSlug}/${bookSlug}/${matchedCanonicalSlug}/`;
      res.writeHead(301, {
        Location: encodeURI(canonicalUrl),
        'Content-Type': 'text/html; charset=utf-8',
      });
      if (req.method === 'HEAD') {
        res.end();
        return true;
      }
      res.end(`<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=${encodeURI(canonicalUrl)}"><title>301 Moved Permanently</title></head><body>Moved to <a href="${encodeURI(canonicalUrl)}">${matchedCanonicalSlug}</a></body></html>`);
      return true;
    }

    // 4. 两级均未命中：绝不进行模糊猜测，直接输出 404 学术视窗
    this.sendAcademic404(req, res, colSlug, bookSlug, rawChapterSlug, '章节不存在或链接已失效', defaultChapterUrl);
    return true;
  }

  /**
   * 输出标准 404 学术视窗
   */
  private sendAcademic404(
    req: IncomingMessage,
    res: ServerResponse,
    colSlug: string,
    bookSlug: string,
    chapterSlug: string,
    reason: string,
    defaultChapterUrl?: string
  ): void {
    const html = renderAcademic404Html(colSlug, bookSlug, chapterSlug, reason, defaultChapterUrl);
    const bodyBuf = Buffer.from(html, 'utf8');
    res.writeHead(404, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': bodyBuf.byteLength,
      'Cache-Control': 'no-cache, must-revalidate',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    res.end(bodyBuf);
  }

  /**
   * 基础静态文件传输与协商缓存引擎
   */
  private async serveFile(
    req: IncomingMessage,
    res: ServerResponse,
    filePath: string,
    pathname: string
  ): Promise<boolean> {
    try {
      const stat = await fs.promises.stat(filePath);
      if (stat.isDirectory()) {
        return false;
      }

      const etag = `W/"${stat.size}-${stat.mtimeMs.toString(16)}"`;

      // 304 缓存协商
      const ifNoneMatch = req.headers['if-none-match'];
      if (ifNoneMatch === etag) {
        res.writeHead(304, {
          ETag: etag,
          'Cache-Control': this.getCacheControl(pathname),
        });
        res.end();
        return true;
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';

      const headers: Record<string, string | number> = {
        'Content-Type': contentType,
        'Content-Length': stat.size,
        ETag: etag,
        'Cache-Control': this.getCacheControl(pathname),
        'Accept-Ranges': 'bytes',
      };

      if (req.method === 'HEAD') {
        res.writeHead(200, headers);
        res.end();
        return true;
      }

      // 命中内存缓存：直接纳秒级输出 Buffer
      const cached = this.memoryCache.get(filePath);
      if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
        res.writeHead(200, headers);
        res.end(cached.buffer);
        return true;
      }

      // 小文件写入内存缓存
      if (stat.size <= this.MAX_CACHE_FILE_SIZE) {
        const fileBuf = await fs.promises.readFile(filePath);
        if (this.memoryCache.size >= this.MAX_CACHE_ENTRIES) {
          const firstKey = this.memoryCache.keys().next().value;
          if (firstKey) this.memoryCache.delete(firstKey);
        }
        this.memoryCache.set(filePath, {
          buffer: fileBuf,
          contentType,
          etag,
          mtimeMs: stat.mtimeMs,
          size: stat.size,
        });

        res.writeHead(200, headers);
        res.end(fileBuf);
        return true;
      }

      // 超大文件流式传输
      res.writeHead(200, headers);
      const stream = fs.createReadStream(filePath);
      stream.pipe(res);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 将 URL 路由映射为本地文件系统路径 (Clean URLs)
   */
  private resolveFilePath(cleanPath: string): string | null {
    const directPath = path.join(this.distDir, cleanPath);

    // 1. 完全精确匹配文件 (distDir 优先)
    if (fs.existsSync(directPath) && fs.statSync(directPath).isFile()) {
      return directPath;
    }

    // 1.1 若请求的是 /abp-packs/ 目录下的资源，按优先级检索：
    //    a. userAbpDir (用户目录动态解压或安装的书籍包与索引)
    //    b. resolveAbpArtifactsDir(projectRoot) (开发期按需编译产物)
    if (cleanPath.startsWith('/abp-packs/') || cleanPath.startsWith('abp-packs/')) {
      const relAbp = cleanPath.replace(/^\/?abp-packs\//, '').replace(/\.\.(\/|\\)/g, '');
      if (this.userAbpDir) {
        const userDirectPath = path.join(this.userAbpDir, relAbp);
        if (fs.existsSync(userDirectPath) && fs.statSync(userDirectPath).isFile()) {
          return userDirectPath;
        }
      }
      if (this.projectRoot) {
        const artifactDirectPath = path.join(resolveAbpArtifactsDir(this.projectRoot), relAbp);
        if (fs.existsSync(artifactDirectPath) && fs.statSync(artifactDirectPath).isFile()) {
          return artifactDirectPath;
        }
      }
    }

    // 1.1b 自包含辅助数据路由：优先从 userAbpDir 已解包的对应书籍包读取，开发期回退 artifacts/
    const auxRouteMap: Array<{ prefix: string; internalFile: string; artifactDir: string }> = [
      { prefix: '/ai-index/', internalFile: 'ai-index.json', artifactDir: 'ai-index' },
      { prefix: '/relation-graphs/', internalFile: 'relation-graph.json', artifactDir: 'relation-graphs' },
      { prefix: '/data/cross-ref/', internalFile: 'cross-refs.json', artifactDir: 'cross-ref' },
      { prefix: '/inspector-data/', internalFile: 'inspector-data.json', artifactDir: 'inspector-data' },
    ];
    for (const rule of auxRouteMap) {
      if (cleanPath.startsWith(rule.prefix) && cleanPath.endsWith('.json')) {
        const bookFileName = cleanPath.slice(rule.prefix.length);
        const bookKey = bookFileName.replace(/\.json$/i, '');
        if (!bookKey.includes('..') && !bookKey.includes('/') && !bookKey.includes('\\')) {
          if (this.userAbpDir) {
            const installedAux = path.join(this.userAbpDir, bookKey, rule.internalFile);
            if (fs.existsSync(installedAux) && fs.statSync(installedAux).isFile()) {
              return installedAux;
            }
          }
          if (this.projectRoot) {
            const artifactAux = path.join(this.projectRoot, 'artifacts', rule.artifactDir, bookFileName);
            if (fs.existsSync(artifactAux) && fs.statSync(artifactAux).isFile()) {
              return artifactAux;
            }
          }
        }
      }
    }

    // 1.1c 自包含习题数据路由 (/data/exercises/<bookSlug>/<relPath>)
    if (cleanPath.startsWith('/data/exercises/')) {
      const exRel = cleanPath.slice('/data/exercises/'.length).replace(/\.\.(\/|\\)/g, '');
      const firstSlash = exRel.indexOf('/');
      if (firstSlash > 0) {
        const exBookSlug = exRel.slice(0, firstSlash);
        const exFileRel = exRel.slice(firstSlash + 1);
        if (this.userAbpDir && fs.existsSync(this.userAbpDir)) {
          try {
            const dirs = fs.readdirSync(this.userAbpDir);
            for (const d of dirs) {
              if (d.endsWith(`-${exBookSlug}`)) {
                const candidate = path.join(this.userAbpDir, d, 'exercises', exFileRel);
                if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
                  return candidate;
                }
              }
            }
          } catch {}
        }
        if (this.projectRoot) {
          const artifactEx = path.join(this.projectRoot, 'artifacts', 'exercises', exRel);
          if (fs.existsSync(artifactEx) && fs.statSync(artifactEx).isFile()) {
            return artifactEx;
          }
        }
      }
    }

    // 1.2 若 distDir 未命中，且配置了 projectRoot，尝试从 projectRoot/public 匹配静态资产
    if (this.projectRoot) {
      const publicPath = path.join(this.projectRoot, 'public', cleanPath);
      if (fs.existsSync(publicPath) && fs.statSync(publicPath).isFile()) {
        return publicPath;
      }
    }

    // 2. 目录 index.html
    const dirIndexPath = path.join(directPath, 'index.html');
    if (fs.existsSync(dirIndexPath) && fs.statSync(dirIndexPath).isFile()) {
      return dirIndexPath;
    }

    // 3. .html 后缀补齐
    const htmlPath = directPath + '.html';
    if (fs.existsSync(htmlPath) && fs.statSync(htmlPath).isFile()) {
      return htmlPath;
    }

    // 4. ABP 章节配图资产回退 (/collections/:col/:book/images/:image 或 /collections/:col/:book/:chapter/images/:image 或 /images/:image)
    const imgMatch = cleanPath.match(/(?:^|\/)collections\/([^/]+)\/([^/]+)(?:\/[^/]+)?\/images\/(.+)$/) ||
                     cleanPath.match(/(?:^|\/)images\/(.+)$/);
    if (imgMatch) {
      const colSlug = imgMatch.length > 3 ? imgMatch[1] : '';
      const bookSlug = imgMatch.length > 3 ? imgMatch[2] : '';
      const imgRel = (imgMatch.length > 3 ? imgMatch[3] : imgMatch[1]).replace(/\.\.(\/|\\)/g, '');
      const imgFileName = path.basename(imgRel);

      const candidateDirs: string[] = [];
      if (colSlug && bookSlug) {
        if (this.userAbpDir) {
          candidateDirs.push(path.join(this.userAbpDir, `${colSlug}-${bookSlug}`));
        }
        if (this.projectRoot) {
          candidateDirs.push(path.join(resolveAbpArtifactsDir(this.projectRoot), `${colSlug}-${bookSlug}`));
          candidateDirs.push(path.join(this.projectRoot, 'content-sources', 'collections', colSlug, bookSlug));
        }
      }
      if (this.userAbpDir) candidateDirs.push(this.userAbpDir);
      candidateDirs.push(this.distDir);
      if (this.projectRoot) {
        candidateDirs.push(path.join(this.projectRoot, 'public'));
        candidateDirs.push(path.join(this.projectRoot, 'content-sources'));
      }

      for (const dir of candidateDirs) {
        const candidates = [
          path.join(dir, 'images', imgRel),
          path.join(dir, 'images', imgFileName),
          path.join(dir, imgRel),
        ];
        for (const candidate of candidates) {
          try {
            if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
              return candidate;
            }
          } catch {}
        }
      }
    }

    return null;
  }

  /**
   * 将 ABP 预编译章节数据即时合成并缓存为标准 HTML
   */
  private synthesizeAbpHtml(abpDir: string, manifestFile: string, chapJsonFile: string, chapterSlug: string): string | null {
    try {
      const cacheDir = this.userAbpDir
        ? path.join(this.userAbpDir, '.cache', path.basename(abpDir))
        : path.join(abpDir, '.cache');
      fs.mkdirSync(cacheDir, { recursive: true });
      const cachedHtmlFile = path.join(cacheDir, `${chapterSlug}.html`);
      // 多级章节 slug（如 zh-wp/001_x）会形成嵌套缓存目录，需递归创建
      fs.mkdirSync(path.dirname(cachedHtmlFile), { recursive: true });

      const manifestStat = fs.statSync(manifestFile);
      const chapStat = fs.statSync(chapJsonFile);

      // 跟踪 Starlight Master Shell 模板与引擎更新，确保应用构建升级时秒级刷新缓存
      const masterTemplateFile = path.join(this.distDir, 'reader-shell', 'index.html');
      let templateMtime = 0;
      if (fs.existsSync(masterTemplateFile)) {
        templateMtime = fs.statSync(masterTemplateFile).mtimeMs;
      }
      let engineMtime = 0;
      const engineCandidates = [
        path.join(currentDir, 'main.mjs'),
        path.join(currentDir, '..', 'dist-electron', 'main.mjs'),
        path.join(process.cwd(), 'dist-electron', 'main.mjs'),
      ];
      for (const e of engineCandidates) {
        if (fs.existsSync(e)) {
          engineMtime = Math.max(engineMtime, fs.statSync(e).mtimeMs);
        }
      }

      if (fs.existsSync(cachedHtmlFile)) {
        const cacheStat = fs.statSync(cachedHtmlFile);
        if (cacheStat.mtimeMs >= Math.max(manifestStat.mtimeMs, chapStat.mtimeMs, templateMtime, engineMtime)) {
          return cachedHtmlFile;
        }
      }

      const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
      const payload = JSON.parse(fs.readFileSync(chapJsonFile, 'utf8'));
      const html = renderReaderPageHtml(manifest, payload, this.distDir);

      fs.writeFileSync(cachedHtmlFile, html, 'utf8');
      return cachedHtmlFile;
    } catch (err) {
      console.warn('[StaticHandler] 合成 ABP HTML 失败:', err);
      return null;
    }
  }

  /**
   * 缓存控制策略
   */
  private getCacheControl(pathname: string): string {
    if (pathname.includes('/_astro/')) {
      // Astro 构建期带 Hash 资产：永久强缓存 1 年
      return 'public, max-age=31536000, immutable';
    }
    if (pathname.endsWith('.html') || pathname === '/' || !pathname.includes('.')) {
      // HTML 文件：每次协商验证
      return 'no-cache, must-revalidate';
    }
    // 其它静态资源（图片、字体）：缓存 1 天
    return 'public, max-age=86400';
  }
}
