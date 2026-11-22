export const DEFAULT_MODEL_IDLE_TTL_MS = 5 * 60 * 1000;

export type LocalModelId = 'qwen-highlight' | 'qwen-align' | 'minilm-align';

export interface RuntimeModelStatus {
  id: LocalModelId;
  name: string;
  loaded: boolean;
  initializing: boolean;
  device: string;
  vramMB: number;
  lastUsedAt: number | null;
  idleTimeoutMs: number;
}

export function parseModelIdleTtlMs(raw: string | number | undefined = process.env.ASTROLIB_MODEL_IDLE_TTL_MS): number {
  if (raw === undefined || raw === null || raw === '') {
    return DEFAULT_MODEL_IDLE_TTL_MS;
  }
  const num = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(num) || num < 0) {
    return DEFAULT_MODEL_IDLE_TTL_MS;
  }
  return Math.floor(num);
}

export class LocalModelIdleController {
  private idleTimeoutMs: number;
  private lastUsedAt: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(initialTimeoutMs?: number) {
    this.idleTimeoutMs = initialTimeoutMs !== undefined
      ? Math.max(0, Math.floor(initialTimeoutMs))
      : parseModelIdleTtlMs();
  }

  public getIdleTimeoutMs(): number {
    return this.idleTimeoutMs;
  }

  public getLastUsedAt(): number | null {
    return this.lastUsedAt;
  }

  public touch(
    isBusy: () => boolean,
    isLoaded: () => boolean,
    onIdleUnload: () => void | Promise<void>
  ): void {
    this.lastUsedAt = Date.now();
    this.schedule(isBusy, isLoaded, onIdleUnload);
  }

  public setIdleTimeoutMs(
    ms: number,
    isBusy: () => boolean,
    isLoaded: () => boolean,
    onIdleUnload: () => void | Promise<void>
  ): void {
    this.idleTimeoutMs = Number.isFinite(ms) && ms >= 0 ? Math.floor(ms) : DEFAULT_MODEL_IDLE_TTL_MS;
    this.clearTimer();
    if (this.idleTimeoutMs <= 0 || !isLoaded()) {
      return;
    }

    const elapsed = this.lastUsedAt ? Math.max(0, Date.now() - this.lastUsedAt) : 0;
    const remaining = Math.max(50, this.idleTimeoutMs - elapsed);
    this.armTimer(remaining, isBusy, isLoaded, onIdleUnload);
  }

  public schedule(
    isBusy: () => boolean,
    isLoaded: () => boolean,
    onIdleUnload: () => void | Promise<void>
  ): void {
    this.clearTimer();
    if (this.idleTimeoutMs <= 0 || !isLoaded()) {
      return;
    }
    this.armTimer(this.idleTimeoutMs, isBusy, isLoaded, onIdleUnload);
  }

  private armTimer(
    delayMs: number,
    isBusy: () => boolean,
    isLoaded: () => boolean,
    onIdleUnload: () => void | Promise<void>
  ): void {
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!isLoaded()) {
        return;
      }
      if (isBusy()) {
        this.armTimer(this.idleTimeoutMs > 0 ? Math.min(this.idleTimeoutMs, 15000) : 15000, isBusy, isLoaded, onIdleUnload);
        return;
      }
      Promise.resolve(onIdleUnload()).catch(() => {});
    }, delayMs);

    if (typeof (this.timer as { unref?: () => void }).unref === 'function') {
      (this.timer as { unref: () => void }).unref();
    }
  }

  public clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  public reset(): void {
    this.clearTimer();
    this.lastUsedAt = null;
  }
}
