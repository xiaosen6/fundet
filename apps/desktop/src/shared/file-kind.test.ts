import { describe, it, test } from 'node:test';
import assert from 'node:assert/strict';
import { extOf, fileKind, isImagePath, mimeFromExt, sendBlockKind, sniffImageMime, MAX_IMAGE_BYTES } from './file-kind.ts';

describe('extOf', () => {
  it('reads the last extension, case-insensitive', () => {
    assert.equal(extOf('D:\\\\proj\\\\A.MP4'), '.mp4');
    assert.equal(extOf('/tmp/out/index.html'), '.html');
    assert.equal(extOf('README'), '');
  });
});

describe('fileKind', () => {
  it('classifies preview families', () => {
    assert.equal(fileKind('a.png'), 'image');
    assert.equal(fileKind('clip.webm'), 'video');
    assert.equal(fileKind('talk.mp3'), 'audio');
    assert.equal(fileKind('page.HTML'), 'html');
    assert.equal(fileKind('doc.pdf'), 'pdf');
    assert.equal(fileKind('note.md'), 'markdown');
    assert.equal(fileKind('main.ts'), 'text');
    assert.equal(fileKind('archive.zip'), 'other');
  });
});

describe('isImagePath / mime / sendBlockKind', () => {
  it('treats jpeg as image', () => {
    assert.equal(isImagePath('photo.JPEG'), true);
    assert.equal(mimeFromExt('photo.jpg'), 'image/jpeg');
    assert.equal(sendBlockKind('photo.jpg', 100), 'image');
  });

  it('sends oversized images as file path references', () => {
    assert.equal(sendBlockKind('huge.png', MAX_IMAGE_BYTES + 1), 'file');
  });

  it('sends video as a file reference', () => {
    assert.equal(sendBlockKind('clip.mp4', 12), 'file');
    assert.equal(mimeFromExt('.mp4'), 'video/mp4');
  });
});

test('sniffImageMime 魔数嗅探覆盖扩展名误报', () => {
  // QQ「原图」：PNG 字节套 .jpeg 扩展名
  const pngHead = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  assert.equal(sniffImageMime(pngHead, 'image/jpeg'), 'image/png');
  const jpegHead = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
  assert.equal(sniffImageMime(jpegHead, 'image/png'), 'image/jpeg');
  const webpHead = new Uint8Array([0x52, 0x49, 0x46, 0x66, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  assert.equal(sniffImageMime(webpHead, 'image/png'), 'image/webp');
  const gifHead = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
  assert.equal(sniffImageMime(gifHead, 'image/png'), 'image/gif');
  // 未知字节回落扩展名
  assert.equal(sniffImageMime(new Uint8Array([0, 0, 0, 0]), 'image/avif'), 'image/avif');
  assert.equal(sniffImageMime(new Uint8Array(0), 'image/jpeg'), 'image/jpeg');
});
