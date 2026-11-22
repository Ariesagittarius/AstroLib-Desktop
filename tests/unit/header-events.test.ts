import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { HEADER_EVENTS, dispatchHeaderEvent } from '../../src/core/ui-state/header-events';

describe('Header Events & Shared Contract Suite (P1-D2)', () => {
  it('1. 所有 Header 事件名称必须 100% 唯一且非空', () => {
    const eventValues = Object.values(HEADER_EVENTS);
    expect(eventValues.length).toBeGreaterThanOrEqual(4);

    const set = new Set<string>();
    for (const val of eventValues) {
      expect(val.trim()).not.toBe('');
      expect(set.has(val)).toBe(false);
      set.add(val);
    }
  });

  it('2. dispatchHeaderEvent 在浏览器环境中能安全分发 CustomEvent', () => {
    const fakeWindow = {
      dispatchEvent: vi.fn((e: any) => true),
    };
    (globalThis as any).window = fakeWindow;

    const res = dispatchHeaderEvent(HEADER_EVENTS.THEME_TOGGLE, { mode: 'dark' });
    expect(res).toBe(true);
    expect(fakeWindow.dispatchEvent).toHaveBeenCalled();

    delete (globalThis as any).window;
  });

  it('3. VpNav 历史垫片必须彻底清零，生产源码中严禁存在任何直接引用', () => {
    const srcDir = path.resolve(process.cwd(), 'src');
    const vpNavFile = path.join(srcDir, 'components', 'VpNav.astro');
    expect(fs.existsSync(vpNavFile)).toBe(false);

    const scanDir = (dir: string): string[] => {
      let results: string[] = [];
      const list = fs.readdirSync(dir);
      for (const file of list) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          results = results.concat(scanDir(fullPath));
        } else if (/\.(astro|ts|tsx|js|mjs)$/.test(file)) {
          const content = fs.readFileSync(fullPath, 'utf-8');
          if (/<VpNav\b|from\s+['"].*VpNav/i.test(content)) {
            results.push(fullPath);
          }
        }
      }
      return results;
    };

    const matches = scanDir(srcDir);
    expect(matches).toEqual([]);
  });
});
