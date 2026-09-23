/**
 * 草稿预热（0.3.13）：把 pi 会话创建从「首条消息发出时」提前到「建草稿时」，
 * 用户打字期间完成 pi 启动（~6.4s）+ MCP 桥拉起，发送即接现成会话。
 *
 * 生命周期（防 0.3.8 pi 泄漏教训重演）：
 * - 只管理**本模块创建**的会话（records 登记）；用户的真实会话永不被碰
 *   （prewarm 遇到无记录的活会话直接让行，attach 只对登记过的会话生效）。
 * - 指纹（providerId/workDir/MCP 工具集）变化 → 旧预热作废重建；模型变化
 *   不算指纹（发送时 setModel 热切）。
 * - 草稿放弃兜底三路：60s 巡检 TTL（5 分钟无消息自动回收）+ 显式 discard
 *   IPC + 启动清「占位标题零消息」孤儿行——全部走 closeSession。
 * - 任何失败静默（false），发送路径回落原 lazy-create，行为与未预热一致。
 *
 * 纯逻辑在 session-prewarm-logic.ts（node --test 直跑）。
 */
import type { Session } from '@fundet/agent-core';
import { eq } from 'drizzle-orm';
import { getDb, getSqlite } from '../db/client.js';
import { sessions, messages } from '../db/schema.js';
import { getBoolSetting } from '../db/settings.js';
import { getSessionKnowledgeBinding } from '../knowledge/store.js';
import { getHost } from './pi-host.js';
import {
  PREWARM_PLACEHOLDER_TITLES,
  PREWARM_TTL_MS,
  computePrewarmFingerprint,
  decidePrewarmAttach,
} from './session-prewarm-logic.js';

export { PREWARM_TTL_MS, computePrewarmFingerprint as computeFingerprint, decidePrewarmAttach as decideAttach } from './session-prewarm-logic.js';

export interface PrewarmInput {
  sessionId: string;
  providerId: string;
  model: string;
  workDir: string;
}

interface PrewarmRecord {
  fingerprint: string;
  providerId: string;
  workDir: string;
  createdAt: number;
}

const records = new Map<string, PrewarmRecord>();
let sweepTimer: ReturnType<typeof setInterval> | null = null;

/** 注入依赖（wireSession/列表广播来自 ipc/register——避免 register↔prewarm 环） */
interface PrewarmDeps {
  wireSession: (session: Session) => void;
  closeSession: (sessionId: string) => Promise<void>;
  notifyListChanged: () => void;
}
let deps: PrewarmDeps | null = null;

export function setPrewarmDeps(d: PrewarmDeps): void {
  deps = d;
}

export function countMessages(sessionId: string): number {
  return getDb().select({ id: messages.id }).from(messages).where(eq(messages.sessionId, sessionId)).all().length;
}

function deleteSessionRowIfEmpty(sessionId: string): void {
  if (countMessages(sessionId) > 0) return;
  getDb().delete(sessions).where(eq(sessions.id, sessionId)).run();
}

async function discardPrewarm(sessionId: string): Promise<void> {
  if (!records.has(sessionId)) return;
  records.delete(sessionId);
  try {
    await deps?.closeSession(sessionId);
  } catch {
    /* 进程已死等情形：行清理照走 */
  }
  deleteSessionRowIfEmpty(sessionId);
  deps?.notifyListChanged();
}

/** 预热（幂等）：指纹相同不重做；变化弃旧重建；只预热草稿、不碰真实会话 */
export async function prewarmSession(input: PrewarmInput): Promise<boolean> {
  if (!deps) return false;
  const existing = records.get(input.sessionId);
  const fingerprint = computePrewarmFingerprint(input);
  if (existing && existing.fingerprint === fingerprint) return true;

  const alive = getHost().maker.getSession(input.sessionId);
  // 活会话且不是我们预热的（用户已发过消息）——不碰
  if (alive && !existing) return true;
  if (existing) await discardPrewarm(input.sessionId);

  try {
    const session = await getHost().maker.createSession({
      agentKind: 'pi',
      id: input.sessionId,
      title: '新对话',
      workingDir: input.workDir,
      model: input.model,
      providerId: input.providerId,
    });
    deps.wireSession(session);
    records.set(input.sessionId, {
      fingerprint,
      providerId: input.providerId,
      workDir: input.workDir,
      createdAt: Date.now(),
    });
    ensureSweep();
    deps.notifyListChanged();
    return true;
  } catch {
    // 预热失败静默：发送路径回落 lazy-create（与未预热行为一致）
    deleteSessionRowIfEmpty(input.sessionId);
    return false;
  }
}

/**
 * 发送路径的接驳判定（ensureSession 调）：attach=现成可用；discard=清障后走
 * 重建；none=非预热会话，维持原语义。副作用：discard 分支就地清理。
 */
export async function prewarmAttachDecision(sessionId: string): Promise<'none' | 'attach' | 'discard'> {
  const record = records.get(sessionId);
  if (!record) return 'none';
  const decision = decidePrewarmAttach({
    hasRecord: true,
    alive: Boolean(getHost().maker.getSession(sessionId)),
    fingerprintMatch:
      record.fingerprint ===
      computePrewarmFingerprint({
        sessionId,
        providerId: record.providerId,
        workDir: record.workDir,
        getBinding: getSessionKnowledgeBinding,
        boolSetting: getBoolSetting,
      }),
    expiredAndEmpty: Date.now() - record.createdAt > PREWARM_TTL_MS && countMessages(sessionId) === 0,
  });
  if (decision === 'discard') await discardPrewarm(sessionId);
  return decision;
}

/** 发送后预热记录转正（真实会话，不再按 TTL 回收） */
export function promotePrewarm(sessionId: string): void {
  records.delete(sessionId);
}

/** 显式弃预热（renderer 删草稿时） */
export async function discardSessionPrewarm(sessionId: string): Promise<void> {
  await discardPrewarm(sessionId);
}

function ensureSweep(): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    void (async () => {
      const now = Date.now();
      for (const [sessionId, record] of [...records]) {
        if (now - record.createdAt > PREWARM_TTL_MS && countMessages(sessionId) === 0) {
          await discardPrewarm(sessionId);
        }
      }
    })().catch(() => undefined);
  }, 60_000);
  sweepTimer.unref?.();
}

/**
 * 启动清理：上次运行残留的「占位标题 + 零消息」预热行（异常退出没走到
 * discard）。真实会话必有消息（首拍即写 user 行）；auto-/IM 同样首拍写消息，
 * 不会被误删。
 */
export function cleanupOrphanPrewarmRows(): number {
  const placeholders = PREWARM_PLACEHOLDER_TITLES.map(() => '?').join(',');
  const result = getSqlite()
    .prepare(
      `DELETE FROM sessions WHERE title IN (${placeholders})` +
        ' AND NOT EXISTS (SELECT 1 FROM messages WHERE messages.session_id = sessions.id)',
    )
    .run(...PREWARM_PLACEHOLDER_TITLES);
  return result.changes;
}
