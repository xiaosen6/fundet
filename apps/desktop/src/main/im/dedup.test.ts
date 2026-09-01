import test from 'node:test';
import assert from 'node:assert/strict';
import { createInboundDedup } from './dedup.ts';

test('inbound dedup', async (t) => {
  await t.test('首次见到返回 false，立即重推返回 true', () => {
    const dedup = createInboundDedup();
    assert.equal(dedup.seen('m1', 1000), false);
    assert.equal(dedup.seen('m1', 1001), true);
  });

  await t.test('TTL 过期后同一 key 不再拦截', () => {
    const dedup = createInboundDedup({ ttlMs: 1000 });
    dedup.seen('m1', 1000);
    assert.equal(dedup.seen('m1', 1000 + 999), true);
    assert.equal(dedup.seen('m1', 1000 + 1000), false);
  });

  await t.test('不同 key 互不影响', () => {
    const dedup = createInboundDedup();
    dedup.seen('a', 1);
    assert.equal(dedup.seen('b', 1), false);
    assert.equal(dedup.seen('a', 2), true);
  });

  await t.test('容量上限触发按插入序丢最旧', () => {
    const dedup = createInboundDedup({ ttlMs: 60_000, maxEntries: 3 });
    dedup.seen('k1', 1);
    dedup.seen('k2', 2);
    dedup.seen('k3', 3);
    dedup.seen('k4', 4); // 触发 prune：k1 最旧被挤出
    assert.equal(dedup.size() <= 3, true);
    assert.equal(dedup.seen('k1', 5), false); // k1 已被遗忘
    assert.equal(dedup.seen('k3', 5), true); // k3 还记得
  });

  await t.test('命中去重不刷新插入序（按首次见到时间淘汰）', () => {
    const dedup = createInboundDedup({ ttlMs: 60_000, maxEntries: 3 });
    dedup.seen('k1', 1);
    dedup.seen('k2', 2);
    assert.equal(dedup.seen('k1', 3), true); // 命中，k1 插入序不变
    dedup.seen('k3', 4);
    dedup.seen('k4', 5); // 挤掉最旧的 k1
    assert.equal(dedup.seen('k2', 6), true); // k2 还记得（先查：重新学习 k1 会再挤人）
    assert.equal(dedup.seen('k1', 6), false); // k1 已被容量淘汰
  });
});
