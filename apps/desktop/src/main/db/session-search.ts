/**
 * 会话搜索：标题 LIKE + 消息正文 FTS5（复用知识库 CJK bigram 分词，零新依赖）。
 *
 * messages_fts 的建表/伴生写在 messages-fts.ts（0.2.27 起写入路径自建表——
 * 本文件搜索入口的 ensure 只是回填时机，不再是表存在的唯一保证）。
 * 删除路径不清理 FTS（孤儿行 join 自然过滤，行重用时被 REPLACE 覆盖）。
 */
import { getSqlite } from './client.js';
import { matchExpression, queryTerms } from '../knowledge/tokenize.ts';
import { ensureMessagesFts } from './messages-fts.js';

export interface SessionSearchHit {
  sessionId: string;
  title: string;
  updatedAt: number;
  snippet: string;
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
  ensureMessagesFts(getSqlite()); // 建表 + 存量回填时机（表存在性由写路径自保证）
  const q = query.trim();
  if (!q) return [];
  const db = getSqlite();

  const sessionMeta = new Map<string, { title: string; updatedAt: number }>();
  for (const r of db
    .prepare('SELECT id, title, updated_at FROM sessions')
    .all() as Array<{ id: string; title: string; updated_at: number }>) {
    if (r.id.startsWith('auto-')) continue; // 自动化隔离会话不进搜索（同侧栏过滤）
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
