import test from 'node:test';
import assert from 'node:assert/strict';
import type { AgentEvent } from '@fundet/agent-core';
import { collectFinalText } from './turn-collector.ts';

/** 最小假会话：手动派事件，记录 abort */
function fakeSession() {
  const listeners = new Set<(event: AgentEvent) => void>();
  let aborted = 0;
  return {
    onEvent(listener: (event: AgentEvent) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    abort(): Promise<void> {
      aborted += 1;
      return Promise.resolve();
    },
    emit(event: AgentEvent): void {
      for (const l of [...listeners]) l(event);
    },
    abortCount(): number {
      return aborted;
    },
  };
}

test('turn collector', async (t) => {
  await t.test('text 累积，done 收口取最后一段', async () => {
    const s = fakeSession();
    const collector = collectFinalText(s, 60_000);
    s.emit({ type: 'text', data: { text: '第一' } } as AgentEvent);
    s.emit({ type: 'text', data: { text: '最终回复' } } as AgentEvent);
    s.emit({ type: 'done', data: {} } as AgentEvent);
    assert.equal(await collector.promise, '最终回复');
    assert.equal(s.abortCount(), 0);
  });

  await t.test('终态 error 用已有文本或错误说明收口', async () => {
    const s = fakeSession();
    const collector = collectFinalText(s, 60_000);
    s.emit({ type: 'error', data: { isTerminal: true, message: '欠费' } } as AgentEvent);
    assert.equal(await collector.promise, '出错了：欠费');

    const s2 = fakeSession();
    const c2 = collectFinalText(s2, 60_000);
    s2.emit({ type: 'text', data: { text: '答到一半' } } as AgentEvent);
    s2.emit({ type: 'error', data: { isTerminal: true, message: '欠费' } } as AgentEvent);
    assert.equal(await c2.promise, '答到一半');
  });

  await t.test('非终态 error 不收口，等 done', async () => {
    const s = fakeSession();
    const collector = collectFinalText(s, 60_000);
    s.emit({ type: 'error', data: { isTerminal: false, message: '重试中' } } as AgentEvent);
    s.emit({ type: 'text', data: { text: '好了' } } as AgentEvent);
    s.emit({ type: 'done', data: {} } as AgentEvent);
    assert.equal(await collector.promise, '好了');
  });

  await t.test('超时：abort 会话并按超时话术收口', async () => {
    const s = fakeSession();
    const collector = collectFinalText(s, 20);
    const text = await collector.promise;
    assert.equal(s.abortCount(), 1);
    assert.match(text, /已中断/);
    // 超时后迟到的 done 不会改变结果（幂等）
    s.emit({ type: 'done', data: {} } as AgentEvent);
  });

  await t.test('dispose 后事件不再收口（会话拒收路径）', async () => {
    const s = fakeSession();
    const collector = collectFinalText(s, 60_000);
    collector.dispose();
    assert.equal(await collector.promise, '');
    s.emit({ type: 'done', data: {} } as AgentEvent); // 不抛错
  });
});
