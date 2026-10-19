/**
 * Roving focus（WAI-ARIA 焦点漫游，CDS §6.6）：组内唯一 tabIndex=0，方向键
 * 移动焦点、Home/End 跳边界、跳过禁用项；Tab/Shift+Tab 自然离开组；修饰键
 * 组合（Ctrl/Meta/Alt）原样放行。焦点跟随点击同步 active 索引。
 */
import { useCallback, useRef, useState, type KeyboardEvent } from 'react';

export interface RovingFocusOptions {
  orientation?: 'horizontal' | 'vertical';
  loop?: boolean;
  /** 禁用项判定（按索引）；禁用项被跳过且不可成为 tab 锚点 */
  isDisabled?: (index: number) => boolean;
}

export function useRovingFocus(count: number, options: RovingFocusOptions = {}) {
  const { orientation = 'horizontal', loop = false, isDisabled } = options;
  const [activeIndex, setActiveIndex] = useState(0);
  const activeRef = useRef(0);
  activeRef.current = activeIndex;

  const nextEnabled = (from: number, delta: 1 | -1): number | null => {
    if (count === 0) return null;
    let i = from;
    for (let step = 0; step < count; step++) {
      i = i + delta;
      if (loop) i = (i + count) % count;
      else if (i < 0 || i >= count) return null;
      if (!isDisabled?.(i)) return i;
    }
    return null;
  };

  const onKeyDown = useCallback(
    (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey) return; // 修饰组合归调用方/系统
      const keys =
        orientation === 'horizontal'
          ? { prev: 'ArrowLeft', next: 'ArrowRight' }
          : { prev: 'ArrowUp', next: 'ArrowDown' };
      const other =
        orientation === 'horizontal'
          ? { prev: 'ArrowUp', next: 'ArrowDown' }
          : { prev: 'ArrowLeft', next: 'ArrowRight' };
      let target: number | null = null;
      if (e.key === keys.prev) target = nextEnabled(activeRef.current, -1);
      else if (e.key === keys.next) target = nextEnabled(activeRef.current, 1);
      else if (e.key === other.prev || e.key === other.next) {
        // 非主轴方向键不拦截（横向组里的 ↑↓ 交给页面滚动等）
        return;
      } else if (e.key === 'Home') target = nextEnabled(-1, 1);
      else if (e.key === 'End') target = nextEnabled(count, -1);
      else return;
      if (target === null) return;
      e.preventDefault();
      setActiveIndex(target);
      // 焦点移动交给 DOM：container 的事件代理查 data-roving-index
      const container = e.currentTarget as HTMLElement;
      const el = container.querySelector<HTMLElement>(`[data-roving-index="${target}"]`);
      el?.focus({ preventScroll: true });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [count, orientation, loop, isDisabled],
  );

  /** 组内条目：active=0（tab 锚点），其余 -1 */
  const itemTabIndex = useCallback(
    (index: number): 0 | -1 => (index === activeIndex && !isDisabled?.(index) ? 0 : -1),
    [activeIndex, isDisabled],
  );

  const onItemFocus = useCallback((index: number): void => {
    setActiveIndex(index);
  }, []);

  return { onKeyDown, itemTabIndex, onItemFocus, activeIndex };
}
