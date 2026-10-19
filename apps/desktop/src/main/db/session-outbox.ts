/**
 * 会话待发队列（outbox）：把「排队中/自动重试中」的发送从渲染层内存挪到主进程
 * SQLite——renderer 崩溃、切会话、重启都不丢（CDS v2 零丢失输入契约的 Fundet 落地）。
 *
 * 幂等建表（对齐 automations/prompt_templates 的 raw SQL 惯例，drizzle-kit 迁移
 * 留给大版本）。注入式 Database 便于 node --test。
 */
import type Database from 'better-sqlite3';

export const OUTBOX_STATES = ['queued', 'sending', 'failed', 'outcome_unknown', 'cancelled'] as const;
export type OutboxState = (typeof OUTBOX_STATES)[number];

export interface OutboxRow {
  id: string;
  sessionId: string;
  seq: number;
  state: OutboxState;
  payloadJson: string;
  userMessageId: string;
  userMessageCreatedAt: number | null;
  attempt: number;
  autoRetryCount: number;
  nextAttemptAt: number | null;
  lastError: string | null;
  cancelRequested: number;
  createdAt: number;
  updatedAt: number;
}

export function ensureSessionOutboxTable(native: Database.Database): void {
  native.prepare(`CREATE TABLE IF NOT EXISTS session_outbox (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    state TEXT NOT NULL DEFAULT 'queued',
    payload_json TEXT NOT NULL,
    user_message_id TEXT NOT NULL UNIQUE,
    user_message_created_at INTEGER,
    attempt INTEGER NOT NULL DEFAULT 0,
    auto_retry_count INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER,
    last_error TEXT,
    cancel_requested INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`).run();
  native.prepare(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_outbox_session_seq ON session_outbox(session_id, seq)',
  ).run();
  native.prepare(
    'CREATE INDEX IF NOT EXISTS idx_outbox_session_state ON session_outbox(session_id, state, seq)',
  ).run();
}

type RawRow = Record<string, unknown>;

