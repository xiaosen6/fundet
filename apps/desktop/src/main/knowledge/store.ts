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
import { cosineSimilarity, embedQuery, loadEmbeddedChunks, mergeRrf } from './embeddings.ts';
import type {
  KnowledgeBaseParams,
  KnowledgeBaseView,
  KnowledgeDocView,
  KnowledgeSearchResult,
  KnowledgeSessionBinding,
} from '../../shared/knowledge.js';

let tablesReady = false;

export function ensureTables(): void {
  if (tablesReady) return;
  const db = getSqlite();
  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_bases (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      top_k INTEGER NOT NULL DEFAULT 6,
      chunk_size INTEGER NOT NULL DEFAULT 800,
      chunk_overlap INTEGER NOT NULL DEFAULT 120
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
  // 早期建表无参数列：逐列补齐（幂等）
  const cols = new Set(
    (db.prepare('PRAGMA table_info(knowledge_bases)').all() as Array<{ name: string }>).map((c) => c.name),
  );
  for (const [col, decl] of [
    ['top_k', 'INTEGER NOT NULL DEFAULT 6'],
    ['chunk_size', 'INTEGER NOT NULL DEFAULT 800'],
    ['chunk_overlap', 'INTEGER NOT NULL DEFAULT 120'],
  ] as const) {
    if (!cols.has(col)) db.exec(`ALTER TABLE knowledge_bases ADD COLUMN ${col} ${decl}`);
  }
  // 笔记：kind 区分来源，content 存笔记原文（供再编辑）
  const docCols = new Set(
    (db.prepare('PRAGMA table_info(knowledge_docs)').all() as Array<{ name: string }>).map((c) => c.name),
  );
  if (!docCols.has('kind')) db.exec("ALTER TABLE knowledge_docs ADD COLUMN kind TEXT NOT NULL DEFAULT 'file'");
  if (!docCols.has('content')) db.exec('ALTER TABLE knowledge_docs ADD COLUMN content TEXT');
  // 语义检索（0.3.14）：块嵌入向量 BLOB（Float32Array；回填见 embeddings.ts）
  const chunkCols = new Set(
    (db.prepare('PRAGMA table_info(kb_chunks)').all() as Array<{ name: string }>).map((c) => c.name),
  );
  if (!chunkCols.has('embedding')) db.exec('ALTER TABLE kb_chunks ADD COLUMN embedding BLOB');
  tablesReady = true;
}

const bindingKey = (sessionId: string): string => `kb.session.${sessionId}`;

// ---------- KB ----------

const KB_PARAM_DEFAULTS: KnowledgeBaseParams = { topK: 6, chunkSize: 800, chunkOverlap: 120 };

function clampParams(p: Partial<KnowledgeBaseParams>): KnowledgeBaseParams {
  const clamp = (v: number | undefined, lo: number, hi: number, dflt: number): number => {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) return dflt;
    return Math.min(hi, Math.max(lo, n));
  };
  return {
    topK: clamp(p.topK, 1, 20, KB_PARAM_DEFAULTS.topK),
    chunkSize: clamp(p.chunkSize, 200, 4000, KB_PARAM_DEFAULTS.chunkSize),
    chunkOverlap: clamp(p.chunkOverlap, 0, 1000, KB_PARAM_DEFAULTS.chunkOverlap),
  };
}

export function listKnowledgeBases(): KnowledgeBaseView[] {
  ensureTables();
  const db = getSqlite();
  const rows = db
    .prepare(
      `SELECT b.id, b.name, b.created_at, b.top_k, b.chunk_size, b.chunk_overlap,
              (SELECT COUNT(*) FROM knowledge_docs d WHERE d.kb_id = b.id) AS doc_count,
              (SELECT COUNT(*) FROM kb_chunks c WHERE c.kb_id = b.id) AS chunk_count,
              (SELECT COUNT(*) FROM kb_chunks c WHERE c.kb_id = b.id AND c.embedding IS NOT NULL) AS embedded_count
       FROM knowledge_bases b ORDER BY b.created_at DESC`,
    )
    .all() as Array<{
    id: string;
    name: string;
    created_at: number;
    top_k: number;
    chunk_size: number;
    chunk_overlap: number;
    doc_count: number;
    chunk_count: number;
    embedded_count: number;
  }>;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    docCount: r.doc_count,
    chunkCount: r.chunk_count,
    embeddedChunks: r.embedded_count,
    createdAt: r.created_at,
    params: { topK: r.top_k, chunkSize: r.chunk_size, chunkOverlap: r.chunk_overlap },
  }));
}

