import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MIN_NAVIGATOR_USERS,
  activeUserMarkIndex,
  minimapMarks,
  navigatorPreview,
  visibleIndexRange,
} from './messageNavigator.ts';

test('minimapMarks：行序线性映射（首行 0、中间 50、末行 100）', () => {
  const marks = minimapMarks([0, 5, 10], 11);
  assert.deepEqual(marks, [
    { index: 0, topPercent: 0 },
    { index: 5, topPercent: 50 },
    { index: 10, topPercent: 100 },
  ]);
});

test('minimapMarks：单行/空列表防除零', () => {
  assert.deepEqual(minimapMarks([0], 1), [{ index: 0, topPercent: 0 }]);
  assert.deepEqual(minimapMarks([], 0), []);
});

test('minimapMarks：index 越界钳在 0~100', () => {
  assert.equal(minimapMarks([9], 5)[0]?.topPercent, 100);
  assert.equal(minimapMarks([0], 5)[0]?.topPercent, 0);
});

test('visibleIndexRange：剥掉 overscan，取真实相交范围', () => {
  const items = [
    { index: 0, start: 0, end: 100 },
    { index: 1, start: 100, end: 200 },
    { index: 2, start: 200, end: 300 },
  ];
  // 视口 [120, 220]：行 0 已滚出（end 100 < 124），行 2 顶部 200 ≤ 216 相交
  assert.deepEqual(visibleIndexRange(items, 120, 100), { first: 1, last: 2 });
  // 视口 [0, 150]：行 2 顶部 200 > 146 不算（overscan 多渲染的不计）
  assert.deepEqual(visibleIndexRange(items, 0, 150), { first: 0, last: 1 });
});

test('visibleIndexRange：视口在内容上方/空列表返回 null', () => {
  const items = [{ index: 0, start: 500, end: 600 }];
  assert.equal(visibleIndexRange(items, 0, 400), null);
  assert.equal(visibleIndexRange([], 0, 400), null);
});

test('activeUserMarkIndex：视口内多条 user 取最后一条', () => {
  assert.equal(activeUserMarkIndex([2, 7, 12, 20], 15), 12);
});

test('activeUserMarkIndex：视口落在两条 user 之间取上方最近一条（正在读的那轮）', () => {
  assert.equal(activeUserMarkIndex([2, 7, 12], 9), 7);
});

test('activeUserMarkIndex：视口越过全部 user 取末条；在首条之前返回 null', () => {
  assert.equal(activeUserMarkIndex([2, 7], 100), 7);
  assert.equal(activeUserMarkIndex([4, 8], 2), null);
});

test('navigatorPreview：首个非空行 trim 后截断', () => {
  assert.equal(navigatorPreview('  \n  你好 \n第二行'), '你好');
  assert.equal(navigatorPreview('a'.repeat(80)), 'a'.repeat(60));
  assert.equal(navigatorPreview('   \n\t\n'), '');
  assert.equal(navigatorPreview('x'.repeat(10), 5), 'xxxxx');
});

test('MIN_NAVIGATOR_USERS：≥5 条 user 消息才显示', () => {
  assert.equal(MIN_NAVIGATOR_USERS, 5);
});
