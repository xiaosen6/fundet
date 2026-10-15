/**
 * useScrollFade —— 滚动边缘渐隐（CDS ScrollFadeContainer 同款）。
 * 按滚动位置往容器上写 --sf-top/--sf-bottom（0 或 28px，触顶/触底 2px 内归零），
 * 配合 globals.css 的 .scroll-fade 7 档非线性遮罩生效。
 */
import { useEffect, type RefObject } from 'react';

const FADE_PX = 28;
const EDGE_PX = 2;

export function useScrollFade(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = (): void => {
      el.style.setProperty('--sf-top', el.scrollTop > EDGE_PX ? `${FADE_PX}px` : '0px');
      el.style.setProperty(
        '--sf-bottom',
        el.scrollHeight - el.scrollTop - el.clientHeight > EDGE_PX ? `${FADE_PX}px` : '0px',
      );
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    // 容器尺寸与内容高度变化都要重算（内容增长不触发 scroll 事件）
    const ro = new ResizeObserver(update);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, [ref]);
}
