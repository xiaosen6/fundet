import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoSessionTitle } from './session-title.ts';

test('自动标题压平空白并保留中文正文', () => {
  assert.equal(autoSessionTitle('  帮我\n查一下   今天的日程 '), '帮我 查一下 今天的日程');
});

test('去掉首尾代码围栏与行首 Markdown 标记', () => {
  assert.equal(autoSessionTitle('```ts\n帮我检查这个文件\n```'), '帮我检查这个文件');
  assert.equal(autoSessionTitle('## 整理本周周报'), '整理本周周报');
});

test('20 个 Unicode 码点截断，不切断 emoji 代理对', () => {
  const title = autoSessionTitle('一二三四五六七八九十abcdefghij🙂🚀');
  assert.equal(Array.from(title).length, 20);
  assert.equal(title, '一二三四五六七八九十abcdefghij');
  assert.equal(/[\uD800-\uDBFF]$/.test(title), false);
});

test('emoji 开头也按码点计数且有效', () => {
  assert.equal(autoSessionTitle('🙂🚀 看图说话'), '🙂🚀 看图说话');
});

test('纯排版符号不覆盖占位标题', () => {
  assert.equal(autoSessionTitle('```'), '');
  assert.equal(autoSessionTitle('--- ??? ###'), '');
  assert.equal(autoSessionTitle('   \n  '), '');
});
