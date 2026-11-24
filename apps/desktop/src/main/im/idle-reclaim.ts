/**
 * IM 闲置会话回收的判定（纯函数，node --test 直测）。
 *
 * 0.3.31 引入、2026-11-24 发现的坑：回收循环里查 `im.session.${key}`，而 key
 * 本身已经是 `im.session.<channel>.<chatId>`（sessionMapKey 的产物）——双重前缀
 * 永远查不到 → 回收从未生效，每个聊过天的 IM 会话各留一个 pi 子进程直到退出应用。
 */

export interface IdleEntry {
  /** sessionMapKey 的产物：im.session.<channel>.<chatId> */
  key: string;
  lastActive: number;
}

export interface IdleReclaim {
  /** 待回收的会话 id（settings 里该 key 的值；值缺失的跳过并单独报告） */
  sessionIds: string[];
  /** 值缺失/失效的 key（映射已坏，从活跃表里摘掉即可，不动 settings） */
  staleKeys: string[];
}

export function decideIdleReclaims(
  entries: readonly IdleEntry[],
  now: number,
  idleMs: number,
  getSetting: (key: string) => string | null,
): IdleReclaim {
  const sessionIds: string[] = [];
  const staleKeys: string[] = [];
  for (const e of entries) {
    if (now - e.lastActive < idleMs) continue;
    const sessionId = (getSetting(e.key) ?? '').trim();
    if (sessionId) sessionIds.push(sessionId);
    else staleKeys.push(e.key);
  }
  return { sessionIds, staleKeys };
}
