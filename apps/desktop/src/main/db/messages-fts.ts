/**
 * messages_fts 全文索引的建表与伴生写（无 electron 依赖，db 注入，单测可直跑）。
 *
 * 0.2.27 修复：upsert 写入路径自保证建表——此前 ensure 只挂在搜索入口，
 * 旧库升级后从未打开过搜索的面板时表不存在，首次 send 即
 * `SqliteError: no such table: messages_fts`（真机 0.2.26 实报）。
 *
 * messages_fts 虚表：rowid 对齐 messages.rowid，内容 = user/assistant 消息
 * {text} 分词后的空格串。写入走 OR REPLACE（复用行时顺带清残留——SQLite
 * 无 AUTOINCREMENT 时 rowid 会复用）。幂等无模块级缓存标志：多库注入下
 * 标志会串库，每次多跑一条 COUNT 的开销可忽略。
 */
import type Database from 'better-sqlite3';
import { tokenize } from '../knowledge/tokenize.ts';

/** 消息 content JSON → 可索引文本（只取 {text}；工具/done 等 raw 行不入索引） */
export function indexMessageContent(contentJson: string): string {
  try {
    const c = JSON.parse(contentJson) as { text?: unknown };
    if (typeof c.text === 'string' && c.text) {
      return tokenize(c.text)
        .map((t) => t.text)
        .join(' ');
    }
  } catch {
    /* 非 JSON 不索引 */
  }
  return '';
}

/** 建表 + 首次遇到空表时对存量消息幂等回填 */
export function ensureMessagesFts(db: Database.Database): void {
  db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(text, tokenize='unicode61')");
  const ftsCount = (db.prepare('SELECT COUNT(*) AS n FROM messages_fts').get() as { n: number }).n;
  if (ftsCount > 0) return;
  const rows = db
    .prepare("SELECT rowid, content FROM messages WHERE role IN ('user','assistant')")
    .all() as Array<{ rowid: number; content: string }>;
  const insert = db.prepare('INSERT INTO messages_fts(rowid, text) VALUES (?, ?)');
  const tx = db.transaction((rs: Array<{ rowid: number; content: string }>): void => {
    for (const r of rs) {
      const text = indexMessageContent(r.content);
      if (text) insert.run(r.rowid, text);
    }
  });
  tx(rows);
}

/** insertMessage 的伴生写：先自保证建表（写路径不依赖搜索入口先跑过） */
export function upsertMessageFts(db: Database.Database, rowid: number, contentJson: string): void {
  ensureMessagesFts(db);
  const text = indexMessageContent(contentJson);
  if (!text) {
    db.prepare('DELETE FROM messages_fts WHERE rowid = ?').run(rowid);
    return;
  }
  db.prepare('INSERT OR REPLACE INTO messages_fts(rowid, text) VALUES (?, ?)').run(rowid, text);
}
