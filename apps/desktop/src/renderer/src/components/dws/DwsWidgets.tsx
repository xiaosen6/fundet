/**
 * 钉钉组件板：今日日程 / 待我审批 / 我的待办 / 未读消息。
 *
 * 两种呈现模式（expandMode）：
 * - popover（主页欢迎页）：板面完全静态——条目点击不原地展开，弹出锚定在卡片
 *   下方的浮层（fixed，可滚动，Esc/外点关闭），主页布局绝不因交互而变化
 * - inline（灵动岛弹层内）：条目原地手风琴展开（grid-rows 0fr→1fr），浮层内
 *   自成一体不影响主界面
 * 未读会话详情 = 按需拉最近消息（dwsWidgetsDetail IPC，不进轮询）；
 * 组件仍只读，一切写操作走 Agent 命令确认闸。
 */
import { useEffect, useState } from 'react';
import {
  CalendarDays,
  CheckSquare,
  ChevronRight,
  Inbox,
  MapPin,
  MessageSquare,
  RefreshCw,
  Sparkles,
  User,
  X,
} from 'lucide-react';
import type { DwsChatMessageView, DwsWidgetsSnapshot } from '../../../../shared/fundet-api.js';
import { cn } from '../../lib/cn';

function fmtTime(ms: number | null | undefined): string {
  if (!ms) return '';
  return new Date(ms).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function fmtAgo(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return '刚刚';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
  return `${Math.floor(diff / 86400_000)} 天前`;
}

function countdown(ms: number, now: number): { text: string; tone: 'live' | 'soon' | 'calm' } {
  const diff = ms - now;
  if (diff <= 0) return { text: '进行中', tone: 'live' };
  if (diff < 15 * 60_000) return { text: `${Math.max(1, Math.round(diff / 60_000))} 分钟后`, tone: 'soon' };
  if (diff < 3600_000) return { text: `${Math.max(1, Math.round(diff / 60_000))} 分钟后`, tone: 'calm' };
  return { text: `${Math.floor(diff / 3600_000)} 小时后`, tone: 'calm' };
}

const TONE_CLASS: Record<'live' | 'soon' | 'calm', string> = {
  live: 'bg-hover-soft text-warning',
  soon: 'bg-accent text-accent-fg',
  calm: 'bg-chip text-secondary',
};

/** 手风琴容器：grid-rows 0fr↔1fr 高度动画（compositor 友好，reduced-motion 全局闸兜底） */
function Reveal({ open, children }: { open: boolean; children: React.ReactNode }): React.JSX.Element {
  return (
    <div
      className={cn(
        'grid transition-[grid-template-rows] duration-[var(--motion-base)] ease-[var(--motion-ease-move)]',
        open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
      )}
    >
      <div className="min-h-0 overflow-hidden">
        <div className="px-1 pb-1.5 pt-0.5">{children}</div>
      </div>
    </div>
  );
}

function AskChip({ label, onClick }: { label: string; onClick: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      className="mt-1 flex h-6 items-center gap-1 rounded-full bg-chip px-2 text-11 text-secondary transition-colors hover:bg-hover hover:text-primary"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <Sparkles size={11} />
      {label}
    </button>
  );
}

function UnreadDetail({ convId }: { convId: string }): React.JSX.Element {
  const [msgs, setMsgs] = useState<DwsChatMessageView[] | null>(null);
  useEffect(() => {
    let alive = true;
    setMsgs(null);
    window.fundet
      .dwsWidgetsDetail('unread', convId)
      .then((m) => {
        if (alive) setMsgs(m);
      })
      .catch(() => {
        if (alive) setMsgs([]);
      });
    return () => {
      alive = false;
    };
  }, [convId]);
  if (msgs === null) return <p className="py-2 text-11 text-muted">拉取最近消息…</p>;
  if (msgs.length === 0) return <p className="py-2 text-11 text-muted">没拉到消息（可能无查看权限）</p>;
  return (
    // 外层容器已负责滚动，这里不再嵌套滚动（双层滚动手感差）
    <div className="flex flex-col gap-2 py-1">
      {msgs.map((m) => (
        <div key={m.id} className="text-12">
          <span className="font-medium text-secondary">{m.sender ?? '未知'}</span>
          {m.timeMs !== null && <span className="ml-1.5 text-11 text-muted">{fmtTime(m.timeMs)}</span>}
          <p className="mt-0.5 leading-relaxed text-primary">{m.text}</p>
        </div>
      ))}
    </div>
  );
}

interface CardShellProps {
  title: string;
  Icon: typeof CalendarDays;
  badge?: number;
  error?: string;
  onAsk?: () => void;
  onRefresh?: () => void;
  index: number;
  children: React.ReactNode;
}

function CardShell({ title, Icon, badge, error, onAsk, onRefresh, index, children }: CardShellProps): React.JSX.Element {
  return (
    <div
      data-widget-card
      className={cn(
        // 高度随网格行弹性分配（高屏舒展/矮屏收缩，主页永不滚动），150px 地板（窗口最小高 640 也放得下）
        'group animate-fundet-rise-in fundet-surface flex h-full min-h-[150px] min-w-0 flex-col rounded-container border border-board bg-card p-5 select-none',
        'hover:border-[var(--input-focus-border)]',
      )}
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <div className="flex items-center gap-2.5">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-chip text-secondary">
          <Icon size={13} strokeWidth={2} />
        </span>
        <span className="text-13 font-medium text-primary">{title}</span>
        {typeof badge === 'number' && badge > 0 && (
          <span className="rounded-full bg-accent px-1.5 py-px text-11 font-medium tabular-nums text-accent-fg">{badge}</span>
        )}
        {error && (
          <button
            type="button"
            title={`${error}（点此重试）`}
            className="rounded-full bg-hover-soft px-1.5 py-px text-11 text-error transition-colors hover:text-primary"
            onClick={onRefresh}
          >
            刷新失败
          </button>
        )}
        <span className="flex-1" />
        {onAsk && (
          <button
            type="button"
            className={cn(
              'flex h-6 items-center gap-1 rounded-full px-2 text-11 text-muted',
              'transition-all duration-[var(--motion-fast)]',
              'hover:bg-hover hover:text-primary',
            )}
            onClick={onAsk}
          >
            <Sparkles size={11} />
            交给智能体
          </button>
        )}
      </div>
      <div className="mt-3 flex min-h-0 flex-1 flex-col overflow-y-auto pr-0.5">{children}</div>
    </div>
  );
}

function EmptyState({ Icon, text }: { Icon: typeof CalendarDays; text: string }): React.JSX.Element {
  return (
    <div className="flex flex-1 items-center gap-2.5 py-5 text-12 text-muted">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-chip">
        <Icon size={13} strokeWidth={1.8} className="text-muted" />
      </span>
      {text}
    </div>
  );
}

/** 行按钮：hover 微位移 + 尾部 chevron 旋转指示展开态 */
function RowButton({
  open,
  onClick,
  children,
}: {
  open: boolean;
  onClick: (e: React.MouseEvent) => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-expanded={open}
      className={cn(
        'group/row flex w-full min-w-0 items-center gap-2 rounded-inner px-1 py-1 text-left',
        'transition-colors duration-[var(--motion-fast)]',
        'hover:bg-hover-soft',
      )}
      onClick={onClick}
    >
      {children}
      <ChevronRight
        size={12}
        className={cn(
          'ml-auto shrink-0 text-muted opacity-0 transition-[opacity,transform] duration-[var(--motion-fast)] group-hover/row:opacity-100 focus-visible:opacity-100',
          open && 'rotate-90 opacity-100',
        )}
      />
    </button>
  );
}

/* ---------------- 各卡内容 ----------------
   两个正交开关（曾合并成 mode 一个字段，导致灵动岛 inline 模式条目点击
   去开一个只在 popover 模式渲染的浮层——点开无反应，0.2.29 拆分修复）：
   - sliced：板面密度（前 3 条 + 溢出行）；false = 全量列表
   - expandable：条目原地手风琴展开；false = 点击弹出详情浮层（欢迎页） */

type CardKind = 'calendar' | 'approvals' | 'todos' | 'unread';

interface ListCtx {
  sliced: boolean;
  expandable: boolean;
  expandedKey: string | null;
  toggle: (key: string) => void;
  openPopover: (kind: CardKind, e: React.MouseEvent) => void;
  onAskAgent?: (prompt: string) => void;
}

function rowClick(ctx: ListCtx, kind: CardKind, key: string): (e: React.MouseEvent) => void {
  if (ctx.expandable) return () => ctx.toggle(key);
  return (e) => ctx.openPopover(kind, e);
}

function CalendarBody({
  s,
  now,
  ctx,
}: {
  s: DwsWidgetsSnapshot;
  now: number;
  ctx: ListCtx;
}): React.JSX.Element | null {
  const nextEvent = s.calendar.find((e) => (e.startMs ?? Infinity) > now) ?? s.calendar[0];
  if (s.calendar.length === 0) return <EmptyState Icon={CalendarDays} text="今天没有日程" />;
  const items = ctx.sliced ? s.calendar.slice(0, 3) : s.calendar;
  return (
    <>
      <div className="rounded-inner bg-card-ivory px-3.5 py-3">
        <div className="flex items-center gap-2">
          {nextEvent.startMs !== null && (() => {
            const c = countdown(nextEvent.startMs, now);
            return (
              <span className={cn('flex h-5 items-center gap-1.5 rounded-full px-2 text-11 font-medium', TONE_CLASS[c.tone])}>
                {c.tone === 'live' && <span className="h-1.5 w-1.5 animate-fundet-pulse rounded-full bg-warning" />}
                {c.text}
              </span>
            );
          })()}
          <span className="text-12 tabular-nums text-secondary">
            {nextEvent.startMs !== null && nextEvent.endMs !== null
              ? `${fmtTime(nextEvent.startMs)} – ${fmtTime(nextEvent.endMs)}`
              : ''}
          </span>
        </div>
        <p className="mt-1.5 truncate text-15 font-medium text-primary" title={nextEvent.title}>
          {nextEvent.title}
        </p>
        {(nextEvent.roomName || nextEvent.organizer) && (
          <p className="mt-1 flex min-w-0 items-center gap-3 text-12 text-muted">
            {nextEvent.roomName && (
              <span className="flex min-w-0 items-center gap-1">
                <MapPin size={11} className="shrink-0" />
                {nextEvent.roomName}
              </span>
            )}
            {nextEvent.organizer && (
              <span className="flex min-w-0 items-center gap-1">
                <User size={11} className="shrink-0" />
                {nextEvent.organizer}
              </span>
            )}
          </p>
        )}
      </div>
      <div className="mt-1.5 flex flex-col divide-y divide-board/60">
        {items.map((e) => {
          const key = `cal:${e.id}`;
          const open = ctx.expandable && ctx.expandedKey === key;
          const isNext = e.id === nextEvent.id;
          return (
            <div key={e.id}>
              <RowButton open={open} onClick={rowClick(ctx, 'calendar', key)}>
                <span
                  className={cn(
                    'w-10 shrink-0 text-right text-12 tabular-nums',
                    isNext ? 'font-medium text-primary' : 'text-secondary',
                  )}
                >
                  {fmtTime(e.startMs)}
                </span>
                <span className={cn('h-1 w-1 shrink-0 rounded-full', isNext ? 'bg-accent' : 'bg-board')} />
                <span className="min-w-0 truncate text-13 text-primary" title={e.title}>
                  {e.title}
                </span>
              </RowButton>
              {ctx.expandable && (
                <Reveal open={open}>
                  <div className="rounded-inner bg-hover-soft/60 px-2.5 py-2">
                    {e.attendees.length > 0 && (
                      <p className="text-12 text-secondary">
                        <span className="text-muted">参会人：</span>
                        {e.attendees.join('、')}
                        {e.attendees.length >= 8 ? ' 等' : ''}
                      </p>
                    )}
                    {e.description && <p className="mt-1 text-12 leading-relaxed text-muted">{e.description}</p>}
                    <AskChip
                      label="准备这场"
                      onClick={() =>
                        ctx.onAskAgent?.(
                          `帮我准备钉钉会议「${e.title}」${e.roomName ? `（会议室：${e.roomName}）` : ''}${
                            e.startMs ? `，${fmtTime(e.startMs)} 开始` : ''
                          }${e.attendees.length > 0 ? `，参会人：${e.attendees.join('、')}` : ''}。收集背景，给我议题和材料清单。`,
                        )
                      }
                    />
                  </div>
                </Reveal>
              )}
            </div>
          );
        })}
        {ctx.sliced && s.calendar.length > 3 && (
          <p className="px-1 pt-1 text-11 text-muted">还有 {s.calendar.length - 3} 场…</p>
        )}
      </div>
    </>
  );
}

function ApprovalsBody({ s, ctx }: { s: DwsWidgetsSnapshot; ctx: ListCtx }): React.JSX.Element {
  if (s.approvals.length === 0) return <EmptyState Icon={Inbox} text="没有待审批" />;
  return (
    <>
      <p className="flex items-baseline gap-2">
        <span className="text-3xl font-medium leading-none tabular-nums text-primary">{s.approvals.length}</span>
        <span className="text-12 leading-none text-muted">条等你处理</span>
      </p>
      <div className="mt-2 flex flex-col divide-y divide-board/60">
        {s.approvals.map((a) => {
          const key = `oa:${a.id}`;
          const open = ctx.expandable && ctx.expandedKey === key;
          return (
            <div key={a.id}>
              <RowButton open={open} onClick={rowClick(ctx, 'approvals', key)}>
                <span className="min-w-0 truncate text-13 text-primary" title={a.title}>
                  {a.title ?? '审批单'}
                </span>
                {a.initiator && <span className="shrink-0 text-11 text-muted">{a.initiator}</span>}
              </RowButton>
              {ctx.expandable && (
                <Reveal open={open}>
                  <div className="rounded-inner bg-hover-soft/60 px-2.5 py-2">
                    {a.createTimeMs && <p className="text-12 text-muted">发起于 {fmtAgo(a.createTimeMs)}</p>}
                    <AskChip
                      label="拉详情给意见"
                      onClick={() =>
                        ctx.onAskAgent?.(
                          `拉取钉钉审批单「${a.title ?? a.id}」的详情，给我建议（同意/拒绝）和理由，先别提交。`,
                        )
                      }
                    />
                  </div>
                </Reveal>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

function TodosBody({ s, now, ctx }: { s: DwsWidgetsSnapshot; now: number; ctx: ListCtx }): React.JSX.Element {
  if (s.todos.length === 0) return <EmptyState Icon={CheckSquare} text="没有待办" />;
  const items = ctx.sliced ? s.todos.slice(0, 3) : s.todos;
  return (
    <>
      <p className="flex items-baseline gap-2">
        <span className="text-3xl font-medium leading-none tabular-nums text-primary">{s.todos.length}</span>
        <span className="text-12 leading-none text-muted">项待办</span>
        {s.todos.filter((t) => t.dueMs !== null && t.dueMs < now).length > 0 && (
          <span className="ml-1 rounded-full bg-hover-soft px-1.5 py-px text-11 leading-4 text-error">
            {s.todos.filter((t) => t.dueMs !== null && t.dueMs < now).length} 项逾期
          </span>
        )}
      </p>
      <div className="mt-2 flex flex-col divide-y divide-board/60">
        {items.map((t) => {
          const key = `todo:${t.taskId}`;
          const open = ctx.expandable && ctx.expandedKey === key;
          const overdue = t.dueMs !== null && t.dueMs < now;
          return (
            <div key={t.taskId}>
              <RowButton open={open} onClick={rowClick(ctx, 'todos', key)}>
                <span
                  className={cn(
                    'h-1.5 w-1.5 shrink-0 rounded-full',
                    overdue ? 'bg-error' : t.priority <= 20 ? 'bg-accent' : 'bg-board',
                  )}
                />
                <span className="min-w-0 truncate text-13 text-primary" title={t.subject}>
                  {t.subject}
                </span>
                {t.dueMs !== null && (
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-1.5 py-px text-11 leading-4 tabular-nums',
                      overdue ? 'bg-hover-soft text-error' : 'bg-chip text-secondary',
                    )}
                  >
                    {overdue ? '逾期' : fmtTime(t.dueMs)}
                  </span>
                )}
              </RowButton>
              {ctx.expandable && (
                <Reveal open={open}>
                  <div className="rounded-inner bg-hover-soft/60 px-2.5 py-2">
                    <p className="text-12 leading-relaxed text-secondary">{t.subject}</p>
                    <p className="mt-0.5 text-11 text-muted">
                      优先级 {t.priority <= 20 ? '高' : t.priority <= 30 ? '中' : '普通'}
                      {t.dueMs !== null ? ` · 截止 ${new Date(t.dueMs).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ''}
                    </p>
                    <AskChip
                      label="处理这条"
                      onClick={() =>
                        ctx.onAskAgent?.(
                          `帮我处理这条钉钉待办：「${t.subject}」（优先级 ${t.priority}${t.dueMs !== null ? `，截止 ${new Date(t.dueMs).toLocaleString('zh-CN')}` : ''}）。判断需要做什么，能直接办的就办（用 dws），办不了给我行动建议。`,
                        )
                      }
                    />
                  </div>
                </Reveal>
              )}
            </div>
          );
        })}
        {ctx.sliced && s.todos.length > 3 && (
          <p className="px-1 pt-1 text-11 text-muted">还有 {s.todos.length - 3} 项…</p>
        )}
      </div>
    </>
  );
}

function UnreadBody({ s, ctx }: { s: DwsWidgetsSnapshot; ctx: ListCtx }): React.JSX.Element {
  if (s.unread.length === 0) return <EmptyState Icon={MessageSquare} text="没有未读" />;
  const items = ctx.sliced ? s.unread.slice(0, 3) : s.unread;
  return (
    <>
      <p className="flex items-baseline gap-2">
        <span className="text-3xl font-medium leading-none tabular-nums text-primary">{s.unreadTotal}</span>
        <span className="text-12 leading-none text-muted">条未读 · 来自 {s.unread.length} 个会话</span>
      </p>
      <div className="mt-2 flex flex-col divide-y divide-board/60">
        {items.map((c) => {
          const key = `unread:${c.id}`;
          const open = ctx.expandable && ctx.expandedKey === key;
          return (
            <div key={c.id}>
              <RowButton open={open} onClick={rowClick(ctx, 'unread', key)}>
                <span className="min-w-0 truncate text-13 text-primary" title={c.title}>
                  {c.title}
                </span>
                <span
                  className={cn(
                    'shrink-0 rounded-full px-1.5 py-px text-11 leading-4 tabular-nums',
                    c.unread > 50 ? 'bg-hover-soft text-error' : 'bg-chip text-secondary',
                  )}
                >
                  {c.unread > 99 ? '99+' : c.unread}
                </span>
              </RowButton>
              {ctx.expandable && (
                <Reveal open={open}>
                  <div className="rounded-inner bg-hover-soft/60 px-2.5 py-2">
                    <UnreadDetail convId={c.id} />
                    <AskChip
                      label="总结这个会话"
                      onClick={() =>
                        ctx.onAskAgent?.(
                          `总结钉钉会话「${c.title}」的最近消息（约 ${c.unread} 条未读），给我要点和需要我回应的事项。`,
                        )
                      }
                    />
                  </div>
                </Reveal>
              )}
            </div>
          );
        })}
        {ctx.sliced && s.unread.length > 3 && (
          <p className="px-1 pt-1 text-11 text-muted">还有 {s.unread.length - 3} 个会话…</p>
        )}
      </div>
    </>
  );
}

/* ---------------- 板 + 弹出浮层 ---------------- */

export interface DwsWidgetsProps {
  snapshot: DwsWidgetsSnapshot | null;
  onAskAgent?: (prompt: string) => void;
  onRefresh?: () => void;
  /** popover=主页欢迎页（板静态，点击弹浮层）；inline=灵动岛弹层（原地展开） */
  expandMode?: 'inline' | 'popover';
}

const CARD_META: Record<CardKind, { title: string; Icon: typeof CalendarDays }> = {
  calendar: { title: '今日日程', Icon: CalendarDays },
  approvals: { title: '待我审批', Icon: Inbox },
  todos: { title: '我的待办', Icon: CheckSquare },
  unread: { title: '未读消息', Icon: MessageSquare },
};

export function DwsWidgets({ snapshot, onAskAgent, onRefresh, expandMode = 'inline' }: DwsWidgetsProps): React.JSX.Element | null {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [pop, setPop] = useState<{ kind: CardKind; top: number; left: number; width: number; height: number } | null>(null);

  // Esc 关浮层（须在早退 return 之前：钩子数不能随 snapshot 变化）
  useEffect(() => {
    if (!pop) return;
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') setPop(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pop]);

  if (!snapshot || snapshot.state !== 'ready') return null;
  const s = snapshot;
  const now = Date.now();
  const toggle = (key: string): void => setExpandedKey((k) => (k === key ? null : key));

  const boardCtx: ListCtx =
    expandMode === 'popover'
      ? { sliced: true, expandable: false, expandedKey: null, toggle, openPopover, onAskAgent }
      : { sliced: true, expandable: true, expandedKey, toggle, openPopover, onAskAgent };
  const detailCtx: ListCtx = { sliced: false, expandable: true, expandedKey, toggle, openPopover, onAskAgent };

  function openPopover(kind: CardKind, e: React.MouseEvent): void {
    const card = (e.currentTarget as HTMLElement).closest('[data-widget-card]');
    if (!(card instanceof HTMLElement)) return;
    const r = card.getBoundingClientRect();
    const width = Math.min(Math.max(r.width, 400), window.innerWidth - r.left - 12);
    // 弹窗定高（内部滚动，外框绝不因内容变高）；下方放不下翻到卡片上方，两边都挤就顶天立地
    const preferH = 440;
    const below = window.innerHeight - r.bottom - 18;
    const above = r.top - 18;
    let top: number;
    let height: number;
    if (below >= Math.min(280, preferH)) {
      top = r.bottom + 6;
      height = Math.min(preferH, below - 6);
    } else if (above >= Math.min(280, preferH)) {
      height = Math.min(preferH, above - 6);
      top = Math.max(12, r.top - 6 - height);
    } else {
      top = 12;
      height = window.innerHeight - 24;
    }
    setPop({ kind, top, left: r.left, width, height });
  }

  const cardAsk: Partial<Record<CardKind, () => void>> = {
    todos:
      s.todos.length > 0
        ? () =>
            onAskAgent?.(
              `帮我处理钉钉待办：${s.todos.map((t) => t.subject).join('、')}。逐条判断需要我做什么，能代办的就直接办（用 dws），办不了的给我行动建议。`,
            )
        : undefined,
    unread:
      s.unread.length > 0
        ? () =>
            onAskAgent?.(
              `帮我总结钉钉未读消息，重点是这几个会话：${s.unread.map((c) => `「${c.title}」（${c.unread} 条）`).join('、')}。各拉最近的消息，汇总成要点给我。`,
            )
        : undefined,
  };

  return (
    <div className="flex h-full w-full flex-col">
      <div className="mb-2.5 flex shrink-0 items-center gap-2 select-none">
        <span className="text-12 font-medium text-secondary">钉钉 · 今日</span>
        <span className="text-11 text-muted">更新于 {fmtAgo(s.fetchedAt)}</span>
        {onRefresh && (
          <button
            type="button"
            className="ml-auto flex h-6 w-6 items-center justify-center rounded-full text-muted transition-colors hover:bg-hover hover:text-primary"
            aria-label="刷新钉钉组件"
            title="刷新钉钉组件"
            onClick={onRefresh}
          >
            <RefreshCw size={12} />
          </button>
        )}
      </div>
      {/* 板区弹性：网格吃满剩余高度（行 1fr 对分、660px 封顶防高屏过空），居中兜底 */}
      <div className="flex min-h-0 flex-1 flex-col justify-center">
        <div className="grid max-h-[660px] min-h-0 flex-1 grid-cols-1 gap-3 sm:grid-cols-2 sm:grid-rows-[repeat(2,minmax(0,1fr))]">
        <CardShell
          title="今日日程"
          Icon={CalendarDays}
          error={s.errors.calendar}
          onRefresh={onRefresh}
          index={0}
        >
          <CalendarBody s={s} now={now} ctx={boardCtx} />
        </CardShell>
        <CardShell title="待我审批" Icon={Inbox} error={s.errors.approvals} onRefresh={onRefresh} index={1}>
          <ApprovalsBody s={s} ctx={boardCtx} />
        </CardShell>
        <CardShell
          title="我的待办"
          Icon={CheckSquare}
          error={s.errors.todos}
          onRefresh={onRefresh}
          index={2}
          onAsk={cardAsk.todos}
        >
          <TodosBody s={s} now={now} ctx={boardCtx} />
        </CardShell>
        <CardShell
          title="未读消息"
          Icon={MessageSquare}
          error={s.errors.unread}
          onRefresh={onRefresh}
          index={3}
          onAsk={cardAsk.unread}
        >
          <UnreadBody s={s} ctx={boardCtx} />
        </CardShell>
        </div>
      </div>

      {/* 弹出浮层：锚在被点卡片下方，内容可滚（板面零变化） */}
      {pop && expandMode === 'popover' && (
        <>
          <div className="fixed inset-0 z-40" aria-hidden onClick={() => setPop(null)} />
          <div
            className="animate-float-in fixed z-50 flex flex-col rounded-container border border-board bg-card p-4 shadow-[var(--shadow-menu)]"
            style={{ top: pop.top, left: pop.left, width: pop.width, height: pop.height }}
            role="dialog"
            aria-label={`${CARD_META[pop.kind].title}详情`}
          >
            <div className="flex items-center gap-2.5">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-chip text-secondary">
                {(() => {
                  const Icon = CARD_META[pop.kind].Icon;
                  return <Icon size={13} strokeWidth={2} />;
                })()}
              </span>
              <span className="text-13 font-medium text-primary">{CARD_META[pop.kind].title}</span>
              {cardAsk[pop.kind] && (
                <button
                  type="button"
                  className="flex h-6 items-center gap-1 rounded-full px-2 text-11 text-muted transition-colors hover:bg-hover hover:text-primary"
                  onClick={() => {
                    cardAsk[pop.kind]?.();
                    setPop(null);
                  }}
                >
                  <Sparkles size={11} />
                  交给智能体
                </button>
              )}
              <span className="flex-1" />
              <button
                type="button"
                aria-label="关闭"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-hover hover:text-primary"
                onClick={() => setPop(null)}
              >
                <X size={13} />
              </button>
            </div>
            <div className="mt-2.5 min-h-0 flex-1 overflow-y-auto pr-1">
              {pop.kind === 'calendar' && <CalendarBody s={s} now={now} ctx={detailCtx} />}
              {pop.kind === 'approvals' && <ApprovalsBody s={s} ctx={detailCtx} />}
              {pop.kind === 'todos' && <TodosBody s={s} now={now} ctx={detailCtx} />}
              {pop.kind === 'unread' && <UnreadBody s={s} ctx={detailCtx} />}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
