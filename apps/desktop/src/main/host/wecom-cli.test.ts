/**
 * wecom-cli 适配器纯函数单测（node --test 直跑，不拉起 electron / 数据库 / 网络）。
 * 带「实测」字样的样例取自 1.3.4 二进制的真实输出（2026-11-24 隔离目录实跑）。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  WECOM_SKILLS_COMMIT,
  WECOM_SKILLS_DIGEST,
  WECOM_SKILLS_FILE_COUNT,
  cancelWecomLogin,
  groupWecomSkills,
  isCompletePng,
  listWecomSkills,
  parseWecomAuthShow,
  parseWecomAuthStatus,
  parseWecomError,
  parseWecomLoginOutput,
  parseWecomVersion,
  pickWecomDist,
  runWecomLogout,
  selectWecomSkillEntries,
  verifyWecomArtifact,
  wecomBinaryName,
  wecomConfigDir,
  wecomPlatformPackage,
  wecomSkillsArchiveUrl,
  wecomSkillsDigest,
} from './wecom-cli.ts';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fundet-wecom-test-'));
}

describe('parseWecomVersion', () => {
  it('实测输出：版本号与构建提交号', () => {
    const v = parseWecomVersion('wecom-cli 1.3.4 (wecom 2026-09-23T11:47:44Z f9b2815)\n');
    assert.equal(v.version, '1.3.4');
    assert.equal(v.build, 'f9b2815');
  });

  it('带预发布后缀的版本号整体保留；认不出返回 undefined', () => {
    assert.equal(parseWecomVersion('wecom-cli 1.4.0-beta.1 (wecom x abc1234)').version, '1.4.0-beta.1');
    assert.deepEqual(parseWecomVersion('garbage'), { version: undefined, build: undefined });
  });
});

describe('parseWecomAuthStatus / parseWecomAuthShow', () => {
  it('实测：--status 输出单行 authorized / unauthorized', () => {
    assert.equal(parseWecomAuthStatus('authorized\r\n'), true);
    assert.equal(parseWecomAuthStatus('unauthorized\n'), false);
  });

  it('输出不是这两个词 → null（不猜）', () => {
    assert.equal(parseWecomAuthStatus('Status: unauthorized'), null);
    assert.equal(parseWecomAuthStatus(''), null);
  });

  it('实测：auth show 的 Status 与 Bot ID', () => {
    assert.deepEqual(parseWecomAuthShow('Status: authorized\nBot ID: bot-abc\n'), { loggedIn: true, botId: 'bot-abc' });
    assert.deepEqual(parseWecomAuthShow('Status: unauthorized\n'), { loggedIn: false, botId: undefined });
    assert.equal(parseWecomAuthShow('').loggedIn, null);
  });
});

describe('parseWecomLoginOutput（扫码登录 stdout）', () => {
  const output = [
    '正在获取二维码...',
    '请打开二维码链接扫码: ',
    'https://work.weixin.qq.com/wework_admin/login?x=1',
    '也可以使用企业微信扫描以下二维码：',
    '二维码已保存到: C:\\tmp\\qr\\login.png',
    '等待扫码中...',
    '',
  ].join('\n');

  it('实测形态：授权链接是提示行的下一个非空行', () => {
    assert.deepEqual(parseWecomLoginOutput(output), {
      pageUrl: 'https://work.weixin.qq.com/wework_admin/login?x=1',
      qrSavedPath: 'C:\\tmp\\qr\\login.png',
      success: false,
    });
  });

  it('二维码 PNG 写文件失败时没有「已保存到」行（官方源码：warn 后继续轮询）', () => {
    const r = parseWecomLoginOutput(output.replace(/^二维码已保存到.*\n/m, ''));
    assert.equal(r.qrSavedPath, undefined);
    assert.equal(r.pageUrl, 'https://work.weixin.qq.com/wework_admin/login?x=1');
  });

  it('扫码成功标记', () => {
    assert.equal(parseWecomLoginOutput(`${output}✔ 扫码成功！Bot ID 和 Secret 已自动获取。\n`).success, true);
    assert.equal(parseWecomLoginOutput('nothing here').success, false);
  });
});

describe('parseWecomError', () => {
  it('实测：未授权调用业务接口（美化 JSON；type 是 UnknownError，鉴权信号只在 message）', () => {
    const stdout = [
      '{',
      '  "error": {',
      '    "type": "UnknownError",',
      '    "code": 893999,',
      '    "message": "AuthError: 该请求需要授权，请先运行 `wecom-cli auth init` 登录 [code=893201]"',
      '  }',
      '}',
    ].join('\n');
    const r = parseWecomError({ code: 1, stdout, stderr: '' });
    assert.equal(r.auth, true);
    assert.equal(r.message, 'AuthError: 该请求需要授权，请先运行 `wecom-cli auth init` 登录 [code=893201]');
  });

  it('紧凑 JSON：AuthError 类型即鉴权失败', () => {
    assert.deepEqual(parseWecomError({ code: 1, stdout: '{"error":{"type":"AuthError","code":893201,"message":"token 已失效"}}', stderr: '' }), {
      message: 'token 已失效',
      auth: true,
    });
  });

  it('业务错误不是鉴权问题', () => {
    const r = parseWecomError({ code: 1, stdout: '{"error":{"type":"ValidationError","code":893001,"message":"--limit 值无效"}}', stderr: '' });
    assert.deepEqual(r, { message: '--limit 值无效', auth: false });
  });

  it('没有 JSON → 退 stderr 尾行，兜底退出码', () => {
    assert.deepEqual(parseWecomError({ code: 1, stdout: '', stderr: 'first\nlast line\n' }), { message: 'last line', auth: false });
    assert.deepEqual(parseWecomError({ code: 2, stdout: '', stderr: '' }), { message: '退出码 2', auth: false });
  });

  it('超长消息截到 220 字', () => {
    const long = 'x'.repeat(500);
    assert.equal(parseWecomError({ code: 1, stdout: `{"error":{"message":"${long}"}}`, stderr: '' }).message.length, 220);
  });
});

describe('isCompletePng', () => {
  const SIG = Buffer.from('89504e470d0a1a0a', 'hex');
  const png = (...body: Buffer[]) => Buffer.concat([SIG, ...body, Buffer.from('IEND'), Buffer.alloc(4)]);

  it('魔数 + IEND 收尾 = 完整；半截文件不算', () => {
    assert.equal(isCompletePng(png(Buffer.from('IHDR-data'))), true);
    const full = png(Buffer.from('IHDR-data'));
    assert.equal(isCompletePng(full.subarray(0, full.length - 5)), false);
    assert.equal(isCompletePng(Buffer.from('not a png at all')), false);
    assert.equal(isCompletePng(Buffer.alloc(0)), false);
  });
});

describe('安装包校验', () => {
  it('wecomPlatformPackage 覆盖官方五个平台包，其它返回 null', () => {
    assert.equal(wecomPlatformPackage('win32', 'x64'), '@wecom/cli-win32-x64');
    assert.equal(wecomPlatformPackage('darwin', 'arm64'), '@wecom/cli-darwin-arm64');
    assert.equal(wecomPlatformPackage('linux', 'arm64'), '@wecom/cli-linux-arm64');
    assert.equal(wecomPlatformPackage('win32', 'arm64'), null);
    assert.equal(wecomBinaryName('win32'), 'wecom-cli.exe');
    assert.equal(wecomBinaryName('linux'), 'wecom-cli');
  });

  const buf = Buffer.from('fake binary payload');
  const sha512 = `sha512-${createHash('sha512').update(buf).digest('base64')}`;

  it('实测 integrity 形态：sha512-<base64> 通过，内容被改一个字节即拒绝', () => {
    assert.equal(verifyWecomArtifact(buf, { integrity: sha512, shasum: null }), true);
    const tampered = Buffer.from(buf);
    tampered[0] = tampered[0]! ^ 0xff;
    assert.equal(verifyWecomArtifact(tampered, { integrity: sha512, shasum: null }), false);
    assert.equal(verifyWecomArtifact(buf, { integrity: 'sha512-AAAA', shasum: null }), false);
  });

  it('没有 integrity 时退 shasum（sha1 hex）；两者都没有 = 无法校验 = 不通过', () => {
    const shasum = createHash('sha1').update(buf).digest('hex');
    assert.equal(verifyWecomArtifact(buf, { integrity: null, shasum }), true);
    assert.equal(verifyWecomArtifact(buf, { integrity: '', shasum: shasum.replace(/.$/, '0') }), false);
    assert.equal(verifyWecomArtifact(buf, { integrity: null, shasum: null }), false);
  });

  it('不认识的哈希算法不通过', () => {
    assert.equal(verifyWecomArtifact(buf, { integrity: 'md5-AAAA', shasum: null }), false);
  });

  it('pickWecomDist：取 latest；元数据里的下载地址不在所选 registry 上时按规范路径重拼', () => {
    const registry = 'https://registry.npmmirror.com';
    const pkg = '@wecom/cli-win32-x64';
    const meta = {
      'dist-tags': { latest: '1.3.4' },
      versions: {
        '1.3.2': { dist: { tarball: `${registry}/${pkg}/-/cli-win32-x64-1.3.2.tgz`, integrity: 'sha512-a' } },
        '1.3.4': { dist: { tarball: 'https://evil.example.com/x.tgz', integrity: 'sha512-b', shasum: 'cafe' } },
      },
    };
    assert.deepEqual(pickWecomDist(meta, registry, pkg), {
      version: '1.3.4',
      tarball: `${registry}/${pkg}/-/${pkg.split('/')[1]}-1.3.4.tgz`,
      integrity: 'sha512-b',
      shasum: 'cafe',
    });
    // 同源地址原样采用
    const same = { 'dist-tags': { latest: '1.3.2' }, versions: meta.versions };
    assert.equal(pickWecomDist(same, registry, pkg)?.tarball, `${registry}/${pkg}/-/cli-win32-x64-1.3.2.tgz`);
  });

  it('pickWecomDist：latest 指向不存在的版本 → 退最后一个；没有版本 / 垃圾输入 → null', () => {
    const versions = { '1.0.0': { dist: {} }, '1.1.0': { dist: { integrity: 'sha512-c' } } };
    assert.equal(pickWecomDist({ 'dist-tags': { latest: '9.9.9' }, versions }, 'https://r', '@wecom/cli-win32-x64')?.version, '1.1.0');
    assert.equal(pickWecomDist({ versions: {} }, 'https://r', '@wecom/cli-win32-x64'), null);
    assert.equal(pickWecomDist(null, 'https://r', '@wecom/cli-win32-x64'), null);
    assert.equal(pickWecomDist('nope', 'https://r', '@wecom/cli-win32-x64'), null);
  });
});

describe('官方技能包', () => {
  const commit = WECOM_SKILLS_COMMIT;

  it('技能包钉在 CLI 1.3.4 的构建提交上；镜像走 FUNDET_GH_PROXY 前缀（缺省 gh-proxy）', () => {
    assert.match(commit, /^[0-9a-f]{40}$/);
    assert.equal(wecomSkillsArchiveUrl('github'), `https://codeload.github.com/WecomTeam/wecom-cli/tar.gz/${commit}`);
    assert.equal(
      wecomSkillsArchiveUrl('mirror', {}),
      `https://gh-proxy.com/https://github.com/WecomTeam/wecom-cli/archive/${commit}.tar.gz`,
    );
    assert.equal(
      wecomSkillsArchiveUrl('mirror', { FUNDET_GH_PROXY: 'https://my.proxy.example/' }),
      `https://my.proxy.example/https://github.com/WecomTeam/wecom-cli/archive/${commit}.tar.gz`,
    );
  });

  it('selectWecomSkillEntries：只取 <归档根>/skills/wecomcli-*/ 下的普通文件，键为相对路径', () => {
    const data = Buffer.from('x');
    const files = selectWecomSkillEntries([
      { path: 'wecom-cli-abc/README.md', data },
      { path: 'wecom-cli-abc/skills/wecomcli-todo/SKILL.md', data },
      { path: 'wecom-cli-abc/skills/wecomcli-todo/references/todo-list.md', data },
      { path: 'wecom-cli-abc/skills/not-ours/SKILL.md', data },
      { path: 'wecom-cli-abc/crates/wecom-cli/src/main.rs', data },
      { path: 'no-root/SKILL.md', data },
    ]);
    assert.deepEqual([...files.keys()].sort(), ['wecomcli-todo/SKILL.md', 'wecomcli-todo/references/todo-list.md']);
  });

  it('wecomSkillsDigest：内容不变则稳定；改一个字节或改路径都变', () => {
    const base = new Map([
      ['wecomcli-a/SKILL.md', Buffer.from('# a')],
      ['wecomcli-b/SKILL.md', Buffer.from('# b')],
    ]);
    const reordered = new Map([...base.entries()].reverse());
    assert.equal(wecomSkillsDigest(base), wecomSkillsDigest(reordered));
    const edited = new Map(base);
    edited.set('wecomcli-a/SKILL.md', Buffer.from('# A'));
    assert.notEqual(wecomSkillsDigest(edited), wecomSkillsDigest(base));
    const renamed = new Map([
      ['wecomcli-c/SKILL.md', Buffer.from('# a')],
      ['wecomcli-b/SKILL.md', Buffer.from('# b')],
    ]);
    assert.notEqual(wecomSkillsDigest(renamed), wecomSkillsDigest(base));
  });

  it('groupWecomSkills：文件数或指纹不符一律拒绝（下载源被篡改/损坏）', () => {
    assert.throws(() => groupWecomSkills(new Map()), /文件数不对/);
    const fake = new Map(
      Array.from({ length: WECOM_SKILLS_FILE_COUNT }, (_, i) => [`wecomcli-x/f${i}`, Buffer.from(String(i))]),
    );
    assert.throws(() => groupWecomSkills(fake), /指纹不符/);
    // 哨兵：常量本身是 64 位十六进制，且不等于任何假包的指纹
    assert.match(WECOM_SKILLS_DIGEST, /^[0-9a-f]{64}$/);
    assert.notEqual(wecomSkillsDigest(fake), WECOM_SKILLS_DIGEST);
  });

  it('listWecomSkills：只认 wecomcli-* 且含 SKILL.md 的目录，排序返回', () => {
    const root = tmpDir();
    try {
      for (const d of ['wecomcli-todo', 'wecomcli-calendar', 'wecomcli-empty', 'dingtalk-x']) {
        fs.mkdirSync(path.join(root, d));
      }
      for (const d of ['wecomcli-todo', 'wecomcli-calendar', 'dingtalk-x']) {
        fs.writeFileSync(path.join(root, d, 'SKILL.md'), '---\nname: x\n---\n');
      }
      assert.deepEqual(listWecomSkills(root), ['wecomcli-calendar', 'wecomcli-todo']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
    assert.deepEqual(listWecomSkills(path.join(tmpDir(), 'missing')), []);
  });
});

