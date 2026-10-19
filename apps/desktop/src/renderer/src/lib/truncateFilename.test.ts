/** 文件名中段截断拆分规格。node --test 直跑。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitFilenameTail } from './truncateFilename.ts';

test('短名不丢字符（head+tail===name，视觉上无截断）', () => {
  for (const n of ['a.png', '报告.md']) {
    const { head, tail } = splitFilenameTail(n);
    assert.equal(head + tail, n);
    assert.ok(tail.length > 0);
  }
});

test('长名保住扩展名 + 末段词干，前段交 CSS truncate', () => {
  const { head, tail } = splitFilenameTail('2026年第三季度运维巡检报告终稿v3.docx');
  assert.ok(tail.endsWith('.docx'));
  assert.ok(tail.length >= 5 && tail.length <= 9);
  assert.ok(head.length > 0);
  assert.equal(head + tail, '2026年第三季度运维巡检报告终稿v3.docx');
});

test('dotfile / 无扩展 / 双扩展', () => {
  // dotfile：无「非位点」→ 按无扩展处理，不丢字符
  const dot = splitFilenameTail('.environmentrc');
  assert.ok(dot.head + dot.tail === '.environmentrc' && dot.tail.length > 0);
  // 无扩展长名：末 4 字符保底
  const noext = splitFilenameTail('这是一段很长的没有扩展名的文件标题');
  assert.equal(noext.tail, noext.tail.slice(-4));
  assert.ok(noext.head.length > 0);
  // 双扩展取最后一个点
  const tar = splitFilenameTail('backup-2026-10-19-full.tar.gz');
  assert.ok(tar.tail.endsWith('.gz'));
});
