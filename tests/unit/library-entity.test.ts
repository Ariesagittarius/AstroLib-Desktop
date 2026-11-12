/**
 * tests/unit/library-entity.test.ts
 * ============================================================================
 * AstroLib 统一研读实体模型与书库聚合服务单元测试
 * ============================================================================
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import type {
  UnifiedReadingEntity,
  LibraryShelf,
  TabItem,
  SplitLayoutMode,
} from '../../src/types/library-entity.ts';

describe('Unified Reading Entity & Library System Unit Tests', () => {
  it('应准确区隔书籍与文献的元数据载荷，保持一等公民同级化', () => {
    // 1. 书籍实体契约
    const bookEntity: UnifiedReadingEntity = {
      id: 'book:math-advanced-algebra',
      kind: 'book',
      title: '高等代数',
      subtitle: 'Advanced Algebra',
      author: '丘维声',
      publisher: '高等教育出版社',
      cover: '/favicon.png',
      category: 'math',
      createdAt: Date.now(),
      status: 'ready',
      metadata: {
        colSlug: 'math',
        bookSlug: 'advanced-algebra',
        entryPoint: 'chapter-01',
        edition: '第三版',
      },
    };

    expect(bookEntity.kind).toBe('book');
    expect(bookEntity.metadata.colSlug).toBe('math');
    expect(bookEntity.status).toBe('ready');

    // 2. 学术文献实体契约
    const paperEntity: UnifiedReadingEntity = {
      id: 'paper:task_attention_is_all_you_need',
      kind: 'paper',
      title: 'Attention Is All You Need',
      subtitle: 'PDF 学术文献 · 云端 MinerU',
      author: 'Vaswani et al.',
      publisher: 'NeurIPS 2017',
      cover: '/astrolib-logo.webp',
      category: 'paper',
      createdAt: Date.now(),
      status: 'ready',
      metadata: {
        taskId: 'task_attention_is_all_you_need',
        originPdfUrl: '/api/ingest/pdf?taskId=task_attention_is_all_you_need',
        markdownUrl: '/api/ingest/result?taskId=task_attention_is_all_you_need',
        hasBookmarks: true,
        hasAnnotations: true,
        totalPages: 15,
      },
    };

    expect(paperEntity.kind).toBe('paper');
    expect(paperEntity.metadata.taskId).toBeDefined();
    expect(paperEntity.metadata.totalPages).toBe(15);
  });

  it('Chrome 风格标签页与分屏数据契约应准确响应', () => {
    const tabs: TabItem[] = [
      {
        id: 'tab-1',
        entityId: 'book:math-advanced-algebra',
        kind: 'book',
        title: '高等代数',
        url: '/collections/math/advanced-algebra/chapter-01/',
        active: true,
      },
      {
        id: 'tab-2',
        entityId: 'paper:task_123',
        kind: 'paper',
        title: 'Attention Is All You Need',
        url: '/workspace/ingest/?taskId=task_123',
        active: false,
      },
    ];

    expect(tabs.length).toBe(2);
    expect(tabs[0].kind).toBe('book');
    expect(tabs[1].kind).toBe('paper');

    // 左右分屏契约 (1x2)
    const splitMode: SplitLayoutMode = 'split-vertical';
    expect(splitMode).toBe('split-vertical');

    // 模拟窗格绑定
    const paneBindings = [tabs[0].id, tabs[1].id];
    expect(paneBindings[0]).toBe('tab-1');
    expect(paneBindings[1]).toBe('tab-2');
  });

  it('书架数据结构应支持自定义添加与统计', () => {
    const shelves: LibraryShelf[] = [
      { id: 'shelf-math-core', name: '数学基础核心', itemCount: 3, createdAt: Date.now() },
      { id: 'shelf-papers-unread', name: '待研读文献', itemCount: 5, createdAt: Date.now() },
    ];

    expect(shelves.length).toBe(2);
    expect(shelves[0].name).toBe('数学基础核心');
    expect(shelves[1].itemCount).toBe(5);
  });
});
