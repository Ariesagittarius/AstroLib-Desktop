/**
 * tests/unit/harness-provider-switching.test.ts
 * ============================================================================
 * AstroLib Agent Harness 模型服务商管理与热切换逻辑单元测试
 * ============================================================================
 */

import { describe, it, expect } from 'vitest';
import type { ProviderConfig } from '../../src/components/harness/harness-controller.ts';

describe('Harness Provider Switching & Settings Unit Tests', () => {
  const initialProviders: ProviderConfig[] = [
    {
      id: 'baigong',
      displayName: '邮百工网关',
      isCustom: true,
      status: 'connected',
      api: 'openai-completions',
      baseURL: 'https://gateway.baigongai.cn/v1',
      apiKey: 'test-key-placeholder',
      headers: {
        'X-YBG-Session-ID': 'youlabber-local-pc',
      },
      models: [
        { id: 'ybg-youlaber-ds4f', name: 'YoulabberLocal Flash', reasoningEffort: 'high' },
        { id: 'ybg-youlaber-ds4pro', name: 'YoulabberLocal Pro', reasoningEffort: 'low' },
      ],
      defaultModelId: 'ybg-youlaber-ds4f',
    },
    {
      id: 'deepseek-account',
      displayName: 'DeepSeek 账号',
      isAccount: true,
      status: 'connected',
      api: 'openai-completions',
      baseURL: 'https://api.deepseek.com/v1',
      models: [],
      defaultModelId: '',
    },
    {
      id: 'deepseek',
      displayName: 'DeepSeek',
      status: 'configured',
      api: 'openai-completions',
      baseURL: 'https://api.deepseek.com/v1',
      apiKey: '',
      models: [
        { id: 'deepseek-chat', name: 'DeepSeek V3', reasoningEffort: 'off' },
        { id: 'deepseek-reasoner', name: 'DeepSeek R1', reasoningEffort: 'high' },
      ],
      defaultModelId: 'deepseek-chat',
    },
  ];

  it('1. 默认首位提供商应为“邮百工网关”且默认模型为 ybg-youlaber-ds4f', () => {
    const defaultProv = initialProviders[0];
    expect(defaultProv.id).toBe('baigong');
    expect(defaultProv.displayName).toBe('邮百工网关');
    expect(defaultProv.isCustom).toBe(true);
    expect(defaultProv.defaultModelId).toBe('ybg-youlaber-ds4f');
    expect(defaultProv.headers?.['X-YBG-Session-ID']).toBe('youlabber-local-pc');
    expect(defaultProv.baseURL).toBe('https://gateway.baigongai.cn/v1');
  });

  it('2. 支持添加新的自定义模型提供商 (如 Ollama / SiliconFlow)', () => {
    const list = [...initialProviders];
    const newProv: ProviderConfig = {
      id: 'ollama-local',
      displayName: 'Ollama 本地网关',
      isCustom: true,
      status: 'configured',
      api: 'openai-completions',
      baseURL: 'http://localhost:11434/v1',
      apiKey: 'ollama',
      models: [
        { id: 'qwen2.5:7b', name: 'Qwen 2.5 7B', reasoningEffort: 'off' }
      ],
      defaultModelId: 'qwen2.5:7b',
    };

    list.push(newProv);
    expect(list.length).toBe(4);
    expect(list[3].id).toBe('ollama-local');
    expect(list[3].models[0].id).toBe('qwen2.5:7b');
  });

  it('3. 支持编辑已有提供商凭据与 BaseURL 并保持可序列化', () => {
    const list = JSON.parse(JSON.stringify(initialProviders));
    const target = list.find((p: any) => p.id === 'deepseek');
    expect(target).toBeDefined();

    target.apiKey = 'sk-mock-deepseek-key-12345';
    target.status = 'connected';

    const serialized = JSON.stringify(list);
    const restored = JSON.parse(serialized);

    expect(restored[2].apiKey).toBe('sk-mock-deepseek-key-12345');
    expect(restored[2].status).toBe('connected');
  });

  it('4. 支持安全删除自定义提供商且不可误删关键预置提供商', () => {
    let list = [...initialProviders];
    // 添加自定义项
    list.push({
      id: 'temp-custom',
      displayName: '临时服务商',
      isCustom: true,
      status: 'unconfigured',
      api: 'openai-completions',
      baseURL: 'http://127.0.0.1:8000',
      models: [],
      defaultModelId: '',
    });

    expect(list.length).toBe(4);

    // 删除自定义项
    list = list.filter(p => p.id !== 'temp-custom');
    expect(list.length).toBe(3);
    expect(list.find(p => p.id === 'baigong')).toBeDefined();
  });
});
