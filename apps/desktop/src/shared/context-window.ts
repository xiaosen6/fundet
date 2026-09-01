/**
 * 模型上下文窗口：从列模型接口提取，接口没有时再按模型 id 推断。
 * 不写死 128k 给未知模型（Pi 未知时也会报 128k，展示层不要信它）。
 */

const NEST_KEYS = ['info', 'meta', 'spec', 'limits', 'capabilities', 'parameters', 'model_spec'] as const;

const DECLARED_KEYS = [
  'context_length',
  'context_window',
  'max_context_length',
  'max_input_tokens',
  'max_model_len',
  'max_position_embeddings',
  'max_input_length',
] as const;

export function asPositiveInt(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v) && Math.floor(v) > 0 && Number.isSafeInteger(Math.floor(v))) {
    return Math.floor(v);
  }
  if (typeof v !== 'string') return undefined;
  const t = v.trim().toLowerCase();
  if (!t) return undefined;
  const km = t.match(/^(\d+(?:\.\d+)?)(k|m)$/);
  if (km) {
    const n = Number(km[1]);
    if (!Number.isFinite(n) || n <= 0) return undefined;
    const scaled = Math.floor(n * (km[2] === 'm' ? 1_000_000 : 1_000));
    return Number.isSafeInteger(scaled) && scaled > 0 ? scaled : undefined;
  }
  if (/^\d+$/.test(t)) {
    const n = Number(t);
    if (Number.isSafeInteger(n) && n > 0) return n;
  }
  return undefined;
}

/** 从列模型条目上尽力抠 contextWindow（含一层嵌套）。 */
export function extractDeclaredContextWindow(rec: Record<string, unknown> | null | undefined): number | undefined {
  if (!rec) return undefined;
  for (const k of DECLARED_KEYS) {
    const n = asPositiveInt(rec[k]);
    if (n) return n;
  }
  for (const nest of NEST_KEYS) {
    const child = rec[nest];
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      const n = extractDeclaredContextWindow(child as Record<string, unknown>);
      if (n) return n;
    }
  }
  return undefined;
}

const M1 = 1_000_000;
const K256 = 256_000;
const K200 = 200_000;

function glmVersion(id: string): number | undefined {
  const m = id.match(/(?:^|[-_./])glm[-_]?(\d+(?:\.\d+)?)(?:$|[-_[.\]])/i);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * 接口没声明时，按常见模型 id 推断。
 * GLM-5.2 / 5.3+ = 1M；国内常见模型默认 256K（不再一律 128k）。
 */
export function inferContextWindow(modelId: string): number | undefined {
  const s = modelId.trim().toLowerCase();
  if (!s) return undefined;

  const tagged = s.match(/(?:^|[-_/])(\d+(?:\.\d+)?)(k|m)(?:$|[-_/\[\]])/i);
  if (tagged) {
    const n = Number(tagged[1]);
    if (Number.isFinite(n) && n > 0) {
      const scaled = Math.floor(n * (tagged[2].toLowerCase() === 'm' ? 1_000_000 : 1_000));
      if (Number.isSafeInteger(scaled) && scaled > 0) return scaled;
    }
  }

  const glm = glmVersion(s);
  if (glm !== undefined) {
    if (glm >= 5.2) return M1;
    return K256;
  }

  if (/(?:^|[-_])long(?:[-_]|$)/.test(s) && /qwen|kimi|claude|gemini|gpt/.test(s)) {
    return M1;
  }

  if (s.includes('claude')) return K200;
  if (/gpt-4\.1/.test(s)) return 1_047_576;
  if (/gemini/.test(s)) return M1;
  if (/minimax|abab/.test(s)) return M1;
  if (
    /kimi|moonshot|qwen|qwq|deepseek|doubao|ernie|hunyuan|spark|gpt-4o|gpt-4-turbo|chatgpt|gpt-5|\bo[1-4](-|$)|llama|mistral|mixtral/.test(
      s,
    )
  ) {
    return K256;
  }
  return undefined;
}

/** 扫描/打开表单时：接口声明优先；上次误填的 128k 用新推断覆盖。 */
export function preferScannedContextWindow(
  modelId: string,
  declared?: number,
  previous?: number,
): number | undefined {
  const inferred = inferContextWindow(modelId);
  if (typeof declared === 'number' && Number.isFinite(declared) && declared > 0) {
    const n = Math.floor(declared);
    if (n === 128_000 && inferred && inferred !== 128_000) return inferred;
    return n;
  }
  if (inferred) return inferred;
  if (typeof previous === 'number' && Number.isFinite(previous) && previous > 0) {
    const n = Math.floor(previous);
    if (n === 128_000 && inferred && inferred !== 128_000) return inferred;
    return n;
  }
  return undefined;
}

/** 接口声明优先，否则按 id 推断。 */
export function resolveModelContextWindow(
  modelId: string,
  declared?: number,
): number | undefined {
  if (typeof declared === 'number' && Number.isFinite(declared) && declared > 0) {
    return Math.floor(declared);
  }
  return inferContextWindow(modelId);
}

export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M`;
  }
  if (n >= 1_000) {
    const k = n / 1_000;
    return `${Number.isInteger(k) ? k : k.toFixed(1)}K`;
  }
  return n.toString();
}
