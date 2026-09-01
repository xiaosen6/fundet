/**
 * 真机隔离实验（不进 CI）：不经 Electron、不打 bundle，直接用 vitest 的
 * vite-node 跑 vendored runtime 的 start → focus → stop 全链。
 * RUN_BROWSER_START_E2E=1 时才执行；默认 skip。
 */
import { describe, expect, it } from 'vitest';
import { createBrowserControlRuntime } from '../index.js';

const RUN = process.env.RUN_BROWSER_START_E2E === '1';

describe.skipIf(!RUN)('browser runtime 真机 start', () => {
  it(
    'start → status → stop 全链返回',
    async () => {
      process.env.XDT_BROWSER_RUNTIME_DIR ??= 'C:/Users/16086/AppData/Roaming/LongMa/browser-runtime';
      const runtime = createBrowserControlRuntime({
        config: {
          browser: {
            enabled: true,
            defaultProfile: 'LongMa',
            headless: false,
            ssrfPolicy: { allowRfc2544BenchmarkRange: true, allowIpv6UniqueLocalRange: true },
            profiles: { LongMa: { driver: 'openclaw', color: '#2563EB', cdpPort: 18800 } },
          },
        } as never,
        logSink: (level: string, scope: string, args: unknown[]) => {
          console.log('[rt]', level, scope, args.map(String).join(' ').slice(0, 160));
        },
      });
      const t0 = Date.now();
      const start = await runtime.call({ action: 'start' });
      console.log('start 耗时', Date.now() - t0, 'ms，ok =', start.ok);
      expect(start.ok).toBe(true);
      const status = await runtime.call({ action: 'status' });
      console.log('status ok =', status.ok);
      const stop = await runtime.call({ action: 'stop' });
      console.log('stop ok =', stop.ok);
    },
    180_000,
  );
});
