import {
  getAiProvider,
  getAiExtendedThinking,
  getAiCollapseToolsSummary,
  getAiAutoCollapsePreceding,
  formatExplorationSummary,
} from '../ai-config';
import { parseAiError, renderErrorCardHtml } from '../error-handler';
import { createM3LoadingHtml } from '../../components/common/m3-loading-helper';
import { mdToHtml } from './chat-markdown';
import { decorateFootnotes, toolSummary, capJsonText } from './chat-formatter';
import { renderToolBlocksHtml } from './chat-tools-view';

export interface GenerateAnswerContext {
  blocksEl: HTMLElement;
  opts: any;
  params: any;
  apiKey: string;
  modelDef: any;
  bookTitle: string;
  bookKey: string;
  col: string;
  book: string;
  bookList: any[];
  activeThread: any;
  abortSignal: AbortSignal;
  aiModules: any;
  sourceOpenNew: boolean;
  historyFromThread: (t: any) => any[];
  getIndex: () => Promise<any>;
  fallbackSummary: (toolLog: any[]) => string;
  typeMath: (el: HTMLElement) => void;
  scrollThread: () => void;
  collapseTools: (el: HTMLElement) => void;
  collapsePreceding: (force?: boolean) => void;
  setStreaming: (streaming: boolean) => void;
  updateSendState: () => void;
}