describe('wecomConfigDir / 解除授权', () => {
  function withCleanEnv<T>(fn: () => T): T {
    const saved = process.env.WECOM_CLI_CONFIG_DIR;
    delete process.env.WECOM_CLI_CONFIG_DIR;
    try {
      return fn();
    } finally {
      if (saved !== undefined) process.env.WECOM_CLI_CONFIG_DIR = saved;
    }
  }

  it('WECOM_CLI_CONFIG_DIR（非空白）优先，否则 ~/.config/wecom', () => {
    assert.equal(wecomConfigDir({ WECOM_CLI_CONFIG_DIR: '/custom/dir' }, '/home/u'), '/custom/dir');
    assert.equal(wecomConfigDir({ WECOM_CLI_CONFIG_DIR: '   ' }, '/home/u'), path.join('/home/u', '.config', 'wecom'));
    assert.equal(wecomConfigDir({}, '/home/u'), path.join('/home/u', '.config', 'wecom'));
  });

  it('runWecomLogout 只删 credentials.enc，不动同目录其它文件；没有凭据时是空操作', async () => {
    const home = tmpDir();
    try {
      const cfg = path.join(home, '.config', 'wecom');
      fs.mkdirSync(cfg, { recursive: true });
      fs.writeFileSync(path.join(cfg, 'config.json'), '{}');
      const none = await withCleanEnv(() => runWecomLogout(home));
      assert.equal(none.ok, true);
      assert.match(none.output, /没有/);

      fs.writeFileSync(path.join(cfg, 'credentials.enc'), 'secret');
      const done = await withCleanEnv(() => runWecomLogout(home));
      assert.equal(done.ok, true);
      assert.equal(fs.existsSync(path.join(cfg, 'credentials.enc')), false);
      assert.equal(fs.existsSync(path.join(cfg, 'config.json')), true);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('cancelWecomLogin 在没有在途扫码时不抛错', () => {
    cancelWecomLogin();
  });
});
