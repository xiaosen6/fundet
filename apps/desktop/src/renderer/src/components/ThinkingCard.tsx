/**
 * ThinkingCard —— 思考块（复刻 Cindy components/chat/ThinkingCard.tsx 的解剖）。
 *
 * 视觉契约：无卡片边框 —— header 行（sparkles 14 + 摘要 text-14 + 尾部 chevron，
 * 同色 --text-secondary）；展开体为 2px 左竖线（--agent-rail）+ 斜体正文
 * （--text-muted，比标题淡一档）。默认折叠，进行中 header 带三点波浪 + 计时。
 * 展开/收起走 Collapse（grid 0fr↔1fr，200ms ease-move）。
 */
import { useState } from 'react';
import { ChevronRight, Sparkles } from 'lucide-react';
import { cn } from '../lib/cn';
import { Collapse } from './ui/Collapse';

interface ThinkingCardProps {
  text: string;
  running: boolean;
  durationMs?: number;
}

/** ms → `Xs` / `Xm Ys`（对齐 Cindy formatDuration 的显示约定） */
export function formatDuration(ms: number): string {
  const totalSec = Math.max(1, Math.round(ms / 1000));
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

export function ThinkingCard({ text, running, durationMs }: ThinkingCardProps): React.JSX.Element {
  const [userExpanded, setUserExpanded] = useState(false);
  // 生成中锁定展开（CDS ThinkingAccordion 互斥）：流式内容强制可见不可收起；
  // 结束后回到用户偏好（此前手风琴里长文一路「藏着流」看不到进度）
  const effectiveExpanded = running || userExpanded;

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={() => {
          if (running) return;
          setUserExpanded((v) => !v);
        }}
        aria-expanded={effectiveExpanded}
        aria-disabled={running}
        className={cn(
          'flex w-full items-center gap-[6px] py-[2px]',
          'cursor-pointer text-left select-none',
          'transition-opacity hover:opacity-80',
          running && 'cursor-default hover:opacity-100',
        )}
      >
        <span className="inline-flex h-[1lh] shrink-0 items-center">
          <Sparkles size={14} className="text-secondary" />
        </span>
        <span className="translate-y-[1px] text-14 text-secondary">
          {running ? '思考中' : durationMs !== undefined ? `已思考 ${formatDuration(durationMs)}` : '已完成思考'}
        </span>
        {running && (
          <div className="flex translate-y-[2px] items-center gap-[3px]">
            <span className="thinking-dot thinking-dot-1" />
            <span className="thinking-dot thinking-dot-2" />
            <span className="thinking-dot thinking-dot-3" />
          </div>
        )}
        <div className="flex-1" />
        <ChevronRight
          size={14}
          className={cn(
            'shrink-0 text-secondary',
            'transition-transform duration-[var(--motion-fast,150ms)]',
            effectiveExpanded && 'rotate-90',
          )}
        />
      </button>

      <Collapse open={effectiveExpanded}>
        <div className="mt-1 border-l-2 border-rail py-[6px] pl-3 select-text">
          {text ? (
            <p className="text-14 leading-[1.6] whitespace-pre-wrap italic text-muted">{text}</p>
          ) : (
            <p className="text-14 leading-[1.6] italic text-muted opacity-70">（没有捕获到思考内容）</p>
          )}
        </div>
      </Collapse>
    </div>
  );
}
