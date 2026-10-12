import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTodoList } from './todoList.ts';

test('parseTodoList：完整清单', () => {
  const r = parseTodoList('[x] #1: 查资料\n[ ] #2: 写报告\n[ ] #3: 提交');
  assert.deepEqual(r, [
    { id: 1, text: '查资料', done: true },
    { id: 2, text: '写报告', done: false },
    { id: 3, text: '提交', done: false },
  ]);
});

test('parseTodoList：空清单/No todos 返回 null', () => {
  assert.equal(parseTodoList('No todos'), null);
  assert.equal(parseTodoList(''), null);
  assert.equal(parseTodoList(undefined), null);
});

test('parseTodoList：add/toggle 单行确认返回 null（回落普通工具卡）', () => {
  assert.equal(parseTodoList('Added todo #3: 买咖啡'), null);
  assert.equal(parseTodoList('Todo #2 completed'), null);
});

test('parseTodoList：混合行只收清单行', () => {
  const r = parseTodoList('header\n[x] #1: a\nnoise\n[ ] #2: b');
  assert.equal(r?.length, 2);
  assert.equal(r?.[0]?.text, 'a');
  assert.equal(r?.[1]?.done, false);
});

// ---------------------------------------------------------------------------
// 增量确认重放（pi todo 扩展实际输出形态，2026-10-12 用户 BM25 会话实锤）
// ---------------------------------------------------------------------------
import { applyTodoUpdate, parseTodoUpdate, replayTodoSnapshots } from './todoList.ts';

test('parseTodoUpdate：增量确认四态 + 全量快照 + 不认识 null', () => {
  assert.deepEqual(parseTodoUpdate('Added todo #3: 生成 PPT'), { kind: 'add', id: 3, text: '生成 PPT' });
  assert.deepEqual(parseTodoUpdate('Todo #3 completed'), { kind: 'complete', id: 3 });
  assert.deepEqual(parseTodoUpdate('Todo #3 uncompleted'), { kind: 'uncomplete', id: 3 });
  assert.deepEqual(parseTodoUpdate('Removed todo #3'), { kind: 'remove', id: 3 });
  assert.deepEqual(parseTodoUpdate('[x] #1: a\n[ ] #2: b'), {
    kind: 'snapshot',
    entries: [
      { id: 1, text: 'a', done: true },
      { id: 2, text: 'b', done: false },
    ],
  });
  assert.equal(parseTodoUpdate('No todos'), null);
  assert.equal(parseTodoUpdate('随便一句话'), null);
  assert.equal(parseTodoUpdate(undefined), null);
});

test('replayTodoSnapshots：用户 BM25 会话真实 8 条输出重放（计划卡根因用例）', () => {
  const snaps = replayTodoSnapshots([
    'Added todo #1: 梳理 BM25 + 嵌入模型结合的内容大纲',
    'Added todo #2: 生成 PPT（BM25 与嵌入模型结合）',
    'Added todo #3: 生成 Word 文档（BM25 与嵌入模型结合）',
    'Todo #2 completed',
    'Todo #3 completed',
    'Todo #3 uncompleted',
    'Todo #1 completed',
    'Todo #3 completed',
  ]);
  // 第 3 步后：3 项全未完成
  assert.deepEqual(
    snaps[2]!.map((e) => [e.id, e.done]),
    [[1, false], [2, false], [3, false]],
  );
  // 第 5 步后：#2 #3 完成
  assert.deepEqual(snaps[4]!.map((e) => [e.id, e.done]), [[1, false], [2, true], [3, true]]);
  // 最终：uncompleted 再 completed 回来，#1 也完成
  const final = snaps[7]!;
  assert.deepEqual(final.map((e) => [e.id, e.done]), [[1, true], [2, true], [3, true]]);
  // 每步快照与输入等长
  assert.equal(snaps.length, 8);
});

test('replayTodoSnapshots：无结果（进行中）与 No todos 状态沿用不炸', () => {
  const snaps = replayTodoSnapshots(['', undefined, 'Added todo #1: a', 'No todos']);
  assert.deepEqual(snaps[0], []);
  assert.deepEqual(snaps[1], []);
  assert.equal(snaps[3]!.length, 1);
  assert.equal(snaps[3]![0]!.done, false);
});

test('applyTodoUpdate：remove 后再 add 同号不复魂', () => {
  let s = applyTodoUpdate([], { kind: 'add', id: 1, text: 'a' });
  s = applyTodoUpdate(s, { kind: 'remove', id: 1 });
  assert.deepEqual(s, []);
  s = applyTodoUpdate(s, { kind: 'add', id: 1, text: 'b' });
  assert.deepEqual(s, [{ id: 1, text: 'b', done: false }]);
});
