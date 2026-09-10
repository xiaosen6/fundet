import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));

vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));

import { PiRpcProcess } from './rpc-client.js';

interface FakeChild extends EventEmitter {
  pid: number;
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: { write: ReturnType<typeof vi.fn> };
  kill: ReturnType<typeof vi.fn>;
}

function makeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.pid = 4321;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write: vi.fn() };
  child.kill = vi.fn();
  return child;
}

function createProcess() {
  const logger = {
    trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn(), child: vi.fn(),
  };
  logger.child.mockReturnValue(logger);
  const onExit = vi.fn();
  mocks.spawn.mockReturnValue(makeChild());
  const proc = new PiRpcProcess({
    binaryPath: '/pi',
    args: ['--mode', 'rpc'],
    cwd: '/work',
    env: {},
    logger,
    onEvent: vi.fn(),
    onExit,
  });
  const child = mocks.spawn.mock.results[0]!.value as FakeChild;
  return { proc, child, onExit, logger };
}

function emitStdout(proc: PiRpcProcess, frame: Record<string, unknown>): void {
  (proc as unknown as { child: FakeChild }).child.stdout.emit(
    'data',
    Buffer.from(`${JSON.stringify(frame)}\n`),
  );
}

beforeEach(() => {
  mocks.spawn.mockReset();
});

describe('PiRpcProcess exit-driven lifecycle (#4182)', () => {
  it('notifies exit after drain even when close never fires (descendant holds the pipes)', async () => {
    const { proc, child, onExit } = createProcess();
    child.emit('exit', 0, null);
    // close 事件被后代管道拖住,不发射;250ms 排水后仍要收口
    await vi.waitFor(() => expect(onExit).toHaveBeenCalledTimes(1), { timeout: 2_000 });
    expect(onExit).toHaveBeenCalledWith({ code: 0, signal: null });
    // close 迟到不再重复上报
    child.emit('close', 0, null);
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(proc.isClosed).toBe(true);
  });

  it('still resolves in-flight RPC responses that land inside the drain window', async () => {
    const { proc, child } = createProcess();
    const pending = proc.request({ type: 'ping' });
    const id = (child.stdin.write.mock.calls[0]![0] as string);
    const requestId = (JSON.parse(id) as { id: string }).id;
    child.emit('exit', 0, null);
    // 尾帧在排水窗内到达:必须正常结算,不能被 exit 抢先 fail 掉
    emitStdout(proc, { type: 'response', id: requestId, command: 'ping', success: true, data: {} });
    await expect(pending).resolves.toMatchObject({ success: true });
    await vi.waitFor(() => expect(proc.isClosed).toBe(true), { timeout: 2_000 });
  });

  it('close() resolves via exit confirmation even without a close event', async () => {
    const { proc, child, onExit } = createProcess();
    // SIGTERM 生效:pi 退出但后代仍握管道 → close 事件永远不来
    child.kill.mockImplementation(() => {
      setImmediate(() => child.emit('exit', 0, 'SIGTERM'));
    });
    await proc.close();
    expect(onExit).toHaveBeenCalledTimes(1);
    await expect(proc.close()).resolves.toBeUndefined();
  });

  it('destroys own pipe endpoints when finishing', async () => {
    const { proc, child } = createProcess();
    const stdoutDestroy = vi.fn();
    const stderrDestroy = vi.fn();
    const stdinDestroy = vi.fn();
    (child.stdout as unknown as { destroy: unknown }).destroy = stdoutDestroy;
    (child.stderr as unknown as { destroy: unknown }).destroy = stderrDestroy;
    (child.stdin as unknown as { destroy: unknown }).destroy = stdinDestroy;
    child.emit('close', 1, 'SIGKILL');
    await vi.waitFor(() => expect(onExitAny(proc)).toBe(true), { timeout: 2_000 });
    expect(stdoutDestroy).toHaveBeenCalled();
    expect(stderrDestroy).toHaveBeenCalled();
    expect(stdinDestroy).toHaveBeenCalled();
  });
});

function onExitAny(_proc: PiRpcProcess): boolean {
  return (_proc as unknown as { exitNotified: boolean }).exitNotified;
}
