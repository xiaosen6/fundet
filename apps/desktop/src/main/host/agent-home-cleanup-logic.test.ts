/**
 * agent-home 启动清扫纯逻辑：根目录收窄（sessions 保留）+ 转录引用计数 GC +
 * 删除路径闸。node --test 直跑（无 Electron 依赖）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  planRootSweep,
  planTranscriptSweep,
  isTranscriptPathWithin,
} from './agent-home-cleanup-logic.ts';

const SESSIONS_DIR = path.resolve('C:/Users/x/AppData/Roaming/Fundet/agent-home/sessions');

test('根目录清扫：sessions 保留，run-tmp/runtime/旧随机目录全删', () => {
  const plan = planRootSweep(['sessions', 'run-tmp', 'runtime', 'ab12cd34ef56', 'note.txt']);
  assert.deepEqual(plan.sort(), ['ab12cd34ef56', 'note.txt', 'run-tmp', 'runtime'].sort());
});

test('转录 GC：被引用的保留；孤儿且超宽限期的删；宽限期内的不删', () => {
  const now = 1_000_000_000_000;
  const hour = 60 * 60 * 1000;
  const referenced = new Set([path.join(SESSIONS_DIR, 'keep.jsonl').toLowerCase()]);
  const files = [
    { name: 'keep.jsonl', mtimeMs: now - 10 * hour }, // 被引用，虽老也留
    { name: 'orphan-old.jsonl', mtimeMs: now - 10 * hour }, // 孤儿超期 → 删
    { name: 'orphan-fresh.jsonl', mtimeMs: now - 10 * 60 * 1000 }, // 孤儿但 10 分钟内 → 留（双实例竞态宽限）
  ];
  const plan = planTranscriptSweep(files, referenced, SESSIONS_DIR, now);
  assert.deepEqual(plan, [path.join(SESSIONS_DIR, 'orphan-old.jsonl')]);
});

test('转录 GC：引用比较大小写不敏感（Windows）', () => {
  const now = 1_000_000_000_000;
  const hour = 60 * 60 * 1000;
  const referenced = new Set([path.join(SESSIONS_DIR, 'Keep.JSONL').toLowerCase()]);
  const files = [{ name: 'keep.jsonl', mtimeMs: now - 10 * hour }];
  assert.deepEqual(planTranscriptSweep(files, referenced, SESSIONS_DIR, now), []);
});

test('删除路径闸：只认共享 sessions 目录内的文件', () => {
  assert.ok(isTranscriptPathWithin(SESSIONS_DIR, path.join(SESSIONS_DIR, 'a.jsonl')));
  // 大小写差异放行（Windows 不敏感）
  assert.ok(isTranscriptPathWithin(SESSIONS_DIR, SESSIONS_DIR.toUpperCase() + '\\a.jsonl'));
  // 目录外/上级逃逸/其他盘全拒
  assert.ok(!isTranscriptPathWithin(SESSIONS_DIR, 'C:/Windows/system32/drivers/etc/hosts'));
  assert.ok(!isTranscriptPathWithin(SESSIONS_DIR, path.join(SESSIONS_DIR, '..', 'runtime', 'perm.json')));
  assert.ok(!isTranscriptPathWithin(SESSIONS_DIR, 'D:/elsewhere/a.jsonl'));
});
