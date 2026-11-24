/**
 * 办公组件聚合器（灵动岛数据面）：按当前办公 CLI 供应商（officecli.provider）
 * 定时并发跑查询，归一化成 DwsWidgetsSnapshot 缓存在主进程，push 给渲染层。
 *
 * - 钉钉（dws）：四路——今日日程 / 待办 / 待审批 / 未读会话
 * - 企业微信（wecom-cli）：两路——今日日程 / 未完成待办（CLI 没有审批与未读
 *   会话接口，这两卡不进快照）；返回结构取自官方 `--schema`，登录态实测输出待补
 *
 * - 门控：未装/未登录 → disabled，不跑查询
 * - 节奏：默认 2 分钟一轮；渲染层回焦触发 dwsWidgets() 时按 TTL（45s）去抖
 * - 降级：单查询失败保留上次好数据 + errors 角标，不拖垮整板
 * - 只读：本模块不产生任何写操作；组件上的动作全部走 Agent 会话（过命令确认闸）
 *
 * 钉钉解析器吃 dws 全量 JSON（输出几 KB，不进模型上下文，无需 --jq 裁剪），
 * fixture 是真机登录态实捕（__fixtures__/dws-*.json）。
 * 供应商设置只能惰性读（settings 依赖 sqlite 原生模块，node --test 直跑本文件的
 * 纯解析器时不能拉起数据库）。
 */
import { createRequire } from 'node:module';
import { execDws, extractJson, hasActiveLogin, parseProfileList, resolveDws } from './dws.ts';
import { execWecom, parseWecomAuthShow, parseWecomError, resolveWecomCli } from './wecom-cli.ts';
import { getOfficeProvider } from './office-cli.ts';
import { DEFAULT_OFFICE_PROVIDER, type OfficeCliProvider } from '../../shared/office-cli.ts';
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

/** 已结束超过 1 小时的不占版面；按开始时间排序，封顶 MAX_ITEMS */
function finishCalendar(events: DwsCalendarEventView[], nowMs: number): DwsCalendarEventView[] {
  return events
    .filter((e) => e.id || e.title !== '（无标题）')
    .filter((e) => e.endMs === null || e.endMs >= nowMs - 60 * 60_000)
    .sort((a, b) => (a.startMs ?? Infinity) - (b.startMs ?? Infinity))
    .slice(0, MAX_ITEMS);
}

export function parseCalendarEvents(stdout: string, nowMs: number = Date.now()): DwsCalendarEventView[] {
  const parsed = extractJson(stdout) as { result?: { events?: unknown } } | null;
  const events = parsed?.result?.events;
  if (!Array.isArray(events)) return [];
  return finishCalendar(
    events
    .filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null)
    // 已取消的会议钉钉仍会返回（带 status:"cancelled"）——不过滤会按时间段
    // 被推断成「进行中/未开始」持续展示（2026-10-09 用户实报）
    .filter((e) => e.status !== 'cancelled' && e.status !== 'canceled')
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
    })),
    nowMs,
  );
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

function parseWecomJson(stdout: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(stdout) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/**
 * wecom-cli 的时间串：`YYYY-MM-DD HH:mm:ss` / `YYYY-MM-DD` 按本地时间；带时区
 * （Z / ±hh:mm）的按绝对时刻；其它形态交给 Date.parse，认不出返回 null。
 */
export function wecomTimeMs(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v) return null;
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(v);
  if (!m) {
    const fallback = Date.parse(v);
    return Number.isFinite(fallback) ? fallback : null;
  }
  const [y, mo, d, hh = '0', mi = '0', ss = '0', tz] = m.slice(1) as Array<string | undefined>;
  const two = (s: string | undefined): string => (s ?? '0').padStart(2, '0');
  if (tz) {
    const instant = Date.parse(`${y}-${two(mo)}-${two(d)}T${two(hh)}:${two(mi)}:${two(ss)}${tz === 'Z' ? 'Z' : tz}`);
    return Number.isFinite(instant) ? instant : null;
  }
  const local = new Date(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mi), Number(ss), 0).getTime();
  return Number.isFinite(local) ? local : null;
}

