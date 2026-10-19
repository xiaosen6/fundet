/**
 * outbox 泵：派发边界 / 终态收口 / 崩溃语义 / FIFO 阻塞。假 store + 假 Session
 * 直测（零 Electron）。计时用注入 scheduleTimer，不落真 setTimeout。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AgentEvent } from '@fundet/agent-core';
import type { SessionOutboxStore, OutboxRow } from '../db/session-outbox.ts';
import { createOutboxService, type OutboxServiceDeps, type OutboxDispatchTarget } from './session-outbox.ts';

interface Harness {
  store: SessionOutboxStore;
  service: ReturnType<typeof createOutboxService>;
  sends: Array<{ text: string; token?: number }>;
  acceptedRows: OutboxRow[];
  ensureError: string | null;
  timers: Array<{ sessionId: string; delay: number }>;
  changed: string[];
}

function makeStore(): SessionOutboxStore {
  const rows = new Map<string, OutboxRow>();
  const bySession = (sid: string) =>
    [...rows.values()].filter((r) => r.sessionId === sid).sort((a, b) => a.seq - b.seq);
  const head = (sid: string) =>
    bySession(sid).find((r) => r.state !== 'cancelled') ?? null;
  return {
    enqueue: ({ userMessageId, sessionId, payloadJson, now }) => {
      const prior = [...rows.values()].find((r) => r.userMessageId === userMessageId);
      if (prior) {
        if (prior.sessionId !== sessionId || prior.payloadJson !== payloadJson) {
          throw new Error('重复的发送 id 但内容不同，拒绝覆盖');
        }
        return prior;
      }
      const seq = bySession(sessionId).length + 1;
      const row: OutboxRow = {
        id: userMessageId, sessionId, seq, state: 'queued', payloadJson,
        userMessageId, userMessageCreatedAt: null, attempt: 0, autoRetryCount: 0,
        nextAttemptAt: null, lastError: null, cancelRequested: 0,
        createdAt: now, updatedAt: now,
      };
      rows.set(row.id, row);
      return row;
    },
    listBySession: bySession,
    head: (sid) => head(sid),
    get: (id) => rows.get(id) ?? null,
    casToSending: (id, _t, now) => {
      const r = rows.get(id);
      if (!r || r.state !== 'queued' || r.cancelRequested) return null;
      const h = head(r.sessionId);
      if (!h || h.id !== id) return null;
      if (r.nextAttemptAt != null && r.nextAttemptAt > now) return null;
      r.state = 'sending'; r.updatedAt = now; r.attempt += 1;
      return { ...r };
    },
    markFailed: (id, error, now) => { const r = rows.get(id); if (r) { r.state = 'failed'; r.lastError = error; r.updatedAt = now; } },
    markOutcomeUnknown: (id, error, now) => { const r = rows.get(id); if (r) { r.state = 'outcome_unknown'; r.lastError = error ?? r.lastError; r.updatedAt = now; } },
    markCancelled: (id, now) => { const r = rows.get(id); if (r && r.state !== 'sending') { r.state = 'cancelled'; r.updatedAt = now; } },
    remove: (id) => { rows.delete(id); },
    requeueForRetry: (id, nextAttemptAt, error, now) => {
      const r = rows.get(id);
      if (!r || r.state !== 'sending') return;
      r.state = 'queued'; r.nextAttemptAt = nextAttemptAt; r.lastError = error ?? r.lastError;
      r.autoRetryCount += 1; r.updatedAt = now;
    },
    requeueManual: (id, now) => {
      const r = rows.get(id);
      if (!r || (r.state !== 'failed' && r.state !== 'outcome_unknown')) return null;
      r.state = 'queued'; r.nextAttemptAt = null; r.updatedAt = now;
      return { ...r };
    },
    setCancelRequested: (id, now) => { const r = rows.get(id); if (r) { r.cancelRequested = 1; r.updatedAt = now; } },
    cancelAllPending: (sid, now) => {
      let n = 0;
      for (const r of bySession(sid)) {
        if (r.state === 'queued' || r.state === 'failed' || r.state === 'outcome_unknown') {
          r.state = 'cancelled'; r.updatedAt = now; n++;
        }
      }
      return n;
    },
    pendingAttachmentPaths: () => [],
    recoverSendingToUnknown: (now) => {
      let n = 0;
      for (const r of rows.values()) {
        if (r.state === 'sending') { r.state = 'outcome_unknown'; r.updatedAt = now; n++; }
      }
      return n;
    },
    hasPending: (sid) => bySession(sid).some((r) => r.state !== 'cancelled'),
    allPendingSessionIds: () => [...new Set([...rows.values()].filter((r) => r.state !== 'cancelled').map((r) => r.sessionId))],
    listAllPending: () => [...rows.values()].filter((r) => r.state !== 'cancelled'),
    nextSeq: (sid) => bySession(sid).length + 1,
  };
}

function makeHarness(overrides?: Partial<OutboxServiceDeps>): Harness {
  const store = overrides?.store ?? makeStore();
  const h: Harness = {
    store,
    service: null as unknown as Harness['service'],
    sends: [],
    acceptedRows: [],
    ensureError: null,
    timers: [],
    changed: [],
  };
  const deps: OutboxServiceDeps = {
    store,
    ensureSession: async ({ sessionId }) => {
      if (h.ensureError) throw new Error(h.ensureError);
      const target: OutboxDispatchTarget = {
        send: async (message, opts) => {
          h.sends.push({ text: String((message as { content?: unknown }).content ?? ''), token: opts?.turnAttemptToken });
          opts?.onAccepted && await opts.onAccepted();
          opts?.onDispatching?.();
          return { accepted: true };
        },
      };
      void sessionId;
      return target;
    },
    prepareTurn: () => {},
    applyAutoRag: async (_sid, text) => text,
    persistAcceptedMessage: (row) => {
      const first = !h.acceptedRows.some((r) => r.id === row.id);
      if (first) h.acceptedRows.push(row);
      return first;
    },
    buildUserMessage: async (text) => ({ type: 'user', content: text }),
    now: (() => { let t = 1_000; return () => (t += 1); })(),
    scheduleTimer: (sessionId, delayMs) => h.timers.push({ sessionId, delay: delayMs }),
    onChanged: (sessionId) => h.changed.push(sessionId),
    log: () => {},
    ...overrides,
  };
  h.service = createOutboxService(deps);
  return h;
}

function enqueue(h: Harness, userMessageId: string, text = `msg-${userMessageId}`, sessionId = 's1'): void {
  h.service.enqueue({ userMessageId, sessionId, text, attachments: [], create: { model: 'm' } });
}

test('入队即派发：onAccepted 幂等落消息 → onDispatching CAS → accepted 后等终态', async () => {
  const h = makeHarness();
  enqueue(h, 'u1');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(h.sends.length, 1);
  assert.equal(h.store.get('u1')?.state, 'sending');
  assert.equal(h.service.isDispatching('s1'), true);
  assert.equal(h.acceptedRows.length, 1);
});

test('done 终态 → 行删除 → FIFO 下一条接棒', async () => {
  const h = makeHarness();
  enqueue(h, 'u1', 'first');
  await new Promise((r) => setTimeout(r, 20));
  h.service.onTerminalEvent('s1', { type: 'done', data: {}, turnAttemptToken: 1 } as AgentEvent);
  await new Promise((r) => setTimeout(r, 20));
  // u1 已收口（成功删行）——入队第二条应立即派发
  enqueue(h, 'u2', 'second');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(h.sends.map((s) => s.text).join(','), 'first,second');
});

test('终态可重试错误 → 自动重试带退避（nextAttemptAt 到期才再派发）', async () => {
  const h = makeHarness();
  enqueue(h, 'r1');
  await new Promise((r) => setTimeout(r, 20));
  h.service.onTerminalEvent('s1', {
    type: 'error',
    data: { isTerminal: true, message: 'HTTP 429 rate limit' },
    turnAttemptToken: 1,
  } as unknown as AgentEvent);
  await new Promise((r) => setTimeout(r, 10));
  const row = h.store.get('r1')!;
  assert.equal(row.state, 'queued');
  assert.equal(row.autoRetryCount, 1);
  assert.ok(row.nextAttemptAt != null && row.nextAttemptAt > 0);
  assert.equal(h.sends.length, 1); // 未到期不重发
});

test('终态不可重试错误 → failed 阻塞后续 FIFO', async () => {
  const h = makeHarness();
  enqueue(h, 'r1');
  await new Promise((r) => setTimeout(r, 20));
  h.service.onTerminalEvent('s1', {
    type: 'error',
    data: { isTerminal: true, message: '401 unauthorized' },
    turnAttemptToken: 1,
  } as unknown as AgentEvent);
  const row = h.store.get('r1')!;
  assert.equal(row.state, 'failed');
  enqueue(h, 'r2');
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(h.sends.length, 1); // r2 被 failed head 阻塞
  // 手动重试解除
  h.service.retry('s1', 'r1');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(h.sends.length, 2);
});

test('CAS 前抛错（ensureSession 失败）→ undispatched：可重试分类走自动重试', async () => {
  const h = makeHarness();
  h.ensureError = 'fetch failed 网络异常';
  enqueue(h, 'r1');
  await new Promise((r) => setTimeout(r, 30));
  const row = h.store.get('r1')!;
  assert.equal(row.state, 'queued');
  assert.equal(row.autoRetryCount, 1);
  assert.ok((row.lastError ?? '').includes('网络'));
});

test('CAS 后抛错 → outcome_unknown，绝不自动重放', async () => {
  const h = makeHarness({
    ensureSession: async () => ({
      send: async (_m, opts) => {
        opts?.onAccepted && await opts.onAccepted();
        opts?.onDispatching?.();
        throw new Error('pi rpc disconnected');
      },
    }),
  });
  enqueue(h, 'r1');
  await new Promise((r) => setTimeout(r, 30));
  const row = h.store.get('r1')!;
  assert.equal(row.state, 'outcome_unknown');
  assert.equal(h.sends.length, 0);
  // 后续入队被阻塞
  enqueue(h, 'r2');
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(h.acceptedRows.some((r) => r.id === 'r2'), false);
});

test('陈旧 turnAttemptToken 的终态不收口当前派发', async () => {
  const h = makeHarness();
  enqueue(h, 'u1');
  await new Promise((r) => setTimeout(r, 20));
  // token 不匹配（旧尝试的迟到终态）
  h.service.onTerminalEvent('s1', { type: 'done', data: {}, turnAttemptToken: 99 } as AgentEvent);
  assert.equal(h.service.isDispatching('s1'), true);
  assert.equal(h.store.get('u1')?.state, 'sending');
});

test('启动恢复：sending → outcome_unknown 后不自动派发、后续阻塞', async () => {
  const h = makeHarness();
  enqueue(h, 'u1');
  await new Promise((r) => setTimeout(r, 20));
  // 模拟重启：直接把 sending 留在库里 → 新 service 实例恢复
  const h2 = makeHarness({ store: h.store });
  h2.service.recoverAndResume();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(h2.store.get('u1')?.state, 'outcome_unknown');
  assert.equal(h2.sends.length, 0); // 绝不自动重放
});

test('手动移除 head 解除 FIFO 阻塞；sending 不可移除', async () => {
  const h = makeHarness();
  enqueue(h, 'u1');
  await new Promise((r) => setTimeout(r, 20));
  assert.throws(() => h.service.remove('s1', 'u1'), /不能移除/);
  h.service.onTerminalEvent('s1', { type: 'error', data: { isTerminal: true, message: '401' }, turnAttemptToken: 1 } as unknown as AgentEvent);
  h.service.remove('s1', 'u1');
  enqueue(h, 'u2');
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(h.sends.length, 2);
});

test('cancelAllPending：queued 全取消，sending 不动', async () => {
  const h = makeHarness();
  enqueue(h, 'u1');
  await new Promise((r) => setTimeout(r, 20));
  enqueue(h, 'u2');
  h.service.cancelAll('s1');
  assert.equal(h.store.get('u1')?.state, 'sending');
  assert.equal(h.store.get('u2')?.state, 'cancelled');
});
