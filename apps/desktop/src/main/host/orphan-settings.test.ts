import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decideOrphanSettingKeys, sessionKeyOwner } from './orphan-settings.ts';

describe('sessionKeyOwner（键里的会话 id 位置）', () => {
  it('kb.session.*：会话 id 在键名后缀', () => {
    assert.equal(sessionKeyOwner({ key: 'kb.session.abc-123', value: null }), 'abc-123');
  });

  it('im.session.*：会话 id 在值里（键名后缀是渠道 chatId，不是会话 id）', () => {
    assert.equal(sessionKeyOwner({ key: 'im.session.wecom.oc_abc123', value: 'sess-1' }), 'sess-1');
    assert.equal(sessionKeyOwner({ key: 'im.session.dingtalk.cid_888', value: ' sess-2 ' }), 'sess-2');
  });

  it('im.session 值缺失/空白 → null（按孤儿清掉）', () => {
    assert.equal(sessionKeyOwner({ key: 'im.session.wecom.x', value: null }), null);
    assert.equal(sessionKeyOwner({ key: 'im.session.wecom.x', value: '   ' }), null);
  });

  it('kb.session 空后缀 → null；其它键不认（调用方 LIKE 已过滤，双保险）', () => {
    assert.equal(sessionKeyOwner({ key: 'kb.session.', value: null }), null);
    assert.equal(sessionKeyOwner({ key: 'voice.enabled', value: '1' }), null);
  });
});

describe('decideOrphanSettingKeys（2026-11-24 修复回归：IM 映射不再被启动清扫删光）', () => {
  const rows = [
    { key: 'im.session.wecom.chatA', value: 'sess-alive' },
    { key: 'im.session.dingtalk.chatB', value: 'sess-dead' },
    { key: 'im.session.feishu.chatC', value: null },
    { key: 'kb.session.sess-alive', value: '["kb1"]' },
    { key: 'kb.session.sess-gone', value: '["kb1"]' },
  ];
  const valid = new Set(['sess-alive']);

  it('只删关联会话确实不存在的键；IM 映射按值判定', () => {
    assert.deepEqual(decideOrphanSettingKeys(rows, valid), [
      'im.session.dingtalk.chatB',
      'im.session.feishu.chatC',
      'kb.session.sess-gone',
    ]);
  });

  it('修复前的行为对照：按键名后缀判定会把全部 im.session.* 误判成孤儿', () => {
    const legacyJudge = (row: { key: string }) => row.key.replace(/^kb\.session\./, '').replace(/^im\.session\.[^.]+\./, '');
    const legacyOrphans = rows.filter((r) => !valid.has(legacyJudge(r))).map((r) => r.key);
    // 旧实现：chatA/chatB/chatC 全部命中（键名后缀是 chatId，不在 sessions 表）
    assert.deepEqual(legacyOrphans.slice(0, 3), [
      'im.session.wecom.chatA',
      'im.session.dingtalk.chatB',
      'im.session.feishu.chatC',
    ]);
  });

  it('空集/全有效 → 不删', () => {
    assert.deepEqual(decideOrphanSettingKeys([], valid), []);
    assert.deepEqual(
      decideOrphanSettingKeys([{ key: 'im.session.wecom.x', value: 'sess-alive' }], valid),
      [],
    );
  });
});
