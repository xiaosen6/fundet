import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertPreviewablePath,
  buildWin32SystemBlocklist,
} from './filePathPolicy.ts';

const winDeps = {
  platform: 'win32' as NodeJS.Platform,
  env: { SystemRoot: 'C:\\Windows', ProgramFiles: 'C:\\Program Files' },
  homeDir: 'C:\\Users\\tester',
  realpathSync: (p: string) => p,
};
const posixDeps = {
  platform: 'linux' as NodeJS.Platform,
  env: {},
  homeDir: '/home/tester',
  realpathSync: (p: string) => p,
};

test('filePathPolicy 预览守卫（deny-list）', async (t) => {
  await t.test('工作目录外普通路径放行（对齐 Cindy：agent 可引用任意盘路径）', () => {
    const out = assertPreviewablePath('D:\\other-drive\\pics\\a.png', winDeps);
    assert.equal(out, 'D:\\other-drive\\pics\\a.png');
  });

  await t.test('Windows 系统目录拦截', () => {
    assert.throws(() => assertPreviewablePath('C:\\Windows\\System32\\x.dll', winDeps), /系统目录/);
    assert.throws(() => assertPreviewablePath('C:\\Program Files\\app\\y.exe', winDeps), /系统目录/);
    // 大小写不敏感
    assert.throws(() => assertPreviewablePath('c:\\windows\\temp\\z.log', winDeps), /系统目录/);
  });

  await t.test('POSIX 系统目录拦截', () => {
    assert.throws(() => assertPreviewablePath('/etc/shadow', posixDeps), /系统目录/);
    assert.throws(() => assertPreviewablePath('/var/log/syslog', posixDeps), /系统目录/);
    // /var 普通子目录放行（macOS temp 在 /var/folders）
    assert.doesNotThrow(() => assertPreviewablePath('/var/folders/abc/tmp.png', posixDeps));
  });

  await t.test('凭据/浏览器 profile 目录拦截', () => {
    assert.throws(() => assertPreviewablePath('C:\\Users\\tester\\.ssh\\id_rsa', winDeps), /敏感目录/);
    assert.throws(
      () => assertPreviewablePath('/home/tester/.aws/credentials', posixDeps),
      /敏感目录/,
    );
    assert.throws(
      () =>
        assertPreviewablePath(
          'C:\\Users\\tester\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Cookies',
          winDeps,
        ),
      /敏感目录/,
    );
  });

  await t.test('HOME 普通文件放行（Downloads / Desktop 等）', () => {
    assert.doesNotThrow(() => assertPreviewablePath('C:\\Users\\tester\\Downloads\\img.png', winDeps));
    assert.doesNotThrow(() => assertPreviewablePath('/home/tester/Desktop/shot.png', posixDeps));
  });

  await t.test('realpath 解析符号链接后再判定', () => {
    const deps = {
      ...winDeps,
      realpathSync: (p: string) => (p.startsWith('D:\\link') ? 'C:\\Windows\\real.dll' : p),
    };
    assert.throws(() => assertPreviewablePath('D:\\link\\to-sys.bat', deps), /系统目录/);
  });

  await t.test('相对路径按 cwd 解析', () => {
    // 不抛错即通过（解析到 cwd 下）
    assert.doesNotThrow(() => assertPreviewablePath('tmp/a.png', winDeps));
  });
});

test('buildWin32SystemBlocklist', async (t) => {
  await t.test('环境变量缺失时回落默认值且不空', () => {
    const list = buildWin32SystemBlocklist({});
    assert.ok(list.length >= 4);
    assert.ok(list.includes('C:\\Windows'));
  });
  await t.test('重装盘符场景（D 盘 Windows）', () => {
    const list = buildWin32SystemBlocklist({ SystemRoot: 'D:\\Windows' });
    assert.ok(list.includes('D:\\Windows'));
  });
});