/** 更新 KB 检索/分块参数（不影响已建索引；改块参数后需重新导入文档才生效） */
export function updateKnowledgeBaseParams(id: string, params: Partial<KnowledgeBaseParams>): void {
  ensureTables();
  const p = clampParams(params);
  getSqlite()
    .prepare('UPDATE knowledge_bases SET top_k = ?, chunk_size = ?, chunk_overlap = ? WHERE id = ?')
    .run(p.topK, p.chunkSize, p.chunkOverlap, id);
}

export function getKnowledgeBaseParams(id: string): KnowledgeBaseParams {
  ensureTables();
  const row = getSqlite()
    .prepare('SELECT top_k, chunk_size, chunk_overlap FROM knowledge_bases WHERE id = ?')
    .get(id) as { top_k: number; chunk_size: number; chunk_overlap: number } | undefined;
  if (!row) return { ...KB_PARAM_DEFAULTS };
  return { topK: row.top_k, chunkSize: row.chunk_size, chunkOverlap: row.chunk_overlap };
}

/** 多库取参数默认值（绑多库时取最大 topK，块参数取首个命中库） */
export function resolveDefaultTopK(kbIds: string[]): number {
  let topK = KB_PARAM_DEFAULTS.topK;
  for (const id of kbIds) {
    topK = Math.max(topK, getKnowledgeBaseParams(id).topK);
  }
  return topK;
}

export function createKnowledgeBase(
  name: string,
  params?: Partial<KnowledgeBaseParams>,
): KnowledgeBaseView {
  ensureTables();
  const trimmed = name.trim();
  if (!trimmed) throw new Error('知识库名称不能为空');
  if (trimmed.length > 60) throw new Error('知识库名称过长（≤60 字）');
  const db = getSqlite();
  const exists = db.prepare('SELECT 1 FROM knowledge_bases WHERE name = ?').get(trimmed);
  if (exists) throw new Error(`已存在同名知识库「${trimmed}」`);
  const p = clampParams(params ?? {});
  const id = randomUUID();
  const createdAt = Date.now();
  db.prepare(
    'INSERT INTO knowledge_bases (id, name, created_at, top_k, chunk_size, chunk_overlap) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, trimmed, createdAt, p.topK, p.chunkSize, p.chunkOverlap);
  return {
    id,
    name: trimmed,
    docCount: 0,
    chunkCount: 0,
    createdAt,
    params: p,
  };
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
      `SELECT d.id, d.kb_id, d.name, d.chars, d.created_at, d.kind, d.content,
              (SELECT COUNT(*) FROM kb_chunks c WHERE c.doc_id = d.id) AS chunk_count
       FROM knowledge_docs d WHERE d.kb_id = ? ORDER BY d.created_at DESC`,
    )
    .all(kbId) as Array<{
    id: string;
    kb_id: string;
    name: string;
    chars: number;
    created_at: number;
    kind: string;
    content: string | null;
    chunk_count: number;
  }>;
  return rows.map((r) => ({
    id: r.id,
    kbId: r.kb_id,
    name: r.name,
    chars: r.chars,
    chunkCount: r.chunk_count,
    createdAt: r.created_at,
    kind: (r.kind === 'note' ? 'note' : 'file') as 'note' | 'file',
    noteContent: r.kind === 'note' ? (r.content ?? '') : undefined,
  }));
}

