/**
 * #5173 同构防线：pi spawn 必须带 windowsHide——pi.exe 是控制台子系统二进制，
 * Windows 上不隐藏会为每个会话派生一个 conhost.exe。
 * 用 mock spawn 构造 PiRpcProcess，只断言 spawn 选项（不真起进程）。
 */
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';

const spawnMock = vi.fn();

vi.mock('node:child_process', () => ({ spawn: (...args: unknown[]) => spawnMock(...args) }));

import { PiRpcProcess } from '../rpc-client.js';

const logger = {
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  child: () => logger,
};

function fakeChild(): unknown {
  const child = new EventEmitter() as unknown as Record<string, unknown>;
  child['pid'] = 4321;
  child['stdin'] = new Writable();
  child['stdout'] = new Readable({ read() {} });
  child['stderr'] = new Readable({ read() {} });
  child['kill'] = () => true;
  return child;
}

describe('PiRpcProcess spawn 选项', () => {
  it('spawn 带 windowsHide（Windows 每会话不派生 conhost.exe）', () => {
    spawnMock.mockReturnValue(fakeChild());
    new PiRpcProcess({
      binaryPath: 'pi',
      args: ['--mode', 'rpc'],
      cwd: '.',
      env: {},
      logger,
      onEvent: () => {},
      onExit: () => {},
    });
    const options = spawnMock.mock.calls[0]?.[2] as Record<string, unknown> | undefined;
    expect(options).toMatchObject({ windowsHide: true });
  });
});
