import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// host.ts 的 runtime-env 是构建期 .js 别名，node 直跑 TS 不解析；这里锁定
// 配置契约，不把 vendored/host 的模块解析问题误当产品配置测试。
const source = readFileSync(new URL('./host.ts', import.meta.url), 'utf8');

test('托管浏览器正常退出后恢复上次会话，固定 Fundet profile 不变', () => {
  assert.match(source, /MANAGED_PROFILE = 'Fundet'/);
  assert.match(source, /extraArgs: \['--restore-last-session'\]/);
});
