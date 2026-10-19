/**
 * 会话 outbox 泵：把排队/重试的派发权收进主进程（CDS v2 零丢失输入契约）。
 *
 * 崩溃安全核心：
 * - 用户消息插入幂等（预生成 userMessageId；onAccepted 里事务插入，重放不重复落行）。
 * - 派发边界 = onDispatching 同步 CAS queued→sending：CAS 前崩溃可安全自动重派，
 *   CAS 后崩溃 → outcome_unknown 永不自动重放（厂商侧可能已在执行）。
 * - 主进程持有全部重试定时器（renderer 崩溃/重启不影响）；failed/outcome_unknown
 *   占位阻塞后续 FIFO，防旧重试跑到新消息后面。
 *
 * 依赖全注入（node --test 假实现直测）；register.ts 装配真实实现。
 */
import type { AgentEvent } from '@fundet/agent-core';
import type { SessionOutboxStore, OutboxRow } from '../db/session-outbox.ts';
import {
  classifyRetryableError,
  MAX_AUTO_RETRY_ATTEMPTS,
  retryDelayMs,
} from '../../shared/error-retry.ts';

export interface OutboxPayload {
  text: string;
  attachments?: Array<{ path?: string; name?: string }>;
  create?: Record<string, unknown>;
}

/** 渲染层视图（不含 create 原文与 token）。 */
export interface OutboxItemView {
  id: string;
  sessionId: string;
  seq: number;
  state: string;
  text: string;
  attachmentNames: string[];
  attempt: number;
  autoRetryCount: number;
  nextAttemptAt: number | null;
  lastError: string | null;
  userMessageCreatedAt: number | null;
  createdAt: number;
}

export function outboxItemView(row: OutboxRow): OutboxItemView {
  let payload: OutboxPayload;
  try {
    payload = JSON.parse(row.payloadJson) as OutboxPayload;
  } catch {
    payload = { text: '' };
  }
  return {
    id: row.id,
    sessionId: row.sessionId,
    seq: row.seq,
    state: row.state,
    text: payload.text,
    attachmentNames: (payload.attachments ?? [])
      .map((a) => a.name ?? a.path ?? '')
      .filter(Boolean),
    attempt: row.attempt,
    autoRetryCount: row.autoRetryCount,
    nextAttemptAt: row.nextAttemptAt,
    lastError: row.lastError,
    userMessageCreatedAt: row.userMessageCreatedAt,
    createdAt: row.createdAt,
  };
}

/** 终态判定与 wireSession 的轮末统计同口径。 */
export function isTerminalTurnEvent(event: AgentEvent): boolean {
  if (event.type === 'done') return true;
  if (event.type === 'error') {
    const data = event.data as { isTerminal?: boolean; willRetry?: boolean } | undefined;
    return data?.isTerminal !== false && data?.willRetry !== true;
  }
  return false;
}

export interface OutboxServiceDeps {
  store: SessionOutboxStore;
  /** 与 SESSION_SEND 同一 ensureSession（含 prewarm 接驳/权限对齐/resume）。 */
  ensureSession(input: {
    sessionId: string;
    text: string;
    attachments?: Array<{ path?: string; name?: string }>;
    create?: Record<string, unknown>;
  }): Promise<OutboxDispatchTarget>;
  /** 首次派发（attempt=0）前置：快照基线 + 轮末产物基线。 */
  prepareTurn(sessionId: string, create: Record<string, unknown> | undefined, text: string): void;
  /** 自动 RAG 注入（返回发模型的文本；库里/DB 仍存用户原话）。 */
  applyAutoRag(sessionId: string, text: string): Promise<string>;
  /** onAccepted：幂等落用户消息（返回是否新插入）+ 首条标题 + prewarm 转正。 */
  persistAcceptedMessage(row: OutboxRow, attachments: Array<{ name?: string }>): boolean;
  /** 组装发给引擎的 user 消息（图片读取等）。 */
  buildUserMessage(
    text: string,
    attachments?: Array<{ path?: string; name?: string }>,
  ): Promise<unknown>;
  now(): number;
  scheduleTimer(sessionId: string, delayMs: number): void;
  onChanged(sessionId: string): void;
  log(...args: unknown[]): void;
}

/** ensureSession 返回的最小面（Session 的 send 子集，测试可假）。 */
export interface OutboxDispatchTarget {
  send(
    message: unknown,
    opts?: {
      turnAttemptToken?: number;
      onAccepted?: () => void | Promise<void>;
      onDispatching?: () => void;
    },
  ): Promise<{ accepted: boolean; reason?: string }>;
}

const RETRY_POLL_MS = 2_000;

