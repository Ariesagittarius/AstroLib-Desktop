import { mdToHtml } from '../../ai/client/chat-markdown.ts';
import type { ChatMessage as AgentChatMessage } from '../../ai/agent/context-manager.ts';
import type { ProviderConfig } from './types.ts';

export interface BtwAskParams {
  question: string;
  prefixMessages: AgentChatMessage[];
  provider: ProviderConfig;
  modelId: string;
  toolsPayload: any[];
  systemPrompt: string;
}

export class BtwSidecarController {
  private hostEl: HTMLElement;
  private hydrateFn?: (el: HTMLElement) => void;
  private abortController: AbortController | null = null;
  private activeCard: HTMLElement | null = null;
  private lastAnswerMarkdown = '';

  constructor(hostEl: HTMLElement, hydrateFn?: (el: HTMLElement) => void) {
    this.hostEl = hostEl;
    this.hydrateFn = hydrateFn;
  }

  public close(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.hostEl.innerHTML = '';
    this.activeCard = null;
  }

  public async openAndAsk(params: BtwAskParams): Promise<void> {
    const q = (params.question || '').trim();
    if (!q) return;

    this.close();

    const esc = (s: string) =>
      s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    const card = document.createElement('section');
    card.className = 'harness-btw-card';
    card.setAttribute('aria-label', '侧载快速旁问 (/btw)');
    card.innerHTML = `
      <div class="harness-btw-card__head">
        <div class="harness-btw-card__title">
          <span class="material-symbols-outlined" style="font-size:16px;" aria-hidden="true">forum</span>
          <span>侧载旁问 · /btw</span>
          <span class="harness-btw-card__badge">不写入主记录 · 共享前缀缓存</span>
        </div>
        <div class="harness-btw-card__actions">
          <button type="button" class="harness-followup-btn" data-btw-copy title="复制旁问回答">复制</button>
          <button type="button" class="harness-icon-btn" data-btw-close title="关闭侧载窗 (Esc)" style="width:26px;height:26px;">
            <span class="material-symbols-outlined" style="font-size:16px;" aria-hidden="true">close</span>
          </button>
        </div>
      </div>
      <div class="harness-btw-card__question">${esc(q)}</div>
      <div class="harness-btw-card__body harness-markdown" data-btw-body>
        <span class="harness-btw-loading">正在沿用当前上下文快速回答…</span>
      </div>
    `;

    card.querySelector('[data-btw-close]')?.addEventListener('click', () => this.close());
    card.querySelector('[data-btw-copy]')?.addEventListener('click', (ev) => {
      if (!this.lastAnswerMarkdown) return;
      navigator.clipboard?.writeText(this.lastAnswerMarkdown);
      const btn = ev.currentTarget as HTMLElement;
      const old = btn.textContent;
      btn.textContent = '已复制';
      setTimeout(() => {
        btn.textContent = old;
      }, 1400);
    });

    this.hostEl.innerHTML = '';
    this.hostEl.appendChild(card);
    this.activeCard = card;

    const bodyEl = card.querySelector<HTMLElement>('[data-btw-body]')!;
    const abortCtrl = new AbortController();
    this.abortController = abortCtrl;
    this.lastAnswerMarkdown = '';

    const basePrefix: AgentChatMessage[] =
      params.prefixMessages.length > 0
        ? [...params.prefixMessages]
        : [{ role: 'system', content: params.systemPrompt }];

    const wireMessages = [
      ...basePrefix,
      {
        role: 'user' as const,
        content: `[侧载即时提问 /btw — 请仅依据已建立上下文简洁作答，勿调用工具]\n${q}`,
      },
    ];

    try {
      let res: Response;
      if (params.provider.id === 'antigravity-cli') {
        res = await fetch('/api/v1/content/antigravity-cli/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: `[Side question /btw] ${q}`,
            model: params.modelId,
            systemPrompt: params.systemPrompt,
          }),
          signal: abortCtrl.signal,
        });
      } else {
        res = await fetch('/api/v1/content/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider: params.provider.id,
            baseURL: params.provider.baseURL,
            apiKey: params.provider.apiKey,
            headers: params.provider.headers,
            model: params.modelId,
            messages: wireMessages,
            stream: true,
            max_tokens: 2048,
            tools: params.toolsPayload,
            ...(params.toolsPayload.length > 0 ? { tool_choice: 'none' } : {}),
          }),
          signal: abortCtrl.signal,
        });
      }

      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let partialLine = '';
      let lastRender = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const textChunk = decoder.decode(value, { stream: true });
        const lines = (partialLine + textChunk).split('\n');
        partialLine = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;
          if (trimmed === 'data: [DONE]') break;
          let data: any;
          try {
            data = JSON.parse(trimmed.replace(/^data:\s*/, ''));
          } catch {
            continue;
          }
          if (data.error) {
            throw new Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error));
          }
          const delta = data.choices?.[0]?.delta;
          if (delta?.content) {
            this.lastAnswerMarkdown += delta.content;
            const now = Date.now();
            if (now - lastRender >= 70) {
              lastRender = now;
              bodyEl.innerHTML = mdToHtml(this.lastAnswerMarkdown, true);
            }
          }
        }
      }

      bodyEl.innerHTML = this.lastAnswerMarkdown.trim()
        ? mdToHtml(this.lastAnswerMarkdown, true)
        : '<span style="color:var(--harness-text-secondary);">（模型未返回正文）</span>';
      this.hydrateFn?.(bodyEl);
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      bodyEl.innerHTML = `<div style="color:var(--md-sys-color-error);font-size:0.82rem;">侧载提问失败: ${esc(err?.message || String(err))}</div>`;
    } finally {
      if (this.abortController === abortCtrl) {
        this.abortController = null;
      }
    }
  }
}
