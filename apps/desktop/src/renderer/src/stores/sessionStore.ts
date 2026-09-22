/**
 * sessionStore — 模块级多会话状态分片（Map<sessionId, slice>）+ useSyncExternalStore。
 *
 * 关键设计：
 * - `initGlobalListeners()` 在 App 启动时调用一次，全局订阅 window.fundet 的
 *   agent:event / interaction 推送，按 sessionId 分发到各自 slice。
 *   多会话并行跑、切换页面不杀后台 turn 全靠这层与 React 树解耦。
 * - 切会话时 `ensureHistory()` 从 IPC 拉 DB 历史重建 items（只建一次）。
 * - 高频事件（text/thinking delta）100ms 节流通知，低频事件立即通知。
 *
 * slice 内 items 是按时间序的显示项（用户消息 / 助手文本 / 思考 / 工具卡 / 错误卡），
 * 流式文本未 final 时放在 streamingText，由 MessageStream 渲染成临时气泡。
 */
import { useSyncExternalStore } from 'react';
import { friendlyError, friendlyProviderError } from '../../../shared/friendly-error.ts';
import { classifyRetryableError, retryDelayMs } from '../lib/errorRetry';
import type { AgentEvent, InteractionRequest, UsageSnapshot } from '@fundet/agent-core';
import type {
  MessageView,
  SessionAttachment,
  SessionCreateInput,
  SessionListItem,
  SessionSendInput,
} from '../../../shared/fundet-api.js';

// ---------------------------------------------------------------------------
// 显示项
// ---------------------------------------------------------------------------

export type DisplayItem =
  | { kind: 'user'; id: string; text: string; createdAt?: number; attachments?: SessionAttachment[] }
  | {
      kind: 'assistant';
      id: string;
      text: string;
      createdAt?: number;
      usage?: { tokenUsage: number; contextTokens: number; costUsd: number };
    }
  | { kind: 'thinking'; id: string; text: string; running: boolean; durationMs?: number; createdAt?: number }
  | {
      kind: 'tool';
      id: string;
      toolName: string;
      input: Record<string, unknown>;
      resultText?: string;
      isError?: boolean;
      done: boolean;
      createdAt?: number;
    }
  | {
      /** 子 agent 任务进度（agent_task_update 实时事件；不落库，历史重建无此卡） */
      kind: 'task';
      id: string;
      taskId: string;
      title: string;
      description?: string;
      summary?: string;
      status: 'running' | 'completed' | 'failed' | 'stopped';
      model?: string | null;
    }
  | { kind: 'error'; id: string; message: string }
  | { kind: 'notice'; id: string; text: string };

export interface SessionSlice {
  items: DisplayItem[];
  /** 当前未 final 的流式助手文本 */
  streamingText: string;
  isRunning: boolean;
  statusText: string;
  usage: UsageSnapshot;
  pendingInteraction: InteractionRequest | null;
  /** DB 历史是否已重建进 items */
  historyLoaded: boolean;
  /** 侧栏关注态：turn 在非注视下完成（绿）/ 终态出错（红）；注视即清除 */
  attention: 'done' | 'error' | null;
}

const EMPTY_USAGE: UsageSnapshot = { tokenUsage: 0, contextTokens: 0, contextWindow: 0, costUsd: 0 };

const EMPTY_SLICE: SessionSlice = {
  items: [],
  streamingText: '',
  isRunning: false,
  statusText: '',
  usage: EMPTY_USAGE,
  pendingInteraction: null,
  historyLoaded: false,
  attention: null,
};

// ---------------------------------------------------------------------------
// 模块级状态
// ---------------------------------------------------------------------------

const slices = new Map<string, SessionSlice>();
/** sessionId → 该 slice 的订阅者 */
const sliceListeners = new Map<string, Set<() => void>>();
/** 会话列表（sidebar）的订阅者 */
const listListeners = new Set<() => void>();
let sessionList: SessionListItem[] = [];

// ---------------------------------------------------------------------------
// 本地草稿会话（Fundet：新建会话不触 main、不 spawn pi；
// 首条消息 send 时由 main 侧 lazy-create 落 DB + 起进程）
// ---------------------------------------------------------------------------

interface DraftSession {
  item: SessionListItem;
  /** 草稿建会话时选定的 provider（首条消息 lazy-create 的 create 参数用） */
  providerId: string;
}

/** 草稿只活在 renderer 内存：切换/删除都是纯本地操作，无任何 main 侧副作用 */
const drafts = new Map<string, DraftSession>();
/** sidebar 快照：有对话内容的草稿 + DB 会话。空草稿不进列表（对齐 Cindy）。 */
let combinedList: SessionListItem[] = [];

function draftHasDialogue(id: string): boolean {
  const s = slices.get(id);
  return Boolean(s && s.items.length > 0);
}

function rebuildCombinedList(): void {
  const visibleDrafts = Array.from(drafts.values())
    .filter((d) => draftHasDialogue(d.item.id))
    .map((d) => d.item);
  // 置顶段最前（服务端已按 pinned/sortOrder 排好），草稿其次，其余按更新时间
  const pinned = sessionList.filter((s) => s.pinned);
  const rest = sessionList.filter((s) => !s.pinned);
  combinedList = [...pinned, ...visibleDrafts, ...rest];
}

