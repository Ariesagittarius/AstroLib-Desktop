/**
 * src/server/plugins/doc-ingestion/mineru-api-client.ts
 * ============================================================================
 * MinerU 官方云端 API 交互客户端 (https://mineru.net)
 * ============================================================================
 * 职责：
 * 1. 凭证自愈读取：支持环境变量与本地 MinerU 客户端配置自动发现；
 * 2. 申请预签名 OSS 上传链接 (/api/v4/file-urls/batch)；
 * 3. 严格遵循 PUT 上传规范（空 Content-Type 避免 SignatureDoesNotMatch）；
 * 4. 轮询任务状态 (/api/v4/extract-results/batch/{batch_id})；
 * 5. 下载结果 ZIP 并通过系统 bsdtar 解包至目标工作区。
 * ============================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ZipArchive } from '../../../core/book-formats/zip-reader.ts';

const MAX_MINERU_ZIP_BYTES = 100 * 1024 * 1024;
const MAX_MINERU_EXTRACTED_BYTES = 256 * 1024 * 1024;

function isInsideTargetDir(baseDir: string, targetPath: string): boolean {
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(targetPath);
  const rel = path.relative(resolvedBase, resolvedTarget);
  return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function assertSafeDownloadUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`非法的下载 URL: ${rawUrl}`);
  }
  const isHttps = parsed.protocol === 'https:';
  const isLoopbackHttp =
    parsed.protocol === 'http:' &&
    (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost');
  if (!isHttps && !isLoopbackHttp) {
    throw new Error(`不支持的非安全下载协议 (${parsed.protocol}): ${rawUrl}`);
  }
  return parsed.toString();
}

export async function extractZipSafely(
  zipBuffer: Buffer | Uint8Array,
  targetDir: string,
  maxExtractedBytes = MAX_MINERU_EXTRACTED_BYTES
): Promise<string[]> {
  const resolvedRoot = path.resolve(targetDir);
  fs.mkdirSync(resolvedRoot, { recursive: true });

  const archive = ZipArchive.fromBytes(zipBuffer, { strictSafePaths: true });
  const entries = archive.listEntries();
  const extractedFiles: string[] = [];
  let totalBytes = 0;

  for (const entryName of entries) {
    const destPath = path.resolve(resolvedRoot, entryName);
    if (!isInsideTargetDir(resolvedRoot, destPath)) {
      throw new Error(`检测到危险 ZIP 路径穿越条目 (ZipSlip): ${entryName}`);
    }
    const content = await archive.readEntryBytes(entryName);
    totalBytes += content.byteLength;
    if (totalBytes > maxExtractedBytes) {
      throw new Error(`ZIP 解压总大小超出安全上限 (${maxExtractedBytes} bytes)`);
    }
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, content);
    extractedFiles.push(entryName);
  }

  return extractedFiles;
}

export interface MineruBatchFileRequest {
  name: string;
  data_id: string;
}

export interface MineruUploadBatchResponse {
  code: number;
  msg: string;
  data?: {
    batch_id: string;
    file_urls: string[];
  };
}

export interface MineruBatchStatusResponse {
  code: number;
  msg: string;
  data?: {
    batch_id: string;
    state: 'waiting-file' | 'pending' | 'processing' | 'done' | 'failed';
    extract_result?: Array<{
      file_name: string;
      state: 'waiting-file' | 'pending' | 'processing' | 'done' | 'failed';
      full_zip_url?: string;
      err_msg?: string;
      data_id?: string;
    }>;
  };
}

export class MineruApiClient {
  private token: string | null = null;
  private readonly baseUrl = 'https://mineru.net';

  constructor(token?: string) {
    this.token = token || this.resolveToken();
  }

  /**
   * 自动探测与读取系统中的 MinerU API Token
   */
  public resolveToken(): string | null {
    if (process.env.MINERU_API_TOKEN && process.env.MINERU_API_TOKEN.trim()) {
      return process.env.MINERU_API_TOKEN.trim();
    }

    const userDataDir = process.env.ASTROLIB_USER_DATA_DIR;
    if (userDataDir) {
      const userTokenFile = path.join(userDataDir, 'mineru-token.json');
      try {
        if (fs.existsSync(userTokenFile)) {
          const parsed = JSON.parse(fs.readFileSync(userTokenFile, 'utf-8'));
          if (parsed?.explicitlyCleared) {
            return null;
          }
          if (typeof parsed?.token === 'string' && parsed.token.trim()) {
            return parsed.token.trim();
          }
        }
      } catch {}

      const prefsFile = path.join(userDataDir, 'user_preferences.json');
      try {
        if (fs.existsSync(prefsFile)) {
          const prefs = JSON.parse(fs.readFileSync(prefsFile, 'utf-8'));
          if (typeof prefs?.mineru_api_token === 'string' && prefs.mineru_api_token.trim()) {
            return prefs.mineru_api_token.trim();
          }
        }
      } catch {}
    }

    const homeDir = os.homedir();
    const candidateFiles = [
      path.join(process.cwd(), '.mineru.json'),
      path.join(homeDir, 'MinerU', 'config.json'),
      path.join(homeDir, '.mineru', 'config.json'),
    ];

    for (const f of candidateFiles) {
      try {
        if (fs.existsSync(f)) {
          const raw = fs.readFileSync(f, 'utf-8');
          const parsed = JSON.parse(raw);
          if (parsed?.explicitlyCleared) {
            return null;
          }
          if (typeof parsed.config === 'string') {
            try {
              const nested = JSON.parse(parsed.config);
              if (nested?.state?.client_api_token) {
                return nested.state.client_api_token.trim();
              }
            } catch {
              // ignore
            }
          }
          if (parsed.client_api_token) return String(parsed.client_api_token).trim();
          if (parsed.token && String(parsed.token).trim()) return String(parsed.token).trim();
        }
      } catch {
        // continue
      }
    }

    return null;
  }

  public getToken(): string | null {
    if (this.token) return this.token;
    const resolved = this.resolveToken();
    if (resolved) this.token = resolved;
    return this.token;
  }

  public setToken(token: string) {
    const cleaned = (token || '').trim();
    this.token = cleaned || null;
  }

  public persistToken(token: string): void {
    const cleaned = (token || '').trim();
    this.setToken(cleaned);

    const payload = cleaned
      ? { token: cleaned, explicitlyCleared: false, updatedAt: Date.now() }
      : { token: '', explicitlyCleared: true, updatedAt: Date.now() };

    const userDataDir = process.env.ASTROLIB_USER_DATA_DIR;
    if (userDataDir) {
      try {
        fs.mkdirSync(userDataDir, { recursive: true });
        fs.writeFileSync(path.join(userDataDir, 'mineru-token.json'), JSON.stringify(payload, null, 2), 'utf-8');
      } catch {}
    }

    // 开发态若工作目录可写则同步更新 .mineru.json；打包安装目录不可写时静默跳过
    try {
      const cwdTokenPath = path.join(process.cwd(), '.mineru.json');
      if (!userDataDir || fs.existsSync(cwdTokenPath)) {
        fs.writeFileSync(cwdTokenPath, JSON.stringify(payload, null, 2), 'utf-8');
      }
    } catch {}
  }

  /**
   * 1. 申请预签名上传链接
   */
  public async requestBatchUploadUrls(
    fileName: string,
    dataId: string,
    options: {
      modelVersion?: string;
      isOcr?: boolean;
      enableFormula?: boolean;
      enableTable?: boolean;
      pageRanges?: string;
    } = {}
  ): Promise<{ batchId: string; fileUrl: string }> {
    const token = this.token || this.resolveToken();
    if (!token) {
      throw new Error('未检测到有效的 MinerU API Token。请在工作台顶栏设置或配置 MINERU_API_TOKEN。');
    }

    const endpoint = `${this.baseUrl}/api/v4/file-urls/batch`;
    const payload: Record<string, unknown> = {
      files: [{ name: fileName, data_id: dataId }],
      model_version: options.modelVersion || 'vlm',
      is_ocr: options.isOcr !== false,
      enable_formula: options.enableFormula !== false,
      enable_table: options.enableTable !== false,
    };

    if (options.pageRanges && options.pageRanges.trim()) {
      payload.page_ranges = options.pageRanges.trim();
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`MinerU 申请上传接口失败 (HTTP ${res.status}): ${errText}`);
    }

    const json = (await res.json()) as MineruUploadBatchResponse;
    if (json.code !== 0 || !json.data) {
      throw new Error(`MinerU 接口错误 (code ${json.code}): ${json.msg}`);
    }

    const { batch_id, file_urls } = json.data;
    if (!file_urls || file_urls.length === 0) {
      throw new Error('MinerU 未返回有效的预签名上传链接');
    }

    return {
      batchId: batch_id,
      fileUrl: file_urls[0],
    };
  }

  /**
   * 2. 将本地文件二进制通过 PUT 上传至预签名链接
   * ⚠️ 关键要求：禁止设置 Content-Type，否则触发 403 SignatureDoesNotMatch
   */
  public async uploadFileToPreSignedUrl(fileUrl: string, filePath: string): Promise<void> {
    const fileBuffer = fs.readFileSync(filePath);

    const res = await fetch(fileUrl, {
      method: 'PUT',
      headers: {}, // 空 Header，不能传 Content-Type
      body: fileBuffer,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`文件上传至云端对象存储失败 (HTTP ${res.status}): ${errText}`);
    }
  }

  /**
   * 3. 轮询批量解析进度直至完成
   */
  public async pollBatchStatus(
    batchId: string,
    options: {
      intervalMs?: number;
      maxRetries?: number;
      onProgress?: (state: string, raw?: MineruBatchStatusResponse) => void;
    } = {}
  ): Promise<{ fullZipUrl: string; state: string }> {
    const token = this.token || this.resolveToken();
    if (!token) {
      throw new Error('MinerU Token 缺失');
    }

    const endpoint = `${this.baseUrl}/api/v4/extract-results/batch/${batchId}`;
    const intervalMs = options.intervalMs || 3000;
    const maxRetries = options.maxRetries || 120; // 默认最多等待 6 分钟

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const res = await fetch(endpoint, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        throw new Error(`查询批次状态失败 (HTTP ${res.status})`);
      }

      const json = (await res.json()) as MineruBatchStatusResponse;
      if (json.code !== 0) {
        throw new Error(`MinerU 查询错误: ${json.msg}`);
      }

      const state = json.data?.state || 'pending';
      const extractResult = json.data?.extract_result?.[0];
      const itemState = extractResult?.state || state;

      if (options.onProgress) {
        options.onProgress(itemState, json);
      }

      if (itemState === 'done') {
        const fullZipUrl = extractResult?.full_zip_url;
        if (!fullZipUrl) {
          throw new Error('任务解析完成，但返回数据中未包含 full_zip_url 下载链接');
        }
        return { fullZipUrl, state: 'done' };
      }

      if (itemState === 'failed') {
        throw new Error(`解析任务失败: ${extractResult?.err_msg || '未知错误'}`);
      }

      // 等待下一次轮询
      await new Promise((r) => setTimeout(r, intervalMs));
    }

    throw new Error('解析任务轮询超时（超过最大等待时间）');
  }

  /**
   * 4. 下载结果 ZIP 并解包到目标目录
   */
  public async downloadAndExtractZip(zipUrl: string, targetDir: string): Promise<string> {
    const safeUrl = assertSafeDownloadUrl(zipUrl);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const zipTempPath = path.join(targetDir, 'result_archive.zip');

    // 下载 ZIP 并执行纯 Node 流式大小守卫
    const res = await fetch(safeUrl);
    if (!res.ok) {
      throw new Error(`下载结果 ZIP 失败 (HTTP ${res.status})`);
    }
    const contentLen = Number(res.headers.get('content-length') || 0);
    if (Number.isFinite(contentLen) && contentLen > MAX_MINERU_ZIP_BYTES) {
      throw new Error(`MinerU 结果 ZIP 超出体积限制 (${contentLen} > ${MAX_MINERU_ZIP_BYTES} bytes)`);
    }

    const arrayBuffer = await res.arrayBuffer();
    const zipBuffer = Buffer.from(arrayBuffer);
    if (zipBuffer.byteLength > MAX_MINERU_ZIP_BYTES) {
      throw new Error(`MinerU 结果 ZIP 超出体积限制 (${zipBuffer.byteLength} > ${MAX_MINERU_ZIP_BYTES} bytes)`);
    }
    fs.writeFileSync(zipTempPath, zipBuffer);

    // 使用纯 Node 内置 ZIP 解析与 ZipSlip 防护解压，绝不拼接 shell 命令
    await extractZipSafely(zipBuffer, targetDir, MAX_MINERU_EXTRACTED_BYTES);

    return targetDir;
  }

  /**
   * 5. Agent 轻量解析 API (免登录 / 免 Token / 限频)
   * 专为 AI Agent 工作流与轻量文献打造 (<= 10MB, <= 20 页)
   */
  public async parseWithAgentApi(
    filePath: string,
    options: {
      pageRange?: string;
      intervalMs?: number;
      maxRetries?: number;
      onProgress?: (state: string) => void;
    } = {}
  ): Promise<{ markdown: string }> {
    const stats = fs.statSync(filePath);
    if (stats.size > 10 * 1024 * 1024) {
      throw new Error('Agent 轻量解析仅支持 <= 10MB 的文件。当前文件超出限制，请切换为【高精 API】');
    }

    const fileName = path.basename(filePath);
    if (options.onProgress) {
      options.onProgress('正在获取 Agent 免密上传签名...');
    }

    // 第 1 步：获取 OSS 签名上传 URL (无需 Bearer Token，按 IP 限频)
    const initEndpoint = `${this.baseUrl}/api/v1/agent/parse/file`;
    const initPayload: Record<string, any> = {
      file_name: fileName,
      language: 'ch',
      enable_table: true,
      is_ocr: false,
      enable_formula: true,
    };
    if (options.pageRange) {
      initPayload.page_range = options.pageRange;
    }

    const initRes = await fetch(initEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(initPayload),
    });

    if (!initRes.ok) {
      const errText = await initRes.text();
      throw new Error(`Agent 接口申请失败 (HTTP ${initRes.status}): ${errText}`);
    }

    const initJson = (await initRes.json()) as any;
    if (initJson.code !== 0) {
      throw new Error(`Agent 接口错误: ${initJson.msg || '未知错误'}`);
    }

    const taskId = initJson.data?.task_id;
    const fileUrl = initJson.data?.file_url;
    if (!taskId || !fileUrl) {
      throw new Error('Agent 接口未返回有效的 task_id 或 file_url');
    }

    // 第 2 步：PUT 二进制直传 OSS (空 headers 避免签名失效)
    if (options.onProgress) {
      options.onProgress('正在上传文档至 Agent 极速解析集群...');
    }

    const fileBuffer = fs.readFileSync(filePath);
    const uploadRes = await fetch(fileUrl, {
      method: 'PUT',
      headers: {},
      body: fileBuffer,
    });

    if (!uploadRes.ok) {
      throw new Error(`Agent 文件上传 OSS 失败 (HTTP ${uploadRes.status})`);
    }

    if (options.onProgress) {
      options.onProgress('文档已入列，正在执行 Agent 轻量解析 (排队与转换中)...');
    }

    // 第 3 步：异步轮询结果 GET /api/v1/agent/parse/{task_id}
    const statusUrl = `${this.baseUrl}/api/v1/agent/parse/${taskId}`;
    const intervalMs = options.intervalMs || 2500;
    const maxRetries = options.maxRetries || 60;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const statusRes = await fetch(statusUrl);
      if (statusRes.ok) {
        const statusJson = (await statusRes.json()) as any;
        const data = statusJson.data || {};
        const state = (data.state || '').toLowerCase();

        if (options.onProgress) {
          options.onProgress(`Agent 状态: ${state || 'running'}`);
        }

        if (state === 'done') {
          const markdownUrl = data.markdown_url;
          if (!markdownUrl) {
            throw new Error('Agent 任务完成但未返回 markdown_url');
          }
          const mdRes = await fetch(markdownUrl);
          if (!mdRes.ok) {
            throw new Error(`获取 Agent Markdown 失败 (HTTP ${mdRes.status})`);
          }
          const markdown = await mdRes.text();
          return { markdown };
        } else if (state === 'failed') {
          throw new Error(`Agent 解析失败: ${data.err_msg || '未知错误'}`);
        }
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }

    throw new Error('Agent 轻量解析超时 (超过最大轮询等待时间)');
  }
}
