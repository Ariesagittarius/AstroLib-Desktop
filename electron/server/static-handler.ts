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
import { renderReaderPageHtml } from './reader-shell-template.ts';
import { cleanSlug } from '../../src/utils/slug.ts';
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

    // 5. ABP 动态内容包实时合成 (/collections/:col/:book/:chapter/)
    const colMatch = cleanPath.match(/^\/?collections\/([^/]+)\/([^/]+)\/([^/]+)/);
    if (colMatch) {
      const [, colSlug, bookSlug, rawChapterSlug] = colMatch;
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

      const canonicalQuerySlug = cleanSlug(rawChapterSlug);
      for (const abpDir of candidateDirs) {
        const manifestFile = path.join(abpDir, 'manifest.json');
        if (!fs.existsSync(manifestFile)) continue;

        let resolvedSlug = rawChapterSlug;
        let chapJsonFile = path.join(abpDir, 'chapters', `${resolvedSlug}.json`);

        if (!fs.existsSync(chapJsonFile) && canonicalQuerySlug && canonicalQuerySlug !== rawChapterSlug) {
          const canonicalCandidate = path.join(abpDir, 'chapters', `${canonicalQuerySlug}.json`);
          if (fs.existsSync(canonicalCandidate)) {
            resolvedSlug = canonicalQuerySlug;
            chapJsonFile = canonicalCandidate;
          }
        }

        // 若直接匹配未命中，检索 manifest 中的 legacySlug / canonicalSlug 别名映射（零模糊扫描）
        if (!fs.existsSync(chapJsonFile)) {
          try {
            const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')) as AstroBookManifest;
            const sections: AstroBookSection[] = Array.isArray(manifest.sections) ? manifest.sections : [];
            for (const sec of sections) {
              const matched = (sec.chapters || []).find(
                (ch) =>
                  ch.slug === rawChapterSlug ||
                  ch.legacySlug === rawChapterSlug ||
                  cleanSlug(ch.slug) === canonicalQuerySlug
              );
              if (matched) {
                const aliasCandidate = path.join(abpDir, 'chapters', `${matched.slug}.json`);
                if (fs.existsSync(aliasCandidate)) {
                  resolvedSlug = matched.slug;
                  chapJsonFile = aliasCandidate;
                  break;
                }
              }
            }
          } catch {}
        }

        if (fs.existsSync(chapJsonFile)) {
          return this.synthesizeAbpHtml(abpDir, manifestFile, chapJsonFile, resolvedSlug);
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
