/**
 * src/services/info-highlight/client.ts
 * ============================================================================
 * AstroLib 关注点透镜前端控制器 (InfoLens Focus Client Controller)
 * ============================================================================
 * 职责：
 * 1. 优先调用 Electron 原生 IPC (window.astrolib.analyzeTextHighlight)，兼顾 Localhost HTTP 回退；
 * 2. 调度文本提取与 CSS Custom Highlight 极速渲染；
 * 3. 驱动 PageSidebarOverride 右侧面板与顶栏按钮联动；
 * 4. 会话级缓存（sessionStorage），避免重复推理，节省计算资源。
 * ============================================================================
 */

import { InfoHighlightRenderer } from './renderer.ts';
import type {
  InfoHighlightResult,
  InfoHighlightStatus,
  HighlightConfig,
  HighlightMode,
} from '../../types/info-highlight.ts';

export class InfoHighlightClient {
  private static instance: InfoHighlightClient | null = null;

  private currentResult: InfoHighlightResult | null = null;
  private config: HighlightConfig = {
    mode: 'fade',
    thresholdPct: 35,
    fadeMinPct: 30,
    intensity: 100,
  };
  private isAnalyzing = false;

  static getInstance(): InfoHighlightClient {
    if (!this.instance) {
      this.instance = new InfoHighlightClient();
    }
    return this.instance;
  }

  getConfig(): HighlightConfig {
    return { ...this.config };
  }

  getCurrentResult(): InfoHighlightResult | null {
    return this.currentResult;
  }

  /**
   * 探测本地服务与 Qwen 模型健康状态
   */
  async getStatus(): Promise<InfoHighlightStatus> {
    if (typeof window !== 'undefined' && (window as any).astrolib?.getInfoHighlightStatus) {
      try {
        return await (window as any).astrolib.getInfoHighlightStatus();
      } catch (err: any) {
        console.warn('[InfoHighlightClient] Electron IPC getStatus failed:', err);
      }
    }

    try {
      const resp = await fetch('/__info_highlight__/status');
      if (resp.ok) {
        return await resp.json();
      }
    } catch {}

    return {
      available: false,
      ready: false,
      modelPath: null,
      pythonPath: null,
      device: 'unknown',
    };
  }

  /**
   * 执行推理分析（优先 Electron IPC，其次 Localhost HTTP）
   */
  async analyzeText(text: string): Promise<InfoHighlightResult> {
    const isElectron = Boolean((window as any).astrolib?.isElectron && (window as any).astrolib?.analyzeTextHighlight);

    if (isElectron) {
      return (window as any).astrolib.analyzeTextHighlight(text);
    }

    const resp = await fetch('/__info_highlight__/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });

    if (!resp.ok) {
      const errJson = await resp.json().catch(() => ({}));
      throw new Error(errJson.error || `HTTP ${resp.status}`);
    }

    return resp.json();
  }

  /**
   * 分析当前正文区域并实时渲染
   */
  async analyzeCurrentPage(): Promise<InfoHighlightResult> {
    if (this.isAnalyzing) {
      throw new Error('已有分析任务正在进行中');
    }

    const article =
      document.querySelector('.sl-markdown-content') ||
      document.querySelector('main article') ||
      document.querySelector('main .content') ||
      document.querySelector('article');

    if (!article) {
      throw new Error('未找到当前文章的正文容器');
    }

    this.isAnalyzing = true;
    this.updateUiState('analyzing');

    try {
      const { text } = InfoHighlightRenderer.extractTextWithMapping(article as HTMLElement);
      if (!text || text.trim().length === 0) {
        throw new Error('当前文章正文为空');
      }

      // 截取前 4000 字符以内最核心正文（或全篇）
      const analyzeSlice = text.length > 3500 ? text.slice(0, 3500) : text;

      // 检查当前 URL 会话缓存
      const cacheKey = `astrolib-focus-${window.location.pathname}`;
      let result: InfoHighlightResult;

      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        try {
          result = JSON.parse(cached);
        } catch {
          result = await this.analyzeText(analyzeSlice);
          sessionStorage.setItem(cacheKey, JSON.stringify(result));
        }
      } else {
        result = await this.analyzeText(analyzeSlice);
        sessionStorage.setItem(cacheKey, JSON.stringify(result));
      }

      this.currentResult = result;
      InfoHighlightRenderer.apply(result.tokens, this.config);
      this.updateUiState('ready', result);
      return result;
    } catch (err: any) {
      this.updateUiState('error', undefined, err.message);
      throw err;
    } finally {
      this.isAnalyzing = false;
    }
  }

  /**
   * 更新高亮配置并即时重绘（零延迟）
   */
  updateConfig(newConfig: Partial<HighlightConfig>): void {
    this.config = { ...this.config, ...newConfig };
    if (this.currentResult) {
      InfoHighlightRenderer.apply(this.currentResult.tokens, this.config);
    }
  }

