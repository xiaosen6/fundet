/**
 * messages_fts 写入路径回归：真机 0.2.26 曾因「表只在搜索入口建」而
 * 首次 send 即 no such table。此处用内存库复现三种库状态。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { ensureMessagesFts, indexMessageContent, upsertMessageFts } from './messages-fts.ts';

function virginDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  return db;
}

const ftsCount = (db: Database.Database): number =>
  (db.prepare('SELECT COUNT(*) AS n FROM messages_fts').get() as { n: number }).n;

test('upsert 在无 fts 表的旧库上不炸且自动建表入索引（真机 0.2.26 场景）', () => {
  const db = virginDb(); // 注意：没有建 messages_fts
  assert.throws(() => db.prepare('SELECT COUNT(*) FROM messages_fts'), /no such table/);
  upsertMessageFts(db, 1, JSON.stringify({ text: '在钉钉查询一下张章的联系方式' }));
  assert.equal(ftsCount(db), 1);
  db.close();
});

test('空 text 行清残留（OR REPLACE 语义的另一半）', () => {
  const db = virginDb();
  upsertMessageFts(db, 5, JSON.stringify({ text: '第一条' }));
  assert.equal(ftsCount(db), 1);
  upsertMessageFts(db, 5, JSON.stringify({ type: 'tool_use' })); // 无 {text} → 清行
  assert.equal(ftsCount(db), 0);
  db.close();
});

test('rowid 复用时 REPLACE 覆盖旧行', () => {
  const db = virginDb();
  upsertMessageFts(db, 7, JSON.stringify({ text: '旧消息' }));
  upsertMessageFts(db, 7, JSON.stringify({ text: '新消息复用同一行' }));
  assert.equal(ftsCount(db), 1);
  // 存的是 bigram 分词串：验新旧词元切换而非原文
  const row = db.prepare('SELECT text FROM messages_fts WHERE rowid = 7').get() as { text: string };
  assert.match(row.text, /新消/);
  assert.doesNotMatch(row.text, /旧消/);
  db.close();
});

test('ensureMessagesFts 对存量消息回填且幂等', () => {
  const db = virginDb();
  const ins = db.prepare('INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)');
  ins.run('a', 's1', 'user', JSON.stringify({ text: '查张章手机号' }), 1);
  ins.run('b', 's1', 'assistant', JSON.stringify({ text: '张章的联系方式如下' }), 2);
  ins.run('c', 's1', 'tool', JSON.stringify({ name: 'contact.search' }), 3); // 非 {text} 不入索引
  ensureMessagesFts(db);
  assert.equal(ftsCount(db), 2);
  ensureMessagesFts(db); // 二次调用不重复回填
  assert.equal(ftsCount(db), 2);
  db.close();
});

test('indexMessageContent：中文 bigram 可被 MATCH 命中', () => {
  const db = virginDb();
  upsertMessageFts(db, 1, JSON.stringify({ text: '帮我查张章的联系方式' }));
  const hit = db
    .prepare("SELECT COUNT(*) AS n FROM messages_fts WHERE messages_fts MATCH '张章'")
    .get() as { n: number };
  assert.equal(hit.n, 1);
  assert.equal(indexMessageContent('not json'), '');
  db.close();
});
