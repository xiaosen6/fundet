import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveVendorKind } from './providerBranding.ts';

describe('resolveVendorKind', () => {
  it('maps Zhipu from URL, name, and glm model id', () => {
    assert.equal(
      resolveVendorKind({ baseUrl: 'https://open.bigmodel.cn/api/paas/v4' }),
      'zhipu',
    );
    assert.equal(resolveVendorKind({ name: '智谱 GLM' }), 'zhipu');
    assert.equal(resolveVendorKind({ modelId: 'glm-5.2' }), 'zhipu');
  });

  it('maps other common vendors', () => {
    assert.equal(resolveVendorKind({ modelId: 'claude-sonnet-4' }), 'anthropic');
    assert.equal(resolveVendorKind({ modelId: 'gpt-4o' }), 'openai');
    assert.equal(resolveVendorKind({ modelId: 'deepseek-chat' }), 'deepseek');
    assert.equal(resolveVendorKind({ name: 'Kimi' }), 'moonshot');
    assert.equal(resolveVendorKind({ baseUrl: 'https://api.openai.com/v1' }), 'openai');
  });
});
