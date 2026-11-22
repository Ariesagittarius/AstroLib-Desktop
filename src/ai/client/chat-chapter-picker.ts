import type { ReferencedChapter } from './chat-controller.state';

export interface ChapterPickerHost {
  getReferencedChapters(): ReferencedChapter[];
  addReferencedChapter(chapter: ReferencedChapter): boolean;
  removeReferencedChapter(url: string): boolean;
  clearReferencedChapters(): void;
  updateContextRow(): void;
  closeModelMenu(): void;
  getInput(): HTMLTextAreaElement | null;
  growInput(): void;
}

export class ChatChapterPicker {
  private host: ChapterPickerHost;
  private chaptersCache: Array<{ title: string; url: string }> | null = null;
  private chapterTextCache: Map<string, Promise<string>> = new Map();

  constructor(host: ChapterPickerHost) {
    this.host = host;
  }

  public getCurrentChapterInfo(): { title: string; url: string; text: string } {
    if (typeof document === 'undefined') {
      return { title: '本章节', url: '', text: '' };
    }
    const h1 = document.querySelector('.main-pane h1, main h1, #starlight-content-title');
    let title = h1?.textContent?.trim() || '';
    if (!title) {
      title = document.title.split(' - ')[0]?.trim() || '本章节';
    }
    const url = typeof window !== 'undefined' ? window.location.pathname : '';

    let text = '';
    const article = document.querySelector('.main-pane article, .main-pane main, main');
    if (article) {
      const clone = article.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('script, style, .print\\:hidden, button, .ex-card-actions, md-icon').forEach((el) => el.remove());
      text = (clone.innerText || clone.textContent || '').replace(/\s+/g, ' ').trim();
    }
    return { title, url, text };
  }

  public extractBookChapters(): Array<{ title: string; url: string }> {
    if (this.chaptersCache && this.chaptersCache.length > 0) {
      return this.chaptersCache;
    }

    if (typeof document === 'undefined') return [];

    const currentPath = typeof window !== 'undefined' ? window.location.pathname : '';
    const match = currentPath.match(/\/collections\/([^/]+)\/([^/]+)/);
    const bookPrefix = match ? `/collections/${match[1]}/${match[2]}/` : '';

    const links = document.querySelectorAll<HTMLAnchorElement>(
      '#starlight__sidebar a[href], nav.sidebar a[href], aside.sidebar a[href], .custom-sidebar-sublist a[href]'
    );

    const chapters: Array<{ title: string; url: string }> = [];
    const seen = new Set<string>();

    links.forEach((a) => {
      const href = a.getAttribute('href') || '';
      if (!href) return;
      if (bookPrefix && !href.includes(bookPrefix)) return;
      const cleanUrl = href.split('#')[0].split('?')[0];
      if (seen.has(cleanUrl)) return;
      seen.add(cleanUrl);
      const text = (a.textContent || '').trim().replace(/\s+/g, ' ');
      if (text && !text.includes('EPUB') && !text.includes('真题') && !text.includes('习题')) {
        chapters.push({ title: text, url: cleanUrl });
      }
    });

    if (chapters.length === 0) {
      const cur = this.getCurrentChapterInfo();
      if (cur.title && cur.url) {
        chapters.push({ title: cur.title, url: cur.url });
      }
    }

    this.chaptersCache = chapters;
    return chapters;
  }

  public async prefetchChapterText(url: string): Promise<string> {
    if (this.chapterTextCache.has(url)) {
      return this.chapterTextCache.get(url)!;
    }
    const currentPath = typeof window !== 'undefined' ? window.location.pathname : '';
    if (url === currentPath) {
      const cur = this.getCurrentChapterInfo();
      const p = Promise.resolve(cur.text || '');
      this.chapterTextCache.set(url, p);
      return p;
    }
    const promise = (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) return '';
        const html = await res.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const article = doc.querySelector('.main-pane article, .main-pane main, main');
        if (article) {
          article.querySelectorAll('script, style, .print\\:hidden, button, .ex-card-actions, md-icon').forEach((el) => el.remove());
          return (article.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 4000);
        }
      } catch {

      }
      return '';
    })();
    this.chapterTextCache.set(url, promise);
    return promise;
  }

  public renderPickerList(
    container: HTMLElement,
    countEl: HTMLElement | null,
    onChanged: () => void
  ): void {
    const chapters = this.extractBookChapters();
    container.innerHTML = '';
    const referenced = this.host.getReferencedChapters();

    chapters.forEach((ch) => {
      const isChecked = referenced.some((c) => c.url === ch.url);

      const li = document.createElement('li');
      li.className = 'ask-chapter-picker-item';
      li.setAttribute('data-url', ch.url);

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'ask-chapter-picker-checkbox';
      cb.checked = isChecked;

      const span = document.createElement('span');
      span.className = 'ask-chapter-picker-label';
      span.textContent = ch.title;
      span.title = ch.title;

      const toggleCheck = () => {
        cb.checked = !cb.checked;
        if (cb.checked) {
          const item: ReferencedChapter = { title: ch.title, url: ch.url };
          const cur = typeof window !== 'undefined' ? window.location.pathname : '';
          if (ch.url === cur) {
            item.isCurrent = true;
            item.text = this.getCurrentChapterInfo().text;
          } else {
            this.prefetchChapterText(ch.url).then((t) => { item.text = t; });
          }
          this.host.addReferencedChapter(item);
        } else {
          this.host.removeReferencedChapter(ch.url);
        }
        this.updatePickerCount(countEl);
        onChanged();
      };

      cb.addEventListener('change', (e) => {
        e.stopPropagation();
        if (cb.checked) {
          const item: ReferencedChapter = { title: ch.title, url: ch.url };
          const cur = typeof window !== 'undefined' ? window.location.pathname : '';
          if (ch.url === cur) {
            item.isCurrent = true;
            item.text = this.getCurrentChapterInfo().text;
          } else {
            this.prefetchChapterText(ch.url).then((t) => { item.text = t; });
          }
          this.host.addReferencedChapter(item);
        } else {
          this.host.removeReferencedChapter(ch.url);
        }
        this.updatePickerCount(countEl);
        onChanged();
      });

      li.addEventListener('click', (e) => {
        if (e.target !== cb) {
          toggleCheck();
        }
      });

      li.appendChild(cb);
      li.appendChild(span);
      container.appendChild(li);
    });

    this.updatePickerCount(countEl);
  }

  public updatePickerCount(countEl: HTMLElement | null): void {
    if (countEl) {
      countEl.textContent = `已选 ${this.host.getReferencedChapters().length} 章`;
    }
  }

  public filterPicker(container: HTMLElement | null, keyword: string): void {
    if (!container) return;
    const items = container.querySelectorAll<HTMLElement>('.ask-chapter-picker-item');
    const lower = keyword.toLowerCase();
    items.forEach((item) => {
      const text = item.textContent?.toLowerCase() || '';
      item.style.display = text.includes(lower) ? '' : 'none';
    });
  }
}
