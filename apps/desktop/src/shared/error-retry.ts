/**
 * 终态错误分类（对齐 Cindy 错误重试补强）：识别限流/过载/网络瞬断三类
 * 可自动重试的错误，给出人话标签与退避延迟；其余（鉴权/参数/欠费配额）不重试。
 * 纯函数，无副作用。
 */

export type RetryKind = 'rate-limit' | 'overloaded' | 'network';

export interface RetryPlanSeed {
  kind: RetryKind;
  /** 人话原因（倒计时提示用） */
  label: string;
  /** 首次退避延迟 */
  delayMs: number;
}

/** 不可重试 / 未识别 */
export function classifyRetryableError(message: string): RetryPlanSeed | null {
  const m = String(message ?? '');
  // 欠费/配额：重试只会继续失败
  if (/insufficient[_\s-]?quota|exceeded your current quota|balance|欠费|余额不足|配额/i.test(m)) {
    return null;
  }
  // 鉴权：重试无意义
  if (/\b40[13]\b|unauthorized|invalid[_\s-]?api[_\s-]?key|鉴权失败|令牌/i.test(m)) {
    return null;
  }
  // 参数类（智谱 1210 等）
  if (/\b1210\b|invalid[_\s-]?parameter|参数错误/i.test(m)) {
    return null;
  }
  if (/\b429\b|rate[ _-]?limit|too many requests|请求过于频繁|触发限流|限流/i.test(m)) {
    return { kind: 'rate-limit', label: '触发限流', delayMs: 15_000 };
  }
  if (/\b(503|529)\b|overload|overloaded|过载|负载过高|繁忙/i.test(m)) {
    return { kind: 'overloaded', label: '服务过载', delayMs: 8_000 };
  }
  if (
    /ECONNRESET|ETIMEDOUT|ECONNREFUSED|ENOTDIR|EAI_AGAIN|fetch failed|network error|socket hang up|连接(?:已|被)?(?:中断|断开|重置)|网络异常/i.test(
      m,
    )
  ) {
    return { kind: 'network', label: '网络瞬断', delayMs: 5_000 };
  }
  return null;
}

/** 自动重试上限：超过后交还手动重发（CDS 熔断口径：3 次自动，第 4 次人工） */
export const MAX_AUTO_RETRY_ATTEMPTS = 3;

/** 第 n 次重试的延迟：截断指数退避 + Full Jitter（CDS 429/503 公式）。
 *  delay = min(max(base, 5s) × 2^(n-1) × jitter, 10min)，jitter = 0.85 + random×0.3
 *  （±15% 防多客户端羊群同步重试）。random 可注入，测试用确定性值。 */
export function retryDelayMs(seed: RetryPlanSeed, attempt: number, random: () => number = Math.random): number {
  const base = Math.max(seed.delayMs, 5_000);
  const jitter = 0.85 + random() * 0.3;
  return Math.min(Math.round(base * 2 ** (attempt - 1) * jitter), 600_000);
}
