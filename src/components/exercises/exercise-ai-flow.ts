import { streamChat } from '../../ai/llm.mjs';
import renderMathInElement from 'katex/dist/contrib/auto-render.mjs';
import { StreamThrottleScheduler } from './stream-scheduler';
import { exerciseDb, type CommunityAiSolution } from '../../utils/exercise-db/exercise-db-client';
import type { SlimQuestionItem } from '../../types/exercises';
import { renderAcademicSolutionMarkdown as renderSolutionMarkdown, EXERCISE_KATEX_OPTIONS as KATEX_OPTIONS } from './exercise-markdown';
import { renderAiVersionsBarHtml, getAiModelLabel } from './exercise-view-renderer';
import {
  getEffectiveAiClientConfig,
  getAiProvider,
  saveAiActiveProvider,
  saveProviderApiKey,
  type AiProviderId,
} from '../../ai/ai-config';
import { renderAiKeyConfigCardHtml } from './exercise-view-renderer';
import { parseAiError } from '../../ai/error-handler';

export interface ExerciseAiFlowContext {
  getBodyContainer(): HTMLElement | null;
  getQuestion(qid: string): SlimQuestionItem | undefined;
  showToast(msg: string): void;
  closeModal(): void;
  esc(s: string): string;
}

export class ExerciseAiFlowManager {
  private aiSolutions = new Map<string, string>();
  private communitySolutions = new Map<string, CommunityAiSolution[]>();
  private activeSolutionVersions = new Map<string, string>();
  private aiControllers = new Map<string, AbortController>();
  private aiStreamActive = new Set<string>();
  private aiSchedulers = new Map<string, StreamThrottleScheduler>();

  constructor(private ctx: ExerciseAiFlowContext) {}

  public getAiSolution(qid: string): string {
    return this.aiSolutions.get(qid) || '';
  }

  public hasAiSolution(qid: string): boolean {
    return this.aiSolutions.has(qid);
  }

  public getCommunitySolutions(qid: string): CommunityAiSolution[] {
    return this.communitySolutions.get(qid) || [];
  }

  public getActiveSolutionVersion(qid: string): string {
    return this.activeSolutionVersions.get(qid) || 'local';
  }

  public setAiSolution(qid: string, md: string): void {
    this.aiSolutions.set(qid, md);
  }

  public addCommunitySolution(qid: string, sol: CommunityAiSolution): void {
    const list = this.getCommunitySolutions(qid);
    list.unshift(sol);
    this.communitySolutions.set(qid, list);
    this.switchAiVersion(qid, sol.id);
  }

