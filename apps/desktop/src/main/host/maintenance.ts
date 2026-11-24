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
import { cleanupAgentHome } from './agent-home-cleanup.js';
import { decideOrphanSettingKeys } from './orphan-settings.js';
import { createSessionOutboxStore } from '../db/session-outbox.js';

const UPLOADS_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天
const UPLOADS_DIR_MAX_BYTES = 512 * 1024 * 1024; // 512MB 总量上限

/** P1-3: .fundet-uploads/ 清理——7 天前的删 + 总量超 512MB 时 LRU 删。
 *  outbox 未终态行引用的附件跳过（排队消息重启后还要发，附件不能被清走）。 */
function cleanupUploadsDir(workDirs: string[]): void {
  const now = Date.now();
  // 受保护路径：durable outbox 未终态行的载荷附件（路径归一化比较）。
  // 走 store.pendingAttachmentPaths（从每个附件对象里取 .path）——2026-11-24
  // 修复：此前内联 SQL 取的是整个附件 JSON 对象再与路径字符串比较，永不相等，
  // 排队消息超 7 天 TTL / 超 512MB 上限时附件会被误清，重启后发送缺件。
  let protectedPaths: Set<string> | null = null;
  try {
    protectedPaths = new Set(
      createSessionOutboxStore(getSqlite())
        .pendingAttachmentPaths()
        .map((p) => p.replace(/[\\/]+/g, '/').toLowerCase()),
    );
  } catch {
    /* 无 outbox 表/脏载荷：按无保护清理 */
  }
  const isProtected = (p: string): boolean =>
    protectedPaths != null && protectedPaths.has(p.replace(/[\\/]+/g, '/').toLowerCase());
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
        if (now - f.mtime > UPLOADS_TTL_MS && !isProtected(f.p)) {
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
        // LRU 删最旧的直到低于上限（受保护的跳过）
        remaining.sort((a, b) => a.mtime - b.mtime);
        let size = totalSize;
        for (const f of remaining) {
          if (size <= UPLOADS_DIR_MAX_BYTES) break;
          if (isProtected(f.p)) continue;
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

/** P2-6: settings 表孤儿键清扫。判定走 orphan-settings 纯函数（含测试）：
 *  kb.session.* 键名后缀是会话 id；im.session.* 的会话 id 在值里——2026-11-24
 *  修复：此前一律按键名后缀，im 映射每次启动被整批误删。 */
function cleanupOrphanSettings(validSessionIds: Set<string>): number {
  const sqlite = getSqlite();
  const rows = sqlite
    .prepare("SELECT key, value FROM settings WHERE key LIKE 'kb.session.%' OR key LIKE 'im.session.%'")
    .all() as Array<{ key: string; value: string | null }>;
  let removed = 0;
  for (const key of decideOrphanSettingKeys(rows, validSessionIds)) {
    sqlite.prepare('DELETE FROM settings WHERE key = ?').run(key);
    removed++;
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

/** 主入口：启动时调用一次（agent-home 清扫改异步，不阻塞事件循环） */
export async function runMaintenanceCleanup(validSessionIds: Set<string>, workDirs: string[]): Promise<void> {
  try {
    // resume 接线后（0.3.47）转录 GC 需要 DB 引用集：被 sdk_session_id 引用的保留
    const referenced = (getSqlite().prepare('SELECT sdk_session_id FROM sessions WHERE sdk_session_id IS NOT NULL').all() as Array<{ sdk_session_id: string }>)
      .map((r) => r.sdk_session_id);
    await cleanupAgentHome({ referencedTranscripts: referenced });
  } catch { /* ignore */ }
  cleanupUploadsDir(workDirs);
  checkpointWal();
  cleanupOrphanSettings(validSessionIds);
  cleanupSkillhubTmp();
}
