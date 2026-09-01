import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeFileName, uniqueDestName } from './file-name.ts';

describe('sanitizeFileName', () => {
  it('strips path segments and reserved characters', () => {
    assert.equal(sanitizeFileName('C:\\\\Users\\\\a\\\\photo.png'), 'photo.png');
    assert.equal(sanitizeFileName('a<b>.mp4'), 'a_b_.mp4');
    assert.equal(sanitizeFileName('../secret.txt'), 'secret.txt');
    assert.equal(sanitizeFileName('..\\secret.txt'), 'secret.txt');
  });

  it('rewrites leading dots on the basename', () => {
    assert.equal(sanitizeFileName('.env'), '_env');
  });
});

describe('uniqueDestName', () => {
  it('keeps the original when free', () => {
    assert.equal(uniqueDestName(new Set(), 'clip.mp4'), 'clip.mp4');
  });

  it('appends -2, -3, … on collision (case-insensitive)', () => {
    const existing = new Set(['clip.mp4', 'clip-2.mp4']);
    assert.equal(uniqueDestName(existing, 'CLIP.mp4'), 'CLIP-3.mp4');
  });
});
