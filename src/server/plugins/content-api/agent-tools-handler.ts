import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { findProjectRoot, resolveCollectionsRoot } from '../../../core/catalog/content-paths.ts';
import { KnowledgeRegistry } from '../../../core/knowledge/knowledge-registry.ts';
import {
  clearAgentPythonCache,
  findAgentPythonExecutable,
  findBestPythonExecutable,
  getAgentPythonEnvInfo,
} from '../../../services/pdf2abp/python-runner.ts';
import { inspectPdf, renderPdfPages } from '../../../services/pdf2abp/pdf-processor.ts';
import { validateBookDirectory } from '../../../publishing/abp/index.ts';
import {
  executeWebSearch,
  type WebSearchProviderKind,
} from '../../../services/web-search/web-search-service.ts';

export interface CanvasCaptureRequest {
  html: string;
  width?: number;
  height?: number;
  darkTheme?: boolean;
}

export interface CanvasCaptureResult {
  available: boolean;
  screenshotDataUrl?: string;
  width?: number;
  height?: number;
  consoleErrors: string[];
  overflowX: boolean;
  overflowY: boolean;
  katexNodeCount: number;
  katexErrorCount: number;
  note?: string;
}

export type ElectronCanvasCapturer = (req: CanvasCaptureRequest) => Promise<CanvasCaptureResult>;

let electronCanvasCapturer: ElectronCanvasCapturer | null = null;

export function registerElectronCanvasCapturer(fn: ElectronCanvasCapturer | null): void {
  electronCanvasCapturer = fn;
}

const execFileAsync = promisify(execFile);

export const ALLOWED_SOURCE_PREFIXES = [
  'src/plugins/harness/',
  'src/features/harness/',
  'src/ai/agent/',
  'src/server/plugins/content-api/',
  'src/components/harness/',
];

const ALLOWED_SOURCE_EXTS = new Set(['.ts', '.mjs', '.astro', '.js']);
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.svg', '.webp', '.gif']);

const MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.log': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.py': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.mdx': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
};

export function getAgentSandboxRoot(): string {
  const dir = process.env.ASTROLIB_AGENT_WORKSPACE
    ? path.resolve(process.env.ASTROLIB_AGENT_WORKSPACE)
    : path.join(os.homedir(), '.astrolib', 'agent-workspace');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function isPathInside(parentDir: string, targetPath: string): boolean {
  const parent = path.resolve(parentDir);
  const target = path.resolve(targetPath);
  const rel = path.relative(parent, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function resolvePathScope(targetPath: string): {
  absPath: string;
  scope: 'workspace' | 'project' | 'local';
  relPath: string;
} {
  const sandbox = getAgentSandboxRoot();
  const projectRoot = findProjectRoot();
  const raw = (targetPath || '').trim();

  if (!raw || raw === '.' || raw === 'workspace' || raw === 'sandbox') {
    return { absPath: sandbox, scope: 'workspace', relPath: '.' };
  }

  let absPath: string;
  if (path.isAbsolute(raw)) {
    absPath = path.resolve(raw);
  } else if (raw.startsWith('workspace/') || raw.startsWith('workspace\\')) {
    absPath = path.resolve(sandbox, raw.slice('workspace/'.length));
  } else {
    const projectCandidate = path.resolve(projectRoot, raw);
    if (fs.existsSync(projectCandidate)) {
      absPath = projectCandidate;
    } else {
      absPath = path.resolve(sandbox, raw);
    }
  }

  if (isPathInside(sandbox, absPath)) {
    return {
      absPath,
      scope: 'workspace',
      relPath: path.relative(sandbox, absPath).replace(/\\/g, '/') || '.',
    };
  }
  if (isPathInside(projectRoot, absPath)) {
    return {
      absPath,
      scope: 'project',
      relPath: path.relative(projectRoot, absPath).replace(/\\/g, '/') || '.',
    };
  }
  return {
    absPath,
    scope: 'local',
    relPath: absPath.replace(/\\/g, '/'),
  };
}

export function validateWhitelistedSourceFile(relFile: string): {
  allowed: boolean;
  absPath?: string;
  normalizedRel?: string;
  reason?: string;
} {
  const clean = (relFile || '').trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!clean || clean.includes('..')) {
    return { allowed: false, reason: '非法文件路径' };
  }
  const matchesPrefix = ALLOWED_SOURCE_PREFIXES.some((prefix) => clean.startsWith(prefix));
  if (!matchesPrefix) {
    return { allowed: false, reason: '文件路径不在允许检视的工具源码白名单目录内' };
  }
  const ext = path.extname(clean).toLowerCase();
  if (!ALLOWED_SOURCE_EXTS.has(ext)) {
    return { allowed: false, reason: '仅允许查看源码文件 (.ts / .mjs / .astro / .js)' };
  }
  const projectRoot = findProjectRoot();
  const absPath = path.resolve(projectRoot, clean);
  if (!isPathInside(projectRoot, absPath)) {
    return { allowed: false, reason: '路径越界' };
  }
  if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
    return { allowed: false, reason: '源文件不存在' };
  }
  return { allowed: true, absPath, normalizedRel: clean };
}

function resolveRipgrepExecutable(): string | null {
  try {
    const req = createRequire(import.meta.url);
    const arch = process.env.npm_config_arch || process.arch;
    const bin = process.platform === 'win32' ? 'rg.exe' : 'rg';
    const resolved = req.resolve(`@vscode/ripgrep-${process.platform}-${arch}/bin/${bin}`);
    if (resolved && fs.existsSync(resolved)) return resolved;
  } catch {}

  try {
    const projectRoot = findProjectRoot();
    const arch = process.env.npm_config_arch || process.arch;
    const bin = process.platform === 'win32' ? 'rg.exe' : 'rg';
    const candidate = path.join(
      projectRoot,
      'node_modules',
      `@vscode/ripgrep-${process.platform}-${arch}`,
      'bin',
      bin
    );
    if (fs.existsSync(candidate)) return candidate;
  } catch {}
  return null;
}

function collectFilesRecursive(dir: string, exts: Set<string>, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      collectFilesRecursive(full, exts, out);
    } else if (entry.isFile()) {
      if (exts.size === 0 || exts.has(path.extname(entry.name).toLowerCase())) {
        out.push(full);
      }
    }
  }
  return out;
}

