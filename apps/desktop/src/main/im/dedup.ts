/**
 * IM 入站消息去重窗口。
 *
 * 飞书/钉钉/企微的长连在断线重连后会重推事件；不去重会让同一句话跑两遍
 * Pi 回合（双倍 token、用户收到两条重复回复）。渠道侧能拿到稳定消息 id
 * （message_id / msgid / messageId）才参与去重，没有 id 的入站保持原样。
 */
export interface InboundDedupOptions {
  /** 记住多久：重推发生在重连后的几秒到几分钟内 */
  ttlMs?: number;
  /** 容量上限，防长时间在线无限增长 */
  maxEntries?: number;
}

const DEFAULT_TTL_MS = 10 * 60_000;
const DEFAULT_MAX_ENTRIES = 2_000;

export interface InboundDedup {
  /** true = 近期已见过这条，应丢弃 */
  seen(key: string, now?: number): boolean;
  /** 当前记住的条数（测试用） */
  size(): number;
}

export function createInboundDedup(options: InboundDedupOptions = {}): InboundDedup {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const seenAt = new Map<string, number>();

  const prune = (now: number): void => {
    for (const [key, at] of seenAt) {
      if (now - at >= ttlMs) seenAt.delete(key);
    }
    // 过期清理后仍达上限（TTL 内消息量异常大）：按插入序丢最旧
    while (seenAt.size >= maxEntries) {
      const oldest = seenAt.keys().next().value;
      if (oldest === undefined) break;
      seenAt.delete(oldest);
    }
  };

  return {
    seen(key: string, now: number = Date.now()): boolean {
      const at = seenAt.get(key);
      // 命中即拦（不刷新时间戳/插入序：重复消息按首次见到的时间老化与淘汰）
      if (at !== undefined && now - at < ttlMs) return true;
      if (seenAt.size + 1 >= maxEntries) prune(now);
      // 先删再插：TTL 过期后重见的 key 排回插入序末尾
      seenAt.delete(key);
      seenAt.set(key, now);
      return false;
    },
    size(): number {
      return seenAt.size;
    },
  };
}
