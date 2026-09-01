/**
 * useReducedMotion — 跟踪 prefers-reduced-motion 系统偏好。
 * 动效组件（Collapse / MorphPopover / 流式逐词淡入）据此降级为直切。
 */
import { useEffect, useState } from 'react';

const MEDIA_QUERY = '(prefers-reduced-motion: reduce)';

function readInitial(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia(MEDIA_QUERY).matches;
  } catch {
    return false;
  }
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(readInitial);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(MEDIA_QUERY);
    const handler = (event: MediaQueryListEvent): void => setReduced(event.matches);
    setReduced(mql.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  return reduced;
}
