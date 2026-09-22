/**
 * 钉钉组件聚合器（灵动岛数据面）：定时并发跑四路 dws 查询，归一化成
 * DwsWidgetsSnapshot 缓存在主进程，push 给渲染层。
 *
 * - 门控：未装/未登录 → disabled，不跑查询
 * - 节奏：默认 2 分钟一轮；渲染层回焦触发 dwsWidgets() 时按 TTL（45s）去抖
 * - 降级：单查询失败保留上次好数据 + errors 角标，不拖垮整板
 * - 只读：本模块不产生任何写操作；组件上的动作全部走 Agent 会话（过命令确认闸）
 *
 * 解析器吃 dws 全量 JSON（输出几 KB，不进模型上下文，无需 --jq 裁剪），
 * fixture 是真机登录态实捕（__fixtures__/dws-*.json）。
 */
import { createRequire } from 'node:module';
import { execDws, extractJson, resolveDws } from './dws.ts';
import type {
  DwsApprovalPendingView,
  DwsCalendarEventView,
  DwsChatMessageView,
  DwsTodoView,
  DwsUnreadConversationView,
  DwsWidgetsSnapshot,
} from '../../shared/fundet-api.ts';
import { FUNDET_INVOKE, FUNDET_PUSH } from '../ipc/channels.ts';

const requireElectron = createRequire(import.meta.url);

const POLL_MS = 2 * 60_000;
const QUERY_TIMEOUT_MS = 60_000;
/** 回焦刷新去抖窗口：距上轮不足此值直接回缓存 */
const REFRESH_TTL_MS = 45_000;
const RUN_TIMEOUT_MS = 60_000;
const MAX_ITEMS = 6;

/* ---------------- 纯解析（fixture 单测覆盖） ---------------- */

function toMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/** start/end 形如 { dateTime: '2026-09-18T14:30:00+08:00' } 或全天 { date: '2026-09-18' } */
function instantMs(value: unknown): number | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as { dateTime?: unknown; date?: unknown };
  if (typeof v.dateTime === 'string') {
    const parsed = Date.parse(v.dateTime);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (typeof v.date === 'string') {
    const parsed = Date.parse(`${v.date}T00:00:00`);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function firstString(...values: unknown[]): string | undefined {
  for (const v of values) if (typeof v === 'string' && v.trim()) return v.trim();
  return undefined;
}

export function parseCalendarEvents(stdout: string, nowMs: number = Date.now()): DwsCalendarEventView[] {
  const parsed = extractJson(stdout) as { result?: { events?: unknown } } | null;
  const events = parsed?.result?.events;
  if (!Array.isArray(events)) return [];
  return events
    .filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null)
    .map((e) => ({
      id: firstString(e.id) ?? '',
      title: firstString(e.summary, e.title) ?? '（无标题）',
      startMs: instantMs(e.start),
      endMs: instantMs(e.end),
      isAllDay: e.isAllDay === true,
      location: firstString(e.location),
      roomName: firstString(
        Array.isArray(e.meetingRooms)
          ? (e.meetingRooms[0] as Record<string, unknown> | undefined)?.roomName
          : undefined,
      ),
      organizer:
        firstString(
          (e.organizer as Record<string, unknown> | undefined)?.displayName,
          e.organizer as unknown as string,
        ),
      // 参会人不含自己（自己的接受状态无信息量）；点开详情展示
      attendees: Array.isArray(e.attendees)
        ? (e.attendees as unknown[])
            .filter((a): a is Record<string, unknown> => typeof a === 'object' && a !== null)
            .filter((a) => a.self !== true)
            .map((a) => firstString(a.displayName) ?? '')
            .filter(Boolean)
            .slice(0, 8)
        : [],
      description: firstString(e.description)?.replace(/\s+/g, ' ').slice(0, 120),
    }))
    .filter((e) => e.id || e.title !== '（无标题）')
    // 已结束超过 1 小时的不占版面
    .filter((e) => e.endMs === null || e.endMs >= nowMs - 60 * 60_000)
    .sort((a, b) => (a.startMs ?? Infinity) - (b.startMs ?? Infinity))
    .slice(0, MAX_ITEMS);
}

export function parseTodos(stdout: string, nowMs: number = Date.now()): DwsTodoView[] {
  const parsed = extractJson(stdout) as { result?: { todoCards?: unknown } } | null;
  const cards = parsed?.result?.todoCards;
  if (!Array.isArray(cards)) return [];
  return cards
    .filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null)
    .map((c) => ({
      taskId: firstString(c.taskId, c.id) ?? '',
      subject: firstString(c.subject, c.title) ?? '',
      dueMs: toMs(c.dueTime),
      priority: typeof c.priority === 'number' ? c.priority : 50,
    }))
    .filter((t) => t.taskId && t.subject)
    // 逾期在前，其余按截止升序、无截止垫底
    .sort((a, b) => {
      const ao = a.dueMs !== null && a.dueMs < nowMs ? 0 : 1;
      const bo = b.dueMs !== null && b.dueMs < nowMs ? 0 : 1;
      if (ao !== bo) return ao - bo;
      return (a.dueMs ?? Infinity) - (b.dueMs ?? Infinity);
    })
    .slice(0, MAX_ITEMS);
}

