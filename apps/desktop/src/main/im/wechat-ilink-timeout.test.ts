/**
 * 微信长轮询回归（源码级）：vendored 包使用 .js 导入，不能进 desktop 的
 * node --test 直跑 TS 链。这里锁定两条不能被误合并的语义边界。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./wechat-ilink/apiClient.ts', import.meta.url), 'utf8');
const getUpdatesBody = source.slice(source.indexOf('async getUpdates('), source.indexOf('notifyStart('));
const pollQrBody = source.slice(source.indexOf('async pollQr('), source.indexOf('async getUpdates('));

test('getUpdates 不再吞 TIMEOUT 或返回 ret:0 空批次', () => {
  assert.equal(getUpdatesBody.includes('catch'), false);
  assert.equal(getUpdatesBody.includes('ret: 0'), false);
  assert.match(getUpdatesBody, /return this\.request\(/);
});

test('pollQr 保留 TIMEOUT → wait 的扫码等待语义', () => {
  assert.match(pollQrBody, /error\.code === "TIMEOUT"/);
  assert.match(pollQrBody, /status: "wait"/);
});
