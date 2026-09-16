/**
 * ConfirmDialog — 全局确认对话框（对齐 Cindy confirm-dialog 观感：
 * 中性遮罩淡入 + 卡片缩放淡入/淡出，不突兀；danger 态确认键为错误色实底）。
 * 服务式 API：await confirmDialog({...})；未挂载 Host 时兜底 window.confirm。
 * Esc=取消，Enter=确认；reduced-motion 下不做进出场动画。
 */
import { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import { useReducedMotion } from '../../hooks/useReducedMotion';

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  /** 删除/不可逆类操作：确认键错误色 */
  danger?: boolean;
}

let confirmImpl: ((options: ConfirmOptions) => Promise<boolean>) | null = null;

/** 全局确认：await confirmDialog({ title: '…', danger: true }) → boolean */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  if (!confirmImpl) return Promise.resolve(window.confirm(options.title));
  return confirmImpl(options);
}

interface PendingState {
  options: ConfirmOptions;
  resolve: (v: boolean) => void;
}

export function ConfirmDialogHost(): React.JSX.Element | null {
  const [pending, setPending] = useState<PendingState | null>(null);
  const [closing, setClosing] = useState(false);
  const resolveRef = useRef<((v: boolean) => void) | null>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    confirmImpl = (options: ConfirmOptions): Promise<boolean> =>
      new Promise<boolean>((resolve) => {
        resolveRef.current?.(false); // 同时刻只保留一张：旧请求直接取消
        resolveRef.current = resolve;
        setPending({ options, resolve });
      });
    return () => {
      confirmImpl = null;
    };
  }, []);

  const settle = (v: boolean): void => {
    if (!pending) return;
    if (reduced) {
      resolveRef.current?.(v);
      setPending(null);
      return;
    }
    // 短暂退场动画后再落定，避免弹窗瞬间消失的生硬感
    setClosing(true);
    window.setTimeout(() => {
      resolveRef.current?.(v);
      setPending(null);
      setClosing(false);
    }, 140);
  };

  useEffect(() => {
    if (!pending || closing) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') settle(false);
      if (e.key === 'Enter') settle(true);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, closing]);

  if (!pending) return null;
  const { options } = pending;
  return (
    <div
      className={cn(
        'fixed inset-0 z-[75] bg-neutral-900/40',
        reduced
          ? ''
          : closing
            ? 'animate-[confirm-overlay-out_140ms_ease-out_forwards]'
            : 'animate-[confirm-overlay-in_160ms_ease-out]',
      )}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) settle(false);
      }}
    >
      <div className="flex h-full items-center justify-center p-4">
        <div
          role="dialog"
          aria-modal="true"
          className={cn(
            'w-full max-w-[400px] rounded-xl border border-board bg-card p-4 shadow-[var(--shadow-menu)]',
            reduced
              ? ''
              : closing
                ? 'animate-[confirm-card-out_140ms_ease-in_forwards]'
                : 'animate-[confirm-card-in_160ms_ease-out]',
          )}
        >
          <p className="text-16 font-medium text-primary">{options.title}</p>
          {options.description && (
            <p className="mt-2 text-13 leading-[1.6] text-secondary">{options.description}</p>
          )}
          <div className="mt-5 flex justify-end gap-2.5">
            <button
              type="button"
              className="h-9 min-w-[88px] rounded-lg border border-board px-3 text-13 text-secondary transition-colors hover:bg-hover"
              onClick={() => settle(false)}
            >
              {options.cancelText ?? '取消'}
            </button>
            <button
              type="button"
              autoFocus
              className={cn(
                'h-9 min-w-[88px] rounded-lg px-3 text-13 font-medium transition-colors',
                options.danger
                  ? 'bg-error text-white hover:opacity-90'
                  : 'bg-accent text-accent-fg hover:bg-accent-hover',
              )}
              onClick={() => settle(true)}
            >
              {options.confirmText ?? '确认'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
