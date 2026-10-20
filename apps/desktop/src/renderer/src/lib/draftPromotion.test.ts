/**
 * 草稿转正判定回归（2026-10-20 用户实报：新建会话发送消息后左侧出现两个会话栏）。
 * 草稿与 DB 会话共用 sessionId（prewarm 预落行），首条消息后必须摘草稿。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { promotableDraftIds } from './draftPromotion.ts';

describe('promotableDraftIds（草稿转正）', () => {
  it('有对话且 DB 已有同 id 行 → 转正（摘草稿）', () => {
    assert.deepEqual(
      promotableDraftIds({
        draftIds: ['a'],
        hasDialogue: (id) => id === 'a',
        dbIds: new Set(['a']),
      }),
      ['a'],
    );
  });

  it('prewarm 已预落 DB 行但草稿还没内容 → 不摘（用户还在编辑，别干掉草稿）', () => {
    assert.deepEqual(
      promotableDraftIds({
        draftIds: ['a'],
        hasDialogue: () => false,
        dbIds: new Set(['a']),
      }),
      [],
    );
  });

  it('草稿有内容但 DB 还没行（prewarm 失败/未启用）→ 不摘（lazy-create 尚未发生）', () => {
    assert.deepEqual(
      promotableDraftIds({
        draftIds: ['a'],
        hasDialogue: () => true,
        dbIds: new Set<string>(),
      }),
      [],
    );
  });

  it('多草稿各判各的；id 不匹配不误摘', () => {
    assert.deepEqual(
      promotableDraftIds({
        draftIds: ['a', 'b', 'c'],
        hasDialogue: (id) => id !== 'c',
        dbIds: new Set(['a', 'z']),
      }),
      ['a'],
    );
  });

  it('无草稿 → 空', () => {
    assert.deepEqual(
      promotableDraftIds({ draftIds: [], hasDialogue: () => true, dbIds: new Set(['a']) }),
      [],
    );
  });
});
