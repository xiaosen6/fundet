import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { managedRuntimeNeedsStop, profileUsesAppBoundEncryption } from './real-profile.ts';

let tmpDir: string | null = null;

function makeCookieDb(rows: Array<{ encrypted: Buffer } | { noColumn: true }>): string {
  tmpDir ??= fs.mkdtempSync(path.join(os.tmpdir(), 'fundet-real-profile-'));
  const dir = fs.mkdtempSync(path.join(tmpDir, 'profile-'));
  const db = new Database(path.join(dir, 'Cookies'));
  try {
    if (rows.length > 0 && 'noColumn' in rows[0]) {
      db.exec('CREATE TABLE cookies (host_key TEXT)');
    } else {
      db.exec('CREATE TABLE cookies (host_key TEXT, encrypted_value BLOB)');
      const insert = db.prepare('INSERT INTO cookies (host_key, encrypted_value) VALUES (?, ?)');
      for (const row of rows) {
        if ('encrypted' in row) insert.run('.example.com', row.encrypted);
      }
    }
  } finally {
    db.close();
  }
  return dir;
}

const V20 = Buffer.concat([Buffer.from('v20', 'utf8'), Buffer.alloc(32, 7)]);

describe('managedRuntimeNeedsStop（#3751 pid 判停）', () => {
  it('running=true 判活，哪怕没有 pid', () => {
    assert.equal(managedRuntimeNeedsStop({ running: true }), true);
  });
  it('running=false 且无 pid 判停', () => {
    assert.equal(managedRuntimeNeedsStop({ running: false }), false);
  });
  it('running=false 但 pid 还在判活（标志未置位的中间态）', () => {
    assert.equal(managedRuntimeNeedsStop({ running: false, pid: 1234 }), true);
  });
  it('pid 非法形态判状态不可知', () => {
    assert.equal(managedRuntimeNeedsStop({ running: false, pid: 'x' }), null);
    assert.equal(managedRuntimeNeedsStop({ running: false, pid: 0 }), null);
  });
  it('非对象/缺字段返回 null', () => {
    assert.equal(managedRuntimeNeedsStop(null), null);
    assert.equal(managedRuntimeNeedsStop('x'), null);
    assert.equal(managedRuntimeNeedsStop({}), null);
    assert.equal(managedRuntimeNeedsStop({ pid: 5 }), null);
  });
});

describe('profileUsesAppBoundEncryption（#3751 App-Bound 检测）', () => {
  it('检出 v20 前缀加密行报 true', () => {
    const dir = makeCookieDb([{ encrypted: V20 }]);
    assert.equal(profileUsesAppBoundEncryption(dir), true);
  });
  it('普通加密行报 false', () => {
    const dir = makeCookieDb([{ encrypted: Buffer.alloc(32, 1) }]);
    assert.equal(profileUsesAppBoundEncryption(dir), false);
  });
  it('无 encrypted_value 列的旧库报 false', () => {
    const dir = makeCookieDb([{ noColumn: true }]);
    assert.equal(profileUsesAppBoundEncryption(dir), false);
  });
  it('非 Windows 直接 false，不读库', () => {
    assert.equal(profileUsesAppBoundEncryption('Z:/definitely-not-there', 'linux'), false);
  });
});

after(() => {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});
