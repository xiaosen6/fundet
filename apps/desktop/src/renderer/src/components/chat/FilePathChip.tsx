/**
 * FilePathChip —— 回复正文里的产物 / 路径 chip（对齐 Cindy FileTargetChip +
 * Tip 黑卡的合成形态）：
 * - 视觉复用 `.md code:not(pre code)` 行内代码底（<code> 元素天然继承），
 *   加常显下划线（globals 可点性规范：下划线是唯一可点信号，不改色）；
 * - 悬停 ~300ms 出完整路径卡：黑底 Card + 1px Board 描边 + 右上角复制图标，
 *   点击复制完整路径，鼠标移开消失（卡与 chip 之间用 padding 桥接，
 *   移到卡上不关，复制图标可点）；
 * - 点击 chip 本体走 onOpenFile（Canvas 预览，与消息里其它文件 chip 同策）；
 * - 用 <code role="button"> 而非 <button>：划选复制消息时富文本编辑器
 *   （Slack / 飞书 / Word）的标签白名单里没有 button，路径文字会凭空消失
 *   （Cindy 同款取舍）。
 */
import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '../../lib/cn';
import { useReducedMotion } from '../../hooks/useReducedMotion';

const SHOW_DELAY_MS = 300;
const COPIED_RESET_MS = 1600;

export function FilePathChip({
  label,
  fullPath,
  onOpen,
  className,
}: {
  /** chip 显示文字（正文里的原文片段） */
  label: string;
  /** 悬停卡展示 / 复制的完整路径 */
  fullPath: string;
  /** 点击 chip 打开（Canvas 预览）；无则点击退化为复制 */
  onOpen?: (path: string) => void;
  className?: string;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);
  const copiedTimerRef = useRef<number | null>(null);
  const reduced = useReducedMotion();

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current);
    },
    [],
  );

  const show = (): void => {
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

  const copy = (): void => {
    void window.fundet
      .copyText(fullPath)
      .then(() => {
        setCopied(true);
        if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current);
        copiedTimerRef.current = window.setTimeout(() => setCopied(false), COPIED_RESET_MS);
      })
      .catch(() => setCopied(false));
  };

  const activate = (): void => {
    if (onOpen) onOpen(fullPath);
    else copy();
  };

  return (
    <span
      className={cn('relative inline-flex max-w-full', className)}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      <code
        role="button"
        tabIndex={0}
        onClick={activate}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          activate();
        }}
        className={cn(
          'cursor-pointer break-all underline decoration-board underline-offset-2',
          'transition-colors hover:bg-hover hover:decoration-current',
        )}
      >
        {label}
      </code>
      {open && (
        // 外层 pb 桥接 chip 与卡的间隙：悬停移到卡上不关（复制图标可点）
        <span className="absolute bottom-full left-0 z-50 pb-1.5">
          <span
            role="tooltip"
            className={cn(
              'flex w-max max-w-[min(420px,70vw)] items-start gap-1.5 rounded-lg border border-board bg-card',
              'py-1.5 pl-2.5 pr-1.5 shadow-[var(--shadow-menu)] select-none',
              !reduced && 'animate-[path-card-in_var(--motion-fast)_var(--motion-ease-out)]',
            )}
          >
            <span className="min-w-0 flex-1 self-center break-all font-mono text-12 leading-[1.5] text-secondary">
              {fullPath}
            </span>
            <button
              type="button"
              aria-label={copied ? '已复制' : '复制完整路径'}
              title={copied ? '已复制' : '复制完整路径'}
              onClick={copy}
              className={cn(
                'mt-[1px] flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px]',
                'text-muted transition-colors hover:bg-hover hover:text-primary',
              )}
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
            </button>
          </span>
        </span>
      )}
    </span>
  );
}
