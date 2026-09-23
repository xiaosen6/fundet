import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PREWARM_TTL_MS,
  computePrewarmFingerprint,
  decidePrewarmAttach,
} from './session-prewarm-logic.ts';

const baseInput = { sessionId: 's1', providerId: 'prov1', workDir: 'D:\\work' };

test('decideAttach：无记录 = none（真实会话原语义，永不触碰）', () => {
  assert.equal(
    decidePrewarmAttach({ hasRecord: false, alive: true, fingerprintMatch: true, expiredAndEmpty: false }),
    'none',
  );
});

test('decideAttach：记录在 + 活会话 + 指纹一致 + 未过期 = attach', () => {
  assert.equal(
    decidePrewarmAttach({ hasRecord: true, alive: true, fingerprintMatch: true, expiredAndEmpty: false }),
    'attach',
  );
});

test('decideAttach：会话已死 / 指纹漂移 / 超时零消息 → discard', () => {
  assert.equal(
    decidePrewarmAttach({ hasRecord: true, alive: false, fingerprintMatch: true, expiredAndEmpty: false }),
    'discard',
  );
  assert.equal(
    decidePrewarmAttach({ hasRecord: true, alive: true, fingerprintMatch: false, expiredAndEmpty: false }),
    'discard',
  );
  assert.equal(
    decidePrewarmAttach({ hasRecord: true, alive: true, fingerprintMatch: true, expiredAndEmpty: true }),
    'discard',
  );
});

test('指纹：KB 绑定 ID 顺序无关，钉钉开关/自动操作开关参与', () => {
  const f1 = computePrewarmFingerprint({
    ...baseInput,
    getBinding: () => ({ ids: ['kb-a', 'kb-b'] }),
  });
  const f2 = computePrewarmFingerprint({
    ...baseInput,
    getBinding: () => ({ ids: ['kb-b', 'kb-a'] }),
  });
  assert.equal(f1, f2, 'KB ID 排序后应一致');

  const withDingtalk = computePrewarmFingerprint({
    ...baseInput,
    getBinding: () => ({ ids: ['kb-a'], dingtalk: true }),
  });
  assert.notEqual(f1, withDingtalk);

  const browserOn = computePrewarmFingerprint({
    ...baseInput,
    getBinding: () => ({ ids: [] }),
    boolSetting: (key) => key === 'browser.enabled',
  });
  const allOff = computePrewarmFingerprint({ ...baseInput, getBinding: () => ({ ids: [] }) });
  assert.notEqual(browserOn, allOff);
});

test('指纹：provider/工作目录变化即漂移（模型不在指纹里——setModel 热切）', () => {
  const f1 = computePrewarmFingerprint(baseInput);
  assert.notEqual(f1, computePrewarmFingerprint({ ...baseInput, providerId: 'prov2' }));
  assert.notEqual(f1, computePrewarmFingerprint({ ...baseInput, workDir: 'D:\\other' }));
});

test('TTL 为 5 分钟（与实现注释一致）', () => {
  assert.equal(PREWARM_TTL_MS, 5 * 60_000);
});
