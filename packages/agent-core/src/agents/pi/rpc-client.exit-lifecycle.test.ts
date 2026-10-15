import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));

vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));

import { PiRpcProcess, type PiRpcDisconnectReason } from './rpc-client.js';

interface FakeChild extends EventEmitter {
  pid: number;
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: EventEmitter & { write: ReturnType<typeof vi.fn> };
  kill: ReturnType<typeof vi.fn>;
}

function makeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.pid = 4321;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = Object.assign(new EventEmitter(), { write: vi.fn() });
  child.kill = vi.fn();
  return child;
}

function createProcess(onDisconnect?: (reason: PiRpcDisconnectReason) => void) {
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
    ...(onDisconnect ? { onDisconnect } : {}),
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

describe('PiRpcProcess disconnect detection (#5729)', () => {
  it('stdout end + 无 exit → 确认窗后失联收口：pending 失败 + onDisconnect + isClosed', async () => {
    const onDisconnect = vi.fn();
    const { proc, child, onExit } = createProcess(onDisconnect);
    const pending = proc.request({ type: 'ping' });
    const assertion = expect(pending).rejects.toThrow(/disconnected.*stdout-ended/);
    child.stdout.emit('end');
    await vi.waitFor(() => expect(onDisconnect).toHaveBeenCalledWith('stdout-ended'), { timeout: 2_000 });
    await assertion;
    expect(proc.isClosed).toBe(true);
    expect(onExit).not.toHaveBeenCalled(); // exit 路径留给后续真退出
  });

  it('确认窗内 exit 到达 → 走 exit 语义，onDisconnect 不触发', async () => {
    const onDisconnect = vi.fn();
    const { proc, child, onExit } = createProcess(onDisconnect);
    child.stdout.emit('end');
    // 正常退出顺序：stdout 先关，exit 随即到达（窗内）
    child.emit('exit', 0, null);
    await vi.waitFor(() => expect(onExit).toHaveBeenCalledTimes(1), { timeout: 2_000 });
    expect(onDisconnect).not.toHaveBeenCalled();
    expect(onExit).toHaveBeenCalledWith({ code: 0, signal: null });
  });

  it('stdin error（EPIPE）→ 失联收口且不炸主进程', async () => {
    const onDisconnect = vi.fn();
    const { proc, child } = createProcess(onDisconnect);
    child.stdin.emit('error', new Error('write EPIPE'));
    await vi.waitFor(() => expect(onDisconnect).toHaveBeenCalledWith('stdin-error'), { timeout: 2_000 });
    expect(proc.isClosed).toBe(true);
  });

  it('失联后 request/send 按已关闭处理', async () => {
    const { proc, child } = createProcess(vi.fn());
    child.stdout.emit('close');
    await vi.waitFor(() => expect(proc.isClosed).toBe(true), { timeout: 2_000 });
    await expect(proc.request({ type: 'ping' })).rejects.toThrow(/disconnected/);
    expect(() => proc.send({ type: 'x' })).not.toThrow();
  });
});
