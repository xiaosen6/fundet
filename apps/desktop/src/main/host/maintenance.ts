/**
 * 统一运维清扫（0.3.30 十联修）：启动时跑一次，处理所有「有增长无清理」的路径。
 *
 * P1-3: .fundet-uploads/ TTL 清理（7 天前的 stage 文件——IM 图片/截图/拖入附件）
 * P2-5: fundet.db wal_checkpoint(TRUNCATE)（WAL 收缩，防 -wal 文件涨后常驻）
 * P2-6: settings 表孤儿键清扫（kb.session.* / im.session.* 对应会话已删）
 */
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { getSqlite } from '../db/client.js';

const UPLOADS_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天
const UPLOADS_DIR_MAX_BYTES = 512 * 1024 * 1024; // 512MB 总量上限

/** P1-3: .fundet-uploads/ 清理——7 天前的删 + 总量超 512MB 时 LRU 删 */
function cleanupUploadsDir(workDirs: string[]): void {
  const now = Date.now();
  let totalCleaned = 0;
  for (const workDir of workDirs) {
    const uploadsDir = path.join(workDir, '.fundet-uploads');
    if (!fs.existsSync(uploadsDir)) continue;
    try {
      const files = fs
        .readdirSync(uploadsDir)
        .filter((f) => f !== '.' && f !== '..')
        .map((f) => {
          const p = path.join(uploadsDir, f);
          try {
            return { p, stat: fs.statSync(p), mtime: fs.statSync(p).mtimeMs };
          } catch {
            return null;
          }
        })
        .filter(Boolean) as Array<{ p: string; stat: fs.Stats; mtime: number }>;
      // TTL 删
      for (const f of files) {
        if (now - f.mtime > UPLOADS_TTL_MS) {
          try {
            fs.rmSync(f.p, { force: true });
            totalCleaned++;
          } catch { /* ignore */ }
        }
      }
      // 总量检查（TTL 删后重算）
      const remaining = files.filter((f) => fs.existsSync(f.p));
      const totalSize = remaining.reduce((n, f) => n + f.stat.size, 0);
      if (totalSize > UPLOADS_DIR_MAX_BYTES) {
        // LRU 删最旧的直到低于上限
        remaining.sort((a, b) => a.mtime - b.mtime);
        let size = totalSize;
        for (const f of remaining) {
          if (size <= UPLOADS_DIR_MAX_BYTES) break;
          try {
            fs.rmSync(f.p, { force: true });
            size -= f.stat.size;
            totalCleaned++;
          } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }
  }
  if (totalCleaned > 0) console.log(`[fundet:maintenance] .fundet-uploads 清理 ${totalCleaned} 个文件`);
}

/** P2-5: WAL 收缩（防 -wal 涨到峰值后常驻不缩） */
function checkpointWal(): void {
  try {
    getSqlite().pragma('wal_checkpoint(TRUNCATE)');
  } catch {
    /* ignore */
  }
}

/** P2-6: settings 表孤儿键清扫 */
function cleanupOrphanSettings(validSessionIds: Set<string>): number {
  const sqlite = getSqlite();
  const rows = sqlite.prepare("SELECT key FROM settings WHERE key LIKE 'kb.session.%' OR key LIKE 'im.session.%'").all() as Array<{ key: string }>;
  let removed = 0;
  for (const r of rows) {
    // kb.session.<sessionId> / im.session.<channel>.<chatId>
    // im.session 键里的 sessionId 在冒号后——需要查 sessions 表有没有对应行
    const sessionId = r.key.replace(/^kb\.session\./, '').replace(/^im\.session\.[^.]+\./, '');
    if (sessionId && !validSessionIds.has(sessionId)) {
      sqlite.prepare('DELETE FROM settings WHERE key = ?').run(r.key);
      removed++;
    }
  }
  if (removed > 0) console.log(`[fundet:maintenance] settings 孤儿键清扫 ${removed} 条`);
  return removed;
}

/** P3-10: .skillhub-tmp-* 临时目录清扫（安装中断残留） */
function cleanupSkillhubTmp(): void {
  const tmp = require('node:os').tmpdir();
  try {
    for (const e of fs.readdirSync(tmp, { withFileTypes: true })) {
      if (e.isDirectory() && e.name.startsWith('.skillhub-tmp-')) {
        fs.rmSync(path.join(tmp, e.name), { recursive: true, force: true });
      }
    }
  } catch { /* ignore */ }
}

/** 主入口：启动时调用一次 */
export function runMaintenanceCleanup(validSessionIds: Set<string>, workDirs: string[]): void {
  cleanupAgentHomeSafe();
  cleanupUploadsDir(workDirs);
  checkpointWal();
  cleanupOrphanSettings(validSessionIds);
  cleanupSkillhubTmp();
}

/** agent-home 清理的本地包装（不 import electron 以保可测） */
function cleanupAgentHomeSafe(): void {
  try {
    const { cleanupAgentHome } = require('./agent-home-cleanup.js');
    cleanupAgentHome();
  } catch { /* ignore */ }
}
