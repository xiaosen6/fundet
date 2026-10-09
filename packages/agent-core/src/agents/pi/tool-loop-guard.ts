/**
 * 工具循环熔断（对齐 Cindy loop-guard 思路的 v1 基础版）：
 * 同一工具 + 同一入参连续调用超过阈值（默认 10 次）且相邻间隔均小于重置窗
 * （默认 30s，视为无外部进展的死循环）→ 熔断该 turn。
 * 不同工具/不同入参/间隔超窗都会重置计数——正常的重试（如轮询间隔 >30s）
 * 与穿插的其它调用不会误伤。疑似复核档（Cindy 三档）暂不做，真实误伤报障再加。
 */

export interface ToolLoopGuardOptions {
  /** 连续相同调用次数阈值 */
  limit?: number;
  /** 相邻调用超过该间隔（ms）重置计数——视作在等外部进展 */
  resetWindowMs?: number;
  now?: () => number;
}

export type ToolLoopVerdict = 'ok' | 'trip';

export interface ToolLoopGuard {
  feed(toolName: string, inputKey: string): ToolLoopVerdict;
  /** 每轮 turn 开始时清零（turn 结束自然停止计数） */
  reset(): void;
}

export function createToolLoopGuard(opts: ToolLoopGuardOptions = {}): ToolLoopGuard {
  const limit = opts.limit ?? 10;
  const resetWindowMs = opts.resetWindowMs ?? 30_000;
  const now = opts.now ?? (() => Date.now());
  let key: string | null = null;
  let count = 0;
  let lastAt = 0;
  return {
    feed(toolName, inputKey) {
      const t = now();
      const k = `${toolName}\u0000${inputKey}`;
      if (k !== key || (count > 0 && t - lastAt > resetWindowMs)) {
        key = k;
        count = 0;
      }
      count++;
      lastAt = t;
      return count >= limit ? 'trip' : 'ok';
    },
    reset() {
      key = null;
      count = 0;
      lastAt = 0;
    },
  };
}

/** 工具入参的稳定键：JSON 序列化（键序无关由调用方保证——pi 的 input 是解析后的对象） */
export function toolInputKey(input: unknown): string {
  try {
    return JSON.stringify(input ?? null);
  } catch {
    return String(input);
  }
}
