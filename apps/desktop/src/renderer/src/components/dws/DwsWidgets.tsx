/**
 * 钉钉组件板（灵动岛数据面的卡片视图）：今日日程 / 待我审批 / 我的待办 / 未读消息。
 * 数据全部来自主进程聚合器 push（window.fundet.onDwsWidgetsChanged），组件自身不轮询。
 * 只读展示 + AI 钩子：所有「处理」动作都走 onAskAgent 预填新会话（写操作过 Agent 命令确认闸），
 * 本组件不执行任何 dws 写命令。
 */
import { useCallback, useEffect, useState } from 'react';
import {
  CalendarDays,
  CheckSquare,
  Inbox,
  MessageSquare,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import type { DwsWidgetsSnapshot } from '../../../../shared/fundet-api.js';
import { cn } from '../../lib/cn';

const CARD = 'rounded-container border border-board bg-card p-4 select-none';

function fmtTime(ms: number | null | undefined): string {
  if (!ms) return '';
  return new Date(ms).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function fmtAgo(ms: number | null | undefined): string {
  if (!ms) return '';
  const diff = Date.now() - ms;
  if (diff < 60_000) return '刚刚';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
  return `${Math.floor(diff / 86400_000)} 天前`;
}

function ErrorTag({ error }: { error?: string }): React.JSX.Element | null {
  if (!error) return null;
  return (
    <span className="rounded-full bg-hover-soft px-1.5 py-0.5 text-11 text-error" title={error}>
      刷新失败
    </span>
  );
}

interface CardShellProps {
  title: string;
  Icon: typeof CalendarDays;
  badge?: number;
  error?: string;
  onAsk?: () => void;
  askLabel?: string;
  empty: string;
  children?: React.ReactNode;
}

function CardShell({ title, Icon, badge, error, onAsk, askLabel, empty, children }: CardShellProps): React.JSX.Element {
  return (
    <div className={cn(CARD, 'flex min-w-0 flex-col')}>
      <div className="flex items-center gap-2">
        <Icon size={14} className="shrink-0 text-secondary" />
        <span className="text-13 font-medium text-primary">{title}</span>
        {typeof badge === 'number' && badge > 0 && (
          <span className="rounded-full bg-accent px-1.5 py-0.5 text-11 font-medium text-accent-fg">{badge}</span>
        )}
        <ErrorTag error={error} />
        <span className="flex-1" />
        {onAsk && (
          <button
            type="button"
            className="flex h-6 items-center gap-1 rounded-full px-2 text-11 text-secondary transition-colors hover:bg-hover hover:text-primary"
            onClick={onAsk}
          >
            <Sparkles size={11} />
            {askLabel ?? '交给智能体'}
          </button>
        )}
      </div>
      <div className="mt-2 flex min-h-0 flex-1 flex-col gap-1.5">
        {children ?? <p className="text-12 text-muted">{empty}</p>}
      </div>
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
  const nextEvent = s.calendar.find((e) => (e.startMs ?? 0) > Date.now()) ?? s.calendar[0];

  const ask = useCallback((prompt: string) => onAskAgent?.(prompt), [onAskAgent]);

  return (
    <div className="w-full">
      <div className="mb-2 flex items-center gap-2 select-none">
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
        <CardShell
          title="今日日程"
          Icon={CalendarDays}
          error={s.errors.calendar}
          empty="今天没有日程"
          onAsk={
            nextEvent
              ? () =>
                  ask(
                    `帮我准备接下来的钉钉会议「${nextEvent.title}」${nextEvent.roomName ? `（会议室：${nextEvent.roomName}）` : ''}${
                      nextEvent.startMs ? `，${fmtTime(nextEvent.startMs)} 开始` : ''
                    }${nextEvent.organizer ? `，组织者 ${nextEvent.organizer}` : ''}。先收集背景，给我一页议题和需要准备的材料清单。`,
                  )
              : undefined
          }
        >
          {s.calendar.map((e) => {
            const upcoming = (e.startMs ?? 0) > Date.now();
            return (
              <div
                key={e.id}
                className={cn(
                  'flex min-w-0 items-baseline gap-2 text-12',
                  upcoming ? 'text-primary' : 'text-muted',
                )}
              >
                <span className="w-11 shrink-0 tabular-nums text-secondary">{fmtTime(e.startMs)}</span>
                <span className="min-w-0 truncate" title={e.title}>
                  {e.title}
                </span>
                {e.roomName && <span className="shrink-0 text-11 text-muted">📍{e.roomName}</span>}
                {!e.roomName && e.location && <span className="shrink-0 text-11 text-muted">{e.location}</span>}
              </div>
            );
          })}
        </CardShell>

        <CardShell
          title="待我审批"
          Icon={Inbox}
          badge={s.approvals.length}
          error={s.errors.approvals}
          empty="没有待审批"
          onAsk={
            s.approvals.length > 0
              ? () =>
                  ask(
                    `我钉钉上有 ${s.approvals.length} 条待审批：${s.approvals
                      .map((a) => `${a.title ?? '审批单'}${a.initiator ? `（${a.initiator} 发起）` : ''}`)
                      .join('、')}。逐条拉详情，给我每条的建议（同意/拒绝）和理由，先别提交，等我确认。`,
                  )
              : undefined
          }
        >
          {s.approvals.map((a) => (
            <div key={a.id} className="flex min-w-0 items-baseline gap-2 text-12 text-primary">
              <span className="min-w-0 truncate" title={a.title}>
                {a.title ?? '审批单'}
              </span>
              {a.initiator && <span className="shrink-0 text-11 text-muted">{a.initiator}</span>}
            </div>
          ))}
        </CardShell>

        <CardShell
          title="我的待办"
          Icon={CheckSquare}
          badge={s.todos.length}
          error={s.errors.todos}
          empty="没有待办"
          onAsk={
            s.todos.length > 0
              ? () =>
                  ask(
                    `帮我处理钉钉待办：${s.todos.map((t) => t.subject).join('、')}。逐条判断需要我做什么，能代办的就直接办（用 dws），办不了的给我行动建议。`,
                  )
              : undefined
          }
        >
          {s.todos.map((t) => {
            const overdue = t.dueMs !== null && t.dueMs < Date.now();
            return (
              <div key={t.taskId} className="flex min-w-0 items-baseline gap-2 text-12 text-primary">
                <span className="min-w-0 truncate" title={t.subject}>
                  {t.subject}
                </span>
                {t.dueMs !== null && (
                  <span className={cn('shrink-0 text-11', overdue ? 'text-error' : 'text-muted')}>
                    {overdue ? '已逾期' : fmtTime(t.dueMs)}
                  </span>
                )}
              </div>
            );
          })}
        </CardShell>

        <CardShell
          title="未读消息"
          Icon={MessageSquare}
          badge={s.unreadTotal}
          error={s.errors.unread}
          empty="没有未读"
          onAsk={
            s.unread.length > 0
              ? () =>
                  ask(
                    `帮我总结钉钉未读消息，重点是这几个会话：${s.unread
                      .map((c) => `「${c.title}」（${c.unread} 条）`)
                      .join('、')}。各拉最近的消息，汇总成要点给我。`,
                  )
              : undefined
          }
        >
          {s.unread.map((c) => (
            <div key={c.id} className="flex min-w-0 items-baseline gap-2 text-12 text-primary">
              <span className="min-w-0 truncate" title={c.title}>
                {c.title}
              </span>
              <span className="shrink-0 tabular-nums text-11 text-muted">{c.unread}</span>
            </div>
          ))}
        </CardShell>
      </div>
    </div>
  );
}
