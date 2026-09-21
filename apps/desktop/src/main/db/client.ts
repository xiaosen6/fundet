/**
 * 数据库入口：打开 userData/fundet.db，执行 migration，导出 drizzle 实例。
 *
 * better-sqlite3 是原生模块，需先经 `pnpm rebuild:native`（@electron/rebuild）
 * 按 Electron ABI 重编译，否则这里 require 即炸。initDatabase 的自查日志
 * 就是验收点之一。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from 'electron';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.js';

export type FundetDb = BetterSQLite3Database<typeof schema>;

let db: FundetDb | null = null;
let sqlite: Database.Database | null = null;

/**
 * migrations 目录：dev 下 out/main → ../../drizzle = apps/desktop/drizzle；
 * 打包后 out/main 在 app.asar 内，同一相对路径解析到 app.asar/drizzle
 * （drizzle/** 已列入 electron-builder files；migrate 只用 fs 读 SQL，asar 内可读）。
 */
function resolveMigrationsFolder(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '../../drizzle');
}

export function initDatabase(): FundetDb {
  if (db) return db;

  const file = path.join(app.getPath('userData'), 'fundet.db');
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const native = new Database(file);
  // 外键默认关闭，messages 的 cascade 删除依赖它
  native.pragma('journal_mode = WAL');
  native.pragma('foreign_keys = ON');
  sqlite = native;

  // 启动自查：确认原生模块在当前 Electron ABI 下可用
  const row = sqlite.prepare('select sqlite_version() as v').get() as { v: string };
  console.log(`[fundet:db] better-sqlite3 OK, sqlite ${row.v}, file=${file}`);

  db = drizzle(native, { schema });
  migrate(db, { migrationsFolder: resolveMigrationsFolder() });
  // 幂等补列（对齐 knowledge store 做法；drizzle-kit 生成迁移留给大版本）：
  // sessions.pinned/sort_order —— 侧栏置顶与手动排序
  const sessionCols = new Set(
    (native.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>).map((c) => c.name),
  );
  if (!sessionCols.has('pinned')) {
    native.prepare('ALTER TABLE sessions ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0').run();
  }
  if (!sessionCols.has('sort_order')) {
    native.prepare('ALTER TABLE sessions ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0').run();
  }
  // 幂等建表（自动化：定时例行任务；对齐 messages_fts 的 raw SQL 做法）
  native.prepare(`CREATE TABLE IF NOT EXISTS automations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    schedule TEXT NOT NULL,
    time TEXT,
    day INTEGER,
    cron TEXT,
    instructions TEXT NOT NULL,
    work_dir TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    next_run_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`).run();
  native.prepare(`CREATE TABLE IF NOT EXISTS automation_runs (
    id TEXT PRIMARY KEY,
    automation_id TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    started_at INTEGER,
    ended_at INTEGER,
    error TEXT,
    created_at INTEGER NOT NULL
  )`).run();
  native.prepare('CREATE INDEX IF NOT EXISTS idx_automation_runs_automation ON automation_runs(automation_id)').run();
  // 幂等补列（0.3.0 自动化对齐 Cindy：interval/once/可选模型）
  const autoCols = new Set(
    (native.prepare('PRAGMA table_info(automations)').all() as Array<{ name: string }>).map((c) => c.name),
  );
  if (!autoCols.has('interval_minutes')) {
    native.prepare('ALTER TABLE automations ADD COLUMN interval_minutes INTEGER').run();
  }
  if (!autoCols.has('model')) {
    native.prepare('ALTER TABLE automations ADD COLUMN model TEXT').run();
  }
  if (!autoCols.has('provider_id')) {
    native.prepare('ALTER TABLE automations ADD COLUMN provider_id TEXT').run();
  }
  if (!autoCols.has('last_run_at')) {
    native.prepare('ALTER TABLE automations ADD COLUMN last_run_at INTEGER').run();
  }
  console.log('[fundet:db] migrations applied');
  return db;
}

export function getDb(): FundetDb {
  if (!db) throw new Error('database not initialised: call initDatabase() first');
  return db;
}

/** 原生 better-sqlite3 句柄：FTS5 虚表等 raw SQL 场景用 */
export function getSqlite(): Database.Database {
  if (!sqlite) throw new Error('database not initialised: call initDatabase() first');
  return sqlite;
}
