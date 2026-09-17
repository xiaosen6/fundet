/**
 * 会话搜索：标题 LIKE + 消息正文 FTS5（复用知识库 CJK bigram 分词，零新依赖）。
 *
 * messages_fts 虚表：rowid 对齐 messages.rowid，内容 = user/assistant 消息
 * {text} 字段分词后的空格串。insertMessage 时同步 upsert（OR REPLACE 顺带清掉
 * 被删消息残留的同 rowid 旧行——SQLite 无 AUTOINCREMENT 时 rowid 会复用）。
 * 启动首次搜索时对存量行幂等回填。删除路径不清理 FTS（孤儿行 join 自然过滤，
 * 行重用时被 REPLACE 覆盖）。
 */
import { getSqlite } from './client.js';
import { matchExpression, queryTerms, tokenize } from '../knowledge/tokenize.ts';

export interface SessionSearchHit {
  sessionId: string;
  title: string;
  updatedAt: number;
  snippet: string;
}

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

/** insertMessage 的伴生写：rowid 上 REPLACE（复用行时清残留） */
export function upsertMessageFts(rowid: number, contentJson: string): void {
  const text = indexMessageContent(contentJson);
  const db = getSqlite();
  if (!text) {
    db.prepare('DELETE FROM messages_fts WHERE rowid = ?').run(rowid);
    return;
  }
  db.prepare('INSERT OR REPLACE INTO messages_fts(rowid, text) VALUES (?, ?)').run(rowid, text);
}

let ftsReady = false;
function ensureFts(): void {
  if (ftsReady) return;
  const db = getSqlite();
  db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(text, tokenize='unicode61')");
  const ftsCount = (db.prepare('SELECT COUNT(*) AS n FROM messages_fts').get() as { n: number }).n;
  if (ftsCount === 0) {
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
  ftsReady = true;
}

function textOfContent(contentJson: string): string {
  try {
    const c = JSON.parse(contentJson) as { text?: unknown };
    return typeof c.text === 'string' ? c.text : '';
  } catch {
    return '';
  }
}

function snippetAround(text: string, terms: string[]): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!flat) return '';
  let idx = -1;
  const lower = flat.toLowerCase();
  for (const t of terms) {
    idx = lower.indexOf(t.toLowerCase());
    if (idx >= 0) break;
  }
  if (idx < 0) return flat.slice(0, 80);
  const start = Math.max(0, idx - 24);
  const end = Math.min(flat.length, idx + 56);
  return (start > 0 ? '…' : '') + flat.slice(start, end) + (end < flat.length ? '…' : '');
}

/** 搜索：标题命中优先，正文 bm25 兜底；各自按更新时间排 */
export function searchSessions(query: string, limit = 30): SessionSearchHit[] {
  ensureFts();
  const q = query.trim();
  if (!q) return [];
  const db = getSqlite();

  const sessionMeta = new Map<string, { title: string; updatedAt: number }>();
  for (const r of db
    .prepare('SELECT id, title, updated_at FROM sessions')
    .all() as Array<{ id: string; title: string; updated_at: number }>) {
    sessionMeta.set(r.id, { title: r.title, updatedAt: r.updated_at });
  }
  const metaOf = (id: string) => sessionMeta.get(id);

  const hits = new Map<string, { snippet: string; isTitle: boolean; updatedAt: number }>();
  // ① 标题（LIKE 转义；短文本无需 FTS）
  const like = `%${q.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
  for (const r of db
    .prepare("SELECT id FROM sessions WHERE title LIKE ? ESCAPE '\\'")
    .all(like) as Array<{ id: string }>) {
    const meta = metaOf(r.id);
    if (!meta) continue;
    hits.set(r.id, { snippet: '', isTitle: true, updatedAt: meta.updatedAt });
  }
  // ② 正文 FTS（bm25 小者优先）；同会话取最优一条作 snippet
  const expr = matchExpression(q);
  if (expr) {
    for (const r of db
      .prepare(
        `SELECT m.session_id AS sid, m.content AS content, bm25(messages_fts) AS rank
         FROM messages_fts JOIN messages m ON m.rowid = messages_fts.rowid
         WHERE messages_fts MATCH ? ORDER BY rank LIMIT 400`,
      )
      .all(expr) as Array<{ sid: string; content: string; rank: number }>) {
      const meta = metaOf(r.sid);
      if (!meta || hits.has(r.sid)) continue;
      hits.set(r.sid, {
        snippet: snippetAround(textOfContent(r.content), queryTerms(q)),
        isTitle: false,
        updatedAt: meta.updatedAt,
      });
    }
  }

  const order: Array<{ id: string; v: { snippet: string; isTitle: boolean; updatedAt: number } }> = [];
  for (const [id, v] of hits) order.push({ id, v });
  order.sort((a, b) => {
    if (a.v.isTitle !== b.v.isTitle) return a.v.isTitle ? -1 : 1;
    return b.v.updatedAt - a.v.updatedAt;
  });
  return order.slice(0, limit).map(({ id, v }) => ({
    sessionId: id,
    title: metaOf(id)?.title || '',
    updatedAt: v.updatedAt,
    snippet: v.snippet,
  }));
}
