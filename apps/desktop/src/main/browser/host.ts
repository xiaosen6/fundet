/**
 * 浏览器自动化 host：进程级唯一的 vendored runtime 单例 + 托管 Chrome 配置。
 *
 * 设计对齐 Cindy browser.ts 的主链，砍掉 webview 后端 / 双后端 controller /
 * 品牌翻转自愈（本应用只有外置 Chrome 一条路）。要点：
 * - 托管 profile「Fundet」持久 user-data-dir（登录态跨会话），默认有头让用户能登录；
 * - runtime 惰性创建（未开开关就零成本）；
 * - quit 清理带 usage 跟踪：从未用过的 runtime 发 stop 反而会拉起浏览器控制服务
 *   （退出挂死放大器），必须跳过；quiesce 门先挡新调用再等在途结算。
 */
import './runtime-env.js';
import type { Logger } from '@fundet/agent-core';
import type {
  BrowserControlRequest,
  BrowserControlResult,
  BrowserControlRuntime,
  BrowserRuntimeConfig,
} from '@fundet/browser-runtime';
import { managedRuntimeNeedsStop } from './real-profile.js';

/** 托管 profile 名：Chrome 右上角显示名 = user-data-dir 目录名。钉死勿改（改了丢登录态）。 */
export const MANAGED_PROFILE = 'Fundet';
/** 高饱和品牌蓝：Chrome 拿它当 Material You 种子合成主题色，中性色会被和成浑浊灰蓝 */
const MANAGED_PROFILE_COLOR = '#2563EB';
/** vendored「launch-and-own」driver 枚举值（runtime 用它区分自启 vs 接管已有浏览器） */
const MANAGED_DRIVER = 'openclaw' as const;
/** 自定义 profile 名必须显式给 cdpPort，18800 是 vendored 默认 CDP 端口段起点 */
const MANAGED_CDP_PORT = 18800;

export function buildManagedConfig(): BrowserRuntimeConfig {
  return {
    browser: {
      enabled: true,
      defaultProfile: MANAGED_PROFILE,
      headless: false, // 有头：用户看得到、能登录
      // 只豁免系统代理 fake-IP 两段（Surge/Clash/sing-box 的 DNS 答案），
      // localhost/RFC1918/云 metadata 仍全拦
      ssrfPolicy: {
        allowRfc2544BenchmarkRange: true,
        allowIpv6UniqueLocalRange: true,
      },
      profiles: {
        [MANAGED_PROFILE]: {
          driver: MANAGED_DRIVER,
          color: MANAGED_PROFILE_COLOR,
          cdpPort: MANAGED_CDP_PORT,
        },
      },
    },
  };
}

export interface UsageTrackedRuntime extends BrowserControlRuntime {
  everCalled(): boolean;
  /** 退出清算开始：拒绝新调用，返回的 promise 在在途调用归零时结算 */
  beginQuiescence(): Promise<void>;
  /** stop 后恢复可用（quit 清理不会调；登录态拷贝等场景 stop 后还要继续用） */
  resumeAfterStop(): void;
}

function trackUsage(runtime: BrowserControlRuntime): UsageTrackedRuntime {
  let used = false;
  let quiescing = false;
  let inFlight = 0;
  let onIdle: (() => void) | null = null;

  return {
    async call(request: BrowserControlRequest): Promise<BrowserControlResult> {
      if (quiescing) throw new Error('browser runtime is quiescing for quit');
      used = true;
      inFlight += 1;
      try {
        return await runtime.call(request);
      } finally {
        inFlight -= 1;
        if (quiescing && inFlight === 0 && onIdle) {
          const resolve = onIdle;
          onIdle = null;
          resolve();
        }
      }
    },
    everCalled(): boolean {
      return used;
    },
    beginQuiescence(): Promise<void> {
      quiescing = true;
      if (inFlight === 0) return Promise.resolve();
      return new Promise((resolve) => {
        onIdle = resolve;
      });
    },
    resumeAfterStop(): void {
      quiescing = false;
      used = false;
    },
  };
}

let hostPromise: Promise<UsageTrackedRuntime | null> | null = null;

/**
 * 生命周期串行队列：浏览动作与登录态拷贝/清除互斥。拷贝/清除进行中托管
 * 浏览器被拉起会锁住 user-data、留下半份发布状态。失败的操作不得毒化后续
 * 队列——尾链恒结算成功，每个调用方仍拿到自己的结果。
 */
