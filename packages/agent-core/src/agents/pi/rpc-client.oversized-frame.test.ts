/**
 * #4518 超限 JSONL 帧：>16MiB 的行整行丢弃（不进 JSON parse / onEvent），
 * pending 里的 get_entries 以显式错误收口（不猜 steer/abort）；
 * 后续合法帧不受影响。
 */
import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));

vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));

import { PI_RPC_OVERSIZED_FRAME_ERROR, PiRpcProcess } from './rpc-client.js';

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
    child: vi.fn(),
  };
  logger.child.mockReturnValue(logger);
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

function emitRaw(proc: PiRpcProcess, chunk: Buffer): void {
  (proc as unknown as { child: { stdout: EventEmitter } }).child.stdout.emit('data', chunk);
}

beforeEach(() => {
  mocks.spawn.mockReset();
});

describe('PiRpcProcess oversized JSONL frame (#4518)', () => {
  it('discards the oversized line and fails only pending get_entries', async () => {
    const { proc, onEvent } = createProcess();
    const pending = proc.request({ type: 'get_entries', session: 's1' });

    // 一行 >16MiB（不带换行先到一半，再补换行 + 一行合法事件帧）
    emitRaw(proc, Buffer.from('x'.repeat(16 * 1024 * 1024 + 64)));
    emitRaw(proc, Buffer.from('\n'));
    emitRaw(proc, Buffer.from(`${JSON.stringify({ type: 'agent_start' })}\n`));

    const resp = await pending;
    expect(resp.success).toBe(false);
    expect(resp.error).toBe(PI_RPC_OVERSIZED_FRAME_ERROR);
    // 丢弃的行不进事件流，合法帧照常
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent.mock.calls[0]![0]).toEqual({ type: 'agent_start' });
  });

  it('leaves non-get_entries pendings untouched when no victim matches', async () => {
    const { proc, logger } = createProcess();
    const steer = proc.request({ type: 'steer', text: 'hi' });

    emitRaw(proc, Buffer.from('y'.repeat(16 * 1024 * 1024 + 8) + '\n'));

    // 没有可确定归属的受害者：只记 warn，steer 不被误伤
    expect(
      logger.warn.mock.calls.some(([msg]) => String(msg).includes('oversized')),
    ).toBe(true);

    const settle = proc.request({ type: 'get_entries' });
    emitRaw(
      proc,
      Buffer.from(
        `${JSON.stringify({ type: 'response', id: 'c1', command: 'steer', success: true })}\n`,
      ),
    );
    const steerResp = await steer;
    expect(steerResp.success).toBe(true);
    // c1 已正常收口，settle（c2）仍挂起不受误伤（测试结束即弃）
    void settle;
  });

  it('still parses CRLF and multi-chunk lines under the limit', async () => {
    const { proc, onEvent } = createProcess();
    const frame = `${JSON.stringify({ type: 'agent_start' })}\r\n`;
    const half = Math.floor(frame.length / 2);
    emitRaw(proc, Buffer.from(frame.slice(0, half), 'utf8'));
    emitRaw(proc, Buffer.from(frame.slice(half), 'utf8'));
    expect(onEvent).toHaveBeenCalledWith({ type: 'agent_start' });
  });
});
