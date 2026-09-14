/**
 * Tooltip — 悬停提示（替代原生 title 的系统样式，对齐 Cindy 手感）。
 * 悬停 ~450ms 出现，CINDY 卡片样式；支持多行（whitespace-pre-line）。
 * 键盘焦点也会触发（focus/blur 与 hover 同口径）。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { useReducedMotion } from '../../hooks/useReducedMotion';

const SHOW_DELAY_MS = 450;

export function Tooltip({
  label,
  children,
  side = 'bottom',
  disabled,
  className,
}: {
  label: string;
  children: ReactNode;
  side?: 'top' | 'bottom';
  disabled?: boolean;
  /** 追加到气泡上的类（如限制宽度） */
  className?: string;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const timerRef = useRef<number | null>(null);
  const reduced = useReducedMotion();

  const show = (): void => {
    if (disabled) return;
    if (timerRef.current !== null) return;
    timerRef.current = window.setTimeout(() => setOpen(true), SHOW_DELAY_MS);
  };
  const hide = (): void => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setOpen(false);
  };
  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {open && (
        <span
          role="tooltip"
          className={cn(
            'pointer-events-none absolute left-1/2 z-50 w-max max-w-[280px] -translate-x-1/2 whitespace-pre-line rounded-lg border border-board bg-card px-2 py-1 text-center text-12 leading-[1.5] text-secondary shadow-[var(--shadow-menu)] select-none',
            side === 'bottom' ? 'top-full mt-1.5' : 'bottom-full mb-1.5',
            !reduced && 'animate-[tooltip-in_120ms_ease-out]',
            className,
          )}
        >
          {label}
        </span>
      )}
    </span>
  );
}