function notifyList(): void {
  for (const l of listListeners) l();
}

/** 任意 slice 变化的订阅者（sidebar 呼吸点等跨会话视图用） */
const anyListeners = new Set<() => void>();
/** 运行中 sessionId 集合快照（useSyncExternalStore 需要引用稳定） */
let runningSnapshot: ReadonlySet<string> = new Set();
/** 侧栏关注态快照（sessionId → done/error）；与 runningSnapshot 同点重算 */
let attentionSnapshot: ReadonlyMap<string, 'done' | 'error'> = new Map();
/** 当前注视（打开）的会话：其 turn 完成不打未读标记 */
let focusedSessionId: string | null = null;

/** 「本会话总允许」工具白名单（pi 的 permission decision 只认 allow/deny，
 *  会话级规则由 renderer 侧自动放行实现） */
const autoAllowTools = new Map<string, Set<string>>();

// ---------------------------------------------------------------------------
// 错误分类自动重试（限流/过载/网络瞬断，最多 2 次，倒计时可被任何新动作打断）
// ---------------------------------------------------------------------------

/** sessionId → 最近一次被 main 接受的发送参数（重发用，retry 标记覆写） */
const lastSendInputs = new Map<string, SessionSendInput>();
/** sessionId → 已自动重试次数（done 清零） */
const retryAttempts = new Map<string, number>();
interface ActiveRetry {
  timer: ReturnType<typeof setTimeout>;
  ticker: ReturnType<typeof setInterval> | null;
  noticeId: string;
}
const activeRetries = new Map<string, ActiveRetry>();

function cancelAutoRetry(sessionId: string): void {
  const plan = activeRetries.get(sessionId);
  if (!plan) return;
  activeRetries.delete(sessionId);
  clearTimeout(plan.timer);
  if (plan.ticker) clearInterval(plan.ticker);
  // 倒计时 notice 就地移除（不打扰其它条目）
  const s = getSlice(sessionId);
  if (s.items.some((it) => it.id === plan.noticeId)) {
    patchSlice(sessionId, { items: s.items.filter((it) => it.id !== plan.noticeId) });
    notifySlice(sessionId);
  }
}

function updateRetryNotice(sessionId: string, noticeId: string, text: string): void {
  const s = getSlice(sessionId);
  patchSlice(sessionId, {
    items: s.items.map((it) => (it.id === noticeId && it.kind === 'notice' ? { ...it, text } : it)),
  });
  notifySlice(sessionId);
}

function performAutoRetry(sessionId: string): void {
  const plan = activeRetries.get(sessionId);
  activeRetries.delete(sessionId);
  if (plan?.ticker) clearInterval(plan.ticker);
  const input = lastSendInputs.get(sessionId);
  if (!input) return;
  patchSlice(sessionId, { isRunning: true, statusText: '自动重试中…' });
  notifySlice(sessionId);
  void window.fundet
    .sendMessage({ ...input, retry: true })
    .then((result) => {
      if (!result.accepted) {
        appendItem(sessionId, {
          kind: 'error',
          id: nextId('e'),
          message: `自动重试未接受：${result.reason ?? '未知原因'}`,
        });
        patchSlice(sessionId, { isRunning: false });
        notifySlice(sessionId);
      }
    })
    .catch((err: unknown) => {
      appendItem(sessionId, {
        kind: 'error',
        id: nextId('e'),
        message: `自动重试失败：${err instanceof Error ? err.message : String(err)}`,
      });
      patchSlice(sessionId, { isRunning: false });
      notifySlice(sessionId);
    });
}

function scheduleAutoRetry(sessionId: string, message: string): void {
  const seed = classifyRetryableError(message);
  if (!seed) return;
  const attempt = (retryAttempts.get(sessionId) ?? 0) + 1;
  if (attempt > 2) return; // 两次之后交还手动重发
  retryAttempts.set(sessionId, attempt);
  const delayMs = retryDelayMs(seed, attempt);
  const noticeId = nextId('n');
  const totalSec = Math.round(delayMs / 1000);
  appendItem(sessionId, {
    kind: 'notice',
    id: noticeId,
    text: `${seed.label}，${totalSec} 秒后自动重试（${attempt}/2）`,
  });
  notifySlice(sessionId);
  let remain = totalSec;
  const ticker = setInterval(() => {
    remain -= 1;
    if (remain > 0) {
      updateRetryNotice(sessionId, noticeId, `${seed.label}，${remain} 秒后自动重试（${attempt}/2）`);
    }
  }, 1000);
  const timer = setTimeout(() => performAutoRetry(sessionId), delayMs);
  activeRetries.set(sessionId, { timer, ticker, noticeId });
}

let idSeq = 0;
function nextId(prefix: string): string {
  return `${prefix}-${++idSeq}`;
}

function getSlice(sessionId: string): SessionSlice {
  return slices.get(sessionId) ?? EMPTY_SLICE;
}

