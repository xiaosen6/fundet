/**
 * 语义检索落库/回填/查询（网关绑定层；纯函数在 embeddings-logic.ts）。
 * 设计：混合检索（FTS5 + 向量 RRF 融合）、服务不可达自动降级纯关键词、
 * 查询侧按 Qwen3-Embedding 官方建议加指令前缀。
 * 注意：本文件 import 链含 electron/db，仅 vite bundle 链使用（.ts 后缀）。
 */
import { embedTexts } from '../host/service-gateway.ts';
import { getSqlite } from '../db/client.ts';
import { ensureTables } from './store.ts';
import { EMBED_INSTRUCT, blobToVector, vectorToBlob } from './embeddings-logic.ts';

export { EMBED_INSTRUCT, cosineSimilarity, mergeRrf, vectorToBlob, blobToVector } from './embeddings-logic.ts';

const BATCH = 24;

export interface EmbedProgress {
  total: number;
  done: number;
}

/** 给 KB 缺嵌入的块批量向量化并落库。幂等（只补缺）。embedFn 可注入（单测/离线）。 */
export async function embedKbChunks(
  kbId: string,
  opts: { onProgress?: (p: EmbedProgress) => void; embedFn?: typeof embedTexts } = {},
): Promise<EmbedProgress> {
  ensureTables();
  const db = getSqlite();
  const embed = opts.embedFn ?? embedTexts;
  const pending = db
    .prepare('SELECT chunk_id, text FROM kb_chunks WHERE kb_id = ? AND embedding IS NULL ORDER BY chunk_id')
    .all(kbId) as Array<{ chunk_id: number; text: string }>;
  const total = pending.length;
  const result = { total, done: 0 };
  if (total === 0) return result;
  const update = db.prepare('UPDATE kb_chunks SET embedding = ? WHERE chunk_id = ?');
  for (let i = 0; i < total; i += BATCH) {
    const batch = pending.slice(i, i + BATCH);
    const { vectors } = await embed(batch.map((c) => c.text));
    const txn = db.transaction(() => {
      batch.forEach((c, j) => {
        update.run(Buffer.from(vectorToBlob(vectors[j])), c.chunk_id);
      });
    });
    txn();
    result.done += batch.length;
    opts.onProgress?.({ ...result });
  }
  return result;
}

/** 查询向量（带指令前缀）；失败抛错由调用方降级 */
export async function embedQuery(query: string): Promise<Float32Array> {
  const { vectors } = await embedTexts([query], { instruct: EMBED_INSTRUCT });
  return Float32Array.from(vectors[0]);
}

/** 读 KB 集内已嵌入块（暴力余弦用） */
export function loadEmbeddedChunks(
  kbIds: string[],
): Array<{
  chunkId: number;
  docId: string;
  ord: number;
  text: string;
  docName: string;
  embedding: Float32Array | null;
}> {
  ensureTables();
  if (kbIds.length === 0) return [];
  const db = getSqlite();
  const placeholders = kbIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT c.chunk_id, c.doc_id, c.ord, c.text, c.embedding, d.name AS doc_name
       FROM kb_chunks c JOIN knowledge_docs d ON d.id = c.doc_id
       WHERE c.kb_id IN (${placeholders}) AND c.embedding IS NOT NULL`,
    )
    .all(...kbIds) as Array<{
    chunk_id: number;
    doc_id: string;
    ord: number;
    text: string;
    embedding: Uint8Array;
    doc_name: string;
  }>;
  return rows.map((r) => ({
    chunkId: r.chunk_id,
    docId: r.doc_id,
    ord: r.ord,
    text: r.text,
    docName: r.doc_name,
    embedding: blobToVector(r.embedding),
  }));
}

/** KB 卡片语义就绪度（嵌入块/总块） */
export function embeddingStats(kbId: string): { total: number; embedded: number } {
  ensureTables();
  const db = getSqlite();
  const row = db
    .prepare(
      'SELECT COUNT(*) AS total, SUM(CASE WHEN embedding IS NOT NULL THEN 1 ELSE 0 END) AS embedded FROM kb_chunks WHERE kb_id = ?',
    )
    .get(kbId) as { total: number; embedded: number | null };
  return { total: row.total, embedded: row.embedded ?? 0 };
}
