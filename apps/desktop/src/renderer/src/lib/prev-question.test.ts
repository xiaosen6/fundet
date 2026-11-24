import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { prevUserRowIndex, userRowIndexes } from './prev-question.ts';

const rows = [
  { kind: 'user' },        // 0
  { kind: 'assistant' },   // 1
  { kind: 'tool' },        // 2（todo 行已从 rows 剔除，不会出现 kind:'todo'）
  { kind: 'genfiles' },    // 3（产物卡伪行：grouped 里没有——旧实现偏移的根源）
  { kind: 'assistant' },   // 4
  { kind: 'user' },        // 5
  { kind: 'turnchanges' }, // 6（轮末改动卡伪行）
  { kind: 'assistant' },   // 7
];

describe('userRowIndexes（rows 口径）', () => {
  it('只收 user 行的 rows 下标', () => {
    assert.deepEqual(userRowIndexes(rows), [0, 5]);
  });

  it('空表/无 user 行返回空', () => {
    assert.deepEqual(userRowIndexes([]), []);
    assert.deepEqual(userRowIndexes([{ kind: 'assistant' }]), []);
  });
});

describe('prevUserRowIndex（视口上方最近提问）', () => {
  it('普通场景：视口从伪行之后开始也能对上（修复前 grouped 口径会偏到 2→找不到/错行）', () => {
    // 视口首行 = 4（assistant）：上方最近 user = 5? 不——5 不小于 4，取 0
    assert.equal(prevUserRowIndex(userRowIndexes(rows), 4), 0);
    // 视口首行 = 6（turnchanges 伪行）：上方最近 user = 5
    assert.equal(prevUserRowIndex(userRowIndexes(rows), 6), 5);
    // 视口首行 = 7：仍是 5
    assert.equal(prevUserRowIndex(userRowIndexes(rows), 7), 5);
  });

  it('视口在首个提问之前 → -1；正好压在提问上 → 前一个', () => {
    assert.equal(prevUserRowIndex(userRowIndexes(rows), 0), -1);
    assert.equal(prevUserRowIndex(userRowIndexes(rows), 5), 0);
  });
});
