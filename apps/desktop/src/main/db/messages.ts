/**
 * messages 表读写助手。
 *
 * 落库策略（本阶段从简）：
 * - user 文本：send 时落 {text}
 * - assistant 文本：text 事件 isFinal 时落 {text}
 * - tool_use / tool_result / thinking(final) / done / error：原始 data 以 JSON 落库
 */
import { randomUUID } from 'node:crypto';
import { eq, asc, and, gt, lte, ne } from 'drizzle-orm';
import { getDb, getSqlite } from './client.js';
import { messages } from './schema.js';
import { upsertMessageFts } from './messages-fts.js';

export function insertMessage(sessionId: string, role: string, content: unknown): void {
  const id = randomUUID();
  const contentJson = JSON.stringify(content ?? null);
  const db = getSqlite();
  getDb()
    .insert(messages)
    .values({
      id,
      sessionId,
      role,
      content: contentJson,
      createdAt: Date.now(),
    })
    .run();
  // FTS 同步（搜索用）：user/assistant 文本入索引，其余行清残留；
  // upsert 内部自建表——旧库没打开过搜索时表不存在（0.2.27 前首次 send 即炸的根因）
  const row = db.prepare('SELECT rowid FROM messages WHERE id = ?').get(id) as
    | { rowid: number }
    | undefined;
  if (row) upsertMessageFts(db, row.rowid, contentJson);
}

export function deleteMessagesInRange(sessionId: string, afterCreatedAt: number, untilCreatedAt: number): void {
  getDb()
    .delete(messages)
    .where(
      and(
        eq(messages.sessionId, sessionId),
        gt(messages.createdAt, afterCreatedAt),
        lte(messages.createdAt, untilCreatedAt),
        ne(messages.role, 'user'),
      ),
    )
    .run();
}

export function copyMessagesUntil(fromId: string, toId: string, upToCreatedAt: number): void {
  const rows = listMessages(fromId).filter((m) => m.createdAt <= upToCreatedAt);
  const db = getDb();
  for (const m of rows) {
    db.insert(messages)
      .values({
        id: randomUUID(),
        sessionId: toId,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
      })
      .run();
  }
}

export function listMessages(sessionId: string): Array<typeof messages.$inferSelect> {
  return getDb()
    .select()
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(asc(messages.createdAt))
    .all();
}
