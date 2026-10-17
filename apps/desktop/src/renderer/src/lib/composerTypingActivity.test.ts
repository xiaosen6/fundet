/**
 * composer 打字活动窗口（Cindy #5a5004446 移植）：窗口内合帧拉长、过期回落。
 * node --test 直跑（无 Electron 依赖；时钟注入靠 Date.now 桩）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  __resetComposerTypingActivityForTest,
  isComposerTypingRecently,
  markComposerTypingActivity,
} from './composerTypingActivity.ts';

test('打字窗口：标记后 800ms 内为真，过期回落', () => {
  __resetComposerTypingActivityForTest();
  const realNow = Date.now;
  let now = 1000;
  Date.now = () => now;
  try {
    assert.equal(isComposerTypingRecently(), false);
    markComposerTypingActivity();
    assert.equal(isComposerTypingRecently(), true);
    now += 799;
    assert.equal(isComposerTypingRecently(), true);
    now += 2;
    assert.equal(isComposerTypingRecently(), false);
  } finally {
    Date.now = realNow;
    __resetComposerTypingActivityForTest();
  }
});

test('重打即续窗（连续按键窗口不断）', () => {
  __resetComposerTypingActivityForTest();
  const realNow = Date.now;
  let now = 5000;
  Date.now = () => now;
  try {
    markComposerTypingActivity();
    for (let i = 0; i < 10; i++) {
      now += 500;
      markComposerTypingActivity();
      assert.equal(isComposerTypingRecently(), true);
    }
    now += 801;
    assert.equal(isComposerTypingRecently(), false);
  } finally {
    Date.now = realNow;
    __resetComposerTypingActivityForTest();
  }
});
