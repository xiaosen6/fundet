/**
 * agent-home 磁盘治理（0.3.30，P1-1）：
 * pi-host 每次 startSession 在 userData/agent-home/<hex>/ 随机建目录，
 * pi 在里面写完整会话 JSONL 转录 + models.json + 扩展。这些目录
 * **没有任何消费者**（sdkSessionId 只写不读、resumeSessionId 全仓零调用）
 * 却永不清理——日均 10 会话×重启 ≈ 1.5GB/年 纯死重（本机实测 132 个/354MB）。
 *
 * 清扫策略：启动时全量删除（安全——启动时无任何 pi 会话在跑，
 * agent-home 目录只被 PiAgent.startSession 引用，而 startSession 不会
 * 在 bootstrap 之前被调）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

export async function cleanupAgentHome(): Promise<{ removed: number; freedBytes: number }> {
  const root = path.join(app.getPath('userData'), 'agent-home');
  let removed = 0;
  let freedBytes = 0;
  try {
    const entries = await fs.promises.readdir(root, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const dir = path.join(root, e.name);
      try {
        freedBytes += await dirSizeAsync(dir);
        await fs.promises.rm(dir, { recursive: true, force: true });
        removed++;
      } catch {
        /* 删不掉的（被锁等）跳过，下次启动再试 */
      }
    }
  } catch {
    /* 目录不存在 = 从未建过会话 */
  }
  if (removed > 0) {
    console.log(
      `[fundet:agent-home] 启动清扫 ${removed} 个目录（${(freedBytes / 1024 / 1024).toFixed(0)}MB）`,
    );
  }
  return { removed, freedBytes };
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