/** 导入一份已提取的正文：分块 → 入库 → 建 FTS 索引（单事务）。 */
export function importDocumentChunks(kbId: string, name: string, text: string): { docId: string; chunks: number } {
  ensureTables();
  const db = getSqlite();
  const p = getKnowledgeBaseParams(kbId);
  const pieces = chunkText(text, { size: p.chunkSize, overlap: p.chunkOverlap });
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

/** 新建/更新笔记（按 docId 判定更新；同名互斥由调用侧界面保证） */
export function saveKnowledgeNote(
  kbId: string,
  noteId: string | null,
  title: string,
  content: string,
): { docId: string; chunks: number } {
  const trimmedTitle = title.trim();
  if (!trimmedTitle) throw new Error('笔记标题不能为空');
  if (!content.trim()) throw new Error('笔记内容不能为空');
  if (noteId) {
    const existing = getSqlite()
      .prepare("SELECT id FROM knowledge_docs WHERE id = ? AND kind = 'note'")
      .get(noteId) as { id: string } | undefined;
    if (!existing) throw new Error('笔记不存在或已删除');
    removeKnowledgeDoc(noteId);
  }
  const name = `笔记：${trimmedTitle.slice(0, 60)}`;
  const imported = importDocumentChunks(kbId, name, content);
  getSqlite()
    .prepare("UPDATE knowledge_docs SET kind = 'note', content = ? WHERE id = ?")
    .run(content, imported.docId);
  return imported;
}

/** 笔记原文（编辑回填用） */
export function getKnowledgeNoteContent(docId: string): string | null {
  const row = getSqlite()
    .prepare("SELECT content FROM knowledge_docs WHERE id = ? AND kind = 'note'")
    .get(docId) as { content: string | null } | undefined;
  return row?.content ?? null;
}

export function removeKnowledgeDoc(docId: string): void {
  ensureTables();
  const db = getSqlite();
  db.prepare('DELETE FROM kb_fts WHERE rowid IN (SELECT chunk_id FROM kb_chunks WHERE doc_id = ?)').run(docId);
  db.prepare('DELETE FROM kb_chunks WHERE doc_id = ?').run(docId);
  db.prepare('DELETE FROM knowledge_docs WHERE id = ?').run(docId);
}

// ---------- 检索 ----------

/**
 * 混合检索（0.3.14）：FTS5 关键词 + 向量余弦 RRF 融合；向量侧不可达时
 * 自动降级纯 FTS5。async（向量查询走网关）。
 */
export async function searchKnowledgeChunks(
  kbIds: string[],
  query: string,
  limit = 6,
): Promise<KnowledgeSearchResult[]> {
  ensureTables();
  const fts = ftsSearch(kbIds, query, limit);
  try {
    const queryVec = await embedQuery(query);
    const chunks = loadEmbeddedChunks(kbIds);
    if (chunks.length === 0) return fts;
    const terms = queryTerms(query);
    const scored = chunks
      .filter((c) => c.embedding)
      .map((c) => ({
        item: {
          docName: c.docName,
          ord: c.ord,
          snippet: buildSnippetLocal(c.text, terms),
          score: 0,
        } as KnowledgeSearchResult,
        key: `${c.docName}#${c.ord}`,
        sim: cosineSimilarity(queryVec, c.embedding!),
      }))
      .sort((a, b) => b.sim - a.sim)
      .slice(0, limit);
    const merged = mergeRrf<KnowledgeSearchResult>([
      fts.map((r) => ({ item: r, key: `${r.docName}#${r.ord}` })),
      scored.map((s) => ({ item: s.item, key: s.key })),
    ]).slice(0, limit);
    return merged.map((m) => ({ ...m.item, score: m.score }));
  } catch {
    // 嵌入服务不可达：降级纯关键词（检索永不死）
    return fts;
  }
}

/** 原 FTS5 关键词检索（同步，混合检索的一路 + 降级态） */
function ftsSearch(
  kbIds: string[],
  query: string,
  limit: number,
): KnowledgeSearchResult[] {
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

export function getSessionKnowledgeBinding(sessionId: string): KnowledgeSessionBinding {
  ensureTables();
  const raw = getSetting(bindingKey(sessionId));
  if (!raw) return { ids: [], auto: false };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      // 旧格式：纯 id 数组（无自动注入）
      return { ids: parsed.filter((v): v is string => typeof v === 'string'), auto: false };
    }
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { ids?: unknown }).ids)) {
      return {
        ids: (parsed as { ids: unknown[] }).ids.filter((v): v is string => typeof v === 'string'),
        auto: (parsed as { auto?: unknown }).auto === true,
        dingtalk: (parsed as { dingtalk?: unknown }).dingtalk === true,
      };
    }
    return { ids: [], auto: false };
  } catch {
    return { ids: [], auto: false };
  }
}

/** 兼容旧调用：只取绑定 id */
export function getSessionKnowledgeKbs(sessionId: string): string[] {
  return getSessionKnowledgeBinding(sessionId).ids;
}

export function setSessionKnowledgeBinding(
  sessionId: string,
  ids: string[],
  auto: boolean,
  dingtalk = false,
): void {
  ensureTables();
  const valid = new Set(
    (
      getSqlite()
        .prepare('SELECT id FROM knowledge_bases')
        .all() as Array<{ id: string }>
    ).map((r) => r.id),
  );
  const filtered = [...new Set(ids)].filter((id) => valid.has(id));
  const empty = filtered.length === 0 && !auto && !dingtalk;
  setSetting(bindingKey(sessionId), empty ? null : JSON.stringify({ ids: filtered, auto, dingtalk }));
}
