/**
 * 模型目录热同步：providers 表变化后，把所有活会话 configHome 的 models.json 重写
 * 并让运行中的 pi 进程重读（set_model 查的是进程内存快照，只改文件不刷新进程无效）。
 *
 * best-effort：单会话失败仅告警、不阻断供应商保存；完成（无论成败）后回调通知，
 * register 层用它广播 SESSION_LIST_CHANGED 刷新侧栏/输入框模型 chip 的数据源。
 * 没赶上热同步的会话，用户切模型时由 setModel 的懒同步路径兜底。
 */
import { getHost } from './pi-host.ts';

export interface ModelCatalogSyncResult {
  /** 参与同步的活会话数 */
  total: number;
  /** 目录确认刷新成功的会话数（含无变化但重读成功的） */
  synced: number;
}

/** 对所有活 pi 会话热同步模型目录；notifyListChanged 在收尾时调用一次。 */
export async function syncAliveSessionsModelCatalog(
  notifyListChanged?: () => void,
): Promise<ModelCatalogSyncResult> {
  const { maker, logger } = getHost();
  // listActiveSessions 含 status==='closed' 的残留实例，与 isSessionAlive 同口径过滤
  const sessions = maker.listActiveSessions().filter((s) => s.getStatus() !== 'closed');
  let synced = 0;
  await Promise.all(
    sessions.map(async (session) => {
      try {
        if (await session.refreshModelCatalog()) synced += 1;
        else logger.warn('[fundet:model-catalog] 会话目录热同步未确认（下次切模型走懒同步）', {
          sessionId: session.id,
        });
      } catch (err) {
        logger.warn('[fundet:model-catalog] 会话目录热同步失败（不影响供应商保存）', {
          sessionId: session.id,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }),
  );
  if (sessions.length > 0) {
    logger.info(`[fundet:model-catalog] 热同步完成：${synced}/${sessions.length} 个活会话`);
  }
  notifyListChanged?.();
  return { total: sessions.length, synced };
}
