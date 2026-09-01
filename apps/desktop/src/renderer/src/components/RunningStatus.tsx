/**
 * RunningStatus —— composer 上方的运行状态行（复刻 Cindy RunningStatusBar 的简化版）。
 *
 * 两段式：左 = Sparkles 14 + 状态文案（Thinking Orange --warning，text-13 font-medium），
 * 右 = 计时 · tokens（--text-secondary）。
 * 呼吸 = cadenced 一次性动画（DESIGN.md §14.4）：状态文案 / token 计数有真实动静时
 * key 重挂载播一次 1.5s 下潜（1→0.45→1，steps(18)），静默期常亮不动。
 * 结束时 linger 1s 再 400ms 淡出，然后卸载（不占 composer 上方空行）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, Check, Sparkles } from 'lucide-react';
import { cn } from '../lib/cn';
import { useReducedMotion } from '../hooks/useReducedMotion';

const FADE_MS = 400;

interface RunningStatusProps {
  visible: boolean;
  status: string;
  tokenUsage: number;
}

export function RunningStatus({ visible, status, tokenUsage }: RunningStatusProps): React.JSX.Element | null {
  const reducedMotion = useReducedMotion();
  const [showContent, setShowContent] = useState(visible);
  const [fading, setFading] = useState(false);

  // 结束：满亮停留 1s → 淡出 → 卸载
  useEffect(() => {
    if (visible) {
      setShowContent(true);
      setFading(false);
      return undefined;
    }
    const lingerTimer = setTimeout(() => setFading(true), 1000);
    const hideTimer = setTimeout(() => setShowContent(false), 1000 + FADE_MS);
    return () => {
      clearTimeout(lingerTimer);
      clearTimeout(hideTimer);
    };
  }, [visible]);

  // 本地计时（isRunning 翻 true 时锚定起点）
  const [elapsed, setElapsed] = useState(0);
  const startedAtRef = useRef<number | null>(null);
  useEffect(() => {
    if (!visible) {
      startedAtRef.current = null;
      setElapsed(0);
      return undefined;
    }
    startedAtRef.current = Date.now();
    setElapsed(0);
    const interval = setInterval(() => {
      if (startedAtRef.current) {
        setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [visible]);

  // cadenced shimmer：每次真实动静（状态文案 / token 变化）重播一次呼吸；
  // 播放期间到达的动静置 pending，动画结束再连播一次
  const [shimmerCycle, setShimmerCycle] = useState(0);
  const shimmerPlayingRef = useRef(false);
  const shimmerPendingRef = useRef(false);
  const handleShimmerEnd = useCallback(() => {
    shimmerPlayingRef.current = false;
    if (shimmerPendingRef.current) {
      shimmerPendingRef.current = false;
      shimmerPlayingRef.current = true;
      setShimmerCycle((n) => n + 1);
    }
  }, []);
  useEffect(() => {
    if (!visible || reducedMotion) {
      shimmerPlayingRef.current = false;
      shimmerPendingRef.current = false;
      return;
    }
    if (shimmerPlayingRef.current) {
      shimmerPendingRef.current = true;
      return;
    }
    shimmerPlayingRef.current = true;
    setShimmerCycle((n) => n + 1);
  }, [visible, reducedMotion, status, tokenUsage]);

  if (!showContent && !visible) return null;

  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  const elapsedText = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
  const tokenText =
    tokenUsage >= 1000 ? `${(tokenUsage / 1000).toFixed(1)}k tokens` : `${tokenUsage} tokens`;

  // Done 态换 Check 图标（对齐 Cindy RunningStatusBar：运行=Sparkles 橙，完成=✓）
  const isDone = status === 'Done' && !visible;

  const hidden = !showContent && !visible;
  const fadeStyle: React.CSSProperties = {
    visibility: hidden ? 'hidden' : 'visible',
    opacity: hidden || fading ? 0 : 1,
    transition: hidden ? 'none' : `opacity ${FADE_MS}ms ease-out`,
    pointerEvents: hidden ? 'none' : 'auto',
  };

  return (
    <div className="grid select-none grid-cols-[minmax(0,1fr)_auto] items-center px-2 py-[6px]">
      <div
        key={shimmerCycle}
        onAnimationEnd={handleShimmerEnd}
        className={cn('flex min-w-0 items-center gap-[6px]', !hidden && visible && !reducedMotion && 'status-bar-shimmer')}
        style={{ ...fadeStyle, color: 'var(--warning)' }}
        aria-hidden={hidden}
      >
        {/* -translate-y-px：lucide Sparkles 视觉重心偏低，上移 1px 对齐文字基线 */}
        {isDone ? (
          <Check size={14} strokeWidth={2.5} className="shrink-0" />
        ) : (
          <Sparkles size={14} className="shrink-0 -translate-y-px" />
        )}
        <span className="truncate text-13 font-medium">{status || 'Working…'}</span>
      </div>
      <div
        className="flex min-w-0 items-center justify-self-end gap-[6px]"
        style={fadeStyle}
        aria-hidden={hidden}
      >
        <span className="text-13 font-medium text-secondary">{elapsedText}</span>
        <span className="text-13 font-medium text-secondary">&middot;</span>
        <ArrowDown size={13} className="shrink-0 text-secondary" />
        <span className="text-13 font-medium text-secondary">{tokenText}</span>
      </div>
    </div>
  );
}
