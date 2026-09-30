/**
 * HoverImgPreview —— 消息图片的悬停放大预览（Cindy ImageHoverPreview 简化版）。
 * 纯 DOM 单例（toast/lightbox 同款模式）：hover 600ms 后在光标附近浮出
 * 320px 预览；点击行为不变（仍走 Lightbox/Canvas）。pointer-events 关闭。
 *
 * 隐藏走「全局兜底」而非只靠 mouseleave（2026-09-30 用户实报「图片一直跟随
 * 飘到屏幕各处」）：虚拟化列表行回收不触发 mouseleave，预览会卡死在屏幕上——
 * 现在显示期间挂 document mousemove，光标离开锚点矩形（或无锚点时离开原点
 * 180px）即隐；任何滚动/窗口失焦也即隐（fixed 元素不随内容滚，留着只会误导）。
 */
import { useRef } from 'react';

let el: HTMLImageElement | null = null;
/** 触发预览的锚点（悬停目标）；光标离开它的矩形即隐藏 */
let anchor: Element | null = null;
/** 无锚点时的原点（命令式调用只给坐标） */
let origin: { x: number; y: number } | null = null;
let cleanupGlobals: (() => void) | null = null;

function ensureGlobalTracking(): void {
  if (cleanupGlobals) return;
  const onMove = (e: MouseEvent): void => {
    if (!el || el.style.opacity === '0') return;
    const pad = 16;
    if (anchor) {
      const r = anchor.getBoundingClientRect();
      const inside = e.clientX >= r.left - pad && e.clientX <= r.right + pad && e.clientY >= r.top - pad && e.clientY <= r.bottom + pad;
      if (!inside) hideHoverPreview();
    } else if (origin) {
      const dx = e.clientX - origin.x;
      const dy = e.clientY - origin.y;
      if (dx * dx + dy * dy > 180 * 180) hideHoverPreview();
    }
  };
  const onHide = (): void => hideHoverPreview();
  document.addEventListener('mousemove', onMove, true);
  window.addEventListener('scroll', onHide, true);
  window.addEventListener('blur', onHide);
  window.addEventListener('resize', onHide);
  cleanupGlobals = () => {
    document.removeEventListener('mousemove', onMove, true);
    window.removeEventListener('scroll', onHide, true);
    window.removeEventListener('blur', onHide);
    window.removeEventListener('resize', onHide);
    cleanupGlobals = null;
  };
}

export function showHoverPreview(src: string, x: number, y: number, anchorEl?: Element): void {
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
  anchor = anchorEl ?? null;
  origin = anchorEl ? null : { x, y };
  const pad = 12;
  const left = Math.min(Math.max(pad, x + 16), Math.max(pad, window.innerWidth - 336));
  const top = Math.min(Math.max(pad, y - 336), Math.max(pad, window.innerHeight - 336));
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  ensureGlobalTracking();
  requestAnimationFrame(() => {
    if (el) el.style.opacity = '1';
  });
}

export function hideHoverPreview(): void {
  if (el) el.style.opacity = '0';
  anchor = null;
  origin = null;
}

let pendingTimer: number | null = null;

/** 命令式用法（markdown 组件回调里没有 hook 上下文）：延迟浮出，移开取消 */
export function scheduleHoverPreview(src: string, x: number, y: number, anchorEl?: Element, delayMs = 600): void {
  cancelScheduledHoverPreview();
  pendingTimer = window.setTimeout(() => {
    pendingTimer = null;
    showHoverPreview(src, x, y, anchorEl);
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
      const anchorEl = e.currentTarget;
      timer.current = window.setTimeout(() => showHoverPreview(src, x, y, anchorEl), 600);
    },
    onMouseLeave: clear,
    onMouseDown: clear,
  };
}
