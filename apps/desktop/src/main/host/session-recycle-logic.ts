/**
 * 闲置会话回收判定（纯逻辑，node --test 直跑）。
 *
 * 背景（2026-10-19 内存实测）：每会话常驻一只 pi.exe ≈ 160MB WS / 390MB 私有，
 * 且桌面会话永不回收（0.3.36 拍板时 resume 未接；0.3.47 起转录持久化 +
 * lazy-create 自动恢复，前提已消失）。IM 侧 30min 闲置回收是现成先例。
 *
 * 回收 = 只关 pi 进程（maker.closeSession），不动 DB 行、不写 status——下次
 * 发消息经 ensureSession lazy-create + resumeSessionId 透明恢复上下文（代价
 * ≈ pi 冷启动 6s）。
 */

export const SESSION_IDLE_RECYCLE_MS = 30 * 60 * 1000;

export interface RecycleCandidate {
  sessionId: string;
  /** 最近一次 agent 事件时间（ms epoch）；无记录按 created 算 */
  lastActivityAt: number;
  /** 会话正在跑 turn（isTurnRunning）——回收会杀掉运行中的工作，绝不可 */
  isRunning: boolean;
  /** 该会话有挂起的审批/问答卡（交互进行中属活跃） */
  hasPendingInteraction: boolean;
  /** durable outbox 有未终态行（排队消息等待派发，进程关了泵会重建——
   * 但重派 = 冷启动延迟排队消息，体验差且徒增重启，留着） */
  hasPendingOutbox: boolean;
  /** 预热会话有自己的 TTL 生命周期，不走回收器 */
  isPrewarm: boolean;
}

/** 判定单个会话是否可回收。 */
export function shouldRecycleSession(
  c: RecycleCandidate,
  now: number,
  idleMs: number = SESSION_IDLE_RECYCLE_MS,
): boolean {
  if (c.isPrewarm) return false;
  if (c.isRunning) return false;
  if (c.hasPendingInteraction) return false;
  if (c.hasPendingOutbox) return false;
  return now - c.lastActivityAt >= idleMs;
}

/** 巡检批判定（返回应回收的 id 列表）。 */
export function pickRecyclableSessions(
  candidates: RecycleCandidate[],
  now: number,
  idleMs: number = SESSION_IDLE_RECYCLE_MS,
): string[] {
  return candidates.filter((c) => shouldRecycleSession(c, now, idleMs)).map((c) => c.sessionId);
}
