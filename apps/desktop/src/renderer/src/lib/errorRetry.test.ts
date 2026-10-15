/**
 * 错误分类重试：识别矩阵 + 退避节奏。node --test 直跑（无 Electron 依赖）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyRetryableError, retryDelayMs } from './errorRetry.ts';

test('限流类识别（429 / rate limit / 中文限流）', () => {
  for (const msg of ['HTTP 429 Too Many Requests', 'rate limit exceeded', '请求过于频繁，触发限流']) {
    const plan = classifyRetryableError(msg);
    assert.equal(plan?.kind, 'rate-limit', msg);
    assert.equal(plan.delayMs, 15_000);
  }
});

test('过载类识别（503 / 529 / overloaded）', () => {
  for (const msg of ['HTTP 503', 'server overloaded', '529 : upstream overloaded']) {
    assert.equal(classifyRetryableError(msg)?.kind, 'overloaded', msg);
  }
});

test('网络瞬断识别（ECONNRESET / fetch failed / 中文断开）', () => {
  for (const msg of ['fetch failed: ECONNRESET', 'socket hang up', '连接已中断']) {
    assert.equal(classifyRetryableError(msg)?.kind, 'network', msg);
  }
});

test('不可重试：鉴权 / 参数 / 欠费配额', () => {
  for (const msg of [
    'HTTP 401 unauthorized',
    'invalid api key',
    '智谱 1210 参数错误',
    'insufficient_quota: 配额不足',
    '账户余额不足',
  ]) {
    assert.equal(classifyRetryableError(msg), null, msg);
  }
});

test('未识别错误不重试', () => {
  assert.equal(classifyRetryableError('something went wrong'), null);
});

test('截断指数退避 + Full Jitter（CDS 公式）：2 倍递增 / jitter 区间 / 封顶', () => {
  const seed = classifyRetryableError('HTTP 429')!;
  // random=0.5 → jitter=1.0，纯指数：15s→30s→60s
  assert.equal(retryDelayMs(seed, 1, () => 0.5), 15_000);
  assert.equal(retryDelayMs(seed, 2, () => 0.5), 30_000);
  assert.equal(retryDelayMs(seed, 3, () => 0.5), 60_000);
  // jitter 边界 0.85 / 1.15（±15%）
  assert.equal(retryDelayMs(seed, 1, () => 0), Math.round(15_000 * 0.85));
  assert.equal(retryDelayMs(seed, 1, () => 1), Math.round(15_000 * 1.15));
  // 封顶 10min
  const huge = { kind: 'rate-limit' as const, label: '', delayMs: 500_000 };
  assert.equal(retryDelayMs(huge, 3, () => 1), 600_000);
  // base 地板 5s：更小的 seed 也按 5s 起
  const tiny = { kind: 'network' as const, label: '', delayMs: 1_000 };
  assert.equal(retryDelayMs(tiny, 1, () => 0.5), 5_000);
});