function notifySlice(sessionId: string): void {
  for (const l of sliceListeners.get(sessionId) ?? []) l();
  notifyAny();
}

/** 重算运行中集合与关注态快照并通知跨会话视图 */
function notifyAny(): void {
  const nextRunning = new Set<string>();
  const nextAttention = new Map<string, 'done' | 'error'>();
  for (const [id, s] of slices) {
    if (s.isRunning) nextRunning.add(id);
    if (s.attention) nextAttention.set(id, s.attention);
  }
  runningSnapshot = nextRunning;
  attentionSnapshot = nextAttention;
  window.fundet?.setRunningBadge?.(nextRunning.size);
  for (const l of anyListeners) l();
}

function patchSlice(sessionId: string, patch: Partial<SessionSlice>): void {
  slices.set(sessionId, { ...getSlice(sessionId), ...patch });
}

function appendItem(sessionId: string, item: DisplayItem): void {
  const s = getSlice(sessionId);
  patchSlice(sessionId, { items: [...s.items, item] });
}

function updateItem(sessionId: string, id: string, patch: Partial<DisplayItem>): void {
  const s = getSlice(sessionId);
  patchSlice(sessionId, {
    items: s.items.map((it) => (it.id === id ? ({ ...it, ...patch } as DisplayItem) : it)),
  });
}

// ---------------------------------------------------------------------------
// 事件节流：text / thinking delta 走 32ms 帧级批量通知（对齐 Cindy
// TEXT_DELTA_BATCH_INTERVAL_MS），其余立即。状态写入始终同步，节流只压通知频率。
// ---------------------------------------------------------------------------

const pendingFlush = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const FLUSH_MS = 32;

function scheduleFlush(sessionId: string): void {
  pendingFlush.add(sessionId);
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    const targets = [...pendingFlush];
    pendingFlush.clear();
    for (const id of targets) notifySlice(id);
  }, FLUSH_MS);
}

// ---------------------------------------------------------------------------
// AgentEvent → slice 归约
// ---------------------------------------------------------------------------

