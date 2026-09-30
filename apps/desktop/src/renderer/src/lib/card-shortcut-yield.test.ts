import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decideCardShortcutYield } from './card-shortcut-yield.ts';

const base = {
  alreadyHandled: false,
  focusEditable: false,
  inOutsideLayer: false,
  focusInteractive: false,
  insideOwner: false,
};

test('无人认领的按键（body 焦点）不让位——快捷键生效', () => {
  assert.equal(decideCardShortcutYield(base, 'activate'), false);
  assert.equal(decideCardShortcutYield(base, 'dismiss'), false);
  assert.equal(decideCardShortcutYield(base, 'character'), false);
});

test('已被处理或输入法组字中的按键让位', () => {
  assert.equal(decideCardShortcutYield({ ...base, alreadyHandled: true }, 'activate'), true);
  assert.equal(decideCardShortcutYield({ ...base, alreadyHandled: true }, 'dismiss'), true);
});

test('焦点在可编辑控件（侧栏搜索等）让位——打数字不选提问选项', () => {
  assert.equal(decideCardShortcutYield({ ...base, focusEditable: true }, 'character'), true);
  assert.equal(decideCardShortcutYield({ ...base, focusEditable: true }, 'dismiss'), true);
});

test('卡片外的浮层（菜单/弹层/对话框）让位——Esc 关菜单不顺带拒绝审批', () => {
  assert.equal(decideCardShortcutYield({ ...base, inOutsideLayer: true }, 'dismiss'), true);
  assert.equal(decideCardShortcutYield({ ...base, inOutsideLayer: true }, 'character'), true);
});

test('卡片外的按钮/链接让位——按键属于那个界面', () => {
  assert.equal(decideCardShortcutYield({ ...base, focusInteractive: true, insideOwner: false }, 'dismiss'), true);
  assert.equal(decideCardShortcutYield({ ...base, focusInteractive: true, insideOwner: false }, 'character'), true);
  assert.equal(decideCardShortcutYield({ ...base, focusInteractive: true, insideOwner: false }, 'activate'), true);
});

test('卡片自己的按钮：普通回车让给控件原生激活（拒绝上回车=拒绝），修饰键组合仍归卡片', () => {
  const own = { ...base, focusInteractive: true, insideOwner: true };
  assert.equal(decideCardShortcutYield(own, 'activate'), true);
  assert.equal(decideCardShortcutYield(own, 'modifiedActivate'), false);
  assert.equal(decideCardShortcutYield(own, 'dismiss'), false);
  assert.equal(decideCardShortcutYield(own, 'character'), false);
});
