/**
 * PinnedPlanCard —— 会话右侧的悬浮计划卡（用户拍板：**悬浮**不切分布局、
 * **可收放**——展开是完整清单卡，收起缩成小胶囊，点胶囊再展开）。
 *
 * 形态：absolute 挂消息大容器（relative flex-row）内，与 CanvasPane 同级；
 * 不占布局宽度，展开时若嫌挡内容可收起（胶囊只有一枚小圆钮）。
 * 数据：todo 工具增量确认重放出的最新清单快照（ChatPage 派生传入）。
 * 退场：全部完成且轮次已结束 → 2 秒后整体缩放淡出（完成收场动画）后移除；
 * AI 更新计划内容 = 新计划，重新展开出现。
 * 动效（CDS 交互物理近似，token 化）：打勾弹入（成功确认 pop-in）、收起↔展开
 * 挂载入场、头部进度条（全勾转成功绿）。
 */
import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronUp, Circle, ListTodo } from 'lucide-react';
import { cn } from '../../lib/cn';
import type { TodoEntry } from '../../lib/todoList';

const DONE_LINGER_MS = 2_000;

export function PinnedPlanCard({
  entries,
  running,
}: {
  entries: readonly TodoEntry[];
  /** 当前轮是否仍在跑（全勾但仍在跑不收起——agent 收尾漏勾/自检是常态） */
  running: boolean;
}): React.JSX.Element | null {
  const identity = JSON.stringify(entries.map((e) => [e.id, e.text, e.done]));
  const [collapsed, setCollapsed] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);

  // 上一帧已完成集合：区分「刚打勾」（播弹入）与「本来就该勾」（静默渲染）
  const prevDoneRef = useRef<ReadonlySet<number>>(new Set());
  const justDone = new Set(
    entries.filter((e) => e.done && !prevDoneRef.current.has(e.id)).map((e) => e.id),
  );
  useEffect(() => {
    prevDoneRef.current = new Set(entries.filter((e) => e.done).map((e) => e.id));
  }, [entries]);

  // 新计划（内容变化）：重新出现且展开
  useEffect(() => {
    setCollapsed(false);
    setLeaving(false);
    setGone(false);
    prevDoneRef.current = new Set();
  }, [identity]);

  const allDone = entries.length > 0 && entries.every((e) => e.done);
  useEffect(() => {
    if (!allDone || running) return;
    const t = window.setTimeout(() => setLeaving(true), DONE_LINGER_MS);
    return () => window.clearTimeout(t);
  }, [allDone, running, identity]);

  // 退场动画收口（150ms 动画；onAnimationEnd 为准，这里 250ms 兜底）
  useEffect(() => {
    if (!leaving) return;
    const t = window.setTimeout(() => setGone(true), 250);
    return () => window.clearTimeout(t);
  }, [leaving]);

  if (entries.length === 0 || gone) return null;

  const done = entries.filter((e) => e.done).length;
  const pct = entries.length > 0 ? (done / entries.length) * 100 : 0;
  const leaveClass = leaving ? 'animate-plan-fade-out pointer-events-none' : '';
  const onLeaveEnd = (): void => {
    if (leaving) setGone(true);
  };

  // 收起态：右侧小胶囊（图标 + 进度），点击展开
  if (collapsed) {
    return (
      <button
        type="button"
        aria-label={`展开计划清单（${done}/${entries.length}）`}
        title={`计划清单 ${done}/${entries.length}，点击展开`}
        onClick={() => setCollapsed(false)}
        onAnimationEnd={onLeaveEnd}
        className={cn(
          'animate-plan-pop-in absolute top-16 right-4 z-30 flex h-8 items-center gap-1.5 rounded-full',
          'border border-board bg-card px-3 shadow-[var(--shadow-menu)]',
          'cursor-pointer select-none transition-colors hover:bg-hover',
          leaveClass,
        )}
      >
        <ListTodo size={13} className="text-muted" />
        <span className="text-12 font-medium tabular-nums text-secondary">
          {done}/{entries.length}
        </span>
        <ChevronUp size={13} className="text-muted" />
      </button>
    );
  }

  // 展开态：完整清单卡（头部标题+进度+收起钮，进度条，列表自滚）
  return (
    <div
      onAnimationEnd={onLeaveEnd}
      className={cn(
        'animate-plan-pop-in absolute top-16 right-4 z-30 flex max-h-[60vh] w-[300px] flex-col',
        'rounded-container border border-board bg-card shadow-[var(--shadow-menu)]',
        leaveClass,
      )}
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-board px-3">
        <ListTodo size={14} className="text-muted" />
        <span className="text-13 font-medium text-primary">计划清单</span>
        <span className="ml-auto text-11 tabular-nums text-muted">
          {done}/{entries.length}
        </span>
        <button
          type="button"
          aria-label="收起计划卡"
          title="收起"
          onClick={() => setCollapsed(true)}
          className="shrink-0 rounded p-1 text-secondary transition-colors hover:bg-hover hover:text-primary"
        >
          <ChevronDown size={14} />
        </button>
      </div>
      {/* 进度条：宽随勾选推进；全部完成转成功绿（完成态的视觉收束） */}
      <div className="h-0.5 shrink-0 bg-chip">
        <div
          className={cn(
            'h-full transition-[width] duration-[var(--motion-base)] ease-[var(--motion-ease-move)]',
            allDone ? 'bg-success' : 'bg-accent',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <ul className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-3">
        {entries.map((t) => (
          <li key={t.id} className="flex items-start gap-2">
            {t.done ? (
              <CheckCircle2
                size={15}
                className={cn(
                  'mt-px shrink-0 text-accent',
                  justDone.has(t.id) && 'animate-plan-check-pop',
                )}
              />
            ) : (
              <Circle size={15} className="mt-px shrink-0 text-muted" />
            )}
            <span
              className={
                t.done
                  ? 'min-w-0 break-words text-13 text-muted line-through'
                  : 'min-w-0 break-words text-13 text-primary'
              }
            >
              {t.text}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
