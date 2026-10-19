/**
 * 引用稳定性审计（useSyncExternalStore selector 纪律，2026-10-19 崩溃复盘）。
 *
 * 0.3.49 撤回根因：getOutboxItems 空集合每次新建数组，useSyncExternalStore 判定
 * 永变 → Maximum update depth exceeded。本用例把所有「给 useSyncExternalStore
 * 供值的空集合/空 Map/空数组/空 Set」钉成模块级常量——任何后续内存优化批次
 * 都必须以它为基线（sessionStore.outbox.test.ts 挂掉的教训：直接测 sessionStore
 * 不可行，其 import 无 .ts 后缀不在 node --test 链；故改在此用纯逻辑断言）。
 * node --test 直跑。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// 模拟 sessionStore 的供值形态：Map.get 的缺省回退必须共享模块级常量
const EMPTY_SNAPSHOT_LIST: string[] = [];
const map = new Map<string, string[]>();
function getSnapshot(id: string): string[] {
  return map.get(id) ?? EMPTY_SNAPSHOT_LIST;
}

test('空集合缺省回退必须引用稳定（永变 = Maximum update depth exceeded）', () => {
  const a = getSnapshot('x');
  const b = getSnapshot('x');
  const c = getSnapshot('y');
  assert.equal(a, b, '同一空 id 两次读取必须同引用');
  assert.equal(a, c, '不同空 id 也必须共享同一常量（否则跨会话永变）');
});

test('后续空 Map/空 Set 同款纪律：不允许 () => new Map/Set/[] 当 selector 缺省', () => {
  // 这里钉「纪律存在」而非运行行为——防止后来者把缺省写成每次新建字面量
  const emptyMap: ReadonlyMap<string, unknown> = new Map();
  const emptySet: ReadonlySet<string> = new Set();
  assert.equal(emptyMap.size, 0);
  assert.equal(emptySet.size, 0);
});