function createBrowserLifecycleQueue(): {
  run<T>(operation: () => Promise<T>): Promise<T>;
} {
  let tail: Promise<void> = Promise.resolve();
  return {
    run<T>(operation: () => Promise<T>): Promise<T> {
      const result = tail.then(operation);
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
}

const browserLifecycleQueue = createBrowserLifecycleQueue();

/** 登录态拷贝/清除、打开托管浏览器等 profile 级操作用它排队，与浏览动作互斥。 */
export function runExclusiveBrowserOp<T>(operation: () => Promise<T>): Promise<T> {
  return browserLifecycleQueue.run(operation);
}

async function createHost(logger: Logger): Promise<UsageTrackedRuntime | null> {
  const { createBrowserControlRuntime } = await import('@fundet/browser-runtime');
  const runtime = createBrowserControlRuntime({
    config: buildManagedConfig(),
    logSink: (level: string, scope: string, args: unknown[]) => {
      const msg = `[browser:${scope}]`;
      const ctx = { args: args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))) };
      if (level === 'error' || level === 'fatal') logger.error(msg, ctx);
      else if (level === 'warn') logger.warn(msg, ctx);
      else logger.debug(msg, ctx);
    },
  });
  return trackUsage(runtime);
}

/** 惰性取进程级单例（失败不缓存，下次重试）。装配失败返回 null。 */
export function ensureBrowserRuntime(logger: Logger): Promise<UsageTrackedRuntime | null> {
  if (!hostPromise) {
    hostPromise = createHost(logger).catch((err) => {
      hostPromise = null;
      logger.error('browser runtime 装配失败', { error: String(err) });
      return null;
    });
  }
  return hostPromise;
}

/** app 退出前调用：用过才 stop（stop 本身会拉起服务，没用过必须跳过） */
export async function disposeBrowserHost(): Promise<void> {
  const promise = hostPromise;
  hostPromise = null;
  if (!promise) return;
  const runtime = await promise.catch(() => null);
  if (!runtime) return;
  await runtime.beginQuiescence();
  if (!runtime.everCalled()) return;
  try {
    await runtime.call({ action: 'stop' });
  } catch (err) {
    console.warn('[fundet:browser] quit-time stop 失败（Chrome 靠 CDP 断连自退）', String(err));
  }
}

/**
 * 停掉托管浏览器但保持 runtime 可用（登录态拷贝前必须停——Chrome 锁自己
 * 的 user-data）。停后验证 status：running 与 pid 都归零才算停干净，确认不了
 * 就抛错让用户重试——带病拷贝会在浏览器还握着库时发布半份登录状态。
 * 调用方须已在 runExclusiveBrowserOp 队列内（与浏览动作互斥），内部直调
 * usage-tracked runtime，不再入队（入队会等自己）。
 */
export async function stopManagedRuntime(): Promise<void> {
  const promise = hostPromise;
  if (!promise) return;
  const runtime = await promise.catch(() => null);
  if (!runtime) return;
  // 没用过的 runtime 发 status/stop 反而会拉起浏览器控制服务，必须跳过
  if (!runtime.everCalled()) return;
  const status = await runtime.call({ action: 'status', profile: MANAGED_PROFILE }).catch(() => null);
  const needsStop = status?.ok ? managedRuntimeNeedsStop(status.data) : null;
  const stop = needsStop
    ? await runtime.call({ action: 'stop', profile: MANAGED_PROFILE }).catch(() => null)
    : null;
  if (!status?.ok || needsStop === null) {
    throw new Error('无法确认托管浏览器已停止，请稍后重试。');
  }
  if (!needsStop) return;
  const stopped =
    stop?.ok === true && (stop.data as { stopped?: unknown } | null)?.['stopped'] === true;
  if (!stopped) {
    throw new Error('托管浏览器未能停止，请关闭它打开的窗口后重试。');
  }
}

/** 浏览器 MCP server 的 mount 入口用：拿已就绪的 runtime 构造门面 deps（同步 getter） */
export async function getBrowserFacadeDeps(logger: Logger): Promise<{
  getRuntime(): BrowserControlRuntime;
  logger: { info(msg: string): void; warn(msg: string): void; error(msg: string): void };
} | null> {
  const runtime = await ensureBrowserRuntime(logger);
  if (!runtime) return null;
  return {
    // MCP 门面的浏览调用走生命周期队列，与登录态拷贝/清除互斥
    getRuntime: (): BrowserControlRuntime => ({
      call: (request) => browserLifecycleQueue.run(() => runtime.call(request)),
    }),
    logger: {
      info: (msg: string) => logger.info(msg),
      warn: (msg: string) => logger.warn(msg),
      error: (msg: string) => logger.error(msg),
    },
  };
}
