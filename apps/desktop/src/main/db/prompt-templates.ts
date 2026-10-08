/**
 * prompt_templates 表读写：常用提示词模板（设置页管理，composer 一键插入）。
 * 函数收 better-sqlite3 句柄参数（对齐 messages-fts 做法）：不依赖 initDatabase，
 * node --test 可在内存库直跑；生产侧由 ipc/register 用 getSqlite() 注入。
 */
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { PromptTemplateInput, PromptTemplateView } from '../../shared/prompt-templates.ts';

interface Row {
  id: string;
  title: string;
  content: string;
  created_at: number;
  updated_at: number;
  sort: number;
}

/** 幂等建表（client.ts initDatabase 启动时调用；测试里手动调用） */
export function ensurePromptTemplatesTable(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS prompt_templates (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    sort INTEGER NOT NULL DEFAULT 0
  )`);
}

function toView(row: Row): PromptTemplateView {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sort: row.sort,
  };
}

/** sort 升序，同序按 updated_at 降序（v1 sort 恒 0，即最近编辑靠前） */
export function listPromptTemplates(db: Database.Database): PromptTemplateView[] {
  return (db
    .prepare('SELECT * FROM prompt_templates ORDER BY sort ASC, updated_at DESC')
    .all() as Row[]).map(toView);
}

export function getPromptTemplate(db: Database.Database, id: string): PromptTemplateView | null {
  const row = db.prepare('SELECT * FROM prompt_templates WHERE id = ?').get(id) as Row | undefined;
  return row ? toView(row) : null;
}

/** 新建（id 空）或更新（带 id，不存在报错）；返回落库后的完整行 */
export function savePromptTemplate(db: Database.Database, input: PromptTemplateInput): PromptTemplateView {
  const title = input.title.trim();
  if (!title) throw new Error('模板标题不能为空');
  // 内容只做非空校验不 trim 落库：多行提示词的首尾换行可能是刻意排版
  if (!input.content.trim()) throw new Error('模板内容不能为空');
  const now = Date.now();
  if (input.id) {
    const info = db
      .prepare('UPDATE prompt_templates SET title = ?, content = ?, updated_at = ? WHERE id = ?')
      .run(title, input.content, now, input.id);
    if (info.changes === 0) throw new Error(`提示词模板不存在: ${input.id}`);
    return getPromptTemplate(db, input.id)!;
  }
  const id = randomUUID();
  db.prepare(
    'INSERT INTO prompt_templates (id, title, content, created_at, updated_at, sort) VALUES (?, ?, ?, ?, ?, 0)',
  ).run(id, title, input.content, now, now);
  return getPromptTemplate(db, id)!;
}

/** 删除；不存在的 id 静默成功（幂等），返回是否真的删了行 */
export function deletePromptTemplate(db: Database.Database, id: string): boolean {
  return db.prepare('DELETE FROM prompt_templates WHERE id = ?').run(id).changes > 0;
}
