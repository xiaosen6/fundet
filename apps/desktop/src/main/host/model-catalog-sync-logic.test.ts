import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  providerCatalogChanged,
  providerCatalogFingerprint,
  type ProviderCatalogEntry,
} from './model-catalog-sync-logic.ts';

function provider(overrides: Partial<ProviderCatalogEntry> = {}): ProviderCatalogEntry {
  return {
    id: 'p1',
    name: 'Provider One',
    api: 'openai-completions',
    baseUrl: 'https://api.example.com/v1',
    models: [{ id: 'm1', reasoning: true }],
    ...overrides,
  };
}

test('无变化（含重排序）→ 不需要热同步', () => {
  const a = [provider(), provider({ id: 'p2', name: 'Two' })];
  const b = [provider({ id: 'p2', name: 'Two' }), provider()];
  assert.equal(providerCatalogChanged(a, b), false);
  // 模型数组重排序同样不算变化
  const c = [provider({ models: [{ id: 'm1', reasoning: true }, { id: 'm2' }] })];
  const d = [provider({ models: [{ id: 'm2' }, { id: 'm1', reasoning: true }] })];
  assert.equal(providerCatalogChanged(c, d), false);
});

test('新增/删除供应商 → 需要热同步', () => {
  const before = [provider()];
  assert.equal(providerCatalogChanged(before, [provider(), provider({ id: 'p2' })]), true);
  assert.equal(providerCatalogChanged([provider(), provider({ id: 'p2' })], before), true);
});

test('模型集合变化（新增/删除/禁用/能力改动）→ 需要热同步', () => {
  const base = [provider()];
  assert.equal(
    providerCatalogChanged(base, [provider({ models: [{ id: 'm1', reasoning: true }, { id: 'm2' }] })]),
    true,
  );
  assert.equal(providerCatalogChanged(base, [provider({ models: [] })]), true);
  // enabled:false 的模型不进 pi 目录 → 等价于删除
  assert.equal(
    providerCatalogChanged(base, [provider({ models: [{ id: 'm1', enabled: false }] })]),
    true,
  );
  assert.equal(
    providerCatalogChanged(base, [provider({ models: [{ id: 'm1' }] })]),
    true,
  );
  assert.equal(
    providerCatalogChanged(
      base,
      [provider({ models: [{ id: 'm1', reasoning: true, contextWindow: 128000 }] })],
    ),
    true,
  );
});

test('thinkingLevelMap 键序不同但内容相同 → 不算变化', () => {
  const a = [provider({
    models: [{ id: 'm1', thinkingLevelMap: { off: null, high: 'high' } }],
  })];
  const b = [provider({
    models: [{ id: 'm1', thinkingLevelMap: { high: 'high', off: null } }],
  })];
  assert.equal(providerCatalogChanged(a, b), false);
});

test('端点/协议/名称/key 配置变化 → 需要热同步', () => {
  const base = [provider()];
  assert.equal(providerCatalogChanged(base, [provider({ baseUrl: 'https://other.example.com/v1' })]), true);
  assert.equal(providerCatalogChanged(base, [provider({ api: 'anthropic-messages' })]), true);
  assert.equal(providerCatalogChanged(base, [provider({ name: 'Renamed' })]), true);
  // key 从无到有：keyEnvVar 出现 → 运行中会话需补注入 env
  assert.equal(providerCatalogChanged(base, [provider({ keyEnvVar: 'CINDY_PI_KEY_P1' })]), true);
});

test('指纹对空表/字段缺省稳定', () => {
  assert.equal(providerCatalogFingerprint([]), '[]');
  assert.equal(providerCatalogChanged([], []), false);
  // 可选字段缺省 vs undefined 显式传入：归一后一致
  const withExplicitUndef = [provider({ models: [{ id: 'm1', compat: undefined }] })];
  const without = [provider({ models: [{ id: 'm1' }] })];
  assert.equal(providerCatalogChanged(withExplicitUndef, without), false);
});
