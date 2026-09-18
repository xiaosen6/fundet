/**
 * 钉钉组件板（高级版）：今日日程 / 待我审批 / 我的待办 / 未读消息。
 *
 * 设计语言（对齐 Cindy 卡片体系）：
 * - 每卡一个 hero：日程=下一场（倒计时呼吸态/临场高亮），待办/未读/审批=大数字
 * - 头部图标坐彩色 chip；AI 钩子按钮卡片 hover 时浮现（focus-visible 常显保可达性）
 * - 卡片交错上浮入场（fundet-rise-in + 60ms 步进；reduced-motion 全局闸直切）
 * - 行 hover 柔和底色；数据只读，一切动作走 onAskAgent 预填会话
 */
import type { DwsWidgetsSnapshot } from '../../../../shared/fundet-api.js';
import { cn } from '../../lib/cn';
import {
  CalendarDays,
  CheckSquare,
  Inbox,
  MapPin,
  MessageSquare,
  RefreshCw,
  Sparkles,
  User,
} from 'lucide-react';

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

/** 倒计时文案 + 档位：进行中（呼吸）/ 15 分钟内（强调）/ 更远（中性） */
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

interface CardShellProps {
  title: string;
  Icon: typeof CalendarDays;
  badge?: number;
  error?: string;
  onAsk?: () => void;
  askLabel?: string;
  /** 交错入场步进 */
  index: number;
  children: React.ReactNode;
}

