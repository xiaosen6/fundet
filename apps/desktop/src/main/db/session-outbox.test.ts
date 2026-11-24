/**
 * 会话 outbox 存储层：入队幂等 / CAS 派发边界 / 崩溃恢复。node --test 直跑
 *（内存 SQLite；desktop 测试链 peer 可选依赖）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createSessionOutboxStore } from './session-outbox.ts';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.prepare(`CREATE TABLE sessions (id TEXT PRIMARY KEY, agent_kind TEXT NOT NULL DEFAULT 'pi',
    title TEXT NOT NULL DEFAULT '', work_dir TEXT NOT NULL, model TEXT NOT NULL, effort TEXT,
    permission_mode TEXT, status TEXT NOT NULL DEFAULT 'active', sdk_session_id TEXT,
    pinned INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`).run();
  db.prepare(`CREATE TABLE messages (id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL)`).run();
  return db;
}

function seedSession(db: Database.Database, id = 's1'): void {
  db.prepare(`INSERT INTO sessions (id, work_dir, model, created_at, updated_at)
    VALUES (?, '/tmp/w', 'm1', 1, 1)`).run(id);
}

const PAYLOAD = (n: number) => JSON.stringify({ text: `msg-${n}`, attachments: [] });

test('入队幂等：同 userMessageId 同载荷返回既有行；异载荷拒绝', () => {
  const db = makeDb();
  seedSession(db);
  const store = createSessionOutboxStore(db);
  const a = store.enqueue({ userMessageId: 'u1', sessionId: 's1', payloadJson: PAYLOAD(1), now: 100 });
  const b = store.enqueue({ userMessageId: 'u1', sessionId: 's1', payloadJson: PAYLOAD(1), now: 200 });
  assert.equal(a.id, b.id);
  assert.equal(store.listBySession('s1').length, 1);
  assert.throws(() =>
    store.enqueue({ userMessageId: 'u1', sessionId: 's1', payloadJson: PAYLOAD(2), now: 300 }));
});

test('FIFO seq 递增 + head 取首个未终态', () => {
  const db = makeDb();
  seedSession(db);
  const store = createSessionOutboxStore(db);
  store.enqueue({ userMessageId: 'u1', sessionId: 's1', payloadJson: PAYLOAD(1), now: 1 });
  store.enqueue({ userMessageId: 'u2', sessionId: 's1', payloadJson: PAYLOAD(2), now: 2 });
  const head = store.head('s1')!;
  assert.equal(head.userMessageId, 'u1');
  assert.equal(store.nextSeq('s1'), 3);
});

test('CAS 派发边界：非 head / 未到期 / 已取消 / 非 queued 全部拒绝', () => {
  const db = makeDb();
  seedSession(db);
  seedSession(db, 's2');
  const store = createSessionOutboxStore(db);
  const h1 = store.enqueue({ userMessageId: 'u1', sessionId: 's1', payloadJson: PAYLOAD(1), now: 1 });
  store.enqueue({ userMessageId: 'u2', sessionId: 's1', payloadJson: PAYLOAD(2), now: 2 });

  // 非 head 拒绝
  const second = store.listBySession('s1')[1]!;
  assert.equal(store.casToSending(second.id, 0, 10), null);
  // head 成功
  const sent = store.casToSending(h1.id, 0, 10);
  assert.equal(sent?.state, 'sending');
  // 已 sending 再 CAS 拒绝（防重复派发）
  assert.equal(store.casToSending(h1.id, 0, 10), null);

  // 未到期拒绝：真实流程 = 派发(sending) → 终态可重试错误 → requeueForRetry 带 nextAttemptAt
  const r1 = store.enqueue({ userMessageId: 'r1', sessionId: 's2', payloadJson: PAYLOAD(9), now: 1 });
  assert.ok(store.casToSending(r1.id, 0, 5));
  store.requeueForRetry(r1.id, 10_000, 'rate limit', 6);
  assert.equal(store.casToSending(r1.id, 0, 5_000), null);
  assert.ok(store.casToSending(r1.id, 0, 10_000));

  // 已取消拒绝
  const r2 = store.enqueue({ userMessageId: 'r2', sessionId: 's2', payloadJson: PAYLOAD(9), now: 1 });
  store.setCancelRequested(r2.id, 2);
  store.markCancelled(r2.id, 3);
  assert.equal(store.casToSending(r2.id, 0, 10), null);
});

test('failed/outcome_unknown head 阻塞后续；手动重试/移除解除', () => {
  const db = makeDb();
  seedSession(db);
  const store = createSessionOutboxStore(db);
  const h1 = store.enqueue({ userMessageId: 'u1', sessionId: 's1', payloadJson: PAYLOAD(1), now: 1 });
  store.enqueue({ userMessageId: 'u2', sessionId: 's1', payloadJson: PAYLOAD(2), now: 2 });
  store.casToSending(h1.id, 0, 3);
  store.markFailed(h1.id, 'rate limit', 4);

  // u2 不可能成为 head（u1 failed 占位）
  assert.equal(store.head('s1')!.userMessageId, 'u1');

  // 手动重试 failed → queued
  assert.equal(store.requeueManual(h1.id, 5)?.state, 'queued');
  // outcome_unknown 需手动；同样占位阻塞
  store.casToSending(h1.id, 0, 6);
  store.markOutcomeUnknown(h1.id, null, 7);
  assert.equal(store.head('s1')!.state, 'outcome_unknown');
  store.requeueManual(h1.id, 8);
  // 移除 head → u2 接棒
  store.remove(h1.id);
  assert.equal(store.head('s1')!.userMessageId, 'u2');
});

test('崩溃恢复：sending → outcome_unknown，绝不自动重放', () => {
  const db = makeDb();
  seedSession(db);
  const store = createSessionOutboxStore(db);
  const h1 = store.enqueue({ userMessageId: 'u1', sessionId: 's1', payloadJson: PAYLOAD(1), now: 1 });
  store.casToSending(h1.id, 0, 2);
  const n = store.recoverSendingToUnknown(3);
  assert.equal(n, 1);
  assert.equal(store.get(h1.id)?.state, 'outcome_unknown');
});

test('cancelAllPending 只取消未终态；sending 不动（须走 abort）', () => {
  const db = makeDb();
  seedSession(db);
  const store = createSessionOutboxStore(db);
  const h1 = store.enqueue({ userMessageId: 'u1', sessionId: 's1', payloadJson: PAYLOAD(1), now: 1 });
  store.enqueue({ userMessageId: 'u2', sessionId: 's1', payloadJson: PAYLOAD(2), now: 2 });
  store.casToSending(h1.id, 0, 3);
  const n = store.cancelAllPending('s1', 4);
  assert.equal(n, 1); // 只取消 queued 的 u2
  assert.equal(store.get(h1.id)?.state, 'sending');
  assert.equal(store.get('u2')?.state, 'cancelled');
});

test('requestCancelSending：只给该会话的 sending 行打标记（abort 前置；2026-11-24 修复）', () => {
  const db = makeDb();
  seedSession(db);
  seedSession(db, 's2');
  const store = createSessionOutboxStore(db);
  const h1 = store.enqueue({ userMessageId: 'u1', sessionId: 's1', payloadJson: PAYLOAD(1), now: 1 });
  store.enqueue({ userMessageId: 'u2', sessionId: 's1', payloadJson: PAYLOAD(2), now: 2 });
  const other = store.enqueue({ userMessageId: 'o1', sessionId: 's2', payloadJson: PAYLOAD(3), now: 3 });
  store.casToSending(h1.id, 0, 4);
  store.casToSending(other.id, 0, 4);
  const n = store.requestCancelSending('s1', 5);
  assert.equal(n, 1);
  assert.equal(store.get(h1.id)?.cancelRequested, 1); // sending 行被标记
  assert.equal(store.get('u2')?.cancelRequested, 0); // queued 行不动（cancelAllPending 管）
  assert.equal(store.get(other.id)?.cancelRequested, 0); // 其它会话不动
});

test('markCancelled 允许 sending→cancelled（终态收口路径；2026-11-24 修复）', () => {
  const db = makeDb();
  seedSession(db);
  const store = createSessionOutboxStore(db);
  const h1 = store.enqueue({ userMessageId: 'u1', sessionId: 's1', payloadJson: PAYLOAD(1), now: 1 });
  store.enqueue({ userMessageId: 'u2', sessionId: 's1', payloadJson: PAYLOAD(2), now: 2 });
  store.casToSending(h1.id, 0, 3);
  store.requestCancelSending('s1', 4);
  store.markCancelled(h1.id, 5); // 终态 abort 错误到达时的收口
  assert.equal(store.get(h1.id)?.state, 'cancelled');
  // cancelled 不再占 head：u2 可派发
  assert.equal(store.head('s1')!.userMessageId, 'u2');
});

test('附件保护视图：未终态行的载荷附件路径全列出', () => {
  const db = makeDb();
  seedSession(db);
  const store = createSessionOutboxStore(db);
  store.enqueue({
    userMessageId: 'u1', sessionId: 's1', now: 1,
    payloadJson: JSON.stringify({ text: 'a', attachments: [{ path: 'C:/tmp/x.png' }] }),
  });
  const h2 = store.enqueue({ userMessageId: 'u2', sessionId: 's1', payloadJson: PAYLOAD(2), now: 2 });
  store.remove(h2.id);
  assert.deepEqual(store.pendingAttachmentPaths(), ['C:/tmp/x.png']);
});

test('附件保护视图：一条消息多附件全列出；终态行不再保护（2026-11-24 维护清扫接线回归）', () => {
  const db = makeDb();
  seedSession(db);
  const store = createSessionOutboxStore(db);
  const h1 = store.enqueue({
    userMessageId: 'u1', sessionId: 's1', now: 1,
    payloadJson: JSON.stringify({
      text: 'a',
      attachments: [
        { path: 'C:/tmp/a.pdf', name: 'a.pdf', kind: 'file' },
        { path: 'C:/tmp/b.png', name: 'b.png', kind: 'image' },
        // 无 path 的附件条目跳过（不炸、不出空串）
        { name: 'no-path' },
      ],
    }),
  });
  const h2 = store.enqueue({
    userMessageId: 'u2', sessionId: 's1', now: 2,
    payloadJson: JSON.stringify({ text: 'b', attachments: [{ path: 'C:/tmp/done.pdf' }] }),
  });
  store.casToSending(h2.id, 0, 3);
  store.remove(h2.id); // 终态成功删行：不再保护
  assert.deepEqual(store.pendingAttachmentPaths(), ['C:/tmp/a.pdf', 'C:/tmp/b.png']);
  store.markFailed(h1.id, 'x', 4); // failed 仍是未终态：继续保护
  assert.deepEqual(store.pendingAttachmentPaths(), ['C:/tmp/a.pdf', 'C:/tmp/b.png']);
});

test('会话删除级联清空 outbox（外键）', () => {
  const db = makeDb();
  seedSession(db);
  const store = createSessionOutboxStore(db);
  store.enqueue({ userMessageId: 'u1', sessionId: 's1', payloadJson: PAYLOAD(1), now: 1 });
  db.prepare('DELETE FROM sessions WHERE id = ?').run('s1');
  assert.equal(store.listBySession('s1').length, 0);
});
