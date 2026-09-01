/**
 * ContextCapacityRing — Cindy 式 20px 上下文占用圆环 + 百分比。
 * 窗口未知时画空轨，不假装 128k。
 */
import { formatTokenCount } from '../../../shared/context-window.js';

interface ContextCapacityRingProps {
  contextTokens: number;
  contextWindow: number;
}

export function ContextCapacityRing({
  contextTokens,
  contextWindow,
}: ContextCapacityRingProps): React.JSX.Element {
  const pct =
    contextWindow > 0
      ? Math.min(Math.max(Math.round((contextTokens / contextWindow) * 100), 0), 100)
      : 0;

  const size = 20;
  const strokeWidth = 2.5;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (circumference * pct) / 100;
  const fillColor = pct > 90 ? 'var(--error-fg)' : pct > 70 ? 'var(--warning)' : 'var(--text-muted)';
  const used = Math.min(contextTokens, contextWindow || Infinity);
  const title =
    contextWindow > 0
      ? `上下文 ${formatTokenCount(used)} / ${formatTokenCount(contextWindow)}（${pct}%）`
      : '还没有上下文窗口数据';

  return (
    <div
      className="flex shrink-0 items-center gap-1 select-none"
      title={title}
      aria-label={title}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="shrink-0"
        aria-hidden="true"
        focusable="false"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--board)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={fillColor}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="text-12 font-medium leading-none" style={{ color: fillColor }}>
        {pct}%
      </span>
    </div>
  );
}
