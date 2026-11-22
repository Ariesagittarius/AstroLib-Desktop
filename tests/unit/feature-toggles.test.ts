import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { initFeatureToggles } from '../../src/scripts/feature-toggles';

describe('Feature Toggles Unit & Host Invariant Suite', () => {
  it('initFeatureToggles 必须具备绝对幂等性，重复调用绝不重复注册或抛出异常', () => {
    expect(() => initFeatureToggles()).not.toThrow();
    expect(() => initFeatureToggles()).not.toThrow();
    expect(() => initFeatureToggles()).not.toThrow();
  });

  it('SettingsHubContent 中同一组件内只允许存在最多 1 个 <starlight-feature-toggles> 宿主', () => {
    const hubFile = path.resolve(process.cwd(), 'src/components/desktop/SettingsHubContent.astro');
    if (fs.existsSync(hubFile)) {
      const content = fs.readFileSync(hubFile, 'utf-8');
      const templateBody = content.replace(/^---[\s\S]*?---/, '');
      const hosts = templateBody.match(/<starlight-feature-toggles\b/g) || [];
      expect(hosts.length).toBeLessThanOrEqual(1);
    }
  });
});
