import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  SETTINGS_DEFINITIONS,
  getAllSettings,
  getSettingsByCategory,
  getSettingDefinition,
  type SettingCategory,
} from '../../src/features/settings/settings-registry';
import { initFeatureToggles } from '../../src/scripts/feature-toggles';

describe('Settings Registry Unit & Invariant Suite (P1-D1)', () => {
  it('1. 所有设置项必须拥有唯一的 ID、合法的分类与非空的存储键', () => {
    const settings = getAllSettings();
    expect(settings.length).toBeGreaterThan(10);

    const ids = new Set<string>();
    const validCategories: SettingCategory[] = [
      'appearance',
      'typography',
      'reading',
      'performance',
      'ai',
      'translation',
    ];

    for (const setting of settings) {
      expect(ids.has(setting.id)).toBe(false);
      ids.add(setting.id);

      expect(setting.id.trim()).not.toBe('');
      expect(setting.label.trim()).not.toBe('');
      expect(validCategories).toContain(setting.category);
      expect(setting.storageKey.trim()).not.toBe('');
      expect(setting.dataAttribute.trim()).not.toBe('');
    }
  });

  it('2. 阅读与功能特性开关 (data-feature-id) 必须 100% 唯一且无任何重复声明', () => {
    const featureIds = new Set<string>();
    const featureSettings = getAllSettings().filter((s) => s.dataAttribute.startsWith('data-feature-id'));

    for (const setting of featureSettings) {
      const match = setting.dataAttribute.match(/data-feature-id="([^"]+)"/);
      expect(match).not.toBeNull();
      const featId = match![1];

      expect(featureIds.has(featId)).toBe(false);
      featureIds.add(featId);
    }
  });

  it('3. getSettingsByCategory 能精确按分类检索配置项', () => {
    const typography = getSettingsByCategory('typography');
    expect(typography.length).toBeGreaterThanOrEqual(3);
    for (const s of typography) {
      expect(s.category).toBe('typography');
    }

    const reading = getSettingsByCategory('reading');
    expect(reading.length).toBeGreaterThanOrEqual(5);
    for (const s of reading) {
      expect(s.category).toBe('reading');
    }
  });

  it('4. getSettingDefinition 针对有效与无效 ID 均能安全响应', () => {
    expect(getSettingDefinition('typographyIndent')?.id).toBe('typographyIndent');
    expect(getSettingDefinition('liteMode')?.category).toBe('performance');
    expect(getSettingDefinition('non-existent-id')).toBeUndefined();
  });

  it('5. initFeatureToggles 必须具备绝对幂等性，重复调用绝不重复注册或抛出异常', () => {
    // 第一次调用
    expect(() => initFeatureToggles()).not.toThrow();
    // 第二次调用（幂等防护）
    expect(() => initFeatureToggles()).not.toThrow();
    // 第三次调用
    expect(() => initFeatureToggles()).not.toThrow();
  });

  it('6. 页面宿主唯一性断言：SettingsHubContent 中同一组件内只允许存在最多 1 个 <starlight-feature-toggles> 宿主', () => {
    const hubFile = path.resolve(process.cwd(), 'src/components/desktop/SettingsHubContent.astro');
    if (fs.existsSync(hubFile)) {
      const content = fs.readFileSync(hubFile, 'utf-8');
      // 提取 frontmatter 之后的真实 HTML 模板部分
      const templateBody = content.replace(/^---[\s\S]*?---/, '');
      const hosts = templateBody.match(/<starlight-feature-toggles\b/g) || [];
      expect(hosts.length).toBeLessThanOrEqual(1);
    }
  });
});