  public async handleAskAi(qid: string, forceRetry = false): Promise<void> {
    const card = this.ctx.getBodyContainer()?.querySelector(`#q-card-${qid}`);
    if (!card) return;

    const aiBox = card.querySelector(`#ai-box-${qid}`);
    if (aiBox) aiBox.classList.remove('hidden');

    this.loadCommunitySolutions(qid);

    if (this.aiSolutions.has(qid) && !forceRetry) {
      this.switchAiVersion(qid, 'local');
      return;
    }

    const q = this.ctx.getQuestion(qid);
    if (!q) return;

    const config = getEffectiveAiClientConfig();
    const configBox = card.querySelector(`#ai-key-config-${qid}`);
    if (!config.apiKey) {
      configBox?.classList.remove('hidden');
      return;
    }
    configBox?.classList.add('hidden');

    const contentEl = card.querySelector(`#ai-content-${qid}`) as HTMLElement;
    const statusEl = card.querySelector(`#ai-status-${qid}`);
    const stopBtn = card.querySelector('.ex-ai-stop-btn');
    const copyBtn = card.querySelector('.ex-ai-copy-btn');
    const retryBtn = card.querySelector('.ex-ai-retry-btn');

    if (stopBtn) stopBtn.classList.remove('hidden');
    if (copyBtn) copyBtn.classList.add('hidden');
    if (retryBtn) retryBtn.classList.add('hidden');
    if (statusEl) statusEl.textContent = '正在推导...';

    const prompt = `请对以下题目给出极为规范、详尽的推导过程与标准解法。
【输出排版强制要求】：
1. 严格使用标准 Markdown 与 KaTeX 规范：行内公式一律用 $...$，独立居中公式一律用 $$...$$；
2. 绝对严禁输出任何 \\[、\\]、\\(、\\) 界定符！
3. 给出规范分步推导演算过程与最终标准答案，步骤严谨无跳步。

【题目信息】
来源：${q.source || `${q.paper_title}（原卷第 ${q.paper_q_num} 题）`}
小节：${q.sec_title || q.sec}
题型：${q.type}
题干：
${q.stem_raw}

${q.options && q.options.length ? `选项：\n${q.options.map((o) => `${o.key}. ${o.text_raw}`).join('\n')}` : ''}
${q.answer ? `参考结果：${q.answer}` : ''}`;

    const controller = new AbortController();
    this.aiControllers.set(qid, controller);
    this.aiStreamActive.add(qid);

    let accumulatedMd = '';
    let accumulatedReasoning = '';
    this.activeSolutionVersions.set(qid, 'local');

    const scheduler = new StreamThrottleScheduler(() => {
      this.aiSolutions.set(qid, accumulatedMd);
      if (contentEl) {
        if (!accumulatedMd && accumulatedReasoning) {
          contentEl.innerHTML = '<div class="ex-ai-placeholder">正在深度梳理推导演算与思考过程...</div>';
        } else if (accumulatedMd) {
          contentEl.innerHTML = renderSolutionMarkdown(accumulatedMd, true);
          try {
            renderMathInElement(contentEl, KATEX_OPTIONS);
          } catch (e) {}
        }
      }
    }, 100);
    this.aiSchedulers.set(qid, scheduler);

    const systemPrompt = `你是专注理科高精数学与物理推导的学术导师，以严谨细致、无跳步分步推导著称。
【严格数学排版规范——必须100%遵从】：
1. 绝对严禁使用任何 LaTeX 原生界定符 \\[ ... \\] 或 \\( ... \\)，绝不允许输出类似 "\\[" 或 "\\]" 单独成行的标记！
2. 行内数学公式：必须且只能使用单个美元符号包裹，例如 $f(x) = 2x^2 + 3y^2$、$P_0(x_0, y_0, z_0)$。
3. 独立块级居中公式：必须且只能使用双美元符号包裹，前后换行单独成段，例如：
$$
z_0 = 2x_0^2 + 3y_0^2
$$
4. 凡是多行推导或方程组，必须在同一个 $$ ... $$ 块内使用 \\begin{aligned} ... \\end{aligned} 组织，绝不可拆分成多个单独的公式块或输出 \\[！
5. 所有数学符号、变量、几何点（如 $P_0$、\\lambda）、方程均须使用 KaTeX 公式渲染，不得作为裸露文本输出。`;
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt },
    ];

    try {
      await streamChat({
        endpoint: config.endpoint,
        apiKey: config.apiKey,
        model: config.model,
        maxTokens: config.maxTokens,
        messages,
        signal: controller.signal,
        onReasoningDelta: (chunk: string) => {
          accumulatedReasoning += chunk;
          scheduler.schedule();
        },
        onDelta: (chunk: string) => {
          accumulatedMd += chunk;
          scheduler.schedule();
        },
      });

      scheduler.flush(true);
      scheduler.stop();
      this.aiSchedulers.delete(qid);
      this.aiStreamActive.delete(qid);

      const hasContent = Boolean(accumulatedMd && accumulatedMd.trim());
      const hasReasoning = Boolean(accumulatedReasoning && accumulatedReasoning.trim());

      if (!hasContent && !hasReasoning) {
        if (statusEl) statusEl.textContent = '推导中断';
        if (contentEl) {
          contentEl.innerHTML = '<div class="ex-ai-error">模型未返回有效推导内容，请检查服务状态并重试</div>';
        }
        if (stopBtn) stopBtn.classList.add('hidden');
        if (retryBtn) retryBtn.classList.remove('hidden');
        return;
      }

      if (!hasContent && hasReasoning) {
        if (statusEl) statusEl.textContent = '推导中断（正文未返回）';
        if (contentEl) {
          contentEl.innerHTML = '<div class="ex-ai-error">模型已完成思路推演，但未输出正文推导（可能因服务端连接中断或生成异常）。请点击重新生成。</div>';
        }
        if (stopBtn) stopBtn.classList.add('hidden');
        if (retryBtn) retryBtn.classList.remove('hidden');
        return;
      }

      this.aiSolutions.set(qid, accumulatedMd);
      if (contentEl) {
        contentEl.innerHTML = renderSolutionMarkdown(accumulatedMd, false);
        try {
          renderMathInElement(contentEl, KATEX_OPTIONS);
        } catch (e) {}
      }

      if (statusEl) statusEl.textContent = '推导完成';
      if (stopBtn) stopBtn.classList.add('hidden');
      if (copyBtn) copyBtn.classList.remove('hidden');
      if (retryBtn) retryBtn.classList.remove('hidden');
      this.updateAiVersionsBar(qid);
    } catch (err: any) {
      const sch = this.aiSchedulers.get(qid);
      if (sch) {
        sch.stop();
        this.aiSchedulers.delete(qid);
      }
      this.aiStreamActive.delete(qid);
      if (err.name === 'AbortError') {
        if (statusEl) statusEl.textContent = '已停止生成';
      } else {
        const errInfo = parseAiError(err);
        if (statusEl) statusEl.textContent = `推导中断: ${errInfo.title}`;
        if (contentEl && !accumulatedMd) {
          contentEl.innerHTML = `
            <div class="ex-ai-error-box">
              <div class="ex-ai-error-header">
                <md-icon class="ex-ai-error-icon">error_outline</md-icon>
                <div class="ex-ai-error-meta">
                  <strong>${this.ctx.esc(errInfo.title)}</strong>
                  <p class="ex-ai-error-desc">${this.ctx.esc(errInfo.message)}</p>
                </div>
              </div>
              <div class="ex-ai-error-actions">
                <button type="button" class="ex-action-btn" data-action="open-ai-settings" data-qid="${qid}">
                  <md-icon class="ex-btn-mdicon">settings</md-icon>
                  <span>检查模型与网络设置</span>
                </button>
                <button type="button" class="ex-action-btn" data-action="bridge-ai-chat" data-qid="${qid}">
                  <md-icon class="ex-btn-mdicon">forum</md-icon>
                  <span>转入全局 AI 对话问答</span>
                </button>
                <button type="button" class="ex-action-btn" data-action="retry-ai" data-qid="${qid}">
                  <md-icon class="ex-btn-mdicon">refresh</md-icon>
                  <span>重试推导</span>
                </button>
              </div>
            </div>
          `;
        }
      }
      if (stopBtn) stopBtn.classList.add('hidden');
      if (retryBtn) retryBtn.classList.remove('hidden');
    }
  }

  public stopAiStream(qid: string): void {
    const scheduler = this.aiSchedulers.get(qid);
    if (scheduler) {
      scheduler.stop();
      this.aiSchedulers.delete(qid);
    }
    const ctrl = this.aiControllers.get(qid);
    if (ctrl) {
      ctrl.abort();
      this.aiControllers.delete(qid);
    }
  }

  public async loadCommunitySolutions(qid: string): Promise<void> {
    try {
      const list = await exerciseDb.fetchCommunitySolutions(qid);
      this.communitySolutions.set(qid, list);
      this.updateAiVersionsBar(qid);
    } catch (err) {
      console.warn('[ExerciseController] 加载社区题解失败:', err);
    }
  }

  public updateAiVersionsBar(qid: string): void {
    const card = this.ctx.getBodyContainer()?.querySelector(`#q-card-${qid}`);
    if (!card) return;
    const verBar = card.querySelector(`#ai-versions-${qid}`);
    if (!verBar) return;

    const activeVer = this.activeSolutionVersions.get(qid) || 'local';
    const list = this.communitySolutions.get(qid) || [];
    verBar.innerHTML = renderAiVersionsBarHtml(qid, activeVer, list);
  }

  public switchAiVersion(qid: string, verId: string): void {
    this.activeSolutionVersions.set(qid, verId);
    const card = this.ctx.getBodyContainer()?.querySelector(`#q-card-${qid}`);
    if (!card) return;

    this.updateAiVersionsBar(qid);

    const contentEl = card.querySelector(`#ai-content-${qid}`) as HTMLElement;
    const modelBadge = card.querySelector(`#ai-model-${qid}`);
    const statusEl = card.querySelector(`#ai-status-${qid}`);

    let md = '';
    if (verId === 'local') {
      md = this.aiSolutions.get(qid) || '';
      if (modelBadge) modelBadge.textContent = getAiModelLabel(qid, 'local', this.getCommunitySolutions(qid));
      if (statusEl) statusEl.textContent = md ? '推导完成' : '';
    } else {
      const list = this.communitySolutions.get(qid) || [];
      const match = list.find((s) => s.id === verId);
      if (match) {
        md = match.solution_md;
        if (modelBadge) modelBadge.textContent = match.model_name;
        if (statusEl) statusEl.textContent = `社区贡献 (by ${match.author_name})`;
      }
    }

    if (contentEl) {
      contentEl.innerHTML = md
        ? renderSolutionMarkdown(md, false)
        : '<div class="ex-ai-placeholder">暂未生成推导内容</div>';
      try {
        renderMathInElement(contentEl, KATEX_OPTIONS);
      } catch (e) {}
    }
  }

  public async upvoteSolution(qid: string, solId: string): Promise<void> {
    if (exerciseDb.isUpvoted(solId)) {
      this.ctx.showToast('您已经点赞过该题解');
      return;
    }

    const res = await exerciseDb.upvoteSolution(solId);
    if (res.success) {
      const list = this.communitySolutions.get(qid) || [];
      const match = list.find((s) => s.id === solId);
      if (match) match.upvotes = res.newUpvotes;
      this.updateAiVersionsBar(qid);
      this.ctx.showToast('点赞成功，感谢您的认可！');
    }
  }

  public copyAiSolution(qid: string): void {
    const activeVer = this.activeSolutionVersions.get(qid) || 'local';
    let md = '';
    if (activeVer === 'local') {
      md = this.aiSolutions.get(qid) || '';
    } else {
      const list = this.communitySolutions.get(qid) || [];
      const match = list.find((s) => s.id === activeVer);
      if (match) md = match.solution_md;
    }

    if (!md) return;
    navigator.clipboard.writeText(md).then(() => {
      this.ctx.showToast('AI 规范推导 LaTeX/Markdown 源码已复制至剪贴板');
    });
  }

  public toggleAiBox(qid: string): void {
    const card = this.ctx.getBodyContainer()?.querySelector(`#q-card-${qid}`);
    const content = card?.querySelector(`#ai-content-${qid}`);
    const chevron = card?.querySelector('.ex-ai-chevron');
    if (content) {
      content.classList.toggle('hidden');
      if (chevron) {
        chevron.classList.toggle('rotated', content.classList.contains('hidden'));
      }
    }
  }

  public switchProviderQuick(qid: string, provider: AiProviderId): void {
    if (!provider) return;
    saveAiActiveProvider(provider);
    const card = this.ctx.getBodyContainer()?.querySelector(`#q-card-${qid}`);
    const keyConfig = card?.querySelector(`#ai-key-config-${qid}`);
    if (keyConfig) {
      keyConfig.outerHTML = renderAiKeyConfigCardHtml(qid);
      const newKeyConfig = card?.querySelector(`#ai-key-config-${qid}`);
      newKeyConfig?.classList.remove('hidden');
    }
    const modelBadge = card?.querySelector(`#ai-model-${qid}`);
    if (modelBadge) {
      modelBadge.textContent = getAiModelLabel(qid, 'local', this.getCommunitySolutions(qid));
    }
  }

  public saveAiKey(qid: string): void {
    const card = this.ctx.getBodyContainer()?.querySelector(`#q-card-${qid}`);
    const input = card?.querySelector('.ex-ai-key-input') as HTMLInputElement;
    if (input && input.value.trim()) {
      const activeProvider = getAiProvider();
      saveProviderApiKey(activeProvider.id, input.value.trim());
      card?.querySelector(`#ai-key-config-${qid}`)?.classList.add('hidden');
      this.ctx.showToast('API Key 保存成功');
      this.handleAskAi(qid, true);
    } else {
      this.ctx.showToast('请输入有效的 API Key');
    }
  }

  public openAiSettings(): void {
    this.ctx.closeModal();
    window.dispatchEvent(
      new CustomEvent('astrolib:open-settings', {
        detail: {
          section: 'ai',
        },
      })
    );
  }

  public bridgeToAiChat(qid: string): void {
    const q = this.ctx.getQuestion(qid);
    if (!q) return;

    const prompt = `请对以下题目给出极为规范、详尽的推导过程与标准解法：\n\n【来源】：${q.source || `${q.paper_title || ''}（第 ${q.paper_q_num || ''} 题）`}\n【题目】：\n${q.stem_raw}\n${q.options && q.options.length ? `\n选项：\n${q.options.map((o) => `${o.key}. ${o.text_raw}`).join('\n')}` : ''}${q.answer ? `\n参考结果：${q.answer}` : ''}`;

    this.ctx.closeModal();
    window.dispatchEvent(
      new CustomEvent('aiask:query', {
        detail: {
          prompt,
          autoSubmit: true,
        },
      })
    );
  }

  public destroy(): void {
    for (const ctrl of this.aiControllers.values()) {
      ctrl.abort();
    }
    this.aiControllers.clear();
    for (const sch of this.aiSchedulers.values()) {
      sch.stop();
    }
    this.aiSchedulers.clear();
    this.aiStreamActive.clear();
  }
}
