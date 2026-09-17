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

test('线性退避：attempt 翻倍延迟', () => {
  const seed = classifyRetryableError('HTTP 429')!;
  assert.equal(retryDelayMs(seed, 1), 15_000);
  assert.equal(retryDelayMs(seed, 2), 30_000);
});
