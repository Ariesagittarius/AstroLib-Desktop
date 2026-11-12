/**
 * tests/unit/info-highlight.test.ts
 * ============================================================================
 * AstroLib 信息高亮与关注点透镜单元测试 (Shannon Surprisal Unit Tests)
 * ============================================================================
 */

import { describe, it, expect } from 'vitest';
import { features } from '@/config/features.config.ts';
import { QwenHighlightService } from '@/services/info-highlight/qwen-highlight-service.ts';
import { InfoHighlightClient } from '@/services/info-highlight/client.ts';
import type { TokenSurprisal } from '@/types/info-highlight.ts';

const RUN_MODEL_TESTS = process.env.ASTROLIB_RUN_MODEL_TESTS === '1';

describe('Info Highlight & Shannon Surprisal Suite', () => {
  it('features 配置中必须声明合法的 infoHighlight 特性清单', () => {
    const feat = features.infoHighlight;
    expect(feat).toBeDefined();
    expect(feat.id).toBe('infoHighlight');
    expect(feat.cat).toBe('reader');
    expect(feat.enabled).toBe(true);
    expect(feat.ui).toBe(true);
    expect(feat.config?.defaultMode).toBe('fade');
    expect(feat.config?.model).toBe('Qwen3-0.6B-Base');
  });

  it('香农惊异度与条件信息量 (CI) 标尺数学逻辑严密', () => {
    const MAX_BITS = 18.0;

    // 1. 高频搭配或标点助词 (P = 0.60, 60% 预测置信度)
    const probHigh = 0.60;
    const surprisalLow = -Math.log2(probHigh);
    const ciLow = Math.min(1.0, Math.max(0.0, surprisalLow / MAX_BITS));
    const levelLow = Math.min(15, Math.max(0, Math.floor(ciLow * 16)));

    expect(surprisalLow).toBeLessThan(1.0); // 惊异度极低 (< 1 bit)
    expect(ciLow).toBeLessThan(0.06);       // CI 比例极低 (< 6%)
    expect(levelLow).toBe(0);               // 归入 0 档 (全淡化/不干扰视觉)

    // 2. 专业罕见词或关键实体 (P = 1.8e-5, 0.0018% 预测置信度)
    const probLow = 1.8e-5;
    const surprisalHigh = -Math.log2(probLow);
    const ciHigh = Math.min(1.0, Math.max(0.0, surprisalHigh / MAX_BITS));
    const levelHigh = Math.min(15, Math.max(0, Math.floor(ciHigh * 16)));

    expect(surprisalHigh).toBeGreaterThan(15.0); // 惊异度极高 (> 15 bits)
    expect(ciHigh).toBeGreaterThan(0.85);        // CI 比例极高 (> 85%)
    expect(levelHigh).toBeGreaterThanOrEqual(13); // 强烈视觉高亮/保留黑度
  });

  it('QwenHighlightService.getStatus() 在任意环境均应返回结构化状态', async () => {
    const service = QwenHighlightService.getInstance();
    const status = await service.getStatus();
    expect(typeof status.available).toBe('boolean');
  });

  it.skipIf(!RUN_MODEL_TESTS)('QwenHighlightService 应能成功在本地自省到 Python 与 Qwen 权重 (严格离线 0 流量消耗)', async () => {
    const service = QwenHighlightService.getInstance();
    const pythonPath = service.findPythonPath();
    const modelPath = service.findModelPath();

    expect(pythonPath).toBeTruthy();
    expect(modelPath).toBeTruthy();
    expect(modelPath).toContain('Qwen--Qwen3-0.6B-Base');

    const status = await service.getStatus();
    expect(status.available).toBe(true);
    expect(status.pythonPath).toBe(pythonPath);
    expect(status.modelPath).toBe(modelPath);
  });

  it('InfoHighlightClient 单例状态机与参数变更应支持即时响应', () => {
    const client = InfoHighlightClient.getInstance();
    const initialConfig = client.getConfig();

    expect(initialConfig.mode).toBe('fade');
    expect(initialConfig.thresholdPct).toBe(35);

    client.updateConfig({ mode: 'block', thresholdPct: 50 });
    const updated = client.getConfig();

    expect(updated.mode).toBe('block');
    expect(updated.thresholdPct).toBe(50);

    // 恢复默认
    client.updateConfig({ mode: 'fade', thresholdPct: 35 });
  });

  it('分词数据结构契约与过滤阈值分类准确', () => {
    const sampleTokens: TokenSurprisal[] = [
      { offset: [0, 4], raw: '人工智能', prob: 0.000018, surprisalBits: 15.76, ciRatio: 0.875, level: 14 },
      { offset: [4, 6], raw: '正在', prob: 0.00216, surprisalBits: 8.85, ciRatio: 0.492, level: 7 },
      { offset: [6, 8], raw: '深刻', prob: 0.0514, surprisalBits: 4.28, ciRatio: 0.238, level: 3 },
      { offset: [8, 10], raw: '改变', prob: 0.573, surprisalBits: 0.80, ciRatio: 0.045, level: 0 },
    ];

    const threshold = 0.35; // 35% CI 阈值
    const highInfoTokens = sampleTokens.filter((t) => t.ciRatio >= threshold);
    const lowInfoTokens = sampleTokens.filter((t) => t.ciRatio < threshold);

    expect(highInfoTokens.map((t) => t.raw)).toEqual(['人工智能', '正在']);
    expect(lowInfoTokens.map((t) => t.raw)).toEqual(['深刻', '改变']);
  });
});