function applyEvent(sessionId: string, event: AgentEvent): 'immediate' | 'throttled' {
  // 自动化隔离会话（auto- 前缀）无 UI 展示：直接丢弃事件，避免为它建孤儿
  // slice（每次定时任务一个，永不清理的内存泄漏；主进程侧已落库可溯源）
  if (sessionId.startsWith('auto-')) return 'immediate';
  const s = getSlice(sessionId);
  switch (event.type) {
    case 'text': {
      const data = event.data as { text?: string; isFinal?: boolean };
      if (data.isFinal) {
        // 整条消息全文校准：封口成 assistant 项，清空流式缓冲
        const items = data.text
          ? [
              ...s.items,
              {
                kind: 'assistant' as const,
                id: nextId('a'),
                text: data.text,
                createdAt: Date.now(),
              },
            ]
          : s.items;
        patchSlice(sessionId, { items, streamingText: '' });
        return 'immediate';
      }
      if (data.text) {
        patchSlice(sessionId, { streamingText: s.streamingText + data.text });
        return 'throttled';
      }
      return 'throttled';
    }

    case 'thinking': {
      const data = event.data as {
        stage?: string;
        blockId?: string;
        text?: string;
        durationMs?: number;
      };
      const blockId = data.blockId || 'think';
      const existing = s.items.find((it) => it.kind === 'thinking' && it.id === blockId);
      if (data.stage === 'start') {
        if (!existing) {
          appendItem(sessionId, { kind: 'thinking', id: blockId, text: '', running: true, createdAt: Date.now() });
        }
        return 'immediate';
      }
      if (data.stage === 'delta' && data.text) {
        if (existing && existing.kind === 'thinking') {
          updateItem(sessionId, blockId, { text: existing.text + data.text });
        } else {
          appendItem(sessionId, { kind: 'thinking', id: blockId, text: data.text, running: true, createdAt: Date.now() });
        }
        return 'throttled';
      }
      if (data.stage === 'final') {
        if (existing) {
          updateItem(sessionId, blockId, {
            text: data.text ?? (existing.kind === 'thinking' ? existing.text : ''),
            running: false,
            durationMs: data.durationMs,
          });
        } else if (data.text) {
          appendItem(sessionId, {
            kind: 'thinking',
            id: blockId,
            text: data.text,
            running: false,
            durationMs: data.durationMs,
            createdAt: Date.now(),
          });
        }
        return 'immediate';
      }
      if (data.stage === 'redacted') {
        if (existing) updateItem(sessionId, blockId, { text: '[思考内容已隐藏]', running: false });
        else appendItem(sessionId, { kind: 'thinking', id: blockId, text: '[思考内容已隐藏]', running: false });
        return 'immediate';
      }
      return 'throttled';
    }

    case 'tool_use': {
      const data = event.data as { toolUseId?: string; toolName?: string; input?: unknown };
      appendItem(sessionId, {
        kind: 'tool',
        id: data.toolUseId || nextId('t'),
        toolName: data.toolName || 'tool',
        input: (data.input ?? {}) as Record<string, unknown>,
        done: false,
        createdAt: Date.now(),
      });
      return 'immediate';
    }

    case 'agent_task_update': {
      const data = event.data as {
        taskId?: string;
        status?: 'running' | 'completed' | 'failed' | 'stopped';
        title?: string;
        description?: string;
        summary?: string;
        model?: string | null;
      };
      if (!data.taskId) return 'immediate';
      const id = `task-${data.taskId}`;
      const existing = s.items.find((it) => it.kind === 'task' && it.id === id);
      if (existing && existing.kind === 'task') {
        updateItem(sessionId, id, {
          title: data.title ?? existing.title,
          description: data.description ?? existing.description,
          summary: data.summary ?? existing.summary,
          status: data.status ?? existing.status,
          model: data.model !== undefined ? data.model : existing.model,
        });
      } else {
        appendItem(sessionId, {
          kind: 'task',
          id,
          taskId: data.taskId,
          title: data.title || '子任务',
          description: data.description,
          summary: data.summary,
          status: data.status ?? 'running',
          model: data.model,
        });
      }
      return 'immediate';
    }

    case 'tool_result_full': {
      const data = event.data as { toolUseId?: string; fullText?: string; isError?: boolean };
      if (data.toolUseId) {
        updateItem(sessionId, data.toolUseId, {
          resultText: data.fullText || '',
          isError: data.isError === true,
          done: true,
        });
      }
      return 'immediate';
    }

    case 'tool_result': {
      const data = event.data as { summary?: string; toolUseIds?: string[] };
      for (const id of data.toolUseIds ?? []) {
        const it = s.items.find((x) => x.kind === 'tool' && x.id === id);
        // tool_result_full 已带全文时保留，这里只兜底标 done
        if (it && it.kind === 'tool' && !it.done) updateItem(sessionId, id, { done: true });
      }
      return 'immediate';
    }

    case 'status': {
      const data = event.data as Partial<UsageSnapshot> & { status?: string; isRunning?: boolean };
      patchSlice(sessionId, {
        statusText: data.status ?? s.statusText,
        isRunning: data.isRunning ?? s.isRunning,
        usage: {
          tokenUsage: data.tokenUsage ?? s.usage.tokenUsage,
          contextTokens: data.contextTokens ?? s.usage.contextTokens,
          contextWindow: data.contextWindow ?? s.usage.contextWindow,
          costUsd: data.costUsd ?? s.usage.costUsd,
        },
      });
      return 'immediate';
    }

    case 'done': {
      // 兜底：万一有没有 final 校准的残留流式文本，封口别丢
      let items = s.streamingText
        ? [
            ...s.items,
            {
              kind: 'assistant' as const,
              id: nextId('a'),
              text: s.streamingText,
              createdAt: Date.now(),
            },
          ]
        : s.items;
      const usageSnap = {
        tokenUsage: s.usage.tokenUsage,
        contextTokens: s.usage.contextTokens,
        costUsd: s.usage.costUsd,
      };
      let lastAi = -1;
      for (let i = items.length - 1; i >= 0; i--) {
        if (items[i].kind === 'assistant') {
          lastAi = i;
          break;
        }
      }
      const lastItem = lastAi >= 0 ? items[lastAi] : undefined;
      if (lastItem?.kind === 'assistant') {
        const next = items.slice();
        next[lastAi] = { ...lastItem, usage: usageSnap };
        items = next;
      }
      patchSlice(sessionId, {
        items,
        streamingText: '',
        isRunning: false,
        statusText: 'Done',
        // 注视中的会话完成不打未读；先前 error 被成功的下一轮覆盖
        attention: sessionId === focusedSessionId ? null : 'done',
      });
      retryAttempts.delete(sessionId);
      cancelAutoRetry(sessionId);
      void refreshSessionList();
      return 'immediate';
    }

    case 'error': {
      const data = event.data as { message?: string; isTerminal?: boolean; willRetry?: boolean };
      const terminal = data.isTerminal ?? data.willRetry !== true;
      const message = friendlyProviderError(data.message || '未知错误');
      const s0 = getSlice(sessionId);
      if (terminal) {
        // 终态错误卡每轮只保留一张：重复错误替换末尾卡片文案（对齐 Cindy「终态错误横幅只弹一次」）
        const last = s0.items[s0.items.length - 1];
        if (last && last.kind === 'error') {
          const items = s0.items.slice();
          items[items.length - 1] = { ...last, message };
          patchSlice(sessionId, { items, streamingText: '', isRunning: false, attention: 'error' });
        } else {
          appendItem(sessionId, { kind: 'error', id: nextId('e'), message });
          patchSlice(sessionId, { isRunning: false, streamingText: '', attention: 'error' });
        }
        // 限流/过载/网络瞬断：自动重试（带倒计时；最多 2 次）
        scheduleAutoRetry(sessionId, message);
      } else {
        // 瞬时重试提示原地更新（1/3 → 2/3 不堆多条）
        const last = s0.items[s0.items.length - 1];
        if (last && last.kind === 'notice') {
          const items = s0.items.slice();
          items[items.length - 1] = { ...last, text: message };
          patchSlice(sessionId, { items });
        } else {
          appendItem(sessionId, { kind: 'notice', id: nextId('n'), text: message });
        }
      }
      return 'immediate';
    }

    case 'compact_boundary': {
      appendItem(sessionId, { kind: 'notice', id: nextId('n'), text: '上下文已压缩' });
      return 'immediate';
    }

    default:
      return 'immediate';
  }
}

