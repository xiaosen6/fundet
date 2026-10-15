/**
 * agent-home 磁盘治理：
 *
 * 0.3.30 起 pi-host 每次 startSession 在 userData/agent-home/<hex>/ 随机建目录、
 * 启动全量删（当时转录零消费者）。**0.3.47 起 resume 接线**：pi-host 改用单一共享
 * userData/agent-home/，sessions/ 里的会话 JSONL 转录是重启恢复上下文的载体，
 * 必须跨启动保留——清扫从「全量删」收窄为：
 *  1. 根目录：run-tmp/（隔离配置）、runtime/（权限档）与旧版随机 hex 目录全删
 *     （启动时无活会话；sessions 保留）；
 *  2. sessions/ 转录 GC：删「不被 sessions 表 sdk_session_id 引用」且 mtime 超过
 *     1h 宽限期的孤儿（删会话残留/预热丢弃/崩退残留）；
 *  3. 删除会话时经 deleteSessionTranscript 连带回收（路径闸防 DB 脏值乱删）。
 * 双实例（dev+打包版共享 userData）下本清扫比旧版更保守：旧版连另一个实例的活
 * 会话配置目录都删，本版只清一次性运行时 + 宽限期外的孤儿转录。
 */
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import {
  AGENT_HOME_SESSIONS_DIR,
  isTranscriptPathWithin,
  planRootSweep,
  planTranscriptSweep,
} from './agent-home-cleanup-logic.js';

function agentHomeRoot(): string {
  return path.join(app.getPath('userData'), 'agent-home');
}

/** 启动清扫（bootstrap 阶段调用，此时无任何 pi 会话在跑）。
 *  referencedTranscripts：DB 里全部 sdk_session_id（转录绝对路径），由调用方给。 */
export async function cleanupAgentHome(opts?: {
  referencedTranscripts?: Iterable<string>;
}): Promise<{ removed: number; freedBytes: number }> {
  const root = agentHomeRoot();
  const referenced = new Set(
    Array.from(opts?.referencedTranscripts ?? []).map((p) => p.toLowerCase()),
  );
  let removed = 0;
  let freedBytes = 0;

  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(root, { withFileTypes: true });
  } catch {
    return { removed, freedBytes }; // 目录不存在 = 从未建过会话
  }

  // 1) 根目录：sessions 之外的子项全删（run-tmp/runtime/旧随机 hex 目录）
  for (const name of planRootSweep(entries.map((e) => e.name))) {
    const dir = path.join(root, name);
    try {
      freedBytes += await dirSizeAsync(dir);
      await fs.promises.rm(dir, { recursive: true, force: true });
      removed++;
    } catch {
      /* 删不掉的（被锁等）跳过，下次启动再试 */
    }
  }

  // 2) sessions/ 转录 GC：孤儿 + 超宽限期才删
  const sessionsDir = path.join(root, AGENT_HOME_SESSIONS_DIR);
  try {
    const files = (await fs.promises.readdir(sessionsDir, { withFileTypes: true }))
      .filter((e) => e.isFile())
      .map((e) => ({ name: e.name, mtimeMs: 0 }));
    for (const f of files) {
      try {
        f.mtimeMs = (await fs.promises.stat(path.join(sessionsDir, f.name))).mtimeMs;
      } catch {
        f.mtimeMs = 0; // 读不到 mtime 按最旧处理（可删）
      }
    }
    for (const p of planTranscriptSweep(files, referenced, sessionsDir, Date.now())) {
      try {
        const size = (await fs.promises.stat(p)).size;
        await fs.promises.rm(p, { force: true });
        freedBytes += size;
        removed++;
      } catch {
        /* 下次启动再试 */
      }
    }
  } catch {
    /* sessions/ 不存在 = 正常（还没任何会话） */
  }

  if (removed > 0) {
    console.log(
      `[fundet:agent-home] 启动清扫 ${removed} 项（${(freedBytes / 1024 / 1024).toFixed(0)}MB，转录保留 ${referenced.size} 条引用）`,
    );
  }
  return { removed, freedBytes };
}

/** 删除会话时连带回收其转录文件（resume 载体）。路径闸：只认共享 sessions 目录内
 *  的文件，DB 脏值不会变成任意文件删除原语。返回值仅用于日志。 */
export async function deleteSessionTranscript(sdkSessionId: string): Promise<boolean> {
  const sessionsDir = path.join(agentHomeRoot(), AGENT_HOME_SESSIONS_DIR);
  if (!isTranscriptPathWithin(sessionsDir, sdkSessionId)) return false;
  try {
    await fs.promises.rm(path.resolve(sdkSessionId), { force: true });
    return true;
  } catch {
    return false;
  }
}

async function dirSizeAsync(dir: string): Promise<number> {
  let total = 0;
  const walk = async (d: string): Promise<void> => {
    try {
      const entries = await fs.promises.readdir(d, { withFileTypes: true });
      for (const e of entries) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) await walk(p);
        else total += (await fs.promises.stat(p)).size;
      }
    } catch {
      /* ignore */
    }
  };
  await walk(dir);
  return total;
}
