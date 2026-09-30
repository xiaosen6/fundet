import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isWindowWatching, shouldNotifyCompletion } from './completion-notify-logic.ts';

function fakeWin(state: { visible?: boolean; focused?: boolean; minimized?: boolean } = {}) {
  return {
    isVisible: () => state.visible ?? true,
    isFocused: () => state.focused ?? true,
    isMinimized: () => state.minimized ?? false,
  };
}

test('isWindowWatching：可见+聚焦+未最小化 = 注视', () => {
  assert.equal(isWindowWatching(fakeWin({ visible: true, focused: true, minimized: false })), true);
});

test('isWindowWatching：最小化时即使焦点簿记未清也不算注视（Windows 自最小化 isFocused 可仍为 true）', () => {
  assert.equal(isWindowWatching(fakeWin({ visible: true, focused: true, minimized: true })), false);
});

test('isWindowWatching：隐藏或失焦不算注视；窗口不存在为 null（仍提醒）', () => {
  assert.equal(isWindowWatching(fakeWin({ visible: false, focused: false })), false);
  assert.equal(isWindowWatching(fakeWin({ visible: true, focused: false })), false);
  assert.equal(isWindowWatching(null), null);
});

test('shouldNotifyCompletion：开关关不提醒；注视中不提醒；其余都提醒', () => {
  assert.equal(shouldNotifyCompletion({ enabled: false, mainWindowFocused: null }), false);
  assert.equal(shouldNotifyCompletion({ enabled: false, mainWindowFocused: false }), false);
  assert.equal(shouldNotifyCompletion({ enabled: true, mainWindowFocused: true }), false);
  assert.equal(shouldNotifyCompletion({ enabled: true, mainWindowFocused: false }), true);
  assert.equal(shouldNotifyCompletion({ enabled: true, mainWindowFocused: null }), true);
});