/** 待审批当前恰好为空（无真实非空样本），字段名宽容提取 */
export function parseApprovalsPending(stdout: string): DwsApprovalPendingView[] {
  const parsed = extractJson(stdout) as Record<string, unknown> | null;
  if (!parsed) return [];
  // dws 版本差异：1.0.62 是 result.values，老版可能是顶层数组或 result.data/items
  const candidates = [
    (parsed.result as Record<string, unknown> | undefined)?.values,
    (parsed.result as Record<string, unknown> | undefined)?.data,
    (parsed.result as Record<string, unknown> | undefined)?.items,
    (parsed as { values?: unknown }).values,
    (parsed as { items?: unknown }).items,
    Array.isArray(parsed) ? parsed : null,
  ];
  const values = candidates.find((c): c is unknown[] => Array.isArray(c));
  if (!values) return [];
  return values
    .filter((v): v is Record<string, unknown> => typeof v === 'object' && v !== null)
    .map((v) => ({
      id: firstString(v.id, v.taskId, v.processInstanceId, v.instanceId) ?? '',
      title: firstString(v.title, v.subject, v.processName, v.templateName, v.summary),
      initiator: firstString(
        v.originatorUserName,
        v.originatorDeptName,
        v.initiator,
        v.creatorUserName,
        v.userName,
      ),
      createTimeMs: toMs(v.createTime ?? v.createTimeMs ?? v.startDate) ?? undefined,
    }))
    .filter((a) => a.id)
    .sort((a, b) => (b.createTimeMs ?? 0) - (a.createTimeMs ?? 0))
    .slice(0, MAX_ITEMS);
}

export interface UnreadParseResult {
  conversations: DwsUnreadConversationView[];
  total: number;
}

export function parseUnread(stdout: string): UnreadParseResult {  const parsed = extractJson(stdout) as { result?: { conversations?: unknown } } | null;
  const conversations = parsed?.result?.conversations;
  if (!Array.isArray(conversations)) return { conversations: [], total: 0 };
  const views = conversations
    .filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null)
    .map((c) => ({
      id: firstString(c.openConversationId, c.conversationId, c.id) ?? '',
      title: firstString(c.title, c.name) ?? '（未知会话）',
      unread: typeof c.unreadPoint === 'number' ? c.unreadPoint : 0,
      lastMsgMs: toMs(c.lastMsgCreateAt),
      singleChat: c.singleChat === true,
    }))
    .filter((c) => c.id)
    .sort((a, b) => (b.lastMsgMs ?? 0) - (a.lastMsgMs ?? 0))
    .slice(0, MAX_ITEMS);
  const total = views.reduce((sum, c) => sum + c.unread, 0);
  return { conversations: views, total };
}

/* ---------------- 聚合器 ---------------- */

interface WidgetCacheEntry<T> {
  data: T;
  error?: string;
}

const cache: {
  calendar?: WidgetCacheEntry<DwsCalendarEventView[]>;
  todos?: WidgetCacheEntry<DwsTodoView[]>;
  approvals?: WidgetCacheEntry<DwsApprovalPendingView[]>;
  unread?: WidgetCacheEntry<UnreadParseResult>;
} = {};

let disabled: { reason: string } | null = null;
let lastCycleAt = 0;
let busy = false;
let timer: NodeJS.Timeout | null = null;

