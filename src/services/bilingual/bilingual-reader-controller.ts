/**
 * src/services/bilingual/bilingual-reader-controller.ts
 * ============================================================================
 * AstroLib 双语分栏与跨书对照全屏控制器 (Bilingual Split Reader Controller)
 * ============================================================================
 * 负责：
 * 1. 协调双栏 DOM 段落提取与端侧向量对齐请求；
 * 2. 驱动中缝 SVG 贝塞尔曲线箭头动态连线渲染；
 * 3. 驱动底部热力图抽屉；
 * 4. 驱动点击段落联动定位高亮与平滑滚动。
 * ============================================================================
 */

import { BilingualAlignerClient } from './aligner-client.ts';
import { SvgArrowRenderer } from './svg-arrow-renderer.ts';
import { HeatmapController } from './heatmap-controller.ts';
import { BipartiteMatcher } from './bipartite-matcher.ts';
import type { AlignmentMatrixResult, ParagraphLink, ParagraphToken } from './types.ts';

export class BilingualReaderController {
  private container: HTMLElement | null = null;
  private sourceCol: HTMLElement | null = null;
  private targetCol: HTMLElement | null = null;
  private svgEl: SVGSVGElement | null = null;

  private arrowRenderer = new SvgArrowRenderer();
  private heatmapController = new HeatmapController();

  private sourceTokens: ParagraphToken[] = [];
  private targetTokens: ParagraphToken[] = [];
  private currentResult: AlignmentMatrixResult | null = null;

  private activeSourceId: string | null = null;
  private activeTargetIds: string[] = [];
  private currentThreshold = 0.55; // 经基准评测验证集校准的最佳初始阈值
  private selectedModelId = 'minilm-l12'; // 默认轻量级 CPU/AVX2 模型，亦可一键切换为 Qwen3-0.6B
  private isSyncScrollLocked = true;

  init(container: HTMLElement) {
    this.container = container;
    this.sourceCol = container.querySelector('.bilingual-col-source');
    this.targetCol = container.querySelector('.bilingual-col-target');
    this.svgEl = container.querySelector('.bilingual-svg-canvas');

    if (!this.sourceCol || !this.targetCol || !this.svgEl) return;

    // 读取持久化的模型首选偏好
    if (typeof localStorage !== 'undefined') {
      const savedModel = localStorage.getItem('astrolib_bilingual_model');
      if (savedModel) {
        this.selectedModelId = savedModel;
        if (savedModel === 'qwen3-0.6b') {
          this.currentThreshold = 0.50;
        }
      }
    }

    this.arrowRenderer.init(this.container, this.svgEl);

    const sheetEl = document.getElementById('bilingual-heatmap-sheet');
    if (sheetEl) {
      this.heatmapController.init(sheetEl, {
        onCellClick: (srcId, tgtId, sim) => this.handleHeatmapCellSelect(srcId, tgtId, sim),
        onThresholdChange: (threshold) => this.handleThresholdChange(threshold),
      });
      this.initModelSelector(sheetEl);
      this.syncThresholdSliderUi();
    }

    this.bindDomEvents();
    this.runAlignment();
  }

  /**
   * 同步界面阈值滑块与数值标签
   */
  private syncThresholdSliderUi() {
    const slider = document.getElementById('heatmap-threshold-slider') as HTMLInputElement | null;
    const valLabel = document.getElementById('heatmap-threshold-val');
    if (slider && valLabel) {
      slider.value = this.currentThreshold.toString();
      valLabel.textContent = this.currentThreshold.toFixed(2);
    }
  }

