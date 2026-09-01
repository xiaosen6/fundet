import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { gitPathEntriesFromRoots } from '../windows-git-path-lite.js';

describe('windows git path lite', () => {
  it('collects cmd/bin dirs that contain bash.exe, deduped', () => {
    const exists = (p: string) => p.includes('ok');
    const root = path.join('C:', 'Git(ok)');
    const out = gitPathEntriesFromRoots([root, root, path.join('D:', 'NoBash')], exists);
    expect(out).toEqual([path.join(root, 'cmd'), path.join(root, 'bin')]);
  });

  it('skips empty roots and missing dirs', () => {
    expect(gitPathEntriesFromRoots(['', path.join('C:', 'X')], () => false)).toEqual([]);
  });
});
