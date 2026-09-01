/**
 * 会话行内改名：Enter 提交、Esc 取消、点外面 / blur 提交。IME 组词中的 Enter 不提交。
 */
import { useEffect, useRef } from 'react';
import { cn } from '../lib/cn';

interface SessionRenameInputProps {
  value: string;
  onChange: (value: string) => void;
  onCommit: (raw: string) => void;
  onCancel: () => void;
  className?: string;
}

export function SessionRenameInput({
  value,
  onChange,
  onCommit,
  onCancel,
  className,
}: SessionRenameInputProps): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const latest = useRef({ value, onCommit });
  latest.current = { value, onCommit };

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent): void => {
      const el = boxRef.current;
      if (!el || el.contains(e.target as Node)) return;
      latest.current.onCommit(latest.current.value);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, []);

  return (
    <div ref={boxRef} className={cn('min-w-0 flex-1', className)} onClick={(e) => e.stopPropagation()}>
      <input
        ref={inputRef}
        value={value}
        maxLength={80}
        aria-label="会话名称"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            onCommit(value);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onCancel();
          }
        }}
        onBlur={() => onCommit(value)}
        className={cn(
          'h-6 w-full rounded-md bg-transparent px-1 text-14 font-medium outline-none',
          'border border-board text-inherit',
        )}
      />
    </div>
  );
}
