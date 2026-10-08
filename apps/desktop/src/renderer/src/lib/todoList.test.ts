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
