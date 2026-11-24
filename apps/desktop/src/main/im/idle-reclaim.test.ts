import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decideIdleReclaims } from './idle-reclaim.ts';

const NOW = 1_000_000;
const IDLE = 30 * 60 * 1000;

const settings: Record<string, string> = {
  'im.session.wecom.chatA': 'sess-a',
  'im.session.dingtalk.chatB': 'sess-b',
  // chatC 没有映射（值缺失）
};

describe('decideIdleReclaims（2026-11-24 修复回归：key 不再带双重前缀）', () => {
  it('超时的按 key 直查映射（key 已是 im.session.* 形态）；未到时不收', () => {
    const r = decideIdleReclaims(
      [
        { key: 'im.session.wecom.chatA', lastActive: NOW - IDLE - 1 },
        { key: 'im.session.dingtalk.chatB', lastActive: NOW - IDLE + 60_000 },
      ],
      NOW,
      IDLE,
      (k) => settings[k] ?? null,
    );
    assert.deepEqual(r, { sessionIds: ['sess-a'], staleKeys: [] });
  });

  it('值缺失的 key 进 staleKeys（只摘活跃表条目，不误当会话 id 去关）', () => {
    const r = decideIdleReclaims(
      [{ key: 'im.session.wecom.chatC', lastActive: NOW - IDLE * 2 }],
      NOW,
      IDLE,
      (k) => settings[k] ?? null,
    );
    assert.deepEqual(r, { sessionIds: [], staleKeys: ['im.session.wecom.chatC'] });
  });

  it('修复前的行为对照：旧实现查 `im.session.${key}` 永远 miss', () => {
    const legacyGet = (key: string): string | null => settings[`im.session.${key}`] ?? null;
    assert.equal(legacyGet('im.session.wecom.chatA'), null);
  });

  it('空表安全；全部未超时返回空', () => {
    assert.deepEqual(decideIdleReclaims([], NOW, IDLE, () => null), { sessionIds: [], staleKeys: [] });
    assert.deepEqual(
      decideIdleReclaims([{ key: 'im.session.wecom.chatA', lastActive: NOW }], NOW, IDLE, (k) => settings[k] ?? null),
      { sessionIds: [], staleKeys: [] },
    );
  });
});
