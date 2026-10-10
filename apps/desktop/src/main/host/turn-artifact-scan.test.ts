import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  SNAPSHOT_MAX_FILES,
  TURN_ARTIFACT_MAX,
  diffArtifacts,
  isArtifactPath,
  isExcludedDirName,
  scanArtifactSnapshot,
  type TurnArtifactSnapshot,
} from './turn-artifact-scan.ts';

async function makeTempWorkdir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'fundet-turn-art-'));
}

async function touch(root: string, rel: string, mtimeMs?: number): Promise<string> {
  const full = path.join(root, rel);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, rel);
  if (mtimeMs !== undefined) {
    const t = new Date(mtimeMs);
    await utimes(full, t, t);
  }
  return full;
}

test('isExcludedDirName：依赖仓/缓存/附件暂存 + 点开头目录排除；fundet-images 收', () => {
  for (const name of ['node_modules', '.git', '.venv', '__pycache__', '.fundet-uploads', '.cache', '.idea']) {
    assert.equal(isExcludedDirName(name), true, name);
  }
  for (const name of ['fundet-images', 'src', 'out', 'dist', 'assets']) {
    assert.equal(isExcludedDirName(name), false, name);
  }
});

test('isArtifactPath：白名单命中（大小写不敏感）；非白名单/无扩展不收', () => {
  for (const p of [
    'a.pptx', 'b.DOCX', 'c.pdf', 'd.xlsm', 'e.png', 'f.jpeg', 'g.webp', 'h.svg',
    'i.bmp', 'j.mp3', 'k.wav', 'l.mp4', 'm.csv', 'n.zip', 'o.7z', 'p.html', 'q.htm',
    'r.json', 's.md', 't.txt', 'u.py', 'v.js', 'w.ts', 'x/y/z.js',
  ]) {
    assert.equal(isArtifactPath(p), true, p);
  }
  for (const p of ['a.exe', 'b.tsx', 'c.jsx', 'd.docx.bak', '无扩展', 'e.mp4.tmp']) {
    assert.equal(isArtifactPath(p), false, p);
  }
});

test('diffArtifacts：新增与 mtime 变化命中，未变与非白名单不命中', () => {
  const baseline: TurnArtifactSnapshot = new Map([
    ['\\w\\old.png', 100],
    ['\\w\\same.md', 200],
    ['\\w\\gone.txt', 300],
  ]);
  const current: TurnArtifactSnapshot = new Map([
    ['\\w\\old.png', 999], // mtime 变化
    ['\\w\\same.md', 200], // 未变
    ['\\w\\new.pptx', 500], // 新增
    ['\\w\\noise.exe', 600], // 非白名单
  ]);
  // old.png mtime 999 > new.pptx 500：倒序 old 在前
  assert.deepEqual(diffArtifacts(baseline, current), ['\\w\\old.png', '\\w\\new.pptx']);
});

test('diffArtifacts：mtime 倒序 + 截断 TURN_ARTIFACT_MAX（15 变更只回最新 12）', () => {
  assert.equal(SNAPSHOT_MAX_FILES, 800);
  assert.equal(TURN_ARTIFACT_MAX, 12);
  const baseline: TurnArtifactSnapshot = new Map();
  const current: TurnArtifactSnapshot = new Map();
  for (let i = 0; i < 15; i++) current.set(`\\w\\f${String(i).padStart(2, '0')}.png`, 1000 + i);
  const got = diffArtifacts(baseline, current);
  assert.equal(got.length, 12);
  assert.deepEqual(
    got.map((p) => Number(p.match(/f(\d+)\.png/)?.[1])),
    [14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3],
  );
});

test('scanArtifactSnapshot：顶层 + 一层子目录收（含 fundet-images），排除目录与两层深不收', async () => {
  const root = await makeTempWorkdir();
  try {
    await touch(root, 'deck.pptx');
    await touch(root, 'report.docx');
    await touch(root, 'main.py');
    await touch(root, 'fundet-images/shot.png');
    await touch(root, 'out/data.xlsx');
    await touch(root, 'node_modules/pkg/a.png'); // 排除目录
    await touch(root, '.fundet-uploads/att.pdf'); // 排除目录
    await touch(root, '.cache/x.json'); // 点开头目录
    await touch(root, 'out/deep/nested.md'); // 两层深不扫
    await touch(root, 'binary.exe'); // 非白名单
    const snap = await scanArtifactSnapshot(root);
    const names = [...snap.keys()].map((p) => path.relative(root, p)).sort();
    assert.deepEqual(names, [
      'deck.pptx',
      path.join('fundet-images', 'shot.png'),
      'main.py',
      path.join('out', 'data.xlsx'),
      'report.docx',
    ]);
    assert.equal(typeof snap.get(path.join(root, 'deck.pptx')), 'number');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('scanArtifactSnapshot：maxFiles 截断（传 2 只收前 2 个白名单文件）', async () => {
  const root = await makeTempWorkdir();
  try {
    await touch(root, 'a.png');
    await touch(root, 'b.md');
    await touch(root, 'c.txt');
    const snap = await scanArtifactSnapshot(root, 2);
    assert.equal(snap.size, 2);
    for (const p of snap.keys()) {
      assert.match(p, /[abc]\.(png|md|txt)$/);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('scanArtifactSnapshot：workDir 不存在时抛错（调用方静默跳过）', async () => {
  await assert.rejects(scanArtifactSnapshot(path.join(tmpdir(), 'fundet-turn-art-not-exist')));
});
