/**
 * 会话编辑态判定回归（2026-10-20 UI 走查修复）。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { editSubmitSettles, errorRetriable } from './sessionEditState.ts';

const user = (id: string) => ({ kind: 'user', id });
const assistant = (id: string) => ({ kind: 'assistant', id });
const error = (id: string) => ({ kind: 'error', id });

describe('errorRetriable（错误卡重发入口）', () => {
  it('最后一轮的错误卡可以重发', () => {
    assert.equal(errorRetriable([user('u1'), assistant('a1'), error('e1')], 'e1'), true);
  });

  it('旧轮错误卡不给按钮（其后还有新的 user 消息）——否则会重跑最新一轮', () => {
    const items = [user('u1'), error('e1'), user('u2'), assistant('a2')];
    assert.equal(errorRetriable(items, 'e1'), false);
  });

  it('同一轮里多个错误项都算最后一轮', () => {
    const items = [user('u1'), error('e1'), error('e2')];
    assert.equal(errorRetriable(items, 'e1'), true);
    assert.equal(errorRetriable(items, 'e2'), true);
  });

  it('不存在的 id 不给按钮', () => {
    assert.equal(errorRetriable([user('u1'), error('e1')], 'nope'), false);
  });

  it('没有任何 user 消息时错误卡仍可重发', () => {
    assert.equal(errorRetriable([error('e1')], 'e1'), true);
  });
});

describe('editSubmitSettles（编辑提交后是否收起编辑框）', () => {
  it('成功（true）收起', () => {
    assert.equal(editSubmitSettles(true), true);
  });

  it('失败（false）必须留在编辑态，草稿不能丢', () => {
    assert.equal(editSubmitSettles(false), false);
  });

  it('旧调用方返回 void 视作成功（向后兼容）', () => {
    assert.equal(editSubmitSettles(undefined), true);
  });
});
