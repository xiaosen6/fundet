import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blobToVector, cosineSimilarity, mergeRrf, vectorToBlob } from './embeddings-logic.ts';

test('cosineSimilarity：同向 1 / 正交 0 / 反向 -1 / 零向量 0', () => {
  assert.ok(Math.abs(cosineSimilarity([1, 2, 3], [2, 4, 6]) - 1) < 1e-6);
  assert.ok(Math.abs(cosineSimilarity([1, 0], [0, 1])) < 1e-6);
  assert.ok(Math.abs(cosineSimilarity([1, 0], [-1, 0]) + 1) < 1e-6);
  assert.equal(cosineSimilarity([0, 0], [1, 1]), 0);
});

test('mergeRrf：双榜命中者得分最高；名次越靠前贡献越大', () => {
  const merged = mergeRrf<string>([
    [
      { item: 'A', key: 'a' },
      { item: 'B', key: 'b' },
    ],
    [
      { item: 'C', key: 'c' },
      { item: 'A', key: 'a' },
    ],
  ]);
  assert.equal(merged[0]?.item, 'A'); // 双榜命中
  const a = merged.find((m) => m.item === 'A')!.score;
  const c = merged.find((m) => m.item === 'C')!.score;
  assert.ok(a > c); // A 两榜累计 > C 单榜第一
});

test('vector blob 往返：Float32 精确保留（2560 维模拟）', () => {
  const vec = Array.from({ length: 2560 }, (_, i) => Math.sin(i / 100) * 0.5);
  const blob = vectorToBlob(vec);
  assert.equal(blob.byteLength, 2560 * 4);
  const back = blobToVector(blob);
  assert.equal(back?.length, 2560);
  for (let i = 0; i < 2560; i += 250) {
    assert.ok(Math.abs((back ?? [])[i] - vec[i]) < 1e-7);
  }
  // 非法 blob → null
  assert.equal(blobToVector(new Uint8Array(7)), null);
  assert.equal(blobToVector(new Uint8Array(0)), null);
});
