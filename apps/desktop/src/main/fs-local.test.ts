import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isPathInsideRoot, resolveUnderWorkDir, stageBytesIntoWorkDir, stageFileIntoWorkDir } from './fs-local.ts';

let tmp = '';

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fundet-fs-'));
});

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('isPathInsideRoot / resolveUnderWorkDir', () => {
  it('allows files under the root and rejects escape', () => {
    const root = path.join(tmp, 'proj');
    fs.mkdirSync(path.join(root, 'out'), { recursive: true });
    const inside = path.join(root, 'out', 'a.html');
    fs.writeFileSync(inside, '<html></html>');
    assert.equal(isPathInsideRoot(root, inside), true);
    assert.equal(resolveUnderWorkDir('out/a.html', root), inside);
    assert.throws(() => resolveUnderWorkDir(path.join(tmp, 'outside.txt'), root), /工作目录/);
  });
});

describe('stageFileIntoWorkDir', () => {
  it('reuses a path already inside the workdir', async () => {
    const root = path.join(tmp, 'in-place');
    fs.mkdirSync(root, { recursive: true });
    const src = path.join(root, 'clip.mp4');
    fs.writeFileSync(src, 'video');
    const staged = await stageFileIntoWorkDir(src, root);
    assert.equal(staged.path, src);
    assert.equal(staged.kind, 'file');
    assert.equal(staged.name, 'clip.mp4');
  });

  it('copies an outside file into .fundet-uploads with unique names', async () => {
    const root = path.join(tmp, 'copy-root');
    fs.mkdirSync(root, { recursive: true });
    const outside = path.join(tmp, 'photo.png');
    fs.writeFileSync(outside, Buffer.alloc(16));
    const first = await stageFileIntoWorkDir(outside, root);
    const second = await stageFileIntoWorkDir(outside, root);
    assert.equal(first.name, 'photo.png');
    assert.equal(second.name, 'photo-2.png');
    assert.ok(first.path.includes('.fundet-uploads'));
    assert.equal(fs.readFileSync(first.path).length, 16);
    assert.equal(first.kind, 'image');
  });
});

describe('stageBytesIntoWorkDir', () => {
  it('writes a clipboard blob', () => {
    const root = path.join(tmp, 'bytes');
    fs.mkdirSync(root, { recursive: true });
    const staged = stageBytesIntoWorkDir(root, 'paste.png', new Uint8Array([1, 2, 3]));
    assert.equal(staged.name, 'paste.png');
    assert.deepEqual([...fs.readFileSync(staged.path)], [1, 2, 3]);
  });
});
