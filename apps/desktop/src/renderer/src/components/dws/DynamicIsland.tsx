/**
 * 灵动岛：会话视图顶部的钉钉状态悬浮条。
 * 收起 = 一粒胶囊（下一会议倒计时 + 待办/审批/未读角标）；点击展开 = 组件板。
 * 动效走 --motion-morph（220ms 容器变换例外档），compositor-only；reduced-motion 直切。
 * 组件板数据面（DwsWidgets）复用，本组件只负责胶囊形态与展开交互。
 */
import { useEffect, useRef, useState } from 'react';
import { CalendarDays, ChevronDown, X } from 'lucide-react';
import type { DwsWidgetsSnapshot } from '../../../../shared/fundet-api.js';
import { cn } from '../../lib/cn';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { DwsWidgets } from './DwsWidgets';

function fmtCountdown(ms: number): string {
  const diff = ms - Date.now();
  if (diff <= 0) return '进行中';
  if (diff < 3600_000) return `${Math.max(1, Math.round(diff / 60_000))} 分钟后`;
  return `${Math.floor(diff / 3600_000)} 小时后`;
}

export interface DynamicIslandProps {
  snapshot: DwsWidgetsSnapshot | null;
  onAskAgent?: (prompt: string) => void;
  onRefresh?: () => void;
  /** 岛只挂在会话视图；欢迎页组件板直接可见时外层传 false 隐藏 */
  visible: boolean;
}

export function DynamicIsland({ snapshot, onAskAgent, onRefresh, visible }: DynamicIslandProps): React.JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const reducedMotion = useReducedMotion();
  const rootRef = useRef<HTMLDivElement | null>(null);

  // 倒计时每 30s 自更新
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // 展开态点外部收起
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  if (!visible || !snapshot || snapshot.state !== 'ready') return null;
  const s = snapshot;
  const nextEvent = s.calendar.find((e) => (e.startMs ?? 0) > now) ?? s.calendar[0];
  const todoCount = s.todos.length;
  const approvalCount = s.approvals.length;
  const hasSignal = Boolean(nextEvent) || todoCount > 0 || approvalCount > 0 || s.unreadTotal > 0;
  if (!hasSignal && !open) return null;

  const badge = (n: number): string => (n > 99 ? '99+' : String(n));

  return (
    <div ref={rootRef} className="pointer-events-none absolute inset-x-0 top-1 z-30 flex justify-center print:hidden">
      <div
        className={cn(
          'pointer-events-auto flex min-w-0 flex-col items-stretch rounded-full border border-board bg-card/95 shadow-sm backdrop-blur',
          open && 'rounded-container',
          !reducedMotion && 'transition-[width,max-height,padding] duration-[var(--motion-morph)] ease-[cubic-bezier(0.2,0,0,1)]',
        )}
      >
        <button
          type="button"
          aria-expanded={open}
          className="flex h-8 min-w-0 items-center gap-2 px-3 text-12 select-none"
          onClick={() => setOpen((v) => !v)}
        >
          {nextEvent ? (
            <>
              <CalendarDays size={13} className="shrink-0 text-secondary" />
              <span className="min-w-0 truncate font-medium text-primary" title={nextEvent.title}>
                {nextEvent.title}
              </span>
              <span className="shrink-0 tabular-nums text-11 text-secondary">
                {nextEvent.startMs !== null ? fmtCountdown(nextEvent.startMs) : ''}
              </span>
            </>
          ) : (
            <span className="font-medium text-primary">钉钉</span>
          )}
          {todoCount > 0 && (
            <span className="shrink-0 rounded-full bg-chip px-1.5 text-11 tabular-nums text-secondary" title="待办">
              待办 {badge(todoCount)}
            </span>
          )}
          {approvalCount > 0 && (
            <span className="shrink-0 rounded-full bg-chip px-1.5 text-11 tabular-nums text-secondary" title="待审批">
              审批 {badge(approvalCount)}
            </span>
          )}
          {s.unreadTotal > 0 && (
            <span className="shrink-0 rounded-full bg-accent px-1.5 text-11 tabular-nums text-accent-fg" title="未读">
              {badge(s.unreadTotal)}
            </span>
          )}
          {open ? (
            <ChevronDown size={13} className="shrink-0 text-muted" />
          ) : (
            <ChevronDown size={13} className="shrink-0 -rotate-90 text-muted" />
          )}
        </button>
        {open && (
          <div className="w-[min(680px,calc(100vw-180px))] px-3 pb-3">
            <DwsWidgets snapshot={s} onAskAgent={onAskAgent} onRefresh={onRefresh} />
            <div className="mt-2 flex justify-end">
              <button
                type="button"
                className="flex h-6 items-center gap-1 rounded-full px-2 text-11 text-muted hover:text-primary"
                onClick={() => setOpen(false)}
              >
                <X size={11} />
                收起
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
