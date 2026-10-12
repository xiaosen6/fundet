/**
 * ContextCapacityRing — Cindy 式 20px 上下文占用圆环 + 百分比。
 * 窗口未知时画空轨，不假装 128k。
 * onCompact 提供时圆环可点击（Cindy 同款：hover 75% / active 60% 透明度，
 * tooltip 多一行「点击压缩上下文」提示）——点击后由上层弹确认框再走
 * SESSION_COMPACT（pi 原生 compact）。
 */
import { formatTokenCount } from '../../../shared/context-window.js';

interface ContextCapacityRingProps {
  contextTokens: number;
  contextWindow: number;
  /** 提供时圆环可点击 — 点击后（经用户确认）压缩上下文 */
  onCompact?: () => void;
}

export function ContextCapacityRing({
  contextTokens,
  contextWindow,
  onCompact,
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
  const usageLine =
    contextWindow > 0
      ? `上下文 ${formatTokenCount(used)} / ${formatTokenCount(contextWindow)}（${pct}%）`
      : '还没有上下文窗口数据';
  const title = onCompact ? `${usageLine}\n点击压缩上下文` : usageLine;

  const ringContent = (
    <>
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
    </>
  );

  if (onCompact) {
    return (
      <button
        type="button"
        onClick={onCompact}
        title={title}
        aria-label={usageLine}
        className="flex shrink-0 cursor-pointer items-center gap-1 transition-opacity hover:opacity-75 active:opacity-60"
      >
        {ringContent}
      </button>
    );
  }
  return (
    <div
      className="flex shrink-0 items-center gap-1 select-none"
      title={title}
      aria-label={usageLine}
    >
      {ringContent}
    </div>
  );
}