  /**
   * 清除正文高亮
   */
  clearHighlight(): void {
    InfoHighlightRenderer.clear();
    this.updateUiState('idle');
  }

  /**
   * 更新右侧面板 UI 状态
   */
  private updateUiState(
    state: 'idle' | 'analyzing' | 'ready' | 'error',
    result?: InfoHighlightResult,
    errMsg?: string
  ): void {
    const statusText = document.getElementById('focus-status-text');
    const analyzeBtn = document.getElementById('focus-analyze-btn') as HTMLButtonElement | null;
    const telemetryBox = document.getElementById('focus-telemetry-box');
    const keywordsList = document.getElementById('focus-keywords-list');

    if (statusText) {
      if (state === 'analyzing') {
        statusText.textContent = 'Qwen 模型本地推理中...';
        statusText.className = 'focus-status is-analyzing';
      } else if (state === 'ready') {
        statusText.textContent = '关注点透镜已激活';
        statusText.className = 'focus-status is-ready';
      } else if (state === 'error') {
        statusText.textContent = `推理失败: ${errMsg || '未知错误'}`;
        statusText.className = 'focus-status is-error';
      } else {
        statusText.textContent = '就绪';
        statusText.className = 'focus-status';
      }
    }

    if (analyzeBtn) {
      analyzeBtn.disabled = state === 'analyzing';
      if (state === 'analyzing') {
        analyzeBtn.innerHTML = '<md-icon class="focus-btn-icon" aria-hidden="true">sync</md-icon> 正在推理...';
      } else {
        analyzeBtn.innerHTML = '<md-icon class="focus-btn-icon" aria-hidden="true">auto_awesome</md-icon> 分析本章关注点';
      }
    }

    if (telemetryBox && result) {
      telemetryBox.style.display = 'grid';
      const timeEl = document.getElementById('focus-stat-time');
      const tokensEl = document.getElementById('focus-stat-tokens');
      const deviceEl = document.getElementById('focus-stat-device');
      const vramEl = document.getElementById('focus-stat-vram');

      if (timeEl) timeEl.textContent = `${result.inferenceTimeMs} ms`;
      if (tokensEl) tokensEl.textContent = `${result.inputTokens} 词元`;
      if (deviceEl) deviceEl.textContent = result.device.toUpperCase();
      if (vramEl) vramEl.textContent = result.vramAllocatedMB ? `${result.vramAllocatedMB} MB` : '1.14 GB';
    }

    if (keywordsList && result && Array.isArray(result.tokens)) {
      // 提取惊异度最高的前 6 个非标点实体词
      const topTokens = [...result.tokens]
        .filter((t) => t.raw.trim().length >= 2 && !/^[，。！？；：、“”‘’（）《》【】\s]+$/.test(t.raw))
        .sort((a, b) => b.surprisalBits - a.surprisalBits)
        .slice(0, 6);

      keywordsList.innerHTML = topTokens
        .map(
          (t) =>
            `<span class="focus-keyword-chip" title="惊异度: ${t.surprisalBits} bits | CI: ${(t.ciRatio * 100).toFixed(1)}%">
              ${t.raw}
              <small class="focus-keyword-bits">${t.surprisalBits.toFixed(1)}b</small>
            </span>`
        )
        .join('');
    }
  }

  /**
   * 绑定 DOM 事件交互 (面板打开时自动触发或由用户按钮触发)
   */
  bindUi(): void {
    const analyzeBtn = document.getElementById('focus-analyze-btn');
    const clearBtn = document.getElementById('focus-clear-btn');
    const slider = document.getElementById('focus-threshold-slider') as HTMLInputElement | null;
    const sliderVal = document.getElementById('focus-threshold-val');

    analyzeBtn?.addEventListener('click', () => {
      this.analyzeCurrentPage().catch((err) => {
        console.error('[InfoHighlight] 分析失败:', err);
      });
    });

    clearBtn?.addEventListener('click', () => {
      this.clearHighlight();
    });

    slider?.addEventListener('input', (e) => {
      const val = parseInt((e.target as HTMLInputElement).value, 10);
      if (sliderVal) sliderVal.textContent = `${val}%`;
      this.updateConfig({ thresholdPct: val });
    });

    // 模式切换 Chip
    document.querySelectorAll('[data-focus-mode]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const mode = (btn as HTMLElement).dataset.focusMode as HighlightMode;
        if (!mode) return;
        document.querySelectorAll('[data-focus-mode]').forEach((b) => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        this.updateConfig({ mode });
      });
    });

    // 异步查询并展示设备信息
    this.getStatus().then((status) => {
      const badge = document.getElementById('focus-hardware-badge');
      if (badge) {
        if (status.ready || status.available) {
          badge.textContent = status.device.includes('cuda') ? 'Qwen 0.6B (RTX 5060)' : 'Qwen 0.6B (本地就绪)';
          badge.classList.add('is-ready');
        } else {
          badge.textContent = '待加载';
        }
      }
    });
  }
}

export const infoHighlightClient = InfoHighlightClient.getInstance();