/** 今日日程的查询窗口（本地时间 00:00:00 – 23:59:59，wecom-cli 的时间格式） */
export function wecomTodayWindow(nowMs: number = Date.now()): { begin_time: string; end_time: string } {
  const pad = (n: number): string => String(n).padStart(2, '0');
  const fmt = (d: Date): string =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const start = new Date(nowMs);
  start.setHours(0, 0, 0, 0);
  const end = new Date(nowMs);
  end.setHours(23, 59, 59, 0);
  return { begin_time: fmt(start), end_time: fmt(end) };
}

/**
 * 今日日程（wecom-cli calendar schedules list）。返回结构取自官方 --schema：
 * schedule_list[] 的 ScheduleInfo——subject / begin_time / end_time / is_all_day /
 * location / attendees[].name / meeting_room.meeting_room_name / creator_name。
 */
export function parseWecomCalendar(stdout: string, nowMs: number = Date.now()): DwsCalendarEventView[] {
  const list = parseWecomJson(stdout)?.schedule_list;
  if (!Array.isArray(list)) return [];
  return finishCalendar(
    list.filter(isRecord).map((e) => {
      const isAllDay = e.is_all_day === true;
      const startMs = wecomTimeMs(e.begin_time);
      let endMs = wecomTimeMs(e.end_time);
      // 全天日程的结束时间可能给次日 0 点或同为日期：算到当天最后一毫秒，免得被「已结束」过滤
      if (isAllDay && startMs !== null && (endMs === null || endMs <= startMs)) {
        endMs = startMs + 24 * 60 * 60_000 - 1;
      }
      const attendees = Array.isArray(e.attendees) ? e.attendees.filter(isRecord) : [];
      return {
        id: firstString(e.schedule_id, e.id) ?? '',
        title: firstString(e.subject, e.title) ?? '（无标题）',
        startMs,
        endMs,
        isAllDay,
        location: firstString(e.location),
        roomName: firstString(isRecord(e.meeting_room) ? e.meeting_room.meeting_room_name : undefined),
        organizer: firstString(e.creator_name),
        // 参会人名（点开详情展示）；wecom 返回里没有「自己」的标记，原样取
        attendees: attendees
          .map((a) => firstString(a.name) ?? '')
          .filter(Boolean)
          .slice(0, 8),
        description: firstString(e.description)?.replace(/\s+/g, ' ').slice(0, 120),
      };
    }),
    nowMs,
  );
}

/**
 * 待办（wecom-cli todo list，status_filter=proceed）。返回结构取自官方 --schema：
 * items[] 的 title / todo_id / deadline{type,value}。date 型截止算到当天结束
 * （截止日当天不算逾期）；wecom 没有优先级，统一给默认档。
 */
