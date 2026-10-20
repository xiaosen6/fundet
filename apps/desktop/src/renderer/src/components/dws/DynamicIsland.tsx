/**
 * 灵动岛（深度融合版）：不再是悬浮异物，而是会话头部（46px slim header）的
 * 尾部状态簇——安静常驻（muted 文字 + 计数，hover 才浮出胶囊底），点击向下
 * 弹出组件板（float-in 150ms，与菜单/弹层同语言；Esc/点外部收起）。
 * 数据面与欢迎页组件板（DwsWidgets）完全复用。
 */
import { useEffect, useRef, useState } from 'react';
import { CalendarDays, ChevronDown, TriangleAlert } from 'lucide-react';
import type { DwsWidgetsSnapshot } from '../../../../shared/fundet-api.js';
import { cn } from '../../lib/cn';
import { dwsConnectionBroken } from '../../lib/dwsState';
import { DwsWidgets } from './DwsWidgets';

function fmtCountdown(ms: number): string {
  const diff = ms - Date.now();
  if (diff <= 0) return '进行中';
  if (diff < 3600_000) return `${Math.max(1, Math.round(diff / 60_000))} 分钟后`;
  return `${Math.floor(diff / 3600_000)} 小时后`;
}

function badge(n: number): string {
  return n > 99 ? '99+' : String(n);
}

export interface DynamicIslandProps {
  snapshot: DwsWidgetsSnapshot | null;
  onAskAgent?: (prompt: string) => void;
  onRefresh?: () => void;
  onOpenPanel?: () => void;
}

export function DynamicIsland({ snapshot, onAskAgent, onRefresh, onOpenPanel }: DynamicIslandProps): React.JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const rootRef = useRef<HTMLDivElement | null>(null);

  // 倒计时每 30s 自更新
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // 展开态：点外部 / Esc 收起
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!snapshot) return null;
  if (snapshot.state !== 'ready') {
    // 只有「本来能用、现在断了」（过期/授权失效）才亮警示：整颗消失会让用户
    // 以为「今天真没事」。从没装/从没登录属于没配置，静默——否则常驻噪音。
    if (!dwsConnectionBroken(snapshot)) return null;
    const className =
      'flex h-7 items-center gap-1.5 rounded-full bg-hover-soft px-2.5 text-11 text-warning';
    return (
      <div className="mr-3 flex shrink-0 items-center">
        {/* 没有跳转目标就不要做成按钮——点了没反应的按钮比没有按钮更糟
            （AskChip 死按钮是同一类问题） */}
        {onOpenPanel ? (
          <button
            type="button"
            title={snapshot.reason ?? '钉钉连接已失效'}
            className={cn(className, 'transition-colors hover:text-primary')}
            onClick={onOpenPanel}
          >
            <TriangleAlert size={12} className="shrink-0" />
            钉钉未连接
          </button>
        ) : (
          <span title={snapshot.reason ?? '钉钉连接已失效'} className={className}>
            <TriangleAlert size={12} className="shrink-0" />
            钉钉未连接
          </span>
        )}
      </div>
    );
  }
  const s = snapshot;
  const nextEvent = s.calendar.find((e) => (e.startMs ?? Infinity) > now) ?? s.calendar[0];
  const todoCount = s.todos.length;
  const approvalCount = s.approvals.length;
  const hasSignal = Boolean(nextEvent) || todoCount > 0 || approvalCount > 0 || s.unreadTotal > 0;
  if (!hasSignal) return null;

  // mr-3：与右侧 Canvas 固定钮（right-[138px]）拉开呼吸位，不挤其点击热区
  return (
    <div ref={rootRef} className="no-drag relative mr-3 flex shrink-0 items-center">
      <button
        type="button"
        aria-expanded={open}
        title="钉钉 · 今日（点击展开）"
        className={cn(
          'flex h-7 max-w-[420px] items-center gap-2 rounded-full px-2.5 text-12 select-none',
          'text-muted transition-colors duration-[var(--motion-fast)]',
          'hover:bg-hover hover:text-primary',
          open && 'bg-hover text-primary',
        )}
        onClick={() => setOpen((v) => !v)}
      >
        {nextEvent ? (
          <>
            <CalendarDays size={13} className="shrink-0 text-secondary" />
            <span className="min-w-0 truncate font-medium text-primary" title={nextEvent.title}>
              {nextEvent.title}
            </span>
            <span className="shrink-0 tabular-nums text-secondary">
              {nextEvent.startMs !== null ? fmtCountdown(nextEvent.startMs) : ''}
            </span>
          </>
        ) : (
          <span className="font-medium text-primary">钉钉</span>
        )}
        <span className="flex shrink-0 items-center gap-1.5 text-11 tabular-nums">
          {todoCount > 0 && (
            <span className="text-secondary" title="待办">
              待办 {badge(todoCount)}
            </span>
          )}
          {approvalCount > 0 && (
            <span className="text-secondary" title="待审批">
              审批 {badge(approvalCount)}
            </span>
          )}
          {s.unreadTotal > 0 && (
            <span className="rounded-full bg-accent px-1.5 leading-4 text-accent-fg" title="未读">
              {badge(s.unreadTotal)}
            </span>
          )}
        </span>
        <ChevronDown size={12} className={cn('shrink-0 transition-transform duration-[var(--motion-fast)]', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="animate-float-in absolute top-full right-0 z-30 mt-1.5 w-[min(700px,calc(100vw-220px))] rounded-container border border-board bg-card p-4 shadow-sm print:hidden">
          <DwsWidgets snapshot={s} onAskAgent={onAskAgent} onRefresh={onRefresh} onOpenPanel={onOpenPanel} />
        </div>
      )}
    </div>
  );
}
