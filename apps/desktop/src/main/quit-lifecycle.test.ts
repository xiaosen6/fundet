import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuitLifecycle } from './quit-lifecycle.ts';

test('重复 before-quit 复用同一清理，结算后才批准最终退出', async () => {
  let calls = 0;
  let release!: () => void;
  const cleanup = () => {
    calls++;
    return new Promise<void>((resolve) => { release = resolve; });
  };
  const lifecycle = createQuitLifecycle(cleanup, 1000);
  assert.equal(lifecycle.begin(), 'started');
  assert.equal(lifecycle.begin(), 'pending');
  assert.equal(calls, 1);
  assert.equal(lifecycle.approved(), false);
  release!();
  await lifecycle.pending();
  assert.equal(lifecycle.approved(), true);
  assert.equal(lifecycle.begin(), 'approved');
});

test('清理失败和超时也继续退出，且不留下永久 pending', async () => {
  const failed = createQuitLifecycle(() => Promise.reject(new Error('stop failed')), 1000);
  failed.begin();
  await failed.pending();
  assert.equal(failed.approved(), true);

  const timedOut = createQuitLifecycle(() => new Promise<void>(() => {}), 0);
  timedOut.begin();
  await timedOut.pending();
  assert.equal(timedOut.approved(), true);
});
