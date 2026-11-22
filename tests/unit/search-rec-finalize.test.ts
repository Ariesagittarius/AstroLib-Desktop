import { describe, it, expect } from 'vitest';
import { SearchRecEngine } from '../../src/features/search-rec/core/engine.ts';
import { FuzzyRetriever } from '../../src/features/search-rec/core/retrieval/fuzzy-retriever.ts';
import { serializeEmbeddingsBinary } from '../../src/features/search-rec/services/storage.ts';
import type { AcademicChunk } from '../../src/features/search-rec/types/candidate.ts';

describe('SearchRecEngine & FuzzyRetriever Finalize & Incremental Registration', () => {
  const book1Chunks: AcademicChunk[] = [
    {
      id: 'la-1',
      bookId: 'math-la',
      colSlug: 'math',
      bookSlug: 'la',
      bookTitle: '线性代数',
      chapterSlug: 'ch1',
      chapterTitle: '第一章 矩阵',
      kind: 'card',
      type: '定理',
      title: '正交对角化定理',
      number: '1.1',
      text: '实对称矩阵必然可以正交对角化，特征值均为实数，特征向量相互正交。',
      url: '/math/la/ch1/#1.1',
    },
    {
      id: 'la-2',
      bookId: 'math-la',
      colSlug: 'math',
      bookSlug: 'la',
      bookTitle: '线性代数',
      chapterSlug: 'ch2',
      chapterTitle: '第二章 向量空间',
      kind: 'card',
      type: '定义',
      title: '线性无关与极大无关组',
      number: '2.1',
      text: '向量组的线性无关性是构建基向量与维数的基础，正交基可通过施密特正交化得到。',
      url: '/math/la/ch2/#2.1',
    },
  ];

  const book2Chunks: AcademicChunk[] = [
    {
      id: 'ma-1',
      bookId: 'math-ma',
      colSlug: 'math',
      bookSlug: 'ma',
      bookTitle: '数学分析',
      chapterSlug: 'ch3',
      chapterTitle: '第三章 中值定理',
      kind: 'card',
      type: '定理',
      title: '柯西中值定理与拉格朗日中值定理',
      number: '3.1',
      text: '拉格朗日中值定理是微分学的核心中值定理，连接函数值增量与导数。',
      url: '/math/ma/ch3/#3.1',
    },
    {
      id: 'ma-2',
      bookId: 'math-ma',
      colSlug: 'math',
      bookSlug: 'ma',
      bookTitle: '数学分析',
      chapterSlug: 'ch7',
      chapterTitle: '第七章 泰勒定理',
      kind: 'card',
      type: '定理',
      title: '泰勒公式与佩亚诺余项',
      number: '7.1',
      text: '利用高阶导数在展开点近似逼近函数值，泰勒多项式展开是局部逼近利器。',
      url: '/math/ma/ch7/#7.1',
    },
  ];

  const book3Chunks: AcademicChunk[] = [
    {
      id: 'ee-1',
      bookId: 'telecom-ee',
      colSlug: 'telecom',
      bookSlug: 'ee',
      bookTitle: '通信原理',
      chapterSlug: 'ch4',
      chapterTitle: '第四章 信息论基础',
      kind: 'card',
      type: '公式',
      title: '香农公式与信道容量',
      number: '4.1',
      text: '香农极限给出了高斯白噪声连续信道下无差错传输的最大速率上限。',
      url: '/telecom/ee/ch4/#4.1',
    },
  ];

  it('T1 (等价性): 逐本 register + finalize vs 一次性构造，top-10 id 序列相同、分数差 <1e-9', async () => {

    const engineA = new SearchRecEngine();
    engineA.registerBook(book1Chunks);
    engineA.registerBook(book2Chunks);
    engineA.registerBook(book3Chunks);
    engineA.finalize();

    const allChunks = [...book1Chunks, ...book2Chunks, ...book3Chunks];
    const engineB = new SearchRecEngine();
    engineB.registerBook(allChunks);
    engineB.finalize();

    const fuzzyIncremental = new FuzzyRetriever();
    fuzzyIncremental.addChunks(book1Chunks);
    fuzzyIncremental.addChunks(book2Chunks);
    fuzzyIncremental.addChunks(book3Chunks);

    const fuzzyOneShot = new FuzzyRetriever(allChunks);
    expect(fuzzyIncremental.size).toBe(fuzzyOneShot.size);

    const testQueries = ['定理', '中值定理', '正交对角化', '香农公式'];
    for (const q of testQueries) {

      const fHitsInc = fuzzyIncremental.search(q, 10);
      const fHitsOne = fuzzyOneShot.search(q, 10);
      expect(fHitsInc.length).toBe(fHitsOne.length);
      for (let i = 0; i < fHitsInc.length; i++) {
        expect(fHitsInc[i].chunk.id).toBe(fHitsOne[i].chunk.id);
        expect(Math.abs((fHitsInc[i].channelScore || 0) - (fHitsOne[i].channelScore || 0))).toBeLessThan(1e-9);
      }

      const resA = await engineA.search({ raw: q, mode: 'fuzzy', topK: 10 });
      const resB = await engineB.search({ raw: q, mode: 'fuzzy', topK: 10 });
      expect(resA.items.length).toBe(resB.items.length);
      for (let i = 0; i < resA.items.length; i++) {
        expect(resA.items[i].chunk.id).toBe(resB.items[i].chunk.id);
        const scoreA = resA.items[i].channelScore || 0;
        const scoreB = resB.items[i].channelScore || 0;
        expect(Math.abs(scoreA - scoreB)).toBeLessThan(1e-9);
      }
    }
  });

  it('T2 (幂等性): finalize 两次：size、结果不变', async () => {
    const engine = new SearchRecEngine();
    engine.registerBook(book1Chunks);
    engine.registerBook(book2Chunks);

    engine.finalize();
    const resFirst = await engine.search({ raw: '矩阵', mode: 'fuzzy', topK: 5 });

    engine.finalize();
    const resSecond = await engine.search({ raw: '矩阵', mode: 'fuzzy', topK: 5 });

    expect(resFirst.items.length).toBe(resSecond.items.length);
    for (let i = 0; i < resFirst.items.length; i++) {
      expect(resFirst.items[i].chunk.id).toBe(resSecond.items[i].chunk.id);
      expect(resFirst.items[i].channelScore).toBe(resSecond.items[i].channelScore);
    }
  });

  it('T3 (迟到注册): finalize 后 register 新书 → search 命中新切片', async () => {
    const engine = new SearchRecEngine();
    engine.registerBook(book1Chunks);
    engine.finalize();

    const beforeRes = await engine.search({ raw: '香农公式', mode: 'fuzzy' });
    expect(beforeRes.items.some((it) => it.chunk.id === 'ee-1')).toBe(false);

    engine.registerBook(book3Chunks);

    const afterRes = await engine.search({ raw: '香农公式', mode: 'fuzzy' });
    expect(afterRes.items.some((it) => it.chunk.id === 'ee-1')).toBe(true);
    expect(afterRes.items[0].chunk.id).toBe('ee-1');
  });

  it('T4 (去重性): 同书 register 两次 → chunks 无重复、denseIndex.chunks 长度不翻倍', async () => {
    const engine = new SearchRecEngine();
    const v1 = new Float32Array([0.1, 0.2, 0.3, 0.4]);
    const v2 = new Float32Array([-0.5, 0.6, -0.7, 0.8]);
    const { buffer } = serializeEmbeddingsBinary([v1, v2], 'int8');
    const dummyBinary = buffer as ArrayBuffer;

    engine.registerBook(book1Chunks, dummyBinary);
    const countFirst = (engine as any).chunks.length;
    const denseCountFirst = (engine as any).denseIndex.chunks.length;
    const vectorCountFirst = (engine as any).denseIndex.int8Vectors.length;

    expect(countFirst).toBe(book1Chunks.length);
    expect(denseCountFirst).toBe(book1Chunks.length);
    expect(vectorCountFirst).toBe(book1Chunks.length);

    engine.registerBook(book1Chunks, dummyBinary);
    const countSecond = (engine as any).chunks.length;
    const denseCountSecond = (engine as any).denseIndex.chunks.length;
    const vectorCountSecond = (engine as any).denseIndex.int8Vectors.length;

    expect(countSecond).toBe(countFirst);
    expect(denseCountSecond).toBe(denseCountFirst);
    expect(vectorCountSecond).toBe(vectorCountFirst);
  });

  it('T5 (空库): 零注册 → finalize + search 不抛错', async () => {
    const engine = new SearchRecEngine();
    expect(() => engine.finalize()).not.toThrow();

    const searchRes = await engine.search({ raw: '任意关键词', mode: 'neural' });
    expect(searchRes.items).toEqual([]);
    expect(searchRes.totalMatches).toBe(0);

    const stream = engine.getContextDiscoveryStream({
      currentColSlug: '',
      currentBookSlug: '',
      currentChapterSlug: '',
    });
    expect(stream).toEqual([]);
  });

  it('T6 (对齐性): 书内含同名重复 id 时，dense 向量与去重 chunks 下标保持严格对齐', () => {
    const rawChunks: AcademicChunk[] = [
      {
        id: 'dup-chunk-0',
        bookId: 'math-senior',
        colSlug: 'math',
        bookSlug: 'math-senior',
        bookTitle: '高中数学',
        chapterSlug: 'ch1',
        chapterTitle: '第一章 集合与函数',
        kind: 'card',
        type: '定理',
        title: '31_22_边角互化-证明',
        number: '1.1',
        text: '正弦定理与余弦定理的边角互化第一次出现。',
        url: '/math/math-senior/ch1/#1.1',
      },
      {
        id: 'dup-chunk-0',
        bookId: 'math-senior',
        colSlug: 'math',
        bookSlug: 'math-senior',
        bookTitle: '高中数学',
        chapterSlug: 'ch1',
        chapterTitle: '第一章 集合与函数',
        kind: 'card',
        type: '定理',
        title: '31_22_边角互化-证明-冗余副本',
        number: '1.1-dup',
        text: '正弦定理与余弦定理的边角互化第二次出现（重复记录）。',
        url: '/math/math-senior/ch1/#1.1-dup',
      },
      {
        id: 'unique-chunk-2',
        bookId: 'math-senior',
        colSlug: 'math',
        bookSlug: 'math-senior',
        bookTitle: '高中数学',
        chapterSlug: 'ch1',
        chapterTitle: '第一章 集合与函数',
        kind: 'card',
        type: '例题',
        title: '边角互化典型例题',
        number: '1.2',
        text: '已知三角形三边求各内角的综合求解例题。',
        url: '/math/math-senior/ch1/#1.2',
      },
    ];

    const v0 = new Float32Array([0, 127]);
    const v1 = new Float32Array([1, 127]);
    const v2 = new Float32Array([2, 127]);
    const { buffer } = serializeEmbeddingsBinary([v0, v1, v2], 'int8');

    const engine = new SearchRecEngine();
    engine.registerBook(rawChunks, buffer as ArrayBuffer);
    engine.finalize();

    const denseIndex = (engine as any).denseIndex;
    const expectedRawIndexes = [0, 2];

    expect(denseIndex.chunks.length).toBe(expectedRawIndexes.length);
    expect((denseIndex.int8Vectors || []).length).toBe(expectedRawIndexes.length);

    for (let i = 0; i < denseIndex.chunks.length; i++) {
      const rawIdx = expectedRawIndexes[i];
      const encodedIdx = denseIndex.int8Vectors[i].data[0];
      expect(encodedIdx).toBe(rawIdx);
      expect(denseIndex.chunks[i].id).toBe(rawChunks[rawIdx].id);
    }
  });

  it('T7 (异步分片): finalizeAsync 与同步 finalize 检索结果深度一致', async () => {
    const allChunks = [...book1Chunks, ...book2Chunks, ...book3Chunks];

    const engineSync = new SearchRecEngine();
    engineSync.registerBook(allChunks);
    engineSync.finalize();

    const engineAsync = new SearchRecEngine();
    engineAsync.registerBook(allChunks);
    await engineAsync.finalizeAsync(2);

    const q = '中值定理';
    const resSync = await engineSync.search({ raw: q, mode: 'fuzzy' });
    const resAsync = await engineAsync.search({ raw: q, mode: 'fuzzy' });

    expect(resAsync.items.length).toBe(resSync.items.length);
    for (let i = 0; i < resSync.items.length; i++) {
      expect(resAsync.items[i].chunk.id).toBe(resSync.items[i].chunk.id);
      expect(resAsync.items[i].channelScore).toBe(resSync.items[i].channelScore);
    }
  });
});
