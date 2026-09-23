import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import {
  computeGitFallbackEntries,
  prependPathEntries,
  setupBundledGitFallback,
} from './git-bash.ts';

const ROOT = 'C:\\app\\resources\\git\\win32-x64';
/** 全部目录/文件都「存在」的注入 fs（测分支逻辑，不测磁盘） */
const existsAll = () => true;
const existsNone = () => false;

test('非 win32 平台不动作', () => {
  assert.deepEqual(
    computeGitFallbackEntries({
      platform: 'darwin',
      bundledRoot: ROOT,
      systemGitPathEntries: [],
      gitReachableOnPath: false,
      currentPath: 'C:\\Windows',
      exists: existsAll,
    }),
    [],
  );
});

test('随包根缺失（未准备/目录被裁）不动作', () => {
  assert.deepEqual(
    computeGitFallbackEntries({
      platform: 'win32',
      bundledRoot: null,
      systemGitPathEntries: [],
      gitReachableOnPath: false,
      currentPath: undefined,
    }),
    [],
  );
});

test('系统 Git 可见（注册表/常见安装位命中）时不动作——用户自己的 Git 优先', () => {
  assert.deepEqual(
    computeGitFallbackEntries({
      platform: 'win32',
      bundledRoot: ROOT,
      systemGitPathEntries: ['C:\\Program Files\\Git\\cmd'],
      gitReachableOnPath: false,
      currentPath: 'C:\\Windows',
      exists: existsAll,
    }),
    [],
  );
});

test('PATH 上有 git 时不动作', () => {
  assert.deepEqual(
    computeGitFallbackEntries({
      platform: 'win32',
      bundledRoot: ROOT,
      systemGitPathEntries: [],
      gitReachableOnPath: true,
      currentPath: 'C:\\Windows',
      exists: existsAll,
    }),
    [],
  );
});

test('系统 Git 全不可见 → 前置 cmd 与 bin 两个目录', () => {
  assert.deepEqual(
    computeGitFallbackEntries({
      platform: 'win32',
      bundledRoot: ROOT,
      systemGitPathEntries: [],
      gitReachableOnPath: false,
      currentPath: 'C:\\Windows;C:\\Windows\\System32',
      exists: existsAll,
    }),
    [path.join(ROOT, 'cmd'), path.join(ROOT, 'bin')],
  );
});

test('目录不存在（bin 缺 bash.exe 且 cmd 缺 git.exe）不动作', () => {
  assert.deepEqual(
    computeGitFallbackEntries({
      platform: 'win32',
      bundledRoot: ROOT,
      systemGitPathEntries: [],
      gitReachableOnPath: false,
      currentPath: 'C:\\Windows',
      exists: existsNone,
    }),
    [],
  );
});

test('已在 PATH 里的目录不重复前置（大小写不敏感，幂等）', () => {
  assert.deepEqual(
    computeGitFallbackEntries({
      platform: 'win32',
      bundledRoot: ROOT,
      systemGitPathEntries: [],
      gitReachableOnPath: false,
      currentPath: `C:\\Windows;${path.join(ROOT, 'cmd').toUpperCase()}`,
      exists: existsAll,
    }),
    [path.join(ROOT, 'bin')],
  );
});

test('prependPathEntries：前置并保留原值', () => {
  assert.equal(
    prependPathEntries('C:\\Windows', ['C:\\git\\cmd', 'C:\\git\\bin']),
    'C:\\git\\cmd;C:\\git\\bin;C:\\Windows',
  );
  assert.equal(prependPathEntries(undefined, []), '');
});

test('setupBundledGitFallback：写 env.PATH（含大小写变体键清理）并返回条目', () => {
  const env: Record<string, string | undefined> = {
    Path: 'C:\\Windows',
    OTHER: 'x',
  };
  const entries = setupBundledGitFallback({
    platform: 'win32',
    bundledRoot: ROOT,
    systemGitPathEntries: [],
    gitReachable: false,
    env,
    exists: existsAll,
  });
  assert.deepEqual(entries, [path.join(ROOT, 'cmd'), path.join(ROOT, 'bin')]);
  assert.equal(env.PATH, `${path.join(ROOT, 'cmd')};${path.join(ROOT, 'bin')};C:\\Windows`);
  assert.equal(env.Path, undefined);
  assert.equal(env.OTHER, 'x');
});

test('setupBundledGitFallback：系统 Git 在时不改 env', () => {
  const env: Record<string, string | undefined> = { PATH: 'C:\\Windows' };
  const entries = setupBundledGitFallback({
    platform: 'win32',
    bundledRoot: ROOT,
    systemGitPathEntries: ['C:\\Program Files\\Git\\cmd'],
    gitReachable: false,
    env,
    exists: existsAll,
  });
  assert.deepEqual(entries, []);
  assert.equal(env.PATH, 'C:\\Windows');
});

test('FUNDET_FORCE_BUNDLED_GIT=1 无视系统 Git 强制启用（开发机实测通道）', () => {
  const env: Record<string, string | undefined> = {
    PATH: 'C:\\Windows',
    FUNDET_FORCE_BUNDLED_GIT: '1',
  };
  const entries = setupBundledGitFallback({
    platform: 'win32',
    bundledRoot: ROOT,
    systemGitPathEntries: ['C:\\Program Files\\Git\\cmd'],
    gitReachable: true,
    env,
    exists: existsAll,
  });
  assert.deepEqual(entries, [path.join(ROOT, 'cmd'), path.join(ROOT, 'bin')]);
});