// ---------------------------------------------------------------------------
// 全局监听器（App 启动装一次）
// ---------------------------------------------------------------------------

let listenersInstalled = false;

export function initGlobalListeners(): void {
  if (listenersInstalled) return;
  listenersInstalled = true;

  window.fundet.onAgentEvent(({ sessionId, event }) => {
    const mode = applyEvent(sessionId, event);
    if (mode === 'immediate') {
      pendingFlush.delete(sessionId);
      notifySlice(sessionId);
    } else {
      scheduleFlush(sessionId);
    }
  });

  // 主进程侧的兜底恢复（abort 复核 / stall 看门狗）会把卡死会话 close 掉。
  // 不订阅这个事件的话 isRunning 恒 true：停止按钮点了没反应、UI 永久转圈。
  window.fundet.onStatusChanged(({ sessionId, status }) => {
    if (status !== 'closed' && status !== 'error') return;
    cancelAutoRetry(sessionId);
    retryAttempts.delete(sessionId);
    const s = getSlice(sessionId);
    if (!s.isRunning && !s.pendingInteraction) return;
    patchSlice(sessionId, {
      isRunning: false,
      streamingText: '',
      statusText: '',
      pendingInteraction: null,
      attention: 'error',
    });
    appendItem(sessionId, {
      kind: 'notice',
      id: nextId('n'),
      text: '会话连接已重置，重新发送即可继续。',
    });
    notifySlice(sessionId);
    void refreshSessionList();
  });

  window.fundet.onInteractionRequest(({ sessionId, request }) => {
    // 「本会话总允许」命中：直接自动放行，不弹卡
    if (request.kind === 'permission' && autoAllowTools.get(sessionId)?.has(request.toolName)) {
      void window.fundet.resolveInteraction(request.requestId, {
        kind: 'permission',
        behavior: 'allow',
      });
      return;
    }
    patchSlice(sessionId, { pendingInteraction: request });
    notifySlice(sessionId);
  });

  window.fundet.onInteractionDismissed(({ sessionId, requestId }) => {
    const s = getSlice(sessionId);
    if (s.pendingInteraction?.requestId === requestId) {
      patchSlice(sessionId, { pendingInteraction: null });
      notifySlice(sessionId);
    }
  });

  // 重启后补拉悬挂的审批（10 分钟兜底超时前仍有效）
  void window.fundet.getPendingInteractions().then((pending) => {
    for (const { sessionId, request } of pending) {
      patchSlice(sessionId, { pendingInteraction: request });
      notifySlice(sessionId);
    }
  });

  void refreshSessionList();
  window.fundet.onSessionListChanged(() => {
    void refreshSessionList();
  });
}

// ---------------------------------------------------------------------------
// 会话列表（sidebar）
// ---------------------------------------------------------------------------

export async function refreshSessionList(): Promise<void> {
  try {
    sessionList = await window.fundet.listSessions();
    rebuildCombinedList();
    notifyList();
  } catch {
    // 列表拉取失败不致命，保持旧值
  }
}

export function useSessionList(): SessionListItem[] {
  return useSyncExternalStore(
    (cb) => {
      listListeners.add(cb);
      return () => listListeners.delete(cb);
    },
    () => combinedList,
  );
}

/** 正在跑 turn 的 sessionId 集合（sidebar 呼吸点） */
export function useRunningIds(): ReadonlySet<string> {
  return useSyncExternalStore(
    (cb) => {
      anyListeners.add(cb);
      return () => anyListeners.delete(cb);
    },
    () => runningSnapshot,
  );
}

/** 侧栏关注态（sessionId → done 未读绿 / error 红）；ChatPage 切会话时 markSessionSeen */
export function useSessionAttentionMap(): ReadonlyMap<string, 'done' | 'error'> {
  return useSyncExternalStore(
    (cb) => {
      anyListeners.add(cb);
      return () => anyListeners.delete(cb);
    },
    () => attentionSnapshot,
  );
}

/** 注视会话（切进即看）：清未读关注态；此后该会话 turn 完成不再打标 */
export function markSessionSeen(sessionId: string | null): void {
  focusedSessionId = sessionId;
  if (!sessionId) return;
  const s = slices.get(sessionId);
  if (s?.attention) {
    patchSlice(sessionId, { attention: null });
    notifyAny();
  }
}

// ---------------------------------------------------------------------------
// 对外 hook 与动作
// ---------------------------------------------------------------------------

export function useSessionSlice(sessionId: string | null): SessionSlice {
  return useSyncExternalStore(
    (cb) => {
      if (!sessionId) return () => undefined;
      let set = sliceListeners.get(sessionId);
      if (!set) {
        set = new Set();
        sliceListeners.set(sessionId, set);
      }
      set.add(cb);
      return () => {
        set.delete(cb);
      };
    },
    () => (sessionId ? getSlice(sessionId) : EMPTY_SLICE),
  );
}

