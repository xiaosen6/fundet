/**
 * 钉钉组件板未就绪态判定回归（2026-10-20 UI 走查修复）。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dwsConnectionBroken, dwsDisabledTitle } from './dwsState.ts';

const snap = (disabledKind: 'not-installed' | 'not-logged-in' | 'expired' | 'auth-failed' | undefined) =>
  ({ state: 'disabled' as const, disabledKind });

describe('dwsConnectionBroken（是否亮警示）', () => {
  it('过期 / 授权失效 = 本来能用现在断了 → 亮', () => {
    assert.equal(dwsConnectionBroken(snap('expired')), true);
    assert.equal(dwsConnectionBroken(snap('auth-failed')), true);
  });

  it('未装 / 未登录 = 没配过 → 不亮（常驻警示会变噪音）', () => {
    assert.equal(dwsConnectionBroken(snap('not-installed')), false);
    assert.equal(dwsConnectionBroken(snap('not-logged-in')), false);
  });

  it('ready 永不亮', () => {
    assert.equal(dwsConnectionBroken({ state: 'ready' }), false);
  });

  it('老主进程没给 disabledKind 时不误报「已失效」', () => {
    assert.equal(dwsConnectionBroken(snap(undefined)), false);
  });
});

describe('dwsDisabledTitle（占位卡标题）', () => {
  it('断了 → 连接已失效', () => {
    assert.equal(dwsDisabledTitle(snap('expired')), '钉钉连接已失效');
    assert.equal(dwsDisabledTitle(snap('auth-failed')), '钉钉连接已失效');
  });

  it('未装 → 安装引导', () => {
    assert.equal(dwsDisabledTitle(snap('not-installed')), '还没安装钉钉 CLI');
  });

  it('未登录 / unknown → 登录引导', () => {
    assert.equal(dwsDisabledTitle(snap('not-logged-in')), '钉钉还没登录');
    assert.equal(dwsDisabledTitle(snap(undefined)), '钉钉还没登录');
  });
});
