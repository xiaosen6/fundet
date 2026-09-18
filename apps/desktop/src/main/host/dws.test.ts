/**
 * dws 桥纯函数单测：
 * - version / profile list 的 JSON 形状取自本机 dws v1.0.62 实测输出
 *   （未登录 profile list = 空 profiles 数组；登录后字段按宽容提取设计）
 * - 技能扫描按 dws skill setup multi 的真实落点（用户技能根下的 dingtalk- 前缀目录 + SKILL.md）
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractAuthUrl, listDingtalkSkills, parseDwsVersion, parseProfileList } from './dws.ts';

describe('parseDwsVersion', () => {
  it('解析本机实测形状', () => {
    const raw = JSON.stringify({
      architecture: 'MCP Static Endpoint Mode',
      build: '2026-09-16T08:35:04Z',
      commit: '70323e14',
      edition: 'open',
      go: '1.24+',
      version: 'v1.0.62',
    });
    assert.deepEqual(parseDwsVersion(raw), { version: 'v1.0.62', build: '2026-09-16T08:35:04Z' });
  });

  it('非 JSON / 缺字段宽容返回空对象（稀疏键）', () => {
    assert.deepEqual(parseDwsVersion('不是 json'), {});
    assert.deepEqual(parseDwsVersion('{"version": 62}'), {});
  });

  it('stdout 混入 cmd AutoRun 回显（doskey 宏）仍能截取 JSON 段', () => {
    const polluted =
      '\r\nD:\\Go\\fundet-buddy>doskey python3.11=C:\\Users\\16086\\AppData\\Local\\Programs\\Python\\Python311\\python.exe $*  \r\n\r\n' +
      '{"version": "v1.0.62", "build": "2026-09-16T08:35:04Z"}\r\n';
    assert.deepEqual(parseDwsVersion(polluted), { version: 'v1.0.62', build: '2026-09-16T08:35:04Z' });
  });
});

describe('parseProfileList', () => {
  it('未登录：空 profiles（本机实测）', () => {
    assert.deepEqual(parseProfileList('{\n  "success": true,\n  "profiles": []\n}'), []);
  });

  it('非 JSON / 缺 profiles 返回空', () => {
    assert.deepEqual(parseProfileList(''), []);
    assert.deepEqual(parseProfileList('{"success": true}'), []);
    assert.deepEqual(parseProfileList('{"profiles": "nope"}'), []);
  });

  it('登录后：宽容提取身份字段（字段名容错）', () => {
    const raw = JSON.stringify({
      success: true,
      profiles: [
        { profile: 'ding123:01234', corpName: '山东未来互联', userName: '孙记森', isOrgCurrent: true },
        { profile: 'ding456:56789', corpName: '另一家企业', nickName: '张三' },
      ],
    });
    assert.deepEqual(parseProfileList(raw), [
      { id: 'ding123:01234', org: '山东未来互联', user: '孙记森', isCurrent: true },
      { id: 'ding456:56789', org: '另一家企业', user: '张三', isCurrent: false },
    ]);
  });

  it('空对象条目被过滤；有任一身份字段的保留', () => {
    const raw = JSON.stringify({ profiles: [{}, { profile: 'x:y' }, 'junk'] });
    assert.deepEqual(parseProfileList(raw), [{ id: 'x:y', org: undefined, user: undefined, isCurrent: false }]);
  });

  it('stdout 混横幅时截取 JSON 段（本机 cmd AutoRun 实捕形状）', () => {
    const polluted = 'some banner line\r\n{"success":true,"profiles":[{"profile":"a:b","corpName":"X","userName":"Y","isOrgCurrent":true}]}\r\n';
    assert.deepEqual(parseProfileList(polluted), [
      { id: 'a:b', org: 'X', user: 'Y', isCurrent: true },
    ]);
  });
});

describe('extractAuthUrl', () => {
  it('从登录输出里抓授权链接（优先 login/dingtalk/oauth 字样）', () => {
    const out =
      '正在启动登录…\n若浏览器没有自动打开，请手动访问:\nhttps://login.dingtalk.com/oauth2/auth?clientId=xx&redirect_uri=http://127.0.0.1:52312/cb\n完成授权后自动继续。';
    assert.equal(
      extractAuthUrl(out),
      'https://login.dingtalk.com/oauth2/auth?clientId=xx&redirect_uri=http://127.0.0.1:52312/cb',
    );
  });

  it('多个链接时优先带授权字样的；无匹配返回 undefined', () => {
    assert.equal(extractAuthUrl('文档 https://open-dev.dingtalk.com/docs 与 https://example.com/a'), 'https://open-dev.dingtalk.com/docs');
    assert.equal(extractAuthUrl('没有任何链接'), undefined);
  });
});

describe('listDingtalkSkills', () => {
  it('只认带 SKILL.md 的 dingtalk-* 目录，排序返回', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dws-skills-'));
    try {
      fs.mkdirSync(path.join(root, 'dingtalk-todo'));
      fs.writeFileSync(path.join(root, 'dingtalk-todo', 'SKILL.md'), '---\nname: dingtalk-todo\n---\n');
      fs.mkdirSync(path.join(root, 'dingtalk-broken')); // 缺 SKILL.md
      fs.mkdirSync(path.join(root, 'other-skill'));
      fs.writeFileSync(path.join(root, 'other-skill', 'SKILL.md'), '---\n---\n');
      fs.mkdirSync(path.join(root, 'dingtalk-chat'));
      fs.writeFileSync(path.join(root, 'dingtalk-chat', 'SKILL.md'), '---\nname: dingtalk-chat\n---\n');
      assert.deepEqual(listDingtalkSkills(root), ['dingtalk-chat', 'dingtalk-todo']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('目录不存在返回空数组（不抛）', () => {
    assert.deepEqual(listDingtalkSkills(path.join(os.tmpdir(), 'dws-no-such-dir-xyz')), []);
  });
});
