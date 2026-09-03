import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));

vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));

import { PiRpcProcess } from './rpc-client.js';

function makeChild() {
  const child = new EventEmitter() as EventEmitter & {
    pid: number;
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { write: ReturnType<typeof vi.fn> };
    kill: ReturnType<typeof vi.fn>;
  };
  child.pid = 4321;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write: vi.fn() };
  child.kill = vi.fn();
  return child;
}

function createProcess() {
  const logger = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  };
  const onEvent = vi.fn();
  mocks.spawn.mockReturnValue(makeChild());
  const proc = new PiRpcProcess({
    binaryPath: '/pi',
    args: ['--mode', 'rpc'],
    cwd: '/work',
    env: {},
    logger,
    onEvent,
    onExit: vi.fn(),
  });
  return { proc, logger, onEvent };
}

function emitEvent(proc: PiRpcProcess, frame: Record<string, unknown>): void {
  (proc as unknown as { child: { stdout: EventEmitter } }).child.stdout.emit(
    'data',
    Buffer.from(`${JSON.stringify(frame)}\n`),
  );
}

beforeEach(() => {
  mocks.spawn.mockReset();
});

describe('PiRpcProcess frame diagnostics (#3696)', () => {
  it('message_end logs block types and char counts, never the text itself', () => {
    const { proc, logger } = createProcess();
    emitEvent(proc, {
      type: 'message_end',
      message: {
        role: 'assistant',
        stopReason: 'stop',
        content: [
          { type: 'text', text: 'SECRET-BODY' },
          { type: 'thinking', thinking: 'SECRET-THOUGHT' },
        ],
      },
    });
    const call = logger.info.mock.calls.find((c) => c[0] === 'pi rpc message_end frame');
    expect(call).toBeDefined();
    expect(call![1]).toEqual({
      role: 'assistant',
      stopReason: 'stop',
      blockTypes: ['text', 'thinking'],
      textChars: 11,
      thinkingChars: 14,
    });
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('SECRET');
  });

  it('agent_settled logs the per-turn histogram and resets counts', () => {
    const { proc, logger } = createProcess();
    emitEvent(proc, { type: 'agent_start' });
    emitEvent(proc, { type: 'message_update' });
    emitEvent(proc, { type: 'message_end', message: { role: 'assistant', content: [] } });
    emitEvent(proc, { type: 'agent_settled' });
    const hist = logger.info.mock.calls.find((c) => c[0] === 'pi rpc turn frame histogram');
    expect(hist![1]).toEqual({
      frames: { agent_start: 1, message_update: 1, message_end: 1, agent_settled: 1 },
    });
    // 结算后计数清零：下一轮直方图不再包含上一轮
    emitEvent(proc, { type: 'agent_start' });
    emitEvent(proc, { type: 'agent_settled' });
    const hist2 = logger.info.mock.calls.filter((c) => c[0] === 'pi rpc turn frame histogram');
    expect(hist2[1]![1]).toEqual({ frames: { agent_start: 1, agent_settled: 1 } });
  });

  it('flushes an unsettled turn histogram at the next agent_start (no cross-turn bleed)', () => {
    const { proc, logger } = createProcess();
    emitEvent(proc, { type: 'agent_start' });
    emitEvent(proc, { type: 'message_update' });
    // 本轮 abort：没有 agent_settled，直接开下一轮
    emitEvent(proc, { type: 'agent_start' });
    const flush = logger.info.mock.calls.find(
      (c) => c[0] === 'pi rpc turn frame histogram (no agent_settled)',
    );
    expect(flush).toBeDefined();
    expect(flush![1]).toEqual({ frames: { agent_start: 1, message_update: 1 } });
  });

  it('normalizes non-identifier labels to (other) so hostile fields never reach logs', () => {
    const { proc, logger } = createProcess();
    emitEvent(proc, {
      type: 'message_end',
      message: { role: 'leak role body here', stopReason: null, content: [{ type: 'x'.repeat(80) }] },
    });
    const call = logger.info.mock.calls.find((c) => c[0] === 'pi rpc message_end frame');
    expect(call![1]).toMatchObject({ role: '(other)', blockTypes: ['(other)'] });
  });
});