/** 切进会话时调用：首次从 DB 重建历史 items（直播中不重建，避免覆盖流式态） */
export async function ensureHistory(sessionId: string): Promise<void> {
  // 草稿在 DB 里没有行，纯本地，不触 main
  if (drafts.has(sessionId)) return;
  const s = getSlice(sessionId);
  if (s.historyLoaded) return;
  // 标记前置，防止并发重复拉取
  patchSlice(sessionId, { historyLoaded: true });
  try {
    const detail = await window.fundet.getSession(sessionId);
    if (!detail) return;
    const current = getSlice(sessionId);
    // 等待期间已有直播事件进来（流式/审批中），跳过重建以免覆盖
    if (current.items.length > 0 || current.isRunning) return;
    patchSlice(sessionId, { items: rebuildItems(detail.messages) });
    notifySlice(sessionId);
  } catch {
    // 拉取失败：保持空，下次切回重试
    patchSlice(sessionId, { historyLoaded: false });
  }
}

/** DB messages → 显示项（content 为 JSON 字符串，形状见 main/db/messages.ts） */
function rebuildItems(messages: MessageView[]): DisplayItem[] {
  const items: DisplayItem[] = [];
  for (const m of messages) {
    let content: unknown;
    try {
      content = JSON.parse(m.content);
    } catch {
      continue;
    }
    const c = content as Record<string, unknown>;
    switch (m.role) {
      case 'user':
        if (typeof c.text === 'string') {
          const attachments = Array.isArray(c.attachments)
            ? (c.attachments as SessionAttachment[])
            : undefined;
          items.push({
            kind: 'user',
            id: m.id,
            text: c.text,
            createdAt: m.createdAt,
            ...(attachments && attachments.length > 0 ? { attachments } : {}),
          });
        }
        break;
      case 'assistant':
        if (typeof c.text === 'string') {
          items.push({ kind: 'assistant', id: m.id, text: c.text, createdAt: m.createdAt });
        }
        break;
      case 'thinking':
        if (typeof c.text === 'string') {
          items.push({ kind: 'thinking', id: m.id, text: c.text, running: false, createdAt: m.createdAt });
        }
        break;
      case 'tool': {
        const kind = c.kind as string;
        const data = (c.data ?? {}) as Record<string, unknown>;
        if (kind === 'tool_use') {
          items.push({
            kind: 'tool',
            id: (data.toolUseId as string) || m.id,
            toolName: (data.toolName as string) || 'tool',
            input: (data.input ?? {}) as Record<string, unknown>,
            done: false,
            createdAt: m.createdAt,
          });
        } else if (kind === 'tool_result_full') {
          // 全文结果：挂回对应工具卡（知识库引用角标重载后仍可点的前提；
          // 0.3.6 前未落库此事件——存量会话的【n】重载后仍是纯文本）
          const tid = data.toolUseId as string | undefined;
          const it = tid ? items.find((x) => x.kind === 'tool' && x.id === tid) : undefined;
          if (it && it.kind === 'tool') {
            Object.assign(it, {
              resultText: (data.fullText as string) || '',
              isError: data.isError === true,
              done: true,
            });
          }
        } else if (kind === 'tool_result') {
          // 历史里只有 summary 没有全文：把对应工具卡标 done
          for (const id of (data.toolUseIds as string[]) ?? []) {
            const it = items.find((x) => x.kind === 'tool' && x.id === id);
            if (it && it.kind === 'tool' && !it.done) {
              Object.assign(it, { done: true });
            }
          }
        }
        break;
      }
      case 'error':
        items.push({
          kind: 'error',
          id: m.id,
          message: (c.message as string) || '未知错误',
        });
        break;
      default:
        break; // done 等不落显示
    }
  }
  return items;
}

/** 发送消息：本地先插用户气泡，再走 IPC */
export async function sendMessage(
  sessionId: string,
  text: string,
  create?: SessionCreateInput,
  attachments?: SessionAttachment[],
): Promise<void> {
  appendItem(sessionId, {
    kind: 'user',
    id: nextId('u'),
    text,
    createdAt: Date.now(),
    ...(attachments && attachments.length > 0 ? { attachments } : {}),
  });
  // 用户正在与会话交互：清关注态
  patchSlice(sessionId, { isRunning: true, statusText: 'Working…', attention: null });
  notifySlice(sessionId);
  if (drafts.has(sessionId)) {
    rebuildCombinedList();
    notifyList();
  }
  try {
    const result = await window.fundet.sendMessage({ sessionId, text, create, attachments });
    if (result.accepted) {
      // 记住本次发送参数（自动重试用），并取消任何挂起的自动重试
      lastSendInputs.set(sessionId, { sessionId, text, create, attachments });
      cancelAutoRetry(sessionId);
      // 草稿首条消息已被 main 接受（lazy-create 落 DB）：摘掉草稿标记，
      // 后续走正式会话路径；随即刷新 sidebar 拿到 DB 行（含自动标题）。
      if (drafts.delete(sessionId)) rebuildCombinedList();
      // 首条消息可能触发 main 侧自动标题，立即刷新 sidebar
      void refreshSessionList();
    } else {
      appendItem(sessionId, {
        kind: 'error',
        id: nextId('e'),
        message: `发送未接受：${result.reason ?? '未知原因'}`,
      });
      patchSlice(sessionId, { isRunning: false });
      notifySlice(sessionId);
      if (drafts.has(sessionId)) {
        rebuildCombinedList();
        notifyList();
      }
    }
  } catch (err) {
    appendItem(sessionId, {
      kind: 'error',
      id: nextId('e'),
      message: `发送失败：${friendlyError(err instanceof Error ? err.message : String(err))}`,
    });
    patchSlice(sessionId, { isRunning: false });
    notifySlice(sessionId);
    if (drafts.has(sessionId)) {
      rebuildCombinedList();
      notifyList();
    }
  }
}

