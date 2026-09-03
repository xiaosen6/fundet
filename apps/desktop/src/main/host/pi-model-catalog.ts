/**
 * 已知模型补全表（对齐 pi 0.84.4 内置目录 + Cindy 上游 2026-09-02 目录同步）。
 *
 * 背景：BYOM 自定义 provider 的模型定义若缺 reasoning/thinkingLevelMap，pi 对
 * zai（open.bigmodel.cn）等推理系端点不会注入 thinking 参数，智谱直接 1210。
 * buildPiNativeProviders 按 id 命中此表时，把缺失字段补全后再传给 pi；
 * 用户显式配置（视觉勾选 / 上下文窗口）始终优先。
 *
 * thinkingLevelMap 里显式 null = 该思考档不支持（UI 灰掉，不发坏参数）；
 * 缺键 = pi 按默认 remap 处理。5.x 系模型不可关思考（off:null），
 * highspeed 系不计费（cost 0）但档位与对应主模型一致。
 *
 * 字段与 pi 0.84.4 内置目录一致，升级 pi 后可用 `pi --list-models` / 二进制
 * 检索校对（`apps/pi-bin/win32-x64/pi.exe`）。
 */

export interface KnownModelInfo {
  name?: string;
  reasoning?: boolean;
  thinkingLevelMap?: Partial<Record<string, string | null>>;
  input?: Array<'text' | 'image'>;
  contextWindow?: number;
  maxTokens?: number;
}

export const KNOWN_MODEL_CATALOG: Record<string, KnownModelInfo> = {
  // ── 智谱 GLM Coding Plan / 标准端点（zai-coding-cn，open.bigmodel.cn）──
  'glm-4.6v': {
    reasoning: true,
    input: ['text', 'image'],
    contextWindow: 128000,
    maxTokens: 32768,
  },
  'glm-4.7': {
    reasoning: true,
    input: ['text'],
    contextWindow: 204800,
    maxTokens: 131072,
  },
  'glm-5-turbo': {
    reasoning: true,
    input: ['text'],
    contextWindow: 200000,
    maxTokens: 131072,
  },
  'glm-5.1': {
    reasoning: true,
    input: ['text'],
    contextWindow: 200000,
    maxTokens: 131072,
  },
  'glm-5.2': {
    reasoning: true,
    thinkingLevelMap: { off: 'none', minimal: null, low: null, medium: null, high: 'high', xhigh: null, max: 'max' },
    input: ['text'],
    contextWindow: 1000000,
    maxTokens: 131072,
  },
  'glm-5.2-highspeed': {
    reasoning: true,
    thinkingLevelMap: { off: 'none', minimal: null, low: null, medium: null, high: 'high', xhigh: null, max: 'max' },
    input: ['text'],
    contextWindow: 1000000,
    maxTokens: 131072,
  },
  'glm-5.3': {
    reasoning: true,
    thinkingLevelMap: { off: null, minimal: null, low: 'low', medium: null, high: 'high', xhigh: null, max: 'max' },
    input: ['text'],
    contextWindow: 1000000,
    maxTokens: 131072,
  },
  'glm-5.3-flash': {
    name: 'GLM-5.3-Flash',
    reasoning: true,
    thinkingLevelMap: { off: null, minimal: null, low: 'low', medium: null, high: 'high', xhigh: null, max: 'max' },
    input: ['text', 'image'],
    contextWindow: 1000000,
    maxTokens: 131072,
  },
  'glm-5.3-highspeed': {
    reasoning: true,
    thinkingLevelMap: { off: null, minimal: null, low: 'low', medium: null, high: 'high', xhigh: null, max: 'max' },
    input: ['text'],
    contextWindow: 1000000,
    maxTokens: 131072,
  },
  'glm-5v-turbo': {
    reasoning: true,
    input: ['text', 'image'],
    contextWindow: 200000,
    maxTokens: 131072,
  },
};

/** 按 id 查已知模型补全；未命中返回空对象。 */
export function lookupKnownModel(id: string): KnownModelInfo {
  return KNOWN_MODEL_CATALOG[id] ?? {};
}
