import { app, safeStorage } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

const SENSITIVE_KEY_RE = /(?:api[_-]?key|token|secret|password|bupt.*key|gemini.*key|mineru)/i;
const ENCRYPTED_PREFIX = 'enc:v1:';

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

  private canUseSafeStorage(): boolean {
    try {
      return Boolean(safeStorage && typeof safeStorage.isEncryptionAvailable === 'function' && safeStorage.isEncryptionAvailable());
    } catch {
      return false;
    }
  }

  private isSensitiveKey(key: string): boolean {
    return SENSITIVE_KEY_RE.test(key);
  }

  private encryptSecret(plain: string): string {
    if (!plain || plain.startsWith(ENCRYPTED_PREFIX) || !this.canUseSafeStorage()) {
      return plain;
    }
    try {
      const encryptedBuf = safeStorage.encryptString(plain);
      return `${ENCRYPTED_PREFIX}${encryptedBuf.toString('base64')}`;
    } catch {
      return plain;
    }
  }

  private decryptSecret(stored: string): string {
    if (!stored || !stored.startsWith(ENCRYPTED_PREFIX)) {
      return stored;
    }
    if (!this.canUseSafeStorage()) {
      return '';
    }
    try {
      const rawBuf = Buffer.from(stored.slice(ENCRYPTED_PREFIX.length), 'base64');
      return safeStorage.decryptString(rawBuf);
    } catch {
      return '';
    }
  }

  private getDefaults(): Record<string, string> {
    return {
      'starlight-font': JSON.stringify({ latin: 'sans', cjk: 'han-sans' }),
      'astrolib_typography_indent': 'true',
      'astrolib_font_size': '15',
      'astrolib_punct_style': 'dot',
      'starlight-theme': 'dark',
      'starlight-m3-theme-color': '#0b57d0',
    };
  }

  private loadFromDisk(): void {
    const defaults = this.getDefaults();
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          let needsMigration = false;
          const loaded: Record<string, string> = { ...defaults };
          for (const [k, rawVal] of Object.entries(parsed)) {
            if (typeof rawVal !== 'string' && rawVal === undefined) continue;
            const valStr = String(rawVal);
            if (this.isSensitiveKey(k)) {
              if (valStr.startsWith(ENCRYPTED_PREFIX)) {
                const decrypted = this.decryptSecret(valStr);
                if (decrypted) {
                  loaded[k] = decrypted;
                }
              } else if (valStr) {
                loaded[k] = valStr;
                if (this.canUseSafeStorage()) {
                  needsMigration = true;
                }
              }
            } else {
              loaded[k] = valStr;
            }
          }
          this.cache = loaded;
          if (needsMigration) {
            this.flushToDiskSync();
          }
          return;
        }
      }
    } catch (err) {
      console.warn('[SettingsManager] 读取配置文件异常，使用默认偏好:', err);
    }
    this.cache = { ...defaults };
    this.flushToDiskSync();
  }

  public getAll(): Record<string, string> {
    return { ...this.cache };
  }

  public get(key: string): string | undefined {
    return this.cache[key];
  }

  public set(key: string, value: string | null | undefined): void {
    if (value === null || value === undefined) {
      delete this.cache[key];
    } else {
      this.cache[key] = String(value);
    }
    this.scheduleSave();
  }

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

  private scheduleSave(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    this.saveTimeout = setTimeout(() => {
      this.flushToDiskSync();
      this.saveTimeout = null;
    }, 150);
  }

  public flushToDiskSync(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    try {
      const diskPayload: Record<string, string> = {};
      for (const [k, v] of Object.entries(this.cache)) {
        diskPayload[k] = this.isSensitiveKey(k) ? this.encryptSecret(v) : v;
      }
      const json = JSON.stringify(diskPayload, null, 2);
      const tmpFile = `${this.filePath}.tmp.${Date.now()}`;
      fs.writeFileSync(tmpFile, json, 'utf8');
      fs.renameSync(tmpFile, this.filePath);
    } catch (err) {
      console.error('[SettingsManager] 写入配置文件失败:', err);
    }
  }
}