export async function generateChatAnswer(ctx: GenerateAnswerContext): Promise<any> {
  const {
    blocksEl,
    opts,
    params,
    apiKey,
    modelDef,
    bookTitle,
    col,
    book,
    bookList,
    activeThread,
    abortSignal,
    aiModules: ai,
    sourceOpenNew,
    historyFromThread,
    getIndex,
    fallbackSummary,
    typeMath,
    scrollThread,
    collapseTools,
    collapsePreceding,
    setStreaming,
    updateSendState,
  } = ctx;

  const { mode = 'retrieve', idx = null, hits = [], question, chapterRef = null, chapterRefs = null } = opts || {};
  const discussion = mode === 'discussion';
  const toolDefs = ai.buildToolDefs();
  const context = discussion ? '' : ai.buildContext(hits.map((h: any) => h.chunk), params.maxContextChars);
  const messages = ai.buildMessages({
    question,
    context,
    bookTitle: (idx && idx.meta && idx.meta.title) || bookTitle,
    history: historyFromThread(activeThread),
    toolsDesc: ai.toolsDesc(),
    discussion,
    chapterRef,
    chapterRefs: chapterRefs || (chapterRef ? [chapterRef] : null),
    extendedThinking: getAiExtendedThinking(),
  });
  const toolCtx = { index: discussion ? null : idx, bookList, col, book };
  const endpoint = modelDef.endpoint;
  const model = modelDef.model;

  let full = '';
  let lastText = '';
  const toolLog: any[] = [];
  const segments: any[] = [];
  const replyEls: HTMLElement[] = [];

  let curText = '';
  let curTextEl: HTMLElement | null = null;
  let scheduled = false;

  const addReplyEl = () => {
    const d = document.createElement('div');
    d.className = 'ai-md ask-ai-reply';
    blocksEl.appendChild(d);
    replyEls.push(d);
    return d;
  };

  const renderCur = () => {
    if (!curTextEl) return;
    curTextEl.innerHTML = decorateFootnotes(mdToHtml(curText, sourceOpenNew), !discussion)
      + '<span class="ask-caret"></span>';
    typeMath(curTextEl);
    scrollThread();
    scheduled = false;
  };

  const scheduleRender = () => {
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(renderCur);
    }
  };

  const flushReply = () => {
    if (curText && curText.trim()) {
      segments.push({ kind: 'reply', text: curText });
      if (curTextEl) {
        const c = curTextEl.querySelector('.ask-caret');
        if (c) c.remove();
      }
    }
    curText = '';
    curTextEl = null;
  };

  const maxTurns = 8;
  let usedTools = false;
  let currentToolsGroupEl: HTMLElement | null = null;
  let currentGroupTools: any[] = [];

  const finishCurrentExplorationGroup = () => {
    if (!currentToolsGroupEl || !currentGroupTools.length) return;
    const titleEl = currentToolsGroupEl.querySelector('.ask-tools-group-title');
    if (titleEl) {
      titleEl.textContent = formatExplorationSummary(currentGroupTools);
    }
    if (getAiCollapseToolsSummary()) {
      currentToolsGroupEl.removeAttribute('open');
      collapseTools(currentToolsGroupEl);
    }
    currentToolsGroupEl = null;
    currentGroupTools = [];
  };

  try {
    setStreaming(true);
    updateSendState();
    for (let turn = 0; turn < maxTurns; turn++) {
      curText = '';
      curTextEl = null;
      const res = await ai.streamChat({
        endpoint, apiKey, model, messages,
        tools: toolDefs, toolChoice: 'auto',
        signal: abortSignal,
        onDelta: (d: string) => {
          const placeholder = blocksEl.querySelector('.ask-msg-thinking-placeholder');
          if (placeholder) placeholder.remove();
          if (usedTools) {
            finishCurrentExplorationGroup();
            collapseTools(blocksEl);
          }
          curText += d;
          full += d;
          if (!curTextEl) curTextEl = addReplyEl();
          scheduleRender();
        },
      });
      lastText = res.text || '';
      if (res.toolCalls && res.toolCalls.length) {
        usedTools = true;
        messages.push({
          role: 'assistant',
          content: res.text || null,
          tool_calls: res.toolCalls.map((tc: any) => {
            const callObj: any = {
              id: tc.id,
              type: 'function',
              function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
            };
            if (tc.extra_content) {
              callObj.extra_content = tc.extra_content;
            }
            return callObj;
          }),
        });
        flushReply();
        for (const tc of res.toolCalls) {
          const placeholder = blocksEl.querySelector('.ask-msg-thinking-placeholder');
          if (placeholder) placeholder.remove();

          if (!currentToolsGroupEl) {
            const groupEl = document.createElement('details');
            groupEl.className = 'ask-tools-group';
            groupEl.setAttribute('open', '');
            groupEl.innerHTML = `
              <summary class="ask-tools-group-summary" title="点击展开/收起工具调用详情">
                <span class="ask-tools-group-title">正在执行工具探索...</span>
                <svg class="ask-tools-group-chevron" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
              </summary>
              <div class="ask-tools-group-items"></div>
            `;
            blocksEl.appendChild(groupEl);
            currentToolsGroupEl = groupEl;
          }

          const inFlight = document.createElement('div');
          inFlight.className = 'ask-tool-in-flight';
          inFlight.innerHTML = createM3LoadingHtml({
            variant: 'default',
            size: 'compact',
            layout: 'inline',
            label: `正在检索章节知识库 [${tc.name}]...`,
          });
          const itemsEl = currentToolsGroupEl.querySelector<HTMLElement>('.ask-tools-group-items') || blocksEl;
          itemsEl.appendChild(inFlight);
          scrollThread();

          let out: any, summary: string;
          try {
            if (!toolCtx.index && tc.name !== 'list_books') toolCtx.index = await getIndex();
            out = await ai.runClientTool(tc.name, tc.arguments, toolCtx);
            summary = toolSummary(tc.name, out);
          } catch (e: any) {
            out = { error: e.message || String(e) };
            summary = '执行失败';
          } finally {
            inFlight.remove();
          }
          const t = { name: tc.name, args: tc.arguments || {}, summary, resultRaw: out, resultText: capJsonText(out) };
          toolLog.push(t);
          segments.push({ kind: 'tool', name: t.name, args: t.args, summary: t.summary, resultText: t.resultText });
          currentGroupTools.push(t);
          itemsEl.insertAdjacentHTML('beforeend', renderToolBlocksHtml([t], true));

          const titleEl = currentToolsGroupEl.querySelector('.ask-tools-group-title');
          if (titleEl) {
            titleEl.textContent = `正在执行工具探索 (${currentGroupTools.length} 步)...`;
          }

          messages.push({ role: 'tool', tool_call_id: tc.id, name: tc.name, content: JSON.stringify(out) });
        }
        continue;
      }
      break;
    }
    flushReply();
  } catch (e: any) {
    const placeholder = blocksEl.querySelector('.ask-msg-thinking-placeholder');
    if (placeholder) placeholder.remove();
    if (e.name !== 'AbortError') {
      const provider = getAiProvider();
      const errInfo = parseAiError(e, {
        providerId: provider.id,
        providerLabel: provider.label,
        modelId: modelDef.model || modelDef.id,
        modelLabel: modelDef.label || modelDef.id,
        endpoint,
      });

      const errorCardHtml = renderErrorCardHtml(errInfo);
      if (curText && curText.trim()) segments.push({ kind: 'reply', text: curText });
      segments.push({ kind: 'error', errorInfo: errInfo, html: errorCardHtml });
      full += (full && full.trim() ? '\n\n' : '') + `[${errInfo.title}] ${errInfo.message}`;

      const d = addReplyEl();
      d.innerHTML = errorCardHtml;
    }
  } finally {
    finishCurrentExplorationGroup();
    collapseTools(blocksEl);
    if (getAiAutoCollapsePreceding()) {
      collapsePreceding(true);
    }
    setStreaming(false);
    updateSendState();
    for (const el of replyEls) {
      const c = el.querySelector('.ask-caret');
      if (c) c.remove();
    }
    if (usedTools && toolLog.length && !lastText.trim()) {
      const fb = fallbackSummary(toolLog);
      if (fb) {
        full = (full && full.trim()) ? `${full.trim()}\n\n${fb}` : fb;
        segments.push({ kind: 'reply', text: fb });
        const d = addReplyEl();
        d.innerHTML = decorateFootnotes(mdToHtml(fb, sourceOpenNew), !discussion);
        typeMath(d);
      }
    }
    scrollThread();
  }
  return { text: full, tools: toolLog, segments };
}
