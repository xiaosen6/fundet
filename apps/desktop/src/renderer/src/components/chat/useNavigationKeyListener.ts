/**
 * useNavigationKeyListener —— Cindy 同名 hook 移植。
 * ---------------------------------------------------------------------------
 * 在 window 上监听「翻页/方向类」按键，触发回调。
 *
 * 用途：MessageNavRail 的乐观 pending 态需要区分「用户主动想看历史」和
 * 「smooth scroll 余波」。wheel/touch 挂在 scroll 容器上即可，但键盘焦点常常
 * 不在 scroll 容器上（尤其输入框聚焦时仍能用 PageUp / 方向键滚 chat），
 * 所以必须挂 window 才捕获得到。
 *
 * Fundet 复用 lib/card-shortcut-yield 的 isEditableKeyboardTarget 做可编辑
 * 目标判定（同一语义的既有单一信息源）。
 */

import { useEffect, useRef } from 'react';

import { isEditableKeyboardTarget } from '../../lib/card-shortcut-yield';

/** 翻页/方向/空格滚动键 — 视为用户接管程序化滚动。
 *  普通文字键（字母数字、Tab、Enter 等）不在内，避免输入框打字被误当成滚动意图。 */
export const NAVIGATION_KEYS: ReadonlySet<string> = new Set([
  'PageUp',
  'PageDown',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  ' ',
]);

export function shouldHandleNavigationKey(key: string, target: EventTarget | null): boolean {
  if (!NAVIGATION_KEYS.has(key)) return false;
  if (key === ' ' && target != null && isEditableKeyboardTarget(target)) return false;
  return true;
}

/**
 * 监听 window keydown，任一 NAVIGATION_KEYS 触发时调用 onNavKey。
 * onNavKey / enabled 用 ref 持有，避免每次 render 重新挂 listener。
 */
export function useNavigationKeyListener(onNavKey: () => void, enabled = true): void {
  const cbRef = useRef(onNavKey);
  cbRef.current = onNavKey;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (!enabledRef.current) return;
      if (shouldHandleNavigationKey(e.key, e.target)) {
        cbRef.current();
      }
    };
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
    };
  }, []);
}
