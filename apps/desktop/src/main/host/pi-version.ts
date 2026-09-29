/**
 * pi 内核版本信息（只读检测，不做应用内更新——供应链/验证纪律的取舍见
 * memory §6 2026-09-29 评估）：本机随包版本 + 上游最新版。
 * 上游探测走 releases/latest 的 302 Location（不下载），gh-proxy 前置、
 * 直连回落，24h 内存缓存，任何失败静默返回 null（UI 只隐藏上游段）。
 */
import { execFileSync } from 'node:child_process';
import { resolvePiBinaryPath } from './pi-binary.js';

const UPSTREAM_LATEST = 'https://github.com/earendil-works/pi/releases/latest';
const CHECK_TTL_MS = 24 * 60 * 60 * 1000;

let bundledCache: string | null = null;
let upstreamCache: { version: string; at: number } | null = null;

export function getBundledPiVersion(): string {
  if (bundledCache) return bundledCache;
  try {
    bundledCache = execFileSync(resolvePiBinaryPath(), ['--version'], {
      timeout: 10_000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    bundledCache = '未知';
  }
  return bundledCache;
}

/** HEAD releases/latest 读 302 的 Location（…/tag/vX.Y.Z），不跟随不下载 */
async function fetchTagVia(url: string): Promise<string | null> {
  const res = await fetch(url, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(8_000) });
  const loc = res.headers.get('location') ?? '';
  const m = /\/tag\/(v[\d.]+)\/?$/.exec(loc);
  return m ? (m[1] as string) : null;
}

export async function fetchUpstreamPiVersion(): Promise<string | null> {
  if (upstreamCache && Date.now() - upstreamCache.at < CHECK_TTL_MS) return upstreamCache.version;
  const version =
    (await fetchTagVia(`https://gh-proxy.com/${UPSTREAM_LATEST}`).catch(() => null)) ??
    (await fetchTagVia(UPSTREAM_LATEST).catch(() => null));
  if (version) upstreamCache = { version, at: Date.now() };
  return version;
}

export async function getPiVersionInfo(): Promise<{ bundled: string; upstream: string | null }> {
  return { bundled: getBundledPiVersion(), upstream: await fetchUpstreamPiVersion() };
}
