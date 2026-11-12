/**
 * electron/services/settings-manager.ts
 * ============================================================================
 * AstroLib 桌面端用户设置与偏好持久化服务 (JSON File Storage in userData)
 * ============================================================================
 * 职责：
 * 1. 负责全量偏好（字体、段前空两格、夜间模式、主题色、提示条折叠记忆、AI Key等）
 *    持久化落盘至 userData/user_preferences.json；
 * 2. 避免 Chromium 多端口分区导致的 localStorage 状态丢失；
 * 3. 内存极速直读 + 纳秒级响应 + 磁盘防损原子写回。
 * ============================================================================
 */

import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

export class SettingsManager {
  private static instance: SettingsManager | null = null;
  private readonly filePath: string;
  private cache: Record<string, string> = {};
  private saveTimeout: NodeJS.Timeout | null = null;

  public static getInstance(customDir?: string): SettingsManager {
    if (!this.instance) {
      this.instance = new SettingsManager(customDir);
    }
    return this.instance;
  }

  constructor(customDir?: string) {
    const dir = customDir || (app ? app.getPath('userData') : process.cwd());
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {}
    this.filePath = path.join(dir, 'user_preferences.json');
    this.loadFromDisk();
  }

  /**
   * 初始化默认配置（思源黑体、默认段前空两格开启）
   */
  private getDefaults(): Record<string, string> {
    return {
      'starlight-font': JSON.stringify({ latin: 'sans', cjk: 'han-sans' }),
      'astrolib_typography_indent': 'true',
      'astrolib_font_size': '16',
      'astrolib_punct_style': 'dot',
      'starlight-theme': 'dark',
      'starlight-m3-theme-color': '#0b57d0',
    };
  }

  /**
   * 从磁盘同步读取配置
   */
  private loadFromDisk(): void {
    const defaults = this.getDefaults();
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          this.cache = { ...defaults, ...parsed };
          return;
        }
      }
    } catch (err) {
      console.warn('[SettingsManager] 读取配置文件异常，使用默认偏好:', err);
    }
    this.cache = { ...defaults };
    this.flushToDiskSync();
  }

  /**
   * 获取全部配置项
   */
  public getAll(): Record<string, string> {
    return { ...this.cache };
  }

  /**
   * 获取单项配置
   */
  public get(key: string): string | undefined {
    return this.cache[key];
  }

  /**
   * 设置或清除单项配置并排队落盘
   */
  public set(key: string, value: string | null | undefined): void {
    if (value === null || value === undefined) {
      delete this.cache[key];
    } else {
      this.cache[key] = String(value);
    }
    this.scheduleSave();
  }

  /**
   * 批量更新配置
   */
  public setBatch(batch: Record<string, string | null | undefined>): void {
    for (const [k, v] of Object.entries(batch)) {
      if (v === null || v === undefined) {
        delete this.cache[k];
      } else {
        this.cache[k] = String(v);
      }
    }
    this.scheduleSave();
  }

  /**
   * 防抖落盘
   */
  private scheduleSave(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    this.saveTimeout = setTimeout(() => {
      this.flushToDiskSync();
      this.saveTimeout = null;
    }, 150);
  }

  /**
   * 同步原子写盘，杜绝进程突发退出时数据截断
   */
  public flushToDiskSync(): void {
    try {
      const json = JSON.stringify(this.cache, null, 2);
      const tmpFile = `${this.filePath}.tmp.${Date.now()}`;
      fs.writeFileSync(tmpFile, json, 'utf8');
      fs.renameSync(tmpFile, this.filePath);
    } catch (err) {
      console.error('[SettingsManager] 写入配置文件失败:', err);
    }
  }
}
