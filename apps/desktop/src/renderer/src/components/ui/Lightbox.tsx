/**
 * Lightbox — 全屏媒体查看（图片点开放大 / mermaid 图表放大，对齐 Cindy
 * ImageLightbox / MermaidLightbox 的合并轻量版）。
 *
 * 模块级 service：showLightbox({ src }) 或 showLightbox({ node })；宿主在
 * App 根挂一次。Esc / 点击遮罩 / 再次点击内容关闭；reduced-motion 无缩放动画。
 */
import { useEffect, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/cn';
import { useReducedMotion } from '../../hooks/useReducedMotion';

type LightboxPayload =
  | { kind: 'image'; src: string; alt?: string }
  | { kind: 'node'; label?: string; node: ReactNode };

let listeners = new Set<(p: LightboxPayload | null) => void>();
let current: LightboxPayload | null = null;

export function showLightbox(payload: LightboxPayload): void {
  current = payload;
  for (const l of listeners) l(current);
}

export function closeLightbox(): void {
  current = null;
  for (const l of listeners) l(current);
}

export function LightboxHost(): React.JSX.Element | null {
  const [payload, setPayload] = useState<LightboxPayload | null>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    listeners.add(setPayload);
    return () => {
      listeners.delete(setPayload);
    };
  }, []);

  useEffect(() => {
    if (!payload) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeLightbox();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [payload]);

  if (!payload) return null;
  return (
    <div
      className={cn(
        'fixed inset-0 z-[80] flex flex-col bg-black/80 backdrop-blur-[2px]',
        !reduced && 'animate-[tooltip-in_120ms_ease-out]',
      )}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeLightbox();
      }}
    >
      <div className="flex items-center justify-between px-4 pt-3">
        <span className="max-w-[60%] truncate text-13 text-white/70 select-none">
          {payload.kind === 'image' ? (payload.alt ?? '') : (payload.label ?? '')}
        </span>
        <button
          type="button"
          aria-label="关闭"
          className="flex h-8 w-8 items-center justify-center rounded-full text-white/70 hover:bg-white/10 hover:text-white"
          onClick={closeLightbox}
        >
          <X size={16} />
        </button>
      </div>
      <div
        className="flex min-h-0 flex-1 cursor-zoom-out items-center justify-center p-6"
        onClick={closeLightbox}
      >
        {payload.kind === 'image' ? (
          <img
            src={payload.src}
            alt={payload.alt ?? ''}
            className="max-h-full max-w-full rounded-container object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <div
            className="max-h-full max-w-full overflow-auto rounded-container bg-card p-4"
            onClick={(e) => e.stopPropagation()}
          >
            {payload.node}
          </div>
        )}
      </div>
    </div>
  );
}
