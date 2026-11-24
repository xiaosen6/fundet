/**
 * settings 表孤儿键清扫的判定（纯函数，node --test 直测）。
 *
 * 两类键的「会话 id」位置不同——这是 0.3.31 引入、2026-11-24 才发现的坑：
 * - `kb.session.<sessionId>`：会话 id 在**键名**后缀；
 * - `im.session.<channel>.<chatId>`：键名后缀是 chatId（渠道侧聊天标识），
 *   会话 id在**值**里（dispatcher 建会话时 setSetting(key, session.id)）。
 * 此前实现把两类键一律按键名后缀取「会话 id」，im.session 的 chatId 永远
 * 不在 sessions 表里 → **每次启动把全部 IM 会话映射删光**，每个聊天重启后
 * 各自新建会话、旧会话行成孤儿，resume 续聊也随之失效。
 */

export interface SettingRow {
  key: string;
  value: string | null;
}

/** 从 settings 行里解出该键关联的会话 id；解不出（空值/键形不对）按孤儿处理 */
export function sessionKeyOwner(row: SettingRow): string | null {
  if (row.key.startsWith('kb.session.')) {
    return row.key.slice('kb.session.'.length) || null;
  }
  if (row.key.startsWith('im.session.')) {
    return (row.value ?? '').trim() || null;
  }
  return null;
}

/** 返回应删除的键：关联会话已不存在（或值缺失）的 */
export function decideOrphanSettingKeys(rows: readonly SettingRow[], validSessionIds: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const row of rows) {
    const owner = sessionKeyOwner(row);
    if (owner === null || !validSessionIds.has(owner)) out.push(row.key);
  }
  return out;
}
