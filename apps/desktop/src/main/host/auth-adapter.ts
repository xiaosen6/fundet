/**
 * BYOK AuthAdapter：Fundet 无账号体系，凭证 = 用户在设置页为 provider 配置的 API key。
 *
 * 与 Cindy DesktopPiAuthAdapter 的差异：
 * - 没有网关/OAuth 分支（Cindy 的 getAuthEnv 要兼容订阅 OAuth 占位符与 compat proxy，
 *   这里只有自定义 provider 一条路）；gateway 用的 CINDY_PI_API_KEY 固定给占位符。
 * - keyless 判定方式不同：Cindy 靠配置侧 auth.method==='none'（写入时强制 loopback），
 *   这里按 baseUrl 是否 loopback（localhost/127.0.0.1/[::1]）在读取时推导。
 * - 实现了 getOneShotAuth（Cindy 未实现）：取第一个可用 provider 的 key+baseUrl。
 */
import type { AuthAdapter, AuthAdapterOptions, AuthState } from '@fundet/agent-core';
import { getProvider, listProviders } from '../db/providers.js';
import { readProviderKey, hasProviderKey } from './secrets.js';

/** 网关 provider 占位 key：Fundet 没有网关，models.json 里 $CINDY_PI_API_KEY 仍需有值 */
const GATEWAY_PLACEHOLDER_KEY = 'fundet-no-gateway-key';
/** keyless（本机端点）dummy key：pi 要求 provider 有 key 才在 /model 显示 */
export const KEYLESS_DUMMY_KEY = 'pi-native-keyless';

/** env 变量名：CINDY_PI_KEY_<ID>，ID 规整成 [A-Z0-9_]（对齐 Cindy piNativeKeyEnvVar） */
export function piNativeKeyEnvVar(providerId: string): string {
  return `CINDY_PI_KEY_${providerId.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
}

/** baseUrl 是否指向本机回环（keyless 判定） */
export function isLoopbackBaseUrl(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
  } catch {
    return false;
  }
}

export function createByokAuthAdapter(): AuthAdapter {
  return {
    async getState(options?: AuthAdapterOptions): Promise<AuthState> {
      const providerId = options?.providerId;
      if (!providerId) {
        // 无全局登录态概念：BYOK 下永远"可用"，具体 provider 的校验在带 providerId 时做
        return { authenticated: true, authSource: 'api-key' };
      }
      const provider = getProvider(providerId);
      if (!provider) {
        return { authenticated: false, errorReason: `provider 不存在: ${providerId}` };
      }
      if (isLoopbackBaseUrl(provider.baseUrl)) {
        return { authenticated: true, authSource: 'api-key' };
      }
      if (hasProviderKey(providerId)) {
        return { authenticated: true, authSource: 'api-key' };
      }
      return {
        authenticated: false,
        errorReason: `provider "${provider.name}" 未配置 API key，请到设置页填写`,
      };
    },

    async triggerLogin(): Promise<AuthState> {
      throw new Error('BYOK 模式没有登录流程，请在设置页为 provider 配置 API key');
    },

    async logout(): Promise<void> {
      // 凭证生命周期归设置页管理（providers:set-key / 删除 provider），logout 无操作
    },

    async getAuthEnv(options?: AuthAdapterOptions): Promise<Record<string, string>> {
      const env: Record<string, string> = { CINDY_PI_API_KEY: GATEWAY_PLACEHOLDER_KEY };
      const providerId = options?.providerId;
      if (providerId) {
        const provider = getProvider(providerId);
        if (provider) {
          const envVar = piNativeKeyEnvVar(providerId);
          if (isLoopbackBaseUrl(provider.baseUrl)) {
            env[envVar] = KEYLESS_DUMMY_KEY;
          } else {
            const key = readProviderKey(providerId);
            if (key) env[envVar] = key;
          }
        }
      }
      return env;
    },

    async getOneShotAuth(): Promise<{ apiKey: string; baseURL?: string } | null> {
      // oneShot（起标题等）没有 providerId 上下文：取第一个有 key 的 provider，
      // 都没有则退到第一个 keyless provider，再不行返回 null（调用方跳过）。
      const all = listProviders();
      for (const p of all) {
        const key = readProviderKey(p.id);
        if (key) return { apiKey: key, baseURL: p.baseUrl };
      }
      const keyless = all.find((p) => isLoopbackBaseUrl(p.baseUrl));
      if (keyless) return { apiKey: KEYLESS_DUMMY_KEY, baseURL: keyless.baseUrl };
      return null;
    },
  };
}