function listSandboxImages(sandboxDir: string): Map<string, number> {
  const map = new Map<string, number>();
  const walk = (dir: string, depth: number) => {
    if (depth > 3 || !fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === 'pdf-renders' || ent.name.startsWith('.')) continue;
        walk(full, depth + 1);
      } else if (ent.isFile() && IMAGE_EXTS.has(path.extname(ent.name).toLowerCase())) {
        try {
          const stat = fs.statSync(full);
          const rel = path.relative(sandboxDir, full).replace(/\\/g, '/');
          map.set(rel, stat.mtimeMs);
        } catch {}
      }
    }
  };
  walk(sandboxDir, 0);
  return map;
}

function sendJson(res: http.ServerResponse, statusCode: number, data: unknown): void {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
  });
  res.end(JSON.stringify(data));
}

async function readJsonBody(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf-8');
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export async function handleAgentToolsRoute(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  subPath: string,
  parsedUrl: URL
): Promise<boolean> {
  if (!subPath.startsWith('/agent-tools/')) {
    return false;
  }

  try {

    if (req.method === 'GET' && subPath === '/agent-tools/workspace-file') {
      const relPath = (parsedUrl.searchParams.get('path') || '').trim();
      const sandbox = getAgentSandboxRoot();
      const absPath = path.resolve(sandbox, relPath);
      if (!relPath || !isPathInside(sandbox, absPath)) {
        sendJson(res, 403, { success: false, error: '路径不在工作区沙箱内' });
        return true;
      }
      if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
        sendJson(res, 404, { success: false, error: '工作区文件不存在' });
        return true;
      }
      const ext = path.extname(absPath).toLowerCase();
      const mime = MIME_MAP[ext] || 'application/octet-stream';
      const buf = fs.readFileSync(absPath);
      res.writeHead(200, {
        'Content-Type': mime,
        'Content-Length': buf.byteLength,
        'Cache-Control': 'no-cache',
      });
      res.end(buf);
      return true;
    }

    if (req.method === 'GET' && subPath === '/agent-tools/source') {
      const file = parsedUrl.searchParams.get('file') || '';
      const check = validateWhitelistedSourceFile(file);
      if (!check.allowed || !check.absPath) {
        sendJson(res, 403, { success: false, error: check.reason || '禁止访问' });
        return true;
      }
      const content = fs.readFileSync(check.absPath, 'utf-8');
      sendJson(res, 200, {
        success: true,
        data: {
          file: check.normalizedRel,
          absPath: check.absPath,
          lineCount: content.split(/\r?\n/).length,
          content,
        },
      });
      return true;
    }

    if (req.method === 'POST' && subPath === '/agent-tools/reveal') {
      const body = await readJsonBody(req);
      const check = validateWhitelistedSourceFile(String(body.file || ''));
      if (!check.allowed || !check.absPath) {
        sendJson(res, 403, { success: false, error: check.reason || '路径不在白名单内' });
        return true;
      }
      sendJson(res, 200, {
        success: true,
        data: { file: check.normalizedRel, absPath: check.absPath },
      });
      return true;
    }

    if (req.method === 'POST' && subPath === '/agent-tools/python') {
      const body = await readJsonBody(req);
      const code = typeof body.code === 'string' ? body.code : '';
      const scriptRelPath = typeof body.scriptRelPath === 'string' ? body.scriptRelPath.trim() : '';
      const timeoutMs = Math.max(1000, Math.min(60000, Number(body.timeoutMs) || 30000));
      const customPy = typeof body.pythonPath === 'string' ? body.pythonPath.trim() : undefined;

      const pythonExe = await findAgentPythonExecutable(customPy);
      if (!pythonExe) {
        sendJson(res, 400, {
          success: false,
          error: '未检测到可用 Agent Python 解释器。请在设置中配置路径或创建 .venv-agent 沙箱。',
        });
        return true;
      }

      const sandbox = getAgentSandboxRoot();
      const scriptsDir = path.join(sandbox, 'scripts');
      fs.mkdirSync(scriptsDir, { recursive: true });

      let targetScriptAbs: string;
      let targetScriptRel: string;
      if (code.trim()) {
        const fname = `_chat_run_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.py`;
        targetScriptRel = `scripts/${fname}`;
        targetScriptAbs = path.join(sandbox, targetScriptRel);
        fs.writeFileSync(targetScriptAbs, code, 'utf-8');
      } else if (scriptRelPath) {
        targetScriptAbs = path.resolve(sandbox, scriptRelPath);
        if (!isPathInside(sandbox, targetScriptAbs) || !fs.existsSync(targetScriptAbs)) {
          sendJson(res, 403, { success: false, error: '脚本不存在或超出工作区沙箱范围' });
          return true;
        }
        targetScriptRel = path.relative(sandbox, targetScriptAbs).replace(/\\/g, '/');
      } else {
        sendJson(res, 400, { success: false, error: '必须提供 Python code 或 scriptRelPath' });
        return true;
      }

      const beforeImages = listSandboxImages(sandbox);
      const t0 = Date.now();
      let exitCode = 0;
      let rawStdout = '';
      let rawStderr = '';

      try {
        const pyArgs = Array.isArray(body.args) ? body.args.map(String) : [];
        const resExec = await execFileAsync(pythonExe, [targetScriptAbs, ...pyArgs], {
          cwd: sandbox,
          timeout: timeoutMs,
          maxBuffer: 4 * 1024 * 1024,
          env: {
            ...process.env,
            PYTHONUTF8: '1',
            PYTHONIOENCODING: 'utf-8',
            MPLBACKEND: 'Agg',
            ASTROLIB_AGENT_SANDBOX: sandbox,
            ASTROLIB_PROJECT_ROOT: findProjectRoot(),
          },
        });
        rawStdout = resExec.stdout || '';
        rawStderr = resExec.stderr || '';
      } catch (err: any) {
        exitCode = typeof err?.code === 'number' ? err.code : 1;
        rawStdout = err?.stdout || '';
        rawStderr = err?.stderr || err?.message || String(err);
      }

      const durationMs = Date.now() - t0;
      const afterImages = listSandboxImages(sandbox);
      const createdImages: Array<{ name: string; relPath: string; url: string }> = [];
      for (const [rel, mtime] of afterImages.entries()) {
        const prevMtime = beforeImages.get(rel);
        if (prevMtime === undefined || mtime > prevMtime) {
          createdImages.push({
            name: path.basename(rel),
            relPath: rel,
            url: `/api/v1/content/agent-tools/workspace-file?path=${encodeURIComponent(rel)}`,
          });
        }
      }

      const MAX_OUT = 12000;
      const truncated = rawStdout.length > MAX_OUT || rawStderr.length > 4000;
      const stdout = rawStdout.length > MAX_OUT ? rawStdout.slice(0, MAX_OUT) + '\n... [stdout truncated]' : rawStdout;
      const stderr = rawStderr.length > 4000 ? rawStderr.slice(0, 4000) + '\n... [stderr truncated]' : rawStderr;

      sendJson(res, 200, {
        success: exitCode === 0,
        data: {
          exitCode,
          durationMs,
          scriptRelPath: targetScriptRel,
          stdout,
          stderr,
          truncated,
          images: createdImages,
        },
      });
      return true;
    }

    if (req.method === 'POST' && subPath === '/agent-tools/fs/list') {
      const body = await readJsonBody(req);
      const { absPath, scope, relPath } = resolvePathScope(String(body.dirPath || ''));
      const maxDepth = Math.max(1, Math.min(4, Number(body.maxDepth) || 2));

      if (!fs.existsSync(absPath) || !fs.statSync(absPath).isDirectory()) {
        sendJson(res, 404, { success: false, error: `目录不存在: ${body.dirPath || '.'}` });
        return true;
      }

      const entries: Array<{ name: string; relPath: string; isDirectory: boolean; sizeBytes: number }> = [];
      const walk = (dir: string, depth: number) => {
        if (depth > maxDepth || entries.length >= 200) return;
        let items: fs.Dirent[];
        try {
          items = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const ent of items) {
          if (entries.length >= 200) break;
          if (ent.name === 'node_modules' || ent.name === '.git' || ent.name === '.astro') continue;
          const full = path.join(dir, ent.name);
          const rel = path.relative(absPath, full).replace(/\\/g, '/');
          if (ent.isDirectory()) {
            entries.push({ name: ent.name, relPath: rel + '/', isDirectory: true, sizeBytes: 0 });
            walk(full, depth + 1);
          } else {
            let sizeBytes = 0;
            try {
              sizeBytes = fs.statSync(full).size;
            } catch {}
            entries.push({ name: ent.name, relPath: rel, isDirectory: false, sizeBytes });
          }
        }
      };
      walk(absPath, 1);

      sendJson(res, 200, {
        success: true,
        data: {
          scope,
          resolvedPath: absPath,
          relPath,
          count: entries.length,
          truncated: entries.length >= 200,
          entries,
        },
      });
      return true;
    }

    if (req.method === 'POST' && subPath === '/agent-tools/fs/read') {
      const body = await readJsonBody(req);
      const rawPath = String(body.filePath || '').trim();
      if (!rawPath) {
        sendJson(res, 400, { success: false, error: '缺少 filePath 参数' });
        return true;
      }

      const { absPath, scope, relPath } = resolvePathScope(rawPath);
      if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
        sendJson(res, 404, { success: false, error: `文件不存在: ${rawPath}` });
        return true;
      }

      const stat = fs.statSync(absPath);
      if (stat.size > 5 * 1024 * 1024) {
        sendJson(res, 400, {
          success: false,
          error: `文件体积过大 (${(stat.size / 1048576).toFixed(1)} MB)，请改用搜索或专用解析工具。`,
        });
        return true;
      }

      const rawText = fs.readFileSync(absPath, 'utf-8');
      if (rawText.includes('\u0000')) {
        sendJson(res, 400, { success: false, error: '检测到二进制文件，请使用 PDF 或图像工具读取。' });
        return true;
      }

      const lines = rawText.split(/\r?\n/);
      const startLine = Math.max(1, Number(body.startLine) || 1);
      const endLine = Math.min(lines.length, Number(body.endLine) || Math.min(lines.length, startLine + 249));
      const maxChars = Math.max(500, Math.min(32000, Number(body.maxChars) || 16000));

      let content = lines.slice(startLine - 1, endLine).join('\n');
      let truncated = endLine < lines.length;
      if (content.length > maxChars) {
        content = content.slice(0, maxChars) + '\n... [content truncated]';
        truncated = true;
      }

      sendJson(res, 200, {
        success: true,
        data: {
          scope,
          resolvedPath: absPath,
          relPath,
          totalLines: lines.length,
          startLine,
          endLine,
          truncated,
          content,
        },
      });
      return true;
    }

    if (req.method === 'POST' && subPath === '/agent-tools/fs/write') {
      const body = await readJsonBody(req);
      const relPath = String(body.relPath || '').trim();
      const content = typeof body.content === 'string' ? body.content : '';
      if (!relPath) {
        sendJson(res, 400, { success: false, error: '缺少 relPath 参数' });
        return true;
      }
      const sandbox = getAgentSandboxRoot();
      const absPath = path.resolve(sandbox, relPath);
      if (!isPathInside(sandbox, absPath) || absPath === sandbox) {
        sendJson(res, 403, { success: false, error: '安全限制：仅允许在 Agent 隔离工作区内创建或修改文件' });
        return true;
      }
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, content, 'utf-8');
      const normalizedRel = path.relative(sandbox, absPath).replace(/\\/g, '/');
      sendJson(res, 200, {
        success: true,
        data: {
          relPath: normalizedRel,
          absPath,
          bytesWritten: Buffer.byteLength(content, 'utf-8'),
        },
      });
      return true;
    }

    if (req.method === 'POST' && subPath === '/agent-tools/search-library') {
      const body = await readJsonBody(req);
      const query = String(body.query || '').trim();
      if (!query) {
        sendJson(res, 400, { success: false, error: '检索词 query 不能为空' });
        return true;
      }
      const limit = Math.max(1, Math.min(40, Number(body.limit) || 15));
      const collectionsRoot = resolveCollectionsRoot();
      let searchDir = collectionsRoot;
      if (body.colSlug && body.bookSlug) {
        const cand = path.resolve(collectionsRoot, String(body.colSlug), String(body.bookSlug));
        if (isPathInside(collectionsRoot, cand) && fs.existsSync(cand)) {
          searchDir = cand;
        }
      } else if (body.colSlug) {
        const cand = path.resolve(collectionsRoot, String(body.colSlug));
        if (isPathInside(collectionsRoot, cand) && fs.existsSync(cand)) {
          searchDir = cand;
        }
      }

      if (!fs.existsSync(searchDir)) {
        sendJson(res, 200, { success: true, data: { engine: 'none', hits: [] } });
        return true;
      }

      const hits: Array<{
        uri: string;
        colSlug: string;
        bookSlug: string;
        chapterSlug: string;
        docTitle?: string;
        sectionTitle?: string;
        kind?: 'book' | 'paper';
        sourceFormat?: string;
        lineNumber: number;
        page?: number;
        text: string;
      }> = [];
      const seenHitKeys = new Set<string>();

      const pushUniqueHit = (h: (typeof hits)[number]) => {
        const key = `${h.colSlug}/${h.bookSlug}/${h.chapterSlug}:${h.lineNumber}:${h.text.slice(0, 40)}`;
        if (seenHitKeys.has(key)) return;
        seenHitKeys.add(key);
        hits.push(h);
      };

      const mapFileToUri = (filePath: string) => {
        const rel = path.relative(collectionsRoot, filePath).replace(/\\/g, '/');
        const parts = rel.split('/');
        const colSlug = parts[0] || '';
        const bookSlug = parts[1] || '';
        const chapterSlug = parts.slice(2).join('/').replace(/\.(mdx|md)$/i, '');
        return {
          colSlug,
          bookSlug,
          chapterSlug,
          uri: colSlug && bookSlug && chapterSlug ? `astrolib://${colSlug}/${bookSlug}/${chapterSlug}` : rel,
        };
      };

      const rgExe = resolveRipgrepExecutable();
      let usedEngine = 'node-fallback';
      const searchMdx =
        (!body.kind || body.kind === 'all' || body.kind === 'book') &&
        (!body.format || body.format === 'all' || body.format === 'mdx') &&
        body.colSlug !== 'paper';

      if (searchMdx && fs.existsSync(searchDir)) {
        if (rgExe) {
          try {
            usedEngine = 'ripgrep+knowledge';
            const args = [
              '--json',
              '--line-number',
              '--ignore-case',
              '--max-count',
              '4',
              '--glob',
              '*.{mdx,md}',
              ...(body.regex ? [] : ['--fixed-strings']),
              query,
              searchDir,
            ];
            const out = await execFileAsync(rgExe, args, {
              timeout: 10000,
              maxBuffer: 4 * 1024 * 1024,
            }).catch((e) => ({ stdout: e?.stdout || '', stderr: e?.stderr || '' }));

            for (const line of (out.stdout || '').split('\n')) {
              if (!line.trim()) continue;
              try {
                const obj = JSON.parse(line);
                if (obj.type === 'match') {
                  const filePath = obj.data?.path?.text || '';
                  const lineNumber = obj.data?.line_number || 0;
                  const text = (obj.data?.lines?.text || '').trim().slice(0, 220);
                  const mapped = mapFileToUri(filePath);
                  pushUniqueHit({
                    ...mapped,
                    kind: 'book',
                    sourceFormat: 'mdx',
                    lineNumber,
                    text,
                  });
                  if (hits.length >= limit) break;
                }
              } catch {}
            }
          } catch {
            usedEngine = 'node-fallback+knowledge';
          }
        }

        if (usedEngine === 'node-fallback' && hits.length === 0) {
          const files = collectFilesRecursive(searchDir, new Set(['.mdx', '.md']));
          const matcher = body.regex ? new RegExp(query, 'i') : null;
          const lowerQ = query.toLowerCase();

          for (const f of files) {
            if (hits.length >= limit) break;
            let txt = '';
            try {
              txt = fs.readFileSync(f, 'utf-8');
            } catch {
              continue;
            }
            const lines = txt.split(/\r?\n/);
            let fileMatches = 0;
            for (let i = 0; i < lines.length; i++) {
              const line = lines[i];
              const matched = matcher ? matcher.test(line) : line.toLowerCase().includes(lowerQ);
              if (matched) {
                const mapped = mapFileToUri(f);
                pushUniqueHit({
                  ...mapped,
                  kind: 'book',
                  sourceFormat: 'mdx',
                  lineNumber: i + 1,
                  text: line.trim().slice(0, 220),
                });
                fileMatches++;
                if (fileMatches >= 4 || hits.length >= limit) break;
              }
            }
          }
        }
      } else {
        usedEngine = 'knowledge-registry';
      }

      if (hits.length < limit) {
        const regHits = KnowledgeRegistry.getInstance().searchAll(query, {
          kind: body.kind || 'all',
          format: body.format || 'all',
          colSlug: body.colSlug ? String(body.colSlug) : undefined,
          docSlug: body.bookSlug || body.docSlug ? String(body.bookSlug || body.docSlug) : undefined,
          regex: Boolean(body.regex),
          limit: limit,
        });
        for (const rh of regHits) {
          if (hits.length >= limit) break;
          pushUniqueHit({
            uri: rh.uri,
            colSlug: rh.colSlug,
            bookSlug: rh.docSlug,
            chapterSlug: rh.sectionId,
            docTitle: rh.docTitle,
            sectionTitle: rh.sectionTitle,
            kind: rh.kind,
            sourceFormat: rh.sourceFormat,
            lineNumber: rh.lineNumber || 1,
            page: rh.page,
            text: rh.snippet,
          });
        }
      }

      sendJson(res, 200, {
        success: true,
        data: {
          engine: usedEngine,
          query,
          count: hits.length,
          hits,
        },
      });
      return true;
    }

    if (req.method === 'POST' && subPath === '/agent-tools/pdf/inspect') {
      const body = await readJsonBody(req);
      const pdfPath = String(body.pdfPath || '').trim();
      if (!pdfPath) {
        sendJson(res, 400, { success: false, error: '缺少 pdfPath 参数' });
        return true;
      }
      const { absPath } = resolvePathScope(pdfPath);
      if (!fs.existsSync(absPath)) {
        sendJson(res, 404, { success: false, error: `PDF 文件不存在: ${pdfPath}` });
        return true;
      }
      const info = await inspectPdf(absPath);
      sendJson(res, 200, { success: true, data: info });
      return true;
    }

    if (req.method === 'POST' && subPath === '/agent-tools/pdf/render') {
      const body = await readJsonBody(req);
      const pdfPath = String(body.pdfPath || '').trim();
      const pagesInput = Array.isArray(body.pages) ? body.pages : [1];
      const pages = Array.from(
        new Set(pagesInput.map((n: any) => Math.max(1, Math.floor(Number(n) || 1))))
      ).slice(0, 4) as number[];
      const dpi = Math.max(72, Math.min(220, Number(body.dpi) || 140));

      const { absPath } = resolvePathScope(pdfPath);
      if (!pdfPath || !fs.existsSync(absPath)) {
        sendJson(res, 404, { success: false, error: `PDF 文件不存在: ${pdfPath}` });
        return true;
      }

      const sandbox = getAgentSandboxRoot();
      const outDir = path.join(sandbox, 'pdf-renders', `${Date.now()}`);
      const rendered = await renderPdfPages(absPath, pages, outDir, {
        dpi,
        quality: 84,
        workspaceRoot: sandbox,
      });

      const items = rendered.map((r) => ({
        page: r.page,
        width: r.width,
        height: r.height,
        relPath: r.relPath,
        url: `/api/v1/content/agent-tools/workspace-file?path=${encodeURIComponent(r.relPath)}`,
      }));

      sendJson(res, 200, { success: true, data: { pages: items } });
      return true;
    }

    if (req.method === 'POST' && subPath === '/agent-tools/mdx/validate') {
      const body = await readJsonBody(req);
      let targetAbs = '';
      if (typeof body.content === 'string' && body.content.trim()) {
        const sandbox = getAgentSandboxRoot();
        const tmpFile = path.join(sandbox, 'mdx-check', `snippet_${Date.now()}.mdx`);
        fs.mkdirSync(path.dirname(tmpFile), { recursive: true });
        fs.writeFileSync(tmpFile, body.content, 'utf-8');
        targetAbs = tmpFile;
      } else if (typeof body.targetPath === 'string' && body.targetPath.trim()) {
        targetAbs = resolvePathScope(body.targetPath).absPath;
      } else {
        sendJson(res, 400, { success: false, error: '必须提供 targetPath 或 content' });
        return true;
      }

      if (!fs.existsSync(targetAbs)) {
        sendJson(res, 404, { success: false, error: '目标文件或目录不存在' });
        return true;
      }

      const report = await validateBookDirectory(targetAbs, {
        skipMath: Boolean(body.skipMath),
        skipMdxCompile: Boolean(body.skipMdxCompile),
      });
      sendJson(res, 200, {
        success: true,
        data: {
          ...report,
          errors: report.errors.slice(0, 30),
          warnings: report.warnings.slice(0, 20),
        },
      });
      return true;
    }

    if (req.method === 'GET' && subPath === '/agent-tools/python/env') {
      const force = parsedUrl.searchParams.get('force') === '1';
      const customPath = parsedUrl.searchParams.get('pythonPath') || undefined;
      const envInfo = await getAgentPythonEnvInfo(customPath, force);
      sendJson(res, 200, { success: true, data: envInfo });
      return true;
    }

    if (req.method === 'POST' && subPath === '/agent-tools/python/packages/install') {
      const body = await readJsonBody(req);
      const rawList = Array.isArray(body.packages)
        ? body.packages
        : typeof body.package === 'string'
          ? [body.package]
          : [];
      const PKG_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
      const cleanPkgs: string[] = [];
      for (const item of rawList) {
        const s = String(item || '').trim();
        if (!s || !PKG_RE.test(s)) {
          sendJson(res, 400, {
            success: false,
            error: `非法的 PyPI 包名 "${s}"：仅支持合法发行包标识（不允许 URL 或命令参数）。`,
          });
          return true;
        }
        cleanPkgs.push(s);
      }
      if (cleanPkgs.length === 0 || cleanPkgs.length > 8) {
        sendJson(res, 400, {
          success: false,
          error: '每次请提供 1 到 8 个合法 Python 包名。',
        });
        return true;
      }

      const customPy = typeof body.pythonPath === 'string' ? body.pythonPath.trim() : undefined;
      let envInfo = await getAgentPythonEnvInfo(customPy, false);
      let targetExe = envInfo.pythonPath;

      if (!envInfo.isolated) {
        const basePy = await findBestPythonExecutable();
        if (!basePy) {
          sendJson(res, 400, {
            success: false,
            error: '未找到基础 Python 解释器，无法创建隔离的 .venv-agent 沙箱。',
          });
          return true;
        }
        const venvTarget = envInfo.sandboxDir;
        try {
          await execFileAsync(basePy, ['-m', 'venv', venvTarget], { timeout: 60_000 });
          clearAgentPythonCache();
          envInfo = await getAgentPythonEnvInfo(customPy, true);
          targetExe = envInfo.pythonPath;
        } catch (err: any) {
          sendJson(res, 500, {
            success: false,
            error: `创建独立 .venv-agent 沙箱失败: ${err?.message || String(err)}`,
          });
          return true;
        }
      }

      if (!targetExe) {
        sendJson(res, 400, { success: false, error: '未找到可用的 Agent Python 解释器。' });
        return true;
      }

      try {
        const { stdout, stderr } = await execFileAsync(
          targetExe,
          [
            '-m',
            'pip',
            'install',
            '-i',
            'https://mirrors.aliyun.com/pypi/simple/',
            '--only-binary=:all:',
            ...cleanPkgs,
          ],
          {
            timeout: 120_000,
            maxBuffer: 4 * 1024 * 1024,
            env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
          }
        );
        clearAgentPythonCache();
        const updatedEnv = await getAgentPythonEnvInfo(customPy, true);
        sendJson(res, 200, {
          success: true,
          data: {
            installed: cleanPkgs,
            stdout: stdout.slice(-4000),
            stderr: stderr.slice(-2000),
            env: updatedEnv,
          },
        });
      } catch (err: any) {
        sendJson(res, 500, {
          success: false,
          error: `安装失败（注意：当前仅允许安装提供预编译 wheel 的包，不执行本地源码编译）: ${err?.stderr || err?.message || String(err)}`.slice(
            0,
            2000
          ),
        });
      }
      return true;
    }

    if (req.method === 'POST' && subPath === '/agent-tools/python/packages/uninstall') {
      const body = await readJsonBody(req);
      const pkg = String(body.package || '').trim();
      const PKG_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
      const PROTECTED = new Set(['pip', 'setuptools', 'wheel', 'pymupdf', 'pypdf']);
      if (!pkg || !PKG_RE.test(pkg) || PROTECTED.has(pkg.toLowerCase())) {
        sendJson(res, 400, {
          success: false,
          error: `包 "${pkg}" 受保护或格式不合法，禁止卸载。`,
        });
        return true;
      }
      const customPy = typeof body.pythonPath === 'string' ? body.pythonPath.trim() : undefined;
      const envInfo = await getAgentPythonEnvInfo(customPy, false);
      if (!envInfo.available || !envInfo.pythonPath || !envInfo.isolated) {
        sendJson(res, 400, {
          success: false,
          error: '仅允许在隔离的 .venv-agent 沙箱内卸载可选包。',
        });
        return true;
      }
      try {
        const { stdout } = await execFileAsync(
          envInfo.pythonPath,
          ['-m', 'pip', 'uninstall', '-y', pkg],
          { timeout: 45_000 }
        );
        clearAgentPythonCache();
        const updatedEnv = await getAgentPythonEnvInfo(customPy, true);
        sendJson(res, 200, {
          success: true,
          data: { removed: pkg, stdout, env: updatedEnv },
        });
      } catch (err: any) {
        sendJson(res, 500, { success: false, error: err?.message || String(err) });
      }
      return true;
    }

    if (req.method === 'POST' && subPath === '/agent-tools/canvas/capture') {
      const body = await readJsonBody(req);
      const html = typeof body.html === 'string' ? body.html : '';
      if (!html.trim()) {
        sendJson(res, 400, { success: false, error: '缺少待渲染的完整沙箱 html 内容' });
        return true;
      }

      if (!electronCanvasCapturer) {
        sendJson(res, 200, {
          success: true,
          data: {
            available: false,
            consoleErrors: [],
            overflowX: false,
            overflowY: false,
            katexNodeCount: 0,
            katexErrorCount: 0,
            note: 'Offscreen screenshot capture requires the Electron desktop shell; dev browser mode relies on iframe ASTROLIB_CANVAS_TELEMETRY + source inspection.',
          } satisfies CanvasCaptureResult,
        });
        return true;
      }

      const captured = await electronCanvasCapturer({
        html,
        width: Number(body.width) || 900,
        height: Number(body.height) || 620,
        darkTheme: Boolean(body.darkTheme),
      });
      sendJson(res, 200, { success: true, data: captured });
      return true;
    }

    if (req.method === 'POST' && subPath === '/agent-tools/image/read') {
      const body = await readJsonBody(req);
      let rawPath = String(body.path || '').trim();
      if (!rawPath) {
        sendJson(res, 400, { success: false, error: '缺少 path 参数' });
        return true;
      }

      if (rawPath.includes('/workspace-file?')) {
        try {
          const parsedApi = new URL(rawPath, 'http://127.0.0.1');
          const relQ = parsedApi.searchParams.get('path');
          if (relQ) rawPath = relQ;
        } catch {}
      }

      const { absPath, scope } = resolvePathScope(rawPath);
      if (!fs.existsSync(absPath) || fs.statSync(absPath).isDirectory()) {
        sendJson(res, 404, { success: false, error: `图像文件不存在: ${rawPath}` });
        return true;
      }

      const ext = path.extname(absPath).toLowerCase();
      if (!IMAGE_EXTS.has(ext)) {
        sendJson(res, 400, { success: false, error: `不支持的图像扩展名: ${ext}` });
        return true;
      }

      const stat = fs.statSync(absPath);
      if (stat.size > 6 * 1024 * 1024) {
        sendJson(res, 400, {
          success: false,
          error: `图像体积 ${(stat.size / 1024 / 1024).toFixed(2)} MB 超过 6MB 上限。`,
        });
        return true;
      }

      const buf = fs.readFileSync(absPath);
      const mimeType = MIME_MAP[ext] || 'image/png';
      const dataUrl = `data:${mimeType};base64,${buf.toString('base64')}`;
      const sandbox = getAgentSandboxRoot();
      const apiUrl = isPathInside(sandbox, absPath)
        ? `/api/v1/content/agent-tools/workspace-file?path=${encodeURIComponent(
            path.relative(sandbox, absPath).replace(/\\/g, '/')
          )}`
        : undefined;

      sendJson(res, 200, {
        success: true,
        data: {
          name: path.basename(absPath),
          path: rawPath,
          absPath,
          scope,
          mimeType,
          sizeBytes: stat.size,
          dataUrl,
          apiUrl,
        },
      });
      return true;
    }

    if (
      req.method === 'POST' &&
      (subPath === '/agent-tools/web-search' || subPath === '/agent-tools/web-search/test')
    ) {
      const body = await readJsonBody(req);
      const isTest = subPath.endsWith('/test');
      const result = await executeWebSearch({
        provider: (body.provider || 'none') as WebSearchProviderKind,
        apiKey: typeof body.apiKey === 'string' ? body.apiKey : undefined,
        baseUrl: typeof body.baseUrl === 'string' ? body.baseUrl : undefined,
        query: String(body.query || (isTest ? 'AstroLib test query' : '')).trim(),
        maxResults: isTest ? 2 : Number(body.maxResults) || 5,
      });
      sendJson(res, result.success ? 200 : 400, {
        success: result.success,
        data: result,
        error: result.error,
      });
      return true;
    }

    sendJson(res, 404, { success: false, error: `未知的 Agent 工具路由: ${subPath}` });
    return true;
  } catch (err: any) {
    sendJson(res, 500, { success: false, error: err?.message || String(err) });
    return true;
  }
}