export async function abortSession(sessionId: string): Promise<void> {
  // 即时反馈：pi 侧若卡死，abort RPC 要等主进程复核兜底（约 15s）才真正收口，
  // 期间不能让「正在中断」看起来像没点到。
  cancelAutoRetry(sessionId);
  retryAttempts.delete(sessionId);
  patchSlice(sessionId, { statusText: '正在中断…' });
  notifySlice(sessionId);
  await window.fundet.abortSession(sessionId);
}

/** 删除某条 AI 回复所在轮的中间过程 + 该回复；其后的消息保留。 */
export async function deleteAssistantTurn(sessionId: string, assistantId: string): Promise<void> {
  const s = getSlice(sessionId);
  const idx = s.items.findIndex((it) => it.kind === 'assistant' && it.id === assistantId);
  if (idx < 0) return;
  let from = idx;
  for (let i = idx - 1; i >= 0; i--) {
    if (s.items[i].kind === 'user') {
      from = i + 1;
      break;
    }
    if (i === 0) from = 0;
  }
  const target = s.items[idx];
  const afterUser = from > 0 ? s.items[from - 1] : null;
  const afterTs = afterUser && 'createdAt' in afterUser ? afterUser.createdAt : undefined;
  const untilTs = target.kind === 'assistant' ? target.createdAt : undefined;
  if (untilTs && !isDraftSession(sessionId)) {
    await window.fundet.deleteTurn(sessionId, afterTs ?? 0, untilTs);
  }
  const items = s.items.filter((_, i) => i < from || i > idx);
  patchSlice(sessionId, { items });
  notifySlice(sessionId);
}

/** 编辑重发用：删除某条用户消息（含）之后的本地条目（无 createdAt 的临时项保留）。 */
export function truncateItemsFrom(sessionId: string, fromCreatedAt: number): void {
  const s = getSlice(sessionId);
  patchSlice(sessionId, {
    items: s.items.filter((it) => {
      if (!('createdAt' in it)) return true;
      const ts = (it as { createdAt?: number }).createdAt;
      return ts === undefined || ts < fromCreatedAt;
    }),
  });
  notifySlice(sessionId);
}

export async function forkSessionAt(sessionId: string, upToCreatedAt: number): Promise<string> {
  const id = await window.fundet.forkSession(sessionId, upToCreatedAt);
  await refreshSessionList();
  return id;
}

/** 审批：允许一次 / 本会话总允许 / 拒绝 */
export async function resolvePermission(
  sessionId: string,
  request: Extract<InteractionRequest, { kind: 'permission' }>,
  behavior: 'allow' | 'deny' | 'allow-session',
): Promise<void> {
  if (behavior === 'allow-session') {
    let set = autoAllowTools.get(sessionId);
    if (!set) {
      set = new Set();
      autoAllowTools.set(sessionId, set);
    }
    set.add(request.toolName);
  }
  await window.fundet.resolveInteraction(request.requestId, {
    kind: 'permission',
    behavior: behavior === 'deny' ? 'deny' : 'allow',
    ...(behavior === 'deny' ? { reason: '用户拒绝' } : {}),
  });
  // dismissed 广播会清 pendingInteraction；这里同步清一次让 UI 即时反馈
  const s = getSlice(sessionId);
  if (s.pendingInteraction?.requestId === request.requestId) {
    patchSlice(sessionId, { pendingInteraction: null });
    notifySlice(sessionId);
  }
}

/** 新建会话后登记一个空 slice，避免首次渲染闪烁 */
export function touchSlice(sessionId: string): void {
  if (!slices.has(sessionId)) slices.set(sessionId, { ...EMPTY_SLICE });
}

// ---------------------------------------------------------------------------
// 草稿会话动作（全部纯本地，不走 IPC）
// ---------------------------------------------------------------------------

/**
 * 新建草稿会话：只进 renderer 内存，不调 session:create、不 spawn pi。
 * 空草稿不进 sidebar；首条消息 send 时才出现在会话列表，并由 main lazy-create。
 * id 用真实 UUID 预铸——落 DB 后 id 不变，activeId / slice 无需迁移。
 */
