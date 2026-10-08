/**
 * pi 模型目录热刷新的主机侧纯逻辑：reload 命令 payload 编码 + RPC 目录快照校验。
 * 与 cindy-bridge 内的对应实现保持同构（扩展自包含、不能反向 import 本模块）。
 */

/** cindy-bridge 扩展注册的热刷新命令名（host 经 RPC prompt 触发）。 */
export const PI_RELOAD_MODELS_COMMAND = 'cindy-reload-models';

/** 扩展侧 env 注入接受的名字面（与 piNativeKeyEnvVar 生成的 CINDY_PI_KEY_<ID> 对齐）。 */
const RELOAD_ENV_NAME_RE = /^CINDY_PI_KEY_[A-Z0-9_]{1,64}$/;
const RELOAD_ENV_VALUE_MAX = 4096;

/** 主机 → 扩展的 reload payload（percent-encoded JSON，同 cindy-branch-switch 手法）。 */
export function encodeReloadModelsPayload(env: Record<string, string>): string {
  return encodeURIComponent(JSON.stringify({ env }));
}

/**
 * 扩展侧 reload payload 解析（与 bridge 内实现同构）：
 * 只接受白名单名字与合法长度的字符串值，其余静默丢弃。
 */
export function parseReloadModelsPayload(args: string | undefined): Record<string, string> {
  let payload: { env?: unknown };
  try {
    payload = JSON.parse(decodeURIComponent((args ?? '').trim())) as { env?: unknown };
  } catch {
    return {};
  }
  const env =
    payload && typeof payload.env === 'object' && payload.env !== null
      ? (payload.env as Record<string, unknown>)
      : {};
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (!RELOAD_ENV_NAME_RE.test(name)) continue;
    if (typeof value !== 'string' || value.length === 0 || value.length > RELOAD_ENV_VALUE_MAX) continue;
    out[name] = value;
  }
  return out;
}

/**
 * 从 get_available_models 的 data 里取可用模型键集合（provider + NUL + modelId，
 * 同 pi 内部键法）。形状不符（旧版 pi / 异常响应）返回空集合 —— 调用方按“未确认”处理。
 */
export function availablePiModelKeys(data: unknown): Set<string> {
  const models =
    data && typeof data === 'object' && Array.isArray((data as { models?: unknown }).models)
      ? ((data as { models: unknown[] }).models)
      : [];
  const keys = new Set<string>();
  for (const model of models) {
    if (!model || typeof model !== 'object') continue;
    const provider = (model as { provider?: unknown }).provider;
    const id = (model as { id?: unknown }).id;
    if (typeof provider !== 'string' || typeof id !== 'string') continue;
    keys.add(provider + '\u0000' + id);
  }
  return keys;
}

/** 目标 (provider, modelId) 是否已进入 pi 进程的可用目录。 */
export function piCatalogOffers(keys: ReadonlySet<string>, provider: string, modelId: string): boolean {
  return keys.has(provider + '\u0000' + modelId);
}
