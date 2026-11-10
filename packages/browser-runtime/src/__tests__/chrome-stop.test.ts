import { describe, expect, it, vi, afterEach } from 'vitest';
import { stopOpenClawChrome, type RunningChrome } from '../_generated/extension/src/browser/chrome.js';

function fakeRunning(overrides: Record<string, unknown> = {}) {
  const proc = {
    killed: false,
    exitCode: null as number | null,
    signalCode: null as string | null,
    kill: vi.fn(),
  };
  return {
    proc,
    cdpPort: 18800,
    releaseCdpProxyBypass: vi.fn(),
    ...overrides,
  } as unknown as RunningChrome;
}

afterEach(() => vi.restoreAllMocks());

describe('stopOpenClawChrome', () => {
  it('already exited: no signal, proxy release exactly once', async () => {
    const running = fakeRunning({ proc: { killed: false, exitCode: 0, signalCode: null, kill: vi.fn() } });
    const release = running.releaseCdpProxyBypass!;
    await stopOpenClawChrome(running, 20);
    expect(running.proc.kill).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
    await stopOpenClawChrome(running, 20);
    expect(release).toHaveBeenCalledOnce();
  });

  it('killed=true 但尚无真实退出：不能提前返回，超时才 SIGKILL', async () => {
    const proc = { killed: true, exitCode: null, signalCode: null, kill: vi.fn() };
    const running = fakeRunning({ proc });
    await stopOpenClawChrome(running, 20);
    expect(proc.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('Windows 先走 CDP Browser.close；正常退出后不再发 SIGTERM/SIGKILL', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    const running = fakeRunning();
    const closeViaCdp = vi.fn(async () => {
      (running.proc as unknown as { exitCode: number }).exitCode = 0;
    });
    await stopOpenClawChrome(running, 50, { closeViaCdp });
    expect(closeViaCdp).toHaveBeenCalledOnce();
    expect(running.proc.kill).not.toHaveBeenCalled();
  });
});