export function createDraftSession(input: {
  workDir: string;
  providerId: string;
  model: string;
  title: string;
}): SessionListItem {
  const now = Date.now();
  const item: SessionListItem = {
    id: crypto.randomUUID(),
    title: input.title,
    workDir: input.workDir,
    model: input.model,
    effort: null,
    permissionMode: null,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
  };
  drafts.set(item.id, { item, providerId: input.providerId });
  touchSlice(item.id);
  rebuildCombinedList();
  notifyList();
  return item;
}

/** 复用已有空草稿，避免点「新对话」就往会话列表堆空会话。 */
export function ensureDraftSession(input: {
  workDir: string;
  providerId: string;
  model: string;
  title: string;
}): SessionListItem {
  let kept: string | null = null;
  for (const id of [...drafts.keys()]) {
    if (draftHasDialogue(id)) continue;
    if (!kept) {
      kept = id;
      updateDraftSession(id, {
        providerId: input.providerId,
        model: input.model,
        workDir: input.workDir,
      });
      const draft = drafts.get(id);
      if (draft) {
        draft.item = { ...draft.item, title: input.title };
        drafts.set(id, draft);
      }
    } else {
      deleteDraftSession(id);
    }
  }
  if (kept) {
    const draft = drafts.get(kept);
    if (draft) {
      rebuildCombinedList();
      notifyList();
      return draft.item;
    }
  }
  return createDraftSession(input);
}

export function getDraftSession(sessionId: string | null): SessionListItem | undefined {
  if (!sessionId) return undefined;
  return drafts.get(sessionId)?.item;
}

export function isDraftSession(sessionId: string): boolean {
  return drafts.has(sessionId);
}

/** 草稿建会话时选定的 providerId（send 组 create 参数用，比按 model 反查精确） */
export function getDraftProviderId(sessionId: string): string | undefined {
  return drafts.get(sessionId)?.providerId;
}

/** 改会话标题。草稿只改本地；已落库的走 IPC。空标题视为取消（调用方应先 trim）。 */
export async function renameSession(sessionId: string, title: string): Promise<void> {
  const trimmed = title.replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!trimmed) throw new Error('标题不能为空');
  const draft = drafts.get(sessionId);
  if (draft) {
    drafts.set(sessionId, { ...draft, item: { ...draft.item, title: trimmed } });
    rebuildCombinedList();
    notifyList();
    return;
  }
  await window.fundet.renameSession(sessionId, trimmed);
  sessionList = sessionList.map((s) => (s.id === sessionId ? { ...s, title: trimmed } : s));
  rebuildCombinedList();
  notifyList();
}

/** 草稿上切模型 / 权限档位：只改本地（会话还不存在，没有 main 侧可同步） */
export function updateDraftSession(
  sessionId: string,
  patch: { providerId?: string; model?: string; permissionMode?: string; workDir?: string; effort?: string | null },
): void {
  const draft = drafts.get(sessionId);
  if (!draft) return;
  if (patch.providerId !== undefined) draft.providerId = patch.providerId;
  drafts.set(sessionId, {
    ...draft,
    item: {
      ...draft.item,
      ...(patch.model !== undefined ? { model: patch.model } : {}),
      ...(patch.permissionMode !== undefined ? { permissionMode: patch.permissionMode } : {}),
      ...(patch.workDir !== undefined ? { workDir: patch.workDir } : {}),
      ...(patch.effort !== undefined ? { effort: patch.effort } : {}),
    },
  });
  rebuildCombinedList();
  notifyList();
}

/** 置顶/取消置顶：先就地更新（即时反馈），再拉服务端权威序 */
export async function setSessionPinned(sessionId: string, pinned: boolean): Promise<void> {
  await window.fundet.setSessionPinned(sessionId, pinned);
  sessionList = sessionList.map((s) => (s.id === sessionId ? { ...s, pinned } : s));
  sessionList = [
    ...sessionList.filter((s) => s.pinned),
    ...sessionList.filter((s) => !s.pinned),
  ];
  rebuildCombinedList();
  notifyList();
  void refreshSessionList();
}

/** 思考档位：草稿只改本地；已落库走 IPC（死会话只落库，lazy-create 带上） */
export async function setSessionEffortLevel(sessionId: string, effort: string | null): Promise<void> {
  const draft = drafts.get(sessionId);
  if (draft) {
    updateDraftSession(sessionId, { effort });
    return;
  }
  await window.fundet.setSessionEffort(sessionId, effort as Parameters<typeof window.fundet.setSessionEffort>[1]);
  sessionList = sessionList.map((s) => (s.id === sessionId ? { ...s, effort } : s));
  rebuildCombinedList();
  notifyList();
}

/** 持久化置顶段手动顺序（ids 从上到下） */
export async function reorderSessions(ids: string[]): Promise<void> {
  await window.fundet.reorderSessions(ids);
  void refreshSessionList();
}

/** 删除草稿：纯本地移除，main/DB 里本来就没有它 */
export function deleteDraftSession(sessionId: string): void {
  if (!drafts.delete(sessionId)) return;
  slices.delete(sessionId);
  rebuildCombinedList();
  notifyList();
}