function CardShell({ title, Icon, badge, error, onAsk, askLabel = '交给智能体', index, children }: CardShellProps): React.JSX.Element {
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
            {askLabel}
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

export interface DwsWidgetsProps {
  snapshot: DwsWidgetsSnapshot | null;
  /** AI 钩子：预填新会话（ChatPage 侧实现 createSession + setInput） */
  onAskAgent?: (prompt: string) => void;
  /** 手动刷新 */
  onRefresh?: () => void;
}

export function DwsWidgets({ snapshot, onAskAgent, onRefresh }: DwsWidgetsProps): React.JSX.Element | null {
  if (!snapshot || snapshot.state !== 'ready') return null;
  const s = snapshot;
  const now = Date.now();
  const nextEvent = s.calendar.find((e) => (e.startMs ?? Infinity) > now) ?? s.calendar[0];
  const overdueCount = s.todos.filter((t) => t.dueMs !== null && t.dueMs < now).length;

  return (
    <div className="w-full">
      <div className="mb-2.5 flex items-center gap-2 select-none">
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
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* ── 今日日程：hero = 下一场 ── */}
        <CardShell
          title="今日日程"
          Icon={CalendarDays}
          error={s.errors.calendar}
          index={0}
          onAsk={
            nextEvent
              ? () =>
                  onAskAgent?.(
                    `帮我准备接下来的钉钉会议「${nextEvent.title}」${nextEvent.roomName ? `（会议室：${nextEvent.roomName}）` : ''}${
                      nextEvent.startMs ? `，${fmtTime(nextEvent.startMs)} 开始` : ''
                    }${nextEvent.organizer ? `，组织者 ${nextEvent.organizer}` : ''}。先收集背景，给我一页议题和需要准备的材料清单。`,
                  )
              : undefined
          }
        >
          {nextEvent ? (
            <>
              <div className="rounded-inner bg-card-ivory px-3.5 py-3">
                <div className="flex items-center gap-2">
                  {nextEvent.startMs !== null && (() => {
                    const c = countdown(nextEvent.startMs, now);
                    return (
                      <span
                        className={cn(
                          'flex h-5 items-center gap-1.5 rounded-full px-2 text-11 font-medium',
                          TONE_CLASS[c.tone],
                        )}
                      >
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
              {s.calendar.length > 1 && (
                <div className="mt-1.5 flex flex-col">
                  {s.calendar
                    .filter((e) => e.id !== nextEvent.id)
                    .map((e) => (
                      <div key={e.id} className="flex min-w-0 items-center gap-2.5 rounded-inner px-1 py-1.5 transition-colors hover:bg-hover-soft">
                        <span className="w-10 shrink-0 text-right text-12 tabular-nums text-secondary">{fmtTime(e.startMs)}</span>
                        <span className="h-1 w-1 shrink-0 rounded-full bg-board" />
                        <span className="min-w-0 truncate text-12 text-primary" title={e.title}>
                          {e.title}
                        </span>
                      </div>
                    ))}
                </div>
              )}
            </>
          ) : (
            <EmptyState Icon={CalendarDays} text="今天没有日程" />
          )}
        </CardShell>

        {/* ── 待我审批：hero = 数量 ── */}
        <CardShell
          title="待我审批"
          Icon={Inbox}
          error={s.errors.approvals}
          index={1}
          onAsk={
            s.approvals.length > 0
              ? () =>
                  onAskAgent?.(
                    `我钉钉上有 ${s.approvals.length} 条待审批：${s.approvals
                      .map((a) => `${a.title ?? '审批单'}${a.initiator ? `（${a.initiator} 发起）` : ''}`)
                      .join('、')}。逐条拉详情，给我每条的建议（同意/拒绝）和理由，先别提交，等我确认。`,
                  )
              : undefined
          }
        >
          {s.approvals.length > 0 ? (
            <>
              <p className="flex items-baseline gap-2">
                <span className="text-3xl font-medium leading-none tabular-nums text-primary">{s.approvals.length}</span>
                <span className="text-12 leading-none text-muted">条等你处理</span>
              </p>
              <div className="mt-2.5 flex flex-col">
                {s.approvals.map((a) => (
                  <div key={a.id} className="flex min-w-0 items-center gap-2 rounded-inner px-1 py-1.5 transition-colors hover:bg-hover-soft">
                    <span className="min-w-0 truncate text-13 text-primary" title={a.title}>
                      {a.title ?? '审批单'}
                    </span>
                    {a.initiator && <span className="ml-auto shrink-0 text-11 text-muted">{a.initiator}</span>}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <EmptyState Icon={Inbox} text="没有待审批" />
          )}
        </CardShell>

        {/* ── 我的待办：hero = 数量 + 逾期 ── */}
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
                  const overdue = t.dueMs !== null && t.dueMs < now;
                  return (
                    <div key={t.taskId} className="flex min-w-0 items-center gap-2 rounded-inner px-1 py-1.5 transition-colors hover:bg-hover-soft">
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
                            'ml-auto shrink-0 rounded-full px-1.5 py-px text-11 leading-4 tabular-nums',
                            overdue ? 'bg-hover-soft text-error' : 'bg-chip text-secondary',
                          )}
                        >
                          {overdue ? '逾期' : fmtTime(t.dueMs)}
                        </span>
                      )}
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

        {/* ── 未读消息：hero = 总数 ── */}
        <CardShell
          title="未读消息"
          Icon={MessageSquare}
          error={s.errors.unread}
          index={3}
          onAsk={
            s.unread.length > 0
              ? () =>
                  onAskAgent?.(
                    `帮我总结钉钉未读消息，重点是这几个会话：${s.unread
                      .map((c) => `「${c.title}」（${c.unread} 条）`)
                      .join('、')}。各拉最近的消息，汇总成要点给我。`,
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
                {s.unread.slice(0, 3).map((c) => (
                  <div key={c.id} className="flex min-w-0 items-center gap-2 rounded-inner px-1 py-1.5 transition-colors hover:bg-hover-soft">
                    <span className="min-w-0 truncate text-13 text-primary" title={c.title}>
                      {c.title}
                    </span>
                    <span className="ml-auto shrink-0 rounded-full bg-chip px-1.5 py-px text-11 leading-4 tabular-nums text-secondary">
                      {c.unread > 99 ? '99+' : c.unread}
                    </span>
                  </div>
                ))}
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
