/**
 * SkillHub 解析与安装管线单测——fixture 为真机抓包。
 * 安装管线用注入式依赖（假下载器 + 临时目录）跑真实落盘/校验/回滚流。
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  parseSkillhubSearch,
  parseSkillhubDetail,
  parseSkillhubFiles,
  validateManifest,
  installSkillhubSkill,
  listInstalledSkillhub,
  setSkillhubDeps,
  isAllowedIconUrl,
  sniffImageType,
  fetchSkillhubIcon,
} from './skillhub.ts';
import { skillhubIconProxyUrl } from '../../shared/skillhub.ts';
import { validateSkillMarkdown } from './skill-frontmatter.ts';

const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__');
const load = (name: string): string => fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf-8');

test('parseSkillhubSearch：真机 fixture，中英双语/计数/标签归一化', () => {
  const list = parseSkillhubSearch(load('skillhub-search.json'));
  assert.ok(list.length >= 5);
  const first = list[0]!;
  assert.equal(first.slug, 'self-improving-agent');
  assert.equal(first.name, 'self-improving agent');
  assert.ok(first.downloads > 0 && first.installs > 0);
  assert.ok(first.category);
  assert.equal(typeof first.requiresApiKey, 'boolean');
  assert.ok(list.every((s) => s.slug && s.name && typeof s.description === 'string'));
});

test('parseSkillhubSearch：垃圾输入返回空', () => {
  assert.deepEqual(parseSkillhubSearch('not json'), []);
  assert.deepEqual(parseSkillhubSearch('{"results": 1}'), []);
});

test('parseSkillhubDetail：审计报告/版本/作者归一化', () => {
  const d = parseSkillhubDetail(load('skillhub-detail.json'));
  assert.ok(d);
  assert.equal(d!.slug, 'self-improving-agent');
  assert.ok(d!.securityReports.length >= 1);
  assert.ok(d!.securityReports.every((r) => r.provider && r.status));
  assert.equal(d!.latestVersion, '3.0.24');
  assert.ok(typeof d!.verified === 'boolean');
});

test('parseSkillhubFiles：清单带 64 位 sha256', () => {
  const files = parseSkillhubFiles(load('skillhub-files.json'));
  assert.equal(files.length, 17);
  assert.ok(files.every((f) => f.path && f.sha256.length === 64 && f.size >= 0));
  assert.ok(files.some((f) => f.path === 'SKILL.md'));
});

test('validateManifest：缺 SKILL.md / 路径穿越 / 上限 / 下划线打头合法', () => {
  const ok = [
    { path: 'SKILL.md', sha256: 'a'.repeat(64), size: 10 },
    { path: 'assets/a.md', sha256: 'b'.repeat(64), size: 10 },
    { path: '_meta.json', sha256: 'c'.repeat(64), size: 4 },
  ];
  assert.equal(validateManifest(ok), null);
  assert.match(validateManifest(ok.slice(1))!, /SKILL\.md/);
  assert.match(validateManifest([{ path: '../evil.md', sha256: 'a'.repeat(64), size: 1 }, ...ok])!, /非法/);
  assert.match(
    validateManifest([{ path: 'SKILL.md', sha256: 'a'.repeat(64), size: 10 }, ...Array.from({ length: 60 }, (_, i) => ({ path: `f${i}.md`, sha256: 'c'.repeat(64), size: 1 }))])!,
    /文件数/,
  );
});

/* ---------------- 安装管线（注入式，真实落盘） ---------------- */

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skillhub-install-'));

function fakeDeps(files: Array<{ path: string; content: Buffer }>, corrupt = false) {
  const manifest = files.map((f) => ({
    path: f.path,
    sha256: corrupt && f.path === files[0]!.path ? '0'.repeat(64) : createHash('sha256').update(f.content).digest('hex'),
    size: f.content.length,
  }));
  return {
    fetchJson: async (p: string) => {
      if (p.includes('/files')) return JSON.stringify({ files: manifest });
      if (p.includes('/skills/')) {
        return JSON.stringify({
          slug: 'demo-skill',
          skill: { displayName: 'demo', summary_zh: '演示', stats: {} },
          latestVersion: { version: '1.2.3', changelog: 'x' },
          owner: { displayName: 'tester' },
          securityReports: {},
        });
      }
      return JSON.stringify({ results: [] });
    },
    fetchFile: async (_slug: string, fp: string) => {
      const hit = files.find((f) => f.path === fp);
      if (!hit) throw new Error(`no such file ${fp}`);
      return hit.content;
    },
    skillsRoot: () => root,
  };
}

const SKILL_MD = '---\nname: demo-skill\ndescription: 演示技能，用于安装管线测试\n---\n\n# Demo\n内容。\n';

before(() => {
  fs.mkdirSync(root, { recursive: true });
});

after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