function toRow(r: RawRow): OutboxRow {
  return {
    id: String(r.id),
    sessionId: String(r.session_id),
    seq: Number(r.seq),
    state: String(r.state) as OutboxState,
    payloadJson: String(r.payload_json),
    userMessageId: String(r.user_message_id),
    userMessageCreatedAt: r.user_message_created_at == null ? null : Number(r.user_message_created_at),
    attempt: Number(r.attempt),
    autoRetryCount: Number(r.auto_retry_count),
    nextAttemptAt: r.next_attempt_at == null ? null : Number(r.next_attempt_at),
    lastError: r.last_error == null ? null : String(r.last_error),
    cancelRequested: Number(r.cancel_requested),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

export interface SessionOutboxStore {
  /** 幂等入队：同 userMessageId 同载荷返回既有行；同 id 异载荷报错。 */
  enqueue(input: {
    userMessageId: string;
    sessionId: string;
    payloadJson: string;
    now: number;
  }): OutboxRow;
  listBySession(sessionId: string): OutboxRow[];
  /** 会话内第一个未终态行（queued/sending/failed/outcome_unknown），无则 null。 */
  head(sessionId: string): OutboxRow | null;
  get(id: string): OutboxRow | null;
  /** onDispatching 同步 CAS：queued→sending（校验仍到期、仍是 head、未被取消）。 */
  casToSending(id: string, expectAttempt: number, now: number): OutboxRow | null;
  markFailed(id: string, error: string, now: number): void;
  markOutcomeUnknown(id: string, error: string | null, now: number): void;
  markCancelled(id: string, now: number): void;
  /** 终态成功即删行（消息已在 messages 表，队列不留成功尾巴）。 */
  remove(id: string): void;
  requeueForRetry(id: string, nextAttemptAt: number, error: string | null, now: number): void;
  /** 手动重试：failed/outcome_unknown → queued（outcome_unknown 须调用方先拿到用户确认）。 */
  requeueManual(id: string, now: number): OutboxRow | null;
  setCancelRequested(id: string, now: number): void;
  /** 会话内所有未终态（queued/failed/outcome_unknown）→ cancelled；返回受影响行数。 */
  cancelAllPending(sessionId: string, now: number): number;
  /** 附件保护视图：所有未终态行的载荷里引用的附件路径集合（供维护清扫排除）。 */
  pendingAttachmentPaths(): string[];
  /** 启动恢复：sending → outcome_unknown（崩溃时可能已越过派发边界，绝不自动重放）。 */
  recoverSendingToUnknown(now: number): number;
  /** 引用计数：该会话是否还有未终态行（prewarm 清扫保护）。 */
  hasPending(sessionId: string): boolean;
  /** 全库未终态行所属会话集合（启动恢复用）。 */
  allPendingSessionIds(): string[];
  /** 全库所有未终态行（渲染层重启后恢复后台会话队列视图）。 */
  listAllPending(): OutboxRow[];
  nextSeq(sessionId: string): number;
}

export function createSessionOutboxStore(native: Database.Database): SessionOutboxStore {
  ensureSessionOutboxTable(native);
  const stmt = {
    insert: native.prepare(
      `INSERT INTO session_outbox (id, session_id, seq, state, payload_json, user_message_id, created_at, updated_at)
       VALUES (@id, @sessionId, @seq, 'queued', @payloadJson, @userMessageId, @now, @now)`,
    ),
    byId: native.prepare('SELECT * FROM session_outbox WHERE id = ?'),
    byUserMessageId: native.prepare('SELECT * FROM session_outbox WHERE user_message_id = ?'),
    listBySession: native.prepare(
      'SELECT * FROM session_outbox WHERE session_id = ? ORDER BY seq ASC',
    ),
    head: native.prepare(
      `SELECT * FROM session_outbox
       WHERE session_id = ? AND state IN ('queued','sending','failed','outcome_unknown')
       ORDER BY seq ASC LIMIT 1`,
    ),
    nextSeq: native.prepare(
      'SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM session_outbox WHERE session_id = ?',
    ),
    update: native.prepare(
      'UPDATE session_outbox SET state = ?, attempt = ?, auto_retry_count = ?, next_attempt_at = ?, last_error = ?, updated_at = ? WHERE id = ?',
    ),
    casSending: native.prepare(
      `UPDATE session_outbox
       SET state = 'sending', updated_at = @now
       WHERE id = @id AND state = 'queued' AND cancel_requested = 0
         AND (next_attempt_at IS NULL OR next_attempt_at <= @now)
         AND seq = (SELECT MIN(seq) FROM session_outbox
                    WHERE session_id = (SELECT session_id FROM session_outbox WHERE id = @id)
                      AND state IN ('queued','sending','failed','outcome_unknown'))`,
    ),
    setCreatedAt: native.prepare(
      'UPDATE session_outbox SET user_message_created_at = ?, updated_at = ? WHERE id = ?',
    ),
    remove: native.prepare('DELETE FROM session_outbox WHERE id = ?'),
    requeueManual: native.prepare(
      `UPDATE session_outbox SET state = 'queued', next_attempt_at = NULL, updated_at = ?
       WHERE id = ? AND state IN ('failed','outcome_unknown')`,
    ),
    setCancelRequested: native.prepare(
      'UPDATE session_outbox SET cancel_requested = 1, updated_at = ? WHERE id = ?',
    ),
    cancelAll: native.prepare(
      `UPDATE session_outbox SET state = 'cancelled', updated_at = ?
       WHERE session_id = ? AND state IN ('queued','failed','outcome_unknown')`,
    ),
    pendingAttachmentPaths: native.prepare(
      `SELECT payload_json FROM session_outbox
       WHERE state IN ('queued','sending','failed','outcome_unknown')`,
    ),
    recoverSending: native.prepare(
      `UPDATE session_outbox SET state = 'outcome_unknown',
         last_error = COALESCE(last_error, '应用在发送中退出，结果未知'), updated_at = ?
       WHERE state = 'sending'`,
    ),
    hasPending: native.prepare(
      `SELECT 1 FROM session_outbox
       WHERE session_id = ? AND state IN ('queued','sending','failed','outcome_unknown') LIMIT 1`,
    ),
    allPendingSessionIds: native.prepare(
      `SELECT DISTINCT session_id FROM session_outbox
       WHERE state IN ('queued','sending','failed','outcome_unknown')`,
    ),
    listAllPending: native.prepare(
      `SELECT * FROM session_outbox
       WHERE state IN ('queued','sending','failed','outcome_unknown') ORDER BY session_id, seq`,
    ),
  };

  function row(id: string): OutboxRow | null {
    const r = stmt.byId.get(id) as RawRow | undefined;
    return r ? toRow(r) : null;
  }

  function write(
    id: string,
    state: OutboxState,
    attempt: number,
    autoRetryCount: number,
    nextAttemptAt: number | null,
    lastError: string | null,
    now: number,
  ): void {
    stmt.update.run(state, attempt, autoRetryCount, nextAttemptAt, lastError, now, id);
  }

  return {
    enqueue({ userMessageId, sessionId, payloadJson, now }) {
      const existing = stmt.byUserMessageId.get(userMessageId) as RawRow | undefined;
      if (existing) {
        const prior = toRow(existing);
        if (prior.sessionId !== sessionId || prior.payloadJson !== payloadJson) {
          throw new Error('重复的发送 id 但内容不同，拒绝覆盖');
        }
        return prior;
      }
      const id = userMessageId;
      const seq = Number((stmt.nextSeq.get(sessionId) as { n: number }).n);
      stmt.insert.run({ id, sessionId, seq, payloadJson, userMessageId, now });
      return row(id)!;
    },
    listBySession(sessionId) {
      return (stmt.listBySession.all(sessionId) as RawRow[]).map(toRow);
    },
    head(sessionId) {
      const r = stmt.head.get(sessionId) as RawRow | undefined;
      return r ? toRow(r) : null;
    },
    get: row,
    casToSending(id, _expectAttempt, now) {
      const res = stmt.casSending.run({ id, now });
      if (res.changes !== 1) return null;
      return row(id);
    },
    markFailed(id, error, now) {
      const prior = row(id);
      if (!prior) return;
      write(id, 'failed', prior.attempt, prior.autoRetryCount, prior.nextAttemptAt, error, now);
    },
    markOutcomeUnknown(id, error, now) {
      const prior = row(id);
      if (!prior) return;
      write(id, 'outcome_unknown', prior.attempt, prior.autoRetryCount, prior.nextAttemptAt, error ?? prior.lastError, now);
    },
    markCancelled(id, now) {
      const prior = row(id);
      if (!prior || prior.state === 'sending') return;
      write(id, 'cancelled', prior.attempt, prior.autoRetryCount, prior.nextAttemptAt, prior.lastError, now);
    },
    remove(id) {
      stmt.remove.run(id);
    },
    requeueForRetry(id, nextAttemptAt, error, now) {
      const prior = row(id);
      if (!prior || prior.state !== 'sending') return;
      write(id, 'queued', prior.attempt, prior.autoRetryCount + 1, nextAttemptAt, error ?? prior.lastError, now);
    },
    requeueManual(id, now) {
      const res = stmt.requeueManual.run(now, id);
      if (res.changes !== 1) return null;
      return row(id);
    },
    setCancelRequested(id, now) {
      stmt.setCancelRequested.run(now, id);
    },
    cancelAllPending(sessionId, now) {
      return Number(stmt.cancelAll.run(now, sessionId).changes);
    },
    pendingAttachmentPaths() {
      const paths: string[] = [];
      for (const r of stmt.pendingAttachmentPaths.all() as RawRow[]) {
        try {
          const payload = JSON.parse(String(r.payload_json)) as { attachments?: Array<{ path?: string }> };
          for (const a of payload.attachments ?? []) {
            if (a.path) paths.push(a.path);
          }
        } catch {
          /* 脏载荷不挡清扫 */
        }
      }
      return paths;
    },
    recoverSendingToUnknown(now) {
      return Number(stmt.recoverSending.run(now).changes);
    },
    hasPending(sessionId) {
      return stmt.hasPending.get(sessionId) != null;
    },
    allPendingSessionIds() {
      return (stmt.allPendingSessionIds.all() as RawRow[]).map((r) => String(r.session_id));
    },
    listAllPending() {
      return (stmt.listAllPending.all() as RawRow[]).map(toRow);
    },
    nextSeq(sessionId) {
      return Number((stmt.nextSeq.get(sessionId) as { n: number }).n);
    },
  };
}
