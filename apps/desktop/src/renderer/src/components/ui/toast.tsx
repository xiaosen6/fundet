/**
 * Toast — 全局轻提示（对齐 Cindy toast 的 API 形态，视觉走 CINDY token）。
 *
 * 模块级 store + useSyncExternalStore：任何模块 `toast.success('…')` 即发，
 * <ToastContainer /> 在 App 根挂一次。自动 2.6s 退场（250ms 淡出）；
 * 只用于「操作完成/失败」反馈，不用作持久状态展示。
 */
import { useSyncExternalStore } from 'react';
import { AlertCircle, CheckCircle2, Info } from 'lucide-react';
import { cn } from '../../lib/cn';

export type ToastVariant = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  text: string;
  variant: ToastVariant;
  exiting: boolean;
}

let items: ToastItem[] = [];
const listeners = new Set<() => void>();
let seq = 0;
const VISIBLE_MS = 2600;
const EXIT_MS = 250;

function notify(): void {
  for (const l of listeners) l();
}

function push(variant: ToastVariant, text: string): void {
  const id = ++seq;
  items = [...items, { id, text, variant, exiting: false }];
  notify();
  window.setTimeout(() => {
    items = items.map((t) => (t.id === id ? { ...t, exiting: true } : t));
    notify();
    window.setTimeout(() => {
      items = items.filter((t) => t.id !== id);
      notify();
    }, EXIT_MS);
  }, VISIBLE_MS);
}

export const toast = {
  success: (text: string): void => push('success', text),
  error: (text: string): void => push('error', text),
  info: (text: string): void => push('info', text),
};

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

const ICONS = {
  success: { Icon: CheckCircle2, cls: 'text-success' },
  error: { Icon: AlertCircle, cls: 'text-error' },
  info: { Icon: Info, cls: 'text-muted' },
} as const;

export function ToastContainer(): React.JSX.Element {
  const list = useSyncExternalStore(subscribe, () => items);
  return (
    <div className="pointer-events-none fixed bottom-24 left-1/2 z-[70] flex -translate-x-1/2 flex-col items-center gap-2">
      {list.map((t) => {
        const { Icon, cls } = ICONS[t.variant];
        return (
          <div
            key={t.id}
            className={cn(
              'flex h-8 max-w-[420px] items-center gap-2 rounded-full border border-board bg-card px-3.5 text-13 text-primary shadow-[var(--shadow-menu)]',
              'transition-all duration-[var(--motion-base)] ease-[var(--motion-ease-move)]',
              t.exiting ? 'translate-y-1 opacity-0' : 'translate-y-0 opacity-100',
            )}
          >
            <Icon size={14} className={cn('shrink-0', cls)} />
            <span className="min-w-0 truncate">{t.text}</span>
          </div>
        );
      })}
    </div>
  );
}
