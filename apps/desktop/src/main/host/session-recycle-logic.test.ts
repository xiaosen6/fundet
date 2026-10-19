/** 闲置会话回收判定。node --test 直跑。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pickRecyclableSessions,
  shouldRecycleSession,
  SESSION_IDLE_RECYCLE_MS,
} from './session-recycle-logic.ts';

const NOW = 1_000_000_000;
const idle = (minutes: number): number => NOW - minutes * 60 * 1000;

function candidate(over: Partial<Parameters<typeof shouldRecycleSession>[0]> = {}): Parameters<typeof shouldRecycleSession>[0] {
  return {
    sessionId: 's1',
    lastActivityAt: idle(45),
    isRunning: false,
    hasPendingInteraction: false,
    hasPendingOutbox: false,
    isPrewarm: false,
    ...over,
  };
}

test('闲置超 30 分钟且无任何在办 → 可回收', () => {
  assert.equal(shouldRecycleSession(candidate(), NOW), true);
  // 恰好 30 分钟（边界含）
  assert.equal(shouldRecycleSession(candidate({ lastActivityAt: NOW - SESSION_IDLE_RECYCLE_MS }), NOW), true);
  // 29 分钟不回收
  assert.equal(shouldRecycleSession(candidate({ lastActivityAt: idle(29) }), NOW), false);
});

test('运行中 / 挂起交互 / 排队消息 / 预热会话绝不回收', () => {
  assert.equal(shouldRecycleSession(candidate({ isRunning: true }), NOW), false);
  assert.equal(shouldRecycleSession(candidate({ hasPendingInteraction: true }), NOW), false);
  assert.equal(shouldRecycleSession(candidate({ hasPendingOutbox: true }), NOW), false);
  assert.equal(shouldRecycleSession(candidate({ isPrewarm: true }), NOW), false);
});

test('巡检批：多会话混布只回收达标的', () => {
  const ids = pickRecyclableSessions(
    [
      candidate({ sessionId: 'idle-old' }),
      candidate({ sessionId: 'fresh', lastActivityAt: idle(5) }),
      candidate({ sessionId: 'running', isRunning: true }),
      candidate({ sessionId: 'queued', hasPendingOutbox: true }),
      candidate({ sessionId: 'pending-card', hasPendingInteraction: true }),
      candidate({ sessionId: 'idle-old-2' }),
    ],
    NOW,
  );
  assert.deepEqual(ids, ['idle-old', 'idle-old-2']);
});
