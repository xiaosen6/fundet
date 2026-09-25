import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decideGitRuntimeExtract } from './git-runtime-logic.ts';

const base = {
  bundledTgz: 'R:\\runtime\\git.tar.gz',
  targetDir: 'U:\\runtime\\git',
  extractedMarker: 'U:\\runtime\\git\\VERSION',
};

function mk(files: Record<string, string | true>) {
  return {
    exists: (p: string) => p in files,
    read: (p: string) => (typeof files[p] === 'string' ? (files[p] as string) : ''),
  };
}

test('decideGitRuntimeExtract：无 tgz / 无版本 → 不解压', () => {
  assert.equal(decideGitRuntimeExtract(mk({}), { ...base, bundledVersion: '2.55' }), false);
  assert.equal(
    decideGitRuntimeExtract(mk({ [base.bundledTgz]: true }), { ...base, bundledVersion: null }),
    false,
  );
});

test('decideGitRuntimeExtract：同版本标记 + bash 在场 → 跳过（幂等）', () => {
  assert.equal(
    decideGitRuntimeExtract(
      mk({ [base.bundledTgz]: true, [base.extractedMarker]: '2.55', [`${base.targetDir}\\bin\\bash.exe`]: true }),
      { ...base, bundledVersion: '2.55' },
    ),
    false,
  );
});

test('decideGitRuntimeExtract：版本不匹配 / 无标记 / bash 缺失 → 重解', () => {
  assert.equal(
    decideGitRuntimeExtract(
      mk({ [base.bundledTgz]: true, [base.extractedMarker]: '2.54', [`${base.targetDir}\\bin\\bash.exe`]: true }),
      { ...base, bundledVersion: '2.55' },
    ),
    true,
  );
  assert.equal(
    decideGitRuntimeExtract(mk({ [base.bundledTgz]: true }), { ...base, bundledVersion: '2.55' }),
    true,
  );
  assert.equal(
    decideGitRuntimeExtract(
      mk({ [base.bundledTgz]: true, [base.extractedMarker]: '2.55' }),
      { ...base, bundledVersion: '2.55' },
    ),
    true,
  );
});
