/**
 * prompt_templates CRUD 回归：内存库直跑（函数收 sqlite 句柄，不依赖 initDatabase）。
 * 覆盖：建表幂等 / 保存（新建+更新）/ 列表排序 / 删除幂等 / 入参校验。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {
  deletePromptTemplate,
  ensurePromptTemplatesTable,
  listPromptTemplates,
  savePromptTemplate,
} from './prompt-templates.ts';

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  ensurePromptTemplatesTable(db);
  return db;
}

test('建表幂等：重复 ensure 不炸不重复建', () => {
  const db = new Database(':memory:');
  ensurePromptTemplatesTable(db);
  ensurePromptTemplatesTable(db);
  const n = (db.prepare('SELECT COUNT(*) AS n FROM prompt_templates').get() as { n: number }).n;
  assert.equal(n, 0);
  db.close();
});

test('新建 → 列表可见；字段与排序默认值完整', () => {
  const db = freshDb();
  const created = savePromptTemplate(db, { title: '  周报汇总  ', content: '汇总本周进展' });
  assert.ok(created.id);
  assert.equal(created.title, '周报汇总'); // 标题 trim 落库
  assert.equal(created.content, '汇总本周进展');
  assert.equal(created.sort, 0);
  assert.ok(created.createdAt > 0 && created.updatedAt >= created.createdAt);
  const list = listPromptTemplates(db);
  assert.equal(list.length, 1);
  assert.equal(list[0]!.id, created.id);
  db.close();
});

test('编辑同 id：单行覆盖，不新增', () => {
  const db = freshDb();
  const a = savePromptTemplate(db, { title: '旧标题', content: '旧内容' });
  const b = savePromptTemplate(db, { id: a.id, title: '新标题', content: '新内容\n第二行' });
  assert.equal(b.id, a.id);
  assert.equal(b.title, '新标题');
  assert.equal(b.content, '新内容\n第二行'); // 多行内容原样保留
  assert.ok(b.updatedAt >= a.updatedAt);
  const list = listPromptTemplates(db);
  assert.equal(list.length, 1); // 更新不是插入
  db.close();
});

test('编辑不存在的 id 报错', () => {
  const db = freshDb();
  assert.throws(() => savePromptTemplate(db, { id: 'nope', title: 't', content: 'c' }), /不存在/);
  db.close();
});

test('内容只校验非空不 trim：首尾换行保留；空白内容拒绝', () => {
  const db = freshDb();
  const t = savePromptTemplate(db, { title: 't', content: '\n带首尾换行\n' });
  assert.equal(t.content, '\n带首尾换行\n');
  assert.throws(() => savePromptTemplate(db, { title: 't', content: '   \n  ' }), /内容不能为空/);
  assert.throws(() => savePromptTemplate(db, { title: '   ', content: 'c' }), /标题不能为空/);
  db.close();
});

test('列表排序：sort 升序，同序按 updated_at 降序（最近编辑靠前）', () => {
  const db = freshDb();
  const a = savePromptTemplate(db, { title: 'a', content: 'ca' });
  const b = savePromptTemplate(db, { title: 'b', content: 'cb' });
  // 编辑 a 后 a 的 updated_at 不小于 b → a 靠前
  savePromptTemplate(db, { id: a.id, title: 'a2', content: 'ca2' });
  db.prepare('UPDATE prompt_templates SET sort = -1, updated_at = 1 WHERE id = ?').run(b.id);
  const list = listPromptTemplates(db);
  assert.equal(list.map((t) => t.title).join(','), 'b,a2'); // b 的 sort=-1 恒靠前
  db.close();
});

test('删除幂等：存在的删掉，再删不炸', () => {
  const db = freshDb();
  const a = savePromptTemplate(db, { title: 'a', content: 'c' });
  assert.equal(deletePromptTemplate(db, a.id), true);
  assert.equal(listPromptTemplates(db).length, 0);
  assert.equal(deletePromptTemplate(db, a.id), false); // 重复删：静默
  assert.equal(deletePromptTemplate(db, 'never-existed'), false);
  db.close();
});