test('安装：校验通过 → 原子落盘 → skillhub.json 元数据可回读', async () => {
  setSkillhubDeps(fakeDeps([{ path: 'SKILL.md', content: Buffer.from(SKILL_MD) }, { path: 'assets/x.md', content: Buffer.from('x') }]));
  const r = await installSkillhubSkill('demo-skill');
  assert.ok(fs.existsSync(path.join(r.dir, 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(r.dir, 'assets/x.md')));
  assert.ok(fs.existsSync(path.join(r.dir, 'skillhub.json')));
  assert.equal(r.version, '1.2.3');
  const installed = listInstalledSkillhub(root);
  assert.equal(installed.length, 1);
  assert.equal(installed[0]!.slug, 'demo-skill');
  assert.equal(installed[0]!.version, '1.2.3');
});

test('安装：sha256 不符整体放弃，不留残留', async () => {
  setSkillhubDeps(fakeDeps([{ path: 'SKILL.md', content: Buffer.from(SKILL_MD) }], true));
  await assert.rejects(installSkillhubSkill('demo-skill', { replace: true }), /校验失败/);
  // 上一个测试装的还在（replace 前置校验先跑下载？——replace:true 允许覆盖，但校验失败应不动原目录）
  assert.ok(fs.existsSync(path.join(root, 'demo-skill', 'SKILL.md')), '失败安装不得破坏已有目录');
  const leftovers = fs.readdirSync(root).filter((n) => n.startsWith('.skillhub-tmp-'));
  assert.deepEqual(leftovers, [], '临时目录必须清理');
});

test('安装：重复安装被拒，replace 走备份-替换路径', async () => {
  setSkillhubDeps(fakeDeps([{ path: 'SKILL.md', content: Buffer.from(SKILL_MD) }]));
  await assert.rejects(installSkillhubSkill('demo-skill'), /已安装/);
  const r = await installSkillhubSkill('demo-skill', { replace: true });
  assert.ok(fs.existsSync(path.join(r.dir, 'SKILL.md')));
  const old = fs.readdirSync(root).filter((n) => n.includes('.old-'));
  assert.deepEqual(old, [], '备份目录必须清理');
});

test('安装：SKILL.md frontmatter 非法（无 description）拒绝', async () => {
  setSkillhubDeps(fakeDeps([{ path: 'SKILL.md', content: Buffer.from('---\nname: demo-skill\n---\nbody') }]));
  await assert.rejects(installSkillhubSkill('bad-meta-skill'), /description|frontmatter/);
  assert.ok(!fs.existsSync(path.join(root, 'bad-meta-skill')));
});

test('validateSkillMarkdown 冒烟：与本地导入同规则的零依赖校验器', () => {
  const { name, description } = validateSkillMarkdown(SKILL_MD, 'demo-skill');
  assert.equal(name, 'demo-skill');
  assert.equal(description, '演示技能，用于安装管线测试');
  assert.throws(() => validateSkillMarkdown('no frontmatter', 'x'), /name|description/);
});

/* ---------------- 图标代理 ---------------- */

test('skillhubIconProxyUrl：https 改写 / http 与垃圾输入回落 null', () => {
  assert.equal(
    skillhubIconProxyUrl('https://cloudcache.tencent-cloud.com/a/b.png'),
    'skillhub-icon://cloudcache.tencent-cloud.com/a/b.png',
  );
  assert.equal(skillhubIconProxyUrl('http://cloudcache.tencent-cloud.com/a.png'), null);
  assert.equal(skillhubIconProxyUrl('not a url'), null);
  assert.equal(skillhubIconProxyUrl(null), null);
  assert.equal(skillhubIconProxyUrl(undefined), null);
});

test('isAllowedIconUrl：白名单域（腾讯系 + skillhub.cn），其它域/非 https 拒绝', () => {
  assert.ok(isAllowedIconUrl('https://cloudcache.tencent-cloud.com/x.png'));
  assert.ok(isAllowedIconUrl('https://skillhub-1388575217.cos.accelerate.myqcloud.com/x.png'));
  assert.ok(isAllowedIconUrl('https://skillhub.cn/x.png'));
  assert.equal(isAllowedIconUrl('https://evil.com/x.png'), false);
  assert.equal(isAllowedIconUrl('https://evil.myqcloud.com.evil.com/x.png'), false);
  assert.equal(isAllowedIconUrl('http://skillhub.cn/x.png'), false);
});

test('sniffImageType：魔数判型（png/jpeg/svg），不认识返回 null', () => {
  assert.equal(sniffImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'image/png');
  assert.equal(sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
  assert.equal(sniffImageType(Buffer.from('<svg xmlns="..."></svg>')), 'image/svg+xml');
  assert.equal(sniffImageType(Buffer.from('hello world')), null);
});

test('fetchSkillhubIcon：下载→落缓存→二次命中不再联网；白名单外直拒', async () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('fake-png-body')]);
  const iconUrl = 'https://skillhub-1388575217.cos.accelerate.myqcloud.com/skill-icons/x.png';
  const cacheDir = path.join(root, 'icons');
  let fetches = 0;
  setSkillhubDeps({
    fetchIcon: async (u: string) => {
      fetches++;
      return u === iconUrl ? { contentType: 'image/png', bytes: png } : null;
    },
  });
  const first = await fetchSkillhubIcon(iconUrl, cacheDir);
  assert.ok(first && first.equals(png));
  assert.equal(fetches, 1);
  assert.ok(fs.readdirSync(cacheDir).length === 1, '缓存落盘');
  // 断网（fetchIcon 直接抛）仍能命中缓存
  setSkillhubDeps({
    fetchIcon: async () => {
      throw new Error('offline');
    },
  });
  const second = await fetchSkillhubIcon(iconUrl, cacheDir);
  assert.ok(second && second.equals(png), '缓存命中不联网');
  // 白名单外：不触发任何网络调用
  fetches = 0;
  setSkillhubDeps({
    fetchIcon: async () => {
      fetches++;
      return { contentType: 'image/png', bytes: png };
    },
  });
  assert.equal(await fetchSkillhubIcon('https://evil.com/x.png', cacheDir), null);
  assert.equal(fetches, 0);
});
