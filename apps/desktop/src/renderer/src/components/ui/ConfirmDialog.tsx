/**
 * ConfirmDialog — 全局确认对话框（替代 window.confirm 的系统灰框）。
 *
 * 模块级 service：<ConfirmDialogHost /> 在 App 根挂一次并接管 confirmDialog；
 * 未挂载时兜底回 window.confirm（测试/异常形态不断功能）。Esc=取消，
 * Enter=确认；danger 态确认键为错误色（删除类操作）。
 */
import { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/cn';

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
  const resolveRef = useRef<((v: boolean) => void) | null>(null);

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
    resolveRef.current?.(v);
    resolveRef.current = null;
    setPending(null);
  };

  useEffect(() => {
    if (!pending) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') settle(false);
      if (e.key === 'Enter') settle(true);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  if (!pending) return null;
  const { options } = pending;
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/25 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) settle(false);
      }}
    >
      <div className="w-[360px] rounded-container border border-board bg-card p-5 shadow-[var(--shadow-menu)]">
        <p className="text-15 font-medium text-primary">{options.title}</p>
        {options.description && (
          <p className="mt-2 text-13 leading-[1.6] text-secondary">{options.description}</p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className="h-8 rounded-full border border-board px-4 text-13 text-secondary hover:bg-hover"
            onClick={() => settle(false)}
          >
            {options.cancelText ?? '取消'}
          </button>
          <button
            type="button"
            className={cn(
              'h-8 rounded-full px-4 text-13 font-medium transition-colors',
              options.danger
                ? 'border border-error-border bg-error-bg text-error hover:bg-error-bg/70'
                : 'bg-accent text-accent-fg hover:bg-accent-hover',
            )}
            autoFocus
            onClick={() => settle(true)}
          >
            {options.confirmText ?? '确认'}
          </button>
        </div>
      </div>
    </div>
  );
}
