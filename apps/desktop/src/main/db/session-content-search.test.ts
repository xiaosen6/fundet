/**
 * searchSessionContent（session:search-content 数据层）回归：
 * 聚合（同会话取最优匹配一条）/ 排序（会话 updatedAt 倒序）/ limit / <2 字符 /
 * auto- 隔离 / 写入链路（伴生写后立即可搜）/ 存量回填（ensure 幂等）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { searchSessionContent, snippetAround } from './session-content-search.ts';
import { upsertMessageFts } from './messages-fts.ts';

function virginDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL
    );
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

let msgSeq = 0;

/** 复刻 insertMessage 写入链：主表插入 + FTS 伴生写（真实链路等价物，client.ts 依赖 electron 不可直跑） */
function addMessage(db: Database.Database, sessionId: string, text: string, role = 'user'): void {
  msgSeq += 1;
  const id = `m${msgSeq}`;
  const contentJson = JSON.stringify({ text });
  db.prepare(
    'INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(id, sessionId, role, contentJson, msgSeq);
  const row = db.prepare('SELECT rowid FROM messages WHERE id = ?').get(id) as { rowid: number };
  upsertMessageFts(db, row.rowid, contentJson);
}

function addSession(db: Database.Database, id: string, title: string, updatedAt: number): void {
  db.prepare('INSERT INTO sessions (id, title, updated_at) VALUES (?, ?, ?)').run(id, title, updatedAt);
}

test('伴生写后正文可搜：命中带标题与 snippet（写入路径端到端）', () => {
  const db = virginDb();
  addSession(db, 's1', '报销流程咨询', 100);
  addMessage(db, 's1', '帮我查张章的联系方式');
  const hits = searchSessionContent(db, '张章');
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.sessionId, 's1');
  assert.equal(hits[0]!.title, '报销流程咨询');
  assert.ok(hits[0]!.snippet.includes('张章'));
  db.close();
});

test('同一会话多消息聚合为一条，snippet 取自最优匹配（bm25 高频者胜）', () => {
  const db = virginDb();
  addSession(db, 's1', '联系人', 100);
  addMessage(db, 's1', '帮我查一下张章的联系方式'); // 词频 1
  addMessage(db, 's1', '张章的手机号、张章的邮箱、张章的工号都要'); // 词频 3 → bm25 更优
  const hits = searchSessionContent(db, '张章');
  assert.equal(hits.length, 1);
  assert.ok(hits[0]!.snippet.includes('邮箱'), `snippet 应取自高频消息: ${hits[0]!.snippet}`);
  db.close();
});

test('按会话 updatedAt 倒序 + limit 截断（与消息 rank 无关）', () => {
  const db = virginDb();
  addSession(db, 'old', '旧', 100);
  addSession(db, 'mid', '中', 200);
  addSession(db, 'new', '新', 300);
  addMessage(db, 'old', '项目进度第一版');
  addMessage(db, 'mid', '项目进度第二版');
  addMessage(db, 'new', '项目进度第三版');
  const all = searchSessionContent(db, '项目');
  assert.deepEqual(all.map((h) => h.sessionId), ['new', 'mid', 'old']);
  const limited = searchSessionContent(db, '项目', 2);
  assert.deepEqual(limited.map((h) => h.sessionId), ['new', 'mid']);
  db.close();
});

test('<2 字符 / 空白 / 纯符号查询返回空', () => {
  const db = virginDb();
  addSession(db, 's1', 't', 100);
  addMessage(db, 's1', '张章张章');
  assert.deepEqual(searchSessionContent(db, '张'), []);
  assert.deepEqual(searchSessionContent(db, '  '), []);
  assert.deepEqual(searchSessionContent(db, '！！'), []); // 无有效词元
  db.close();
});

test('auto- 隔离会话与孤儿消息（无 session 行）不进结果', () => {
  const db = virginDb();
  addSession(db, 'auto-run1', '自动化', 999);
  addMessage(db, 'auto-run1', '查张章');
  addMessage(db, 'orphan', '查张章'); // 无 sessions 行
  assert.deepEqual(searchSessionContent(db, '张章'), []);
  db.close();
});

test('标题不参与正文搜索（标题命中在渲染层本地过滤）', () => {
  const db = virginDb();
  addSession(db, 's1', '会议纪要', 100);
  addMessage(db, 's1', '今天讨论了发布流程');
  assert.deepEqual(searchSessionContent(db, '会议'), []);
  db.close();
});

test('存量库（伴生写缺席）首搜自动回填，且重复搜索结果稳定（ensure 幂等）', () => {
  const db = virginDb();
  addSession(db, 's1', '旧库会话', 100);
  // 模拟 0.2.27 前的旧行为：只写主表，未伴生写 FTS
  db.prepare(
    "INSERT INTO messages (id, session_id, role, content, created_at) VALUES ('legacy', 's1', 'user', ?, 1)",
  ).run(JSON.stringify({ text: '历史消息里提到张章的工号' }));
  const first = searchSessionContent(db, '张章');
  assert.equal(first.length, 1);
  assert.equal(first[0]!.sessionId, 's1');
  const second = searchSessionContent(db, '张章');
  assert.deepEqual(second, first);
  db.close();
});

test('snippetAround：无命中取开头，命中取上下文并加省略号', () => {
  const long = '前奏'.repeat(30) + '关键词' + '后奏'.repeat(30);
  const snip = snippetAround(long, ['关键词']);
  assert.ok(snip.includes('关键词'));
  assert.ok(snip.startsWith('…') || snip.includes('关键词'));
  assert.ok(snip.length <= 84);
  assert.equal(snippetAround('短文本没有词元命中', ['不存在']), '短文本没有词元命中');
  assert.equal(snippetAround('', ['x']), '');
});