  /**
   * 初始化 M3 向量模型选择芯片交互
   */
  private initModelSelector(sheetEl: HTMLElement) {
    const chipBtns = sheetEl.querySelectorAll<HTMLButtonElement>('.model-chip-set [data-model-id]');
    chipBtns.forEach((btn) => {
      const mid = btn.getAttribute('data-model-id');
      const isActive = mid === this.selectedModelId;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-checked', isActive ? 'true' : 'false');

      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const clickedModel = btn.getAttribute('data-model-id');
        if (clickedModel && clickedModel !== this.selectedModelId) {
          this.switchModel(clickedModel);
        }
      });
    });

    // 动态探测后端多模型就绪状态
    BilingualAlignerClient.getAvailableModels().then((models) => {
      const qwenInfo = models.find((m) => m.id === 'qwen3-0.6b');
      const qwenBtn = sheetEl.querySelector<HTMLButtonElement>('.model-chip-set [data-model-id="qwen3-0.6b"]');
      if (qwenBtn && qwenInfo) {
        if (!qwenInfo.isAvailable) {
          qwenBtn.setAttribute('disabled', 'true');
          qwenBtn.title = '当前环境未检测到 Python 或 Qwen3 权重文件';
        } else {
          qwenBtn.removeAttribute('disabled');
          qwenBtn.title = 'Qwen3-Embedding-0.6B (已就绪 · GPU加速)';
        }
      }
    }).catch(() => {
      // 离线环境静默忽略
    });
  }

  /**
   * 动态切换对齐向量模型（轻量 MiniLM 与高精 Qwen3-0.6B 无缝互切）
   */
  async switchModel(modelId: string) {
    if (this.selectedModelId === modelId) return;
    this.selectedModelId = modelId;

    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('astrolib_bilingual_model', modelId);
    }

    // 更新界面芯片状态
    const sheetEl = document.getElementById('bilingual-heatmap-sheet');
    if (sheetEl) {
      const chipBtns = sheetEl.querySelectorAll<HTMLButtonElement>('.model-chip-set [data-model-id]');
      chipBtns.forEach((btn) => {
        const mid = btn.getAttribute('data-model-id');
        const isActive = mid === this.selectedModelId;
        btn.classList.toggle('is-active', isActive);
        btn.setAttribute('aria-checked', isActive ? 'true' : 'false');
      });
    }

    // 针对不同模型的几何表示空间校准推荐阈值
    if (modelId === 'qwen3-0.6b') {
      this.currentThreshold = 0.50; // Qwen3 跨领域底噪压制至 0.15~0.25，0.50 能清晰剔除干扰
    } else {
      this.currentThreshold = 0.55;
    }
    this.syncThresholdSliderUi();

    // 立即向用户展示加载反馈
    this.updateEngineBadge({
      state: 'loading',
      modelId: this.selectedModelId,
    });

    await this.runAlignment();
  }

  destroy() {
    this.arrowRenderer.destroy();
    this.heatmapController.destroy();
    this.container = null;
    this.sourceCol = null;
    this.targetCol = null;
    this.svgEl = null;
  }

  getHeatmapController(): HeatmapController {
    return this.heatmapController;
  }

  private bindDomEvents() {
    if (!this.sourceCol || !this.targetCol) return;

    // 1. 点击左栏段落 -> 聚焦连线并滚动右栏对应段落
    this.sourceCol.addEventListener('click', (e) => {
      const targetEl = (e.target as HTMLElement).closest('[data-trans-id]') as HTMLElement | null;
      if (!targetEl) return;
      const id = targetEl.getAttribute('data-trans-id');
      if (id) {
        this.selectSourceParagraph(id);
      }
    });

    // 2. 点击右栏段落 -> 反向聚焦左栏关联段落
    this.targetCol.addEventListener('click', (e) => {
      const targetEl = (e.target as HTMLElement).closest('[data-trans-id]') as HTMLElement | null;
      if (!targetEl) return;
      const id = targetEl.getAttribute('data-trans-id');
      if (id) {
        this.selectTargetParagraph(id);
      }
    });

    // 3. 滚动重绘连线
    const handleScroll = () => {
      window.requestAnimationFrame(() => {
        this.redrawArrows();
      });
    };

    this.sourceCol.addEventListener('scroll', handleScroll, { passive: true });
    this.targetCol.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleScroll, { passive: true });
  }

  /**
   * 执行段落提取与向量对齐推理
   */
  async runAlignment() {
    if (!this.sourceCol || !this.targetCol) return;

    this.sourceTokens = BilingualAlignerClient.extractTokens(this.sourceCol, 'src');
    this.targetTokens = BilingualAlignerClient.extractTokens(this.targetCol, 'tgt');

    if (this.sourceTokens.length === 0 || this.targetTokens.length === 0) {
      return;
    }

    // 立即更新为加载状态，提供即时视觉反馈与呼吸感脉冲
    this.updateEngineBadge({
      state: 'loading',
      modelId: this.selectedModelId,
    });

    try {
      this.currentResult = await BilingualAlignerClient.computeAlignment(
        this.sourceTokens,
        this.targetTokens,
        {
          threshold: this.currentThreshold,
          monotonicBias: 0.05,
          model: this.selectedModelId,
        }
      );

      // 若服务端返回自适应校准阈值，结合当前状态优化
      if (this.currentResult.calibratedThreshold) {
        this.currentThreshold = Math.max(0.40, Math.min(0.70, this.currentResult.calibratedThreshold));
        this.syncThresholdSliderUi();
      }

      if (this.currentResult.isFallback) {
        this.updateEngineBadge({
          state: 'fallback',
          modelId: this.selectedModelId,
          modelName: this.currentResult.modelName || 'MiniLM-L12',
          engine: this.currentResult.engine,
          device: this.currentResult.device || 'CPU',
          dim: this.currentResult.dim || 384,
          inferenceTimeMs: this.currentResult.inferenceTimeMs,
          fallbackReason: this.currentResult.fallbackReason,
        });
      } else {
        this.updateEngineBadge({
          state: 'ready',
          modelId: this.currentResult.modelId || this.selectedModelId,
          modelName: this.currentResult.modelName,
          engine: this.currentResult.engine,
          device: this.currentResult.device,
          dim: this.currentResult.dim,
          inferenceTimeMs: this.currentResult.inferenceTimeMs,
        });
      }

      this.heatmapController.setData(this.currentResult, this.currentThreshold);
      this.updateUnmatchedStates();

      // 默认高亮首个具备关联匹配的段落，使箭头连线与对侧对齐微光即时生效可见
      const firstMatchedLink = this.currentResult.links.find((l) => l.similarity >= this.currentThreshold);
      if (firstMatchedLink) {
        this.selectSourceParagraph(firstMatchedLink.sourceId);
      } else {
        this.redrawArrows();
      }
    } catch (err: any) {
      console.warn('[bilingual-reader] Alignment compute error:', err);
      this.updateEngineBadge({
        state: 'error',
        modelId: this.selectedModelId,
        fallbackReason: err?.message || '推理请求异常',
      });
    }
  }

  /**
   * 更新右下角向量推理引擎徽标状态（多态：加载、就绪、降级、异常）
   */
  private updateEngineBadge(status: {
    state: 'loading' | 'ready' | 'fallback' | 'error';
    modelId: string;
    modelName?: string;
    engine?: string;
    device?: string;
    dim?: number;
    inferenceTimeMs?: number;
    fallbackReason?: string;
  }) {
    const badge = document.getElementById('heatmap-engine-badge');
    if (!badge) return;

    // 确保内部结构完整
    if (!badge.querySelector('.engine-status-dot')) {
      badge.innerHTML = `
        <span class="engine-status-dot" aria-hidden="true"></span>
        <span class="engine-model-name"></span>
        <span class="engine-meta-tag engine-device-tag"></span>
        <span class="engine-meta-tag engine-dim-tag"></span>
        <span class="engine-time-tag"></span>
      `;
    }

    badge.classList.remove('is-loading', 'is-ready', 'is-fallback', 'is-error');
    badge.classList.add(`is-${status.state}`);

    const nameEl = badge.querySelector('.engine-model-name');
    const devEl = badge.querySelector('.engine-device-tag') as HTMLElement | null;
    const dimEl = badge.querySelector('.engine-dim-tag') as HTMLElement | null;
    const timeEl = badge.querySelector('.engine-time-tag') as HTMLElement | null;

    const isQwen = status.modelId.includes('qwen');
    const baseName = isQwen ? 'Qwen3-0.6B' : 'MiniLM-L12';

    if (status.state === 'loading') {
      if (nameEl) nameEl.textContent = `加载 ${baseName}...`;
      if (devEl) devEl.style.display = 'none';
      if (dimEl) dimEl.style.display = 'none';
      if (timeEl) timeEl.textContent = '计算中';
      badge.title = `正在调用 ${baseName} 进行向量语义对齐与显存计算，请稍候...`;
    } else if (status.state === 'ready') {
      const device = status.device || (isQwen ? 'CUDA' : 'CPU');
      const dim = status.dim || (isQwen ? 1024 : 384);
      const ms = status.inferenceTimeMs !== undefined ? `${status.inferenceTimeMs}ms` : '';

      if (nameEl) nameEl.textContent = baseName;
      if (devEl) {
        devEl.textContent = device;
        devEl.style.display = '';
      }
      if (dimEl) {
        dimEl.textContent = `${dim}维`;
        dimEl.style.display = '';
      }
      if (timeEl) timeEl.textContent = ms;

      badge.title = `模型: ${status.modelName || baseName}\n运行硬件: ${device}\n向量空间: ${dim}维\n推理耗时: ${ms}\n状态: 运行正常 · 向量匹配成功`;
    } else if (status.state === 'fallback') {
      if (nameEl) nameEl.textContent = 'MiniLM (降级兜底)';
      if (devEl) {
        devEl.textContent = 'CPU';
        devEl.style.display = '';
      }
      if (dimEl) {
        dimEl.textContent = '384维';
        dimEl.style.display = '';
      }
      if (timeEl) timeEl.textContent = status.inferenceTimeMs !== undefined ? `${status.inferenceTimeMs}ms` : '';
      badge.title = `提示: Qwen3 模型未就绪 (${status.fallbackReason || '未知原因'})，已自动降级至 MiniLM-L12 保证对齐`;
    } else {
      if (nameEl) nameEl.textContent = '启发式词法对齐';
      if (devEl) devEl.style.display = 'none';
      if (dimEl) dimEl.style.display = 'none';
      if (timeEl) timeEl.textContent = '离线';
      badge.title = `服务端对齐接口异常: ${status.fallbackReason || '离线降级'}`;
    }
  }

  private handleThresholdChange(threshold: number) {
    this.currentThreshold = threshold;
    if (this.currentResult) {
      this.currentResult.links = BipartiteMatcher.extractLinks(
        this.currentResult.matrix,
        this.sourceTokens,
        this.targetTokens,
        {
          threshold: this.currentThreshold,
          monotonicBias: 0.05,
        }
      );
      const { unmatchedSourceIds, unmatchedTargetIds } = BipartiteMatcher.findUnmatched(
        this.currentResult.links,
        this.sourceTokens,
        this.targetTokens
      );
      this.currentResult.unmatchedSourceIds = unmatchedSourceIds;
      this.currentResult.unmatchedTargetIds = unmatchedTargetIds;
      this.updateUnmatchedStates();
    }
    this.redrawArrows();
  }

  private updateUnmatchedStates() {
    if (!this.container || !this.currentResult) return;
    const unmatchedSrc = new Set(this.currentResult.unmatchedSourceIds || []);
    const unmatchedTgt = new Set(this.currentResult.unmatchedTargetIds || []);

    this.sourceCol?.querySelectorAll('[data-trans-id]').forEach((el) => {
      const id = el.getAttribute('data-trans-id');
      if (id && unmatchedSrc.has(id)) {
        el.classList.add('bilingual-unmatched-state');
      } else {
        el.classList.remove('bilingual-unmatched-state');
      }
    });

    this.targetCol?.querySelectorAll('[data-trans-id]').forEach((el) => {
      const id = el.getAttribute('data-trans-id');
      if (id && unmatchedTgt.has(id)) {
        el.classList.add('bilingual-unmatched-state');
      } else {
        el.classList.remove('bilingual-unmatched-state');
      }
    });
  }

  private selectSourceParagraph(srcId: string) {
    this.activeSourceId = srcId;

    // 清空现有高亮
    this.clearHighlights();

    const srcEl = this.container?.querySelector(`[data-trans-id="${srcId}"]`);
    srcEl?.classList.add('bilingual-highlight-active');

    // 查找对侧关联段落
    const matchingLinks = (this.currentResult?.links || []).filter(
      (l) => l.sourceId === srcId && l.similarity >= this.currentThreshold
    );

    this.activeTargetIds = matchingLinks.map((l) => l.targetId);

    // 高亮并平滑滚动首要关联目标
    matchingLinks.forEach((link, idx) => {
      const tgtEl = this.container?.querySelector(`[data-trans-id="${link.targetId}"]`) as HTMLElement | null;
      if (tgtEl) {
        tgtEl.classList.add('bilingual-highlight-target');
        if (idx === 0) {
          tgtEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    });

    this.redrawArrows();
  }

  private selectTargetParagraph(tgtId: string) {
    // 逆向查找源段落
    const matchingLinks = (this.currentResult?.links || []).filter(
      (l) => l.targetId === tgtId && l.similarity >= this.currentThreshold
    );

    if (matchingLinks.length > 0) {
      this.selectSourceParagraph(matchingLinks[0].sourceId);
    } else {
      this.clearHighlights();
      const tgtEl = this.container?.querySelector(`[data-trans-id="${tgtId}"]`);
      tgtEl?.classList.add('bilingual-highlight-active');
      this.activeSourceId = null;
      this.activeTargetIds = [tgtId];
      this.redrawArrows();
    }
  }

  private handleHeatmapCellSelect(srcId: string, tgtId: string, _similarity: number) {
    this.selectSourceParagraph(srcId);
    const tgtEl = this.container?.querySelector(`[data-trans-id="${tgtId}"]`) as HTMLElement | null;
    tgtEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  private clearHighlights() {
    this.container?.querySelectorAll('.bilingual-highlight-active, .bilingual-highlight-target').forEach((el) => {
      el.classList.remove('bilingual-highlight-active', 'bilingual-highlight-target');
    });
  }

  private redrawArrows() {
    if (!this.currentResult) return;
    this.arrowRenderer.renderLinks(this.currentResult.links, {
      activeSourceId: this.activeSourceId,
      activeTargetIds: this.activeTargetIds,
      threshold: this.currentThreshold,
    });
  }
}
