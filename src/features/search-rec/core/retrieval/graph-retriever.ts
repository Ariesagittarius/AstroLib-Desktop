/**
 * src/features/search-rec/core/retrieval/graph-retriever.ts
 * 知识图谱拓扑游走与前驱后继召回通道
 */

import type { AcademicChunk, CandidateItem } from '../../types/candidate.ts';

export interface RelationNode {
  id: string;
  title: string;
  chapterSlug: string;
  bookSlug: string;
  colSlug: string;
}

export interface RelationLink {
  source: string;
  target: string;
  type: 'prerequisite' | 'application' | 'cross-book' | 'reference';
  weight?: number;
}

export interface RelationGraphData {
  nodes: RelationNode[];
  links: RelationLink[];
}

export class GraphRetriever {
  private chunks: AcademicChunk[];
  private chunkMap: Map<string, AcademicChunk> = new Map();
  private graph: RelationGraphData | null = null;
  private adjacency: Map<string, Array<{ target: string; type: string; weight: number }>> = new Map();

  constructor(chunks: AcademicChunk[], graph?: RelationGraphData) {
    this.chunks = chunks;
    for (const c of chunks) {
      this.chunkMap.set(c.id, c);
      this.chunkMap.set(`${c.bookSlug}/${c.chapterSlug}`, c);
    }
    if (graph) {
      this.setGraph(graph);
    }
  }

  setGraph(graph: RelationGraphData): void {
    this.graph = graph;
    this.adjacency.clear();
    for (const link of graph.links) {
      const w = link.weight || 1.0;
      if (!this.adjacency.has(link.source)) this.adjacency.set(link.source, []);
      if (!this.adjacency.has(link.target)) this.adjacency.set(link.target, []);
      this.adjacency.get(link.source)!.push({ target: link.target, type: link.type, weight: w });
      // 无向关联或反向关联
      this.adjacency.get(link.target)!.push({ target: link.source, type: link.type, weight: w * 0.8 });
    }
  }

  /**
   * 基于当前章节或当前命中节点执行 1-2 步拓扑游走
   */
  walk(seedId: string, limit = 20): CandidateItem[] {
    if (!this.graph || !this.adjacency.has(seedId)) return [];

    const visited = new Set<string>([seedId]);
    const candidates: Array<{ chunk: AcademicChunk; score: number; reason: string }> = [];

    // Step 1: 1-hop 直接关联
    const neighbors1 = this.adjacency.get(seedId) || [];
    for (const n1 of neighbors1) {
      if (visited.has(n1.target)) continue;
      visited.add(n1.target);

      const targetChunk = this.chunkMap.get(n1.target);
      if (targetChunk) {
        let reason = '知识图谱关联';
        if (n1.type === 'prerequisite') reason = '前驱数学基石';
        else if (n1.type === 'application') reason = '后继工程应用';
        else if (n1.type === 'cross-book') reason = '跨书交叉领域';

        candidates.push({
          chunk: targetChunk,
          score: n1.weight * 10,
          reason,
        });
      }

      // Step 2: 2-hop 间接关联 (限制前 3 个邻居展开)
      if (candidates.length < limit) {
        const neighbors2 = this.adjacency.get(n1.target) || [];
        for (const n2 of neighbors2.slice(0, 3)) {
          if (visited.has(n2.target)) continue;
          visited.add(n2.target);
          const chunk2 = this.chunkMap.get(n2.target);
          if (chunk2) {
            candidates.push({
              chunk: chunk2,
              score: n1.weight * n2.weight * 5,
              reason: `延展关联 (via ${n1.target})`,
            });
          }
        }
      }
    }

    candidates.sort((a, b) => b.score - a.score);

    return candidates.slice(0, limit).map((item, rank) => ({
      chunk: item.chunk,
      channel: 'graph',
      channelScore: item.score,
      channelRank: rank + 1,
      recommendReason: item.reason,
    }));
  }
}
