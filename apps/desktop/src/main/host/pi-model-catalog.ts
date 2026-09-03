/**
 * 已知模型补全表（对齐 pi 0.84.4 内置目录，2026-09-03 提取）。
 *
 * 背景：BYOM 自定义 provider 的模型定义若缺 reasoning/thinkingLevelMap，pi 对
 * zai（open.bigmodel.cn）等推理系端点不会注入 thinking 参数，智谱直接 1210。
 * buildPiNativeProviders 按 id 命中此表时，把缺失字段补全后再传给 pi；
 * 用户显式配置（视觉勾选 / 上下文窗口）始终优先。
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
    thinkingLevelMap: { off: 'none', low: null, medium: null, high: 'high', max: 'max' },
    input: ['text'],
    contextWindow: 1000000,
    maxTokens: 131072,
  },
  'glm-5.2-highspeed': {
    reasoning: true,
    thinkingLevelMap: { off: 'none', low: null, medium: null, high: 'high', max: 'max' },
    input: ['text'],
    contextWindow: 1000000,
    maxTokens: 131072,
  },
  'glm-5.3': {
    reasoning: true,
    thinkingLevelMap: { low: 'low', medium: null, high: 'high', max: 'max' },
    input: ['text'],
    contextWindow: 1000000,
    maxTokens: 131072,
  },
  'glm-5.3-flash': {
    name: 'GLM-5.3-Flash',
    reasoning: true,
    thinkingLevelMap: { low: 'low', medium: null, high: 'high', max: 'max' },
    input: ['text', 'image'],
    contextWindow: 1000000,
    maxTokens: 131072,
  },
  'glm-5.3-highspeed': {
    reasoning: true,
    thinkingLevelMap: { low: 'low', medium: null, high: 'high', max: 'max' },
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
