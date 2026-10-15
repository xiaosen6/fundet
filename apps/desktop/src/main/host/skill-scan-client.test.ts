/**
 * SkillScanClient（utilityProcess 隔离客户端）纯逻辑测试：node --test 直跑，
 * fork 注入假子进程（无 Electron 依赖）。机制对照 Cindy customizationScanClient.test.ts。
 */
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SkillScanClient, type SkillScanChild } from './skill-scan-client.ts';
import type { SkillScanRequest } from './skill-scan-protocol.ts';
import type { ListCustomizationsOptions, ListCustomizationsResult } from '@fundet/agent-core';

class FakeScanner extends EventEmitter implements SkillScanChild {
  lastRequest: SkillScanRequest | null = null;
  autoExit = true;
  killed = 0;
  postMessage(message: SkillScanRequest): void {
    this.lastRequest = message;
  }
  kill(): boolean {
    this.killed++;
    if (this.autoExit) queueMicrotask(() => this.emit('exit', 0));
    return true;
  }
  reply(result: ListCustomizationsResult): void {
    assert.ok(this.lastRequest, 'postMessage 未被调用');
    this.emit('message', { kind: 'result', id: this.lastRequest.id, result });
  }
}

const okResult = (): ListCustomizationsResult => ({
  items: [
    {
      engine: 'pi',
      name: 'demo',
      kind: 'skill',
      scope: 'user',
      absolutePath: 'C:/skills/demo/SKILL.md',
    },
  ],
  errors: [],
});

const OPTS: ListCustomizationsOptions = { workingDirs: [], kinds: ['skill'] };
const OTHER_OPTS: ListCustomizationsOptions = { workingDirs: ['C:/x'], kinds: ['skill'] };

function makeClient(fork: () => SkillScanChild, overrides: { timeoutMs?: number; maxConcurrent?: number } = {}) {
  return new SkillScanClient({ fork, timeoutMs: overrides.timeoutMs ?? 50, maxConcurrent: overrides.maxConcurrent });
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

test('正常路径：子进程回有效结果 → 结构化返回并 kill 回收', async () => {
  const child = new FakeScanner();
  const forkCount = { n: 0 };
  const client = makeClient(() => {
    forkCount.n++;
    return child;
  });
  const pending = client.scan(OPTS);
  queueMicrotask(() => child.reply(okResult()));
  const result = await pending;
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]!.name, 'demo');
  await wait(5);
  assert.equal(child.killed, 1);
  assert.equal(forkCount.n, 1);
});

test('同参数去重：只 fork 一次，两个调用方各拿独立副本', async () => {
  const child = new FakeScanner();
  const forkCount = { n: 0 };
  const client = makeClient(() => {
    forkCount.n++;
    return child;
  });
  const a = client.scan(OPTS);
  const b = client.scan(OPTS);
  queueMicrotask(() => child.reply(okResult()));
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(forkCount.n, 1);
  ra.items.push({
    engine: 'pi', name: 'x', kind: 'skill', scope: 'user', absolutePath: 'C:/x',
  });
  assert.equal(rb.items.length, 1, '共享 job 但副本独立');
});

test('超时：返回 [pi] 前缀错误并 kill 一次（主进程计时器不被子进程挂死拖住）', async () => {
  const child = new FakeScanner();
  const client = makeClient(() => child, { timeoutMs: 10 });
  const heartbeat = { n: 0 };
  // 心跳保持 ref：client 的超时计时器是 unref 的（生产语义，不拖住退出），
  // 测试进程若没有 ref 计时器，事件循环会在 10ms 计时器触发前排干、进程提前退出
  const ticker = setInterval(() => heartbeat.n++, 5);
  const result = await client.scan(OPTS);
  clearInterval(ticker);
  assert.ok(result.items.length === 0);
  assert.match(result.errors[0]!.message, /^\[pi\] Skill scan timed out$/);
  assert.ok(heartbeat.n > 0, '等待期间主进程事件循环仍活着');
  assert.equal(child.killed, 1);
});

test('失败路径：exit/error/非法结果各自收敛为错误返回', async () => {
  // exit before completing
  const exiter = new FakeScanner();
  const c1 = makeClient(() => exiter);
  const p1 = c1.scan(OPTS);
  queueMicrotask(() => exiter.emit('exit', 1));
  assert.match((await p1).errors[0]!.message, /exited before completing/);
  // error
  const errer = new FakeScanner();
  const c2 = makeClient(() => errer);
  const p2 = c2.scan(OPTS);
  queueMicrotask(() => errer.emit('error', 'boom'));
  assert.match((await p2).errors[0]!.message, /failed$/);
  // 非法结果（engine 不符）
  const bad = new FakeScanner();
  const c3 = makeClient(() => bad);
  const p3 = c3.scan(OPTS);
  queueMicrotask(() =>
    bad.reply({ items: [{ engine: 'codex', name: 'x', kind: 'skill', scope: 'user', absolutePath: 'C:/x' }], errors: [] }),
  );
  assert.match((await p3).errors[0]!.message, /invalid result/);
});

test('迟到/串台消息被忽略：不干扰下一次扫描', async () => {
  const child = new FakeScanner();
  const client = makeClient(() => child);
  const first = client.scan(OPTS);
  queueMicrotask(() => child.reply(okResult()));
  await first;
  // 迟到重复消息（旧 id）
  child.reply(okResult());
  const second = client.scan(OTHER_OPTS);
  queueMicrotask(() => child.reply(okResult()));
  const r2 = await second;
  assert.equal(r2.items.length, 1);
});

test('并发上限与 kill 失败的槽位保留：挂死子进程不绕过 maxConcurrent', async () => {
  const stuck = new FakeScanner();
  stuck.autoExit = false; // kill 后不 exit（模拟原生 I/O 挂死）
  const client = makeClient(() => stuck, { timeoutMs: 10, maxConcurrent: 1 });
  const first = client.scan(OPTS); // 会超时，但子进程占着槽位直到 exit
  await wait(30);
  await first;
  const busy = await client.scan(OTHER_OPTS);
  assert.match(busy.errors[0]!.message, /busy/);
  // exit 到达后槽位回收，可再次扫描
  stuck.emit('exit', 0);
  const normal = new FakeScanner();
  const client2 = new SkillScanClient({ fork: () => normal, timeoutMs: 50 });
  const p = client2.scan(OPTS);
  queueMicrotask(() => normal.reply(okResult()));
  assert.equal((await p).items.length, 1);
});

test('dispose：在途取消、后续请求直接 stopped', async () => {
  const child = new FakeScanner();
  child.autoExit = false;
  const client = makeClient(() => child, { timeoutMs: 1000 });
  const pending = client.scan(OPTS);
  client.dispose();
  assert.match((await pending).errors[0]!.message, /stopped/);
  assert.equal(child.killed, 1);
  const after = await client.scan(OPTS);
  assert.match(after.errors[0]!.message, /^\[pi\] Skill scanner stopped$/);
});
