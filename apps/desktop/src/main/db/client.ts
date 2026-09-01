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

  const sqlite = new Database(file);
  // 外键默认关闭，messages 的 cascade 删除依赖它
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  // 启动自查：确认原生模块在当前 Electron ABI 下可用
  const row = sqlite.prepare('select sqlite_version() as v').get() as { v: string };
  console.log(`[fundet:db] better-sqlite3 OK, sqlite ${row.v}, file=${file}`);

  db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: resolveMigrationsFolder() });
  console.log('[fundet:db] migrations applied');
  return db;
}

export function getDb(): FundetDb {
  if (!db) throw new Error('database not initialised: call initDatabase() first');
  return db;
}
