/**
 * MessageNavigator — 消息导航器（对齐 Cindy minimap）。
 *
 * 收起态：消息流右缘垂直居中的细列，每条 user 消息一根小横线（w-5 h-[3px]），
 * 纵向位置按该消息在虚拟行中的相对位置百分比映射；当前视口所处的那条
 * （≤视口末行的最后一条 user 消息）高亮 accent，其余 muted/40。
 * 悬停细列/浮层 → 展开消息列表浮层（左侧预览文本 + 右侧横线，当前项 accent），
 * 点击跳到对应消息；鼠标移出 150ms 后收起，无点击外部关闭（Cindy 移出即收）。
 *
 * 细列上的滚轮转发回消息流容器（右缘是去滚动条的必经之路，不能变成滚动死区）。
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../lib/cn';
import { minimapMarks } from '../lib/messageNavigator';

export interface NavigatorEntry {
  /** 虚拟行 index（user 消息所在行） */
  index: number;
  /** 一行截断预览文本 */
  preview: string;
}

interface MessageNavigatorProps {
  entries: NavigatorEntry[];
  /** 虚拟行总数（含流式伪行） */
  totalRows: number;
  /** 当前高亮的行 index（视口内/上方最近一条 user 消息） */
  activeIndex: number | null;
  onJump: (index: number) => void;
  /** 收起态细列上的滚轮转发（消息流容器消费；展开态浮层自身可滚不转发） */
  onRailWheel: (e: React.WheelEvent) => void;
}

/** 移出后延迟收起（ms）：细列 → 浮层间的指针穿行余量 */
const CLOSE_DELAY_MS = 150;

export const MessageNavigator = memo(function MessageNavigator({
  entries,
  totalRows,
  activeIndex,
  onJump,
  onRailWheel,
}: MessageNavigatorProps): React.JSX.Element {
  const marks = useMemo(
    () => minimapMarks(entries.map((e) => e.index), totalRows),
    [entries, totalRows],
  );
  const [open, setOpen] = useState(false);
  const closeTimerRef = useRef<number | null>(null);
  const cancelClose = (): void => {
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };
  useEffect(() => cancelClose, []);
  const handleEnter = (): void => {
    cancelClose();
    setOpen(true);
  };
  const handleLeave = (): void => {
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  };

  return (
    <div className="pointer-events-none absolute inset-0 z-40">
      {/* 悬停域 = 细列 + 浮层（浮层贴细列左缘挂载，指针在两者间移动不触发 leave）。
          right-2 让出 8px 滚动条，不遮挡滚动条拖拽。 */}
      <div
        className="pointer-events-auto absolute top-1/2 right-2 flex h-[min(360px,65%)] -translate-y-1/2"
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
      >
        <div className="relative h-full w-7" onWheel={onRailWheel}>
          {marks.map((m) => (
            <span
              key={m.index}
              className={cn(
                'absolute right-0 h-[3px] w-5 -translate-y-1/2 rounded-full transition-colors duration-[var(--motion-fast)]',
                m.index === activeIndex ? 'bg-accent' : 'bg-muted/40',
              )}
              style={{ top: `${m.topPercent}%` }}
            />
          ))}
        </div>
        {open && (
          <div className="animate-fade-in absolute top-1/2 right-7 max-h-[min(420px,70vh)] w-[300px] -translate-y-1/2 overflow-y-auto rounded-container border border-board bg-card py-1.5 shadow-[var(--shadow-menu)]">
            {entries.map((e) => (
              <button
                key={e.index}
                type="button"
                onClick={() => {
                  setOpen(false);
                  onJump(e.index);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors duration-[var(--motion-fast)] hover:bg-hover"
              >
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate text-13',
                    e.index === activeIndex ? 'text-accent' : 'text-secondary',
                  )}
                >
                  {e.preview || '（空消息）'}
                </span>
                <span
                  className={cn(
                    'h-[3px] w-5 shrink-0 rounded-full',
                    e.index === activeIndex ? 'bg-accent' : 'bg-muted/40',
                  )}
                />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});
