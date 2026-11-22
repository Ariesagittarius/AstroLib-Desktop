/**
 * src/features/doc-ingestion/word-popover.ts
 * ============================================================================
 * 学术英文文献单词即点即译浮窗控制器 (Click-to-Define + M3 Popover)
 * ============================================================================
 */

import { safeParsePaperMarkdown } from './bilingual-translator';

interface DictLookupResult {
  ok: boolean;
  word: string;
  phonetic?: string;
  audioUrl?: string;
  meanings: Array<{ partOfSpeech: string; definitions: string[] }>;
  source: string;
}

export class WordPopoverController {
  private popoverEl = document.getElementById('m3-word-popover');
  private currentAudio: HTMLAudioElement | null = null;
  private currentWord = '';
  private enabled = true;
  private dictProvider = 'auto';
  private transProvider = 'google';

  constructor(options: { enabled: boolean; dictProvider: string; transProvider: string }) {
    this.enabled = options.enabled;
    this.dictProvider = options.dictProvider;
    this.transProvider = options.transProvider;
    this.bindGlobalDismiss();
  }

  public updateConfig(options: { enabled?: boolean; dictProvider?: string; transProvider?: string }): void {
    if (options.enabled !== undefined) this.enabled = options.enabled;
    if (options.dictProvider !== undefined) this.dictProvider = options.dictProvider;
    if (options.transProvider !== undefined) this.transProvider = options.transProvider;
    if (!this.enabled) {
      this.close();
    }
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public close(): void {
    if (!this.popoverEl) return;
    this.popoverEl.classList.remove('active');
    this.popoverEl.style.display = 'none';
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio = null;
    }
  }

