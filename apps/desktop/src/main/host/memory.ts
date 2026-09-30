/**
 * MakerMemoryManager 的 desktop 工厂（参照 Cindy maker-memory-host.ts，裁掉账号分区）。
 *
 * host-only 依赖注入：
 *  - sqliteFactory: better-sqlite3 实例（native module，agent-core 只 import type）
 *  - basePath: app.getPath('userData')；manager 内部自拼 'maker-memory/<sanitized-workdir>/'
 *  - initialEnabled: 读 settings `memory.enabled`（默认开；设置面板/记忆面板可关）
 *
 * 鸡生蛋（manager 要 agents，agents 要 manager）：构造时 agents 传 {}，
 * pi-host 装配完 PiAgent 后调 manager.setAgents({ pi })。
 */
import path from 'node:path';
import { app } from 'electron';
import Database from 'better-sqlite3';
import {
  MakerMemoryManager,
  type Logger,
  type SqliteFactory,
} from '@fundet/agent-core';
import { getBoolSetting } from '../db/settings.js';
import { MEMORY_ENABLED_SETTING } from '../../shared/memory.js';

const sqliteFactory: SqliteFactory = (filePath) => {
  // 与 db/client.ts 同口径：WAL 多会话并发更稳，busyTimeout 防小撞锁
  const db = new Database(filePath);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  return db;
};

export function createFundetMemoryManager(logger: Logger): MakerMemoryManager {
  return new MakerMemoryManager({
    basePath: path.join(app.getPath('userData')),
    sqliteFactory,
    agents: {}, // 占位，pi-host 装配后 setAgents 补上
    logger: logger.child('memory'),
    initialEnabled: getBoolSetting(MEMORY_ENABLED_SETTING, true),
    // 只有一个 agent：memory_review 的 oneShot 走 pi（当前 PiAgent 未实现
    // oneShot——内置 memory MCP 不暴露 memory_review，此配置仅为接口完备）
    reviewAgent: 'pi',
  });
}
