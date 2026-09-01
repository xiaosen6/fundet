import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFilePreviewUrl,
  parseFilePreviewUrl,
  FILE_PROTOCOL_SCHEME,
} from './file-preview-url.ts';

describe('file preview url', () => {
  it('round-trips a posix workdir file', () => {
    const url = buildFilePreviewUrl('/home/u/proj', '/home/u/proj/out/index.html');
    assert.ok(url);
    assert.ok(url.startsWith(`${FILE_PROTOCOL_SCHEME}://work/`));
    assert.deepEqual(parseFilePreviewUrl(url), {
      workDir: '/home/u/proj',
      relPath: 'out/index.html',
    });
  });

  it('round-trips windows paths and keeps relative assets', () => {
    const url = buildFilePreviewUrl('D:\\proj', 'D:\\proj\\site\\index.html');
    assert.ok(url);
    const parsed = parseFilePreviewUrl(url);
    assert.equal(parsed?.relPath, 'site/index.html');
    assert.equal(parsed?.workDir.replace(/\//g, '\\'), 'D:\\proj');
  });

  it('rejects files outside the workdir', () => {
    assert.equal(buildFilePreviewUrl('/home/u/proj', '/etc/passwd'), null);
  });

  it('accepts a relative path already inside the workdir', () => {
    const url = buildFilePreviewUrl('/home/u/proj', '.longma-uploads/a.mp4');
    assert.deepEqual(parseFilePreviewUrl(url!), {
      workDir: '/home/u/proj',
      relPath: '.longma-uploads/a.mp4',
    });
  });
});
