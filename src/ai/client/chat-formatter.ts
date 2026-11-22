/**
 * src/ai/client/chat-formatter.ts
 * ============================================================================
 * Helper formatters and markdown/json renderers for AI Ask Component
 * ============================================================================
 */

export function esc(s: string): string {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function cleanSingleLine(s: string): string {
  return (s || '').replace(/\s+/g, ' ').trim();
}

export function capSnippet(s: string, n = 110): string {
  const t = cleanSingleLine(s);
  return t.length > n ? t.slice(0, n) + '…' : t;
}

export function jsonHighlight(escaped: string): string {
  return escaped
    .replace(/"([^"]+)":/g, '<span class="tok-key">"$1"</span>:')
    .replace(/: "([^"]*)"/g, ': <span class="tok-str">"$1"</span>')
    .replace(/: (-?\d+(?:\.\d+)?)/g, ': <span class="tok-num">$1</span>')
    .replace(/: (true|false)/g, ': <span class="tok-bool">$1</span>')
    .replace(/: (null)/g, ': <span class="tok-null">$1</span>');
}

export function capJsonText(v: any, cap = 1200): string {
  let s = '';
  try {
    s = JSON.stringify(v, null, 2) || '';
  } catch {
    s = String(v);
  }
  if (s.length > cap) {
    return s.slice(0, cap) + `\n… (其余 ${s.length - cap} 字符已折叠)`;
  }
  return s;
}

export function decorateFootnotes(html: string, decorate = true): string {
  if (!decorate || !html) return html || '';
  const protectedBlocks: string[] = [];
  // 保护 pre, code, a 标签，以及包含数学公式的标签与 HTML 属性，避免数学公式下标被误换为链接
  let safe = html.replace(/(<(?:pre|code|a|p\s+class="md-math")[^>]*>[\s\S]*?<\/(?:pre|code|a|p)>|<[^>]+>)/gi, (m) => {
    protectedBlocks.push(m);
    return `___FN_PROT_${protectedBlocks.length - 1}___`;
  });
  safe = safe.replace(/\[(\d+)\]/g, (_m, n) => `<a class="cite-ref" href="#ai-cite-${n}">[${n}]</a>`);
  return safe.replace(/___FN_PROT_(\d+)___/g, (_m, i) => protectedBlocks[Number(i)] || '');
}

export function toolSummary(name: string, out: any = {}): string {
  let summary = '执行完成';
  if (name === 'book_retrieve') {
    const n = out.count ?? (out.results || []).length;
    const titles = (out.results || []).slice(0, 2).map((r: any) => r.title).filter(Boolean).join('、');
    summary = `命中 ${n} 条${titles ? `：${titles}` : ''}`;
  } else if (name === 'book_chunk') {
    summary = out.found ? '已取片段全文' : '未找到片段';
  } else if (name === 'book_slice_search') {
    const n = out.count ?? (out.hits || []).length;
    const titles = (out.hits || []).slice(0, 2).map((r: any) => r.title).filter(Boolean).join('、');
    summary = `命中 ${n} 条${titles ? `：${titles}` : ''}`;
  } else if (name === 'book_chapter_outline') {
    if (out.found === false) {
      summary = '未找到匹配章节（可给章号或标题后重试）';
    } else if (out.chapter) {
      const secs = (out.chapter.sections || []).length;
      const cards = (out.chapter.sections || []).reduce((s: number, x: any) => s + (x.cards || []).length, 0);
      const t = out.chapter.title ? `：${out.chapter.title}` : '';
      summary = `章 ${out.chapter.number || ''}${t}（${secs} 小节 / ${cards} 卡片）`;
    } else {
      summary = `列出 ${(out.chapters || []).length} 章（${out.count ?? ''}）`;
    }
  } else if (name === 'book_read_section') {
    if (out.found === false) {
      summary = '未找到起始片段（可用 id/标题/编号）';
    } else {
      summary = `已读 ${out.count} 段${out.truncated ? '（部分截断）' : ''}`;
    }
  } else if (name === 'list_books') {
    summary = `列出 ${(out.books || []).length} 本书`;
  } else if (name === 'book_toc') {
    summary = out.found ? `已获取目录（${out.units?.length || 0} 个单元）` : '未找到目录';
  }
  return summary;
}

export const CHAT_DEFAULT_SUGGESTIONS = [
  '夹逼定理是什么意思？',
  '什么情况下用麦克劳林展开？',
  '这道例题的解题步骤是什么？',
];

export const CHAT_LITERARY_SUGGESTIONS = [
  '梳理本章的核心情节与人物关系',
  '解读本章的关键细节、伏笔与心理描写',
  '概括本节涉及的背景设定与译注要点',
];

export function getElementDataConfig(el: Element): any {
  try { return JSON.parse(el.getAttribute('data-config') || '{}'); } catch { return {}; }
}

