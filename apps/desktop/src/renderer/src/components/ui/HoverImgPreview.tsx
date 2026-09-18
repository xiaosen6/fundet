/**
 * HoverImgPreview —— 消息图片的悬停放大预览（Cindy ImageHoverPreview 简化版）。
 * 纯 DOM 单例（toast/lightbox 同款模式）：hover 600ms 后在光标附近浮出
 * 320px 预览，移开即隐；点击行为不变（仍走 Lightbox/Canvas）。pointer-events
 * 关闭，不挡任何交互。
 */
import { useRef } from 'react';

let el: HTMLImageElement | null = null;

export function showHoverPreview(src: string, x: number, y: number): void {
  if (!el) {
    el = document.createElement('img');
    el.alt = '';
    el.draggable = false;
    el.style.cssText =
      'position:fixed;z-index:60;max-width:320px;max-height:320px;object-fit:contain;' +
      'border:1px solid var(--board);border-radius:8px;background:var(--card);' +
      'box-shadow:var(--shadow-menu);pointer-events:none;opacity:0;' +
      'transition:opacity 120ms ease-out';
    document.body.appendChild(el);
  }
  el.src = src;
  const pad = 12;
  const left = Math.min(Math.max(pad, x + 16), Math.max(pad, window.innerWidth - 336));
  const top = Math.min(Math.max(pad, y - 336), Math.max(pad, window.innerHeight - 336));
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  requestAnimationFrame(() => {
    if (el) el.style.opacity = '1';
  });
}

export function hideHoverPreview(): void {
  if (el) el.style.opacity = '0';
}

let pendingTimer: number | null = null;

/** 命令式用法（markdown 组件回调里没有 hook 上下文）：延迟浮出，移开取消 */
export function scheduleHoverPreview(src: string, x: number, y: number, delayMs = 600): void {
  cancelScheduledHoverPreview();
  pendingTimer = window.setTimeout(() => {
    pendingTimer = null;
    showHoverPreview(src, x, y);
  }, delayMs);
}

export function cancelScheduledHoverPreview(): void {
  if (pendingTimer !== null) {
    window.clearTimeout(pendingTimer);
    pendingTimer = null;
  }
  hideHoverPreview();
}

/** 组件侧用法：把返回的 handlers 挂到 <img>/<button>；getSrc 在触发时取当前地址 */
export function useHoverPreview(getSrc: () => string | null | undefined): {
  onMouseEnter: (e: React.MouseEvent) => void;
  onMouseLeave: () => void;
  onMouseDown: () => void;
} {
  const timer = useRef<number | null>(null);
  const clear = (): void => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    hideHoverPreview();
  };
  return {
    onMouseEnter: (e) => {
      clear();
      const src = getSrc();
      if (!src) return;
      const { clientX: x, clientY: y } = e;
      timer.current = window.setTimeout(() => showHoverPreview(src, x, y), 600);
    },
    onMouseLeave: clear,
    onMouseDown: clear,
  };
}
