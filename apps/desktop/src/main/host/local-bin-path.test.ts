import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ensureUserLocalBinOnPath, withPathEntry } from './local-bin-path.ts';

describe('withPathEntry', () => {
  it('PATH 里已有该目录 → 原样返回（幂等）', () => {
    assert.equal(withPathEntry('/usr/bin:/home/u/.local/bin', '/home/u/.local/bin', 'linux'), '/usr/bin:/home/u/.local/bin');
    assert.equal(withPathEntry('/home/u/.local/bin:/usr/bin', '/home/u/.local/bin', 'linux'), '/home/u/.local/bin:/usr/bin');
  });

  it('缺失时追加到末尾，不改变已有条目的先后', () => {
    assert.equal(withPathEntry('/usr/bin', '/home/u/.local/bin', 'linux'), '/usr/bin:/home/u/.local/bin');
  });

  it('Windows：分号分隔、大小写与斜杠方向不敏感、尾斜杠不计', () => {
    assert.equal(
      withPathEntry('C:\\Windows;C:\\Users\\U\\.local\\bin\\', 'c:\\users\\u\\.local\\bin', 'win32'),
      'C:\\Windows;C:\\Users\\U\\.local\\bin\\',
    );
    assert.equal(
      withPathEntry('C:\\Windows', 'C:\\Users\\U\\.local\\bin', 'win32'),
      'C:\\Windows;C:\\Users\\U\\.local\\bin',
    );
  });

  it('PATH 为空或未设置 → 直接成为该目录', () => {
    assert.equal(withPathEntry(undefined, '/x/.local/bin', 'linux'), '/x/.local/bin');
    assert.equal(withPathEntry('', '/x/.local/bin', 'linux'), '/x/.local/bin');
  });

  it('只认整段目录，不做前缀匹配（.local/bin-extra 不算命中）', () => {
    assert.equal(
      withPathEntry('/home/u/.local/bin-extra', '/home/u/.local/bin', 'linux'),
      '/home/u/.local/bin-extra:/home/u/.local/bin',
    );
  });
});

describe('ensureUserLocalBinOnPath', () => {
  it('写入进程环境（统一成大写 PATH 键），再次调用不重复追加', () => {
    const env: NodeJS.ProcessEnv = { Path: '/usr/bin' };
    assert.equal(ensureUserLocalBinOnPath({ home: '/home/u', env, platform: 'linux' }), true);
    assert.equal(env.PATH, '/usr/bin:/home/u/.local/bin');
    assert.equal(env.Path, undefined);
    assert.equal(ensureUserLocalBinOnPath({ home: '/home/u', env, platform: 'linux' }), false);
    assert.equal(env.PATH, '/usr/bin:/home/u/.local/bin');
  });

  it('目录已在 PATH 上 → 不动环境', () => {
    const env: NodeJS.ProcessEnv = { PATH: 'C:\\Windows;C:\\Users\\U\\.local\\bin' };
    assert.equal(ensureUserLocalBinOnPath({ home: 'C:\\Users\\U', env, platform: 'win32' }), false);
    assert.equal(env.PATH, 'C:\\Windows;C:\\Users\\U\\.local\\bin');
  });
});
