import { describe, it, expect } from 'vitest';
import { parseAstrolibUri, buildAstrolibUri, isAstrolibUri, getBookTitle } from '../../src/utils/astrolib-uri.ts';

describe('astrolib-uri 统一协议解析与构建', () => {
  it('1. 正确识别 astrolib 协议与 collections 路径', () => {
    expect(isAstrolibUri('astrolib://cs/algorithms/031_why-graphs')).toBe(true);
    expect(isAstrolibUri('astrolib://math/graph_theory/15_树和森林#card-1-23')).toBe(true);
    expect(isAstrolibUri('/collections/math/graph_theory/11_图/')).toBe(true);
    expect(isAstrolibUri('https://example.com/other')).toBe(false);
  });

  it('2. 精确解析标准节点链接 (Algorithms 章节)', () => {
    const res = parseAstrolibUri('astrolib://cs/algorithms/031_why-graphs');
    expect(res).not.toBeNull();
    expect(res?.colSlug).toBe('cs');
    expect(res?.bookSlug).toBe('algorithms');
    expect(res?.chapterSlug).toBe('031_why-graphs');
    expect(res?.anchor).toBeUndefined();
    expect(res?.canonicalPath).toBe('/collections/cs/algorithms/031_why-graphs/');
    expect(res?.title).toBe('Algorithms');
  });

  it('3. 精确解析含中文与卡片 ID 锚点的节点链接', () => {
    const res = parseAstrolibUri('astrolib://math/graph_theory/15_树和森林#card-1-23');
    expect(res).not.toBeNull();
    expect(res?.colSlug).toBe('math');
    expect(res?.bookSlug).toBe('graph_theory');
    expect(res?.chapterSlug).toBe('15_树和森林');
    expect(res?.anchor).toBe('card-1-23');
    expect(res?.canonicalPath).toContain('/collections/math/graph_theory/');
    expect(res?.canonicalPath).toContain('#card-1-23');
    expect(res?.title).toBe('图论');
  });

  it('4. 容错解析历史残留与畸形链接 (如 /astrolib:/)', () => {
    const res = parseAstrolibUri('http://127.0.0.1:62960/astrolib:/cs/algorithms/031_why-graphs');
    expect(res).not.toBeNull();
    expect(res?.colSlug).toBe('cs');
    expect(res?.bookSlug).toBe('algorithms');
    expect(res?.chapterSlug).toBe('031_why-graphs');
  });

  it('4.1 容错解析带空格分隔锚点与反引号/中文引号包裹的 URI', () => {
    const res1 = parseAstrolibUri('`astrolib://science/vectors_and_tensors/zh/063_riemann-curvature-tensor math-128`');
    expect(res1).not.toBeNull();
    expect(res1?.colSlug).toBe('science');
    expect(res1?.bookSlug).toBe('vectors_and_tensors');
    expect(res1?.chapterSlug).toBe('zh/063_riemann-curvature-tensor');
    expect(res1?.anchor).toBe('math-128');
    expect(res1?.canonicalPath).toBe('/collections/science/vectors_and_tensors/zh/063_riemann-curvature-tensor/#math-128');

    const res2 = parseAstrolibUri('“astrolib://math/graph_theory/11_图”');
    expect(res2).not.toBeNull();
    expect(res2?.chapterSlug).toBe('11_图');
    expect(res2?.canonicalPath).toBe('/collections/math/graph_theory/11_%E5%9B%BE/');
  });

  it('5. 正确构建标准 astrolib URI', () => {
    const uri1 = buildAstrolibUri('cs', 'algorithms', '031_why-graphs');
    expect(uri1).toBe('astrolib://cs/algorithms/031_why-graphs');

    const uri2 = buildAstrolibUri('math', 'graph_theory', '15_树和森林', 'card-1-23');
    expect(uri2).toBe('astrolib://math/graph_theory/15_树和森林#card-1-23');
  });

  it('6. 书名查询', () => {
    expect(getBookTitle('cs', 'algorithms')).toBe('Algorithms');
    expect(getBookTitle('math', 'graph_theory')).toBe('图论');
    expect(getBookTitle('unknown', 'book')).toBe('book');
  });
});
