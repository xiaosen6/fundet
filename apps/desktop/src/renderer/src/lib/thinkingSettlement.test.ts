import test from 'node:test';
import assert from 'node:assert/strict';
import { settleRunningThinking } from './thinkingSettlement.ts';

test('仅终态收口 running 思考项，保留文本和 duration', () => {
  const out = settleRunningThinking([
    { kind: 'thinking', running: true, text: '思考中', durationMs: 500 },
    { kind: 'assistant', text: '回答' },
  ]);
  assert.deepEqual(out[0], { kind: 'thinking', running: false, text: '思考中', durationMs: 500 });
  assert.deepEqual(out[1], { kind: 'assistant', text: '回答' });
});

test('已完成项和其他类型不变；无变化时保留原数组引用', () => {
  const items = [{ kind: 'thinking', running: false }, { kind: 'error' }];
  assert.equal(settleRunningThinking(items), items);
});
