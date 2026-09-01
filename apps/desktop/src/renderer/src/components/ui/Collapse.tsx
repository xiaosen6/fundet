/**
 * Collapse —— 聊天流卡片通用的展开/收起高度动画容器（移植自 Cindy，同参数）。
 *
 * DESIGN.md §14.4「展开/折叠」原型：grid-template-rows 0fr ↔ 1fr（无需测量
 * 内容高度）+ opacity，200ms / ease-move；内容收起后卸载（工具输出可能很重，
 * 长会话不允许常驻 DOM）。
 *
 * 编排规则：
 * - 首次挂载不播动画（初始即终态），只有用户点击切换才动。
 * - 展开：先挂载（0fr 帧提交）→ 下一帧切 1fr 起播。
 * - 收起：切 0fr 起播，transitionend 后卸载；fallback 定时器兜底（reduced-motion
 *   的全局 transition:none 会让 transitionend 缺席）。
 * - 收起动画期间渲染「最后一次展开态」的 children 快照（父组件可能已按收起态
 *   置空数据，不冻结会让内容在动画中途被换掉）。
 */
import { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import { useReducedMotion } from '../../hooks/useReducedMotion';

/** 收起卸载兜底（动画 200ms + 余量） */
const COLLAPSE_UNMOUNT_FALLBACK_MS = 280;

interface CollapseProps extends React.HTMLAttributes<HTMLDivElement> {
  open: boolean;
  /** 追加在内层内容容器上的 class（外层 grid 容器用 className）。 */
  innerClassName?: string;
  children: React.ReactNode;
}

export function Collapse({
  open,
  className,
  innerClassName,
  children,
  ...rest
}: CollapseProps): React.JSX.Element | null {
  const reducedMotion = useReducedMotion();
  const [mounted, setMounted] = useState(open);
  const [expanded, setExpanded] = useState(open);
  // transitionend 可能在快速再展开后迟到，用最新 open 拦掉过期的卸载
  const openRef = useRef(open);
  openRef.current = open;
  const isFirstRun = useRef(true);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 退场冻结快照（见文件头注释）
  const lastOpenChildrenRef = useRef<React.ReactNode>(open ? children : null);
  if (open) {
    lastOpenChildrenRef.current = children;
  }

  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return undefined;
    }
    if (open) {
      if (fallbackTimerRef.current !== null) {
        clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }
      setMounted(true);
      if (reducedMotion) {
        setExpanded(true);
        return undefined;
      }
      const id = requestAnimationFrame(() => setExpanded(true));
      return () => cancelAnimationFrame(id);
    }
    setExpanded(false);
    if (reducedMotion) {
      setMounted(false);
      return undefined;
    }
    fallbackTimerRef.current = setTimeout(() => setMounted(false), COLLAPSE_UNMOUNT_FALLBACK_MS);
    return () => {
      if (fallbackTimerRef.current !== null) {
        clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }
    };
  }, [open, reducedMotion]);

  if (!mounted) {
    lastOpenChildrenRef.current = null;
    return null;
  }

  return (
    <div
      {...rest}
      className={cn(
        'grid transition-[grid-template-rows] duration-[var(--motion-base,200ms)] ease-[var(--motion-ease-move,cubic-bezier(0.4,0,0.2,1))] motion-reduce:duration-0',
        expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        className,
      )}
      onTransitionEnd={(e) => {
        if (
          e.target === e.currentTarget &&
          e.propertyName === 'grid-template-rows' &&
          !openRef.current
        ) {
          if (fallbackTimerRef.current !== null) {
            clearTimeout(fallbackTimerRef.current);
            fallbackTimerRef.current = null;
          }
          setMounted(false);
        }
      }}
    >
      <div
        aria-hidden={!expanded || undefined}
        className={cn(
          'min-h-0 overflow-hidden',
          'transition-opacity duration-[var(--motion-base,200ms)] ease-[var(--motion-ease-move,cubic-bezier(0.4,0,0.2,1))] motion-reduce:duration-0',
          expanded ? 'opacity-100' : 'opacity-0',
          innerClassName,
        )}
      >
        {open ? children : lastOpenChildrenRef.current}
      </div>
    </div>
  );
}
