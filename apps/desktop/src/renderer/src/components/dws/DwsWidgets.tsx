/**
 * 钉钉组件板（可下钻版）：今日日程 / 待我审批 / 我的待办 / 未读消息。
 *
 * 交互模型：
 * - 每个条目可点击展开（手风琴，grid-rows 0fr→1fr 高度动画），一次只开一条
 * - 未读会话展开 = 按需拉最近消息（dwsWidgetsDetail IPC，不进轮询）
 * - 日程展开 = 参会人 + 描述；待办展开 = 完整信息；每处都有定向 AI 钩子
 * - 卡片级「交给智能体」保留；组件仍只读，一切写操作走 Agent 命令确认闸
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
    <div className="flex max-h-44 flex-col gap-2 overflow-y-auto py-1">
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
  index: number;
  children: React.ReactNode;
}

function CardShell({ title, Icon, badge, error, onAsk, index, children }: CardShellProps): React.JSX.Element {
  return (
    <div
      className={cn(
        'group animate-fundet-rise-in flex min-h-[170px] min-w-0 flex-col rounded-container border border-board bg-card p-5 select-none',
        'transition-[border-color,box-shadow] duration-[var(--motion-fast)]',
        'hover:border-[var(--input-focus-border)] hover:shadow-[0_2px_8px_rgba(0,0,0,0.05)]',
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
          <span className="rounded-full bg-hover-soft px-1.5 py-px text-11 text-error" title={error}>
            刷新失败
          </span>
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
      <div className="mt-3 flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}

function EmptyState({ Icon, text }: { Icon: typeof CalendarDays; text: string }): React.JSX.Element {
  return (
    <div className="flex flex-1 items-center gap-2 py-5 text-12 text-muted">
      <Icon size={14} strokeWidth={1.8} />
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
  onClick: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-expanded={open}
      className={cn(
        'flex w-full min-w-0 items-center gap-2 rounded-inner px-1 py-1 text-left',
        'transition-[background-color,transform] duration-[var(--motion-fast)]',
        'hover:bg-hover-soft hover:translate-x-0.5',
      )}
      onClick={onClick}
    >
      {children}
      <ChevronRight
        size={12}
        className={cn(
          'ml-auto shrink-0 text-muted transition-transform duration-[var(--motion-fast)]',
          open && 'rotate-90',
        )}
      />
    </button>
  );
}

export interface DwsWidgetsProps {
  snapshot: DwsWidgetsSnapshot | null;
  onAskAgent?: (prompt: string) => void;
  onRefresh?: () => void;
}

export function DwsWidgets({ snapshot, onAskAgent, onRefresh }: DwsWidgetsProps): React.JSX.Element | null {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  if (!snapshot || snapshot.state !== 'ready') return null;
  const s = snapshot;
  const now = Date.now();
  const nextEvent = s.calendar.find((e) => (e.startMs ?? Infinity) > now) ?? s.calendar[0];
  const overdueCount = s.todos.filter((t) => t.dueMs !== null && t.dueMs < now).length;
  const toggle = (key: string): void => setExpandedKey((k) => (k === key ? null : key));

  return (
    <div className="w-full">
      <div className="mb-2.5 flex items-center gap-2 select-none">
        <span className="text-12 font-medium text-secondary">钉钉 · 今日</span>
        <span className="text-11 text-muted">更新于 {fmtAgo(s.fetchedAt)} · 点条目可展开</span>
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
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* ── 今日日程 ── */}
        <CardShell
          title="今日日程"
          Icon={CalendarDays}
          error={s.errors.calendar}
          index={0}
        >
          {nextEvent ? (
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
              <div className="mt-1.5 flex flex-col">
                {s.calendar.map((e) => {
                  const key = `cal:${e.id}`;
                  const open = expandedKey === key;
                  const isNext = e.id === nextEvent.id;
                  return (
                    <div key={e.id}>
                      <RowButton open={open} onClick={() => toggle(key)}>
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
                              onAskAgent?.(
                                `帮我准备钉钉会议「${e.title}」${e.roomName ? `（会议室：${e.roomName}）` : ''}${
                                  e.startMs ? `，${fmtTime(e.startMs)} 开始` : ''
                                }${e.attendees.length > 0 ? `，参会人：${e.attendees.join('、')}` : ''}。收集背景，给我议题和材料清单。`,
                              )
                            }
                          />
                        </div>
                      </Reveal>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <EmptyState Icon={CalendarDays} text="今天没有日程" />
          )}
        </CardShell>

        {/* ── 待我审批 ── */}
        <CardShell title="待我审批" Icon={Inbox} error={s.errors.approvals} index={1}>
          {s.approvals.length > 0 ? (
            <>
              <p className="flex items-baseline gap-2">
                <span className="text-3xl font-medium leading-none tabular-nums text-primary">{s.approvals.length}</span>
                <span className="text-12 leading-none text-muted">条等你处理</span>
              </p>
              <div className="mt-2.5 flex flex-col">
                {s.approvals.map((a) => {
                  const key = `oa:${a.id}`;
                  const open = expandedKey === key;
                  return (
                    <div key={a.id}>
                      <RowButton open={open} onClick={() => toggle(key)}>
                        <span className="min-w-0 truncate text-13 text-primary" title={a.title}>
                          {a.title ?? '审批单'}
                        </span>
                        {a.initiator && <span className="shrink-0 text-11 text-muted">{a.initiator}</span>}
                      </RowButton>
                      <Reveal open={open}>
                        <div className="rounded-inner bg-hover-soft/60 px-2.5 py-2">
                          {a.createTimeMs && <p className="text-12 text-muted">发起于 {fmtAgo(a.createTimeMs)}</p>}
                          <AskChip
                            label="拉详情给意见"
                            onClick={() =>
                              onAskAgent?.(
                                `拉取钉钉审批单「${a.title ?? a.id}」的详情，给我建议（同意/拒绝）和理由，先别提交。`,
                              )
                            }
                          />
                        </div>
                      </Reveal>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <EmptyState Icon={Inbox} text="没有待审批" />
          )}
        </CardShell>

        {/* ── 我的待办 ── */}
        <CardShell
          title="我的待办"
          Icon={CheckSquare}
          error={s.errors.todos}
          index={2}
          onAsk={
            s.todos.length > 0
              ? () =>
                  onAskAgent?.(
                    `帮我处理钉钉待办：${s.todos.map((t) => t.subject).join('、')}。逐条判断需要我做什么，能代办的就直接办（用 dws），办不了的给我行动建议。`,
                  )
              : undefined
          }
        >
          {s.todos.length > 0 ? (
            <>
              <p className="flex items-baseline gap-2">
                <span className="text-3xl font-medium leading-none tabular-nums text-primary">{s.todos.length}</span>
                <span className="text-12 leading-none text-muted">项待办</span>
                {overdueCount > 0 && (
                  <span className="ml-1 rounded-full bg-hover-soft px-1.5 py-px text-11 leading-4 text-error">{overdueCount} 项逾期</span>
                )}
              </p>
              <div className="mt-2.5 flex flex-col">
                {s.todos.slice(0, 3).map((t) => {
                  const key = `todo:${t.taskId}`;
                  const open = expandedKey === key;
                  const overdue = t.dueMs !== null && t.dueMs < now;
                  return (
                    <div key={t.taskId}>
                      <RowButton open={open} onClick={() => toggle(key)}>
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
                              onAskAgent?.(
                                `帮我处理这条钉钉待办：「${t.subject}」（优先级 ${t.priority}${t.dueMs !== null ? `，截止 ${new Date(t.dueMs).toLocaleString('zh-CN')}` : ''}）。判断需要做什么，能直接办的就办（用 dws），办不了给我行动建议。`,
                              )
                            }
                          />
                        </div>
                      </Reveal>
                    </div>
                  );
                })}
                {s.todos.length > 3 && (
                  <p className="px-1 pt-1 text-11 text-muted">还有 {s.todos.length - 3} 项…</p>
                )}
              </div>
            </>
          ) : (
            <EmptyState Icon={CheckSquare} text="没有待办" />
          )}
        </CardShell>

        {/* ── 未读消息 ── */}
        <CardShell
          title="未读消息"
          Icon={MessageSquare}
          error={s.errors.unread}
          index={3}
          onAsk={
            s.unread.length > 0
              ? () =>
                  onAskAgent?.(
                    `帮我总结钉钉未读消息，重点是这几个会话：${s.unread.map((c) => `「${c.title}」（${c.unread} 条）`).join('、')}。各拉最近的消息，汇总成要点给我。`,
                  )
              : undefined
          }
        >
          {s.unread.length > 0 ? (
            <>
              <p className="flex items-baseline gap-2">
                <span className="text-3xl font-medium leading-none tabular-nums text-primary">{s.unreadTotal}</span>
                <span className="text-12 leading-none text-muted">条未读 · 来自 {s.unread.length} 个会话</span>
              </p>
              <div className="mt-2.5 flex flex-col">
                {s.unread.slice(0, 3).map((c) => {
                  const key = `unread:${c.id}`;
                  const open = expandedKey === key;
                  return (
                    <div key={c.id}>
                      <RowButton open={open} onClick={() => toggle(key)}>
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
                      <Reveal open={open}>
                        <div className="rounded-inner bg-hover-soft/60 px-2.5 py-2">
                          <UnreadDetail convId={c.id} />
                          <AskChip
                            label="总结这个会话"
                            onClick={() =>
                              onAskAgent?.(
                                `总结钉钉会话「${c.title}」的最近消息（约 ${c.unread} 条未读），给我要点和需要我回应的事项。`,
                              )
                            }
                          />
                        </div>
                      </Reveal>
                    </div>
                  );
                })}
                {s.unread.length > 3 && (
                  <p className="px-1 pt-1 text-11 text-muted">还有 {s.unread.length - 3} 个会话…</p>
                )}
              </div>
            </>
          ) : (
            <EmptyState Icon={MessageSquare} text="没有未读" />
          )}
        </CardShell>
      </div>
    </div>
  );
}