function snapshot(): DwsWidgetsSnapshot {
  if (disabled) {
    return {
      state: 'disabled',
      reason: disabled.reason,
      fetchedAt: lastCycleAt,
      calendar: [],
      todos: [],
      approvals: [],
      unread: [],
      unreadTotal: 0,
      errors: {},
    };
  }
  return {
    state: 'ready',
    fetchedAt: lastCycleAt,
    calendar: cache.calendar?.data ?? [],
    todos: cache.todos?.data ?? [],
    approvals: cache.approvals?.data ?? [],
    unread: cache.unread?.data.conversations ?? [],
    unreadTotal: cache.unread?.data.total ?? 0,
    errors: {
      ...(cache.calendar?.error ? { calendar: cache.calendar.error } : {}),
      ...(cache.todos?.error ? { todos: cache.todos.error } : {}),
      ...(cache.approvals?.error ? { approvals: cache.approvals.error } : {}),
      ...(cache.unread?.error ? { unread: cache.unread.error } : {}),
    },
  };
}

function push(): void {
  try {
    const { BrowserWindow } = requireElectron('electron') as typeof import('electron');
    const payload = snapshot();
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(FUNDET_PUSH.DWS_WIDGETS_CHANGED, payload);
    }
  } catch {
    /* 无窗口时静默 */
  }
}

/**
 * 从 dws 调用结果提炼人话错误：优先 stdout 里 dws 的 error.message（业务错：
 * 无权限/token 过期/缺命令），退 stderr 尾行（网络层），兜底退出码。
 * 此前只记「退出码 N」——所有人所有原因一个脸，排查无从下手（0.2.28 修）。
 */
export function errOf(result: { code: number; stdout: string; stderr: string }): string {
  const parsed = extractJson(result.stdout) as { error?: { message?: unknown; reason?: unknown } } | null;
  const bizMsg = typeof parsed?.error?.message === 'string' ? parsed.error.message.trim() : '';
  if (bizMsg) return bizMsg.slice(0, 120);
  const tail = result.stderr
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .pop();
  if (tail) return tail.slice(0, 120);
  return `退出码 ${result.code}`;
}

/** profile 失败里能识别出「登录态失效」的信号（token 30 天过期、授权被撤） */
const AUTH_FAIL_RE = /401|token|授权|unauthor|login|登录/i;

/** 审批查询失败的错误文案增强：dws 版本 < 1.0.62 时提示升级（输出格式不匹配的主因） */
function enrichApprovalError(msg: string, version: string | null): string {
  if (!version) return msg;
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!m) return msg;
  const [_, major, minor, patch] = m.map(Number);
  const tooOld = major! < 1 || (major === 1 && (minor! < 0 || (minor === 0 && patch! < 62)));
  return tooOld ? `${msg}（dws ${version} 版本过旧：到钉钉工作台面板点「重装 / 升级 dws」，装完后如仍失败，再「退出登录」重新登录）` : msg;
}

async function runCycle(force: boolean): Promise<DwsWidgetsSnapshot> {
  if (busy) return snapshot();
  if (!force && Date.now() - lastCycleAt < REFRESH_TTL_MS) return snapshot();
  busy = true;
  try {
    const dws = await resolveDws();
    if (!dws) {
      disabled = { reason: '还没安装 dws（钉钉工作台面板可一键安装）' };
      lastCycleAt = Date.now();
      push();
      return snapshot();
    }
    // 版本探测（审批卡错误文案增强用；探测失败 null 不阻断）
    let dwsVersion: string | null = null;
    try {
      const v = await execDws(dws, ['version', '--format', 'json'], 10_000);
      if (v.code === 0) {
        const parsed = (await import('./dws.js')).parseDwsVersion(v.stdout);
        dwsVersion = parsed.version ?? null;
      }
    } catch { /* 版本拿不到不阻断 */ }
    const [profile, cal, todo, oa, unread] = await Promise.all([
      execDws(dws, ['profile', 'list', '--format', 'json'], RUN_TIMEOUT_MS),
      execDws(dws, ['calendar', 'event', 'list', '--format', 'json'], QUERY_TIMEOUT_MS),
      execDws(dws, ['todo', 'task', 'list', '--format', 'json'], QUERY_TIMEOUT_MS),
      execDws(dws, ['oa', 'approval', 'list-pending', '--format', 'json'], QUERY_TIMEOUT_MS),
      execDws(dws, ['chat', 'message', 'list-unread-conversations', '--format', 'json'], QUERY_TIMEOUT_MS),
    ]);
    // profile 命令本身失败 ≠ 未登录：token 过期给可操作提示；网络/代理抖动
    // 保住登录态与旧数据，四卡挂失败角标等下轮重试（此前一律误判"还没登录"，
    // 整板直接消失——部分用户「加载失败」的来源）。
    if (profile.code !== 0) {
      const msg = errOf(profile);
      if (AUTH_FAIL_RE.test(msg)) {
        disabled = { reason: `钉钉登录态失效：${msg}（到钉钉工作台重新登录）` };
      } else {
        disabled = null;
        const err = `钉钉连接失败：${msg}`;
        cache.calendar = { data: cache.calendar?.data ?? [], error: err };
        cache.todos = { data: cache.todos?.data ?? [], error: err };
        cache.approvals = { data: cache.approvals?.data ?? [], error: err };
        cache.unread = { data: cache.unread?.data ?? { conversations: [], total: 0 }, error: err };
      }
      lastCycleAt = Date.now();
      push();
      return snapshot();
    }
    const profiles = extractJson(profile.stdout) as { profiles?: unknown } | null;
    if (!Array.isArray(profiles?.profiles) || (profiles?.profiles as unknown[]).length === 0) {
      disabled = { reason: '还没登录钉钉（钉钉工作台面板点「开始登录」）' };
      lastCycleAt = Date.now();
      push();
      return snapshot();
    }
    disabled = null;

    cache.calendar =
      cal.code === 0
        ? { data: parseCalendarEvents(cal.stdout) }
        : { data: cache.calendar?.data ?? [], error: errOf(cal) };
    cache.todos =
      todo.code === 0
        ? { data: parseTodos(todo.stdout) }
        : { data: cache.todos?.data ?? [], error: errOf(todo) };
    cache.approvals =
      oa.code === 0
        ? { data: parseApprovalsPending(oa.stdout) }
        : {
            data: cache.approvals?.data ?? [],
            error: enrichApprovalError(errOf(oa), dwsVersion),
          };
    cache.unread =
      unread.code === 0
        ? { data: parseUnread(unread.stdout) }
        : { data: cache.unread?.data ?? { conversations: [], total: 0 }, error: errOf(unread) };

    lastCycleAt = Date.now();
    push();
    return snapshot();
  } finally {
    busy = false;
  }
}

