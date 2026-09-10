/**
 * 知识库存储：KB / 文档 / 分块（FTS5 索引）与会话绑定。
 *
 * 表结构走 raw SQL 幂等创建（FTS5 虚表不进 drizzle 迁移）：
 * - knowledge_bases / knowledge_docs / kb_chunks（原文与元数据）
 * - kb_fts：FTS5 虚表（seg 列存 bigram 分词文本，unicode61 切词），
 *   rowid 与 kb_chunks.chunk_id 对齐；检索命中后回 kb_chunks 取原文片段。
 *
 * 会话绑定存 settings 表（key = kb.session.<sessionId>），主进程装配会话时
 * 读取以决定是否注入 knowledge MCP。
 */
import { randomUUID } from 'node:crypto';
import { getSqlite } from '../db/client.js';
import { getSetting, setSetting } from '../db/settings.js';
import { chunkText } from './chunk.js';
import { indexText, matchExpression, queryTerms } from './tokenize.js';
import type {
  KnowledgeBaseView,
  KnowledgeDocView,
  KnowledgeSearchResult,
} from '../../shared/knowledge.js';

let tablesReady = false;

function ensureTables(): void {
  if (tablesReady) return;
  const db = getSqlite();
  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_bases (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS knowledge_docs (
      id TEXT PRIMARY KEY,
      kb_id TEXT NOT NULL,
      name TEXT NOT NULL,
      chars INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_kb_docs_kb ON knowledge_docs(kb_id);
    CREATE TABLE IF NOT EXISTS kb_chunks (
      chunk_id INTEGER PRIMARY KEY,
      kb_id TEXT NOT NULL,
      doc_id TEXT NOT NULL,
      ord INTEGER NOT NULL,
      text TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_kb_chunks_kb ON kb_chunks(kb_id);
    CREATE INDEX IF NOT EXISTS idx_kb_chunks_doc ON kb_chunks(doc_id);
    CREATE VIRTUAL TABLE IF NOT EXISTS kb_fts USING fts5(seg, tokenize='unicode61');
  `);
  tablesReady = true;
}

const bindingKey = (sessionId: string): string => `kb.session.${sessionId}`;

// ---------- KB ----------

export function listKnowledgeBases(): KnowledgeBaseView[] {
  ensureTables();
  const db = getSqlite();
  const rows = db
    .prepare(
      `SELECT b.id, b.name, b.created_at,
              (SELECT COUNT(*) FROM knowledge_docs d WHERE d.kb_id = b.id) AS doc_count,
              (SELECT COUNT(*) FROM kb_chunks c WHERE c.kb_id = b.id) AS chunk_count
       FROM knowledge_bases b ORDER BY b.created_at DESC`,
    )
    .all() as Array<{ id: string; name: string; created_at: number; doc_count: number; chunk_count: number }>;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    docCount: r.doc_count,
    chunkCount: r.chunk_count,
    createdAt: r.created_at,
  }));
}

export function createKnowledgeBase(name: string): KnowledgeBaseView {
  ensureTables();
  const trimmed = name.trim();
  if (!trimmed) throw new Error('知识库名称不能为空');
  if (trimmed.length > 60) throw new Error('知识库名称过长（≤60 字）');
  const db = getSqlite();
  const exists = db.prepare('SELECT 1 FROM knowledge_bases WHERE name = ?').get(trimmed);
  if (exists) throw new Error(`已存在同名知识库「${trimmed}」`);
  const id = randomUUID();
  db.prepare('INSERT INTO knowledge_bases (id, name, created_at) VALUES (?, ?, ?)').run(
    id,
    trimmed,
    Date.now(),
  );
  return { id, name: trimmed, docCount: 0, chunkCount: 0, createdAt: Date.now() };
}

export function deleteKnowledgeBase(id: string): void {
  ensureTables();
  const db = getSqlite();
  db.prepare('DELETE FROM kb_fts WHERE rowid IN (SELECT chunk_id FROM kb_chunks WHERE kb_id = ?)').run(id);
  db.prepare('DELETE FROM kb_chunks WHERE kb_id = ?').run(id);
  db.prepare('DELETE FROM knowledge_docs WHERE kb_id = ?').run(id);
  db.prepare('DELETE FROM knowledge_bases WHERE id = ?').run(id);
}

// ---------- 文档 ----------

export function listKnowledgeDocs(kbId: string): KnowledgeDocView[] {
  ensureTables();
  const db = getSqlite();
  const rows = db
    .prepare(
      `SELECT d.id, d.kb_id, d.name, d.chars, d.created_at,
              (SELECT COUNT(*) FROM kb_chunks c WHERE c.doc_id = d.id) AS chunk_count
       FROM knowledge_docs d WHERE d.kb_id = ? ORDER BY d.created_at DESC`,
    )
    .all(kbId) as Array<{ id: string; kb_id: string; name: string; chars: number; created_at: number; chunk_count: number }>;
  return rows.map((r) => ({
    id: r.id,
    kbId: r.kb_id,
    name: r.name,
    chars: r.chars,
    chunkCount: r.chunk_count,
    createdAt: r.created_at,
  }));
}

/** 导入一份已提取的正文：分块 → 入库 → 建 FTS 索引（单事务）。 */
export function importDocumentChunks(kbId: string, name: string, text: string): { docId: string; chunks: number } {
  ensureTables();
  const db = getSqlite();
  const pieces = chunkText(text);
  if (pieces.length === 0) throw new Error(`「${name}」没有可索引的正文内容`);
  const docId = randomUUID();
  const insertDoc = db.prepare(
    'INSERT INTO knowledge_docs (id, kb_id, name, chars, created_at) VALUES (?, ?, ?, ?, ?)',
  );
  const insertChunk = db.prepare(
    'INSERT INTO kb_chunks (chunk_id, kb_id, doc_id, ord, text) VALUES (?, ?, ?, ?, ?)',
  );
  const insertFts = db.prepare('INSERT INTO kb_fts (rowid, seg) VALUES (?, ?)');
  const txn = db.transaction(() => {
    insertDoc.run(docId, kbId, name, text.length, Date.now());
    for (const piece of pieces) {
      const chunkId = db.prepare('SELECT COALESCE(MAX(chunk_id), 0) + 1 AS id FROM kb_chunks').get() as {
        id: number;
      };
      insertChunk.run(chunkId.id, kbId, docId, piece.ord, piece.text);
      insertFts.run(chunkId.id, indexText(piece.text));
    }
  });
  txn();
  return { docId, chunks: pieces.length };
}

export function removeKnowledgeDoc(docId: string): void {
  ensureTables();
  const db = getSqlite();
  db.prepare('DELETE FROM kb_fts WHERE rowid IN (SELECT chunk_id FROM kb_chunks WHERE doc_id = ?)').run(docId);
  db.prepare('DELETE FROM kb_chunks WHERE doc_id = ?').run(docId);
  db.prepare('DELETE FROM knowledge_docs WHERE id = ?').run(docId);
}

// ---------- 检索 ----------

export function searchKnowledgeChunks(
  kbIds: string[],
  query: string,
  limit = 6,
): KnowledgeSearchResult[] {
  ensureTables();
  const expr = matchExpression(query);
  if (!expr || kbIds.length === 0) return [];
  const db = getSqlite();
  const placeholders = kbIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT c.doc_id, c.ord, c.text, bm25(kb_fts) AS rank, d.name AS doc_name
       FROM kb_fts JOIN kb_chunks c ON c.chunk_id = kb_fts.rowid
       JOIN knowledge_docs d ON d.id = c.doc_id
       WHERE kb_fts MATCH ? AND c.kb_id IN (${placeholders})
       ORDER BY rank LIMIT ?`,
    )
    .all(expr, ...kbIds, limit) as Array<{
    doc_id: string;
    ord: number;
    text: string;
    rank: number;
    doc_name: string;
  }>;
  const terms = queryTerms(query);
  return rows.map((r) => ({
    docName: r.doc_name,
    ord: r.ord,
    snippet: buildSnippetLocal(r.text, terms),
    score: r.rank,
  }));
}

function buildSnippetLocal(text: string, terms: string[]): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  let first = -1;
  let len = 0;
  for (const term of terms) {
    const idx = clean.indexOf(term);
    if (idx >= 0 && (first < 0 || idx < first)) {
      first = idx;
      len = term.length;
    }
  }
  const radius = 130;
  if (first < 0) return clean.slice(0, radius * 2) + (clean.length > radius * 2 ? '…' : '');
  const start = Math.max(0, first - radius);
  const end = Math.min(clean.length, first + len + radius);
  return `${start > 0 ? '…' : ''}${clean.slice(start, end)}${end < clean.length ? '…' : ''}`;
}

// ---------- 会话绑定 ----------

export function getSessionKnowledgeKbs(sessionId: string): string[] {
  ensureTables();
  const raw = getSetting(bindingKey(sessionId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string');
  } catch {
    return [];
  }
}

export function setSessionKnowledgeKbs(sessionId: string, ids: string[]): void {
  ensureTables();
  const valid = new Set(
    (
      getSqlite()
        .prepare('SELECT id FROM knowledge_bases')
        .all() as Array<{ id: string }>
    ).map((r) => r.id),
  );
  const filtered = [...new Set(ids)].filter((id) => valid.has(id));
  setSetting(bindingKey(sessionId), filtered.length > 0 ? JSON.stringify(filtered) : null);
}
