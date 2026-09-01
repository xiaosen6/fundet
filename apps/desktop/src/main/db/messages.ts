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
import { getDb } from './client.js';
import { messages } from './schema.js';

export function insertMessage(sessionId: string, role: string, content: unknown): void {
  getDb()
    .insert(messages)
    .values({
      id: randomUUID(),
      sessionId,
      role,
      content: JSON.stringify(content ?? null),
      createdAt: Date.now(),
    })
    .run();
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
