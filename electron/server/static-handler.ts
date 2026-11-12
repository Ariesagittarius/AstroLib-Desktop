/**
 * electron/server/static-handler.ts
 * ============================================================================
 * AstroLib 静态资源服务引擎 (Zero-Dependency High-Performance Static Handler)
 * ============================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { renderReaderPageHtml } from '../../src/services/content-provider/reader-shell-template.ts';

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

    const filePath = this.resolveFilePath(safePath);
    if (!filePath || !fs.existsSync(filePath)) {
      return false;
    }

    try {
      // 1. 检查内存缓存有效性
      const cached = this.memoryCache.get(filePath);
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

      // 2. 命中内存缓存：直接纳秒级输出 Buffer
      if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
        res.writeHead(200, headers);
        res.end(cached.buffer);
        return true;
      }

      // 3. 小文件写入内存缓存
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

      // 4. 超大文件流式传输
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

    // 1.1 若请求的是 /abp-packs/ 目录下的资源，按优先级依次检索：
    //    a. userAbpDir (用户目录动态解压或安装的书籍包与索引)
    //    b. projectRoot/public/abp-packs (工程内置全量离线包与向量切片索引)
    if (cleanPath.startsWith('/abp-packs/') || cleanPath.startsWith('abp-packs/')) {
      const relAbp = cleanPath.replace(/^\/?abp-packs\//, '');
      if (this.userAbpDir) {
        const userDirectPath = path.join(this.userAbpDir, relAbp);
        if (fs.existsSync(userDirectPath) && fs.statSync(userDirectPath).isFile()) {
          return userDirectPath;
        }
      }
      if (this.projectRoot) {
        const publicDirectPath = path.join(this.projectRoot, 'public', 'abp-packs', relAbp);
        if (fs.existsSync(publicDirectPath) && fs.statSync(publicDirectPath).isFile()) {
          return publicDirectPath;
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

    // 2.1 针对 /collections/:col/:book/:chapter/ 路由，优先检索 dist/ 预渲染 Starlight HTML (兼容点号/连字符/下划线差异)
    const colChapMatch = cleanPath.match(/^\/?collections\/([^/]+)\/([^/]+)\/([^/]+)/);
    if (colChapMatch) {
      const [, colSlug, bookSlug, rawChapterSlug] = colChapMatch;
      const bookDistDir = path.join(this.distDir, 'collections', colSlug, bookSlug);
      if (fs.existsSync(bookDistDir)) {
        const directCandidate = path.join(bookDistDir, rawChapterSlug, 'index.html');
        if (fs.existsSync(directCandidate) && fs.statSync(directCandidate).isFile()) {
          return directCandidate;
        }

        const normalizedTarget = rawChapterSlug.replace(/\./g, '').replace(/[-_ ]/g, '').toLowerCase();
        try {
          const entries = fs.readdirSync(bookDistDir);
          for (const entry of entries) {
            const normEntry = entry.replace(/\./g, '').replace(/[-_ ]/g, '').toLowerCase();
            if (normEntry === normalizedTarget) {
              const candidate = path.join(bookDistDir, entry, 'index.html');
              if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
                return candidate;
              }
            }
          }
        } catch {}
      }
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
      const imgRel = imgMatch.length > 3 ? imgMatch[3] : imgMatch[1];
      const imgFileName = path.basename(imgRel);

      const candidateDirs: string[] = [];
      if (colSlug && bookSlug) {
        candidateDirs.push(path.join(this.distDir, 'abp-packs', `${colSlug}-${bookSlug}`));
        if (this.projectRoot) {
          candidateDirs.push(path.join(this.projectRoot, 'public', 'abp-packs', `${colSlug}-${bookSlug}`));
          candidateDirs.push(path.join(this.projectRoot, 'dist', 'abp-packs', `${colSlug}-${bookSlug}`));
        }
        if (this.userAbpDir) {
          candidateDirs.push(path.join(this.userAbpDir, `${colSlug}-${bookSlug}`));
        }
        candidateDirs.push(path.join(this.distDir, 'collections', colSlug, bookSlug));
        if (this.projectRoot) {
          candidateDirs.push(path.join(this.projectRoot, 'content-sources', 'collections', colSlug, bookSlug));
          candidateDirs.push(path.join(this.projectRoot, 'src', 'content', 'docs', 'collections', colSlug, bookSlug));
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

    // 5. ABP 预编译内容包动态合成回退 (/collections/:col/:book/:chapter/)
    const colMatch = cleanPath.match(/^\/?collections\/([^/]+)\/([^/]+)\/([^/]+)/);
    if (colMatch) {
      const [, colSlug, bookSlug, chapterSlug] = colMatch;
      const distCandidate = path.join(this.distDir, 'abp-packs', `${colSlug}-${bookSlug}`);
      const publicCandidate = this.projectRoot ? path.join(this.projectRoot, 'public', 'abp-packs', `${colSlug}-${bookSlug}`) : '';
      const userCandidate = this.userAbpDir ? path.join(this.userAbpDir, `${colSlug}-${bookSlug}`) : '';

      // 智能评判候选目录优先级：若内置 distDir / public 具有更新的 manifest 或用户目录缺失，优先使用内置权威内容
      let candidateDirs: string[] = [];
      let preferBundled = false;
      const bundledCandidate = (distCandidate && fs.existsSync(path.join(distCandidate, 'manifest.json')))
        ? distCandidate
        : (publicCandidate && fs.existsSync(path.join(publicCandidate, 'manifest.json')))
        ? publicCandidate
        : null;

      if (bundledCandidate) {
        if (!userCandidate || !fs.existsSync(path.join(userCandidate, 'manifest.json'))) {
          preferBundled = true;
        } else {
          try {
            const bundledMtime = fs.statSync(path.join(bundledCandidate, 'manifest.json')).mtimeMs;
            const userMtime = fs.statSync(path.join(userCandidate, 'manifest.json')).mtimeMs;
            if (bundledMtime >= userMtime) {
              preferBundled = true;
            }
          } catch {}
        }
      }

      if (preferBundled && bundledCandidate) {
        candidateDirs.push(bundledCandidate);
        if (distCandidate && distCandidate !== bundledCandidate) candidateDirs.push(distCandidate);
        if (publicCandidate && publicCandidate !== bundledCandidate) candidateDirs.push(publicCandidate);
        if (userCandidate) candidateDirs.push(userCandidate);
      } else {
        if (userCandidate) candidateDirs.push(userCandidate);
        if (distCandidate) candidateDirs.push(distCandidate);
        if (publicCandidate) candidateDirs.push(publicCandidate);
      }

      for (const abpDir of candidateDirs) {
        const manifestFile = path.join(abpDir, 'manifest.json');
        if (fs.existsSync(manifestFile)) {
          let chapJsonFile = path.join(abpDir, 'chapters', `${chapterSlug}.json`);
          if (!fs.existsSync(chapJsonFile)) {
            const chapDir = path.join(abpDir, 'chapters');
            if (fs.existsSync(chapDir)) {
              try {
                const chapFiles = fs.readdirSync(chapDir);
                const targetNorm = chapterSlug.replace(/\./g, '').replace(/[-_ ]/g, '').toLowerCase();
                const found = chapFiles.find((f) => {
                  const base = f.replace(/\.json$/, '');
                  if (base === chapterSlug) return true;
                  if (base.toLowerCase() === chapterSlug.toLowerCase()) return true;
                  const baseNorm = base.replace(/\./g, '').replace(/[-_ ]/g, '').toLowerCase();
                  if (baseNorm === targetNorm) return true;
                  return false;
                });
                if (found) {
                  chapJsonFile = path.join(chapDir, found);
                }
              } catch {}
            }
          }

          if (fs.existsSync(chapJsonFile)) {
            return this.synthesizeAbpHtml(abpDir, manifestFile, chapJsonFile, chapterSlug);
          }
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
