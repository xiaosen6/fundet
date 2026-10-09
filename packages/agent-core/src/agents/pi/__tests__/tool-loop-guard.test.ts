import { describe, expect, it } from 'vitest';
import { createToolLoopGuard, toolInputKey } from '../tool-loop-guard.js';

describe('createToolLoopGuard', () => {
  it('连续相同调用达到阈值熔断', () => {
    let t = 0;
    const g = createToolLoopGuard({ limit: 3, now: () => t });
    expect(g.feed('bash', 'x')).toBe('ok');
    t = 10;
    expect(g.feed('bash', 'x')).toBe('ok');
    t = 20;
    expect(g.feed('bash', 'x')).toBe('trip');
  });

  it('不同工具或不同入参重置计数', () => {
    let t = 0;
    const g = createToolLoopGuard({ limit: 3, now: () => t });
    g.feed('bash', 'x');
    t = 10;
    g.feed('bash', 'x');
    t = 20;
    g.feed('read', 'x'); // 换工具重置
    t = 30;
    expect(g.feed('read', 'x')).toBe('ok');
    t = 40;
    g.feed('read', 'x');
    t = 50;
    expect(g.feed('read', 'x')).toBe('trip');
  });

  it('间隔超过重置窗视为外部进展，不熔断轮询', () => {
    let t = 0;
    const g = createToolLoopGuard({ limit: 3, resetWindowMs: 1000, now: () => t });
    for (let i = 0; i < 10; i++) {
      t += 2000; // 每次间隔 2s > 1s 窗口
      expect(g.feed('bash', 'poll')).toBe('ok');
    }
  });

  it('reset 清零', () => {
    let t = 0;
    const g = createToolLoopGuard({ limit: 2, now: () => t });
    g.feed('bash', 'x');
    t = 1;
    g.feed('bash', 'x'); // trip 但忽略
    g.reset();
    t = 2;
    expect(g.feed('bash', 'x')).toBe('ok');
  });
});

describe('toolInputKey', () => {
  it('对象序列化稳定，undefined 归一', () => {
    expect(toolInputKey({ a: 1 })).toBe('{"a":1}');
    expect(toolInputKey(undefined)).toBe('null');
    expect(toolInputKey(undefined)).toBe(toolInputKey(null));
  });
});
