/**
 * 语义检索纯函数（零依赖，node --test 直跑；网关绑定层在 embeddings.ts）。
 */
export const EMBED_INSTRUCT = 'Instruct: 检索相关文档';

export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i];
    const y = b[i];
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

export interface RrfCandidate<T> {
  item: T;
  key: string;
}

/** RRF 融合：k=60 惯例；多榜命中者按名次累加 1/(k+rank) */
export function mergeRrf<T>(lists: Array<Array<RrfCandidate<T>>>, k = 60): Array<{ item: T; score: number }> {
  const scores = new Map<string, { item: T; score: number }>();
  for (const list of lists) {
    list.forEach((entry, idx) => {
      const rank = idx + 1;
      const add = 1 / (k + rank);
      const prev = scores.get(entry.key);
      if (prev) prev.score += add;
      else scores.set(entry.key, { item: entry.item, score: add });
    });
  }
  return [...scores.values()].sort((a, b) => b.score - a.score);
}

export function vectorToBlob(vec: number[]): Uint8Array {
  const f = new Float32Array(vec);
  return new Uint8Array(f.buffer, f.byteOffset, f.byteLength);
}

export function blobToVector(blob: Uint8Array): Float32Array | null {
  if (!blob || blob.byteLength === 0 || blob.byteLength % 4 !== 0) return null;
  const copy = blob.slice().buffer;
  return new Float32Array(copy);
}
