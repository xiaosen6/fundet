/**
 * checkpoint store 集成测试：真实 git 子进程跑完整快照→改动→预览→回滚流。
 * FUNDET_CHECKPOINT_ROOT 注入临时根目录（不触 Electron 运行时）。
 * 本机无 git 时整组跳过（与 pi 集成测试同口径）。
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let gitOk = true;
try {
  execFileSync('git', ['--version'], { stdio: 'ignore', timeout: 5000 });
} catch {
  gitOk = false;
  console.warn('[checkpoint.test] git 不可用，跳过');
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fundet-cp-root-'));
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'fundet-cp-work-'));
process.env.FUNET_CHECKPOINT_ROOT = root;

before(() => {
  if (!gitOk) return;
  // 关掉全局身份/所有权干扰
  fs.writeFileSync(path.join(work, 'a.txt'), 'v1\n');
  fs.mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(work, 'node_modules', 'junk.txt'), 'junk\n');
});

after(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(work, { recursive: true, force: true });
});

test('快照→改动→预览→回滚全链（真实 git）', { skip: !gitOk }, async () => {
  const { createSnapshot, listCheckpoints, previewRewind, rewindTo } = await import('./store.ts');
  const sid = '11111111-2222-3333-4444-555555555555';

  // 快照 1：a.txt=v1（node_modules 应被排除）
  const sha1 = await createSnapshot(sid, work, '第一轮');
  assert.ok(sha1, '首个快照应产生 commit');
  const bare = path.join(root, `${sid}.git`);
  const files = execFileSync('git', ['--git-dir', bare, 'ls-tree', '-r', '--name-only', 'HEAD'], { encoding: 'utf8' });
  assert.ok(files.includes('a.txt'), 'a.txt 已入快照');
  assert.ok(!files.includes('node_modules/junk.txt'), 'node_modules 被排除');

  // 无变更不重复提交
  const again = await createSnapshot(sid, work, '无变化轮');
  assert.equal(again, null, '无变更返回 null');

  // 改动：改 a.txt + 新增 b.txt
  fs.writeFileSync(path.join(work, 'a.txt'), 'v2\n');
  fs.writeFileSync(path.join(work, 'b.txt'), 'new\n');
  const sha2 = await createSnapshot(sid, work, '第二轮');
  assert.ok(sha2 && sha2 !== sha1);

  // 列表（新→旧）
  const list = await listCheckpoints(sid);
  assert.equal(list.length, 2);
  assert.equal(list[0]!.sha, sha2);
  assert.equal(list[0]!.label, '第二轮');

  // 预览回滚到第一轮：a.txt 恢复 + b.txt 删除
  const preview = await previewRewind(sid, sha1!);
  assert.deepEqual(preview.restore.sort(), ['a.txt']);
  assert.deepEqual(preview.remove, ['b.txt']);

  // 执行回滚
  const result = await rewindTo(sid, work, sha1!);
  // 预快照：工作树与 tip 一致时无需落（返回 null）；有偏离才提交
  assert.equal(fs.readFileSync(path.join(work, 'a.txt'), 'utf8'), 'v1\n');
  assert.ok(!fs.existsSync(path.join(work, 'b.txt')), '新增文件已删除');

  // 反悔：回滚到第二轮快照（或预快照，若有的话）能拿回 v2/b.txt
  const undone = await rewindTo(sid, work, result.preRollbackSha ?? sha2!);
  assert.ok(undone, '反悔回滚完成');
  assert.equal(fs.readFileSync(path.join(work, 'a.txt'), 'utf8'), 'v2\n');
  assert.ok(fs.existsSync(path.join(work, 'b.txt')));
});

test('删会话清理快照仓', { skip: !gitOk }, async () => {
  const { createSnapshot, deleteCheckpoints } = await import('./store.ts');
  const sid = '99999999-8888-7777-6666-555555555555';
  fs.writeFileSync(path.join(work, 'c.txt'), 'x\n');
  const sha = await createSnapshot(sid, work, '临时');
  assert.ok(sha);
  deleteCheckpoints(sid);
  assert.ok(!fs.existsSync(path.join(root, `${sid}.git`)));
});