  public attachToContainer(container: HTMLElement | null, isBilingualActive: () => boolean): void {
    if (!container) return;
    container.addEventListener('click', (e: MouseEvent) => {
      if (!isBilingualActive() || !this.enabled) return;

      const selection = window.getSelection();
      if (selection && selection.toString().trim().length > 0) return;

      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('.block-hover-actions, .block-item-translation, button, md-icon-button, a')) return;

      const hit = this.getWordAtPoint(e.clientX, e.clientY);
      if (hit) {
        void this.showDefinition(hit.word, hit.sentence, hit.rect);
      }
    });
  }

  private bindGlobalDismiss(): void {
    document.addEventListener('click', (e: MouseEvent) => {
      if (!this.popoverEl || !this.popoverEl.classList.contains('active')) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('#m3-word-popover') || target.closest('.structured-block-item')) return;
      this.close();
    });

    document.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.popoverEl?.classList.contains('active')) {
        this.close();
      }
    });
  }

  private getWordAtPoint(x: number, y: number): { word: string; sentence: string; rect: DOMRect } | null {
    let textNode: Node | null = null;
    let offset = 0;

    if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(x, y);
      if (pos && pos.offsetNode && pos.offsetNode.nodeType === Node.TEXT_NODE) {
        textNode = pos.offsetNode;
        offset = pos.offset;
      }
    } else if ((document as any).caretRangeFromPoint) {
      const r = (document as any).caretRangeFromPoint(x, y);
      if (r && r.startContainer && r.startContainer.nodeType === Node.TEXT_NODE) {
        textNode = r.startContainer;
        offset = r.startOffset;
      }
    }

    if (!textNode || !textNode.textContent) return null;
    const parentEl = textNode.parentElement;
    if (!parentEl) return null;
    if (
      parentEl.closest(
        '.katex, .doc-equation-display, pre, code, .block-hover-actions, .block-item-translation, button, .doc-footnote-ref'
      )
    ) {
      return null;
    }

    const blockCard = parentEl.closest(
      '.structured-block-item.type-text, .structured-block-item.type-title, .structured-block-item.type-paragraph'
    );
    if (!blockCard) return null;

    const text = textNode.textContent;
    let start = offset;
    let end = offset;

    if (offset > 0 && (offset >= text.length || !/[a-zA-Z]/.test(text[offset])) && /[a-zA-Z]/.test(text[offset - 1])) {
      start = offset - 1;
      end = offset - 1;
    }
    if (start >= text.length || !/[a-zA-Z]/.test(text[start])) return null;

    while (start > 0 && /[a-zA-Z\-'’]/.test(text[start - 1])) start--;
    while (end < text.length && /[a-zA-Z\-'’]/.test(text[end])) end++;

    const rawWord = text.slice(start, end).replace(/^['’\-]+|['’\-]+$/g, '');
    if (!rawWord || rawWord.length < 2) return null;

    const range = document.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, end);
    const rect = range.getBoundingClientRect();

    const fullBlockText = blockCard.querySelector('.block-item-body')?.textContent || text;
    let sentence = text;
    const sentenceMatches = fullBlockText.match(/[^.!?]+[.!?]+/g);
    if (sentenceMatches) {
      for (const s of sentenceMatches) {
        if (s.toLowerCase().includes(rawWord.toLowerCase())) {
          sentence = s.trim();
          break;
        }
      }
    }

    return { word: rawWord, sentence, rect };
  }

  private positionPopover(rect: DOMRect): void {
    if (!this.popoverEl) return;
    if (window.innerWidth <= 800) {
      this.popoverEl.classList.add('mobile-sheet');
      this.popoverEl.style.top = '';
      this.popoverEl.style.left = '';
      this.popoverEl.style.right = '';
      this.popoverEl.style.bottom = '';
      this.popoverEl.style.display = 'block';
      void this.popoverEl.offsetWidth;
      this.popoverEl.classList.add('active');
      return;
    }

    this.popoverEl.classList.remove('mobile-sheet');
    this.popoverEl.style.display = 'block';

    const popoverWidth = Math.min(320, window.innerWidth - 32);
    const popoverHeight = 220;

    let top = rect.bottom + 8;
    if (top + popoverHeight > window.innerHeight - 16 && rect.top - popoverHeight > 16) {
      top = rect.top - popoverHeight - 8;
    }

    let left = rect.left + rect.width / 2 - popoverWidth / 2;
    left = Math.max(16, Math.min(window.innerWidth - popoverWidth - 16, left));

    this.popoverEl.style.top = `${top}px`;
    this.popoverEl.style.left = `${left}px`;
    void this.popoverEl.offsetWidth;
    this.popoverEl.classList.add('active');
  }

  private async fetchClientDirectDict(word: string): Promise<DictLookupResult | null> {
    try {
      const res = await fetch(`https://dict.youdao.com/jsonapi?q=${encodeURIComponent(word)}`);
      if (res.ok) {
        const d = await res.json();
        const simpleWord = d.simple?.word?.[0];
        const phonetic = simpleWord?.usphone
          ? `/${simpleWord.usphone}/`
          : simpleWord?.ukphone
            ? `/${simpleWord.ukphone}/`
            : undefined;
        const audioUrl = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word)}&type=2`;
        const trs = d.ec?.word?.[0]?.trs;
        const meanings: Array<{ partOfSpeech: string; definitions: string[] }> = [];

        if (Array.isArray(trs)) {
          for (const item of trs) {
            const text = item?.tr?.[0]?.l?.i?.[0] || '';
            if (!text) continue;
            const m = text.match(/^([a-z]+\.)\s*(.+)$/i);
            if (m) {
              const defs = m[2].split(/[,，、；;]/).map((s: string) => s.trim()).filter(Boolean);
              if (defs.length > 0) meanings.push({ partOfSpeech: m[1].toLowerCase(), definitions: defs.slice(0, 5) });
            } else {
              meanings.push({ partOfSpeech: '', definitions: [text] });
            }
          }
        }
        if (meanings.length > 0) {
          return { ok: true, word, phonetic, audioUrl, meanings, source: 'youdao-jsonapi' };
        }
      }
    } catch {}

    try {
      const res = await fetch(`https://dict.youdao.com/suggest?num=1&doctype=json&q=${encodeURIComponent(word)}`);
      if (res.ok) {
        const json = await res.json();
        const entry = json?.data?.entries?.[0];
        if (entry?.explain) {
          const posMatch = entry.explain.match(/^([a-z]+\.)\s*(.+)$/i);
          const pos = posMatch ? posMatch[1].toLowerCase() : '';
          const raw = posMatch ? posMatch[2] : entry.explain;
          const defs = raw.split(/[,，、；;]/).map((s: string) => s.trim()).filter(Boolean);
          return {
            ok: true,
            word,
            audioUrl: `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word)}&type=2`,
            meanings: [{ partOfSpeech: pos, definitions: defs.slice(0, 5) }],
            source: 'youdao-suggest',
          };
        }
      }
    } catch {}

    return null;
  }

  private async showDefinition(word: string, sentence: string, rect: DOMRect): Promise<void> {
    if (!this.popoverEl) return;
    this.currentWord = word;

    this.positionPopover(rect);
    this.popoverEl.innerHTML = `
      <div class="m3-word-header">
        <div class="m3-word-header-left">
          <span class="m3-word-title">${word}</span>
          <span class="m3-word-phonetic">查询中...</span>
        </div>
        <div class="m3-word-header-actions">
          <button type="button" class="m3-word-close-btn" id="m3-word-close" title="关闭" aria-label="关闭">
            <span class="material-symbols-outlined" style="font-size: 16px;">close</span>
          </button>
        </div>
      </div>
      <div style="font-size: 0.8rem; color: var(--md3-on-surface-variant); padding: 8px 0;">正在检索多源词典...</div>
    `;
    document.getElementById('m3-word-close')?.addEventListener('click', () => this.close());

    let data: DictLookupResult | null = null;
    try {
      const res = await fetch(
        `/api/dict?word=${encodeURIComponent(word)}&provider=${encodeURIComponent(this.dictProvider)}`
      );
      const contentType = res.headers.get('content-type') || '';
      if (res.ok && contentType.includes('application/json')) {
        const json = await res.json();
        if (json && json.ok && Array.isArray(json.meanings) && json.meanings.length > 0) {
          data = json;
        }
      }
    } catch {}

    if (!data) {
      data = await this.fetchClientDirectDict(word);
    }

    if (!this.popoverEl.classList.contains('active') || this.currentWord !== word) return;

    if (!data || !data.ok || !data.meanings || data.meanings.length === 0) {
      this.popoverEl.innerHTML = `
        <div class="m3-word-header">
          <div class="m3-word-header-left"><span class="m3-word-title">${word}</span></div>
          <div class="m3-word-header-actions">
            <button type="button" class="m3-word-close-btn" id="m3-word-close" title="关闭" aria-label="关闭">
              <span class="material-symbols-outlined" style="font-size: 16px;">close</span>
            </button>
          </div>
        </div>
        <div style="font-size: 0.82rem; color: var(--md3-outline); padding: 6px 0;">未在词库中命中释义</div>
        <div class="m3-word-ai-section">
          <button type="button" class="m3-ai-context-btn" id="btn-explain-context">
            <span class="material-symbols-outlined" style="font-size: 14px;">auto_awesome</span>
            <span>AI 学术语境解析</span>
          </button>
          <div id="ai-context-result" style="display: none;"></div>
        </div>
      `;
      this.bindPopoverActions(word, sentence);
      return;
    }

    const meaningsHtml = data.meanings
      .map(
        (m) => `
      <div class="m3-word-meaning-row">
        ${m.partOfSpeech ? `<span class="m3-pos-chip">${m.partOfSpeech}</span>` : ''}
        <div class="m3-word-defs">${m.definitions.join('； ')}</div>
      </div>
    `
      )
      .join('');

    this.popoverEl.innerHTML = `
      <div class="m3-word-header">
        <div class="m3-word-header-left">
          <span class="m3-word-title">${data.word || word}</span>
          ${data.phonetic ? `<span class="m3-word-phonetic">${data.phonetic}</span>` : ''}
        </div>
        <div class="m3-word-header-actions">
          <button type="button" class="m3-word-audio-btn" id="m3-word-audio" title="朗读发音" aria-label="朗读发音">
            <span class="material-symbols-outlined" style="font-size: 17px;">volume_up</span>
          </button>
          <button type="button" class="m3-word-close-btn" id="m3-word-close" title="关闭" aria-label="关闭">
            <span class="material-symbols-outlined" style="font-size: 16px;">close</span>
          </button>
        </div>
      </div>
      <div class="m3-word-meanings">${meaningsHtml}</div>
      <div class="m3-word-ai-section">
        <button type="button" class="m3-ai-context-btn" id="btn-explain-context" title="结合本文原句解析学术用法">
          <span class="material-symbols-outlined" style="font-size: 14px;">auto_awesome</span>
          <span>学术语境</span>
        </button>
        <div id="ai-context-result" style="display: none;"></div>
      </div>
    `;
    this.bindPopoverActions(word, sentence, data.audioUrl);
  }

  private bindPopoverActions(word: string, sentence: string, audioUrl?: string): void {
    document.getElementById('m3-word-close')?.addEventListener('click', () => this.close());

    document.getElementById('m3-word-audio')?.addEventListener('click', () => {
      if (audioUrl) {
        if (this.currentAudio) this.currentAudio.pause();
        this.currentAudio = new Audio(audioUrl);
        this.currentAudio.play().catch(() => this.speakFallback(word));
      } else {
        this.speakFallback(word);
      }
    });

    const aiBtn = document.getElementById('btn-explain-context') as HTMLButtonElement | null;
    const aiBox = document.getElementById('ai-context-result');
    aiBtn?.addEventListener('click', async () => {
      if (!aiBtn || !aiBox) return;
      aiBtn.disabled = true;
      aiBtn.innerHTML = `<span class="material-symbols-outlined" style="font-size: 14px;">sync</span><span>研判中...</span>`;
      aiBox.style.display = 'block';
      aiBox.innerHTML = '<div class="m3-ai-context-box" style="color: var(--md3-outline);">正在结合学术原句深度研判...</div>';

      try {
        let res = await fetch('/api/dict/context', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ word, sentence, provider: this.transProvider }),
        });
        if (!res.ok) {
          res = await fetch('/api/translate/dict/context', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ word, sentence, provider: this.transProvider }),
          });
        }
        const data = await res.json();
        if (data.ok && data.explanation) {
          aiBox.innerHTML = `<div class="m3-ai-context-box">${safeParsePaperMarkdown(data.explanation)}</div>`;
          aiBtn.style.display = 'none';
        } else {
          aiBox.innerHTML = `<div class="m3-ai-context-box" style="color: var(--md-sys-color-error, #ba1a1a);">语境解析未完成: ${data.error || '通道繁忙'}</div>`;
          aiBtn.disabled = false;
          aiBtn.innerHTML = `<span class="material-symbols-outlined" style="font-size: 14px;">auto_awesome</span><span>重试学术语境</span>`;
        }
      } catch (e: any) {
        aiBox.innerHTML = `<div class="m3-ai-context-box" style="color: var(--md-sys-color-error, #ba1a1a);">解析异常: ${e?.message || e}</div>`;
        aiBtn.disabled = false;
        aiBtn.innerHTML = `<span class="material-symbols-outlined" style="font-size: 14px;">auto_awesome</span><span>重试学术语境</span>`;
      }
    });
  }

  private speakFallback(word: string): void {
    if ('speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(word);
      u.lang = 'en-US';
      window.speechSynthesis.speak(u);
    }
  }
}
