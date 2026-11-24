import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_OFFICE_PROVIDER,
  LEGACY_OFFICE_PROVIDER,
  OFFICE_PROVIDER_META,
  normalizeOfficeProvider,
  officeSupportedWidgets,
} from './office-cli.ts';

describe('normalizeOfficeProvider', () => {
  it('缺省是企业微信（用户拍板：默认企微 CLI）', () => {
    assert.equal(DEFAULT_OFFICE_PROVIDER, 'wecom');
    assert.equal(normalizeOfficeProvider(undefined), 'wecom');
    assert.equal(normalizeOfficeProvider(null), 'wecom');
    assert.equal(normalizeOfficeProvider(''), 'wecom');
  });

  it('脏值回落缺省，不抛错', () => {
    assert.equal(normalizeOfficeProvider('feishu'), 'wecom');
    assert.equal(normalizeOfficeProvider(42), 'wecom');
    assert.equal(normalizeOfficeProvider({}), 'wecom');
  });

  it('钉钉原样保留', () => {
    assert.equal(normalizeOfficeProvider('dingtalk'), 'dingtalk');
  });
});

describe('officeSupportedWidgets', () => {
  it('企业微信只有日程与待办（CLI 没有审批 / 未读会话接口）', () => {
    assert.deepEqual([...officeSupportedWidgets('wecom')], ['calendar', 'todos']);
  });

  it('钉钉四卡齐全，顺序固定', () => {
    assert.deepEqual([...officeSupportedWidgets('dingtalk')], ['calendar', 'todos', 'approvals', 'unread']);
  });
});

describe('OFFICE_PROVIDER_META', () => {
  it('两家元数据齐备，命令名与技能前缀互不串', () => {
    assert.equal(OFFICE_PROVIDER_META.wecom.cli, 'wecom-cli');
    assert.equal(OFFICE_PROVIDER_META.dingtalk.cli, 'dws');
    assert.equal(OFFICE_PROVIDER_META.wecom.skillPrefix, 'wecomcli-');
    assert.equal(OFFICE_PROVIDER_META.dingtalk.skillPrefix, 'dingtalk-');
    for (const meta of Object.values(OFFICE_PROVIDER_META)) {
      assert.ok(meta.label && meta.workspace && meta.repoUrl.startsWith('https://'));
    }
  });

  it('老快照（无 provider 字段）按钉钉解读，保持字段出现前的行为', () => {
    assert.equal(LEGACY_OFFICE_PROVIDER, 'dingtalk');
  });
});
