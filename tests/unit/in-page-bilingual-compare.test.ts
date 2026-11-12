/**
 * tests/unit/in-page-bilingual-compare.test.ts
 * ============================================================================
 * 本页内联双语排版对照与高保真学术相关矩阵测试套件 (Node 环境极简 DOM Mock)
 * ============================================================================
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { InPageCompareController } from '../../src/services/bilingual/in-page-compare-controller.ts';
import { HeatmapController } from '../../src/services/bilingual/heatmap-controller.ts';
import type { AlignmentMatrixResult } from '../../src/services/bilingual/types.ts';

// 极简 DOM Mock，供 Node.js 环境下测试控制器状态机流转
class MockClassList {
  private classes = new Set<string>();
  add(...names: string[]) {
    names.forEach((n) => this.classes.add(n));
  }
  remove(...names: string[]) {
    names.forEach((n) => this.classes.delete(n));
  }
  contains(name: string) {
    return this.classes.has(name);
  }
  toggle(name: string) {
    if (this.classes.has(name)) {
      this.classes.delete(name);
      return false;
    }
    this.classes.add(name);
    return true;
  }
}

class MockElement {
  id: string = '';
  className: string = '';
  classList = new MockClassList();
  children: MockElement[] = [];
  parentElement: MockElement | null = null;
  innerHTML: string = '';
  textContent: string = '';
  style: Record<string, string> = {};
  width: number = 0;
  height: number = 0;
  clientWidth: number = 800;
  clientHeight: number = 500;
  private attributes = new Map<string, string>();
  private listeners: Record<string, Function[]> = {};

  setAttribute(k: string, v: string) {
    this.attributes.set(k, v);
  }
  getAttribute(k: string) {
    return this.attributes.get(k) || null;
  }
  appendChild(child: MockElement) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
  insertBefore(newChild: MockElement, refChild: MockElement) {
    const idx = this.children.indexOf(refChild);
    if (idx !== -1) {
      newChild.parentElement = this;
      this.children.splice(idx, 0, newChild);
    } else {
      this.appendChild(newChild);
    }
    return newChild;
  }
  remove() {
    if (this.parentElement) {
      const idx = this.parentElement.children.indexOf(this);
      if (idx !== -1) {
        this.parentElement.children.splice(idx, 1);
      }
      this.parentElement = null;
    }
  }
  querySelector(selector: string): MockElement | null {
    if (selector.startsWith('#')) {
      const targetId = selector.slice(1);
      if (this.id === targetId) return this;
      for (const child of this.children) {
        const found = child.querySelector(selector);
        if (found) return found;
      }
    }
    if (selector.startsWith('.')) {
      const targetClass = selector.slice(1);
      if (this.classList.contains(targetClass) || this.className.includes(targetClass)) return this;
      for (const child of this.children) {
        const found = child.querySelector(selector);
        if (found) return found;
      }
    }
    for (const child of this.children) {
      const found = child.querySelector(selector);
      if (found) return found;
    }
    return null;
  }
  addEventListener(event: string, fn: Function) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(fn);
  }
  dispatchEvent(event: { type: string; clientX?: number; clientY?: number }) {
    const fns = this.listeners[event.type] || [];
    fns.forEach((fn) => fn(event));
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 800, height: 500, right: 800, bottom: 500 };
  }
  getContext() {
    return {
      scale: vi.fn(),
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      fillText: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      font: '',
      textAlign: '',
      textBaseline: '',
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
    };
  }
}

describe('InPageCompareController Suite', () => {
  let controller: InPageCompareController;
  let mockDoc: any;
  let mockWin: any;
  let bodyEl: MockElement;
  let mainEl: MockElement;
  let articleEl: MockElement;

  beforeEach(() => {
    bodyEl = new MockElement();
    bodyEl.id = 'body';
    const docEl = new MockElement();
    docEl.id = 'html';

    mainEl = new MockElement();
    mainEl.id = 'main';
    articleEl = new MockElement();
    articleEl.className = 'sl-markdown-content';
    articleEl.classList.add('sl-markdown-content');
    mainEl.appendChild(articleEl);
    bodyEl.appendChild(mainEl);

    mockDoc = {
      body: bodyEl,
      documentElement: docEl,
      createElement: () => new MockElement(),
      createComment: () => new MockElement(),
      querySelector: (sel: string) => {
        if (sel === 'main') return mainEl;
        if (sel.includes('article.sl-markdown-content') || sel.includes('.sl-markdown-content')) return articleEl;
        return bodyEl.querySelector(sel);
      },
      getElementById: (id: string) => bodyEl.querySelector(`#${id}`),
      addEventListener: vi.fn(),
    };

    mockWin = {
      addEventListener: vi.fn(),
      scrollY: 100,
      scrollTo: vi.fn(),
      ResizeObserver: class {
        observe = vi.fn();
        disconnect = vi.fn();
      },
      DOMParser: class {
        parseFromString() {
          const doc = new MockElement();
          const art = new MockElement();
          art.className = 'sl-markdown-content';
          doc.appendChild(art);
          return {
            querySelector: () => art,
          };
        }
      },
    };

    (globalThis as any).document = mockDoc;
    (globalThis as any).window = mockWin;
    (globalThis as any).DOMParser = mockWin.DOMParser;
    (globalThis as any).ResizeObserver = mockWin.ResizeObserver;

    controller = new InPageCompareController();
  });

  afterEach(() => {
    controller.close();
    delete (globalThis as any).document;
    delete (globalThis as any).window;
  });

  it('manages singleton lifecycle and initial state correctly', () => {
    const instance1 = InPageCompareController.getInstance();
    const instance2 = InPageCompareController.getInstance();
    expect(instance1).toBe(instance2);
    expect(controller.getIsActive()).toBe(false);
  });

  it('opens in-page split comparison and expands viewport to wide academic layout', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '<article class="sl-markdown-content"><p>Target</p></article>',
    } as any);

    const availableTargets = [
      { id: 'en', label: 'English (原著)', url: '/collections/cs/algorithms/00.3_big-o-notation/' },
    ];

    await controller.open({
      bookSlug: 'algorithms',
      sourceId: 'zh-wp',
      sourceLabel: '中文 (王沛等译)',
      target: availableTargets[0],
      availableTargets,
    });

    expect(controller.getIsActive()).toBe(true);
    expect(mockDoc.body.classList.contains('bilingual-in-page-active')).toBe(true);
    expect(mockDoc.documentElement.classList.contains('bilingual-in-page-active')).toBe(true);
  });

  it('gracefully restores original DOM and viewport upon closing', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '<article class="sl-markdown-content"><p>Test</p></article>',
    } as any);

    await controller.open({
      bookSlug: 'algorithms',
      sourceId: 'zh-wp',
      sourceLabel: '中文 (王沛等译)',
      target: { id: 'en', label: 'English (原著)', url: '/test/' },
      availableTargets: [],
    });

    expect(controller.getIsActive()).toBe(true);

    // 执行关闭
    controller.close();

    expect(controller.getIsActive()).toBe(false);
    expect(mockDoc.body.classList.contains('bilingual-in-page-active')).toBe(false);
  });
});

describe('HeatmapController Layout & Blues Colormap Suite', () => {
  let sheetEl: MockElement;
  let canvas: MockElement;
  let heatmap: HeatmapController;

  beforeEach(() => {
    sheetEl = new MockElement();
    sheetEl.id = 'bilingual-heatmap-sheet';
    sheetEl.classList.add('bilingual-heatmap-sheet');

    const wrapper = new MockElement();
    wrapper.className = 'heatmap-matrix-scroll-wrapper';
    canvas = new MockElement();
    canvas.id = 'heatmap-canvas';
    wrapper.appendChild(canvas);
    sheetEl.appendChild(wrapper);

    const badge = new MockElement();
    badge.id = 'heatmap-links-badge';
    sheetEl.appendChild(badge);

    const slider = new MockElement();
    slider.id = 'heatmap-threshold-slider';
    sheetEl.appendChild(slider);

    const valEl = new MockElement();
    valEl.id = 'heatmap-threshold-val';
    sheetEl.appendChild(valEl);

    (globalThis as any).document = {
      documentElement: new MockElement(),
    };
    (globalThis as any).window = {
      devicePixelRatio: 1,
      ResizeObserver: class {
        observe = vi.fn();
        disconnect = vi.fn();
      },
    };

    heatmap = new HeatmapController();
  });

  afterEach(() => {
    heatmap.destroy();
    delete (globalThis as any).document;
    delete (globalThis as any).window;
  });

  it('initializes and calculates Blues gradient colors correctly', () => {
    heatmap.init(sheetEl as any);

    const mockResult: AlignmentMatrixResult = {
      sourceParagraphs: [
        { id: 's1', index: 0, text: 'Sentence 1 source', type: 'paragraph' },
        { id: 's2', index: 1, text: 'Sentence 2 source', type: 'paragraph' },
        { id: 's3', index: 2, text: 'Sentence 3 source', type: 'paragraph' },
        { id: 's4', index: 3, text: 'Sentence 4 source', type: 'paragraph' },
      ],
      targetParagraphs: [
        { id: 't1', index: 0, text: 'Sentence 1 target', type: 'paragraph' },
        { id: 't2', index: 1, text: 'Sentence 2 target', type: 'paragraph' },
        { id: 't3', index: 2, text: 'Sentence 3 target', type: 'paragraph' },
        { id: 't4', index: 3, text: 'Sentence 4 target', type: 'paragraph' },
      ],
      matrix: [
        [1.00, 0.54, 0.50, 0.85],
        [0.52, 1.00, 0.44, 0.53],
        [0.52, 0.46, 1.00, 0.47],
        [0.80, 0.51, 0.45, 1.00],
      ],
      links: [],
      stats: { mean: 0.65, max: 1.0, min: 0.44, stdDev: 0.2 },
      calibratedThreshold: 0.6,
      inferenceTimeMs: 15,
      engine: 'test-engine',
    };

    heatmap.setData(mockResult, 0.6);

    expect(canvas.width).toBeGreaterThan(50);
    expect(canvas.height).toBeGreaterThan(50);

    const badge = sheetEl.querySelector('#heatmap-links-badge');
    expect(badge?.textContent).toContain('对有效关联');
  });

  it('triggers onCellClick callback when a cell is clicked', () => {
    let clickedPair: any = null;
    heatmap.init(sheetEl as any, {
      onCellClick: (s, t, sim) => {
        clickedPair = { s, t, sim };
      },
    });

    const mockResult: AlignmentMatrixResult = {
      sourceParagraphs: [
        { id: 'src-1', index: 0, text: 'First para', type: 'paragraph' },
      ],
      targetParagraphs: [
        { id: 'tgt-1', index: 0, text: 'First translation', type: 'paragraph' },
      ],
      matrix: [[0.95]],
      links: [],
      stats: { mean: 0.95, max: 0.95, min: 0.95, stdDev: 0 },
      calibratedThreshold: 0.6,
      inferenceTimeMs: 10,
      engine: 'test-engine',
    };

    heatmap.setData(mockResult, 0.6);

    // 触发点击
    canvas.dispatchEvent({
      type: 'click',
      clientX: 120,
      clientY: 60,
    });

    expect(clickedPair).not.toBeNull();
    expect(clickedPair.s).toBe('src-1');
    expect(clickedPair.t).toBe('tgt-1');
    expect(clickedPair.sim).toBe(0.95);
  });
});
