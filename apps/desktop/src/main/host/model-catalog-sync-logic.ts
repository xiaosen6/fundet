/**
 * 供应商目录 → 热同步门控的纯逻辑（node --test 直测，不引 electron/db）。
 *
 * 供应商保存/扫描/删除后是否需要刷新活会话的 models.json，靠对比变化前后整表
 * 指纹判定：只取会影响 pi 侧目录与路由的字段（baseUrl/api/key env 变量名/启用
 * 模型及其能力补全），展示序无关 —— 重排序不触发无谓的热同步。
 */

/** 与 db/providers.ts 的 ProviderView/ProviderModelSpec 结构兼容的最小面 */
export interface ProviderCatalogModelEntry {
  id: string;
  enabled?: boolean;
  reasoning?: boolean;
  thinkingLevelMap?: Record<string, string | null>;
  contextWindow?: number;
  maxTokens?: number;
  input?: ReadonlyArray<string>;
  compat?: unknown;
}

export interface ProviderCatalogEntry {
  id: string;
  name: string;
  api: string;
  baseUrl: string;
  /** api key 的 env 变量名：已配置 key 的 provider 才有（keyless 省略） */
  keyEnvVar?: string;
  models: ReadonlyArray<ProviderCatalogModelEntry>;
}

/** thinkingLevelMap 键序归一，否则同内容不同插入序会判成“有变化”。 */
function normalizeThinkingLevelMap(map: Record<string, string | null>): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const key of Object.keys(map).sort()) out[key] = map[key];
  return out;
}

function normalizeModel(model: ProviderCatalogModelEntry): unknown {
  return {
    id: model.id,
    ...(model.reasoning !== undefined ? { reasoning: model.reasoning } : {}),
    ...(model.thinkingLevelMap !== undefined
      ? { thinkingLevelMap: normalizeThinkingLevelMap(model.thinkingLevelMap) }
      : {}),
    ...(model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : {}),
    ...(model.maxTokens !== undefined ? { maxTokens: model.maxTokens } : {}),
    ...(model.input ? { input: [...model.input] } : {}),
    ...(model.compat !== undefined ? { compat: model.compat } : {}),
  };
}

function normalizeProvider(provider: ProviderCatalogEntry): unknown {
  return {
    id: provider.id,
    name: provider.name,
    api: provider.api,
    baseUrl: provider.baseUrl,
    ...(provider.keyEnvVar ? { keyEnvVar: provider.keyEnvVar } : {}),
    // buildPiNativeProviders 只写 enabled !== false 的模型
    models: provider.models
      .filter((m) => m.enabled !== false)
      .map(normalizeModel)
      .sort((a, b) => String((a as { id: string }).id).localeCompare((b as { id: string }).id)),
  };
}

/** 整表目录指纹（稳定 JSON）；同名/同序无关。 */
export function providerCatalogFingerprint(providers: ReadonlyArray<ProviderCatalogEntry>): string {
  return JSON.stringify(
    [...providers].map(normalizeProvider).sort((a, b) =>
      String((a as { id: string }).id).localeCompare(String((b as { id: string }).id)),
    ),
  );
}

/** 变化前后指纹对比：true = 需要热同步活会话。 */
export function providerCatalogChanged(
  before: ReadonlyArray<ProviderCatalogEntry>,
  after: ReadonlyArray<ProviderCatalogEntry>,
): boolean {
  return providerCatalogFingerprint(before) !== providerCatalogFingerprint(after);
}
