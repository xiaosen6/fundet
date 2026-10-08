/**
 * 会话正文搜索（session:search-content 数据层）：db 注入、无 electron 依赖，node --test 直跑。
 *
 * 只查 messages_fts（建表/伴生写在 messages-fts.ts；此处 ensure 只作存量回填时机，
 * 表存在性由写路径自保证）。同一会话聚合取 bm25 最优一条消息的上下文片段，
 * 结果按会话 updatedAt 倒序；标题匹配在渲染层本地做，不经过这里。
 */
import type Database from 'better-sqlite3';
import { matchExpression, queryTerms } from '../knowledge/tokenize.ts';
import { ensureMessagesFts } from './messages-fts.ts';

/** 搜索命中（与渲染层 SessionSearchHit 同形） */
export interface SessionContentHit {
  sessionId: string;
  title: string;
  snippet: string;
  updatedAt: number;
}

/** content JSON → 原文文本（snippet 定位用；只认 {text} 行） */
export function textOfContent(contentJson: string): string {
  try {
    const c = JSON.parse(contentJson) as { text?: unknown };
    return typeof c.text === 'string' ? c.text : '';
  } catch {
    return '';
  }
}

/** 匹配词上下文片段（约 80 字；找不到词元则取开头） */
export function snippetAround(text: string, terms: string[]): string {
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

/** 正文搜索：<2 字符（渲染层已拦，此处兜底）或无有效词元返回空；limit 按会话数截断 */
export function searchSessionContent(
  db: Database.Database,
  query: string,
  limit = 20,
): SessionContentHit[] {
  ensureMessagesFts(db);
  const q = query.trim();
  if (q.length < 2 || limit <= 0) return [];
  const expr = matchExpression(q);
  if (!expr) return [];

  const metaOf = new Map<string, { title: string; updatedAt: number }>();
  for (const r of db
    .prepare('SELECT id, title, updated_at FROM sessions')
    .all() as Array<{ id: string; title: string; updated_at: number }>) {
    if (r.id.startsWith('auto-')) continue; // 自动化隔离会话不进搜索（同侧栏过滤）
    metaOf.set(r.id, { title: r.title, updatedAt: r.updated_at });
  }

  // bm25 小者优先：每会话取首条命中（最优匹配）作 snippet
  const best = new Map<string, SessionContentHit>();
  const terms = queryTerms(q);
  for (const r of db
    .prepare(
      `SELECT m.session_id AS sid, m.content AS content, bm25(messages_fts) AS rank
       FROM messages_fts JOIN messages m ON m.rowid = messages_fts.rowid
       WHERE messages_fts MATCH ? ORDER BY rank LIMIT 400`,
    )
    .all(expr) as Array<{ sid: string; content: string; rank: number }>) {
    const meta = metaOf.get(r.sid);
    if (!meta || best.has(r.sid)) continue;
    best.set(r.sid, {
      sessionId: r.sid,
      title: meta.title,
      snippet: snippetAround(textOfContent(r.content), terms),
      updatedAt: meta.updatedAt,
    });
  }

  const hits = [...best.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  return hits.slice(0, limit);
}