export function createOutboxService(deps: OutboxServiceDeps): {
  enqueue(input: { userMessageId: string; sessionId: string; text: string; attachments?: Array<{ path?: string; name?: string }>; create?: Record<string, unknown> }): OutboxItemView;
  list(sessionId?: string): OutboxItemView[];
  retry(sessionId: string, id: string): OutboxItemView[];
  remove(sessionId: string, id: string): OutboxItemView[];
  cancelAll(sessionId: string): OutboxItemView[];
  onTerminalEvent(sessionId: string, event: AgentEvent): void;
  recoverAndResume(): void;
  dispose(): void;
  /** 测试/装配用：某会话是否正在派发。 */
  isDispatching(sessionId: string): boolean;
} {
  const { store } = deps;
  const pumping = new Set<string>();
  const dispatching = new Map<string, { rowId: string; token: number }>();
  const timers = new Map<string, { t: ReturnType<typeof setTimeout>; fireAt: number }>();
  let disposed = false;

  function payloadOf(row: OutboxRow): OutboxPayload {
    try {
      return JSON.parse(row.payloadJson) as OutboxPayload;
    } catch {
      return { text: '' };
    }
  }

  function views(sessionId: string): OutboxItemView[] {
    return store.listBySession(sessionId).map(outboxItemView);
  }

  function schedule(sessionId: string, delayMs: number): void {
    if (disposed) return;
    const fireAt = deps.now() + Math.max(0, delayMs);
    const existing = timers.get(sessionId);
    // 立即泵无条件抢占（手动重试/移除/FIFO 接棒不等重试轮询）；延迟泵取更早者
    if (existing && delayMs > 0 && existing.fireAt <= fireAt) return;
    if (existing) clearTimeout(existing.t);
    const t = setTimeout(() => {
      timers.delete(sessionId);
      void pump(sessionId);
    }, Math.max(0, delayMs));
    t.unref?.();
    timers.set(sessionId, { t, fireAt });
  }

  function pumpAsync(sessionId: string, delayMs = 0): void {
    deps.scheduleTimer(sessionId, delayMs);
    schedule(sessionId, delayMs);
  }

  async function pump(sessionId: string): Promise<void> {
    if (disposed || pumping.has(sessionId)) return;
    pumping.add(sessionId);
    try {
      for (;;) {
        const head = store.head(sessionId);
        if (!head) return;
        if (head.state === 'sending') {
          // 运行期出现无主 sending（异常路径）→ 保守按未知结果收口
          if (!dispatching.has(sessionId)) {
            store.markOutcomeUnknown(head.id, '发送状态失去跟踪', deps.now());
            deps.onChanged(sessionId);
            continue;
          }
          return;
        }
        if (head.state === 'failed' || head.state === 'outcome_unknown') return; // 手动阻塞
        // queued
        if (head.nextAttemptAt != null && head.nextAttemptAt > deps.now()) {
          pumpAsync(sessionId, head.nextAttemptAt - deps.now());
          return;
        }
        await dispatchRow(sessionId, head);
        // dispatchRow 返回后：要么在等终态（sending），要么已排下一次泵
        if (dispatching.has(sessionId)) return;
      }
    } finally {
      pumping.delete(sessionId);
    }
  }

  async function dispatchRow(sessionId: string, row: OutboxRow): Promise<void> {
    const payload = payloadOf(row);
    const attachments = payload.attachments ?? [];
    let session: OutboxDispatchTarget;
    try {
      session = await deps.ensureSession({
        sessionId,
        text: payload.text,
        attachments,
        create: payload.create,
      });
    } catch (err) {
      // 懒建失败（目录没了/无 provider）： undispatched，按可重试性收口
      settleUndispatched(row, err instanceof Error ? err.message : String(err));
      return;
    }
    if (row.attempt === 0) {
      try {
        deps.prepareTurn(sessionId, payload.create, payload.text);
      } catch (err) {
        deps.log('[fundet:outbox] prepareTurn 失败（继续派发）', err);
      }
    }
    let sendText = payload.text;
    try {
      sendText = await deps.applyAutoRag(sessionId, payload.text);
    } catch {
      sendText = payload.text;
    }
    const token = row.attempt + 1;
    try {
      const result = await session.send(await deps.buildUserMessage(sendText, attachments), {
        turnAttemptToken: token,
        onAccepted: () => {
          const inserted = deps.persistAcceptedMessage(row, attachments);
          if (inserted) deps.onChanged(sessionId);
        },
        onDispatching: () => {
          const sent = store.casToSending(row.id, token, deps.now());
          if (!sent) throw new Error('outbox 行已不可派发（取消/被移除/不再是队首）');
          dispatching.set(sessionId, { rowId: row.id, token });
          deps.onChanged(sessionId);
        },
      });
      if (result.accepted) return; // 等终态事件收口
      // 未越过派发边界（cancelled-before-dispatch / 会话忙）：留在 queued，短退避后再试
      if (result.reason === 'cancelled-before-dispatch') {
        const fresh = store.get(row.id);
        if (fresh?.cancelRequested) store.markCancelled(row.id, deps.now());
      }
      if (store.get(row.id)?.state === 'queued') {
        pumpAsync(sessionId, RETRY_POLL_MS);
      }
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (dispatching.get(sessionId)?.rowId === row.id) {
        // 已越过派发边界后抛错：结果未知，绝不自动重放
        store.markOutcomeUnknown(row.id, message, deps.now());
        dispatching.delete(sessionId);
        deps.onChanged(sessionId);
        return;
      }
      settleUndispatched(row, message);
      return;
    }
  }

  /** 未越界的失败：按分类自动重试（沿用 3 次封顶 + 指数退避），否则 failed 阻塞。 */
  function settleUndispatched(row: OutboxRow, message: string): void {
    const seed = classifyRetryableError(message);
    const fresh = store.get(row.id);
    if (!fresh || fresh.state !== 'queued') {
      // 可能已被取消/移除；sending 由终态路径处理
      if (fresh?.state === 'sending') {
        store.markOutcomeUnknown(row.id, message, deps.now());
        dispatching.delete(row.sessionId);
      }
      deps.onChanged(row.sessionId);
      pumpAsync(row.sessionId, RETRY_POLL_MS);
      return;
    }
    if (seed && fresh.autoRetryCount < MAX_AUTO_RETRY_ATTEMPTS) {
      const delay = retryDelayMs(seed, fresh.autoRetryCount + 1);
      // 复用 sending→queued 的重试通道（计数 +1 在 store.requeueForRetry）
      store.casToSending(row.id, 0, deps.now());
      store.requeueForRetry(row.id, deps.now() + delay, `${seed.label}：${message}`, deps.now());
    } else {
      store.markFailed(row.id, message, deps.now());
    }
    deps.onChanged(row.sessionId);
    pumpAsync(row.sessionId, RETRY_POLL_MS);
  }

  function onTerminalEvent(sessionId: string, event: AgentEvent): void {
    if (!isTerminalTurnEvent(event)) return;
    const entry = dispatching.get(sessionId);
    if (!entry) return;
    if (event.turnAttemptToken != null && event.turnAttemptToken !== entry.token) return; // 陈旧终态
    dispatching.delete(sessionId);
    const row = store.get(entry.rowId);
    if (!row) {
      pumpAsync(sessionId, 0);
      return;
    }
    if (event.type === 'done') {
      const data = event.data as { turnContinuationId?: number } | undefined;
      if (data?.turnContinuationId != null) {
        // 轮 continuation：非产品轮终态，恢复派发跟踪等真正收口
        dispatching.set(sessionId, entry);
        return;
      }
      store.remove(row.id);
      deps.onChanged(sessionId);
      pumpAsync(sessionId, 0);
      return;
    }
    // 终态 error
    const message =
      (event.data as { message?: string; error?: string } | undefined)?.message ??
      (event.data as { error?: string } | undefined)?.error ??
      '未知错误';
    if (row.cancelRequested) {
      store.markCancelled(row.id, deps.now());
    } else {
      const seed = classifyRetryableError(String(message));
      if (seed && row.autoRetryCount < MAX_AUTO_RETRY_ATTEMPTS) {
        const delay = retryDelayMs(seed, row.autoRetryCount + 1);
        store.requeueForRetry(row.id, deps.now() + delay, `${seed.label}：${message}`, deps.now());
      } else {
        store.markFailed(row.id, String(message), deps.now());
      }
    }
    deps.onChanged(sessionId);
    pumpAsync(sessionId, RETRY_POLL_MS);
  }

  function recoverAndResume(): void {
    const n = store.recoverSendingToUnknown(deps.now());
    if (n > 0) deps.log(`[fundet:outbox] 恢复：${n} 条 sending 转 outcome_unknown（不自动重放）`);
    for (const sessionId of store.allPendingSessionIds()) {
      deps.onChanged(sessionId);
      pumpAsync(sessionId, 0);
    }
  }

  return {
    enqueue({ userMessageId, sessionId, text, attachments, create }) {
      store.enqueue({
        userMessageId,
        sessionId,
        payloadJson: JSON.stringify({ text, attachments: attachments ?? [], create }),
        now: deps.now(),
      });
      deps.onChanged(sessionId);
      pumpAsync(sessionId, 0);
      return views(sessionId).find((v) => v.id === userMessageId)!;
    },
    list(sessionId) {
      if (sessionId) return views(sessionId);
      return store.listAllPending().map(outboxItemView);
    },
    retry(sessionId, id) {
      store.requeueManual(id, deps.now());
      deps.onChanged(sessionId);
      pumpAsync(sessionId, 0);
      return views(sessionId);
    },
    remove(sessionId, id) {
      const row = store.get(id);
      if (row && row.state === 'sending') throw new Error('发送中的条目不能移除，请先停止');
      store.remove(id);
      deps.onChanged(sessionId);
      pumpAsync(sessionId, 0);
      return views(sessionId);
    },
    cancelAll(sessionId) {
      store.cancelAllPending(sessionId, deps.now());
      deps.onChanged(sessionId);
      return views(sessionId);
    },
    onTerminalEvent,
    recoverAndResume,
    dispose() {
      disposed = true;
      for (const { t } of timers.values()) clearTimeout(t);
      timers.clear();
    },
    isDispatching: (sessionId) => dispatching.has(sessionId),
  };
}
