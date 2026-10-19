/**
 * CJK 输入法 Enter 守卫纯逻辑：组词中让位 / 229 让位 / WebKit 组词后 500ms
 * 合成 Enter 拦截（含 beforeinput 换行判定）。node --test 直跑。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decideEnterGuard,
  isGuardedNewlineInsert,
  isWebKitEngine,
  IME_POST_COMPOSITION_GUARD_MS,
} from './imeEnterGuard.ts';

const base = {
  key: 'Enter',
  isComposing: false,
  compositionEndedAt: null as number | null,
  now: 10_000,
  webkit: true,
};

test('组词中 / keyCode 229：整键让位给输入法', () => {
  assert.deepEqual(decideEnterGuard({ ...base, isComposing: true }), { action: 'yield-to-ime' });
  assert.deepEqual(decideEnterGuard({ ...base, keyCode: 229 }), { action: 'yield-to-ime' });
});

test('WebKit 组词后 500ms 内裸 Enter 拦截；Shift+Enter 放行', () => {
  const endedAt = 10_000 - 499;
  assert.deepEqual(decideEnterGuard({ ...base, compositionEndedAt: endedAt }), {
    action: 'block-and-swallow-newline',
  });
  assert.deepEqual(decideEnterGuard({ ...base, compositionEndedAt: 10_000 - IME_POST_COMPOSITION_GUARD_MS }), {
    action: 'pass',
  });
  assert.deepEqual(
    decideEnterGuard({ ...base, compositionEndedAt: endedAt, shiftKey: true }),
    { action: 'pass' },
  );
});

test('非 WebKit（Electron/Chromium）不受 500ms 窗口影响', () => {
  assert.deepEqual(
    decideEnterGuard({ ...base, webkit: false, compositionEndedAt: 10_000 - 100 }),
    { action: 'pass' },
  );
  assert.equal(isWebKitEngine('Google Inc.'), false);
  assert.equal(isWebKitEngine('Apple Computer, Inc.'), true);
});

test('非 Enter 键 / 未见组词一律放行', () => {
  assert.deepEqual(decideEnterGuard({ ...base, key: 'a' }), { action: 'pass' });
  assert.deepEqual(decideEnterGuard({ ...base, key: 'Escape' }), { action: 'pass' });
  assert.deepEqual(decideEnterGuard(base), { action: 'pass' });
});

test('beforeinput 只拦段落/换行插入', () => {
  assert.equal(isGuardedNewlineInsert('insertParagraph'), true);
  assert.equal(isGuardedNewlineInsert('insertLineBreak'), true);
  assert.equal(isGuardedNewlineInsert('insertText'), false);
  assert.equal(isGuardedNewlineInsert('deleteContentBackward'), false);
});