export function parseWecomTodos(stdout: string, nowMs: number = Date.now()): DwsTodoView[] {
  const items = parseWecomJson(stdout)?.items;
  if (!Array.isArray(items)) return [];
  return items
    .filter(isRecord)
    .map((t) => {
      const deadline = isRecord(t.deadline) ? t.deadline : undefined;
      let dueMs = wecomTimeMs(deadline?.value);
      // date 型截止算到当天最后一毫秒（截止日当天不算逾期）
      if (dueMs !== null && deadline?.type === 'date') dueMs += 24 * 60 * 60_000 - 1;
      return {
        taskId: firstString(t.todo_id, t.id) ?? '',
        subject: firstString(t.title, t.subject) ?? '',
        dueMs,
        priority: typeof t.priority === 'number' ? t.priority : 50,
      };
    })
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

let disabled: { reason: string; kind: NonNullable<DwsWidgetsSnapshot['disabledKind']> } | null = null;
let lastCycleAt = 0;
let busy = false;
let timer: NodeJS.Timeout | null = null;
let loggedInvocation = false;
/** 当前缓存对应的供应商；与设置不一致时清缓存按新供应商重取 */
let activeProvider: OfficeCliProvider = DEFAULT_OFFICE_PROVIDER;
/** 供应商切换发生在某轮查询途中：那一轮结束后要按新供应商补跑一轮 */
let rerunRequested = false;
/** 供应商刚切换、新供应商的第一轮还没出结果：此时给占位快照，不把上一家清空后的
 *  空缓存当成「今天没事」展示 */
let switching = false;

function snapshot(): DwsWidgetsSnapshot {
  if (switching) {
    return {
      provider: activeProvider,
      state: 'disabled',
      disabledKind: 'not-logged-in',
      reason: '正在切换办公平台…',
      fetchedAt: 0,
      calendar: [],
      todos: [],
      approvals: [],
      unread: [],
      unreadTotal: 0,
      errors: {},
    };
  }
  if (disabled) {
    return {
      provider: activeProvider,
      state: 'disabled',
      disabledKind: disabled.kind,
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
    provider: activeProvider,
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
  // 只有带真实结果的那一轮才 push：到这里切换过渡态结束
  switching = false;
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
 * 从 dws 调用结果提炼人话错误：优先两侧 stdout/stderr 里 dws 的 error.message
 *（业务错：无权限/token 过期/缺命令；2026-10-20 实测 stderr 也带 JSON），退
 * stderr 尾行（网络层），兜底退出码。旧登录态刷新失败（authCode.notFound 类）
 * 映射为固定重新登录指引；其余业务错原文保留、上限 220 字。
 */
export function errOf(result: { code: number; stdout: string; stderr: string }): string {
  // dws 的业务错误 JSON 可能落在 stdout 也可能落在 stderr（2026-10-20 实测：
  // 旧登录态刷新失败时 stdout 空、stderr 是完整 JSON）。两侧都先按 JSON 解析
  // 取 error.message，再退 stderr 尾行（网络层文本），兜底退出码。
  for (const text of [result.stdout, result.stderr]) {
    const parsed = extractJson(text) as { error?: { message?: unknown; reason?: unknown } } | null;
    const bizMsg = typeof parsed?.error?.message === 'string' ? parsed.error.message.trim() : '';
    if (bizMsg) {
      // 旧登录态刷新失败：原文 200+ 字（含 profile 标识与内部错误码），卡片只给
      // 可行动作，原文仍留在主进程诊断日志里
      if (/authCode\.notFound|登录态已无法|重新授权/.test(bizMsg)) {
        return '钉钉登录态已失效，请重新登录（钉钉工作台面板点「开始登录」）';
      }
      return bizMsg.slice(0, 220);
    }
  }
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
  const tooOld = major! < 1 || (major === 1 && minor === 0 && patch! < 62);
  return tooOld ? `${msg}（dws ${version} 版本过旧：到钉钉工作台面板点「重装 / 升级 dws」，装完后如仍失败，再「退出登录」重新登录）` : msg;
}

function resetWidgetState(): void {
  cache.calendar = undefined;
  cache.todos = undefined;
  cache.approvals = undefined;
  cache.unread = undefined;
  disabled = null;
  lastCycleAt = 0;
  loggedInvocation = false;
}

/** 切换办公 CLI 供应商后调用：上一家的数据清空，随后的 refreshDwsWidgets 按新供应商全量重取 */
export function resetDwsWidgets(): void {
  resetWidgetState();
}

export function refreshDwsWidgets(): Promise<DwsWidgetsSnapshot> {
  return runCycle(true);
}

/**
 * 轮询入口：读当前供应商再分派。busy 的检查与置位之间没有 await（采集函数体同步
 * 跑到第一个 await 前就已置位），并发调用不会双入。切换供应商时若恰好有一轮在途，
 * 那一轮属于旧供应商——它回来后发现过期就不写缓存，由这里补跑一轮新供应商的。
 */
async function runCycle(force: boolean): Promise<DwsWidgetsSnapshot> {
  const provider = await getOfficeProvider();
  if (provider !== activeProvider) {
    resetWidgetState();
    activeProvider = provider;
    switching = true;
    force = true;
  }
  if (busy) {
    if (force) rerunRequested = true;
    return snapshot();
  }
  if (!force && Date.now() - lastCycleAt < REFRESH_TTL_MS) return snapshot();
  try {
    return await (provider === 'wecom' ? runWecomCycle() : runDingtalkCycle());
  } finally {
    if (rerunRequested && !busy) {
      rerunRequested = false;
      void runCycle(true);
    }
  }
}

/** 本轮开始时的供应商；途中被切换 = 这一轮的结果作废 */
function staleCheck(): () => boolean {
  const start = activeProvider;
  return () => activeProvider !== start;
}

/**
 * 企业微信一轮：先看授权（未授权时不发业务请求，省掉两次必败的网络调用），
 * 再并发拉今日日程与未完成待办。审批/未读没有对应接口——不进缓存也不报错。
 */
async function runWecomCycle(): Promise<DwsWidgetsSnapshot> {
  busy = true;
  const stale = staleCheck();
  try {
    const finish = (): DwsWidgetsSnapshot => {
      lastCycleAt = Date.now();
      push();
      return snapshot();
    };
    const cli = await resolveWecomCli();
    if (stale()) return snapshot();
    if (!cli) {
      disabled = { kind: 'not-installed', reason: '还没安装 wecom-cli（企业微信工作台面板可一键安装）' };
      return finish();
    }
    // 命中哪个调用方式只报一次（npm 全局装与 ~/.local/bin 可能并存，排查时要靠这条）
    if (!loggedInvocation) {
      loggedInvocation = true;
      console.log('[fundet:dws] 聚合器命中 wecom-cli 调用方式', { command: cli.args.length > 0 ? `${cli.command} ${cli.args.join(' ')}` : cli.command });
    }
    const auth = await execWecom(cli, ['auth', 'show'], RUN_TIMEOUT_MS);
    if (stale()) return snapshot();
    if (auth.code !== 0) {
      // 授权命令本身失败 ≠ 未登录：授权类错误给可操作提示；网络/代理抖动保住旧数据
      const failure = parseWecomError(auth);
      if (failure.auth) {
        disabled = { kind: 'auth-failed', reason: `企业微信授权已失效：${failure.message}（到企业微信工作台重新扫码）` };
      } else {
        disabled = null;
        const err = `企业微信连接失败：${failure.message}`;
        cache.calendar = { data: cache.calendar?.data ?? [], error: err };
        cache.todos = { data: cache.todos?.data ?? [], error: err };
      }
      return finish();
    }
    if (parseWecomAuthShow(auth.stdout).loggedIn !== true) {
      disabled = { kind: 'not-logged-in', reason: '还没登录企业微信（企业微信工作台面板点「扫码登录」）' };
      return finish();
    }
    disabled = null;
    const now = Date.now();
    const [cal, todo] = await Promise.all([
      execWecom(cli, ['calendar', 'schedules', 'list', '--json', JSON.stringify(wecomTodayWindow(now))], QUERY_TIMEOUT_MS),
      execWecom(cli, ['todo', 'list', '--json', JSON.stringify({ status_filter: ['proceed'], limit: 20 })], QUERY_TIMEOUT_MS),
    ]);
    if (stale()) return snapshot();
    // 失败诊断（只在有失败时输出）：UI 只挂角标时看不到是哪一路、为什么挂
    for (const [name, res] of [
      ['calendar', cal],
      ['todo', todo],
    ] as const) {
      if (res.code === 0) continue;
      console.warn('[fundet:dws] 企业微信组件查询失败', {
        name,
        code: res.code,
        stdoutHead: res.stdout.replace(/\s+/g, ' ').slice(0, 160),
        stderrHead: res.stderr.replace(/\s+/g, ' ').slice(0, 160),
      });
    }
    cache.calendar =
      cal.code === 0
        ? { data: parseWecomCalendar(cal.stdout, now) }
        : { data: cache.calendar?.data ?? [], error: parseWecomError(cal).message };
    cache.todos =
      todo.code === 0
        ? { data: parseWecomTodos(todo.stdout, now) }
        : { data: cache.todos?.data ?? [], error: parseWecomError(todo).message };
    return finish();
  } finally {
    busy = false;
  }
}

/** 钉钉一轮：profile 门控 + 四路查询（日程 / 待办 / 待审批 / 未读会话） */
async function runDingtalkCycle(): Promise<DwsWidgetsSnapshot> {
  busy = true;
  const stale = staleCheck();
  try {
    const dws = await resolveDws();
    if (stale()) return snapshot();
    if (!dws) {
      disabled = { kind: 'not-installed', reason: '还没安装 dws（钉钉工作台面板可一键安装）' };
      lastCycleAt = Date.now();
      push();
      return snapshot();
    }
    // 命中哪个 dws 二进制只报一次（npm 包装 v1.0.x 与 ~/.local/bin 可能并存且版本不同，
    // 2026-10-20 排查靠这条才没走偏）；每轮都打会刷屏
    if (!loggedInvocation) {
      loggedInvocation = true;
      console.log('[fundet:dws] 聚合器命中 dws 调用方式', { command: dws.psCommand });
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
    if (stale()) return snapshot();
    // 失败诊断（只在有失败时输出）：UI 只挂角标时看不到是哪一路、为什么挂
    for (const [name, res] of [
      ['profile', profile],
      ['calendar', cal],
      ['todo', todo],
      ['oa', oa],
      ['unread', unread],
    ] as const) {
      if (res.code === 0) continue;
      const stderrTail = res.stderr.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop() ?? '';
      console.warn('[fundet:dws] 组件查询失败', {
        name,
        code: res.code,
        stdoutLen: res.stdout.length,
        stderrLen: res.stderr.length,
        stdoutHead: res.stdout.replace(/\s+/g, ' ').slice(0, 160),
        stderrHead: res.stderr.replace(/\s+/g, ' ').slice(0, 160),
        stderrTail: stderrTail.slice(0, 160),
      });
    }
    // profile 命令本身失败 ≠ 未登录：token 过期给可操作提示；网络/代理抖动
    // 保住登录态与旧数据，四卡挂失败角标等下轮重试（此前一律误判"还没登录"，
    // 整板直接消失——部分用户「加载失败」的来源）。
    if (profile.code !== 0) {
      const msg = errOf(profile);
      if (AUTH_FAIL_RE.test(msg)) {
        disabled = { kind: 'auth-failed', reason: `钉钉登录态失效：${msg}（到钉钉工作台重新登录）` };
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
    const profiles = parseProfileList(profile.stdout);
    if (profiles.length === 0) {
      disabled = { kind: 'not-logged-in', reason: '还没登录钉钉（钉钉工作台面板点「开始登录」）' };
      lastCycleAt = Date.now();
      push();
      return snapshot();
    }
    // profile list 不需有效 token 也能返回：status=expired 时四路查询注定全部
    // authCode.notFound（2026-10-20 实报，旧登录态服务端刷新通道已关闭）。此时
    // 直接给「重新登录」横幅，不让四卡各挂一条天书错误。
    if (!hasActiveLogin(profiles)) {
      disabled = { kind: 'expired', reason: '钉钉登录态已过期（旧登录态服务端不再支持自动刷新）：钉钉工作台面板点「开始登录」重新授权一次即可' };
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
  // 未读详情是钉钉独有；企业微信没有这张卡（渲染层按供应商隐藏），保险起见直接返回
  if (activeProvider !== 'dingtalk') return [];
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