/** 应用启动后调用：立即一轮 + 定时轮询 */
export function startDwsWidgets(): void {
  if (timer) return;
  void runCycle(true);
  timer = setInterval(() => void runCycle(false), POLL_MS);
}

export function stopDwsWidgets(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

export function getDwsWidgetsSnapshot(): DwsWidgetsSnapshot {
  return snapshot();
}

/* ---------------- 条目详情（点开查看，按需拉取） ---------------- */

/** 群消息正文摘要上限：日报类机器人消息很长，卡片详情里只留头部 */
const CHAT_SNIPPET_MAX = 140;

export function parseChatMessages(stdout: string): DwsChatMessageView[] {
  const parsed = extractJson(stdout) as { messages?: unknown } | null;
  const messages = parsed?.messages;
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((m): m is Record<string, unknown> => typeof m === 'object' && m !== null)
    .map((m) => ({
      id: firstString(m.messageId, m.openMessageId) ?? '',
      sender: firstString(m.sender),
      text: (firstString(m.text, m.content) ?? '').replace(/\s+/g, ' ').trim().slice(0, CHAT_SNIPPET_MAX),
      timeMs: toMs(firstString(m.createTime) ?? ''),
    }))
    .filter((m) => m.id && m.text)
    .slice(0, 8);
}

/** conversationId 进入 spawn 参数前先过白名单（本就只来自快照，双保险） */
const SAFE_CONV_ID = /^[A-Za-z0-9+/=_.-]{1,128}$/;

export async function fetchUnreadDetail(conversationId: string): Promise<DwsChatMessageView[]> {
  if (!SAFE_CONV_ID.test(conversationId)) return [];
  const dws = await resolveDws();
  if (!dws) return [];
  const res = await execDws(
    dws,
    ['chat', 'message', 'list', '--conversation-id', conversationId, '--limit', '8', '--format', 'json'],
    QUERY_TIMEOUT_MS,
  );
  if (res.code !== 0) return [];
  return parseChatMessages(res.stdout);
}

export function registerDwsWidgetsIpc(): void {
  const { ipcMain } = requireElectron('electron') as typeof import('electron');
  ipcMain.handle(
    FUNDET_INVOKE.DWS_WIDGETS,
    async (_e: unknown, force: unknown) => runCycle(force === true),
  );
  ipcMain.handle(
    FUNDET_INVOKE.DWS_WIDGETS_DETAIL,
    async (_e: unknown, kind: unknown, id: unknown) =>
      kind === 'unread' && typeof id === 'string' ? fetchUnreadDetail(id) : [],
  );
}
