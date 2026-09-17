/**
 * FadeSwitcher —— 主区域内容切换的淡入容器（Cindy F4 FadeSwitcher 手工移植）。
 *
 * 用法：<FadeSwitcher trigger={location.pathname}>{…}</FadeSwitcher>
 * - trigger 变化（路由 pathname / 能力面板开关 / 会话 id）→ 容器 opacity 0→1
 *   过渡（220ms、--motion-enter 曲线）。与 Cindy 的 key 重挂方案不同，这里子树
 *   **不重挂**：composer 草稿、输入焦点、滚动位置等本地状态在会话间切换时保留，
 *   内容替换由 React 正常完成，本组件只负责「浮现」节奏。
 * - useLayoutEffect 在 paint 前压 opacity:0（否则新内容会先闪一帧再淡入），
 *   rAF 再切 1 起播——两次 setState 必须隔帧，批处理会吞掉起点帧。
 * - transitionend 清 will-change 防合成层堆积；每次重新触发时再置位。
 * - prefers-reduced-motion：无过渡瞬间替换。
 * - 性能边界（F4）：仅 opacity；禁止 width/height/top/left/margin/padding 动画。
 */
import { useLayoutEffect, useState, type ReactNode, type TransitionEvent } from 'react';
import { cn } from '../../lib/cn';
import { useReducedMotion } from '../../hooks/useReducedMotion';

/** F4 路由/区域切换类别的专用时长（§14.4 档位外的既定例外，Cindy 同值） */
const FADE_MS = 220;

interface FadeSwitcherProps {
  /** 变化即触发一次淡入；传路由 pathname / 面板 id / 会话 id */
  trigger: string | null;
  children: ReactNode;
  className?: string;
}

export function FadeSwitcher({ trigger, children, className }: FadeSwitcherProps): React.JSX.Element {
  const reducedMotion = useReducedMotion();
  const [opacity, setOpacity] = useState(0);
  const [willChange, setWillChange] = useState<'opacity' | 'auto'>('opacity');

  useLayoutEffect(() => {
    if (reducedMotion) {
      setOpacity(1);
      setWillChange('auto');
      return;
    }
    setWillChange('opacity');
    setOpacity(0);
    const id = requestAnimationFrame(() => setOpacity(1));
    return () => cancelAnimationFrame(id);
  }, [trigger, reducedMotion]);

  const handleTransitionEnd = (e: TransitionEvent<HTMLDivElement>): void => {
    if (e.propertyName === 'opacity') setWillChange('auto');
  };

  return (
    <div
      onTransitionEnd={handleTransitionEnd}
      className={cn('flex min-h-0 w-full flex-col', className)}
      style={{
        opacity,
        willChange,
        transition: reducedMotion ? 'none' : `opacity ${FADE_MS}ms var(--motion-ease-out)`,
      }}
    >
      {children}
    </div>
  );
}
